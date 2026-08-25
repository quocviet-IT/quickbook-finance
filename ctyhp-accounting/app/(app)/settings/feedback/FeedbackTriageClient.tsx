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
import IconActionButton from "@/components/ui/IconActionButton";
import ReportCell from "./ReportCell";
import { COLUMN } from "@/lib/design/table-metrics";
import {
  describeFeedbackStatusChange,
  FEEDBACK_STATUSES,
  feedbackFrequencyLabel,
  feedbackImpactLabel,
  feedbackImpactShortLabel,
  feedbackKindLabel,
  feedbackKindShortLabel,
  feedbackStatusLabel,
  nextStatuses,
  queueCounts,
  sortNewestFirst,
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
      width: COLUMN.DATE,
      render: (value: string) => (
        <Tooltip title={new Date(value).toLocaleString("en-US")}>
          <span>{new Date(value).toLocaleDateString("en-US")}</span>
        </Tooltip>
      ),
    },
    {
      // One word, with the full wording on hover. The sentence this used to
      // print — "Suggestion for improvement" — is 26 characters and spilled
      // straight over the Urgency column beside it.
      title: "Kind",
      dataIndex: "kind",
      width: 120,
      render: (kind: string) => (
        <Tooltip title={feedbackKindLabel(kind as "broken")}>
          <Tag color={KIND_COLOR[kind]}>{feedbackKindShortLabel(kind as "broken")}</Tag>
        </Tooltip>
      ),
    },
    {
      title: "Urgency",
      width: 130,
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
              // Same reason as Kind above: the full sentence is written for
              // the person choosing it, and "There is a way round, but it
              // costs time" cannot be a column.
              <Tooltip title={feedbackImpactLabel(entry.impact)}>
                <Tag color={IMPACT_COLOR[entry.impact]}>
                  {feedbackImpactShortLabel(entry.impact)}
                </Tag>
              </Tooltip>
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
      // The elastic column, and the one this screen exists to read. See
      // ReportCell for what moved onto its second line and why.
      minWidth: COLUMN.TEXT_MIN,
      render: (_: unknown, row: FeedbackReportView) => (
        <ReportCell row={row} entry={improvementById.get(row.id)} />
      ),
    },
    {
      title: "Shot",
      width: COLUMN.ACTION + 16,
      align: "center",
      render: (_, row) =>
        row.screenshot ? (
          <IconActionButton
            label="View the screenshot filed with this report"
            icon={<PictureOutlined />}
            onClick={() => openScreenshot(row.screenshot as string)}
          />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Attachments",
      width: 130,
      render: (_, row) => {
        const files = attachmentsByReport.get(row.id) ?? [];
        if (files.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
        return (
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            {files.map((file) => (
              // A link, not a Button: Ant Design wraps a button's children in
              // a span of its own, so an ellipsis set on the button cuts at
              // the wrong level — the text ended mid-character against the
              // column border with no ellipsis at all, which is what a reader
              // screenshotted. Typography.Link does the truncation itself and
              // carries the whole name in the tooltip.
              <Typography.Link
                key={file.id}
                ellipsis
                title={`${file.fileName} (${formatBytes(file.sizeBytes)})`}
                style={{ display: "block", maxWidth: "100%", fontSize: 13 }}
                onClick={() => openAttachment(file.storagePath)}
              >
                <FileOutlined style={{ marginInlineEnd: 4 }} />
                {file.fileName}
              </Typography.Link>
            ))}
          </Space>
        );
      },
    },
    ...(canTriage
      ? [
          {
            title: "Move to",
            width: 190,
            align: "right" as const,
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
