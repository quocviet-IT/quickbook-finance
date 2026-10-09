"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { closeLogSheet, type CloseLogLine, type CloseLogReport } from "@/lib/domain/close-log";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { stampInTimeZone } from "@/lib/domain/stamp";

const EVENT_COLOR: Record<CloseLogLine["event"], string | undefined> = {
  Closed: "blue",
  Reopened: "orange",
  Open: undefined,
};

/** Month-End Close Log: every close and reopen of a fiscal year's months. */
export default function CloseLogClient({
  companyName,
  currencyCode,
  fiscalYear,
  timeZone,
  load,
}: {
  companyName: string;
  currencyCode: string;
  fiscalYear: number;
  timeZone: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<CloseLogReport>>;
}) {
  const sheet = useCallback(
    (report: CloseLogReport, when: ReportWhen) =>
      closeLogSheet(report, { companyName, fiscalYear: when.fiscalYear ?? fiscalYear, currencyCode, timeZone }),
    [companyName, fiscalYear, currencyCode, timeZone],
  );

  return (
    <SimpleReport<CloseLogReport>
      companyName={companyName}
      title="Month-End Close Log"
      currencyCode={currencyCode}
      period={{ kind: "fiscalYear", current: fiscalYear }}
      load={load}
      sheet={sheet}
      runningText="Reading the closes…"
      render={(report) => (
        <>
          <StatRow
            items={[
              { label: "Months closed", value: report.closedMonths },
              { label: "Reopenings", value: report.reopenings, danger: report.reopenings > 0 },
            ]}
          />
          <DataTable<CloseLogLine>
            rowKey="key"
            dataSource={report.lines}
            pagination={false}
            rowClassName={(line) => (line.monthStart ? styles.groupStart : "")}
            emptyTitle="No accounting periods for this fiscal year"
            emptyDescription="Months are closed one accounting period at a time, and this year has none set up yet."
            emptyAction={<Link href="/settings/periods">Set up accounting periods</Link>}
            columns={[
              {
                title: "Month",
                key: "month",
                width: 150,
                render: (_: unknown, line: CloseLogLine) => (line.monthStart ? <strong>{line.month}</strong> : null),
              },
              {
                title: "Event",
                dataIndex: "event",
                width: 120,
                render: (event: CloseLogLine["event"]) => <Tag color={EVENT_COLOR[event]}>{event}</Tag>,
              },
              {
                title: "When",
                dataIndex: "at",
                width: 150,
                render: (at: string | null) => (at ? stampInTimeZone(at, timeZone) : "—"),
              },
              { title: "By", dataIndex: "by", width: 200, ellipsis: true, render: (by: string | null) => by ?? "—" },
              flexColumn<CloseLogLine>({
                title: "Reason or note",
                key: "reason",
                render: (_: unknown, line: CloseLogLine) => (
                  <span className={styles.muted} title={line.reason ?? ""}>
                    {line.reason ?? "—"}
                  </span>
                ),
              }),
            ]}
          />
          <ReportFoot>
            Every close and every reopen is listed, with the reason given at the time. The books do not keep which close
            checks passed when a month was closed, so this log does not show a count of them.
          </ReportFoot>
        </>
      )}
    />
  );
}
