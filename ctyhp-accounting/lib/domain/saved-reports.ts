import { z } from "zod";
import { parseCsvGrid } from "@/lib/csv";

/**
 * A report produced somewhere else, kept as it arrived.
 *
 * Nothing here reads figures out of a file. That is the whole point: an
 * imported file posts, a saved report does not, and the two must never be
 * confused by the code any more than by the person using it.
 */

export const SAVED_REPORT_BUCKET = "onebook-reports";

/** Ten megabytes, the same ceiling supporting documents use. */
export const SAVED_REPORT_MAX_BYTES = 10_485_760;

export const SAVED_REPORT_SOURCES = [
  "quickbooks",
  "wave",
  "bank",
  "spreadsheet",
  "other",
] as const;
export type SavedReportSource = (typeof SAVED_REPORT_SOURCES)[number];

export const SAVED_REPORT_SOURCE_LABEL: Record<SavedReportSource, string> = {
  quickbooks: "QuickBooks",
  wave: "Wave",
  bank: "Bank",
  spreadsheet: "Spreadsheet",
  other: "Other",
};

/**
 * Deliberately narrower than the attachment allowlist. Nothing in this bucket
 * is scanned, so the list holds only formats a browser will not execute, and
 * every signed URL is issued as a download besides.
 */
export const SAVED_REPORT_MIME_TYPES = [
  "text/csv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
] as const;

export const SAVED_REPORT_ACCEPT = ".csv,.pdf,.xlsx,.png,.jpg,.jpeg";

const EXTENSIONS: Record<string, string> = {
  "text/csv": "csv",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png",
  "image/jpeg": "jpg",
  // A bank's own download, kept as a statement file (1.83).
  "text/plain": "txt",
};

export function savedReportExtension(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "bin";
}

/**
 * `<company schema>/<object id>.<ext>`.
 *
 * The folder is the company's schema, so an object found in the bucket can be
 * traced back to the books it belongs to — and, since 1.83, so the database can
 * refuse to register a path outside its own folder (`current_schema()`).
 * Files saved before 1.83 sit under the company's id; they are left where they
 * are. Reading never authorises on a path — a signed URL is minted only after
 * the row was read through the session.
 */
export function savedReportStoragePath(
  folder: string,
  mimeType: string,
  objectId: string,
): string {
  return `${folder}/${objectId}.${savedReportExtension(mimeType)}`;
}

/** Whether the viewer can show this file as a table rather than a download. */
export function isTabularSavedReport(mimeType: string): boolean {
  return mimeType === "text/csv";
}

/**
 * How a saved file is shown inside OneBook. Nothing in the store is scanned, so
 * nothing is handed to the browser to open: a PDF is drawn as images, a CSV is
 * a table, a bank download is text. Anything else is Download only.
 */
export type SavedReportView = "pdf" | "table" | "text" | "download";

export function savedReportView(mimeType: string): SavedReportView {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/csv") return "table";
  if (mimeType === "text/plain") return "text";
  return "download";
}

export function validateSavedReportFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!file.name.trim()) return "Choose a file with a valid name.";
  if (file.name.length > 255) return "The file name must be 255 characters or fewer.";
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > SAVED_REPORT_MAX_BYTES) return "The file must be 10 MB or smaller.";
  if (!SAVED_REPORT_MIME_TYPES.includes(file.type as (typeof SAVED_REPORT_MIME_TYPES)[number])) {
    return "Use CSV, PDF, XLSX, PNG, or JPG.";
  }
  return null;
}

export interface SavedReportPreview {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

/**
 * The first rows of a CSV, ready to render.
 *
 * A report from another product has blank and repeated column headings, so the
 * grid is kept as rows rather than keyed records — keying would silently merge
 * two columns called "Amount" into one.
 */
export function savedReportPreview(text: string, limit = 500): SavedReportPreview {
  const grid = parseCsvGrid(text);
  if (grid.length === 0) return { headers: [], rows: [], truncated: false };
  const [headers, ...body] = grid;
  return {
    headers,
    rows: body.slice(0, limit),
    truncated: body.length > limit,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const savedReportRegisterSchema = z
  .object({
    title: z.string().trim().min(1, "Give the report a title").max(200),
    source: z.enum(SAVED_REPORT_SOURCES),
    period_start: isoDate.nullable(),
    period_end: isoDate.nullable(),
    notes: z.string().trim().max(2000).nullable(),
    file_name: z.string().trim().min(1).max(255),
    storage_path: z.string().min(1).max(400),
    mime_type: z.enum(SAVED_REPORT_MIME_TYPES),
    size_bytes: z.number().int().positive().max(SAVED_REPORT_MAX_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "Expected a sha256 digest"),
  })
  .refine(
    (value) => !value.period_start || !value.period_end || value.period_end >= value.period_start,
    { message: "The period cannot end before it starts", path: ["period_end"] },
  );

export type SavedReportRegisterInput = z.infer<typeof savedReportRegisterSchema>;

export const savedReportArchiveSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1, "Say why this report is being archived").max(500),
});
