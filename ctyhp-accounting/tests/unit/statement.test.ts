import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AccountType } from "@/lib/domain/accounts";
import { buildBalanceSheet, buildProfitAndLoss, buildTrialBalance, type BalanceSheet, type LedgerBalance } from "@/lib/domain/reports";
import {
  balanceSheetStatement,
  indexAccounts,
  pnlStatement,
  trialBalanceStatement,
  type AccountRef,
  type Statement,
  type StatementColumn,
} from "@/lib/domain/statement";

const acct = (id: string, code: string, name: string, type: AccountType, parentId: string | null = null): AccountRef => ({
  id,
  code,
  name,
  type,
  parentId,
});

const ACCOUNTS = indexAccounts([
  acct("sales", "4000", "Sales", "income"),
  acct("services", "4100", "Services", "income", "sales"),
  acct("cogs", "5000", "Cost of Goods Sold", "cost_of_goods_sold"),
  acct("rent", "6100", "Rent", "expense"),
  acct("repairs", "6200", "Repairs", "expense"),
  acct("showroom", "6210", "Showroom Repairs", "expense", "repairs"),
  acct("interest", "7000", "Interest Income", "other_income"),
]);

const bal = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
  const a = ACCOUNTS.get(id)!;
  return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
};

/** Q2: $10,000 sales and $2,000 services; $3,000 cost of sales; $1,500 rent, $200 + $300 repairs; $50 interest. */
const CURRENT = [
  bal("sales", 0, 1_000_000),
  bal("services", 0, 200_000),
  bal("cogs", 300_000, 0),
  bal("rent", 150_000, 0),
  bal("repairs", 20_000, 0),
  bal("showroom", 30_000, 0),
  bal("interest", 0, 5_000),
];
/** Q1: $8,000 sales; $2,500 cost of sales; $1,500 rent; $100 showroom repairs. */
const PRIOR = [bal("sales", 0, 800_000), bal("cogs", 250_000, 0), bal("rent", 150_000, 0), bal("showroom", 10_000, 0)];

const Q2: StatementColumn = { key: "current", label: "Q2 2026", sub: "", from: "2026-04-01", to: "2026-06-30", isTotal: false };
const Q1: StatementColumn = { key: "prior", label: "Q1 2026", sub: "", from: "2026-01-01", to: "2026-03-31", isTotal: false };

const single = (rows: LedgerBalance[], showPercent = false) =>
  pnlStatement({ columns: [Q2], pnls: [buildProfitAndLoss(rows)], accounts: ACCOUNTS, showPercent, change: false });
const pair = () =>
  pnlStatement({
    columns: [Q2, Q1],
    pnls: [buildProfitAndLoss(CURRENT), buildProfitAndLoss(PRIOR)],
    accounts: ACCOUNTS,
    showPercent: true,
    change: true,
  });
const row = (s: Statement, key: string) => s.rows.find((r) => r.key === key);
const amounts = (s: Statement, key: string) => row(s, key)?.cells.map((c) => c.amount);

