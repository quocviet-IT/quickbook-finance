import { describe, expect, it } from "vitest";
import { RELATED_COLUMN_WIDTH } from "@/app/(app)/banking/rules/related-columns";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";

describe("the Related companies columns", () => {
  it("fit the table's box at 1280px, with Matches on given the text floor", () => {
    const measured = Object.values(RELATED_COLUMN_WIDTH).reduce((sum, width) => sum + width, 0);
    expect(fitsBox(measured, COLUMN.TEXT_MIN)).toBe(true);
  });
});
