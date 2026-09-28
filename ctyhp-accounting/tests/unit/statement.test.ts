import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AccountType } from "@/lib/domain/accounts";
import { buildProfitAndLoss, type LedgerBalance } from "@/lib/domain/reports";
import { indexAccounts, pnlStatement, type AccountRef, type Statement, type StatementColumn } from "@/lib/domain/statement";

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
});

describe("statement module", () => {
  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/statement.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
