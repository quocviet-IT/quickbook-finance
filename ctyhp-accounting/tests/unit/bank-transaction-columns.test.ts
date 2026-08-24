import { describe, expect, it } from "vitest";
import {
  BANK_BUDGET,
  BANK_COLUMN_KEYS,
  BANK_LAST_ELASTIC_KEY,
  BANK_MEASURED_WIDTHS,
  BANK_WIDTH_STORAGE_KEY,
  BANK_WIDTH_STORAGE_KEY_V1,
} from "@/app/(app)/banking/bank-transaction-columns";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";

/**
 * The screenshot on feedback a9c5b84b: Account source repeated "Bank Of
 * America - 121" on all 25 rows, Reference was an em dash on all 25, and Match
 * and Status sat off the right-hand edge where only a sideways scroll reached
 * them.
 */
describe("the bank transactions columns", () => {
  it("no longer carries the two columns that repeated", () => {
    expect(BANK_COLUMN_KEYS).not.toContain("account");
    expect(BANK_COLUMN_KEYS).not.toContain("reference");
  });

  it("keeps the five the reader needs, in reading order", () => {
    expect([...BANK_COLUMN_KEYS]).toEqual(["date", "description", "amount", "category", "match"]);
  });

  it("fits the narrowest box this design supports", () => {
    const measured = Object.values(BANK_MEASURED_WIDTHS).reduce(
      (sum: number, px) => sum + ((px as number) ?? 0),
      0,
    );
    expect(fitsBox(measured + BANK_BUDGET.chrome, BANK_BUDGET.elasticFloor)).toBe(true);
  });

  it("counts the two pinned buttons and the checkbox as room no drag reclaims", () => {
    expect(BANK_BUDGET.chrome).toBe(COLUMN.ACTION * 2 + COLUMN.SELECTION);
  });

  it("leaves the description without a width, so something absorbs the remainder", () => {
    // The elastic column never takes a width of its own, which is what keeps
    // the row total pinned to the box whatever else the reader drags. It is
    // the description and not Match: the first cut had that the other way
    // round and spent 340px rendering the word "Matched" beside a description
    // cut mid-reference.
    expect(BANK_LAST_ELASTIC_KEY).toBe("description");
    expect(BANK_MEASURED_WIDTHS).not.toHaveProperty("description");
    expect(BANK_MEASURED_WIDTHS.match).toBe(COLUMN.RICH_MIN);
    expect(BANK_BUDGET.elasticFloor).toBe(COLUMN.TEXT_MIN);
  });

  it("reads its widths from a new key, and names the one it replaces", () => {
    // August's 1530px of widths are in this reader's browser. Merged over the
    // new defaults they would put the scrollbar straight back.
    expect(BANK_WIDTH_STORAGE_KEY).not.toBe(BANK_WIDTH_STORAGE_KEY_V1);
    expect(BANK_WIDTH_STORAGE_KEY).toContain("v2");
  });
});
