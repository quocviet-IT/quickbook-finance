"use client";

import { useState } from "react";
import { FileExcelOutlined, FilePdfOutlined } from "@ant-design/icons";
import { App, Button, Space } from "antd";
import type { ReportExportSheet } from "@/lib/domain/report-export";

export default function ReportExportButtons({
  sheet,
  disabled = false,
}: {
  sheet: ReportExportSheet;
  disabled?: boolean;
}) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState<"pdf" | "excel" | null>(null);

  const run = async (kind: "pdf" | "excel") => {
    setLoading(kind);
    try {
      const { exportReportToExcel, exportReportToPdf } = await import("@/lib/client/report-export");
      if (kind === "pdf") await exportReportToPdf(sheet);
      else await exportReportToExcel(sheet);
      message.success(`${kind === "pdf" ? "PDF" : "Excel"} export created`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not export report");
    } finally {
      setLoading(null);
    }
  };

  return (
    <Space.Compact aria-label="Report export options">
      <Button
        icon={<FilePdfOutlined />}
        loading={loading === "pdf"}
        disabled={disabled || loading !== null}
        onClick={() => void run("pdf")}
      >
        PDF
      </Button>
      <Button
        icon={<FileExcelOutlined />}
        loading={loading === "excel"}
        disabled={disabled || loading !== null}
        onClick={() => void run("excel")}
      >
        Excel
      </Button>
    </Space.Compact>
  );
}
