/**
 * Month-by-month figures from the two ledger reads the Dashboard makes: the
 * cumulative balances the day before its window opens, and each month's
 * activity after that (`getMonthlyLedgerBalances`).
 *
 * Pure. A month with no postings has no key in `byMonth`; it adds nothing to a
 * balance and moves nothing, which is what the books say about it. Whether
 * such a month was entered at all is `markPosted`'s question, not a zero's.
 */
import { naturalBalance, type AccountType } from "@/lib/domain/accounts";
import type { LedgerBalance } from "@/lib/domain/reports";
import type { HomeMonth } from "./types";
import { monthKeyOf } from "./ranges";

type MonthKeyed = { key: string };

function netOf(rows: readonly LedgerBalance[] | undefined, types: ReadonlySet<AccountType>): number {
  let sum = 0;
  for (const row of rows ?? []) {
    if (types.has(row.accountType)) sum += naturalBalance(row.accountType, row.debitBase, row.creditBase);
  }
  // `|| 0`: a credit-normal account holding nothing nets to -0.
  return sum || 0;
}

/**
 * The balance at the end of each month, for the given account types, starting
 * from the cumulative `opening` rows (balances the day before `months[0]`
 * begins). `months` must be consecutive, oldest first.
 *
 * Each row is signed by its type's normal side (`naturalBalance`), as the
 * reports sign it: bank and receivables are debit minus credit, payables
 * credit minus debit, so what is owed to the company and what it owes both
 * read positive.
 */
export function monthEndBalances(
  opening: readonly LedgerBalance[],
  byMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
  months: readonly MonthKeyed[],
  accountTypes: readonly AccountType[],
): number[] {
  const types = new Set(accountTypes);
  let running = netOf(opening, types);
  return months.map((month) => {
    running += netOf(byMonth.get(month.key), types);
    return running;
  });
}

/** Gross debits and gross credits to the given account types, per month. */
export function monthMovement(
  byMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
  months: readonly MonthKeyed[],
  accountTypes: readonly AccountType[],
): { debitMinor: number[]; creditMinor: number[] } {
  const types = new Set(accountTypes);
  const debitMinor: number[] = [];
  const creditMinor: number[] = [];
  for (const month of months) {
    let debit = 0;
    let credit = 0;
    for (const row of byMonth.get(month.key) ?? []) {
      if (!types.has(row.accountType)) continue;
      debit += row.debitBase;
      credit += row.creditBase;
    }
    debitMinor.push(debit);
    creditMinor.push(credit);
  }
  return { debitMinor, creditMinor };
}

/**
 * Each month, marked posted or not. A month is not posted when it starts
 * after the month of the last posted entry and has no ledger activity: not a
 * month of zeros, a month nobody has entered yet. A quiet month before the
 * last posted entry is posted: its zero is real. With nothing posted at all,
 * only a month with activity counts.
 */
export function markPosted(
  months: readonly { key: string; label: string; year: number }[],
  postedThrough: string | null,
  byMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
): HomeMonth[] {
  const lastPosted = postedThrough === null ? null : monthKeyOf(postedThrough);
  return months.map((month) => ({
    key: month.key,
    label: month.label,
    year: month.year,
    posted: (lastPosted !== null && month.key <= lastPosted) || (byMonth.get(month.key)?.length ?? 0) > 0,
  }));
}

/**
 * Several reads' rows as one: debits and credits summed per account. A range
 * made of whole months is the sum of those months' activity.
 */
export function sumLedgerRows(lists: readonly (readonly LedgerBalance[] | undefined)[]): LedgerBalance[] {
  const byAccount = new Map<string, LedgerBalance>();
  for (const rows of lists) {
    for (const row of rows ?? []) {
      const seen = byAccount.get(row.accountId);
      if (seen) {
        seen.debitBase += row.debitBase;
        seen.creditBase += row.creditBase;
      } else {
        byAccount.set(row.accountId, { ...row });
      }
    }
  }
  return [...byAccount.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/** False when nothing was posted in the rows: every account's debits and credits are zero. */
export function hasActivity(rows: readonly LedgerBalance[]): boolean {
  return rows.some((row) => row.debitBase !== 0 || row.creditBase !== 0);
}
