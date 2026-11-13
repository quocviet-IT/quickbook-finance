/**
 * Records the guide videos' pictures (3.0.28): one take per guide, from the
 * sample company, each step done on screen while its narration is read.
 *
 *   node --env-file=.env.local scripts/guide-videos/record.mjs <work-dir> <guide id>… [--base=<url>]
 *
 * Run tts.py first: each beat lasts at least as long as its lines take to say
 * (<work-dir>/durations.json). Banking's guides point at the bank accounts,
 * reconciliations and Plaid test feed that `npm run guide:step-shots` makes in
 * Meridian, so run that first; the deployed app is the one with Plaid.
 *
 * A step is played, not posed: the pointer opens the dialog, picks the
 * customer, types the line and watches the total change; it opens the menu and
 * runs down it; it scrolls a report to its total; it moves to the next screen
 * by the menu, as a reader would. Every move tells the camera what to look at
 * (`cam`), and build.mjs follows it, closing in and drawing back.
 *
 * The page is filmed with the browser's own screencast, every frame stamped
 * with its time. Each beat, and each move between screens, records when it
 * started and ended; build.mjs cuts everything between them (pages loading,
 * dialogs closing), so the film has no dead time and the voice lands where the
 * picture is.
 *
 * Nothing is saved: a form is filled and cancelled, a menu opened and left; no
 * button that posts, imports, issues, records or deletes is pressed (`press`
 * refuses them). Real people's and companies' names are swapped for invented
 * ones in every page as it draws (overlay.js), and a beat that still shows one
 * fails.
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
const HOLD = 700; // the screen stays a moment after the last word
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
const banking = ["bank-lines-in", "reconcile-by-hand", "code-and-match"];
const ids = guides.some((id) => banking.includes(id)) ? await bankingIds() : {};
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

// --- The camera -------------------------------------------------------------------
// Each span keeps a list of what the camera looks at and from when: boxes in the
// window's coordinates, or none for the whole screen. build.mjs eases from one to
// the next and drifts slowly in between, so the picture is never quite still.

let span = null;
function cam(boxes, { zoom = 1.6 } = {}) {
  if (!span) return;
  span.camera.push({ t: Date.now() / 1000, boxes: (boxes ?? []).filter(Boolean), zoom });
}
const wide = () => cam([]);
// Something to keep in view is a hint, not a must: one that is not there is let go at once,
// not waited 30 seconds for while the film runs on in silence.
const boxOf = (locator) => locator.first().boundingBox({ timeout: 1500 }).catch(() => null);
async function look(...locators) {
  const last = locators.at(-1);
  const zoom = typeof last === "number" ? last : 1.6;
  const boxes = await Promise.all(locators.filter((l) => typeof l !== "number").map(boxOf));
  cam(boxes, { zoom });
}

// --- Helpers a step uses ---------------------------------------------------------

const vt = (fn, ...rest) => page.evaluate(([f, a]) => window.__vt?.[f]?.(...a), [fn, rest]);
async function settle() {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector(".ant-btn-loading, .ant-spin-spinning, .ant-skeleton-active"), null, { timeout: 20_000 })
    .catch(() => undefined);
  await sleep(300);
}
async function arrived() {
  await page.locator("main, .app-shell__content").first().waitFor({ timeout: 60_000 });
  await settle();
  // Buttons answer only once the page has hydrated.
  await sleep(900);
  await vt("swaps", swaps);
  await screencast();
  await sleep(250);
}
async function go(route) {
  await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
  await arrived();
}
/** Moves the pointer to `locator`; the camera follows, keeping `context` in view. */
async function point(locator, { ms = 650, context = [], zoom, follow = true } = {}) {
  const target = locator.first();
  await target.scrollIntoViewIfNeeded();
  let box = await target.boundingBox();
  if (!box) throw new Error("nothing to point at");
  // "In view" can still be under a toolbar that sticks to the top (Banking's filters), where a
  // click lands on the toolbar: anything that near an edge is brought to the middle first.
  const inDialog = await target.evaluate((el) => Boolean(el.closest('[role="dialog"], .ant-dropdown, .ant-select-dropdown, .ant-drawer')));
  if (!inDialog && (box.y < 230 || box.y + box.height > VIEWPORT.height - 40)) {
    await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await sleep(150);
    box = (await target.boundingBox()) ?? box;
  }
  if (follow) cam([box, ...(await Promise.all(context.map(boxOf)))], zoom ? { zoom } : undefined);
  const x = box.x + Math.min(box.width / 2, 60);
  const y = box.y + box.height / 2;
  await vt("cursor", x, y, ms);
  await sleep(ms + 80);
  return { x, y };
}
/** A press the viewer sees. Never one that saves or posts: those are for the reader to make. */
const SAVES =
  /^(Save|Save draft|Save and post|Create draft|Record|Issue|Import|Import \d+ lines?|Import anyway…?|Record payment|Post|Create|Delete it|Remove|Void|Approve|Add \d+ to the books|Add anyway|Complete|Discard|Discard this reconciliation|Disconnect|Undo|Reverse|Attach|OK|Not a transaction)$/;
