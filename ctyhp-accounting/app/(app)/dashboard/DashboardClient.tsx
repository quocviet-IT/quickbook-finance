"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  AuditOutlined,
  BankOutlined,
  CheckCircleOutlined,
  DollarOutlined,
  FileTextOutlined,
  FilterOutlined,
  InboxOutlined,
  RiseOutlined,
  ShopOutlined,
  SwapOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Card, Segmented, Tag, Timeline, Typography } from "antd";
import PageHeader from "@/components/PageHeader";
import WorkQueueCard from "@/components/dashboard/WorkQueueCard";
import {
  AgingComparisonChart,
  CashFlowBridgeChart,
  ComparisonBars,
  PerformanceChart,
} from "@/components/charts/FinancialCharts";
import { fromMinor } from "@/lib/domain/money";
import { INTERNAL_REPORT_HREFS } from "@/lib/domain/report-catalog";
import type {
  DashboardActivity,
  DashboardActivityCategory,
  DashboardAnalytics,
  InventoryDashboardSnapshot,
  OperatingPulse,
} from "@/lib/services/dashboard";

interface DashboardClientProps {
  analytics: DashboardAnalytics;
  baseCurrency: string;
  baseDecimals: number;
  accountingBasis: string;
  timeZone: string;
}

type TrendTone = "positive" | "negative" | "neutral";
type DashboardRange = 3 | 6 | 12;

