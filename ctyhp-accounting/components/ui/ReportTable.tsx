"use client";

import type { ReactNode } from "react";
import { Table } from "antd";
import DataTable, { type DataTableProps } from "./DataTable";

export type ReportTableProps<RecordType extends object> = DataTableProps<RecordType> & {
  /** The figures that close the report, rendered by Table.Summary. */
  summary?: (rows: readonly RecordType[]) => ReactNode;
};

/**
 * A table that ends in a total.
 *
 * Six reports carry a summary row, and a report without its total is a list of
 * numbers rather than a statement. Pagination is off unless a caller turns it
 * on: a trial balance split across pages does not add up on screen, which is
 * the one thing a reader is there to check.
 *
 * Everything else — the columns, the empty state, the dense rows — is
 * DataTable's, so the two cannot drift apart.
 */
export default function ReportTable<RecordType extends object>({
  summary,
  pagination = false,
  ...props
}: ReportTableProps<RecordType>) {
  return (
    <DataTable<RecordType>
      {...props}
      pagination={pagination}
      summary={summary ? (rows) => <Table.Summary fixed>{summary(rows)}</Table.Summary> : undefined}
    />
  );
}
