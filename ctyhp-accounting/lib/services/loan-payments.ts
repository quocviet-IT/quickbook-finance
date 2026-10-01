import type { SupabaseClient } from "@supabase/supabase-js";
import { codingAccountOf } from "@/lib/domain/coding";
import { loanSuggestionsFrom, type LoanMovement, type LoanSuggestionView } from "@/lib/domain/loan-interest";
import type { RepaymentAccount } from "@/lib/domain/repayments";
import { listAccounts } from "./accounts";
import { listBankTransactions, listSuggestions } from "./banking";
import { readAllPages } from "./paging";
import { repaymentContext } from "./repayment-register";

/**
 * Loan instalments on bank lines (1.76): the balance each loan stands at on the
 * books, the split proposed for each waiting payment, and the one call that
 * posts it. The split itself is worked out in lib/domain/loan-interest.ts; the
 * posting's accounts and principal are the database's (migration 0130).
 */
export class LoanPaymentError extends Error {}
const fail = (message: string) => new LoanPaymentError(message);

/** The account each switched-on loan repays, each once. */
export function loanAccountIds(repayments: readonly RepaymentAccount[]): string[] {
  return [...new Set(repayments.filter((entry) => entry.kind === "loan" && entry.isActive).map((entry) => entry.accountId))];
}

/** Every posted line on these accounts, with its entry's date. */
export async function loadLoanMovements(sb: SupabaseClient, accountIds: readonly string[]): Promise<LoanMovement[]> {
  if (!accountIds.length) return [];
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_journal_line")
        .select("id,account_id,debit_minor,credit_minor,acc_journal_entry!inner(entry_date,status)")
        .in("account_id", [...accountIds])
        .eq("acc_journal_entry.status", "posted")
        .order("id")
        .range(from, to),
    fail,
  );
  return rows.map((row) => ({
    accountId: row.account_id as string,
    date: String((row.acc_journal_entry as { entry_date: string }).entry_date).slice(0, 10),
    debitMinor: Number(row.debit_minor),
    creditMinor: Number(row.credit_minor),
  }));
}

/**
 * For Bank Transactions: the proposed split of every waiting loan payment in
 * view (null is every bank account). The carry runs over every waiting line of
 * the company, so a split reads the same here as on Review import.
 */
export async function loanSuggestions(sb: SupabaseClient, bankAccountId: string | null): Promise<LoanSuggestionView[]> {
  const context = await repaymentContext(sb);
  const ids = loanAccountIds(context.repayments);
  if (!ids.length) return [];
  const [lines, matches, accounts, movements] = await Promise.all([
    listBankTransactions(sb, null),
    listSuggestions(sb, null),
    listAccounts(sb),
    loadLoanMovements(sb, ids),
  ]);
  const views = loanSuggestionsFrom({
    lines: lines
      .filter((row) => row.status === "unmatched" && !row.pending)
      .map((row) => ({
        id: row.id,
        bankAccountId: row.bank_account_id,
        date: row.txn_date,
        amountMinor: Number(row.amount_minor),
        description: row.description ?? "",
      })),
    repayments: context.repayments,
    baseCurrencyBankIds: context.baseCurrencyBankIds,
    accounts: new Map(accounts.map((row) => [row.id, codingAccountOf(row)])),
    movements,
    excludeIds: new Set(matches.map((match) => match.bank_transaction_id)),
  });
  if (!bankAccountId) return views;
  const inView = new Set(lines.filter((row) => row.bank_account_id === bankAccountId).map((row) => row.id));
  return views.filter((view) => inView.has(view.transactionId));
}

/** Post one loan payment: the database takes the accounts from the register and works out the principal. */
export async function postLoanPayment(
  sb: SupabaseClient,
  transactionId: string,
  repaymentId: string,
  interestMinor: number,
): Promise<{ entry_number: string | null; principal_minor: number; interest_minor: number }> {
  const { data, error } = await sb.rpc("acc_post_bank_loan_payment", {
    p_transaction_id: transactionId,
    p_repayment_id: repaymentId,
    p_interest_minor: interestMinor,
  });
  if (error) throw fail(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { entry_number: string | null; principal_minor: number; interest_minor: number };
  return { entry_number: row.entry_number ?? null, principal_minor: Number(row.principal_minor), interest_minor: Number(row.interest_minor) };
}
