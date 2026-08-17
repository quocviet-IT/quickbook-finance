"use client";

import type { ReactNode } from "react";
import { Card, Empty, Typography } from "antd";
import { TOKENS } from "@/lib/design/tokens";
import { axisTicks } from "@/lib/domain/chart-axis";
import type {
  AgingSnapshot,
  CashMovementSnapshot,
  MonthlyPerformancePoint,
} from "@/lib/services/dashboard";

const PALETTE = {
  income: TOKENS.series.income,
  expense: TOKENS.series.expense,
  net: TOKENS.series.net,
  receivable: TOKENS.series.receivable,
  payable: TOKENS.series.payable,
  positive: TOKENS.money.positive,
  negative: TOKENS.money.negative,
  neutral: TOKENS.text.secondary,
};

function ChartCard({
  title,
  description,
  extra,
  children,
}: {
  title: string;
  description?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      className="financial-chart-card"
      title={
        <div>
          <Typography.Text strong>{title}</Typography.Text>
          {description && (
            <Typography.Paragraph type="secondary" className="financial-chart-card__description">
              {description}
            </Typography.Paragraph>
          )}
        </div>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
}

function ChartEmpty({ description }: { description: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

export function PerformanceChart({
  data,
  formatCompact,
  periodMonths,
  extra,
}: {
  data: MonthlyPerformancePoint[];
  formatCompact: (value: number) => string;
  periodMonths: number;
  extra?: ReactNode;
}) {
  const width = 720;
  const height = 300;
  const plot = { left: 64, right: 18, top: 22, bottom: 42 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const values = data.flatMap((point) => [
    point.incomeMinor,
    point.expenseMinor,
    point.netIncomeMinor,
  ]);
  const domainMin = Math.min(0, ...values);
  const domainMax = Math.max(1, ...values);
  const domainSpan = Math.max(1, domainMax - domainMin);
  const y = (value: number) => plot.top + ((domainMax - value) / domainSpan) * plotHeight;
  const baselineY = y(0);
  const groupWidth = data.length ? plotWidth / data.length : plotWidth;
  const barWidth = Math.min(26, groupWidth * 0.25);
  const netPoints = data
    .map((point, index) => {
      const center = plot.left + groupWidth * index + groupWidth / 2;
      return `${center},${y(point.netIncomeMinor)}`;
    })
    .join(" ");
  const ticks = axisTicks(domainMax, domainSpan);
  const hasData = values.some((value) => value !== 0);

  return (
    <ChartCard
      title="Income and expense trend"
      description={`${periodMonths}-month ledger view; the current month is month-to-date.`}
      extra={extra}
    >
      {!hasData ? (
        <ChartEmpty description="Post transactions to build the monthly performance trend." />
      ) : (
        <>
          <div className="financial-chart__legend" aria-hidden="true">
            <Legend color={PALETTE.income} label="Income" />
            <Legend color={PALETTE.expense} label="Expenses" />
            <Legend color={PALETTE.net} label="Net income" line />
          </div>
          <div className="financial-chart__scroll">
            <svg
              className="financial-chart"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`Monthly income, expenses, and net income for the last ${periodMonths} months`}
            >
              {ticks.map((tick, tickIndex) => (
                // Rounding can make adjacent ticks collide (see axisTicks),
                // so the key must be the tick's position, not its value.
                <g key={tickIndex}>
                  <line
                    x1={plot.left}
                    x2={width - plot.right}
                    y1={y(tick)}
                    y2={y(tick)}
                    stroke={TOKENS.series.grid}
                    strokeDasharray="4 4"
                  />
                  <text x={plot.left - 10} y={y(tick) + 4} textAnchor="end" className="financial-chart__axis">
                    {formatCompact(tick)}
                  </text>
                </g>
              ))}
              <line
                x1={plot.left}
                x2={width - plot.right}
                y1={baselineY}
                y2={baselineY}
                stroke={TOKENS.series.axis}
              />
              {data.map((point, index) => {
                const center = plot.left + groupWidth * index + groupWidth / 2;
                const incomeY = y(point.incomeMinor);
                const expenseY = y(point.expenseMinor);
                return (
                  <g key={point.key}>
                    <rect
                      x={center - barWidth - 2}
                      y={Math.min(incomeY, baselineY)}
                      width={barWidth}
                      height={Math.max(1, Math.abs(baselineY - incomeY))}
                      rx={4}
                      fill={PALETTE.income}
                    >
                      <title>{`${point.label} income: ${formatCompact(point.incomeMinor)}`}</title>
                    </rect>
                    <rect
                      x={center + 2}
                      y={Math.min(expenseY, baselineY)}
                      width={barWidth}
                      height={Math.max(1, Math.abs(baselineY - expenseY))}
                      rx={4}
                      fill={PALETTE.expense}
                    >
                      <title>{`${point.label} expenses: ${formatCompact(point.expenseMinor)}`}</title>
                    </rect>
                    <text x={center} y={height - 14} textAnchor="middle" className="financial-chart__axis">
                      {point.label}
                    </text>
                  </g>
                );
              })}
              <polyline
                points={netPoints}
                fill="none"
                stroke={PALETTE.net}
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((point, index) => {
                const center = plot.left + groupWidth * index + groupWidth / 2;
                return (
                  <circle
                    key={point.key}
                    cx={center}
                    cy={y(point.netIncomeMinor)}
                    r={4.5}
                    fill={TOKENS.text.onDark}
                    stroke={PALETTE.net}
                    strokeWidth={3}
                  >
                    <title>{`${point.label} net income: ${formatCompact(point.netIncomeMinor)}`}</title>
                  </circle>
                );
              })}
            </svg>
          </div>
          <table className="accounting-sr-only">
            <caption>Monthly income, expenses, and net income</caption>
            <thead>
              <tr><th>Month</th><th>Income</th><th>Expenses</th><th>Net income</th></tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.key}>
                  <th>{point.label}</th>
                  <td>{formatCompact(point.incomeMinor)}</td>
                  <td>{formatCompact(point.expenseMinor)}</td>
                  <td>{formatCompact(point.netIncomeMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </ChartCard>
  );
}

function Legend({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="financial-chart__legend-item">
      <span
        className={line ? "financial-chart__legend-line" : "financial-chart__legend-swatch"}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

const AGING_BUCKETS = [
  ["current", "Current"],
  ["d1_30", "1–30"],
  ["d31_60", "31–60"],
  ["d61_90", "61–90"],
  ["d90_plus", "90+"],
] as const;

export function AgingComparisonChart({
  receivables,
  payables,
  formatMoney,
  extra,
}: {
  receivables?: AgingSnapshot;
  payables?: AgingSnapshot;
  formatMoney: (value: number) => string;
  extra?: ReactNode;
}) {
  const values = AGING_BUCKETS.flatMap(([key]) => [
    receivables?.[key] ?? 0,
    payables?.[key] ?? 0,
  ]);
  const max = Math.max(1, ...values);
  const hasData = values.some((value) => value !== 0);

  return (
    <ChartCard
      title={receivables && payables ? "Receivables vs payables aging" : "Aging distribution"}
      description="Open balances grouped by due-date risk."
      extra={extra}
    >
      {!hasData ? (
        <ChartEmpty description="There are no open balances to age." />
      ) : (
        <div className="aging-chart">
          <div className="financial-chart__legend" aria-hidden="true">
            {receivables && <Legend color={PALETTE.receivable} label="Receivables" />}
            {payables && <Legend color={PALETTE.payable} label="Payables" />}
          </div>
          {AGING_BUCKETS.map(([key, label]) => (
            <div className="aging-chart__row" key={key}>
              <Typography.Text className="aging-chart__label">{label}</Typography.Text>
              <div className="aging-chart__series">
                {receivables && (
                  <AgingBar
                    label={`${label} receivables`}
                    value={receivables[key]}
                    max={max}
                    color={PALETTE.receivable}
                    formatMoney={formatMoney}
                  />
                )}
                {payables && (
                  <AgingBar
                    label={`${label} payables`}
                    value={payables[key]}
                    max={max}
                    color={PALETTE.payable}
                    formatMoney={formatMoney}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

function AgingBar({
  label,
  value,
  max,
  color,
  formatMoney,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  formatMoney: (value: number) => string;
}) {
  return (
    <div className="aging-chart__bar-row" aria-label={`${label}: ${formatMoney(value)}`}>
      <div className="aging-chart__track">
        <div
          className="aging-chart__fill"
          style={{ width: `${Math.max(value ? 2 : 0, (Math.abs(value) / max) * 100)}%`, backgroundColor: color }}
        />
      </div>
      <Typography.Text className="aging-chart__value">{formatMoney(value)}</Typography.Text>
    </div>
  );
}

export function CashFlowBridgeChart({
  cash,
  formatMoney,
  extra,
}: {
  cash: CashMovementSnapshot;
  formatMoney: (value: number) => string;
  extra?: ReactNode;
}) {
  const components = [
    { key: "operating", label: "Operating activities", value: cash.operatingMinor },
    { key: "investing", label: "Investing activities", value: cash.investingMinor },
    { key: "financing", label: "Financing activities", value: cash.financingMinor },
  ];
  const max = Math.max(1, ...components.map((item) => Math.abs(item.value)));

  return (
    <ChartCard
      title="Cash flow bridge"
      description="Month-to-date movement from opening to closing cash."
      extra={extra}
    >
      <div className="cash-flow-balance-strip">
        <div>
          <Typography.Text type="secondary">Opening cash</Typography.Text>
          <Typography.Text strong>{formatMoney(cash.openingMinor)}</Typography.Text>
        </div>
        <div className={cash.netChangeMinor < 0 ? "amount-negative" : "amount-positive"}>
          <span aria-hidden="true">→</span>
          <Typography.Text strong>{formatMoney(cash.netChangeMinor)}</Typography.Text>
          <small>net change</small>
        </div>
        <div>
          <Typography.Text type="secondary">Closing cash</Typography.Text>
          <Typography.Text strong>{formatMoney(cash.closingMinor)}</Typography.Text>
        </div>
      </div>
      <div className="cash-flow-components">
        {components.map((item) => (
          <div className="cash-flow-component" key={item.key}>
            <div className="cash-flow-component__header">
              <Typography.Text>{item.label}</Typography.Text>
              <Typography.Text
                strong
                className={item.value < 0 ? "amount-negative" : "amount-positive"}
              >
                {formatMoney(item.value)}
              </Typography.Text>
            </div>
            <div
              className="cash-flow-component__scale"
              aria-label={`${item.label}: ${formatMoney(item.value)}`}
            >
              <span className="cash-flow-component__axis" />
              <span
                className={`cash-flow-component__bar cash-flow-component__bar--${item.value < 0 ? "negative" : "positive"}`}
                style={{ width: `${(Math.abs(item.value) / max) * 50}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="cash-bridge-summary">
        <Typography.Text type="secondary">
          {cash.tiesOut
            ? "Closing cash agrees with the balance sheet."
            : "Cash flow does not agree with the balance sheet; review required."}
        </Typography.Text>
      </div>
    </ChartCard>
  );
}

export interface ComparisonBarDatum {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export function ComparisonBars({
  title,
  description,
  data,
  formatMoney,
  extra,
}: {
  title: string;
  description?: string;
  data: ComparisonBarDatum[];
  formatMoney: (value: number) => string;
  extra?: ReactNode;
}) {
  const max = Math.max(1, ...data.map((item) => Math.abs(item.value)));
  const hasData = data.some((item) => item.value !== 0);
  return (
    <ChartCard title={title} description={description} extra={extra}>
      {!hasData ? (
        <ChartEmpty description="No values are available for the selected period." />
      ) : (
        <>
          <div
            className="comparison-bars"
            role="img"
            aria-label={`${title}: ${data
              .map((item) => `${item.label} ${formatMoney(item.value)}`)
              .join(", ")}`}
          >
            {data.map((item) => (
              <div className="comparison-bars__row" key={item.key}>
                <div className="comparison-bars__header">
                  <Typography.Text>{item.label}</Typography.Text>
                  <Typography.Text strong>{formatMoney(item.value)}</Typography.Text>
                </div>
                <div className="comparison-bars__track" aria-hidden="true">
                  <div
                    className="comparison-bars__fill"
                    style={{
                      width: `${(Math.abs(item.value) / max) * 100}%`,
                      backgroundColor:
                        item.color ??
                        (item.value < 0 ? PALETTE.negative : PALETTE.positive),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <table className="accounting-sr-only">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th>Category</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.key}>
                  <th>{item.label}</th>
                  <td>{formatMoney(item.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </ChartCard>
  );
}

export const chartColors = PALETTE;
