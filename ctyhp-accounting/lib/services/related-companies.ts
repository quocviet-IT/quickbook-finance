import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankTransactionRow } from "@/lib/db/types";
import { codingAccountOf } from "@/lib/domain/coding";
import {
  relatedAccountProblem,
  relatedMatches,
  validateRelatedInput,
  type RelatedCompany,
  type RelatedCompanyInput,
} from "@/lib/domain/related-companies";
import { phrasesOf } from "@/lib/domain/repayments";
import { listAccounts } from "./accounts";
import { readAllPages } from "./paging";
import { baseCurrencyBankIds, listRepayments } from "./repayment-register";

/**
 * Related companies on Banking › Rules: saving an entry; the lines waiting now
 * that name it — "Names 3 waiting lines", with the lines, so a short word that
 * catches too much is seen before it is saved; and the balance with each
 * company today, read from its one account.
 */
export class RelatedCompanyError extends Error {}
const fail = (message: string) => new RelatedCompanyError(message);

export interface RelatedWaitingLine {
  date: string;
  description: string;
  amountMinor: number;
}

export interface RelatedPreview {
  /** Waiting lines the words name, in or out, on base-currency banks. */
  waiting: number;
  /** The newest of them, at most ten. */
  lines: RelatedWaitingLine[];
}

type WaitingRow = { bank_account_id: string; txn_date: string; description: string | null; amount_minor: number };
type WaitingLine = RelatedWaitingLine & { inBaseCurrency: boolean };

/** Every line waiting now, in or out. Read narrowly: only what the preview needs. */
async function waitingRows(sb: SupabaseClient): Promise<WaitingRow[]> {
  return readAllPages<WaitingRow>(
    (from, to) =>
      sb
        .from("acc_bank_transaction")
        .select("id,bank_account_id,txn_date,description,amount_minor")
        .eq("status", "unmatched")
        .eq("pending", false)
        .is("provider_removed_at", null)
        .neq("amount_minor", 0)
        .order("id")
        .range(from, to),
    fail,
  );
}

const waitingFrom = (rows: readonly WaitingRow[], bankIds: ReadonlySet<string>): WaitingLine[] =>
  rows.map((row) => ({
    date: String(row.txn_date).slice(0, 10),
    description: row.description ?? "",
    amountMinor: Number(row.amount_minor),
    inBaseCurrency: bankIds.has(row.bank_account_id),
  }));

/** Pure: the waiting lines a company's words name, in or out, on base-currency banks; the newest ten listed. */
export function relatedPreviewFrom(company: Pick<RelatedCompany, "matchWords">, waiting: readonly WaitingLine[]): RelatedPreview {
  const named = waiting.filter((line) => line.amountMinor !== 0 && line.inBaseCurrency && relatedMatches(company, line.description));
  return {
    waiting: named.length,
    lines: [...named]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map(({ date, description, amountMinor }) => ({ date, description, amountMinor })),
  };
}

export async function previewRelated(sb: SupabaseClient, input: { matchWords: string }): Promise<RelatedPreview> {
  const [rows, bankIds] = await Promise.all([waitingRows(sb), baseCurrencyBankIds(sb)]);
  return relatedPreviewFrom(input, waitingFrom(rows, bankIds));
}

/** For the Rules page, from the lines it already read: how many waiting lines name each company. */
export async function relatedWaitingCounts(
  sb: SupabaseClient,
  companies: readonly RelatedCompany[],
  lines: readonly BankTransactionRow[],
): Promise<Record<string, number>> {
  if (!companies.length) return {};
  const bankIds = await baseCurrencyBankIds(sb);
  const waiting = waitingFrom(
    lines
      .filter((row) => row.status === "unmatched" && !row.pending)
      .map((row) => ({
        bank_account_id: row.bank_account_id,
        txn_date: row.txn_date,
        description: row.description,
        amount_minor: Number(row.amount_minor),
      })),
    bankIds,
  );
  return Object.fromEntries(companies.map((company) => [company.id, relatedPreviewFrom(company, waiting).waiting]));
}

/** Debit less credit on each account, from posted entries dated on or before `asOf`, in the base currency. */
export async function relatedBalances(
  sb: SupabaseClient,
  accountIds: readonly string[],
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<Record<string, number>> {
  if (!accountIds.length) return {};
  const rows = await readAllPages<{ account_id: string; debit_base: number; credit_base: number }>(
    (from, to) =>
      sb
        .rpc("acc_ledger_balances", { p_from: null, p_to: asOf })
        .in("account_id", [...accountIds])
        // account_id is unique per row, so this order is total and the pages cannot overlap or skip.
        .order("account_id")
        .range(from, to),
    fail,
  );
  return Object.fromEntries(rows.map((row) => [row.account_id, Number(row.debit_base) - Number(row.credit_base)]));
}

/** Which of the two unique rules a save broke, in the screen's words. */
export function relatedDuplicateMessage(dbMessage: string): string {
  return /account_id/.test(dbMessage)
    ? "This account already belongs to a related company"
    : "A related company of this name is already here";
}

export async function saveRelatedCompany(sb: SupabaseClient, id: string | null, input: RelatedCompanyInput): Promise<string> {
  const problem = validateRelatedInput(input);
  if (problem) throw fail(problem);
  const [accounts, repayments] = await Promise.all([listAccounts(sb), listRepayments(sb)]);
  const chart = new Map(accounts.map((row) => [row.id, codingAccountOf(row)]));
  const accountProblem = relatedAccountProblem(
    chart.get(input.accountId),
    repayments.some((entry) => entry.accountId === input.accountId),
  );
  if (accountProblem) throw fail(accountProblem);
  const fields = {
    name: input.name.trim().replace(/\s+/g, " "),
    account_id: input.accountId,
    match_words: phrasesOf(input.matchWords).join(", "),
    is_active: input.isActive,
  };
  const result = id
    ? await sb.from("acc_related_company").update(fields).eq("id", id).select("id").single()
    : await sb.from("acc_related_company").insert(fields).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") throw fail(relatedDuplicateMessage(result.error.message));
    if (result.error.code === "PGRST116") throw fail("This related company is no longer in the list");
    throw fail(result.error.message);
  }
  return (result.data as { id: string }).id;
}

export async function deleteRelatedCompany(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("acc_related_company").delete().eq("id", id);
  if (error) throw fail(error.message);
}
