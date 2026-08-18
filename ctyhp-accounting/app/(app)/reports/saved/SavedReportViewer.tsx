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
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const PREVIEW_DEFAULT_PAGE_SIZE = 25;

export interface SavedReportViewerProps {
  report: SavedReportRow | null;
  onClose: () => void;
}

/** One row of the preview grid, carried with its position so it needs no key of its own. */
interface PreviewRow {
  index: number;
  row: string[];
}

/**
 * What was read, and which report it was read for.
 *
 * Keeping the id alongside the result is what lets opening a second report show
 * a spinner rather than the first one's rows — without an effect that clears
 * state synchronously and re-renders everything twice.
 */
interface LoadedPreview {
  id: string;
  preview?: SavedReportPreview;
  problem?: string;
}

/**
 * Reading a report without leaving One Book.
 *
 * A CSV is shown as a table; anything else says so and offers the original.
 * Telling someone up front beats a click that ends in a format error.
 */
export default function SavedReportViewer({ report, onClose }: SavedReportViewerProps) {
  const { message } = App.useApp();
  const [loaded, setLoaded] = useState<LoadedPreview | null>(null);
  const [pageSize, setPageSize] = useState<number>(PREVIEW_DEFAULT_PAGE_SIZE);
  const tabular = Boolean(report) && isTabularSavedReport(report?.mime_type ?? "");

  useEffect(() => {
    if (!report || !isTabularSavedReport(report.mime_type)) return;
    let cancelled = false;
    savedReportPreviewAction(report.id).then((result) => {
      if (cancelled) return;
      setLoaded(
        result.ok && result.data
          ? { id: report.id, preview: savedReportPreview(result.data.text) }
          : { id: report.id, problem: result.error ?? "Could not read that report" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [report]);

  const current = report && loaded?.id === report.id ? loaded : null;

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

          {!tabular ? (
            <Alert
              type="info"
              showIcon
              message="This format is not shown as a table"
              description="One Book shows saved CSV files on screen. Download the original to open this one."
            />
          ) : current?.problem ? (
            <Alert type="error" showIcon message={current.problem} />
          ) : !current?.preview ? (
            <Spin />
          ) : (
            <>
              {current.preview.truncated ? (
                <Alert
                  type="info"
                  showIcon
                  message="Showing the first 500 rows. Download the original for the whole report."
                />
              ) : null}
              <Table<PreviewRow>
                size="small"
                rowKey={(item) => String(item.index)}
                pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PREVIEW_DEFAULT_PAGE_SIZE))}
                scroll={{ x: true }}
                dataSource={current.preview.rows.map((row, index) => ({ index, row }))}
                columns={current.preview.headers.map((header, column) => ({
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
