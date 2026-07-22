/**
 * Pure roll-up of the sales-tax liability. `collected` is per-tax-code tax
 * accrued from issued invoices in the period; `netBalanceMinor` is the current
 * Sales Tax Payable balance (credit - debit) owed. This is the single place the
 * liability totals are computed.
 */
export interface TaxCollectedLine {
  taxCodeId: string;
  code: string;
  name: string;
  ratePercent: number;
  taxableMinor: number;
  taxMinor: number;
}

export interface SalesTaxLiability {
  lines: TaxCollectedLine[];
  totalTaxCollectedMinor: number;
  paymentsMinor: number;
  netOwedMinor: number;
}

export function summarizeSalesTaxLiability(input: {
  collected: TaxCollectedLine[];
  paymentsMinor: number;
  netBalanceMinor: number;
}): SalesTaxLiability {
  const totalTaxCollectedMinor = input.collected.reduce((s, l) => s + l.taxMinor, 0);
  return {
    lines: input.collected,
    totalTaxCollectedMinor,
    paymentsMinor: input.paymentsMinor,
    netOwedMinor: input.netBalanceMinor,
  };
}
