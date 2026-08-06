"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Empty, Input, Modal, Space, Table, Tag } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { SAVED_REPORT_SOURCE_LABEL, type SavedReportSource } from "@/lib/domain/saved-reports";
import type { SavedReportRow } from "@/lib/services/saved-reports";
import { archiveSavedReportAction } from "./actions";
import SaveReportModal from "./SaveReportModal";
import SavedReportViewer from "./SavedReportViewer";

export interface SavedReportsClientProps {
  reports: SavedReportRow[];
  canManage: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPeriod(row: SavedReportRow): string {
  if (!row.period_start && !row.period_end) return "—";
  return `${row.period_start ?? "…"} → ${row.period_end ?? "…"}`;
}

/**
 * What has been kept, and how to retire it.
 *
 * Nothing here reads a figure out of a report. The screen exists so a report
 * from another product can be found again, which is the whole of the request
 * it answers.
 */
export default function SavedReportsClient({ reports, canManage }: SavedReportsClientProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<SavedReportRow | null>(null);
  const [archiving, setArchiving] = useState<SavedReportRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmArchive = async () => {
    if (!archiving) return;
    setBusy(true);
    const result = await archiveSavedReportAction(archiving.id, reason);
    setBusy(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not archive that report");
      return;
    }
    message.success("Report archived");
    setArchiving(null);
    setReason("");
  };

  return (
    <Card
      extra={
        canManage ? (
          <Button type="primary" onClick={() => setSaving(true)}>
            Save a report
          </Button>
        ) : null
      }
    >
      <Table<SavedReportRow>
        size="small"
        rowKey="id"
        dataSource={reports}
        locale={{
          emptyText: (
            <Empty
              image={<InboxOutlined style={{ fontSize: 36 }} />}
              description="No reports saved yet. Anything saved here is kept as it arrived and never posted."
            />
          ),
        }}
        columns={[
          {
            title: "Report",
            dataIndex: "title",
            render: (title: string, row: SavedReportRow) => (
              <Space direction="vertical" size={0}>
                <a onClick={() => setViewing(row)}>{title}</a>
                <span style={{ color: "#8c8c8c", fontSize: 12 }}>
                  {row.file_name} · {formatBytes(row.size_bytes)}
                </span>
              </Space>
            ),
          },
          {
            title: "From",
            dataIndex: "source",
            width: 130,
            filters: (Object.keys(SAVED_REPORT_SOURCE_LABEL) as SavedReportSource[]).map((key) => ({
              text: SAVED_REPORT_SOURCE_LABEL[key],
              value: key,
            })),
            onFilter: (value, row) => row.source === value,
            render: (source: SavedReportSource) => (
              <Tag>{SAVED_REPORT_SOURCE_LABEL[source] ?? source}</Tag>
            ),
          },
          { title: "Period", width: 200, render: (_, row) => formatPeriod(row) },
          {
            title: "Saved",
            dataIndex: "uploaded_at",
            width: 130,
            render: (value: string) => value.slice(0, 10),
          },
          {
            title: "",
            width: 110,
            render: (_, row) =>
              row.status === "archived" ? (
                <Tag color="default">archived</Tag>
              ) : canManage ? (
                <Button size="small" onClick={() => setArchiving(row)}>
                  Archive
                </Button>
              ) : null,
          },
        ]}
      />

      <Modal
        open={Boolean(archiving)}
        title={`Archive "${archiving?.title ?? ""}"`}
        okText="Archive"
        confirmLoading={busy}
        onOk={confirmArchive}
        onCancel={() => {
          setArchiving(null);
          setReason("");
        }}
      >
        <p>
          The report stays in One Book with its history. Say why it is being retired so the next
          person reading it knows.
        </p>
        <Input
          placeholder="Replaced by a corrected export"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Modal>

      <SaveReportModal
        open={saving}
        onClose={() => setSaving(false)}
        onSaved={() => {
          setSaving(false);
          router.refresh();
        }}
      />

      <SavedReportViewer report={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}
