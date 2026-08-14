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
 * Every field falls back rather than failing.
 *
 * These parameters arrive from a bookmark, a pasted link or a hand-edited
 * address, so they are untrusted input. Validating them is not swallowing an
 * error: refusing to render a list because a stale link says `page=abc` would
 * be a worse answer than showing the first page.
 */
const schema = z.object({
  page: z.coerce.number().int().positive().catch(DEFAULT_TABLE_STATE.page),
  // Not a type predicate: the pinned TableState interface types pageSize as
  // plain number, so a refine narrowed to the literal union 10 | 20 | 50 | 100
  // would reject DEFAULT_TABLE_STATE.pageSize as the .catch() fallback. The
  // runtime check is unchanged; only the type-level narrowing is dropped.
  size: z.coerce
    .number()
    .int()
    .refine((value) => (PAGE_SIZES as readonly number[]).includes(value))
    .catch(DEFAULT_TABLE_STATE.pageSize),
  sort: z.string().min(1).nullable().catch(null),
  order: z.enum(["ascend", "descend"]).nullable().catch(null),
  q: z.string().catch(""),
});

export function parseTableState(
  params: URLSearchParams | string,
  defaults: TableState = DEFAULT_TABLE_STATE,
): TableState {
  const search = typeof params === "string" ? new URLSearchParams(params) : params;
  const parsed = schema.parse({
    page: search.get("page") ?? defaults.page,
    size: search.get("size") ?? defaults.pageSize,
    sort: search.get("sort"),
    order: search.get("order"),
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
  if (state.sort) {
    params.set("sort", state.sort);
    if (state.order) params.set("order", state.order);
  }
  if (state.search !== defaults.search) params.set("q", state.search);
  return params.toString();
}
