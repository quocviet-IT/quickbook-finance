import { describe, expect, it } from "vitest";
import { buildProfitAndLoss, type LedgerBalance } from "@/lib/domain/reports";
import { EVERYTHING_ELSE, topExpenses, totalExpenses } from "@/lib/domain/dashboard-home/expenses";

const row = (code: string, accountType: LedgerBalance["accountType"], debitBase: number, creditBase: number): LedgerBalance => ({
  accountId: `id-${code}`,
  accountCode: code,
  name: `Sample ${code}`,
  accountType,
  debitBase,
  creditBase,
});

const sum = (lines: { amountMinor: number }[]) => lines.reduce((total, line) => total + line.amountMinor, 0);

describe("topExpenses", () => {
  it("takes the four largest accounts across cost of goods sold, operating and other expenses, then everything else", () => {
    const pnl = buildProfitAndLoss([
      row("4000", "income", 0, 50_000_00),
      row("5000", "cost_of_goods_sold", 9_840_00, 0),
      row("6100", "expense", 4_150_00, 0),
      row("6200", "expense", 2_200_00, 0),
      row("6300", "expense", 1_130_00, 0),
      row("6400", "expense", 500_00, 0),
      row("8000", "other_expense", 600_00, 0),
    ]);
    const lines = topExpenses(pnl);
    expect(lines).toEqual([
      { accountId: "id-5000", name: "Sample 5000", amountMinor: 9_840_00 },
      { accountId: "id-6100", name: "Sample 6100", amountMinor: 4_150_00 },
      { accountId: "id-6200", name: "Sample 6200", amountMinor: 2_200_00 },
      { accountId: "id-6300", name: "Sample 6300", amountMinor: 1_130_00 },
      { accountId: null, name: EVERYTHING_ELSE, amountMinor: 1_100_00 },
    ]);
    expect(sum(lines)).toBe(totalExpenses(pnl));
  });

  it("keeps a negative line (a contra account) out of the top list and in everything else, still summing to the total", () => {
    const pnl = buildProfitAndLoss([
      row("5000", "cost_of_goods_sold", 10_000_00, 0),
      // Purchase Discounts: a cost of goods sold account carrying a credit.
      row("5100", "cost_of_goods_sold", 0, 300_00),
      row("6100", "expense", 2_000_00, 0),
      row("6200", "expense", 1_000_00, 0),
      row("6300", "expense", 500_00, 0),
    ]);
    const lines = topExpenses(pnl);
    expect(lines.map((l) => l.name)).toEqual(["Sample 5000", "Sample 6100", "Sample 6200", "Sample 6300", EVERYTHING_ELSE]);
    expect(lines.at(-1)?.amountMinor).toBe(-300_00);
    expect(sum(lines)).toBe(totalExpenses(pnl));
  });

  it("adds no everything-else line when the top accounts are all there is", () => {
    const pnl = buildProfitAndLoss([row("6100", "expense", 2_000_00, 0), row("6200", "expense", 1_000_00, 0)]);
    expect(topExpenses(pnl).map((l) => l.name)).toEqual(["Sample 6100", "Sample 6200"]);
    expect(topExpenses(buildProfitAndLoss([]))).toEqual([]);
  });

  it("orders ties by account code and honors a smaller limit", () => {
    const pnl = buildProfitAndLoss([row("6200", "expense", 1_000_00, 0), row("6100", "expense", 1_000_00, 0), row("6300", "expense", 1_00, 0)]);
    const lines = topExpenses(pnl, 1);
    expect(lines).toEqual([
      { accountId: "id-6100", name: "Sample 6100", amountMinor: 1_000_00 },
      { accountId: null, name: EVERYTHING_ELSE, amountMinor: 1_001_00 },
    ]);
  });
});
