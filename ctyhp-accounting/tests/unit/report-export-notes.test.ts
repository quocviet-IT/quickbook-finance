import { describe, expect, it } from "vitest";
import { buildReportPdf } from "@/lib/client/report-export";
import type { ReportExportSheet } from "@/lib/domain/report-export";

const sheet: ReportExportSheet = {
  fileName: "customer-statement-example",
  companyName: "Example Jewelry LLC",
  title: "Customer Statement",
  subtitle: "Example Customer · 09/01/2026 – 09/30/2026",
  currencyCode: "USD",
  columns: [
    { key: "type", header: "Type", kind: "text", width: 18 },
    { key: "running", header: "Running", kind: "money", width: 16 },
  ],
  rows: [
    { type: "Opening balance", running: 0 },
    { type: "Closing balance", running: 40 },
  ],
};

const text = async (s: ReportExportSheet) =>
  new TextDecoder("latin1").decode(new Uint8Array((await buildReportPdf(s)).output("arraybuffer") as ArrayBuffer));

describe("a report PDF's notes (2.87)", () => {
  it("prints each note under the table, its heading before its words", async () => {
    const page = await text({ ...sheet, notes: [{ heading: "How to pay", text: "Checks payable to Example Jewelry LLC." }] });
    const table = page.indexOf("(Closing balance)");
    const heading = page.indexOf("(How to pay)");
    expect(table).toBeGreaterThan(-1);
    expect(heading).toBeGreaterThan(table);
    expect(page.indexOf("(Checks payable to Example Jewelry LLC.)")).toBeGreaterThan(heading);
  });

  it("prints nothing extra for a sheet without notes", async () => {
    expect(await text(sheet)).not.toContain("(How to pay)");
  });
});
