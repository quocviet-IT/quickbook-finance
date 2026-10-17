"use client";

import { useCallback, useMemo, useState } from "react";
import { Alert, Select, Switch, Tag, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination } from "@/components/reports/SimpleReport";
import {
  changeLogSheet,
  CHANGE_LOG_LIMIT,
  visibleChanges,
  type ChangeLogEntry,
  type ChangeLogReport,
} from "@/lib/domain/change-log";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { formatDateTime, plural } from "@/lib/format";

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
  // The system's own activity (work queue states, kept statement files, a
  // reconciliation's matches, backups) is hidden until asked for: it buried the
  // changes to the books a reader came for.
  const [showSystem, setShowSystem] = useState(false);
  const [loaded, setLoaded] = useState<ChangeLogReport | null>(null);

  const visible = useMemo(() => (loaded ? visibleChanges(loaded, showSystem).lines : []), [loaded, showSystem]);
  const records = useMemo(() => [...new Set(visible.map((line) => line.record))].sort(), [visible]);
  const hidden = loaded ? loaded.lines.filter((line) => line.system).length : 0;

  const view = useCallback(
    (report: ChangeLogReport): ChangeLogReport => {
      const shown = visibleChanges(report, showSystem);
      return record ? { ...shown, lines: shown.lines.filter((line) => line.record === record) } : shown;
    },
    [record, showSystem],
  );
  const sheet = useCallback(
    (report: ChangeLogReport, when: ReportWhen) =>
      changeLogSheet(report, { companyName, from: when.from ?? when.to, to: when.to, currencyCode, timeZone }),
    [companyName, currencyCode, timeZone],
  );

  return (
    <SimpleReport<ChangeLogReport>
      companyName={companyName}
      title="Change Log"
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "month" }}
      load={load}
      onLoaded={setLoaded}
      view={view}
      sheet={sheet}
      runningText="Reading the audit log…"
      filters={
        <>
          <Select
            allowClear
            aria-label="Record type"
            placeholder="All records"
            style={{ minWidth: 200 }}
            value={record ?? undefined}
            onChange={(value) => setRecord(value ?? null)}
            options={records.map((value) => ({ value, label: value }))}
          />
          <label className={styles.inlineSwitch}>
            <Switch size="small" checked={showSystem} onChange={setShowSystem} />
            <span>Show system activity</span>
          </label>
        </>
      }
      render={(report, _when, { printing }) => (
        <>
          <StatRow items={[{ label: "Changes", value: report.lines.length.toLocaleString("en-US") }]} />
          {!showSystem && hidden > 0 && !printing ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              {plural(hidden, "system event")} hidden: work queue states, kept statement files, a reconciliation's
              own matches and backups. Turn on Show system activity to see them.
            </Typography.Paragraph>
          ) : null}
          {report.truncated ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title={`Only the newest ${plural(CHANGE_LOG_LIMIT, "change")} are shown.`}
              description="This period holds more. Narrow the dates to see the rest."
            />
          ) : null}
          <DataTable<ChangeLogEntry>
            rowKey="id"
            dataSource={report.lines}
            pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
            emptyTitle={record ? "No change to this kind of record in this period" : "Nothing changed in this period"}
            emptyDescription={record ? "Choose All records, or widen the dates." : "Widen the dates."}
            columns={[
              { title: "When", dataIndex: "at", width: 170, render: (at: string) => formatDateTime(at, timeZone) },
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
