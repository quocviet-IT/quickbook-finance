/**
 * The vocabulary every work surface shares — and nothing else.
 *
 * Design record: docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md
 * Plan: docs/superpowers/plans/2026-08-22-accounting-cockpit-phase6.md
 *
 * This file is deliberately ignorant. It does not know what a ledger is, what an
 * invoice is, or that accounting exists. Everything here is about *work* — a
 * thing that needs doing, how urgent it is, whether a check passed, and whether
 * the figure on screen can be believed.
 *
 * That ignorance is the point and it is enforced: `tests/unit/work-surface-boundary.test.ts`
 * fails if anything under `lib/domain/work-surface/` or `components/work-surface/`
 * imports from an area, or names an area's vocabulary. Without that test
 * "shared" becomes "accounting's, reused by other people", which is exactly what
 * `WorkAreaOverview` became.
 *
 * Two ideas carry the whole design and both live here.
 *
 * **A section reports its own state.** Every section is fetched, and fails, on
 * its own, so each returns a `SectionEnvelope` saying when it was computed and
 * whether the figure can be trusted. A section that could not be computed says
 * `unavailable`; it never quietly reports zero, because "nothing is wrong" and
 * "we could not look" are opposite answers that a bare 0 makes identical.
 *
 * **A status is a rule, not a colour.** A control carries the condition it passes
 * on and the difference it found, so a screen can render an icon and a sentence
 * beside the colour rather than making green and red carry the meaning alone.
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

export type Severity = "critical" | "high" | "medium" | "low";

export type ControlStatus = "healthy" | "attention" | "blocked" | "unavailable";

/**
 * A check an area runs on itself.
 *
 * The shape is shared; which checks exist is not. Accounting has a trial balance
 * and three subledgers; Banking has neither and has a statement date instead.
 * Anything that decides *what* to check belongs to an area.
 */
export interface SurfaceControl {
  key: string;
  title: string;
  status: ControlStatus;
  /** What passing means, in one sentence, so the reader need not guess. */
  passCondition: string;
  detail: string;
  differenceMinor?: number;
  evaluatedAt: string;
  href: string;
  /**
   * True when this failing stops the area's own key outcome — closing a period,
   * completing a reconciliation. Each area decides what its outcome is; the
   * shared ordering rule only needs to know that one exists.
   */
  blocking: boolean;
}

/**
 * What the records say about one piece of work.
 *
 * Derived on every read, in every area. The builders that produce these have no
 * business knowing who picked something up — that half is joined in by
 * composition, below.
 */
export interface DerivedWorkItem {
  key: string;
  /**
   * Which kind of thing this is, in the area's own words — `unmatched-bank`,
   * `overdue-invoice`, `three-way-match`. A plain string on purpose: a shared
   * union listing every area's kinds would be one area's composition wearing a
   * general name, and would need editing every time an area learned something.
   */
  sourceKind: string;
  /** The record this stands for, when it stands for one. */
  sourceId: string | null;
  title: string;
  /** Why this sits where it sits, in the reader's words. */
  reason: string;
  severity: Severity;
  amountMinor?: number;
  ageDays: number;
  /** The one primary action: where the work is actually done. */
  href: string;
  actionLabel: string;
  /** When the source data behind this item was read. */
  confirmedAt: string;
  /** See `SurfaceControl.blocking`. */
  blocking: boolean;
}

/**
 * A work item as a screen sees it: what the records say, and what a person
 * decided about it.
 *
 * The two halves are joined by key at compose time and never stored together. An
 * item is still derived on every read; the state below says only who picked it
 * up, and it cannot make an exception go away.
 */
export interface SurfaceWorkItem extends DerivedWorkItem {
  lifecycle: WorkLifecycle;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  dismissReason: string | null;
  /** The concurrency token to send back with a change. Null when untouched. */
  stateVersion: number | null;
  /**
   * The amount as the reader sees it, formatted where the currency is known.
   *
   * Presentation, deliberately on the item rather than in the browser: the
   * string never changes while the page is open, and working it out client-side
   * means shipping a currency formatter to print a fixed number. Null when the
   * item has no amount — which is not the same as zero.
   */
  amountText: string | null;
}

/** One figure an insight was built from, so a reader can check the sentence. */
export interface EvidenceChip {
  label: string;
  value: string;
  href?: string;
}

/**
 * Something worth knowing, and the figures it was reached from.
 *
 * `ruleKey` is versioned and shown on screen, so a disagreement has something to
 * point at rather than being an argument with the page. Which rules exist is an
 * area's business; that every one shows its working is everyone's.
 */
export interface SurfaceInsight {
  id: string;
  ruleKey: string;
  severity: Severity;
  title: string;
  summary: string;
  evidence: EvidenceChip[];
  recommendedAction: { label: string; href: string };
}
