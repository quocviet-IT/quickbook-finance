/**
 * The arithmetic behind the Dashboard's four charts (3.0.38), kept apart from
 * the drawing so it can be tested without a browser.
 *
 * Pure. Every chart is drawn at the width it is shown at (the chart measures
 * its box and uses that as the viewBox width), so one unit here is one CSS
 * pixel and a 12px label is 12px on screen at every card width.
 */
import { niceTicks } from "@/lib/domain/chart-axis";

export type Point = readonly [number, number];

/** One decimal is finer than a pixel; it keeps the path strings short. */
export function px(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A smooth line through every point (Catmull-Rom, drawn as cubic Béziers), the
 * way the approved design draws its cash and sparkline curves. One point is a
 * move only; none is an empty path.
 */
export function smoothPath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  let d = `M${px(points[0][0])},${px(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i - 1] ?? points[i];
    const b = points[i];
    const c = points[i + 1];
    const e = points[i + 2] ?? c;
    const c1x = b[0] + (c[0] - a[0]) / 6;
    const c1y = b[1] + (c[1] - a[1]) / 6;
    const c2x = c[0] - (e[0] - b[0]) / 6;
    const c2y = c[1] - (e[1] - b[1]) / 6;
    d += ` C${px(c1x)},${px(c1y)} ${px(c2x)},${px(c2y)} ${px(c[0])},${px(c[1])}`;
  }
  return d;
}

/**
 * The value axis for a set of amounts: round ticks from niceTicks, lowest
 * first. With `withZero` the axis always reaches 0, as bars need it to stand
 * on; a balance line does not, so its axis can start near its lowest point.
 */
export function valueAxis(values: readonly number[], count: number, withZero: boolean): number[] {
  const all = withZero ? [0, ...values] : [...values];
  if (all.length === 0) return niceTicks(0, 0, count);
  return niceTicks(Math.min(...all), Math.max(...all), count);
}

/** A linear map from an axis (its lowest and highest tick) onto a pixel span, top larger than bottom. */
export function yScale(ticks: readonly number[], top: number, bottom: number): (value: number) => number {
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  const span = high - low || 1;
  return (value) => bottom - ((value - low) / span) * (bottom - top);
}

/**
 * The center of each of `count` equal bands between `left` and `right`, and a
 * band's width. `extra` adds room after the last band (a fraction of a band),
 * where the cash chart puts its projected point.
 */
export function bands(count: number, left: number, right: number, extra = 0): { step: number; centers: number[] } {
  const step = Math.max(0, right - left) / Math.max(1, count + extra);
  return { step, centers: Array.from({ length: count }, (_, i) => left + step * (i + 0.5)) };
}

/**
 * Where each bar of a group sits: `count` bars side by side, centered on the
 * band, at most `widest` pixels each and never wider than the band allows,
 * with `gap` pixels between them.
 */
export function barSlots(center: number, step: number, count: number, widest: number, gap = 2): { x: number; width: number }[] {
  const room = step * 0.72 - gap * (count - 1);
  const width = Math.max(2, Math.min(widest, Math.floor(room / Math.max(1, count))));
  const total = width * count + gap * (count - 1);
  const start = center - total / 2;
  return Array.from({ length: count }, (_, i) => ({ x: px(start + i * (width + gap)), width }));
}

/** A bar from 0 to its value: the top edge and its height, below zero as well as above it. */
export function barSpan(value: number, y: (value: number) => number): { y: number; height: number } {
  const zero = y(0);
  const end = y(value);
  return { y: px(Math.min(zero, end)), height: px(Math.abs(end - zero)) };
}

/**
 * Whether "Not posted" fits across a dashed block of this width at 12px, or has
 * to be turned on its side. About 6.2px a character, and room either side.
 */
export function labelFitsAcross(text: string, width: number): boolean {
  return text.length * 6.2 + 8 <= width;
}

/** A rough width of a 12px label, for keeping it inside the chart. */
export function labelWidth(text: string): number {
  return text.length * 6.6;
}

/**
 * How many months apart the names under a chart are written so that no two
 * touch: 1 when each fits its band with `gap` pixels to spare, 2 when they
 * would touch (twelve months on a phone), and so on. The chart counts back
 * from its last month, so the month to date is always named.
 */
export function labelStride(step: number, labels: readonly string[], gap = 6): number {
  if (step <= 0 || labels.length === 0) return 1;
  const widest = Math.max(...labels.map(labelWidth));
  return Math.max(1, Math.ceil((widest + gap) / step));
}

/**
 * Where a label under a chart goes beside the last month's name: centered on
 * `center`; moved left to end at `right` when it would cross the chart's
 * edge; null when it would then begin before `leftLimit` (the end of the
 * last month's name, and a gap), and so cannot be written without touching it.
 */
export function placeEdgeLabel(
  center: number,
  text: string,
  right: number,
  leftLimit: number,
): { x: number; anchor: "middle" | "end" } | null {
  const width = labelWidth(text);
  if (center + width / 2 <= right && center - width / 2 >= leftLimit) return { x: px(center), anchor: "middle" };
  if (right - width >= leftLimit) return { x: px(right), anchor: "end" };
  return null;
}

/** A sparkline: the posted months as points across the width, an unposted month as no point at all. */
export function sparkPoints(
  values: readonly number[],
  posted: readonly boolean[],
  width: number,
  height: number,
  inset = 4,
): { points: (Point | null)[]; slot: number } {
  const count = values.length;
  const slot = count > 1 ? (width - inset) / (count - 1) : 0;
  const shown = values.filter((_, i) => posted[i] !== false);
  const low = shown.length ? Math.min(...shown) : 0;
  const high = shown.length ? Math.max(...shown) : 0;
  const span = high - low;
  const points = values.map((value, i): Point | null => {
    if (posted[i] === false) return null;
    const x = count > 1 ? inset / 2 + i * slot : width / 2;
    // A flat series sits in the middle, not on the floor.
    const y = span === 0 ? height / 2 : inset + (height - inset * 2) * (1 - (value - low) / span);
    return [px(x), px(y)];
  });
  return { points, slot };
}

/** Runs of consecutive points with no gap, each drawn as its own line. */
export function runs(points: readonly (Point | null)[]): Point[][] {
  const out: Point[][] = [];
  let current: Point[] = [];
  for (const point of points) {
    if (point) current.push(point);
    else if (current.length) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

export interface DonutSlice<T> {
  item: T;
  /** Where the slice starts along the ring, and how long it is, in the ring's own units. */
  offset: number;
  length: number;
}

/**
 * Slices of a ring for the positive amounts only, in order, each its share of
 * their sum. A line at zero or below has no slice (a ring cannot draw a
 * negative share); the legend beside the ring still lists it.
 */
export function donutSlices<T>(items: readonly T[], amountOf: (item: T) => number, circumference: number): DonutSlice<T>[] {
  const positive = items.filter((item) => amountOf(item) > 0);
  const sum = positive.reduce((total, item) => total + amountOf(item), 0);
  if (sum <= 0) return [];
  let offset = 0;
  return positive.map((item) => {
    const length = (amountOf(item) / sum) * circumference;
    const slice = { item, offset, length };
    offset += length;
    return slice;
  });
}

/** A whole-number share of a total, for a legend: 53 for 53%. Null when there is no total to share. */
export function sharePercent(part: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((part / total) * 100);
}

/**
 * The widths of a stacked bar of parts, as percentages of their sum, for the
 * open invoices and bills split by due date. A part at zero or below takes no
 * room. Empty when nothing is positive.
 */
export function stackShares(parts: readonly number[]): number[] {
  const sum = parts.reduce((total, part) => total + Math.max(0, part), 0);
  if (sum <= 0) return parts.map(() => 0);
  return parts.map((part) => (Math.max(0, part) / sum) * 100);
}
