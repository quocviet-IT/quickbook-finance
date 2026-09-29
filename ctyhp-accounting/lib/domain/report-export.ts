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

/** Decimal places the sheet's currency is written in. */
function currencyDigits(currencyCode: string): number {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/** A value as it goes into a text export: money as a plain number in the currency's decimals, a blank as nothing. */
function exportCellText(v: string | number | null | undefined, kind: ExportCellKind, digits: number): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && kind === "money") return v.toFixed(digits);
  return typeof v === "number" ? String(v) : v;
}

/**
 * A sheet as CSV, with the report's identity above it: what "Save as CSV"
 * hands over, from the same sheet the PDF and Excel buttons use.
 *
 * Money is written as a plain number in the currency's own decimals, without a
 * symbol or thousands separators, so a spreadsheet reads it as a number.
 */
export function csvFromExportSheet(sheet: ReportExportSheet): string {
  const cell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const digits = currencyDigits(sheet.currencyCode);
  const lines = [
    sheet.columns.map((c) => cell(c.header)).join(","),
    ...sheet.rows.map((r) => sheet.columns.map((c) => cell(exportCellText(r[c.key], c.kind ?? "text", digits))).join(",")),
  ];
  return csvWithReportIdentity(lines.join("\n"), sheet);
}

/**
 * A sheet as tab-separated text, for "Copy this report": pasted into a
 * spreadsheet it keeps its columns, with the report's identity above them. A
 * tab or line break inside a value would split it, so it becomes a space.
 */
export function tsvFromExportSheet(sheet: ReportExportSheet): string {
  const clean = (value: string): string => value.replace(/[\t\r\n]+/g, " ");
  const digits = currencyDigits(sheet.currencyCode);
  return [
    clean(sheet.companyName),
    clean(sheet.title),
    clean(sheet.subtitle),
    `Currency: ${sheet.currencyCode}`,
    "",
    sheet.columns.map((c) => clean(c.header)).join("\t"),
    ...sheet.rows.map((r) => sheet.columns.map((c) => clean(exportCellText(r[c.key], c.kind ?? "text", digits))).join("\t")),
  ].join("\n");
}
