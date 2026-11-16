import { describe, expect, it } from "vitest";
import { axisTicks, niceTicks } from "@/lib/domain/chart-axis";

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

/**
 * niceTicks draws the rebuilt dashboard's axes (3.0.38): round steps a reader
 * can count in, 0 on the axis whenever the data crosses it, and integer minor
 * units throughout, for the same reason axisTicks rounds.
 */
describe("niceTicks", () => {
  const steps = (ticks: number[]) => ticks.slice(1).map((tick, index) => tick - ticks[index]);

  it("steps in 1, 2, 2.5, 5 or 10 times a power of ten and covers the range", () => {
    // $0 to $61,300 in cents, about three intervals: steps of $25,000.
    expect(niceTicks(0, 6_130_000, 3)).toEqual([0, 2_500_000, 5_000_000, 7_500_000]);
    // About four intervals of 3,000: steps of 5,000.
    expect(niceTicks(0, 12_000)).toEqual([0, 5_000, 10_000, 15_000]);
    expect(niceTicks(1_000, 1_900, 4)).toEqual([1_000, 1_250, 1_500, 1_750, 2_000]);
    for (const [min, max, count] of [[0, 6_130_000, 3], [-130_000, 1_150_000, 3], [17_000_000, 21_000_000, 3], [3, 97, 4]] as const) {
      const ticks = niceTicks(min, max, count);
      expect(ticks[0]).toBeLessThanOrEqual(min);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(max);
      const step = steps(ticks)[0];
      expect(new Set(steps(ticks))).toEqual(new Set([step]));
      const magnitude = 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 2.5, 5, 10]).toContain(step / magnitude);
    }
  });

  it("puts 0 on the axis when the range crosses it", () => {
    const ticks = niceTicks(-130_000, 1_150_000, 3);
    expect(ticks).toContain(0);
    expect(ticks).toEqual([-500_000, 0, 500_000, 1_000_000, 1_500_000]);
    const below = niceTicks(-7_000, -1_000, 3);
    expect(below).toEqual([-8_000, -6_000, -4_000, -2_000, 0]);
    // Never -0, which an axis label would print as "-$0".
    expect(below.some((tick) => Object.is(tick, -0))).toBe(false);
  });

  it("returns integers, never a fraction of a minor unit, even for a tiny range", () => {
    for (const [min, max] of [[0, 10], [0, 3], [0, 1], [5, 6], [-1, 1]]) {
      const ticks = niceTicks(min, max, 4);
      for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true);
    }
    // A step of 2.5 is not a whole number of cents: 5 is used instead.
    expect(niceTicks(0, 10, 4)).toEqual([0, 5, 10]);
  });

  it("gives a flat or empty series two ticks to sit between", () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    const flat = niceTicks(50_000, 50_000, 3);
    expect(flat.length).toBeGreaterThanOrEqual(2);
    expect(flat[0]).toBeLessThanOrEqual(50_000);
    expect(flat.at(-1)).toBeGreaterThanOrEqual(50_000);
    // Arguments the wrong way round are read as a range all the same.
    expect(niceTicks(12_000, 0)).toEqual(niceTicks(0, 12_000));
  });
});
