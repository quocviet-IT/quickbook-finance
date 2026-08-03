/**
 * Settling a bank line against open documents.
 *
 * These decide what a person is *offered* and whether their allocation is
 * arithmetically possible. Nothing here posts: `acc_record_payment` and
 * `acc_pay_bills` own the ledger, the period-close guard, the discount window
 * and the numbering, and `acc_settle_from_bank_transaction` re-derives the same
 * checks server-side. A client-side ranking is a convenience and never an
 * authority.
 */
import type { Minor } from "./money";
import { daysBetween } from "./settlement";

export type SettlementDirection = "receivable" | "payable";

/**
 * Which side of the ledger a bank line settles.
 *
 * `amount_minor` is signed — money in is positive — and that single fact picks
 * the whole path: which documents may be offered, which RPC posts, and which
 * subledger clears. A zero line moved no money and settles nothing.
 */
export function settlementDirection(amountMinor: Minor): SettlementDirection | null {
  if (amountMinor > 0) return "receivable";
  if (amountMinor < 0) return "payable";
  return null;
}

/** An open invoice or bill, as far as offering it against a bank line goes. */
export interface SettlementCandidate {
  documentId: string;
  documentNumber: string | null;
  /** Issue date for an invoice, bill date for a bill. */
  documentDate: string;
  balanceDueMinor: Minor;
  currencyCode: string;
}

export interface RankedCandidate<T extends SettlementCandidate = SettlementCandidate> {
  candidate: T;
  /** The balance is the bank line to the minor unit — by far the best signal. */
  exactAmount: boolean;
  /** Days between the document and the bank line; smaller is nearer. */
  dayGap: number;
}

/**
 * Open documents this bank line could be settling, best guess first.
 *
 * Currency is a filter rather than a signal: settling across currencies needs a
 * rate, and a bank matcher is the wrong place to invent one. A document with
 * nothing left owing is not a candidate either.
 *
 * Everything else is offered, because one bank line routinely pays several
 * invoices at once — a balance that does not equal the line is an ordinary
 * choice, not a wrong one. Ordering only saves scrolling.
 */
export function rankSettlementCandidates<T extends SettlementCandidate>(
  amountMinor: Minor,
  bankDate: string,
  currencyCode: string,
  candidates: readonly T[],
): RankedCandidate<T>[] {
  const size = Math.abs(amountMinor);

  return candidates
    .filter((c) => c.currencyCode === currencyCode && c.balanceDueMinor > 0)
    .map((candidate) => ({
      candidate,
      exactAmount: candidate.balanceDueMinor === size,
      dayGap: Math.abs(daysBetween(candidate.documentDate, bankDate)),
    }))
    .sort((a, b) => {
      if (a.exactAmount !== b.exactAmount) return a.exactAmount ? -1 : 1;
      if (a.dayGap !== b.dayGap) return a.dayGap - b.dayGap;
      return (a.candidate.documentNumber ?? "").localeCompare(b.candidate.documentNumber ?? "");
    });
}

/**
 * Can these allocations be paid out of this bank line?
 *
 * The bank is the authority on how much money moved, so allocations may use all
 * of it or less — the remainder stays unapplied on the customer or vendor
 * account, which both settlement RPCs already model — but never more. Every
 * allocation must be a positive amount; a zero line is a row someone forgot to
 * fill in, and an empty list settles nothing at all.
 */
export function allocationFits(amountMinor: Minor, allocations: readonly Minor[]): boolean {
  if (allocations.length === 0) return false;
  if (allocations.some((value) => value <= 0)) return false;
  const total = allocations.reduce((sum, value) => sum + value, 0);
  return total <= Math.abs(amountMinor);
}
