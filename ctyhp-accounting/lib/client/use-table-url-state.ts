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
   *
   * Know this before building on it: **in client mode the returned state is
   * not re-derived after `update`.** The address is written with
   * `history.replaceState`, which the router deliberately does not see, so
   * `useSearchParams` never yields a new value and nothing schedules a render.
   * A table rendering straight from the returned state would sit still while
   * its own controls were clicked, and no test, lint rule or type would say
   * why. In client mode this hook seeds a caller's own state and mirrors
   * changes back into the address; it is not the state a client-mode table
   * renders from. In server mode the returned state is live, because there the
   * navigation is real.
   */
  mode?: "client" | "server";
  /**
   * The same object on every render — a module-level constant, or memoized.
   *
   * An inline object literal is a new identity each render, and both the parse
   * and the updater below are memoized on that identity, so an inline one
   * redoes the whole hook every render and quietly undoes the reason this file
   * exists. Nothing catches it: React's exhaustive-deps rule checks dependency
   * arrays, not the stability of a custom hook's own arguments.
   */
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
 *
 * The client-mode trick is load-bearing and narrower than it looks: passing the
 * existing `window.history.state` back in is what keeps it invisible. Next marks
 * its own history entries and its patched `replaceState` returns early on them,
 * so reusing that state reaches the router as a no-op — whereas passing `null`
 * or `{}` would resync `useSearchParams` and undo the whole point.
 *
 * When the first screen migrates in batch 2, that migration is the first real
 * test of this file, and it has two halves. That no request fires is one.
 * That the rows actually change when a control is clicked is the other, and it
 * is the half this file cannot give a client-mode caller by itself — see the
 * note on `mode` above.
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
      // In client mode the address is the only live record. `state` above is
      // frozen at the last real navigation, because the router never sees the
      // writes below — so merging onto it would rebuild the query string from
      // a stale reading and drop whatever an earlier update wrote. Read the
      // address back instead: it is what those updates actually changed.
      const current =
        mode === "client" && typeof window !== "undefined"
          ? parseTableState(window.location.search, defaults)
          : state;
      const next = { ...current, ...patch };
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
