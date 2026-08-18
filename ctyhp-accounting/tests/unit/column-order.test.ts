import { describe, expect, it } from "vitest";
import { reorderColumns } from "@/lib/domain/column-order";

/**
 * The eight columns Bank Transactions actually shows, in their shipped
 * order (RQ-01, change request section 3). Real keys, not `a`/`b`/`c`: this
 * is the function that decides which heading a row's Amount ends up under,
 * and a reviewer should be able to read a test here and know exactly what
 * the reader saw move.
 */
const SHIPPED_ORDER = [
  "date",
  "description",
  "account",
  "reference",
  "amount",
  "category",
  "match",
  "status",
] as const;

describe("reorderColumns", () => {
  it("moves a column left, past several others in one drop", () => {
    // The literal complaint RQ-01 exists to fix: the reader drags Amount up
    // next to Description so they can read it without scrolling. Fails if
    // the insertion point is computed off by one in either direction — e.g.
    // `to - 1` unconditionally would land Amount before Date instead of
    // after it.
    const result = reorderColumns(SHIPPED_ORDER, "amount", "description");
    expect(result).toEqual([
      "date",
      "amount",
      "description",
      "account",
      "reference",
      "category",
      "match",
      "status",
    ]);
  });

  it("moves a column right, past several others in one drop", () => {
    // Fails if the target's insertion index is looked up in the array AFTER
    // the dragged column is removed instead of before — a real off-by-one a
    // careless implementation would make, since removing "description"
    // shifts "match" from index 6 to index 5. Recomputing there would land
    // Description one slot too early (before Match instead of after it).
    const result = reorderColumns(SHIPPED_ORDER, "description", "match");
    expect(result).toEqual([
      "date",
      "account",
      "reference",
      "amount",
      "category",
      "match",
      "description",
      "status",
    ]);
  });

  it("moves the last column to the first position", () => {
    // Fails if a "leftward drag inserts after the target" special case ever
    // gets added — Status would land second, not first.
    const result = reorderColumns(SHIPPED_ORDER, "status", "date");
    expect(result).toEqual([
      "status",
      "date",
      "description",
      "account",
      "reference",
      "amount",
      "category",
      "match",
    ]);
  });

  it("moves the first column to the last position", () => {
    // Fails if the insertion index is clamped to `length - 1` "to be safe" —
    // a defensive-looking change that would actually leave Date second to
    // last instead of last, because the target array is one shorter once
    // the dragged column has been removed from it.
    const result = reorderColumns(SHIPPED_ORDER, "date", "status");
    expect(result).toEqual([
      "description",
      "account",
      "reference",
      "amount",
      "category",
      "match",
      "status",
      "date",
    ]);
  });

  it("does nothing when a column is dropped on itself", () => {
    // Fails if the from === to guard is removed: splicing a column out and
    // straight back into the same spot is harmless here, but the guard is
    // what keeps a same-column drop from ever being treated as "moved" by a
    // caller that diffs the result to decide whether to re-render.
    const result = reorderColumns(SHIPPED_ORDER, "amount", "amount");
    expect(result).toEqual(SHIPPED_ORDER);
    // Still a fresh array, not the same reference — fails if a "nothing to
    // do" shortcut ever returns `order` itself instead of a copy.
    expect(result).not.toBe(SHIPPED_ORDER);
  });

  it("leaves the order untouched when the dragged key is not in it", () => {
    // Fails if the -1 check on `from` is dropped: indexOf's -1 would then
    // reach splice(-1, 1), which removes the LAST element — silently
    // deleting Status from the table instead of leaving the order alone.
    const result = reorderColumns(SHIPPED_ORDER, "vendor" as (typeof SHIPPED_ORDER)[number], "amount");
    expect(result).toEqual(SHIPPED_ORDER);
  });

  it("leaves the order untouched when the drop target is not in it", () => {
    // Same failure mode on the other index: fails if the -1 check on `to`
    // is dropped, splice(-1, 0, moved) would insert Amount second-to-last
    // instead of leaving the table exactly as it was.
    const result = reorderColumns(SHIPPED_ORDER, "amount", "vendor" as (typeof SHIPPED_ORDER)[number]);
    expect(result).toEqual(SHIPPED_ORDER);
  });

  it("reorders correctly when the order given does not include every column", () => {
    // A caller is never required to hand this function the full eight-column
    // set — session state, a saved subset, or a table with fewer columns
    // enabled all look like this. Fails if the function assumes a fixed
    // eight-element shape anywhere (e.g. a hard-coded length or index bound)
    // instead of working purely off the array it was given.
    const partial = ["date", "amount", "status"] as const;
    const result = reorderColumns(partial, "amount", "date");
    expect(result).toEqual(["amount", "date", "status"]);
  });
});
