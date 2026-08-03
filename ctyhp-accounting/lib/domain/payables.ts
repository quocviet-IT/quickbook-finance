/**
 * Payables rules that decide money, kept out of the screen so they can be
 * tested with concrete numbers.
 */
import type { Minor } from "./money";

/** One open bill, as far as spreading a payment across bills is concerned. */
export interface OpenBillAllocation {
  billId: string;
  balanceDueMinor: Minor;
  /**
   * The early payment discount already chosen for this bill, or 0. Choosing it
   * is the user's call and is made before this runs; this only decides how much
   * cash each bill takes.
   */
  discountMinor: Minor;
}

/**
 * Spread a payment across open bills in the order given, oldest first.
 *
 * A discounted bill is all-or-nothing. `acc_pay_bills` only checks that
 * payment + discount does not exceed the balance, so a partial payment carrying
 * the whole discount would be accepted — and would relieve more payable than
 * the early payment actually earned. Rather than claim a discount that was not
 * earned, a bill that cannot be settled in full is skipped and the cash goes to
 * the next one. A bill with no discount takes whatever is left, part-paid.
 *
 * Whole minor units throughout; a bill allocated nothing is left out entirely.
 */
export function allocateAcrossBills(
  paymentMinor: Minor,
  bills: readonly OpenBillAllocation[],
): Record<string, Minor> {
  const allocation: Record<string, Minor> = {};
  let remaining = Math.trunc(paymentMinor);

  for (const bill of bills) {
    if (remaining <= 0) break;
    if (bill.balanceDueMinor <= 0) continue;

    const cashToSettle = bill.balanceDueMinor - bill.discountMinor;
    if (cashToSettle <= 0) continue;

    if (bill.discountMinor > 0) {
      if (remaining < cashToSettle) continue;
      allocation[bill.billId] = cashToSettle;
      remaining -= cashToSettle;
      continue;
    }

    const take = Math.min(remaining, cashToSettle);
    allocation[bill.billId] = take;
    remaining -= take;
  }

  return allocation;
}
