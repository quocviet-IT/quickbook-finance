/**
 * The accounting surface's vocabulary: the shared work-surface types, plus the
 * two things that are genuinely accounting's own.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md
 * Plan: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 *
 * Everything general — section envelopes, data states, severity, the shape of a
 * control, the shape of a work item — moved to `lib/domain/work-surface/` in
 * Phase 6 so Banking, Sales, Purchases and Inventory could use it without
 * inheriting accounting's composition. What remains here is what would be
 * meaningless on those screens: the seven control keys this area checks, and the
 * seven kinds of work it produces.
 *
 * The re-exports are deliberate. Callers in this area keep importing their
 * vocabulary from one place, and the aliases below record what accounting calls
 * each shared idea — `blocksClose` is this area's name for `blocking`, because
 * the outcome being blocked here is a period close.
 */
import type {
  DerivedWorkItem,
  SurfaceControl,
  SurfaceWorkItem,
} from "@/lib/domain/work-surface/types";

export type {
  SectionDataState,
  SectionEnvelope,
  ControlStatus,
  EvidenceChip,
} from "@/lib/domain/work-surface/types";

/** Accounting's word for the shared `Severity`. */
export type { Severity as QueueSeverity } from "@/lib/domain/work-surface/types";

/** The checks this area runs. Which ones exist is accounting's business. */
export type ControlKey =
  | "trial-balance"
  | "bank-reconciliation"
  | "ar-to-gl"
  | "ap-to-gl"
  | "inventory-to-gl"
  | "period-status"
  | "pending-approvals";

/** The kinds of work this area produces. */
export type QueueSourceKind =
  | "control-failure"
  | "overdue-invoice"
  | "bill-due"
  | "unmatched-bank"
  | "pending-approval"
  | "overdue-period"
  | "recurring-failure";

/**
 * A control on this surface: the shared shape, narrowed to accounting's keys,
 * with `blocking` named for what it actually blocks here.
 */
export interface AccountingControl extends Omit<SurfaceControl, "key" | "blocking"> {
  key: ControlKey;
  /** True when this control failing should stop a period being closed. */
  blocksClose: boolean;
}

/**
 * What the books say about one piece of work.
 *
 * Everything here is derived on every read. The builders in `queue-items.ts`
 * produce exactly this and nothing more: they have no business knowing who
 * picked something up.
 */
export interface DerivedQueueItem
  extends Omit<DerivedWorkItem, "sourceKind" | "blocking"> {
  sourceKind: QueueSourceKind;
  blocksClose: boolean;
}

/**
 * A work item as the screen sees it: what the books say, and what a person
 * decided about it.
 *
 * The two halves are joined by key at compose time and never stored together.
 * An item is still derived from the books on every read; the state below says
 * only who picked it up, and it cannot make an exception go away.
 */
export interface PriorityQueueItem
  extends DerivedQueueItem,
    Omit<SurfaceWorkItem, keyof DerivedWorkItem> {}

/**
 * Accounting's items in the shape the shared helpers expect.
 *
 * A translation, not a copy: `blocksClose` is the same bit as `blocking`, and
 * this is the one place that says so. Doing it here rather than renaming the
 * field everywhere keeps the accounting code reading in accounting's words,
 * which is what made the original readable.
 */
export function asWorkItem<T extends DerivedQueueItem>(
  item: T,
): T & { blocking: boolean } {
  return { ...item, blocking: item.blocksClose };
}
