import { fromMinor } from "./money";

export type ExportCellKind = "text" | "number" | "money" | "percent";

export interface ReportExportColumn {
  key: string;
  header: string;
  kind?: ExportCellKind;
  width?: number;
}

export interface ReportExportSheet {
  fileName: string;
  companyName: string;
  title: string;
  subtitle: string;
  currencyCode: string;
  columns: ReportExportColumn[];
  rows: Record<string, string | number | null>[];
}

export function sanitizeExportFileName(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "accounting-report";
}

export function formatExportCell(
  value: string | number | null,
  kind: ExportCellKind,
  currencyCode: string,
): string {
  if (value === null || value === "") return "";
  if (typeof value === "string") return value;
  if (kind === "money") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (kind === "percent") return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString("en-US");
}

/** One export-sheet row's worth of amounts, before they are keyed by column. */
export interface MinorAmountRow {
  label: string;
  /** Integer minor units, one per column, in the same order as `columnKeys`. */
  amounts: readonly number[];
}

/**
 * Turn per-column minor-unit amounts into the major-unit values a
 * `ReportExportSheet` row expects, keyed the same way its `kind: "money"`
 * columns are keyed.
 *
 * Money stays integer minor units everywhere in the domain; an export sheet
 * is a display edge exactly like the on-screen table, so this is the one
 * place a multi-column money export (a trend across periods, an aging grid
 * across parties) has to divide by the currency's own decimal scale. It is
 * pulled out into one function, rather than written inline in each view,
 * specifically so that scale can never be hard-coded to 100 or forgotten —
 * `baseDecimals` is 0 for a currency like VND, and dividing by 100 anyway
 * would silently shrink every figure by two orders of magnitude.
 *
 * A row shorter than `columnKeys` (a section header, which carries no
 * amounts) reads as a blank cell for the missing columns, not as $0.00.
 */
export function exportRowsFromMinorAmounts(
  rows: readonly MinorAmountRow[],
  columnKeys: readonly string[],
  baseDecimals: number,
): Record<string, string | number | null>[] {
  return rows.map((row) => ({
    label: row.label,
    ...Object.fromEntries(
      columnKeys.map((key, index) => {
        const minor = row.amounts[index];
        return [key, minor === undefined ? null : fromMinor(minor, baseDecimals)];
      }),
    ),
  }));
}

/**
 * Prepend the four identity rows to a CSV export.
 *
 * A CSV that names no company is a file somebody will read next quarter without
 * knowing whose it is — the same problem the on-screen reports had. The layout
 * deliberately mirrors `buildWorksheet`: company, title, subtitle, currency, a
 * blank row, then the table. Exporting one report as CSV and as XLSX should not
 * produce two differently shaped files.
 *
 * Values are quoted the same way a data cell is, because a legal name with a
 * comma in it — "Cascade Precious Metals, Inc." — would otherwise split into
 * two columns and shift the preamble.
 */
export function csvWithReportIdentity(
  csv: string,
  identity: { companyName: string; title: string; subtitle: string; currencyCode: string },
): string {
  const cell = (value: string): string => {
    const text = value ?? "";
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const preamble = [
    cell(identity.companyName),
    cell(identity.title),
    cell(identity.subtitle),
    cell(`Currency: ${identity.currencyCode}`),
    "",
  ];
  return `${preamble.join("\n")}\n${csv}`;
}
