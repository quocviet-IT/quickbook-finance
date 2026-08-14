import { z } from "zod";

/**
 * Which page of which sort a reader is looking at, expressed as URL parameters.
 *
 * It goes in the address so that going back, sharing a link and reloading all
 * return the reader to what they were looking at. Before this, a filtered list
 * was lost the moment anybody navigated away.
 *
 * Pure. The hook that decides how to write the address lives in
 * lib/client/use-table-url-state.ts; the rules for what a parameter means
 * belong here, where a test can hold them.
 */
export interface TableState {
  page: number;
  pageSize: number;
  sort: string | null;
  order: "ascend" | "descend" | null;
  search: string;
}

export const DEFAULT_TABLE_STATE: TableState = {
  page: 1,
  pageSize: 20,
  sort: null,
  order: null,
  search: "",
};

/** The sizes the page-size control offers. Anything else is somebody guessing. */
const PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * Every field falls back rather than failing, and falls back to the screen's
 * own default rather than to this module's.
 *
 * These parameters arrive from a bookmark, a pasted link or a hand-edited
 * address, so they are untrusted input. Validating them is not swallowing an
 * error: refusing to render a list because a stale link says `page=abc` would
 * be a worse answer than showing the first page.
 *
 * Built per call rather than once for the module, which is the only way the
 * fallback can be the caller's. A single shared schema could fall back only to
 * `DEFAULT_TABLE_STATE`, so a screen that declares fifty rows a page would
 * quietly show twenty the moment a stale link carried a bad size — the screen
 * appearing to forget its own mind, with nothing saying why.
 */
function schemaFor(defaults: TableState) {
  return z.object({
    page: z.coerce.number().int().positive().catch(defaults.page),
    // Not a type predicate: the TableState interface above types pageSize as
    // plain number, so narrowing this to the literal 10 | 20 | 50 | 100 union
    // makes the .catch() fallback no longer assignable, and `npm run typecheck`
    // fails. Nothing downstream reads the narrowed type, and the runtime check
    // is the same either way.
    size: z.coerce
      .number()
      .int()
      .refine((value) => (PAGE_SIZES as readonly number[]).includes(value))
      .catch(defaults.pageSize),
    sort: z.string().min(1).nullable().catch(defaults.sort),
    order: z.enum(["ascend", "descend"]).nullable().catch(defaults.order),
    q: z.string().catch(defaults.search),
  });
}

export function parseTableState(
  params: URLSearchParams | string,
  defaults: TableState = DEFAULT_TABLE_STATE,
): TableState {
  const search = typeof params === "string" ? new URLSearchParams(params) : params;
  // All five read the same way: the address if it says anything, the screen's
  // default if it does not. Sort and order are not exceptions — a screen that
  // declares the order its list opens in means it, and an address that says
  // nothing about sorting is not the same as an address asking for none.
  const parsed = schemaFor(defaults).parse({
    page: search.get("page") ?? defaults.page,
    size: search.get("size") ?? defaults.pageSize,
    sort: search.get("sort") ?? defaults.sort,
    order: search.get("order") ?? defaults.order,
    q: search.get("q") ?? defaults.search,
  });

  // An order with no column to sort by describes half a sort, so neither half
  // is kept.
  const sort = parsed.sort;
  return {
    page: parsed.page,
    pageSize: parsed.size,
    sort,
    order: sort ? parsed.order : null,
    search: parsed.q,
  };
}

export function serialiseTableState(
  state: TableState,
  defaults: TableState = DEFAULT_TABLE_STATE,
): string {
  const params = new URLSearchParams();
  // Only what differs from the default is written, so an ordinary view has an
  // ordinary address and a shared link carries only what the sender changed.
  if (state.page !== defaults.page) params.set("page", String(state.page));
  if (state.pageSize !== defaults.pageSize) params.set("size", String(state.pageSize));
  // Sort and order follow the same rule as the other three, and each half is
  // written on its own: changing only the direction of a screen's default sort
  // should put one parameter in the address, not two.
  //
  // The consequence, pinned by tests rather than left to be discovered: on a
  // screen that declares a default sort, an address cannot say "no sort at
  // all", because an absent parameter already means the default. Clearing the
  // sort returns the reader to that default rather than to an unsorted list.
  //
  // The same holds for the direction on its own, which is the half easier to
  // miss: a state naming a column but no direction writes no `order`, and an
  // absent `order` reads back as the screen's. So a link naming another column
  // arrives sorted the way this screen sorts. That is the friendlier of the two
  // answers available — the alternative is to drop a sort the address asked for
  // by name — and no interface here produces a directionless sort anyway, since
  // Ant Design clears a column and its direction together.
  //
  // Both cases would need a sentinel value to express, which would make every
  // ordinary link stranger to read for the sake of states nobody has. Page,
  // size and search have no such gap: they compare with `!==` and nothing else,
  // so even their empty values survive the round trip.
  if (state.sort && state.sort !== defaults.sort) params.set("sort", state.sort);
  if (state.sort && state.order && state.order !== defaults.order) {
    params.set("order", state.order);
  }
  if (state.search !== defaults.search) params.set("q", state.search);
  return params.toString();
}
