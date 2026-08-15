"use client";
import { Tooltip } from "antd";
import DataTable from "@/components/ui/DataTable";
import { ComparisonBars, chartColors } from "@/components/charts/FinancialCharts";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { ReportBody } from "@/components/reports/ReportAudience";
import { formatPercent } from "@/lib/format";
import { fromMinor } from "@/lib/domain/money";
import type { ReportExportSheet } from "@/lib/domain/report-export";
import type { RangeColumn } from "@/lib/domain/report-periods";
import {
  percentOfIncome,
  pnlTrendRows,
  sumProfitAndLoss,
  type PnlTrendRow,
  type ProfitAndLoss,
} from "@/lib/domain/reports";

export interface PnlTrendPeriod extends RangeColumn {
  pnl: ProfitAndLoss;
}

/**
 * Same wording wherever the % of Income header appears — on screen and, one
 * day, wherever an export gets a chance to carry it. QuickBooks' Total Income
 * excludes Other Income, and this matches that, but a column headed only
 * "% of Income" does not say so on its own.
 */
const PERCENT_TOOLTIP = "Percentage of Total Income for this column — Other Income is not included.";

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
  // Appending the sum as one more "period" is what lines the Total column up
  // account-for-account with the rest of the table for free: pnlTrendRows
  // already matches lines across periods by account, and sumProfitAndLoss's
  // lines carry the same account codes, so the Total simply falls into place
  // as the last column instead of needing its own lookup.
  const total = sumProfitAndLoss(pnls);
  const rows = pnlTrendRows([...pnls, total]);
  const incomeTotals = [...pnls.map((pnl) => pnl.income.total), total.income.total];
  const columnLabels = [...periods.map((period) => period.label), "Total"];

  const percentText = (amount: number, income: number): string => {
    const pct = percentOfIncome(amount, income);
    return pct === null ? "—" : formatPercent(pct);
  };

  const last = periods[periods.length - 1];
  const exportSheet: ReportExportSheet = {
    fileName: `profit-and-loss-by-period-${last.to}`,
    companyName,
    title: "Profit and Loss by Period",
    subtitle: `${periods[0].label} to ${last.label}`,
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
    rows: rows.map((row) => ({
      label: row.label,
      ...Object.fromEntries(
        columnLabels.flatMap((_, index) => {
          const amount = row.kind === "section" ? null : (row.amounts[index] ?? 0);
          const entries: [string, string | number | null][] = [
            [`amount-${index}`, amount === null ? null : fromMinor(amount, baseDecimals)],
          ];
          if (showPercentOfIncome) {
            entries.push([
              `percent-${index}`,
              amount === null ? null : percentOfIncome(amount, incomeTotals[index]),
            ]);
          }
          return entries;
        }),
      ),
    })),
  };

  return (
    <div className="report-result">
      <div className="report-heading">
        <div>
          <div className="report-result__entity">{companyName}</div>
          <h3>Profit and Loss by Period</h3>
          <p>
            {periods.length} periods, {periods[0].label} to {last.label}
          </p>
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
                const isTotal = index === columnLabels.length - 1;
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
                    <Tooltip title={PERCENT_TOOLTIP}>
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
