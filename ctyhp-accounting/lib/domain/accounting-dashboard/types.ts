/**
 * The Accounting Operations Cockpit's vocabulary.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md
 *
 * Two ideas carry the whole redesign and both live here:
 *
 * **A section reports its own state.** Every section of the dashboard is
 * fetched, and fails, on its own — so each returns a `SectionEnvelope` saying
 * when it was computed and whether that figure can be trusted. A section that
 * could not be computed says `unavailable`; it never quietly reports zero,
 * because "no exceptions" and "we could not look" are opposite answers that a
 * bare 0 makes identical (spec §9.2, §9.3).
 *
 * **A status is a rule, not a colour.** A control carries the condition it
 * passes on, the difference it found, and when it was evaluated, so the screen
 * can render an icon and a sentence beside the colour rather than relying on
 * green and red to carry the meaning alone (spec §7.3, §8.3).
 */
import type { WorkLifecycle } from "./lifecycle";

export type SectionDataState = "fresh" | "stale" | "unavailable";

export interface SectionEnvelope<T> {
  /** Null exactly when `dataState` is "unavailable". */
  data: T | null;
  generatedAt: string;
  dataState: SectionDataState;
  /** Safe, user-facing reason. Never a raw database error. */
  unavailableReason?: string;
}

export type ControlKey =
  | "trial-balance"
  | "bank-reconciliation"
  | "ar-to-gl"
  | "ap-to-gl"
  | "inventory-to-gl"
  | "period-status"
  | "pending-approvals";

export type ControlStatus = "healthy" | "attention" | "blocked" | "unavailable";

export interface AccountingControl {
  key: ControlKey;
  title: string;
  status: ControlStatus;
  /** What passing means, in one sentence, so the reader need not guess. */
  passCondition: string;
  detail: string;
  differenceMinor?: number;
  evaluatedAt: string;
  href: string;
  /** True when this control failing should stop a period being closed. */
  blocksClose: boolean;
}

export type QueueSeverity = "critical" | "high" | "medium" | "low";

export type QueueSourceKind =
  | "control-failure"
  | "overdue-invoice"
  | "bill-due"
  | "unmatched-bank"
  | "pending-approval"
  | "overdue-period"
  | "recurring-failure";

/**
 * What the books say about one piece of work.
 *
 * Everything here is derived on every read. The builders in `queue-items.ts`
 * produce exactly this and nothing more: they have no business knowing who
 * picked something up.
 */
export interface DerivedQueueItem {
  key: string;
  sourceKind: QueueSourceKind;
  /** The record this item stands for, when it stands for one. */
  sourceId: string | null;
  title: string;
  /** Why this sits where it sits, in the reader's words. */
  reason: string;
  severity: QueueSeverity;
  amountMinor?: number;
  ageDays: number;
  /** The one primary action: where the work is actually done. */
  href: string;
  actionLabel: string;
  /** When the source data behind this item was read. */
  confirmedAt: string;
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
export interface PriorityQueueItem extends DerivedQueueItem {
  lifecycle: WorkLifecycle;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  dismissReason: string | null;
  /** The concurrency token to send back with a change. Null when untouched. */
  stateVersion: number | null;
}
