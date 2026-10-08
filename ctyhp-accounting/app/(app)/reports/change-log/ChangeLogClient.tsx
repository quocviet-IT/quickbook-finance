"use client";

import { useCallback, useState } from "react";
import { Alert, Select, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import { StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { changeLogSheet, CHANGE_LOG_LIMIT, type ChangeLogEntry, type ChangeLogReport } from "@/lib/domain/change-log";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { stampInTimeZone } from "@/lib/domain/stamp";

const PAGE_SIZE = 50;
/** Room for a two-word action; a longer one, "Match from reconciliation", wraps inside its tag. */
const COLUMN_WHAT = 150;
const WRAPPING_TAG = { whiteSpace: "normal", height: "auto", lineHeight: "18px" } as const;

const WHAT_COLOR: Record<string, string | undefined> = {
  Created: "green",
  Posted: "blue",
  Voided: "red",
  Reversed: "orange",
  Deleted: "red",
};

/** Change Log: what changed in the books between two dates, newest first. */
export default function ChangeLogClient({
  companyName,
  currencyCode,
  presets,
  timeZone,
  load,
}: {
  companyName: string;
  currencyCode: string;
  presets: PresetContext;
  timeZone: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<ChangeLogReport>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [record, setRecord] = useState<string | null>(null);
  const [records, setRecords] = useState<string[]>([]);

  const view = useCallback(
    (report: ChangeLogReport): ChangeLogReport =>
      record ? { ...report, lines: report.lines.filter((line) => line.record === record) } : report,
    [record],
  );
  const sheet = useCallback(
    (report: ChangeLogReport, when: ReportWhen) =>
      changeLogSheet(report, { companyName, from: when.from ?? when.to, to: when.to, currencyCode, timeZone }),
    [companyName, currencyCode, timeZone],
  );
  const loadAndList = useCallback(
    async (when: ReportWhen) => {
      const result = await load(when);
      if (result.ok && result.data) setRecords([...new Set(result.data.lines.map((line) => line.record))].sort());
      return result;
    },
    [load],
  );

  return (
    <SimpleReport<ChangeLogReport>
      companyName={companyName}
      title="Change Log"
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "month" }}
      load={loadAndList}
      view={view}
      sheet={sheet}
      runningText="Reading the audit log…"
      filters={
        <Select
          allowClear
          aria-label="Record type"
          placeholder="All records"
          style={{ minWidth: 200 }}
          value={record ?? undefined}
          onChange={(value) => setRecord(value ?? null)}
          options={records.map((value) => ({ value, label: value }))}
        />
      }
      render={(report) => (
        <>
          <StatRow items={[{ label: "Changes", value: report.lines.length.toLocaleString("en-US") }]} />
          {report.truncated ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title={`Only the newest ${CHANGE_LOG_LIMIT.toLocaleString("en-US")} changes are shown.`}
              description="This period holds more. Narrow the dates to see the rest."
            />
          ) : null}
          <DataTable<ChangeLogEntry>
            rowKey="id"
            dataSource={report.lines}
            pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
            emptyTitle="Nothing changed in this period"
            emptyDescription="Widen the dates."
            columns={[
              { title: "When", dataIndex: "at", width: 150, render: (at: string) => stampInTimeZone(at, timeZone) },
              { title: "Who", dataIndex: "who", width: 220, ellipsis: true },
              {
                title: "What",
                dataIndex: "what",
                width: COLUMN_WHAT,
                render: (what: string) => (
                  <Tag color={WHAT_COLOR[what]} style={WRAPPING_TAG}>
                    {what}
                  </Tag>
                ),
              },
              {
                title: "Record",
                key: "record",
                width: 220,
                render: (_: unknown, line: ChangeLogEntry) => (
                  <span>
                    {line.record}
                    {line.reference ? <span className={styles.mono}> {line.reference}</span> : null}
                  </span>
                ),
              },
              flexColumn<ChangeLogEntry>({
                title: "Detail",
                key: "detail",
                render: (_: unknown, line: ChangeLogEntry) => (
                  <span className={styles.muted} title={line.detail}>
                    {line.detail || "—"}
                  </span>
                ),
              }),
            ]}
          />
        </>
      )}
    />
  );
}
