import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { entryDisplayName } from "@/lib/domain/entry-detail";
import { dayBefore } from "@/lib/domain/fiscal";
import type { ZoomSpec } from "@/lib/domain/statement";
import { buildZoom, type ZoomAccount, type ZoomResult } from "@/lib/domain/zoom";
import { readAllPages, type PageResult } from "@/lib/services/paging";
import { getLedgerBalances, getTransactionList } from "@/lib/services/reports";

/**
 * Reading the lines behind a statement figure. Every call here reads; nothing
 * writes, and any failed read fails the zoom — a list missing a page would not
 * add up, and would say the books are wrong when they are not.
 */
export class ZoomError extends Error {}

type ChartRow = { id: string; account_code: string; name: string; account_type: AccountType };
type LineRow = {
  id: string;
  account_id: string;
  debit_minor: number;
  credit_minor: number;
  amount_base_minor: number;
  acc_journal_entry: { id: string; entry_number: string; entry_date: string; source_type: string };
};

function readAll<T>(label: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  return readAllPages<T>(page, (message) => new ZoomError(`Reading ${label} failed: ${message}`));
}

function readChart(sb: SupabaseClient): Promise<ChartRow[]> {
  return readAll<ChartRow>("the chart of accounts", (f, t) =>
    sb.from("acc_account").select("id,account_code,name,account_type").order("account_code").range(f, t),
  );
}

/**
 * Accounts per request. A total can stand on every account in a section, and
 * each id is 37 characters of query string; a hundred keeps the URL well
 * inside what the API gateway accepts.
 */
const ACCOUNTS_PER_READ = 100;

async function readLines(sb: SupabaseClient, spec: ZoomSpec): Promise<LineRow[]> {
  const rows: LineRow[] = [];
  for (let i = 0; i < spec.accountIds.length; i += ACCOUNTS_PER_READ) {
    const ids = spec.accountIds.slice(i, i + ACCOUNTS_PER_READ);
    rows.push(
      ...(await readAll<LineRow>("the entries", (f, t) => {
        let q = sb
          .from("acc_journal_line")
          .select("id,account_id,debit_minor,credit_minor,amount_base_minor,acc_journal_entry!inner(id,entry_number,entry_date,source_type)")
          .in("account_id", ids)
          .eq("acc_journal_entry.status", "posted")
          .lte("acc_journal_entry.entry_date", spec.to);
        if (spec.from) q = q.gte("acc_journal_entry.entry_date", spec.from);
        return q.order("id").range(f, t);
      })),
    );
  }
  return rows;
}

export async function getZoom(sb: SupabaseClient, spec: ZoomSpec): Promise<ZoomResult> {
  const single = spec.accountIds.length === 1;
  const [chart, lines, before] = await Promise.all([
    readChart(sb),
    readLines(sb, spec),
    single && spec.from ? getLedgerBalances(sb, null, dayBefore(spec.from)) : Promise.resolve(null),
  ]);
  // Names and the other side of each entry, read only over the dates the lines span.
  const earliest = lines
    .map((l) => String(l.acc_journal_entry.entry_date).slice(0, 10))
    .reduce((min, date) => (date < min ? date : min), spec.to);
  const listed = lines.length > 0 ? await getTransactionList(sb, spec.from ?? earliest, spec.to) : [];
  const accounts = new Map<string, ZoomAccount>(
    chart.map((a) => [a.id, { id: a.id, code: a.account_code, name: a.name, type: a.account_type }]),
  );
  const labels = new Map(chart.map((a) => [a.id, `${a.account_code} ${a.name}`]));
  const names = new Map(listed.map((r) => [r.entryId, entryDisplayName(r)]));
  const entryAccounts = new Map(listed.map((r) => [r.entryId, r.accountIds]));
  const opening = before?.find((b) => b.accountId === spec.accountIds[0]);
  return buildZoom({
    spec,
    accounts,
    labels,
    entryAccounts,
    openingRaw: before ? (opening ? opening.debitBase - opening.creditBase : 0) : null,
    lines: lines.map((l) => ({
      lineId: l.id,
      entryId: l.acc_journal_entry.id,
      entryNumber: l.acc_journal_entry.entry_number,
      entryDate: String(l.acc_journal_entry.entry_date).slice(0, 10),
      sourceType: l.acc_journal_entry.source_type,
      accountId: l.account_id,
      // Base currency, read exactly as acc_ledger_balances reads it.
      debitBase: Number(l.debit_minor) > 0 ? Number(l.amount_base_minor) : 0,
      creditBase: Number(l.credit_minor) > 0 ? Number(l.amount_base_minor) : 0,
      name: names.get(l.acc_journal_entry.id) ?? "",
    })),
  });
}
