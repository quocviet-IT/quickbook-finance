import { describe, expect, it } from "vitest";
import { unreadNetIncome } from "@/lib/parity/read-check";
import type { PlKey, PrototypeBook, Totals } from "@/lib/parity/types";

const totals = (netOperating: number | null, net: number | null): Totals<PlKey> => ({
  income: 0,
  cogs: 0,
  gross: null,
  opex: 0,
  netOperating,
  otherIncome: 0,
  otherExpenses: 0,
  netOther: 0,
  net,
});
const book = (profitAndLoss: Record<string, Totals<PlKey>>): PrototypeBook => ({
  id: "1",
  name: "Example",
  accounts: [],
  entries: [],
  monthEnds: [],
  fiscalYears: [],
  figures: { balances: {}, trialBalance: {}, profitAndLoss, balanceSheet: {} },
});

describe("unreadNetIncome", () => {
  it("lists a year whose report shows Net Operating Income but whose Net Income was not read", () => {
    const result = unreadNetIncome(
      book({ "2025-01-01..2025-12-31": totals(1000, null), "2024-01-01..2024-12-31": totals(500, 500) }),
    );
    expect(result).toEqual(["2025-01-01..2025-12-31"]);
  });
  it("accepts an empty report, which shows neither line", () => {
    expect(unreadNetIncome(book({ "2023-01-01..2023-12-31": totals(null, null) }))).toEqual([]);
  });
});
