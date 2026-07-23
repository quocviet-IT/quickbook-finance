import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { normalBalanceOf } from "@/lib/domain/accounts";
import { computeRunningBalance } from "@/lib/domain/reports";
import type { ManualJournalInput, OpeningBalanceInput, ReverseEntryInput } from "@/lib/domain/schemas";

export class JournalError extends Error {}

export interface JournalFilters {
  from?: string | null;
  to?: string | null;
  sourceType?: string | null;
  accountId?: string | null;
  status?: string | null;
}

export interface JournalEntryLineSummary {
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  memo: string | null;
}
export interface JournalEntrySummary {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  sourceType: string;
  sourceId: string | null;
  status: string;
  isReversed: boolean;
  reversalEntryId: string | null;
  isReversal: boolean;
  lines: JournalEntryLineSummary[];
}

export interface GeneralLedgerRow {
  entryId: string;
  lineId: string;
  entryNumber: string;
  entryDate: string;
  sourceType: string;
  sourceId: string | null;
  memo: string | null;
  debitMinor: number;
  creditMinor: number;
  runningMinor: number;
}
export interface GeneralLedger {
  accountId: string;
  accountCode: string;
  accountName: string;
  openingMinor: number;
  rows: GeneralLedgerRow[];
  closingMinor: number;
}

export interface ReversedEntryRow {
  originalEntryId: string;
  originalNumber: string;
  reversalEntryId: string;
  reversalNumber: string;
  reason: string;
  createdAt: string;
}

// --- writes ---------------------------------------------------------------
// Note: the acc_post_manual_journal / acc_reverse_entry / acc_post_opening_balances
// RPCs already append acc_audit_log atomically inside their own transaction, so
// this service does not call writeAudit again (that would duplicate audit rows).
export async function createManualJournal(sb: SupabaseClient, input: ManualJournalInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_post_manual_journal", {
    p_entry_date: input.entry_date || undefined,
    p_description: input.description || null,
    p_source_ref: input.source_ref || null,
    p_currency: input.currency_code,
    p_lines: input.lines.map((l) => ({
      account_id: l.account_id,
      debit_minor: l.debit_minor,
      credit_minor: l.credit_minor,
    })),
  });
  if (error) throw new JournalError(error.message);
  return data as string;
}

export async function reverseEntry(sb: SupabaseClient, input: ReverseEntryInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_reverse_entry", {
    p_entry_id: input.entry_id,
    p_reason: input.reason,
    p_reversal_date: input.reversal_date || undefined,
  });
  if (error) throw new JournalError(error.message);
  return data as string;
}

export async function postOpeningBalances(sb: SupabaseClient, input: OpeningBalanceInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_post_opening_balances", {
    p_as_of: input.as_of || undefined,
    p_currency: input.currency_code,
    p_lines: input.lines
      .filter((l) => l.debit_minor > 0 || l.credit_minor > 0)
      .map((l) => ({ account_id: l.account_id, debit_minor: l.debit_minor, credit_minor: l.credit_minor })),
  });
  if (error) throw new JournalError(error.message);
  return data as string;
}

// --- reads ----------------------------------------------------------------
type EntryRow = {
  id: string; entry_number: string; entry_date: string; description: string | null;
  source_type: string; source_id: string | null; status: string;
  acc_journal_line: { account_id: string; debit_minor: number; credit_minor: number; memo: string | null; line_order: number;
    acc_account: { account_code: string; name: string } | null }[];
};

export async function listJournalEntries(sb: SupabaseClient, filters: JournalFilters): Promise<JournalEntrySummary[]> {
  let q = sb
    .from("acc_journal_entry")
    .select(
      "id,entry_number,entry_date,description,source_type,source_id,status," +
        "acc_journal_line(account_id,debit_minor,credit_minor,memo,line_order,acc_account(account_code,name))",
    )
    .order("entry_date", { ascending: false })
    .order("entry_number", { ascending: false });
  if (filters.from) q = q.gte("entry_date", filters.from);
  if (filters.to) q = q.lte("entry_date", filters.to);
  if (filters.sourceType) q = q.eq("source_type", filters.sourceType);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) throw new JournalError(error.message);

  const rows = (data ?? []) as unknown as EntryRow[];
  const links = await sb.from("acc_journal_reversal_link").select("original_entry_id,reversal_entry_id");
  if (links.error) throw new JournalError(links.error.message);
  const reversedOf = new Map<string, string>();
  const reversalIds = new Set<string>();
  for (const l of links.data ?? []) {
    reversedOf.set(l.original_entry_id as string, l.reversal_entry_id as string);
    reversalIds.add(l.reversal_entry_id as string);
  }

  // Account filter keeps an entry when any of its lines references filters.accountId.
  const list = rows
    .filter((e) => !filters.accountId || e.acc_journal_line.some((l) => l.account_id === filters.accountId))
    .map((e) => ({
      id: e.id,
      entryNumber: e.entry_number,
      entryDate: e.entry_date,
      description: e.description,
      sourceType: e.source_type,
      sourceId: e.source_id,
      status: e.status,
      isReversed: reversedOf.has(e.id),
      reversalEntryId: reversedOf.get(e.id) ?? null,
      isReversal: reversalIds.has(e.id),
      lines: [...e.acc_journal_line]
        .sort((a, b) => a.line_order - b.line_order)
        .map((l) => ({
          accountCode: l.acc_account?.account_code ?? "",
          accountName: l.acc_account?.name ?? "",
          debitMinor: l.debit_minor,
          creditMinor: l.credit_minor,
          memo: l.memo,
        })),
    }));
  return list;
}

