"use client";

import { useCallback, useState } from "react";
import { Alert, Button, Space, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import DataTable from "@/components/ui/DataTable";
import { dateColumn, statusColumn, actionsColumn } from "@/components/ui/columns";
import { longTextColumn } from "@/components/ui/long-text-column";
import { formatBytes } from "@/lib/domain/feedback-attachment";
import { downloadBackupAction, type BackupRow } from "./actions";

export default function BackupsClient({
  backups,
  loadError,
  canRestore,
}: {
  backups: BackupRow[];
  loadError: string | null;
  canRestore: boolean;
}) {
  // A set, not a single id: downloading row A and then row B while A is
  // still in flight must not clear A's spinner when B's `finally` runs (or
  // vice versa) — each row's own request is what should own its own row's
  // loading state.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  // Wrapped the same way app/(app)/reports/saved/SavedReportViewer.tsx wraps
  // its own download handler: this assigns window.location.href, and the
  // compiler's lint rule reads that mutation of an outside variable as a
  // render-time side effect unless it happens inside a recognised callback.
  const download = useCallback(async (row: BackupRow) => {
    setBusyIds((prev) => new Set(prev).add(row.id));
    try {
      const result = await downloadBackupAction(row.id);
      if (!result.ok || !result.data) {
        throw new Error(result.error ?? "Could not prepare the download");
      }
      window.location.href = result.data.url;
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Could not prepare the download");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  }, []);

  const columns: ColumnsType<BackupRow> = [
    dateColumn<BackupRow>({ title: "Date", dataIndex: "takenAt", width: 130 }),
    statusColumn<BackupRow>({
      title: "Status",
      dataIndex: "status",
      width: 120,
      tones: {
        stored: { tone: "positive", label: "Stored" },
        skipped: { tone: "neutral", label: "Skipped" },
        failed: { tone: "danger", label: "Failed" },
      },
    }),
    {
      title: "Why no file",
      dataIndex: "skipReason",
      ...longTextColumn(320),
    },
    {
      title: "Size",
      dataIndex: "sizeBytes",
      width: 110,
      align: "right",
      // Bytes are display arithmetic, not money: formatBytes divides to build
      // "2.4 MB" and must stay away from fromMinor/formatMoney, which throw on
      // exactly the fractional result that kind of division produces.
      render: (value: number | null) => (value === null ? "—" : formatBytes(value)),
    },
    {
      title: "Journal lines",
      dataIndex: "journalLineCount",
      width: 130,
      align: "right",
      render: (value: number | null) => (value === null ? "—" : value.toLocaleString("en-US")),
    },
    actionsColumn<BackupRow>({
      width: canRestore ? 220 : 120,
      actions: (row) => [
        <Button
          key="download"
          size="small"
          disabled={row.status !== "stored"}
          loading={busyIds.has(row.id)}
          onClick={() => download(row)}
        >
          Download
        </Button>,
        canRestore ? (
          <Link key="restore" href={`/settings/backups/${row.id}/restore`}>
            <Button size="small" disabled={row.status !== "stored"}>
              Restore as new company
            </Button>
          </Link>
        ) : null,
      ],
    }),
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {loadError ? <Alert type="error" showIcon message={loadError} /> : null}
      <Alert
        type="info"
        showIcon
        message="What a snapshot holds"
        description="A snapshot holds every table in this company's books, including vendor tax profiles. Attachments — document scans and other uploaded files — are not included: the snapshot lists them, but their contents are not part of it, and a restore will not bring them back. A Skipped row means the books have not changed since the previous snapshot — expected, not a failure. A missing date is different: it is not proof a snapshot was taken that night, since a failed run leaves no row at all and a routine night may not reach every company — check with an administrator if a specific date matters."
      />
      <DataTable<BackupRow>
        rowKey="id"
        columns={columns}
        dataSource={backups}
        pagination={{ pageSize: 30 }}
      />
    </Space>
  );
}
