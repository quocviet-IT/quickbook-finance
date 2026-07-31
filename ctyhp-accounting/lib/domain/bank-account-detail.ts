/**
 * What kind of bank-type ledger account this is.
 *
 * Pure. "Bank" is the account *type*; checking, savings, money market and cash
 * on hand are the details under it. They all present as cash and cash
 * equivalents, but only some of them are places a bank statement comes from —
 * which is the distinction the bank setup screen has to make.
 */

export const BANK_DETAIL_TYPES = [
  "checking",
  "savings",
  "money_market",
  "cash_on_hand",
  "other_bank",
] as const;

export type BankDetailType = (typeof BANK_DETAIL_TYPES)[number];

const LABELS: Record<BankDetailType, string> = {
  checking: "Checking account",
  savings: "Savings account",
  money_market: "Money market account",
  cash_on_hand: "Cash on hand",
  other_bank: "Other bank account",
};

const DESCRIPTIONS: Record<BankDetailType, string> = {
  checking: "Day-to-day account at a bank, with a statement to reconcile.",
  savings: "Interest-bearing deposit account held at a bank.",
  money_market: "Money market deposit account held at a bank.",
  cash_on_hand: "Physical cash the business holds — a till, a safe, petty cash.",
  other_bank: "Any other account held at a financial institution.",
};

export function bankDetailLabel(detail: string | null | undefined): string {
  if (!detail) return "Unclassified";
  return LABELS[detail as BankDetailType] ?? detail;
}

export function bankDetailDescription(detail: BankDetailType): string {
  return DESCRIPTIONS[detail];
}

/** Whether an account of this detail can hold a bank feed or a statement. */
export function holdsBankStatement(detail: string | null | undefined): boolean {
  return detail !== "cash_on_hand";
}

/** The types the bank setup screen offers; cash on hand is not one of them. */
export const BANK_SETUP_DETAIL_TYPES: BankDetailType[] = [
  "checking",
  "savings",
  "money_market",
  "other_bank",
];

export interface LedgerAccountLike {
  id: string;
  account_code: string;
  name: string;
  account_type: string;
  detail_type: string | null;
  is_posting_account: boolean;
  status: string;
}

/**
 * The ledger accounts a bank account may be attached to: active, posting,
 * Bank-type, and not the cash tin. Unclassified accounts are kept — a chart
 * written before the classifications existed still has to be usable — but a
 * cash-on-hand account is never offered, whatever else it might match.
 */
export function selectableBankLedgerAccounts<T extends LedgerAccountLike>(
  accounts: readonly T[],
  options: { detail?: BankDetailType | null } = {},
): T[] {
  const usable = accounts.filter(
    (account) =>
      account.account_type === "bank" &&
      account.is_posting_account &&
      account.status === "active" &&
      holdsBankStatement(account.detail_type),
  );
  if (!options.detail) return usable;
  // The chosen kind first; unclassified accounts stay available behind them.
  return usable.filter(
    (account) => account.detail_type === options.detail || account.detail_type === null,
  );
}

/**
 * The account to offer once a kind is chosen: the single exact match if there
 * is one, otherwise nothing. Two candidates is a choice for the person setting
 * it up, not something to guess at.
 */
export function suggestBankLedgerAccount<T extends LedgerAccountLike>(
  accounts: readonly T[],
  detail: BankDetailType,
): T | null {
  const exact = selectableBankLedgerAccounts(accounts).filter(
    (account) => account.detail_type === detail,
  );
  return exact.length === 1 ? exact[0] : null;
}

/**
 * What to call a ledger account the user is about to create for this kind, and
 * the first free code in the 1000 block — the range a US chart keeps its cash
 * accounts in.
 */
export function suggestNewLedgerAccount<T extends LedgerAccountLike>(
  accounts: readonly T[],
  detail: BankDetailType,
  bankName?: string | null,
): { account_code: string; name: string; detail_type: BankDetailType } {
  const used = new Set(accounts.map((account) => account.account_code));
  let code = 1010;
  while (used.has(String(code)) && code < 1100) code += 10;

  const base = LABELS[detail];
  const named = bankName?.trim() ? `${bankName.trim()} ${base.toLowerCase()}` : base;
  return { account_code: String(code), name: named, detail_type: detail };
}
