/**
 * Pictures for the guide's steps (3.0.21): each step's screen, cropped around
 * the control the step names, with that control ringed in orange.
 *
 *   npm run guide:step-shots -- [baseUrl] [--only=get-paid,budget]
 *
 * Run it against a running server (`npm run dev` or a built one) after a change
 * to any screen the guide shows. Each picture lands in public/guide/steps as
 * WebP, named after its step; tests/unit/guide-pictures-321.test.ts checks that
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
 *
 * Banking (3.0.27): its steps need bank accounts, statements and reconciliations
 * in a given state. `ensureBanking` makes them in Meridian through Banking's own
 * screens, from statements made up in this file to agree with Meridian's books
 * (`statementCsv`); each month opens where the one before closed. The bank feed
 * comes from Plaid's test service, which only the deployed app has set up, so
 * run Banking against it:
 *
 *   npm run guide:step-shots -- https://ctyhp-accounting.vercel.app --only=bank-lines-in
 *
 * Three pictures need a statement's balance posted as payments on Checking:
 * the three entries are posted just before them and removed right after with
 * Reconcile's own Remove these entries, which reverses each on its date.
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
  // The floating Report and Ask Abacus buttons sit over every screen's bottom right,
  // and a development server's own badge over its bottom left.
  await page.addStyleTag({ content: ".assistant-launcher, nextjs-portal { visibility: hidden !important; }" });
}

/** An Ant Design select: open it, type, and choose the option that reads `choice` (by default, what was typed). */
async function pick(field, text, choice = text) {
  await field.click();
  await page.keyboard.type(text, { delay: 20 });
  const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: choice }).first();
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

// --- Banking: statements made up for the sample company ------------------------
// Meridian's books hold entries on Checking from January to March 2026 and no
// bank statement at all. These statements are made up to agree with those
// entries, with the lines only a bank would have added (a monthly fee, a charge
// taken twice, a loan payment the books missed), and are handed to the file
// chooser from memory: no statement file is ever read from disk.

const BANKING_GUIDES = new Set([
  "bank-lines-in",
  "code-and-match",
  "cards-loans-companies",
  "reconcile-by-hand",
  "reconcile-from-files",
  "check-reconciliations",
]);
const BANK = "First National Bank";
const BANK_ACCOUNTS = {
  checking: { code: "1010", kind: "Checking", masked: "****4417" },
  savings: { code: "1020", kind: "Savings", masked: "****8820" },
  card: { code: "2050", kind: "Credit card", masked: "****1093" },
};

const cents = (amount) => Math.round(amount * 100);
/** Where a statement closes; each month opens where the one before it closed, so the months join up. */
const closingOf = ({ opening, lines }) => (cents(opening) + lines.reduce((sum, [, , amount]) => sum + cents(amount), 0)) / 100;

/** Each line is [date, description, amount], money in positive, as a bank download prints it. */
const CHECKING_JANUARY = {
  // Opened on New Year's Day with the deposit the books record as their opening balance.
  opening: 0,
  lines: [
    ["2026-01-01", "OPENING DEPOSIT", 30000],
    ["2026-01-08", "METRO REALTY PARTNERS RENT", -4200],
    ["2026-01-12", "DEPOSIT NORTHWIND ANALYTICS RCV-1001", 32000],
    ["2026-01-15", "PAYROLL SEMI-MONTHLY", -15725],
    ["2026-01-28", "PACIFIC POWER AUTOPAY", -540],
  ],
};
const CHECKING_FEBRUARY = {
  opening: closingOf(CHECKING_JANUARY),
  lines: [
    ["2026-02-02", "ADOBE *CREATIVE CLOUD", -54.99],
    ["2026-02-06", "METRO REALTY PARTNERS RENT", -4200],
    ["2026-02-10", "FIBERLINK COMMUNICATIONS", -260],
    // Taken twice: the books hold one, so the second is held back as already booked.
    ["2026-02-11", "FIBERLINK COMMUNICATIONS", -260],
    ["2026-02-14", "PAYROLL SEMI-MONTHLY", -15725],
    // The books missed February's instalment: offered as a loan payment, to split.
    ["2026-02-16", "FIRST NATIONAL LOAN PMT", -1650],
    ["2026-02-24", "DEPOSIT HARBOR LOGISTICS RCV-1002", 12000],
    ["2026-02-27", "APEX INSURANCE PREMIUM", -7200],
    ["2026-02-28", "MONTHLY SERVICE FEE", -25],
  ],
};
const CHECKING_MARCH = {
  opening: closingOf(CHECKING_FEBRUARY),
  lines: [
    ["2026-03-02", "ADOBE *CREATIVE CLOUD", -54.99],
    ["2026-03-02", "METRO REALTY PARTNERS RENT", -4200],
    // Charged twice in two days: the Banking overview's possible duplicate.
    ["2026-03-04", "ADOBE *CREATIVE CLOUD", -54.99],
    ["2026-03-05", "COUNTER DEPOSIT", 9800],
    ["2026-03-09", "CHECK 2210 STERLING & CO CPAS", -3500],
    ["2026-03-13", "PAYROLL SEMI-MONTHLY", -15725],
    ["2026-03-16", "FIRST NATIONAL LOAN PMT", -1680],
    ["2026-03-20", "OFFICE DEPOT #1123", -86.4],
    ["2026-03-27", "ACCOUNT SERVICE CHARGES", -75],
    ["2026-03-30", "DEPOSIT BLUERIDGE FOODS RCV-1003", 16800],
    ["2026-03-31", "OWNER DISTRIBUTION", -5000],
    ["2026-03-31", "IRS USATAXPYMT", -8325],
  ],
};
/** Only ever previewed in the import dialog, never imported. */
const CHECKING_APRIL = {
  opening: closingOf(CHECKING_MARCH),
  lines: [
    ["2026-04-01", "ADOBE *CREATIVE CLOUD", -54.99],
    ["2026-04-03", "METRO REALTY PARTNERS RENT", -4200],
    ["2026-04-10", "FIBERLINK COMMUNICATIONS", -260],
    ["2026-04-14", "PAYROLL SEMI-MONTHLY", -15725],
    ["2026-04-16", "FIRST NATIONAL LOAN PMT", -1650],
    ["2026-04-22", "DEPOSIT NORTHWIND ANALYTICS", 18500],
    ["2026-04-30", "MONTHLY SERVICE FEE", -25],
  ],
};
/** Savings has never been reconciled; the books reach this statement's opening exactly. */
const SAVINGS_MARCH = {
  opening: 25085,
  lines: [["2026-03-31", "INTEREST PAYMENT", 86.2]],
};

const usDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/**
 * A bank download: date, description, amount and the running balance. `leaveOut`
 * drops one line from the file while its balance still counts, which is a
 * statement that does not add up.
 */
function statementCsv({ opening, lines }, { leaveOut = -1 } = {}) {
  let balance = cents(opening);
  const rows = ["Date,Description,Amount,Balance"];
  lines.forEach(([date, description, amount], index) => {
    balance += cents(amount);
    if (index === leaveOut) return;
    rows.push([usDate(date), `"${description}"`, amount.toFixed(2), (balance / 100).toFixed(2)].join(","));
  });
  return { csv: `${rows.join("\n")}\n`, closing: balance / 100 };
}

const statementFile = (name, statement, options) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(statementCsv(statement, options).csv, "utf8"),
});

/** The bank accounts and reconciliations the Banking recipes point at, filled in by ensureBanking. */
const ids = {};

async function bankAccountFor(code) {
  const { data: gl, error } = await books.from("acc_account").select("id").eq("account_code", code).single();
  if (error) throw new Error(`account ${code}: ${error.message}`);
  const { data } = await books.from("acc_bank_account").select("id").eq("account_id", gl.id).maybeSingle();
  return data?.id ?? null;
}

async function reconciliationOf(bankAccountId, endingDate, status) {
  let query = books
    .from("acc_statement_reconciliation")
    .select("id,status,statement_file_id")
    .eq("bank_account_id", bankAccountId)
    .eq("statement_ending_date", endingDate);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function until(check, what, timeout = 60_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await page.waitForTimeout(1_000);
  }
}

/** A date picker takes the date as every screen prints it. */
async function typeDate(field, iso) {
  await field.click();
  await field.fill(usDate(iso));
  await field.press("Enter");
}

/** Opens Import statement from `trigger`, hands it the file, and waits until the statement has been read. */
async function readStatement(trigger, file) {
  await trigger.click();
  const dialog = page.getByRole("dialog").last();
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await dialog.locator(".ant-alert").first().waitFor({ timeout: 60_000 });
  await settle();
  return dialog;
}

async function importStatement(trigger, file) {
  const dialog = await readStatement(trigger, file);
  const ok = dialog.getByRole("button", { name: /^Import \d+ lines?$/ });
  await until(async () => ok.isEnabled(), "Import to be offered");
  await ok.click();
  await dialog.waitFor({ state: "hidden", timeout: 120_000 });
  await settle();
}

async function ensureBankAccounts() {
  for (const [key, spec] of Object.entries(BANK_ACCOUNTS)) {
    let id = await bankAccountFor(spec.code);
    if (!id) {
      await open("/banking");
      await page.getByRole("button", { name: /Add (bank )?account/ }).first().click();
      const dialog = page.getByRole("dialog").filter({ hasText: "Add bank account" });
      await pick(dialog.getByLabel("What kind of account is this?"), spec.kind);
      await pickIfEmpty(dialog.getByLabel("General Ledger account"), spec.code);
      await dialog.getByLabel(spec.kind === "Credit card" ? "Card issuer" : "Bank name").fill(BANK);
      await dialog.getByLabel("Account number (masked)").fill(spec.masked);
      await dialog.getByRole("button", { name: "Create" }).click();
      id = await until(() => bankAccountFor(spec.code), `${spec.kind} in Banking`);
      created.push(`${spec.kind} (${spec.code}) added to Banking`);
    }
    ids[key] = id;
  }
}

/** January reconciled from its statement file, the way Reconcile from statement files does it. */
async function ensureCheckingJanuary() {
  let january = await reconciliationOf(ids.checking, "2026-01-31", "completed");
  if (!january) {
    await open(`/banking/reconcile/from-files?account=${ids.checking}`);
    await page.locator('input[type="file"]').first().setInputFiles(statementFile("checking-2026-01.csv", CHECKING_JANUARY));
    const preview = page.getByRole("button", { name: /^Preview/ });
    await until(async () => preview.isEnabled(), "Preview to be offered");
    await preview.click();
    const sign = page.getByRole("button", { name: /^Sign off/ });
    await sign.waitFor({ timeout: 120_000 });
    await sign.click();
    january = await until(() => reconciliationOf(ids.checking, "2026-01-31", "completed"), "January signed off", 120_000);
    created.push("Checking's January reconciled from its statement file");
  }
  ids.january = january.id;
}

