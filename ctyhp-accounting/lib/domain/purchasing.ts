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
