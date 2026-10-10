/**
 * The Chart of Accounts screen's list: which accounts a view shows, what the
 * search and the type pills keep, and the rows the table draws — a heading for
 * each group, then the group's accounts as a tree.
 *
 * Pure: accounts and figures in, rows and counts out. Which group an account
 * falls under and what its figure is are lib/domain/chart-groups.ts.
 */
import { accountGroups, withAncestors, type SectionAccount } from "./account-sections";
import {
  CHART_GROUPS,
  chartClassOf,
  chartGroupOf,
  filterCounts,
  type ChartClass,
  type ChartGroupKey,
  type ChartStatement,
} from "./chart-groups";

/** Balances is the default: every account with its figure. Setup is the same list with type, cash flow and status. */
export type ChartView = "balances" | "setup";

/** `?view=setup` opens Setup; anything else, or nothing, opens Balances. */
export function chartViewOf(param: string | string[] | null | undefined): ChartView {
  const value = Array.isArray(param) ? param[0] : param;
  return value === "setup" ? "setup" : "balances";
}

/** The address of a view. Balances is the default, so it carries no parameter. */
export function chartViewHref(view: ChartView): string {
  return view === "setup" ? "/accounts?view=setup" : "/accounts";
}

/**
 * The fiscal year's first month, read off the start date the figures were
 * worked out from (`fiscalYearStartFor` always names the 1st of that month),
 * so what a click opens covers the same dates as the figure clicked.
 */
export function fiscalStartMonthOf(fiscalYearStart: string): number {
  const month = Number(fiscalYearStart.slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1;
}

/** Inactive and archived accounts are out of use, though they may still hold money. */
export function isRetired(status: string): boolean {
  return status === "inactive" || status === "archived";
}

/**
 * The accounts a view lists. Setup lists every account. Balances leaves out an
 * account that is out of use and holds nothing, and keeps one that still does.
 */
export function accountsInView<T extends { id: string; status: string }>(
  accounts: readonly T[],
  figures: Readonly<Record<string, number>>,
  view: ChartView,
): T[] {
  if (view === "setup") return [...accounts];
  return accounts.filter((a) => !isRetired(a.status) || (figures[a.id] ?? 0) !== 0);
}

/** A search matches the code or the name, ignoring case. An empty search matches everything. */
export function matchesAccountSearch(account: { account_code: string; name: string }, search: string): boolean {
  const q = search.trim().toLowerCase();
  return q === "" || account.account_code.toLowerCase().includes(q) || account.name.toLowerCase().includes(q);
}

export type ChartFilter = "all" | ChartClass;

export interface ChartListAccount extends SectionAccount {
  name: string;
  status: string;
}

/** A group's heading row: its title, and how many accounts are listed under it. */
export interface ChartGroupHeading {
  kind: "group";
  key: string;
  group: ChartGroupKey;
  title: string;
  statement: ChartStatement;
  count: number;
}

export interface ChartAccountLine<T> {
  kind: "account";
  key: string;
  account: T;
  /** 0 for a top-level account; each sub-account level adds one. */
  depth: number;
}

export type ChartListRow<T> = ChartGroupHeading | ChartAccountLine<T>;

export interface ChartListOptions<T> {
  figures: Readonly<Record<string, number>>;
  inventoryAccountIds: ReadonlySet<string>;
  view: ChartView;
  search: string;
  filter: ChartFilter;
  /** A further narrowing applied with the search, such as Setup's cash flow role. */
  keep?: (account: T) => boolean;
}

export interface ChartListing<T> {
  rows: ChartListRow<T>[];
  /** The pills' counts: what the search found, by class. */
  counts: Record<ChartFilter, number>;
  /** Accounts both the search and the pill keep. The parents listed with them are not counted. */
  matched: number;
  /** For the lede: every account the view lists, before any search. */
  total: number;
  /** For the lede: how many of those carry a balance. */
  withBalance: number;
}

/**
 * The list a view draws. A match reads in its place in the tree, so the parents
 * above it come along; the pill counts follow the search, not the pill.
 */
export function chartListing<T extends ChartListAccount>(
  accounts: readonly T[],
  { figures, inventoryAccountIds, view, search, filter, keep }: ChartListOptions<T>,
): ChartListing<T> {
  const universe = accountsInView(accounts, figures, view);
  const searched = universe.filter((a) => matchesAccountSearch(a, search) && (!keep || keep(a)));
  const matches = filter === "all" ? searched : searched.filter((a) => chartClassOf(a.account_type) === filter);
  const narrowed = search.trim() !== "" || filter !== "all" || keep !== undefined;
  const listed = narrowed ? withAncestors(universe, matches) : universe;

  const statementOfGroup = new Map(CHART_GROUPS.map((g) => [g.key, g.statement]));
  const rows = accountGroups(listed, CHART_GROUPS, (a) => chartGroupOf(a, inventoryAccountIds)).flatMap(
    (group): ChartListRow<T>[] => [
      {
        kind: "group",
        key: `group:${group.key}`,
        group: group.key,
        title: group.title,
        statement: statementOfGroup.get(group.key) ?? "balance_sheet",
        count: group.rows.length,
      },
      ...group.rows.map(({ account, depth }): ChartAccountLine<T> => ({ kind: "account", key: account.id, account, depth })),
    ],
  );

  return {
    rows,
    counts: filterCounts(searched),
    matched: matches.length,
    total: universe.length,
    withBalance: universe.filter((a) => (figures[a.id] ?? 0) !== 0).length,
  };
}

/**
 * A figure as the chart prints it. A negative one is the wrong way round for
 * its account, and reads in parentheses: `($4,200.00)`.
 */
export function chartFigureText(minor: number, money: (minor: number) => string): string {
  if (minor === 0) return money(0);
  return minor < 0 ? `(${money(-minor)})` : money(minor);
}

/** The same figure as a screen reader says it: a parenthesis is easy to miss, "negative" is not. */
export function chartFigureSpoken(minor: number, money: (minor: number) => string): string {
  if (minor === 0) return money(0);
  return minor < 0 ? `negative ${money(-minor)}` : money(minor);
}

/** The accessible name of what opens an account: "Open 1000 Cash on Hand". */
export function openAccountLabel(account: { account_code: string; name: string }): string {
  return `Open ${account.account_code} ${account.name}`;
}
