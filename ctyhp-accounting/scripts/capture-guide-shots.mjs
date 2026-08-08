/**
 * Capture the pictures the system guide shows for the import flow.
 *
 * Two rules govern this script, and both are about what must never end up in a
 * committed PNG:
 *
 *   * it refuses to run against a company that is not marked `is_sample`, so a
 *     screenshot can never carry a customer's account names or balances;
 *   * the ledger it imports is generated here from that sample company's own
 *     chart, so no real export is ever opened.
 *
 * It drives the built server the smoke sweep drives, signing in the same way.
 *
 * Run:
 *   npm run build && npm start           # in one shell
 *   npm run guide:shots                  # in another
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { smokeSession } from "./smoke-environment.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(projectRoot, "public", "guide");
/** The name the generated ledger is uploaded under, and how its litter is found. */
const GUIDE_FILE_NAME = "wave-account-transactions.csv";

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
  return cookies.map((c) => ({ ...c, domain, path: "/", httpOnly: false, secure: false }));
}

/**
 * A sample company and four of its posting accounts.
 *
 * Refusing anything but a sample is the whole safety story of this script: a
 * screenshot keeps whatever was on the screen, and these books hold a real
 * customer's bank history.
 */
async function sampleCompany(admin) {
  const { data, error } = await admin
    .schema("onebook")
    .from("company")
    .select("slug,schema_name,legal_name,is_sample,status")
    .eq("is_sample", true)
    .eq("status", "active")
    .order("display_order")
    .limit(1);
  if (error) throw new Error(`company register unavailable: ${error.message}`);
  const company = data?.[0];
  if (!company) throw new Error("no active sample company to capture against");
  if (!company.is_sample) throw new Error("refusing to capture against real books");
  return company;
}

async function chartAccounts(admin, schema) {
  const pick = async (types) => {
    const { data, error } = await admin
      .schema(schema)
      .from("acc_account")
      .select("account_code,name,account_type")
      .in("account_type", types)
      .eq("is_posting_account", true)
      .eq("status", "active")
      .order("account_code")
      .limit(1);
    if (error) throw new Error(`chart unavailable: ${error.message}`);
    return data?.[0] ?? null;
  };
  const bank = await pick(["bank"]);
  const expense = await pick(["expense"]);
  const income = await pick(["income"]);
  if (!bank || !expense || !income) throw new Error("the sample chart lacks a bank/expense/income account");
  return { bank, expense, income };
}

/**
 * A tiny Account Transactions report in Wave's own layout.
 *
 * `stamp` varies the amounts so each run is a different file. One Book refuses
 * a file it has already imported, and a second run would otherwise photograph
 * that refusal instead of the screen it is meant to show.
 */
function ledgerCsv({ bank, expense, income }, ghost, stamp) {
  const first = ghost ?? bank.name;
  const big = `$${(4000 + stamp).toLocaleString("en-US")}.00`;
  const small = `$${100 + (stamp % 90)}.00`;
  return [
    "ACCOUNT NUMBER,DATE,DESCRIPTION,DEBIT (In Business Currency),CREDIT (In Business Currency),BALANCE (In Business Currency)",
    `${first},,,,,`,
    `,1/4/2026,Opening float,"${big}",,"${big}"`,
    `,1/9/2026,Card terminal fee,,${small},"${big}"`,
    `Totals and Ending Balance,,,"${big}",${small},"${big}"`,
    ",,,,,",
    `,${income.name},,,,`,
    "Starting Balance,,,,,$0.00",
    `,1/4/2026,Opening float,,"${big}","${big}"`,
    `Totals and Ending Balance,,,$0.00,"${big}","${big}"`,
    ",,,,,",
    `,${expense.name},,,,`,
    "Starting Balance,,,,,$0.00",
    `,1/9/2026,Card terminal fee,${small},,${small}`,
    `Totals and Ending Balance,,,${small},$0.00,${small}`,
    "",
  ].join("\r\n");
}

/** A name no chart has, used to photograph the pre-flight doing its job. */
const UNKNOWN_ACCOUNT = "Courier & Freight (not in this chart)";

/** A categorized export: every row names both sides, which is what this tab needs. */
function transactionsCsv(bank, { expense, income }, stamp) {
  const big = (4000 + stamp).toFixed(2);
  const small = (100 + (stamp % 90)).toFixed(2);
  return [
    "Date,Description,Bank account,Chart of account,Amount",
    `1/4/2026,Opening float,${bank.name},${income.name},${big}`,
    `1/9/2026,Card terminal fee,${bank.name},${expense.name},-${small}`,
    `1/9/2026,Fee waived,${bank.name},${expense.name},0.00`,
    // One name this chart does not have, so the pre-flight has something real
    // to show. It is answered through the picker further down, which is both
    // the picture worth taking and a rehearsal of the path it documents.
    `1/12/2026,Courier charge,${bank.name},${UNKNOWN_ACCOUNT},-${small}`,
    "",
  ].join("\r\n");
}

