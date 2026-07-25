"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightOutlined,
  BankOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  FileTextOutlined,
  RiseOutlined,
} from "@ant-design/icons";
import { Alert, Card, Col, Row, Space, Tag, Timeline, Typography } from "antd";
import PageHeader from "@/components/PageHeader";
import {
  AgeingComparisonChart,
  PerformanceChart,
} from "@/components/charts/FinancialCharts";
import { fromMinor } from "@/lib/domain/money";
import type {
  DashboardActivity,
  DashboardAnalytics,
} from "@/lib/services/dashboard";

interface DashboardClientProps {
  analytics: DashboardAnalytics;
  baseCurrency: string;
  baseDecimals: number;
  accountingBasis: string;
  timeZone: string;
}

interface ActionItem {
  key: string;
  title: string;
  detail: string;
  count: number;
  href: string;
  priority: "high" | "medium" | "normal";
  icon: ReactNode;
}

export default function DashboardClient({
  analytics,
  baseCurrency,
  baseDecimals,
  accountingBasis,
  timeZone,
}: DashboardClientProps) {
  const { metrics } = analytics;
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

  const actions: ActionItem[] = [
    {
      key: "approvals",
      title: "Pending approvals",
      detail: "Review transactions waiting for authorization.",
      count: metrics.pendingApprovals,
      href: "/approvals",
      priority: "high",
      icon: <CheckCircleOutlined />,
    },
    {
      key: "periods",
      title: "Periods past close date",
      detail: "Close or review accounting periods that remain open.",
      count: metrics.openPastPeriods,
      href: "/settings/periods",
      priority: "high",
      icon: <CalendarOutlined />,
    },
    {
      key: "bank",
      title: "Unreconciled bank items",
      detail: `${formatMoney(metrics.unreconciledMinor)} needs matching or review.`,
      count: metrics.unreconciledCount,
      href: "/banking/reconcile",
      priority: "medium",
      icon: <BankOutlined />,
    },
    {
      key: "receivables",
      title: "Overdue customer balances",
      detail: `${formatMoney(metrics.overdueArMinor)} is past due.`,
      count: metrics.overdueArCount,
      href: "/reports/ar-ageing",
      priority: "medium",
      icon: <ClockCircleOutlined />,
    },
    {
      key: "payables",
      title: "Overdue vendor balances",
      detail: `${formatMoney(metrics.overdueApMinor)} requires payment planning.`,
      count: metrics.overdueApCount,
      href: "/reports/ap-ageing",
      priority: "normal",
      icon: <DollarOutlined />,
    },
  ];

  return (
    <div className="management-dashboard">
      <PageHeader
        title="Management Dashboard"
        description="A connected view of profitability, cash, receivables, payables, close tasks, and accounting activity."
        meta={
          <Space size={[6, 6]} wrap>
            <Tag>As of {analytics.asOf}</Tag>
            <Tag>{accountingBasis === "cash" ? "Cash basis" : "Accrual basis"}</Tag>
            <Tag>{baseCurrency}</Tag>
            <Tag>{timeZone}</Tag>
          </Space>
        }
      />

      <Row gutter={[16, 16]} className="management-dashboard__kpis">
        <KpiCard
          title="Cash position"
          value={formatMoney(metrics.cashMinor)}
          context="Posted bank-account balance"
          href="/reports/cash-flow"
          icon={<BankOutlined />}
          tone="neutral"
        />
        <KpiCard
          title="Net income this month"
          value={formatMoney(metrics.mtdNetIncomeMinor)}
          context={metrics.mtdNetIncomeMinor >= 0 ? "Profitable month to date" : "Loss month to date"}
          href="/reports"
          icon={<RiseOutlined />}
          tone={metrics.mtdNetIncomeMinor >= 0 ? "positive" : "danger"}
        />
        <KpiCard
          title="Overdue receivables"
          value={formatMoney(metrics.overdueArMinor)}
          context={`${metrics.overdueArCount} open ${metrics.overdueArCount === 1 ? "document" : "documents"}`}
          href="/reports/ar-ageing"
          icon={<ClockCircleOutlined />}
          tone={metrics.overdueArMinor > 0 ? "warning" : "positive"}
        />
        <KpiCard
          title="Overdue payables"
          value={formatMoney(metrics.overdueApMinor)}
          context={`${metrics.overdueApCount} open ${metrics.overdueApCount === 1 ? "document" : "documents"}`}
          href="/reports/ap-ageing"
          icon={<FileTextOutlined />}
          tone={metrics.overdueApMinor > 0 ? "warning" : "positive"}
        />
      </Row>

      <Row gutter={[16, 16]} className="management-dashboard__section">
        <Col xs={24} xl={16}>
          <PerformanceChart
            data={analytics.monthlyPerformance}
            formatCompact={formatCompact}
            extra={<Link href="/reports">View reports <ArrowRightOutlined /></Link>}
          />
        </Col>
        <Col xs={24} xl={8}>
          <ActionCenter actions={actions} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="management-dashboard__section">
        <Col xs={24} xl={14}>
          <AgeingComparisonChart
            receivables={metrics.arAgeing}
            payables={metrics.apAgeing}
            formatMoney={formatMoney}
            extra={<Link href="/reports/ar-ageing">Review ageing <ArrowRightOutlined /></Link>}
          />
        </Col>
        <Col xs={24} xl={10}>
          <ActivityTimeline activities={analytics.recentActivity} timeZone={timeZone} />
        </Col>
      </Row>

      <Alert
        className="management-dashboard__lineage"
        type="info"
        showIcon
        message="Connected accounting data"
        description="KPIs and charts are calculated from posted ledger entries, open customer and vendor documents, bank reconciliation records, approval requests, accounting periods, and the audit log. Report links use the same underlying records for drill-down."
      />
    </div>
  );
}

