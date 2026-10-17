"use client";
import ControlPanel from "./ControlPanel";
import WorkQueuePanel, { type QueueEmptyState } from "./WorkQueuePanel";
import type { Assignee, ChangeAction } from "./WorkItemActions";
import type {
  SectionEnvelope,
  SurfaceControl,
  SurfaceWorkItem,
} from "@/lib/domain/work-surface/types";
import type { KindFilter, SurfaceNouns } from "@/lib/domain/work-surface/lifecycle";
import styles from "./work-surface.module.css";

/**
 * The shape the four overviews turned out to share: the work, and the checks
 * beside it.
 *
 * **This is a composition, and it is opt-in.** It exists because Banking, Sales
 * and Purchases genuinely arrived at the same two sections — not because a
 * layout was decided first and screens were fitted into it, which is what
 * `WorkAreaOverview` did. A surface that needs something else does not use this;
 * Accounting has an explanation panel, a close mode and a trend section and
 * composes its own page, and it is right that it does.
 *
 * The page's facts (as of, currency, zone, when it was computed) are not drawn
 * here: each overview hands them to its PageHeader as `meta`, through
 * SurfaceMeta, so they read as part of the subtitle. The two sections below
 * repeat the time only when theirs has gone stale.
 *
 * The moment a fourth screen needs a third region, it composes its own too
 * rather than this growing an `extra` slot.
 */
export default function SurfaceScreen({
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
  timeZone,
  currencyCode,
  currencyDecimals,
  queueUnavailable,
  controlsUnavailable,
  blockingTag,
}: {
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
  /** The company zone, so the server and the browser print the same time. */
  timeZone: string;
  currencyCode: string;
  currencyDecimals: number;
  queueUnavailable: string;
  controlsUnavailable: string;
  blockingTag?: { label: string; title: string };
}) {
  return (
    <div className={styles.surfaceRoot}>
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
            timeZone={timeZone}
            changeAction={changeAction}
            nouns={nouns}
            blockingTag={blockingTag}
            emptyState={emptyState}
            unavailableFallback={queueUnavailable}
            freshness="when-stale"
          />
        </div>
        <div className={styles.surfaceControls}>
          <ControlPanel
            controls={controls}
            currencyCode={currencyCode}
            currencyDecimals={currencyDecimals}
            timeZone={timeZone}
            title={controlsTitle}
            unavailableFallback={controlsUnavailable}
            freshness="when-stale"
          />
        </div>
      </div>
    </div>
  );
}
