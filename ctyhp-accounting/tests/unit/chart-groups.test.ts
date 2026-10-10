import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/domain/accounts";
import {
  CHART_FILTERS,
  CHART_GROUPS,
  chartClassOf,
  chartFigures,
  chartGroupOf,
  chartLede,
  chartRange,
  chartZoomSpec,
  filterCounts,
  fiscalYearStartFor,
  groupRangeLabel,
  naturalBalanceMinor,
  statementOf,
  type ChartGroupKey,
} from "@/lib/domain/chart-groups";

const none = new Set<string>();
const acct = (account_type: AccountType, detail_type: string | null = null, id = "a1") => ({ id, account_type, detail_type });

describe("the groups", () => {
  it("are the fourteen, in statement order", () => {
    expect(CHART_GROUPS.map((g) => g.title)).toEqual([
      "Bank and cash",
      "Receivables",
      "Inventory",
      "Other current assets",
      "Long-term assets",
      "Credit cards",
      "Payables",
      "Other current liabilities",
      "Long-term liabilities",
      "Equity",
      "Income",
      "Cost of sales",
      "Expenses",
      "Other expenses",
    ]);
  });

  it("put profit and loss groups on the profit and loss statement and the rest on the balance sheet", () => {
    const pnl = CHART_GROUPS.filter((g) => g.statement === "profit_and_loss").map((g) => g.key);
    expect(pnl).toEqual(["income", "cost_of_sales", "expenses", "other_expenses"]);
  });

  it("place every account type", () => {
    const expected: Record<AccountType, ChartGroupKey> = {
      bank: "bank_cash",
      accounts_receivable: "receivables",
      current_asset: "other_current_assets",
      fixed_asset: "long_term_assets",
      accounts_payable: "payables",
      credit_card: "credit_cards",
      current_liability: "other_current_liabilities",
      long_term_liability: "long_term_liabilities",
      equity: "equity",
      income: "income",
      cost_of_goods_sold: "cost_of_sales",
      expense: "expenses",
      other_income: "income",
      other_expense: "other_expenses",
    };
    for (const type of ACCOUNT_TYPES) expect(chartGroupOf(acct(type), none), type).toBe(expected[type]);
  });

  it("put an inventory-set current asset under Inventory", () => {
    expect(chartGroupOf(acct("current_asset", null, "inv"), new Set(["inv"]))).toBe("inventory");
    expect(chartGroupOf(acct("current_asset", null, "other"), new Set(["inv"]))).toBe("other_current_assets");
  });

  it("put money in transit under Bank and cash", () => {
    expect(chartGroupOf(acct("current_asset", "undeposited_funds"), none)).toBe("bank_cash");
    expect(chartGroupOf(acct("current_asset", "transfer_clearing"), none)).toBe("bank_cash");
  });

  it("let Inventory win only when the account is in the inventory set", () => {
    expect(chartGroupOf(acct("current_asset", "undeposited_funds", "x"), new Set(["x"]))).toBe("inventory");
    expect(chartGroupOf(acct("current_asset", "undeposited_funds", "x"), new Set(["y"]))).toBe("bank_cash");
  });

  it("leave a non-current-asset type alone even if the inventory set names it", () => {
    expect(chartGroupOf(acct("fixed_asset", null, "x"), new Set(["x"]))).toBe("long_term_assets");
  });
});

describe("classes and statements", () => {
  it("fold other income into income, and cost of sales and other expenses into expenses", () => {
    expect(chartClassOf("other_income")).toBe("income");
    expect(chartClassOf("cost_of_goods_sold")).toBe("expense");
    expect(chartClassOf("expense")).toBe("expense");
    expect(chartClassOf("other_expense")).toBe("expense");
    expect(chartClassOf("bank")).toBe("asset");
    expect(chartClassOf("credit_card")).toBe("liability");
    expect(chartClassOf("equity")).toBe("equity");
  });

  it("agree with each group's own class", () => {
    const types: AccountType[] = [...ACCOUNT_TYPES];
    for (const type of types) {
      const group = CHART_GROUPS.find((g) => g.key === chartGroupOf(acct(type), none))!;
      expect(group.chartClass, type).toBe(chartClassOf(type));
      expect(group.statement, type).toBe(statementOf(type));
    }
  });

  it("put income, cost of sales and expenses on the profit and loss", () => {
    expect(statementOf("income")).toBe("profit_and_loss");
    expect(statementOf("other_expense")).toBe("profit_and_loss");
    expect(statementOf("equity")).toBe("balance_sheet");
    expect(statementOf("fixed_asset")).toBe("balance_sheet");
  });

  it("offer the six pills in order", () => {
    expect(CHART_FILTERS.map((f) => f.label)).toEqual(["All", "Assets", "Liabilities", "Equity", "Income", "Expenses"]);
  });

  it("count the accounts under each pill", () => {
    const counts = filterCounts([
      { account_type: "bank" },
      { account_type: "accounts_receivable" },
      { account_type: "credit_card" },
      { account_type: "equity" },
      { account_type: "income" },
      { account_type: "other_income" },
      { account_type: "cost_of_goods_sold" },
      { account_type: "expense" },
      { account_type: "other_expense" },
    ]);
    expect(counts).toEqual({ all: 9, asset: 2, liability: 1, equity: 1, income: 2, expense: 3 });
    expect(filterCounts([])).toEqual({ all: 0, asset: 0, liability: 0, equity: 0, income: 0, expense: 0 });
  });
});

