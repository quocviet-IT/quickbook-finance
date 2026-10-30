"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { CLOSE_STEP_ICON, CLOSE_STEP_LABEL } from "@/components/accounting-dashboard/close-step-status";
import { checklistCell, closeLogSheet, type CloseLogLine, type CloseLogReport } from "@/lib/domain/close-log";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { formatDateTime } from "@/lib/format";

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
            expandable={{
              // A close that kept its checklist opens to it, step by step, as the closing screen showed it.
              rowExpandable: (line) => Boolean(line.checklist),
              expandedRowRender: (line) => (
                <ul className={styles.checklist}>
                  {(line.checklist ?? []).map((step) => (
                    <li key={step.key}>
                      <span className={styles.checklistStatus}>
                        {CLOSE_STEP_ICON[step.status]} {CLOSE_STEP_LABEL[step.status]}
                      </span>
                      <span>
                        <strong>{step.title}</strong>
                        {step.evidence ? <span className={styles.muted}> · {step.evidence}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ),
            }}
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
                render: (at: string | null) => (at ? formatDateTime(at, timeZone) : "—"),
              },
              { title: "By", dataIndex: "by", width: 200, ellipsis: true, render: (by: string | null) => by ?? "—" },
              flexColumn<CloseLogLine>({
                title: "Reason or note",
                key: "reason",
                // A close's checklist, in one line under its reason: a column of its own
                // pushed the reason off the page.
                render: (_: unknown, line: CloseLogLine) => {
                  const checklist = checklistCell(line);
                  return (
                    <>
                      <span className={styles.muted} title={line.reason ?? ""}>
                        {line.reason ?? "—"}
                      </span>
                      {checklist ? (
                        <div style={{ fontSize: 12 }} className={line.checklist ? undefined : styles.muted}>
                          Checklist at close: {checklist}
                        </div>
                      ) : null}
                    </>
                  );
                },
              }),
            ]}
          />
          <ReportFoot>
            Every close and every reopen is listed, with the reason given at the time. Since 2.84 a close also keeps the
            month-end checklist as it stood when the month was closed: open the line to see each check and what it found. A
            close from before then kept none.
          </ReportFoot>
        </>
      )}
    />
  );
}
