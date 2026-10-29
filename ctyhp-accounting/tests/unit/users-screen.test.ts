import { describe, expect, it } from "vitest";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";
import { USERS_FIXED_WIDTHS } from "@/app/(app)/settings/users/UsersClient";

/**
 * Settings › Users was Ant Design's own table: its declared widths took a
 * phone's whole screen and Email was drawn zero wide. It is a fitted
 * DataTable now, so Email keeps its floor and the frame scrolls.
 */
describe("the Users table", () => {
  it("fits the narrowest computer screen with Email at its floor", () => {
    const fixed = USERS_FIXED_WIDTHS.reduce((sum, px) => sum + px, 0);
    expect(fitsBox(fixed, COLUMN.TEXT_MIN)).toBe(true);
  });

  it("takes its widths from the shared tokens, not numbers of its own", () => {
    expect(USERS_FIXED_WIDTHS).toEqual([COLUMN.PICKER, COLUMN.STATUS, COLUMN.STATUS, COLUMN.DATE_TIME, COLUMN.ACTION * 2]);
  });
});