describe("pnlStatement", () => {
  it("carries every builder figure and adds none of its own to them", () => {
    const s = single(CURRENT);
    const pnl = buildProfitAndLoss(CURRENT);
    expect(amounts(s, "income:total")).toEqual([pnl.income.total]);
    expect(amounts(s, "cogs:total")).toEqual([pnl.costOfGoodsSold.total]);
    expect(amounts(s, "gross")).toEqual([pnl.grossProfit]);
    expect(amounts(s, "opex:total")).toEqual([pnl.operatingExpenses.total]);
    expect(amounts(s, "net-operating")).toEqual([900_000 - 200_000]);
    expect(amounts(s, "net-other")).toEqual([5_000]);
    expect(amounts(s, "net-income")).toEqual([pnl.netIncome]);
    expect(pnl.netIncome).toBe(705_000);
  });

  it("nests an account under its parent, with the parent's subtotal", () => {
    const s = single(CURRENT);
    const opex = s.rows.filter((r) => r.key.startsWith("opex"));
    expect(opex.map((r) => [r.key, r.kind, r.depth, r.cells[0].amount])).toEqual([
      ["opex", "section", 0, null],
      ["opex:a:rent", "account", 1, 150_000],
      ["opex:a:repairs", "account", 1, 20_000],
      ["opex:a:showroom", "account", 2, 30_000],
      ["opex:t:repairs", "subtotal", 1, 50_000],
      ["opex:total", "total", 0, 200_000],
    ]);
    expect(row(s, "opex:t:repairs")?.label).toBe("Total 6200 Repairs");
  });

  it("heads children with a parent that has no balance of its own", () => {
    const s = single([bal("showroom", 10_000, 0), bal("sales", 0, 800_000)]);
    expect(row(s, "opex:a:repairs")?.cells[0].amount).toBeNull();
    expect(row(s, "opex:a:repairs")?.accountId).toBeNull();
    expect(row(s, "opex:a:showroom")?.accountId).toBe("showroom");
    expect(row(s, "opex:a:showroom")?.depth).toBe(2);
    expect(amounts(s, "opex:t:repairs")).toEqual([10_000]);
  });

  it("shows each figure as a share of that column's income", () => {
    expect(row(single(CURRENT, true), "opex:a:rent")?.percent).toEqual([12.5]);
  });

  it("puts the change beside two columns: the first less the second, as a % of the second", () => {
    const s = pair();
    expect(amounts(s, "net-income")).toEqual([705_000, 390_000]);
    expect(row(s, "net-income")?.change).toEqual({ amount: 315_000, percent: (315_000 / 390_000) * 100 });
    expect(row(s, "opex:a:repairs")?.change).toEqual({ amount: 20_000, percent: null });
    expect(s.changeLabels).toEqual(["Change", "%"]);
  });

  it("opens a total onto every account behind it, in its column's dates", () => {
    const s = pair();
    expect(row(s, "income:total")?.cells[0].zoom).toEqual({
      title: "Total Income",
      accountIds: ["sales", "services"],
      from: "2026-04-01",
      to: "2026-06-30",
      figure: 1_200_000,
    });
    expect(row(s, "income:total")?.cells[1].zoom?.from).toBe("2026-01-01");
  });

  it("leaves out cost of sales and other income when there are none, and says when a section is empty", () => {
    const s = single([bal("rent", 150_000, 0)]);
    expect(row(s, "cogs:total")).toBeUndefined();
    expect(row(s, "gross")).toBeUndefined();
    expect(row(s, "net-other")).toBeUndefined();
    expect(row(s, "income:note")?.label).toBe("No income in this period");
  });

  it("is empty when nothing was posted", () => {
    expect(single([]).empty).toBe(true);
    expect(single(CURRENT).empty).toBe(false);
  });

  it("keeps the row of an expense account that names itself as its own parent", () => {
    const SELF_ACCOUNTS = indexAccounts([acct("loop", "6300", "Self-Parented Expense", "expense", "loop")]);
    const balSelf = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
      const a = SELF_ACCOUNTS.get(id)!;
      return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
    };
    const pnl = buildProfitAndLoss([balSelf("loop", 7_000, 0)]);
    const s = pnlStatement({ columns: [Q2], pnls: [pnl], accounts: SELF_ACCOUNTS, showPercent: false, change: false });
    expect(row(s, "opex:a:loop")?.depth).toBe(1);
    expect(amounts(s, "opex:a:loop")).toEqual([7_000]);
    expect(amounts(s, "opex:total")).toEqual([7_000]);
  });

  it("keeps both rows of two expense accounts that name each other as parent, nested under one Total", () => {
    const LOOP2_ACCOUNTS = indexAccounts([
      acct("expA", "6300", "Expense A", "expense", "expB"),
      acct("expB", "6400", "Expense B", "expense", "expA"),
    ]);
    const balLoop2 = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
      const a = LOOP2_ACCOUNTS.get(id)!;
      return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
    };
    const pnl = buildProfitAndLoss([balLoop2("expA", 4_000, 0), balLoop2("expB", 6_000, 0)]);
    const s = pnlStatement({ columns: [Q2], pnls: [pnl], accounts: LOOP2_ACCOUNTS, showPercent: false, change: false });
    expect(row(s, "opex:a:expB")?.depth).toBe(1);
    expect(row(s, "opex:a:expA")?.depth).toBe(2);
    expect(amounts(s, "opex:a:expB")).toEqual([6_000]);
    expect(amounts(s, "opex:a:expA")).toEqual([4_000]);
    expect(row(s, "opex:t:expB")?.kind).toBe("subtotal");
    expect(amounts(s, "opex:t:expB")).toEqual([10_000]);
    expect(amounts(s, "opex:total")).toEqual([pnl.operatingExpenses.total]);
  });

  it("puts an expense account at the top when its parent is outside Operating Expenses, with no subtotal", () => {
    const CROSS_ACCOUNTS = indexAccounts([
      acct("inc", "4000", "Income", "income"),
      acct("exp", "6100", "Expense Under Income", "expense", "inc"),
    ]);
    const balCross = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
      const a = CROSS_ACCOUNTS.get(id)!;
      return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
    };
    const pnl = buildProfitAndLoss([balCross("exp", 5_000, 0)]);
    const s = pnlStatement({ columns: [Q2], pnls: [pnl], accounts: CROSS_ACCOUNTS, showPercent: false, change: false });
    expect(row(s, "opex:a:exp")?.depth).toBe(1);
    expect(amounts(s, "opex:a:exp")).toEqual([5_000]);
    expect(s.rows.some((r) => r.key.startsWith("opex:t:"))).toBe(false);
  });
});

