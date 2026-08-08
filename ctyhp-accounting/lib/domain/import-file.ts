import { parseCsv } from "@/lib/csv";
import { proposeMapping, type ImportTarget } from "./import-mapping";

export interface ReadImportFile {
  /** The file's own headings, in the order it wrote them. */
  columns: string[];
  /** Data rows only, one array per row, aligned to `columns`. */
  rows: string[][];
  proposed: ReturnType<typeof proposeMapping>;
}

/**
 * Turn a chosen file into the three things the screen works from.
 *
 * Pure, so the step between "somebody picked a file" and "the screen has
 * columns to agree" can be tested without a browser — it is where a header the
 * matcher does not recognise becomes a column nobody mapped.
 *
 * Null when the file has no rows under its header, which is a different thing
 * from a file that could not be read at all and reads differently on screen.
 */
export function readImportFile(text: string, target: ImportTarget): ReadImportFile | null {
  const records = parseCsv(text);
  if (records.length === 0) return null;

  const columns = Object.keys(records[0]);
  return {
    columns,
    rows: records.map((record) => columns.map((column) => record[column] ?? "")),
    proposed: proposeMapping(columns, target),
  };
}
