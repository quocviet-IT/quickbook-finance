/**
 * Reconcile history (2.03): every bank account with the posted lines no
 * completed reconciliation holds, and, for an account never reconciled, what
 * bringing its history forward through a date would do. The rule is the
 * database's (acc_bring_history_forward): the books through the date must hold
 * exactly the statement's balance on that date, the account must never have
 * been reconciled, and a session in progress must end after the date.
 *
 * Pure: the service reads acc_reconciliation_history, the bank accounts and
 * acc_brought_forward_preview; this merges them and writes the page's
 * sentences.
 */
import type { BankStanding } from "./bank-standing";
import { entriesCount } from "./reconcile-statement";

import { formatDate } from "@/lib/format";
/** One row of acc_reconciliation_history. */
export interface ReconciliationHistoryRow {
  bankAccountId: string;
  /** Posted lines no completed reconciliation holds; a tick in a session in progress still counts. */
  openLines: number;
  /** The first and last of their dates; null when there are none. */
  firstOpenDate: string | null;
  lastOpenDate: string | null;
  /** The latest completed reconciliation's ending date; null when the account was never reconciled. */
  lastReconciledDate: string | null;
  /** The session in progress, when there is one. */
  inProgress: { id: string; endingDate: string } | null;
}

/** A bank account as Banking lists it (listBankAccounts). */
export interface HistoryBankAccount {
  id: string;
  bank_name: string;
  account_name: string;
  account_code: string;
  account_number_masked: string | null;
}

/** Never reconciled: the history can be brought forward. Reconciled: it cannot. */
export type HistoryState = "never" | "reconciled";

export interface HistoryAccount extends ReconciliationHistoryRow {
  /** "Example Bank · 1010", as Banking and the reconciliation name the account. */
  label: string;
  maskedNumber: string | null;
  state: HistoryState;
  /** Where the account stands against its statements (2.05); null or absent when it could not be read. */
  standing?: BankStanding | null;
}

/** Joins each account's standing by its id; every row is null when the standing could not be read. */
export function withStandings(
  accounts: readonly HistoryAccount[],
  standings: readonly BankStanding[] | null,
): HistoryAccount[] {
  const byId = new Map((standings ?? []).map((s) => [s.bankAccountId, s]));
  return accounts.map((account) => ({ ...account, standing: byId.get(account.bankAccountId) ?? null }));
}

/**
 * The closing under Last reconciled; null when never reconciled or the standing
 * was not read. A reconciliation with no closing recorded reads "—", never $0.00.
 */
export function historyClosingCell(
  standing: BankStanding | null | undefined,
  money: (minor: number) => string,
): { amount: string; broughtForward: boolean } | null {
  if (!standing || standing.lastCompletedDate === null) return null;
  const amount = standing.lastClosingMinor === null ? "—" : money(standing.lastClosingMinor);
  return { amount, broughtForward: standing.lastBroughtForward };
}

/**
 * The Since cell's lines: count over net, "Nothing since" for a reconciled
 * account with no activity, all its lines for a never-reconciled one, a dash
 * when the standing was not read.
 */
export function historySinceCell(standing: BankStanding | null | undefined, money: (minor: number) => string): string[] {
  if (!standing) return ["—"];
  if (standing.lastCompletedDate !== null && standing.sinceCount === 0) return ["Nothing since"];
  // As the Balance Sheet's panel says it: never reconciled, and nothing to reconcile.
  if (standing.sinceCount === 0 && standing.bookMinor === 0) return ["No activity"];
  return [entriesCount(standing.sinceCount), money(standing.sinceNetMinor)];
}

/** The open lines' dates in one cell: the first, then "– last" under it; null when there are none. */
export function historyDatedCell(first: string | null, last: string | null): string[] | null {
  if (!first && !last) return null;
  if (first && last && first !== last) return [formatDate(first), `– ${formatDate(last)}`];
  return [formatDate((first ?? last) as string)];
}

const noHistory = (bankAccountId: string): ReconciliationHistoryRow => ({
  bankAccountId,
  openLines: 0,
  firstOpenDate: null,
  lastOpenDate: null,
  lastReconciledDate: null,
  inProgress: null,
});

/**
 * One row per bank account, in the order Banking lists them. An account the
 * history does not name yet (added a moment ago) has nothing open; a history
 * row for an account this person cannot see is left out.
 */
export function historyAccounts(rows: readonly ReconciliationHistoryRow[], banks: readonly HistoryBankAccount[]): HistoryAccount[] {
  const byAccount = new Map(rows.map((row) => [row.bankAccountId, row]));
  return banks.map((bank) => {
    const row = byAccount.get(bank.id) ?? noHistory(bank.id);
    return {
      ...row,
      label: [bank.bank_name || bank.account_name, bank.account_code].filter(Boolean).join(" · "),
      maskedNumber: bank.account_number_masked,
      state: row.lastReconciledDate ? "reconciled" : "never",
    };
  });
}

/** The page, and the link to it from the Reconcile start screen. */
export const RECONCILE_HISTORY = "Reconcile history";
export const RECONCILE_HISTORY_PATH = "/banking/reconcile/history";

