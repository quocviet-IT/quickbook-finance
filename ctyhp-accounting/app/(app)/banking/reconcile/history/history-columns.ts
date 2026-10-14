import { COLUMN } from "@/lib/design/table-metrics";
import type { Tone } from "@/lib/design/tone";
import { HISTORY_STATE_LABELS, type HistoryState } from "@/lib/domain/reconcile-history";

/**
 * How each account's state reads: never reconciled needs a look, reconciled
 * is the good outcome.
 */
export const HISTORY_STATE_TONES: Record<HistoryState, { tone: Tone; label: string }> = {
  never: { tone: "warning", label: HISTORY_STATE_LABELS.never },
  reconciled: { tone: "positive", label: HISTORY_STATE_LABELS.reconciled },
};

/**
 * A date as the page prints it, "Sep 30, 2026" — as the card under the table
 * and the in-progress link do — which is wider than the 2026-09-30 that
 * COLUMN.DATE measures (the statement-alert cards measure the same).
 */
export const HISTORY_SHORT_DATE = 112;

/**
 * The Reconcile history table's measured columns, in the order they are drawn
 * (the radio that chooses the account first), and the floor of its one elastic
 * column (Account). Kept apart from the client component so a unit test can add
 * them up against the 984px box of a 1280px window without rendering the table.
 */
export const HISTORY_COLUMN_WIDTH = {
  choose: COLUMN.SELECTION,
  /** A count, under a three-word heading that stays on one line. */
  openLines: 150,
  from: HISTORY_SHORT_DATE,
  to: HISTORY_SHORT_DATE,
  /** A date, under a two-word heading that stays on one line. */
  lastReconciled: 120,
  /** "Never reconciled", and under it "In progress, ending Sep 30, 2026". */
  state: 220,
} as const;

/** Account takes what the measured columns leave, down to this. */
export const HISTORY_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

/**
 * The narrowest the table is drawn on a phone (history.module.css).
 *
 * In a phone's box the measured columns alone are wider than the box, and the
 * elastic Account column was left 0px: no account's name showed. Under 640px
 * the table is held to its measured widths plus Account's floor, so the name
 * and masked number keep their room, and it scrolls inside its own box.
 */
export const HISTORY_MIN_WIDTH =
  HISTORY_COLUMN_WIDTH.choose +
  HISTORY_COLUMN_WIDTH.openLines +
  HISTORY_COLUMN_WIDTH.from +
  HISTORY_COLUMN_WIDTH.to +
  HISTORY_COLUMN_WIDTH.lastReconciled +
  HISTORY_COLUMN_WIDTH.state +
  HISTORY_ELASTIC_FLOOR;
