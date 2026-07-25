"use client";

import Link from "next/link";
import { Tag, Typography } from "antd";
import { ComparisonBars, chartColors } from "@/components/charts/FinancialCharts";
import DataTable from "@/components/ui/DataTable";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import type { StatementOfEquity } from "@/lib/domain/reports";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import { fromMinor } from "@/lib/domain/money";

export default function StatementOfEquityView({
  report,
  from,
  to,
  companyName,
  baseCurrency,
  baseDecimals,
  money,
}: {
  report: StatementOfEquity;
  from: string;
  to: string;
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  money: (value: number) => string;
}) {
  const exportSheet: ReportExportSheet = {
    fileName: `statement-of-equity-${from}-${to}`,
    companyName,
    title: "Statement of Equity",
    subtitle: `${from} to ${to}`,
    currencyCode: baseCurrency,
    columns: [
      { key: "movement", header: "Equity movement", width: 42 },
      { key: "amount", header: "Amount", kind: "money", width: 20 },
    ],
    rows: report.lines.map((line) => ({
      movement: line.label,
      amount: fromMinor(line.amount, baseDecimals),
    })),
  };

  return (
    <div className="report-result">
      <div className="report-result__heading">
        <div>
          <Typography.Title level={4}>Statement of Equity</Typography.Title>
          <Typography.Text type="secondary">{from} to {to}</Typography.Text>
        </div>
        <ReportExportButtons sheet={exportSheet} />
      </div>
      <div className="report-visual-layout">
        <ComparisonBars
          title="Equity movement"
          description="Beginning equity plus direct equity activity and net income equals ending equity."
          formatMoney={money}
          data={[
            { key: "opening", label: "Beginning equity", value: report.openingEquity, color: chartColors.neutral },
            { key: "activity", label: "Direct equity activity", value: report.equityActivity, color: chartColors.payable },
            { key: "income", label: "Net income", value: report.netIncome, color: report.netIncome < 0 ? chartColors.negative : chartColors.income },
            { key: "closing", label: "Ending equity", value: report.closingEquity, color: chartColors.net },
          ]}
        />
        <DataTable
          rowKey="key"
          dataSource={report.lines}
          pagination={false}
          columns={[
            {
              title: "Equity movement",
              render: (_, row) =>
                row.accountId ? (
                  <Link href={`/reports/general-ledger?account=${row.accountId}&from=${from}&to=${to}`}>
                    {row.label}
                  </Link>
                ) : (
                  row.label
                ),
            },
            {
              title: "Classification",
              width: 130,
              render: (_, row) => {
                const labels = {
                  opening: "Beginning",
                  activity: "Equity activity",
                  income: "Earnings",
                  closing: "Ending",
                };
                return <Tag>{labels[row.kind]}</Tag>;
              },
            },
            { title: "Amount", width: 170, align: "right", render: (_, row) => money(row.amount) },
          ]}
          rowClassName={(row) => row.kind === "closing" ? "report-table-row--emphasis" : ""}
        />
      </div>
    </div>
  );
}
