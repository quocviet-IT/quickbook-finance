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
    // The control itself lives in the toolbar, which every tab shares.
    expect(read("ImportToolbar.tsx")).toMatch(/Post to bank account/i);
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

describe("the pre-flight panel", () => {
  it("answers both prerequisites where they are found, not on another screen", () => {
    // The report made the same complaint twice, of the chart of accounts and of
    // Banking: the requirement "is only revealed after the user has already
    // gone through the upload and mapping steps".
    const panel = read("ImportPreflightPanel.tsx");
    expect(panel).toContain("do not name one account");
    expect(panel).toContain("no record under Banking");
    expect(panel).toContain("Add under Banking");
    // The picker itself is shared with the general ledger tab, which hits the
    // same wall with the same chart and used to have only half the answer.
    expect(read("UnresolvedAccountsTable.tsx")).toContain("Choose an account");
    expect(read("LedgerImportPanel.tsx")).toContain("UnresolvedAccountsTable");
  });

  it("never offers to create an account without asking what kind it is", () => {
    // A transaction row is not evidence that an account should exist, and its
    // type cannot be read off a row. "Transfer from PERFBUS CHK (530)" reads
    // like an account and is a description of a transfer.
    const create = read("CreateAccountFromImport.tsx");
    expect(create).toContain("ACCOUNT_TYPE_LABEL");
    expect(create).toMatch(/rules=\{\[\{ required: true, message: "Choose what kind of account this is" \}\]\}/);
    expect(create).not.toMatch(/account_type:\s*"/);
  });

  it("shows the pre-flight before the columns are agreed", () => {
    const client = read("ImportClient.tsx");
    expect(client.indexOf("ImportPreflightSection")).toBeGreaterThan(-1);
    expect(client.indexOf("<ImportPreflightSection")).toBeLessThan(
      client.indexOf("<ImportColumnsTable"),
    );
  });
});

describe("the import screen's shape", () => {
  it("keeps every import component under the 400-line ceiling", () => {
    for (const file of [
      "ImportClient.tsx",
      "ImportGuidance.tsx",
      "ImportColumnsTable.tsx",
      "ImportPreviewPanel.tsx",
      "ImportPreflightPanel.tsx",
      "ImportPreflightSection.tsx",
      "CreateAccountFromImport.tsx",
      "AddBankRecordFromImport.tsx",
      "ImportConfirmContent.tsx",
      "ImportBatchRegister.tsx",
      "ImportToolbar.tsx",
      "UnresolvedAccountsTable.tsx",
      "LedgerImportPanel.tsx",
      "LedgerBatchList.tsx",
    ]) {
      expect(lineCount(file), file).toBeLessThanOrEqual(400);
    }
  });
});
