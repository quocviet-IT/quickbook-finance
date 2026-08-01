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
import { FileOutlined, PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import {
  describeFeedbackStatusChange,
  FEEDBACK_STATUSES,
  feedbackFrequencyLabel,
  feedbackImpactLabel,
  feedbackKindLabel,
  feedbackStatusLabel,
  nextStatuses,
  queueCounts,
  sortNewestFirst,
  summarizePageContext,
  type FeedbackStatus,
} from "@/lib/domain/feedback";
import type {
  FeedbackAttachmentView,
  FeedbackImprovementView,
  FeedbackReportView,
} from "@/lib/services/feedback";
import { formatBytes } from "@/lib/domain/feedback-attachment";
import {
  feedbackAttachmentUrlAction,
  feedbackScreenshotUrlAction,
  listFeedbackAttachmentsAction,
  listFeedbackImprovementsAction,
  listFeedbackReportsAction,
  setFeedbackStatusAction,
} from "./actions";

const KIND_COLOR: Record<string, string> = { broken: "red", suggestion: "blue" };

/**
 * The colour follows the reporter's own answer, not the score: "I cannot finish
 * the work" should look different from "this would just be nicer" at a glance.
 */
const IMPACT_COLOR: Record<string, string> = {
  blocking: "red",
  slows_work: "orange",
  nice_to_have: "default",
};

export default function FeedbackTriageClient({
  initialReports,
  initialAttachments,
  initialImprovements,
  canTriage,
}: {
  initialReports: FeedbackReportView[];
  initialAttachments: FeedbackAttachmentView[];
  /** Priority and the argument behind each suggestion, computed by the database. */
  initialImprovements: FeedbackImprovementView[];
  canTriage: boolean;
}) {
  const { message } = App.useApp();
  const [reports, setReports] = useState(initialReports);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [improvements, setImprovements] = useState(initialImprovements);
  const [queue, setQueue] = useState<FeedbackStatus>("new");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const counts = useMemo(() => queueCounts(reports), [reports]);
  const attachmentsByReport = useMemo(() => {
    const map = new Map<string, FeedbackAttachmentView[]>();
    for (const attachment of attachments) {
      const list = map.get(attachment.reportId);
      if (list) list.push(attachment);
      else map.set(attachment.reportId, [attachment]);
    }
    return map;
  }, [attachments]);
  const improvementById = useMemo(
    () => new Map(improvements.map((entry) => [entry.id, entry])),
    [improvements],
  );
  const rows = useMemo(
    () => sortNewestFirst(reports.filter((r) => r.status === queue)),
    [reports, queue],
  );

  async function reload() {
    setLoading(true);
    const [res, files, ranked] = await Promise.all([
      listFeedbackReportsAction(),
      listFeedbackAttachmentsAction(),
      listFeedbackImprovementsAction(),
    ]);
    setLoading(false);
    if (res.ok && res.data) setReports(res.data);
    else message.error(res.error ?? "Failed to load reports");
    if (files.ok && files.data) setAttachments(files.data);
    if (ranked.ok && ranked.data) setImprovements(ranked.data);
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

  /** Signed on demand and short-lived: an attachment can hold customer data. */
  async function openAttachment(path: string) {
    const res = await feedbackAttachmentUrlAction(path);
    if (res.ok && res.data) window.open(res.data.url, "_blank", "noopener");
    else message.error(res.error ?? "Attachment unavailable");
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
      title: "Urgency",
      width: 210,
      // Sorted by the score the database computed, never one recomputed here.
      sorter: (a: FeedbackReportView, b: FeedbackReportView) =>
        (improvementById.get(a.id)?.priority ?? 0) - (improvementById.get(b.id)?.priority ?? 0),
      render: (_: unknown, row: FeedbackReportView) => {
        const entry = improvementById.get(row.id);
        if (!entry?.impact && !entry?.frequency) {
          return <Typography.Text type="secondary">Not rated</Typography.Text>;
        }
        return (
          <Space direction="vertical" size={2}>
            {entry.impact ? (
              <Tag color={IMPACT_COLOR[entry.impact]}>{feedbackImpactLabel(entry.impact)}</Tag>
            ) : null}
            {entry.frequency ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {feedbackFrequencyLabel(entry.frequency)} · score {entry.priority}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "What happened",
      dataIndex: "description",
      render: (text: string | null, row: FeedbackReportView) => {
        const entry = improvementById.get(row.id);
        // A suggestion reads as an argument: the difficulty first, then what
        // was asked for. The free-text note is background and comes last.
        if (entry?.currentDifficulty || entry?.desiredOutcome) {
          return (
            <Space direction="vertical" size={2}>
              {entry.currentDifficulty ? (
                <Typography.Text>
                  <Typography.Text type="secondary">Today: </Typography.Text>
                  {entry.currentDifficulty}
                </Typography.Text>
              ) : null}
              {entry.desiredOutcome ? (
                <Typography.Text>
                  <Typography.Text type="secondary">Wants: </Typography.Text>
                  {entry.desiredOutcome}
                </Typography.Text>
              ) : null}
              {text ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {text}
                </Typography.Text>
              ) : null}
            </Space>
          );
        }
        return text ? (
          <Typography.Text>{text}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">No description</Typography.Text>
        );
      },
    },
    {
      title: "Where",
      width: 280,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {summarizePageContext(row.page)}
          </Typography.Text>
          {/* What that screen is for, as the guide describes it — so a reader
              knows which part of the system an idea belongs to without opening
              the route. */}
          {improvementById.get(row.id)?.pagePurpose ? (
            <Typography.Text type="secondary" style={{ fontSize: 12, fontStyle: "italic" }}>
              {improvementById.get(row.id)?.pagePurpose}
            </Typography.Text>
          ) : null}
        </Space>
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
    {
      title: "Attachments",
      width: 240,
      render: (_, row) => {
        const files = attachmentsByReport.get(row.id) ?? [];
        if (files.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
        return (
          <Space direction="vertical" size={2}>
            {files.map((file) => (
              <Button
                key={file.id}
                size="small"
                type="link"
                icon={<FileOutlined />}
                style={{ padding: 0, height: "auto", textAlign: "left" }}
                onClick={() => openAttachment(file.storagePath)}
              >
                {file.fileName} ({formatBytes(file.sizeBytes)})
              </Button>
            ))}
          </Space>
        );
      },
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
