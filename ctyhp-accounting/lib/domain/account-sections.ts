/**
 * The chart of accounts read by section: the headings the client's retail and
 * jewelry chart is organised under, for every company, derived from each
 * account's type (and, for money in transit, its detail type) — so a chart
 * numbered any way still reads in the same order.
 *
 * Pure: accounts in, sections of nested rows out.
 */
import type { AccountType } from "./accounts";
import { isBankSectionDetail } from "./account-detail";

export type AccountSectionKey =
  | "bank"
  | "receivables_inventory"
  | "non_current_assets"
  | "current_liabilities"
  | "non_current_liabilities"
  | "equity"
  | "income"
  | "cogs"
  | "operating_expenses"
  | "other_expenses";

export const ACCOUNT_SECTIONS: readonly { key: AccountSectionKey; title: string }[] = [
  { key: "bank", title: "Current Assets – Bank Accounts" },
  { key: "receivables_inventory", title: "Current Assets – Receivables & Inventory" },
  { key: "non_current_assets", title: "Non-current Assets" },
  { key: "current_liabilities", title: "Current Liabilities" },
  { key: "non_current_liabilities", title: "Non-current Liabilities" },
  { key: "equity", title: "Equity" },
  { key: "income", title: "Income" },
  { key: "cogs", title: "Cost of Goods Sold" },
  { key: "operating_expenses", title: "Operating Expenses" },
  { key: "other_expenses", title: "Other Expenses" },
];

export function sectionOf(account: { account_type: AccountType; detail_type: string | null }): AccountSectionKey {
  switch (account.account_type) {
    case "bank":
      return "bank";
    case "current_asset":
      return isBankSectionDetail(account.detail_type) ? "bank" : "receivables_inventory";
    case "accounts_receivable":
      return "receivables_inventory";
    case "fixed_asset":
      return "non_current_assets";
    case "accounts_payable":
    case "credit_card":
    case "current_liability":
      return "current_liabilities";
    case "long_term_liability":
      return "non_current_liabilities";
    case "equity":
      return "equity";
    case "income":
    case "other_income":
      return "income";
    case "cost_of_goods_sold":
      return "cogs";
    case "expense":
      return "operating_expenses";
    case "other_expense":
      return "other_expenses";
  }
}

/** Account codes in number order: 90, 400, 1000 — not 1000, 400, 90. */
export function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export interface SectionAccount {
  id: string;
  account_code: string;
  account_type: AccountType;
  detail_type: string | null;
  parent_account_id: string | null;
}

export interface AccountTreeRow<T> {
  account: T;
  /** 0 for a top-level account; each sub-account level adds one. */
  depth: number;
}

export interface AccountSection<T> {
  key: AccountSectionKey;
  title: string;
  rows: AccountTreeRow<T>[];
}

function treeRows<T extends SectionAccount>(members: readonly T[]): AccountTreeRow<T>[] {
  const ids = new Set(members.map((m) => m.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const m of members) {
    const parent = m.parent_account_id;
    if (parent && parent !== m.id && ids.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(m);
      children.set(parent, list);
    } else {
      roots.push(m);
    }
  }
  const out: AccountTreeRow<T>[] = [];
  const seen = new Set<string>();
  const walk = (list: readonly T[], depth: number) => {
    for (const a of [...list].sort((x, y) => compareCodes(x.account_code, y.account_code))) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ account: a, depth });
      walk(children.get(a.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  // Accounts caught in a loop are reached from no root: list them at the top.
  walk(members.filter((m) => !seen.has(m.id)), 0);
  return out;
}

/**
 * The groups that have accounts, in the order given, each as a tree in code
 * order. A sub-account nests under its parent only when both are in the same
 * group; otherwise it stands at the top of its own group.
 */
export function accountGroups<T extends SectionAccount, K extends string>(
  accounts: readonly T[],
  groups: readonly { key: K; title: string }[],
  groupOf: (account: T) => K,
): { key: K; title: string; rows: AccountTreeRow<T>[] }[] {
  const byGroup = new Map<K, T[]>();
  for (const a of accounts) {
    const key = groupOf(a);
    const list = byGroup.get(key) ?? [];
    list.push(a);
    byGroup.set(key, list);
  }
  return groups.flatMap(({ key, title }) => {
    const members = byGroup.get(key);
    return members && members.length > 0 ? [{ key, title, rows: treeRows(members) }] : [];
  });
}

/** The sections that have accounts, in order, each as a tree in code order. */
export function accountSections<T extends SectionAccount>(accounts: readonly T[]): AccountSection<T>[] {
  return accountGroups(accounts, ACCOUNT_SECTIONS, sectionOf);
}

/**
 * The accounts a search found, with the parents above them, so each match
 * reads in its place in the tree rather than stranded at the top of its section.
 */
export function withAncestors<T extends SectionAccount>(all: readonly T[], matches: readonly T[]): T[] {
  const byId = new Map(all.map((a) => [a.id, a]));
  const keep = new Set(matches.map((m) => m.id));
  for (const m of matches) {
    let parentId = m.parent_account_id;
    // Stops at a parent already kept, which is also what ends a loop.
    while (parentId && !keep.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) break;
      keep.add(parent.id);
      parentId = parent.parent_account_id;
    }
  }
  return all.filter((a) => keep.has(a.id));
}

/**
 * The accounts that may be the parent of an account of `type`: a sub-account
 * has its parent's type (migration 0125 refuses anything else), and an account
 * is never its own parent.
 */
export function parentChoices<T extends SectionAccount>(
  accounts: readonly T[],
  type: AccountType | undefined,
  selfId: string | null,
): T[] {
  return accounts.filter((a) => a.id !== selfId && (type === undefined || a.account_type === type));
}
