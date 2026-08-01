/**
 * Reviewing inventory for obsolescence and slow movement.
 *
 * Pure. The database reports the facts about each line of stock — how much,
 * what it cost, when it last moved, how much sold recently. Whether that adds
 * up to "this is not going to sell" is a judgement, and judgements belong here
 * where they can be argued with and tested.
 *
 * Measurement is **lower of cost and net realisable value** (ASC 330-10-35-1B).
 * This company is on weighted average cost, so the older lower-of-cost-or-market
 * test does not apply — it survives only for LIFO and the retail method.
 */

export interface InventoryReviewRow {
  itemId: string;
  itemCode: string | null;
  name: string;
  qtyOnHand: number;
  valueMinor: number;
  unitCostMinor: number;
  salesPriceMinor: number | null;
  lastMovementOn: string | null;
  lastSaleOn: string | null;
  qtySoldInWindow: number;
  writtenDownMinor: number;
}

/** How long stock may sit before it is worth asking about. */
export const SLOW_MOVING_DAYS = 90;
/** Sitting this long, with no sales at all, is the stronger signal. */
export const STALE_DAYS = 180;
/**
 * What is assumed to be lost getting a piece sold — commission, remounting,
 * the discount it takes to move something that has not moved. Net realisable
 * value is the selling price *less* these costs (ASC 330-10-20), so using the
 * ticket price unadjusted would overstate what the goods will fetch.
 */
export const SELLING_COST_RATE = 0.1;

export type StockVerdict =
  /** Selling at a normal rate. Nothing to do. */
  | "moving"
  /** Nothing has moved for a while. Worth an explanation. */
  | "slow_moving"
  /** Nothing has moved for a long while, and nothing has ever sold. */
  | "stale"
  /** Carried above what it would fetch. A write-down is due. */
  | "above_nrv"
  /** On the books with no stock behind it. */
  | "empty";

export interface ReviewedStock extends InventoryReviewRow {
  verdict: StockVerdict;
  daysSinceMovement: number | null;
  /** Selling price less the cost of selling it; null when nothing is priced. */
  nrvMinor: number | null;
  /** How far carrying value exceeds NRV. Zero unless a write-down is due. */
  shortfallMinor: number;
  /** Months of stock at the recent selling rate; null when nothing sold. */
  monthsOfCover: number | null;
  reason: string;
}

