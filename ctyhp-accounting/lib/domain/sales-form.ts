/**
 * Small rules shared by the invoice, estimate and customer forms.
 *
 * Pure. A line's amount is worked out the way the totals under the editor and
 * the database work it out (computeInvoiceLine), so the per-line figure and
 * the subtotal can never disagree by a cent.
 */
import { computeInvoiceLine } from "@/lib/domain/money";
import { toMinorUnits } from "@/lib/format";

export interface SalesLineValues {
  quantity?: number | null;
  /** Major units, as typed. */
  unit_price?: number | null;
}

/** Quantity × unit price in minor units, before tax; null until both are entered. */
export function salesLineAmountMinor(line: SalesLineValues | undefined, decimals: number): number | null {
  if (!line) return null;
  const { quantity, unit_price: unitPrice } = line;
  if (quantity === undefined || quantity === null || unitPrice === undefined || unitPrice === null) return null;
  return computeInvoiceLine({
    quantity: Number(quantity),
    unitPriceMinor: toMinorUnits(Number(unitPrice), decimals),
    taxRatePercent: 0,
  }).subtotalMinor;
}

/** A draft has no number until it is issued, so it is named by its customer. */
export function draftInvoiceCreatedMessage(customerName: string): string {
  return `Draft invoice for ${customerName} created`;
}

export function customerSavedMessage(name: string, outcome: "created" | "updated"): string {
  return outcome === "created" ? `${name} added` : `${name} updated`;
}
