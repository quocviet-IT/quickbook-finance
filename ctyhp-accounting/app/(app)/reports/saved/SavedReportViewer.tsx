"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Drawer, Space, Spin, Table, Typography } from "antd";
import {
  isTabularSavedReport,
  savedReportPreview,
  type SavedReportPreview,
} from "@/lib/domain/saved-reports";
import type { SavedReportRow } from "@/lib/services/saved-reports";
import { savedReportDownloadUrlAction, savedReportPreviewAction } from "./actions";

export interface SavedReportViewerProps {
  report: SavedReportRow | null;
  onClose: () => void;
}

const EMPTY: SavedReportPreview = { headers: [], rows: [], truncated: false };

/** One row of the preview grid, carried with its position so it needs no key of its own. */
interface PreviewRow {
  index: number;
  row: string[];
}

/**
 * Reading a report without leaving One Book.
 *
 * A CSV is shown as a table; anything else says so and offers the original.
 * Telling someone up front beats a click that ends in a format error.
 */
export default function SavedReportViewer({ report, onClose }: SavedReportViewerProps) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<SavedReportPreview>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(EMPTY);
    setProblem(null);
    if (!report || !isTabularSavedReport(report.mime_type)) return;
    setLoading(true);
    savedReportPreviewAction(report.id).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok || !result.data) {
        setProblem(result.error ?? "Could not read that report");
        return;
      }
      setPreview(savedReportPreview(result.data.text));
    });
    return () => {
      cancelled = true;
    };
  }, [report]);

  const download = useCallback(async () => {
    if (!report) return;
    const opened = window.open("about:blank");
    if (opened) opened.opener = null;
    const result = await savedReportDownloadUrlAction(report.id);
    if (!result.ok || !result.data) {
      opened?.close();
      message.error(result.error ?? "Could not prepare the download");
      return;
    }
    if (opened) opened.location.href = result.data.url;
    else window.location.href = result.data.url;
  }, [report, message]);

  return (
    <Drawer
      open={Boolean(report)}
      onClose={onClose}
      width={900}
      title={report?.title ?? ""}
      extra={<Button onClick={download}>Download original</Button>}
    >
      {report ? (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {report.file_name} · saved {report.uploaded_at.slice(0, 10)}
            {report.notes ? ` · ${report.notes}` : ""}
          </Typography.Text>

          {report.status === "archived" ? (
            <Alert
              type="warning"
              showIcon
              message="This report is archived"
              description={report.archive_reason ?? "No reason was recorded."}
            />
          ) : null}

          {!isTabularSavedReport(report.mime_type) ? (
            <Alert
              type="info"
              showIcon
              message="This format is not shown as a table"
              description="One Book shows saved CSV files on screen. Download the original to open this one."
            />
          ) : problem ? (
            <Alert type="error" showIcon message={problem} />
          ) : loading ? (
            <Spin />
          ) : (
            <>
              {preview.truncated ? (
                <Alert
                  type="info"
                  showIcon
                  message="Showing the first 500 rows. Download the original for the whole report."
                />
              ) : null}
              <Table<PreviewRow>
                size="small"
                rowKey={(item) => String(item.index)}
                pagination={{ pageSize: 25 }}
                scroll={{ x: true }}
                dataSource={preview.rows.map((row, index) => ({ index, row }))}
                columns={preview.headers.map((header, column) => ({
                  title: header || `Column ${column + 1}`,
                  key: String(column),
                  render: (_: unknown, item: PreviewRow) => item.row[column] ?? "",
                }))}
              />
            </>
          )}
        </Space>
      ) : null}
    </Drawer>
  );
}
