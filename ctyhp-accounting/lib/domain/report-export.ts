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
