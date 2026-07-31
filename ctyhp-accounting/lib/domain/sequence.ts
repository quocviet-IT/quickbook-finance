/**
 * Document number sequences and the breaks in them.
 *
 * Pure. The database hands out numbers from `acc_sequence` and reports which
 * documents still carry them; deciding what is missing, what somebody has
 * accounted for, and what is left unexplained happens here — one
 * implementation, held to account by unit tests, used by the report, the
 * invoice screen's warning, and the CSV export alike.
 */

import { toCsv, type CsvColumn } from "@/lib/csv";

export interface SequenceDefinition {
  sequence_key: string;
  label: string;
  prefix: string;
  /** The number the sequence will hand out next; everything below it is issued. */
  next_value: number;
}

export interface SequenceDocument {
  number_value: number;
  document_id: string;
  document_date: string | null;
  document_status: string | null;
}

export interface SequenceGapNote {
  number_value: number;
  reason: string;
  noted_at: string;
  noted_by_email?: string | null;
}

export type SequenceRowState = "present" | "missing" | "beyond_sequence";

export interface SequenceRow {
  value: number;
  number: string;
  state: SequenceRowState;
  documentId: string | null;
  documentDate: string | null;
  documentStatus: string | null;
  note: SequenceGapNote | null;
}

export interface SequenceSummary {
  /** Highest number the sequence has handed out. */
  allocated: number;
  present: number;
  missing: number;
  explained: number;
  unexplained: number;
  /** Documents numbered above what the sequence claims to have issued. */
  beyondSequence: number;
  nextNumber: string;
}

export interface SequenceAudit {
  definition: SequenceDefinition;
  rows: SequenceRow[];
  summary: SequenceSummary;
}

const DIGITS = 6;

/** `INV-` + 14 → `INV-000014`, the format `acc_next_number` writes. */
export function formatDocumentNumber(prefix: string, value: number): string {
  return `${prefix}${String(value).padStart(DIGITS, "0")}`;
}

/**
 * The whole number line of one sequence: every number it has issued, in order,
 * each either attached to a document or missing — and if missing, whether
 * anyone has explained it.
 *
 * A document numbered above the sequence's own counter is reported as
 * `beyond_sequence` rather than hidden: it means the counter was moved
 * backwards, which no ordinary posting can do.
 */
export function auditSequence(input: {
  definition: SequenceDefinition;
  documents: readonly SequenceDocument[];
  notes?: readonly SequenceGapNote[];
}): SequenceAudit {
  const { definition, documents, notes = [] } = input;
  const allocated = Math.max(0, definition.next_value - 1);
  const byNumber = new Map(documents.map((doc) => [doc.number_value, doc]));
  const noteByNumber = new Map(notes.map((note) => [note.number_value, note]));

  const beyond = documents
    .filter((doc) => doc.number_value > allocated)
    .map((doc) => doc.number_value);
  const highest = Math.max(allocated, ...(beyond.length ? beyond : [0]));

  const rows: SequenceRow[] = [];
  for (let value = 1; value <= highest; value++) {
    const doc = byNumber.get(value);
    const note = noteByNumber.get(value) ?? null;
    rows.push({
      value,
      number: formatDocumentNumber(definition.prefix, value),
      state: doc ? (value > allocated ? "beyond_sequence" : "present") : "missing",
      documentId: doc?.document_id ?? null,
      documentDate: doc?.document_date ?? null,
      documentStatus: doc?.document_status ?? null,
      note: doc ? null : note,
    });
  }

  const missing = rows.filter((row) => row.state === "missing");
  const explained = missing.filter((row) => row.note !== null).length;
  return {
    definition,
    rows,
    summary: {
      allocated,
      present: rows.filter((row) => row.state !== "missing").length,
      missing: missing.length,
      explained,
      unexplained: missing.length - explained,
      beyondSequence: beyond.length,
      nextNumber: formatDocumentNumber(definition.prefix, definition.next_value),
    },
  };
}

/** The numbers a reviewer has to act on, in the order they would work through them. */
export function unexplainedGaps(audit: SequenceAudit): SequenceRow[] {
  return audit.rows.filter((row) => row.state === "missing" && row.note === null);
}

/**
 * One sentence for the banner on a document screen. Says nothing when the
 * sequence is whole — a control that cries wolf stops being read.
 */
export function describeSequenceIntegrity(audit: SequenceAudit): string | null {
  const gaps = unexplainedGaps(audit);
  const { summary } = audit;
  if (gaps.length === 0 && summary.beyondSequence === 0) return null;

  const parts: string[] = [];
  if (gaps.length > 0) {
    const shown = gaps.slice(0, 5).map((row) => row.number).join(", ");
    const rest = gaps.length - Math.min(5, gaps.length);
    parts.push(
      `${gaps.length} number${gaps.length === 1 ? "" : "s"} issued by the sequence ` +
        `${gaps.length === 1 ? "is" : "are"} not on any document: ${shown}` +
        (rest > 0 ? ` and ${rest} more` : ""),
    );
  }
  if (summary.beyondSequence > 0) {
    parts.push(
      `${summary.beyondSequence} document${summary.beyondSequence === 1 ? " is" : "s are"} ` +
        `numbered above ${summary.nextNumber}, which the counter says has not been issued yet`,
    );
  }
  return `${parts.join(". ")}.`;
}

/** Across every sequence: what a reviewer opening the report should see first. */
export function totalUnexplained(audits: readonly SequenceAudit[]): number {
  return audits.reduce(
    (total, audit) => total + audit.summary.unexplained + audit.summary.beyondSequence,
    0,
  );
}

export interface SequenceCsvRow extends Record<string, unknown> {
  number: string;
  state: string;
  document_date: string;
  document_status: string;
  document_id: string;
  gap_reason: string;
}

const CSV_COLUMNS: CsvColumn<SequenceCsvRow>[] = [
  { key: "number", header: "Number" },
  { key: "state", header: "State" },
  { key: "document_date", header: "Date" },
  { key: "document_status", header: "Status" },
  { key: "document_id", header: "Document id" },
  { key: "gap_reason", header: "Documented reason" },
];

const STATE_LABELS: Record<SequenceRowState, string> = {
  present: "On file",
  missing: "MISSING",
  beyond_sequence: "AHEAD OF SEQUENCE",
};

export function sequenceStateLabel(state: SequenceRowState): string {
  return STATE_LABELS[state];
}

/** The monthly reconciliation listing: every number, in order, breaks flagged. */
export function sequenceCsv(audit: SequenceAudit): string {
  return toCsv(
    audit.rows.map((row) => ({
      number: row.number,
      state: sequenceStateLabel(row.state),
      document_date: row.documentDate ?? "",
      document_status: row.documentStatus ?? "",
      document_id: row.documentId ?? "",
      gap_reason: row.note?.reason ?? "",
    })),
    CSV_COLUMNS,
  );
}

export function sequenceCsvFileName(audit: SequenceAudit): string {
  return `number-sequence-${audit.definition.sequence_key}.csv`;
}
