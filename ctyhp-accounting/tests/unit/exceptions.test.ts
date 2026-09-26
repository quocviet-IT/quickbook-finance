import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  holdingAccounts,
  undepositedFunds,
  wrongWayBalances,
  type ExceptionAccount,
  type UndepositedDetail,
} from "@/lib/domain/exceptions";

const account = (over: Partial<ExceptionAccount> = {}): ExceptionAccount => ({
  accountId: "a1",
  accountCode: "1000",
  name: "Cash on Hand",
  accountType: "bank",
  detailType: null,
  debitBase: 0,
  creditBase: 0,
  ...over,
});

describe("wrongWayBalances", () => {
  it("flags an expense account carrying a credit balance", () => {
    const rows = wrongWayBalances([
      account({ accountId: "e1", accountCode: "6100", name: "Payroll Taxes", accountType: "expense", creditBase: 7_334_72 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].accountCode).toBe("6100");
    expect(rows[0].balanceMinor).toBe(-7_334_72);
  });

  it("leaves an account carrying its normal balance alone", () => {
    const rows = wrongWayBalances([account({ accountType: "expense", debitBase: 500_00 })]);
    expect(rows).toEqual([]);
  });

  it("does not flag a contra account, which is meant to point the other way", () => {
    const rows = wrongWayBalances([
      account({
        accountCode: "1590",
        name: "Accumulated Depreciation",
        accountType: "fixed_asset",
        detailType: "Contra fixed asset",
        creditBase: 42_000_00,
      }),
    ]);
    expect(rows).toEqual([]);
  });

  it("ignores an account with no balance at all", () => {
    const rows = wrongWayBalances([account({ accountType: "income" })]);
    expect(rows).toEqual([]);
  });

  it("puts the largest question first", () => {
    const rows = wrongWayBalances([
      account({ accountId: "s", accountCode: "6100", accountType: "expense", creditBase: 100_00 }),
      account({ accountId: "b", accountCode: "6200", accountType: "expense", creditBase: 900_00 }),
    ]);
    expect(rows.map((r) => r.accountCode)).toEqual(["6200", "6100"]);
  });

  it("still flags a detail_type like 'Contractor Fees' that contains 'Contractor' without a word boundary", () => {
    const rows = wrongWayBalances([
      account({
        accountCode: "6300",
        name: "Contractor Fees",
        accountType: "expense",
        detailType: "Contractor Fees",
        creditBase: 1_000_00,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].accountCode).toBe("6300");
  });
});

describe("holdingAccounts", () => {
  it("flags anything left in Uncategorized", () => {
    const rows = holdingAccounts([
      account({ accountCode: "9000", name: "Uncategorized Expense", accountType: "expense", debitBase: 475_000_00 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].balanceMinor).toBe(475_000_00);
  });

  it("matches Suspense and Ask My Accountant too", () => {
    const rows = holdingAccounts([
      account({ accountId: "s1", accountCode: "9100", name: "Suspense", accountType: "current_asset", debitBase: 10_00 }),
      account({ accountId: "s2", accountCode: "9200", name: "Ask My Accountant", accountType: "current_asset", debitBase: 20_00 }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("stays silent when the holding account has been cleared to zero", () => {
    expect(holdingAccounts([account({ name: "Uncategorized Income", accountType: "income" })])).toEqual([]);
  });

  it("does not flag an ordinary account", () => {
    expect(holdingAccounts([account({ name: "Sales Revenue", accountType: "income", creditBase: 900_00 })])).toEqual([]);
  });
});

describe("undepositedFunds", () => {
  const details = new Map<string, UndepositedDetail>([
    ["u1", { entryCount: 12, oldestEntryDate: "2026-01-04" }],
  ]);

  it("flags a balance sitting in Undeposited Funds", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u1", accountCode: "1210", name: "Undeposited Funds", accountType: "current_asset", debitBase: 33_400_00 })],
      details,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].entryCount).toBe(12);
    expect(rows[0].oldestEntryDate).toBe("2026-01-04");
  });

  it("recognises the account by code when it has been renamed", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u1", accountCode: "1210", name: "Takings not yet banked", accountType: "current_asset", debitBase: 500_00 })],
      details,
    );
    expect(rows).toHaveLength(1);
  });

  it("recognises a second one by name when it does not carry the code", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u2", accountCode: "1211", name: "Undeposited Funds - Branch", accountType: "current_asset", debitBase: 500_00 })],
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].entryCount).toBe(0);
    expect(rows[0].oldestEntryDate).toBeNull();
  });

  it("says nothing when the account has emptied, which is what should happen", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u1", accountCode: "1210", name: "Undeposited Funds", accountType: "current_asset" })],
      details,
    );
    expect(rows).toEqual([]);
  });
});

describe("the exceptions module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/exceptions.ts", "utf8");
    const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imported.filter((p) => p.startsWith("@/lib/db/") || p.startsWith("@/lib/services/"))).toEqual([]);
  });
});
