"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { ReportFoot, SourceTag, reportPaperStyles as paper } from "@/components/reports/ReportPaper";
import SimpleReport, { reportPagination, type SimpleReportPeriod } from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatDate, formatMoney, plural } from "@/lib/format";
import type { ReportWhen } from "@/lib/domain/report-run";
import {
  buildReconciliationReport,
  reconLineDescription,
  reconciliationProof,
  reconciliationReportSheet,
  reconciliationSummaryRows,
  type ReconReportInput,
  type ReconReportLine,
} from "@/lib/domain/reconciliation-report";
import { reconciliationReportAction } from "./actions";
import styles from "./report.module.css";

const PAGE_SIZE = 25;

/** A fact the report rests on, said above the figures: the statement file, how it was brought forward. */
export interface ReportFact {
  key: string;
  text: string;
  link?: { href: string; label: string };
}

/**
 * One bank reconciliation's report, on paper like every other report: the
 * bridge from the statement's closing balance to the books', the four halves'
 * lines, and what it proves in words. Copy, CSV, PDF, Excel and Print come
 * with the paper.
 */
export default function ReconciliationReportClient({
  reconciliationId,
  companyName,
  currencyCode,
  decimals,
  today,
  accountLabel,
  statementDate,
  facts,
}: {
  reconciliationId: string;
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  accountLabel: string;
  statementDate: string;
  facts: ReportFact[];
}) {
  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const period = useMemo<SimpleReportPeriod>(
    () => ({ kind: "none", today, caption: `${accountLabel} · statement of ${formatDate(statementDate)}` }),
    [today, accountLabel, statementDate],
  );
  const load = useCallback((when: ReportWhen) => reconciliationReportAction(reconciliationId, when), [reconciliationId]);
  const sheet = useCallback(
    (input: ReconReportInput) =>
      reconciliationReportSheet(buildReconciliationReport(input), input, {
        companyName,
        accountLabel,
        currencyCode,
        baseDecimals: decimals,
      }),
    [companyName, accountLabel, currencyCode, decimals],
  );

  return (
    <SimpleReport<ReconReportInput>
      companyName={companyName}
      title="Reconciliation Report"
      currencyCode={currencyCode}
      period={period}
      load={load}
      sheet={sheet}
      runningText="Reading the reconciliation…"
      render={(input, _when, { printing }) => {
        const report = buildReconciliationReport(input);
        const proof = reconciliationProof(report, input, money);
        const verdictClass = !input.completed ? undefined : report.provesOut ? styles.verdictGood : styles.verdictBad;
        return (
          <>
            {facts.length > 0 ? (
              <ul className={styles.facts}>
                {facts.map((fact) => (
                  <li key={fact.key}>
                    {fact.text}
                    {fact.link ? (
                      <>
                        {" · "}
                        <Link href={fact.link.href}>{fact.link.label}</Link>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <table className={styles.summary} aria-label="From the statement to the books">
              <tbody>
                {reconciliationSummaryRows(report, input).map((row) => (
                  <tr
                    key={row.key}
                    className={[
                      row.kind === "total" ? styles.total : "",
                      row.kind === "warning" ? styles.warning : "",
                      row.gapBefore ? styles.gap : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                  >
                    <td className={row.indent ? styles.indent : undefined}>{row.label}</td>
                    <td>{money(row.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {report.sections.map((section) => (
              <div key={section.key} className={paper.section}>
                <div className={paper.sectionHead}>
                  <strong className={paper.sectionTitle}>{section.title}</strong>
                  <span className={paper.sectionNote}>
                    {plural(section.lines.length, "item")}
                    {section.note ? ` · ${section.note}` : ""}
                  </span>
                  <strong>{money(section.totalMinor)}</strong>
                </div>
                {section.lines.length === 0 ? (
                  <div className={paper.muted}>None.</div>
                ) : (
                  <div className={paper.det}>
                    <DataTable<ReconReportLine>
                      rowKey="journalLineId"
                      size="small"
                      dataSource={section.lines}
                      pagination={reportPagination(
                        printing,
                        pageSizes[section.key] ?? PAGE_SIZE,
                        (size) => setPageSizes((was) => ({ ...was, [section.key]: size })),
                        PAGE_SIZE,
                      )}
                      emptyTitle="None"
                      columns={[
                        { title: "Date", dataIndex: "entryDate", width: COLUMN.DATE, render: (d: string) => formatDate(d) },
                        {
                          title: "Entry",
                          key: "entry",
                          width: COLUMN.CODE + 60,
                          render: (_: unknown, line: ReconReportLine) => (
                            <SourceTag sourceType={line.sourceType} number={line.entryNumber} />
                          ),
                        },
                        { title: "Reference", dataIndex: "reference", width: COLUMN.CODE, render: (r: string | null) => r ?? "—" },
                        flexColumn<ReconReportLine>({
                          title: "Description",
                          key: "description",
                          render: (_: unknown, line: ReconReportLine) => reconLineDescription(line) || "—",
                        }),
                        {
                          title: "Amount",
                          key: "amount",
                          align: "right",
                          width: COLUMN.MONEY,
                          render: (_: unknown, line: ReconReportLine) => (
                            <span className={line.signedMinor < 0 ? paper.negative : undefined}>{money(line.signedMinor)}</span>
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </div>
            ))}

            <ReportFoot>
              <strong className={verdictClass}>{proof.headline}</strong> {proof.detail}
            </ReportFoot>
          </>
        );
      }}
    />
  );
}