describe("statement module", () => {
  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/statement.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});

const BS_ACCOUNTS = indexAccounts([
  acct("cash", "1000", "Cash", "bank"),
  acct("checking", "1010", "Checking", "bank", "cash"),
  acct("ar", "1100", "Accounts Receivable", "accounts_receivable"),
  acct("inventory", "1200", "Inventory", "current_asset"),
  acct("equipment", "1500", "Equipment", "fixed_asset"),
  acct("ap", "2000", "Accounts Payable", "accounts_payable"),
  acct("card", "2100", "Company Card", "credit_card"),
  acct("owner", "3000", "Owner's Equity", "equity"),
  acct("sales", "4000", "Sales", "income"),
  acct("rent", "6100", "Rent", "expense"),
]);
const bsBal = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
  const a = BS_ACCOUNTS.get(id)!;
  return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
};
/** June 30, 2026: $12,500 of assets against $2,000 owed and $10,500 of equity ($6,000 put in, $4,500 earned). */
const JUNE = [
  bsBal("cash", 500_000, 0),
  bsBal("checking", 250_000, 0),
  bsBal("ar", 120_000, 0),
  bsBal("inventory", 80_000, 0),
  bsBal("equipment", 300_000, 0),
  bsBal("ap", 0, 150_000),
  bsBal("card", 0, 50_000),
  bsBal("owner", 0, 600_000),
  bsBal("sales", 0, 900_000),
  bsBal("rent", 450_000, 0),
];
const JUNE_30: StatementColumn = { key: "current", label: "Jun 30, 2026", sub: "", from: null, to: "2026-06-30", isTotal: false };
const sheetOf = (rows: LedgerBalance[], priorEarnings = 300_000) =>
  balanceSheetStatement({
    columns: [JUNE_30],
    sheets: [buildBalanceSheet(rows)],
    priorEarnings: [priorEarnings],
    fiscalYearStarts: ["2026-01-01"],
    accounts: BS_ACCOUNTS,
    change: false,
  });

