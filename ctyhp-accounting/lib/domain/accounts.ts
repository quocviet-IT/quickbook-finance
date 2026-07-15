/**
 * Pure Chart-of-Accounts domain rules.
 *
 * Account type is the single source of truth for how an account behaves:
 * whether its normal balance is debit or credit, and whether it appears on
 * the Balance Sheet or the Profit & Loss statement. These derivations are
 * pure functions — never stored — so they cannot drift out of sync.
 *
 * Grounded in QUICKBOOK_USER_MANUAL/06_Chart_of_Accounts.md §5.
 */

export const ACCOUNT_TYPES = [
  "bank",
  "accounts_receivable",
  "current_asset",
  "fixed_asset",
  "accounts_payable",
  "credit_card",
  "current_liability",
  "equity",
  "income",
  "cost_of_goods_sold",
  "expense",
  "other_income",
  "other_expense",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type NormalBalance = "debit" | "credit";
export type StatementSection = "balance_sheet" | "profit_and_loss";

const DEBIT_NORMAL: ReadonlySet<AccountType> = new Set<AccountType>([
  "bank",
  "accounts_receivable",
  "current_asset",
  "fixed_asset",
  "cost_of_goods_sold",
  "expense",
  "other_expense",
]);

const PROFIT_AND_LOSS: ReadonlySet<AccountType> = new Set<AccountType>([
  "income",
  "cost_of_goods_sold",
  "expense",
  "other_income",
  "other_expense",
]);

/** The side on which this account type increases. */
export function normalBalanceOf(type: AccountType): NormalBalance {
  return DEBIT_NORMAL.has(type) ? "debit" : "credit";
}

/** Which financial statement this account type belongs to. */
export function statementSectionOf(type: AccountType): StatementSection {
  return PROFIT_AND_LOSS.has(type) ? "profit_and_loss" : "balance_sheet";
}

/**
 * Signed balance in the account's own natural direction.
 * A positive result means the account carries its normal balance.
 */
export function naturalBalance(
  type: AccountType,
  debitTotalMinor: number,
  creditTotalMinor: number,
): number {
  const raw = debitTotalMinor - creditTotalMinor;
  return normalBalanceOf(type) === "debit" ? raw : -raw;
}

/**
 * Validate a proposed parent chain for cycles.
 * `parentOf` returns the parent id of an account, or null at the root.
 * Throws if attaching `childId` under `newParentId` would create a cycle.
 */
export function assertNoCycle(
  childId: string,
  newParentId: string | null,
  parentOf: (id: string) => string | null,
): void {
  let cursor: string | null = newParentId;
  const guard = new Set<string>();
  while (cursor !== null) {
    if (cursor === childId) {
      throw new Error(`Account hierarchy cycle: ${childId} cannot be its own ancestor`);
    }
    if (guard.has(cursor)) {
      // Pre-existing cycle in stored data — stop rather than loop forever.
      throw new Error(`Existing account hierarchy cycle detected at ${cursor}`);
    }
    guard.add(cursor);
    cursor = parentOf(cursor);
  }
}
