/**
 * Staff feedback: bug reports and improvement suggestions filed from any page.
 *
 * Pure. Owns the two report kinds, the four triage queues, and which status
 * change is legal — so the dialog, the triage page, and the database guard all
 * agree on one set of rules.
 */

export const FEEDBACK_KINDS = ["broken", "suggestion"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Triage order, left to right, as the queue tabs read. */
export const FEEDBACK_STATUSES = ["new", "reviewing", "resolved", "declined"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackPageContext {
  /** Full location, so a report filed from a filtered view can be reproduced. */
  url: string;
  route: string;
  title: string;
  viewport: { width: number; height: number };
}

export interface FeedbackReporter {
  email: string | null;
  role: string | null;
}

export interface FeedbackReport {
  id: string;
  kind: FeedbackKind;
  /** Optional — the dialog lets a reporter send a screenshot with no words. */
  description: string | null;
  status: FeedbackStatus;
  page: FeedbackPageContext;
  reporter: FeedbackReporter | null;
  /** Storage path of the attached screenshot, or null when it was excluded. */
  screenshot: string | null;
  createdAt: string;
}

const KIND_LABELS: Record<FeedbackKind, string> = {
  broken: "Something is broken",
  suggestion: "Suggestion for improvement",
};

export function feedbackKindLabel(kind: FeedbackKind): string {
  return KIND_LABELS[kind];
}

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  resolved: "Resolved",
  declined: "Declined",
};

export function feedbackStatusLabel(status: FeedbackStatus): string {
  return STATUS_LABELS[status];
}

export function newFeedbackReport(input: {
  id: string;
  kind: FeedbackKind;
  description: string | null;
  page: FeedbackPageContext;
  reporter: FeedbackReporter | null;
  screenshot: string | null;
  createdAt: string;
}): FeedbackReport {
  return {
    id: input.id,
    kind: input.kind,
    description: input.description?.trim() || null,
    status: "new",
    page: input.page,
    reporter: input.reporter,
    screenshot: input.screenshot,
    createdAt: input.createdAt,
  };
}

/**
 * New is arrival order, not a state to re-enter: once a report has been picked
 * up, it can move forward or be reopened for review, but never go back to New.
 */
const ALLOWED_TRANSITIONS: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  new: ["reviewing", "resolved", "declined"],
  reviewing: ["resolved", "declined"],
  resolved: ["reviewing"],
  declined: ["reviewing"],
};

export function nextStatuses(from: FeedbackStatus): FeedbackStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}

export function canTransition(from: FeedbackStatus, to: FeedbackStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** One wording for a status change, used in confirmations and audit reasons. */
export function describeFeedbackStatusChange(
  from: FeedbackStatus,
  to: FeedbackStatus,
): string {
  if (to === "reviewing" && (from === "resolved" || from === "declined")) {
    return "Reopen this report for review";
  }
  if (to === "reviewing") return "Start reviewing this report";
  if (to === "resolved") return "Mark this report resolved";
  if (to === "declined") return "Decline this report — it will not be actioned";
  return `Change status from ${from} to ${to}`;
}

export function queueCounts(
  reports: readonly Pick<FeedbackReport, "status">[],
): Record<FeedbackStatus, number> {
  const counts: Record<FeedbackStatus, number> = {
    new: 0,
    reviewing: 0,
    resolved: 0,
    declined: 0,
  };
  for (const report of reports) counts[report.status] += 1;
  return counts;
}

/**
 * Newest first, as the triage page reads. Never mutates the input. Generic so a
 * caller holding a richer row type keeps its own fields.
 */
export function sortNewestFirst<T extends Pick<FeedbackReport, "createdAt">>(
  reports: readonly T[],
): T[] {
  return [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One scannable line of context for a developer reading the report. */
export function summarizePageContext(page: FeedbackPageContext): string {
  return `${page.route} · ${page.title} · ${page.viewport.width}×${page.viewport.height}`;
}

export function feedbackExportFileName(report: FeedbackReport): string {
  return `feedback-${report.kind}-${report.createdAt.slice(0, 10)}-${report.id}.zip`;
}
