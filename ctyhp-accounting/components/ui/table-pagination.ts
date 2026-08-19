import type { TablePaginationConfig } from "antd/es/table";

/**
 * Ant Design's own size-changer choices. A screen whose default already sits
 * in this list needs nothing else; one that does not (8, 12, 15, 25 rows —
 * several screens swept in the RQ-04 follow-up did not) still needs its own
 * number reachable, or the size changer would open on a value that is not
 * among its own options.
 */
const STANDARD_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

/**
 * The choices to offer a table's size changer, guaranteed to contain the
 * screen's own default.
 *
 * Ant Design does not require the current `pageSize` to appear in
 * `pageSizeOptions`, but a size changer whose own selected value is not one
 * of its listed choices reads as broken even once the controlled-prop bug
 * below is fixed — the dropdown would open on a size it cannot be set back
 * to by picking from the list.
 */
export function pageSizeOptionsFor(defaultPageSize: number): number[] {
  return (STANDARD_PAGE_SIZE_OPTIONS as readonly number[]).includes(defaultPageSize)
    ? [...STANDARD_PAGE_SIZE_OPTIONS]
    : [...STANDARD_PAGE_SIZE_OPTIONS, defaultPageSize].sort((a, b) => a - b);
}

/**
 * Turns a caller's own `(pageSize, setPageSize)` state into the pagination
 * config a client-paged table needs — the mechanism every screen in the
 * RQ-04 sweep shares, whatever their own default and size choices are.
 *
 * `pageSize` must come from the caller's state, never written as a literal
 * number at the call site: Ant Design's Pagination treats a *defined*
 * `pagination.pageSize` prop as controlled — `useControlledState` in
 * `@rc-component/pagination` always prefers the prop over its own internal
 * state, on every render — so a fresh object literal rebuilt on each render
 * pins the table back to whatever number is written there, no matter what
 * the reader picks from the size changer. That was RQ-04 on Bank
 * Transactions (see app/(app)/banking/bank-transactions-pagination.ts for
 * the investigation against `@rc-component/pagination`'s source), and the
 * same literal shape recurred at nineteen more call sites across the app —
 * this file is the mechanism those nineteen now share, one bug fixed once.
 *
 * `current` (the page number) is deliberately left out, for the same reason
 * documented there: Ant Design already clamps it correctly on its own, both
 * on render and specifically on a size change, before this code ever sees
 * it, so tracking it here too would just be a second, competing source of
 * truth for the same number.
 *
 * A pure function so a `.ts` test can hold this contract without paying for
 * Ant Design's runtime — the only import above is `import type`.
 */
export function clientTablePagination(
  pageSize: number,
  setPageSize: (pageSize: number) => void,
  pageSizeOptions: readonly number[],
): TablePaginationConfig {
  return {
    pageSize,
    pageSizeOptions: [...pageSizeOptions],
    // Ant Design reports (page, pageSize) on every pager interaction, not
    // only on a size change; re-setting pageSize to the value it already
    // holds when the reader merely turns the page is a harmless no-op.
    onChange: (_page, nextPageSize) => setPageSize(nextPageSize),
  };
}

/**
 * The page size for a table whose caller never mentioned pagination at all.
 *
 * This was the RQ-04 controlled-prop bug's last hiding place. A screen that
 * passed nothing received `{ pageSize: 20 }` from resolveTableData, rebuilt on
 * every render — and a *defined* pageSize is a controlled one, so the size
 * changer moved while the table stayed at twenty. The 1.25 sweep fixed every
 * screen that wrote a literal itself; the screens that wrote nothing inherited
 * the same literal from the shared default and were missed. Chart of Accounts
 * was the one reported; at least eight screens shared it.
 *
 * DataTable holds one piece of state and routes it through here, so the fix
 * lands once instead of eight more times. A caller that supplies its own
 * `pageSize` is left entirely alone — those screens already hold their own
 * state and must keep exactly the behaviour they have.
 */
export function fallbackPagination(
  callerPagination: TablePaginationConfig | false | undefined,
  pageSize: number,
  setPageSize: (pageSize: number) => void,
): TablePaginationConfig | false | undefined {
  if (callerPagination === false) return false;
  if (callerPagination?.pageSize !== undefined) return callerPagination;
  return {
    ...callerPagination,
    pageSize,
    onChange: (page, nextPageSize) => {
      setPageSize(nextPageSize);
      callerPagination?.onChange?.(page, nextPageSize);
    },
  };
}
