import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = ["app", "(app)", "settings", "import"];
const read = (file: string) => readFileSync(join(process.cwd(), ...route, file), "utf8");
const lineCount = (file: string) => read(file).split(/\r?\n/).length;

describe("the import guidance panel", () => {
  it("keeps guidance and the column table in their own components", () => {
    const client = read("ImportClient.tsx");
    expect(client).toContain("<ImportGuidance");
    expect(client).toContain("<ImportColumnsTable");
    expect(client).toContain("detectFileShape");
  });

  it("offers the template and answers the batch question", () => {
    const guidance = read("ImportGuidance.tsx");
    expect(guidance).toContain("templateCsvFor");
    expect(guidance).toContain("Download template");
    // The report asked whether ledgers must be imported one at a time.
    expect(guidance).toMatch(/one file/i);
    expect(guidance).toMatch(/every account/i);
    // Where the file comes from in the other product.
    expect(guidance).toMatch(/QuickBooks/);
    expect(guidance).toMatch(/Wave/);
  });

  it("lets a recognised file switch to the tab it belongs in", () => {
    expect(read("ImportGuidance.tsx")).toContain("onSwitchTarget");
    expect(read("ImportGuidance.tsx")).toContain("describeShapeMismatch");
  });
});

describe("the transactions tab", () => {
  it("offers the tab and a bank account to post against", () => {
    const client = read("ImportClient.tsx");
    expect(client).toContain('"transactions"');
    expect(client).toContain("bankAccounts");
    expect(client).toMatch(/Post to bank account/i);
  });

  it("blocks the import when the chart is missing an account", () => {
    const panel = read("ImportPreviewPanel.tsx");
    expect(panel).toContain("missingAccounts");
    expect(panel).toMatch(/Import the chart of accounts first/i);
  });

  it("reports rows that were imported before rather than posting them again", () => {
    expect(read("ImportPreviewPanel.tsx")).toContain("duplicates");
  });
});

describe("the import screen's shape", () => {
  it("keeps every import component under the 400-line ceiling", () => {
    for (const file of [
      "ImportClient.tsx",
      "ImportGuidance.tsx",
      "ImportColumnsTable.tsx",
      "ImportPreviewPanel.tsx",
    ]) {
      expect(lineCount(file), file).toBeLessThanOrEqual(400);
    }
  });
});
