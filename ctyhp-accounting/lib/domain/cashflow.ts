/**
 * Pure cash-flow classification + assembly for the direct-method statement.
 * Cash = 'bank' accounts. Category totals come from the non-bank lines of
 * bank-touching entries; they must sum to the change in cash (the tie-out).
 */
import type { AccountType } from "./accounts";

export type CashFlowCategory = "operating" | "investing" | "financing";

export function cashFlowCategoryOf(t: AccountType): CashFlowCategory {
  if (t === "fixed_asset") return "investing";
  if (t === "equity" || t === "credit_card") return "financing";
  return "operating";
}

export interface CashFlowAssembled {
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
  openingMinor: number;
  closingMinor: number;
  tiesOut: boolean;
}

export function assembleCashFlow(
  categories: { category: CashFlowCategory; amountMinor: number }[],
  openingMinor: number,
  closingMinor: number,
): CashFlowAssembled {
  const sum = (c: CashFlowCategory) => categories.filter((x) => x.category === c).reduce((s, x) => s + x.amountMinor, 0);
  const operating = sum("operating");
  const investing = sum("investing");
  const financing = sum("financing");
  const netChange = closingMinor - openingMinor;
  return {
    operating, investing, financing, netChange, openingMinor, closingMinor,
    tiesOut: operating + investing + financing === netChange,
  };
}
