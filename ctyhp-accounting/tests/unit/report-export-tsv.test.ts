import { describe, expect, it } from "vitest";
import { tsvFromExportSheet } from "@/lib/domain/report-export";

describe("tsvFromExportSheet", () => {
  const tsv = tsvFromExportSheet({
    fileName: "x",
    companyName: "Harbour Test Co",
    title: "Profit and Loss",
    subtitle: "April 1, 2026 – June 30, 2026",
    currencyCode: "USD",
    columns: [
      { key: "account", header: "Account" },
      { key: "amount", header: "Amount", kind: "money" },
    ],
    rows: [
      { account: "4000 Sales", amount: 12000 },
      { account: "A name\twith a tab", amount: null },
    ],
  });
  const lines = tsv.split("\n");

  it("puts the report's identity above the table", () => {
    expect(lines.slice(0, 5)).toEqual(["Harbour Test Co", "Profit and Loss", "April 1, 2026 – June 30, 2026", "Currency: USD", ""]);
  });

  it("separates columns with tabs, writes money plainly, and keeps a stray tab from splitting a cell", () => {
    expect(lines[5]).toBe("Account\tAmount");
    expect(lines[6]).toBe("4000 Sales\t12000.00");
    expect(lines[7]).toBe("A name with a tab\t");
  });
});
