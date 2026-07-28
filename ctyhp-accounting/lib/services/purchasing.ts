import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BillRow,
  GoodsReceiptLineRow,
  GoodsReceiptRow,
  PoVarianceExceptionRow,
  PurchaseOrderLineRow,
  PurchaseOrderRow,
  PurchasingConfigRow,
  ReceivedNotBilledRow,
} from "@/lib/db/types";
import type {
  BillFromPoInput,
  GoodsReceiptInput,
  PurchaseOrderSaveInput,
  PurchasingConfigInput,
} from "@/lib/domain/schemas";

export class PurchasingError extends Error {}

const PO_COLS =
  "id,po_number,vendor_id,order_date,expected_date,currency_code,ship_to,memo," +
  "total_minor,status,close_reason,created_at,updated_at";

export interface PurchaseOrderWithVendor extends PurchaseOrderRow {
  vendor_name: string;
}

export interface GoodsReceiptWithLines extends GoodsReceiptRow {
  lines: GoodsReceiptLineRow[];
}

export interface PurchaseOrderDetail {
  order: PurchaseOrderWithVendor;
  lines: PurchaseOrderLineRow[];
  receipts: GoodsReceiptWithLines[];
  bills: Pick<BillRow, "id" | "bill_number" | "bill_date" | "total_minor" | "status">[];
  exceptions: PoVarianceExceptionRow[];
}

// --- Reads ---

export async function listPurchaseOrders(sb: SupabaseClient): Promise<PurchaseOrderWithVendor[]> {
  const { data, error } = await sb
    .from("acc_purchase_order")
    .select(`${PO_COLS},acc_vendor(name)`)
    .order("created_at", { ascending: false });
  if (error) throw new PurchasingError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as PurchaseOrderRow),
    vendor_name: (r.acc_vendor as { name?: string } | null)?.name ?? "—",
  }));
}

export async function getPurchaseOrder(sb: SupabaseClient, id: string): Promise<PurchaseOrderDetail> {
  const { data: head, error: e1 } = await sb
    .from("acc_purchase_order")
    .select(`${PO_COLS},acc_vendor(name)`)
    .eq("id", id)
    .single();
  if (e1) throw new PurchasingError(e1.message);
  const headRow = head as unknown as Record<string, unknown>;

  const [lines, receipts, bills, exceptions] = await Promise.all([
    sb.from("acc_purchase_order_line").select("*").eq("purchase_order_id", id).order("line_order"),
    sb
      .from("acc_goods_receipt")
      .select("*,acc_goods_receipt_line(*)")
      .eq("purchase_order_id", id)
      .order("receipt_date"),
    sb
      .from("acc_bill")
      .select("id,bill_number,bill_date,total_minor,status")
      .eq("purchase_order_id", id)
      .order("bill_date"),
    sb.from("acc_po_variance_exception").select("*").eq("purchase_order_id", id).order("created_at"),
  ]);
  for (const r of [lines, receipts, bills, exceptions]) {
    if (r.error) throw new PurchasingError(r.error.message);
  }

  return {
    order: {
      ...(headRow as unknown as PurchaseOrderRow),
      vendor_name: (headRow.acc_vendor as { name?: string } | null)?.name ?? "—",
    },
    lines: (lines.data ?? []) as unknown as PurchaseOrderLineRow[],
    receipts: ((receipts.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      ...(r as unknown as GoodsReceiptRow),
      lines: (r.acc_goods_receipt_line ?? []) as unknown as GoodsReceiptLineRow[],
    })),
    bills: (bills.data ?? []) as unknown as PurchaseOrderDetail["bills"],
    exceptions: (exceptions.data ?? []) as unknown as PoVarianceExceptionRow[],
  };
}

export async function getReceivedNotBilled(sb: SupabaseClient): Promise<ReceivedNotBilledRow[]> {
  const { data, error } = await sb.rpc("acc_received_not_billed");
  if (error) throw new PurchasingError(error.message);
  return (data ?? []) as unknown as ReceivedNotBilledRow[];
}

export async function getPurchasingConfig(sb: SupabaseClient): Promise<PurchasingConfigRow> {
  const { data, error } = await sb
    .from("acc_purchasing_config")
    .select("price_tolerance_bps,qty_tolerance_bps,updated_at")
    .single();
  if (error) throw new PurchasingError(error.message);
  return data as unknown as PurchasingConfigRow;
}

// --- Writes (every one is an atomic SECURITY DEFINER RPC) ---

export async function savePurchaseOrder(
  sb: SupabaseClient,
  id: string | null,
  input: PurchaseOrderSaveInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_save_purchase_order", {
    p_po_id: id,
    p_vendor_id: input.vendor_id,
    p_order_date: input.order_date,
    p_expected_date: input.expected_date || null,
    p_currency: input.currency_code,
    p_ship_to: input.ship_to || null,
    p_memo: input.memo || null,
    p_lines: input.lines.map((l) => ({
      item_id: l.item_id || null,
      description: l.description ?? "",
      quantity: l.quantity,
      unit_cost_minor: l.unit_cost_minor,
      expense_account_id: l.expense_account_id,
    })),
  });
  if (error) throw new PurchasingError(error.message);
  return String(data);
}

export async function approvePurchaseOrder(sb: SupabaseClient, id: string): Promise<string> {
  const { data, error } = await sb.rpc("acc_approve_purchase_order", { p_po_id: id });
  if (error) throw new PurchasingError(error.message);
  return String(data);
}

export async function cancelPurchaseOrder(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("acc_cancel_purchase_order", { p_po_id: id, p_reason: reason });
  if (error) throw new PurchasingError(error.message);
}

export async function closePurchaseOrder(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("acc_close_purchase_order", { p_po_id: id, p_reason: reason });
  if (error) throw new PurchasingError(error.message);
}

export async function receivePurchaseOrder(
  sb: SupabaseClient,
  id: string,
  input: GoodsReceiptInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_receive_purchase_order", {
    p_po_id: id,
    p_receipt_date: input.receipt_date,
    p_memo: input.memo || null,
    p_lines: input.lines,
  });
  if (error) throw new PurchasingError(error.message);
  return String(data);
}

export async function voidGoodsReceipt(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_goods_receipt", { p_receipt_id: id, p_reason: reason });
  if (error) throw new PurchasingError(error.message);
}

/** Create a draft bill from received PO lines. Three-way matching is enforced server-side. */
export async function createBillFromPo(
  sb: SupabaseClient,
  id: string,
  input: BillFromPoInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_bill_from_po", {
    p_po_id: id,
    p_bill_date: input.bill_date,
    p_due_date: input.due_date || null,
    p_vendor_ref: input.vendor_ref || null,
    p_memo: input.memo || null,
    p_lines: input.lines,
    p_variance_reason: input.variance_reason || null,
  });
  if (error) throw new PurchasingError(error.message);
  return String(data);
}

export async function setPurchasingConfig(
  sb: SupabaseClient,
  input: PurchasingConfigInput,
): Promise<void> {
  const { error } = await sb.rpc("acc_set_purchasing_config", {
    p_price_tolerance_bps: input.price_tolerance_bps,
    p_qty_tolerance_bps: input.qty_tolerance_bps,
  });
  if (error) throw new PurchasingError(error.message);
}
