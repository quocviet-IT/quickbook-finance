import { describe, expect, it } from "vitest";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";

describe("the column width tokens", () => {
  it("are whole pixels above zero", () => {
    for (const [name, px] of Object.entries(COLUMN)) {
      expect(Number.isInteger(px), name).toBe(true);
      expect(px, name).toBeGreaterThan(0);
    }
  });

  it("knows the narrowest box this design supports", () => {
    // 1280 viewport, minus the 248px sidebar and the 24px margin each side.
    expect(TABLE_BOX_AT_1280).toBe(984);
  });

  it("leaves the banking row inside that box", () => {
    // Date, Amount, Category, two icon buttons and the selection checkbox are
    // measured; Description and Match are elastic and only have floors.
    const measured =
      COLUMN.DATE + COLUMN.MONEY + COLUMN.PICKER + COLUMN.ACTION * 2 + COLUMN.SELECTION;
    expect(fitsBox(measured, COLUMN.TEXT_MIN + COLUMN.RICH_MIN)).toBe(true);
  });

  it("reports a row that does not fit instead of rounding it down", () => {
    expect(fitsBox(700, 400)).toBe(false);
  });

  it("lets a caller ask about a wider box", () => {
    expect(fitsBox(700, 400, 1174)).toBe(true);
  });
});
