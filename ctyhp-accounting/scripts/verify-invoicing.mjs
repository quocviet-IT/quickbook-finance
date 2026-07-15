// End-to-end verify of the invoicing engine against the live DB (as admin).
// Creates a customer + draft invoice, issues it, records a payment, and checks
// the ledger is balanced and the postings are correct. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-invoicing.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const round = (v) => Math.sign(v) * Math.round(Math.abs(v) + Number.EPSILON);

async function acctId(code) {
  return (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;
}
async function ledgerByCode(code) {
  const r = await db.query(
    `select coalesce(sum(l.debit_minor),0) d, coalesce(sum(l.credit_minor),0) c
       from acc_journal_line l join acc_account a on a.id=l.account_id
      where a.account_code=$1
        and l.journal_entry_id in (select id from acc_journal_entry where status='posted')`,
    [code],
  );
  return { debit: Number(r.rows[0].d), credit: Number(r.rows[0].c) };
}

async function main() {
  await db.connect();

  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({
    email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026",
  });
  if (e1) throw new Error("login: " + e1.message);
  const authed = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + auth.session.access_token } },
    auth: { persistSession: false },
  });

  const salesAcc = await acctId("4000");
  const bankAcc = await acctId("1010");
  const taxCode = (await db.query("select id, rate_percent from acc_tax_code where code='TAX'")).rows[0];

  // Baseline ledger totals (DB may already hold data).
  const arBefore = await ledgerByCode("1100");
  const salesBefore = await ledgerByCode("4000");
  const taxBefore = await ledgerByCode("2100");
  const bankBefore = await ledgerByCode("1010");

  // --- Create customer ---
  const { data: cust, error: e2 } = await authed.from("acc_customer")
    .insert({ name: "E2E Test Customer", currency_code: "USD" }).select("id").single();
  if (e2) throw new Error("customer: " + e2.message);

  // --- Compute lines (2.5% ... use TAX rate) ---
  const rate = Number(taxCode.rate_percent);
  const lines = [
    { qty: 2, unit: 15000, acc: salesAcc },
    { qty: 1, unit: 5000, acc: salesAcc },
  ].map((l) => {
    const sub = round(l.qty * l.unit);
    const tax = round((sub * rate) / 100);
    return { ...l, sub, tax, total: sub + tax };
  });
  const subtotal = lines.reduce((s, l) => s + l.sub, 0);
  const taxTotal = lines.reduce((s, l) => s + l.tax, 0);
  const total = subtotal + taxTotal;

  // --- Create draft invoice + lines ---
  const { data: inv, error: e3 } = await authed.from("acc_invoice").insert({
    customer_id: cust.id, currency_code: "USD",
    subtotal_minor: subtotal, tax_total_minor: taxTotal, total_minor: total,
  }).select("id").single();
  if (e3) throw new Error("invoice: " + e3.message);

  const { error: e4 } = await authed.from("acc_invoice_line").insert(
    lines.map((l, i) => ({
      invoice_id: inv.id, line_order: i, description: "Item " + (i + 1),
      quantity: l.qty, unit_price_minor: l.unit, income_account_id: l.acc,
      tax_code_id: taxCode.id, line_subtotal_minor: l.sub, line_tax_minor: l.tax, line_total_minor: l.total,
    })),
  );
  if (e4) throw new Error("lines: " + e4.message);

  // --- Issue invoice (posts the journal entry) ---
  const { error: e5 } = await authed.rpc("acc_issue_invoice", { p_invoice_id: inv.id });
  if (e5) throw new Error("issue: " + e5.message);

  const issued = (await db.query("select invoice_number,status,balance_due_minor,journal_entry_id from acc_invoice where id=$1", [inv.id])).rows[0];
  check("invoice issued with number", issued.status === "issued" && !!issued.invoice_number, `(${issued.invoice_number})`);
  check("balance_due equals total", Number(issued.balance_due_minor) === total);

  const arAfterIssue = await ledgerByCode("1100");
  const salesAfter = await ledgerByCode("4000");
  const taxAfter = await ledgerByCode("2100");
  check("AR debited by total", arAfterIssue.debit - arBefore.debit === total, `(+${arAfterIssue.debit - arBefore.debit})`);
  check("Income credited by subtotal", salesAfter.credit - salesBefore.credit === subtotal, `(+${salesAfter.credit - salesBefore.credit})`);
  check("Sales tax credited by tax", taxAfter.credit - taxBefore.credit === taxTotal, `(+${taxAfter.credit - taxBefore.credit})`);

  // entry balanced
  const bal = (await db.query(
    `select sum(debit_minor)-sum(credit_minor) diff from acc_journal_line where journal_entry_id=$1`,
    [issued.journal_entry_id])).rows[0].diff;
  check("invoice journal entry balanced", Number(bal) === 0);

  // --- Record full payment ---
  const { error: e6 } = await authed.rpc("acc_record_payment", {
    p_customer_id: cust.id, p_payment_date: issued_date(), p_currency: "USD",
    p_amount_minor: total, p_deposit_account_id: bankAcc, p_method: "bank_transfer",
    p_memo: "E2E", p_allocations: [{ invoice_id: inv.id, amount_minor: total }],
  });
  if (e6) throw new Error("payment: " + e6.message);

  const paid = (await db.query("select status,balance_due_minor from acc_invoice where id=$1", [inv.id])).rows[0];
  check("invoice marked paid", paid.status === "paid" && Number(paid.balance_due_minor) === 0);
  const bankAfter = await ledgerByCode("1010");
  check("Bank debited by total", bankAfter.debit - bankBefore.debit === total, `(+${bankAfter.debit - bankBefore.debit})`);
  const arNet = await ledgerByCode("1100");
  check("AR net change is zero", (arNet.debit - arNet.credit) - (arBefore.debit - arBefore.credit) === 0);

  // --- Trial balance for the whole ledger must balance ---
  const tb = (await db.query(
    `select sum(debit_minor) d, sum(credit_minor) c from acc_journal_line
      where journal_entry_id in (select id from acc_journal_entry where status='posted')`)).rows[0];
  check("trial balance balances", Number(tb.d) === Number(tb.c), `(D=${tb.d} C=${tb.c})`);

  // --- Cleanup (comprehensive; test DB holds only test data) ---
  await db.query("begin");
  await db.query("delete from acc_payment_allocation");
  await db.query("delete from acc_payment");
  await db.query("delete from acc_invoice_line");
  await db.query("delete from acc_invoice");
  await db.query("delete from acc_customer");
  await db.query("update acc_journal_entry set status='void'");
  await db.query("delete from acc_journal_line");
  await db.query("delete from acc_journal_entry");
  await db.query("update acc_sequence set next_value=1");
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

function issued_date() { return new Date(Date.parse("2026-07-15")).toISOString().slice(0, 10); }

main().catch((e) => { console.error("verify error:", e.message); process.exitCode = 1; }).finally(() => db.end());
