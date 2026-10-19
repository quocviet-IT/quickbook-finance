import { AGING_BUCKETS, agingSummaryGrid, pivotAgingByParty } from "./aging";
import { fromMinor } from "./money";
import { exportRowsFromMinorAmounts, sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { formatDate } from "@/lib/format";
import { humanizeStatus } from "./status-label";
import type { AgingReportRow } from "@/lib/services/aging";

export type AgingExportGrouping = "grid" | "party" | "document";

/**
 * What an aging report hands over: the grouping the reader is looking at, as
 * the same columns and rows the screen shows. Money is integer minor units in
 * the domain and major units in the sheet.
 */
export function agingExportSheet(input: {
  grouping: AgingExportGrouping;
  rows: readonly AgingReportRow[];
  /** "Customer" or "Vendor". */
  partyLabel: string;
  companyName: string;
  asOf: string;
  currencyCode: string;
  baseDecimals: number;
}): ReportExportSheet {
  const { grouping, rows, partyLabel, baseDecimals } = input;
  const payable = partyLabel === "Vendor";
  const head = {
    companyName: input.companyName,
    title: `${payable ? "Accounts Payable" : "Accounts Receivable"} Aging`,
    subtitle: `As of ${formatDate(input.asOf)}`,
    currencyCode: input.currencyCode,
  };
  const base = `${partyLabel.toLowerCase()}-aging-${input.asOf}`;
  const pivot = pivotAgingByParty(rows);

  if (grouping === "document") {
    return {
      ...head,
      fileName: sanitizeExportFileName(`${base}-by-document`),
      columns: [
        { key: "party", header: partyLabel, kind: "text" },
        { key: "type", header: "Type", kind: "text" },
        { key: "number", header: "Number", kind: "text" },
        { key: "due", header: "Due", kind: "text" },
        { key: "bucket", header: "Bucket", kind: "text" },
        { key: "balance", header: "Balance", kind: "money" },
      ],
      rows: rows.map((row) => ({
        party: row.entityName,
        type: humanizeStatus(row.docType),
        number: row.docNumber ?? "",
        due: formatDate(row.dueDate),
        // The bucket as the screen names it, never its key (d1_30).
        bucket: AGING_BUCKETS.find((b) => b.key === row.bucket)?.label ?? row.bucket,
        balance: fromMinor(row.balanceMinor, baseDecimals),
      })),
    };
  }

  if (grouping === "party") {
    const keys = [...AGING_BUCKETS.map((bucket) => bucket.key), "overdue", "total"];
    const amounts = [
      ...pivot.rows.map((row) => ({
        label: row.entityName,
        amounts: [...AGING_BUCKETS.map((bucket) => row.buckets[bucket.key] ?? 0), row.overdueMinor, row.totalMinor],
      })),
      {
        label: "Total",
        amounts: [...AGING_BUCKETS.map((bucket) => pivot.bucketTotals[bucket.key] ?? 0), pivot.overdueMinor, pivot.totalMinor],
      },
    ];
    return {
      ...head,
      fileName: sanitizeExportFileName(`${base}-by-${partyLabel.toLowerCase()}`),
      columns: [
        { key: "label", header: partyLabel, kind: "text" },
        ...AGING_BUCKETS.map((bucket) => ({ key: bucket.key, header: bucket.label, kind: "money" as const })),
        { key: "overdue", header: "Overdue", kind: "money" as const },
        { key: "total", header: "Total", kind: "money" as const },
      ],
      rows: exportRowsFromMinorAmounts(amounts, keys, baseDecimals),
    };
  }

  const grid = agingSummaryGrid(pivot);
  const keys = [...grid.columns.map((column) => column.entityId), "total"];
  return {
    ...head,
    fileName: sanitizeExportFileName(`${base}-summary`),
    columns: [
      { key: "label", header: "Age", kind: "text" },
      ...grid.columns.map((column) => ({ key: column.entityId, header: column.entityName, kind: "money" as const })),
      { key: "total", header: "Total", kind: "money" as const },
    ],
    rows: exportRowsFromMinorAmounts(
      grid.rows.map((row) => ({ label: row.label, amounts: [...row.amounts, row.totalMinor] })),
      keys,
      baseDecimals,
    ),
  };
}
