"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Empty,
  Segmented,
  Space,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import {
  describeFeedbackStatusChange,
  FEEDBACK_STATUSES,
  feedbackKindLabel,
  feedbackStatusLabel,
  nextStatuses,
  queueCounts,
  sortNewestFirst,
  summarizePageContext,
  type FeedbackStatus,
} from "@/lib/domain/feedback";
import type { FeedbackReportView } from "@/lib/services/feedback";
import {
  feedbackScreenshotUrlAction,
  listFeedbackReportsAction,
  setFeedbackStatusAction,
} from "./actions";

const KIND_COLOR: Record<string, string> = { broken: "red", suggestion: "blue" };

export default function FeedbackTriageClient({
  initialReports,
  canTriage,
}: {
  initialReports: FeedbackReportView[];
  canTriage: boolean;
}) {
  const { message } = App.useApp();
  const [reports, setReports] = useState(initialReports);
  const [queue, setQueue] = useState<FeedbackStatus>("new");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const counts = useMemo(() => queueCounts(reports), [reports]);
  const rows = useMemo(
    () => sortNewestFirst(reports.filter((r) => r.status === queue)),
    [reports, queue],
  );

  async function reload() {
    setLoading(true);
    const res = await listFeedbackReportsAction();
    setLoading(false);
    if (res.ok && res.data) setReports(res.data);
    else message.error(res.error ?? "Failed to load reports");
  }

  async function move(report: FeedbackReportView, status: FeedbackStatus) {
    setBusyId(report.id);
    const res = await setFeedbackStatusAction({ report_id: report.id, status, note: null });
    setBusyId(null);
    if (!res.ok) {
      message.error(res.error ?? "Failed to move the report");
      return;
    }
    message.success(feedbackStatusLabel(status));
    await reload();
  }

  async function openScreenshot(path: string) {
    const res = await feedbackScreenshotUrlAction(path);
    if (res.ok && res.data) window.open(res.data.url, "_blank", "noopener");
    else message.error(res.error ?? "Screenshot unavailable");
  }

  const columns: TableColumnsType<FeedbackReportView> = [
    {
      title: "Filed",
      dataIndex: "createdAt",
      width: 170,
      render: (value: string) => new Date(value).toLocaleString("en-US"),
    },
    {
      title: "Kind",
      dataIndex: "kind",
      width: 210,
      render: (kind: string) => (
        <Tag color={KIND_COLOR[kind]}>{feedbackKindLabel(kind as "broken")}</Tag>
      ),
    },
    {
      title: "What happened",
      dataIndex: "description",
      render: (text: string | null) =>
        text ? (
          <Typography.Text>{text}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">No description</Typography.Text>
        ),
    },
    {
      title: "Where",
      width: 280,
      render: (_, row) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {summarizePageContext(row.page)}
        </Typography.Text>
      ),
    },
    {
      title: "Reporter",
      width: 190,
      render: (_, row) => row.reporter?.email ?? "—",
    },
    {
      title: "Screenshot",
      width: 120,
      render: (_, row) =>
        row.screenshot ? (
          <Button
            size="small"
            icon={<PictureOutlined />}
            onClick={() => openScreenshot(row.screenshot as string)}
          >
            View
          </Button>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    ...(canTriage
      ? [
          {
            title: "Move to",
            width: 240,
            render: (_: unknown, row: FeedbackReportView) => (
              <Space size="small" wrap>
                {nextStatuses(row.status).map((status) => (
                  <Button
                    key={status}
                    size="small"
                    loading={busyId === row.id}
                    title={describeFeedbackStatusChange(row.status, status)}
                    onClick={() => move(row, status)}
                  >
                    {feedbackStatusLabel(status)}
                  </Button>
                ))}
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <Segmented
          value={queue}
          onChange={(value) => setQueue(value as FeedbackStatus)}
          options={FEEDBACK_STATUSES.map((status) => ({
            value: status,
            label: `${feedbackStatusLabel(status)} (${counts[status]})`,
          }))}
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>
          Refresh
        </Button>
        {!canTriage ? (
          <Typography.Text type="secondary">
            You can read the queue; moving a report between queues needs the feedback
            triage permission.
          </Typography.Text>
        ) : null}
      </Space>

      <DataTable
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        sticky
        locale={{ emptyText: <Empty description="Nothing in this queue." /> }}
      />
    </Space>
  );
}
