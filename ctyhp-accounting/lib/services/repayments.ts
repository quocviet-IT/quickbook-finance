import type { SupabaseClient } from "@supabase/supabase-js";
import { codingAccountOf } from "@/lib/domain/coding";
import type { HistorySource } from "@/lib/domain/coding-history";
import type { BankTransactionRow } from "@/lib/db/types";
import {
  interestAccountAllowed,
  kindChangeProblem,
  phrasesOf,
  repaymentMatches,
  repaysAccountAllowed,
  validateRepaymentInput,
  type RepaymentAccount,
  type RepaymentInput,
  type RepaymentKind,
} from "@/lib/domain/repayments";
import { listAccounts } from "./accounts";
import { loadHistory } from "./coding";
import { RepaymentError, baseCurrencyBankIds } from "./repayment-register";
import { readAllPages } from "./paging";

/**
 * Cards and loans on Banking › Rules: saving an entry, and how its words do —
 * against the payments already posted to its account, and the lines waiting
 * now. "Catches 12 of 12 past payments" is the check that the words are right.
 */
export interface RepaymentStats {
  /** Finished payments out to this account, one bank leg and this one. */
  past: number;
  caught: number;
  waiting: number;
  /** The newest past payments the words miss, at most ten. */
  missed: { date: string; text: string }[];
}

type WaitingRow = { bank_account_id: string; description: string | null; amount_minor: number };
type WaitingLine = { description: string; amountMinor: number; inBaseCurrency: boolean };

/** Waiting payments out, the only lines a card or loan can match. Read narrowly: only what the count needs. */
async function waitingPaymentsOut(sb: SupabaseClient): Promise<WaitingRow[]> {
  return readAllPages<WaitingRow>(
    (from, to) =>
      sb
        .from("acc_bank_transaction")
        .select("id,bank_account_id,description,amount_minor")
        .eq("status", "unmatched")
        .eq("pending", false)
        .is("provider_removed_at", null)
        .lt("amount_minor", 0)
        .order("id")
        .range(from, to),
    (message) => new RepaymentError(message),
  );
}

async function statsGround(
  sb: SupabaseClient,
  accountIds: readonly string[],
  lines?: readonly BankTransactionRow[],
): Promise<{ history: HistorySource[]; waiting: WaitingLine[] }> {
  // Prefetched lines (the Rules page reads them once) or a narrow read of its own; one shape either way.
  const fromLines = (rows: readonly BankTransactionRow[]): WaitingRow[] =>
    rows
      .filter((row) => row.status === "unmatched" && !row.pending)
      .map((row) => ({ bank_account_id: row.bank_account_id, description: row.description, amount_minor: Number(row.amount_minor) }));
  const [history, rows, bankIds] = await Promise.all([
    loadHistory(sb, accountIds),
    lines ? Promise.resolve(fromLines(lines)) : waitingPaymentsOut(sb),
    baseCurrencyBankIds(sb),
  ]);
  const waiting = rows.map((row) => ({
    description: row.description ?? "",
    amountMinor: Number(row.amount_minor),
    inBaseCurrency: bankIds.has(row.bank_account_id),
  }));
  return { history, waiting };
}

/** Pure: how an entry's words do against past payments to its account and the lines waiting now. */
export function repaymentStatsFrom(
  entry: Pick<RepaymentAccount, "accountId" | "matchWords" | "matchDigits">,
  history: readonly HistorySource[],
  waiting: readonly WaitingLine[],
): RepaymentStats {
  const past = history.filter((source) => source.accountId === entry.accountId && source.direction === "out");
  const missed = past.filter((source) => !source.texts.some((text) => repaymentMatches(entry, text)));
  return {
    past: past.length,
    caught: past.length - missed.length,
    waiting: waiting.filter((line) => line.amountMinor < 0 && line.inBaseCurrency && repaymentMatches(entry, line.description)).length,
    missed: [...missed]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map((source) => ({ date: source.date, text: source.texts[0] ?? "" })),
  };
}

export async function repaymentStats(
  sb: SupabaseClient,
  entries: readonly RepaymentAccount[],
  lines?: readonly BankTransactionRow[],
): Promise<Record<string, RepaymentStats>> {
  if (!entries.length) return {};
  const { history, waiting } = await statsGround(sb, [...new Set(entries.map((entry) => entry.accountId))], lines);
  return Object.fromEntries(entries.map((entry) => [entry.id, repaymentStatsFrom(entry, history, waiting)]));
}

export async function previewRepayment(
  sb: SupabaseClient,
  input: { accountId: string; matchWords: string; matchDigits: string | null },
): Promise<RepaymentStats> {
  const { history, waiting } = await statsGround(sb, [input.accountId]);
  return repaymentStatsFrom(input, history, waiting);
}

export async function saveRepayment(sb: SupabaseClient, id: string | null, input: RepaymentInput): Promise<string> {
  const problem = validateRepaymentInput(input);
  if (problem) throw new RepaymentError(problem);
  if (id) {
    const { data: existing, error: readError } = await sb.from("acc_repayment_account").select("kind").eq("id", id).maybeSingle();
    if (readError) throw new RepaymentError(readError.message);
    if (!existing) throw new RepaymentError("This entry is no longer in Cards and loans");
    const changed = kindChangeProblem((existing as { kind: RepaymentKind }).kind, input.kind);
    if (changed) throw new RepaymentError(changed);
  }
  const chart = new Map((await listAccounts(sb)).map((row) => [row.id, codingAccountOf(row)]));
  if (!repaysAccountAllowed(input.kind, chart.get(input.accountId))) {
    throw new RepaymentError(
      input.kind === "card"
        ? "A card repays an active posting Credit Card account"
        : "A loan repays an active posting current or long-term liability account",
    );
  }
  if (input.kind === "loan" && !interestAccountAllowed(chart.get(input.interestAccountId ?? ""))) {
    throw new RepaymentError("Interest posts to an active posting expense or other expense account");
  }
  const fields = {
    kind: input.kind,
    account_id: input.accountId,
    match_words: phrasesOf(input.matchWords).join(", "),
    match_digits: input.matchDigits,
    interest_account_id: input.kind === "loan" ? input.interestAccountId : null,
    interest_method: input.kind === "loan" ? input.interestMethod : null,
    annual_rate: input.kind === "loan" && input.interestMethod === "rate" ? input.annualRate : null,
    fixed_interest_minor: input.kind === "loan" && input.interestMethod === "fixed" ? input.fixedInterestMinor : null,
    is_active: input.isActive,
  };
  const result = id
    ? await sb.from("acc_repayment_account").update(fields).eq("id", id).select("id").single()
    : await sb.from("acc_repayment_account").insert(fields).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") throw new RepaymentError("This account is already in Cards and loans");
    throw new RepaymentError(result.error.message);
  }
  return (result.data as { id: string }).id;
}

export async function deleteRepayment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from("acc_repayment_account").delete().eq("id", id);
  if (error) throw new RepaymentError(error.message);
}
