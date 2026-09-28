/**
 * A financial statement, laid out as the client's prototype lays one out
 * (`reportPL`, `reportBS`, `reportTB`, `reportBudget` in Accounting-System-v3.html):
 * sections, accounts nested under their parent, subtotals, totals and a grand
 * total, one cell per column — and every figure a QuickZoom.
 *
 * Pure, and it computes no figure. Every amount comes from
 * `lib/domain/reports.ts`. What is added here is only for display — a parent
 * account's subtotal, a group's subtotal on the balance sheet — and the tests
 * hold each of those to the builders' own totals. Section and statement totals
 * are always the builders', never re-added.
 */

import type { AccountType } from "@/lib/domain/accounts";
import { percentOfIncome, type ProfitAndLoss, type ReportSection } from "@/lib/domain/reports";
import type { StatementColumnSpec } from "@/lib/domain/statement-columns";

/* ------------------------------------------------------------------ model */

export interface AccountRef {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
}

export type AccountIndex = ReadonlyMap<string, AccountRef>;

export function indexAccounts(accounts: readonly AccountRef[]): AccountIndex {
  return new Map(accounts.map((a) => [a.id, a]));
}

/** What clicking a figure opens: every posted line on these accounts in these dates. */
export interface ZoomSpec {
  title: string;
  accountIds: string[];
  /** Null for a point statement: all history up to `to`. */
  from: string | null;
  to: string;
  /** The amount that was clicked. The list it opens must add up to it. */
  figure: number;
}

export type StatementRowKind = "section" | "classhead" | "account" | "subtotal" | "total" | "grand" | "spacer" | "note";

export interface StatementCell {
  /** Minor units, base currency; null is a blank. */
  amount: number | null;
  zoom: ZoomSpec | null;
}

export type StatementTone = "favorable" | "unfavorable" | null;

export interface StatementRow {
  key: string;
  kind: StatementRowKind;
  label: string;
  depth: 0 | 1 | 2 | 3;
  /** An account row's account; its name opens that account's General Ledger. */
  accountId: string | null;
  cells: StatementCell[];
  /** % of income, per column, when the statement shows it. */
  percent?: (number | null)[];
  /** Two columns: the first less the second, and that as a % of the second. */
  change?: { amount: number; percent: number | null } | null;
  /** Budget vs Actual: whether the variance is good news. */
  tone?: StatementTone;
}

export type StatementColumn = StatementColumnSpec;

export interface Statement {
  title: string;
  columns: StatementColumn[];
  /** Headings of the two change columns, when the statement has them. */
  changeLabels: [string, string] | null;
  percent: boolean;
  rows: StatementRow[];
  empty: boolean;
  /** When a statement should balance and does not: by how much, in the first column that does not. */
  outOfBalance: number | null;
}

/* ------------------------------------------------------------------- rows */

interface Ctx {
  columns: readonly StatementColumn[];
  accounts: AccountIndex;
  /** Income per column, when % of income is shown. */
  percentBase: readonly number[] | null;
  change: boolean;
}

type Depth = StatementRow["depth"];
const depthOf = (n: number): Depth => Math.min(Math.max(n, 0), 3) as Depth;

export function changeOf(current: number, prior: number): { amount: number; percent: number | null } {
  const amount = current - prior;
  return { amount, percent: prior === 0 ? null : (amount / Math.abs(prior)) * 100 };
}

interface RowSpec {
  key: string;
  kind: StatementRowKind;
  label: string;
  depth?: number;
  accountId?: string | null;
  amounts?: readonly number[] | null;
  /** The accounts behind the figures. None: the figures are not links. */
  zoomIds?: readonly string[] | null;
  /** The dates a cell's zoom reads, when they are not its column's. */
  zoomRange?: (column: number) => { from: string | null; to: string };
  zoomTitle?: string;
}

function makeRow(ctx: Ctx, spec: RowSpec): StatementRow {
  const amounts = spec.amounts ?? null;
  const ids = spec.zoomIds && spec.zoomIds.length > 0 ? [...spec.zoomIds] : null;
  const cells: StatementCell[] = amounts
    ? amounts.map((amount, i) => {
        const range = spec.zoomRange ? spec.zoomRange(i) : { from: ctx.columns[i].from, to: ctx.columns[i].to };
        return {
          amount,
          zoom: ids ? { title: spec.zoomTitle ?? spec.label, accountIds: ids, from: range.from, to: range.to, figure: amount } : null,
        };
      })
    : ctx.columns.map(() => ({ amount: null, zoom: null }));
  const row: StatementRow = {
    key: spec.key,
    kind: spec.kind,
    label: spec.label,
    depth: depthOf(spec.depth ?? 0),
    accountId: spec.accountId ?? null,
    cells,
  };
  if (amounts && ctx.percentBase) {
    const base = ctx.percentBase;
    row.percent = amounts.map((a, i) => percentOfIncome(a, base[i]));
  }
  if (amounts && ctx.change) row.change = changeOf(amounts[0], amounts[1]);
  return row;
}

