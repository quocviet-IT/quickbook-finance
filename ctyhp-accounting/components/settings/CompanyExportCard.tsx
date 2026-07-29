"use client";

import { useState } from "react";
import { Alert, App, Button, Card, Space, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { exportCompanyDataAction } from "@/app/(app)/settings/company/actions";

export function CompanyExportCard() {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [lastExport, setLastExport] = useState<{ rows: number; sha: string } | null>(null);

  async function download() {
    setBusy(true);
    try {
      const result = await exportCompanyDataAction();
      if (!result.ok || !result.data) {
        message.error(result.error ?? "The export failed");
        return;
      }
      const bytes = Uint8Array.from(atob(result.data.zipBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.data.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setLastExport({ rows: result.data.totalRows, sha: result.data.manifestSha256 });
      message.success(`Exported ${result.data.totalRows.toLocaleString("en-US")} rows`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Company data export">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          One archive of every accounting table as CSV, with a manifest whose control
          totals a restored database must reproduce. Attachments are listed, not included.
        </Typography.Paragraph>
        <Alert
          type="warning"
          showIcon
          message="This archive contains vendor taxpayer identification numbers"
          description="Store it where the company stores tax records. Every download is recorded in the audit log."
        />
        <Button type="primary" icon={<DownloadOutlined />} loading={busy} onClick={download}>
          Export company data
        </Button>
        {lastExport ? (
          <Typography.Text type="secondary">
            Last export in this session: {lastExport.rows.toLocaleString("en-US")} rows, manifest
            sha256 {lastExport.sha.slice(0, 12)}…
          </Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
}
