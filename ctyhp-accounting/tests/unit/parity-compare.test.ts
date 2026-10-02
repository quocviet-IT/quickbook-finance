import { describe, expect, it } from "vitest";
import { compareFigures, pairFigures, tagDifference, type FigurePair } from "@/lib/parity/compare";
import type { BookFigures } from "@/lib/parity/types";

const empty = (): BookFigures => ({ balances: {}, trialBalance: {}, profitAndLoss: {}, balanceSheet: {} });
const pl = (over: Partial<BookFigures["profitAndLoss"][string]> = {}) => ({
  income: 100000,
  cogs: 0,
  gross: null,
  opex: 40000,
  netOperating: 60000,
  otherIncome: 0,
  otherExpenses: 0,
  netOther: 0,
  net: 60000,
  ...over,
});
const bs = () => ({ assets: 500000, liabilities: 200000, equity: 300000, liabilitiesAndEquity: 500000 });

describe("pairFigures", () => {
  it("pairs every account either side shows at a month end, an absent one as zero", () => {
    const p = empty();
    const o = empty();
    p.balances["2026-01-31"] = { "Assets:Bank:Example": 1000, "Expenses:Rent": 500 };
    o.balances["2026-01-31"] = { "Assets:Bank:Example": 1000, "Income:Sales": -1500 };
    expect(pairFigures(p, o)).toEqual([
      { kind: "balance", from: null, to: "2026-01-31", key: "Assets:Bank:Example", prototypeCents: 1000, onebookCents: 1000 },
      { kind: "balance", from: null, to: "2026-01-31", key: "Expenses:Rent", prototypeCents: 500, onebookCents: 0 },
      { kind: "balance", from: null, to: "2026-01-31", key: "Income:Sales", prototypeCents: 0, onebookCents: -1500 },
    ]);
  });
  it("pairs the totals of each statement, skipping a line the prototype's report does not show", () => {
    const p = empty();
    const o = empty();
    p.trialBalance["2025-12-31"] = { debit: 900, credit: 900 };
    o.trialBalance["2025-12-31"] = { debit: 900, credit: 901 };
    p.profitAndLoss["2025-01-01..2025-12-31"] = pl();
    o.profitAndLoss["2025-01-01..2025-12-31"] = pl({ gross: 100000 });
    p.balanceSheet["2025-12-31"] = bs();
    o.balanceSheet["2025-12-31"] = bs();
    const pairs = pairFigures(p, o);
    expect(pairs.filter((x) => x.kind === "trial_balance")).toEqual([
      { kind: "trial_balance", from: null, to: "2025-12-31", key: "debit", prototypeCents: 900, onebookCents: 900 },
      { kind: "trial_balance", from: null, to: "2025-12-31", key: "credit", prototypeCents: 900, onebookCents: 901 },
    ]);
    const plPairs = pairs.filter((x) => x.kind === "profit_and_loss");
    expect(plPairs.map((x) => x.key)).not.toContain("gross");
    expect(plPairs).toHaveLength(8);
    expect(plPairs[0]).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
    expect(pairs.filter((x) => x.kind === "balance_sheet")).toHaveLength(4);
  });
});

describe("tagDifference and compareFigures", () => {
  const pair = (over: Partial<FigurePair>): FigurePair => ({
    kind: "balance",
    from: null,
    to: "2026-03-31",
    key: "Expenses:Rent",
    prototypeCents: 1000,
    onebookCents: 1000,
    ...over,
  });
  const none = { notLoaded: [], closingDates: [] };
  it("counts agreement and tags each difference", () => {
    const result = compareFigures([pair({}), pair({ onebookCents: 1001 }), pair({ key: "Income:Sales", onebookCents: 5000 })], none);
    expect(result.compared).toBe(3);
    expect(result.agreed).toBe(1);
    expect(result.differences.map((d) => [d.key, d.diffCents, d.tag])).toEqual([
      ["Expenses:Rent", 1, "rounding"],
      ["Income:Sales", 4000, "new"],
    ]);
  });
  it("blames entries not loaded only for the accounts and dates they touch", () => {
    const ctx = { notLoaded: [{ date: "2026-02-10", accounts: ["Expenses:Rent", "Assets:Bank:Example"] }], closingDates: [] };
    expect(tagDifference(pair({}), 8000, ctx)).toBe("not loaded");
    expect(tagDifference(pair({ key: "Income:Sales" }), 8000, ctx)).toBe("new");
    expect(tagDifference(pair({ to: "2026-01-31" }), 8000, ctx)).toBe("new");
    expect(tagDifference(pair({ kind: "balance_sheet", key: "assets", to: "2026-12-31" }), 8000, ctx)).toBe("not loaded");
    expect(tagDifference(pair({ kind: "profit_and_loss", key: "net", from: "2025-01-01", to: "2025-12-31" }), 8000, ctx)).toBe("new");
  });
  it("blames a closing entry only in a Profit and Loss whose range holds one", () => {
    const ctx = { notLoaded: [], closingDates: ["2025-12-31"] };
    expect(tagDifference(pair({ kind: "profit_and_loss", key: "net", from: "2025-01-01", to: "2025-12-31" }), 500, ctx)).toBe("closing entry");
    expect(tagDifference(pair({ kind: "profit_and_loss", key: "net", from: "2026-01-01", to: "2026-12-31" }), 500, ctx)).toBe("new");
    expect(tagDifference(pair({ kind: "balance_sheet", key: "equity", to: "2025-12-31" }), 500, ctx)).toBe("new");
  });
});