/** A reconciliation started for `ending`, with `statement` imported into it unless it is to stay without a file. */
async function ensureReconciliation(bankKey, ending, balance, statement, fileName) {
  let rec = await reconciliationOf(ids[bankKey], ending, "in_progress");
  if (!rec) {
    await open(`/banking/reconcile?account=${ids[bankKey]}`);
    await page.getByRole("button", { name: /New reconciliation/ }).first().click();
    const dialog = page.getByRole("dialog").filter({ hasText: "New reconciliation" });
    await typeDate(dialog.getByLabel("Statement ending date"), ending);
    await dialog.locator(".ant-input-number input").fill(String(balance));
    await dialog.getByRole("button", { name: "OK" }).click();
    rec = await until(() => reconciliationOf(ids[bankKey], ending, "in_progress"), `the ${ending} reconciliation`);
    created.push(`a reconciliation of ${BANK_ACCOUNTS[bankKey].kind} to ${ending}`);
  }
  if (statement && !rec.statement_file_id) {
    await open(`/banking/reconcile/${rec.id}`);
    await importStatement(page.getByRole("button", { name: /Import statement/ }).first(), statementFile(fileName, statement));
    rec = await until(async () => {
      const kept = await reconciliationOf(ids[bankKey], ending, "in_progress");
      return kept?.statement_file_id ? kept : null;
    }, `the ${ending} statement file to be kept`);
    created.push(`${fileName} imported into it`);
  }
  return rec.id;
}

async function ensureCheckingMarch() {
  const march = await count("acc_bank_transaction", (q) =>
    q.eq("bank_account_id", ids.checking).gte("txn_date", "2026-03-01").lte("txn_date", "2026-03-31"),
  );
  if (!march) {
    await open(`/banking?account=${ids.checking}`);
    await importStatement(page.getByRole("button", { name: /Import statement/ }).first(), statementFile("checking-2026-03.csv", CHECKING_MARCH));
    created.push("Checking's March statement imported into Bank Transactions");
  }
  // March opens where February closed: its first balance says so.
  const [date, , amount] = CHECKING_MARCH.lines[0];
  const { data: first } = await books
    .from("acc_bank_transaction")
    .select("running_balance_minor")
    .eq("bank_account_id", ids.checking)
    .eq("txn_date", date)
    .not("running_balance_minor", "is", null)
    .order("running_balance_minor", { ascending: false })
    .limit(1);
  const expected = cents(CHECKING_MARCH.opening) + cents(amount);
  if (first?.[0] && first[0].running_balance_minor !== expected) {
    throw new Error(`March's balances do not follow February's closing: ${first[0].running_balance_minor} against ${expected}`);
  }
}

/** The subscription coded from Bank Transactions, so its lines offer Recode and the overview sees it charged twice. */
async function ensureCodedSubscription() {
  const waiting = () =>
    count("acc_bank_transaction", (q) =>
      q.eq("bank_account_id", ids.checking).eq("status", "unmatched").ilike("description", "ADOBE%").lte("txn_date", "2026-03-31"),
    );
  if (!(await waiting())) return;
  await open(`/banking?account=${ids.checking}`);
  await page.getByLabel("Search bank transactions by description or reference").fill("ADOBE");
  await settle();
  for (let left = await waiting(); left > 0; left = await waiting()) {
    const cell = page.getByRole("row").filter({ hasText: "ADOBE" }).locator(".ant-select").filter({ hasText: "Find account" }).first();
    // The search reads words, not codes; 6100 Office is a heading, so it offers Office Supplies.
    await pick(cell, "office", /^6110\s*—\s*Office Supplies/);
    await until(async () => (await waiting()) < left, "the subscription to be coded");
    await settle();
  }
  created.push("the Adobe subscription coded to Office Supplies");
}

/**
 * FiberLink took February's bill twice. Ledger matching offered the books' one
 * entry to the second charge, which would leave that line spoken for; it is
 * rejected, so the entry goes to the first and the second waits on Reconcile,
 * held back as already booked.
 */
async function ensureSecondChargeFree() {
  const { data: second } = await books
    .from("acc_bank_transaction")
    .select("id")
    .eq("bank_account_id", ids.checking)
    .eq("txn_date", "2026-02-11")
    .ilike("description", "FIBERLINK%")
    .limit(1);
  const line = second?.[0];
  if (!line) throw new Error("February's second FiberLink charge is not in Bank Transactions");
  if (!(await count("acc_reconciliation", (q) => q.eq("bank_transaction_id", line.id).eq("status", "suggested")))) return;
  await open(`/banking?account=${ids.checking}`);
  await page.getByLabel("Search bank transactions by description or reference").fill("FIBERLINK");
  await settle();
  await page.getByRole("row").filter({ hasText: "02/11/2026" }).getByRole("button", { name: "Reject", exact: true }).click();
  await until(async () => !(await count("acc_reconciliation", (q) => q.eq("bank_transaction_id", line.id).eq("status", "suggested"))), "the suggestion to be rejected");
  await page.getByRole("button", { name: /Find ledger matches/ }).click();
  await settle();
  created.push("the books' FiberLink entry offered to February's first charge, not its second");
}

