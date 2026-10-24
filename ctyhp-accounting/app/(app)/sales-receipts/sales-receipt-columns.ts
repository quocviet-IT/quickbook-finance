import { COLUMN } from "@/lib/design/table-metrics";
import type { Tone } from "@/lib/design/tone";
import type { SalesReceiptStatus } from "@/lib/domain/sales-receipts";

/**
 * How each status reads. A receipt is paid the moment it is saved, so Paid is
 * the good outcome; Void is off the books, as a void invoice is.
 */
export const SALES_RECEIPT_STATUS_TONES: Record<SalesReceiptStatus, { tone: Tone; label: string }> = {
  posted: { tone: "positive", label: "Paid" },
  void: { tone: "muted", label: "Void" },
};

/**
 * The Sales Receipts list's measured columns, in the order they are drawn,
 * and the floors of its two elastic ones (Customer, Deposit to).
 *
 * Kept apart from the client component so tests/unit/sales-receipts-screen.test.ts
 * can add them up against the 984px box of a 1280px window without rendering
 * the table.
 */
export const SALES_RECEIPT_COLUMN_WIDTH = {
  number: COLUMN.CODE,
  date: COLUMN.DATE,
  /** "Bank transfer", the longest, on one line. */
  method: 112,
  total: COLUMN.MONEY,
  status: COLUMN.STATUS,
  /** One "⋯" button. */
  actions: COLUMN.ACTION + 8,
} as const;

/** Customer takes what the measured columns leave, down to this. */
export const SALES_RECEIPT_CUSTOMER_FLOOR = COLUMN.TEXT_MIN;

/** "1010 Operating Checking" fits; a longer name ends in an ellipsis. */
export const SALES_RECEIPT_DEPOSIT_FLOOR = 160;
