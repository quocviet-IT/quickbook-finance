import type { DerivedWorkItem, Severity } from "@/lib/domain/work-surface/types";

/**
 * The work Banking has, derived from the feed on every read.
 *
 * Nothing here is stored. An unmatched line is work because it is unmatched; the
 * moment somebody matches it, it stops being derived and leaves the queue on its
 * own. That is the same rule the accounting queue follows and the reason a
 * dismissal cannot make an exception go away.
 */

export type BankingSourceKind =
  | "unmatched-bank"
  | "broken-feed"
  | "open-reconciliation";

/**
 * How many unmatched lines reach the queue.
 *
 * A company with a busy feed can have hundreds, and a queue of hundreds is not a
 * list of things to do — it is a table, which is what `/banking` already is. The
 * oldest are the ones that matter, so the oldest are the ones that come here.
 *
 * **The cap is never silent**: the `unmatched-activity` control carries the true
 * total, so a reader who sees fifty rows also sees that there are two hundred
 * and twelve.
 */
export const QUEUE_UNMATCHED_LIMIT = 50;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * How urgent an unmatched line is.
 *
 * `ageLimitDays` is the company's own policy for how long a line may sit — null
 * until somebody sets it, and when it is null this falls back to age alone
 * rather than to a threshold nobody chose. The difference matters: an invented
 * limit would put "Critical" on somebody's screen on a schedule they never
 * agreed to.
 */
export function unmatchedSeverity(ageDays: number, ageLimitDays: number | null): Severity {
  if (ageLimitDays !== null) {
    if (ageDays > ageLimitDays * 2) return "critical";
    if (ageDays > ageLimitDays) return "high";
    return "medium";
  }
  // No policy: report what is true — how long it has been there — without
  // calling any of it late.
  if (ageDays >= 90) return "high";
  if (ageDays >= 30) return "medium";
  return "low";
}

export function unmatchedBankItem(
  line: {
    id: string;
    txnDate: string;
    description: string;
    amountMinor: number;
    accountName: string;
  },
  input: { ageDays: number; ageLimitDays: number | null; confirmedAt: string },
): DerivedWorkItem {
  const late =
    input.ageLimitDays !== null && input.ageDays > input.ageLimitDays
      ? `, past the ${plural(input.ageLimitDays, "day")} this company allows`
      : "";
  return {
    key: `bank-txn:${line.id}`,
    sourceKind: "unmatched-bank",
    sourceId: line.id,
    title: line.description.trim() || "Bank line with no description",
    reason: `${line.accountName} · ${line.txnDate} · unmatched for ${plural(input.ageDays, "day")}${late}`,
    severity: unmatchedSeverity(input.ageDays, input.ageLimitDays),
    // Magnitude: a line is equally unmatched whichever way the money went, and
    // the queue's last tie-breaker is "how much is at stake", not "which way".
    amountMinor: Math.abs(line.amountMinor),
    ageDays: input.ageDays,
    href: `/banking?focus=${line.id}`,
    actionLabel: "Match",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}

export function brokenFeedItem(
  connection: { id: string; institutionName: string; status: string; lastError: string | null },
  input: { ageDays: number; confirmedAt: string },
): DerivedWorkItem {
  return {
    key: `bank-feed:${connection.id}`,
    sourceKind: "broken-feed",
    sourceId: connection.id,
    title: `${connection.institutionName} is not syncing`,
    reason:
      connection.lastError?.trim() ||
      `The connection is ${connection.status}. New activity may not be arriving.`,
    severity: "high",
    ageDays: input.ageDays,
    href: "/banking",
    actionLabel: "Reconnect",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}

export function openReconciliationItem(
  session: { id: string; accountName: string; statementEndingDate: string },
  input: { ageDays: number; confirmedAt: string },
): DerivedWorkItem {
  return {
    key: `bank-recon:${session.id}`,
    sourceKind: "open-reconciliation",
    sourceId: session.id,
    title: `${session.accountName} — reconciliation left open`,
    reason: `Statement ending ${session.statementEndingDate}, started ${plural(input.ageDays, "day")} ago and never finished`,
    severity: input.ageDays >= 30 ? "high" : "medium",
    ageDays: input.ageDays,
    href: "/banking/reconcile",
    actionLabel: "Finish",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}

/**
 * There is no control-failure item builder here, and that is the difference
 * between designing this surface and copying the other one.
 *
 * The accounting queue turns a failed control into a row because a trial balance
 * that does not balance has no other representation — there is nothing smaller
 * to hand somebody. Every one of Banking's three controls is a *summary of work
 * this queue already itemises*: unmatched activity is the unmatched lines, feed
 * health is the broken feeds, statement reconciliation is the sessions left
 * open. Adding control rows would put the same work on the screen twice, once as
 * a thing to do and once as a number about the things to do.
 *
 * A consequence worth stating: nothing in Banking's queue is ever blocking, so
 * every item here can be dismissed with a reason. That is correct rather than
 * lax — dismissing an unmatched line hides the row, and the `unmatched-activity`
 * control goes on counting it.
 */
