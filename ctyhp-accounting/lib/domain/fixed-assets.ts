import type { FixedAssetMethod } from "@/lib/db/types";

/** The methods an asset can be registered under, as the form and the import offer them. */
export const DEPRECIATION_METHOD_OPTIONS: { value: FixedAssetMethod; label: string }[] = [
  { value: "straight_line", label: "Straight-line (monthly)" },
  // Short enough for the form's select; the note under the form says it switches to straight-line.
  { value: "declining_balance", label: "Declining balance (200%)" },
  { value: "none", label: "Not depreciated" },
];

export const DEPRECIATION_METHODS: readonly FixedAssetMethod[] = DEPRECIATION_METHOD_OPTIONS.map((option) => option.value);

/** Whether an asset under this method has a useful life, a schedule and the two depreciation accounts. */
export function depreciates(method: FixedAssetMethod | string | null | undefined): boolean {
  return method === "straight_line" || method === "declining_balance";
}

/**
 * The monthly charges the database plans for a declining-balance asset
 * (migration 0182), for the form's preview and the tests: twice the
 * straight-line rate (2 / months) on what is left of the cost, until the
 * straight line over the months left gives more, and from then on that; the
 * last month takes the asset to its salvage value exactly. A month that would
 * charge nothing is not planned.
 */
export function decliningBalanceSchedule(costMinor: number, salvageMinor: number, months: number): number[] {
  const charges: number[] = [];
  let book = costMinor;
  for (let month = 1; month <= months; month++) {
    if (book <= salvageMinor) break;
    const left = months - month + 1;
    const doubled = Math.round((book * 2) / months);
    const level = Math.round((book - salvageMinor) / left);
    const charge = month === months ? book - salvageMinor : Math.min(Math.max(doubled, level), book - salvageMinor);
    charges.push(charge);
    book -= charge;
  }
  return charges;
}

/** What the form says a declining-balance schedule will charge, before the asset is registered. */
export function decliningBalancePreview(
  costMinor: number,
  salvageMinor: number,
  months: number,
  money: (minor: number) => string,
): string | null {
  if (!(costMinor > 0) || !(salvageMinor >= 0) || costMinor <= salvageMinor || !(months > 0)) return null;
  const charges = decliningBalanceSchedule(costMinor, salvageMinor, months);
  if (charges.length === 0) return null;
  const year = Math.min(12, charges.length);
  const firstYear = charges.slice(0, year).reduce((sum, charge) => sum + charge, 0);
  return (
    `First month ${money(charges[0])}, first ${year} months ${money(firstYear)}; ` +
    `the last charge, in month ${charges.length}, leaves the salvage value of ${money(salvageMinor)}.`
  );
}

/** How the two methods charge, said under the form. */
export const BOOK_DEPRECIATION_NOTE =
  "Both methods use a full-month convention beginning in the in-service month. Straight-line charges the same each month. " +
  "Declining balance charges twice the straight-line rate on what is left, then switches to straight-line when that gives more, " +
  "so the asset reaches its salvage value at the end of its life. Registering an asset from a posted bill links the records " +
  "without duplicating the acquisition journal.";

export interface AssetDisposalAmounts {
  netBookValueMinor: number;
  netProceedsMinor: number;
  gainLossMinor: number;
}

/**
 * Book-value calculation used by the disposal preview.
 *
 * A positive gain/loss is a gain; a negative value is a loss. The database
 * repeats this calculation while holding the asset row lock, so the preview
 * never replaces the authoritative posting calculation.
 */
export function calculateAssetDisposal(
  costMinor: number,
  accumulatedDepreciationMinor: number,
  salePriceMinor: number,
  disposalCostMinor: number,
): AssetDisposalAmounts {
  const netBookValueMinor = costMinor - accumulatedDepreciationMinor;
  const netProceedsMinor = salePriceMinor - disposalCostMinor;
  return {
    netBookValueMinor,
    netProceedsMinor,
    gainLossMinor: netProceedsMinor - netBookValueMinor,
  };
}
