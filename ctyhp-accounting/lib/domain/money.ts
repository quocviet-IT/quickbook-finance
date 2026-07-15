/**
 * Money is represented in integer minor units (e.g. cents; for VND, đồng —
 * decimal_places = 0). Working in integers avoids binary floating-point drift
 * in accounting math. Conversion to/from a display decimal happens only at the
 * UI edge, using the currency's decimal_places.
 */

export type Minor = number;

export function assertMinor(value: number, label = "amount"): asserts value is Minor {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer minor-unit amount, received ${value}`);
  }
}

/** Round to the nearest integer, half away from zero (banker-safe, symmetric). */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON);
}

/** Convert a decimal display amount to minor units for a given currency scale. */
export function toMinor(amount: number, decimalPlaces: number): Minor {
  return roundHalfAwayFromZero(amount * 10 ** decimalPlaces);
}

/** Convert minor units back to a decimal display amount. */
export function fromMinor(minor: Minor, decimalPlaces: number): number {
  assertMinor(minor);
  return minor / 10 ** decimalPlaces;
}

export interface InvoiceLineInput {
  /** May be fractional (e.g. gold weight in grams). */
  quantity: number;
  /** Unit price in minor units. */
  unitPriceMinor: Minor;
  /** Tax rate as a percentage, e.g. 10 for 10%. */
  taxRatePercent: number;
}

export interface InvoiceLineAmounts {
  subtotalMinor: Minor;
  taxMinor: Minor;
  totalMinor: Minor;
}

/** Compute one invoice line's subtotal, tax, and total in minor units. */
export function computeInvoiceLine(input: InvoiceLineInput): InvoiceLineAmounts {
  assertMinor(input.unitPriceMinor, "unitPriceMinor");
  if (input.taxRatePercent < 0) {
    throw new Error(`taxRatePercent must be >= 0, received ${input.taxRatePercent}`);
  }
  const subtotalMinor = roundHalfAwayFromZero(input.quantity * input.unitPriceMinor);
  const taxMinor = roundHalfAwayFromZero((subtotalMinor * input.taxRatePercent) / 100);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

export interface InvoiceTotals {
  subtotalMinor: Minor;
  taxTotalMinor: Minor;
  totalMinor: Minor;
}

/** Sum line amounts into invoice-level totals. */
export function sumInvoiceTotals(lines: InvoiceLineAmounts[]): InvoiceTotals {
  return lines.reduce<InvoiceTotals>(
    (acc, l) => ({
      subtotalMinor: acc.subtotalMinor + l.subtotalMinor,
      taxTotalMinor: acc.taxTotalMinor + l.taxMinor,
      totalMinor: acc.totalMinor + l.totalMinor,
    }),
    { subtotalMinor: 0, taxTotalMinor: 0, totalMinor: 0 },
  );
}
