/**
 * Balance Comparison: OneBook's balances beside another ledger's, at a date.
 *
 * Pure: accounts, OneBook's figures and the typed figures in, rows, totals,
 * sentences and an export sheet out. It ships to the browser, so it imports no
 * PDF module and only the small date and account helpers.
 *
 * Every figure here is in base-currency minor units and in the account's
 * natural sign, the way a balance sheet prints it: assets and expenses are
 * positive on the debit side, liabilities, equity and income positive on the
 * credit side. The typed figure is read in the same sign, so the difference is
 * a plain subtraction.
 */
import type { AccountType, NormalBalance } from "./accounts";
import { chartClassOf, type ChartClass } from "./chart-groups";
import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { formatDate, plural } from "@/lib/format";
import { parseStatementAmount } from "./statement-import";

/* ------------------------------------------------------------------ groups */

export type ComparisonGroup = ChartClass;

/** The five groups, in the order a balance sheet and a profit and loss print them. */
export const COMPARISON_GROUPS: readonly {
  key: ComparisonGroup;
  title: string;
  totalLabel: string;
  side: NormalBalance;
}[] = [
  { key: "asset", title: "Assets", totalLabel: "Total assets", side: "debit" },
  { key: "liability", title: "Liabilities", totalLabel: "Total liabilities", side: "credit" },
  { key: "equity", title: "Equity", totalLabel: "Total equity", side: "credit" },
  { key: "income", title: "Income", totalLabel: "Total income", side: "credit" },
  { key: "expense", title: "Expenses", totalLabel: "Total expenses", side: "debit" },
];

export function comparisonGroupOf(type: AccountType): ComparisonGroup {
  return chartClassOf(type);
}

/** The side an account that exists only in the other system is read on, from the group chosen for it. */
export function sideOfGroup(group: ComparisonGroup): NormalBalance {
  return group === "asset" || group === "expense" ? "debit" : "credit";
}

/* ------------------------------------------------------------------ parser */

export type ExternalBalance =
  | { ok: true; minor: number | null }
  | { ok: false; error: string };

const CURRENCY_SYMBOL = /^[$€£¥]/;
const SUFFIX = /\s*(CR|DR)\.?$/i;

/** A US-style amount: thousands commas, at most `decimals` places, nothing else. */
function amountPattern(decimals: number): RegExp {
  const places = decimals > 0 ? `\\.\\d{1,${decimals}}` : "";
  const whole = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)";
  return new RegExp(`^(?:${whole}(?:${places})?${places ? `|${places}` : ""})$`);
}

/**
 * The figure as it is read off the other system's report, in the account's
 * natural sign.
 *
 * Accepted: `1,234.56`, `$1,234.56`, `(1,234.56)`, a leading or trailing minus,
 * the Unicode minus (U+2212), non-breaking spaces, and a `CR` or `DR` suffix.
 * `CR` makes a debit-natural figure negative and `DR` makes a credit-natural
 * one negative; the suffix on the account's own side changes nothing.
 *
 * A blank box is "no figure" (`minor: null`). Anything else that is not a
 * number is an error and is never read as zero. The thousands commas are
 * stripped before `parseStatementAmount` sees the text, because it reads a
 * lone comma as a decimal point.
 */
export function parseExternalBalance(raw: string, naturalSide: NormalBalance, decimals = 2): ExternalBalance {
  const shown = (raw ?? "")
    .replace(/[   ]/g, " ")
    .trim();
  if (shown === "") return { ok: true, minor: null };
  const fail = (): ExternalBalance => ({ ok: false, error: `Not a number: ${shown}` });

  let text = shown.replace(/−/g, "-");
  let negatives = 0;

  const suffix = text.match(SUFFIX);
  if (suffix) {
    text = text.slice(0, suffix.index).trim();
    const credit = suffix[1].toUpperCase() === "CR";
    // The suffix names the side the figure sits on: against the account's own side it is negative.
    if ((credit && naturalSide === "debit") || (!credit && naturalSide === "credit")) negatives += 1;
  }

  // Peel brackets, signs and a currency symbol, in any order they were printed.
  for (let guard = 0; guard < 6; guard += 1) {
    text = text.trim();
    if (/^\(.*\)$/.test(text)) {
      negatives += 1;
      text = text.slice(1, -1);
    } else if (text.startsWith("-")) {
      negatives += 1;
      text = text.slice(1);
    } else if (text.startsWith("+")) {
      text = text.slice(1);
    } else if (text.endsWith("-")) {
      negatives += 1;
      text = text.slice(0, -1);
    } else if (CURRENCY_SYMBOL.test(text)) {
      text = text.slice(1);
    } else {
      break;
    }
  }

  text = text.trim();
  // Two minus signs, or a minus inside brackets, is not something to guess at.
  if (negatives > 1 || !amountPattern(decimals).test(text)) return fail();

  const magnitude = parseStatementAmount(text.replace(/,/g, ""), decimals);
  if (magnitude === null || !Number.isSafeInteger(magnitude)) return fail();
  const minor = negatives === 1 ? -magnitude : magnitude;
  // Minus zero is zero.
  return { ok: true, minor: minor === 0 ? 0 : minor };
}

