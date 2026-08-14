import type { SorterResult } from "antd/es/table/interface";
import type { TablePaginationConfig } from "antd/es/table";
import { DEFAULT_TABLE_STATE, type TableState } from "@/lib/domain/table-url-state";

/**
 * What a table interaction means, in the vocabulary the address uses.
 *
 * Ant Design reports a page change and a sort change through the same
 * `onChange`, in its own shapes. Converting that in one place is what keeps 47
 * screens from each writing the same ten lines slightly differently.
 *
 * Ant Design is `import type` only, so a test of this file costs no runtime
 * import — the same reason `table-data.ts` exists separately from `DataTable`.
 */
export function tableStateFromAntdChange<T>(
  pagination: TablePaginationConfig,
  sorter: SorterResult<T> | SorterResult<T>[],
): Partial<TableState> {
  // An array only arrives for a multi-column sort. These screens sort by one
  // column, so the first entry is the whole story.
  const single = Array.isArray(sorter) ? sorter[0] : sorter;

  // A sort exists only where Ant Design reports a direction. This is the part
  // worth stating: clearing a sort does NOT clear `field` — Ant Design empties
  // `order` and `column` and leaves `field` and `columnKey` behind. Reading the
  // column name on its own would keep a table sorted for good after the reader
  // asked it to stop.
  const order = single?.order ?? null;
  const column = order ? (single?.columnKey ?? single?.field) : null;

  return {
    // The page comes from Ant Design rather than resetting to the first, and
    // that is deliberate: it already recomputes the page when the size changes,
    // and re-ordering a list does not change how many pages it has. The
    // return-to-page-one rule exists for a search box, which narrows the list
    // and does not come through here.
    page: pagination.current ?? DEFAULT_TABLE_STATE.page,
    pageSize: pagination.pageSize ?? DEFAULT_TABLE_STATE.pageSize,
    sort: typeof column === "string" ? column : null,
    order,
  };
}
