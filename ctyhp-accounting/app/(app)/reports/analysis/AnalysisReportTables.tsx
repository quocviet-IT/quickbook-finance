"use client";
import { Alert, Card, Space, Tag, Typography } from "antd";
import ReportTable from "@/components/ui/ReportTable";
import type { WhatIfAnalysis } from "@/lib/domain/financial-analysis";
import type { BalanceSheet, ProfitAndLoss, ReportSection } from "@/lib/domain/reports";
import { formatMoney } from "@/lib/format";

/**
 * The three-column rendering — Actual | Adjustment | Adjusted — used by the
 * live workspace and by the frozen-report viewer alike, so a photograph can
 * never look different from the screen it captured.
 */

interface AnalysisRow {
  key: string;
  label: string;
  kind: "section" | "line" | "total";
  actual: number | null;
  adjusted: number | null;
}

/** Union of a section's actual and adjusted lines, actual order first. */
function sectionRows(actual: ReportSection, adjusted: ReportSection): AnalysisRow[] {
  const keyOf = (line: ReportSection["lines"][number]) =>
    line.accountId ?? `${line.accountCode}:${line.name}`;
  const adjustedByKey = new Map(adjusted.lines.map((l) => [keyOf(l), l]));
  const seen = new Set<string>();
  const rows: AnalysisRow[] = [
    { key: `${actual.key}-head`, label: actual.title, kind: "section", actual: null, adjusted: null },
  ];
  for (const line of actual.lines) {
    const k = keyOf(line);
    seen.add(k);
    rows.push({
      key: `${actual.key}-${k}`,
      label: line.accountCode ? `${line.accountCode} — ${line.name}` : line.name,
      kind: "line",
      actual: line.amount,
      adjusted: adjustedByKey.get(k)?.amount ?? 0,
    });
  }
  for (const line of adjusted.lines) {
    const k = keyOf(line);
    if (seen.has(k)) continue;
    rows.push({
      key: `${actual.key}-${k}`,
      label: line.accountCode ? `${line.accountCode} — ${line.name}` : line.name,
      kind: "line",
      actual: 0,
      adjusted: line.amount,
    });
  }
  rows.push({
    key: `${actual.key}-total`,
    label: `Total ${actual.title}`,
    kind: "total",
    actual: actual.total,
    adjusted: adjusted.total,
  });
  return rows;
}

function pnlRows(actual: ProfitAndLoss, adjusted: ProfitAndLoss): AnalysisRow[] {
  return [
    ...sectionRows(actual.income, adjusted.income),
    ...sectionRows(actual.costOfGoodsSold, adjusted.costOfGoodsSold),
    { key: "gross-profit", label: "Gross Profit", kind: "total", actual: actual.grossProfit, adjusted: adjusted.grossProfit },
    ...sectionRows(actual.operatingExpenses, adjusted.operatingExpenses),
    ...sectionRows(actual.otherIncome, adjusted.otherIncome),
    ...sectionRows(actual.otherExpenses, adjusted.otherExpenses),
    { key: "net-income", label: "Net Income", kind: "total", actual: actual.netIncome, adjusted: adjusted.netIncome },
  ];
}

function balanceSheetRows(actual: BalanceSheet, adjusted: BalanceSheet): AnalysisRow[] {
  return [
    ...sectionRows(actual.assets, adjusted.assets),
    ...sectionRows(actual.liabilities, adjusted.liabilities),
    ...sectionRows(actual.equity, adjusted.equity),
    {
      key: "liabilities-and-equity",
      label: "Total Liabilities and Equity",
      kind: "total",
      actual: actual.totalLiabilities + actual.totalEquity,
      adjusted: adjusted.totalLiabilities + adjusted.totalEquity,
    },
  ];
}

export default function AnalysisReportTables({
  analysis,
  baseCurrency,
  baseDecimals,
}: {
  analysis: WhatIfAnalysis;
  baseCurrency: string;
  baseDecimals: number;
}) {
  const money = (minor: number) => formatMoney(minor, baseCurrency, baseDecimals);
  const delta = (row: AnalysisRow) => (row.adjusted ?? 0) - (row.actual ?? 0);

  const cell = (value: number | null, row: AnalysisRow) => {
    if (row.kind === "section" || value === null) return "";
    const text = money(value);
    return row.kind === "total" ? <Typography.Text strong>{text}</Typography.Text> : text;
  };

  const columns = [
    {
      title: "Account",
      dataIndex: "label",
      render: (label: string, row: AnalysisRow) =>
        row.kind === "section" ? (
          <Typography.Text strong>{label}</Typography.Text>
        ) : row.kind === "total" ? (
          <Typography.Text strong>{label}</Typography.Text>
        ) : (
          label
        ),
    },
    {
      title: "Actual",
      dataIndex: "actual",
      align: "right" as const,
      width: 150,
      render: (v: number | null, row: AnalysisRow) => cell(v, row),
    },
    {
      title: "Adjustment",
      key: "delta",
      align: "right" as const,
      width: 150,
      render: (_: unknown, row: AnalysisRow) => {
        if (row.kind === "section") return "";
        const d = delta(row);
        if (d === 0) return <Typography.Text type="secondary">—</Typography.Text>;
        const text = `${d > 0 ? "+" : "−"}${money(Math.abs(d))}`;
        return <Typography.Text type={d > 0 ? "success" : "danger"}>{text}</Typography.Text>;
      },
    },
    {
      title: "Adjusted",
      dataIndex: "adjusted",
      align: "right" as const,
      width: 150,
      render: (v: number | null, row: AnalysisRow) => cell(v, row),
    },
  ];

  const balancedTag = (label: string, balanced: boolean) => (
    <Tag color={balanced ? "green" : "red"}>
      {label} {balanced ? "balanced ✓" : "NOT balanced"}
    </Tag>
  );

  return (
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Alert
        type="warning"
        showIcon
        message="What-if analysis — not the books"
        description="These figures include hypothetical adjustments and never post to the ledger."
      />
      <Card size="small" title="Profit & Loss">
        <ReportTable<AnalysisRow>
          rowKey="key"
          dataSource={pnlRows(analysis.pnl.actual, analysis.pnl.adjusted)}
          columns={columns}
        />
      </Card>
      <Card
        size="small"
        title="Balance Sheet"
        extra={
          <Space>
            {balancedTag("Actual", analysis.balanceSheet.actual.balanced)}
            {balancedTag("Adjusted", analysis.balanceSheet.adjusted.balanced)}
          </Space>
        }
      >
        <ReportTable<AnalysisRow>
          rowKey="key"
          dataSource={balanceSheetRows(analysis.balanceSheet.actual, analysis.balanceSheet.adjusted)}
          columns={columns}
        />
      </Card>
    </Space>
  );
}