/** antd's Segmented hides its radio input; the label is what a person clicks. */
async function chooseLedgerTab(page) {
  await page.locator(".ant-segmented-item", { hasText: "General ledger" }).first().click();
  await page.locator(".ant-upload-drag").first().waitFor({ timeout: 10_000 });
}

async function chooseTransactionsTab(page) {
  await page.locator(".ant-segmented-item", { hasText: "Transactions" }).first().click();
  await page.getByRole("button", { name: "Choose a CSV file" }).waitFor({ timeout: 10_000 });
}

/** Hide the floating launcher; a style tag does not survive a navigation. */
async function hideChrome(page) {
  await page.addStyleTag({ content: ".assistant-launcher { display: none !important; }" });
}

/**
 * Remove what earlier runs of THIS script left in the sample company.
 *
 * One Book never hard-deletes a saved report, and that rule is about a
 * company's records. This is screenshot litter in a sample company, written by
 * this file and recognised by its file name — leaving it behind would put three
 * identical rows in a picture meant to teach.
 */
async function clearGuideLitter(admin, schema) {
  const { data, error } = await admin
    .schema(schema)
    .from("acc_saved_report")
    .select("id,storage_path")
    .eq("file_name", GUIDE_FILE_NAME);
  if (error) throw new Error(`could not read saved reports: ${error.message}`);
  if (!data?.length) return 0;
  await admin.storage.from("onebook-reports").remove(data.map((row) => row.storage_path));
  // A batch points at the copy it kept, and the foreign key is right to stop a
  // delete. Let the batch go on saying an import happened, without the file.
  const ids = data.map((row) => row.id);
  const { error: unlinkError } = await admin
    .schema(schema)
    .from("acc_import_batch")
    .update({ saved_report_id: null })
    .in("saved_report_id", ids);
  if (unlinkError) throw new Error(`could not unlink old shots: ${unlinkError.message}`);
  const { error: removeError } = await admin
    .schema(schema)
    .from("acc_saved_report")
    .delete()
    .in("id", ids);
  if (removeError) throw new Error(`could not clear old shots: ${removeError.message}`);
  return data.length;
}

/**
 * Make sure the sample company has one bank account on the Banking screen.
 *
 * Without it the transactions tab can only ever show its refusal — the bank
 * line is what stops a second import posting twice, so a file cannot be
 * imported without one. This is setup, not litter: it is created once, only in
 * a sample company, and left in place.
 */
async function ensureSampleBankAccount(admin, schema) {
  const { data: existing } = await admin
    .schema(schema)
    .from("acc_bank_account")
    .select("account_id, acc_account!inner(id,name)")
    .limit(1);
  if (existing?.length) {
    const linked = existing[0].acc_account;
    return { id: linked.id, name: linked.name, created: false };
  }

  const { data: accounts, error } = await admin
    .schema(schema)
    .from("acc_account")
    .select("id,account_code,name")
    .eq("account_type", "bank")
    .eq("is_posting_account", true)
    .eq("status", "active")
    .order("account_code");
  if (error) throw new Error(`chart unavailable: ${error.message}`);
  if (!accounts?.length) throw new Error("the sample company has no bank account in its chart");

  // Not every bank-type account may be linked: the database refuses Cash on
  // Hand, because physical cash is not a bank balance. Take the first the
  // database actually accepts rather than assuming which that is.
  const refusals = [];
  for (const account of accounts) {
    const { error: insertError } = await admin
      .schema(schema)
      .from("acc_bank_account")
      .insert({
        account_id: account.id,
        bank_name: account.name,
        account_number_masked: "0000",
        currency_code: "USD",
      });
    if (!insertError) return { ...account, created: true };
    refusals.push(`${account.name}: ${insertError.message.slice(0, 60)}`);
  }
  throw new Error(`could not set up banking — ${refusals.join(" | ")}`);
}

async function savedReportCount(admin, schema) {
  const { count, error } = await admin
    .schema(schema)
    .from("acc_saved_report")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`saved reports unreadable: ${error.message}`);
  return count ?? 0;
}

/** Poll until true, or fail with a message that says what did not happen. */
async function waitFor(condition, complaint, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(complaint);
}

