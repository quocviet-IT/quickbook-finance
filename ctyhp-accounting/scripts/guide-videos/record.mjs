/**
 * Records the guide videos' pictures (3.0.28): one take per guide, from the
 * sample company, with the step's control pointed at and ringed while its
 * narration is read.
 *
 *   node --env-file=.env.local scripts/guide-videos/record.mjs <work-dir> <guide id>… [--base=<url>]
 *
 * Run tts.py first: each beat is held on screen for as long as its lines take
 * to say (<work-dir>/durations.json). Banking's guides point at the bank
 * accounts, reconciliations and Plaid test feed that `npm run guide:step-shots`
 * makes in Meridian, so run that first; the deployed app is the one with Plaid.
 *
 * The page is filmed with the browser's own screencast, every frame stamped
 * with its time; each beat records when it started and ended and what it was
 * about (the area to fill the frame with). build.mjs cuts everything between
 * beats (pages loading, dialogs closing), so the film has no dead time and the
 * voice lands where the picture is.
 *
 * Nothing is saved: a dialog is opened and closed, a menu opened and left; no
 * button that posts, imports, issues or deletes is pressed (`press` refuses
 * them). Real people's and companies' names are swapped for invented ones in
 * every page as it draws (overlay.js), and a beat that still shows one fails.
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { smokeSession } from "../smoke-environment.mjs";
import { CHECKING_APRIL, statementFile } from "../guide-statements.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const work = args.find((arg) => !arg.startsWith("--"));
const guides = args.filter((arg) => !arg.startsWith("--") && arg !== work);
const base = args.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ?? "https://ctyhp-accounting.vercel.app";
if (!work || !guides.length) throw new Error("usage: record.mjs <work-dir> <guide id>… [--base=<url>]");

const narration = JSON.parse(readFileSync(join(HERE, "narration.json"), "utf8"));
const durations = JSON.parse(readFileSync(join(work, "durations.json"), "utf8"));
const overlay = readFileSync(join(HERE, "overlay.js"), "utf8");

const VIEWPORT = { width: 1280, height: 720 };
const GAP = 320; // a breath between lines, ms
const LEAD = 450; // the first word starts a moment after the cut
const HOLD = 900; // the screen stays a moment after the last word
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

// --- The sample company, and nothing else -------------------------------------

const { session, user, supabaseUrl } = await smokeSession();
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: found } = await admin
  .schema("onebook")
  .from("company")
  .select("slug,schema_name,is_sample")
  .eq("slug", "meridian")
  .limit(1);
const company = found?.[0];
if (!company?.is_sample) throw new Error("refusing to record anything but the sample company Meridian");
const books = admin.schema(company.schema_name);

/** Pairs of [what a screen would show, what the film shows instead]. Kept in memory only. */
async function realNames() {
  const invented = ["Alex Morgan", "Sam Rivera", "Jordan Lee", "Taylor Brooks"];
  const companies = ["Riverbend Supply Co.", "Harbor Relay LLC", "Cedar Point Holdings", "Bluewater Trading Inc."];
  const swaps = [];
  const { data: people } = await books.from("acc_app_user").select("id,full_name");
  for (const [index, person] of (people ?? []).entries()) {
    if (person.full_name) swaps.push([person.full_name, invented[index % invented.length]]);
    const { data } = await admin.auth.admin.getUserById(person.id);
    if (data?.user?.email) swaps.push([data.user.email, `${invented[index % invented.length].toLowerCase().replace(" ", ".")}@example.com`]);
  }
  if (user?.email) swaps.push([user.email, "alex.morgan@example.com"]);
  const { data: others } = await admin.schema("onebook").from("company").select("*").neq("slug", "meridian");
  for (const [index, other] of (others ?? []).entries()) {
    for (const key of ["legal_name", "display_name", "dba_name", "name"]) {
      if (typeof other[key] === "string" && other[key].trim()) swaps.push([other[key], companies[index % companies.length]]);
    }
    for (const key of ["slug", "schema_name"]) {
      if (typeof other[key] === "string" && other[key].length > 3) swaps.push([other[key], `company-${index + 2}`]);
    }
  }
  return swaps.sort((a, b) => b[0].length - a[0].length);
}

