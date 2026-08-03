/**
 * Purchasing rules: line extension, receipt progress, and three-way matching
 * (PO <-> receipt <-> bill). These are the single definition of each rule; the
 * SQL RPCs in `supabase/migrations/0032_purchasing_functions.sql` re-derive the
 * same arithmetic server-side (`acc_variance_bps`, the quantity guard) because
 * the server must never trust a client-side match result. No component may
 * recompute either rule.
 */
import { assertMinor, roundHalfAwayFromZero, type Minor } from "./money";

/** Quantities are numeric(20,4) in the database, so compare with a 4-decimal-safe epsilon. */
const QTY_EPSILON = 1e-6;

/** A PO line's extended amount: quantity x unit cost, in whole minor units. */
export function poLineTotalMinor(quantity: number, unitCostMinor: Minor): Minor {
  assertMinor(unitCostMinor, "unitCostMinor");
  return roundHalfAwayFromZero(quantity * unitCostMinor);
}

/** What is still outstanding on a line; never negative. */
export function remainingQty(orderedQty: number, receivedQty: number): number {
  return Math.max(orderedQty - receivedQty, 0);
}

export type PoReceiptStatus = "open" | "partial" | "received";

export interface PoLineProgress {
  quantity: number;
  qty_received: number;
  is_closed: boolean;
}

/**
 * Receipt progress across a PO's lines. A short-closed line counts as settled,
 * which is what lets a partially-received PO reach `received` after a close.
 */
export function poReceiptStatus(lines: PoLineProgress[]): PoReceiptStatus {
  const outstanding = lines.filter(
    (l) => !l.is_closed && l.qty_received < l.quantity - QTY_EPSILON,
  ).length;
  if (lines.length > 0 && outstanding === 0) return "received";
  return lines.some((l) => l.qty_received > 0) ? "partial" : "open";
}

/**
 * Signed variance of `actual` against `expected`, in basis points.
 * Both zero is no variance; a zero expected with a non-zero actual is a full
 * 10000 bps so a from-nothing variance can never look "within tolerance".
 */
export function varianceBps(expected: number, actual: number): number {
  if (expected === 0 && actual === 0) return 0;
  if (expected === 0) return 10000;
  return roundHalfAwayFromZero(((actual - expected) / Math.abs(expected)) * 10000);
}

export function withinToleranceBps(expected: number, actual: number, toleranceBps: number): boolean {
  return Math.abs(varianceBps(expected, actual)) <= toleranceBps;
}

export type VarianceKind = "price" | "quantity";

export interface VarianceException {
  kind: VarianceKind;
  expectedValue: number;
  actualValue: number;
  varianceBps: number;
}

export interface ThreeWayMatchInput {
  orderedQty: number;
  receivedQty: number;
  /** Quantity already billed on earlier bills for this PO line. */
  alreadyBilledQty: number;
  billQty: number;
  poUnitCostMinor: Minor;
  billUnitCostMinor: Minor;
}

export interface ThreeWayMatchConfig {
  priceToleranceBps: number;
  qtyToleranceBps: number;
}

export interface ThreeWayMatchResult {
  priceOk: boolean;
  qtyOk: boolean;
  requiresApproval: boolean;
  exceptions: VarianceException[];
}

/**
 * Match one bill line against its PO line and receipts.
 *
 * Quantity is matched as (already billed + this bill) against what was
 * RECEIVED, not what was ordered: you bill what arrived. Price is matched
 * against the PO unit cost. Anything outside tolerance requires an explicit,
 * audited exception approval (US-FR-073).
 */
export function threeWayMatchLine(
  input: ThreeWayMatchInput,
  config: ThreeWayMatchConfig,
): ThreeWayMatchResult {
  const exceptions: VarianceException[] = [];

  const cumulativeBilled = input.alreadyBilledQty + input.billQty;
  const allowedQty = input.receivedQty * (1 + config.qtyToleranceBps / 10000);
  const qtyOk = cumulativeBilled <= allowedQty + QTY_EPSILON;
  if (!qtyOk) {
    exceptions.push({
      kind: "quantity",
      expectedValue: input.receivedQty,
      actualValue: cumulativeBilled,
      varianceBps: varianceBps(input.receivedQty, cumulativeBilled),
    });
  }

  const priceOk = withinToleranceBps(
    input.poUnitCostMinor,
    input.billUnitCostMinor,
    config.priceToleranceBps,
  );
  if (!priceOk) {
    exceptions.push({
      kind: "price",
      expectedValue: input.poUnitCostMinor,
      actualValue: input.billUnitCostMinor,
      varianceBps: varianceBps(input.poUnitCostMinor, input.billUnitCostMinor),
    });
  }

  return { priceOk, qtyOk, requiresApproval: !priceOk || !qtyOk, exceptions };
}

/** What a picker needs to offer one purchase order that is waiting to be billed. */
export interface BillablePurchaseOrder {
  purchaseOrderId: string;
  poNumber: string | null;
  vendorId: string;
  currencyCode: string;
  orderDate: string;
  /** Outstanding lines on this order — received, not yet billed. */
  lineCount: number;
  /** Their total value, in whole minor units. */
  valueMinor: Minor;
}

/** The two row shapes this join needs, named so callers are not tied to db types. */
interface ReceivedNotBilledLike {
  purchase_order_id: string;
  po_number: string | null;
  order_date: string;
  value_minor: number;
  currency_code: string;
}
interface PurchaseOrderLike {
  id: string;
  vendor_id: string;
}

/**
 * The purchase orders a vendor still owes a bill for, one entry per order.
 *
 * `acc_received_not_billed` answers "what arrived and has not been billed" a
 * line at a time, and reports the vendor by *name* — which is not an identity,
 * because two vendors may share one. So the vendor id comes from the purchase
 * order itself, and a billable line whose order is not in the list is dropped
 * rather than guessed at: offering a choice that opens the wrong document is
 * worse than offering none.
 *
 * Newest order first, because the one someone is about to bill is almost always
 * the one that just arrived.
 */
export function billablePurchaseOrders(
  receivedNotBilled: readonly ReceivedNotBilledLike[],
  purchaseOrders: readonly PurchaseOrderLike[],
): BillablePurchaseOrder[] {
  const vendorOf = new Map(purchaseOrders.map((po) => [po.id, po.vendor_id]));
  const byOrder = new Map<string, BillablePurchaseOrder>();

  for (const row of receivedNotBilled) {
    const vendorId = vendorOf.get(row.purchase_order_id);
    if (!vendorId) continue;
    const found = byOrder.get(row.purchase_order_id);
    if (found) {
      found.lineCount += 1;
      found.valueMinor += row.value_minor;
      continue;
    }
    byOrder.set(row.purchase_order_id, {
      purchaseOrderId: row.purchase_order_id,
      poNumber: row.po_number,
      vendorId,
      currencyCode: row.currency_code,
      orderDate: row.order_date,
      lineCount: 1,
      valueMinor: row.value_minor,
    });
  }

  return [...byOrder.values()].sort((a, b) => b.orderDate.localeCompare(a.orderDate));
}
