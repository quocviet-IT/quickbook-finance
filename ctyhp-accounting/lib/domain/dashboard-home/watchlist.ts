/**
 * The account watchlist (3.0.39): up to ten accounts a person picks, each with
 * this month's activity, last month's, and the figure the Chart of Accounts
 * shows for it.
 *
 * Pure. Every figure is built with `chartFigures`, the Chart of Accounts' own
 * rule, so the watchlist and that page can never disagree about an account:
 * each is on the account's normal side, a contra account's the other way.
 */
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/domain/accounts";
import { chartFigures } from "@/lib/domain/chart-groups";

/** How many accounts a watchlist holds (the database holds it to the same). */
export const WATCHLIST_MAX = 10;

export interface HomeWatchRow {
  accountId: string;
  code: string;
  name: string;
  /** "Income", "Accounts Payable" */
  typeLabel: string;
  /** The month to date's activity on the account's normal side. */
  thisMonthMinor: number;
  /** The whole previous month's activity, the same way. */
  lastMonthMinor: number;
  /** The Chart of Accounts figure: this fiscal year for income and expense accounts, every other since the books began. */
  balanceMinor: number;
}

/** An account the picker offers. */
export interface HomeWatchChoice {
  id: string;
  code: string;
  name: string;
  typeLabel: string;
}

/** The part of a chart account the watchlist reads. */
export interface WatchAccount {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
  is_contra: boolean;
}

/** A ledger read's rows: debits and credits by account. */
interface LedgerSide {
  accountId: string;
  debitBase: number;
  creditBase: number;
}

export interface WatchRowsInput {
  /** The person's account ids, in their order. */
  ids: readonly string[];
  accounts: readonly WatchAccount[];
  /** Each account's activity in the month to date. */
  thisMonth: readonly LedgerSide[];
  /** Each account's activity in the whole previous month. */
  lastMonth: readonly LedgerSide[];
  /** Every account's balance from the start of the books to asOf. */
  sinceTheBooksBegan: readonly LedgerSide[];
  /** Every account's activity from the fiscal year's first day to asOf. */
  fiscalYearToDate: readonly LedgerSide[];
}

/**
 * One row per chosen account still in the chart, in the person's order, at
 * most ten. An id no longer in the chart (an account deleted since) is left out.
 */
export function watchRows(input: WatchRowsInput): HomeWatchRow[] {
  const byId = new Map(input.accounts.map((account) => [account.id, account]));
  const chosen: WatchAccount[] = [];
  for (const id of input.ids) {
    const account = byId.get(id);
    if (account && !chosen.includes(account)) chosen.push(account);
    if (chosen.length === WATCHLIST_MAX) break;
  }
  // The same rows on both sides: each month's figure is the activity itself, signed as the chart signs it.
  const thisMonth = chartFigures(chosen, input.thisMonth, input.thisMonth);
  const lastMonth = chartFigures(chosen, input.lastMonth, input.lastMonth);
  const balance = chartFigures(chosen, input.sinceTheBooksBegan, input.fiscalYearToDate);
  return chosen.map((account) => ({
    accountId: account.id,
    code: account.account_code,
    name: account.name,
    typeLabel: ACCOUNT_TYPE_LABEL[account.account_type] ?? account.account_type,
    thisMonthMinor: thisMonth[account.id] || 0,
    lastMonthMinor: lastMonth[account.id] || 0,
    balanceMinor: balance[account.id] || 0,
  }));
}

/** The accounts the picker offers: every active account, by code. */
export function watchChoices(accounts: readonly (WatchAccount & { status: string })[]): HomeWatchChoice[] {
  return accounts
    .filter((account) => account.status === "active")
    .sort((a, b) => a.account_code.localeCompare(b.account_code, "en-US", { numeric: true }))
    .map((account) => ({
      id: account.id,
      code: account.account_code,
      name: account.name,
      typeLabel: ACCOUNT_TYPE_LABEL[account.account_type] ?? account.account_type,
    }));
}
