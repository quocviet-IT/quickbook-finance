/**
 * One bank line's posting as the Category cell shows it.
 *
 * acc_bank_transaction_postings returns a row for every other line of the
 * entry, so a loan payment (principal and interest) or a deposit of several
 * items arrives as several rows for one bank line. The cell shows the first
 * account, by code, and says how many others there are — never one picked at
 * random from the set.
 */
export interface PostingLike {
  bank_transaction_id: string;
  account_code: string;
  account_name: string;
}

export function postingsByLine<T extends PostingLike>(rows: readonly T[]): Map<string, T & { others: string[] }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.bank_transaction_id, [...(groups.get(row.bank_transaction_id) ?? []), row]);
  const byLine = new Map<string, T & { others: string[] }>();
  for (const [id, group] of groups) {
    // Number order: 410 before 1000.
    const [first, ...rest] = [...group].sort((a, b) => a.account_code.localeCompare(b.account_code, "en", { numeric: true }));
    const label = (r: PostingLike) => `${r.account_code} — ${r.account_name}`;
    const others = [...new Set(rest.map(label))].filter((other) => other !== label(first));
    byLine.set(id, { ...first, others });
  }
  return byLine;
}
