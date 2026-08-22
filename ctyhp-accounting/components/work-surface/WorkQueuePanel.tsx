"use client";
import Link from "next/link";
import { Button, Card, Segmented, Tag } from "antd";
import { ArrowRightOutlined, MoreOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { SectionEnvelope, Severity, SurfaceWorkItem } from "@/lib/domain/work-surface/types";
import {
  matchesFilter,
  surfaceFilters,
  type KindFilter,
  type SurfaceNouns,
} from "@/lib/domain/work-surface/lifecycle";
import type { Assignee, ChangeAction } from "./WorkItemActions";
import styles from "./work-surface.module.css";
import { FreshnessNote, HealthyEmpty, UnavailableNote } from "./DataStateNote";

/**
 * Loaded when a row is on screen, not when the page is.
 *
 * The menu carries a date picker, a person picker and three dialogs — the
 * heaviest thing on these routes by some way, and used on a fraction of page
 * loads. A queue must not pay for what most readers never open.
 */
const WorkItemActions = dynamic(() => import("./WorkItemActions"), {
  loading: () => <Button size="small" icon={<MoreOutlined />} disabled aria-hidden="true" />,
});

/**
 * The work, first on the page — on every page that has work.
 *
 * Every row answers what the design document asks a queue item to answer: what
 * it is, why it is here and how long it has been here, what it is worth, and the
 * one action that resolves it. Age lives in the reason line rather than a column
 * of its own — "190 days overdue" is the same fact twice.
 *
 * Rendered as rows rather than through DataTable, and that is a decision rather
 * than an oversight. A work queue is a list of things to do, not a data grid:
 * nothing here sorts, pages, or selects a row. It also keeps the table engine
 * off routes that never loaded one — measured at 48KB gzip.
 *
 * **What this panel does not know**: what kind of work it is showing. The
 * filters, the labels, the empty-state evidence and the blocking noun all come
 * from the surface, because they are the only part that differs.
 */

const SEVERITY_TAG: Record<Severity, { color: string; label: string }> = {
  critical: { color: "red", label: "Critical" },
  high: { color: "orange", label: "High" },
  medium: { color: "blue", label: "Medium" },
  low: { color: "default", label: "Low" },
};

/** The design document's answer to a queue that grows: limit the first view. */
const FIRST_VIEW = 8;

export interface QueueEmptyState {
  title: string;
  /** What was actually checked. "Nothing to do" is believable only with this. */
  evidence: string;
}

export default function WorkQueuePanel({
  queue,
  title,
  kindFilters = [],
  viewerId,
  canManage,
  assignees,
  today,
  changeAction,
  nouns = {},
  blockingTag,
  emptyState,
  filteredEmptyEvidence = "Clear the filter to see the rest of the queue.",
  unavailableFallback = "The work queue could not be loaded.",
  className,
}: {
  queue: SectionEnvelope<readonly SurfaceWorkItem[]>;
  title: string;
  /** This surface's own filters, on top of the universal ones. */
  kindFilters?: readonly KindFilter[];
  /** Who is looking, so "Mine" can mean somebody. */
  viewerId: string | null;
  /** A viewer reads the queue and changes nothing. */
  canManage: boolean;
  assignees: Assignee[];
  /** The company's own today, not the browser's. */
  today: string;
  changeAction: ChangeAction;
  nouns?: SurfaceNouns;
  /** The tag on a blocking row — "blocks close", "blocks reconciliation". */
  blockingTag?: { label: string; title: string };
  emptyState: QueueEmptyState;
  filteredEmptyEvidence?: string;
  unavailableFallback?: string;
  className?: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);

  const filters = useMemo(() => surfaceFilters(kindFilters), [kindFilters]);
  const matching = useMemo(
    () =>
      (queue.data ?? []).filter((item) =>
        matchesFilter(item, filter, { viewerId, today, kindFilters }),
      ),
    [queue.data, filter, viewerId, today, kindFilters],
  );
  const visible = showAll ? matching : matching.slice(0, FIRST_VIEW);
  const hidden = matching.length - visible.length;

  return (
    <Card size="small" title={title} className={className}>
      {queue.data ? (
        <div className={styles.queueFilters}>
          <Segmented
            size="small"
            value={filter}
            onChange={(value) => {
              setFilter(String(value));
              setShowAll(false);
            }}
            options={filters.map(({ id, label }) => ({ value: id, label }))}
            aria-label="Filter the work queue"
          />
        </div>
      ) : null}
      {queue.dataState === "unavailable" || !queue.data ? (
        <UnavailableNote reason={queue.unavailableReason ?? unavailableFallback} />
      ) : matching.length === 0 ? (
        <HealthyEmpty
          title={filter === "all" ? emptyState.title : "Nothing matches this filter"}
          evidence={
            filter === "all"
              ? emptyState.evidence
              : filter === "mine"
                ? "Nothing is assigned to you. Pick something up from All."
                : filteredEmptyEvidence
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
                    {item.blocking && blockingTag ? (
                      <Tag color="red" title={blockingTag.title}>
                        {blockingTag.label}
                      </Tag>
                    ) : null}
                    {/* `new` renders as nothing: it is the absence of a
                        decision, and a tag saying so would be noise on most of
                        the queue most of the time. */}
                    {item.lifecycle === "acknowledged" ? <Tag color="blue">acknowledged</Tag> : null}
                    {item.lifecycle === "in_progress" ? <Tag color="cyan">in progress</Tag> : null}
                    {item.lifecycle === "dismissed" ? (
                      <Tag title={item.dismissReason ?? undefined}>dismissed</Tag>
                    ) : null}
                  </span>
                  <span className={styles.queueReason}>{item.reason}</span>
                </div>
                <span className={styles.queueOwner}>
                  {item.ownerName ?? <span className={styles.queueReason}>Unassigned</span>}
                  {item.dueDate ? (
                    <span
                      className={item.dueDate < today ? styles.queueDueLate : styles.queueReason}
                    >
                      due {item.dueDate}
                    </span>
                  ) : null}
                </span>
                <span className={styles.queueAmount}>{item.amountText ?? "—"}</span>
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
                      changeAction={changeAction}
                      nouns={nouns}
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
