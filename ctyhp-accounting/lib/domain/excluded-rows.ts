import { toCsv } from "@/lib/csv";

/**
 * The rows an import will leave out, written back as a file.
 *
 * "The import preview shows '100 row(s) will be left out' … This means nearly
 * 7% of the data will be lost during import, and the system does not provide an
 * easy way to fix these rows." The count was the whole of what anyone was told.
 *
 * Rebuilt from the file the screen already holds rather than sent back from the
 * server: those rows never left the browser, so returning a hundred of them
 * across the wire to describe themselves would be a copy of something already
 * in hand.
 *
 * The line number comes first and the file's own columns follow, carrying every
 * value exactly as it was read — so the result opens beside the original and can
 * be corrected against it, which is what somebody holding a source file they can
 * edit actually needs, and the nearest honest thing to editing rows inside a
 * preview. The heading text is lower-cased, because that is how `parseCsv` keys
 * a file and therefore what every other screen shows too.
 */
export interface ExcludedRow {
  /** The line in the file, counting the header as line 1. */
  line: number;
  reason: string;
  message: string;
}

export function excludedRowsCsv(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  excluded: readonly ExcludedRow[],
): string {
  // Keyed by position rather than by header text: a file is free to have two
  // columns of the same name, and one of them must not swallow the other.
  const columns = [
    { key: "line", header: "Line in file" },
    { key: "reason", header: "Why it was left out" },
    { key: "message", header: "What to do" },
    ...headers.map((header, index) => ({ key: `c${index}`, header })),
  ];

  const body = [...excluded]
    .sort((a, b) => a.line - b.line)
    .map((entry) => {
      // `line` counts the header, so the data row sits two behind it.
      const row = rows[entry.line - 2] ?? [];
      const record: Record<string, string> = {
        line: String(entry.line),
        reason: entry.reason,
        message: entry.message,
      };
      headers.forEach((_header, index) => {
        record[`c${index}`] = row[index] ?? "";
      });
      return record;
    });

  return toCsv(body, columns);
}
