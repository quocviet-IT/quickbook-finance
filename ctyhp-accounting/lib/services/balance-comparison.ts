import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import type { ComparisonAccount, DraftLine, SavedLine } from "@/lib/domain/balance-comparison";
import { getChartBalances } from "./chart-balances";
import { readAllPages } from "./paging";

export class BalanceComparisonError extends Error {}

const fail = (message: string) => new BalanceComparisonError(message);

export interface SavedHeader {
  asOf: string;
  comparedWith: string;
  note: string;
}

/** Everything the report needs for one date, read together. */
export interface BalanceComparisonData {
  asOf: string;
  accounts: ComparisonAccount[];
  /** OneBook's natural balance by account id: balance sheet accounts at the date, income and expenses for the fiscal year to date. */
  figures: Record<string, number>;
  /** The comparison saved for this date; null when nothing has been typed for it. */
  header: SavedHeader | null;
  lines: SavedLine[];
  /** Every date a comparison is saved for, oldest first. */
  savedDates: string[];
}

/**
 * Every account, active or not, in chart order. The code is unique, and the id
 * after it makes the order total, so the pages never shift between two reads.
 */
export async function listComparisonAccounts(sb: SupabaseClient): Promise<ComparisonAccount[]> {
  const rows = await readAllPages<{
    id: string;
    account_code: string;
    name: string;
    account_type: AccountType;
    is_contra: boolean | null;
    status: string;
  }>(
    (from, to) =>
      sb
        .from("acc_account")
        .select("id,account_code,name,account_type,is_contra,status")
        .order("account_code")
        .order("id")
        .range(from, to),
    fail,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.account_code,
    name: r.name,
    type: r.account_type,
    isContra: Boolean(r.is_contra),
    active: r.status === "active",
  }));
}

/** The dates a comparison is saved for, oldest first. */
export async function listComparisonDates(sb: SupabaseClient): Promise<string[]> {
  const rows = await readAllPages<{ as_of: string }>(
    (from, to) => sb.from("acc_balance_comparison").select("as_of").order("as_of").order("id").range(from, to),
    fail,
  );
  return rows.map((r) => String(r.as_of).slice(0, 10));
}

/** The header saved for a date, or null. */
export async function getComparisonHeader(sb: SupabaseClient, asOf: string): Promise<SavedHeader | null> {
  const { data, error } = await sb
    .from("acc_balance_comparison")
    .select("as_of,compared_with,note")
    .eq("as_of", asOf)
    .maybeSingle();
  if (error) throw fail(error.message);
  if (!data) return null;
  const row = data as { as_of: string; compared_with: string; note: string | null };
  return { asOf: String(row.as_of).slice(0, 10), comparedWith: row.compared_with, note: row.note ?? "" };
}

/** The figures saved for a date, ordered by id so the pages are total. */
export async function listComparisonLines(sb: SupabaseClient, asOf: string): Promise<SavedLine[]> {
  const rows = await readAllPages<{
    account_id: string | null;
    external_code: string | null;
    external_name: string | null;
    other_balance_minor: number | string;
  }>(
    (from, to) =>
      sb
        .from("acc_balance_comparison_line")
        .select("id,account_id,external_code,external_name,other_balance_minor")
        .eq("as_of", asOf)
        .order("id")
        .range(from, to),
    fail,
  );
  return rows.map((r) => ({
    accountId: r.account_id,
    externalCode: r.external_code,
    externalName: r.external_name,
    otherMinor: Number(r.other_balance_minor),
  }));
}

/** OneBook's side, the saved side and the dates, for one comparison date. Reads only. */
export async function loadBalanceComparison(sb: SupabaseClient, asOf: string): Promise<BalanceComparisonData> {
  const [accounts, balances, header, lines, savedDates] = await Promise.all([
    listComparisonAccounts(sb),
    getChartBalances(sb, asOf),
    getComparisonHeader(sb, asOf),
    listComparisonLines(sb, asOf),
    listComparisonDates(sb),
  ]);
  return { asOf, accounts, figures: balances.figures, header, lines: header ? lines : [], savedDates };
}

export interface SaveBalanceComparisonInput {
  asOf: string;
  comparedWith: string;
  note: string;
  lines: DraftLine[];
}

/** Keep a comparison for its date, replacing that date's figures only. Staff only, checked by the database. Returns the figures kept. */
export async function saveBalanceComparison(sb: SupabaseClient, input: SaveBalanceComparisonInput): Promise<number> {
  const { data, error } = await sb.rpc("acc_save_balance_comparison", {
    p_as_of: input.asOf,
    p_compared_with: input.comparedWith.trim(),
    p_note: input.note.trim() === "" ? null : input.note.trim(),
    p_lines: input.lines.map((line) =>
      "accountId" in line
        ? { account_id: line.accountId, other_balance_minor: line.otherMinor }
        : {
            external_code: line.externalCode,
            external_name: line.externalName,
            other_balance_minor: line.otherMinor,
          },
    ),
  });
  if (error) throw fail(error.message);
  return Number(data ?? 0);
}
