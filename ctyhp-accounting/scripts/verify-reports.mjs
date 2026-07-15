// Verify the reporting aggregation against live data: seed an invoice + full
// payment, call acc_ledger_balances, assert per-account base totals and that
// debits equal credits, then clean up.
// Run: node --env-file=.env.local scripts/verify-reports.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const round = (v) => Math.sign(v) * Math.round(Math.abs(v) + Number.EPSILON);

async function main() {
  await db.connect();
  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({ email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026" });
  if (e1) throw new Error("login: " + e1.message);
  const authed = createClient(url, key, { global: { headers: { Authorization: "Bearer " + auth.session.access_token } }, auth: { persistSession: false } });

  const acc = async (c) => (await db.query("select id from acc_account where account_code=$1", [c])).rows[0].id;
  const sales = await acc("4000"), bank = await acc("1010");
  const tax = (await db.query("select id, rate_percent from acc_tax_code where code='TAX'")).rows[0];

  const { data: cust } = await authed.from("acc_customer").insert({ name: "Reports Test", currency_code: "USD" }).select("id").single();
  const sub = round(2 * 15000) + round(1 * 5000); // 35000
  const taxAmt = round((30000 * Number(tax.rate_percent)) / 100) + round((5000 * Number(tax.rate_percent)) / 100);
  const total = sub + taxAmt;
  const { data: inv } = await authed.from("acc_invoice").insert({
    customer_id: cust.id, currency_code: "USD", subtotal_minor: sub, tax_total_minor: taxAmt, total_minor: total, balance_due_minor: total,
  }).select("id").single();
  await authed.from("acc_invoice_line").insert([
    { invoice_id: inv.id, line_order: 0, description: "A", quantity: 2, unit_price_minor: 15000, income_account_id: sales, tax_code_id: tax.id, line_subtotal_minor: 30000, line_tax_minor: round(30000 * Number(tax.rate_percent) / 100), line_total_minor: 30000 + round(30000 * Number(tax.rate_percent) / 100) },
    { invoice_id: inv.id, line_order: 1, description: "B", quantity: 1, unit_price_minor: 5000, income_account_id: sales, tax_code_id: tax.id, line_subtotal_minor: 5000, line_tax_minor: round(5000 * Number(tax.rate_percent) / 100), line_total_minor: 5000 + round(5000 * Number(tax.rate_percent) / 100) },
  ]);
  await authed.rpc("acc_issue_invoice", { p_invoice_id: inv.id });
  await authed.rpc("acc_record_payment", {
    p_customer_id: cust.id, p_payment_date: "2026-07-15", p_currency: "USD", p_amount_minor: total,
    p_deposit_account_id: bank, p_method: "cash", p_memo: null, p_allocations: [{ invoice_id: inv.id, amount_minor: total }],
  });

  // --- Reporting RPC (cumulative to date) ---
  const { data: bal, error: e2 } = await authed.rpc("acc_ledger_balances", { p_from: null, p_to: "2026-07-15" });
  if (e2) throw new Error("rpc: " + e2.message);
  const by = Object.fromEntries(bal.map((r) => [r.account_code, r]));
  check("bank debit_base = total", Number(by["1010"].debit_base) === total, `(${by["1010"].debit_base})`);
  check("income credit_base = subtotal", Number(by["4000"].credit_base) === sub, `(${by["4000"].credit_base})`);
  check("sales tax credit_base = tax", Number(by["2100"].credit_base) === taxAmt, `(${by["2100"].credit_base})`);
  check("AR nets to zero", Number(by["1100"].debit_base) - Number(by["1100"].credit_base) === 0);
  const totD = bal.reduce((s, r) => s + Number(r.debit_base), 0);
  const totC = bal.reduce((s, r) => s + Number(r.credit_base), 0);
  check("trial balance balances", totD === totC, `(D=${totD} C=${totC})`);

  // cleanup
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
main().catch((e) => { console.error("verify error:", e.message); process.exitCode = 1; }).finally(() => db.end());