/** How each account's state reads in the history table. */
export const HISTORY_STATE_LABELS: Record<HistoryState, string> = {
  never: "Never reconciled",
  reconciled: "Reconciled",
};

/** The session in progress, under the state: "In progress, ending 09/30/2026". */
export function inProgressText(endingDate: string): string {
  return `In progress, ending ${formatDate(endingDate)}`;
}

/** The link beside "Finish or discard the reconciliation in progress first." */
export const OPEN_IN_PROGRESS = "Open the reconciliation in progress";

/** The words of the form "Statement balance on {date} = {amount}", around its two fields. */
export const STATEMENT_BALANCE_ON = "Statement balance on";

/**
 * The account the page opens on: the first never reconciled that has lines to
 * bring forward, else the first never reconciled, else the first. Null with no
 * accounts.
 */
export function defaultHistoryAccount(accounts: readonly Pick<HistoryAccount, "bankAccountId" | "state" | "openLines">[]): string | null {
  const never = accounts.filter((account) => account.state === "never");
  return (never.find((account) => account.openLines > 0) ?? never[0] ?? accounts[0])?.bankAccountId ?? null;
}

/**
 * Said once the history is brought forward, from the history page or from
 * inside a reconciliation. `rebasedBeginsMinor` is where a reconciliation in
 * progress now begins, when bringing forward moved it; null when none did.
 */
export function historyBroughtForwardMessage(
  lines: number,
  through: string,
  rebasedBeginsMinor: number | null,
  money: (minor: number) => string,
): string {
  const done = `Brought forward: ${entriesCount(lines)} up to ${formatDate(through)} marked reconciled. Nothing was posted to the books.`;
  return rebasedBeginsMinor === null ? done : `${done} The reconciliation in progress now begins at ${money(rebasedBeginsMinor)}.`;
}

export const FINISH_IN_PROGRESS_FIRST = "Finish or discard the reconciliation in progress first.";

/** "Reconciled up to 08/31/2026" */
export function reconciledUpTo(date: string): string {
  return `Reconciled up to ${formatDate(date)}`;
}

/** "Books on 08/31/2026 read $5,000.00 ✓" */
export function booksReadText(through: string, bookBalanceMinor: number, money: (minor: number) => string): string {
  return `Books on ${formatDate(through)} read ${money(bookBalanceMinor)} ✓`;
}

/** "Bring forward 214 entries", "Bring forward 1 entry" */
export function bringForwardEntriesLabel(entries: number): string {
  return `Bring forward ${entriesCount(entries)}`;
}

/** "Out by $100.00. Find the entry that differs, or try another statement." */
export function historyOutByText(outByMinor: number, money: (minor: number) => string): string {
  return `Out by ${money(outByMinor)}. Find the entry that differs, or try another statement.`;
}

/** The note a reconciliation brought forward from the history page keeps. */
export function historyBroughtForwardNote(balanceMinor: number, through: string, money: (minor: number) => string): string {
  return `Brought forward, proved by the statement balance of ${money(balanceMinor)} on ${formatDate(through)}`;
}

/** What the books hold through a date, as acc_brought_forward_preview reads them. */
export interface HistoryPreview {
  bookBalanceMinor: number;
  /** Posted lines through the date: what bringing the history forward marks reconciled. */
  entries: number;
}

export type HistoryAdviceKind = "reconciled" | "inProgress" | "match" | "out";

export interface HistoryAdvice {
  kind: HistoryAdviceKind;
  text: string;
  /** The button, when it may be pressed: "Bring forward 3 entries". Null otherwise. */
  action: string | null;
  entries: number;
  /** How far the books are from the statement's balance; 0 unless `kind` is "out". */
  outByMinor: number;
  /** The session in progress to finish or discard first, when it is in the way. */
  inProgressId: string | null;
}

/**
 * The live preview under "Statement balance on {date} = {amount}", checked in
 * the order the database refuses: an account already reconciled, then a session
 * in progress that ends on or before the date, then the figures. A match with
 * nothing to bring offers no button: an empty brought-forward reconciliation
 * would only close the account to bringing its history forward later.
 */
export function historyAdvice(
  account: Pick<ReconciliationHistoryRow, "lastReconciledDate" | "inProgress">,
  through: string,
  balanceMinor: number,
  preview: HistoryPreview,
  money: (minor: number) => string,
): HistoryAdvice {
  const none = { action: null, entries: preview.entries, outByMinor: 0, inProgressId: null };
  if (account.lastReconciledDate) return { ...none, kind: "reconciled", text: reconciledUpTo(account.lastReconciledDate) };
  if (account.inProgress && account.inProgress.endingDate <= through) {
    return { ...none, kind: "inProgress", text: FINISH_IN_PROGRESS_FIRST, inProgressId: account.inProgress.id };
  }
  if (preview.bookBalanceMinor !== balanceMinor) {
    const outByMinor = Math.abs(preview.bookBalanceMinor - balanceMinor);
    return { ...none, kind: "out", text: historyOutByText(outByMinor, money), outByMinor };
  }
  return {
    ...none,
    kind: "match",
    text: booksReadText(through, preview.bookBalanceMinor, money),
    action: preview.entries > 0 ? bringForwardEntriesLabel(preview.entries) : null,
  };
}
