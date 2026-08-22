import type { SurfaceControl } from "@/lib/domain/work-surface/types";

/**
 * What Banking checks about itself, and when each check has passed.
 *
 * Three, not seven. The accounting surface has a trial balance and three
 * subledgers because that is what an accountant ties out; Banking has none of
 * those and would be inventing work to display them. Its job — the one the
 * design document gives it — is *unmatched activity and reconciliation*, so
 * these are the three things that can be true or false about that.
 *
 * Pure by design: every builder takes plain numbers and dates, so the rules can
 * be read and tested without a database. Two rules run through all of them, the
 * same two that govern every surface:
 *
 *   a control that could not be computed is `unavailable`, never `healthy` —
 *   "we did not look" and "nothing is wrong" are opposite answers;
 *
 *   every status carries a sentence and a pass condition, so the screen never
 *   has to make a colour do the explaining.
 */

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export type BankingControlKey =
  | "unmatched-activity"
  | "feed-health"
  | "statement-reconciliation";

/**
 * Every imported line is either matched or deliberately set aside.
 *
 * **The one blocking check on this surface.** A reconciliation cannot honestly
 * complete while activity dated inside it is still unaccounted for — which is
 * the same reason the accounting surface refuses to close a period over a
 * variance.
 *
 * Pending lines are excluded, and that is not leniency: a pending card
 * authorisation has not settled, its amount can still change, and matching it
 * would be matching a figure the bank has not committed to.
 */
export function unmatchedActivityControl(input: {
  asOf: string;
  /** Null when the transactions could not be counted at all. */
  unmatchedCount: number | null;
  oldestAgeDays: number | null;
  pendingCount: number;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "unmatched-activity" as const,
    title: "Imported activity is accounted for",
    passCondition: `Every settled line dated on or before ${input.asOf} is matched or set aside.`,
    evaluatedAt: input.evaluatedAt,
    href: "/banking",
    blocking: true,
  };
  if (input.unmatchedCount === null) {
    return {
      ...base,
      status: "unavailable",
      detail: "The bank transactions could not be counted, so nothing here is proven.",
    };
  }
  const pendingNote =
    input.pendingCount === 0
      ? ""
      : ` ${plural(input.pendingCount, "pending line")} excluded — they have not settled.`;
  if (input.unmatchedCount === 0) {
    return {
      ...base,
      status: "healthy",
      detail: `Every settled line is matched or set aside.${pendingNote}`,
    };
  }
  const waited =
    input.oldestAgeDays === null
      ? ""
      : ` The oldest has waited ${plural(input.oldestAgeDays, "day")}.`;
  return {
    ...base,
    status: "blocked",
    detail: `${plural(input.unmatchedCount, "line")} still unmatched.${waited}${pendingNote}`,
  };
}

/**
 * The feeds are connected and syncing.
 *
 * Not applicable when a company imports its statements by file — which is a
 * legitimate way to run, not a degraded one, and reporting it as a failed check
 * would be telling somebody to fix a choice they made.
 */
export function feedHealthControl(input: {
  /** Null when the connections could not be read. */
  connectionCount: number | null;
  brokenCount: number;
  brokenNames: readonly string[];
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "feed-health" as const,
    title: "Bank feeds are connected",
    passCondition: "Every connected feed is active and reported no error on its last sync.",
    evaluatedAt: input.evaluatedAt,
    href: "/banking",
    // A broken feed stops new activity arriving; it does not make what has
    // already arrived wrong. Work, not a control failure.
    blocking: false,
  };
  if (input.connectionCount === null) {
    return {
      ...base,
      status: "unavailable",
      detail: "The bank connections could not be read.",
    };
  }
  if (input.connectionCount === 0) {
    return {
      ...base,
      status: "healthy",
      detail: "No feed is connected — this company brings its statements in by file.",
      passCondition: "Applies only once a bank feed is connected.",
    };
  }
  if (input.brokenCount === 0) {
    return {
      ...base,
      status: "healthy",
      detail: `${plural(input.connectionCount, "feed")} connected, none reporting a problem.`,
    };
  }
  return {
    ...base,
    status: "attention",
    detail: `${plural(input.brokenCount, "feed")} need attention: ${input.brokenNames.join(", ")}. New activity may not be arriving.`,
  };
}

/**
 * Each account has been reconciled, and recently enough to be worth something.
 *
 * `staleBefore` is the date a reconciliation has to reach to count as current —
 * supplied by the caller, because "recently enough" is a question about the
 * calendar rather than about banking, and this file does not own a clock.
 */
export function statementReconciliationControl(input: {
  /** Null when the accounts or sessions could not be read. */
  accountCount: number | null;
  /** Accounts with no completed reconciliation reaching `staleBefore`. */
  behindNames: readonly string[];
  inProgressCount: number;
  staleBefore: string;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "statement-reconciliation" as const,
    title: "Statements are reconciled",
    passCondition: `Every account has a completed reconciliation reaching ${input.staleBefore}.`,
    evaluatedAt: input.evaluatedAt,
    href: "/banking/reconcile",
    blocking: false,
  };
  if (input.accountCount === null) {
    return {
      ...base,
      status: "unavailable",
      detail: "The reconciliation sessions could not be read.",
    };
  }
  if (input.accountCount === 0) {
    return {
      ...base,
      status: "healthy",
      detail: "This company keeps no bank account in One Book.",
      passCondition: "Applies once a bank account exists.",
    };
  }
  const openNote =
    input.inProgressCount === 0
      ? ""
      : ` ${plural(input.inProgressCount, "session")} left open part-way through.`;
  if (input.behindNames.length === 0) {
    return {
      ...base,
      status: input.inProgressCount === 0 ? "healthy" : "attention",
      detail: `Every account is reconciled through ${input.staleBefore}.${openNote}`,
    };
  }
  return {
    ...base,
    status: "attention",
    detail: `${plural(input.behindNames.length, "account")} not reconciled through ${input.staleBefore}: ${input.behindNames.join(", ")}.${openNote}`,
  };
}
