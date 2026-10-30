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
 * Pure: the checks in, the list out.
 */
import { formatDate, plural } from "@/lib/format";
import type { HoldingRow, NoLongerAgreeRow, UnreconciledRow } from "./exceptions";
import type { TransactionListRow } from "./transaction-list";

export type AttentionKey = "waiting" | "neverReconciled" | "noLongerAgree" | "holding" | "futureDated";

export interface AttentionChecks {
  /** Bank lines not yet posted to an account: waiting on Bank Transactions. */
  waitingLines: number;
  /** Bank accounts with a balance and no completed reconciliation. */
  neverReconciled: UnreconciledRow[];
  noLongerAgree: NoLongerAgreeRow[];
  holding: HoldingRow[];
  futureDated: TransactionListRow[];
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
  return out;
}

const UNAVAILABLE_WORDS: Record<AttentionKey, string> = {
  waiting: "lines waiting on Bank Transactions",
  neverReconciled: "bank accounts never reconciled",
  noLongerAgree: "reconciliations that no longer agree",
  holding: "holding accounts",
  futureDated: "entries dated in the future",
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
export function clearLine(unavailable: readonly AttentionKey[]): string | null {
  if (unavailable.length === 0) return NOTHING_WAITING;
  return unavailable.length < Object.keys(UNAVAILABLE_WORDS).length ? "Nothing is waiting among the checks that ran." : null;
}
