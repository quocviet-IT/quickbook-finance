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
/**
 * What a bank account's name plainly says it is, or null when it says nothing.
 *
 * Migration 0072 classified the accounts that existed by these same four
 * readings, as a one-off backfill. An import creates new ones every time, and
 * left unclassified they turn up on the bank setup screen as "(unclassified)"
 * — so the reading moves here, where it can run again.
 *
 * Only what the name settles. Anything else stays null for a person to answer:
 * guessing a classification onto a ledger account is how a balance sheet ends
 * up quietly wrong, which is the reason 0072 gave for stopping at four.
 */
export function detailTypeFromName(name: string | null | undefined): BankDetailType | null {
  const text = (name ?? "").toLowerCase();
  if (text.includes("cash on hand") || text.includes("petty cash")) return "cash_on_hand";
  if (
    text.includes("checking") ||
    text.includes("operating bank") ||
    text.includes("current account")
  ) {
    return "checking";
  }
  if (text.includes("savings")) return "savings";
  if (text.includes("money market")) return "money_market";
  return null;
}

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
 * What the bank setup screen asks for (2.45): the detail of a Bank-type
 * account, or a credit card — a Credit Card-type ledger account, a liability,
 * whose statement is imported and reconciled like a bank's.
 */
export type BankAccountKind = BankDetailType | "credit_card";

/** The kinds the bank setup screen offers: the bank details, then a credit card. */
export const BANK_SETUP_KINDS: BankAccountKind[] = [...BANK_SETUP_DETAIL_TYPES, "credit_card"];

export function bankKindLabel(kind: BankAccountKind): string {
  return kind === "credit_card" ? "Credit card" : bankDetailLabel(kind);
}

const postable = (account: LedgerAccountLike) => account.is_posting_account && account.status === "active";

/**
 * The ledger accounts a bank account may be attached to: active, posting,
 * Bank-type and not the cash tin, or (2.45) Credit Card-type. Unclassified
 * Bank-type accounts are kept — a chart written before the classifications
 * existed still has to be usable — but a cash-on-hand account is never
 * offered, whatever else it might match. A credit card asks for card accounts
 * only; a bank detail for bank accounts only.
 */
export function selectableBankLedgerAccounts<T extends LedgerAccountLike>(
  accounts: readonly T[],
  options: { detail?: BankAccountKind | null } = {},
): T[] {
  const banks = accounts.filter(
    (account) => account.account_type === "bank" && postable(account) && holdsBankStatement(account.detail_type),
  );
  const cards = accounts.filter((account) => account.account_type === "credit_card" && postable(account));
  if (!options.detail) return [...banks, ...cards];
  if (options.detail === "credit_card") return cards;
  // The chosen kind first; unclassified accounts stay available behind them.
  return banks.filter((account) => account.detail_type === options.detail || account.detail_type === null);
}

/**
 * The account to offer once a kind is chosen: the single exact match if there
 * is one, otherwise nothing. Two candidates is a choice for the person setting
 * it up, not something to guess at. For a credit card, the only card account.
 */
export function suggestBankLedgerAccount<T extends LedgerAccountLike>(
  accounts: readonly T[],
  detail: BankAccountKind,
): T | null {
  const exact =
    detail === "credit_card"
      ? selectableBankLedgerAccounts(accounts, { detail })
      : selectableBankLedgerAccounts(accounts).filter(
          (account) => account.account_type === "bank" && account.detail_type === detail,
        );
  return exact.length === 1 ? exact[0] : null;
}

/** A ledger account the setup screen proposes to create. */
export interface NewLedgerAccount {
  account_code: string;
  name: string;
  account_type: "bank" | "credit_card";
  /** The Bank-type detail; null for a credit card, which has none. */
  detail_type: BankDetailType | null;
}

/**
 * What to call a ledger account the user is about to create for this kind, and
 * the first free code in its block: 1010 up for a bank account, the range a US
 * chart keeps its cash in; 2010 up for a credit card, among the current
 * liabilities.
 */
export function suggestNewLedgerAccount<T extends LedgerAccountLike>(
  accounts: readonly T[],
  detail: BankAccountKind,
  bankName?: string | null,
): NewLedgerAccount {
  const used = new Set(accounts.map((account) => account.account_code));
  const card = detail === "credit_card";
  const first = card ? 2010 : 1010;
  let code = first;
  while (used.has(String(code)) && code < first + 90) code += 10;

  const base = card ? "Credit card" : LABELS[detail];
  const named = bankName?.trim() ? `${bankName.trim()} ${base.toLowerCase()}` : base;
  return card
    ? { account_code: String(code), name: named, account_type: "credit_card", detail_type: null }
    : { account_code: String(code), name: named, account_type: "bank", detail_type: detail };
}
