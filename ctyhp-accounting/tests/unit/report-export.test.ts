import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildReportXlsx } from "@/lib/client/report-export";
import {
  exportRowsFromMinorAmounts,
  formatExportCell,
  sanitizeExportFileName,
  type ReportExportSheet,
} from "@/lib/domain/report-export";

const sheet: ReportExportSheet = {
  fileName: "Profit & Loss / 2026",
  companyName: "CTYHP",
  title: "Profit & Loss",
  subtitle: "Jan 1 to Dec 31, 2026",
  currencyCode: "USD",
  columns: [
    { key: "account", header: "Account" },
    { key: "amount", header: "Amount", kind: "money" },
  ],
  rows: [{ account: "4000 — Sales", amount: 1234.56 }],
};

describe("report exports", () => {
  it("creates a valid minimal XLSX package with report values", () => {
    const files = unzipSync(buildReportXlsx(sheet));
    expect(Object.keys(files)).toContain("xl/worksheets/sheet1.xml");
    const worksheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(worksheet).toContain("Profit &amp; Loss");
    expect(worksheet).toContain("<v>1234.56</v>");
  });

  it("sanitizes file names and formats values for PDF", () => {
    expect(sanitizeExportFileName(sheet.fileName)).toBe("Profit-Loss-2026");
    expect(formatExportCell(1234.56, "money", "USD")).toBe("$1,234.56");
  });
});

describe("exportRowsFromMinorAmounts", () => {
  // This is the seam a multi-column money export (Balance Sheet Trend, the
  // aging summary grid) builds its rows through. A trend row's `amounts` are
  // integer minor units, same as everywhere in the domain; a ReportExportSheet
  // row is the display edge, so converting to major units is this function's
  // job alone — a caller that forgets ships every figure 100x too large for a
  // two-decimal currency, silently, because nothing on screen goes through it.
  it("converts each column's minor-unit amount to major units, keyed by column", () => {
    const rows = exportRowsFromMinorAmounts(
      [{ label: "1010 — Operating Bank Account", amounts: [10_000, 25_050] }],
      ["2026-01-31", "2026-02-28"],
      2,
    );
    expect(rows).toEqual([
      { label: "1010 — Operating Bank Account", "2026-01-31": 100, "2026-02-28": 250.5 },
    ]);
  });

  it("does not divide by 100 for a currency with zero decimal places", () => {
    // VND has decimal_places = 0. An exported minor-unit amount of 12,345 đồng
    // is 12,345 đồng, not 123.45 — a fixed "divide by 100" is exactly the bug
    // this function exists to make impossible.
    const rows = exportRowsFromMinorAmounts(
      [{ label: "1010 — Bank", amounts: [12_345] }],
      ["2026-01-31"],
      0,
    );
    expect(rows).toEqual([{ label: "1010 — Bank", "2026-01-31": 12_345 }]);
  });

  it("scales up for a currency with three decimal places", () => {
    const rows = exportRowsFromMinorAmounts(
      [{ label: "1010 — Bank", amounts: [1_234_567] }],
      ["2026-01-31"],
      3,
    );
    expect(rows).toEqual([{ label: "1010 — Bank", "2026-01-31": 1234.567 }]);
  });

  it("leaves a column null, not zero, when a row has no amount for it", () => {
    // A section header row (Assets, Liabilities…) carries no amounts at all;
    // it must read as a blank export cell, not as $0.00 for every period.
    const rows = exportRowsFromMinorAmounts(
      [{ label: "Assets", amounts: [] }],
      ["2026-01-31", "2026-02-28"],
      2,
    );
    expect(rows).toEqual([{ label: "Assets", "2026-01-31": null, "2026-02-28": null }]);
  });

  it("keeps a real zero balance as 0, not null", () => {
    const rows = exportRowsFromMinorAmounts(
      [{ label: "1010 — Bank", amounts: [0] }],
      ["2026-01-31"],
      2,
    );
    expect(rows).toEqual([{ label: "1010 — Bank", "2026-01-31": 0 }]);
  });
});
