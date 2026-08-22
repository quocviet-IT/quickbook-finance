"use client";
import WorkQueuePanel from "@/components/work-surface/WorkQueuePanel";
import type { Assignee } from "@/components/work-surface/WorkItemActions";
import type {
  PriorityQueueItem,
  SectionEnvelope,
} from "@/lib/domain/accounting-dashboard/types";
import { ACCOUNTING_KIND_FILTERS, ACCOUNTING_NOUNS } from "@/lib/domain/accounting-dashboard/lifecycle";
import { changeWorkItemAction } from "@/app/(app)/accounting/actions";

/**
 * The accounting work, first on the page.
 *
 * The rows, the filter bar and the row menu are
 * `components/work-surface/WorkQueuePanel.tsx` — a list of things to do looks
 * the same whichever screen derived it, and four copies would be four places to
 * forget that age belongs in the reason line rather than a column.
 *
 * What is accounting's, and is supplied here: this surface's own filters, the
 * words on a blocking row, the sentence that makes "nothing to do" believable,
 * and the action that writes a change.
 */
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
  viewerId: string | null;
  canManage: boolean;
  assignees: Assignee[];
  today: string;
}) {
  return (
    <WorkQueuePanel
      queue={{
        ...queue,
        data: queue.data?.map((item) => ({ ...item, blocking: item.blocksClose })) ?? null,
      }}
      title="Priority work"
      kindFilters={ACCOUNTING_KIND_FILTERS}
      viewerId={viewerId}
      canManage={canManage}
      assignees={assignees}
      today={today}
      changeAction={changeWorkItemAction}
      nouns={ACCOUNTING_NOUNS}
      blockingTag={{
        label: "blocks close",
        title: "A period cannot be closed while this stands.",
      }}
      emptyState={{
        title: "Nothing needs attention",
        // The distinction the whole redesign turns on: an empty queue means
        // something only when the checks behind it actually ran.
        evidence: controlsEvaluated
          ? "Every accounting control passed and no document, bank line, or approval is waiting."
          : "No document, bank line, or approval is waiting — but the accounting controls could not be evaluated, so this is not a clean bill of health.",
      }}
      unavailableFallback="The work queue could not be loaded."
      className="accounting-priority-queue"
    />
  );
}
