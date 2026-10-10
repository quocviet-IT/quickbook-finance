import { describe, expect, it } from "vitest";
import { TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import {
  ACCOUNT_FLOOR,
  BALANCES_FIXED_WIDTHS,
  SETUP_FIXED_WIDTHS,
} from "@/app/(app)/accounts/AccountsClient";
import type { AccountType } from "@/lib/domain/accounts";
import { chartRange, chartZoomSpec, fiscalYearStartFor } from "@/lib/domain/chart-groups";
import {
  accountsInView,
  chartFigureSpoken,
  chartFigureText,
  chartLedeWithoutBalances,
  chartListing,
  chartViewHref,
  chartViewOf,
  fiscalStartMonthOf,
  isRetired,
  matchesAccountSearch,
  openAccountLabel,
  type ChartListOptions,
  type ChartListRow,
} from "@/lib/domain/chart-list";

interface TestAccount {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
  detail_type: string | null;
  parent_account_id: string | null;
  status: string;
  cash_flow_role: string;
}

/** Invented accounts only. */
function account(
  id: string,
  code: string,
  name: string,
  type: AccountType,
  extra: Partial<TestAccount> = {},
): TestAccount {
  return {
    id,
    account_code: code,
    name,
    account_type: type,
    detail_type: null,
    parent_account_id: null,
    status: "active",
    cash_flow_role: "operating",
    ...extra,
  };
}

const CHART: TestAccount[] = [
  account("cash", "1000", "Petty Cash", "bank"),
  account("bank", "1010", "Harbor Checking", "bank"),
  account("ar", "1100", "Accounts Receivable", "accounts_receivable"),
  account("stock", "1200", "Stock on Hand", "current_asset"),
  account("prepaid", "1300", "Prepaid Rent", "current_asset"),
  account("old", "1310", "Old Deposit", "current_asset", { status: "inactive" }),
  account("kept", "1320", "Closed Escrow", "current_asset", { status: "inactive" }),
  account("ap", "2000", "Accounts Payable", "accounts_payable"),
  account("card", "2050", "Example Card", "credit_card"),
  account("equity", "3000", "Owner Equity", "equity"),
  account("sales", "4000", "Sales", "income"),
  account("sales-web", "4010", "Web Sales", "income", { parent_account_id: "sales" }),
  account("interest", "7000", "Interest Earned", "other_income", { cash_flow_role: "unclassified" }),
  account("cogs", "5000", "Cost of Goods Sold", "cost_of_goods_sold"),
  account("rent", "6100", "Rent Expense", "expense"),
  account("fees", "8100", "Bank Fees", "other_expense", { status: "archived" }),
];

const FIGURES: Record<string, number> = {
  cash: 12_500,
  bank: 1_250_000,
  ar: 300_000,
  stock: 0,
  prepaid: 60_000,
  old: 0,
  kept: -4_000,
  ap: 210_000,
  card: 0,
  equity: 500_000,
  sales: 900_000,
  "sales-web": 150_000,
  cogs: 400_000,
  rent: 120_000,
};

function options(patch: Partial<ChartListOptions<TestAccount>> = {}): ChartListOptions<TestAccount> {
  return {
    figures: FIGURES,
    inventoryAccountIds: new Set(["stock"]),
    view: "balances",
    search: "",
    filter: "all",
    ...patch,
  };
}

const headings = (rows: ChartListRow<TestAccount>[]) =>
  rows.flatMap((r) => (r.kind === "group" ? [`${r.title} (${r.count})`] : []));
const codes = (rows: ChartListRow<TestAccount>[]) =>
  rows.flatMap((r) => (r.kind === "account" ? [`${"  ".repeat(r.depth)}${r.account.account_code}`] : []));

describe("table fit", () => {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

  it("fits Balances at a 1280px window", () => {
    expect(fitsBox(sum(BALANCES_FIXED_WIDTHS), ACCOUNT_FLOOR)).toBe(true);
  });

  it("fits Setup at a 1280px window, with the action buttons", () => {
    expect(fitsBox(sum(SETUP_FIXED_WIDTHS), ACCOUNT_FLOOR)).toBe(true);
  });

  it("measures against the 984px box, with an account column no narrower than its floor", () => {
    expect(TABLE_BOX_AT_1280).toBe(984);
    expect(ACCOUNT_FLOOR).toBeGreaterThanOrEqual(200);
    expect(TABLE_BOX_AT_1280 - sum(SETUP_FIXED_WIDTHS)).toBeGreaterThanOrEqual(ACCOUNT_FLOOR);
  });
});

describe("the view in the address", () => {
  it("opens Setup only for view=setup", () => {
    expect(chartViewOf("setup")).toBe("setup");
    expect(chartViewOf(["setup", "balances"])).toBe("setup");
    expect(chartViewOf(undefined)).toBe("balances");
    expect(chartViewOf(null)).toBe("balances");
    expect(chartViewOf("balances")).toBe("balances");
    expect(chartViewOf("Setup")).toBe("balances");
    expect(chartViewOf("anything")).toBe("balances");
  });

  it("writes Setup into the address and leaves Balances out of it", () => {
    expect(chartViewHref("setup")).toBe("/accounts?view=setup");
    expect(chartViewHref("balances")).toBe("/accounts");
    expect(chartViewOf(new URL(chartViewHref("setup"), "https://example.test").searchParams.get("view"))).toBe("setup");
  });
});

describe("the lede without balances", () => {
  it("counts the accounts and says nothing about their figures", () => {
    expect(chartLedeWithoutBalances(45)).toBe("45 accounts.");
    expect(chartLedeWithoutBalances(1)).toBe("1 account.");
    expect(chartLedeWithoutBalances(0)).toBe("0 accounts.");
  });
});

describe("which accounts a view lists", () => {
  it("counts inactive and archived accounts as out of use, and nothing else", () => {
    expect(isRetired("inactive")).toBe(true);
    expect(isRetired("archived")).toBe(true);
    expect(isRetired("active")).toBe(false);
    expect(isRetired("draft")).toBe(false);
  });

  it("hides an inactive account with nothing in it from Balances, and keeps one that still holds money", () => {
    const ids = accountsInView(CHART, FIGURES, "balances").map((a) => a.id);
    expect(ids).not.toContain("old");
    expect(ids).not.toContain("fees");
    expect(ids).toContain("kept");
    // An active account with a zero balance is still listed.
    expect(ids).toContain("card");
    expect(ids).toHaveLength(CHART.length - 2);
  });

  it("lists every account in Setup", () => {
    expect(accountsInView(CHART, FIGURES, "setup")).toHaveLength(CHART.length);
  });
});

describe("search", () => {
  it("matches the code or the name, ignoring case and outer spaces", () => {
    const sales = CHART.find((a) => a.id === "sales")!;
    expect(matchesAccountSearch(sales, "40")).toBe(true);
    expect(matchesAccountSearch(sales, "  SALES ")).toBe(true);
    expect(matchesAccountSearch(sales, "rent")).toBe(false);
    expect(matchesAccountSearch(sales, "")).toBe(true);
  });
});

describe("the listing", () => {
  it("draws each group with accounts under its heading, in statement order, and no empty group", () => {
    const { rows } = chartListing(CHART, options());
    expect(headings(rows)).toEqual([
      "Bank and cash (2)",
      "Receivables (1)",
      "Inventory (1)",
      "Other current assets (2)",
      "Credit cards (1)",
      "Payables (1)",
      "Equity (1)",
      "Income (3)",
      "Cost of sales (1)",
      "Expenses (1)",
    ]);
    expect(rows[0]).toMatchObject({ kind: "group", group: "bank_cash", statement: "balance_sheet", key: "group:bank_cash" });
    const income = rows.find((r) => r.kind === "group" && r.group === "income");
    expect(income).toMatchObject({ statement: "profit_and_loss" });
  });

  it("nests a sub-account under its parent, in code order", () => {
    const { rows } = chartListing(CHART, options());
    const codesInIncome = codes(rows).filter((c) => c.trim().startsWith("4") || c.trim().startsWith("7"));
    expect(codesInIncome).toEqual(["4000", "  4010", "7000"]);
  });

  it("keys every row uniquely, so a group heading never collides with an account", () => {
    const { rows } = chartListing(CHART, options({ view: "setup" }));
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("gives the lede every listed account and the ones carrying a balance", () => {
    const balances = chartListing(CHART, options());
    expect(balances.total).toBe(CHART.length - 2);
    // cash, bank, ar, prepaid, kept, ap, equity, sales, sales-web, cogs, rent
    expect(balances.withBalance).toBe(11);
    const setup = chartListing(CHART, options({ view: "setup" }));
    expect(setup.total).toBe(CHART.length);
    expect(setup.withBalance).toBe(11);
  });

  it("counts the pills from what the search found, before the pill narrows it", () => {
    const all = chartListing(CHART, options());
    expect(all.counts).toEqual({ all: 14, asset: 6, liability: 2, equity: 1, income: 3, expense: 2 });

    const searched = chartListing(CHART, options({ search: "sales", filter: "expense" }));
    expect(searched.counts).toEqual({ all: 2, asset: 0, liability: 0, equity: 0, income: 2, expense: 0 });
    expect(searched.matched).toBe(0);
    expect(searched.rows).toEqual([]);
  });

  it("narrows to one class with a pill", () => {
    const { rows, matched } = chartListing(CHART, options({ filter: "liability" }));
    expect(matched).toBe(2);
    expect(headings(rows)).toEqual(["Credit cards (1)", "Payables (1)"]);
  });

  it("keeps the parent of a matching sub-account, so the match reads in its place", () => {
    const { rows, matched } = chartListing(CHART, options({ search: "web" }));
    expect(matched).toBe(1);
    expect(codes(rows)).toEqual(["4000", "  4010"]);
    expect(headings(rows)).toEqual(["Income (2)"]);
  });

  it("stands a sub-account at the top of its own group when the parent is in another", () => {
    const chart = [
      account("float", "1050", "Card Float", "current_asset", { parent_account_id: "bank", detail_type: "undeposited_funds" }),
      account("bank", "1010", "Harbor Checking", "bank"),
      account("deposit", "1060", "Rent Deposit", "current_asset", { parent_account_id: "bank" }),
    ];
    const { rows } = chartListing(chart, options({ figures: {} }));
    expect(codes(rows)).toEqual(["1010", "  1050", "1060"]);
    expect(headings(rows)).toEqual(["Bank and cash (2)", "Other current assets (1)"]);
  });

  it("applies a further narrowing, such as Setup's cash flow role, with the search", () => {
    const { rows, matched, counts } = chartListing(CHART, {
      ...options({ view: "setup" }),
      keep: (a) => a.cash_flow_role === "unclassified",
    });
    expect(matched).toBe(1);
    expect(counts.all).toBe(1);
    expect(codes(rows)).toEqual(["7000"]);
  });

  it("finds an inactive account in Balances only while it carries a balance", () => {
    expect(chartListing(CHART, options({ search: "old deposit" })).matched).toBe(0);
    expect(chartListing(CHART, options({ search: "closed escrow" })).matched).toBe(1);
    expect(chartListing(CHART, options({ view: "setup", search: "old deposit" })).matched).toBe(1);
  });
});

describe("what a click opens", () => {
  it("reads the fiscal year's first month off the start date the figures used", () => {
    expect(fiscalStartMonthOf("2026-01-01")).toBe(1);
    expect(fiscalStartMonthOf("2025-07-01")).toBe(7);
    expect(fiscalStartMonthOf("not a date")).toBe(1);
  });

  it("opens a profit and loss account over the same dates as its figure, in a year that starts in July", () => {
    const asOf = "2026-03-15";
    const start = fiscalYearStartFor(asOf, 7);
    expect(start).toBe("2025-07-01");
    const range = chartRange("profit_and_loss", asOf, fiscalStartMonthOf(start));
    expect(range).toEqual({ from: "2025-07-01", to: asOf });
    const spec = chartZoomSpec({ id: "rent", account_code: "6100", name: "Rent Expense" }, range, 120_000);
    expect(spec).toEqual({ title: "6100 Rent Expense", accountIds: ["rent"], from: "2025-07-01", to: asOf, figure: 120_000 });
  });

  it("opens a balance sheet account from the start of the books", () => {
    expect(chartRange("balance_sheet", "2026-03-15", fiscalStartMonthOf("2025-07-01"))).toEqual({ from: null, to: "2026-03-15" });
  });
});

describe("figures", () => {
  const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

  it("prints a negative figure in parentheses, and a zero as a plain zero", () => {
    expect(chartFigureText(1_250_000, money)).toBe("$12500.00");
    expect(chartFigureText(-420_000, money)).toBe("($4200.00)");
    expect(chartFigureText(0, money)).toBe("$0.00");
    expect(chartFigureText(-0, money)).toBe("$0.00");
  });

  it("says “negative” to a screen reader instead of a parenthesis", () => {
    expect(chartFigureSpoken(-420_000, money)).toBe("negative $4200.00");
    expect(chartFigureSpoken(5, money)).toBe("$0.05");
    expect(chartFigureSpoken(-0, money)).toBe("$0.00");
  });

  it("names what a click opens", () => {
    expect(openAccountLabel({ account_code: "1000", name: "Petty Cash" })).toBe("Open 1000 Petty Cash");
  });
});
