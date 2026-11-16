import { describe, expect, it } from "vitest";
import { chartFigures } from "@/lib/domain/chart-groups";
import { watchChoices, watchRows, WATCHLIST_MAX, type WatchAccount } from "@/lib/domain/dashboard-home/watchlist";

const account = (id: string, code: string, type: WatchAccount["account_type"], isContra = false, status = "active") => ({
  id,
  account_code: code,
  name: `Sample ${code}`,
  account_type: type,
  is_contra: isContra,
  status,
});

const ACCOUNTS = [
  account("a-1400", "1400", "current_asset"),
  account("a-1590", "1590", "fixed_asset", true), // accumulated depreciation: a contra asset
  account("a-2200", "2200", "current_liability"),
  account("a-4000", "4000", "income"),
  account("a-4900", "4900", "income", true), // sales returns: a contra income account
  account("a-6100", "6100", "expense"),
  account("a-6999", "6999", "expense", false, "inactive"),
];

const side = (id: string, debitBase: number, creditBase: number) => ({ accountId: id, debitBase, creditBase });

/** Since the books began: balance sheet and profit and loss accounts alike. */
const SINCE_BEGAN = [
  side("a-1400", 120_000_00, 33_600_00),
  side("a-1590", 0, 9_000_00),
  side("a-2200", 5_000_00, 6_612_40),
  side("a-4000", 0, 900_000_00),
  side("a-4900", 4_000_00, 0),
  side("a-6100", 300_000_00, 0),
];
/** The fiscal year to date: only what profit and loss accounts carry this year. */
const YEAR = [side("a-4000", 0, 520_150_00), side("a-4900", 2_100_00, 0), side("a-6100", 103_420_00, 0)];
const THIS_MONTH = [side("a-1400", 9_000_00, 600_00), side("a-2200", 1_000_00, 2_612_40), side("a-4000", 300_00, 22_150_00), side("a-4900", 150_00, 0)];
const LAST_MONTH = [side("a-1590", 0, 750_00), side("a-4000", 0, 57_400_00), side("a-6100", 10_430_00, 0)];

const input = (ids: string[]) => ({
  ids,
  accounts: ACCOUNTS,
  thisMonth: THIS_MONTH,
  lastMonth: LAST_MONTH,
  sinceTheBooksBegan: SINCE_BEGAN,
  fiscalYearToDate: YEAR,
});

describe("watchRows", () => {
  it("gives one row per chosen account, in the person's order", () => {
    const rows = watchRows(input(["a-4000", "a-1400", "a-2200"]));
    expect(rows.map((row) => [row.code, row.name, row.typeLabel])).toEqual([
      ["4000", "Sample 4000", "Income"],
      ["1400", "Sample 1400", "Current Asset"],
      ["2200", "Sample 2200", "Current Liability"],
    ]);
  });

  it("leaves out an account no longer in the chart, and a repeat", () => {
    expect(watchRows(input(["a-gone", "a-4000", "a-4000"])).map((row) => row.accountId)).toEqual(["a-4000"]);
    expect(watchRows(input([]))).toEqual([]);
  });

  it("keeps at most ten", () => {
    const many = Array.from({ length: 12 }, (_, i) => account(`a-${7000 + i}`, String(7000 + i), "expense"));
    const rows = watchRows({ ...input(many.map((a) => a.id)), accounts: many });
    expect(rows).toHaveLength(WATCHLIST_MAX);
    expect(rows.at(-1)?.code).toBe("7009");
  });

  it("makes Balance the Chart of Accounts figure: a contra account, an income account, a liability and an asset", () => {
    const ids = ["a-1590", "a-4000", "a-4900", "a-2200", "a-1400"];
    const rows = watchRows(input(ids));
    const chart = chartFigures(ACCOUNTS, SINCE_BEGAN, YEAR);
    for (const row of rows) expect(row.balanceMinor, row.code).toBe(chart[row.accountId]);
    expect(rows.map((row) => [row.code, row.balanceMinor])).toEqual([
      // Accumulated depreciation is credit-normal: it reads positive.
      ["1590", 9_000_00],
      // Income is the fiscal year's, not every year's.
      ["4000", 520_150_00],
      // Sales returns are debit-normal.
      ["4900", 2_100_00],
      ["2200", 1_612_40],
      ["1400", 86_400_00],
    ]);
  });

  it("signs this month's and last month's activity as the chart signs a figure, and an account with none at zero", () => {
    const rows = watchRows(input(["a-4000", "a-1400", "a-2200", "a-4900", "a-1590", "a-6100"]));
    expect(rows.map((row) => [row.code, row.thisMonthMinor, row.lastMonthMinor])).toEqual([
      ["4000", 21_850_00, 57_400_00],
      ["1400", 8_400_00, 0],
      ["2200", 1_612_40, 0],
      ["4900", 150_00, 0],
      ["1590", 0, 750_00],
      ["6100", 0, 10_430_00],
    ]);
  });
});

describe("watchChoices", () => {
  it("offers every active account by code, inactive ones left out", () => {
    const shuffled = [ACCOUNTS[5], ACCOUNTS[0], ACCOUNTS[6], ACCOUNTS[3]];
    expect(watchChoices(shuffled)).toEqual([
      { id: "a-1400", code: "1400", name: "Sample 1400", typeLabel: "Current Asset" },
      { id: "a-4000", code: "4000", name: "Sample 4000", typeLabel: "Income" },
      { id: "a-6100", code: "6100", name: "Sample 6100", typeLabel: "Expense" },
    ]);
  });

  it("orders codes as numbers where they are numbers", () => {
    const codes = watchChoices([account("x", "10000", "expense"), account("y", "9000", "expense"), account("z", "1100", "expense")]).map((c) => c.code);
    expect(codes).toEqual(["1100", "9000", "10000"]);
  });
});
