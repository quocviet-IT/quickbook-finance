/**
 * The OneBook type a prototype account is posted to, by the prototype's own
 * rules: its Balance Sheet classes (p13 assetClass / liabClass) and its Profit
 * and Loss sections (p4 COGS_RE / OTHER_INCOME / OTHER_EXPENSE), so both
 * systems put each account in the same section. Within each root the first
 * rule wins, in the prototype's own order for assets: long-lived, cash,
 * receivable.
 */
import type { AccountType } from "../domain/accounts.ts";

const LONG_ASSET = /FixedAsset|Equipment|Furniture|Vehicle|Property|Building|Land|Intangible|Goodwill|Depreciation|Amorti/i;
const CASH = /^Assets:(Bank|Cash)|Cash/i;
const RECEIVABLE = /Receivable/i;
const LONG_LIABILITY = /LongTerm|Mortgage|NotePayable|LoansPayable|Debenture|Bond/i;
const CREDIT_CARD = /CreditCard/i;
const ACCOUNTS_PAYABLE = /AccountsPayable/i;
const OTHER_INCOME = /^Income:(InterestIncome|OtherIncome)/;
const COGS = /^Expenses:CostOfGoodsSold/;
const OTHER_EXPENSE = /^Expenses:(InterestExpense|TaxExpense|OtherExpense)/;

export function prototypeAccountType(name: string): AccountType | null {
  switch (name.split(":")[0]) {
    case "Assets":
      if (LONG_ASSET.test(name)) return "fixed_asset";
      if (CASH.test(name)) return "bank";
      if (RECEIVABLE.test(name)) return "accounts_receivable";
      return "current_asset";
    case "Liabilities":
      if (LONG_LIABILITY.test(name)) return "long_term_liability";
      if (CREDIT_CARD.test(name)) return "credit_card";
      if (ACCOUNTS_PAYABLE.test(name)) return "accounts_payable";
      return "current_liability";
    case "Equity":
      return "equity";
    case "Income":
      return OTHER_INCOME.test(name) ? "other_income" : "income";
    case "Expenses":
      if (COGS.test(name)) return "cost_of_goods_sold";
      if (OTHER_EXPENSE.test(name)) return "other_expense";
      return "expense";
    default:
      return null;
  }
}
