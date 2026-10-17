import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toCashCountResult,
  toCashCountRow,
  toCashStanding,
  type CashCountResult,
  type CashCountRow,
  type CashStanding,
} from "@/lib/domain/cash-count";
import { readAllPages } from "@/lib/services/paging";

export class CashCountError extends Error {}

const fail = (message: string) => new CashCountError(message);

/**
 * Every active cash on hand account at a day: its book balance and its latest
 * posted count. One row per account from acc_cash_accounts_standing, paged all
 * the same (the account id orders it totally, after the code).
 */
export async function getCashStanding(sb: SupabaseClient, asOf: string): Promise<CashStanding[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_cash_accounts_standing", { p_as_of: asOf })
        .order("account_code")
        .order("account_id")
        .range(from, to),
    fail,
  );
  return rows.map(toCashStanding);
}

/** The account's book balance on a day, from the server. */
export async function getCashBook(sb: SupabaseClient, accountId: string, on: string): Promise<number> {
  const { data, error } = await sb.rpc("acc_cash_book_minor", { p_account_id: accountId, p_on: on });
  if (error) throw fail(error.message);
  return Number(data ?? 0);
}

/** Whether the company's approval policy makes a difference of this size wait. */
export async function cashCountNeedsApproval(sb: SupabaseClient, differenceMinor: number): Promise<boolean> {
  if (differenceMinor === 0) return false;
  const { data, error } = await sb.rpc("acc_approval_required", {
    p_action_key: "cash_count",
    p_amount_minor: Math.abs(differenceMinor),
  });
  if (error) throw fail(error.message);
  return Boolean(data);
}

export interface PostCashCountInput {
  accountId: string;
  countedOn: string;
  countedMinor: number;
  offsetAccountId: string;
  memo: string;
}

/** Record a count. The database checks the role, the account, the date and the period. */
export async function postCashCount(
  sb: SupabaseClient,
  input: PostCashCountInput,
): Promise<{ result: CashCountResult; entryNumber: string | null }> {
  const { data, error } = await sb.rpc("acc_post_cash_count", {
    p_account_id: input.accountId,
    p_counted_on: input.countedOn,
    p_counted_minor: input.countedMinor,
    p_offset_account_id: input.offsetAccountId,
    p_memo: input.memo,
  });
  if (error) throw fail(error.message);
  const result = toCashCountResult((data ?? {}) as Record<string, unknown>);
  let entryNumber: string | null = null;
  if (result.journalEntryId) {
    // The entry is posted; failing to read its number must not make the count look failed.
    const { data: entry } = await sb
      .from("acc_journal_entry")
      .select("entry_number")
      .eq("id", result.journalEntryId)
      .maybeSingle();
    entryNumber = (entry as { entry_number?: string } | null)?.entry_number ?? null;
  }
  return { result, entryNumber };
}

const COUNT_COLUMNS =
  "id,counted_on,counted_minor,book_minor,difference_minor,status,journal_entry_id,created_by,created_at";

/** Ids per lookup: a URL for `in (…)` has to stay short. */
const LOOKUP_CHUNK = 100;

async function entryNumbersFor(sb: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const { data, error } = await sb
      .from("acc_journal_entry")
      .select("id,entry_number")
      .in("id", ids.slice(i, i + LOOKUP_CHUNK));
    if (error) throw fail(error.message);
    for (const r of (data ?? []) as { id: string; entry_number: string }[]) numbers.set(r.id, r.entry_number);
  }
  return numbers;
}

/** User id → the name shown: the person's name, or their email. Empty when the directory cannot be read. */
async function actorNames(sb: SupabaseClient): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data, error } = await sb.rpc("acc_actor_directory");
  if (error) return names;
  for (const r of (data ?? []) as { id: string; email: string | null; full_name: string | null }[]) {
    const name = r.full_name?.trim() || r.email?.trim() || "";
    if (name) names.set(r.id, name);
  }
  return names;
}

/**
 * Every count of one account, newest first. Ordered by date, creation time and
 * id, so the order is total and the pages never shift between two reads.
 */
export async function listCashCounts(sb: SupabaseClient, accountId: string): Promise<CashCountRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_cash_count")
        .select(COUNT_COLUMNS)
        .eq("account_id", accountId)
        .order("counted_on", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    fail,
  );
  const entryIds = [...new Set(rows.map((r) => r.journal_entry_id).filter((id): id is string => typeof id === "string"))];
  const [numbers, names] = await Promise.all([entryNumbersFor(sb, entryIds), actorNames(sb)]);
  return rows.map((r) => toCashCountRow(r, numbers, names));
}
