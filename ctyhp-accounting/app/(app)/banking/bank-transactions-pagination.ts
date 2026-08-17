import type { TablePaginationConfig } from "antd/es/table";

/**
 * Rows per page the reader can choose, and the exact set RQ-04 asked to be
 * selectable in sequence (25, 50, 100). Ant Design's own default list is
 * `[10, 20, 50, 100]`, which does not contain 25 — so once a reader picked
 * 50 or 100 the size changer would quietly stop offering 25 again. Stating
 * the set explicitly keeps all three reachable both ways.
 */
export const BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE: (typeof BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS)[number] = 25;

/**
 * The pagination config handed to DataTable for Bank Transactions.
 *
 * `pageSize` must come from the caller's own state, never written as a
 * literal number here: Ant Design's Pagination treats a *defined*
 * `pagination.pageSize` prop as fully controlled — `useControlledState` in
 * `@rc-component/pagination` always prefers the prop over its own internal
 * state, on every render — so a fresh object literal rebuilt on each render
 * pins the table back to whatever number is written at the call site, no
 * matter what the reader picks from the size changer. That was RQ-04: the
 * dropdown moved, the table did not, because the literal `{ pageSize: 25 }`
 * was reasserted the instant anything re-rendered the table.
 *
 * `current` (the page number) is deliberately left out of this config, same
 * as before this fix: Ant Design already owns it correctly on its own. The
 * library clamps the displayed page between 1 and the page count on every
 * render regardless of who set it last, and a size change specifically
 * recomputes the nearest valid page and reports that through `onChange`
 * before we ever see it — so tracking `current` here too would just be a
 * second, competing source of truth for the same number.
 *
 * A pure function so a `.ts` test can hold this contract without paying for
 * Ant Design's runtime — the only import above is `import type`.
 */
export function bankTransactionsPagination(
  pageSize: number,
  setPageSize: (pageSize: number) => void,
): TablePaginationConfig {
  return {
    pageSize,
    pageSizeOptions: [...BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS],
    // Ant Design reports (page, pageSize) on every pager interaction, not
    // only on a size change; re-setting pageSize to the value it already
    // holds when the reader merely turns the page is a harmless no-op.
    onChange: (_page, nextPageSize) => setPageSize(nextPageSize),
  };
}
