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

import { auditFieldLabel, type AuditEntryLike } from "./audit";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { stampInTimeZone } from "./stamp";
import { humanizeStatus, statusLabel } from "./status-label";
import { formatDate, formatDateRange, formatMoney } from "@/lib/format";

/**
 * Keys, links, stamps and fingerprints: true, but a reader learns nothing from
 * a uuid, a hash, a storage path or the work queue's internal key.
 */
const NOT_FOR_READING = /(^id$|_id$|_by$|_at$|_hash$|^sha256$|^storage_path$|^work_key$)/;
/** A value longer than this is cut, so one field cannot fill the cell. */
const VALUE_LENGTH = 40;
const FIELDS_SHOWN = 3;
/** What a person typed: quoted, so it reads as their words rather than the system's. */
const FREE_TEXT = /^(memo|note|notes|reason|description)$/;
const STATUS_FIELD = /^(status|lifecycle|state)$/;
/** Fields that hold a code, read as words: `other_expense` → "Other expense", `loan` → "Loan". */
const CODE_FIELD = /(^|_)(type|kind|provider|method|basis|role|source|key)$/;
const SNAKE_CODE = /^[a-z]+(_[a-z0-9]+)+$/;
/** Read first, because they say what happened; the rest follow in name order. */
const FIRST = ["reason", "status", "lifecycle", "total_minor", "amount_minor", "name"];

const clip = (value: string) => (value.length > VALUE_LENGTH ? `${value.slice(0, VALUE_LENGTH)}…` : value);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === "";

/** A field's name as words, without the `is_` of a yes-or-no field: `is_contra` → "Contra". */
const fieldLabel = (field: string) => auditFieldLabel(field.replace(/^is_/, ""));

function minorUnits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** A stored value as a reader reads it: money as money, a date as a date, a code as words, typed text in quotes. */
function readable(field: string, value: unknown, currency: string): string {
  if (isEmpty(value)) return "empty";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    return /_minor$/.test(field) ? formatMoney(value, currency, minorUnits(currency)) : value.toLocaleString("en-US");
  }
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length.toLocaleString("en-US")} items`;
  if (typeof value === "object") return "details";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatDate(text);
  if (STATUS_FIELD.test(field)) return statusLabel(text);
  if (CODE_FIELD.test(field) || SNAKE_CODE.test(text)) return humanizeStatus(text);
  return FREE_TEXT.test(field) ? `“${clip(text)}”` : clip(text);
}

const order = (a: string, b: string) => {
  const rank = (field: string) => (FIRST.includes(field) ? FIRST.indexOf(field) : FIRST.length);
  return rank(a) - rank(b) || a.localeCompare(b);
};

/**
 * What an audit entry did, in plain sentences.
 *
 * A change reads "Status changed from Draft to Void.", "Due date set to
 * 10/20/2026." or "Memo cleared."; a record added or removed, or an action
 * that keeps its own details, reads as the facts it holds: "Name: Cash Over
 * and Short. Status: Active." Money is money, dates are dates, codes are words
 * and typed text is quoted. Ids, links and timestamps are left out, and so is
 * a yes-or-no that is no on a new record: the When and Record columns carry
 * the rest. The UI review of 2026-10-17 found "due_date: (empty); lifecycle:
 * dismissed" and "Book: 426500" here.
 */
export function changeLogDetail(
  entry: Pick<AuditEntryLike, "before_json" | "after_json">,
  options: { currencyCode?: string } = {},
): string {
  const before = asRecord(entry.before_json);
  const after = asRecord(entry.after_json);
  const hasBefore = entry.before_json !== null && entry.before_json !== undefined;
  const hasAfter = entry.after_json !== null && entry.after_json !== undefined;
  const snapshotCurrency = after.currency_code ?? before.currency_code;
  const currency =
    typeof snapshotCurrency === "string" && /^[A-Z]{3}$/.test(snapshotCurrency)
      ? snapshotCurrency
      : (options.currencyCode ?? "USD");

  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !NOT_FOR_READING.test(field) && field !== "updated_at" && field !== "updated_by")
    .filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .sort(order);

  const sentences: string[] = [];
  if (hasBefore && hasAfter) {
    for (const field of fields) {
      const label = fieldLabel(field);
      const was = readable(field, before[field], currency);
      const now = readable(field, after[field], currency);
      if (isEmpty(before[field])) sentences.push(`${label} set to ${now}.`);
      else if (isEmpty(after[field])) sentences.push(`${label} cleared (was ${was}).`);
      else sentences.push(`${label} changed from ${was} to ${now}.`);
    }
  } else {
    // A record added or removed, or an action that keeps its own details on one side.
    const facts = hasAfter ? after : before;
    for (const field of fields) {
      const value = facts[field];
      if (isEmpty(value) || value === false) continue;
      sentences.push(value === true ? `${fieldLabel(field)}.` : `${fieldLabel(field)}: ${readable(field, value, currency)}.`);
    }
  }
  if (sentences.length === 0) return "";
  const rest = sentences.length - FIELDS_SHOWN;
  const shown = sentences.slice(0, FIELDS_SHOWN).join(" ");
  return rest > 0 ? `${shown} And ${rest === 1 ? "1 more" : `${rest} more`}.` : shown;
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
  /** "Status changed from Draft to Issued. Memo set to “…”." */
  detail: string;
  /**
   * Done by the application around the books rather than to them: the work
   * queue's state, kept statement files, a reconciliation's own matches,
   * backups, anything no person did. Hidden until the reader asks.
   */
  system: boolean;
}

/** The lines a reader sees: the changes to the books, and the system's own activity only when asked for. */
export function visibleChanges(report: ChangeLogReport, showSystem: boolean): ChangeLogReport {
  return showSystem ? report : { ...report, lines: report.lines.filter((line) => !line.system) };
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
    subtitle: formatDateRange(ctx.from, ctx.to),
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
