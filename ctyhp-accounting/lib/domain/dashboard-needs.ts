/**
 * What needs someone today, on the Dashboard (2.88): the design's front door
 * ("this counts the things that are waiting, in the order they matter, and
 * takes you straight to them").
 *
 * The holding, reconciliation and future-date verdicts are the Exception
 * Report's own (lib/domain/exceptions.ts), worked out from the same reads, so
 * the Dashboard and the report cannot disagree. Two of the report's checks are
 * narrowed for a front door:
 *
 * - A bank account is listed only when it was never reconciled. The report
 *   asks about every account not reconciled through its date, which on any
 *   given day is nearly all of them.
 * - Lines waiting on Bank Transactions are counted here, which the report does
 *   not: they are posted nowhere yet, so no balance shows them.
 *
 * Two more are the Dashboard's own (2.98): recurring entries the nightly run
 * has not posted, and expense accounts already over this fiscal year's budget.
 *
 * Pure: the checks in, the list out.
 */
import { formatDate, plural } from "@/lib/format";
import type { HoldingRow, NoLongerAgreeRow, UnreconciledRow } from "./exceptions";
import type { TransactionListRow } from "./transaction-list";
import { nightsMissed } from "./backup-schedule";

export type AttentionKey =
  | "backup"
  | "waiting"
  | "recurringDue"
  | "neverReconciled"
  | "noLongerAgree"
  | "holding"
  | "futureDated"
  | "overBudget";

/** An active recurring schedule whose date has passed without the nightly run posting it. */
export interface RecurringDueRow {
  name: string;
  nextRunDate: string;
}

/** An expense account that has already spent more this fiscal year than its budget to the end of this month. */
export interface OverBudgetRow {
  accountCode: string;
  name: string;
  actualMinor: number;
  budgetMinor: number;
}

export interface AttentionChecks {
  /**
   * The company's latest snapshot date and the date it should be by now
   * (backup-schedule.ts), for someone who may see the backups (company.export);
   * absent for anyone else, who could not read them and must not be told none exist.
   */
  backup?: { lastBackup: string | null; expected: string } | null;
  /** Bank lines not yet posted to an account: waiting on Bank Transactions. */
  waitingLines: number;
  /** Recurring entries due before today that the nightly run has not posted (2.98). */
  recurringDue: RecurringDueRow[];
  /** Bank accounts with a balance and no completed reconciliation. */
  neverReconciled: UnreconciledRow[];
  noLongerAgree: NoLongerAgreeRow[];
  holding: HoldingRow[];
  futureDated: TransactionListRow[];
  /**
   * Expense accounts over budget (2.98); null when the company has no budget
   * for this fiscal year, which is not a check that could fail.
   */
  overBudget: OverBudgetRow[] | null;
  /** The checks whose reads failed: neither clear nor counted. */
  unavailable: AttentionKey[];
}

export interface DashboardNeed {
  key: AttentionKey;
  count: number;
  tone: "warning" | "danger";
  title: string;
  detail: string;
  href: string;
}

const LISTED = 3;

