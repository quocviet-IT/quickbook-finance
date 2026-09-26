import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  duplicateEntries,
  holdingAccounts,
  undepositedFunds,
  unreconciledBankAccounts,
  wrongWayBalances,
  yearTotalsFromMonthly,
  yearsWithIncomeAndNoCost,
  type ExceptionAccount,
  type ExceptionBankAccount,
  type LedgerBalance,
  type TransactionListRow,
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

  it("reports an account matching both the name and the code only once", () => {
    const rows = undepositedFunds(
      [account({ accountId: "u1", accountCode: "1210", name: "Undeposited Funds", accountType: "current_asset", debitBase: 900_00 })],
      new Map(),
    );
    expect(rows).toHaveLength(1);
  });
});

const bank = (over: Partial<ExceptionBankAccount> = {}): ExceptionBankAccount => ({
  bankAccountId: "b1",
  accountId: "a1",
  accountName: "Checking 3388",
  lastReconciledDate: null,
  ...over,
});

describe("unreconciledBankAccounts", () => {
  const balances = new Map<string, number>([["a1", 96_293_85]]);

  it("flags a bank account nobody has ever reconciled", () => {
    const rows = unreconciledBankAccounts([bank()], balances, "2026-09-30");
    expect(rows).toHaveLength(1);
    expect(rows[0].lastReconciledDate).toBeNull();
    expect(rows[0].balanceMinor).toBe(96_293_85);
  });

  it("flags one whose last reconciliation stops short of the report date", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-06-30" })], balances, "2026-09-30");
    expect(rows).toHaveLength(1);
  });

  it("leaves one reconciled exactly to the report date alone", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-09-30" })], balances, "2026-09-30");
    expect(rows).toEqual([]);
  });

  it("leaves one reconciled beyond the report date alone", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-10-31" })], balances, "2026-09-30");
    expect(rows).toEqual([]);
  });

  it("says nothing about a closed account with no balance to prove", () => {
    const rows = unreconciledBankAccounts([bank()], new Map([["a1", 0]]), "2026-09-30");
    expect(rows).toEqual([]);
  });
});

const bal = (over: Partial<LedgerBalance> = {}): LedgerBalance => ({
  accountId: "x",
  accountCode: "4000",
  name: "Sales Revenue",
  accountType: "income",
  debitBase: 0,
  creditBase: 0,
  ...over,
});

describe("yearTotalsFromMonthly", () => {
  it("sums income as credits less debits, and cost as debits less credits", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [bal({ creditBase: 100_00 }), bal({ accountCode: "6000", accountType: "expense", debitBase: 40_00 })]],
      ["2026-02", [bal({ creditBase: 50_00, debitBase: 10_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([
      { year: "2026", incomeMinor: 140_00, costMinor: 40_00 },
    ]);
  });

  it("counts other income and other expense on the right sides", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [
        bal({ accountType: "other_income", creditBase: 30_00 }),
        bal({ accountType: "other_expense", debitBase: 7_00 }),
        bal({ accountType: "cost_of_goods_sold", debitBase: 3_00 }),
      ]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([
      { year: "2026", incomeMinor: 30_00, costMinor: 10_00 },
    ]);
  });

  it("ignores balance sheet accounts entirely", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [bal({ accountType: "bank", debitBase: 900_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([{ year: "2026", incomeMinor: 0, costMinor: 0 }]);
  });

  it("separates the years and returns them oldest first", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2025-12", [bal({ creditBase: 10_00 })]],
      ["2024-06", [bal({ creditBase: 20_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth).map((y) => y.year)).toEqual(["2024", "2025"]);
  });
});

describe("yearsWithIncomeAndNoCost", () => {
  it("flags a year with revenue and nothing spent against it", () => {
    const rows = yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 500_000_00, costMinor: 0 }]);
    expect(rows).toEqual([{ year: "2024", incomeMinor: 500_000_00, costMinor: 0 }]);
  });

  it("does not flag a year with even one cost in it", () => {
    expect(yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 500_000_00, costMinor: 1 }])).toEqual([]);
  });

  it("does not flag a year with no income either — that is a quiet year, not a broken one", () => {
    expect(yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 0, costMinor: 0 }])).toEqual([]);
  });
});

const txn = (over: Partial<TransactionListRow> = {}): TransactionListRow => ({
  entryId: "t1",
  entryNumber: "JE-000001",
  entryDate: "2026-03-04",
  description: "Monthly rent",
  sourceType: "manual",
  partyName: "Harbour Property Ltd",
  categoryLabel: "Rent",
  moneyLabel: "Checking 3388",
  amountMinor: -4_500_00,
  currencyCode: "USD",
  reconciled: false,
  accountIds: ["rent", "checking"],
  ...over,
});

describe("duplicateEntries", () => {
  const noRefs = new Map<string, string>();

  it("groups two entries alike in date, party, accounts and amount", () => {
    const groups = duplicateEntries([txn(), txn({ entryId: "t2", entryNumber: "JE-000002" })], noRefs);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.entryId)).toEqual(["t1", "t2"]);
  });

  it("reports nothing when the amounts differ", () => {
    expect(duplicateEntries([txn(), txn({ entryId: "t2", amountMinor: -4_500_01 })], noRefs)).toEqual([]);
  });

  it("reports nothing when the accounts differ", () => {
    expect(
      duplicateEntries([txn(), txn({ entryId: "t2", accountIds: ["rent", "savings"] })], noRefs),
    ).toEqual([]);
  });

  it("does not care what order the accounts arrive in", () => {
    const groups = duplicateEntries(
      [txn(), txn({ entryId: "t2", accountIds: ["checking", "rent"] })],
      noRefs,
    );
    expect(groups).toHaveLength(1);
  });

  it("separates two entries carrying different references", () => {
    const refs = new Map<string, string>([["t1", "1018"], ["t2", "1019"]]);
    expect(duplicateEntries([txn(), txn({ entryId: "t2" })], refs)).toEqual([]);
  });

  it("groups two entries carrying the same reference", () => {
    const refs = new Map<string, string>([["t1", "1018"], ["t2", "1018"]]);
    expect(duplicateEntries([txn(), txn({ entryId: "t2" })], refs)).toHaveLength(1);
  });

  it("treats a missing party the same as another missing party", () => {
    const groups = duplicateEntries(
      [txn({ partyName: null }), txn({ entryId: "t2", partyName: null })],
      noRefs,
    );
    expect(groups).toHaveLength(1);
  });

  it("returns the groups oldest first", () => {
    const groups = duplicateEntries(
      [
        txn({ entryId: "n1", entryDate: "2026-05-01" }),
        txn({ entryId: "n2", entryDate: "2026-05-01" }),
        txn({ entryId: "o1", entryDate: "2026-01-01" }),
        txn({ entryId: "o2", entryDate: "2026-01-01" }),
      ],
      noRefs,
    );
    expect(groups.map((g) => g.entries[0].entryDate)).toEqual(["2026-01-01", "2026-05-01"]);
  });

  it("does not group two entries whose party and reference merely concatenate alike", () => {
    const refs = new Map<string, string>([["t1", "x"], ["t2", "1018|x"]]);
    const groups = duplicateEntries(
      [txn({ partyName: "Smith|1018" }), txn({ entryId: "t2", partyName: "Smith" })],
      refs,
    );
    expect(groups).toEqual([]);
  });
});

describe("the exceptions module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/exceptions.ts", "utf8");
    const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imported.filter((p) => p.startsWith("@/lib/db/") || p.startsWith("@/lib/services/"))).toEqual([]);
  });
});
