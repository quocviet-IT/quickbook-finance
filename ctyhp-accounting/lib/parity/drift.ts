/**
 * Matching two copies of the same books entry by entry: the prototype's newest
 * copy against the one OneBook holds. Entries are matched by date and the
 * sorted list of their posting amounts. When both sides know each posting's
 * account, an entry with the same accounts is matched first; one whose amounts
 * match but whose accounts differ is reported apart. Duplicates are counted,
 * never remembered.
 */
export interface DriftEntry {
  id: string;
  date: string;
  /** Signed cents per posting (debit positive). */
  amounts: number[];
  /** The account of each posting, in the order of `amounts`, when known. */
  accounts: string[] | null;
  /** What the report shows for the entry. */
  label: string;
}

export interface DriftResult {
  matched: number;
  onlyPrototype: DriftEntry[];
  onlyOnebook: DriftEntry[];
  accountsDiffer: { prototype: DriftEntry; onebook: DriftEntry }[];
}

export function driftKey(entry: Pick<DriftEntry, "date" | "amounts">): string {
  const amounts = entry.amounts.filter((amount) => amount !== 0).sort((a, b) => a - b);
  return `${entry.date}|${amounts.join(",")}`;
}

function postingsKey(entry: DriftEntry): string | null {
  if (entry.accounts === null) return null;
  const accounts = entry.accounts;
  return entry.amounts
    .map((amount, i) => ({ amount, account: accounts[i] }))
    .filter((posting) => posting.amount !== 0)
    .map((posting) => `${posting.account}|${posting.amount}`)
    .sort()
    .join(";");
}

function push(pool: Map<string, DriftEntry[]>, key: string, entry: DriftEntry): void {
  const list = pool.get(key);
  if (list) list.push(entry);
  else pool.set(key, [entry]);
}

export function compareEntries(prototype: readonly DriftEntry[], onebook: readonly DriftEntry[]): DriftResult {
  const result: DriftResult = { matched: 0, onlyPrototype: [], onlyOnebook: [], accountsDiffer: [] };
  const exactKey = (entry: DriftEntry) => `${driftKey(entry)}#${postingsKey(entry) ?? ""}`;

  // First: the same date, amounts and accounts.
  const exact = new Map<string, DriftEntry[]>();
  for (const entry of onebook) push(exact, exactKey(entry), entry);
  const unmatched: DriftEntry[] = [];
  for (const entry of prototype) {
    if (exact.get(exactKey(entry))?.shift()) result.matched += 1;
    else unmatched.push(entry);
  }

  // Then: the same date and amounts, other accounts. A candidate whose accounts are known is offered first to an
  // entry whose accounts are known, so a real account difference is never swallowed by a candidate that cannot tell.
  const side = (entry: DriftEntry) => (entry.accounts === null ? "unknown" : "known");
  const leftovers = new Map<string, DriftEntry[]>();
  for (const list of exact.values()) for (const entry of list) push(leftovers, `${driftKey(entry)}#${side(entry)}`, entry);
  for (const entry of unmatched) {
    const key = driftKey(entry);
    const otherSide = side(entry) === "known" ? "unknown" : "known";
    const other = leftovers.get(`${key}#${side(entry)}`)?.shift() ?? leftovers.get(`${key}#${otherSide}`)?.shift();
    if (!other) result.onlyPrototype.push(entry);
    else if (entry.accounts !== null && other.accounts !== null) result.accountsDiffer.push({ prototype: entry, onebook: other });
    else result.matched += 1;
  }
  for (const list of leftovers.values()) result.onlyOnebook.push(...list);
  const byDate = (a: DriftEntry, b: DriftEntry) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  result.onlyPrototype.sort(byDate);
  result.onlyOnebook.sort(byDate);
  result.accountsDiffer.sort((a, b) => byDate(a.prototype, b.prototype));
  return result;
}
