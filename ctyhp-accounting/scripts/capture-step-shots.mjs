/**
 * Pictures for the guide's steps (3.0.19): each step's screen, cropped around
 * the control the step names, with that control ringed in orange.
 *
 *   npm run guide:step-shots -- [baseUrl] [--only=get-paid,budget]
 *
 * Run it against a running server (`npm run dev` or a built one) after a change
 * to any screen the guide shows. Each picture lands in public/guide/steps as
 * WebP, named after its step; tests/unit/guide-pictures-319.test.ts checks that
 * every step has one and that this file holds a recipe for each.
 *
 * Safety:
 * - It captures only the sample company Meridian, and refuses to start if that
 *   company is not marked a sample. A picture keeps whatever was on the screen.
 * - A few steps need something to point at: a draft invoice, an estimate, a
 *   purchase order half received. Before capturing, it makes sure Meridian
 *   holds each, creating it through the app's own screens only when it is
 *   missing, so a second run creates nothing.
 * - Screens name the people who use OneBook (a user list, an invoice's
 *   history) and the other companies it holds. On every screen, their names
 *   and email addresses are swapped for invented ones in the page before it
 *   is captured (`scrub`), and a picture is refused if any is still there
 *   (`assertScrubbed`). Nothing in the database changes, and the real names
 *   are never written to disk.
 * - The bar across the top of the page, which carries the signed-in email, is
 *   left out of every frame but one, and that one is cropped to its left end.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import sharp from "sharp";
import { smokeSession } from "./smoke-environment.mjs";

const args = process.argv.slice(2);
const base = args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:3000";
const only = new Set(
  (args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ?? "").split(",").filter(Boolean),
);
/** --failures=<dir>: the whole screen as it stood when a step could not be captured. */
const failuresDir = args.find((arg) => arg.startsWith("--failures="))?.slice("--failures=".length) ?? null;
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(projectRoot, "public", "guide", "steps");

const VIEWPORT = { width: 1280, height: 900 };
/** Captured at twice the size and shown at most 640px wide, so the words read at their own size. */
const SCALE = 2;
const FRAME = { width: 640, height: 260 };
/** Left of this is the menu; above it, the bar with the signed-in email. */
const CONTENT_LEFT = 256;
const BELOW_HEADER = 60;
const RING = "#f59e0b";

