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
