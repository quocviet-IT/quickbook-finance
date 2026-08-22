"use client";
import { useMemo } from "react";
import ControlPanel from "./ControlPanel";
import WorkQueuePanel, { type QueueEmptyState } from "./WorkQueuePanel";
import SurfaceStatusStrip from "./SurfaceStatusStrip";
import { freshnessOf } from "./DataStateNote";
import type { Assignee, ChangeAction } from "./WorkItemActions";
import type {
  SectionEnvelope,
  SurfaceControl,
  SurfaceWorkItem,
} from "@/lib/domain/work-surface/types";
import type { KindFilter, SurfaceNouns } from "@/lib/domain/work-surface/lifecycle";
import styles from "./work-surface.module.css";

/**
 * The shape three of the four surfaces turned out to share: a strip, the work,
 * and the checks beside it.
 *
 * **This is a composition, and it is opt-in.** It exists because Banking, Sales
 * and Purchases genuinely arrived at the same two sections — not because a
 * layout was decided first and screens were fitted into it, which is what
 * `WorkAreaOverview` did. A surface that needs something else does not use this;
 * Accounting has an explanation panel, a close mode and a trend section and
 * composes its own page, and it is right that it does.
 *
 * The moment a fourth screen needs a third region, it composes its own too
 * rather than this growing an `extra` slot.
 */
export default function SurfaceScreen({
  facts,
  lead,
  queue,
  controls,
  queueTitle,
  controlsTitle,
  kindFilters,
  nouns,
  changeAction,
  emptyState,
  viewerId,
  canManage,
  assignees,
  today,
  currencyCode,
  currencyDecimals,
  queueUnavailable,
  controlsUnavailable,
  blockingTag,
}: {
  facts: readonly string[];
  lead?: React.ReactNode;
  queue: SectionEnvelope<SurfaceWorkItem[]>;
  controls: SectionEnvelope<SurfaceControl[]>;
  queueTitle: string;
  controlsTitle: string;
  kindFilters: readonly KindFilter[];
  nouns: SurfaceNouns;
  changeAction: ChangeAction;
  emptyState: QueueEmptyState;
  viewerId: string | null;
  canManage: boolean;
  assignees: Assignee[];
  today: string;
  currencyCode: string;
  currencyDecimals: number;
  queueUnavailable: string;
  controlsUnavailable: string;
  blockingTag?: { label: string; title: string };
}) {
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
    <div className={styles.surfaceRoot}>
      <SurfaceStatusStrip
        lead={lead}
        facts={facts}
        generatedAt={generatedAt}
        staleSections={stale}
        unavailableSections={unavailable}
      />
      <div className={styles.surfaceBody}>
        <div className={styles.surfaceQueue}>
          <WorkQueuePanel
            queue={queue}
            title={queueTitle}
            kindFilters={kindFilters}
            viewerId={viewerId}
            canManage={canManage}
            assignees={assignees}
            today={today}
            changeAction={changeAction}
            nouns={nouns}
            blockingTag={blockingTag}
            emptyState={emptyState}
            unavailableFallback={queueUnavailable}
          />
        </div>
        <div className={styles.surfaceControls}>
          <ControlPanel
            controls={controls}
            currencyCode={currencyCode}
            currencyDecimals={currencyDecimals}
            title={controlsTitle}
            unavailableFallback={controlsUnavailable}
          />
        </div>
      </div>
    </div>
  );
}
