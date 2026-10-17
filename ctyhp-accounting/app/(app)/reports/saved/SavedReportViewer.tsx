"use client";
import { useCallback } from "react";
import { Alert, App, Button, Drawer, Space, Typography } from "antd";
import type { SavedReportRow } from "@/lib/services/saved-reports";
import StatementFileViewer from "@/components/statement-file/StatementFileViewer";
import { downloadSavedFile } from "@/lib/client/saved-file-download";
import { useCompanyClock } from "@/components/CompanyClock";
import { formatDateInTimeZone } from "@/lib/format";

export interface SavedReportViewerProps {
  report: SavedReportRow | null;
  onClose: () => void;
}

/**
 * Reading a report without leaving One Book.
 *
 * A CSV is shown as a table, a PDF drawn page by page, a bank download as its
 * text (1.83); anything else says so and offers the original. Telling someone
 * up front beats a click that ends in a format error.
 */
export default function SavedReportViewer({ report, onClose }: SavedReportViewerProps) {
  const { message } = App.useApp();
  const { timeZone } = useCompanyClock();

  const download = useCallback(async () => {
    if (!report) return;
    const problem = await downloadSavedFile(report.id);
    if (problem) message.error(problem);
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
            {report.file_name} · saved {formatDateInTimeZone(report.uploaded_at, timeZone)}
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

          <StatementFileViewer id={report.id} mimeType={report.mime_type} />
        </Space>
      ) : null}
    </Drawer>
  );
}
