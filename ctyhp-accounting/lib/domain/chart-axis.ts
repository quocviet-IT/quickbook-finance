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

/** The steps a reader can count in: 1, 2, 2.5, 5 and 10 times a power of ten. */
const NICE_STEPS = [1, 2, 2.5, 5, 10] as const;

/**
 * Round-number ticks for a value axis: 0 / 20K / 40K / 60K rather than
 * 0 / 15,854 / 31,709.
 *
 * About `count` intervals cover [min, max]; the step is 1, 2, 2.5, 5 or 10
 * times a power of ten, the first ticks start and end on a multiple of it, so
 * 0 is a tick whenever the range crosses or touches it. Every tick is an
 * integer, because the values are minor units (money.ts refuses a fraction of
 * a cent): a step that would not be whole is replaced by the next one that is,
 * and the smallest step is 1. There are always at least two ticks, lowest
 * first, so a flat series still has an axis to sit on.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const intervals = Math.max(1, Math.floor(count));
  const raw = (high - low || Math.abs(high) || 1) / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  let step = 1;
  for (const factor of NICE_STEPS) {
    const candidate = Math.round(factor * magnitude * 1e6) / 1e6;
    if (candidate >= raw * (1 - 1e-9) && Number.isInteger(candidate)) {
      step = candidate;
      break;
    }
  }
  if (step < raw) step = Math.max(1, Math.ceil(raw));
  const first = Math.floor(low / step) * step;
  const last = Math.max(Math.ceil(high / step) * step, first + step);
  const ticks: number[] = [];
  // `|| 0`: a range below zero ends on -0, which would print as "-$0".
  for (let value = first; value <= last; value += step) ticks.push(value || 0);
  return ticks;
}
