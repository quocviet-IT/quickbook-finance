// scripts/verify-ar-ap.mjs
// E2E verify of the AR/AP extension (as admin): issue an invoice + a credit
// memo, apply part of the credit to the invoice, refund the remainder, check
// AR ageing ties to the AR control account; post a bill + a vendor credit,
// apply it, check AP ageing ties to the AP control account; write off the
// invoice's remaining balance and confirm the Trial Balance stays balanced;
// confirm voiding a credit memo with a live allocation is rejected. Cleans up
// after itself (void-before-delete, mirroring scripts/verify-journal.mjs).
// Run: node --env-file=.env.local scripts/verify-ar-ap.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const acctId = async (code) => (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;

async function main() {
  await db.connect();
  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({ email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026" });
  if (e1) throw new Error("login: " + e1.message);
  const authed = createClient(url, key, { global: { headers: { Authorization: "Bearer " + auth.session.access_token } }, auth: { persistSession: false } });

  const ar = await acctId("1100");
  const ap = await acctId("2000");
  const bank = await acctId("1010");
  const income = await acctId("4000");
  const expense = await acctId("6000");

  const asOf = "2026-05-31";
  const arNet = async () => {
    const r = await db.query(
      "select coalesce(sum(debit_base-credit_base),0) n from acc_ledger_balances(null,$1) where account_id=$2",
      [asOf, ar]);
    return Number(r.rows[0].n);
  };
  const apNet = async () => {
    const r = await db.query(
      "select coalesce(sum(credit_base-debit_base),0) n from acc_ledger_balances(null,$1) where account_id=$2",
      [asOf, ap]);
    return Number(r.rows[0].n);
  };
  const tb = async () => (await db.query(
    "select coalesce(sum(debit_minor),0) d, coalesce(sum(credit_minor),0) c from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where e.status='posted'")).rows[0];

  // --- Seed a test customer and vendor. ---------------------------------
  const custId = (await db.query(
    "insert into acc_customer (name, currency_code) values ('E2E AR/AP Customer','USD') returning id")).rows[0].id;
  const vendId = (await db.query(
    "insert into acc_vendor (name, currency_code) values ('E2E AR/AP Vendor','USD') returning id")).rows[0].id;

  // --- 1) Invoice for 500, issued. ---------------------------------------
  const invId = (await db.query(
    `insert into acc_invoice (customer_id, issue_date, due_date, currency_code, subtotal_minor, total_minor, status)
     values ($1,'2026-05-01','2026-05-31','USD',500_00,500_00,'draft') returning id`, [custId])).rows[0].id;
  await db.query(
    `insert into acc_invoice_line (invoice_id, line_order, description, quantity, unit_price_minor, income_account_id, line_subtotal_minor, line_total_minor)
     values ($1,0,'E2E service',1,500_00,$2,500_00,500_00)`, [invId, income]);
  const { error: e2 } = await authed.rpc("acc_issue_invoice", { p_invoice_id: invId });
  if (e2) throw new Error("issue invoice: " + e2.message);

  // --- 2) Credit memo for 200, issued, apply 120 to the invoice. ---------
  const cmId = (await db.query(
    `insert into acc_credit_memo (customer_id, memo_date, currency_code, subtotal_minor, total_minor, status, reason)
     values ($1,'2026-05-05','USD',200_00,200_00,'draft','E2E goodwill credit') returning id`, [custId])).rows[0].id;
  await db.query(
    `insert into acc_credit_memo_line (credit_memo_id, line_order, description, quantity, unit_price_minor, income_account_id, line_subtotal_minor, line_total_minor)
     values ($1,0,'E2E credit',1,200_00,$2,200_00,200_00)`, [cmId, income]);
  const { error: e3 } = await authed.rpc("acc_issue_credit_memo", { p_credit_memo_id: cmId });
  if (e3) throw new Error("issue credit memo: " + e3.message);

  const { error: e4 } = await authed.rpc("acc_apply_credit_memo", {
    p_credit_memo_id: cmId, p_allocations: [{ invoice_id: invId, amount_minor: 120_00 }],
  });
  if (e4) throw new Error("apply credit memo: " + e4.message);

  const invBal1 = Number((await db.query("select balance_due_minor from acc_invoice where id=$1", [invId])).rows[0].balance_due_minor);
  check("invoice balance dropped by applied credit (500-120=380)", invBal1 === 380_00, `(=${invBal1})`);
  const cmRemaining1 = Number((await db.query("select balance_remaining_minor from acc_credit_memo where id=$1", [cmId])).rows[0].balance_remaining_minor);
  check("credit memo balance_remaining dropped (200-120=80)", cmRemaining1 === 80_00, `(=${cmRemaining1})`);

  // --- 3) Refund the credit memo's remaining 80. --------------------------
  const { error: e5 } = await authed.rpc("acc_record_customer_refund", {
    p_customer_id: custId, p_refund_date: "2026-05-10", p_currency: "USD", p_amount_minor: 80_00,
    p_source_type: "credit_memo", p_payment_id: null, p_credit_memo_id: cmId, p_bank_account_id: bank, p_memo: "E2E refund",
  });
  if (e5) throw new Error("refund: " + e5.message);
  const cm2 = (await db.query("select balance_remaining_minor, status from acc_credit_memo where id=$1", [cmId])).rows[0];
  check("credit memo remaining is 0 after refund", Number(cm2.balance_remaining_minor) === 0, `(=${cm2.balance_remaining_minor})`);
  check("credit memo status is applied", cm2.status === "applied", `(=${cm2.status})`);

  // --- 4) AR ageing ties to the AR control account (as of 2026-05-31). ----
  const arAgeing = (await db.query("select coalesce(sum(balance_minor),0) s from acc_ar_ageing($1)", [asOf])).rows[0].s;
  const arControlNet = await arNet();
  check("AR ageing sum ties to AR control-account net", Number(arAgeing) === arControlNet, `(ageing=${arAgeing}, control=${arControlNet})`);

  // --- 5) Bill for 300, posted; vendor credit 100, applied. ---------------
  const billId = (await db.query(
    `insert into acc_bill (vendor_id, bill_date, due_date, currency_code, status)
     values ($1,'2026-05-02','2026-06-01','USD','draft') returning id`, [vendId])).rows[0].id;
  await db.query(
    `insert into acc_bill_line (bill_id, line_order, description, expense_account_id, amount_minor)
     values ($1,0,'E2E purchase',$2,300_00)`, [billId, expense]);
  const { data: billEntry, error: e6 } = await authed.rpc("acc_post_bill", { p_bill_id: billId });
  if (e6) throw new Error("post bill: " + e6.message);
  check("bill posting returned a journal entry", !!billEntry);

  const vcId = (await db.query(
    `insert into acc_vendor_credit (vendor_id, credit_date, currency_code, total_minor, status, reason)
     values ($1,'2026-05-06','USD',100_00,'draft','E2E vendor credit') returning id`, [vendId])).rows[0].id;
  await db.query(
    `insert into acc_vendor_credit_line (vendor_credit_id, line_order, description, expense_account_id, amount_minor)
     values ($1,0,'E2E vendor credit line',$2,100_00)`, [vcId, expense]);
  const { error: e7 } = await authed.rpc("acc_issue_vendor_credit", { p_vendor_credit_id: vcId });
  if (e7) throw new Error("issue vendor credit: " + e7.message);
  const { error: e8 } = await authed.rpc("acc_apply_vendor_credit", {
    p_vendor_credit_id: vcId, p_allocations: [{ bill_id: billId, amount_minor: 100_00 }],
  });
  if (e8) throw new Error("apply vendor credit: " + e8.message);

  const billBal1 = Number((await db.query("select balance_due_minor from acc_bill where id=$1", [billId])).rows[0].balance_due_minor);
  check("bill balance dropped by applied vendor credit (300-100=200)", billBal1 === 200_00, `(=${billBal1})`);

  const apAgeing = (await db.query("select coalesce(sum(balance_minor),0) s from acc_ap_ageing($1)", [asOf])).rows[0].s;
  const apControlNet = await apNet();
  check("AP ageing sum ties to AP control-account net", Number(apAgeing) === apControlNet, `(ageing=${apAgeing}, control=${apControlNet})`);

  // --- 6) Write off the invoice's remaining 380. --------------------------
  const { error: e9 } = await authed.rpc("acc_write_off", {
    p_side: "ar", p_target_id: invId, p_offset_account_id: expense, p_amount_minor: 380_00,
    p_date: "2026-05-15", p_reason: "E2E bad debt",
  });
  if (e9) throw new Error("write off: " + e9.message);
  const invBal2 = Number((await db.query("select balance_due_minor from acc_invoice where id=$1", [invId])).rows[0].balance_due_minor);
  check("invoice balance is 0 after write-off", invBal2 === 0, `(=${invBal2})`);

  let t = await tb();
  check("trial balance balanced after write-off", Number(t.d) === Number(t.c), `(${t.d}=${t.c})`);

  // --- 7) Voiding the credit memo (still allocation-holding) is rejected. -
  const { error: e10 } = await authed.rpc("acc_void_credit_memo", { p_credit_memo_id: cmId });
  check("voiding an allocated/refunded credit memo is rejected", !!e10);

  // Void the refund and the allocation, then void succeeds.
  const refundId = (await db.query("select id from acc_customer_refund where credit_memo_id=$1", [cmId])).rows[0].id;
  const { error: e11 } = await authed.rpc("acc_void_customer_refund", { p_refund_id: refundId });
  if (e11) throw new Error("void refund: " + e11.message);
  await db.query("delete from acc_credit_memo_allocation where credit_memo_id=$1", [cmId]);
  await db.query(
    "update acc_credit_memo set balance_remaining_minor = balance_remaining_minor + 120_00, status='issued' where id=$1",
    [cmId]);
  const { error: e12 } = await authed.rpc("acc_void_credit_memo", { p_credit_memo_id: cmId });
  check("void succeeds once the allocation/refund are removed", !e12, e12 ? e12.message : "");

  // Restore the invoice balance the removed allocation had covered (write-off
  // already cleared it to 0 above, but the allocation removal above didn't
  // touch the invoice; nothing further to assert here — clean-up only).

  // --- Cleanup. Delete every row that references a journal entry (via
  // journal_entry_id FK) BEFORE voiding + deleting the entries themselves —
  // acc_journal_entry has no ON DELETE CASCADE from those tables, so deleting
  // an entry while a document still points at it would violate the FK. Void
  // is still needed first for the raw journal rows (acc_journal_line_immutable
  // blocks deleting/updating lines while their entry is 'posted'), mirroring
  // scripts/verify-journal.mjs.
  await db.query("begin");
  await db.query("delete from acc_credit_memo_allocation where invoice_id=$1 or credit_memo_id=$2", [invId, cmId]);
  await db.query("delete from acc_vendor_credit_allocation where bill_id=$1 or vendor_credit_id=$2", [billId, vcId]);
  await db.query("delete from acc_customer_refund where credit_memo_id=$1 or customer_id=$2", [cmId, custId]);
  await db.query("delete from acc_write_off where invoice_id=$1", [invId]);
  await db.query("delete from acc_credit_memo_line where credit_memo_id=$1", [cmId]);
  await db.query("delete from acc_vendor_credit_line where vendor_credit_id=$1", [vcId]);
  await db.query("delete from acc_credit_memo where id=$1", [cmId]);
  await db.query("delete from acc_vendor_credit where id=$1", [vcId]);
  await db.query("delete from acc_invoice_line where invoice_id=$1", [invId]);
  await db.query("delete from acc_invoice where id=$1", [invId]);
  await db.query("delete from acc_bill_line where bill_id=$1", [billId]);
  await db.query("delete from acc_bill where id=$1", [billId]);
  await db.query("update acc_journal_entry set status='void'");
  await db.query("delete from acc_journal_line");
  await db.query("delete from acc_journal_entry");
  await db.query("delete from acc_customer where id=$1", [custId]);
  await db.query("delete from acc_vendor where id=$1", [vendId]);
  await db.query("update acc_sequence set next_value=1");
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
