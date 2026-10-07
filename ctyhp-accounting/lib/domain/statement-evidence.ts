/**
 * The statement file kept beside what was read from it (1.83).
 *
 * Pure, so the wording is tested where it is written: which files are kept and
 * as what, what a kept file is called, whether a file chosen later is the
 * statement a reconciliation was reconciled against, and what is said when a
 * file cannot be kept.
 */
import { z } from "zod";
import { periodLabel, shortDate } from "./pdf-statement-view";
import { SAVED_REPORT_MAX_BYTES } from "./saved-reports";

/** A bank's own download (OFX, QFX, QBO, QIF) is text, and kept as text. */
export const STATEMENT_FILE_MIME_TYPES = ["application/pdf", "text/csv", "text/plain"] as const;
export type StatementFileMime = (typeof STATEMENT_FILE_MIME_TYPES)[number];

const BY_EXTENSION: Record<string, StatementFileMime> = {
  pdf: "application/pdf",
  csv: "text/csv",
  ofx: "text/plain",
  qfx: "text/plain",
  qbo: "text/plain",
  qif: "text/plain",
};

/**
 * How a statement file is kept. The name decides first: a browser gives a bank
 * download no type, or one the store would refuse.
 */
export function statementFileMime(fileName: string, browserType = ""): StatementFileMime | null {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  const byName = extension ? BY_EXTENSION[extension] : undefined;
  if (byName) return byName;
  return (STATEMENT_FILE_MIME_TYPES as readonly string[]).includes(browserType) ? (browserType as StatementFileMime) : null;
}

/** Why a file cannot be kept, said before anything is sent; null when it can. */
export function statementFileRefusal(file: { name: string; type?: string; size: number }): string | null {
  if (file.size <= 0) return "the file is empty";
  if (file.size > SAVED_REPORT_MAX_BYTES) return "it is larger than 10 MB";
  if (file.name.length > 255) return "its name is longer than 255 characters";
  if (!statementFileMime(file.name, file.type)) return "OneBook keeps PDF, CSV, OFX, QFX, QBO and QIF statement files";
  return null;
}

export interface StatementPeriod {
  from: string | null;
  to: string | null;
}

/** The days a file covers: from its earliest statement's first day to its latest one's last. */
export function statementFileSpan(periods: readonly StatementPeriod[]): StatementPeriod {
  const froms = periods.map((p) => p.from).filter((d): d is string => Boolean(d)).sort();
  const tos = periods.map((p) => p.to).filter((d): d is string => Boolean(d)).sort();
  return { from: froms[0] ?? null, to: tos[tos.length - 1] ?? null };
}

/** The days a file of lines covers, when it prints no period of its own. */
export function linesSpan(lines: readonly { txn_date: string }[]): StatementPeriod {
  const dates = lines.map((l) => l.txn_date).sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}

/** The bank account a kept file is named after: "Example Bank ****1183". */
export function statementFileAccount(name: string, maskedNumber: string | null): string {
  return [name.trim(), (maskedNumber ?? "").trim()].filter(Boolean).join(" ");
}

/** "Example Bank ****1183 — statement May 1 – May 31, 2026", as Reports › Saved lists it. */
export function statementFileTitle(account: string, period: StatementPeriod): string {
  const what = period.from || period.to ? `statement ${periodLabel(period.from, period.to)}` : "statement file";
  return `${account.trim() || "Bank account"} — ${what}`.slice(0, 200);
}

/** The first 12 characters of a file's SHA-256, printed so a paper report can be matched to its file. */
export function shortSha(sha256: string): string {
  return sha256.slice(0, 12);
}

/** Where a file that could not be kept can be attached later, and what was done without it. */
export type KeepFailureWhere = "reconciliation" | "import";

const reasonText = (reason: string) => reason.trim().replace(/[.\s]+$/, "") || "an unexpected error occurred";

export function keepFailureMessage(reason: string, where: KeepFailureWhere): string {
  const why = reasonText(reason);
  return where === "reconciliation"
    ? `The statement file could not be kept: ${why}. Attach it on the reconciliation.`
    : `The statement file could not be kept: ${why}. Its lines were imported without it.`;
}

/** Why a call to the server failed outright — its own words, or that it did not answer — for a dialog's message. */
export function serverFailure(error: unknown): string {
  return error instanceof Error && error.message.trim() ? reasonText(error.message) : "the server did not answer";
}

/** Said when a kept file could not be tied to the import or reconciliation it came with: the file is kept, only the link is missing. */
export function unlinkedFileMessage(reason: string, where: KeepFailureWhere): string {
  const why = reasonText(reason);
  return where === "reconciliation"
    ? `The statement file was kept but could not be tied to this reconciliation: ${why}. Attach it on the reconciliation.`
    : `The statement file was kept but could not be tied to this import: ${why}. It is in Reports › Saved.`;
}

