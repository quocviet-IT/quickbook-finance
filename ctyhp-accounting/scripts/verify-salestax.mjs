// End-to-end verify of the Sales Tax Center (as admin): issue a taxed invoice,
// check tax shows as collected, record a remittance, check the payable balance
// drops, then void it and confirm restore. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-salestax.mjs
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
async function payableBalance(to) {
  return Number((await db.query("select acc_sales_tax_payable_balance($1) b", [to])).rows[0].b);
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

  const income = await acctId("4000");
  const bank = await acctId("1010");
  const taxPayable = await acctId("2100");
  const tax = (await db.query("select id, rate_percent from acc_tax_code where code='TAX'")).rows[0];
  const rate = Number(tax.rate_percent);
  const sub = 100_00;
  const taxMinor = Math.round((sub * rate) / 100);

  const balBefore = await payableBalance("2100-12-31");

  // Issue a taxed invoice
  const { data: cust, error: ec } = await authed.from("acc_customer").insert({ name: "E2E Tax Cust", currency_code: "USD" }).select("id").single();
  if (ec) throw new Error("customer: " + ec.message);
  const { data: inv, error: e2 } = await authed.from("acc_invoice").insert({
    customer_id: cust.id, currency_code: "USD",
    subtotal_minor: sub, tax_total_minor: taxMinor, total_minor: sub + taxMinor, balance_due_minor: sub + taxMinor,
  }).select("id,issue_date").single();
  if (e2) throw new Error("invoice: " + e2.message);
  const { error: e3 } = await authed.from("acc_invoice_line").insert({
    invoice_id: inv.id, line_order: 0, description: "E2E", quantity: 1, unit_price_minor: sub,
    income_account_id: income, tax_code_id: tax.id, line_subtotal_minor: sub, line_tax_minor: taxMinor, line_total_minor: sub + taxMinor,
  });
  if (e3) throw new Error("line: " + e3.message);
  const { error: e4 } = await authed.rpc("acc_issue_invoice", { p_invoice_id: inv.id });
  if (e4) throw new Error("issue: " + e4.message);

  // Collected shows in the period
  const { data: collected, error: e5 } = await authed.rpc("acc_sales_tax_collected", { p_from: inv.issue_date, p_to: inv.issue_date });
  if (e5) throw new Error("collected: " + e5.message);
  const taxRow = (collected ?? []).find((r) => r.code === "TAX");
  check("tax collected reported for TAX", !!taxRow && Number(taxRow.tax_minor) >= taxMinor, `(+${taxRow ? taxRow.tax_minor : 0})`);

  const balAfterIssue = await payableBalance("2100-12-31");
  check("payable balance rose by tax", balAfterIssue - balBefore === taxMinor, `(+${balAfterIssue - balBefore})`);

  // Record a remittance for the tax
  const { data: payId, error: e6 } = await authed.rpc("acc_record_tax_payment", {
    p_tax_account_id: taxPayable, p_bank_account_id: bank, p_payment_date: "2026-07-31",
    p_currency: "USD", p_amount_minor: taxMinor, p_period_start: null, p_period_end: null, p_memo: "E2E",
  });
  if (e6) throw new Error("record payment: " + e6.message);
  const balAfterPay = await payableBalance("2100-12-31");
  check("payable balance dropped after remittance", balAfterPay === balBefore, `(=${balAfterPay})`);

  // Void the remittance -> restored
  const { error: e7 } = await authed.rpc("acc_void_tax_payment", { p_payment_id: payId });
  if (e7) throw new Error("void: " + e7.message);
  const balAfterVoid = await payableBalance("2100-12-31");
  check("payable balance restored after void", balAfterVoid === balAfterIssue, `(=${balAfterVoid})`);

  // Cleanup
  await db.query("begin");
  await db.query("delete from acc_tax_payment");
  await db.query("delete from acc_invoice_line where invoice_id=$1", [inv.id]);
  await db.query("delete from acc_invoice where id=$1", [inv.id]);
  await db.query("delete from acc_customer where id=$1", [cust.id]);
  await db.query("update acc_journal_entry set status='void'");
  await db.query("delete from acc_journal_line");
  await db.query("delete from acc_journal_entry");
  await db.query("update acc_sequence set next_value=1");
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  const inner = (e.errors || []).map((x) => `${x.code} ${x.address}:${x.port}`).join(", ");
  console.error("verify error:", parts || "(no message)", inner ? `| ${inner}` : "");
  process.exitCode = 1;
}).finally(() => db.end());
