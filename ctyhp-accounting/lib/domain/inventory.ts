/**
 * Inventory costing: weighted average cost (moving average).
 *
 * These are the single definition of the costing rules. The SQL functions in
 * `supabase/migrations/0034_inventory_functions.sql` re-derive the same
 * arithmetic (`acc_item_wac`, `acc_cost_of_sale_minor`, `acc_add_inventory_txn`)
 * because the server must enforce them, not trust a client. No component may
 * recompute a cost.
 */
import { roundHalfAwayFromZero, type Minor } from "./money";

export interface OnHand {
  qty: number;
  valueMinor: Minor;
}

export interface Movement {
  qtyDelta: number;
  costDeltaMinor: Minor;
}

/** Weighted average unit cost; zero when nothing is on hand. */
export function weightedAverageCostMinor(qtyOnHand: number, valueMinor: Minor): Minor {
  if (qtyOnHand === 0) return 0;
  return roundHalfAwayFromZero(valueMinor / qtyOnHand);
}

/**
 * Cost to relieve for a sale.
 *
 * Residual rule: a sale that empties the stock relieves the ENTIRE remaining
 * value rather than `qtySold x WAC`. Without it, integer-cent rounding leaves
 * value attached to zero units and the valuation can never tie to the ledger.
 */
export function costOfSaleMinor(qtyOnHand: number, valueMinor: Minor, qtySold: number): Minor {
  if (qtySold <= 0) {
    throw new Error(`Sale quantity must be positive, received ${qtySold}`);
  }
  if (qtySold > qtyOnHand) {
    throw new Error(`Insufficient inventory: ${qtyOnHand} on hand, selling ${qtySold}`);
  }
  if (qtySold === qtyOnHand) return valueMinor;
  return roundHalfAwayFromZero(qtySold * (valueMinor / qtyOnHand));
}

/** Apply one movement to a running pair, refusing to go negative on quantity. */
export function applyMovement(current: OnHand, movement: Movement): OnHand {
  const qty = current.qty + movement.qtyDelta;
  if (qty < 0) {
    throw new Error(
      `Insufficient inventory: ${current.qty} on hand, movement of ${movement.qtyDelta}`,
    );
  }
  return { qty, valueMinor: current.valueMinor + movement.costDeltaMinor };
}

/** The US-FR-072 acceptance check: subledger value equals the control account. */
export function inventoryTiesOut(subledgerValueMinor: Minor, controlAccountBalanceMinor: Minor): boolean {
  return subledgerValueMinor === controlAccountBalanceMinor;
}
