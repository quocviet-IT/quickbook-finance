/**
 * Y-axis tick values for the dashboard's performance chart.
 *
 * Ticks are five evenly spaced points between domainMax and
 * domainMax - domainSpan (the chart's domainMin), one per quarter-step of the
 * span. domainMax and domainSpan are always integer minor-unit amounts (see
 * money.ts), but an even quarter-split of an arbitrary integer span is only
 * itself an integer when the span happens to be a multiple of 4 — three
 * residues out of four leave a fractional minor unit on three of the five
 * ticks. That fraction used to reach the display edge, where fromMinor's
 * assertMinor throws on anything non-integer: a real ledger with 39,318,319
 * minor units of span (span % 4 === 3) took a production dashboard down for
 * exactly that reason. Axis labels are compact approximations, so rounding
 * a tick by up to half a minor unit is invisible; what matters is that the
 * value handed to the display edge is always the integer money.ts requires.
 *
 * Rounding can make adjacent ticks collide (a span under 4 rounds several
 * ticks to the same integer) — callers must key the rendered tick elements
 * by index, not by value.
 */
export function axisTicks(domainMax: number, domainSpan: number, count = 5): number[] {
  return Array.from({ length: count }, (_, index) =>
    Math.round(domainMax - (domainSpan * index) / (count - 1)),
  );
}