function KpiCard({
  title,
  value,
  context,
  href,
  icon,
  tone,
}: {
  title: string;
  value: string;
  context: string;
  href: string;
  icon: ReactNode;
  tone: "positive" | "warning" | "danger" | "neutral";
}) {
  return (
    <Col xs={24} sm={12} xl={6}>
      <Link href={href} className="dashboard-kpi-link">
        <Card className={`dashboard-kpi dashboard-kpi--${tone}`} hoverable>
          <div className="dashboard-kpi__header">
            <Typography.Text type="secondary">{title}</Typography.Text>
            <span className="dashboard-kpi__icon" aria-hidden="true">{icon}</span>
          </div>
          <Typography.Title level={3} className="dashboard-kpi__value">{value}</Typography.Title>
          <Typography.Text type="secondary" className="dashboard-kpi__context">
            {context}
          </Typography.Text>
        </Card>
      </Link>
    </Col>
  );
}

function ActionCenter({ actions }: { actions: ActionItem[] }) {
  const active = actions
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      const rank = { high: 3, medium: 2, normal: 1 };
      return rank[b.priority] - rank[a.priority] || b.count - a.count;
    });

  return (
    <Card
      className="dashboard-action-card"
      title="Action center"
      extra={<Typography.Text type="secondary">{active.length} areas</Typography.Text>}
    >
      {active.length === 0 ? (
        <div className="dashboard-action-card__clear">
          <CheckCircleOutlined />
          <div>
            <Typography.Text strong>No immediate exceptions</Typography.Text>
            <Typography.Paragraph type="secondary">
              Approval, close, banking, and ageing queues are clear.
            </Typography.Paragraph>
          </div>
        </div>
      ) : (
        <div className="dashboard-action-list">
          {active.map((item) => (
            <Link href={item.href} className="dashboard-action" key={item.key}>
              <span className={`dashboard-action__icon dashboard-action__icon--${item.priority}`} aria-hidden="true">
                {item.icon}
              </span>
              <span className="dashboard-action__body">
                <span className="dashboard-action__title">{item.title}</span>
                <span className="dashboard-action__detail">{item.detail}</span>
              </span>
              <Tag color={item.priority === "high" ? "red" : item.priority === "medium" ? "orange" : "default"}>
                {item.count}
              </Tag>
              <ArrowRightOutlined aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function ActivityTimeline({
  activities,
  timeZone,
}: {
  activities: DashboardActivity[];
  timeZone: string;
}) {
  return (
    <Card
      className="dashboard-activity-card"
      title="Recent accounting activity"
      extra={<Link href="/settings/audit">Audit log <ArrowRightOutlined /></Link>}
    >
      {activities.length === 0 ? (
        <Typography.Text type="secondary">
          No recent audit activity is available for your role.
        </Typography.Text>
      ) : (
        <Timeline
          items={activities.map((activity) => ({
            color: "blue",
            children: (
              <div className="dashboard-activity">
                <Link href={activity.href} className="dashboard-activity__title">
                  {activity.verb} {activity.entity.toLowerCase()}
                  {activity.reference ? ` ${activity.reference}` : ""}
                </Link>
                <Typography.Text type="secondary" className="dashboard-activity__meta">
                  {activity.actor} · {new Date(activity.occurredAt).toLocaleString("en-US", {
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