const shots = [];
async function shoot(target, name, note) {
  mkdirSync(outDir, { recursive: true });
  await target.screenshot({ path: join(outDir, name), scale: "css" });
  shots.push(name);
  console.log(`  shot  ${name}${note ? ` — ${note}` : ""}`);
}

const { session, user, supabaseUrl } = await smokeSession();
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const company = await sampleCompany(admin);
const accounts = await chartAccounts(admin, company.schema_name);
console.log(`Capturing against ${company.legal_name} (sample), accounts:`,
  [accounts.bank.name, accounts.income.name, accounts.expense.name].join(" / "));

/** Varies the file between runs; the second is a different import, not a repeat. */
const stamp = Number(process.env.GUIDE_SHOT_STAMP ?? `${Date.now() % 900}`);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const domain = new URL(base).hostname;
await context.addCookies([
  ...sessionCookies(session, user, supabaseUrl, domain),
  { name: "onebook-company", value: company.slug, domain, path: "/" },
]);

const cleared = await clearGuideLitter(admin, company.schema_name);
if (cleared) console.log(`  clean  removed ${cleared} saved report(s) from an earlier run`);

const page = await context.newPage();
// The floating Report / Ask AI launcher sits over the bottom-right of every
// screen and would cover a figure in half these shots.
await page.addStyleTag({ content: ".assistant-launcher { display: none !important; }" }).catch(
  () => undefined,
);
try {
  await page.goto(`${base}/settings/import`, { waitUntil: "networkidle" });
  await hideChrome(page);
  await chooseLedgerTab(page);
  await page.waitForTimeout(400);

  const tabs = page.locator(".ant-segmented").first();
  await shoot(tabs, "import-01-tab.png", "the tab strip");

  const dropArea = page.locator(".ant-upload-drag").first();
  await shoot(dropArea, "import-02-empty.png", "the drop area");

  // The refusal first, so the clean run is not polluted by a reload.
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({
    name: GUIDE_FILE_NAME,
    mimeType: "text/csv",
    buffer: Buffer.from(
      ledgerCsv(accounts, "Account This Chart Does Not Have", stamp),
      "utf8",
    ),
  });
  // The ledger tab now offers the same picker the transactions tab does, so the
  // picture is of the table that answers the problem, not only of the refusal.
  await page.getByText("do not name one account").waitFor({ timeout: 15_000 });
  await shoot(
    page.locator(".ant-table-wrapper").filter({ hasText: "Name in the file" }).first(),
    "import-04-blocked.png",
    "a name the chart does not have, and the way to answer it",
  );

  await page.reload({ waitUntil: "networkidle" });
  await hideChrome(page);
  await chooseLedgerTab(page);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: GUIDE_FILE_NAME,
    mimeType: "text/csv",
    buffer: Buffer.from(ledgerCsv(accounts, null, stamp), "utf8"),
  });
  await page.getByText("Total debits").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);

  const preview = page.locator(".ant-card").filter({ hasText: "Total debits" }).first();
  await shoot(preview, "import-03-preview.png", "what the file holds");

  const modeCard = page.locator(".ant-card").filter({ hasText: "What to bring across" }).first();
  await modeCard.scrollIntoViewIfNeeded();
  // The button stays shut until the database has answered which accounts are
  // missing. A picture of a greyed-out button would teach the wrong thing.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").trim().startsWith("Import "),
    );
    return Boolean(button) && !button.disabled;
  }, null, { timeout: 15_000 });
  // antd fades a button in as it enables; a shot taken on the same tick catches
  // it mid-transition and looks disabled.
  await page.waitForTimeout(600);
  await shoot(modeCard, "import-05-mode.png", "the two modes");

  const before = await savedReportCount(admin, company.schema_name);
  await page.getByRole("button", { name: /^Import / }).click();
  await page.getByText(/entries and .* lines posted into/).waitFor({ timeout: 30_000 });

  // The copy of the original is saved after the ledger posts. Navigating away
  // while that upload is in flight cancels it — which is exactly what the first
  // version of this script did, and it photographed an empty Saved Reports.
  await waitFor(
    async () => (await savedReportCount(admin, company.schema_name)) > before,
    "the original file was not kept under Saved Reports",
  );
  await page.waitForTimeout(1200);
  const batchCard = page.locator(".ant-card").filter({ hasText: "Ledgers imported before" }).first();
  await batchCard.scrollIntoViewIfNeeded();
  await shoot(batchCard, "import-06-batches.png", "what was imported, and Undo");

  await page.goto(`${base}/reports/saved`, { waitUntil: "networkidle" });
  await hideChrome(page);
  await page.waitForTimeout(800);
  await shoot(page.locator(".ant-card").first(), "import-07-saved.png", "the file, kept as it arrived");

  // ---- The transactions tab -------------------------------------------------
  // The file must name the account Banking actually holds — the chart's first
  // bank account is Cash on Hand, which the database refuses to link because
  // physical cash is not a bank balance.
  const bankAccount = await ensureSampleBankAccount(admin, company.schema_name);
  if (bankAccount.created) console.log(`  setup  linked ${bankAccount.name} under Banking`);

  await page.goto(`${base}/settings/import`, { waitUntil: "networkidle" });
  await hideChrome(page);
  await chooseTransactionsTab(page);
  await page.waitForTimeout(500);

  const beforeYouStart = page.locator(".ant-alert").filter({ hasText: "Before you start" }).first();
  await shoot(beforeYouStart, "txn-01-before.png", "what has to exist first");

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "transactions.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(transactionsCsv(bankAccount, accounts, stamp), "utf8"),
  });
  // ---- The pre-flight, before a column is agreed ----------------------------
  const preflight = page.locator(".ant-card").filter({ hasText: "What this file needs" }).first();
  await preflight.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await preflight.scrollIntoViewIfNeeded();
  await shoot(preflight, "txn-02-preflight.png", "what this company is missing");

  // Answer it the way the screen intends: point the name at an account that
  // exists. If that stops working the picture becomes a lie, so it is done here
  // rather than described.
  await preflight.locator(".ant-select").first().click();
  await page.keyboard.type(accounts.expense.name.slice(0, 12));
  await page.waitForTimeout(800);
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").first().click();
  await preflight
    .getByText("Every account this file names already exists")
    .waitFor({ timeout: 30_000 });
  console.log("  check  the pre-flight cleared once the name was pointed at an account");

  // The pre-flight now says "Agree the columns below" too, so be precise.
  await page.locator(".ant-steps-item-title", { hasText: "Agree the columns" }).first()
    .waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);

  const columns = page.locator(".ant-table-wrapper").filter({ hasText: "Column in your file" }).first();
  await columns.scrollIntoViewIfNeeded();
  await shoot(columns, "txn-03-columns.png", "the columns One Book proposed");

  await page.getByRole("button", { name: "See what will happen" }).click();
  await page.getByText("Rows carrying no money").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  const figures = page.locator(".import-preview__figures").first();
  await shoot(figures, "txn-04-preview.png", "what the file will do");

  const emptyNote = page
    .locator(".ant-alert")
    .filter({ hasText: "carry no money" })
    .first();
  await shoot(emptyNote, "txn-05-empty.png", "rows with nothing in them");

  // Import for real, so the register can be photographed holding something.
  // Undone a few lines below, through the control the picture is of.
  await page.getByRole("button", { name: /^Import / }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByText(/created/).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);

  const register = page
    .locator(".ant-table")
    .filter({ hasText: "transactions.csv" })
    .first();
  await register.scrollIntoViewIfNeeded();
  await shoot(register, "txn-06-record.png", "the import, and the way back out");

  // Undo it through the real control, both to prove the button in the picture
  // works and so the sample company does not collect an import per run.
  await register.getByRole("button", { name: "Undo" }).first().click();
  await page.getByPlaceholder("Imported against the wrong chart of accounts").fill(
    "Captured for the system guide",
  );
  await page.getByRole("button", { name: "Undo the import" }).click();
  await page.getByText(/entries voided/).waitFor({ timeout: 30_000 });
  console.log("  undo   the captured transactions import was rolled back out");
  await page.waitForTimeout(1000);

  // ---- Undo through the real control, so the sample company does not collect
  // a ledger for every run of this script.
  await page.goto(`${base}/settings/import`, { waitUntil: "networkidle" });
  await hideChrome(page);
  await chooseLedgerTab(page);
  await page.getByRole("button", { name: "Undo" }).first().click();
  await page.getByPlaceholder("Imported against the wrong chart of accounts").fill(
    "Captured for the system guide",
  );
  await page.getByRole("button", { name: "Undo the import" }).click();
  await page.getByText(/entries voided/).waitFor({ timeout: 30_000 });
  console.log("  undo   the captured import was rolled back out of the sample company");

  console.log(`\n${shots.length} shots written to public/guide/`);
} catch (error) {
  console.error(`\nFAILED: ${error.message}`);
  writeFileSync(join(outDir, "last-failure.html"), await page.content(), "utf8");
  process.exitCode = 1;
} finally {
  await browser.close();
}
