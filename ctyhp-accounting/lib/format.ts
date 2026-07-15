/** Format a minor-unit amount as a currency string for display. */
export function formatMoney(minor: number, currencyCode: string, decimals: number): string {
  const value = minor / 10 ** decimals;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${value.toFixed(decimals)} ${currencyCode}`;
  }
}

/** Convert a major-unit decimal (e.g. dollars) to integer minor units. */
export function toMinorUnits(amount: number, decimals: number): number {
  return Math.round(amount * 10 ** decimals);
}