export async function getGeneralLedger(
  sb: SupabaseClient,
  accountId: string,
  from: string,
  to: string,
): Promise<GeneralLedger> {
  const acctRes = await sb.from("acc_account").select("account_code,name,account_type").eq("id", accountId).single();
  if (acctRes.error) throw new JournalError(acctRes.error.message);
  const acct = acctRes.data as { account_code: string; name: string; account_type: AccountType };
  const normal = normalBalanceOf(acct.account_type);

  // Opening balance = signed activity strictly before `from` on posted entries.
  const openRes = await sb.rpc("acc_ledger_balances", { p_from: null, p_to: shiftBack(from) });
  if (openRes.error) throw new JournalError(openRes.error.message);
  const openRow = (openRes.data ?? []).find((r: Record<string, unknown>) => (r.account_id as string) === accountId);
  const openDebit = openRow ? Number(openRow.debit_base) : 0;
  const openCredit = openRow ? Number(openRow.credit_base) : 0;
  const openingMinor = normal === "debit" ? openDebit - openCredit : openCredit - openDebit;

  const linesRes = await sb
    .from("acc_journal_line")
    .select(
      "id,debit_minor,credit_minor,amount_base_minor,memo,acc_journal_entry!inner(id,entry_number,entry_date,source_type,source_id,status)",
    )
    .eq("account_id", accountId)
    .eq("acc_journal_entry.status", "posted")
    .gte("acc_journal_entry.entry_date", from)
    .lte("acc_journal_entry.entry_date", to);
  if (linesRes.error) throw new JournalError(linesRes.error.message);

  type LineRow = {
    id: string; debit_minor: number; credit_minor: number; amount_base_minor: number; memo: string | null;
    acc_journal_entry: { id: string; entry_number: string; entry_date: string; source_type: string; source_id: string | null };
  };
  const raw = (linesRes.data ?? []) as unknown as LineRow[];
  raw.sort((a, b) =>
    a.acc_journal_entry.entry_date === b.acc_journal_entry.entry_date
      ? a.acc_journal_entry.entry_number.localeCompare(b.acc_journal_entry.entry_number)
      : a.acc_journal_entry.entry_date.localeCompare(b.acc_journal_entry.entry_date),
  );
  // Report in base-currency minor units throughout (matches openingMinor, which
  // comes from acc_ledger_balances / amount_base_minor); the transaction-currency
  // debit_minor/credit_minor only indicate which side the line is on.
  const baseLines = raw.map((r) => ({
    debitMinor: r.debit_minor > 0 ? r.amount_base_minor : 0,
    creditMinor: r.credit_minor > 0 ? r.amount_base_minor : 0,
  }));
  const running = computeRunningBalance(openingMinor, baseLines, normal);
  const rows: GeneralLedgerRow[] = raw.map((r, i) => ({
    entryId: r.acc_journal_entry.id,
    lineId: r.id,
    entryNumber: r.acc_journal_entry.entry_number,
    entryDate: r.acc_journal_entry.entry_date,
    sourceType: r.acc_journal_entry.source_type,
    sourceId: r.acc_journal_entry.source_id,
    memo: r.memo,
    debitMinor: baseLines[i].debitMinor,
    creditMinor: baseLines[i].creditMinor,
    runningMinor: running[i].runningMinor,
  }));
  return {
    accountId,
    accountCode: acct.account_code,
    accountName: acct.name,
    openingMinor,
    rows,
    closingMinor: rows.length ? rows[rows.length - 1].runningMinor : openingMinor,
  };
}

export async function listReversedEntries(sb: SupabaseClient): Promise<ReversedEntryRow[]> {
  const { data, error } = await sb
    .from("acc_journal_reversal_link")
    .select(
      "reason,created_at," +
        "orig:acc_journal_entry!acc_journal_reversal_link_original_entry_id_fkey(id,entry_number)," +
        "rev:acc_journal_entry!acc_journal_reversal_link_reversal_entry_id_fkey(id,entry_number)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new JournalError(error.message);
  type Row = { reason: string; created_at: string; orig: { id: string; entry_number: string }; rev: { id: string; entry_number: string } };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    originalEntryId: r.orig.id,
    originalNumber: r.orig.entry_number,
    reversalEntryId: r.rev.id,
    reversalNumber: r.rev.entry_number,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/** One day before an ISO date (opening balance is activity strictly before `from`). */
function shiftBack(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}
