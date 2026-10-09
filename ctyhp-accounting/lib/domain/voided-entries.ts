/**
 * Voided and Reversed Entries — OneBook's answer to the mockup's Bin.
 *
 * OneBook never deletes a posted entry. A document's void marks its entry void
 * (it stays, with the time it was voided); a reversal posts a second entry that
 * undoes the first and keeps the reason. This report lists both, dated by when
 * the void or reversal happened in the company's own time zone, newest first.
 * Nothing here puts an entry back: posting it again is a new entry.
 *
 * Pure: entries in, report out.
 */

import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { dateInTimeZone, stampInTimeZone } from "./stamp";

export interface VoidedEntry {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  /** The entry's debits, base currency. */
  amountMinor: number;
  /** When it was voided; null for an entry voided before the books kept the time. */
  voidedAt: string | null;
  /** Who voided it, when the audit log says; null otherwise. */
  byName: string | null;
}

export interface ReversedEntry {
  originalEntryId: string;
  originalNumber: string;
  originalDate: string;
  description: string;
  amountMinor: number;
  reversalEntryId: string;
  reversalNumber: string;
  reason: string;
  reversedAt: string;
  byName: string | null;
}

export interface VoidedEntriesLine {
  key: string;
  action: "Voided" | "Reversed";
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  amountMinor: number;
  /** null when the books did not keep the time of the void. */
  actedAt: string | null;
  by: string | null;
  reason: string | null;
  reversalEntryId: string | null;
  reversalNumber: string | null;
}

export interface VoidedEntriesReport {
  lines: VoidedEntriesLine[];
  voided: number;
  reversed: number;
  /** True when the audit read behind "By" was cut short, so an older void may show no name. */
  byIncomplete: boolean;
}

export function voidedEntries(
  voided: readonly VoidedEntry[],
  reversed: readonly ReversedEntry[],
  range: { from: string; to: string },
  timeZone: string,
  byIncomplete = false,
): VoidedEntriesReport {
  const inRange = (day: string) => day >= range.from && day <= range.to;
  // A void the books did not time is dated by its entry, the only date it has.
  const voidedWithin = (entry: VoidedEntry) =>
    entry.voidedAt ? inRange(dateInTimeZone(entry.voidedAt, timeZone)) : inRange(entry.entryDate);
  const sortKey = (line: VoidedEntriesLine) => line.actedAt ?? `${line.entryDate}T00:00:00`;
  const lines: VoidedEntriesLine[] = [
    ...voided.filter(voidedWithin).map(
      (entry): VoidedEntriesLine => ({
        key: `void:${entry.entryId}`,
        action: "Voided",
        entryId: entry.entryId,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        description: entry.description,
        amountMinor: entry.amountMinor,
        actedAt: entry.voidedAt,
        by: entry.byName,
        reason: null,
        reversalEntryId: null,
        reversalNumber: null,
      }),
    ),
    ...reversed.filter((entry) => inRange(dateInTimeZone(entry.reversedAt, timeZone))).map(
      (entry): VoidedEntriesLine => ({
        key: `reverse:${entry.originalEntryId}`,
        action: "Reversed",
        entryId: entry.originalEntryId,
        entryNumber: entry.originalNumber,
        entryDate: entry.originalDate,
        description: entry.description,
        amountMinor: entry.amountMinor,
        actedAt: entry.reversedAt,
        by: entry.byName,
        reason: entry.reason.trim() === "" ? null : entry.reason,
        reversalEntryId: entry.reversalEntryId,
        reversalNumber: entry.reversalNumber,
      }),
    ),
  ].sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.entryNumber.localeCompare(b.entryNumber));
  return {
    lines,
    voided: lines.filter((line) => line.action === "Voided").length,
    reversed: lines.filter((line) => line.action === "Reversed").length,
    byIncomplete,
  };
}

export function voidedEntriesSheet(
  report: VoidedEntriesReport,
  ctx: { companyName: string; from: string; to: string; currencyCode: string; baseDecimals: number; timeZone: string },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`voided-and-reversed-entries-${ctx.from}-to-${ctx.to}`),
    companyName: ctx.companyName,
    title: "Voided and Reversed Entries",
    subtitle: `${ctx.from} to ${ctx.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "date", header: "Date of entry", kind: "text", width: 12 },
      { key: "entry", header: "Entry", kind: "text", width: 14 },
      { key: "description", header: "Description", kind: "text", width: 36 },
      { key: "amount", header: "Amount", kind: "money", width: 16 },
      { key: "action", header: "Action", kind: "text", width: 10 },
      { key: "by", header: "By", kind: "text", width: 28 },
      { key: "at", header: "When", kind: "text", width: 18 },
      { key: "reason", header: "Reason", kind: "text", width: 36 },
      { key: "reversal", header: "Reversal entry", kind: "text", width: 14 },
    ],
    rows: report.lines.map((line) => ({
      date: line.entryDate,
      entry: line.entryNumber,
      description: line.description,
      amount: fromMinor(line.amountMinor, ctx.baseDecimals),
      action: line.action,
      by: line.by ?? "",
      at: line.actedAt ? stampInTimeZone(line.actedAt, ctx.timeZone) : "Not recorded",
      reason: line.reason ?? "",
      reversal: line.reversalNumber ?? "",
    })),
  };
}
