// scripts/verify-purchasing.mjs
// E2E verify of Module G1 — Purchase Orders, Receiving, Three-Way Matching (as admin):
// create a 2-line PO -> approve -> partially receive -> block over-receipt ->
// receive the rest -> convert to a draft bill -> post it and check DR expense /
// CR AP -> block an out-of-tolerance price with no reason -> allow it with a
// reason and record the exception -> void the bill and check qty_billed rolls
// back -> void a receipt and check qty_received rolls back -> short close and
// check no further receipt is accepted. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-purchasing.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { pass++; } else { fail++; } console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const acctId = async (code) => (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;
const num = (v) => Number(v);

async function poLines(poId) {
  const { rows } = await db.query(
    "select id, line_order, quantity, unit_cost_minor, qty_received, qty_billed, is_closed" +
      " from acc_purchase_order_line where purchase_order_id=$1 order by line_order",
    [poId],
  );
  return rows;
}
const poStatus = async (poId) =>
  (await db.query("select status from acc_purchase_order where id=$1", [poId])).rows[0].status;

async function main() {
  await db.connect();
  const { data: auth, error: eLogin } = await sb.auth.signInWithPassword({
    email: "admin@ctyhp.vn",
    password: "Ctyhp@Ketoan2026",
  });
  if (eLogin) throw new Error("login: " + eLogin.message);
  const authed = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + auth.session.access_token } },
    auth: { persistSession: false },
  });

  const expense = await acctId("5000");
  const ap = (await db.query(
    "select id from acc_account where account_type='accounts_payable' and is_posting_account and status='active' order by account_code limit 1",
  )).rows[0].id;

  // A vendor to buy from.
  const vendorId = (await db.query(
    "insert into acc_vendor (name, currency_code) values ('E2E Purchasing Vendor', 'USD') returning id",
  )).rows[0].id;

  // Known tolerances: 2% price, 0% quantity.
  const { error: eCfg } = await authed.rpc("acc_set_purchasing_config", {
    p_price_tolerance_bps: 200,
    p_qty_tolerance_bps: 0,
  });
  if (eCfg) throw new Error("set config: " + eCfg.message);

  // 1) Create a 2-line draft PO: 10 @ $12.50 and 4 @ $100.00.
  const { data: poId, error: e1 } = await authed.rpc("acc_save_purchase_order", {
    p_po_id: null,
    p_vendor_id: vendorId,
    p_order_date: "2026-07-01",
    p_expected_date: "2026-07-15",
    p_currency: "USD",
    p_ship_to: "Main warehouse",
    p_memo: "E2E purchasing",
    p_lines: [
      { description: "Widget", quantity: 10, unit_cost_minor: 1250, expense_account_id: expense },
      { description: "Gadget", quantity: 4, unit_cost_minor: 10000, expense_account_id: expense },
    ],
  });
  if (e1) throw new Error("save PO: " + e1.message);
  const poTotal = (await db.query("select total_minor from acc_purchase_order where id=$1", [poId])).rows[0].total_minor;
  check("PO total is recomputed server-side", num(poTotal) === 10 * 1250 + 4 * 10000, `(=${poTotal})`);
  check("new PO is a draft with no number", (await poStatus(poId)) === "draft");

  // A draft PO posts nothing to the ledger.
  const entriesForPo = (await db.query(
    "select count(*)::int c from acc_journal_entry where source_id=$1", [poId],
  )).rows[0].c;
  check("a purchase order posts no journal entry", entriesForPo === 0);

  // 2) Receiving before approval is rejected.
  let lines = await poLines(poId);
  const { error: eEarly } = await authed.rpc("acc_receive_purchase_order", {
    p_po_id: poId, p_receipt_date: "2026-07-05", p_memo: null,
    p_lines: [{ purchase_order_line_id: lines[0].id, quantity: 1 }],
  });
  check("receiving against a draft PO is rejected", !!eEarly);

  // 3) Approve: a number is assigned and the PO opens.
  const { data: poNumber, error: e3 } = await authed.rpc("acc_approve_purchase_order", { p_po_id: poId });
  if (e3) throw new Error("approve: " + e3.message);
  check("approve assigns a PO number", typeof poNumber === "string" && poNumber.startsWith("PO-"), `(=${poNumber})`);
  check("approved PO is open", (await poStatus(poId)) === "open");

  // 4) Partially receive line 1 (4 of 10).
  const { data: receipt1, error: e4 } = await authed.rpc("acc_receive_purchase_order", {
    p_po_id: poId, p_receipt_date: "2026-07-06", p_memo: "first shipment",
    p_lines: [{ purchase_order_line_id: lines[0].id, quantity: 4 }],
  });
  if (e4) throw new Error("receive #1: " + e4.message);
  lines = await poLines(poId);
  check("partial receipt updates qty_received", num(lines[0].qty_received) === 4, `(=${lines[0].qty_received})`);
  check("PO is partially received", (await poStatus(poId)) === "partial");

  // A receipt posts nothing in G1 (inventory postings are Module G2).
  const entriesForReceipt = (await db.query(
    "select count(*)::int c from acc_journal_entry where source_id=$1", [receipt1],
  )).rows[0].c;
  check("a goods receipt posts no journal entry in G1", entriesForReceipt === 0);

  // 5) Over-receipt is rejected (this is the duplicate-receipt guard).
  const { error: eOver } = await authed.rpc("acc_receive_purchase_order", {
    p_po_id: poId, p_receipt_date: "2026-07-07", p_memo: "too much",
    p_lines: [{ purchase_order_line_id: lines[0].id, quantity: 7 }],
  });
  check("over-receipt beyond the ordered quantity is rejected", !!eOver && /Over-receipt/i.test(eOver.message));
  lines = await poLines(poId);
  check("rejected receipt did not change qty_received", num(lines[0].qty_received) === 4);

  // Re-sending the same receipt again is rejected once the line is full.
  const { error: eRest } = await authed.rpc("acc_receive_purchase_order", {
    p_po_id: poId, p_receipt_date: "2026-07-08", p_memo: "second shipment",
    p_lines: [
      { purchase_order_line_id: lines[0].id, quantity: 6 },
      { purchase_order_line_id: lines[1].id, quantity: 4 },
    ],
  });
  if (eRest) throw new Error("receive #2: " + eRest.message);
  lines = await poLines(poId);
  check("remaining receipt fills both lines", num(lines[0].qty_received) === 10 && num(lines[1].qty_received) === 4);
  check("fully received PO is 'received'", (await poStatus(poId)) === "received");

  const { error: eDup } = await authed.rpc("acc_receive_purchase_order", {
    p_po_id: poId, p_receipt_date: "2026-07-08", p_memo: "duplicate of second shipment",
    p_lines: [{ purchase_order_line_id: lines[0].id, quantity: 6 }],
  });
  check("a duplicated receipt is rejected", !!eDup);

  // 6) Convert line 1 (10 @ 1250) to a draft bill at the ordered price.
  const { data: billId, error: e6 } = await authed.rpc("acc_create_bill_from_po", {
    p_po_id: poId, p_bill_date: "2026-07-10", p_due_date: "2026-08-09",
    p_vendor_ref: "VINV-1", p_memo: "E2E bill from PO",
    p_lines: [{ purchase_order_line_id: lines[0].id, quantity: 10, unit_cost_minor: 1250 }],
    p_variance_reason: null,
  });
  if (e6) throw new Error("bill from PO: " + e6.message);
  const bill = (await db.query(
    "select status, total_minor, purchase_order_id from acc_bill where id=$1", [billId],
  )).rows[0];
  check("conversion creates a draft bill linked to the PO", bill.status === "draft" && bill.purchase_order_id === poId);
  check("draft bill total is quantity x unit cost", num(bill.total_minor) === 10 * 1250, `(=${bill.total_minor})`);

  const billLine = (await db.query(
    "select purchase_order_line_id, quantity, unit_cost_minor, amount_minor from acc_bill_line where bill_id=$1", [billId],
  )).rows[0];
  check("bill line keeps PO traceability", billLine.purchase_order_line_id === lines[0].id);
  check("bill line carries quantity and unit cost", num(billLine.quantity) === 10 && num(billLine.unit_cost_minor) === 1250);
  lines = await poLines(poId);
  check("conversion updates qty_billed", num(lines[0].qty_billed) === 10, `(=${lines[0].qty_billed})`);

  // 7) Post the bill: DR expense 125.00 / CR AP 125.00.
  const { data: entryId, error: e7 } = await authed.rpc("acc_post_bill", { p_bill_id: billId });
  if (e7) throw new Error("post bill: " + e7.message);
  const jl = (await db.query(
    "select account_id, debit_minor, credit_minor from acc_journal_line where journal_entry_id=$1", [entryId],
  )).rows;
  const debit = jl.reduce((s, l) => s + num(l.debit_minor), 0);
  const credit = jl.reduce((s, l) => s + num(l.credit_minor), 0);
  check("posted entry is balanced", debit === credit && debit === 12500, `(dr=${debit} cr=${credit})`);
  check("expense account is debited", jl.some((l) => l.account_id === expense && num(l.debit_minor) === 12500));
  check("AP is credited", jl.some((l) => l.account_id === ap && num(l.credit_minor) === 12500));

  // 8) Billing line 2 at 10% over the ordered cost without a reason is rejected.
  const { error: eVar } = await authed.rpc("acc_create_bill_from_po", {
    p_po_id: poId, p_bill_date: "2026-07-11", p_due_date: null, p_vendor_ref: "VINV-2", p_memo: null,
    p_lines: [{ purchase_order_line_id: lines[1].id, quantity: 4, unit_cost_minor: 11000 }],
    p_variance_reason: null,
  });
  check("price variance outside tolerance with no reason is rejected", !!eVar && /Price variance/i.test(eVar.message));

  // Within tolerance (1.6%) it goes through with no reason and no exception row.
  const { data: billOk, error: eOk } = await authed.rpc("acc_create_bill_from_po", {
    p_po_id: poId, p_bill_date: "2026-07-11", p_due_date: null, p_vendor_ref: "VINV-2a", p_memo: null,
    p_lines: [{ purchase_order_line_id: lines[1].id, quantity: 1, unit_cost_minor: 10160 }],
    p_variance_reason: null,
  });
  if (eOk) throw new Error("bill within tolerance: " + eOk.message);
  const exOk = (await db.query("select count(*)::int c from acc_po_variance_exception where bill_id=$1", [billOk])).rows[0].c;
  check("a price inside tolerance needs no approval and records no exception", exOk === 0);

  // With a reason it is accepted and the exception is recorded.
  const { data: billVar, error: eVar2 } = await authed.rpc("acc_create_bill_from_po", {
    p_po_id: poId, p_bill_date: "2026-07-12", p_due_date: null, p_vendor_ref: "VINV-3", p_memo: null,
    p_lines: [{ purchase_order_line_id: lines[1].id, quantity: 3, unit_cost_minor: 11000 }],
    p_variance_reason: "Vendor surcharge agreed by purchasing",
  });
  if (eVar2) throw new Error("bill with variance reason: " + eVar2.message);
  const ex = (await db.query(
    "select kind, expected_value, actual_value, variance_bps, reason, approved_by from acc_po_variance_exception where bill_id=$1",
    [billVar],
  )).rows;
  check("approved price variance records one exception", ex.length === 1 && ex[0].kind === "price", `(n=${ex.length})`);
  check("exception records expected, actual, and 1000 bps", ex[0] && num(ex[0].expected_value) === 10000 && num(ex[0].actual_value) === 11000 && ex[0].variance_bps === 1000, `(bps=${ex[0]?.variance_bps})`);
  check("exception records the approver and reason", !!ex[0]?.approved_by && /surcharge/i.test(ex[0]?.reason ?? ""));

  // 9) Billing more than was received is rejected at 0% quantity tolerance.
  const { error: eQty } = await authed.rpc("acc_create_bill_from_po", {
    p_po_id: poId, p_bill_date: "2026-07-13", p_due_date: null, p_vendor_ref: "VINV-4", p_memo: null,
    p_lines: [{ purchase_order_line_id: lines[1].id, quantity: 1, unit_cost_minor: 10000 }],
    p_variance_reason: null,
  });
  check("billing beyond the received quantity is rejected", !!eQty && /Quantity variance/i.test(eQty.message));

  // 10) Void the posted bill: the ledger effect goes and qty_billed rolls back.
  const { error: eVoid } = await authed.rpc("acc_void_bill", { p_bill_id: billId });
  if (eVoid) throw new Error("void bill: " + eVoid.message);
  const entryStatus = (await db.query("select status from acc_journal_entry where id=$1", [entryId])).rows[0].status;
  check("voiding the bill voids its journal entry", entryStatus === "void");
  lines = await poLines(poId);
  check("voiding the bill rolls qty_billed back to 0", num(lines[0].qty_billed) === 0, `(=${lines[0].qty_billed})`);

  // 11) A receipt whose quantity is still billed cannot be voided; line 1 is now
  // unbilled, so its receipt can be.
  const receipt2 = (await db.query(
    "select id from acc_goods_receipt where purchase_order_id=$1 and memo='second shipment'", [poId],
  )).rows[0].id;
  const { error: eVoidBilled } = await authed.rpc("acc_void_goods_receipt", { p_receipt_id: receipt2, p_reason: "test" });
  check("a receipt whose quantity is billed cannot be voided", !!eVoidBilled && /already been billed/i.test(eVoidBilled.message));

  const { error: eVoidRec } = await authed.rpc("acc_void_goods_receipt", { p_receipt_id: receipt1, p_reason: "wrong shipment" });
  if (eVoidRec) throw new Error("void receipt: " + eVoidRec.message);
  lines = await poLines(poId);
  check("voiding a receipt rolls qty_received back", num(lines[0].qty_received) === 6, `(=${lines[0].qty_received})`);
  check("PO returns to partial after a receipt is voided", (await poStatus(poId)) === "partial");

  // 12) Received-not-billed shows line 1's unbilled 6 units.
  const { data: rnb, error: eRnb } = await authed.rpc("acc_received_not_billed");
  if (eRnb) throw new Error("received not billed: " + eRnb.message);
  const rnbLine = (rnb ?? []).find((r) => r.purchase_order_line_id === lines[0].id);
  check("received-not-billed reports the unbilled quantity", !!rnbLine && num(rnbLine.qty_outstanding) === 6, `(=${rnbLine?.qty_outstanding})`);
  check("received-not-billed values it at the PO cost", !!rnbLine && num(rnbLine.value_minor) === 6 * 1250, `(=${rnbLine?.value_minor})`);

  // 13) Short close: no further receipt is accepted.
  const { error: eClose } = await authed.rpc("acc_close_purchase_order", { p_po_id: poId, p_reason: "Vendor cannot supply the rest" });
  if (eClose) throw new Error("close PO: " + eClose.message);
  check("short-closed PO is closed", (await poStatus(poId)) === "closed");
  const { error: eAfterClose } = await authed.rpc("acc_receive_purchase_order", {
    p_po_id: poId, p_receipt_date: "2026-07-20", p_memo: null,
    p_lines: [{ purchase_order_line_id: lines[0].id, quantity: 1 }],
  });
  check("receiving against a closed PO is rejected", !!eAfterClose);

  // 14) A cancel is refused once anything has been received.
  const { error: eCancel } = await authed.rpc("acc_cancel_purchase_order", { p_po_id: poId, p_reason: "too late" });
  check("cancelling a PO with receipts is refused", !!eCancel);

  // Cleanup: void every remaining bill, then delete this module's rows.
  const remainingBills = (await db.query(
    "select id, status from acc_bill where purchase_order_id=$1 and status <> 'void'", [poId],
  )).rows;
  for (const b of remainingBills) {
    const { error } = await authed.rpc("acc_void_bill", { p_bill_id: b.id });
    if (error) throw new Error(`void bill ${b.id} for cleanup: ${error.message}`);
  }

  await db.query("begin");
  await db.query("delete from acc_po_variance_exception where purchase_order_id=$1", [poId]);
  await db.query("delete from acc_bill_line where bill_id in (select id from acc_bill where purchase_order_id=$1)", [poId]);
  await db.query("delete from acc_bill where purchase_order_id=$1", [poId]);
  await db.query("delete from acc_goods_receipt_line where goods_receipt_id in (select id from acc_goods_receipt where purchase_order_id=$1)", [poId]);
  await db.query("delete from acc_goods_receipt where purchase_order_id=$1", [poId]);
  await db.query("delete from acc_purchase_order_line where purchase_order_id=$1", [poId]);
  await db.query("delete from acc_purchase_order where id=$1", [poId]);
  await db.query("delete from acc_journal_line where journal_entry_id in (select id from acc_journal_entry where source_type='bill' and status='void')");
  await db.query("delete from acc_journal_entry where source_type='bill' and status='void'");
  await db.query("delete from acc_vendor where id=$1", [vendorId]);
  await db.query("delete from acc_audit_log where table_name in ('acc_purchase_order','acc_goods_receipt','acc_purchasing_config')");
  await db.query("commit");

  const leftPo = (await db.query("select count(*)::int c from acc_purchase_order")).rows[0].c;
  const leftReceipts = (await db.query("select count(*)::int c from acc_goods_receipt")).rows[0].c;
  const leftEx = (await db.query("select count(*)::int c from acc_po_variance_exception")).rows[0].c;
  check("cleanup left no purchase orders", leftPo === 0, `(=${leftPo})`);
  check("cleanup left no receipts", leftReceipts === 0, `(=${leftReceipts})`);
  check("cleanup left no variance exceptions", leftEx === 0, `(=${leftEx})`);
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
