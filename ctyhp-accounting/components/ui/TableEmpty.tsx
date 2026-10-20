"use client";

import type { ReactNode } from "react";
import { Empty, Typography } from "antd";

/**
 * What a table says when it has no rows: what is missing, what to do about
 * it, and the button that does it.
 *
 * DataTable has drawn this since it was written. The raw antd tables were left
 * with Ant Design's "No data", or a line of text in its disabled grey — about
 * 1.9:1, too pale to read (UI review, 2026-10-20). They pass this as
 * `locale.emptyText` instead.
 *
 * While the table is loading it has not found nothing, so the placeholder
 * only holds the space: a pay run still on its way read "No open bills —
 * nothing to pay" for seconds before its overdue bill arrived.
 */
export default function TableEmpty({
  title,
  description,
  action,
  loading = false,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
}) {
  if (loading) return <div style={{ minHeight: 96 }} aria-hidden="true" />;
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null}>
      <Typography.Text strong>{title}</Typography.Text>
      {description ? (
        <Typography.Paragraph type="secondary" className="accounting-empty-description">
          {description}
        </Typography.Paragraph>
      ) : null}
      {action ? <div className="accounting-empty-action">{action}</div> : null}
    </Empty>
  );
}
