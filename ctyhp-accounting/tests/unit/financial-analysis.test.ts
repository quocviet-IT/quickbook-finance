import { describe, expect, it } from "vitest";
import {
  applyAdjustments,
  buildWhatIfAnalysis,
  freezeAnalysisSchema,
  validateAdjustment,
} from "@/lib/domain/financial-analysis";
import type { LedgerBalance } from "@/lib/domain/reports";

const balanced = {
  key: "a1",
  label: "Recognize December revenue",
  lines: [
    { accountId: "acc-ar", deltaMinor: 100_000 },
    { accountId: "acc-sales", deltaMinor: -100_000 },
  ],
};

describe("validateAdjustment", () => {
  it("accepts a balanced two-line adjustment", () => {
    expect(validateAdjustment(balanced)).toBeNull();
  });

  it("rejects an unbalanced adjustment, naming both sides", () => {
    const msg = validateAdjustment({
      ...balanced,
      lines: [
        { accountId: "acc-ar", deltaMinor: 100_000 },
        { accountId: "acc-sales", deltaMinor: -90_000 },
      ],
    });
    expect(msg).toMatch(/debits 1,000\.00 vs credits 900\.00/);
  });

  it("rejects fewer than two lines — one leg cannot balance", () => {
    expect(validateAdjustment({ ...balanced, lines: [balanced.lines[0]] })).toMatch(
      /at least two lines/i,
    );
  });

  it("rejects a zero or non-integer delta", () => {
    expect(
      validateAdjustment({
        ...balanced,
        lines: [
          { accountId: "acc-ar", deltaMinor: 0 },
          { accountId: "acc-sales", deltaMinor: 0 },
        ],
      }),
    ).toMatch(/zero/i);
    expect(
      validateAdjustment({
        ...balanced,
        lines: [
          { accountId: "acc-ar", deltaMinor: 100.5 },
          { accountId: "acc-sales", deltaMinor: -100.5 },
        ],
      }),
    ).toMatch(/whole minor units/i);
  });

  it("rejects a blank label — a frozen report must say what was assumed", () => {
    expect(validateAdjustment({ ...balanced, label: "  " })).toMatch(/label/i);
  });
});

const ACCOUNTS = [
  { accountId: "acc-ar", accountCode: "1100", name: "Accounts Receivable", accountType: "accounts_receivable" as const },
  { accountId: "acc-sales", accountCode: "4000", name: "Sales", accountType: "income" as const },
  { accountId: "acc-rent", accountCode: "6100", name: "Rent", accountType: "expense" as const },
];

const PNL_ROWS: LedgerBalance[] = [
  { accountId: "acc-sales", accountCode: "4000", name: "Sales", accountType: "income", debitBase: 0, creditBase: 500_000 },
];
const BS_ROWS: LedgerBalance[] = [
  ...PNL_ROWS,
  { accountId: "acc-ar", accountCode: "1100", name: "Accounts Receivable", accountType: "accounts_receivable", debitBase: 500_000, creditBase: 0 },
];

const REVENUE_UP = {
  key: "a1",
  label: "Recognize December revenue",
  lines: [
    { accountId: "acc-ar", deltaMinor: 100_000 },
    { accountId: "acc-sales", deltaMinor: -100_000 },
  ],
};

describe("applyAdjustments", () => {
  it("adds a positive delta to debits and a negative one to credits", () => {
    const out = applyAdjustments(BS_ROWS, [REVENUE_UP], ACCOUNTS);
    expect(out.find((r) => r.accountId === "acc-ar")).toMatchObject({ debitBase: 600_000 });
    expect(out.find((r) => r.accountId === "acc-sales")).toMatchObject({ creditBase: 600_000 });
  });

  it("never mutates the actual rows — actual and adjusted must coexist", () => {
    applyAdjustments(BS_ROWS, [REVENUE_UP], ACCOUNTS);
    expect(BS_ROWS.find((r) => r.accountId === "acc-ar")?.debitBase).toBe(500_000);
  });

  it("synthesizes a row for an account with no activity in the period", () => {
    const rentUp = {
      key: "a2",
      label: "Assume market rent",
      lines: [
        { accountId: "acc-rent", deltaMinor: 50_000 },
        { accountId: "acc-ar", deltaMinor: -50_000 },
      ],
    };
    const out = applyAdjustments(BS_ROWS, [rentUp], ACCOUNTS);
    expect(out.find((r) => r.accountId === "acc-rent")).toMatchObject({
      accountCode: "6100",
      accountType: "expense",
      debitBase: 50_000,
    });
  });

  it("throws on an account the chart does not know", () => {
    const ghost = {
      ...REVENUE_UP,
      lines: [
        { accountId: "nope", deltaMinor: 1 },
        { accountId: "acc-ar", deltaMinor: -1 },
      ],
    };
    expect(() => applyAdjustments(BS_ROWS, [ghost], ACCOUNTS)).toThrow(/unknown account/i);
  });
});

describe("buildWhatIfAnalysis", () => {
  it("flows a revenue adjustment from the P&L to a still-balanced sheet", () => {
    const out = buildWhatIfAnalysis(PNL_ROWS, BS_ROWS, [REVENUE_UP], ACCOUNTS);
    expect(out.pnl.actual.netIncome).toBe(500_000);
    expect(out.pnl.adjusted.netIncome).toBe(600_000);
    expect(out.balanceSheet.adjusted.totalAssets).toBe(600_000);
    expect(out.balanceSheet.adjusted.totalEquity).toBe(600_000);
    expect(out.balanceSheet.actual.balanced).toBe(true);
    expect(out.balanceSheet.adjusted.balanced).toBe(true);
  });
});

describe("freezeAnalysisSchema", () => {
  const UUID_A = "7d3f2b1a-0000-4000-8000-000000000001";
  const UUID_B = "7d3f2b1a-0000-4000-8000-000000000002";
  const REVENUE_UP_UUID = {
    key: "a1",
    label: "Recognize December revenue",
    lines: [
      { accountId: UUID_A, deltaMinor: 100_000 },
      { accountId: UUID_B, deltaMinor: -100_000 },
    ],
  };
  const good = {
    title: "FY2026 margin scenario",
    notes: null,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    adjustments: [REVENUE_UP_UUID],
  };

  it("accepts a complete freeze request", () => {
    expect(freezeAnalysisSchema.safeParse(good).success).toBe(true);
  });

  it("refuses an empty adjustment list — a frozen actual is just a report", () => {
    expect(freezeAnalysisSchema.safeParse({ ...good, adjustments: [] }).success).toBe(false);
  });

  it("refuses a period that ends before it starts", () => {
    expect(
      freezeAnalysisSchema.safeParse({ ...good, periodStart: "2026-12-31", periodEnd: "2026-01-01" })
        .success,
    ).toBe(false);
  });

  it("refuses an adjustment that does not balance", () => {
    const bad = {
      ...REVENUE_UP_UUID,
      lines: [
        { accountId: UUID_A, deltaMinor: 5 },
        { accountId: UUID_B, deltaMinor: -4 },
      ],
    };
    expect(freezeAnalysisSchema.safeParse({ ...good, adjustments: [bad] }).success).toBe(false);
  });

  it("caps the adjustment count at 50", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...REVENUE_UP_UUID, key: `k${i}` }));
    expect(freezeAnalysisSchema.safeParse({ ...good, adjustments: many }).success).toBe(false);
  });
});
