import { describe, expect, it } from "vitest";
import {
  DEFAULT_TABLE_STATE,
  parseTableState,
  serialiseTableState,
  type TableState,
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

describe("a screen's own defaults", () => {
  // Every field reads from these, not from the module-level default. A screen
  // that declares its own list order and page size means it, and a stale link
  // is exactly when that declaration matters most.
  const screenDefaults: TableState = {
    ...DEFAULT_TABLE_STATE,
    pageSize: 50,
    sort: "due_date",
    order: "ascend",
  };

  it("takes the screen's default sort when the address carries none", () => {
    const state = parseTableState("", screenDefaults);
    expect(state).toEqual(screenDefaults);
  });

  it("falls back to the screen's default, not the global one, when a value is junk", () => {
    // Reverting to the global 20 on a screen that declared 50 would read as the
    // screen forgetting its own mind, and nothing would say why.
    expect(parseTableState("size=999999", screenDefaults).pageSize).toBe(50);
    expect(parseTableState("order=sideways", screenDefaults).order).toBe("ascend");
  });

  it("writes nothing for a view that is already the screen's default", () => {
    expect(serialiseTableState(screenDefaults, screenDefaults)).toBe("");
  });

  it("writes only the half of the sort that differs, and reads it back whole", () => {
    const state: TableState = { ...screenDefaults, order: "descend" };
    expect(serialiseTableState(state, screenDefaults)).toBe("order=descend");
    expect(parseTableState(serialiseTableState(state, screenDefaults), screenDefaults)).toEqual(state);
  });

  it("returns the reader to the screen's default sort when the sort is cleared", () => {
    // The limitation this pins rather than hides: on a screen that declares a
    // default sort, an address has no way to say "no sort at all", because an
    // absent parameter already means the default. Clearing the sort returns the
    // reader to that default rather than to an unsorted list. No screen needs
    // the difference today, and a sentinel value would make every ordinary link
    // stranger to read for the sake of a case nobody has.
    const cleared: TableState = { ...screenDefaults, sort: null, order: null };
    const reread = parseTableState(serialiseTableState(cleared, screenDefaults), screenDefaults);
    expect(reread.sort).toBe("due_date");
    expect(reread.order).toBe("ascend");
  });

  it("gives a sort with no direction the screen's direction, for the same reason", () => {
    // The half of that limitation easier to miss, because it survives even when
    // the column does change: the direction is written only when it differs, so
    // a state carrying a column and no direction writes nothing for it, and an
    // absent direction reads back as the screen's. A link naming another column
    // therefore arrives sorted the way this screen sorts.
    //
    // Pinned because it is silent, not because it is wrong. The alternative is
    // to drop a sort the address named outright, and no interface here produces
    // a directionless sort anyway — Ant Design clears a column and its
    // direction together.
    const foreign: TableState = { ...screenDefaults, sort: "customer_name", order: null };
    const reread = parseTableState(serialiseTableState(foreign, screenDefaults), screenDefaults);
    expect(reread.sort).toBe("customer_name");
    expect(reread.order).toBe("ascend");
  });
});
