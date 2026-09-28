/**
 * The working-paper trial balance of the client's prototype
 * (`reportWorkingPapers` in Accounting-System-v3.html): what the books said
 * before anyone adjusted them, what was adjusted, and what they say now.
 *
 * "An entry counts as an adjustment because somebody marked it one — not
 * because of its date or its shape." The marks come in as `adjusting`; nothing
 * here infers one.
 *
 * Pure: it receives balances already read and returns rows. It imports nothing
 * from `@/lib/db` or `@/lib/services`, and a test fails if that changes.
 * Figures are signed, debit positive, in base-currency minor units.
 */

import { statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import type { LedgerBalance } from "@/lib/domain/reports";

export const RETAINED_EARNINGS_KEY = "retained-earnings-before-period";
export const RETAINED_EARNINGS_LABEL = "Retained earnings — before this period";

/** One posting of an adjusting entry, in base currency as `acc_ledger_balances` reads it. */
export interface AdjustingLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitBase: number;
  creditBase: number;
}

/** A posted entry somebody marked adjusting. */
export interface AdjustingEntry {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  /** Who it was with: the customer or vendor, or else the description. */
  name: string;
  /** "Why it was adjusted". Null when nobody wrote one. */
  note: string | null;
  lines: AdjustingLine[];
}

export interface WorkingTrialBalanceInput {
  from: string;
  to: string;
  /** `acc_ledger_balances(null, from − 1 day)`. */
  before: readonly LedgerBalance[];
  /** `acc_ledger_balances(from, to)`: every posted movement in the range. */
  movements: readonly LedgerBalance[];
  /** Posted entries marked adjusting. Any dated outside the range are ignored. */
  adjusting: readonly AdjustingEntry[];
}

export interface WtbRow {
  /** The account id, or RETAINED_EARNINGS_KEY. */
  key: string;
  /** Null on the retained-earnings line, which is no single account. */
  accountId: string | null;
  accountCode: string;
  name: string;
  unadjusted: number;
  adjustment: number;
  adjusted: number;
}

export interface WtbTotals {
  unadjustedDebit: number;
  unadjustedCredit: number;
  adjustmentDebit: number;
  adjustmentCredit: number;
  adjustedDebit: number;
  adjustedCredit: number;
}

/** One posting in "The adjustments", the list under the table. */
export interface AjeRow {
  key: string;
  entryId: string;
  /** The entry's first posting, which carries its number, date, name and why. */
  first: boolean;
  number: string | null;
  date: string | null;
  name: string | null;
  account: string;
  debit: number;
  credit: number;
  why: string | null;
}

export interface WorkingTrialBalance {
  from: string;
  to: string;
  rows: WtbRow[];
  totals: WtbTotals;
  /** The prototype's check: debits equal credits in all three column pairs. */
  balanced: boolean;
  /** Rows that are accounts — the retained-earnings line is not one. */
  accountCount: number;
  adjustingEntryCount: number;
  adjustments: AjeRow[];
}

interface AccountMeta {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
}

const signed = (b: Pick<LedgerBalance, "debitBase" | "creditBase">) => b.debitBase - b.creditBase;

