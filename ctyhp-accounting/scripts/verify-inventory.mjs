// scripts/verify-inventory.mjs
// E2E verify of Module G2 — Inventory quantity and valuation (as admin):
// receive 10 @ 12.50 on a PO and assert DR Inventory / CR GRNI + subledger;
// bill it at 13.00 with an approved variance and assert GRNI nets to zero and
// WAC becomes 13.00; sell 4 and assert a separate base-currency DR COGS /
// CR Inventory entry; refuse an oversell; sell the remaining 6 and assert
// quantity 0 AND value 0 (the residual rule); adjust found stock and shrinkage;
// void the invoice and assert the stock and the cost entry come back; refuse an
// inventory item on a direct bill; and assert the valuation equals the inventory
// control account at every checkpoint. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-inventory.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { if (ok) { pass++; } else { fail++; } console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const num = (v) => Number(v);
const acctId = async (code) => (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;

/** On-hand quantity and value straight from the subledger's latest row. */
async function onHand(itemId) {
  const { rows } = await db.query(
    "select running_qty, running_value_minor from acc_inventory_txn where item_id=$1 order by seq desc limit 1",
    [itemId],
  );
  return rows.length ? { qty: num(rows[0].running_qty), value: num(rows[0].running_value_minor) } : { qty: 0, value: 0 };
}

/** Posted-ledger balance of one account (debits - credits). */
async function ledgerBalance(accountId) {
  const { rows } = await db.query(
    `select coalesce(sum(l.debit_minor - l.credit_minor), 0) b
       from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
      where l.account_id = $1 and e.status = 'posted'`,
    [accountId],
  );
  return num(rows[0].b);
}

async function valuationValue(authed, asOf, itemId) {
  const { data, error } = await authed.rpc("acc_inventory_valuation", { p_as_of: asOf });
  if (error) throw new Error("valuation: " + error.message);
  const row = (data ?? []).find((r) => r.item_id === itemId);
  return row ? { qty: num(row.qty_on_hand), value: num(row.value_minor), unit: num(row.unit_cost_minor) } : null;
}

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

  const invAcct  = await acctId("1200");   // Inventory
  const cogsAcct = await acctId("5000");   // Cost of Goods Sold
  const income   = await acctId("4000");   // Sales Revenue
  const grni     = await acctId("2150");   // Goods Received Not Invoiced
  const expense  = await acctId("6000");   // Operating Expenses (shrinkage offset)
  const base = (await db.query("select code from acc_currency where is_base")).rows[0].code;

  const invAcctOpening = await ledgerBalance(invAcct);
  const grniOpening = await ledgerBalance(grni);

  // An inventory item, a vendor to buy from, and a customer to sell to.
  const itemId = (await db.query(
    `insert into acc_item (item_code, name, is_sold, sales_price_minor, income_account_id,
                           is_purchased, purchase_cost_minor, expense_account_id,
                           is_inventory, inventory_account_id, cogs_account_id)
     values ('E2E-INV', 'E2E Inventory Widget', true, 5000, $1, true, 1250, $2, true, $3, $4)
     returning id`,
    [income, cogsAcct, invAcct, cogsAcct],
  )).rows[0].id;
  const vendorId = (await db.query(
    "insert into acc_vendor (name, currency_code) values ('E2E Inventory Vendor', $1) returning id", [base],
  )).rows[0].id;
  const customerId = (await db.query(
    "insert into acc_customer (name, currency_code) values ('E2E Inventory Customer', $1) returning id", [base],
  )).rows[0].id;

  const { error: eCfg } = await authed.rpc("acc_set_purchasing_config", {
    p_price_tolerance_bps: 200, p_qty_tolerance_bps: 0,
  });
  if (eCfg) throw new Error("set config: " + eCfg.message);

  // ---- 1) Receive 10 @ 12.50 --------------------------------------------
  const { data: poId, error: e1 } = await authed.rpc("acc_save_purchase_order", {
    p_po_id: null, p_vendor_id: vendorId, p_order_date: "2026-07-01", p_expected_date: null,
    p_currency: base, p_ship_to: null, p_memo: "E2E inventory",
    p_lines: [{ item_id: itemId, description: "Widget", quantity: 10, unit_cost_minor: 1250, expense_account_id: cogsAcct }],
  });
  if (e1) throw new Error("save PO: " + e1.message);
  const { error: eAppr } = await authed.rpc("acc_approve_purchase_order", { p_po_id: poId });
  if (eAppr) throw new Error("approve: " + eAppr.message);
  const poLineId = (await db.query("select id from acc_purchase_order_line where purchase_order_id=$1", [poId])).rows[0].id;

  const { data: receiptId, error: e2 } = await authed.rpc("acc_receive_purchase_order", {
    p_po_id: poId, p_receipt_date: "2026-07-05", p_memo: "shipment",
    p_lines: [{ purchase_order_line_id: poLineId, quantity: 10 }],
  });
  if (e2) throw new Error("receive: " + e2.message);

  let oh = await onHand(itemId);
  check("receipt adds quantity and value to the subledger", oh.qty === 10 && oh.value === 12500, `(qty=${oh.qty} val=${oh.value})`);

  const recEntry = (await db.query(
    "select id, currency_code from acc_journal_entry where source_type='goods_receipt' and source_id=$1", [receiptId],
  )).rows[0];
  check("the receipt posts a base-currency entry", !!recEntry && recEntry.currency_code === base);
  const recLines = (await db.query(
    "select account_id, debit_minor, credit_minor from acc_journal_line where journal_entry_id=$1", [recEntry.id],
  )).rows;
  check("receipt debits Inventory 125.00", recLines.some((l) => l.account_id === invAcct && num(l.debit_minor) === 12500));
  check("receipt credits GRNI 125.00", recLines.some((l) => l.account_id === grni && num(l.credit_minor) === 12500));
  check("receipt entry is balanced",
    recLines.reduce((s, l) => s + num(l.debit_minor), 0) === recLines.reduce((s, l) => s + num(l.credit_minor), 0));

  let val = await valuationValue(authed, "2026-07-05", itemId);
  check("valuation matches the inventory control account after receiving",
    val.value === (await ledgerBalance(invAcct)) - invAcctOpening, `(sub=${val.value})`);

  // ---- 2) Bill it at 13.00 with an approved price variance ---------------
  const { data: billId, error: e3 } = await authed.rpc("acc_create_bill_from_po", {
    p_po_id: poId, p_bill_date: "2026-07-10", p_due_date: null, p_vendor_ref: "VINV-INV-1", p_memo: null,
    p_lines: [{ purchase_order_line_id: poLineId, quantity: 10, unit_cost_minor: 1300 }],
    p_variance_reason: "Vendor surcharge approved",
  });
  if (e3) throw new Error("bill from PO: " + e3.message);

  const billLines = (await db.query(
    "select expense_account_id, amount_minor, is_inventory_variance from acc_bill_line where bill_id=$1 order by line_order", [billId],
  )).rows;
  check("the inventory line clears GRNI at the purchase-order cost",
    billLines[0] && billLines[0].expense_account_id === grni && num(billLines[0].amount_minor) === 12500);
  check("the price difference becomes an inventory variance line",
    billLines[1] && billLines[1].is_inventory_variance && billLines[1].expense_account_id === invAcct && num(billLines[1].amount_minor) === 500);

  const { data: billEntry, error: e4 } = await authed.rpc("acc_post_bill", { p_bill_id: billId });
  if (e4) throw new Error("post bill: " + e4.message);
  check("GRNI drains back to its opening balance once billed", (await ledgerBalance(grni)) === grniOpening,
    `(=${await ledgerBalance(grni)})`);

  oh = await onHand(itemId);
  check("the variance raises inventory value without moving quantity", oh.qty === 10 && oh.value === 13000, `(qty=${oh.qty} val=${oh.value})`);
  const wac = num((await db.query("select acc_item_wac($1) w", [itemId])).rows[0].w);
  check("weighted average cost is now 13.00", wac === 1300, `(=${wac})`);
  check("valuation still matches the control account after billing",
    (await valuationValue(authed, "2026-07-10", itemId)).value === (await ledgerBalance(invAcct)) - invAcctOpening);

  // ---- 3) Sell 4 at WAC --------------------------------------------------
  const invoice1 = (await db.query(
    `insert into acc_invoice (customer_id, issue_date, currency_code, subtotal_minor, tax_total_minor, total_minor, status)
     values ($1, '2026-07-15', $2, 20000, 0, 20000, 'draft') returning id`, [customerId, base],
  )).rows[0].id;
  await db.query(
    `insert into acc_invoice_line (invoice_id, line_order, description, quantity, unit_price_minor,
                                   income_account_id, item_id, line_subtotal_minor, line_tax_minor, line_total_minor)
     values ($1, 0, 'Widget', 4, 5000, $2, $3, 20000, 0, 20000)`, [invoice1, income, itemId],
  );
  const { data: salesEntry, error: e5 } = await authed.rpc("acc_issue_invoice", { p_invoice_id: invoice1 });
  if (e5) throw new Error("issue invoice: " + e5.message);

  oh = await onHand(itemId);
  check("selling 4 relieves 4 units at 13.00", oh.qty === 6 && oh.value === 7800, `(qty=${oh.qty} val=${oh.value})`);

  const costEntry = (await db.query(
    "select id, currency_code from acc_journal_entry where source_type='inventory' and source_id=$1 and status='posted'", [invoice1],
  )).rows[0];
  check("the cost of sale is a separate base-currency entry",
    !!costEntry && costEntry.id !== salesEntry && costEntry.currency_code === base);
  const costLines = (await db.query(
    "select account_id, debit_minor, credit_minor from acc_journal_line where journal_entry_id=$1", [costEntry.id],
  )).rows;
  check("cost entry debits COGS 52.00", costLines.some((l) => l.account_id === cogsAcct && num(l.debit_minor) === 5200));
  check("cost entry credits Inventory 52.00", costLines.some((l) => l.account_id === invAcct && num(l.credit_minor) === 5200));
  check("valuation still matches the control account after selling",
    (await valuationValue(authed, "2026-07-15", itemId)).value === (await ledgerBalance(invAcct)) - invAcctOpening);

  // ---- 4) Oversell is refused -------------------------------------------
  const invoiceBad = (await db.query(
    `insert into acc_invoice (customer_id, issue_date, currency_code, subtotal_minor, tax_total_minor, total_minor, status)
     values ($1, '2026-07-16', $2, 50000, 0, 50000, 'draft') returning id`, [customerId, base],
  )).rows[0].id;
  await db.query(
    `insert into acc_invoice_line (invoice_id, line_order, description, quantity, unit_price_minor,
                                   income_account_id, item_id, line_subtotal_minor, line_tax_minor, line_total_minor)
     values ($1, 0, 'Widget', 10, 5000, $2, $3, 50000, 0, 50000)`, [invoiceBad, income, itemId],
  );
  const { error: eOver } = await authed.rpc("acc_issue_invoice", { p_invoice_id: invoiceBad });
  check("selling more than is on hand is rejected", !!eOver && /Insufficient inventory/i.test(eOver.message));
  oh = await onHand(itemId);
  check("the rejected sale changed nothing", oh.qty === 6 && oh.value === 7800);

  // ---- 5) Sell the rest: quantity AND value must reach zero -------------
  const invoice2 = (await db.query(
    `insert into acc_invoice (customer_id, issue_date, currency_code, subtotal_minor, tax_total_minor, total_minor, status)
     values ($1, '2026-07-17', $2, 30000, 0, 30000, 'draft') returning id`, [customerId, base],
  )).rows[0].id;
  await db.query(
    `insert into acc_invoice_line (invoice_id, line_order, description, quantity, unit_price_minor,
                                   income_account_id, item_id, line_subtotal_minor, line_tax_minor, line_total_minor)
     values ($1, 0, 'Widget', 6, 5000, $2, $3, 30000, 0, 30000)`, [invoice2, income, itemId],
  );
  const { error: e6 } = await authed.rpc("acc_issue_invoice", { p_invoice_id: invoice2 });
  if (e6) throw new Error("issue invoice 2: " + e6.message);
  oh = await onHand(itemId);
  check("emptying the stock leaves quantity 0 AND value 0 (residual rule)", oh.qty === 0 && oh.value === 0, `(qty=${oh.qty} val=${oh.value})`);
  check("inventory control account is back to its opening balance",
    (await ledgerBalance(invAcct)) === invAcctOpening, `(=${await ledgerBalance(invAcct)})`);

  // ---- 6) Adjustments: found stock, then shrinkage ----------------------
  const { error: e7 } = await authed.rpc("acc_adjust_inventory", {
    p_item_id: itemId, p_date: "2026-07-18", p_qty_delta: 5, p_unit_cost_minor: 1000,
    p_value_delta_minor: 0, p_offset_account_id: expense, p_reason: "Found in the safe during the count",
  });
  if (e7) throw new Error("adjust up: " + e7.message);
  oh = await onHand(itemId);
  check("found stock adds quantity at the given unit cost", oh.qty === 5 && oh.value === 5000, `(qty=${oh.qty} val=${oh.value})`);

  const { error: e8 } = await authed.rpc("acc_adjust_inventory", {
    p_item_id: itemId, p_date: "2026-07-19", p_qty_delta: -2, p_unit_cost_minor: 0,
    p_value_delta_minor: 0, p_offset_account_id: expense, p_reason: "Damaged",
  });
  if (e8) throw new Error("adjust down: " + e8.message);
  oh = await onHand(itemId);
  check("shrinkage relieves quantity at weighted average", oh.qty === 3 && oh.value === 3000, `(qty=${oh.qty} val=${oh.value})`);
  check("an adjustment without a reason is refused",
    !!(await authed.rpc("acc_adjust_inventory", {
      p_item_id: itemId, p_date: "2026-07-19", p_qty_delta: -1, p_unit_cost_minor: 0,
      p_value_delta_minor: 0, p_offset_account_id: expense, p_reason: "  ",
    })).error);
  check("valuation matches the control account after adjustments",
    (await valuationValue(authed, "2026-07-19", itemId)).value === (await ledgerBalance(invAcct)) - invAcctOpening,
    `(sub=${(await valuationValue(authed, "2026-07-19", itemId)).value} led=${(await ledgerBalance(invAcct)) - invAcctOpening})`);

  // ---- 7) Voiding an invoice puts the goods back ------------------------
  const { error: e9 } = await authed.rpc("acc_void_invoice", { p_invoice_id: invoice2 });
  if (e9) throw new Error("void invoice: " + e9.message);
  oh = await onHand(itemId);
  check("voiding a sale restores the quantity and the exact cost relieved", oh.qty === 9 && oh.value === 10800, `(qty=${oh.qty} val=${oh.value})`);
  const costEntry2Status = (await db.query(
    "select status from acc_journal_entry where source_type='inventory' and source_id=$1", [invoice2],
  )).rows[0].status;
  check("voiding a sale voids its cost entry too", costEntry2Status === "void");
  check("valuation matches the control account after the void",
    (await valuationValue(authed, "2026-07-19", itemId)).value === (await ledgerBalance(invAcct)) - invAcctOpening);

  // ---- 8) An inventory item may not be bought on a direct bill ----------
  const directBill = (await db.query(
    "insert into acc_bill (vendor_id, bill_date, currency_code, status) values ($1, '2026-07-20', $2, 'draft') returning id",
    [vendorId, base],
  )).rows[0].id;
  await db.query(
    "insert into acc_bill_line (bill_id, line_order, description, expense_account_id, amount_minor, item_id) values ($1, 0, 'Widget', $2, 1300, $3)",
    [directBill, cogsAcct, itemId],
  );
  const { error: eDirect } = await authed.rpc("acc_post_bill", { p_bill_id: directBill });
  check("an inventory item on a direct bill is rejected",
    !!eDirect && /purchase order/i.test(eDirect.message));

  // ---- 9) Non-base-currency purchase of inventory is refused -----------
  const foreign = (await db.query("select code from acc_currency where not is_base limit 1")).rows[0]?.code;
  if (foreign) {
    const { data: fxPo, error: eFxPo } = await authed.rpc("acc_save_purchase_order", {
      p_po_id: null, p_vendor_id: vendorId, p_order_date: "2026-07-21", p_expected_date: null,
      p_currency: foreign, p_ship_to: null, p_memo: "fx",
      p_lines: [{ item_id: itemId, description: "Widget", quantity: 1, unit_cost_minor: 1000, expense_account_id: cogsAcct }],
    });
    if (eFxPo) throw new Error("save fx PO: " + eFxPo.message);
    await authed.rpc("acc_approve_purchase_order", { p_po_id: fxPo });
    const fxLine = (await db.query("select id from acc_purchase_order_line where purchase_order_id=$1", [fxPo])).rows[0].id;
    const { error: eFx } = await authed.rpc("acc_receive_purchase_order", {
      p_po_id: fxPo, p_receipt_date: "2026-07-21", p_memo: null,
      p_lines: [{ purchase_order_line_id: fxLine, quantity: 1 }],
    });
    check("receiving inventory on a non-base-currency PO is rejected", !!eFx && /base-currency/i.test(eFx.message));
    await db.query("delete from acc_goods_receipt_line where goods_receipt_id in (select id from acc_goods_receipt where purchase_order_id=$1)", [fxPo]);
    await db.query("delete from acc_goods_receipt where purchase_order_id=$1", [fxPo]);
    await db.query("delete from acc_purchase_order_line where purchase_order_id=$1", [fxPo]);
    await db.query("delete from acc_purchase_order where id=$1", [fxPo]);
  } else {
    console.log("  (skip) no non-base currency configured");
  }

  // ---- 10) Voiding the bill reverses the cost variance ------------------
  const { error: e10 } = await authed.rpc("acc_void_bill", { p_bill_id: billId });
  if (e10) throw new Error("void bill: " + e10.message);
  oh = await onHand(itemId);
  check("voiding the bill reverses the inventory cost variance", oh.qty === 9 && oh.value === 10300, `(qty=${oh.qty} val=${oh.value})`);
  check("valuation matches the control account after voiding the bill",
    (await valuationValue(authed, "2026-07-21", itemId)).value === (await ledgerBalance(invAcct)) - invAcctOpening,
    `(sub=${(await valuationValue(authed, "2026-07-21", itemId)).value} led=${(await ledgerBalance(invAcct)) - invAcctOpening})`);
  check("the posted bill entry is void", (await db.query(
    "select status from acc_journal_entry where id=$1", [billEntry],
  )).rows[0].status === "void");

  // ---- Cleanup: void what is still posted, then delete ------------------
  const { error = null } = await authed.rpc("acc_void_invoice", { p_invoice_id: invoice1 });
  if (error) throw new Error("cleanup void invoice1: " + error.message);
  const { error: eVoidRec } = await authed.rpc("acc_void_goods_receipt", { p_receipt_id: receiptId, p_reason: "cleanup" });
  if (eVoidRec) throw new Error("cleanup void receipt: " + eVoidRec.message);

  await db.query("begin");
  // The two adjustments are legitimate posted entries; void them so the control
  // account returns to where this run found it.
  await db.query(
    "update acc_journal_entry set status='void', voided_at=now() where source_type='inventory_adjustment' and source_id=$1",
    [itemId],
  );
  await db.query("delete from acc_inventory_txn where item_id=$1", [itemId]);
  await db.query("delete from acc_po_variance_exception where purchase_order_id=$1", [poId]);
  await db.query("delete from acc_bill_line where bill_id in (select id from acc_bill where purchase_order_id=$1 or vendor_id=$2)", [poId, vendorId]);
  await db.query("delete from acc_bill where purchase_order_id=$1 or vendor_id=$2", [poId, vendorId]);
  await db.query("delete from acc_goods_receipt_line where goods_receipt_id in (select id from acc_goods_receipt where purchase_order_id=$1)", [poId]);
  await db.query("delete from acc_goods_receipt where purchase_order_id=$1", [poId]);
  await db.query("delete from acc_purchase_order_line where purchase_order_id=$1", [poId]);
  await db.query("delete from acc_purchase_order where id=$1", [poId]);
  await db.query("delete from acc_invoice_line where invoice_id in (select id from acc_invoice where customer_id=$1)", [customerId]);
  await db.query("delete from acc_invoice where customer_id=$1", [customerId]);
  await db.query(`delete from acc_journal_line where journal_entry_id in (
                    select id from acc_journal_entry
                     where source_type in ('goods_receipt','inventory','inventory_adjustment','bill','invoice')
                       and status='void')`);
  await db.query(`delete from acc_journal_entry
                   where source_type in ('goods_receipt','inventory','inventory_adjustment','bill','invoice')
                     and status='void'`);
  await db.query("delete from acc_customer where id=$1", [customerId]);
  await db.query("delete from acc_vendor where id=$1", [vendorId]);
  await db.query("delete from acc_item where id=$1", [itemId]);
  await db.query("delete from acc_audit_log where table_name in ('acc_inventory_txn','acc_purchase_order','acc_goods_receipt','acc_purchasing_config','acc_bill','acc_item')");
  await db.query("commit");

  const leftTxns = (await db.query("select count(*)::int c from acc_inventory_txn")).rows[0].c;
  const leftItems = (await db.query("select count(*)::int c from acc_item where item_code='E2E-INV'")).rows[0].c;
  const invAcctFinal = await ledgerBalance(invAcct);
  check("cleanup left no inventory movements", leftTxns === 0, `(=${leftTxns})`);
  check("cleanup left no test item", leftItems === 0);
  check("inventory control account is back where it started", invAcctFinal === invAcctOpening, `(=${invAcctFinal})`);
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
