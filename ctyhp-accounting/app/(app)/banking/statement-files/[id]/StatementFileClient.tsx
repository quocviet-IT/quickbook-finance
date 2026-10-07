"use client";
import { Alert, App, Button, Card, Space, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import StatementFileViewer from "@/components/statement-file/StatementFileViewer";
import { downloadSavedFile } from "@/lib/client/saved-file-download";
import { shortSha } from "@/lib/domain/statement-evidence";
import type { SavedReportRow } from "@/lib/services/saved-reports";

export default function StatementFileClient({ file }: { file: SavedReportRow }) {
  const { message } = App.useApp();

  async function download() {
    const problem = await downloadSavedFile(file.id);
    if (problem) message.error(problem);
  }

  return (
    <Card
      extra={
        <Button icon={<DownloadOutlined />} onClick={() => void download()}>
          Download
        </Button>
      }
      title={file.file_name}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          Kept {file.uploaded_at.slice(0, 10)} · SHA-256 {shortSha(file.sha256)}
        </Typography.Text>
        {file.status === "archived" ? (
          <Alert
            type="warning"
            showIcon
            message="This file is archived"
            description={file.archive_reason ?? "No reason was recorded."}
          />
        ) : null}
        <StatementFileViewer id={file.id} mimeType={file.mime_type} />
      </Space>
    </Card>
  );
}
