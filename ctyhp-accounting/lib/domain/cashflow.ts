/**
 * Pure cash-flow classification + assembly for the direct-method statement.
 * Cash = 'bank' accounts. Category totals come from the non-bank lines of
 * bank-touching entries; they must sum to the change in cash (the tie-out).
 */
import type { AccountType } from "./accounts";

export type CashFlowCategory = "operating" | "investing" | "financing";

export const CASH_FLOW_ROLES = [
  "cash",
  "cash_equivalent",
  "restricted_cash",
  "operating",
  "operating_receivable",
  "operating_inventory",
  "operating_payable",
  "operating_asset",
  "operating_liability",
  "investing",
  "financing",
  "exclude",
  "unclassified",
] as const;

export type CashFlowRole = (typeof CASH_FLOW_ROLES)[number];

/**
 * Conservative chart-of-accounts default for cash-flow reporting.
 * Generic current assets and liabilities need an accountant's policy choice;
 * defaulting them to operating could silently classify loans or investments.
 */
export function defaultCashFlowRole(type: AccountType): CashFlowRole {
  switch (type) {
    case "bank":
      return "cash";
    case "accounts_receivable":
      return "operating_receivable";
    case "accounts_payable":
      return "operating_payable";
    case "fixed_asset":
      return "investing";
    case "equity":
    case "credit_card":
      return "financing";
    case "income":
    case "cost_of_goods_sold":
    case "expense":
    case "other_income":
    case "other_expense":
      return "operating";
    case "current_asset":
    case "current_liability":
      return "unclassified";
  }
}

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

export type CashFlowStatementSection = CashFlowCategory | "unclassified";

export interface CashFlowContribution {
  section: CashFlowStatementSection;
  lineCode: string;
  label: string;
  amountMinor: number;
  detailCount: number;
}

export interface IndirectCashFlowReport extends CashFlowAssembled {
  method: "indirect";
  lines: CashFlowContribution[];
  endingCashStatementMinor: number;
  balanceSheetCashMinor: number;
  differenceMinor: number;
  unclassifiedMinor: number;
  unclassifiedCount: number;
  classificationComplete: boolean;
}

/** Assemble already-classified ledger contributions into the signed bridge. */
export function assembleIndirectCashFlow(
  contributions: CashFlowContribution[],
  openingMinor: number,
  balanceSheetCashMinor: number,
): IndirectCashFlowReport {
  const total = (section: CashFlowCategory) =>
    contributions
      .filter((line) => line.section === section)
      .reduce((sum, line) => sum + line.amountMinor, 0);
  const operating = total("operating");
  const investing = total("investing");
  const financing = total("financing");
  const classifiedChange = operating + investing + financing;
  const endingCashStatementMinor = openingMinor + classifiedChange;
  const differenceMinor = balanceSheetCashMinor - endingCashStatementMinor;
  const unclassified = contributions.filter((line) => line.section === "unclassified");
  const unclassifiedMinor = unclassified.reduce((sum, line) => sum + line.amountMinor, 0);
  const unclassifiedCount = unclassified.reduce((sum, line) => sum + line.detailCount, 0);
  const classificationComplete = unclassifiedCount === 0;

  return {
    method: "indirect",
    lines: contributions,
    operating,
    investing,
    financing,
    netChange: balanceSheetCashMinor - openingMinor,
    openingMinor,
    closingMinor: balanceSheetCashMinor,
    endingCashStatementMinor,
    balanceSheetCashMinor,
    differenceMinor,
    unclassifiedMinor,
    unclassifiedCount,
    classificationComplete,
    tiesOut: differenceMinor === 0 && classificationComplete,
  };
}
