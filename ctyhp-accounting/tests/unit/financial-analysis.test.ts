import { describe, expect, it } from "vitest";
import { validateAdjustment } from "@/lib/domain/financial-analysis";

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
