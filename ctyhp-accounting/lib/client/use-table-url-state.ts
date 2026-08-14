"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_TABLE_STATE,
  parseTableState,
  serialiseTableState,
  type TableState,
} from "@/lib/domain/table-url-state";

export interface TableUrlStateOptions {
  /**
   * `client` when the whole list is already in the browser and the table
   * pages it locally; `server` when changing the page has to fetch.
   */
  mode?: "client" | "server";
  defaults?: TableState;
}

/**
 * Keep a table's page, sort and search in the address.
 *
 * The two modes differ in one thing, and it matters more than it looks. 59 of
 * this application's 60 pages are `force-dynamic`, so `router.replace` re-runs
 * the server component. In client mode — where the rows are already in the
 * browser — that would mean a server round trip on every keystroke of a search
 * box, turning a fix for lost filters into a performance regression. So client
 * mode writes the address with `history.replaceState`, which the router never
 * sees: the link is still shareable and the back button still works, and
 * nothing is fetched.
 *
 * Server mode uses `router.replace`, because there the round trip is the point.
 */
export function useTableUrlState(
  options: TableUrlStateOptions = {},
): [TableState, (patch: Partial<TableState>) => void] {
  const { mode = "client", defaults = DEFAULT_TABLE_STATE } = options;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(
    () => parseTableState(searchParams.toString(), defaults),
    [searchParams, defaults],
  );

  const update = useCallback(
    (patch: Partial<TableState>) => {
      const next = { ...state, ...patch };
      // Any change to what is being shown returns to the first page. Leaving
      // the reader on page 7 of a result set that now has two pages shows them
      // an empty table and no reason for it.
      if (patch.search !== undefined || patch.sort !== undefined || patch.pageSize !== undefined) {
        next.page = patch.page ?? DEFAULT_TABLE_STATE.page;
      }

      const query = serialiseTableState(next, defaults);
      const url = query ? `${pathname}?${query}` : pathname;

      if (mode === "server") {
        router.replace(url, { scroll: false });
        return;
      }
      window.history.replaceState(window.history.state, "", url);
    },
    [state, defaults, pathname, mode, router],
  );

  return [state, update];
}
