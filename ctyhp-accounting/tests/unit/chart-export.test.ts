import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsvGrid } from "@/lib/csv";
import { ACCOUNT_TYPES } from "@/lib/domain/accounts";
import { chartOfAccountsCsv, chartOfAccountsFileName, exportedAccountType } from "@/lib/domain/chart-export";
import { applyMapping, proposeMapping, splitAccountName, translateAccountType } from "@/lib/domain/import-mapping";
import { detectFileShape } from "@/lib/domain/import-shape";
import type { AccountRow } from "@/lib/db/types";

/**
 * 2.98: Export chart on Chart of Accounts writes the active chart in the
 * Chart of accounts import's own columns, so it goes back in unchanged
 * (the prototype's "copy my chart of accounts").
 */
const account = (over: Partial<AccountRow>): AccountRow =>
  ({
    id: "a",
    account_code: "1000",
    name: "Example",
    account_type: "bank",
    description: null,
    parent_account_id: null,
    status: "active",
    ...over,
  }) as AccountRow;

const chart: AccountRow[] = [
  account({ id: "bank", account_code: "1010", name: "Operating Checking", account_type: "bank", description: "Main account, checks" }),
  account({ id: "exp", account_code: "6000", name: "Office", account_type: "expense", is_posting_account: false }),
  account({ id: "sup", account_code: "6010", name: "Supplies", account_type: "expense", parent_account_id: "exp" }),
  account({ id: "ar", account_code: "1200", name: "Accounts Receivable", account_type: "accounts_receivable" }),
  account({ id: "old", account_code: "6990", name: "Retired", account_type: "expense", status: "inactive" }),
];

describe("Export chart", () => {
  it("names every account type so the import reads it back as the same type", () => {
    for (const type of ACCOUNT_TYPES) expect(translateAccountType(exportedAccountType(type)), type).toBe(type);
  });

  it("writes the import's own columns: active accounts, in code order, a subaccount as Parent: Child, no balances", () => {
    const grid = parseCsvGrid(chartOfAccountsCsv(chart));
    expect(grid[0]).toEqual(["Account code", "Account name", "Type", "Description", "Opening balance"]);
    expect(grid.slice(1).map((row) => row.slice(0, 2))).toEqual([
      ["1010", "Operating Checking"],
      ["1200", "Accounts Receivable"],
      ["6000", "Office"],
      ["6010", "Office: Supplies"],
    ]);
    expect(grid[1][3]).toBe("Main account, checks");
    expect(grid.slice(1).every((row) => row[4] === "")).toBe(true);
  });

  it("goes back in through the import unchanged: detected, mapped and read with no problems", () => {
    const grid = parseCsvGrid(chartOfAccountsCsv(chart));
    const [headers, ...rows] = grid;
    expect(detectFileShape(headers).target).toBe("chart_of_accounts");
    const mapping = proposeMapping(headers, "chart_of_accounts");
    const parsed = applyMapping(rows, mapping.columns, "chart_of_accounts");
    expect(parsed.problems).toEqual([]);
    expect(parsed.records.map((r) => [r.account_code, splitAccountName(String(r.name)), r.account_type])).toEqual([
      ["1010", { name: "Operating Checking", parents: [] }, "bank"],
      ["1200", { name: "Accounts Receivable", parents: [] }, "accounts_receivable"],
      ["6000", { name: "Office", parents: [] }, "expense"],
      ["6010", { name: "Supplies", parents: ["Office"] }, "expense"],
    ]);
  });

  it("is dated, and offered on Chart of Accounts", () => {
    expect(chartOfAccountsFileName("2026-11-02")).toBe("chart-of-accounts-2026-11-02.csv");
    const client = readFileSync(join(process.cwd(), "app/(app)/accounts/AccountsClient.tsx"), "utf8");
    expect(client).toContain("downloadTextFile(chartOfAccountsFileName(initialAsOf), chartOfAccountsCsv(accounts))");
  });
});
