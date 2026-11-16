/**
 * The Bank accounts widget: each bank and card account as the Banking screens
 * show it, with one status that says what to do next.
 *
 * Pure. There is no live bank balance in OneBook, so nothing here claims one:
 * the figures beside the books are the last completed statement's ending
 * balance and the date reconciled through.
 */
import { describeStanding, daysFromTo, type BankStanding, type Money, type StandingView } from "@/lib/domain/bank-standing";
import { cardStanding, shown } from "@/lib/domain/card-account";
import type { LedgerBalance } from "@/lib/domain/reports";
import { formatDate, plural } from "@/lib/format";
import type { HomeBank, HomeBankAccount, HomeTone } from "./types";

/** An account that has had bank lines and has none for longer than this many days is shown as stale. */
export const STALE_BANK_LINES_DAYS = 45;

export type BankStatusKind = "stale" | "toCode" | "standing";

/**
 * One account's status, by priority:
 *
 * 1. no bank lines for more than 45 days on an account that has had lines:
 *    danger, "No bank lines since MM/DD/YYYY";
 * 2. lines waiting to be coded: warning, "N lines to code";
 * 3. otherwise how it stands against its statements, in the standing's tone:
 *    "Reconciliation no longer agrees", "Never reconciled" or
 *    "Reconciled through MM/DD/YYYY".
 */
export function bankAccountStatus(input: {
  linesToCode: number;
  standingView: StandingView;
  reconciledThrough: string | null;
  lastLineDate: string | null;
  asOf: string;
}): { tone: HomeTone; statusText: string; kind: BankStatusKind } {
  const { linesToCode, standingView, reconciledThrough, lastLineDate, asOf } = input;
  const quiet = lastLineDate === null ? null : daysFromTo(lastLineDate, asOf);
  if (lastLineDate !== null && quiet !== null && quiet > STALE_BANK_LINES_DAYS) {
    return { tone: "danger", statusText: `No bank lines since ${formatDate(lastLineDate)}`, kind: "stale" };
  }
  if (linesToCode > 0) {
    return { tone: "warning", statusText: `${plural(linesToCode, "line")} to code`, kind: "toCode" };
  }
  if (standingView.noLongerAgrees !== null) {
    return { tone: standingView.tone, statusText: "Reconciliation no longer agrees", kind: "standing" };
  }
  if (reconciledThrough === null) {
    return { tone: standingView.tone, statusText: "Never reconciled", kind: "standing" };
  }
  return { tone: standingView.tone, statusText: `Reconciled through ${formatDate(reconciledThrough)}`, kind: "standing" };
}

/** A bank or card account record, as the widget needs it. */
export interface HomeBankRecord {
  id: string;
  /** The ledger account behind it. */
  accountId: string;
  name: string;
  masked: string | null;
  isCard: boolean;
}

function hrefFor(kind: BankStatusKind, id: string): string {
  if (kind === "toCode") return `/banking?queue=unmatched&account=${id}`;
  if (kind === "stale") return `/banking?account=${id}`;
  return `/banking/reconcile?account=${id}`;
}

/** Debit minus credit over the bank-type rows: cash on hand, as every dashboard figure counts it. */
export function cashOnHand(rows: readonly LedgerBalance[]): number {
  return rows.filter((row) => row.accountType === "bank").reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
}

/**
 * The widget's rows, bank accounts first and cards after, each in the order
 * given. `balances` are the ledger's balances as of asOf; their bank-type
 * total is the widget's total, so it equals Cash on hand. A bank-type ledger
 * account with no bank account record behind it (the chart's Cash on Hand) is
 * in that total and reported apart as `otherCash`.
 */
export function homeBank(input: {
  records: readonly HomeBankRecord[];
  standings: readonly BankStanding[];
  linesToCode: ReadonlyMap<string, number>;
  lastLineDates: ReadonlyMap<string, string | null>;
  balances: readonly LedgerBalance[];
  asOf: string;
  money: Money;
}): HomeBank {
  const { records, asOf, money } = input;
  const standingById = new Map(input.standings.map((s) => [s.bankAccountId, s]));
  const ledgerById = new Map(input.balances.map((row) => [row.accountId, row.debitBase - row.creditBase]));

  const accounts: HomeBankAccount[] = [...records]
    .sort((a, b) => Number(a.isCard) - Number(b.isCard))
    .map((record) => {
      const side = record.isCard ? "card" : "bank";
      const raw = standingById.get(record.id);
      const standing = raw ? cardStanding(raw, side) : null;
      const linesToCode = input.linesToCode.get(record.id) ?? 0;
      const lastLineDate = input.lastLineDates.get(record.id) ?? null;
      const reconciledThrough = standing?.lastCompletedDate ?? null;
      const status = standing
        ? bankAccountStatus({ linesToCode, standingView: describeStanding(standing, asOf, money), reconciledThrough, lastLineDate, asOf })
        : bankAccountStatus({
            linesToCode,
            standingView: { tone: "neutral", text: "", noLongerAgrees: null, ageDays: null },
            reconciledThrough: null,
            lastLineDate,
            asOf,
          });
      return {
        id: record.id,
        name: record.name,
        masked: record.masked,
        isCard: record.isCard,
        bookMinor: standing ? standing.bookMinor : shown(ledgerById.get(record.accountId) ?? 0, side),
        statementMinor: standing?.lastClosingMinor ?? null,
        reconciledThrough,
        linesToCode,
        lastLineDate,
        tone: status.tone,
        statusText: status.statusText,
        href: hrefFor(status.kind, record.id),
      };
    });

  const linked = new Set(records.map((record) => record.accountId));
  const unlinked = input.balances.filter(
    (row) => row.accountType === "bank" && !linked.has(row.accountId) && row.debitBase - row.creditBase !== 0,
  );
  return {
    accounts,
    otherCash:
      unlinked.length === 0
        ? null
        : { accounts: unlinked.length, bookMinor: unlinked.reduce((sum, row) => sum + row.debitBase - row.creditBase, 0) },
    totalBookMinor: cashOnHand(input.balances),
  };
}
