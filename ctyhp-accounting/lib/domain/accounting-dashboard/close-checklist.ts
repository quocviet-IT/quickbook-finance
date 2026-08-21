/**
 * What has to be true before a period can be closed, and whether it is.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md
 * Plan: docs/superpowers/plans/2026-08-21-accounting-cockpit-phase4.md
 *
 * Two rules run through everything here, and they are the reason this file is
 * pure.
 *
 * **Every step is evaluated at the period's end date, never today.** The daily
 * control strip answers "are the books safe right now"; a close checklist
 * answers "were the books safe on the thirty-first". Those come apart in both
 * directions — a correcting entry posted in April makes March tie today when it
 * did not then, and April's unpaid invoices make March look out when it was
 * fine. Reusing today's answer would be wrong roughly half the time and would
 * look right every time.
 *
 * **No step can be ticked.** There is no state to set, here or anywhere: a step
 * is complete because the ledger, the reconciliation or the approval queue says
 * so. The spec asks for that as a prohibition (Phase 4, work item 6); it is
 * enforced by there being nothing to store.
 */

export type CloseStepStatus = "complete" | "outstanding" | "not-applicable" | "unavailable";

export interface CloseStep {
  key: string;
  title: string;
  status: CloseStepStatus;
  /** What being complete means, in one sentence. */
  passCondition: string;
  /** The figures this status was reached from, so the reader can check it. */
  evidence: string;
  /** True when this step failing stops `acc_close_period` closing the period. */
  blocksClose: boolean;
  href: string;
  /**
   * The work queue key this step corresponds to, when one exists — which is
   * how the person holding the blocker gets onto the same row as the blocker.
   */
  workKey: string | null;
}

export interface CloseProgress {
  complete: number;
  outstanding: number;
  notApplicable: number;
  unavailable: number;
  /** The steps this company actually has to do: complete + outstanding. */
  applicable: number;
  /** Null when nothing applies — a percentage of nothing is not zero. */
  percent: number | null;
}

/**
 * Count the steps by what they are.
 *
 * `complete + outstanding === applicable` is an invariant of this function and
 * is asserted in the tests, because the spec's acceptance criterion is exactly
 * that overall progress reconciles to the status of each included step.
 *
 * A step nobody could check counts as neither. It is not progress, and it is
 * not a failure — but a bar reading "5 of 7" while one check never ran is the
 * kind of quiet falsehood this dashboard exists to stop, so it is counted and
 * reported separately rather than folded into either side.
 */
export function closeProgress(steps: readonly CloseStep[]): CloseProgress {
  const count = (status: CloseStepStatus) => steps.filter((s) => s.status === status).length;
  const complete = count("complete");
  const outstanding = count("outstanding");
  const applicable = complete + outstanding;
  return {
    complete,
    outstanding,
    notApplicable: count("not-applicable"),
    unavailable: count("unavailable"),
    applicable,
    percent: applicable === 0 ? null : Math.round((complete / applicable) * 100),
  };
}

/**
 * The steps standing in the way, hardest first.
 *
 * Blocking before advisory, because an accountant looking for "what is stopping
 * me" should not have to read past a draft bill to reach a trial balance that
 * does not balance. That ordering is what makes the spec's ten-second criterion
 * reachable at all.
 */