async function press(locator, { after = 350, ...options } = {}) {
  const target = locator.first();
  const text = ((await target.innerText().catch(() => "")) ?? "").trim();
  if (SAVES.test(text)) throw new Error(`refusing to press "${text}": a video never saves`);
  const { x, y } = await point(target, options);
  await vt("ripple", x, y);
  await page.mouse.click(x, y);
  // The real mouse leaves at once: left where it clicked, it raises tooltips over whatever opens
  // there ("Remove invoice line 1"). The pointer the viewer sees is the overlay's own.
  await page.mouse.move(VIEWPORT.width - 3, VIEWPORT.height - 3);
  await sleep(after);
}
/** Types into a field the way a person does, a letter at a time. */
async function typeInto(locator, text, { delay = 70, context = [] } = {}) {
  await press(locator, { after: 150, context });
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text, { delay });
  await sleep(250);
}
/** An Ant Design select: open it, type the words, and choose the option that reads `option`. */
async function choose(select, words, option, { context = [] } = {}) {
  await press(select, { after: 250, context });
  await page.keyboard.type(words, { delay: 75 });
  const pick = page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: option }).first();
  await pick.waitFor();
  await sleep(350);
  await press(pick, { after: 400, follow: false });
}
/** A select a vendor's usual account may have filled already: chosen when empty, pointed at when filled. */
async function chooseUnlessFilled(scope, placeholder, words, option) {
  const empty = scope.locator(".ant-select").filter({ hasText: placeholder });
  if (await empty.count()) {
    await choose(empty.first(), words, option);
    return;
  }
  await point(scope.locator(".ant-select").filter({ hasText: option }).first());
  await sleep(500);
}
/** Runs the pointer down a list, item by item, a reader looking it over. */
async function skim(items, { each = 380, max = 6 } = {}) {
  const count = await items.count();
  // A few items say "look down this list"; every one of a long report says nothing more, slowly.
  let shown = 0;
  for (let i = 0; i < count && shown < max; i++) {
    const item = items.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;
    await point(item, { ms: 260, follow: false });
    await sleep(each - 260);
    shown++;
  }
}
/** Scrolls smoothly to `locator`, the camera standing back while the page moves. */
async function glide(locator, block = "center") {
  wide();
  await locator.first().evaluate((el, block) => el.scrollIntoView({ behavior: "smooth", block }), block);
  await sleep(1100);
}
let ringNo = 0;
/** Rings `locator` and points at it; the camera closes in on it and on `context`. */
async function ring(locator, { context = [], zoom } = {}) {
  const target = locator.first();
  await target.waitFor({ state: "visible" });
  await target.scrollIntoViewIfNeeded();
  const id = `r${++ringNo}`;
  await target.evaluate((el, id) => el.setAttribute("data-vt", `${el.getAttribute("data-vt") ?? ""} ${id}`.trim()), id);
  await vt("ring", id);
  await point(target, { context, zoom });
}
const unring = () => vt("unring", null);
const button = (name) => page.getByRole("button", { name, exact: typeof name === "string" });
const dialog = () => page.getByRole("dialog").last();
const menu = () => page.locator(".ant-dropdown:visible").first();
const menuItem = (name) => page.locator(".ant-dropdown:visible").getByRole("menuitem", { name });
async function openMenu(label) {
  await press(page.getByRole("button", { name: label }).first(), { after: 450 });
  await menu().waitFor();
  // The real mouse leaves the button, so its "More actions" tooltip goes; the menu stays open.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 4);
  await sleep(200);
  await look(menu(), page.getByRole("button", { name: label }).first());
}
/**
 * Closes the dialog without saving. A form with something typed in asks first
 * ("Discard this invoice?"): Discard throws away only what was typed, so the
 * answer is always yes. Waits until no dialog is left open.
 */
