import { describe, expect, it } from "vitest";
import { csvWithReportIdentity } from "@/lib/domain/report-export";

const identity = {
  companyName: "Aurora Fine Jewelry LLC",
  title: "Customer Credit Exposure",
  subtitle: "As of 2026-08-03",
  currencyCode: "USD",
};

const table = "Customer,Owed now\nElena Brooks,759.07\n";

describe("csvWithReportIdentity", () => {
  it("lays the identity out the way the Excel export does", () => {
    // Same four rows, then a blank, then the table — so exporting one report as
    // CSV and as XLSX does not produce two differently shaped files.
    const lines = csvWithReportIdentity(table, identity).split("\n");
    expect(lines[0]).toBe("Aurora Fine Jewelry LLC");
    expect(lines[1]).toBe("Customer Credit Exposure");
    expect(lines[2]).toBe("As of 2026-08-03");
    expect(lines[3]).toBe("Currency: USD");
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("Customer,Owed now");
  });

  it("keeps the data rows untouched", () => {
    expect(csvWithReportIdentity(table, identity)).toContain("Elena Brooks,759.07");
  });

  it("quotes a company name containing a comma", () => {
    // "Cascade Precious Metals, Inc." unquoted would split into two columns and
    // shift the whole preamble.
    const out = csvWithReportIdentity(table, {
      ...identity,
      companyName: "Cascade Precious Metals, Inc.",
    });
    expect(out.split("\n")[0]).toBe('"Cascade Precious Metals, Inc."');
  });

  it("escapes a quote inside a name rather than breaking the field", () => {
    const out = csvWithReportIdentity(table, { ...identity, companyName: 'The "Gem" Company' });
    expect(out.split("\n")[0]).toBe('"The ""Gem"" Company"');
  });

  it("survives a name with a line break in it", () => {
    const out = csvWithReportIdentity(table, { ...identity, companyName: "Two\nLines Ltd" });
    expect(out.startsWith('"Two\nLines Ltd"')).toBe(true);
  });

  it("leaves an empty subtitle as an empty row rather than the word undefined", () => {
    const lines = csvWithReportIdentity(table, { ...identity, subtitle: "" }).split("\n");
    expect(lines[2]).toBe("");
  });
});
