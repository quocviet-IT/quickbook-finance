"use client";
import Link from "next/link";
import { Button, Card, Segmented, Tag } from "antd";
import { ArrowRightOutlined, MoreOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  PriorityQueueItem,
  QueueSeverity,
  SectionEnvelope,
} from "@/lib/domain/accounting-dashboard/types";
import { matchesFilter, type QueueFilter } from "@/lib/domain/accounting-dashboard/lifecycle";
import type { Assignee } from "./WorkItemActions";

/**
 * Loaded when a row is on screen, not when the page is.
 *
 * The menu carries a date picker, a person picker and three dialogs — the
 * heaviest thing on this route by some way, and used on a fraction of page
 * loads. The same reasoning that put the secondary analysis behind a dynamic
 * import in Phase 1: the queue must not pay for what most readers never open.
 */
const WorkItemActions = dynamic(() => import("./WorkItemActions"), {
  loading: () => <Button size="small" icon={<MoreOutlined />} disabled aria-hidden="true" />,
});
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

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "overdue", label: "Overdue" },
  { value: "critical", label: "Critical" },
  { value: "reconciliation", label: "Reconciliation" },
  { value: "approvals", label: "Approvals" },
  { value: "period_close", label: "Period close" },
  { value: "dismissed", label: "Dismissed" },
];

/** The design document's answer to a queue that grows: limit the first view. */
const FIRST_VIEW = 8;

export default function PriorityWorkQueue({
  queue,
  controlsEvaluated,
  viewerId,
  canManage,
  assignees,
  today,
}: {
  queue: SectionEnvelope<PriorityQueueItem[]>;
  /** True when the controls actually ran, so an empty queue can be believed. */
  controlsEvaluated: boolean;
  /** Who is looking, so "Mine" can mean somebody. */
  viewerId: string | null;
  /** A viewer reads the queue and changes nothing. */
  canManage: boolean;
  assignees: Assignee[];
  /** The company's own today, not the browser's. */
  today: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [showAll, setShowAll] = useState(false);

  const matching = useMemo(
    () => (queue.data ?? []).filter((item) => matchesFilter(item, filter, viewerId, today)),
    [queue.data, filter, viewerId, today],
  );
  const visible = showAll ? matching : matching.slice(0, FIRST_VIEW);
  const hidden = matching.length - visible.length;

  return (
    <Card
      size="small"
      title="Priority work"
      className="accounting-priority-queue"
    >
      {queue.data ? (
        <div className={styles.queueFilters}>
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
        </div>
      ) : null}
      {queue.dataState === "unavailable" || !queue.data ? (
        <UnavailableNote
          reason={queue.unavailableReason ?? "The work queue could not be loaded."}
        />
      ) : matching.length === 0 ? (
        <HealthyEmpty
          title={filter === "all" ? "Nothing needs attention" : "Nothing matches this filter"}
          evidence={
            filter !== "all"
              ? filter === "mine"
                ? "Nothing is assigned to you. Pick something up from All."
                : "Clear the filter to see the rest of the queue."
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
                    {/* `new` renders as nothing: it is the absence of a
                        decision, and a tag saying so would be noise on most
                        of the queue most of the time. */}
                    {item.lifecycle === "acknowledged" ? <Tag color="blue">acknowledged</Tag> : null}
                    {item.lifecycle === "in_progress" ? <Tag color="cyan">in progress</Tag> : null}
                    {item.lifecycle === "dismissed" ? (
                      <Tag title={item.dismissReason ?? undefined}>dismissed</Tag>
                    ) : null}
                  </span>
                  <span className={styles.queueReason}>{item.reason}</span>
                </div>
                <span className={styles.queueOwner}>
                  {item.ownerName ?? (
                    <span className={styles.queueReason}>Unassigned</span>
                  )}
                  {item.dueDate ? (
                    <span
                      className={
                        item.dueDate < today ? styles.queueDueLate : styles.queueReason
                      }
                    >
                      due {item.dueDate}
                    </span>
                  ) : null}
                </span>
                <span className={styles.queueAmount}>
                  {item.amountText ?? "—"}
                </span>
                <Link href={item.href} className={styles.queueAction}>
                  <Button size="small" type="primary" ghost>
                    {item.actionLabel} <ArrowRightOutlined aria-hidden="true" />
                  </Button>
                </Link>
                {canManage ? (
                  <span className={styles.queueAction}>
                    <WorkItemActions
                      item={item}
                      assignees={assignees}
                      onChanged={() => router.refresh()}
                    />
                  </span>
                ) : null}
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
