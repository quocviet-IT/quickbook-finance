"use client";
import Link from "next/link";
import { Button, Card, Segmented, Tag } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import type {
  PriorityQueueItem,
  QueueSeverity,
  SectionEnvelope,
} from "@/lib/domain/accounting-dashboard/types";
import { formatMoney } from "@/lib/format";
import styles from "./accounting-dashboard.module.css";
import { FreshnessNote, HealthyEmpty, UnavailableNote } from "./DataStateNote";

/**
 * The work, first on the page.
 *
 * Every row answers what the design document asks a queue item to answer:
 * what it is, why it is here and how long it has been here, what it is worth,
 * and the one action that resolves it. Age lives in the reason line rather
 * than a column of its own — "190 days overdue" is the same fact twice.
 *
 * Rendered as rows rather than through DataTable, and that is a decision
 * rather than an oversight. A work queue is a list of things to do, not a
 * data grid: nothing here sorts, pages, or selects a row, and `/dashboard`'s
 * own work queue has always rendered as rows for the same reason. It also
 * keeps the table engine off a route that never loaded one — measured at 48KB
 * gzip, which is more than this whole redesign is allowed to add.
 *
 * Owner and lifecycle arrive in Phase 2, when there is somewhere to persist
 * them.
 */

const SEVERITY_TAG: Record<QueueSeverity, { color: string; label: string }> = {
  critical: { color: "red", label: "Critical" },
  high: { color: "orange", label: "High" },
  medium: { color: "blue", label: "Medium" },
  low: { color: "default", label: "Low" },
};

type QueueFilter = "all" | "critical" | "controls" | "reconciliation" | "approvals";

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "controls", label: "Controls" },
  { value: "reconciliation", label: "Reconciliation" },
  { value: "approvals", label: "Approvals" },
];

/** The design document's answer to a queue that grows: limit the first view. */
const FIRST_VIEW = 8;

function matches(item: PriorityQueueItem, filter: QueueFilter): boolean {
  switch (filter) {
    case "critical":
      return item.severity === "critical";
    case "controls":
      return item.sourceKind === "control-failure" || item.sourceKind === "overdue-period";
    case "reconciliation":
      return item.sourceKind === "unmatched-bank";
    case "approvals":
      return item.sourceKind === "pending-approval";
    default:
      return true;
  }
}

export default function PriorityWorkQueue({
  queue,
  currencyCode,
  currencyDecimals,
  controlsEvaluated,
}: {
  queue: SectionEnvelope<PriorityQueueItem[]>;
  currencyCode: string;
  currencyDecimals: number;
  /** True when the controls actually ran, so an empty queue can be believed. */
  controlsEvaluated: boolean;
}) {
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [showAll, setShowAll] = useState(false);

  const matching = useMemo(
    () => (queue.data ?? []).filter((item) => matches(item, filter)),
    [queue.data, filter],
  );
  const visible = showAll ? matching : matching.slice(0, FIRST_VIEW);
  const hidden = matching.length - visible.length;

  return (
    <Card
      size="small"
      title="Priority work"
      className="accounting-priority-queue"
      extra={
        queue.data ? (
          <Segmented
            size="small"
            value={filter}
            onChange={(value) => {
              setFilter(value as QueueFilter);
              setShowAll(false);
            }}
            options={FILTERS}
            aria-label="Filter the work queue"
          />
        ) : null
      }
    >
      {queue.dataState === "unavailable" || !queue.data ? (
        <UnavailableNote
          reason={queue.unavailableReason ?? "The work queue could not be loaded."}
        />
      ) : matching.length === 0 ? (
        <HealthyEmpty
          title={filter === "all" ? "Nothing needs attention" : "Nothing matches this filter"}
          evidence={
            filter !== "all"
              ? "Clear the filter to see the rest of the queue."
              : controlsEvaluated
                ? "Every accounting control passed and no document, bank line, or approval is waiting."
                : "No document, bank line, or approval is waiting — but the accounting controls could not be evaluated, so this is not a clean bill of health."
          }
        />
      ) : (
        <>
          <ul className={styles.queueList}>
            {visible.map((item) => (
              <li key={item.key} className={styles.queueRow}>
                <Tag color={SEVERITY_TAG[item.severity].color} className={styles.queueSeverity}>
                  {SEVERITY_TAG[item.severity].label}
                </Tag>
                <div className={styles.queueTitleCell}>
                  <span className={styles.queueTitleLine}>
                    <span className={styles.queueTitle}>{item.title}</span>
                    {item.blocksClose ? (
                      <Tag color="red" title="A period cannot be closed while this stands.">
                        blocks close
                      </Tag>
                    ) : null}
                  </span>
                  <span className={styles.queueReason}>{item.reason}</span>
                </div>
                <span className={styles.queueAmount}>
                  {item.amountMinor === undefined
                    ? "—"
                    : formatMoney(item.amountMinor, currencyCode, currencyDecimals)}
                </span>
                <Link href={item.href} className={styles.queueAction}>
                  <Button size="small" type="primary" ghost>
                    {item.actionLabel} <ArrowRightOutlined aria-hidden="true" />
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <Button type="link" size="small" onClick={() => setShowAll(true)}>
              Show {hidden} more
            </Button>
          ) : null}
        </>
      )}
      {queue.data ? (
        <FreshnessNote generatedAt={queue.generatedAt} dataState={queue.dataState} />
      ) : null}
    </Card>
  );
}
