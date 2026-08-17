"use client";
import { Tooltip } from "antd";
import DataTable from "@/components/ui/DataTable";
import { ComparisonBars, chartColors } from "@/components/charts/FinancialCharts";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { ReportBody } from "@/components/reports/ReportAudience";
import { formatPercent } from "@/lib/format";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import { trendPeriodHeading, trendPeriodRangeText, type RangeColumn } from "@/lib/domain/report-periods";
import {
  percentOfIncome,
  PERCENT_OF_INCOME_TOOLTIP,
  pnlTrendColumns,
  pnlTrendExportRows,
  type PnlTrendRow,
  type ProfitAndLoss,
} from "@/lib/domain/reports";

export interface PnlTrendPeriod extends RangeColumn {
  pnl: ProfitAndLoss;
}

export default function PnlTrendView({
  periods,
  showPercentOfIncome,
  money,
  companyName,
  baseCurrency,
  baseDecimals,
}: {
  periods: PnlTrendPeriod[];
  showPercentOfIncome: boolean;
  money: (value: number) => string;
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
}) {
  if (periods.length === 0) return null;

  const pnls = periods.map((period) => period.pnl);
  const labels = periods.map((period) => period.label);
  // pnlTrendColumns is the one place that decides whether a Total column
  // exists (only once there is more than one period to sum) — the table, the
  // export sheet, and the heading below all read that decision from here
  // rather than each guarding it separately.
  const { hasTotal, columnLabels, rows, incomeTotals } = pnlTrendColumns(pnls, labels);

  const percentText = (amount: number, income: number): string => {
    const pct = percentOfIncome(amount, income);
    return pct === null ? "—" : formatPercent(pct);
  };

  const last = periods[periods.length - 1];
  const exportSheet: ReportExportSheet = {
    fileName: `profit-and-loss-by-period-${last.to}`,
    companyName,
    title: "Profit and Loss by Period",
    subtitle: trendPeriodRangeText(labels),
    currencyCode: baseCurrency,
    columns: [
      { key: "label", header: "Account", kind: "text" },
      ...columnLabels.flatMap((label, index) => [
        { key: `amount-${index}`, header: label, kind: "money" as const },
        ...(showPercentOfIncome
          ? [{ key: `percent-${index}`, header: "% of Income", kind: "percent" as const }]
          : []),
      ]),
    ],
    // Money is routed through the shared minor-to-major seam, not divided
    // inline — see pnlTrendExportRows for why that matters right next to a
    // percent column that must *not* go through the same conversion.
    rows: pnlTrendExportRows(rows, columnLabels.length, baseDecimals, incomeTotals, showPercentOfIncome),
  };

  return (
    <div className="report-result">
      <div className="report-heading">
        <div>
          <div className="report-result__entity">{companyName}</div>
          <h3>Profit and Loss by Period</h3>
          <p>{trendPeriodHeading(labels)}</p>
        </div>
        <ReportExportButtons sheet={exportSheet} />
      </div>

      <ReportBody
        numbers={
          <DataTable<PnlTrendRow>
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
              ...columnLabels.flatMap((label, index) => {
                const isTotal = hasTotal && index === columnLabels.length - 1;
                const moneyColumn = {
                  title: isTotal ? <strong>Total</strong> : label,
                  width: 130,
                  align: "right" as const,
                  render: (_: unknown, row: PnlTrendRow) => {
                    if (row.kind === "section") return "";
                    const text = money(row.amounts[index] ?? 0);
                    return isTotal ? <strong>{text}</strong> : text;
                  },
                };
                if (!showPercentOfIncome) return [moneyColumn];
                const percentColumn = {
                  title: (
                    <Tooltip title={PERCENT_OF_INCOME_TOOLTIP}>
                      <span>{isTotal ? "Total %" : "% of Income"}</span>
                    </Tooltip>
                  ),
                  width: 100,
                  align: "right" as const,
                  render: (_: unknown, row: PnlTrendRow) =>
                    row.kind === "section" ? "" : percentText(row.amounts[index] ?? 0, incomeTotals[index]),
                };
                return [moneyColumn, percentColumn];
              }),
            ]}
            rowClassName={(row) =>
              row.kind === "section"
                ? "report-table-row--section"
                : row.kind === "total"
                  ? "report-table-row--emphasis"
                  : ""
            }
          />
        }
        chart={
          <ComparisonBars
            title="Net income by period"
            description="Net income for each column shown, oldest to newest."
            formatMoney={money}
            data={periods.map((period, index) => ({
              key: period.to,
              label: period.label,
              value: pnls[index].netIncome,
              color: pnls[index].netIncome < 0 ? chartColors.negative : chartColors.net,
            }))}
          />
        }
      />
    </div>
  );
}
