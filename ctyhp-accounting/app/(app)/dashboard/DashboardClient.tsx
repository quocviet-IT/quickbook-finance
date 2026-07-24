"use client";
import Link from "next/link";
import { Card, Col, Row, Statistic } from "antd";
import PageHeader from "@/components/PageHeader";
import { fromMinor } from "@/lib/domain/money";
import type { DashboardMetrics } from "@/lib/services/dashboard";

export default function DashboardClient({ metrics, baseCurrency, baseDecimals }: { metrics: DashboardMetrics; baseCurrency: string; baseDecimals: number }) {
  const fmt = (m: number) => `${fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals })} ${baseCurrency}`;
  const cards: { title: string; value: string; href: string }[] = [
    { title: "Cash position", value: fmt(metrics.cashMinor), href: "/reports/cash-flow" },
    { title: "Overdue receivables", value: fmt(metrics.overdueArMinor), href: "/reports/ar-ageing" },
    { title: "Overdue payables", value: fmt(metrics.overdueApMinor), href: "/reports/ap-ageing" },
    { title: "Unreconciled bank items", value: `${metrics.unreconciledCount} · ${fmt(metrics.unreconciledMinor)}`, href: "/banking/reconcile" },
    { title: "Open periods past end date", value: String(metrics.openPastPeriods), href: "/settings/periods" },
    { title: "Net income (this month)", value: fmt(metrics.mtdNetIncomeMinor), href: "/reports" },
  ];
  return (
    <div>
      <PageHeader title="Dashboard" description="Actionable exceptions across receivables, payables, cash, and close." />
      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col xs={24} sm={12} md={8} key={c.title}>
            <Link href={c.href}>
              <Card hoverable><Statistic title={c.title} value={c.value} /></Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
