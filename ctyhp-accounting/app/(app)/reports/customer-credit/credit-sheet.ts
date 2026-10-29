import { sanitizeExportFileName, type ReportExportSheet } from "@/lib/domain/report-export";
import { plural } from "@/lib/format";
import type { CustomerCreditRow } from "@/lib/services/credit";

/** What Copy, CSV, PDF and Excel hand over for Customer Credit: the customers on screen, with the columns the CSV always had. */
export function customerCreditSheet(
  rows: readonly CustomerCreditRow[],
  ctx: { companyName: string; salesWindowDays: number },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName("customer-credit-exposure"),
    companyName: ctx.companyName,
    title: "Customer Credit Exposure",
    // A spreadsheet takes the number, so past the window the cell is blank
    // rather than a figure in the thousands (see describeDso), and the subtitle says why.
    subtitle: `Sales window ${plural(ctx.salesWindowDays, "day")}. DSO is blank where more is owed than was invoiced in the window.`,
    currencyCode: "USD",
    columns: [
      { key: "customer", header: "Customer", kind: "text" },
      { key: "credit_limit", header: "Credit limit", kind: "money" },
      { key: "owed", header: "Owed now", kind: "money" },
      { key: "available", header: "Available", kind: "money" },
      { key: "overdue", header: "Past due", kind: "money" },
      { key: "oldest_due", header: "Oldest due date", kind: "text" },
      { key: "dso", header: "DSO (days)", kind: "number" },
      { key: "state", header: "Credit status", kind: "text" },
      { key: "terms_days", header: "Terms (days)", kind: "number" },
      { key: "billing_address", header: "Billing address on file", kind: "text" },
    ],
    rows: rows.map((row) => ({
      customer: row.name,
      credit_limit: row.creditLimitMinor === null ? null : row.creditLimitMinor / 100,
      owed: row.openBalanceMinor / 100,
      available: row.status.availableMinor === null ? null : row.status.availableMinor / 100,
      overdue: row.overdueMinor / 100,
      oldest_due: row.oldestDueDate ?? "",
      dso:
        row.status.daysSalesOutstanding === null || row.status.daysSalesOutstanding > ctx.salesWindowDays
          ? null
          : row.status.daysSalesOutstanding,
      state: row.status.label,
      terms_days: row.creditTermsDays,
      billing_address: row.hasBillingAddress ? "yes" : "no",
    })),
  };
}
