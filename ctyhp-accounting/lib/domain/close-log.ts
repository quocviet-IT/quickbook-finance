/**
 * Month-End Close Log: every close and reopen of a fiscal year's months, with
 * when, by whom and why.
 *
 * The books record each close and reopen (`acc_period_event`) with its reason.
 * Since 2.84 a close made from the closing screens also keeps the month-end
 * checklist as it stood (0180); a close from before then kept none, and the
 * log says so rather than inventing one.
 *
 * Pure: periods and events in, log out.
 */

import { checklistSummary, NO_CHECKLIST_KEPT, readChecklist, type RecordedCloseStep } from "./close-record";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { stampInTimeZone } from "./stamp";

export interface ClosePeriod {
  id: string;
  label: string;
  periodStart: string;
  status: "open" | "closed";
}

export interface CloseEvent {
  periodId: string;
  event: "close" | "reopen";
  reason: string;
  actorName: string | null;
  createdAt: string;
  /** The checklist kept with a close, as stored; absent or null when none was kept. */
  checklist?: unknown;
}

export type CloseLogEvent = "Closed" | "Reopened" | "Open";

export interface CloseLogLine {
  key: string;
  periodId: string;
  month: string;
  /** Only on a month's first line, so a month reads as one block. */
  monthStart: boolean;
  event: CloseLogEvent;
  /** null on the line of a month that has never been closed. */
  at: string | null;
  by: string | null;
  reason: string | null;
  /** The month's status now, on its first line. */
  statusNow: "open" | "closed";
  /** On a Closed line: the checklist as it stood, or null when the close kept none. */
  checklist: RecordedCloseStep[] | null;
}

/** A Closed line's Checklist cell: what it said, or that none was kept; nothing on other lines. */
export function checklistCell(line: CloseLogLine): string | null {
  if (line.event !== "Closed") return null;
  return line.checklist ? checklistSummary(line.checklist) : NO_CHECKLIST_KEPT;
}

export interface CloseLogReport {
  lines: CloseLogLine[];
  closedMonths: number;
  reopenings: number;
}

/** Month by month in order; within a month, its events in the order they happened. */
export function closeLog(periods: readonly ClosePeriod[], events: readonly CloseEvent[]): CloseLogReport {
  const byPeriod = new Map<string, CloseEvent[]>();
  for (const event of events) {
    const list = byPeriod.get(event.periodId) ?? [];
    list.push(event);
    byPeriod.set(event.periodId, list);
  }
  const lines: CloseLogLine[] = [];
  for (const period of [...periods].sort((a, b) => a.periodStart.localeCompare(b.periodStart))) {
    const own = (byPeriod.get(period.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (own.length === 0) {
      lines.push({
        key: `${period.id}:open`,
        periodId: period.id,
        month: period.label,
        monthStart: true,
        event: "Open",
        at: null,
        by: null,
        reason: null,
        statusNow: period.status,
        checklist: null,
      });
      continue;
    }
    own.forEach((event, index) => {
      lines.push({
        key: `${period.id}:${index}`,
        periodId: period.id,
        month: period.label,
        monthStart: index === 0,
        event: event.event === "close" ? "Closed" : "Reopened",
        at: event.createdAt,
        by: event.actorName,
        reason: event.reason.trim() === "" ? null : event.reason,
        statusNow: period.status,
        checklist: event.event === "close" ? readChecklist(event.checklist) : null,
      });
    });
  }
  return {
    lines,
    closedMonths: periods.filter((period) => period.status === "closed").length,
    reopenings: events.filter((event) => event.event === "reopen").length,
  };
}

export function closeLogSheet(
  report: CloseLogReport,
  ctx: { companyName: string; fiscalYear: number; currencyCode: string; timeZone: string },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`month-end-close-log-fy${ctx.fiscalYear}`),
    companyName: ctx.companyName,
    title: "Month-End Close Log",
    subtitle: `Fiscal year ${ctx.fiscalYear}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "month", header: "Month", kind: "text", width: 16 },
      { key: "event", header: "Event", kind: "text", width: 12 },
      { key: "at", header: "When", kind: "text", width: 20 },
      { key: "by", header: "By", kind: "text", width: 28 },
      { key: "reason", header: "Reason or note", kind: "text", width: 48 },
      { key: "checklist", header: "Checklist at close", kind: "text", width: 34 },
    ],
    rows: report.lines.map((line) => ({
      month: line.month,
      event: line.event,
      at: line.at ? stampInTimeZone(line.at, ctx.timeZone) : "",
      by: line.by ?? "",
      reason: line.reason ?? "",
      checklist: checklistCell(line) ?? "",
    })),
  };
}
