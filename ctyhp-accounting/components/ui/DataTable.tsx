"use client";

import { useState, type ReactNode } from "react";
import { Empty, Table, Typography, type TableProps } from "antd";
import { resolveTableData, type ServerPage } from "./table-data";
import { fallbackPagination } from "./table-pagination";
import { DEFAULT_TABLE_STATE } from "@/lib/domain/table-url-state";

export type { ServerPage };

export type DataTableProps<RecordType extends object> = TableProps<RecordType> & {
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Client mode: the whole list, paged in the browser. */
  rows?: RecordType[];
  /** Server mode: one page, and how many there are altogether. */
  page?: ServerPage<RecordType>;
  /**
   * Whether this table is held to the width of its box. Default: it is.
   *
   * `false` restores Ant Design's `x: "max-content"` and is only for a table
   * that genuinely is a matrix — a grid whose column count is data rather than
   * design. Every use is named in tests/unit/table-fit-contract.test.ts.
   */
  fit?: boolean;
};

export default function DataTable<RecordType extends object>({
  emptyTitle = "No records yet",
  emptyDescription,
  emptyAction,
  rows,
  page,
  pagination,
  dataSource,
  locale,
  scroll,
  fit = true,
  // Accounting work means comparing many rows at once, so lists default to the
  // dense row height; a page can still opt into a roomier table.
  size = "small",
  ...props
}: DataTableProps<RecordType>) {
  // The size changer for callers who never mention pagination. Without this,
  // resolveTableData's shared default reached antd as a defined — controlled —
  // pageSize rebuilt every render, and picking 50 rows a page did nothing on
  // every screen that passed no pagination prop at all (see
  // fallbackPagination). Server-paged tables are excluded: their size lives in
  // the caller's own state, usually the address bar.
  const [fallbackSize, setFallbackSize] = useState<number>(DEFAULT_TABLE_STATE.pageSize);
  const resolved = resolveTableData<RecordType>({
    rows,
    page,
    dataSource,
    pagination: page ? pagination : fallbackPagination(pagination, fallbackSize, setFallbackSize),
  });

  return (
    <div className={`accounting-data-table${fit ? " accounting-table--fit" : ""}`}>
      <Table<RecordType>
        {...props}
        size={size}
        dataSource={resolved.data as RecordType[]}
        pagination={resolved.pagination}
        // A fixed layout is what makes a declared width binding and lets the
        // columns that declare none share what is left. Under `auto` — which
        // is what rc-table falls back to — a width is a hint the browser may
        // overrule, and the elastic columns would not be elastic at all.
        tableLayout={props.tableLayout ?? (fit ? "fixed" : undefined)}
        // Under `fit` the row total IS the box, so there is nothing to scroll
        // sideways and `scroll.x` must not be set. This one line, defaulted to
        // `max-content` for every table, is why the same complaint arrived
        // from four different screens. A caller may still ask for a vertical
        // viewport.
        scroll={
          fit
            ? scroll?.y === undefined
              ? undefined
              : { y: scroll.y }
            : { x: "max-content", ...scroll }
        }
        locale={{
          ...locale,
          emptyText: locale?.emptyText ?? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null}>
              <Typography.Text strong>{emptyTitle}</Typography.Text>
              {emptyDescription && (
                <Typography.Paragraph type="secondary" className="accounting-empty-description">
                  {emptyDescription}
                </Typography.Paragraph>
              )}
              {emptyAction && <div className="accounting-empty-action">{emptyAction}</div>}
            </Empty>
          ),
        }}
      />
    </div>
  );
}
