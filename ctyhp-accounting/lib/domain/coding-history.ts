/**
 * What the books already say: a name coded to Rent eleven times out of eleven
 * is not a question on the twelfth (the prototype's "coding that learns").
 *
 * The index is built from entries that are finished — one bank leg and one
 * other leg, as `acc_coding_history()` returns them — and only from those whose
 * account may teach (coding.ts decides: active, posting, not a control or
 * holding account). A suggestion needs at least two past entries and a clear
 * majority; below that it stays quiet and the line waits for a person.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
import { historyKeys, type CodingDirection } from "./coding-names.ts";

export const HISTORY_MIN = 2;
export const HISTORY_SHARE = 0.75;

/** One entry that can teach: its bank leg's direction, the account on its other leg, the texts it is known by. */
export interface HistorySource {
  entryId: string;
  date: string;
  direction: CodingDirection;
  accountId: string;
  texts: readonly string[];
}

export interface HistoryKeyStats {
  n: number;
  byAccount: Map<string, number>;
  last: string;
}

export type HistoryIndex = ReadonlyMap<string, HistoryKeyStats>;

const indexKey = (direction: CodingDirection, key: string) => `${direction}|${key}`;

export function buildHistoryIndex(
  sources: readonly HistorySource[],
  teaches: (accountId: string) => boolean,
): HistoryIndex {
  const index = new Map<string, HistoryKeyStats>();
  for (const source of sources) {
    if (!teaches(source.accountId)) continue;
    const seen = new Set<string>();
    for (const text of source.texts) {
      for (const key of historyKeys(text)) {
        const k = indexKey(source.direction, key);
        if (seen.has(k)) continue;
        seen.add(k);
        const stats = index.get(k) ?? { n: 0, byAccount: new Map<string, number>(), last: "" };
        stats.n += 1;
        stats.byAccount.set(source.accountId, (stats.byAccount.get(source.accountId) ?? 0) + 1);
        if (source.date > stats.last) stats.last = source.date;
        index.set(k, stats);
      }
    }
  }
  return index;
}

export interface HistorySuggestion {
  accountId: string;
  hits: number;
  of: number;
  key: string;
  last: string;
}

/** The account these texts have gone to before, if the past is clear about it. */
export function suggestFromHistory(
  index: HistoryIndex,
  texts: readonly string[],
  direction: CodingDirection,
  thresholds: { min: number; share: number } = { min: HISTORY_MIN, share: HISTORY_SHARE },
): HistorySuggestion | null {
  const keys: string[] = [];
  for (const text of texts) for (const key of historyKeys(text)) if (!keys.includes(key)) keys.push(key);
  // Longest keys first: three words agreeing beats two.
  keys.sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (const key of keys) {
    const stats = index.get(indexKey(direction, key));
    if (!stats || stats.n < thresholds.min) continue;
    let best = "";
    let hits = 0;
    for (const [accountId, count] of stats.byAccount) {
      if (count > hits) {
        best = accountId;
        hits = count;
      }
    }
    if (hits / stats.n < thresholds.share) continue;
    return { accountId: best, hits, of: stats.n, key, last: stats.last };
  }
  return null;
}
