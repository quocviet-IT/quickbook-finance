import type { TablePaginationConfig } from "antd/es/table";
import { clientTablePagination } from "@/components/ui/table-pagination";

/**
 * Rows per page the reader can choose, and the exact set RQ-04 asked to be
 * selectable in sequence (25, 50, 100). Ant Design's own default list is
 * `[10, 20, 50, 100]`, which does not contain 25 — so once a reader picked
 * 50 or 100 the size changer would quietly stop offering 25 again. Stating
 * the set explicitly keeps all three reachable both ways, and is why this
 * screen keeps its own options rather than the generic
 * `pageSizeOptionsFor` in table-pagination.ts, which would offer 20 instead.
 */
export const BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE: (typeof BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS)[number] = 25;

/**
 * The pagination config handed to DataTable for Bank Transactions.
 *
 * This is the screen where the RQ-04 controlled-prop bug was first found and
 * fixed; the mechanism (why `pageSize` must come from state, and why
 * `current` is left out) now lives in components/ui/table-pagination.ts,
 * shared with every other screen the same bug was found on. What stays here
 * is only what is specific to this screen: the exact 25/50/100 set above.
 *
 * A pure function so a `.ts` test can hold this contract without paying for
 * Ant Design's runtime — the only import above is `import type`.
 */
export function bankTransactionsPagination(
  pageSize: number,
  setPageSize: (pageSize: number) => void,
): TablePaginationConfig {
  return clientTablePagination(pageSize, setPageSize, BANK_TRANSACTIONS_PAGE_SIZE_OPTIONS);
}