export function blockingFirst(steps: readonly CloseStep[]): CloseStep[] {
  const rank = (step: CloseStep) => {
    if (step.status === "outstanding") return step.blocksClose ? 0 : 1;
    if (step.status === "unavailable") return 2;
    if (step.status === "not-applicable") return 4;
    return 3;
  };
  return [...steps].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

// --- Step builders ---------------------------------------------------------
//
// Each one takes plain numbers and returns a step. No client, no dates read
// from a clock: given the same figures they give the same answer, which is what
// makes the rules above testable without a database.

function money(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function trialBalanceStep(input: {
  periodEnd: string;
  /** Null when the ledger could not be read at all. */
  differenceMinor: number | null;
}): CloseStep {
  const base = {
    key: "trial-balance",
    title: "The trial balance balances",
    passCondition: `Posted debits equal posted credits through ${input.periodEnd}.`,
    blocksClose: true,
    href: `/reports?report=trial&asOf=${input.periodEnd}`,
    workKey: "control:trial-balance",
  };
  if (input.differenceMinor === null) {
    return {
      ...base,
      status: "unavailable",
      evidence: "The ledger could not be read at the period end, so nothing here is proven.",
    };
  }
  return {
    ...base,
    status: input.differenceMinor === 0 ? "complete" : "outstanding",
    evidence:
      input.differenceMinor === 0
        ? `Debits and credits agree at ${input.periodEnd}.`
        : `Debits and credits differ by ${money(input.differenceMinor)} at ${input.periodEnd}.`,
  };
}

/**
 * One step per control account, from the same figures the close gate loops
 * over.
 *
 * The applicability rule is copied from `acc_period_close_blockers`, not
 * invented: that function treats a control with no subledger as being out by
 * its whole balance. So no subledger *and* a zero control account means the
 * company does not have this thing at all — not applicable. No subledger and a
 * balance means somebody posted to the control account directly, which is a
 * blocker there and must be outstanding here, or the screen would promise a
 * close the database is going to refuse.
 */
export function controlAccountStep(input: {
  controlKey: string;
  label: string;
  hasSubledger: boolean;
  subledgerMinor: number;
  controlMinor: number;
  periodEnd: string;
}): CloseStep {
  const variance = input.hasSubledger
    ? input.subledgerMinor - input.controlMinor
    : input.controlMinor;
  const base = {
    key: `control:${input.controlKey}`,
    title: `${input.label} ties to the ledger`,
    passCondition: `The ${input.label.toLowerCase()} subledger equals its control account at ${input.periodEnd}.`,
    blocksClose: true,
    href: "/reports/gl-posting",
    workKey: null,
  };

  if (!input.hasSubledger && input.controlMinor === 0) {
    return {
      ...base,
      status: "not-applicable",
      evidence: `This company has no ${input.label.toLowerCase()} to tie out, and the control account is empty.`,
    };
  }

  if (variance === 0) {
    return {
      ...base,
      status: "complete",
      evidence: `Both sides read ${money(input.controlMinor)} at ${input.periodEnd}.`,
    };
  }

  return {
    ...base,
    status: "outstanding",
    evidence: input.hasSubledger
      ? `The subledger reads ${money(input.subledgerMinor)} and the control account ${money(input.controlMinor)} — out by ${money(variance)}.`
      : `The control account holds ${money(input.controlMinor)} with nothing behind it to tie out against.`,
  };
}

export function draftDocumentsStep(input: {
  periodStart: string;
  periodEnd: string;
  /** Null when the documents could not be counted. */
  draftCount: number | null;
}): CloseStep {
  const base = {
    key: "drafts-posted",
    title: "Everything in the period is posted",
    passCondition: `No invoice or bill dated between ${input.periodStart} and ${input.periodEnd} is still a draft.`,
    // A draft has not posted, so it cannot put the ledger out and the database
    // will not refuse the close over it. It is still a reason the period's
    // figures are not final, which is why it is on the list at all.
    blocksClose: false,
    href: "/invoices?status=draft",
    workKey: null,
  };
  if (input.draftCount === null) {
    return { ...base, status: "unavailable", evidence: "The documents could not be counted." };
  }
  return {
    ...base,
    status: input.draftCount === 0 ? "complete" : "outstanding",
    evidence:
      input.draftCount === 0
        ? "Every invoice and bill dated in this period has posted."
        : `${plural(input.draftCount, "document")} dated in this period ${input.draftCount === 1 ? "is" : "are"} still a draft, so the period's figures are not final.`,
  };
}

export function bankReconciledStep(input: {
  periodEnd: string;
  /** False when the company keeps no bank account at all. */
  hasBankAccount: boolean | null;
  lastCompletedOn: string | null;
  unmatchedCount: number | null;
}): CloseStep {
  const base = {
    key: "bank-reconciled",
    title: "The bank is reconciled through the period end",
    passCondition: `A completed reconciliation covers ${input.periodEnd} and no line before it is unmatched.`,
    blocksClose: false,
    href: "/banking/reconcile",
    workKey: "control:bank-reconciliation",
  };
  if (input.hasBankAccount === null || input.unmatchedCount === null) {
    return { ...base, status: "unavailable", evidence: "The banking tables did not answer." };
  }
  if (!input.hasBankAccount) {
    return {
      ...base,
      status: "not-applicable",
      evidence: "This company keeps no bank account in One Book.",
    };
  }
  const reconciled = input.lastCompletedOn !== null && input.lastCompletedOn >= input.periodEnd;
  if (reconciled && input.unmatchedCount === 0) {
    return {
      ...base,
      status: "complete",
      evidence: `Reconciled through ${input.lastCompletedOn}, with nothing unmatched on or before ${input.periodEnd}.`,
    };
  }
  const parts = [
    reconciled
      ? `Reconciled through ${input.lastCompletedOn}.`
      : input.lastCompletedOn === null
        ? "No completed reconciliation on record."
        : `The last reconciliation ends ${input.lastCompletedOn}, before the period end.`,
    input.unmatchedCount === 0
      ? "Nothing is unmatched."
      : `${plural(input.unmatchedCount, "bank line")} dated on or before ${input.periodEnd} ${input.unmatchedCount === 1 ? "is" : "are"} still unmatched.`,
  ];
  return { ...base, status: "outstanding", evidence: parts.join(" ") };
}

export function approvalsStep(input: {
  periodEnd: string;
  pendingCount: number | null;
}): CloseStep {
  const base = {
    key: "approvals-decided",
    title: "Controlled actions have been decided",
    passCondition: `Nothing requested on or before ${input.periodEnd} is still waiting for a decision.`,
    blocksClose: false,
    href: "/approvals",
    workKey: "control:pending-approvals",
  };
  if (input.pendingCount === null) {
    return { ...base, status: "unavailable", evidence: "The approval queue did not answer." };
  }
  return {
    ...base,
    status: input.pendingCount === 0 ? "complete" : "outstanding",
    evidence:
      input.pendingCount === 0
        ? "Nothing from this period is waiting for a decision."
        : `${plural(input.pendingCount, "action")} requested on or before ${input.periodEnd} ${input.pendingCount === 1 ? "is" : "are"} still waiting.`,
  };
}

// --- When close mode is worth recommending ---------------------------------

export interface CloseRecommendation {
  recommended: boolean;
  reason: string | null;
  /** The policy field this could not consider, when one is unset. */
  sleepingOn: "closeWindowDays" | null;
}

/**
 * Whether an accountant should be in close mode.
 *
 * Two triggers, and only one of them needs a number a person had to choose.
 *
 * A period still open after the last day it covers is overdue by arithmetic —
 * no policy, no threshold, it just is. A period *approaching* its deadline is a
 * judgement: three days before month end is early for one company and late for
 * another. So that trigger waits on `closeWindowDays`, and while nobody has set
 * it the trigger says nothing and the screen names the setting it is waiting
 * on. Inventing a default here would put a banner on somebody's dashboard on a
 * schedule they never agreed to.
 */
export function closeRecommendation(input: {
  today: string;
  overdueCount: number;
  oldestOverdueLabel: string | null;
  currentPeriodEnd: string | null;
  closeWindowDays: number | null;
}): CloseRecommendation {
  if (input.overdueCount > 0) {
    return {
      recommended: true,
      reason:
        input.overdueCount === 1
          ? `${input.oldestOverdueLabel ?? "A period"} is still open after the last day it covers.`
          : `${input.overdueCount} periods are still open after the last day they cover, the oldest being ${input.oldestOverdueLabel ?? "an earlier one"}.`,
      sleepingOn: null,
    };
  }

  if (input.closeWindowDays === null) {
    return { recommended: false, reason: null, sleepingOn: "closeWindowDays" };
  }

  if (input.currentPeriodEnd !== null) {
    const daysLeft = daysBetween(input.currentPeriodEnd, input.today);
    if (daysLeft !== null && daysLeft <= input.closeWindowDays) {
      return {
        recommended: true,
        reason:
          daysLeft === 0
            ? "The current period ends today."
            : `The current period ends in ${plural(daysLeft, "day")}, inside the ${plural(input.closeWindowDays, "day")} this company set for starting a close.`,
        sleepingOn: null,
      };
    }
  }

  return { recommended: false, reason: null, sleepingOn: null };
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function daysBetween(later: string, earlier: string): number | null {
  const a = Date.parse(`${later}T00:00:00.000Z`);
  const b = Date.parse(`${earlier}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / DAY_MS);
}

// --- How long closing has taken --------------------------------------------

export interface CloseHistoryEntry {
  periodLabel: string;
  periodEnd: string;
  closedOn: string;
  daysToClose: number;
}

/**
 * The median of what has actually happened, or null when too little has.
 *
 * A median over one month is that month, dressed up as a trend. Two is the
 * least that can honestly be called a typical figure, and even that is stated
 * as "the last N closes" rather than as a rate.
 */
export function medianDaysToClose(history: readonly CloseHistoryEntry[]): number | null {
  if (history.length < 2) return null;
  const sorted = history.map((h) => h.daysToClose).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

export function closeHistoryEntry(input: {
  periodLabel: string;
  periodEnd: string;
  closedAt: string;
}): CloseHistoryEntry | null {
  const closedOn = input.closedAt.slice(0, 10);
  const days = daysBetween(closedOn, input.periodEnd);
  if (days === null) return null;
  return {
    periodLabel: input.periodLabel,
    periodEnd: input.periodEnd,
    closedOn,
    // A period closed before its own end date is a reopen-and-reclose or a
    // clerical oddity; reporting a negative "days to close" would read as a
    // defect in the measurement rather than in the month.
    daysToClose: Math.max(0, days),
  };
}
