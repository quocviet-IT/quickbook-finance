// End-to-end verify of the payables (Accounts Payable) engine against the live
// DB (as admin). Creates a vendor + draft bill, posts it, pays it, records an
// expense, voids the bill payment, and checks the ledger stays balanced and the
// postings are correct. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-payables.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };

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
async function entryBalanced(entryId) {
  const r = await db.query(
    `select coalesce(sum(debit_minor),0)-coalesce(sum(credit_minor),0) diff
       from acc_journal_line where journal_entry_id=$1`, [entryId]);
  return Number(r.rows[0].diff) === 0;
}
async function trialBalances() {
  const r = await db.query(
    `select coalesce(sum(debit_minor),0) d, coalesce(sum(credit_minor),0) c from acc_journal_line
      where journal_entry_id in (select id from acc_journal_entry where status='posted')`);
  return { d: Number(r.rows[0].d), c: Number(r.rows[0].c) };
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

  const apAcc = await acctId("2000");      // Accounts Payable
  const expAcc = await acctId("6000");     // Operating Expenses
  const bankAcc = await acctId("1010");    // Operating Bank Account

  const apBefore = await ledgerByCode("2000");
  const expBefore = await ledgerByCode("6000");
  const bankBefore = await ledgerByCode("1010");

  // --- Create vendor ---
  const { data: vend, error: e2 } = await authed.from("acc_vendor")
    .insert({ name: "E2E Test Vendor", currency_code: "USD" }).select("id").single();
  if (e2) throw new Error("vendor: " + e2.message);

  // --- Create draft bill + lines (tax-inclusive amounts; US model) ---
  const billLines = [
    { desc: "Rent", acc: expAcc, amount: 10000 },
    { desc: "Utilities", acc: expAcc, amount: 4000 },
  ];
  const billTotal = billLines.reduce((s, l) => s + l.amount, 0); // 14000

  const { data: bill, error: e3 } = await authed.from("acc_bill").insert({
    vendor_id: vend.id, currency_code: "USD", total_minor: billTotal, balance_due_minor: billTotal,
  }).select("id").single();
  if (e3) throw new Error("bill: " + e3.message);

  const { error: e4 } = await authed.from("acc_bill_line").insert(
    billLines.map((l, i) => ({
      bill_id: bill.id, line_order: i, description: l.desc,
      expense_account_id: l.acc, amount_minor: l.amount,
    })),
  );
  if (e4) throw new Error("bill lines: " + e4.message);

  // --- Post the bill (posts DR expense / CR AP) ---
  const { error: e5 } = await authed.rpc("acc_post_bill", { p_bill_id: bill.id });
  if (e5) throw new Error("post bill: " + e5.message);

  const posted = (await db.query(
    "select bill_number,status,balance_due_minor,total_minor,journal_entry_id from acc_bill where id=$1",
    [bill.id])).rows[0];
  check("bill posted with number", posted.status === "open" && !!posted.bill_number, `(${posted.bill_number})`);
  check("bill balance_due equals total", Number(posted.balance_due_minor) === billTotal);

  const apAfterPost = await ledgerByCode("2000");
  const expAfterPost = await ledgerByCode("6000");
  check("AP credited by bill total", apAfterPost.credit - apBefore.credit === billTotal, `(+${apAfterPost.credit - apBefore.credit})`);
  check("Expense debited by bill total", expAfterPost.debit - expBefore.debit === billTotal, `(+${expAfterPost.debit - expBefore.debit})`);
  check("bill journal entry balanced", await entryBalanced(posted.journal_entry_id));

  // --- Pay the bill in full from the bank account ---
  const { error: e6 } = await authed.rpc("acc_pay_bills", {
    p_vendor_id: vend.id, p_payment_date: "2026-07-20", p_currency: "USD",
    p_amount_minor: billTotal, p_payment_account_id: bankAcc, p_method: "bank_transfer",
    p_memo: "E2E", p_allocations: [{ bill_id: bill.id, amount_minor: billTotal }],
  });
  if (e6) throw new Error("pay bills: " + e6.message);

  const paid = (await db.query("select status,balance_due_minor from acc_bill where id=$1", [bill.id])).rows[0];
  check("bill marked paid", paid.status === "paid" && Number(paid.balance_due_minor) === 0);
  const bankAfterPay = await ledgerByCode("1010");
  check("Bank credited by bill total", bankAfterPay.credit - bankBefore.credit === billTotal, `(+${bankAfterPay.credit - bankBefore.credit})`);
  const apAfterPay = await ledgerByCode("2000");
  check("AP net change zero after pay", (apAfterPay.debit - apAfterPay.credit) - (apBefore.debit - apBefore.credit) === 0);

  // --- Void the bill payment (should restore the bill balance) ---
  const payId = (await db.query("select id from acc_bill_payment order by created_at desc limit 1")).rows[0].id;
  const { error: e7 } = await authed.rpc("acc_void_bill_payment", { p_payment_id: payId });
  if (e7) throw new Error("void bill payment: " + e7.message);
  const restored = (await db.query("select status,balance_due_minor from acc_bill where id=$1", [bill.id])).rows[0];
  check("bill restored to open after void", restored.status === "open" && Number(restored.balance_due_minor) === billTotal);
  const apAfterVoid = await ledgerByCode("2000");
  check("AP net change back to bill total after void", (apAfterVoid.credit - apAfterVoid.debit) - (apBefore.credit - apBefore.debit) === billTotal);

  // --- Record an immediate expense from the bank account ---
  const expenseAmount = 2500;
  const { error: e8 } = await authed.rpc("acc_record_expense", {
    p_vendor_id: vend.id, p_payment_account_id: bankAcc, p_expense_date: "2026-07-21",
    p_currency: "USD", p_memo: "E2E expense",
    p_lines: [{ expense_account_id: expAcc, amount_minor: expenseAmount, description: "Supplies" }],
  });
  if (e8) throw new Error("record expense: " + e8.message);
  const expEntry = (await db.query(
    "select journal_entry_id from acc_expense order by created_at desc limit 1")).rows[0].journal_entry_id;
  check("expense journal entry balanced", await entryBalanced(expEntry));
  const expAfterExp = await ledgerByCode("6000");
  check("Expense debited by expense amount", expAfterExp.debit - expAfterPost.debit === expenseAmount, `(+${expAfterExp.debit - expAfterPost.debit})`);

  // --- Whole-ledger trial balance must still balance ---
  const tb = await trialBalances();
  check("trial balance balances", tb.d === tb.c, `(D=${tb.d} C=${tb.c})`);

  // --- Cleanup (comprehensive; test DB holds only test data) ---
  await db.query("begin");
  await db.query("delete from acc_bill_payment_allocation");
  await db.query("delete from acc_bill_payment");
  await db.query("delete from acc_bill_line");
  await db.query("delete from acc_bill");
  await db.query("delete from acc_expense_line");
  await db.query("delete from acc_expense");
  await db.query("delete from acc_vendor");
  await db.query("update acc_journal_entry set status='void'");
  await db.query("delete from acc_journal_line");
  await db.query("delete from acc_journal_entry");
  await db.query("update acc_sequence set next_value=1");
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error("verify error:", e.message); process.exitCode = 1; }).finally(() => db.end());
