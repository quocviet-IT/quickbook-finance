import { toMinorUnits } from "@/lib/format";

/**
 * Keyword and amount filters for Bank Transactions and the General Ledger
 * report (RQ-02) — the "quick way to find a transaction by amount" a user
 * asked for on a review call, on both screens by name.
 *
 * Amount matches by magnitude, not sign. A bank line of -1,250.00 is money
 * out; a person who types "1250" is looking for that line by the number
 * printed on the statement, not asserting which direction it moved — the
 * table already shows direction with color and a minus sign, and requiring a
 * typed minus to find an outgoing payment is not what was asked for. The
 * General Ledger side of this has no sign to begin with: a posted line is
 * already split into an unsigned Debit or Credit column, so "amount" there is
 * whichever of the two is nonzero.
 *
 * Both screens hold their full result set in the browser already — Bank
 * Transactions fetches every transaction for the selected account(s) and
 * paginates client-side, and the General Ledger report fetches every posted
 * line for the chosen account and date range and does the same — so filtering
 * here, before the table pages the array, narrows the real dataset rather
 * than whatever happens to be rendered on the current page.
 */

export interface AmountFilter {
  /** Minor units, or null when the box is empty / unparseable. */
  exactMinor: number | null;
  minMinor: number | null;
  maxMinor: number | null;
}

export const EMPTY_AMOUNT_FILTER: AmountFilter = {
  exactMinor: null,
  minMinor: null,
  maxMinor: null,
};

/**
 * What a person typed into an amount box ("1,250.00", "$1,250") converted to
 * integer minor units — the only form money is compared in past this edge.
 *
 * Blank or unparseable input is null, not zero: a null filter matches
 * everything, while an exact-zero filter would match only zero-amount rows.
 * The sign of what was typed is discarded, matching the magnitude decision
 * above — typing "-1250" or "1250" finds the same rows.
 */
export function parseAmountFilterInput(raw: string, decimals: number): number | null {
  const cleaned = raw.trim().replace(/[$,]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.abs(toMinorUnits(value, decimals));
}

/** True when a non-negative magnitude satisfies the exact/min/max filter. */
export function amountMagnitudeMatches(magnitudeMinor: number, filter: AmountFilter): boolean {
  if (filter.exactMinor !== null && magnitudeMinor !== filter.exactMinor) return false;
  if (filter.minMinor !== null && magnitudeMinor < filter.minMinor) return false;
  if (filter.maxMinor !== null && magnitudeMinor > filter.maxMinor) return false;
  return true;
}

/** Case-insensitive substring match across whichever fields the caller offers. */
function keywordMatches(fields: readonly (string | null | undefined)[], keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const haystack = fields
    .filter((field): field is string => Boolean(field))
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

// --- Bank Transactions ------------------------------------------------------

export interface BankTransactionFilterRow {
  description: string;
  reference: string | null;
  amount_minor: number;
}

/**
 * Description and Reference are the fields the request document names as the
 * minimum; Category, Account source, Match and Status are visible columns too
 * but none were asked for, and adding them would be exactly the kind of
 * unrequested field the document says not to assume.
 */
export function filterBankTransactions<T extends BankTransactionFilterRow>(
  rows: readonly T[],
  keyword: string,
  amount: AmountFilter,
): T[] {
  return rows.filter(
    (row) =>
      keywordMatches([row.description, row.reference], keyword) &&
      amountMagnitudeMatches(Math.abs(row.amount_minor), amount),
  );
}

// --- General Ledger ----------------------------------------------------------

export interface GeneralLedgerFilterRow {
  entryNumber: string;
  memo: string | null;
  sourceType: string;
  debitMinor: number;
  creditMinor: number;
}

/**
 * Entry number and Memo are the General Ledger's equivalent of Reference and
 * Description; Source is included because it is a visible column read the
 * same way a keyword search reads the others. A line's "amount" is whichever
 * of Debit/Credit is nonzero — a posted line never carries both at once.
 */
export function filterGeneralLedgerRows<T extends GeneralLedgerFilterRow>(
  rows: readonly T[],
  keyword: string,
  amount: AmountFilter,
): T[] {
  return rows.filter(
    (row) =>
      keywordMatches([row.entryNumber, row.memo, row.sourceType], keyword) &&
      amountMagnitudeMatches(Math.max(row.debitMinor, row.creditMinor), amount),
  );
}