const sectionRow = (ctx: Ctx, key: string, label: string) => makeRow(ctx, { key, kind: "section", label });
const classheadRow = (ctx: Ctx, key: string, label: string) => makeRow(ctx, { key, kind: "classhead", label });
const noteRow = (ctx: Ctx, key: string, label: string) => makeRow(ctx, { key, kind: "note", label, depth: 1 });
const spacerRow = (ctx: Ctx, key: string) => makeRow(ctx, { key, kind: "spacer", label: "" });

/* ------------------------------------------------------ lines and the tree */

interface Leaf {
  key: string;
  accountId: string | null;
  code: string;
  name: string;
  amounts: number[];
}

type SectionLine = ReportSection["lines"][number];
const lineKey = (l: SectionLine) => l.accountId ?? `${l.accountCode}:${l.name}`;
const labelOf = (code: string, name: string) => (code ? `${code} ${name}` : name);

/**
 * Every line a section has in any column, in code order, 0 in a column that
 * lacks it — the pairing `compareReportLines` does for two columns.
 */
function leavesOf(sections: readonly ReportSection[]): Leaf[] {
  const byKey = new Map<string, Leaf>();
  sections.forEach((section, i) => {
    for (const line of section.lines) {
      const key = lineKey(line);
      let leaf = byKey.get(key);
      if (!leaf) {
        leaf = { key, accountId: line.accountId, code: line.accountCode, name: line.name, amounts: sections.map(() => 0) };
        byKey.set(key, leaf);
      }
      leaf.amounts[i] = line.amount;
    }
  });
  return [...byKey.values()].sort((a, b) => a.code.localeCompare(b.code));
}

const idsOf = (leaves: readonly Leaf[]): string[] => leaves.flatMap((l) => (l.accountId ? [l.accountId] : []));

function sumLeaves(leaves: readonly Leaf[], width: number): number[] {
  const total = new Array<number>(width).fill(0);
  for (const leaf of leaves) leaf.amounts.forEach((v, i) => (total[i] += v));
  return total;
}

interface TreeNode {
  key: string;
  accountId: string | null;
  code: string;
  label: string;
  own: number[] | null;
  children: TreeNode[];
}

const ofTypes =
  (...types: AccountType[]) =>
  (a: AccountRef) =>
    types.includes(a.type);

/**
 * Accounts under their parent, as the prototype's `buildTreeN` nests
 * `Assets:Bank:…`. A parent from another section, or a loop in the chart,
 * leaves an account at the top.
 */
function forest(leaves: readonly Leaf[], ctx: Ctx, inSection: (a: AccountRef) => boolean): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const nodeFor = (id: string, trail: ReadonlySet<string>): TreeNode => {
    const found = nodes.get(id);
    if (found) return found;
    const account = ctx.accounts.get(id)!;
    const node: TreeNode = { key: id, accountId: id, code: account.code, label: labelOf(account.code, account.name), own: null, children: [] };
    nodes.set(id, node);
    const parent = account.parentId ? ctx.accounts.get(account.parentId) : undefined;
    if (parent && inSection(parent) && !trail.has(parent.id)) {
      nodeFor(parent.id, new Set([...trail, id])).children.push(node);
    } else {
      roots.push(node);
    }
    return node;
  };
  for (const leaf of leaves) {
    if (leaf.accountId && ctx.accounts.has(leaf.accountId)) {
      nodeFor(leaf.accountId, new Set()).own = leaf.amounts;
    } else {
      roots.push({ key: leaf.key, accountId: leaf.accountId, code: leaf.code, label: labelOf(leaf.code, leaf.name), own: leaf.amounts, children: [] });
    }
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.code.localeCompare(b.code));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

function subtreeTotal(node: TreeNode, width: number): number[] {
  const total = node.own ? [...node.own] : new Array<number>(width).fill(0);
  for (const child of node.children) subtreeTotal(child, width).forEach((v, i) => (total[i] += v));
  return total;
}

const subtreeIds = (node: TreeNode): string[] => [
  ...(node.accountId ? [node.accountId] : []),
  ...node.children.flatMap(subtreeIds),
];

function renderTree(nodes: readonly TreeNode[], depth: number, ctx: Ctx, out: StatementRow[], prefix: string): void {
  for (const node of nodes) {
    out.push(
      makeRow(ctx, {
        key: `${prefix}:a:${node.key}`,
        kind: "account",
        label: node.label,
        depth,
        // A heading with nothing of its own may be a non-posting account the
        // General Ledger does not list, so only an account with a figure links there.
        accountId: node.own ? node.accountId : null,
        amounts: node.own,
        zoomIds: node.own && node.accountId ? [node.accountId] : null,
      }),
    );
    if (node.children.length === 0) continue;
    renderTree(node.children, depth + 1, ctx, out, prefix);
    out.push(
      makeRow(ctx, {
        key: `${prefix}:t:${node.key}`,
        kind: "subtotal",
        label: `Total ${node.label}`,
        depth,
        amounts: subtreeTotal(node, ctx.columns.length),
        zoomIds: subtreeIds(node),
      }),
    );
  }
}