/** What Banking's beats point at, made by guide:step-shots. Read only. */
async function bankingIds() {
  const bankFor = async (code) => {
    const { data: gl } = await books.from("acc_account").select("id").eq("account_code", code).single();
    const { data } = await books.from("acc_bank_account").select("id").eq("account_id", gl.id).maybeSingle();
    return data?.id ?? null;
  };
  const rec = async (bank, ending) => {
    const { data } = await books
      .from("acc_statement_reconciliation")
      .select("id")
      .eq("bank_account_id", bank)
      .eq("statement_ending_date", ending)
      .eq("status", "in_progress")
      .limit(1);
    return data?.[0]?.id ?? null;
  };
  const checking = await bankFor("1010");
  const card = await bankFor("2050");
  const { data: feed } = await books.from("acc_bank_feed_account").select("bank_account_id").eq("is_active", true).limit(1);
  const ids = {
    checking,
    card,
    feed: feed?.[0]?.bank_account_id ?? null,
    february: checking ? await rec(checking, "2026-02-28") : null,
    cardJanuary: card ? await rec(card, "2026-01-31") : null,
  };
  const missing = Object.entries(ids).filter(([, id]) => !id).map(([key]) => key);
  if (missing.length) throw new Error(`Meridian has no ${missing.join(", ")}: run npm run guide:step-shots for Banking first`);
  return ids;
}

// --- Browser and screencast ----------------------------------------------------

console.log("reading the names to swap…");
const swaps = await realNames();
const ids = guides.some((id) => ["bank-lines-in", "reconcile-by-hand"].includes(id)) ? await bankingIds() : {};
console.log(`${swaps.length} names to swap; opening the browser…`);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "light", timezoneId: "America/Los_Angeles", locale: "en-US" });
await context.addInitScript({ content: overlay });
const ref = new URL(supabaseUrl).hostname.split(".")[0];
const encoded = `base64-${Buffer.from(
  JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: "bearer",
    user,
  }),
  "utf8",
).toString("base64")}`;
const domain = new URL(base).hostname;
const cookieName = `sb-${ref}-auth-token`;
const CHUNK = 3180;
const chunks = encoded.length <= CHUNK ? [encoded] : Array.from({ length: Math.ceil(encoded.length / CHUNK) }, (_, i) => encoded.slice(i * CHUNK, (i + 1) * CHUNK));
await context.addCookies([
  ...chunks.map((value, i) => ({ name: chunks.length === 1 ? cookieName : `${cookieName}.${i}`, value, domain, path: "/", secure: base.startsWith("https:") })),
  { name: "onebook-company", value: company.slug, domain, path: "/" },
]);
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on("dialog", (dialog) => void dialog.accept());

const cdp = await context.newCDPSession(page);
let frames = [];
let writes = [];
let frameDir = null;
let skew = null;
let frameNo = 0;
cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  if (!frameDir) return;
  const now = Date.now() / 1000;
  const ts = typeof metadata?.timestamp === "number" ? metadata.timestamp : now;
  // The browser's clock against this one: the quickest a frame ever arrived. The first frame
  // can arrive late while the machine is busy, and taking its delay put the picture 1.4 s behind.
  if (skew === null || now - ts < skew) skew = now - ts;
  const n = frameNo++;
  frames.push({ n, ts });
  writes.push(writeFile(join(frameDir, `${String(n).padStart(6, "0")}.jpg`), Buffer.from(data, "base64")));
  if (writes.length > 200) writes = [Promise.all(writes)];
});
async function screencast() {
  await cdp.send("Page.stopScreencast").catch(() => {});
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
}

// --- Helpers a beat uses ---------------------------------------------------------

