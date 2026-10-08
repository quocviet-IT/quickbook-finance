/**
 * Change Log: what changed in the books, when and by whom, read from the audit
 * log the database keeps for every audited table.
 *
 * The audit search returns at most 1,000 entries, newest first. A period with
 * more says so instead of quietly showing the newest thousand as if they were
 * all of it.
 *
 * Pure: audit entries (already described) in, report out.
 */

import { diffAuditEntry, formatAuditValue, summarizeAuditChanges, type AuditEntryLike } from "./audit";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { stampInTimeZone } from "./stamp";

/** Keys, links and stamps: true, but a reader learns nothing from a uuid or a hash. */
const NOT_FOR_READING = /(^id$|_id$|_by$|_at$|_hash$)/;
/** A value longer than this is cut, so one field cannot fill the cell. */
const VALUE_LENGTH = 40;
const FIELDS_SHOWN = 3;

const clip = (value: string) => (value.length > VALUE_LENGTH ? `${value.slice(0, VALUE_LENGTH)}…` : value);

/**
 * One line a reader can scan for an audit entry: for a change, the fields that
 * changed, before and after; for a record added or removed, what it held. Ids,
 * links and timestamps are left out — the When and Record columns carry those.
 */
export function changeLogDetail(entry: Pick<AuditEntryLike, "before_json" | "after_json">): string {
  const changes = diffAuditEntry(entry)
    .filter((change) => !NOT_FOR_READING.test(change.field))
    .map((change) => ({
      ...change,
      before: change.before === null ? null : clip(change.before),
      after: change.after === null ? null : clip(change.after),
    }));
  if (changes.length === 0) return "";
  const added = changes.every((change) => change.before === null);
  const removed = changes.every((change) => change.after === null);
  if (!added && !removed) return summarizeAuditChanges(changes, FIELDS_SHOWN);
  const shown = changes
    .slice(0, FIELDS_SHOWN)
    .map((change) => `${change.field}: ${formatAuditValue(added ? change.after : change.before)}`)
    .join("; ");
  const rest = changes.length - FIELDS_SHOWN;
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
}

/** The audit search's ceiling (`acc_audit_search`). */
export const CHANGE_LOG_LIMIT = 1000;

export interface ChangeLogEntry {
  id: string;
  at: string;
  who: string;
  /** Added, Changed, Voided… */
  what: string;
  /** Invoice, Bill, Account… */
  record: string;
  /** The record's own number or name, when the snapshot holds one. */
  reference: string | null;
  /** `status: draft → issued; memo: … (+2 more)`. */
  detail: string;
}

export interface ChangeLogReport {
  lines: ChangeLogEntry[];
  /** True when the search hit its ceiling, so older changes in the period are not shown. */
  truncated: boolean;
}

export function changeLog(entries: readonly ChangeLogEntry[]): ChangeLogReport {
  const lines = [...entries].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { lines, truncated: entries.length >= CHANGE_LOG_LIMIT };
}

export function changeLogSheet(
  report: ChangeLogReport,
  ctx: { companyName: string; from: string; to: string; currencyCode: string; timeZone: string },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`change-log-${ctx.from}-to-${ctx.to}`),
    companyName: ctx.companyName,
    title: "Change Log",
    subtitle: `${ctx.from} to ${ctx.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "at", header: "When", kind: "text", width: 20 },
      { key: "who", header: "Who", kind: "text", width: 28 },
      { key: "what", header: "What", kind: "text", width: 14 },
      { key: "record", header: "Record", kind: "text", width: 28 },
      { key: "detail", header: "Detail", kind: "text", width: 60 },
    ],
    rows: report.lines.map((line) => ({
      at: stampInTimeZone(line.at, ctx.timeZone),
      who: line.who,
      what: line.what,
      record: line.reference ? `${line.record} ${line.reference}` : line.record,
      detail: line.detail,
    })),
  };
}
