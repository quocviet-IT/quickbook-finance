"use client";

import { useCallback, useState } from "react";
import { Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import ProofLine from "@/components/reports/ProofLine";
import { StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { ageLabel, openDocumentsSheet, type OpenDocumentLine } from "@/lib/domain/open-items";
import { shortDate } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import type { OpenDocumentsResult } from "@/lib/services/party-reports";

const PAGE_SIZE = 50;

/** A short totals block, right-aligned under the list, in the statements' ruled style. */
export const TOTALS_STYLE = { width: "auto", minWidth: 360, marginLeft: "auto", marginTop: 16 } as const;

/**
 * Open Invoices and Unpaid Bills: every invoice (or bill) still open on the
 * as-of date, by customer (or vendor) and due date, then what credits take
 * off, the aging total, and whether it agrees with the control account.
 */
export default function OpenDocumentsReport({
  kind,
  companyName,
  currencyCode,
  decimals,
  today,
  load,
}: {
  kind: "invoice" | "bill";
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<OpenDocumentsResult>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const invoices = kind === "invoice";
  const sheet = useCallback(
    (data: OpenDocumentsResult, when: ReportWhen) =>
      openDocumentsSheet(data.report, kind, { companyName, asOf: when.to, currencyCode, baseDecimals: decimals }),
    [kind, companyName, currencyCode, decimals],
  );

  return (
    <SimpleReport<OpenDocumentsResult>
      companyName={companyName}
      title={invoices ? "Open Invoices" : "Unpaid Bills"}
      currencyCode={currencyCode}
      period={{ kind: "asOf", today }}
      load={load}
      sheet={sheet}
      runningText={invoices ? "Reading the open invoices…" : "Reading the unpaid bills…"}
      render={({ report, control }) => {
        const overdue = report.lines.filter((line) => line.daysPastDue > 0).reduce((sum, line) => sum + line.openMinor, 0);
        return (
          <>
            <StatRow
              items={[
                { label: invoices ? "Open invoices" : "Unpaid bills", value: report.lines.length.toLocaleString("en-US") },
                { label: "Open balance", value: money(report.documentsMinor) },
                { label: "Past due", value: money(overdue), danger: overdue > 0 },
              ]}
            />
            <DataTable<OpenDocumentLine>
              rowKey="key"
              dataSource={report.lines}
              pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
              emptyTitle={invoices ? "No open invoices" : "No unpaid bills"}
              emptyDescription={invoices ? "Every invoice dated by this day is paid." : "Every bill dated by this day is paid."}
              columns={[
                { title: "Date", dataIndex: "docDate", width: COLUMN.DATE + 20, render: (d: string) => shortDate(d) },
                { title: "Num", dataIndex: "docNumber", width: COLUMN.CODE, render: (n: string | null) => <span className={styles.mono}>{n ?? "—"}</span> },
                flexColumn<OpenDocumentLine>({ title: invoices ? "Customer" : "Vendor", dataIndex: "partyName" }),
                { title: "Due", dataIndex: "dueDate", width: COLUMN.DATE + 20, render: (d: string) => shortDate(d) },
                {
                  title: "Age",
                  dataIndex: "daysPastDue",
                  width: COLUMN.STATUS,
                  render: (days: number) => (
                    <Tag color={days <= 0 ? "green" : days > 60 ? "red" : "orange"}>{ageLabel(days)}</Tag>
                  ),
                },
                {
                  title: "Amount",
                  dataIndex: "amountMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (minor: number | null) => (minor === null ? "—" : money(minor)),
                },
                {
                  title: "Open balance",
                  dataIndex: "openMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (minor: number) => money(minor),
                },
              ]}
            />
            <table className={styles.rpt} style={TOTALS_STYLE} aria-label="Totals">
              <tbody>
                <tr>
                  <td>{invoices ? "Total open invoices" : "Total unpaid bills"}</td>
                  <td className={styles.r}>{money(report.documentsMinor)}</td>
                </tr>
                <tr>
                  <td>Credits and unapplied payments</td>
                  <td className={styles.r}>{money(report.creditsMinor)}</td>
                </tr>
                <tr className={styles.rGrand}>
                  <td>{invoices ? "A/R Aging total" : "A/P Aging total"}</td>
                  <td className={styles.r}>{money(report.agingTotalMinor)}</td>
                </tr>
              </tbody>
            </table>
            <ProofLine
              against={invoices ? "the A/R control account" : "the A/P control account"}
              tie={control}
              money={money}
              whenOut={
                invoices
                  ? "An entry posted straight to the receivables account, with no invoice, credit memo or payment behind it, moves the account but not this list. The A/R Aging shows the same gap."
                  : "An entry posted straight to the payables account, with no bill, vendor credit or payment behind it, moves the account but not this list. The A/P Aging shows the same gap."
              }
            />
          </>
        );
      }}
    />
  );
}
