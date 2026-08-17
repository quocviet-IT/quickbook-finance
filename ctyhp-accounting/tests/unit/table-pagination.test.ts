// Imports table-pagination, never DataTable or antd. See the note atop
// data-table-contract.test.ts: importing antd's runtime costs about 55
// seconds against this file's fraction of a second.
import { describe, expect, it, vi } from "vitest";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

describe("clientTablePagination (the mechanism behind the RQ-04 sweep)", () => {
  it("hands back whatever pageSize the caller is holding, not a fixed number", () => {
    // The whole bug in one assertion, same as the Bank Transactions test this
    // mirrors: a hardcoded `{ pageSize: N }` inside the implementation would
    // fail the second and third of these.
    expect(clientTablePagination(10, () => {}, [10, 20]).pageSize).toBe(10);
    expect(clientTablePagination(20, () => {}, [10, 20]).pageSize).toBe(20);
    expect(clientTablePagination(100, () => {}, [10, 20, 100]).pageSize).toBe(100);
  });

  it("passes the caller's own size choices through, not a fixed list", () => {
    // Fails if the implementation swaps in STANDARD_PAGE_SIZE_OPTIONS (or any
    // other constant) instead of the array the caller passed.
    expect(clientTablePagination(8, () => {}, [8, 16, 24]).pageSizeOptions).toEqual([8, 16, 24]);
  });

  it("copies the options array rather than handing back the caller's own reference", () => {
    // Fails if the implementation does `pageSizeOptions` (the same array) instead
    // of `[...pageSizeOptions]` — a caller mutating the config's array would then
    // also mutate whatever array the caller originally passed in.
    const original = [10, 20];
    const config = clientTablePagination(10, () => {}, original);
    expect(config.pageSizeOptions).not.toBe(original);
  });

  it("reports the size the reader picked back to the caller's state setter", () => {
    const setPageSize = vi.fn();
    const config = clientTablePagination(25, setPageSize, [25, 50]);
    // Ant Design's Pagination calls pagination.onChange(page, pageSize) on every
    // pager interaction, including plain page navigation.
    config.onChange?.(1, 50);
    expect(setPageSize).toHaveBeenCalledWith(50);
  });

  it("leaves `current` out of the config, trusting Ant Design's own page-clamping", () => {
    // See bank-transactions-pagination.ts (and its test) for why: rc-pagination
    // already clamps `current` correctly on render and on a size change, before
    // this code ever sees it. Fails if the implementation starts returning one.
    expect(clientTablePagination(10, () => {}, [10])).not.toHaveProperty("current");
  });
});

describe("pageSizeOptionsFor (keeping a screen's own default reachable)", () => {
  it("leaves the standard list untouched when the default is already in it", () => {
    // Fails if the implementation always appends the default, which would
    // duplicate 20 here instead of leaving the standard four alone.
    expect(pageSizeOptionsFor(20)).toEqual([10, 20, 50, 100]);
  });

  it("inserts a default the standard list does not carry, in sorted order", () => {
    // 8, 12, 15 and 25 are real screen defaults from the RQ-04 sweep, not
    // synthetic ones. Fails if the implementation forgets to insert, or
    // inserts without sorting (leaving the reader's own default out of order
    // in the size-changer dropdown).
    expect(pageSizeOptionsFor(8)).toEqual([8, 10, 20, 50, 100]);
    expect(pageSizeOptionsFor(12)).toEqual([10, 12, 20, 50, 100]);
    expect(pageSizeOptionsFor(15)).toEqual([10, 15, 20, 50, 100]);
    expect(pageSizeOptionsFor(25)).toEqual([10, 20, 25, 50, 100]);
  });

  it("always contains the default it was given", () => {
    // A general property test alongside the specific numbers above: whatever
    // default a future screen declares, the reader must be able to pick it
    // back from the size changer.
    for (const defaultPageSize of [5, 8, 10, 12, 15, 20, 25, 30, 50, 75, 100, 200]) {
      expect(pageSizeOptionsFor(defaultPageSize)).toContain(defaultPageSize);
    }
  });
});
