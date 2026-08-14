import type { TablePaginationConfig } from "antd/es/table";
import { DEFAULT_TABLE_STATE } from "@/lib/domain/table-url-state";

export interface ServerPage<RecordType> {
  rows: RecordType[];
  total: number;
  /** 1-based, as antd counts pages. */
  pageIndex: number;
  pageSize: number;
}

/** The subset of DataTable's props that decides what is on screen. */
export interface DataTableCoreProps<RecordType> {
  /** Client mode: the whole list, paged in the browser. */
  rows?: RecordType[];
  /** Server mode: one page, and how many there are altogether. */
  page?: ServerPage<RecordType>;
  dataSource?: readonly RecordType[];
  pagination?: TablePaginationConfig | false;
}

/**
 * Where the rows come from, and what the pager should say about them.
 *
 * Lives apart from `DataTable.tsx` so the contract can be tested without paying
 * for Ant Design's runtime: this project runs Vitest with `environment: "node"`,
 * and importing the component costs 55 seconds against this file's 0.4.
 *
 * The two modes exist so that moving a screen to server-side paging later
 * changes its data source and nothing else: the columns, the markup and the
 * URL state all stay as they are.
 *
 * A screen driving its table from the address owns the other half of this:
 * pass `pagination={{ current: state.page, pageSize: state.pageSize }}`, or the
 * table pages by this default while the address says something else.
 */
export function resolveTableData<RecordType>(
  props: DataTableCoreProps<RecordType>,
): { data: readonly RecordType[]; pagination: TablePaginationConfig | false } {
  if (props.rows && props.page) {
    throw new Error(
      "DataTable was given both `rows` and `page`. Pass one: `rows` pages in the browser, `page` pages on the server.",
    );
  }

  const data = props.page?.rows ?? props.rows ?? props.dataSource ?? [];

  if (props.pagination === false) return { data, pagination: false };

  const shared = {
    showSizeChanger: true,
    showTotal: (total: number) => `${total.toLocaleString("en-US")} records`,
  };

  const pagination: TablePaginationConfig = props.page
    ? {
        ...shared,
        total: props.page.total,
        current: props.page.pageIndex,
        pageSize: props.page.pageSize,
        ...props.pagination,
      }
    : { ...shared, pageSize: DEFAULT_TABLE_STATE.pageSize, ...props.pagination };

  return { data, pagination };
}
