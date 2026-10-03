import type pg from "pg";
import type { DriftEntry } from "@/lib/parity/drift";

/**
 * Every posted entry of a live company, for the data pass. Called inside a
 * read-only transaction the caller rolls back. With `withAccounts`, each
 * posting carries its account code, so it can be compared with the prototype's
 * accounts through a local map.
 */
export async function readLiveEntries(client: pg.Client, schema: string, withAccounts: boolean): Promise<DriftEntry[]> {
  if (!/^co_[a-z0-9_]+$/.test(schema)) throw new Error("PARITY_LIVE_SCHEMA must be a company schema name");
  const { rows } = await client.query(
    `select e.id::text as id, e.entry_date::text as date, coalesce(e.description, '') as description,
            a.account_code as code, (l.debit_minor - l.credit_minor)::bigint as cents
       from ${schema}.acc_journal_entry e
       join ${schema}.acc_journal_line l on l.journal_entry_id = e.id
       join ${schema}.acc_account a on a.id = l.account_id
      where e.status = 'posted'
      order by e.entry_date, e.id, l.line_order`,
  );
  const entries = new Map<string, DriftEntry>();
  for (const row of rows as { id: string; date: string; description: string; code: string; cents: string }[]) {
    const cents = Number(row.cents);
    if (cents === 0) continue;
    let entry = entries.get(row.id);
    if (!entry) {
      entry = { id: row.id, date: row.date, amounts: [], accounts: withAccounts ? [] : null, label: row.description };
      entries.set(row.id, entry);
    }
    entry.amounts.push(cents);
    entry.accounts?.push(row.code);
  }
  return [...entries.values()];
}
