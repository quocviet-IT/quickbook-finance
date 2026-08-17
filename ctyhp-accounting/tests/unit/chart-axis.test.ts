import { describe, expect, it } from "vitest";
import { axisTicks } from "@/lib/domain/chart-axis";

/**
 * axisTicks feeds formatCompact, which converts through fromMinor's
 * assertMinor (lib/domain/money.ts) — a fractional tick throws there, during
 * server render, and the dashboard shows its error boundary instead of the
 * chart. A quarter-split of an integer span is an integer only when the span
 * is a multiple of 4, so every residue class must be covered, not just one.
 */
describe("axisTicks", () => {
  it("stays integer for the span that actually took production down", () => {
    // Pacific Four Nine's live 6-month window: domainMax = 30,319,248,
    // domainMin = -8,999,071, so domainSpan = 39,318,319 (% 4 === 3). Before
    // the fix this produced [30319248, 20489668.25, 10660088.5, 830508.75,
    // -8999071] — three fractional ticks, the exact production crash
    // (digest 405171483). Reverting the Math.round in axisTicks reproduces
    // the fractional ticks and fails this assertion.
    const ticks = axisTicks(30319248, 39318319);
    for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true);
  });

  it("stays integer when the span leaves remainder 1", () => {
    // 1001 % 4 === 1. Removing Math.round leaves ticks at domainMax - 0.25
    // and domainMax - 0.75 fractional.
    const ticks = axisTicks(1000, 1001);
    for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true);
  });

  it("stays integer when the span leaves remainder 2", () => {
    // 1002 % 4 === 2. Removing Math.round leaves ticks at domainMax - 0.5
    // and domainMax - 1.5 fractional.
    const ticks = axisTicks(1000, 1002);
    for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true);
  });

  it("collapses every tick to domainMax when the span is 0", () => {
    // A degenerate, flat domain: every tick lands on domainMax exactly, so
    // the five rendered elements would share one key if keyed by value. A
    // "fix" for duplicate keys that nudges each tick apart by its index
    // (instead of switching the JSX key to index, which is the actual fix)
    // would break this assertion by spreading the values out.
    const ticks = axisTicks(500, 0);
    expect(ticks).toEqual([500, 500, 500, 500, 500]);
  });

  it("still rounds every tick for the smallest non-zero span, where duplicates appear", () => {
    // domainSpan = 1 is the floor the chart applies (Math.max(1, ...)) when
    // there is no real spread. Its residue is 1, same family as the crafted
    // remainder-1 case above, but small enough that rounding collapses
    // several ticks onto the same integer: [x, x, x, x-1, x-1]. Removing
    // Math.round fails the integer check; and because the duplicates only
    // exist *after* rounding, this is the case proving the chart must key
    // its tick elements by index rather than by value — two values, five
    // elements.
    const ticks = axisTicks(1000, 1);
    for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true);
    expect(new Set(ticks).size).toBeLessThan(ticks.length);
  });
});