const vt = (fn, ...rest) => page.evaluate(([f, a]) => window.__vt?.[f]?.(...a), [fn, rest]);
async function settle() {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector(".ant-btn-loading, .ant-spin-spinning, .ant-skeleton-active"), null, { timeout: 20_000 })
    .catch(() => undefined);
  await sleep(300);
}
async function go(route) {
  await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
  await page.locator("main, .app-shell__content").first().waitFor({ timeout: 60_000 });
  await settle();
  // Buttons answer only once the page has hydrated.
  await sleep(900);
  await vt("swaps", swaps);
  await screencast();
  await sleep(250);
}
async function point(locator, { ms = 700 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("nothing to point at");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await vt("cursor", x, y, ms);
  await sleep(ms + 80);
  return { x, y };
}
/** A press the viewer sees. Never one that saves or posts: those are for the reader to make. */
const SAVES = /^(Save|Save draft|Save and post|Issue|Import|Import \d+ lines?|Import anyway|Record payment|Post|Create|Delete it|Remove|Void|Add \d+ to the books|Add anyway|Complete|Discard|Disconnect|Undo|Reverse|Attach|OK)$/;
async function press(locator, { after = 350 } = {}) {
  const text = ((await locator.innerText().catch(() => "")) ?? "").trim();
  if (SAVES.test(text)) throw new Error(`refusing to press "${text}": a video never saves`);
  const { x, y } = await point(locator);
  await vt("ripple", x, y);
  await page.mouse.click(x, y);
  await sleep(after);
}
let ringNo = 0;
/** Rings `locator` and points at it; returns its box, the area the beat is about. */
async function ring(locator) {
  const target = locator.first();
  await target.waitFor({ state: "visible" });
  await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  const id = `r${++ringNo}`;
  await target.evaluate((el, id) => el.setAttribute("data-vt", `${el.getAttribute("data-vt") ?? ""} ${id}`.trim()), id);
  await vt("ring", id);
  await point(target);
  return target.boundingBox();
}
const unring = () => vt("unring", null);
const button = (name) => page.getByRole("button", { name, exact: typeof name === "string" });
const dialog = () => page.getByRole("dialog").last();
const menuItem = (name) => page.locator(".ant-dropdown:visible").getByRole("menuitem", { name });
async function openMenu(label) {
  await press(page.getByRole("button", { name: label }).first(), { after: 450 });
  await page.locator(".ant-dropdown:visible").first().waitFor();
  // The real mouse leaves the button, so its "More actions" tooltip goes; the menu stays open.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 4);
  await sleep(250);
}

// --- Beats ------------------------------------------------------------------------

let timeline = [];
/**
 * One beat: its lines are read while `act` points and rings; it lasts as long
 * as they take, plus a breath. `act` returns the area the beat is about (a box,
 * or several), or null for the whole frame.
 */
async function beat(id, act) {
  const lines = durations[id];
  if (!lines) throw new Error(`no narration spoken for ${id}: run tts.py`);
  const offsets = [];
  let t = LEAD;
  for (const d of lines) {
    offsets.push(t);
    t += d * 1000 + GAP;
  }
  const spoken = t - GAP;
  const start = Date.now();
  let focus = null;
  let error = null;
  try {
    focus = (await act?.()) ?? null;
  } catch (e) {
    error = e;
  }
  const rest = start + spoken + HOLD - Date.now();
  if (rest > 0) await sleep(rest);
  const end = Date.now();
  const leaks = await vt("leaks", swaps.map(([from]) => from));
  if (leaks && (leaks.names || leaks.emails)) error ??= new Error(`a real name or email is on screen in ${id}`);
  const boxes = (Array.isArray(focus) ? focus : focus ? [focus] : []).filter(Boolean);
  timeline.push({
    id,
    start: start / 1000,
    end: end / 1000,
    offsets: offsets.map((o) => o / 1000),
    durs: lines,
    focus: boxes.length ? boxes : null,
    over: Math.max(0, end - start - spoken - HOLD) / 1000,
  });
  console.log(`  ${id}: ${((end - start) / 1000).toFixed(1)}s (spoken ${(spoken / 1000).toFixed(1)}s)${error ? `  ERROR ${error.message.split("\n")[0]}` : ""}`);
  await unring();
  if (error) throw error;
}

/** The opening: the guide's first screen behind a card of its title, purpose and steps. */
async function intro(flowId, route, title, purpose, steps) {
  await go(route);
  await vt("cursor", VIEWPORT.width - 120, VIEWPORT.height - 80, 0);
  await beat(`${flowId}-intro`, async () => {
    await vt("card", { kicker: "OneBook guide", title, purpose, steps });
    return null;
  });
  await vt("card", null);
}

// --- The guides -------------------------------------------------------------------
// Each step's beat is the step picture's recipe (scripts/capture-step-shots.mjs), played.

/** Each guide's title, purpose and steps for its opening card, as narration.json keeps them (a test holds them to system-guide.ts). */
const GUIDE = Object.fromEntries(Object.entries(narration.guides).map(([id, body]) => [id, body.card]));

const scenes = {
  async "get-paid"() {
    const g = GUIDE["get-paid"];
    await intro("get-paid", "/invoices", g.title, g.purpose, g.steps);
    await go("/invoices");
    await beat("get-paid-1", async () => {
      await press(button(/New invoice/).first(), { after: 900 });
      return [await ring(dialog().getByRole("button", { name: "Save draft" })), await dialog().boundingBox()];
    });
    await page.keyboard.press("Escape");
    await go("/invoices");
    await beat("get-paid-2", async () => [await ring(button("Issue"))]);
    await go("/invoices");
    await beat("get-paid-3", async () => {
      await openMenu("Actions for INV-000003");
      return [await ring(menuItem("Download PDF")), await page.locator(".ant-dropdown:visible").first().boundingBox()];
    });
    await go("/payments");
    await beat("get-paid-4", async () => {
      const box = await ring(button(/Receive payment/));
      await unring();
      await press(button(/Receive payment/).first(), { after: 1100 });
      return [box, await dialog().boundingBox()];
    });
    await page.keyboard.press("Escape");
    await go("/reports/ar-aging");
    await beat("get-paid-5", async () => {
      await ring(page.getByRole("heading", { name: "Accounts Receivable Aging", exact: true }));
      return null;
    });
    await go("/reports/open-invoices");
    await beat("get-paid-6", async () => {
      await ring(page.getByRole("heading", { name: "Open Invoices", exact: true }));
      return null;
    });
    await go("/reports/cash-flow-forecast");
    await beat("get-paid-7", async () => {
      await ring(page.getByRole("heading", { name: "13 Week Cash Forecast", exact: true }));
      return null;
    });
  },

  async "quote-a-price"() {
    const g = GUIDE["quote-a-price"];
    await intro("quote-a-price", "/estimates", g.title, g.purpose, g.steps);
    await go("/estimates");
    await beat("quote-a-price-1", async () => {
      await press(button(/New estimate/).first(), { after: 900 });
      return [await ring(dialog().getByRole("button", { name: /^Save/ })), await dialog().boundingBox()];
    });
    await page.keyboard.press("Escape");
    for (const [n, item] of [
      [2, "Download PDF"],
      [3, "Mark declined"],
      [4, "Turn into an invoice"],
    ]) {
      await go("/estimates");
      await beat(`quote-a-price-${n}`, async () => {
        await openMenu(/^Actions for EST-/);
        return [await ring(menuItem(item)), await page.locator(".ant-dropdown:visible").first().boundingBox()];
      });
    }
    await go("/estimates");
    await openMenu(/^Actions for EST-/);
    await press(menuItem("Turn into an invoice"), { after: 600 });
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Turn into an invoice" });
    if (await confirm.count()) await press(confirm.first(), { after: 600 });
    await page.waitForURL(/\/invoices/);
    await page.getByRole("dialog").filter({ hasText: "New invoice" }).waitFor();
    await settle();
    await screencast();
    await beat("quote-a-price-5", async () => {
      const draft = page.getByRole("dialog").filter({ hasText: "New invoice" });
      return [await ring(draft.getByRole("button", { name: "Save draft" })), await draft.boundingBox()];
    });
    await page.getByRole("dialog").filter({ hasText: "New invoice" }).getByRole("button", { name: "Cancel" }).click();
    await go("/invoices");
    await page.getByRole("button", { name: /Actions for draft invoice/i }).first().click();
    await menuItem(/^View/).first().click();
    await page.getByRole("dialog").waitFor();
    await settle();
    await vt("swaps", swaps);
    await beat("quote-a-price-6", async () => [await ring(dialog().getByRole("button", { name: "Issue" })), await dialog().boundingBox()]);
    await page.keyboard.press("Escape");
    await go("/invoices");
    await beat("quote-a-price-7", async () => {
      await openMenu("Actions for INV-000001");
      return [await ring(menuItem(/^Void invoice/)), await page.locator(".ant-dropdown:visible").first().boundingBox()];
    });
  },

  async "bank-lines-in"() {
    const g = GUIDE["bank-lines-in"];
    await intro("bank-lines-in", `/banking?account=${ids.checking}`, g.title, g.purpose, g.steps);
    await go(`/banking?account=${ids.checking}`);
    // Steps one to four happen in the Import statement dialog: a statement that adds up, one with
    // a total read in as a line (ticked, it adds up), and one missing a line. Nothing is imported.
    const reopen = async (file) => {
      await page.keyboard.press("Escape");
      await dialog().waitFor({ state: "hidden" }).catch(() => undefined);
      await go(`/banking?account=${ids.checking}`);
      await button(/Import statement/).first().click();
      await dialog().locator('input[type="file"]').setInputFiles(file);
      await dialog().locator(".ant-alert").first().waitFor({ timeout: 60_000 });
      await settle();
      await vt("swaps", swaps);
    };
    await beat("bank-lines-in-1", async () => {
      await press(button(/Import statement/).first(), { after: 900 });
      return [await ring(dialog().locator(".ant-upload-drag").first()), await dialog().boundingBox()];
    });
    await beat("bank-lines-in-2", async () => {
      await dialog().locator('input[type="file"]').setInputFiles(statementFile("checking-2026-04.csv", CHECKING_APRIL));
      await dialog().locator(".ant-alert-success").first().waitFor({ timeout: 60_000 });
      await sleep(400);
      return [await ring(dialog().locator(".ant-alert-success").first())];
    });
    await reopen(statementFile("checking-2026-04.csv", CHECKING_APRIL, { misread: ["2026-04-30", "TOTAL DEPOSITS", 18500] }));
    await beat("bank-lines-in-3", async () => {
      // Out by the total read in as a line; ticked, the statement adds up again.
      const tick = dialog().getByRole("checkbox", { name: /^Not a transaction: .*TOTAL DEPOSITS/ });
      const box = await ring(tick);
      await sleep(1600);
      const { x, y } = await point(tick);
      await vt("ripple", x, y);
      await tick.check();
      await dialog().locator(".ant-alert-success").first().waitFor({ timeout: 30_000 });
      await sleep(300);
      return [box, await dialog().locator(".ant-alert").first().boundingBox()];
    });
    await reopen(statementFile("checking-2026-04.csv", CHECKING_APRIL, { leaveOut: 1 }));
    await beat("bank-lines-in-4", async () => [
      await ring(dialog().getByRole("button", { name: "Import anyway…" })),
      await dialog().locator(".ant-alert-error").first().boundingBox(),
    ]);
    await page.keyboard.press("Escape");
    await go(`/banking?account=${ids.feed}`);
    await beat("bank-lines-in-5", async () => [
      await ring(page.getByRole("button", { name: "Undo", exact: true, disabled: false })),
      await page.getByText("Bank feed syncs", { exact: true }).boundingBox(),
    ]);
    await go(`/banking?account=${ids.feed}`);
    await beat("bank-lines-in-6", async () => [
      await ring(button("Disconnect")),
      await page.getByText("First Platypus Bank", { exact: true }).first().boundingBox(),
    ]);
  },

  async "reconcile-by-hand"() {
    const g = GUIDE["reconcile-by-hand"];
    const february = `/banking/reconcile/${ids.february}`;
    await intro("reconcile-by-hand", `/banking/reconcile?account=${ids.checking}`, g.title, g.purpose, g.steps);
    await go(`/banking/reconcile?account=${ids.checking}`);
    await beat("reconcile-by-hand-1", async () => [
      await ring(page.locator('[aria-label="Reconciliation standing"]')),
      await page.getByLabel("Bank account", { exact: true }).boundingBox(),
    ]);
    await go(`/banking/reconcile?account=${ids.checking}`);
    await beat("reconcile-by-hand-2", async () => {
      const box = await ring(button(/New reconciliation/));
      await unring();
      await press(button(/New reconciliation/).first(), { after: 900 });
      return [box, await dialog().boundingBox()];
    });
    await page.keyboard.press("Escape");
    await go(february);
    await beat("reconcile-by-hand-3", async () => [
      await ring(page.getByText("Left to explain", { exact: true })),
      await page.locator(".ant-alert-warning").filter({ hasText: "Left to explain" }).boundingBox(),
    ]);
    await beat("reconcile-by-hand-4", async () => {
      const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Not a transaction" }) }).filter({ hasText: "MONTHLY SERVICE FEE" });
      // The line's own description in the frame too, not cut at its edge.
      return [await ring(row.getByRole("button", { name: "Not a transaction" })), await row.getByText("MONTHLY SERVICE FEE").boundingBox()];
    });
    const box = () => page.locator(".ant-alert").filter({ hasText: /The bank shows \d+ things? your books do not/ });
    const choose = async (where, words, option) => {
      const select = where.locator(".ant-select").first();
      await press(select, { after: 300 });
      await page.keyboard.type(words, { delay: 60 });
      const pick = page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: option }).first();
      await pick.waitFor();
      await press(pick, { after: 400 });
    };
    await beat("reconcile-by-hand-5", async () => {
      await box().evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await choose(box().getByRole("row").filter({ hasText: "MONTHLY SERVICE FEE" }), "bank", /6400/);
      return [await ring(button(/^Add \d+ to the books$/)), await box().getByRole("row").filter({ hasText: "MONTHLY SERVICE FEE" }).boundingBox()];
    });
    await beat("reconcile-by-hand-6", async () => {
      await choose(box().locator("li").filter({ hasText: "FIBERLINK" }), "internet", /6120/);
      return [await ring(button("Add anyway")), await page.getByText("Held back from Add all:").boundingBox()];
    });
    await go(february);
    // From the first button of its row, so the frame does not open halfway through a sentence.
    await beat("reconcile-by-hand-7", async () => [
      await ring(button("Discard this reconciliation")),
      await page.getByRole("button", { name: /Import statement/ }).first().boundingBox(),
    ]);
    await beat("reconcile-by-hand-8", async () => {
      const view = page.getByRole("link", { name: "View", exact: true });
      const first = await ring(view);
      await sleep(1500);
      await unring();
      await press(view, { after: 300 });
      await page.waitForURL(/statement-files/);
      await settle();
      await vt("swaps", swaps);
      return [first];
    });
    await go(`/banking/reconcile/${ids.cardJanuary}`);
    await beat("reconcile-by-hand-9", async () => [await ring(button("Attach the statement")), await page.getByText("No statement file").boundingBox()]);
  },
};

// --- Run --------------------------------------------------------------------------

const killer = setTimeout(() => {
  console.error("taking too long; stopped");
  process.exit(2);
}, 30 * 60 * 1000);
let failed = null;
try {
  for (const id of guides) {
    if (!scenes[id]) throw new Error(`no scene for ${id}`);
    const dir = join(work, "takes", id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "frames"), { recursive: true });
    frameDir = join(dir, "frames");
    frames = [];
    timeline = [];
    frameNo = 0;
    skew = null;
    console.log(`take ${id}`);
    try {
      await scenes[id]();
    } finally {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await sleep(300);
      await Promise.all(writes);
      writes = [];
      writeFileSync(join(dir, "take.json"), JSON.stringify({ guide: id, skew, timeline, frames }, null, 1));
      frameDir = null;
      console.log(`  ${frames.length} frames, ${timeline.length} beats; skew ${skew?.toFixed(3)}s`);
    }
  }
} catch (error) {
  failed = error.message.split("\n")[0];
  console.error(`FAILED: ${failed}`);
  await page.screenshot({ path: join(work, "FAILED.png") }).catch(() => {});
} finally {
  await browser.close();
  clearTimeout(killer);
  process.exit(failed ? 1 : 0);
}
