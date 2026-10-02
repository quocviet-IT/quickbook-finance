/**
 * Every figure both systems report, paired, compared to the cent, and each
 * difference tagged with the known reason it matches — or "new", which is a
 * finding. First matching reason wins: entries that could not be loaded, then
 * the prototype's closing entries, then a one-cent rounding difference.
 */
import { BS_KEYS, PL_KEYS, type BookFigures } from "./types.ts";

export type FigureKind = "balance" | "trial_balance" | "profit_and_loss" | "balance_sheet";
export type DifferenceTag = "not loaded" | "closing entry" | "rounding" | "new";

export interface FigurePair {
  kind: FigureKind;
  /** Start of the range for a Profit and Loss; null for a figure at a date. */
  from: string | null;
  to: string;
  /** An account name for a balance; the total's key otherwise. */
  key: string;
  prototypeCents: number;
  onebookCents: number;
}

export interface Difference extends FigurePair {
  /** OneBook minus the prototype. */
  diffCents: number;
  tag: DifferenceTag;
}

export interface BookContext {
  /** Entries that could not be loaded into OneBook: their dates and the accounts they touch. */
  notLoaded: readonly { date: string; accounts: readonly string[] }[];
  /** Dates of the prototype's entries flagged as closing. */
  closingDates: readonly string[];
}

export interface Comparison {
  compared: number;
  agreed: number;
  differences: Difference[];
}

/** Every figure the two systems both report, paired. A line the prototype's report does not show is not compared. */
export function pairFigures(prototype: BookFigures, onebook: BookFigures): FigurePair[] {
  const pairs: FigurePair[] = [];
  for (const to of Object.keys(prototype.balances).sort()) {
    const p = prototype.balances[to] ?? {};
    const o = onebook.balances[to] ?? {};
    const accounts = [...new Set([...Object.keys(p), ...Object.keys(o)])].sort();
    for (const key of accounts) {
      pairs.push({ kind: "balance", from: null, to, key, prototypeCents: p[key] ?? 0, onebookCents: o[key] ?? 0 });
    }
  }
  for (const to of Object.keys(prototype.trialBalance).sort()) {
    const p = prototype.trialBalance[to];
    const o = onebook.trialBalance[to] ?? { debit: 0, credit: 0 };
    pairs.push({ kind: "trial_balance", from: null, to, key: "debit", prototypeCents: p.debit, onebookCents: o.debit });
    pairs.push({ kind: "trial_balance", from: null, to, key: "credit", prototypeCents: p.credit, onebookCents: o.credit });
  }
  for (const range of Object.keys(prototype.profitAndLoss).sort()) {
    const [from, to] = range.split("..");
    const p = prototype.profitAndLoss[range];
    const o = onebook.profitAndLoss[range];
    for (const key of PL_KEYS) {
      const value = p[key];
      if (value === null) continue;
      pairs.push({ kind: "profit_and_loss", from, to, key, prototypeCents: value, onebookCents: o?.[key] ?? 0 });
    }
  }
  for (const to of Object.keys(prototype.balanceSheet).sort()) {
    const p = prototype.balanceSheet[to];
    const o = onebook.balanceSheet[to];
    for (const key of BS_KEYS) {
      const value = p[key];
      if (value === null) continue;
      pairs.push({ kind: "balance_sheet", from: null, to, key, prototypeCents: value, onebookCents: o?.[key] ?? 0 });
    }
  }
  return pairs;
}

const inRange = (date: string, from: string | null, to: string) => (from === null || date >= from) && date <= to;

/** Why a figure differs, by the known rules; first match wins. */
export function tagDifference(pair: FigurePair, diffCents: number, context: BookContext): DifferenceTag {
  const unloaded = context.notLoaded.filter((entry) => inRange(entry.date, pair.from, pair.to));
  const touched = pair.kind === "balance" ? unloaded.some((entry) => entry.accounts.includes(pair.key)) : unloaded.length > 0;
  if (touched) return "not loaded";
  if (pair.kind === "profit_and_loss" && context.closingDates.some((date) => inRange(date, pair.from, pair.to))) {
    return "closing entry";
  }
  if (Math.abs(diffCents) === 1) return "rounding";
  return "new";
}

export function compareFigures(pairs: readonly FigurePair[], context: BookContext): Comparison {
  const differences: Difference[] = [];
  for (const pair of pairs) {
    const diffCents = pair.onebookCents - pair.prototypeCents;
    if (diffCents !== 0) differences.push({ ...pair, diffCents, tag: tagDifference(pair, diffCents, context) });
  }
  return { compared: pairs.length, agreed: pairs.length - differences.length, differences };
}