/** Money as a reader expects it, with separators. */
function money(minor: number): string {
  return (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * What the stock would actually fetch, net of getting it sold.
 *
 * Null when the item has no selling price: an unpriced item cannot be measured
 * against one, and guessing a value would be worse than declining to.
 */
export function netRealisableValue(row: InventoryReviewRow): number | null {
  if (!row.salesPriceMinor || row.salesPriceMinor <= 0) return null;
  const perUnit = Math.floor(row.salesPriceMinor * (1 - SELLING_COST_RATE));
  return Math.max(0, Math.round(perUnit * row.qtyOnHand));
}

export function reviewStock(
  row: InventoryReviewRow,
  asOf: string,
  windowDays: number,
): ReviewedStock {
  const daysSinceMovement = row.lastMovementOn ? daysBetween(row.lastMovementOn, asOf) : null;
  const nrvMinor = netRealisableValue(row);
  const shortfallMinor = nrvMinor !== null ? Math.max(0, row.valueMinor - nrvMinor) : 0;

  const monthlyRate = (row.qtySoldInWindow / windowDays) * 30;
  const monthsOfCover = monthlyRate > 0 ? row.qtyOnHand / monthlyRate : null;

  let verdict: StockVerdict;
  let reason: string;

  if (row.qtyOnHand <= 0) {
    verdict = "empty";
    reason = "Nothing on hand";
  } else if (shortfallMinor > 0) {
    // Carrying more than the goods will fetch is a measurement problem, and it
    // outranks how fast they are selling.
    verdict = "above_nrv";
    reason =
      `Carried at ${money(row.valueMinor)} against a realisable ` +
      `${money(nrvMinor!)} — ${money(shortfallMinor)} above value`;
  } else if (daysSinceMovement !== null && daysSinceMovement >= STALE_DAYS && row.lastSaleOn === null) {
    verdict = "stale";
    reason = `No movement in ${daysSinceMovement} days and never sold`;
  } else if (daysSinceMovement !== null && daysSinceMovement >= SLOW_MOVING_DAYS) {
    verdict = "slow_moving";
    reason = `No movement in ${daysSinceMovement} days`;
  } else if (row.qtySoldInWindow === 0 && daysSinceMovement !== null) {
    verdict = "slow_moving";
    reason = `Nothing sold in the last ${windowDays} days`;
  } else {
    verdict = "moving";
    reason =
      monthsOfCover !== null
        ? `About ${monthsOfCover.toFixed(1)} month(s) of stock at the recent rate`
        : "Moving";
  }

  return { ...row, verdict, daysSinceMovement, nrvMinor, shortfallMinor, monthsOfCover, reason };
}

export const VERDICT_LABEL: Record<StockVerdict, string> = {
  moving: "Moving",
  slow_moving: "Slow moving",
  stale: "Stale",
  above_nrv: "Above realisable value",
  empty: "No stock",
};

const VERDICT_ORDER: StockVerdict[] = ["above_nrv", "stale", "slow_moving", "moving", "empty"];

export interface InventoryReviewTotals {
  valueMinor: number;
  slowMovingMinor: number;
  /** What would come off the books if every write-down due were taken. */
  shortfallMinor: number;
  writtenDownMinor: number;
}

export interface InventoryReview {
  asOf: string;
  windowDays: number;
  method: string;
  rows: ReviewedStock[];
  needsAttention: ReviewedStock[];
  totals: InventoryReviewTotals;
}

export function buildInventoryReview(
  rows: readonly InventoryReviewRow[],
  asOf: string,
  windowDays: number,
  method: string,
): InventoryReview {
  const reviewed = rows
    .map((row) => reviewStock(row, asOf, windowDays))
    .sort((a, b) => {
      const band = VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict);
      if (band !== 0) return band;
      return b.valueMinor - a.valueMinor;
    });

  const needsAttention = reviewed.filter(
    (row) => row.verdict === "above_nrv" || row.verdict === "stale" || row.verdict === "slow_moving",
  );

  return {
    asOf,
    windowDays,
    method,
    rows: reviewed,
    needsAttention,
    totals: {
      valueMinor: reviewed.reduce((sum, row) => sum + row.valueMinor, 0),
      slowMovingMinor: needsAttention.reduce((sum, row) => sum + row.valueMinor, 0),
      shortfallMinor: reviewed.reduce((sum, row) => sum + row.shortfallMinor, 0),
      writtenDownMinor: reviewed.reduce((sum, row) => sum + row.writtenDownMinor, 0),
    },
  };
}

/** How the valuation method should read on a report. */
export const METHOD_LABEL: Record<string, string> = {
  average_cost: "Weighted average cost",
  fifo: "First in, first out",
  specific_identification: "Specific identification",
};

export function describeInventoryReview(review: InventoryReview): string | null {
  if (review.needsAttention.length === 0) return null;
  const parts: string[] = [];
  const writeDowns = review.rows.filter((row) => row.verdict === "above_nrv");
  if (writeDowns.length > 0) {
    parts.push(
      `${writeDowns.length} item(s) carried above realisable value — ` +
        `${money(review.totals.shortfallMinor)} to write down`,
    );
  }
  const idle = review.needsAttention.filter((row) => row.verdict !== "above_nrv");
  if (idle.length > 0) {
    parts.push(
      `${idle.length} item(s) slow moving, holding ` +
        `${money(idle.reduce((sum, row) => sum + row.valueMinor, 0))}`,
    );
  }
  return `${parts.join(". ")}.`;
}