describe("natural balance", () => {
  it("is debit less credit on a debit-normal account", () => {
    expect(naturalBalanceMinor(500_00, 120_00, "debit")).toBe(380_00);
  });

  it("is credit less debit on a credit-normal account", () => {
    expect(naturalBalanceMinor(120_00, 500_00, "credit")).toBe(380_00);
  });

  it("goes negative when the account is the wrong way round", () => {
    expect(naturalBalanceMinor(100_00, 300_00, "debit")).toBe(-200_00);
    expect(naturalBalanceMinor(300_00, 100_00, "credit")).toBe(-200_00);
  });
});

describe("the fiscal year", () => {
  it("starts on January 1 for a January fiscal year", () => {
    expect(fiscalYearStartFor("2026-10-10", 1)).toBe("2026-01-01");
    expect(fiscalYearStartFor("2026-01-01", 1)).toBe("2026-01-01");
    expect(fiscalYearStartFor("2026-12-31", 1)).toBe("2026-01-01");
  });

  it("starts in the earlier calendar year before a non-January start month", () => {
    expect(fiscalYearStartFor("2026-10-10", 4)).toBe("2026-04-01");
    expect(fiscalYearStartFor("2026-04-01", 4)).toBe("2026-04-01");
    expect(fiscalYearStartFor("2026-03-31", 4)).toBe("2025-04-01");
    expect(fiscalYearStartFor("2026-01-15", 4)).toBe("2025-04-01");
  });

  it("gives a balance sheet account all history, and a profit and loss account the year to date", () => {
    expect(chartRange("balance_sheet", "2026-10-10", 4)).toEqual({ from: null, to: "2026-10-10" });
    expect(chartRange("profit_and_loss", "2026-10-10", 4)).toEqual({ from: "2026-04-01", to: "2026-10-10" });
    expect(chartRange("profit_and_loss", "2026-02-10", 4)).toEqual({ from: "2025-04-01", to: "2026-02-10" });
    expect(chartRange("profit_and_loss", "2026-10-10", 1)).toEqual({ from: "2026-01-01", to: "2026-10-10" });
  });
});

describe("chartFigures", () => {
  const accounts = [
    { id: "bank", account_type: "bank" as const, is_contra: false },
    { id: "payable", account_type: "accounts_payable" as const, is_contra: false },
    { id: "accum", account_type: "fixed_asset" as const, is_contra: true },
    { id: "sales", account_type: "income" as const, is_contra: false },
    { id: "rent", account_type: "expense" as const, is_contra: false },
    { id: "idle", account_type: "expense" as const, is_contra: false },
  ];
  const sheet = [
    { accountId: "bank", debitBase: 900_00, creditBase: 400_00 },
    { accountId: "payable", debitBase: 50_00, creditBase: 250_00 },
    { accountId: "accum", debitBase: 0, creditBase: 80_00 },
    // Not read: sales is profit and loss, so only the year-to-date ledger counts.
    { accountId: "sales", debitBase: 0, creditBase: 99_999_00 },
  ];
  const pnl = [
    { accountId: "sales", debitBase: 0, creditBase: 700_00 },
    { accountId: "rent", debitBase: 30_00, creditBase: 90_00 },
    // Not read: bank is balance sheet.
    { accountId: "bank", debitBase: 1_00, creditBase: 0 },
  ];

  it("reads each account from the ledger of its own statement", () => {
    const figures = chartFigures(accounts, sheet, pnl);
    expect(figures.bank).toBe(500_00);
    expect(figures.payable).toBe(200_00);
    expect(figures.sales).toBe(700_00);
  });

  it("treats a contra account's normal side as the opposite", () => {
    expect(chartFigures(accounts, sheet, pnl).accum).toBe(80_00);
  });

  it("shows a wrong-way balance as negative", () => {
    expect(chartFigures(accounts, sheet, pnl).rent).toBe(-60_00);
  });

  it("gives an account missing from its ledger zero", () => {
    expect(chartFigures(accounts, sheet, pnl).idle).toBe(0);
    expect(chartFigures(accounts, [], [])).toEqual({ bank: 0, payable: 0, accum: 0, sales: 0, rent: 0, idle: 0 });
  });
});

describe("chartZoomSpec", () => {
  it("opens the one account over its range with the figure shown", () => {
    expect(
      chartZoomSpec({ id: "a1", account_code: "6100", name: "Rent" }, { from: "2026-04-01", to: "2026-10-10" }, -60_00),
    ).toEqual({
      title: "6100 Rent",
      accountIds: ["a1"],
      from: "2026-04-01",
      to: "2026-10-10",
      figure: -60_00,
    });
  });

  it("keeps a null from for a balance sheet account", () => {
    const spec = chartZoomSpec({ id: "a2", account_code: "1000", name: "Checking" }, { from: null, to: "2026-10-10" }, 5);
    expect(spec.from).toBeNull();
  });
});

describe("the lede and the range label", () => {
  it("reads in the plural", () => {
    expect(chartLede(45, 28, "2026-10-10")).toBe("45 accounts, 28 carrying a balance at Oct 10, 2026.");
    expect(chartLede(0, 0, "2026-10-10")).toBe("0 accounts, 0 carrying a balance at Oct 10, 2026.");
  });

  it("reads in the singular", () => {
    expect(chartLede(1, 1, "2026-01-05")).toBe("1 account, 1 carrying a balance at Jan 5, 2026.");
  });

  it("names the year to date", () => {
    expect(groupRangeLabel("2026-01-01")).toBe("Year to date, from Jan 1, 2026");
    expect(groupRangeLabel("2025-04-01")).toBe("Year to date, from Apr 1, 2025");
  });
});
