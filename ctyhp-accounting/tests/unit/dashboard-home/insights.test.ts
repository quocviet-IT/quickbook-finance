import { describe, expect, it } from "vitest";
import { buildProfitAndLoss, type LedgerBalance, type ProfitAndLoss } from "@/lib/domain/reports";
import { homeInsights, listWords, type HomeInsightFacts } from "@/lib/domain/dashboard-home/insights";
import type { HomeMonth } from "@/lib/domain/dashboard-home/types";
import { formatBaseMoney } from "@/lib/format";

const AS_OF = "2026-11-13";

const row = (code: string, accountType: LedgerBalance["accountType"], debitBase: number, creditBase: number): LedgerBalance => ({
  accountId: code,
  accountCode: code,
  name: `Sample ${code}`,
  accountType,
  debitBase,
  creditBase,
});

/** A month's Profit and Loss from its sales, cost of goods sold and other expenses. */
function month(sales: number, cogs: number, other: number): ProfitAndLoss {
  return buildProfitAndLoss([row("4000", "income", 0, sales), row("5000", "cost_of_goods_sold", cogs, 0), row("6100", "expense", other, 0)]);
}

const KEYS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const months = (posted: boolean[]): HomeMonth[] =>
  KEYS.map((key, index) => ({ key, label: key, year: 2026, posted: posted[index] }));

function facts(over: Partial<HomeInsightFacts> = {}): HomeInsightFacts {
  return {
    asOf: AS_OF,
    postedThrough: "2026-11-12",
    behind: false,
    months: months([true, true, true, true, true, true]),
    // Each full month: 50,000 of sales, 20,000 cost, 25,000 other expenses: a profit, margin 60%.
    pnl: [month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(20_000_00, 8_000_00, 9_000_00)],
    cashTodayMinor: 180_000_00,
    overdueParties: [],
    ...over,
  };
}

const keys = (f: HomeInsightFacts) => homeInsights(f, formatBaseMoney).map((i) => i.key);

describe("books behind", () => {
  const behind = facts({
    postedThrough: "2026-09-30",
    behind: true,
    months: months([true, true, true, true, false, false]),
    pnl: [month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(45_900_00, 20_000_00, 27_200_00), buildProfitAndLoss([]), buildProfitAndLoss([])],
  });

  it("says how many months are missing, and the figures stop at the last posted day", () => {
    const [first] = homeInsights(behind, formatBaseMoney);
    expect(first).toEqual({
      key: "books-behind",
      kind: "Books",
      headline: "2 months are missing from the books",
      detail: "Nothing is posted after 09/30/2026, so every figure stops there. October and November are not entered yet.",
      link: { label: "Import bank lines", href: "/banking" },
    });
  });

  it("is not said when the books are up to date", () => {
    expect(keys(facts())).not.toContain("books-behind");
  });
});

describe("a loss in the last full posted month", () => {
  it("names the last posted month's loss with its expenses and income, skipping months not entered", () => {
    const f = facts({
      postedThrough: "2026-09-30",
      behind: true,
      months: months([true, true, true, true, false, false]),
      pnl: [month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(45_900_00, 20_000_00, 27_200_00), buildProfitAndLoss([]), buildProfitAndLoss([])],
    });
    const loss = homeInsights(f, formatBaseMoney).find((i) => i.key === "loss-last-month");
    expect(loss).toEqual({
      key: "loss-last-month",
      kind: "Profit",
      headline: "September ran a loss of $1,300.00",
      detail: "Expenses of $47,200.00 against income of $45,900.00.",
      link: { label: "Profit and loss", href: "/reports?report=pnl" },
    });
  });

  it("is not said after a profitable month", () => {
    expect(keys(facts())).not.toContain("loss-last-month");
  });
});

