"use client";
import { Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { ComparisonBars, chartColors } from "@/components/charts/FinancialCharts";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { ReportBody } from "@/components/reports/ReportAudience";
import { exportRowsFromMinorAmounts, type ReportExportSheet } from "@/lib/domain/report-export";
import { balanceTrendRows, type BalanceSheet, type BalanceTrendRow } from "@/lib/domain/reports";
import type { TrendColumn } from "@/lib/domain/report-periods";

export interface TrendPeriod extends TrendColumn {
  sheet: BalanceSheet;
}

export default function BalanceSheetTrendView({
  periods,
  money,
  companyName,
  baseCurrency,
  baseDecimals,
}: {
  periods: TrendPeriod[];
  money: (value: number) => string;
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
}) {
  if (periods.length === 0) return null;

  const rows = balanceTrendRows(periods.map((period) => period.sheet));

  const last = periods[periods.length - 1];
  const exportSheet: ReportExportSheet = {
    fileName: `balance-sheet-trend-${last.date}`,
    companyName,
    title: "Balance Sheet Trend",
    subtitle: `${periods[0].label} to ${last.label}`,
    currencyCode: baseCurrency,
    columns: [
      { key: "label", header: "Account", kind: "text" },
      ...periods.map((period) => ({
        key: period.date,
        header: period.label,
        kind: "money" as const,
      })),
    ],
    // row.amounts are integer minor units, same as every other domain value;
    // an export cell is the display edge, exactly where money.ts says the
    // conversion belongs — see exportRowsFromMinorAmounts for why this is a
    // shared function rather than an inline division.
    rows: exportRowsFromMinorAmounts(
      rows,
      periods.map((period) => period.date),
      baseDecimals,
    ),
  };

  return (
    <div className="report-result">
      <div className="report-heading">
        <div>
          <div className="report-result__entity">{companyName}</div>
          <h3>Balance Sheet Trend</h3>
          <p>
            {periods.length} periods, {periods[0].label} to {last.label}
          </p>
        </div>
        <ReportExportButtons sheet={exportSheet} />
      </div>

      <ReportBody
        numbers={
          <>
          <DataTable<BalanceTrendRow>
            rowKey="key"
            dataSource={rows}
            pagination={false}
            scroll={{ x: "max-content" }}
            columns={[
              {
                title: "Account",
                width: 260,
                fixed: "left",
                render: (_: unknown, row) =>
                  row.kind === "section" ? <strong>{row.label}</strong> : row.label,
              },
              ...periods.map((period, index) => ({
                title: period.label,
                width: 130,
                align: "right" as const,
                render: (_: unknown, row: BalanceTrendRow) =>
                  row.kind === "section" ? "" : money(row.amounts[index] ?? 0),
              })),
            ]}
            rowClassName={(row) =>
              row.kind === "section"
                ? "report-table-row--section"
                : row.kind === "total"
                  ? "report-table-row--emphasis"
                  : ""
            }
          />

          <div className="report-balance-status">
            <Tag color={last.sheet.balanced ? "green" : "red"}>
              {last.sheet.balanced ? "Balanced" : "Out of balance"}
            </Tag>
          </div>
          </>
        }
        chart={
          <ComparisonBars
            title="Total assets over the periods shown"
            description="Each bar is the balance sheet total for that period end."
            formatMoney={money}
            data={periods.map((period) => ({
              key: period.date,
              label: period.label,
              value: period.sheet.totalAssets,
              color: chartColors.receivable,
            }))}
          />
        }
      />
    </div>
  );
}
