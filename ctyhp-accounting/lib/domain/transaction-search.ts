/**
 * What to offer somebody as they type into the Bank Transactions search box.
 *
 * The rule that shapes everything here: **only ever suggest something that is
 * actually there.** The caller passes the rows already narrowed by the scope
 * filters — account, status, posted to — and never the whole ledger, so a
 * suggestion can always be chosen and always returns rows. A suggestion that
 * leads to an empty table is worse than no suggestion at all: it teaches the
 * reader that the box lies to them.
 *
 * Values are grouped rather than listed per row, because a bank statement
 * repeats itself — three months of the same fee is one thing to search for,
 * not three identical lines in a dropdown — and each suggestion carries the
 * number of lines behind it, which is the reader's clue about whether it is
 * the group they meant.
 *
 * Pure, so the ranking can be asserted directly rather than through a
 * rendered dropdown.
 */

/** As many as a dropdown can be read at a glance without scrolling. */
export const MAX_SEARCH_SUGGESTIONS = 8;

/**
 * How many values behind a single line may appear.
 *
 * Found against a real statement: a bank wire description carries its own
 * date and time, so no two are ever equal, and grouping produced eight
 * near-identical one-line entries that pushed out the one suggestion worth
 * having. A value behind several lines is the only kind that narrows
 * anything — the table below is already filtered live to everything the
 * typed text matches, so a suggestion leading to exactly one of those rows
 * offers the reader nothing they cannot already see.
 *
 * Not zero: on a statement where every description is unique, a short list
 * is still better than an empty box.
 */
export const MAX_SINGLE_LINE_SUGGESTIONS = 3;

/** The two fields the keyword filter already searches (see transaction-filter.ts). */
export interface SearchableRow {
  description: string;
  reference: string | null;
}

export interface SearchSuggestion {
  /** Exactly what goes into the search box when this is chosen. */
  value: string;
  /** Which column it came from, so the dropdown can say so. */
  field: "description" | "reference";
  /** How many rows carry this value. */
  count: number;
}

interface Bucket extends SearchSuggestion {
  /** True when the typed text starts the value rather than appearing inside it. */
  leading: boolean;
}

/**
 * Suggestions for `keyword`, best first.
 *
 * Order is: values the typed text *begins*, then values that merely contain
 * it; within each, the values behind the most rows. Typing "wire" should
 * offer the wires before the one fee whose name happens to contain the word.
 */
export function buildSearchSuggestions(
  rows: readonly SearchableRow[],
  keyword: string,
  limit: number = MAX_SEARCH_SUGGESTIONS,
): SearchSuggestion[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [];

  // Keyed by the value itself, so one string is offered once even when it is
  // both somebody's description and somebody else's reference — two identical
  // lines in a dropdown is a choice with no difference behind it.
  const buckets = new Map<string, Bucket>();

  const add = (raw: string | null, field: SearchSuggestion["field"]) => {
    const value = raw?.trim();
    if (!value) return;
    const at = value.toLowerCase().indexOf(needle);
    if (at < 0) return;
    const existing = buckets.get(value);
    if (existing) {
      existing.count += 1;
      return;
    }
    buckets.set(value, { value, field, count: 1, leading: at === 0 });
  };

  for (const row of rows) {
    add(row.description, "description");
    add(row.reference, "reference");
  }

  const ranked = [...buckets.values()].sort((a, b) => {
    // A value behind several lines outranks a one-off however it matched:
    // the whole purpose of a suggestion is to narrow, and a group is the
    // only thing that does.
    const aGroups = a.count > 1;
    const bGroups = b.count > 1;
    if (aGroups !== bGroups) return aGroups ? -1 : 1;
    if (a.leading !== b.leading) return a.leading ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    // Alphabetical last, so the same input always produces the same list
    // rather than one that depends on which row happened to be read first.
    return a.value.localeCompare(b.value);
  });

  const chosen: Bucket[] = [];
  let singles = 0;
  for (const bucket of ranked) {
    if (chosen.length >= limit) break;
    if (bucket.count === 1) {
      if (singles >= MAX_SINGLE_LINE_SUGGESTIONS) continue;
      singles += 1;
    }
    chosen.push(bucket);
  }

  return chosen.map(({ value, field, count }) => ({ value, field, count }));
}
