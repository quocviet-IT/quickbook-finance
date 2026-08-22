"use client";
import { useMemo } from "react";
import ControlPanel from "@/components/work-surface/ControlPanel";
import WorkQueuePanel from "@/components/work-surface/WorkQueuePanel";
import { freshnessOf } from "@/components/work-surface/DataStateNote";
import type { Assignee } from "@/components/work-surface/WorkItemActions";
import type { BankingSurfaceData } from "@/lib/services/banking-surface";
import { BANKING_KIND_FILTERS, BANKING_NOUNS } from "@/lib/domain/banking-surface/lifecycle";
import { changeBankingWorkItemAction } from "@/app/(app)/banking/overview/actions";
import SurfaceStatusStrip from "@/components/work-surface/SurfaceStatusStrip";
import styles from "./banking-surface.module.css";

/**
 * The Banking surface.
 *
 * Two sections, and the order is the whole decision: **the work first, then the
 * three things that can be true or false about it.** The screen this replaces
 * opened with four metric cards and a twelve-month chart, and an accountant
 * looking for what to match had to scroll past both.
 *
 * There is no chart here at all. Banking's job is *what is unmatched, and how
 * far each account is reconciled* — a trend line answers neither question, and
 * the only reason to draw one would be that the accounting screen has one.
 */
export default function BankingSurface({
  data,
  viewerId,
  canManage,
  assignees,
}: {
  data: BankingSurfaceData;
  viewerId: string | null;
  canManage: boolean;
  assignees: Assignee[];
}) {
  const { context, controls, queue } = data;

  // Freshness is judged in the browser, against the reader's own clock: a
  // server-rendered page left open for an hour is stale even though nothing
  // about the payload changed.
  const { stale, unavailable, generatedAt } = useMemo(() => {
    const sections = [
      { name: "Work", envelope: queue },
      { name: "Checks", envelope: controls },
    ];
    return {
      stale: sections
        .filter(
          (s) =>
            s.envelope.dataState !== "unavailable" &&
            freshnessOf(s.envelope.generatedAt) === "stale",
        )
        .map((s) => s.name),
      unavailable: sections
        .filter((s) => s.envelope.dataState === "unavailable")
        .map((s) => s.name),
      generatedAt: sections
        .map((s) => s.envelope.generatedAt)
        .sort()
        .at(-1) as string,
    };
  }, [queue, controls]);

  return (
    <div className={styles.root}>
      <SurfaceStatusStrip
        facts={[`As of ${context.asOf}`, context.currencyCode, context.timeZone]}
        generatedAt={generatedAt}
        staleSections={stale}
        unavailableSections={unavailable}
      />

      <div className={styles.body}>
        <div className={styles.queueColumn}>
          <WorkQueuePanel
            queue={queue}
            title="What needs matching"
            kindFilters={BANKING_KIND_FILTERS}
            viewerId={viewerId}
            canManage={canManage}
            assignees={assignees}
            today={context.asOf}
            changeAction={changeBankingWorkItemAction}
            nouns={BANKING_NOUNS}
            emptyState={{
              title: "Nothing is waiting to be matched",
              evidence:
                controls.dataState === "unavailable"
                  ? "No unmatched line, broken feed or unfinished reconciliation was found — but the checks could not run, so this is not a clean bill of health."
                  : "Every settled line is matched or set aside, every feed is syncing, and no reconciliation was left open.",
            }}
            filteredEmptyEvidence="Clear the filter to see the rest of the queue."
            unavailableFallback="The banking work could not be loaded."
            className="banking-work-queue"
          />
        </div>
        <div className={styles.controlColumn}>
          <ControlPanel
            controls={controls}
            currencyCode={context.currencyCode}
            currencyDecimals={context.currencyDecimals}
            title="Banking checks"
            unavailableFallback="The banking checks could not be evaluated."
          />
        </div>
      </div>
    </div>
  );
}
