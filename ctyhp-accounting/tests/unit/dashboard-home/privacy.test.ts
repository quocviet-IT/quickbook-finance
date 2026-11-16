import { describe, expect, it } from "vitest";
import { homeInsights, type HomeInsightFacts } from "@/lib/domain/dashboard-home/insights";
import { homeNeeds, type HomeNeedFacts } from "@/lib/domain/dashboard-home/needs";
import { maskAmounts, PRIVATE_AMOUNT, PRIVATE_CHANGE, PRIVATE_COMPACT } from "@/lib/domain/dashboard-home/privacy";
import type { HomeMonth } from "@/lib/domain/dashboard-home/types";
import { buildProfitAndLoss, type LedgerBalance, type ProfitAndLoss } from "@/lib/domain/reports";
import { formatCompactMoney, formatMoney, formatSignedMoney } from "@/lib/format";

const usd = (minor: number) => formatMoney(minor, "USD", 2);

describe("what Privacy writes instead of an amount", () => {
  it("is a masked amount, a short one for axes and the ring's middle, and a masked change", () => {
    expect(PRIVATE_AMOUNT).toBe("$••••••");
    expect(PRIVATE_COMPACT).toBe("•••");
    expect(PRIVATE_CHANGE).toBe("••••");
  });
});

describe("maskAmounts", () => {
  it("masks every way the app writes an amount", () => {
    for (const amount of [
      usd(123_456),
      usd(-123_456),
      usd(0),
      formatSignedMoney(5_000_00, "USD", 2),
      formatCompactMoney(2_000_000, "USD", 2),
      formatCompactMoney(120_000_000, "USD", 2),
      formatCompactMoney(-30_000, "USD", 2),
      formatMoney(98_765, "EUR", 2),
      formatMoney(-98_765, "GBP", 2),
      formatMoney(12_345, "JPY", 0),
      formatMoney(1_000_00, "CAD", 2),
    ]) {
      expect(maskAmounts(amount), amount).toBe(PRIVATE_AMOUNT);
    }
    expect(maskAmounts("$20K")).toBe(PRIVATE_AMOUNT);
    expect(maskAmounts("$1.2M")).toBe(PRIVATE_AMOUNT);
    expect(maskAmounts("-$1,234.56")).toBe(PRIVATE_AMOUNT);
  });

  it("leaves counts, dates, days, percentages and names as they are", () => {
    const plain = "3 customers owe 83% of what is overdue · oldest 97 days late · first on 11/16/2026 · Sample Retail Co.";
    expect(maskAmounts(plain)).toBe(plain);
    expect(maskAmounts("Gross margin is 55.0%, down from 56.9% in October")).toBe("Gross margin is 55.0%, down from 56.9% in October");
  });

  it("keeps the punctuation around an amount", () => {
    expect(maskAmounts("Owe $15,550.00 of $18,750.00.")).toBe(`Owe ${PRIVATE_AMOUNT} of ${PRIVATE_AMOUNT}.`);
    expect(maskAmounts("Checking ($1,250.00), Savings ($300.00)")).toBe(`Checking (${PRIVATE_AMOUNT}), Savings (${PRIVATE_AMOUNT})`);
    expect(maskAmounts("$1,250, then $300")).toBe(`${PRIVATE_AMOUNT}, then ${PRIVATE_AMOUNT}`);
  });

  it("masks the amounts in Needs attention's rows, and keeps their counts and dates", () => {
    const facts: HomeNeedFacts = {
      asOf: "2026-11-13",
      overdueInvoices: { count: 4, amountMinor: 18_750_00, oldestDaysLate: 97 },
      billsOverdue: { count: 1, amountMinor: 2_800_00, oldestDaysLate: 12 },
      billsDueSoon: { count: 2, amountMinor: 4_200_00, firstDueDate: "2026-11-16" },
      cardActivity: { cards: 1, lines: 6, amountMinor: 1_612_40 },
      approvals: 3,
      monthsOpen: { count: 1, oldestPeriodEnd: "2026-10-31", earlierYear: false },
      unavailable: [],
    };
    const details = homeNeeds([], facts, usd).map((need) => need.detail);
    expect(details).toContain("$18,750.00 · oldest 97 days late");
    expect(details.map(maskAmounts)).toEqual([
      `${PRIVATE_AMOUNT} · oldest 97 days late`,
      `${PRIVATE_AMOUNT} · oldest 12 days late`,
      `${PRIVATE_AMOUNT} · first on 11/16/2026`,
      `${PRIVATE_AMOUNT} on 1 card, not yet on a completed reconciliation`,
      "3 requests wait for a decision",
      "October 2026 has ended and is still open",
    ]);
  });

  it("masks the amounts in the insights, and keeps their months, names and percentages", () => {
    const row = (code: string, accountType: LedgerBalance["accountType"], debitBase: number, creditBase: number): LedgerBalance => ({
      accountId: code,
      accountCode: code,
      name: `Sample ${code}`,
      accountType,
      debitBase,
      creditBase,
    });
    const month = (sales: number, cogs: number, other: number): ProfitAndLoss =>
      buildProfitAndLoss([row("4000", "income", 0, sales), row("5000", "cost_of_goods_sold", cogs, 0), row("6100", "expense", other, 0)]);
    const months: HomeMonth[] = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map((key) => ({ key, label: key, year: 2026, posted: true }));
    const facts: HomeInsightFacts = {
      asOf: "2026-11-13",
      postedThrough: "2026-11-12",
      behind: false,
      months,
      pnl: [
        month(50_000_00, 20_000_00, 25_000_00),
        month(50_000_00, 20_000_00, 25_000_00),
        month(50_000_00, 20_000_00, 25_000_00),
        month(50_000_00, 20_000_00, 25_000_00),
        month(45_900_00, 20_000_00, 27_200_00),
        month(20_000_00, 8_800_00, 9_000_00),
      ],
      cashTodayMinor: 180_000_00,
      overdueParties: [
        { entityId: "c1", name: "Sample Retail Co.", overdueMinor: 7_400_00, oldestDueDate: "2026-08-08" },
        { entityId: "c2", name: "Demo Boutique LLC", overdueMinor: 5_150_00, oldestDueDate: "2026-09-22" },
        { entityId: "c3", name: "Example Gifts Inc.", overdueMinor: 3_000_00, oldestDueDate: "2026-10-30" },
      ],
    };
    const insights = homeInsights(facts, usd);
    const said = insights.map((insight) => `${insight.headline} | ${insight.detail}`);
    expect(said[0]).toBe("October ran a loss of $1,300.00 | Expenses of $47,200.00 against income of $45,900.00.");
    expect(said.map(maskAmounts)).toEqual([
      `October ran a loss of ${PRIVATE_AMOUNT} | Expenses of ${PRIVATE_AMOUNT} against income of ${PRIVATE_AMOUNT}.`,
      `2 customers owe 81% of what is overdue | Sample Retail Co. and Demo Boutique LLC owe ${PRIVATE_AMOUNT} of ${PRIVATE_AMOUNT}.`,
      insights[2].headline + ` | ${PRIVATE_AMOUNT} on hand against an average of ${PRIVATE_AMOUNT} in expenses a month, June to October.`,
    ]);
    // A ratio is not an amount.
    expect(maskAmounts(insights[2].headline)).toBe(insights[2].headline);
  });
});
