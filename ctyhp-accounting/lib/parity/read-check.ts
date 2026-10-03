import type { PrototypeBook } from "./types.ts";

/**
 * The fiscal years whose Profit and Loss shows Net Operating Income but whose Net Income was not read. The prototype
 * prints Net Income on every report that has Net Operating Income, so a year listed here is a figure the page shows
 * and the reader missed. An empty report shows neither line and is not listed.
 */
export function unreadNetIncome(book: PrototypeBook): string[] {
  return Object.entries(book.figures.profitAndLoss)
    .filter(([, totals]) => totals.netOperating !== null && totals.net === null)
    .map(([years]) => years)
    .sort();
}
