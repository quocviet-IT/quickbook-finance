"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Input, Modal, Space, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { SAVED_REPORT_SOURCE_LABEL, type SavedReportSource } from "@/lib/domain/saved-reports";
import type { SavedReportRow } from "@/lib/services/saved-reports";
import { archiveSavedReportAction } from "./actions";
import SaveReportModal from "./SaveReportModal";
import SavedReportViewer from "./SavedReportViewer";
import { tokenVar } from "@/lib/design/tokens";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDate, formatDateInTimeZone } from "@/lib/format";

export interface SavedReportsClientProps {
  reports: SavedReportRow[];
  canManage: boolean;
}

/**
 * From, Period, Saved, and the archive action. The report's title takes what is
 * left, at least COLUMN.TEXT_MIN. Period holds two dates and an arrow.
 */
export const SAVED_REPORTS_FIXED_WIDTHS = [
  COLUMN.STATUS,
  COLUMN.DATE * 2 + COLUMN.ACTION,
  COLUMN.DATE,
  COLUMN.CODE,
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPeriod(row: SavedReportRow): string {
  if (!row.period_start && !row.period_end) return "—";
  return `${row.period_start ? formatDate(row.period_start) : "…"} → ${row.period_end ? formatDate(row.period_end) : "…"}`;
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
  const { timeZone } = useCompanyClock();
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
      <DataTable<SavedReportRow>
        rowKey="id"
        rows={reports}
        emptyTitle="No reports saved yet"
        emptyDescription="Anything saved here is kept as it arrived and never posted."
        columns={[
          flexColumn<SavedReportRow>({
            title: "Report",
            dataIndex: "title",
            render: (title: unknown, row: SavedReportRow) => (
              <Space direction="vertical" size={0}>
                <a onClick={() => setViewing(row)}>{String(title)}</a>
                <span style={{ color: tokenVar("text.secondary"), fontSize: 12 }}>
                  {row.file_name} · {formatBytes(row.size_bytes)}
                </span>
              </Space>
            ),
          }),
          {
            title: "From",
            dataIndex: "source",
            width: SAVED_REPORTS_FIXED_WIDTHS[0],
            filters: (Object.keys(SAVED_REPORT_SOURCE_LABEL) as SavedReportSource[]).map((key) => ({
              text: SAVED_REPORT_SOURCE_LABEL[key],
              value: key,
            })),
            onFilter: (value, row) => row.source === value,
            render: (source: SavedReportSource) => (
              <Tag>{SAVED_REPORT_SOURCE_LABEL[source] ?? source}</Tag>
            ),
          },
          { title: "Period", width: SAVED_REPORTS_FIXED_WIDTHS[1], render: (_, row) => formatPeriod(row) },
          {
            title: "Saved",
            dataIndex: "uploaded_at",
            width: SAVED_REPORTS_FIXED_WIDTHS[2],
            render: (value: string) => formatDateInTimeZone(value, timeZone),
          },
          {
            title: "",
            key: "archive",
            width: SAVED_REPORTS_FIXED_WIDTHS[3],
            render: (_, row) =>
              row.status === "archived" ? (
                <StatusTag status="archived" />
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
