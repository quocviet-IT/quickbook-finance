import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_STATE,
  parseTableState,
  serialiseTableState,
} from "@/lib/domain/table-url-state";

describe("reading table state from a URL", () => {
  it("reads a complete set of parameters", () => {
    const state = parseTableState("page=3&size=50&sort=due_date&order=descend&q=acme");
    expect(state).toEqual({
      page: 3,
      pageSize: 50,
      sort: "due_date",
      order: "descend",
      search: "acme",
    });
  });

  it("falls back to the defaults when nothing is there", () => {
    expect(parseTableState("")).toEqual(DEFAULT_TABLE_STATE);
  });

  it("falls back rather than throwing on junk, because a stale link must still open", () => {
    // Somebody's bookmark from three releases ago, or a hand-edited address.
    // Refusing to render the page would be a worse answer than showing page 1.
    for (const query of ["page=abc", "page=-4", "page=0", "size=999999", "order=sideways", "size=nope"]) {
      expect(() => parseTableState(query), query).not.toThrow();
    }
    expect(parseTableState("page=abc").page).toBe(DEFAULT_TABLE_STATE.page);
    expect(parseTableState("page=-4").page).toBe(DEFAULT_TABLE_STATE.page);
    expect(parseTableState("order=sideways").order).toBe(null);
    expect(parseTableState("size=999999").pageSize).toBe(DEFAULT_TABLE_STATE.pageSize);
  });

  it("keeps an unknown parameter out of the state rather than carrying it", () => {
    expect(parseTableState("page=2&colour=red")).toEqual({ ...DEFAULT_TABLE_STATE, page: 2 });
  });
});

describe("writing table state back to a URL", () => {
  it("writes only what differs from the defaults, so a plain view has a plain address", () => {
    expect(serialiseTableState(DEFAULT_TABLE_STATE)).toBe("");
    expect(serialiseTableState({ ...DEFAULT_TABLE_STATE, page: 2 })).toBe("page=2");
  });

  it("round-trips every field", () => {
    const state = {
      page: 4,
      pageSize: 100,
      sort: "issue_date",
      order: "ascend" as const,
      search: "north star",
    };
    expect(parseTableState(serialiseTableState(state))).toEqual(state);
  });

  it("drops a sort order with no column to sort by", () => {
    // An order without a column says nothing, and carrying it would let a link
    // restore half a sort.
    const written = serialiseTableState({ ...DEFAULT_TABLE_STATE, sort: null, order: "descend" });
    expect(written).toBe("");
  });
});