function addTo(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function totalsOf(rows: readonly WtbRow[]): WtbTotals {
  const debit = (v: number) => Math.max(v, 0);
  const credit = (v: number) => Math.max(-v, 0);
  return rows.reduce<WtbTotals>(
    (t, r) => ({
      unadjustedDebit: t.unadjustedDebit + debit(r.unadjusted),
      unadjustedCredit: t.unadjustedCredit + credit(r.unadjusted),
      adjustmentDebit: t.adjustmentDebit + debit(r.adjustment),
      adjustmentCredit: t.adjustmentCredit + credit(r.adjustment),
      adjustedDebit: t.adjustedDebit + debit(r.adjusted),
      adjustedCredit: t.adjustedCredit + credit(r.adjusted),
    }),
    { unadjustedDebit: 0, unadjustedCredit: 0, adjustmentDebit: 0, adjustmentCredit: 0, adjustedDebit: 0, adjustedCredit: 0 },
  );
}

/** "The adjustments": one row per posting, numbered AJE 1, AJE 2 … in date order. */
function adjustmentRows(entries: readonly AdjustingEntry[]): AjeRow[] {
  return entries.flatMap((e, i) =>
    e.lines.map((l, k) => ({
      key: `${e.entryId}:${k}`,
      entryId: e.entryId,
      first: k === 0,
      number: k === 0 ? `AJE ${i + 1}` : null,
      date: k === 0 ? e.entryDate : null,
      name: k === 0 ? e.name : null,
      account: `${l.accountCode} ${l.accountName}`.trim(),
      debit: l.debitBase,
      credit: l.creditBase,
      why: k === 0 ? e.note?.trim() || e.description?.trim() || "" : null,
    })),
  );
}

export function buildWorkingTrialBalance(input: WorkingTrialBalanceInput): WorkingTrialBalance {
  const adjusting = input.adjusting
    .filter((e) => e.entryDate >= input.from && e.entryDate <= input.to)
    .sort((x, y) => x.entryDate.localeCompare(y.entryDate) || x.entryNumber.localeCompare(y.entryNumber));

  const meta = new Map<string, AccountMeta>();
  const remember = (m: AccountMeta) => {
    if (!meta.has(m.accountId)) meta.set(m.accountId, m);
  };
  const carried = new Map<string, number>();
  const movement = new Map<string, number>();
  const adjustment = new Map<string, number>();
  let retained = 0;

  for (const b of input.before) {
    remember(b);
    // The prototype carries the balance sheet forward and starts income and
    // expense afresh. OneBook posts no closing entry, so what those accounts
    // earned before the range is carried on one line instead (see the spec, §7).
    if (statementSectionOf(b.accountType) === "balance_sheet") addTo(carried, b.accountId, signed(b));
    else retained += signed(b);
  }
  for (const b of input.movements) {
    remember(b);
    addTo(movement, b.accountId, signed(b));
  }
  for (const e of adjusting) {
    for (const l of e.lines) {
      remember({ accountId: l.accountId, accountCode: l.accountCode, name: l.accountName, accountType: l.accountType });
      addTo(adjustment, l.accountId, l.debitBase - l.creditBase);
    }
  }

  const rowOf = (m: AccountMeta): WtbRow => {
    const adj = adjustment.get(m.accountId) ?? 0;
    const unadjusted = (carried.get(m.accountId) ?? 0) + (movement.get(m.accountId) ?? 0) - adj;
    return {
      key: m.accountId,
      accountId: m.accountId,
      accountCode: m.accountCode,
      name: m.name,
      unadjusted,
      adjustment: adj,
      adjusted: unadjusted + adj,
    };
  };
  const shown = (r: WtbRow) => r.unadjusted !== 0 || r.adjustment !== 0 || r.adjusted !== 0;
  const inSection = (section: "balance_sheet" | "profit_and_loss") =>
    [...meta.values()]
      .filter((m) => statementSectionOf(m.accountType) === section)
      .sort((x, y) => x.accountCode.localeCompare(y.accountCode))
      .map(rowOf)
      .filter(shown);

  const balanceSheet = inSection("balance_sheet");
  const profitAndLoss = inSection("profit_and_loss");
  const retainedRow: WtbRow[] =
    retained === 0
      ? []
      : [
          {
            key: RETAINED_EARNINGS_KEY,
            accountId: null,
            accountCode: "",
            name: RETAINED_EARNINGS_LABEL,
            unadjusted: retained,
            adjustment: 0,
            adjusted: retained,
          },
        ];
  const rows = [...balanceSheet, ...retainedRow, ...profitAndLoss];
  const totals = totalsOf(rows);

  return {
    from: input.from,
    to: input.to,
    rows,
    totals,
    balanced:
      totals.unadjustedDebit === totals.unadjustedCredit &&
      totals.adjustmentDebit === totals.adjustmentCredit &&
      totals.adjustedDebit === totals.adjustedCredit,
    accountCount: balanceSheet.length + profitAndLoss.length,
    adjustingEntryCount: adjusting.length,
    adjustments: adjustmentRows(adjusting),
  };
}
