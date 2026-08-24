import { describe, expect, it } from "vitest";
import { discardOversizeWidths, parseStoredWidths } from "@/lib/domain/column-width";

/**
 * The reader who filed the complaint had already dragged their columns, so
 * 1530px of August widths sit in their browser. Merged over the new defaults,
 * those numbers put the horizontal scrollbar straight back for exactly the
 * person who reported it — the fix would have looked correct everywhere except
 * on the screen it was written for.
 */
describe("widths recovered from a browser", () => {
  const BUDGET = { box: 984, chrome: 116, elasticFloor: 240 };

  it("drops a stored set that cannot fit the narrowest box", () => {
    const august = { date: 115, description: 320, account: 200, reference: 135, amount: 140 };
    expect(discardOversizeWidths(august, BUDGET)).toEqual({});
  });

  it("keeps a stored set that fits", () => {
    const mine = { date: 88, description: 260, amount: 116 };
    expect(discardOversizeWidths(mine, BUDGET)).toEqual(mine);
  });

  it("keeps the set that lands exactly on the box, and drops the one past it", () => {
    // 628 is the whole allowance here: 984 - 116 chrome - 240 floor.
    expect(discardOversizeWidths({ a: 628 }, BUDGET)).toEqual({ a: 628 });
    expect(discardOversizeWidths({ a: 629 }, BUDGET)).toEqual({});
  });

  it("has nothing to say about an empty store", () => {
    expect(discardOversizeWidths({}, BUDGET)).toEqual({});
  });

  it("works on what parseStoredWidths hands it, keys the release removed and all", () => {
    const stored = parseStoredWidths('{"date":88,"gone":200}', ["date"] as const);
    expect(stored).toEqual({ date: 88 });
    expect(discardOversizeWidths(stored, BUDGET)).toEqual({ date: 88 });
  });
});