export default function DashboardClient({
  analytics,
  baseCurrency,
  baseDecimals,
  accountingBasis,
  timeZone,
}: DashboardClientProps) {
  const [range, setRange] = useState<DashboardRange>(6);
  const { metrics, periodComparison, cashMovement, inventory, operatingPulse } = analytics;
  const formatMoney = (minor: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: baseCurrency,
      minimumFractionDigits: baseDecimals,
      maximumFractionDigits: baseDecimals,
    }).format(fromMinor(minor, baseDecimals));
  const formatCompact = (minor: number) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(fromMinor(minor, baseDecimals));
  const formatPercent = (value: number | null, suffix = "%") =>
    value === null
      ? "No prior baseline"
      : `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
  const formatInteger = (value: number) =>
    new Intl.NumberFormat("en-US").format(value);
  const visiblePerformance = analytics.monthlyPerformance.slice(-range);
  const activityFrom = visiblePerformance[0]?.key ?? analytics.asOf.slice(0, 7);
  const visibleActivity = analytics.recentActivity.filter(
    (activity) => activity.occurredAt.slice(0, 7) >= activityFrom,
  );

  return (
    <div className="management-dashboard">
      <PageHeader
        title="Financial command center"
        description="Profitability, liquidity, working capital, inventory, exceptions, and accounting activity in one operational view."
        meta={
          <div className="dashboard-context">
            <Tag>As of {analytics.asOf}</Tag>
            <Tag>{accountingBasis === "cash" ? "Cash basis" : "Accrual basis"}</Tag>
            <Tag>{baseCurrency}</Tag>
            <Tag>{timeZone}</Tag>
          </div>
        }
      />

      <section className="dashboard-filter-bar" aria-label="Dashboard analysis filters">
        <div className="dashboard-filter-bar__summary">
          <span className="dashboard-filter-bar__icon" aria-hidden="true">
            <FilterOutlined />
          </span>
          <span>
            <strong>Analysis window</strong>
            <small>
              Trends and activity use the selected period. Balance and aging
              figures remain as of {analytics.asOf}.
            </small>
          </span>
        </div>
        <label className="dashboard-filter-bar__control">
          <span>Trend period</span>
          <Segmented
            aria-label="Dashboard trend period"
            options={[
              { label: "3M", value: 3 },
              { label: "6M", value: 6 },
              { label: "12M", value: 12 },
            ]}
            value={range}
            onChange={(value) => setRange(value as DashboardRange)}
          />
        </label>
        <span className="accounting-sr-only" aria-live="polite">
          Dashboard trends now show {range} months.
        </span>
      </section>

      <section aria-labelledby="executive-overview-title">
        <div className="dashboard-section-heading">
          <div>
            <Typography.Title level={4} id="executive-overview-title">
              Executive overview
            </Typography.Title>
            <Typography.Text type="secondary">
              Month to date compared with the same number of days in{" "}
              {periodComparison.priorLabel}.
            </Typography.Text>
          </div>
          <Link href="/reports" className="dashboard-section-link">
            Open reports <ArrowRightOutlined />
          </Link>
        </div>

        <div className="dashboard-overview-grid">
          <SummaryMetric
            title="Cash position"
            value={formatMoney(metrics.cashMinor)}
            href="/reports/cash-flow"
            icon={<BankOutlined />}
            tone={cashMovement.netChangeMinor >= 0 ? "positive" : "negative"}
            trend={formatMoney(cashMovement.netChangeMinor)}
            trendLabel="net movement this month"
            featured
          />
          <SummaryMetric
            title="Revenue"
            value={formatMoney(periodComparison.current.revenueMinor)}
            href={INTERNAL_REPORT_HREFS.pnl}
            icon={<RiseOutlined />}
            tone={trendTone(periodComparison.revenueChangePercent)}
            trend={formatPercent(periodComparison.revenueChangePercent)}
            trendLabel={`vs ${periodComparison.priorLabel}`}
          />
          <SummaryMetric
            title="Net income"
            value={formatMoney(periodComparison.current.netIncomeMinor)}
            href={INTERNAL_REPORT_HREFS.pnl}
            icon={<DollarOutlined />}
            tone={periodComparison.netIncomeChangeMinor >= 0 ? "positive" : "negative"}
            trend={`${periodComparison.netIncomeChangeMinor > 0 ? "+" : ""}${formatMoney(periodComparison.netIncomeChangeMinor)}`}
            trendLabel={`vs ${periodComparison.priorLabel}`}
          />
          <SummaryMetric
            title="Gross margin"
            value={
              periodComparison.current.grossMarginPercent === null
                ? "n/a"
                : `${periodComparison.current.grossMarginPercent.toFixed(1)}%`
            }
            href={INTERNAL_REPORT_HREFS.pnl}
            icon={<RiseOutlined />}
            tone={trendTone(periodComparison.grossMarginChangePoints)}
            trend={formatPercent(periodComparison.grossMarginChangePoints, " pts")}
            trendLabel="margin change"
          />
          <SummaryMetric
            title="Working capital"
            value={formatMoney(metrics.workingCapitalMinor)}
            href={INTERNAL_REPORT_HREFS.balance}
            icon={<SwapOutlined />}
            tone={
              metrics.currentRatio === null
                ? "neutral"
                : metrics.currentRatio >= 1
                  ? "positive"
                  : "negative"
            }
            trend={metrics.currentRatio === null ? "n/a" : `${metrics.currentRatio.toFixed(2)}x`}
            trendLabel="current ratio"
          />
          <SummaryMetric
            title="Inventory value"
            value={formatMoney(inventory.valueMinor)}
            href="/reports/inventory-valuation"
            icon={<ShopOutlined />}
            tone={inventory.tiesOut ? "positive" : "negative"}
            trend={`${formatInteger(inventory.itemCount)} items / ${formatInteger(inventory.quantity)} units`}
            trendLabel={inventory.tiesOut ? "subledger balanced" : "tie-out required"}
          />
        </div>
      </section>

      <div className="dashboard-layout dashboard-layout--performance">
        <PerformanceChart
          data={visiblePerformance}
          formatCompact={formatCompact}
          periodMonths={range}
          extra={
            <Link href={INTERNAL_REPORT_HREFS.pnl}>
              Profit and loss <ArrowRightOutlined />
            </Link>
          }
        />
        <WorkQueueCard queue={analytics.workQueue} formatMoney={formatMoney} />
      </div>

      <div className="dashboard-layout dashboard-layout--cash">
        <CashFlowBridgeChart
          cash={cashMovement}
          formatMoney={formatMoney}
          extra={
            <Link href="/reports/cash-flow">
              Cash flow report <ArrowRightOutlined />
            </Link>
          }
        />
        <OperatingPulsePanel
          pulse={operatingPulse}
          formatMoney={formatMoney}
          formatInteger={formatInteger}
        />
      </div>

      <div className="dashboard-layout dashboard-layout--operations">
        <AgingComparisonChart
          receivables={metrics.arAging}
          payables={metrics.apAging}
          formatMoney={formatMoney}
          extra={
            <Link href="/reports/ar-aging">
              Review aging <ArrowRightOutlined />
            </Link>
          }
        />
        <InventoryPanel inventory={inventory} formatMoney={formatMoney} />
      </div>

      <section aria-labelledby="financial-diagnostics-title">
        <div className="dashboard-section-heading">
          <div>
            <Typography.Title level={4} id="financial-diagnostics-title">
              Financial diagnostics
            </Typography.Title>
            <Typography.Text type="secondary">
              Snapshot views of short-term liquidity and balances that require
              operational attention.
            </Typography.Text>
          </div>
        </div>
        <div className="dashboard-layout dashboard-layout--analysis">
          <ComparisonBars
            title="Liquidity structure"
            description={`Current balance-sheet position as of ${analytics.asOf}.`}
            data={[
              {
                key: "current-assets",
                label: "Current assets",
                value: metrics.currentAssetsMinor,
                color: "#0f766e",
              },
              {
                key: "current-liabilities",
                label: "Current liabilities",
                value: metrics.currentLiabilitiesMinor,
                color: "#c2410c",
              },
              {
                key: "working-capital",
                label: "Working capital",
                value: metrics.workingCapitalMinor,
                color: "#1d4ed8",
              },
            ]}
            formatMoney={formatMoney}
            extra={
              <Link href={INTERNAL_REPORT_HREFS.balance}>
                Balance sheet <ArrowRightOutlined />
              </Link>
            }
          />
          <ComparisonBars
            title="Exception exposure"
            description="Open monetary exposure requiring collection, payment, or bank review."
            data={[
              {
                key: "overdue-receivables",
                label: "Overdue receivables",
                value: metrics.overdueArMinor,
                color: "#b91c1c",
              },
              {
                key: "overdue-payables",
                label: "Overdue payables",
                value: metrics.overdueApMinor,
                color: "#b45309",
              },
              {
                key: "unreconciled-bank",
                label: "Unreconciled bank activity",
                value: metrics.unreconciledMinor,
                color: "#7c3aed",
              },
            ]}
            formatMoney={formatMoney}
            extra={
              <Link href="/banking">
                Review banking <ArrowRightOutlined />
              </Link>
            }
          />
        </div>
      </section>

      <ActivityTimeline activities={visibleActivity} timeZone={timeZone} />

      <div className="dashboard-data-lineage">
        <AuditOutlined aria-hidden="true" />
        <span>
          Figures are calculated from posted ledger entries and connected operational
          records. Exception links and charts drill into the same underlying
          transactions.
        </span>
      </div>
    </div>
  );
}

function trendTone(value: number | null): TrendTone {
  if (value === null || Math.abs(value) < 0.05) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function SummaryMetric({
  title,
  value,
  href,
  icon,
  tone,
  trend,
  trendLabel,
  featured = false,
}: {
  title: string;
  value: string;
  href: string;
  icon: ReactNode;
  tone: TrendTone;
  trend: string;
  trendLabel: string;
  featured?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`dashboard-summary${featured ? " dashboard-summary--featured" : ""}`}
    >
      <div className="dashboard-summary__header">
        <Typography.Text>{title}</Typography.Text>
        <span className="dashboard-summary__icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="dashboard-summary__value">{value}</div>
      <div className={`dashboard-trend dashboard-trend--${tone}`}>
        {tone === "positive" ? (
          <ArrowUpOutlined />
        ) : tone === "negative" ? (
          <ArrowDownOutlined />
        ) : (
          <span className="dashboard-trend__dash">—</span>
        )}
        <strong>{trend}</strong>
        <span>{trendLabel}</span>
      </div>
    </Link>
  );
}

function OperatingPulsePanel({
  pulse,
  formatMoney,
  formatInteger,
}: {
  pulse: OperatingPulse;
  formatMoney: (value: number) => string;
  formatInteger: (value: number) => string;
}) {
  const rows = [
    {
      key: "invoices",
      label: "Customer invoices",
      count: pulse.invoices.count,
      value: formatMoney(pulse.invoices.amountMinor),
      href: "/invoices",
      icon: <FileTextOutlined />,
    },
    {
      key: "payments",
      label: "Cash received",
      count: pulse.customerPayments.count,
      value: formatMoney(pulse.customerPayments.amountMinor),
      href: "/payments",
      icon: <DollarOutlined />,
    },
    {
      key: "bills",
      label: "Vendor bills",
      count: pulse.bills.count,
      value: formatMoney(pulse.bills.amountMinor),
      href: "/bills",
      icon: <ShopOutlined />,
    },
    {
      key: "receipts",
      label: "Goods receipts",
      count: pulse.goodsReceipts.count,
      value: `${formatInteger(pulse.goodsReceipts.count)} posted`,
      href: "/purchase-orders",
      icon: <InboxOutlined />,
    },
  ];

  return (
    <Card
      className="dashboard-pulse-card"
      title="Operating pulse"
      extra={<Typography.Text type="secondary">This month</Typography.Text>}
    >
      <div className="dashboard-pulse-list">
        {rows.map((row) => (
          <Link href={row.href} className="dashboard-pulse-row" key={row.key}>
            <span className="dashboard-pulse-row__icon" aria-hidden="true">
              {row.icon}
            </span>
            <span className="dashboard-pulse-row__body">
              <span>{row.label}</span>
              <small>{formatInteger(row.count)} transactions</small>
            </span>
            <strong>{row.value}</strong>
            <ArrowRightOutlined aria-hidden="true" />
          </Link>
        ))}
      </div>
      <div className="dashboard-pulse-note">
        <SwapOutlined aria-hidden="true" />
        Sales, collections, purchasing, and receiving remain linked to their source
        records.
      </div>
    </Card>
  );
}

function InventoryPanel({
  inventory,
  formatMoney,
}: {
  inventory: InventoryDashboardSnapshot;
  formatMoney: (value: number) => string;
}) {
  return (
    <Card
      className="dashboard-inventory-card"
      title="Jewelry inventory exposure"
      extra={
        <Link href="/reports/inventory-valuation">
          Valuation <ArrowRightOutlined />
        </Link>
      }
    >
      <div className="dashboard-inventory-summary">
        <div>
          <span>Total value</span>
          <strong>{formatMoney(inventory.valueMinor)}</strong>
        </div>
        <div>
          <span>Slow-moving</span>
          <strong className={inventory.slowMovingCount > 0 ? "amount-warning" : ""}>
            {formatMoney(inventory.slowMovingValueMinor)}
          </strong>
        </div>
      </div>
      {inventory.topHoldings.length === 0 ? (
        <div className="dashboard-panel-empty">
          <InboxOutlined />
          <Typography.Text type="secondary">
            No inventory holdings are available.
          </Typography.Text>
        </div>
      ) : (
        <div className="inventory-holdings">
          {inventory.topHoldings.map((holding) => (
            <Link href="/items" className="inventory-holding" key={holding.itemId}>
              <div className="inventory-holding__header">
                <span>
                  <strong>{holding.code ?? "No code"}</strong>
                  <small>{holding.name}</small>
                </span>
                <span>
                  <strong>{formatMoney(holding.valueMinor)}</strong>
                  <small>{holding.quantity.toLocaleString("en-US")} units</small>
                </span>
              </div>
              <div
                className="inventory-holding__track"
                aria-label={`${holding.name}: ${holding.sharePercent.toFixed(1)}% of inventory value`}
              >
                <span
                  style={{
                    width: `${Math.min(100, Math.max(1, holding.sharePercent))}%`,
                  }}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
      <div className="dashboard-inventory-status">
        <span className={inventory.tiesOut ? "amount-positive" : "amount-negative"}>
          {inventory.tiesOut ? <CheckCircleOutlined /> : <WarningOutlined />}
          {inventory.tiesOut
            ? "Subledger agrees with general ledger"
            : "Ledger tie-out required"}
        </span>
        <Link href="/items">{inventory.zeroStockCount} out of stock</Link>
      </div>
    </Card>
  );
}

const ACTIVITY_FILTERS: Array<{
  key: "all" | DashboardActivityCategory;
  label: string;
}> = [
  { key: "all", label: "All activity" },
  { key: "sales", label: "Sales" },
  { key: "purchases", label: "Purchases" },
  { key: "inventory", label: "Inventory" },
  { key: "banking", label: "Banking" },
  { key: "close", label: "Close" },
  { key: "governance", label: "Controls" },
];

const ACTIVITY_COLORS: Record<DashboardActivityCategory, string> = {
  sales: "#0f766e",
  purchases: "#7c3aed",
  inventory: "#0369a1",
  banking: "#1d4ed8",
  close: "#c2410c",
  governance: "#475569",
  other: "#94a3b8",
};

function ActivityTimeline({
  activities,
  timeZone,
}: {
  activities: DashboardActivity[];
  timeZone: string;
}) {
  const [filter, setFilter] = useState<"all" | DashboardActivityCategory>("all");
  const counts = useMemo(
    () =>
      activities.reduce<Partial<Record<DashboardActivityCategory, number>>>(
        (acc, item) => {
          acc[item.category] = (acc[item.category] ?? 0) + 1;
          return acc;
        },
        {},
      ),
    [activities],
  );
  const visibleActivities = useMemo(
    () =>
      activities
        .filter((activity) => filter === "all" || activity.category === filter)
        .slice(0, 12),
    [activities, filter],
  );
  const availableFilters = ACTIVITY_FILTERS.filter(
    (item) => item.key === "all" || (counts[item.key] ?? 0) > 0,
  );

  return (
    <Card
      className="dashboard-activity-card dashboard-activity-card--wide"
      title={
        <div>
          <Typography.Text strong>Accounting activity timeline</Typography.Text>
          <Typography.Paragraph
            type="secondary"
            className="financial-chart-card__description"
          >
            Trace operational events through their accounting and control records.
          </Typography.Paragraph>
        </div>
      }
      extra={
        <Link href="/settings/audit">
          Full audit log <ArrowRightOutlined />
        </Link>
      }
    >
      <div className="dashboard-timeline-filters" aria-label="Filter accounting activity">
        {availableFilters.map((item) => (
          <button
            type="button"
            key={item.key}
            className={filter === item.key ? "is-active" : ""}
            aria-pressed={filter === item.key}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
            <span>{item.key === "all" ? activities.length : counts[item.key] ?? 0}</span>
          </button>
        ))}
      </div>
      {visibleActivities.length === 0 ? (
        <div className="dashboard-panel-empty">
          <AuditOutlined />
          <Typography.Text type="secondary">
            No recent audit activity is available for this category or role.
          </Typography.Text>
        </div>
      ) : (
        <Timeline
          items={visibleActivities.map((activity) => ({
            color: ACTIVITY_COLORS[activity.category],
            content: (
              <div className="dashboard-activity">
                <Link href={activity.href} className="dashboard-activity__title">
                  {activity.verb} {activity.entity.toLowerCase()}
                  {activity.reference ? ` ${activity.reference}` : ""}
                </Link>
                <Typography.Text type="secondary" className="dashboard-activity__meta">
                  {activity.actor} ·{" "}
                  {new Date(activity.occurredAt).toLocaleString("en-US", {
                    timeZone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </Typography.Text>
              </div>
            ),
          }))}
        />
      )}
    </Card>
  );
}