describe("overdue owed by a few customers", () => {
  const parties = [
    { entityId: "a", name: "Sample Retail Co.", overdueMinor: 7_400_00, oldestDueDate: "2026-08-08" },
    { entityId: "b", name: "Demo Boutique LLC", overdueMinor: 5_150_00, oldestDueDate: "2026-09-22" },
    { entityId: "c", name: "Example Gifts Inc.", overdueMinor: 3_000_00, oldestDueDate: "2026-10-23" },
    { entityId: "d", name: "Sample Studio LLC", overdueMinor: 3_200_00, oldestDueDate: "2026-11-04" },
  ];

  it("names the three customers owing the most and their share of what is overdue", () => {
    const insight = homeInsights(facts({ overdueParties: parties }), formatBaseMoney).find((i) => i.key === "receivables-concentration");
    expect(insight).toEqual({
      key: "receivables-concentration",
      kind: "Receivables",
      // 15,750 of 18,750 is 84%.
      headline: "3 customers owe 84% of what is overdue",
      detail: "Sample Retail Co., Demo Boutique LLC and Sample Studio LLC owe $15,750.00 of $18,750.00.",
      link: { label: "Review overdue", href: "/invoices?queue=overdue&asOf=2026-11-13" },
    });
  });

  it("names fewer customers when fewer are overdue, and needs at least two", () => {
    const two = homeInsights(facts({ overdueParties: parties.slice(0, 2) }), formatBaseMoney).find((i) => i.key === "receivables-concentration");
    expect(two?.headline).toBe("2 customers owe 100% of what is overdue");
    expect(keys(facts({ overdueParties: parties.slice(0, 1) }))).not.toContain("receivables-concentration");
    expect(keys(facts({ overdueParties: [] }))).not.toContain("receivables-concentration");
  });

  it("is left out when receivables could not be read", () => {
    expect(keys(facts({ overdueParties: null }))).not.toContain("receivables-concentration");
  });
});

describe("cash runway", () => {
  it("divides cash today by the average expenses of the last five full posted months", () => {
    const insight = homeInsights(facts(), formatBaseMoney).find((i) => i.key === "cash-runway");
    expect(insight).toEqual({
      key: "cash-runway",
      kind: "Cash",
      headline: "Cash covers 4.0 months of expenses",
      detail: "$180,000.00 on hand against an average of $45,000.00 in expenses a month, June to October.",
      link: { label: "Cash flow report", href: "/reports/cash-flow" },
    });
  });

  it("needs two full posted months, expenses above zero and cash above zero", () => {
    const oneFull = facts({ months: months([false, false, false, false, true, true]) });
    expect(keys(oneFull)).not.toContain("cash-runway");
    const twoFull = facts({ months: months([false, false, false, true, true, true]) });
    expect(homeInsights(twoFull, formatBaseMoney).find((i) => i.key === "cash-runway")?.detail).toContain("September to October");
    const noExpenses = facts({ pnl: Array.from({ length: 6 }, () => month(1_000_00, 0, 0)) });
    expect(keys(noExpenses)).not.toContain("cash-runway");
    expect(keys(facts({ cashTodayMinor: -5_00 }))).not.toContain("cash-runway");
  });
});

describe("gross margin change", () => {
  it("compares this month's gross margin with the last full month's when it moved a point or more", () => {
    // October: 60.0%. November: 12,000 of 20,000 after 8,800 of cost: 56.0%.
    const f = facts({ pnl: [...facts().pnl.slice(0, 5), month(20_000_00, 8_800_00, 9_000_00)] });
    const insight = homeInsights(f, formatBaseMoney).find((i) => i.key === "gross-margin");
    expect(insight).toEqual({
      key: "gross-margin",
      kind: "Margin",
      headline: "Gross margin is 56.0%, down from 60.0% in October",
      detail: "Cost of goods sold is $8,800.00 on sales of $20,000.00.",
      link: { label: "Profit and loss", href: "/reports?report=pnl" },
    });
  });

  it("is not said for a change under a point, or without income and cost in both months", () => {
    // 60.0% both months.
    expect(keys(facts())).not.toContain("gross-margin");
    const noCost = facts({ pnl: [...facts().pnl.slice(0, 5), month(20_000_00, 0, 9_000_00)] });
    expect(keys(noCost)).not.toContain("gross-margin");
  });
});

describe("the list", () => {
  it("keeps the priority order and stops at three", () => {
    const all = facts({
      postedThrough: "2026-09-30",
      behind: true,
      months: months([true, true, true, true, false, false]),
      pnl: [month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(50_000_00, 20_000_00, 25_000_00), month(45_900_00, 20_000_00, 27_200_00), buildProfitAndLoss([]), buildProfitAndLoss([])],
      overdueParties: [
        { entityId: "a", name: "Sample A", overdueMinor: 1_00, oldestDueDate: "2026-08-01" },
        { entityId: "b", name: "Sample B", overdueMinor: 1_00, oldestDueDate: "2026-08-01" },
      ],
    });
    expect(keys(all)).toEqual(["books-behind", "loss-last-month", "receivables-concentration"]);
    expect(keys(facts())).toEqual(["cash-runway"]);
  });

  it("joins names the way a sentence does", () => {
    expect(listWords(["A"])).toBe("A");
    expect(listWords(["A", "B"])).toBe("A and B");
    expect(listWords(["A", "B", "C"])).toBe("A, B and C");
  });
});
