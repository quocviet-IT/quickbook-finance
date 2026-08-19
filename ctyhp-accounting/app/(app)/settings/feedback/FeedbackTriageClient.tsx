"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Empty,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  FileOutlined,
  PictureOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { ButtonProps } from "antd";
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
 * What each Move-to button looks like, so the three destinations can be told
 * apart before reading them: resolving is green, declining is red, and
 * sending back to review is the same gold the reporter's own screen uses for
 * a report in review (STATUS_COLOR in MyReportsClient) — the two screens
 * describe one workflow and must not colour it two ways.
 *
 * Outlined, not solid. This column repeats on every row; a grid of solid
 * green and red buttons would shout over the reports it is there to file.
 */
const MOVE_BUTTON: Record<FeedbackStatus, Pick<ButtonProps, "color" | "variant" | "icon">> = {
  new: { color: "default", variant: "outlined" },
  reviewing: { color: "gold", variant: "outlined", icon: <EyeOutlined /> },
  resolved: { color: "green", variant: "outlined", icon: <CheckOutlined /> },
  declined: { color: "danger", variant: "outlined", icon: <CloseOutlined /> },
};

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
      // The date answers "how stale is this queue"; the exact minute almost
      // never matters and was costing sixty pixels on every row. It stays a
      // hover away rather than gone.
      width: 110,
      render: (value: string) => (
        <Tooltip title={new Date(value).toLocaleString("en-US")}>
          <span>{new Date(value).toLocaleDateString("en-US")}</span>
        </Tooltip>
      ),
    },
    {
      title: "Kind",
      dataIndex: "kind",
      width: 130,
      render: (kind: string) => (
        <Tag color={KIND_COLOR[kind]}>{feedbackKindLabel(kind as "broken")}</Tag>
      ),
    },
    {
      title: "Urgency",
      width: 160,
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
      // Bounded, at last. This column had no width in a table sized to its
      // contents, so one long report decided how wide the whole table was —
      // the same unbounded free-text defect the 1.20 sweep fixed everywhere
      // else; this screen was missed. Text wraps inside the column now, cut
      // after a few lines with antd's own "more" control, so a long report
      // costs its own row some height instead of costing every column its
      // room.
      width: 380,
      render: (text: string | null, row: FeedbackReportView) => {
        const entry = improvementById.get(row.id);
        // A suggestion reads as an argument: the difficulty first, then what
        // was asked for. The free-text note is background and comes last.
        if (entry?.currentDifficulty || entry?.desiredOutcome) {
          return (
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              {entry.currentDifficulty ? (
                <Typography.Paragraph
                  style={{ marginBottom: 0 }}
                  ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
                >
                  <Typography.Text type="secondary">Today: </Typography.Text>
                  {entry.currentDifficulty}
                </Typography.Paragraph>
              ) : null}
              {entry.desiredOutcome ? (
                <Typography.Paragraph
                  style={{ marginBottom: 0 }}
                  ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
                >
                  <Typography.Text type="secondary">Wants: </Typography.Text>
                  {entry.desiredOutcome}
                </Typography.Paragraph>
              ) : null}
              {text ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ fontSize: 12, marginBottom: 0 }}
                  ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
                >
                  {text}
                </Typography.Paragraph>
              ) : null}
            </Space>
          );
        }
        return text ? (
          <Typography.Paragraph
            style={{ marginBottom: 0 }}
            ellipsis={{ rows: 3, expandable: true, symbol: "more" }}
          >
            {text}
          </Typography.Paragraph>
        ) : (
          <Typography.Text type="secondary">No description</Typography.Text>
        );
      },
    },
    {
      title: "Where",
      width: 220,
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
                    {...MOVE_BUTTON[status]}
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
