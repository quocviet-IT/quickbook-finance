"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightOutlined,
  BankOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { Card, Tag, Typography } from "antd";
import type {
  DashboardWorkQueue,
  WorkQueueKind,
  WorkQueuePriority,
} from "@/lib/domain/work-queue";

type QueueFilter = "all" | WorkQueueKind;

const FILTERS: Array<{
  key: QueueFilter;
  label: string;
  icon: ReactNode;
}> = [
  { key: "all", label: "All", icon: <ClockCircleOutlined /> },
  { key: "overdue_invoice", label: "Invoices", icon: <FileTextOutlined /> },
  { key: "due_bill", label: "Bills", icon: <DollarOutlined /> },
  { key: "unreconciled_transaction", label: "Banking", icon: <BankOutlined /> },
  { key: "pending_approval", label: "Approvals", icon: <CheckCircleOutlined /> },
];

const KIND_LABEL: Record<WorkQueueKind, string> = {
  overdue_invoice: "Overdue invoice",
  due_bill: "Bill due",
  unreconciled_transaction: "Unreconciled",
  pending_approval: "Pending approval",
};

const PRIORITY_TAG: Record<
  WorkQueuePriority,
  { label: string; color: "red" | "orange" | "default" }
> = {
  critical: { label: "Critical", color: "red" },
  high: { label: "Priority", color: "orange" },
  normal: { label: "Open", color: "default" },
};

function countFor(queue: DashboardWorkQueue, filter: QueueFilter): number {
  if (filter === "all") {
    return Object.values(queue.counts).reduce((sum, count) => sum + count, 0);
  }
  return queue.counts[filter];
}

function fullQueueHref(queue: DashboardWorkQueue, filter: QueueFilter): string | null {
  if (filter === "overdue_invoice") {
    return `/invoices?queue=overdue&asOf=${queue.asOf}`;
  }
  if (filter === "due_bill") {
    return `/bills?queue=due&through=${queue.dueThrough}`;
  }
  if (filter === "unreconciled_transaction") {
    return "/banking?queue=unmatched";
  }
  if (filter === "pending_approval") {
    return "/approvals";
  }
  return null;
}

export default function WorkQueueCard({
  queue,
  formatMoney,
}: {
  queue: DashboardWorkQueue;
  formatMoney: (minor: number) => string;
}) {
  const [filter, setFilter] = useState<QueueFilter>("all");
  const totalCount = countFor(queue, "all");
  const visibleItems = useMemo(
    () =>
      queue.items
        .filter((item) => filter === "all" || item.kind === filter)
        .slice(0, 4),
    [filter, queue.items],
  );
  const fullHref = fullQueueHref(queue, filter);

  return (
    <Card
      className="dashboard-work-queue"
      title={
        <div>
          <Typography.Text strong>Work queue</Typography.Text>
          <Typography.Paragraph
            type="secondary"
            className="financial-chart-card__description"
          >
            Items requiring collection, payment, matching, or authorization.
          </Typography.Paragraph>
        </div>
      }
      extra={
        <Typography.Text type="secondary" className="dashboard-work-queue__total">
          {totalCount.toLocaleString("en-US")} open
        </Typography.Text>
      }
    >
      <div className="dashboard-work-queue__filters" aria-label="Filter work queue">
        {FILTERS.map((item) => {
          const count = countFor(queue, item.key);
          return (
            <button
              type="button"
              key={item.key}
              className={filter === item.key ? "is-active" : ""}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>

      {visibleItems.length === 0 ? (
        <div className="dashboard-work-queue__empty">
          <CheckCircleOutlined aria-hidden="true" />
          <div>
            <Typography.Text strong>This queue is clear</Typography.Text>
            <Typography.Paragraph type="secondary">
              No items currently require follow-up in this category.
            </Typography.Paragraph>
          </div>
        </div>
      ) : (
        <div className="dashboard-work-queue__list" aria-live="polite">
          {visibleItems.map((item) => {
            const tag = PRIORITY_TAG[item.priority];
            return (
              <Link href={item.href} className="dashboard-work-item" key={item.id}>
                <span
                  className={`dashboard-work-item__marker dashboard-work-item__marker--${item.priority}`}
                  aria-hidden="true"
                />
                <span className="dashboard-work-item__main">
                  <span className="dashboard-work-item__title">{item.title}</span>
                  <span className="dashboard-work-item__subtitle">
                    {item.subtitle} · {item.timingLabel}
                  </span>
                </span>
                <span className="dashboard-work-item__amount">
                  {item.amountMinor === 0 ? "—" : formatMoney(item.amountMinor)}
                  <small>
                    {KIND_LABEL[item.kind]} ·{" "}
                    {new Date(`${item.eventDate}T00:00:00.000Z`).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", timeZone: "UTC" },
                    )}
                  </small>
                </span>
                <Tag color={tag.color}>{tag.label}</Tag>
                <ArrowRightOutlined aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}

      {fullHref && countFor(queue, filter) > visibleItems.length ? (
        <div className="dashboard-work-queue__footer">
          <Link href={fullHref}>
            Open full queue <ArrowRightOutlined />
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