async function cancelDialog() {
  const cancel = dialog().getByRole("button", { name: "Cancel", exact: true });
  if (await cancel.count()) await cancel.first().click().catch(() => undefined);
  else await page.keyboard.press("Escape");
  const discard = page.locator(".ant-modal-confirm").getByRole("button", { name: /^(Discard|Leave|Discard changes)$/ });
  if (await discard.first().waitFor({ timeout: 1500 }).then(() => true, () => false)) await discard.first().click();
  await page
    .waitForFunction(() => ![...document.querySelectorAll('[role="dialog"]')].some((d) => d.getBoundingClientRect().height > 0), null, { timeout: 10_000 })
    .catch(() => undefined);
  await sleep(300);
}

// --- Spans -------------------------------------------------------------------------

let timeline = [];
async function film(id, kind, act, { lines = [] } = {}) {
  const offsets = [];
  let t = LEAD;
  for (const d of lines) {
    offsets.push(t);
    t += d * 1000 + GAP;
  }
  const spoken = lines.length ? t - GAP : 0;
  const start = Date.now();
  span = { camera: [] };
  let error = null;
  try {
    await act?.();
  } catch (e) {
    error = e;
  }
  const rest = start + spoken + (lines.length ? HOLD : 0) - Date.now();
  if (rest > 0) await sleep(rest);
  const end = Date.now();
  const leaks = await vt("leaks", swaps.map(([from]) => from));
  if (leaks && (leaks.names || leaks.emails)) error ??= new Error(`a real name or email is on screen in ${id}`);
  timeline.push({
    id,
    kind,
    start: start / 1000,
    end: end / 1000,
    offsets: offsets.map((o) => o / 1000),
    durs: lines,
    camera: span.camera,
    over: lines.length ? Math.max(0, end - start - spoken - HOLD) / 1000 : 0,
  });
  span = null;
  console.log(`  ${id}: ${((end - start) / 1000).toFixed(1)}s${lines.length ? ` (spoken ${(spoken / 1000).toFixed(1)}s)` : ""}${error ? `  ERROR ${error.message.split("\n").filter((l) => l.trim()).slice(0, 4).join(" | ")}` : ""}`);
  await unring();
  if (error) throw error;
}
/** A step: its lines are read while `act` plays it out; it lasts at least as long as they take. */
async function beat(id, act) {
  const lines = durations[id];
  if (!lines) throw new Error(`no narration spoken for ${id}: run tts.py`);
  await film(id, "beat", act, { lines });
}
/** The way to the next screen, by the menu, as a reader goes: a short silent span, then the load is cut. */
async function travel(beatId, name, { group } = {}) {
  // A menu left open by the step before would catch the click.
  await page.keyboard.press("Escape");
  await film(`${beatId}:move`, "move", async () => {
    wide();
    if (group) {
      const head = page.getByRole("menuitem", { name: group }).first();
      if ((await head.getAttribute("aria-expanded").catch(() => null)) === "false") await press(head, { after: 450, follow: false });
    }
    const link = page.getByRole("link", { name, exact: true }).locator("visible=true").first();
    await press(link, { after: 250, follow: false });
  });
  await page.waitForLoadState("domcontentloaded");
  await arrived();
}

/** The opening: the guide's first screen behind a card of its title, purpose and steps. */
async function intro(flowId, route, card) {
  await go(route);
  await vt("cursor", VIEWPORT.width - 120, VIEWPORT.height - 80, 0);
  await beat(`${flowId}-intro`, async () => {
    wide();
    await vt("card", { kicker: "OneBook guide", ...card });
  });
  await vt("card", null);
}

// --- The guides -------------------------------------------------------------------

const CARD = Object.fromEntries(Object.entries(narration.guides).map(([id, body]) => [id, body.card]));