/** "A, B and C", or "A, B, C and 2 more". */
function named(names: readonly string[]): string {
  const shown = names.slice(0, LISTED);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** What is waiting, in the order it matters; an empty list when every check that ran came back clear. */
export function dashboardNeeds(checks: AttentionChecks, money: (minor: number) => string): DashboardNeed[] {
  const out: DashboardNeed[] = [];
  const ran = (key: AttentionKey) => !checks.unavailable.includes(key);

  // First: books nobody can restore are the one thing here that cannot wait (2.90).
  const missed = checks.backup ? nightsMissed(checks.backup.lastBackup, checks.backup.expected) : 0;
  if (ran("backup") && checks.backup && missed > 0) {
    out.push({
      key: "backup",
      count: missed,
      tone: "danger",
      title: "Backup overdue",
      detail:
        checks.backup.lastBackup === null
          ? "These books have never been backed up by the nightly run."
          : `The last snapshot of these books is from ${formatDate(checks.backup.lastBackup)}; one was due on ${formatDate(checks.backup.expected)}.`,
      href: "/settings/backups",
    });
  }

  if (ran("waiting") && checks.waitingLines > 0) {
    out.push({
      key: "waiting",
      count: checks.waitingLines,
      tone: "warning",
      title: "Bank lines waiting to be coded",
      detail: "Not yet posted to an account, so neither the Profit and Loss nor the Balance Sheet shows them.",
      href: "/banking?queue=unmatched",
    });
  }
  if (ran("recurringDue") && checks.recurringDue.length > 0) {
    out.push({
      key: "recurringDue",
      count: checks.recurringDue.length,
      tone: "warning",
      title: checks.recurringDue.length === 1 ? "Recurring entry not posted" : "Recurring entries not posted",
      detail: `Due and not posted by the nightly run: ${named(
        checks.recurringDue.map((row) => `${row.name} on ${formatDate(row.nextRunDate)}`),
      )}. The schedule says why when a run failed.`,
      href: "/recurring",
    });
  }
  if (ran("neverReconciled") && checks.neverReconciled.length > 0) {
    out.push({
      key: "neverReconciled",
      count: checks.neverReconciled.length,
      tone: "warning",
      title: checks.neverReconciled.length === 1 ? "Bank account never reconciled" : "Bank accounts never reconciled",
      detail: `A balance nobody has proved against a statement: ${named(
        checks.neverReconciled.map((row) => `${row.accountName} (${money(row.balanceMinor)})`),
      )}.`,
      href: "/banking/reconcile/history",
    });
  }
  if (ran("noLongerAgree") && checks.noLongerAgree.length > 0) {
    out.push({
      key: "noLongerAgree",
      count: checks.noLongerAgree.length,
      tone: "danger",
      title: checks.noLongerAgree.length === 1 ? "Reconciliation that no longer agrees" : "Reconciliations that no longer agree",
      detail: `Something ticked on ${named(
        checks.noLongerAgree.map((row) => `${row.accountName} to ${formatDate(row.statementEndingDate)}`),
      )} has changed since it was signed off.`,
      href: "/reports/exceptions",
    });
  }
  if (ran("holding") && checks.holding.length > 0) {
    out.push({
      key: "holding",
      count: checks.holding.length,
      tone: "warning",
      title: "Money in a holding account",
      detail: `Still sitting in ${named(
        checks.holding.map((row) => `${row.accountCode} ${row.name} (${money(Math.abs(row.balanceMinor))})`),
      )} rather than where it belongs.`,
      href: "/reports/exceptions",
    });
  }
  if (ran("futureDated") && checks.futureDated.length > 0) {
    out.push({
      key: "futureDated",
      count: checks.futureDated.length,
      tone: "warning",
      title: checks.futureDated.length === 1 ? "Entry dated in the future" : "Entries dated in the future",
      detail: `Usually a typing slip in the year: ${named(
        checks.futureDated.map((row) => `${row.entryNumber} on ${formatDate(row.entryDate)}`),
      )}.`,
      href: "/reports/exceptions",
    });
  }
  if (ran("overBudget") && checks.overBudget && checks.overBudget.length > 0) {
    out.push({
      key: "overBudget",
      count: checks.overBudget.length,
      tone: "warning",
      title: checks.overBudget.length === 1 ? "Account over budget" : "Accounts over budget",
      detail: `Spent more this fiscal year than budgeted to the end of this month: ${named(
        checks.overBudget.map(
          (row) => `${row.accountCode} ${row.name} (${money(row.actualMinor)} of ${money(row.budgetMinor)})`,
        ),
      )}.`,
      href: "/reports?report=budget",
    });
  }
  return out;
}

/**
 * The expense accounts already over budget: spent from the first day of the
 * fiscal year to today, against what is budgeted from then to the end of this
 * month. Comparing with the whole month's budget means an account is named
 * only once it has gone over what the month allows, never for being early in
 * its spending. Biggest overrun first. Income under budget is not "over".
 */
export function overBudgetAccounts(
  budget: readonly { accountId: string; accountCode: string; name: string; accountType: string; amountMinor: number }[],
  actual: readonly { accountId: string; debitBase: number; creditBase: number }[],
): OverBudgetRow[] {
  const spent = new Map(actual.map((row) => [row.accountId, Number(row.debitBase) - Number(row.creditBase)]));
  return budget
    .filter((row) => EXPENSE_TYPES.has(row.accountType) && row.amountMinor > 0)
    .map((row) => ({
      accountCode: row.accountCode,
      name: row.name,
      actualMinor: spent.get(row.accountId) ?? 0,
      budgetMinor: row.amountMinor,
    }))
    .filter((row) => row.actualMinor > row.budgetMinor)
    .sort((a, b) => b.actualMinor - b.budgetMinor - (a.actualMinor - a.budgetMinor) || a.accountCode.localeCompare(b.accountCode));
}

const EXPENSE_TYPES = new Set(["expense", "cost_of_goods_sold", "other_expense"]);

const UNAVAILABLE_WORDS: Record<AttentionKey, string> = {
  backup: "the last backup",
  waiting: "lines waiting on Bank Transactions",
  recurringDue: "recurring entries not posted",
  neverReconciled: "bank accounts never reconciled",
  noLongerAgree: "reconciliations that no longer agree",
  holding: "holding accounts",
  futureDated: "entries dated in the future",
  overBudget: "accounts over budget",
};

/** Said under the list when a check could not run: it is neither clear nor counted. */
export function unavailableNote(unavailable: readonly AttentionKey[]): string | null {
  if (unavailable.length === 0) return null;
  return `${plural(unavailable.length, "check")} could not run just now, so ${named(
    unavailable.map((key) => UNAVAILABLE_WORDS[key]),
  )} ${unavailable.length === 1 ? "is" : "are"} not counted here.`;
}

/** Said when every check ran and found nothing. */
export const NOTHING_WAITING = "Nothing is waiting. Every check came back clear.";

/** Said when nothing could be checked at all. */
export const CHECKS_FAILED = "The checks could not be read just now. The Exception report runs them in full.";

/** The clear line: only a check that ran can come back clear. */
export function clearLine(checks: Pick<AttentionChecks, "unavailable" | "backup">): string | null {
  const unavailable = checks.unavailable;
  if (unavailable.length === 0) return NOTHING_WAITING;
  // The backup check is only made for someone who may see the backups.
  const made = Object.keys(UNAVAILABLE_WORDS).length - (checks.backup === undefined ? 1 : 0);
  return unavailable.length < made ? "Nothing is waiting among the checks that ran." : null;
}
