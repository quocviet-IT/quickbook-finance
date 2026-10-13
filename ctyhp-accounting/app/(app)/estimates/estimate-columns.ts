import { COLUMN } from "@/lib/design/table-metrics";
import type { Tone } from "@/lib/design/tone";
import { ESTIMATE_STATE_LABELS, type EstimateState } from "@/lib/domain/estimates";

/**
 * How each state reads. Converted is the good outcome; Expired needs a look
 * before it is turned into an invoice; Declined is off the table, like a void
 * document; Open is work in progress.
 */
export const ESTIMATE_STATE_TONES: Record<EstimateState, { tone: Tone; label: string }> = {
  open: { tone: "neutral", label: ESTIMATE_STATE_LABELS.open },
  expired: { tone: "warning", label: ESTIMATE_STATE_LABELS.expired },
  declined: { tone: "muted", label: ESTIMATE_STATE_LABELS.declined },
  converted: { tone: "positive", label: ESTIMATE_STATE_LABELS.converted },
};

/**
 * The Estimates list's measured columns, in the order they are drawn, and the
 * floor of its one elastic column (Customer).
 *
 * Kept apart from the client component so tests/unit/estimates-screen.test.ts
 * can add them up against the 984px box of a 1280px window without rendering
 * the table.
 */
export const ESTIMATE_COLUMN_WIDTH = {
  number: COLUMN.CODE,
  date: COLUMN.DATE,
  /**
   * A date, but under a two-word heading: at COLUMN.DATE "Valid until" wraps
   * onto a second line and makes the whole heading row taller, which is what
   * the invoice list renamed "Issue date" to "Issued" to avoid.
   */
  validUntil: 104,
  total: COLUMN.MONEY,
  state: COLUMN.STATUS,
  /** The invoice made from it: a number such as INV-000123, or "Draft". */
  invoice: COLUMN.CODE,
  /** One "⋯" button. */
  actions: COLUMN.ACTION + 8,
} as const;

/** Customer takes what the measured columns leave, down to this. */
export const ESTIMATE_ELASTIC_FLOOR = COLUMN.TEXT_MIN;