/** A figure written back into its box: `-1,234.56`, plain, with no symbol. */
export function formatFigureText(minor: number, decimals: number): string {
  return fromMinor(minor, decimals).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/* ----------------------------------------------------------------- sentences */

/** Under the heading: how the OneBook column is read. */
export const BALANCE_BASIS_NOTE =
  "Balance sheet accounts as at the date; income and expenses for the year to date.";

/** What a comparison is called when its other system has not been named yet. */
export const UNNAMED_OTHER_SYSTEM = "the other system";

/** `Balance Comparison as of 09/30/2026 · OneBook and QuickBooks` */
export function balanceComparisonHeading(asOf: string, comparedWith: string): string {
  const name = comparedWith.trim() || UNNAMED_OTHER_SYSTEM;
  return `Balance Comparison as of ${formatDate(asOf)} · OneBook and ${name}`;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The saved comparison closest to `asOf` in days (the earlier one on a tie), other than `asOf` itself. */
export function nearestSavedDate(asOf: string, savedDates: readonly string[]): string | null {
  const target = dayNumber(asOf);
  let best: string | null = null;
  let bestGap = Infinity;
  for (const date of savedDates) {
    if (date === asOf) continue;
    const gap = Math.abs(dayNumber(date) - target);
    if (gap < bestGap || (gap === bestGap && best !== null && date < best)) {
      best = date;
      bestGap = gap;
    }
  }
  return best;
}

export interface NothingTyped {
  /** The whole sentence. */
  text: string;
  /** The sentence cut around the date that links to the nearest comparison; null when there is none. */
  parts: { before: string; date: string; after: string } | null;
  /** The ISO date the link opens. */
  nearest: string | null;
}

/**
 * What a date with nothing saved says:
 * `Nothing has been typed for 09/30/2026. The nearest saved comparison is 08/31/2026.`
 */
export function nothingTypedMessage(asOf: string, savedDates: readonly string[]): NothingTyped {
  const nearest = nearestSavedDate(asOf, savedDates);
  const first = `Nothing has been typed for ${formatDate(asOf)}.`;
  if (!nearest) return { text: first, parts: null, nearest: null };
  const before = `${first} The nearest saved comparison is `;
  const date = formatDate(nearest);
  return { text: `${before}${date}.`, parts: { before, date, after: "." }, nearest };
}

/** `Saved 4 figures for 09/30/2026.` */
export function savedMessage(count: number, asOf: string): string {
  return `Saved ${plural(count, "figure")} for ${formatDate(asOf)}.`;
}

/** What Only differences says when no row differs. */
export const NO_DIFFERENCES = "No differences to show.";

/** What the page says when the comparison could not be read; the cause is logged on the server. */
export const LOAD_FAILED = "The comparison could not be loaded. Try again in a moment.";

export const INACTIVE_ROW_NOTE = "This account is inactive; its figure is not saved again.";

/* ---------------------------------------------------------------- rows */

export interface ComparisonAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isContra: boolean;
  active: boolean;
}

/** An account only the other system has, added on this screen or read back from a saved comparison. */
export interface ExternalRow {
  /** `x:` and the lower-cased code, which is unique on a date. */
  key: string;
  code: string;
  name: string;
  group: ComparisonGroup;
}

export const accountRowKey = (accountId: string) => `a:${accountId}`;
export const externalRowKey = (code: string) => `x:${code.trim().toLowerCase()}`;

/** One saved line, as the service reads it. */
export interface SavedLine {
  accountId: string | null;
  externalCode: string | null;
  externalName: string | null;
  /** The group the line was typed under; null only for an account of this ledger. */
  externalGroup: ComparisonGroup | null;
  otherMinor: number;
}

/** What a saved comparison puts back on the screen: typed figures by row, and the external-only rows. */
export function hydrateSaved(
  lines: readonly SavedLine[],
): { typed: Record<string, number>; externals: ExternalRow[] } {
  const typed: Record<string, number> = {};
  const externals: ExternalRow[] = [];
  for (const line of lines) {
    if (line.accountId) {
      typed[accountRowKey(line.accountId)] = line.otherMinor;
    } else if (line.externalCode && line.externalName) {
      const row: ExternalRow = {
        key: externalRowKey(line.externalCode),
        code: line.externalCode,
        name: line.externalName,
        // A line saved without a group still shows, in Assets.
        group: line.externalGroup ?? "asset",
      };
      externals.push(row);
      typed[row.key] = line.otherMinor;
    }
  }
  return { typed, externals };
}

export interface ComparisonRow {
  key: string;
  accountId: string | null;
  code: string;
  name: string;
  group: ComparisonGroup;
  side: NormalBalance;
  /** An account only the other system has. */
  external: boolean;
  /** An account that has since gone inactive: shown with its saved figure, read-only, and not saved again. */
  inactive: boolean;
  onebookMinor: number;
  /** Null until a figure is typed. */
  otherMinor: number | null;
  /** OneBook minus the other system; null until a figure is typed. */
  differenceMinor: number | null;
}

export interface ComparisonTotals {
  onebookMinor: number;
  /** The sum of the figures typed; null when none is. */
  otherMinor: number | null;
  /** The sum of the differences shown; null when none is. */
  differenceMinor: number | null;
}

export interface ComparisonGroupView {
  key: ComparisonGroup;
  title: string;
  totalLabel: string;
  rows: ComparisonRow[];
  totals: ComparisonTotals;
}

export interface Comparison {
  groups: ComparisonGroupView[];
  /** Debits less credits over every row, each on its own side: nil for OneBook on a balanced ledger. */
  grand: ComparisonTotals;
  /** How many rows carry a typed figure. */
  typedCount: number;
  /** How many rows differ. */
  differenceCount: number;
}

function totalsOf(rows: readonly ComparisonRow[], debitsLessCredits = false): ComparisonTotals {
  let onebook = 0;
  let other = 0;
  let difference = 0;
  let anyOther = false;
  for (const row of rows) {
    const sign = debitsLessCredits && row.side === "credit" ? -1 : 1;
    onebook += sign * row.onebookMinor;
    if (row.otherMinor !== null) {
      other += sign * row.otherMinor;
      anyOther = true;
    }
    if (row.differenceMinor !== null) difference += sign * row.differenceMinor;
  }
  return {
    onebookMinor: onebook,
    otherMinor: anyOther ? other : null,
    differenceMinor: anyOther ? difference : null,
  };
}

export interface BuildInput {
  accounts: readonly ComparisonAccount[];
  /** OneBook's balance by account id as the Chart of Accounts reads it (a contra account on its own side); an account never posted to is absent and reads as nil. */
  figures: Readonly<Record<string, number>>;
  /** The typed figure by row key; a missing key or null is "no figure". */
  typed: Readonly<Record<string, number | null | undefined>>;
  externals: readonly ExternalRow[];
}

/**
 * Every active account (nil when never posted to), the inactive accounts a
 * saved figure still points at, and the accounts only the other system has,
 * grouped and totalled.
 */
export function buildComparison(input: BuildInput): Comparison {
  const make = (
    base: Pick<ComparisonRow, "key" | "accountId" | "code" | "name" | "group" | "side" | "external" | "inactive">,
    onebookMinor: number,
  ): ComparisonRow => {
    const value = input.typed[base.key];
    const otherMinor = typeof value === "number" ? value : null;
    return {
      ...base,
      onebookMinor,
      otherMinor,
      differenceMinor: otherMinor === null ? null : onebookMinor - otherMinor,
    };
  };

  const byGroup = new Map<ComparisonGroup, ComparisonRow[]>(COMPARISON_GROUPS.map((g) => [g.key, []]));
  for (const account of input.accounts) {
    const key = accountRowKey(account.id);
    const balance = input.figures[account.id] ?? 0;
    // An inactive account is shown while a saved figure points at it or it still holds a balance.
    if (!account.active && typeof input.typed[key] !== "number" && balance === 0) continue;
    const group = comparisonGroupOf(account.type);
    byGroup.get(group)!.push(
      make(
        {
          key,
          accountId: account.id,
          code: account.code,
          name: account.name,
          group,
          // Every row is read on its group's side, as a balance sheet prints it.
          side: sideOfGroup(group),
          external: false,
          inactive: !account.active,
        },
        // `figures` reads a contra account on its own side (the Chart of
        // Accounts convention); here it carries its section's sign, so
        // Accumulated Depreciation is negative under Assets.
        account.isContra ? -balance : balance,
      ),
    );
  }
  for (const ext of input.externals) {
    byGroup.get(ext.group)!.push(
      make(
        {
          key: ext.key,
          accountId: null,
          code: ext.code,
          name: ext.name,
          group: ext.group,
          side: sideOfGroup(ext.group),
          external: true,
          inactive: false,
        },
        0,
      ),
    );
  }

  const groups = COMPARISON_GROUPS.map((g) => {
    const rows = byGroup.get(g.key)!;
    return { key: g.key, title: g.title, totalLabel: g.totalLabel, rows, totals: totalsOf(rows) };
  });
  const all = groups.flatMap((g) => g.rows);
  return {
    groups,
    grand: totalsOf(all, true),
    typedCount: all.filter((r) => r.otherMinor !== null).length,
    differenceCount: all.filter((r) => r.differenceMinor !== null && r.differenceMinor !== 0).length,
  };
}

/** Whether a row is marked: it has a typed figure and the two systems disagree. */
export function rowDiffers(row: Pick<ComparisonRow, "differenceMinor">): boolean {
  return row.differenceMinor !== null && row.differenceMinor !== 0;
}

/* ------------------------------------------------------------ table lines */

export type TableLine =
  | { kind: "heading"; key: string; label: string }
  | { kind: "row"; key: string; row: ComparisonRow }
  | { kind: "total"; key: string; label: string; totals: ComparisonTotals; grand: boolean };

export const GRAND_TOTAL_LABEL = "Debits less credits";

/**
 * The lines the table draws, in order: a heading, its accounts, its total, for
 * each group, then the whole-report total. "Only differences" keeps just the
 * rows that differ, and any row whose box is in error (`errorKeys`), so a figure
 * that does not read never disappears with its message; it drops a group with
 * none, and keeps the totals whole.
 */
export function tableLines(
  comparison: Comparison,
  onlyDifferences: boolean,
  errorKeys: ReadonlySet<string> = new Set(),
): TableLine[] {
  const lines: TableLine[] = [];
  for (const group of comparison.groups) {
    const rows = onlyDifferences ? group.rows.filter((r) => rowDiffers(r) || errorKeys.has(r.key)) : group.rows;
    if (rows.length === 0) continue;
    lines.push({ kind: "heading", key: `h:${group.key}`, label: group.title });
    for (const row of rows) lines.push({ kind: "row", key: row.key, row });
    lines.push({ kind: "total", key: `t:${group.key}`, label: group.totalLabel, totals: group.totals, grand: false });
  }
  lines.push({ kind: "total", key: "t:all", label: GRAND_TOTAL_LABEL, totals: comparison.grand, grand: true });
  return lines;
}

/* ----------------------------------------------------------------- export */

/** The export of what the table shows, with the heading as its subtitle. */
export function balanceComparisonSheet(
  comparison: Comparison,
  meta: {
    asOf: string;
    comparedWith: string;
    companyName: string;
    currencyCode: string;
    decimals: number;
    onlyDifferences: boolean;
  },
): ReportExportSheet {
  const money = (minor: number | null) => (minor === null ? null : fromMinor(minor, meta.decimals));
  const rows: ReportExportSheet["rows"] = [];
  for (const line of tableLines(comparison, meta.onlyDifferences)) {
    if (line.kind === "heading") {
      rows.push({ code: null, account: line.label, onebook: null, other: null, difference: null });
    } else if (line.kind === "row") {
      const r = line.row;
      rows.push({
        code: r.code,
        account: r.inactive ? `${r.name} (inactive)` : r.name,
        onebook: money(r.onebookMinor),
        other: money(r.otherMinor),
        difference: money(r.differenceMinor),
      });
    } else {
      rows.push({
        code: null,
        account: line.label,
        onebook: money(line.totals.onebookMinor),
        other: money(line.totals.otherMinor),
        difference: money(line.totals.differenceMinor),
      });
    }
  }
  return {
    fileName: sanitizeExportFileName(`balance-comparison-${meta.asOf}`),
    companyName: meta.companyName,
    title: "Balance Comparison",
    subtitle: `${balanceComparisonHeading(meta.asOf, meta.comparedWith)}. ${BALANCE_BASIS_NOTE}`,
    currencyCode: meta.currencyCode,
    columns: [
      { key: "code", header: "Code", width: 12 },
      { key: "account", header: "Account", width: 44 },
      { key: "onebook", header: "OneBook", kind: "money", width: 16 },
      { key: "other", header: meta.comparedWith.trim() || "The other system", kind: "money", width: 16 },
      { key: "difference", header: "Difference", kind: "money", width: 16 },
    ],
    rows,
  };
}

/* ---------------------------------------------------------------- saving */

export const OTHER_SYSTEM_NAME_MAX = 80;
export const NOTE_MAX = 500;
export const EXTERNAL_CODE_MAX = 40;
export const EXTERNAL_NAME_MAX = 200;

/** One figure to keep: an account here, or one only the other system has. */
export type DraftLine =
  | { accountId: string; otherMinor: number }
  | { externalCode: string; externalName: string; externalGroup: ComparisonGroup; otherMinor: number };

export interface ComparisonDraft {
  asOf: string;
  comparedWith: string;
  note: string;
  lines: DraftLine[];
}

/**
 * The lines to save: every row with a typed figure except an inactive account's,
 * which the database refuses and which is not saved again.
 */
export function draftLines(comparison: Comparison): DraftLine[] {
  const lines: DraftLine[] = [];
  for (const group of comparison.groups) {
    for (const row of group.rows) {
      if (row.otherMinor === null || row.inactive) continue;
      lines.push(
        row.accountId
          ? { accountId: row.accountId, otherMinor: row.otherMinor }
          : {
              externalCode: row.code.trim(),
              externalName: row.name.trim(),
              externalGroup: row.group,
              otherMinor: row.otherMinor,
            },
      );
    }
  }
  return lines;
}

/** Why a draft cannot be saved, in a sentence; null when it can. The database checks the same things. */
export function draftProblem(draft: ComparisonDraft): string | null {
  if (!isRealIsoDate(draft.asOf)) return "Choose the date to compare at";
  const name = draft.comparedWith.trim();
  if (name === "") return "Enter the name of the other system";
  if (name.length > OTHER_SYSTEM_NAME_MAX) {
    return `The name of the other system is too long (${OTHER_SYSTEM_NAME_MAX} characters at most)`;
  }
  if (draft.note.trim().length > NOTE_MAX) return `The note is too long (${NOTE_MAX} characters at most)`;
  const seenAccounts = new Set<string>();
  const seenCodes = new Set<string>();
  for (const line of draft.lines) {
    if (!Number.isSafeInteger(line.otherMinor)) return "A figure must be a whole number of cents";
    if ("accountId" in line) {
      if (seenAccounts.has(line.accountId)) return "An account appears twice";
      seenAccounts.add(line.accountId);
      continue;
    }
    const code = line.externalCode.trim();
    if (!COMPARISON_GROUPS.some((g) => g.key === line.externalGroup)) {
      return "Choose a group for an account only the other system has";
    }
    const label = line.externalName.trim();
    if (code === "" || label === "") return "An account only the other system has needs a code and a name";
    if (code.length > EXTERNAL_CODE_MAX) return `An account code is too long (${EXTERNAL_CODE_MAX} characters at most)`;
    if (label.length > EXTERNAL_NAME_MAX) return `An account name is too long (${EXTERNAL_NAME_MAX} characters at most)`;
    const lower = code.toLowerCase();
    if (seenCodes.has(lower)) return `Two accounts the other system has share the code ${code}`;
    seenCodes.add(lower);
  }
  return null;
}

export type NewExternal =
  | { ok: true; row: ExternalRow; minor: number }
  | { ok: false; field: "code" | "name" | "figure"; error: string };

/** The "Add an account the other system has" form, checked before the row is added. */
export function checkNewExternal(
  input: { code: string; name: string; group: ComparisonGroup; figure: string },
  existingKeys: ReadonlySet<string>,
  decimals: number,
): NewExternal {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code === "") return { ok: false, field: "code", error: "Enter the account code" };
  if (code.length > EXTERNAL_CODE_MAX) {
    return { ok: false, field: "code", error: `The code is too long (${EXTERNAL_CODE_MAX} characters at most)` };
  }
  if (existingKeys.has(externalRowKey(code))) {
    return { ok: false, field: "code", error: `The code ${code} is already in the list` };
  }
  if (name === "") return { ok: false, field: "name", error: "Enter the account name" };
  if (name.length > EXTERNAL_NAME_MAX) {
    return { ok: false, field: "name", error: `The name is too long (${EXTERNAL_NAME_MAX} characters at most)` };
  }
  const parsed = parseExternalBalance(input.figure, sideOfGroup(input.group), decimals);
  if (!parsed.ok) return { ok: false, field: "figure", error: parsed.error };
  if (parsed.minor === null) return { ok: false, field: "figure", error: "Enter the figure the other system shows" };
  return {
    ok: true,
    row: { key: externalRowKey(code), code, name, group: input.group },
    minor: parsed.minor,
  };
}