/** The same cookie shape `@supabase/ssr` reads, as the smoke sweep builds it. */
function sessionCookies(session, user, supabaseUrl, domain) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: "bearer",
    user,
  };
  const encoded = "base64-" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const name = `sb-${ref}-auth-token`;
  const CHUNK = 3180;
  const cookies = [];
  if (encoded.length <= CHUNK) cookies.push({ name, value: encoded });
  else {
    for (let i = 0; i * CHUNK < encoded.length; i++) {
      cookies.push({ name: `${name}.${i}`, value: encoded.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
  }
  return cookies.map((c) => ({ ...c, domain, path: "/", httpOnly: false, secure: base.startsWith("https:") }));
}

// --- The sample company, and nothing else -------------------------------------

const { session, user, supabaseUrl } = await smokeSession();
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: found, error: companyError } = await admin
  .schema("onebook")
  .from("company")
  .select("slug,schema_name,legal_name,is_sample,status")
  .eq("slug", "meridian")
  .limit(1);
if (companyError) throw new Error(`company register unavailable: ${companyError.message}`);
const company = found?.[0];
if (!company?.is_sample) throw new Error("refusing to capture anything but the sample company Meridian");
const books = admin.schema(company.schema_name);
console.log(`Capturing against ${company.legal_name} (sample) at ${base}`);

// --- Real names, swapped in the page ------------------------------------------

const INVENTED_PEOPLE = [
  ["Alex Morgan", "alex.morgan@example.com"],
  ["Sam Rivera", "sam.rivera@example.com"],
  ["Jordan Lee", "jordan.lee@example.com"],
  ["Taylor Brooks", "taylor.brooks@example.com"],
];
const INVENTED_COMPANIES = [
  "Riverbend Supply Co.",
  "Harbor Relay LLC",
  "Cedar Point Holdings",
  "Bluewater Trading Inc.",
  "Summit Ridge Partners",
  "Lakeside Goods LLC",
  "Pinecrest Studio",
  "Northgate Retail Group",
];

/** Pairs of [what the screen would show, what the picture shows instead]. Kept in memory only. */
async function realNames() {
  const swaps = [];
  const { data: people } = await books.from("acc_app_user").select("id,full_name");
  for (const [index, person] of (people ?? []).entries()) {
    const [name, email] = INVENTED_PEOPLE[index % INVENTED_PEOPLE.length];
    if (person.full_name) swaps.push([person.full_name, name]);
    const { data } = await admin.auth.admin.getUserById(person.id);
    if (data?.user?.email) swaps.push([data.user.email, email]);
  }
  if (user?.email) swaps.push([user.email, INVENTED_PEOPLE[0][1]]);
  const { data: others } = await admin.schema("onebook").from("company").select("*").neq("slug", "meridian");
  for (const [index, other] of (others ?? []).entries()) {
    const invented = INVENTED_COMPANIES[index % INVENTED_COMPANIES.length];
    for (const key of ["legal_name", "display_name", "dba_name", "name"]) {
      if (typeof other[key] === "string" && other[key].trim()) swaps.push([other[key], invented]);
    }
    for (const key of ["slug", "schema_name"]) {
      if (typeof other[key] === "string" && other[key].length > 3) swaps.push([other[key], `company-${index + 2}`]);
    }
  }
  // Longest first, so a full name is swapped before a part of it.
  return swaps.sort((a, b) => b[0].length - a[0].length);
}

/** Runs in the page: every text, field and tooltip label that names a real person or company. */
function scrub(swaps) {
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  // A short name is swapped only as a word of its own, so it cannot eat part of a label.
  const rules = swaps.map(([from, to]) => [
    new RegExp(`(?<![A-Za-z0-9_])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g"),
    to,
  ]);
  const swap = (text) => {
    let next = text;
    for (const [pattern, to] of rules) next = next.replace(pattern, to);
    return next.replace(email, (address) => (address.endsWith("@example.com") ? address : "alex.morgan@example.com"));
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  for (const node of nodes) {
    const next = swap(node.nodeValue ?? "");
    if (next !== node.nodeValue) node.nodeValue = next;
  }
  for (const field of document.querySelectorAll("input, textarea")) {
    const next = swap(field.value ?? "");
    if (next !== field.value) field.value = next;
  }
}

// --- Browser ------------------------------------------------------------------

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: "light" });
const domain = new URL(base).hostname;
await context.addCookies([
  ...sessionCookies(session, user, supabaseUrl, domain),
  { name: "onebook-company", value: company.slug, domain, path: "/" },
]);
const page = await context.newPage();
page.setDefaultTimeout(20_000);
// A development server builds each screen the first time it is asked for.
page.setDefaultNavigationTimeout(120_000);
// Leaving a form with something typed in asks first; the answer is always yes.
page.on("dialog", (dialog) => void dialog.accept());

const created = [];
const problems = [];

/** Until the network is quiet and nothing on the page is still spinning: a report runs after it loads. */
async function settle() {
  // Bounded: a screen that polls, or a development server's own connection, is never quiet.
  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector(".ant-btn-loading, .ant-spin-spinning, .ant-skeleton-active"), null, {
      timeout: 20_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(400);
}

async function open(route) {
  await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
  await page.locator("main, .app-shell__content").first().waitFor({ timeout: 120_000 });
  await settle();
  // The floating Report and Ask AI buttons sit over every screen's bottom right,
  // and a development server's own badge over its bottom left.
  await page.addStyleTag({ content: ".assistant-launcher, nextjs-portal { visibility: hidden !important; }" });
}

/** An Ant Design select: open it, type, and choose the option that reads `text`. */
async function pick(field, text) {
  await field.click();
  await page.keyboard.type(text, { delay: 20 });
  const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: text }).first();
  await option.waitFor();
  await option.click();
}

/** Choose only when the select is still empty: a form may start on a default. */
async function pickIfEmpty(field, text) {
  const holder = field.locator("xpath=ancestor::div[contains(concat(' ', @class, ' '), ' ant-select ')][1]");
  // Ant Design 6 marks a chosen value with ant-select-content-has-value; 5 drew a selection item.
  if ((await holder.locator(".ant-select-selection-item, .ant-select-content-has-value").count()) > 0) return;
  await pick(field, text);
}

async function count(table, filter) {
  let query = books.from(table).select("id", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count: rows, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return rows ?? 0;
}

// --- What some steps need to point at -----------------------------------------
// Each is created through the app's own screens, and only when it is missing.

async function ensureDraftInvoice() {
  if (await count("acc_invoice", (q) => q.eq("status", "draft"))) return;
  await open("/invoices");
  await page.getByRole("button", { name: /New invoice/ }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "New invoice" });
  await pick(dialog.getByLabel("Customer", { exact: true }), "Harbor Logistics");
  await dialog.getByLabel("Line 1 description").fill("Strategy workshop, half day");
  await dialog.getByLabel("Line 1 quantity").fill("1");
  await dialog.getByLabel("Line 1 unit price").fill("2400");
  await pickIfEmpty(dialog.getByLabel("Line 1 income account"), "Service Revenue");
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await dialog.waitFor({ state: "hidden" });
  created.push("a draft invoice for Harbor Logistics");
}

async function ensureEstimate() {
  if (await count("acc_estimate", (q) => q.eq("status", "open"))) return;
  await open("/estimates");
  await page.getByRole("button", { name: /New estimate/ }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "New estimate" });
  await pick(dialog.getByLabel("Customer", { exact: true }), "BlueRidge Foods");
  await dialog.getByLabel("Line 1 description").fill("Quarterly planning review");
  await dialog.getByLabel("Line 1 quantity").fill("1");
  await dialog.getByLabel("Line 1 unit price").fill("3600");
  await pickIfEmpty(dialog.getByLabel("Line 1 income account"), "Service Revenue");
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await dialog.waitFor({ state: "hidden" });
  created.push("an estimate for BlueRidge Foods");
}

async function ensureSalesReceipt() {
  if (await count("acc_sales_receipt", (q) => q.is("voided_at", null))) return;
  await open("/sales-receipts");
  await page.getByRole("button", { name: /New sales receipt/ }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "New sales receipt" });
  await pick(dialog.getByLabel("Customer", { exact: true }), "Northwind Analytics");
  await dialog.getByLabel("Line 1 description").fill("Reporting workshop");
  await dialog.getByLabel("Line 1 quantity").fill("1");
  await dialog.getByLabel("Line 1 unit price").fill("950");
  await pickIfEmpty(dialog.getByLabel("Line 1 income account"), "Service Revenue");
  await pickIfEmpty(dialog.getByLabel("Deposit to"), "Checking");
  await dialog.getByRole("button", { name: "Save and post" }).click();
  await dialog.waitFor({ state: "hidden" });
  created.push("a sales receipt for Northwind Analytics");
}

async function ensureUnappliedPayment() {
  if (await count("acc_payment", (q) => q.gt("unapplied_minor", 0).is("voided_at", null))) return;
  await open("/payments");
  await page.getByRole("button", { name: /Receive payment/ }).first().click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("Amount", { exact: true }).waitFor();
  await pick(dialog.getByLabel("Customer", { exact: true }), "Alder Grove Ventures");
  await dialog.getByLabel("Amount", { exact: true }).fill("500");
  await pickIfEmpty(dialog.getByLabel("Deposit to"), "Checking");
  await dialog.getByLabel("Reference").fill("Deposit for spring work");
  const date = dialog.getByLabel("Date", { exact: true });
  await date.click();
  await date.fill(new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }));
  await date.press("Enter");
  await dialog.getByRole("button", { name: "Record payment" }).click();
  // Either the dialog closes, or the reason it did not is said in a message or an alert.
  const refused = page.locator(".ant-message-error, .ant-modal-content .ant-alert-error, .ant-form-item-explain-error").first();
  await Promise.race([
    dialog.waitFor({ state: "hidden" }),
    refused.waitFor().then(async () => {
      throw new Error(`Record payment refused: ${(await refused.innerText()).slice(0, 160)}`);
    }),
  ]);
  created.push("a payment of $500 from Alder Grove Ventures, left unapplied");
}

/** An order half received, so both Receive and Create bill are on it. Picks up where a run that failed stopped. */
async function ensurePurchaseOrder() {
  const { data: orders, error } = await books
    .from("acc_purchase_order")
    .select("id,status")
    .in("status", ["draft", "open", "partial"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const order = orders?.[0];
  if (order?.status === "partial") return;
  if (order) {
    await open(`/purchase-orders/${order.id}`);
  } else {
    await open("/purchase-orders");
    await page.getByRole("button", { name: /New purchase order/ }).first().click();
    const dialog = page.getByRole("dialog").filter({ hasText: "New purchase order" });
    const { data: vendors } = await books.from("acc_vendor").select("name").order("name").limit(1);
    await pick(dialog.getByLabel("Vendor", { exact: true }), vendors[0].name);
    await dialog.getByPlaceholder("Description").first().fill("Printer toner cartridges");
    await pick(dialog.locator(".ant-select").filter({ hasText: "Expense account" }).first(), "Office Supplies");
    await dialog.getByPlaceholder("Qty").first().fill("10");
    await dialog.getByPlaceholder("Unit cost").first().fill("42");
    await dialog.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/purchase-orders\/[0-9a-f-]{36}/);
    await settle();
    created.push("a purchase order for toner");
  }
  if (await page.getByRole("button", { name: "Approve" }).count()) {
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: "Receive" }).waitFor();
  }
  await page.getByRole("button", { name: "Receive" }).click();
  const receive = page.getByRole("dialog").filter({ hasText: "Receive against this purchase order" });
  await receive.getByLabel("Quantity to receive for line 1").fill("6");
  await receive.getByRole("button", { name: "Record receipt" }).click();
  await receive.waitFor({ state: "hidden" });
  created.push("6 of its 10 received");
}

/** A draft count with lines on it, so Adjust inventory by … is offered. */
async function ensureStockCount() {
  const { data: drafts, error } = await books.from("acc_stock_count").select("id").eq("status", "draft").limit(1);
  if (error) throw new Error(error.message);
  const draft = drafts?.[0];
  if (draft && (await count("acc_stock_count_line", (q) => q.eq("stock_count_id", draft.id)))) return;
  if (draft) {
    await open(`/inventory/stock-count/${draft.id}`);
  } else {
    await open("/inventory/stock-count");
    await page.getByRole("button", { name: /New count/ }).first().click();
    await page.waitForURL(/\/inventory\/stock-count\/[0-9a-f-]{36}/);
    await settle();
  }
  await page.getByLabel("Count sheet", { exact: true }).fill("Branded notebooks, 40, 4.50\nPrinter paper (case), 12, 38.00");
  await page.getByRole("button", { name: "Read it" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await settle();
  created.push("a draft stock count of two lines");
}

/** Accounting Periods' fiscal year box: typed, then left, so the year's periods are read. */
async function showYear(year) {
  const box = page.locator(".ant-input-number input").first();
  await box.click();
  await box.press("Control+A");
  await box.pressSequentially(year);
  await box.press("Tab");
  await settle();
}

/** 2025's periods, December closed: before Meridian's books begin, so nothing is locked that matters. */
async function ensurePeriods() {
  if (!(await count("acc_accounting_period", (q) => q.gte("period_start", "2025-01-01").lte("period_start", "2025-12-31")))) {
    await open("/settings/periods");
    await showYear("2025");
    await page.getByText("No periods for 2025 yet").waitFor();
    // The empty table offers Generate periods as well as the bar above it.
    await page.getByRole("button", { name: "Generate periods" }).first().click();
    await page.getByRole("row").filter({ hasText: "2025-12" }).waitFor();
    if (!(await count("acc_accounting_period", (q) => q.eq("period_start", "2025-12-01")))) {
      throw new Error("Generate periods made no December 2025");
    }
    created.push("2025's accounting periods");
  }
  if (!(await count("acc_accounting_period", (q) => q.eq("period_start", "2025-12-01").eq("status", "closed")))) {
    await open("/settings/periods");
    await showYear("2025");
    const december = page.getByRole("row").filter({ hasText: "2025-12" });
    await december.getByRole("button", { name: "Close", exact: true }).click();
    const confirm = page.getByRole("dialog").filter({ hasText: "Close 2025-12?" });
    await confirm.getByPlaceholder("Reason for closing").fill("Before the books begin; closed for the guide's pictures.");
    const variance = confirm.getByPlaceholder(/Explain the difference/);
    if (await variance.count()) await variance.fill("Nothing is posted before the books begin in January 2026.");
    await confirm.getByRole("button", { name: /^Close/ }).last().click();
    await confirm.waitFor({ state: "hidden" });
    await settle();
    created.push("December 2025 closed");
  }
}

// --- Framing ------------------------------------------------------------------

function union(boxes) {
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A frame of at least FRAME around `area`, kept off the menu and, unless asked, the top bar. */
function frameAround(
  area,
  { width = FRAME.width, height = FRAME.height, top = BELOW_HEADER, bottom = VIEWPORT.height, left = CONTENT_LEFT, right = VIEWPORT.width } = {},
) {
  const w = Math.min(Math.max(width, area.width + 48), right - left);
  const h = Math.min(Math.max(height, area.height + 48), bottom - top);
  const x = Math.min(Math.max(area.x + area.width / 2 - w / 2, left), right - w);
  // A little above centre, so the control sits in the upper half with what follows it below;
  // an open menu, which fills the frame, is centred.
  const lift = area.height + 48 >= h ? 0.5 : 0.45;
  const y = Math.min(Math.max(area.y + area.height / 2 - h * lift, top), bottom - h);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

async function ring(box) {
  await page.evaluate(
    ({ box, color }) => {
      const el = document.createElement("div");
      el.id = "guide-step-ring";
      Object.assign(el.style, {
        position: "fixed",
        left: `${box.x - 5}px`,
        top: `${box.y - 5}px`,
        width: `${box.width + 10}px`,
        height: `${box.height + 10}px`,
        border: `3px solid ${color}`,
        borderRadius: "10px",
        boxShadow: "0 0 0 4px rgba(245, 158, 11, 0.22)",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.body.appendChild(el);
    },
    { box, color: RING },
  );
}

let swaps = [];

/**
 * Refuses the picture when anything on screen still names a real person or
 * company, or shows an email address that is not an invented one.
 */
async function assertScrubbed() {
  const found = await page.evaluate((real) => {
    const text = `${document.body.innerText}\n${[...document.querySelectorAll("input, textarea")].map((f) => f.value).join("\n")}`;
    const names = real.filter((from) =>
      new RegExp(`(?<![A-Za-z0-9_])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`).test(text),
    ).length;
    const emails = (text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).filter((a) => !a.endsWith("@example.com")).length;
    return { names, emails };
  }, swaps.map(([from]) => from));
  if (found.names || found.emails) {
    throw new Error(`refusing a picture with ${found.names} real name(s) and ${found.emails} email address(es) still on screen`);
  }
}

/** For --failures only, and scrubbed like any picture: it can show a settings screen. */
async function keepFailure(name) {
  if (!failuresDir) return;
  mkdirSync(failuresDir, { recursive: true });
  await page.evaluate(scrub, swaps).catch(() => undefined);
  await page.screenshot({ path: join(failuresDir, `${name}.png`) }).catch(() => undefined);
}

async function capture(recipe) {
  await open(recipe.route);
  if (recipe.prepare) await recipe.prepare();
  const target = recipe.target().first();
  await target.waitFor({ state: "visible" });
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  // Every screen, not only the settings ones: an invoice's history names who created it.
  await page.evaluate(scrub, swaps);
  await assertScrubbed();
  const box = await target.boundingBox();
  if (!box) throw new Error("the control has no box on screen");
  const extras = recipe.include ? await Promise.all(recipe.include().map((l) => l.first().boundingBox())) : [];
  await ring(box);
  // A control in a dialog is framed inside the dialog, not over the grey behind it.
  // The dialog sits over the menu and the top bar, so those need not be kept clear.
  const inside = recipe.within ? await recipe.within().first().boundingBox() : null;
  const frame = inside
    ? {
        ...recipe.frame,
        left: Math.max(0, Math.round(inside.x)),
        right: Math.min(VIEWPORT.width, Math.round(inside.x + inside.width)),
        top: Math.max(0, Math.round(inside.y)),
        bottom: Math.min(VIEWPORT.height, Math.round(inside.y + inside.height)),
      }
    : recipe.frame;
  const clip = frameAround(union([box, ...extras.filter(Boolean)]), frame);
  const png = await page.screenshot({ clip });
  await sharp(png).webp({ quality: 82, effort: 6 }).toFile(join(outDir, `${recipe.shot}.webp`));
  await page.evaluate(() => document.getElementById("guide-step-ring")?.remove());
  if (recipe.after) await recipe.after();
}

// --- Locators shared by several steps ------------------------------------------

/** A button by its label; a plain string must be the whole label, so "Issue" is not "1 Issue". */
const button = (name) => page.getByRole("button", { name, exact: typeof name === "string" });
const menuItem = (name) => page.locator(".ant-dropdown:visible").getByRole("menuitem", { name });
const visibleMenu = () => page.locator(".ant-dropdown:visible");
const heading = (name) => page.getByRole("heading", { name, exact: true });
const openMenu = (label) => async () => {
  await page.getByRole("button", { name: label }).first().click();
  await visibleMenu().first().waitFor();
  // Off the button, so its "More actions" tooltip goes; the menu stays open.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 8);
  await page.waitForTimeout(300);
};

// --- One recipe per step --------------------------------------------------------
// `shot` names the picture; tests/unit/guide-pictures-319.test.ts holds the list
// to the steps in lib/domain/system-guide.ts.

const RECIPES = [
  // Invoice a customer and get paid
  { shot: "get-paid-1", route: "/invoices", target: () => button(/New invoice/) },
  { shot: "get-paid-2", route: "/invoices", target: () => button("Issue") },
  {
    shot: "get-paid-3",
    route: "/invoices",
    prepare: openMenu("Actions for INV-000003"),
    target: () => menuItem("Download PDF"),
    include: () => [visibleMenu(), button("Actions for INV-000003")],
  },
  { shot: "get-paid-4", route: "/payments", target: () => button(/Receive payment/) },
  { shot: "get-paid-5", route: "/reports/ar-aging", target: () => heading("Accounts Receivable Aging") },
  { shot: "get-paid-6", route: "/reports/open-invoices", target: () => heading("Open Invoices") },
  { shot: "get-paid-7", route: "/reports/cash-flow-forecast", target: () => heading("13 Week Cash Forecast") },

  // Give a customer an estimate and turn it into an invoice
  { shot: "quote-a-price-1", route: "/estimates", target: () => button(/New estimate/) },
  {
    shot: "quote-a-price-2",
    route: "/estimates",
    prepare: openMenu(/^Actions for EST-/),
    target: () => menuItem("Download PDF"),
    include: () => [visibleMenu()],
  },
  {
    shot: "quote-a-price-3",
    route: "/estimates",
    prepare: openMenu(/^Actions for EST-/),
    target: () => menuItem("Mark declined"),
    include: () => [visibleMenu()],
  },
  {
    shot: "quote-a-price-4",
    route: "/estimates",
    prepare: openMenu(/^Actions for EST-/),
    target: () => menuItem("Turn into an invoice"),
    include: () => [visibleMenu()],
  },
  {
    shot: "quote-a-price-5",
    within: () => page.getByRole("dialog").last(),
    route: "/estimates",
    prepare: async () => {
      await openMenu(/^Actions for EST-/)();
      await menuItem("Turn into an invoice").click();
      const confirm = page.getByRole("dialog").getByRole("button", { name: "Turn into an invoice" });
      if (await confirm.count()) await confirm.first().click();
      await page.waitForURL(/\/invoices/);
      await page.getByRole("dialog").filter({ hasText: "New invoice" }).waitFor();
      await page.waitForTimeout(600);
    },
    target: () => page.getByRole("dialog").filter({ hasText: "New invoice" }).getByRole("button", { name: "Save draft" }),
    frame: { height: 300 },
    after: async () => {
      await page.getByRole("dialog").filter({ hasText: "New invoice" }).getByRole("button", { name: "Cancel" }).click();
    },
  },
  {
    shot: "quote-a-price-6",
    within: () => page.getByRole("dialog").last(),
    route: "/invoices",
    prepare: async () => {
      await page.getByRole("button", { name: /Actions for draft invoice/i }).first().click();
      await menuItem(/^View/).first().click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(500);
    },
    target: () => page.getByRole("dialog").getByRole("button", { name: "Issue" }),
    frame: { height: 300 },
    after: async () => page.keyboard.press("Escape"),
  },
  {
    shot: "quote-a-price-7",
    route: "/invoices",
    prepare: openMenu("Actions for INV-000001"),
    target: () => menuItem(/^Void invoice/),
    include: () => [visibleMenu()],
  },

  // Record a sale paid on the spot
  { shot: "record-a-paid-sale-1", route: "/sales-receipts", target: () => button(/New sales receipt/) },
  {
    shot: "record-a-paid-sale-2",
    within: () => page.getByRole("dialog").last(),
    route: "/sales-receipts",
    prepare: async () => {
      await button(/New sales receipt/).click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(500);
    },
    target: () => page.getByRole("dialog").locator(".ant-form-item").filter({ hasText: "Deposit to" }),
    after: async () => page.keyboard.press("Escape"),
  },
  {
    shot: "record-a-paid-sale-3",
    within: () => page.getByRole("dialog").last(),
    route: "/sales-receipts",
    prepare: async () => {
      await button(/New sales receipt/).click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(500);
    },
    target: () => page.getByRole("dialog").getByRole("button", { name: "Save and post" }),
    after: async () => page.keyboard.press("Escape"),
  },
  {
    shot: "record-a-paid-sale-4",
    route: "/sales-receipts",
    prepare: openMenu(/^Actions for SR-/),
    target: () => menuItem("Download PDF"),
    include: () => [visibleMenu()],
  },
  {
    shot: "record-a-paid-sale-5",
    route: "/sales-receipts",
    prepare: openMenu(/^Actions for SR-/),
    target: () => menuItem("Void"),
    include: () => [visibleMenu()],
  },

  // Correct or cancel a sale
  {
    shot: "correct-a-sale-1",
    route: "/invoices",
    prepare: openMenu("Actions for INV-000001"),
    target: () => menuItem(/^Void invoice/),
    include: () => [visibleMenu(), button("Actions for INV-000001")],
  },
  { shot: "correct-a-sale-2", route: "/credit-memos", target: () => button(/New credit memo/) },
  {
    shot: "correct-a-sale-3",
    route: "/payments",
    prepare: openMenu(/^Actions for PMT-/),
    target: () => menuItem("Refund"),
    include: () => [visibleMenu()],
  },
  {
    shot: "correct-a-sale-4",
    route: "/invoices",
    prepare: openMenu("Actions for INV-000003"),
    target: () => menuItem("Write off"),
    include: () => [visibleMenu()],
  },

  // Record what you owe and pay it
  { shot: "pay-suppliers-1", route: "/bills", target: () => button(/New bill/) },
  { shot: "pay-suppliers-2", route: "/expenses", target: () => button(/New expense/) },
  { shot: "pay-suppliers-3", route: "/bills", target: () => button("Manage bill attachments") },
  { shot: "pay-suppliers-4", route: "/pay-bills", target: () => button(/Pay bills/) },
  { shot: "pay-suppliers-5", route: "/reports/ap-aging", target: () => heading("Accounts Payable Aging") },
  { shot: "pay-suppliers-6", route: "/reports/unpaid-bills", target: () => heading("Unpaid Bills") },

  // Order stock and receive it
  { shot: "purchasing-1", route: "/purchase-orders", target: () => button(/New purchase order/) },
  {
    shot: "purchasing-2",
    route: "/purchase-orders",
    prepare: async () => {
      await page.getByRole("row").filter({ hasText: /Partially received|Partial/ }).first().getByRole("link").first().click();
      await page.waitForURL(/\/purchase-orders\/[0-9a-f-]{36}/);
      await settle();
    },
    target: () => button("Receive"),
  },
  {
    shot: "purchasing-3",
    route: "/purchase-orders",
    prepare: async () => {
      await page.getByRole("row").filter({ hasText: /Partially received|Partial/ }).first().getByRole("link").first().click();
      await page.waitForURL(/\/purchase-orders\/[0-9a-f-]{36}/);
      await settle();
    },
    target: () => button("Create bill"),
  },
  { shot: "purchasing-4", route: "/purchase-orders/received-not-billed", target: () => heading("Received Not Billed") },
  { shot: "purchasing-5", route: "/reports/inventory-valuation", target: () => heading("Inventory Valuation") },
  { shot: "purchasing-6", route: "/reports/purchases-inventory", target: () => heading("Purchases and Inventory") },

  // Set a budget and compare it with the books
  // The report is chosen in the picker at the top of Reports.
  { shot: "budget-1", route: "/reports?report=budget", target: () => page.locator(".ant-select").filter({ hasText: "Budget vs Actual" }) },
  { shot: "budget-2", route: "/reports?report=budget", target: () => button(/Manage budget/) },
  {
    shot: "budget-3",
    route: "/reports?report=budget",
    prepare: async () => {
      await button(/Manage budget/).click();
      await page.locator(".ant-drawer-open").waitFor();
      // The grid is read after the drawer opens.
      await page.getByText("Reading the budget").waitFor({ state: "hidden", timeout: 30_000 });
      await page.waitForTimeout(500);
    },
    target: () => button(/Start from last year/),
    within: () => page.locator(".ant-drawer-open .ant-drawer-content, .ant-drawer-open .ant-drawer-section").first(),
    after: async () => page.keyboard.press("Escape"),
  },
  {
    shot: "budget-4",
    route: "/reports?report=budget",
    prepare: async () => {
      await button(/Manage budget/).click();
      await page.locator(".ant-drawer-open").waitFor();
      // The grid is read after the drawer opens.
      await page.getByText("Reading the budget").waitFor({ state: "hidden", timeout: 30_000 });
      await page.waitForTimeout(500);
    },
    target: () => page.locator(".ant-drawer-open").getByRole("button", { name: "Save", exact: true }),
    within: () => page.locator(".ant-drawer-open .ant-drawer-content, .ant-drawer-open .ant-drawer-section").first(),
    after: async () => page.keyboard.press("Escape"),
  },

  // Count stock
  { shot: "count-stock-1", route: "/inventory/stock-count", target: () => button(/New count/) },
  {
    shot: "count-stock-2",
    route: "/inventory/stock-count",
    prepare: async () => {
      await page.getByRole("row").filter({ hasText: /Draft/ }).first().getByRole("link").first().click();
      await page.waitForURL(/\/inventory\/stock-count\/[0-9a-f-]{36}/);
      await settle();
    },
    target: () => page.getByRole("region", { name: "Paste a count sheet" }),
  },
  {
    shot: "count-stock-3",
    route: "/inventory/stock-count",
    prepare: async () => {
      await page.getByRole("row").filter({ hasText: /Draft/ }).first().getByRole("link").first().click();
      await page.waitForURL(/\/inventory\/stock-count\/[0-9a-f-]{36}/);
      await settle();
    },
    target: () => button("Save draft"),
  },
  {
    shot: "count-stock-4",
    route: "/inventory/stock-count",
    prepare: async () => {
      await page.getByRole("row").filter({ hasText: /Draft/ }).first().getByRole("link").first().click();
      await page.waitForURL(/\/inventory\/stock-count\/[0-9a-f-]{36}/);
      await settle();
    },
    target: () => button(/^Adjust inventory by/),
  },

  // Close an accounting period
  { shot: "period-close-1", route: "/reports?report=trial", target: () => page.locator(".ant-select").filter({ hasText: "Trial Balance" }) },
  { shot: "period-close-2", route: "/accounts", target: () => page.getByLabel(/^As of/).first() },
  {
    shot: "period-close-3",
    route: `/reports/exceptions`,
    target: () => page.getByText("Clearing accounts that have not emptied", { exact: true }),
  },
  {
    shot: "period-close-4",
    route: "/settings/periods",
    prepare: async () => showYear("2025"),
    target: () => page.getByRole("row").filter({ hasText: "2025-11" }).getByRole("button", { name: "Close" }),
  },
  {
    shot: "period-close-5",
    route: "/settings/periods",
    prepare: async () => showYear("2025"),
    target: () => page.getByRole("row").filter({ hasText: "2025-12" }).getByRole("button", { name: "Reopen" }),
  },
  { shot: "period-close-6", route: "/reports/close-log", target: () => heading("Month-End Close Log") },
  { shot: "period-close-7", route: "/reports/financial-ratios", target: () => heading("Financial Ratios") },
  { shot: "period-close-8", route: "/accounting/beancount", target: () => heading("Beancount Export") },

  // Handle US sales tax
  {
    shot: "sales-tax-1",
    route: "/sales-tax",
    prepare: async () => page.getByRole("tab", { name: "Tax rates" }).click(),
    target: () => button(/New rate/),
  },
  { shot: "sales-tax-2", route: "/sales-tax", target: () => page.getByRole("tab", { name: "Liability" }) },
  { shot: "sales-tax-3", route: "/sales-tax", target: () => button(/Record payment/) },
  { shot: "sales-tax-4", route: "/sales-tax", target: () => page.getByRole("link", { name: "Sales Tax Liability by period" }) },

  // Prepare vendor 1099 information
  { shot: "year-end-1", route: "/vendors", target: () => button("Tax profile") },
  { shot: "year-end-2", route: "/reports/1099", target: () => heading("1099 Review") },

  // Control who can do what
  { shot: "governance-1", route: "/settings/users", target: () => button(/Add user/) },
  {
    shot: "governance-2",
    route: "/settings/users",
    // Nobody can suspend themselves: the first row whose menu offers it.
    prepare: async () => {
      const menus = page.getByRole("button", { name: /^Actions for / });
      for (let i = 0; i < (await menus.count()); i++) {
        await menus.nth(i).click();
        await visibleMenu().first().waitFor();
        if (await menuItem("Suspend").count()) {
          await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height - 8);
          await page.waitForTimeout(300);
          return;
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
      throw new Error("no user's menu offers Suspend");
    },
    target: () => menuItem("Suspend"),
    include: () => [visibleMenu()],
  },
  { shot: "governance-3", route: "/settings/permissions", target: () => heading("Permissions") },
  { shot: "governance-4", route: "/settings/approvals", target: () => heading(/Approval/) },
  { shot: "governance-5", route: "/settings/audit", target: () => heading(/Audit/) },
  { shot: "governance-6", route: "/reports/change-log", target: () => heading("Change Log") },
  { shot: "governance-7", route: "/settings/users", target: () => heading("Users") },

  // Set up a new company
  { shot: "set-up-a-company-1", route: "/settings/companies", target: () => button(/New company/) },
  {
    shot: "set-up-a-company-2",
    route: "/settings/company",
    target: () => page.locator(".ant-card").filter({ hasNotText: "Posting defaults" }).getByRole("button", { name: "Edit", exact: true }),
  },
  {
    shot: "set-up-a-company-3",
    route: "/settings/company",
    target: () => page.locator(".ant-card").filter({ hasText: "Posting defaults" }).getByRole("button", { name: "Edit", exact: true }),
  },
  { shot: "set-up-a-company-4", route: "/opening-balances", target: () => button(/Post opening balances/) },
  { shot: "set-up-a-company-5", route: "/banking", target: () => button(/Add bank account/) },
  { shot: "set-up-a-company-6", route: "/settings/users", target: () => button(/Add user/), frame: { height: 220 } },

  // Find a backup, and open it as a second company to compare against
  { shot: "restore-a-backup-1", route: "/settings/backups", target: () => heading("Backups") },
  { shot: "restore-a-backup-2", route: "/settings/backups", target: () => button("Download") },
  { shot: "restore-a-backup-3", route: "/settings/backups", target: () => button("Restore") },
  {
    shot: "restore-a-backup-4",
    route: "/settings/backups",
    prepare: async () => {
      await button("Restore").first().click();
      await page.waitForURL(/\/settings\/backups\/[0-9a-f-]{36}\/restore/);
      await settle();
    },
    // The totals themselves appear only after a restore, which makes a company.
    target: () => page.getByText(/When it finishes, the copy's trial balance/),
  },
  {
    shot: "restore-a-backup-5",
    route: "/settings/backups",
    target: () => page.locator(".app-shell__header .ant-select").first(),
    frame: { top: 0, right: 860 },
  },

  // Tell us what is wrong or missing
  {
    shot: "feedback-1",
    route: "/invoices",
    prepare: async () => page.addStyleTag({ content: ".assistant-launcher { visibility: visible !important; }" }),
    target: () => page.locator(".assistant-launcher").getByRole("button", { name: /Report/ }),
    frame: { height: 220 },
  },
  {
    shot: "feedback-2",
    route: "/invoices",
    prepare: async () => page.addStyleTag({ content: ".assistant-launcher { visibility: visible !important; }" }),
    target: () => button(/^Ask AI$/),
    frame: { height: 220 },
  },
  { shot: "feedback-3", route: "/settings/feedback", target: () => heading("Feedback triage") },
];

// --- Run ------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
try {
  swaps = await realNames();
  for (const ensure of [
    ensureDraftInvoice,
    ensureEstimate,
    ensureSalesReceipt,
    ensureUnappliedPayment,
    ensurePurchaseOrder,
    ensureStockCount,
    ensurePeriods,
  ]) {
    try {
      await ensure();
    } catch (error) {
      problems.push(`${ensure.name}: ${error.message.split("\n")[0]}`);
      await keepFailure(ensure.name);
    }
  }
  for (const recipe of RECIPES) {
    if (only.size && !only.has(recipe.shot.replace(/-\d+$/, "")) && !only.has(recipe.shot)) continue;
    try {
      await capture(recipe);
      console.log(`  shot  ${recipe.shot}`);
    } catch (error) {
      problems.push(`${recipe.shot}: ${error.message.split("\n")[0]}`);
      console.log(`  FAIL  ${recipe.shot}`);
      await keepFailure(recipe.shot);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }
} finally {
  await browser.close();
}
for (const line of created) console.log(`  made  ${line}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exitCode = 1;
}
