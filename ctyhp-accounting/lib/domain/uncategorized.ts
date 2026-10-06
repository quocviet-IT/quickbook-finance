/**
 * The two holding accounts a bank line goes to when nothing places it
 * (migration 0134): Uncategorized Income for money in, Uncategorized Expense
 * for money out. Known by their detail type, never by name or code — a chart
 * keeps whatever code its own convention gave them.
 */
export const HOLDING_DETAIL_TYPES = ["uncategorized_income", "uncategorized_expense"] as const;
export type HoldingDetailType = (typeof HOLDING_DETAIL_TYPES)[number];

export function isHoldingDetail(detail: string | null | undefined): detail is HoldingDetailType {
  return (HOLDING_DETAIL_TYPES as readonly string[]).includes(detail ?? "");
}

export interface HoldingAccount {
  id: string;
  /** "6999 — Uncategorized Expense" */
  label: string;
}

export interface HoldingAccounts {
  income: HoldingAccount | null;
  expense: HoldingAccount | null;
}

interface AccountLike {
  id: string;
  account_code: string;
  name: string;
  detail_type: string | null;
  status: string;
}

export function holdingAccountsOf(accounts: readonly AccountLike[]): HoldingAccounts {
  const find = (detail: HoldingDetailType): HoldingAccount | null => {
    const account = accounts.find((a) => a.detail_type === detail && a.status === "active");
    return account ? { id: account.id, label: `${account.account_code} — ${account.name}` } : null;
  };
  return { income: find("uncategorized_income"), expense: find("uncategorized_expense") };
}

/** The ids of the holding accounts in a chart, for telling a posting that sits in one. */
export function holdingAccountIds(accounts: readonly AccountLike[]): Set<string> {
  return new Set(accounts.filter((a) => isHoldingDetail(a.detail_type)).map((a) => a.id));
}

/** A line coded to Uncategorized and not recoded yet — what Bank Transactions' "Needs coding" lists. */
export function needsCoding(postedToAccountId: string | null | undefined, holdingIds: ReadonlySet<string>, recoded: boolean): boolean {
  return Boolean(postedToAccountId && holdingIds.has(postedToAccountId) && !recoded);
}