async function ensureLoan() {
  if (await count("acc_repayment_account", (q) => q.eq("kind", "loan"))) return;
  await open("/banking/rules");
  await page.getByRole("button", { name: /Add loan/ }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Add loan" });
  await pick(dialog.getByLabel("Loan account"), "2500");
  await dialog.getByLabel("Words your bank prints for these payments").fill("first national loan");
  await pickIfEmpty(dialog.getByLabel("Interest posts to"), "8100");
  await dialog.getByText("A rate a year").click();
  await dialog.getByLabel("Rate a year", { exact: true }).fill("9");
  await dialog.getByRole("button", { name: "Add loan" }).click();
  await dialog.waitFor({ state: "hidden" });
  created.push("First National's term loan on Banking › Rules");
}

/**
 * A bank feed on the card, from Plaid's test service: its lines are Plaid's sample
 * data. Only the deployed app has Plaid set up, so this runs against it; the
 * feed is left connected, so Undo and Disconnect stay there to be pictured again.
 */
/** Plaid's test credit card that has transactions (named "Plaid Diamond 12.5% APR Interest Credit Card" in 11/2026). */
const PLAID_TEST_CARD_MASK = "3333";

async function ensureFeed() {
  const active = async () => {
    const { data, error } = await books
      .from("acc_bank_feed_account")
      .select("bank_account_id,account_name,account_mask")
      .eq("is_active", true)
      .limit(1);
    if (error) throw new Error(error.message);
    return data?.[0] ?? null;
  };
  // A feed on another of Plaid's test cards (the business one has no transactions) is disconnected, with the reason, and connected again.
  const wrong = await active();
  if (wrong && wrong.account_mask !== PLAID_TEST_CARD_MASK) {
    await open(`/banking?account=${wrong.bank_account_id}`);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    const dialog = page.getByRole("dialog").last();
    await dialog.locator("textarea").fill("Connected to Plaid's business test card, which has no transactions; connected again to its everyday test card.");
    await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
    await until(async () => !(await active()), "the business test card to be disconnected");
    created.push(`${wrong.account_name} disconnected`);
  }
  const feeds = [await active()].filter(Boolean);
  if (feeds?.[0]) {
    ids.feed = feeds[0].bank_account_id;
    await ensureFeedSynced();
    return;
  }
  await open(`/banking?account=${ids.card}`);
  const connect = page.getByRole("button", { name: /Connect bank/ });
  if (await connect.isDisabled()) throw new Error("Connect bank is off here: run against the deployed app, where Plaid's test service is set up");
  // Pressed before Plaid's script has loaded, it only says to try again in a moment.
  const frame = page.locator('iframe[id^="plaid-link-iframe"]');
  for (let attempt = 0; attempt < 4; attempt++) {
    await connect.click();
    if (await frame.first().waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) break;
  }
  const plaid = page.frameLocator('iframe[id^="plaid-link-iframe"]');
  const mapping = page.getByRole("dialog").filter({ hasText: "Connect and synchronize" });
  const visible = async (locator) => locator.first().isVisible().catch(() => false);
  // Plaid's own screens, in whatever order its test service shows them.
  let loggedIn = false;
  for (let step = 0; step < 30 && !(await visible(mapping)); step++) {
    await page.waitForTimeout(1_500);
    if (failuresDir) await page.screenshot({ path: join(failuresDir, `plaid-${String(step).padStart(2, "0")}.png`) }).catch(() => undefined);
    // Plaid's test bank takes user_good / pass_good; its fields are named by floating labels.
    const username = plaid.getByRole("textbox", { name: /user ?name/i });
    if (!loggedIn && (await visible(username))) {
      await username.first().fill("user_good");
      await plaid.locator('input[type="password"]').first().fill("pass_good");
      await plaid.getByRole("button", { name: /^Submit$/i }).first().click();
      // Its pane stays in the page, hidden, after the bank has let the test user in.
      loggedIn = true;
      continue;
    }
    // A phone number, to log in faster or to save the connection to a Plaid account: never.
    const skip = plaid.getByRole("button", { name: /without phone|without saving|as a guest|as guest|not now|skip/i });
    if (await visible(skip)) {
      console.log(`  plaid: ${await skip.first().innerText().catch(() => "?")}`);
      await skip.first().click({ force: true });
      continue;
    }
    // Searched for, first: a tile of popular banks can sit under Plaid's own "Sandbox mode" banner.
    // Each of the bank's choosing steps is taken once: a pane left behind can still read as visible.
    const search = plaid.locator('input[type="search"], input[placeholder*="Search" i]');
    if (!loggedIn && (await visible(search)) && !(await search.first().inputValue().catch(() => "x"))) {
      await search.first().fill("First Platypus");
      continue;
    }
    // A search result reads "First Platypus Bank · Multiple available".
    const result = plaid.getByText("Multiple available", { exact: true });
    if (!loggedIn && (await visible(result))) {
      await result.first().click();
      continue;
    }
    // Then the bank itself, not its OAuth variants, in its list of associated institutions.
    const bank = plaid.getByRole("button", { name: /First Platypus Bank$/ });
    if (!loggedIn && (await visible(plaid.getByText(/associated institutions/))) && (await visible(bank))) {
      await bank.first().click();
      continue;
    }
    const next = plaid.getByRole("button", { name: /^(Continue|Get started|Agree and continue|I agree|Done|Finish)$/i });
    if (await visible(next)) {
      console.log(`  plaid: ${await next.first().innerText().catch(() => "?")}`);
      await next.first().click({ force: true });
    }
  }
  await mapping.waitFor({ timeout: 10_000 });
  // Known by its last four digits: Plaid renames its test accounts from time to time.
  const card = mapping
    .locator("div")
    .filter({ has: page.locator("strong", { hasText: new RegExp(`${PLAID_TEST_CARD_MASK}$`) }) })
    .filter({ has: page.locator(".ant-select") })
    .last();
  await pick(card.locator(".ant-select").first(), "2050");
  await mapping.getByRole("button", { name: "Connect and synchronize" }).click();
  ids.feed = await until(async () => {
    const { data } = await books.from("acc_bank_feed_account").select("bank_account_id").eq("is_active", true).limit(1);
    return data?.[0]?.bank_account_id ?? null;
  }, "the bank feed to be connected", 120_000);
  created.push("a Plaid test-service feed on the credit card");
  await ensureFeedSynced();
}

/** A sync that brought lines in, so Bank feed syncs lists it with Undo. Plaid's test service can take a while to have them. */
async function ensureFeedSynced() {
  const brought = () => count("acc_bank_feed_sync_run", (q) => q.eq("status", "succeeded").gt("added_count", 0).is("undone_at", null));
  if (await brought()) return;
  for (let attempt = 0; attempt < 5 && !(await brought()); attempt++) {
    await open(`/banking?account=${ids.feed}`);
    await page.getByRole("button", { name: /Sync now/ }).click();
    await settle();
    if (!(await brought())) await page.waitForTimeout(20_000);
  }
  if (!(await brought())) throw new Error("Plaid's test service sent no lines for the card");
  created.push("its lines synced");
}

async function ensureBanking() {
  await ensureBankAccounts();
  await ensureCheckingJanuary();
  ids.february = await ensureReconciliation(
    "checking",
    "2026-02-28",
    statementCsv(CHECKING_FEBRUARY).closing,
    CHECKING_FEBRUARY,
    "checking-2026-02.csv",
  );
  await ensureCheckingMarch();
  await ensureCodedSubscription();
  await ensureSecondChargeFree();
  await ensureLoan();
  ids.savingsMarch = await ensureReconciliation(
    "savings",
    "2026-03-31",
    statementCsv(SAVINGS_MARCH).closing,
    SAVINGS_MARCH,
    "savings-2026-03.csv",
  );
  // Started by hand from the card's January statement, which is not attached yet.
  ids.cardJanuary = await ensureReconciliation("card", "2026-01-31", 4160, null, null);
  await ensureFeed();
}

// --- Banking: a balance posted as payments, made and removed for three pictures --
// Three entries whose amounts are what Checking itself came to on their dates:
// a statement's Balance column read as amounts. Reconcile flags them, and the
// account reads below zero; once pictured, they are removed with the card's own
// button, which reverses each on its date.

const GHOST = "Statement balance carried forward";
const GHOST_DATES = ["2026-02-27", "2026-03-13", "2026-03-31"];

async function checkingThrough(date) {
  const { data: gl } = await books.from("acc_account").select("id").eq("account_code", BANK_ACCOUNTS.checking.code).single();
  const { data, error } = await books
    .from("acc_journal_line")
    .select("debit_minor,credit_minor,acc_journal_entry!inner(entry_date,status)")
    .eq("account_id", gl.id)
    .eq("acc_journal_entry.status", "posted")
    .lte("acc_journal_entry.entry_date", date);
  if (error) throw new Error(error.message);
  return data.reduce((sum, line) => sum + line.debit_minor - line.credit_minor, 0);
}

async function ghostCardShowing() {
  await open(`/banking/reconcile?account=${ids.checking}`);
  return page
    .getByRole("button", { name: "Show me the workings" })
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

async function ghostEntryNumbers() {
  const { data, error } = await books.from("acc_journal_entry").select("entry_number").eq("description", GHOST);
  if (error) throw new Error(error.message);
  return (data ?? []).map((entry) => entry.entry_number);
}

/** Takes entries back by number with the Journal's own Reverse, each on its own date. */
async function reverseEntries(numbers, reason) {
  for (const number of numbers) {
    const { data: entry, error } = await books.from("acc_journal_entry").select("id").eq("entry_number", number).single();
    if (error) throw new Error(`${number}: ${error.message}`);
    await open(`/journal?entry=${entry.id}`);
    await page.getByRole("row").filter({ hasText: number }).first().getByRole("button", { name: "Reverse", exact: true }).click();
    const confirm = page.locator(".ant-modal-confirm").filter({ hasText: `Reverse ${number}?` });
    await confirm.getByPlaceholder("Reason for reversal").fill(reason);
    await confirm.getByRole("button", { name: "Reverse", exact: true }).click();
    await confirm.waitFor({ state: "hidden", timeout: 60_000 });
    created.push(`${number} taken back`);
  }
}

async function ensureGhostGroup() {
  if (await ghostCardShowing()) return;
  const before = new Set(await ghostEntryNumbers());
  // The journal entry dialog is filled at the width it was built for, whatever the picture's.
  const size = page.viewportSize();
  await page.setViewportSize(VIEWPORT);
  try {
    // Each amount is the balance of everything else, so it is read before any of the three is posted.
    const amounts = [];
    for (const date of GHOST_DATES) amounts.push(await checkingThrough(date));
    for (const [index, date] of GHOST_DATES.entries()) {
      const amount = (amounts[index] / 100).toFixed(2);
      await open("/journal");
      await page.getByRole("button", { name: /New journal entry/ }).first().click();
      const dialog = page.getByRole("dialog").filter({ hasText: "New journal entry" });
      await typeDate(dialog.getByLabel("Date", { exact: true }), date);
      await dialog.getByLabel("Description").fill(GHOST);
      const accounts = dialog.locator(".ant-select");
      await pick(accounts.nth(0), "6990");
      await dialog.getByPlaceholder("Debit").nth(0).fill(amount);
      await pick(accounts.nth(1), "1010");
      await dialog.getByPlaceholder("Credit").nth(1).fill(amount);
      await dialog.getByRole("button", { name: "OK" }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    if (!(await ghostCardShowing())) throw new Error("Reconcile did not flag the balance posted as payments");
  } catch (error) {
    // Never left part-way: whatever of the three was posted is taken back before the failure is reported.
    const posted = (await ghostEntryNumbers()).filter((number) => !before.has(number));
    await reverseEntries(posted, "Posted part-way while setting up the guide's pictures; taken back.");
    throw error;
  } finally {
    await page.setViewportSize(size);
  }
  created.push(`three entries of Checking's balance posted as payments (to be removed)`);
}

async function removeGhostGroup() {
  if (!(await ghostCardShowing())) return;
  // Not anchored: an Ant Design button's name begins with its icon's.
  await page.getByRole("button", { name: /Remove these \d+ entries/ }).click();
  await page.getByLabel("Reason for removing these entries").fill("A statement's Balance column was read as payments; set up and removed for the guide's pictures.");
  await page.getByRole("button", { name: /Confirm — remove all/ }).click();
  await page.getByRole("button", { name: "Show me the workings" }).waitFor({ state: "hidden", timeout: 60_000 });
  created.push("…and removed again with Remove these entries");
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

/**
 * A narrower window, for a screen whose cards and rows span the page: framed at
 * 1280 they come out too wide to read at 640. At 1024 the same card is 768 wide.
 */
const NARROW = { width: 1024, height: VIEWPORT.height };

async function capture(recipe) {
  // `narrow: true` is 1024 wide; a number is a width of its own, for a table that wraps its words at 1024.
  const viewport = recipe.narrow ? (typeof recipe.narrow === "number" ? { ...NARROW, width: recipe.narrow } : NARROW) : VIEWPORT;
  await page.setViewportSize(viewport);
  try {
    await captureIn(recipe, viewport);
  } finally {
    if (recipe.narrow) await page.setViewportSize(VIEWPORT);
  }
}

async function captureIn(recipe, viewport) {
  // Banking's routes name an account or a reconciliation, known once ensureBanking has run.
  await open(typeof recipe.route === "function" ? recipe.route() : recipe.route);
  if (recipe.prepare) await recipe.prepare();
  const target = recipe.target().first();
  await target.waitFor({ state: "visible" });
  // A control near the foot of the window is brought to its middle, so the frame can reach below it.
  if (recipe.center) await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  else await target.scrollIntoViewIfNeeded();
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
        right: Math.min(viewport.width, Math.round(inside.x + inside.width)),
        top: Math.max(0, Math.round(inside.y)),
        bottom: Math.min(viewport.height, Math.round(inside.y + inside.height)),
      }
    : { right: viewport.width, ...recipe.frame };
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
// `shot` names the picture; tests/unit/guide-pictures-321.test.ts holds the list
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

  // Bring bank lines in
  {
    shot: "bank-lines-in-1",
    route: () => `/banking?account=${ids.checking}`,
    target: () => button(/Import statement/),
  },
  {
    shot: "bank-lines-in-2",
    within: () => page.getByRole("dialog").last(),
    route: () => `/banking?account=${ids.checking}`,
    prepare: async () => {
      await readStatement(button(/Import statement/).first(), statementFile("checking-2026-04.csv", CHECKING_APRIL));
    },
    target: () => page.getByRole("dialog").last().locator(".ant-alert-success"),
    frame: { height: 300 },
    after: async () => page.keyboard.press("Escape"),
  },
  {
    shot: "bank-lines-in-3",
    within: () => page.getByRole("dialog").last(),
    route: () => `/banking?account=${ids.checking}`,
    prepare: async () => {
      await readStatement(button(/Import statement/).first(), statementFile("checking-2026-04.csv", CHECKING_APRIL));
    },
    target: () => page.getByRole("dialog").last().getByRole("checkbox", { name: /^Not a transaction/ }),
    include: () => [page.getByRole("dialog").last().getByRole("columnheader", { name: "Not a transaction" })],
    frame: { height: 300 },
    after: async () => page.keyboard.press("Escape"),
  },
  {
    shot: "bank-lines-in-4",
    within: () => page.getByRole("dialog").last(),
    route: () => `/banking?account=${ids.checking}`,
    prepare: async () => {
      // The rent line left out of the file while its balance stays: out by $4,200.00.
      await readStatement(button(/Import statement/).first(), statementFile("checking-2026-04.csv", CHECKING_APRIL, { leaveOut: 1 }));
    },
    target: () => page.getByRole("dialog").last().getByRole("button", { name: "Import anyway…" }),
    include: () => [page.getByRole("dialog").last().locator(".ant-alert-error")],
    frame: { height: 300 },
    after: async () => page.keyboard.press("Escape"),
  },
  {
    shot: "bank-lines-in-5",
    route: () => `/banking?account=${ids.feed}`,
    // The newest sync that changed something; a sync that only skipped lines offers no Undo.
    target: () => page.getByRole("button", { name: "Undo", exact: true, disabled: false }),
    include: () => [page.getByText("Bank feed syncs", { exact: true })],
    narrow: true,
  },
  {
    shot: "bank-lines-in-6",
    route: () => `/banking?account=${ids.feed}`,
    target: () => button("Disconnect"),
    include: () => [page.getByText("First Platypus Bank", { exact: true })],
  },

  // Match and code bank lines
  {
    shot: "code-and-match-1",
    route: () => `/banking?account=${ids.checking}`,
    target: () => button("Approve"),
    include: () => [page.getByRole("columnheader", { name: "Match" })],
  },
  {
    shot: "code-and-match-2",
    route: () => `/banking?account=${ids.checking}`,
    target: () => page.getByRole("row").filter({ hasText: "OFFICE DEPOT" }).locator(".ant-select"),
    // The line's own description, rather than the column's heading far above it.
    include: () => [page.getByText("OFFICE DEPOT #1123", { exact: true })],
  },
  {
    shot: "code-and-match-3",
    route: () => `/banking?account=${ids.checking}`,
    prepare: async () => {
      // Coded lines are matched, so the status filter has to let them show.
      await page.getByLabel("Search bank transactions by description or reference").fill("ADOBE");
      await page.getByLabel("Filter bank transactions by status").click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: /^All/ }).first().click();
      await settle();
    },
    target: () => button("Recode"),
    include: () => [
      page.getByRole("row").filter({ has: page.getByRole("button", { name: "Recode" }) }).first().getByText("ADOBE *CREATIVE CLOUD", { exact: true }),
    ],
  },
  {
    shot: "code-and-match-4",
    route: "/banking/overview",
    prepare: async () => {
      await page.locator(".ant-segmented-item").filter({ hasText: "Possible duplicates" }).click();
      await settle();
    },
    target: () => page.locator(".ant-segmented-item").filter({ hasText: "Possible duplicates" }),
    include: () => [page.getByText(/^Charged twice in/)],
  },

  // Set up cards, loans and related companies
  { shot: "cards-loans-companies-1", route: "/banking/rules", target: () => button(/Add card/) },
  {
    shot: "cards-loans-companies-2",
    route: () => `/banking?account=${ids.checking}`,
    target: () => button("Split…"),
    include: () => [
      page.getByRole("row").filter({ has: page.getByRole("button", { name: "Split…" }) }).first().getByText("FIRST NATIONAL LOAN PMT", { exact: true }),
    ],
  },
  { shot: "cards-loans-companies-3", route: "/banking/rules", target: () => button(/Add related company/) },

  // Reconcile an account to a statement
  {
    shot: "reconcile-by-hand-1",
    route: () => `/banking/reconcile?account=${ids.checking}`,
    target: () => page.locator('[aria-label="Reconciliation standing"]'),
    include: () => [page.getByLabel("Bank account", { exact: true })],
    narrow: true,
  },
  {
    shot: "reconcile-by-hand-2",
    route: () => `/banking/reconcile?account=${ids.checking}`,
    target: () => button(/New reconciliation/),
  },
  {
    shot: "reconcile-by-hand-3",
    route: () => `/banking/reconcile/${ids.february}`,
    target: () => page.getByText("Left to explain", { exact: true }),
    include: () => [page.locator(".ant-alert-warning").filter({ hasText: "Left to explain" })],
    narrow: true,
  },
  {
    shot: "reconcile-by-hand-4",
    route: () => `/banking/reconcile/${ids.february}`,
    target: () => page.getByRole("row").filter({ hasText: "MONTHLY SERVICE FEE" }).getByRole("button", { name: "Not a transaction" }),
    // Its amount and "Not in the books" beside it: the whole row is too wide to read at 640.
    include: () => [
      page.getByRole("row").filter({ has: page.getByRole("button", { name: "Not a transaction" }) }).filter({ hasText: "MONTHLY SERVICE FEE" }).getByText("Not in the books"),
    ],
    center: true,
  },
  {
    shot: "reconcile-by-hand-5",
    route: () => `/banking/reconcile/${ids.february}`,
    // The fee's account chosen in the box, as a reader would, so the button counts it; nothing is posted.
    prepare: async () => {
      const box = page.locator(".ant-alert").filter({ hasText: /The bank shows \d+ things? your books do not/ });
      await pick(box.getByRole("row").filter({ hasText: "MONTHLY SERVICE FEE" }).locator(".ant-select").first(), "bank", /6400/);
      await page.mouse.move(VIEWPORT.width / 2, 8);
    },
    target: () => button(/^Add \d+ to the books$/),
    include: () => [page.getByText(/^The bank shows \d+ things? your books do not/)],
    frame: { height: 320 },
    // At 1024 its Description column wraps a word a letter at a time.
    narrow: 1180,
  },
  {
    shot: "reconcile-by-hand-6",
    route: () => `/banking/reconcile/${ids.february}`,
    // The second FiberLink charge's account chosen, so Add anyway is offered; nothing is posted.
    prepare: async () => {
      const box = page.locator(".ant-alert").filter({ hasText: /The bank shows \d+ things? your books do not/ });
      await pick(box.locator("li").filter({ hasText: "FIBERLINK" }).locator(".ant-select").first(), "internet", /6120/);
      await page.mouse.move(VIEWPORT.width / 2, 8);
    },
    target: () => button("Add anyway"),
    include: () => [page.getByText("Held back from Add all:")],
    narrow: true,
  },
  {
    shot: "reconcile-by-hand-7",
    route: () => `/banking/reconcile/${ids.february}`,
    target: () => button("Discard this reconciliation"),
  },
  {
    shot: "reconcile-by-hand-8",
    route: () => `/banking/reconcile/${ids.february}`,
    target: () => page.getByRole("link", { name: "View", exact: true }),
    include: () => [page.getByText(/^Statement file/)],
  },
  {
    shot: "reconcile-by-hand-9",
    route: () => `/banking/reconcile/${ids.cardJanuary}`,
    target: () => button("Attach the statement"),
    include: () => [page.getByText("No statement file")],
  },

  // Reconcile from statement files
  {
    shot: "reconcile-from-files-1",
    route: () => `/banking/reconcile?account=${ids.checking}`,
    target: () => button(/From statement files/),
  },
  {
    shot: "reconcile-from-files-2",
    route: () => `/banking/reconcile/${ids.savingsMarch}`,
    target: () => button("Bring the history forward"),
    include: () => [page.locator(".ant-alert-info").filter({ has: page.getByRole("button", { name: "Bring the history forward" }) })],
    narrow: true,
  },
  {
    shot: "reconcile-from-files-3",
    route: () => `/banking/reconcile?account=${ids.checking}`,
    target: () => page.getByRole("link", { name: "Reconcile history" }),
  },

  // Check and correct reconciled accounts: the first three need a balance posted as payments
  {
    shot: "check-reconciliations-1",
    route: () => `/banking/reconcile?account=${ids.checking}`,
    prepare: async () => {
      await ensureGhostGroup();
      await page.getByRole("button", { name: "Show me the workings" }).waitFor();
    },
    target: () => button(/Show me the workings/),
    include: () => [page.getByText(/entries here look like the statement's balance/)],
    frame: { height: 320 },
    narrow: true,
  },
  {
    shot: "check-reconciliations-2",
    route: () => `/banking/reconcile?account=${ids.checking}`,
    prepare: async () => {
      await ensureGhostGroup();
      await page.getByRole("button", { name: /Remove these \d+ entries/ }).waitFor();
    },
    target: () => button(/Remove these \d+ entries/),
    include: () => [page.getByText(/entries here look like the statement's balance/)],
    frame: { height: 320 },
    narrow: true,
  },
  {
    shot: "check-reconciliations-3",
    route: () => `/banking/reconcile?account=${ids.checking}`,
    prepare: async () => {
      await ensureGhostGroup();
      await page.getByText(/payments not yet on a statement/).waitFor();
    },
    target: () => page.getByText(/payments not yet on a statement/),
    include: () => [page.getByText(/reads below zero/)],
    frame: { height: 360 },
    narrow: true,
    after: removeGhostGroup,
  },
  {
    shot: "check-reconciliations-4",
    route: () => `/banking/reconcile/${ids.january}`,
    target: () => button("Reopen"),
  },
  {
    shot: "check-reconciliations-5",
    route: "/reports/reconciliations",
    target: () => heading("Reconciliation Report"),
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
    target: () => page.locator(".assistant-launcher").getByRole("button", { name: /Ask Abacus/ }),
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
  const wanted = (recipe) => !only.size || only.has(recipe.shot.replace(/-\d+$/, "")) || only.has(recipe.shot);
  const bankingWanted = RECIPES.some((recipe) => wanted(recipe) && BANKING_GUIDES.has(recipe.shot.replace(/-\d+$/, "")));
  if (bankingWanted) {
    try {
      await ensureBanking();
    } catch (error) {
      problems.push(`ensureBanking: ${error.message.split("\n")[0]}`);
      await keepFailure("ensureBanking");
    }
  }
  for (const recipe of RECIPES) {
    if (!wanted(recipe)) continue;
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
  // Whatever stopped a run part-way, Checking is not left with a balance posted as payments.
  if (bankingWanted && ids.checking) {
    await removeGhostGroup().catch(async (error) => {
      problems.push(`removeGhostGroup: ${error.message.split("\n")[0]}`);
      await keepFailure("removeGhostGroup");
    });
  }
} finally {
  await browser.close();
}
for (const line of created) console.log(`  made  ${line}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exitCode = 1;
}
