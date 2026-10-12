import { COLUMN, TABLE_BOX_AT_1280 } from "@/lib/design/table-metrics";

/**
 * How wide the statement-alert cards' tables are allowed to be.
 *
 * Both tables sit inside an amber card, beside its icon, inside an inset
 * panel, so their box is narrower than the page's. The figures here are the
 * ones `statement-alerts.module.css` draws with; change one and change the
 * other, and `tests/unit/reconcile-alerts-screen.test.ts` adds them up.
 */
export const ALERT_CARD = {
  /** The card's border on the right, and the inset panel's on both sides. */
  border: 1 + 2,
  /** The amber rule down the card's left edge. */
  accent: 4,
  /** Padding inside the card, each side. */
  paddingX: 20,
  /** The icon's column and the gap after it. */
  gutter: 32 + 16,
} as const;

/** The width a card's table has at the narrowest window the design supports. */
export const ALERT_TABLE_BOX =
  TABLE_BOX_AT_1280 - ALERT_CARD.border - ALERT_CARD.accent - 2 * ALERT_CARD.paddingX - ALERT_CARD.gutter;

/** A date written "Sep 26, 2026", which is wider than the 2026-09-26 that COLUMN.DATE measures. */
const SHORT_DATE = 112;

/** The workings of a balance posted as payments. Coded to carries no width and takes what is left. */
export const WORKINGS_WIDTH = {
  date: SHORT_DATE,
  postedAs: COLUMN.MONEY_WIDE,
  /** "This account on that date": a balance, under a heading that wraps to two lines. */
  balance: 176,
  difference: COLUMN.MONEY,
} as const;
export const WORKINGS_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

/** The largest payments not yet on a statement. Name and Coded to carry no width. */
export const OUTSTANDING_WIDTH = {
  date: SHORT_DATE,
  amount: COLUMN.MONEY_WIDE,
} as const;
export const OUTSTANDING_ELASTIC_FLOOR = 2 * COLUMN.TEXT_MIN;

/**
 * The narrowest each table is drawn on a phone.
 *
 * In a phone's box the declared widths can still fit and leave the elastic
 * columns nothing — Name and Coded to came out as "E…" and "6…". Under 640px
 * the stylesheet holds each table to its declared widths plus its floors, and
 * the table scrolls inside the card instead.
 */
export const WORKINGS_MIN_WIDTH =
  WORKINGS_WIDTH.date + WORKINGS_WIDTH.postedAs + WORKINGS_WIDTH.balance + WORKINGS_WIDTH.difference + WORKINGS_ELASTIC_FLOOR;
export const OUTSTANDING_MIN_WIDTH = OUTSTANDING_WIDTH.date + OUTSTANDING_WIDTH.amount + OUTSTANDING_ELASTIC_FLOOR;
