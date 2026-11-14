import { describe, expect, it } from "vitest";
import {
  bands,
  barSlots,
  barSpan,
  donutSlices,
  labelFitsAcross,
  runs,
  sharePercent,
  smoothPath,
  sparkPoints,
  stackShares,
  valueAxis,
  yScale,
} from "@/components/dashboard-home/charts/geometry";
import { monthDayLabel, monthName } from "@/components/dashboard-home/charts/labels";

describe("the Dashboard's chart arithmetic (3.0.38)", () => {
  it("draws a smooth line through every point, and nothing for no points", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([[10, 20]])).toBe("M10,20");
    const d = smoothPath([
      [0, 10],
      [10, 0],
      [20, 10],
    ]);
    expect(d.startsWith("M0,10 C")).toBe(true);
    // Two segments, each ending on its point.
    expect(d.match(/ C/g)).toHaveLength(2);
    expect(d.endsWith(" 20,10")).toBe(true);
  });

  it("gives bars an axis that reaches zero, and a balance line one that need not", () => {
    expect(valueAxis([18_240_000, 20_564_025], 3, false)).toEqual([18_000_000, 19_000_000, 20_000_000, 21_000_000]);
    const bars = valueAxis([4_820_000, 5_260_000, 6_130_000], 3, true);
    expect(bars[0]).toBe(0);
    expect(bars[bars.length - 1]).toBeGreaterThanOrEqual(6_130_000);
    // Below zero too: a loss month's bar hangs from the zero line.
    const loss = valueAxis([-130_000, 850_000], 3, true);
    expect(loss[0]).toBeLessThan(0);
    expect(loss).toContain(0);
    // No values still gives an axis to stand on.
    expect(valueAxis([], 3, true).length).toBeGreaterThanOrEqual(2);
  });

  it("maps the lowest tick to the bottom and the highest to the top", () => {
    const y = yScale([0, 100, 200], 10, 110);
    expect(y(0)).toBe(110);
    expect(y(200)).toBe(10);
    expect(y(100)).toBe(60);
  });

  it("spaces the months evenly, with room after the last for a projected point", () => {
    const plain = bands(6, 50, 650);
    expect(plain.step).toBe(100);
    expect(plain.centers).toEqual([100, 200, 300, 400, 500, 600]);
    const withRoom = bands(6, 0, 690, 0.9);
    expect(withRoom.step).toBe(100);
    expect(withRoom.centers[5]).toBe(550);
  });

  it("keeps a month's bars inside its band, however narrow", () => {
    const wide = barSlots(100, 100, 2, 11);
    expect(wide.map((slot) => slot.width)).toEqual([11, 11]);
    expect(wide[0].x).toBe(88);
    expect(wide[1].x).toBe(101);
    const narrow = barSlots(20, 20, 2, 11);
    const left = narrow[0].x;
    const right = narrow[1].x + narrow[1].width;
    expect(left).toBeGreaterThanOrEqual(10);
    expect(right).toBeLessThanOrEqual(30);
  });

  it("stands a bar on zero whether its value is above or below it", () => {
    const y = yScale([-100, 0, 100], 0, 200);
    expect(barSpan(50, y)).toEqual({ y: 50, height: 50 });
    expect(barSpan(-50, y)).toEqual({ y: 100, height: 50 });
  });

  it("turns 'Not posted' on its side when the block is too narrow for it", () => {
    expect(labelFitsAcross("Not posted", 80)).toBe(true);
    expect(labelFitsAcross("Not posted", 40)).toBe(false);
  });

  it("leaves a month not entered yet out of a sparkline instead of drawing it at zero", () => {
    const { points } = sparkPoints([100, 200, 300, 0], [true, true, true, false], 92, 32);
    expect(points[3]).toBeNull();
    // The lowest posted value is at the bottom inset, the highest at the top inset.
    expect(points[0]?.[1]).toBe(28);
    expect(points[2]?.[1]).toBe(4);
    expect(runs(points)).toHaveLength(1);
    // A flat series sits in the middle.
    const flat = sparkPoints([5, 5, 5], [true, true, true], 92, 32);
    expect(flat.points.every((point) => point?.[1] === 16)).toBe(true);
  });

  it("splits a line where a month is missing", () => {
    expect(
      runs([
        [0, 0],
        null,
        [2, 2],
        [3, 3],
      ]),
    ).toEqual([[[0, 0]], [[2, 2], [3, 3]]]);
  });

  it("gives a ring slice to positive lines only, and the slices fill the ring", () => {
    const lines = [
      { name: "Cost of goods sold", amount: 600 },
      { name: "Payroll", amount: 300 },
      { name: "Everything else", amount: -100 },
      { name: "Rent", amount: 100 },
    ];
    const slices = donutSlices(lines, (line) => line.amount, 1000);
    expect(slices.map((slice) => slice.item.name)).toEqual(["Cost of goods sold", "Payroll", "Rent"]);
    expect(slices.map((slice) => slice.length)).toEqual([600, 300, 100]);
    expect(slices.map((slice) => slice.offset)).toEqual([0, 600, 900]);
    expect(donutSlices([{ amount: -5 }], (line) => line.amount, 1000)).toEqual([]);
  });

  it("states a share of the real total, negative when the line is", () => {
    expect(sharePercent(534, 1000)).toBe(53);
    expect(sharePercent(-20, 1000)).toBe(-2);
    expect(sharePercent(5, 0)).toBeNull();
  });

  it("splits the due-date bar by the positive parts only", () => {
    expect(stackShares([25, 25, 50])).toEqual([25, 25, 50]);
    expect(stackShares([0, 0, 0])).toEqual([0, 0, 0]);
    expect(stackShares([-10, 10, 30])).toEqual([0, 25, 75]);
  });

  it("names a month in a tooltip, and the projected day under the chart", () => {
    expect(monthName({ label: "Oct", year: 2026 }, false)).toBe("Oct 2026");
    expect(monthName({ label: "Nov", year: 2026 }, true)).toBe("Nov 2026, to date");
    expect(monthDayLabel("2026-12-13")).toBe("Dec 13");
    expect(monthDayLabel("2027-01-01")).toBe("Jan 1");
  });
});