const scenes = {
  async "get-paid"() {
    await intro("get-paid", "/invoices", CARD["get-paid"]);
    await go("/invoices");
    await beat("get-paid-1", async () => {
      await press(button(/New invoice/), { after: 900 });
      const d = dialog();
      await look(d);
      await choose(d.getByLabel("Customer", { exact: true }), "North", "Northwind Analytics", { context: [d.getByLabel("Customer", { exact: true })] });
      await typeInto(d.getByLabel("Line 1 description"), "Quarterly strategy review");
      await typeInto(d.getByLabel("Line 1 unit price"), "3600");
      await look(d.getByText(/^Total/).last(), d.getByLabel("Line 1 unit price"));
      await sleep(600);
      await ring(d.getByRole("button", { name: "Save draft" }), { context: [d.getByText(/^Total/).last()] });
    });
    await cancelDialog();
    await beat("get-paid-2", async () => {
      // The draft's own line, from its customer to its Issue button: the whole row is too wide to close in on.
      const row = page.getByRole("row").filter({ has: button("Issue") }).first();
      await point(row.getByText("Harbor Logistics"), { context: [row.getByText("Draft", { exact: true })] });
      await sleep(400);
      await point(row.getByText("Draft", { exact: true }), { context: [row.getByText("Harbor Logistics"), button("Issue")] });
      await sleep(400);
      await ring(button("Issue"), { context: [row.getByText("Draft", { exact: true })] });
    });
    await beat("get-paid-3", async () => {
      await openMenu("Actions for INV-000003");
      await skim(menu().getByRole("menuitem"));
      await ring(menuItem("Download PDF"), { context: [menu()] });
    });
    await travel("get-paid-4", "Payments", { group: "Sales" });
    await beat("get-paid-4", async () => {
      await press(button(/Receive payment/), { after: 1000 });
      const d = dialog();
      await look(d);
      await choose(d.getByLabel("Customer", { exact: true }), "Harbor", "Harbor Logistics");
      await sleep(700);
      await look(d.getByText("Apply to open invoices"), d.getByText("INV-000003").first());
      await typeInto(d.getByLabel("Amount", { exact: true }), "9500");
      await ring(d.getByRole("button", { name: "Record payment" }), { context: [d.getByText(/^Allocated/).first()] });
    });
    await cancelDialog();
    await go("/reports/ar-aging");
    await beat("get-paid-5", async () => {
      await look(page.getByRole("heading", { name: "Accounts Receivable Aging", exact: true }), page.getByText(/^Open receivables by age/), 1.4);
      await sleep(900);
      await glide(page.getByText(/^Total: /).first());
      await ring(page.getByText(/^Total: /).first(), { context: [page.getByText(/^Reconciled to Accounts Receivable/).first()] });
    });
    await go("/reports/open-invoices");
    await beat("get-paid-6", async () => {
      await look(page.getByRole("heading", { name: "Open Invoices", exact: true }), 1.4);
      await sleep(700);
      await glide(page.getByText("OPEN BALANCE", { exact: false }).first());
      await ring(page.getByText(/OPEN BALANCE/i).first(), { context: [page.getByText(/OPEN INVOICES/i).first()] });
      await sleep(600);
      await skim(page.getByRole("row").filter({ hasText: /INV-/ }), { each: 450 });
    });
    await go("/reports/cash-flow-forecast");
    await beat("get-paid-7", async () => {
      await look(page.getByRole("heading", { name: "13 Week Cash Forecast", exact: true }), 1.4);
      await sleep(700);
      await glide(page.getByText(/CASH TODAY/i).first());
      await ring(page.getByText(/IN 13 WEEKS/i).first(), { context: [page.getByText(/CASH TODAY/i).first()] });
    });
  },

  async "quote-a-price"() {
    await intro("quote-a-price", "/estimates", CARD["quote-a-price"]);
    await go("/estimates");
    await beat("quote-a-price-1", async () => {
      await press(button(/New estimate/), { after: 900 });
      const d = dialog();
      await look(d);
      await choose(d.getByLabel("Customer", { exact: true }), "Blue", "BlueRidge Foods");
      await typeInto(d.getByLabel("Line 1 description"), "Market sizing study");
      await typeInto(d.getByLabel("Line 1 unit price"), "4800");
      await ring(d.getByRole("button", { name: /^Save/ }), { context: [d.getByText(/^Total/).last()] });
    });
    await cancelDialog();
    for (const [n, item] of [
      [2, "Download PDF"],
      [3, "Mark declined"],
      [4, "Turn into an invoice"],
    ]) {
      await beat(`quote-a-price-${n}`, async () => {
        await openMenu(/^Actions for EST-/);
        await skim(menu().getByRole("menuitem"), { each: 330 });
        await ring(menuItem(item), { context: [menu()] });
      });
      await page.keyboard.press("Escape");
    }
    await beat("quote-a-price-5", async () => {
      await openMenu(/^Actions for EST-/);
      await press(menuItem("Turn into an invoice"), { after: 700 });
      const confirm = page.getByRole("dialog").getByRole("button", { name: "Turn into an invoice" });
      if (await confirm.count()) await press(confirm, { after: 700 });
      await page.waitForURL(/\/invoices/);
      const draft = page.getByRole("dialog").filter({ hasText: "New invoice" });
      await draft.waitFor();
      // A new page: the screencast is started again so it goes on filming it.
      await screencast();
      await vt("swaps", swaps);
      await sleep(400);
      await look(draft);
      await point(draft.getByText(/From estimate/).first(), { context: [draft.getByText(/From estimate/).first()] });
      await point(draft.getByLabel("Line 1 description"), { context: [draft.getByLabel("Line 1 unit price")] });
      await ring(draft.getByRole("button", { name: "Save draft" }), { context: [draft.getByText(/^Total/).last()] });
    });
    await cancelDialog();
    await go("/invoices");
    await beat("quote-a-price-6", async () => {
      await openMenu(/Actions for draft invoice/i);
      await press(menuItem(/^View/).first(), { after: 900, follow: false });
      const d = dialog();
      await d.waitFor();
      await vt("swaps", swaps);
      await look(d);
      await glide(d.getByRole("button", { name: "Issue" }), "end");
      await ring(d.getByRole("button", { name: "Issue" }), { context: [d.getByRole("button", { name: /Void invoice/ })] });
    });
    await page.keyboard.press("Escape");
    await beat("quote-a-price-7", async () => {
      await openMenu("Actions for INV-000001");
      await skim(menu().getByRole("menuitem"), { each: 330 });
      await ring(menuItem(/^Void invoice/), { context: [menu()] });
    });
  },

  async "bank-lines-in"() {
    await intro("bank-lines-in", `/banking?account=${ids.checking}`, CARD["bank-lines-in"]);
    await go(`/banking?account=${ids.checking}`);
    // Steps one to four happen in the Import statement dialog: a statement that adds up, one with
    // a total read in as a line (ticked, it adds up), and one missing a line. Nothing is imported.
    await beat("bank-lines-in-1", async () => {
      await press(button(/Import statement/), { after: 900 });
      const d = dialog();
      const drop = d.locator(".ant-upload-drag").first();
      await look(d);
      // The statement is carried in from the side, as if dragged from the desktop, and dropped.
      await vt("cursor", VIEWPORT.width - 90, 520, 0);
      await vt("carry", "checking-2026-04.csv");
      await sleep(500);
      await ring(drop, { context: [d] });
      await sleep(400);
      await vt("carry", null);
      await d.locator('input[type="file"]').setInputFiles(statementFile("checking-2026-04.csv", CHECKING_APRIL));
      await d.locator(".ant-alert").first().waitFor({ timeout: 60_000 });
      await unring();
      await look(d.getByText(/checking-2026-04\.csv \(CSV\)/).first(), d.getByRole("columnheader", { name: "Description" }));
    });
    await beat("bank-lines-in-2", async () => {
      const d = dialog();
      await ring(d.locator(".ant-alert-success").first(), { zoom: 1.7 });
      await sleep(600);
      await skim(d.getByRole("row").filter({ hasText: /2026/ }), { each: 330 });
      await ring(d.locator(".ant-alert-success").first(), { zoom: 1.7 });
    });
    const reopen = async (file) => {
      await cancelDialog();
      await press(button(/Import statement/), { after: 600, follow: false });
      await dialog().locator('input[type="file"]').setInputFiles(file);
      await dialog().locator(".ant-alert").first().waitFor({ timeout: 60_000 });
      await settle();
      await vt("swaps", swaps);
    };
    await reopen(statementFile("checking-2026-04.csv", CHECKING_APRIL, { misread: ["2026-04-30", "TOTAL DEPOSITS", 18500] }));
    await beat("bank-lines-in-3", async () => {
      const d = dialog();
      await look(d.locator(".ant-alert-error").first(), 1.6);
      await sleep(900);
      const tick = d.getByRole("checkbox", { name: /^Not a transaction: .*TOTAL DEPOSITS/ });
      await glide(tick);
      await ring(tick, { context: [d.getByRole("row").filter({ hasText: "TOTAL DEPOSITS" })] });
      await sleep(500);
      const { x, y } = await point(tick, { follow: false });
      await vt("ripple", x, y);
      await tick.check();
      await unring();
      await d.locator(".ant-alert-success").first().waitFor({ timeout: 30_000 });
      await glide(d.locator(".ant-alert-success").first());
      await ring(d.locator(".ant-alert-success").first(), { zoom: 1.7 });
    });
    await reopen(statementFile("checking-2026-04.csv", CHECKING_APRIL, { leaveOut: 1 }));
    await beat("bank-lines-in-4", async () => {
      const d = dialog();
      await look(d.locator(".ant-alert-error").first(), 1.7);
      await sleep(1200);
      await ring(d.getByRole("button", { name: "Import anyway…" }), { context: [d.locator(".ant-alert-error").first()] });
    });
    await cancelDialog();
    await beat("bank-lines-in-5", async () => {
      // To the card the bank feed is on, with the account picker, as a reader would.
      await choose(page.getByLabel("Choose the bank account to review"), "2050", "2050");
      await settle();
      await glide(page.getByText("Bank feed syncs", { exact: true }));
      await look(page.getByText("Bank feed syncs", { exact: true }), page.getByRole("button", { name: "Undo", exact: true, disabled: false }));
      await sleep(500);
      await ring(page.getByRole("button", { name: "Undo", exact: true, disabled: false }), { context: [page.getByText("Bank feed syncs", { exact: true })] });
    });
    await beat("bank-lines-in-6", async () => {
      await glide(page.getByText("First Platypus Bank", { exact: true }).first());
      await ring(button("Disconnect"), { context: [page.getByText("First Platypus Bank", { exact: true }).first()] });
    });
  },

  async "reconcile-by-hand"() {
    const february = `/banking/reconcile/${ids.february}`;
    await intro("reconcile-by-hand", `/banking/reconcile?account=${ids.checking}`, CARD["reconcile-by-hand"]);
    await go(`/banking/reconcile?account=${ids.checking}`);
    await beat("reconcile-by-hand-1", async () => {
      await press(page.getByLabel("Bank account", { exact: true }), { after: 600 });
      await skim(page.locator(".ant-select-dropdown:visible .ant-select-item-option"), { each: 450 });
      await page.keyboard.press("Escape");
      await ring(page.locator('[aria-label="Reconciliation standing"]'), { context: [page.getByLabel("Bank account", { exact: true })] });
    });
    await beat("reconcile-by-hand-2", async () => {
      await press(button(/New reconciliation/), { after: 900 });
      const d = dialog();
      await look(d, 1.8);
      await typeInto(d.getByLabel("Statement ending date"), "03/31/2026");
      await page.keyboard.press("Enter");
      await typeInto(d.locator(".ant-input-number input").first(), "12058.63");
      await ring(d.getByRole("button", { name: "OK" }), { context: [d] });
    });
    await cancelDialog();
    await go(february);
    await beat("reconcile-by-hand-3", async () => {
      const alert = page.locator(".ant-alert-warning").filter({ hasText: "Left to explain" });
      await look(alert, 1.7);
      await skim(alert.locator("dt"), { each: 600 });
      await ring(page.getByText("Left to explain", { exact: true }), { context: [alert] });
    });
    await beat("reconcile-by-hand-4", async () => {
      const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Not a transaction" }) }).filter({ hasText: "MONTHLY SERVICE FEE" });
      await glide(row);
      await skim(page.getByRole("row").filter({ hasText: /Paired|Not in the books/ }), { each: 260 });
      await ring(row.getByRole("button", { name: "Not a transaction" }), { context: [row.getByText("MONTHLY SERVICE FEE")] });
    });
    const box = () => page.locator(".ant-alert").filter({ hasText: /The bank shows \d+ things? your books do not/ });
    await beat("reconcile-by-hand-5", async () => {
      await glide(box());
      const fee = box().getByRole("row").filter({ hasText: "MONTHLY SERVICE FEE" });
      await choose(fee.locator(".ant-select").first(), "bank", /6400/, { context: [fee] });
      await ring(button(/^Add \d+ to the books$/), { context: [fee] });
    });
    await beat("reconcile-by-hand-6", async () => {
      const held = box().locator("li").filter({ hasText: "FIBERLINK" });
      await point(held.getByText(/Looks like/).first(), { context: [held] });
      await choose(held.locator(".ant-select").first(), "internet", /6120/, { context: [held] });
      await ring(button("Add anyway"), { context: [page.getByText("Held back from Add all:")] });
    });
    await go(february);
    await beat("reconcile-by-hand-7", async () => {
      await skim(page.getByRole("button").filter({ hasText: /^(Import statement|Match again|Complete|Record adjustment)$/ }), { each: 420 });
      await ring(button("Discard this reconciliation"), { context: [page.getByRole("button", { name: /Import statement/ }).first()] });
    });
    await beat("reconcile-by-hand-8", async () => {
      const view = page.getByRole("link", { name: "View", exact: true });
      await ring(view, { context: [page.getByText(/^Statement file/)] });
      await sleep(700);
      await unring();
      await press(view, { after: 300, follow: false });
      await page.waitForURL(/statement-files/);
      await settle();
      await screencast();
      await vt("swaps", swaps);
      wide();
      await sleep(600);
      await skim(page.getByRole("row").filter({ hasText: /2026/ }), { each: 260 });
    });
    await go(`/banking/reconcile/${ids.cardJanuary}`);
    await beat("reconcile-by-hand-9", async () => {
      await look(page.getByText("No statement file"), button("Attach the statement"), 1.8);
      await sleep(600);
      await ring(button("Attach the statement"), { context: [page.getByText("No statement file")] });
    });
  },

  async "pay-suppliers"() {
    await intro("pay-suppliers", "/bills", CARD["pay-suppliers"]);
    await go("/bills");
    await beat("pay-suppliers-1", async () => {
      await press(button(/New bill/), { after: 900 });
      const d = dialog();
      await look(d);
      await choose(d.getByLabel("Vendor", { exact: true }), "Office", "Office Depot");
      await typeInto(d.getByLabel("Vendor Reference Number"), "OD-55120");
      await typeInto(d.getByPlaceholder("Description", { exact: true }).locator("visible=true").first(), "Printer paper and toner");
      // The vendor's usual account fills itself in; it is chosen only when it has not.
      await chooseUnlessFilled(d, "Expense or asset account", "office", /Office Supplies/);
      await typeInto(d.getByPlaceholder("Amount", { exact: true }).locator("visible=true").first(), "218.40");
      await ring(d.getByRole("button", { name: "Create draft" }), { context: [d.getByLabel("Vendor Reference Number")] });
    });
    await cancelDialog();
    await travel("pay-suppliers-2", "Expenses", { group: "Purchases" });
    await beat("pay-suppliers-2", async () => {
      await press(button(/New expense/), { after: 900 });
      const d = dialog();
      await look(d);
      await choose(d.getByLabel("Vendor (optional)"), "Pacific", "Pacific Power");
      await typeInto(d.getByPlaceholder("Description", { exact: true }).locator("visible=true").first(), "April electricity");
      await chooseUnlessFilled(d, "Expense account", "utilities", /Utilities/);
      await typeInto(d.getByPlaceholder("Amount", { exact: true }).locator("visible=true").first(), "540");
      await ring(d.getByRole("button", { name: "Record", exact: true }), { context: [d.getByPlaceholder("Amount", { exact: true }).locator("visible=true").first()] });
    });
    await cancelDialog();
    await travel("pay-suppliers-3", "Bills", { group: "Purchases" });
    await beat("pay-suppliers-3", async () => {
      const clip = button("Manage bill attachments");
      const row = page.getByRole("row").filter({ has: clip }).first();
      await point(row, { context: [row] });
      await ring(clip, { context: [row] });
      await sleep(500);
      await unring();
      await press(clip, { after: 1100, follow: false });
      const drawer = page.locator(".ant-drawer-open").first();
      await drawer.waitFor();
      await vt("swaps", swaps);
      await look(drawer);
      await ring(drawer.locator(".ant-upload-drag, .ant-upload").first(), { context: [drawer] });
    });
    await page.keyboard.press("Escape");
    await travel("pay-suppliers-4", "Pay Bills", { group: "Purchases" });
    await beat("pay-suppliers-4", async () => {
      await press(button(/Pay bills/), { after: 1000 });
      const d = dialog();
      await look(d);
      await choose(d.getByLabel("Vendor", { exact: true }), "Vance", "Vance & Doyle");
      await sleep(800);
      await look(d.getByText("BILL-000001").first(), d.getByLabel("Payment amount"));
      await typeInto(d.getByLabel("Payment amount"), "6200");
      await ring(d.getByRole("button", { name: "Record payment" }), { context: [d.getByLabel("Payment amount")] });
    });
    await cancelDialog();
    await go("/reports/ap-aging");
    await beat("pay-suppliers-5", async () => {
      await look(page.getByRole("heading", { name: "Accounts Payable Aging", exact: true }), 1.4);
      await sleep(900);
      await glide(page.getByText(/^Total: /).first());
      await ring(page.getByText(/^Total: /).first(), { context: [page.getByText(/^Reconciled to Accounts Payable/).first()] });
    });
    await go("/reports/unpaid-bills");
    await beat("pay-suppliers-6", async () => {
      await look(page.getByRole("heading", { name: "Unpaid Bills", exact: true }), 1.4);
      await sleep(800);
      await glide(page.getByRole("row").filter({ hasText: /BILL-/ }).first());
      await skim(page.getByRole("row").filter({ hasText: /BILL-|Total/ }), { each: 500 });
      await ring(page.getByRole("row").filter({ hasText: /BILL-/ }).first());
    });
  },

  async "code-and-match"() {
    const checking = `/banking?account=${ids.checking}`;
    await intro("code-and-match", checking, CARD["code-and-match"]);
    await go(checking);
    await beat("code-and-match-1", async () => {
      const approve = button("Approve");
      const row = page.getByRole("row").filter({ has: approve }).first();
      // The entry it suggests, then the button: the whole row is too wide to close in on.
      const entry = row.getByText(/^JE-0/).first();
      await point(entry, { context: [approve] });
      await sleep(600);
      await ring(approve, { context: [entry] });
    });
    await beat("code-and-match-2", async () => {
      const row = page.getByRole("row").filter({ hasText: "OFFICE DEPOT" });
      await glide(row);
      await press(row.locator(".ant-select").first(), { after: 300, context: [row.getByText("OFFICE DEPOT #1123", { exact: true })] });
      await page.keyboard.type("office", { delay: 90 });
      const options = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
      await options.first().waitFor();
      await look(page.locator(".ant-select-dropdown:visible").first(), row.getByText("OFFICE DEPOT #1123", { exact: true }));
      await skim(options, { each: 500 });
      // Choosing would post the line: the reader does that, not the film.
      await page.keyboard.press("Escape");
      await ring(row.locator(".ant-select").first(), { context: [row.getByText("OFFICE DEPOT #1123", { exact: true })] });
    });
    await beat("code-and-match-3", async () => {
      await typeInto(page.getByLabel("Search bank transactions by description or reference"), "ADOBE");
      await press(page.getByLabel("Filter bank transactions by status"), { after: 400 });
      await press(page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^All/ }).first(), { after: 900, follow: false });
      await settle();
      const recode = button("Recode");
      // Held by its key: once Recode is pressed the row no longer has the button it was found by.
      const key = await page.getByRole("row").filter({ has: recode }).first().getAttribute("data-row-key");
      const row = page.locator(`tr[data-row-key="${key}"]`);
      await ring(recode, { context: [row.getByText("ADOBE *CREATIVE CLOUD", { exact: true })] });
      await sleep(500);
      await unring();
      await press(recode, { after: 500, follow: false });
      // Recode shows the account box; it is clicked into, or the words land in whatever had the focus.
      const recodeTo = row.locator(".ant-select").filter({ hasText: "Recode to" }).first();
      await press(recodeTo, { after: 300, context: [row.getByText("ADOBE *CREATIVE CLOUD", { exact: true })] });
      await page.keyboard.type("internet", { delay: 90 });
      await sleep(600);
      await look(page.locator(".ant-select-dropdown:visible").first(), row.getByText("ADOBE *CREATIVE CLOUD", { exact: true }));
      await sleep(700);
      // Choosing would post the move: the reader does that, not the film.
      await page.keyboard.press("Escape");
    });
    await travel("code-and-match-4", "Overview", { group: "Banking" });
    await beat("code-and-match-4", async () => {
      const segment = page.locator(".ant-segmented-item").filter({ hasText: "Possible duplicates" });
      await press(segment, { after: 900 });
      await settle();
      const first = page.getByText(/^Charged twice in/).first();
      await look(segment, first);
      await skim(page.getByText(/^Charged twice in/), { each: 700 });
      await ring(segment, { context: [first] });
    });
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
      writeFileSync(join(dir, "take.json"), JSON.stringify({ guide: id, skew, viewport: VIEWPORT, timeline, frames }, null, 1));
      frameDir = null;
      console.log(`  ${frames.length} frames, ${timeline.length} spans; skew ${skew?.toFixed(3)}s`);
    }
  }
} catch (error) {
  failed = error.message.split("\n")[0];
  console.error(`FAILED: ${failed}`);
  await page.screenshot({ path: join(work, "FAILED.png") }).catch(() => {});
} finally {
  // Closing has hung once after a take was safely written: it is given ten seconds.
  await Promise.race([browser.close(), sleep(10_000)]);
  clearTimeout(killer);
  process.exit(failed ? 1 : 0);
}
