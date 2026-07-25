import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildReportXlsx } from "@/lib/client/report-export";
import {
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
