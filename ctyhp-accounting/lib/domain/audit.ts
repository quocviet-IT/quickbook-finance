/**
 * Audit trail presentation rules.
 *
 * Pure. `acc_audit_log` stores an immutable before/after snapshot of every
 * changed row; an auditor needs the field-level story that follows from it —
 * which field changed, what it held before, what it holds now. Deriving that
 * here keeps one copy of the evidence in the database instead of a second
 * per-field table that could drift from the snapshots it was built from.
 */

import { toCsv, type CsvColumn } from "@/lib/csv";

export interface AuditFieldChange {
  field: string;
  /** Value before the change, already rendered. `null` means the field did not exist. */
  before: string | null;
  after: string | null;
}

/**
 * Written by the stamp trigger on every single update, so it says nothing an
 * auditor cannot read off the entry's own timestamp. Hidden unless asked for.
 */
export const AUDIT_HOUSEKEEPING_FIELDS = ["updated_at", "updated_by"] as const;

export interface AuditEntryLike {
  table_name: string;
  record_id: string | null;
  action: string;
  actor_email: string | null;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One rendering of a stored value, stable enough to compare two snapshots by. */
function render(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Field-level changes between the two snapshots of one audit entry, ordered by
 * field name so two runs over the same entry read the same way.
 *
 * An insert has no `before_json`, so every field it wrote is reported with a
 * `null` before; a delete reports every field it removed with a `null` after.
 */
export function diffAuditEntry(
  entry: Pick<AuditEntryLike, "before_json" | "after_json">,
  options: { includeHousekeeping?: boolean } = {},
): AuditFieldChange[] {
  const before = asRecord(entry.before_json) ?? {};
  const after = asRecord(entry.after_json) ?? {};
  const hidden: readonly string[] = options.includeHousekeeping
    ? []
    : AUDIT_HOUSEKEEPING_FIELDS;

  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: AuditFieldChange[] = [];
  for (const field of fields) {
    if (hidden.includes(field)) continue;
    const from = render(before[field]);
    const to = render(after[field]);
    if (from === to) continue;
    changes.push({ field, before: from, after: to });
  }
  return changes;
}

/** `—` for "the field was not there", so an empty string still reads as empty. */
export function formatAuditValue(value: string | null): string {
  if (value === null) return "—";
  return value === "" ? "(empty)" : value;
}

/** One scannable line for a table cell: `status: draft → issued`. */
export function summarizeAuditChanges(changes: readonly AuditFieldChange[], limit = 3): string {
  if (changes.length === 0) return "No field changed";
  const shown = changes
    .slice(0, limit)
    .map((c) => `${c.field}: ${formatAuditValue(c.before)} → ${formatAuditValue(c.after)}`)
    .join("; ");
  const rest = changes.length - Math.min(limit, changes.length);
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
}

/** Every actor row reads the same way, including the one that has no user. */
export function formatActor(email: string | null | undefined): string {
  return email && email.trim() !== "" ? email : "system";
}

export interface AttributionSource {
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface Attribution {
  createdBy: string;
  createdAt: string;
  modifiedBy: string | null;
  modifiedAt: string | null;
}

/**
 * Who made the record and who touched it last, resolved through a directory of
 * user ids to emails. A record nobody has changed since creation reports no
 * modification rather than repeating the creation as one.
 */
export function documentAttribution(
  row: AttributionSource,
  directory: ReadonlyMap<string, string>,
): Attribution {
  const email = (id: string | null | undefined): string =>
    formatActor(id ? (directory.get(id) ?? id) : null);
  const modified =
    row.updated_at && row.updated_at !== row.created_at ? row.updated_at : null;
  return {
    createdBy: email(row.created_by),
    createdAt: row.created_at,
    modifiedBy: modified ? email(row.updated_by) : null,
    modifiedAt: modified,
  };
}

/** Trim a stored timestamp to what a report shows: `2026-07-31 01:05:07`. */
export function formatAuditTimestamp(value: string): string {
  return value.slice(0, 19).replace("T", " ");
}

export interface AuditTrailCsvRow extends Record<string, unknown> {
  changed_at: string;
  changed_by: string;
  table_name: string;
  record_id: string;
  action: string;
  field_changed: string;
  old_value: string;
  new_value: string;
}

const CSV_COLUMNS: CsvColumn<AuditTrailCsvRow>[] = [
  { key: "changed_at", header: "Changed at" },
  { key: "changed_by", header: "Changed by" },
  { key: "table_name", header: "Table" },
  { key: "record_id", header: "Record id" },
  { key: "action", header: "Action" },
  { key: "field_changed", header: "Field changed" },
  { key: "old_value", header: "Old value" },
  { key: "new_value", header: "New value" },
];

/**
 * One row per changed field — the shape an auditor reconciles against, and the
 * reason the report is exported per field rather than per entry. An entry whose
 * snapshots show no visible change still gets one row, so nothing recorded in
 * the log disappears from the report.
 */
export function auditTrailRows(
  entries: readonly AuditEntryLike[],
  options: { includeHousekeeping?: boolean } = {},
): AuditTrailCsvRow[] {
  const rows: AuditTrailCsvRow[] = [];
  for (const entry of entries) {
    const base = {
      changed_at: formatAuditTimestamp(entry.created_at),
      changed_by: formatActor(entry.actor_email),
      table_name: entry.table_name,
      record_id: entry.record_id ?? "",
      action: entry.action,
    };
    const changes = diffAuditEntry(entry, options);
    if (changes.length === 0) {
      rows.push({ ...base, field_changed: "", old_value: "", new_value: "" });
      continue;
    }
    for (const change of changes) {
      rows.push({
        ...base,
        field_changed: change.field,
        old_value: change.before ?? "",
        new_value: change.after ?? "",
      });
    }
  }
  return rows;
}

export function auditTrailCsv(
  entries: readonly AuditEntryLike[],
  options: { includeHousekeeping?: boolean } = {},
): string {
  return toCsv(auditTrailRows(entries, options), CSV_COLUMNS);
}

/**
 * `audit-trail-2026-07.csv` for a whole month, `audit-trail-2026-07-01_2026-07-15.csv`
 * for any other range, `audit-trail-all.csv` when the search was unfiltered.
 */
export function auditTrailFileName(range: { from: string | null; to: string | null }): string {
  const { from, to } = range;
  if (!from || !to) return "audit-trail-all.csv";
  const month = from.slice(0, 7);
  if (to.slice(0, 7) === month && from.endsWith("-01") && to === lastDayOfMonth(month)) {
    return `audit-trail-${month}.csv`;
  }
  return `audit-trail-${from}_${to}.csv`;
}

function lastDayOfMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, "0")}`;
}
