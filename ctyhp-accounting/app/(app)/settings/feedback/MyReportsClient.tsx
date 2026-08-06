"use client";

import { useMemo } from "react";
import { Empty, Space, Tag, Typography, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import {
  feedbackKindLabel,
  feedbackStatusLabel,
  sortNewestFirst,
  summarizePageContext,
} from "@/lib/domain/feedback";
import type { FeedbackAttachmentView, FeedbackReportView } from "@/lib/services/feedback";

const KIND_COLOR: Record<string, string> = { broken: "red", suggestion: "blue" };

const STATUS_COLOR: Record<string, string> = {
  new: "blue",
  reviewing: "gold",
  resolved: "green",
  declined: "default",
};

/**
 * What the person who filed a report sees.
 *
 * The rows arrive already narrowed: since 0099 only an administrator holds
 * feedback.read, so RLS returns a reporter nothing but their own reports.
 * Filtering again here would be a second definition of the rule, in the place
 * least able to enforce it.
 *
 * No triage controls, and none disabled either. A control that exists only to be
 * refused is noise.
 */
export default function MyReportsClient({
  reports,
  attachments,
}: {
  reports: FeedbackReportView[];
  attachments: FeedbackAttachmentView[];
}) {
  const rows = useMemo(() => sortNewestFirst(reports), [reports]);
  const attachmentCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of attachments) {
      counts.set(file.reportId, (counts.get(file.reportId) ?? 0) + 1);
    }
    return counts;
  }, [attachments]);

  const columns: TableColumnsType<FeedbackReportView> = [
    {
      title: "What you reported",
      dataIndex: "description",
      render: (description: string | null, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{description ?? "—"}</Typography.Text>
          <Typography.Text type="secondary">{summarizePageContext(row.page)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "Kind",
      dataIndex: "kind",
      width: 130,
      render: (_: unknown, row) => (
        <Tag color={KIND_COLOR[row.kind]}>{feedbackKindLabel(row.kind)}</Tag>
      ),
    },
    {
      title: "Where it stands",
      dataIndex: "status",
      width: 160,
      render: (_: unknown, row) => (
        <Tag color={STATUS_COLOR[row.status] ?? "default"}>{feedbackStatusLabel(row.status)}</Tag>
      ),
    },
    {
      title: "Files",
      dataIndex: "id",
      width: 90,
      render: (id: string) => attachmentCount.get(id) ?? 0,
    },
    {
      title: "Filed",
      dataIndex: "createdAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString(),
    },
  ];

  if (rows.length === 0) {
    return (
      <Empty description="You have not filed a report yet. Use the Report button on any screen when something is broken or could work better." />
    );
  }

  return <DataTable rowKey="id" columns={columns} dataSource={rows} pagination={false} />;
}
