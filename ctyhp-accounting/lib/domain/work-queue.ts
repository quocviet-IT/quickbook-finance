export type WorkQueueKind =
  | "overdue_invoice"
  | "due_bill"
  | "unreconciled_transaction"
  | "pending_approval";

export type WorkQueuePriority = "critical" | "high" | "normal";

export interface WorkQueueSource {
  id: string;
  kind: WorkQueueKind;
  title: string;
  subtitle: string;
  eventDate: string;
  amountMinor: number;
  href: string;
}

export interface WorkQueueItem extends WorkQueueSource {
  priority: WorkQueuePriority;
  timingLabel: string;
}

export interface WorkQueueCounts {
  overdue_invoice: number;
  due_bill: number;
  unreconciled_transaction: number;
  pending_approval: number;
}

export interface DashboardWorkQueue {
  asOf: string;
  dueThrough: string;
  counts: WorkQueueCounts;
  items: WorkQueueItem[];
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function utcDay(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
}

export function addIsoDays(value: string, days: number): string {
  return new Date(utcDay(value) + days * DAY_MS).toISOString().slice(0, 10);
}

export function calendarDayDifference(later: string, earlier: string): number {
  return Math.round((utcDay(later) - utcDay(earlier)) / DAY_MS);
}

function timingFor(source: WorkQueueSource, asOf: string): {
  priority: WorkQueuePriority;
  timingLabel: string;
} {
  const ageDays = Math.max(0, calendarDayDifference(asOf, source.eventDate));

  if (source.kind === "overdue_invoice") {
    return {
      priority: ageDays > 30 ? "critical" : "high",
      timingLabel: `${Math.max(1, ageDays)} day${ageDays === 1 ? "" : "s"} overdue`,
    };
  }

  if (source.kind === "due_bill") {
    const daysUntilDue = calendarDayDifference(source.eventDate, asOf);
    if (daysUntilDue < 0) {
      const overdueDays = Math.abs(daysUntilDue);
      return {
        priority: overdueDays > 30 ? "critical" : "high",
        timingLabel: `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`,
      };
    }
    if (daysUntilDue === 0) {
      return { priority: "high", timingLabel: "Due today" };
    }
    return {
      priority: "normal",
      timingLabel: `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`,
    };
  }

  if (source.kind === "unreconciled_transaction") {
    return {
      priority: ageDays >= 7 ? "high" : "normal",
      timingLabel:
        ageDays === 0
          ? "New bank activity"
          : `Unmatched for ${ageDays} day${ageDays === 1 ? "" : "s"}`,
    };
  }

  return {
    priority: ageDays >= 2 ? "high" : "normal",
    timingLabel:
      ageDays === 0
        ? "Submitted today"
        : `Waiting ${ageDays} day${ageDays === 1 ? "" : "s"}`,
  };
}

const PRIORITY_RANK: Record<WorkQueuePriority, number> = {
  critical: 3,
  high: 2,
  normal: 1,
};

export function buildWorkQueueItems(
  sources: WorkQueueSource[],
  asOf: string,
): WorkQueueItem[] {
  return sources
    .map((source) => ({ ...source, ...timingFor(source, asOf) }))
    .sort(
      (left, right) =>
        PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority] ||
        left.eventDate.localeCompare(right.eventDate) ||
        left.title.localeCompare(right.title),
    );
}