// --- Attach the statement: is this file the reconciliation's statement? -----

export interface EvidenceLine {
  txn_date: string;
  amount_minor: number;
}

/** What was read from the file chosen: its lines, and its last day and closing balance when it prints them. */
export interface ReadStatementFile {
  to: string | null;
  closingMinor: number | null;
  lines: readonly EvidenceLine[];
}

/** What the reconciliation holds: its statement date and ending balance, and the statement lines it kept. */
export interface EvidenceTarget {
  endingDate: string;
  endingMinor: number;
  keptLines: readonly EvidenceLine[];
}

/**
 * Why the file chosen is not this reconciliation's statement, or null when it
 * is. A file that prints its closing balance must close on the statement date
 * at the ending balance. When the reconciliation kept the statement's lines,
 * the file's lines must be the same lines, in order — and for a bank download
 * that prints no balance, those lines are the whole proof. A reconciliation
 * that kept no lines can only be matched by a closing balance.
 */
export function statementFileMismatch(
  read: ReadStatementFile,
  target: EvidenceTarget,
  money: (minor: number) => string,
): string | null {
  const date = (iso: string) => shortDate(iso, true);
  if (read.to !== null && read.closingMinor !== null) {
    if (read.to !== target.endingDate || read.closingMinor !== target.endingMinor) {
      return (
        `This file's statement closes ${date(read.to)} at ${money(read.closingMinor)}; ` +
        `this reconciliation is to ${date(target.endingDate)} at ${money(target.endingMinor)}.`
      );
    }
  } else if (target.keptLines.length === 0) {
    return (
      `This file does not show the statement's closing balance, so it cannot be matched to this reconciliation. ` +
      `Attach the bank's PDF statement for ${date(target.endingDate)}.`
    );
  }
  const kept = target.keptLines;
  if (kept.length === 0) return null;

  // A line of no amount moves no money and was never kept. A CSV that runs over
  // several months gave each month's reconciliation only that month's lines,
  // so the file's lines from the first kept day to the statement date count too.
  const lines = read.lines.filter((l) => l.amount_minor !== 0);
  const firstKeptDay = kept.reduce((min, l) => (l.txn_date < min ? l.txn_date : min), kept[0].txn_date);
  const month = lines.filter((l) => l.txn_date >= firstKeptDay && l.txn_date <= target.endingDate);
  const firstDifference = (candidate: readonly EvidenceLine[]) =>
    candidate.findIndex((l, i) => l.txn_date !== kept[i].txn_date || l.amount_minor !== kept[i].amount_minor);
  const same = (candidate: readonly EvidenceLine[]) => candidate.length === kept.length && firstDifference(candidate) < 0;
  if (same(lines) || same(month)) return null;

  const plural = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
  if (month.length !== kept.length) {
    return (
      `This reconciliation kept ${plural(kept.length)} from ${date(firstKeptDay)} to ${date(target.endingDate)}; ` +
      `this file has ${plural(month.length)} in those days.`
    );
  }
  const at = firstDifference(month);
  return (
    `Line ${at + 1} differs: the file has ${date(month[at].txn_date)} at ${money(month[at].amount_minor)}; ` +
    `this reconciliation kept ${date(kept[at].txn_date)} at ${money(kept[at].amount_minor)}.`
  );
}

// --- Validation of what the browser sends ------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const statementFileKeepSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    period_start: isoDate.nullable(),
    period_end: isoDate.nullable(),
    file_name: z.string().trim().min(1).max(255),
    storage_path: z.string().min(1).max(400),
    mime_type: z.enum(STATEMENT_FILE_MIME_TYPES),
    size_bytes: z.number().int().positive().max(SAVED_REPORT_MAX_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "Expected a sha256 digest"),
  })
  .refine(
    (value) => !value.period_start || !value.period_end || value.period_end >= value.period_start,
    { message: "The period cannot end before it starts", path: ["period_end"] },
  );
export type StatementFileKeepInput = z.infer<typeof statementFileKeepSchema>;

const evidenceLineSchema = z.object({
  txn_date: isoDate,
  amount_minor: z.number().int(),
});

export const statementFileAttachSchema = z.object({
  reconciliation_id: z.string().uuid(),
  file_id: z.string().uuid(),
  to: isoDate.nullable(),
  closing_minor: z.number().int().nullable(),
  lines: z.array(evidenceLineSchema).max(10_000),
});
export type StatementFileAttachInput = z.infer<typeof statementFileAttachSchema>;
