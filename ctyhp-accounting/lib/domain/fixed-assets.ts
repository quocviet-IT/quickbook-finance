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