/* ------------------------------------------------------- Profit and Loss */

export interface PnlStatementInput {
  columns: readonly StatementColumn[];
  /** One per column, in column order; a Total column's is `sumProfitAndLoss` of the others. */
  pnls: readonly ProfitAndLoss[];
  accounts: AccountIndex;
  showPercent: boolean;
  /** Two columns and a change pair (Previous period, Previous year). */
  change: boolean;
}

/** Following `reportPL`. */
export function pnlStatement(input: PnlStatementInput): Statement {
  const { pnls } = input;
  const ctx: Ctx = {
    columns: input.columns,
    accounts: input.accounts,
    percentBase: input.showPercent ? pnls.map((p) => p.income.total) : null,
    change: input.change,
  };
  const rows: StatementRow[] = [];
  const pick = (f: (p: ProfitAndLoss) => ReportSection) => pnls.map(f);
  const income = leavesOf(pick((p) => p.income));
  const cogs = leavesOf(pick((p) => p.costOfGoodsSold));
  const opex = leavesOf(pick((p) => p.operatingExpenses));
  const otherIncome = leavesOf(pick((p) => p.otherIncome));
  const otherExpenses = leavesOf(pick((p) => p.otherExpenses));

  const block = (
    key: string,
    title: string,
    leaves: Leaf[],
    types: AccountType[],
    totals: number[],
    emptyNote: string | null,
  ) => {
    rows.push(sectionRow(ctx, key, title));
    if (leaves.length === 0 && emptyNote) rows.push(noteRow(ctx, `${key}:note`, emptyNote));
    renderTree(forest(leaves, ctx, ofTypes(...types)), 1, ctx, rows, key);
    rows.push(makeRow(ctx, { key: `${key}:total`, kind: "total", label: `Total ${title}`, amounts: totals, zoomIds: idsOf(leaves) }));
  };

  block("income", "Income", income, ["income"], pick((p) => p.income).map((s) => s.total), "No income in this period");
  if (cogs.length > 0) {
    rows.push(spacerRow(ctx, "s-cogs"));
    block("cogs", "Cost of Goods Sold", cogs, ["cost_of_goods_sold"], pick((p) => p.costOfGoodsSold).map((s) => s.total), null);
    rows.push(spacerRow(ctx, "s-gross"));
    rows.push(
      makeRow(ctx, {
        key: "gross",
        kind: "total",
        label: "Gross Profit",
        amounts: pnls.map((p) => p.grossProfit),
        zoomIds: [...idsOf(income), ...idsOf(cogs)],
      }),
    );
  }
  rows.push(spacerRow(ctx, "s-opex"));
  block("opex", "Operating Expenses", opex, ["expense"], pick((p) => p.operatingExpenses).map((s) => s.total), "No expenses in this period");
  rows.push(spacerRow(ctx, "s-net-operating"));
  const operatingIds = [...idsOf(income), ...idsOf(cogs), ...idsOf(opex)];
  rows.push(
    makeRow(ctx, {
      key: "net-operating",
      kind: "total",
      label: "Net Operating Income",
      amounts: pnls.map((p) => p.grossProfit - p.operatingExpenses.total),
      zoomIds: operatingIds,
    }),
  );
  if (otherIncome.length > 0 || otherExpenses.length > 0) {
    rows.push(spacerRow(ctx, "s-other"));
    if (otherIncome.length > 0) {
      block("other-income", "Other Income", otherIncome, ["other_income"], pick((p) => p.otherIncome).map((s) => s.total), null);
    }
    if (otherExpenses.length > 0) {
      block("other-expenses", "Other Expenses", otherExpenses, ["other_expense"], pick((p) => p.otherExpenses).map((s) => s.total), null);
    }
    rows.push(
      makeRow(ctx, {
        key: "net-other",
        kind: "total",
        label: "Net Other Income",
        amounts: pnls.map((p) => p.otherIncome.total - p.otherExpenses.total),
        zoomIds: [...idsOf(otherIncome), ...idsOf(otherExpenses)],
      }),
    );
  }
  rows.push(spacerRow(ctx, "s-net"));
  rows.push(
    makeRow(ctx, {
      key: "net-income",
      kind: "grand",
      label: "Net Income",
      amounts: pnls.map((p) => p.netIncome),
      zoomIds: [...operatingIds, ...idsOf(otherIncome), ...idsOf(otherExpenses)],
    }),
  );

  return {
    title: "Profit and Loss",
    columns: [...input.columns],
    changeLabels: input.change ? ["Change", "%"] : null,
    percent: input.showPercent,
    rows,
    empty: [income, cogs, opex, otherIncome, otherExpenses].every((l) => l.length === 0),
    outOfBalance: null,
  };
}
