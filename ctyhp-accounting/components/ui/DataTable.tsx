"use client";

import type { ReactNode } from "react";
import { Empty, Table, Typography, type TableProps } from "antd";

export type DataTableProps<RecordType extends object> = TableProps<RecordType> & {
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
};

export default function DataTable<RecordType extends object>({
  emptyTitle = "No records yet",
  emptyDescription,
  emptyAction,
  pagination,
  locale,
  scroll,
  // Accounting work means comparing many rows at once, so lists default to the
  // dense row height; a page can still opt into a roomier table.
  size = "small",
  ...props
}: DataTableProps<RecordType>) {
  const normalizedPagination =
    pagination === false
      ? false
      : {
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total: number) => `${total.toLocaleString("en-US")} records`,
          ...pagination,
        };

  return (
    <div className="accounting-data-table">
      <Table<RecordType>
        {...props}
        size={size}
        pagination={normalizedPagination}
        scroll={{ x: "max-content", ...scroll }}
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
