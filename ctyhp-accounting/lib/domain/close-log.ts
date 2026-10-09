/**
 * Month-End Close Log: every close and reopen of a fiscal year's months, with
 * when, by whom and why.
 *
 * The books record each close and reopen (`acc_period_event`) with its reason,
 * but not which close checks passed at the time, so this log does not show a
 * check count: it would have to be invented.
 *
 * Pure: periods and events in, log out.
 */

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
    ],
    rows: report.lines.map((line) => ({
      month: line.month,
      event: line.event,
      at: line.at ? stampInTimeZone(line.at, ctx.timeZone) : "",
      by: line.by ?? "",
      reason: line.reason ?? "",
    })),
  };
}
