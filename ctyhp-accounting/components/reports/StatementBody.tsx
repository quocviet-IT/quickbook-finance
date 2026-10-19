"use client";

import { useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { ReportFoot, StatRow } from "@/components/reports/ReportPaper";
import { reportPagination } from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatDate, formatMoney } from "@/lib/format";
import { humanizeStatus } from "@/lib/domain/status-label";
import type { StatementReport, StatementRow } from "@/lib/services/aging";

const PAGE_SIZE = 50;

/** What a statement's load hands the screen: who it is for, and the lines. */
export interface PartyStatement {
  partyName: string;
  report: StatementReport;
}

/**
 * The body of the Customer and Vendor Statements: the party, the opening and
 * closing balance, and every document between them with its running balance.
 */
export default function StatementBody({
  kind,
  data,
  currencyCode,
  decimals,
  printing,
}: {
  kind: "customer" | "vendor";
  data: PartyStatement;
  currencyCode: string;
  decimals: number;
  printing: boolean;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = (minor: number) => formatMoney(minor, currencyCode, decimals);
  const customer = kind === "customer";
  return (
    <>
      <StatRow
        items={[
          { label: customer ? "Customer" : "Vendor", value: data.partyName },
          { label: "Opening balance", value: money(data.report.openingMinor) },
          { label: "Closing balance", value: money(data.report.closingMinor) },
        ]}
      />
      <DataTable<StatementRow>
        rowKey={(r) => `${r.docType}-${r.docNumber}-${r.txnDate}`}
        dataSource={data.report.rows}
        pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
        emptyTitle="No statement activity"
        emptyDescription={`No ${kind} transactions were found for this date range.`}
        columns={[
          { title: "Date", dataIndex: "txnDate", width: COLUMN.DATE, render: (v: string) => formatDate(v) },
          { title: "Type", dataIndex: "docType", render: (v: string) => humanizeStatus(v) },
          { title: "Number", dataIndex: "docNumber", width: COLUMN.CODE },
          { title: "Amount", align: "right", width: COLUMN.MONEY, render: (_: unknown, r: StatementRow) => money(r.amountMinor) },
          { title: "Running", align: "right", width: COLUMN.MONEY_WIDE, render: (_: unknown, r: StatementRow) => money(r.runningMinor) },
        ]}
      />
      <ReportFoot>
        <strong>How it reads.</strong> The opening balance reflects current open items dated before the period; historical
        point-in-time statements are a later enhancement.
      </ReportFoot>
    </>
  );
}