describe("balanceSheetStatement", () => {
  it("groups assets as the prototype does, and the groups add up to Total Assets", () => {
    const s = sheetOf(JUNE);
    expect(amounts(s, "assets:cash:total")).toEqual([750_000]);
    expect(amounts(s, "assets:ar:total")).toEqual([120_000]);
    expect(amounts(s, "assets:other:total")).toEqual([80_000]);
    expect(amounts(s, "assets:long:total")).toEqual([300_000]);
    expect(amounts(s, "assets:total")).toEqual([buildBalanceSheet(JUNE).totalAssets]);
    expect(row(s, "assets:total")?.kind).toBe("grand");
    expect(row(s, "assets:cash:a:checking")?.depth).toBe(2);
  });

  it("shows receivables only when there are some, and the other groups always", () => {
    const s = sheetOf(JUNE.filter((b) => b.accountId !== "ar" && b.accountId !== "equipment"));
    expect(row(s, "assets:ar")).toBeUndefined();
    expect(row(s, "assets:long")?.kind).toBe("classhead");
    expect(amounts(s, "assets:long:total")).toEqual([0]);
  });

  it("splits the year's profit from earlier years', and the two make the builder's Current earnings", () => {
    const s = sheetOf(JUNE);
    expect(amounts(s, "equity:retained")).toEqual([300_000]);
    expect(amounts(s, "equity:net-income")).toEqual([150_000]);
    expect(amounts(s, "equity:total")).toEqual([1_050_000]);
    expect(amounts(s, "le:total")).toEqual([1_250_000]);
    expect(row(s, "equity:retained")?.cells[0].zoom).toMatchObject({ accountIds: ["sales", "rent"], from: null, to: "2025-12-31" });
    expect(row(s, "equity:net-income")?.cells[0].zoom).toMatchObject({ from: "2026-01-01", to: "2026-06-30" });
  });

  it("says by how much it is out of balance, when it is", () => {
    const off: BalanceSheet = {
      ...buildBalanceSheet(JUNE),
      totalAssets: 1_250_010,
      balanced: false,
    };
    const s = balanceSheetStatement({
      columns: [JUNE_30],
      sheets: [off],
      priorEarnings: [300_000],
      fiscalYearStarts: ["2026-01-01"],
      accounts: BS_ACCOUNTS,
      change: false,
    });
    expect(s.outOfBalance).toBe(10);
    expect(sheetOf(JUNE).outOfBalance).toBeNull();
  });
});

describe("trialBalanceStatement", () => {
  // Rent is coded 0100 on purpose: a trial balance orders by type first, so it still comes last.
  const TB_ACCOUNTS = indexAccounts([
    acct("cash", "1000", "Cash", "bank"),
    acct("ap", "2000", "Accounts Payable", "accounts_payable"),
    acct("owner", "3000", "Owner's Equity", "equity"),
    acct("sales", "4000", "Sales", "income"),
    acct("rent", "0100", "Rent", "expense"),
  ]);
  const tbBal = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
    const a = TB_ACCOUNTS.get(id)!;
    return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
  };
  const ROWS = [tbBal("rent", 1_150, 0), tbBal("cash", 500, 0), tbBal("ap", 0, 150), tbBal("owner", 0, 600), tbBal("sales", 0, 900)];
  const tb = trialBalanceStatement({ columns: [JUNE_30], tbs: [buildTrialBalance(ROWS)], accounts: TB_ACCOUNTS });

  it("orders accounts by type, then code, with a blank on the side a balance is not", () => {
    expect(tb.rows.filter((r) => r.kind === "account").map((r) => r.accountId)).toEqual(["cash", "ap", "owner", "sales", "rent"]);
    expect(amounts(tb, "a:cash")).toEqual([500, null]);
    expect(amounts(tb, "a:ap")).toEqual([null, 150]);
    expect(tb.columns.map((c) => c.label)).toEqual(["Debit", "Credit"]);
  });

  it("closes with the builder's totals, each opening onto the accounts on its side", () => {
    expect(amounts(tb, "total")).toEqual([1_650, 1_650]);
    expect(row(tb, "total")?.cells[0].zoom?.accountIds.sort()).toEqual(["cash", "rent"]);
    expect(row(tb, "total")?.cells[1].zoom?.accountIds.sort()).toEqual(["ap", "owner", "sales"]);
    expect(tb.outOfBalance).toBeNull();
  });

  it("names each side by its column when there are several", () => {
    const two = trialBalanceStatement({
      columns: [JUNE_30, { ...JUNE_30, key: "prior", label: "May 31, 2026", to: "2026-05-31" }],
      tbs: [buildTrialBalance(ROWS), buildTrialBalance(ROWS)],
      accounts: TB_ACCOUNTS,
    });
    expect(two.columns.map((c) => c.label)).toEqual([
      "Jun 30, 2026 Debit",
      "Jun 30, 2026 Credit",
      "May 31, 2026 Debit",
      "May 31, 2026 Credit",
    ]);
  });
});
