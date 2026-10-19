import { describe, expect, it } from "vitest";
import { agingExportSheet } from "@/lib/domain/aging-export";
import { partyStatementSheet } from "@/lib/domain/ledger-report-sheets";
import type { AgingReportRow, StatementReport } from "@/lib/services/aging";

/**
 * The exports the report bar added to pages that had none: what the screen
 * shows, money in major units, and words where the screen has words.
 */
const ctx = { companyName: "Example Co", currencyCode: "USD", baseDecimals: 2 };

describe("the aging export", () => {
  const rows: AgingReportRow[] = [
    { entityId: "c1", entityName: "Example Customer", docType: "invoice", docNumber: "INV-1", docDate: "2026-09-01", dueDate: "2026-09-15", balanceMinor: 12_500, bucket: "d1_30" },
    { entityId: "c1", entityName: "Example Customer", docType: "credit_memo", docNumber: "CM-1", docDate: "2026-10-01", dueDate: "2026-10-20", balanceMinor: -2_500, bucket: "current" },
  ];
  const sheet = (grouping: "grid" | "party" | "document") =>
    agingExportSheet({ grouping, rows, partyLabel: "Customer", companyName: "Example Co", asOf: "2026-10-17", currencyCode: "USD", baseDecimals: 2 });

  it("names each document's bucket and type in words, never the stored key", () => {
    const byDocument = sheet("document");
    expect(byDocument.rows.map((row) => row.bucket)).toEqual(["1–30", "Current"]);
    expect(byDocument.rows.map((row) => row.type)).toEqual(["Invoice", "Credit memo"]);
    expect(byDocument.rows[0].balance).toBe(125);
  });

  it("totals by party in major units, under the screen's column names", () => {
    const byParty = sheet("party");
    expect(byParty.columns.map((c) => c.header)).toContain("1–30");
    expect(byParty.rows.at(-1)).toMatchObject({ label: "Total", total: 100 });
    expect(byParty.subtitle).toBe("As of 10/17/2026");
  });
});

describe("a party statement's export", () => {
  const report: StatementReport = {
    openingMinor: 10_000,
    rows: [
      { txnDate: "2026-09-02", docType: "invoice", docNumber: "INV-7", amountMinor: 5_000, runningMinor: 15_000 },
      { txnDate: "2026-09-20", docType: "customer_payment", docNumber: null, amountMinor: -15_000, runningMinor: 0 },
    ] as StatementReport["rows"],
    closingMinor: 0,
  };

  it("runs from the opening balance through each document to the closing balance", () => {
    const sheet = partyStatementSheet("customer", "Example Customer", report, { from: "2026-09-01", to: "2026-09-30" }, ctx);
    expect(sheet.rows[0]).toMatchObject({ type: "Opening balance", running: 100 });
    expect(sheet.rows.at(-1)).toMatchObject({ type: "Closing balance", running: 0 });
    expect(sheet.rows.slice(1, -1).map((row) => row.type)).toEqual(["Invoice", "Customer payment"]);
    expect(sheet.subtitle).toBe("Example Customer · 09/01/2026 – 09/30/2026");
  });
});
