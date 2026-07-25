"use client";

import Link from "next/link";
import { Card, Col, Row, Statistic, Table, Tag, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import type { BudgetVsActual } from "@/lib/domain/reports";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import { fromMinor } from "@/lib/domain/money";

function percent(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export default function BudgetVsActualView({
  report,
  fiscalYear,
  from,
  to,
  companyName,
  baseCurrency,
  baseDecimals,
  money,
}: {
  report: BudgetVsActual;
  fiscalYear: number;
  from: string;
  to: string;
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  money: (value: number) => string;
}) {
  const actualIncome = report.actual.income.total + report.actual.otherIncome.total;
  const budgetIncome = report.budget.income.total + report.budget.otherIncome.total;
  const actualExpenses =
    report.actual.costOfGoodsSold.total +
    report.actual.operatingExpenses.total +
    report.actual.otherExpenses.total;
  const major = (value: number) => fromMinor(value, baseDecimals);
  const exportSheet: ReportExportSheet = {
    fileName: `budget-vs-actual-fy-${fiscalYear}-${from}-${to}`,
    companyName,
    title: "Budget vs Actual",
    subtitle: `FY ${fiscalYear} · ${from} to ${to}`,
    currencyCode: baseCurrency,
    columns: [
      { key: "account", header: "Account", width: 36 },
      { key: "actual", header: "Actual", kind: "money", width: 18 },
      { key: "budget", header: "Budget", kind: "money", width: 18 },
      { key: "variance", header: "Variance", kind: "money", width: 18 },
      { key: "variancePercent", header: "Variance %", kind: "percent", width: 14 },
      { key: "assessment", header: "Assessment", width: 16 },
    ],
    rows: report.lines.map((line) => ({
      account: `${line.accountCode} — ${line.name}`,
      actual: major(line.current),
      budget: major(line.prior),
      variance: major(line.variance),
      variancePercent: line.variancePercent,
      assessment: line.favorable === null ? "On budget" : line.favorable ? "Favorable" : "Unfavorable",
    })),
  };

  return (
    <div className="report-result">
      <div className="report-result__heading">
        <div>
          <Typography.Title level={4}>Budget vs Actual</Typography.Title>
          <Typography.Text type="secondary">FY {fiscalYear} · {from} to {to}</Typography.Text>
        </div>
        <ReportExportButtons sheet={exportSheet} disabled={report.lines.length === 0} />
      </div>
      <Row gutter={[12, 12]} className="report-summary-grid">
        <Col xs={24} sm={12} xl={6}><Card><Statistic title="Actual income" value={money(actualIncome)} /></Card></Col>
        <Col xs={24} sm={12} xl={6}><Card><Statistic title="Budget income" value={money(budgetIncome)} /></Card></Col>
        <Col xs={24} sm={12} xl={6}><Card><Statistic title="Actual expenses" value={money(actualExpenses)} /></Card></Col>
        <Col xs={24} sm={12} xl={6}><Card><Statistic title="Net income variance" value={money(report.actual.netIncome - report.budget.netIncome)} /></Card></Col>
      </Row>
      <DataTable
        rowKey={(row) => row.accountId ?? row.accountCode}
        dataSource={report.lines}
        pagination={false}
        emptyTitle="No budget or actual activity"
        emptyDescription="Enter a monthly budget or post ledger activity for the selected period."
        columns={[
          {
            title: "Account",
            fixed: "left",
            width: 260,
            render: (_, row) => (
              <Link href={`/reports/general-ledger?account=${row.accountId}&from=${from}&to=${to}`}>
                {row.accountCode} — {row.name}
              </Link>
            ),
          },
          { title: "Actual", width: 150, align: "right", render: (_, row) => money(row.current) },
          { title: "Budget", width: 150, align: "right", render: (_, row) => money(row.prior) },
          { title: "Variance", width: 150, align: "right", render: (_, row) => money(row.variance) },
          { title: "Variance %", width: 110, align: "right", render: (_, row) => percent(row.variancePercent) },
          {
            title: "Assessment",
            width: 130,
            render: (_, row) =>
              row.favorable === null ? (
                <Tag>On budget</Tag>
              ) : row.favorable ? (
                <Tag color="green">Favorable</Tag>
              ) : (
                <Tag color="red">Unfavorable</Tag>
              ),
          },
        ]}
        summary={() => (
          <Table.Summary.Row className="report-summary-row">
            <Table.Summary.Cell index={0}>Net income</Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">{money(report.actual.netIncome)}</Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">{money(report.budget.netIncome)}</Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">{money(report.actual.netIncome - report.budget.netIncome)}</Table.Summary.Cell>
            <Table.Summary.Cell index={4} />
            <Table.Summary.Cell index={5} />
          </Table.Summary.Row>
        )}
      />
    </div>
  );
}
