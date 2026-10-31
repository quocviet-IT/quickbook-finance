import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BankingError,
  listBankRecodes,
  listBankTransactionPostings,
  listBankStatementImports,
  listBankTransactions,
  listSuggestions,
  type BankPostingRow,
  type BankRecodeRow,
  type BankStatementImportRow,
  type SuggestionView,
} from "@/lib/services/banking";
import { listBankFeedSyncs } from "@/lib/services/bank-feeds";
import type { BankFeedSyncView } from "@/lib/domain/bank-feeds";
import type { BankTransactionRow } from "@/lib/db/types";

/** The same shape as the Server Actions' result, so the screen reads one kind. */
export interface ViewResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** One part of a combined read: its own answer or its own error, never the others'. */
export async function settled<T>(read: () => Promise<T>): Promise<ViewResult<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (err) {
    const error = err instanceof BankingError || err instanceof Error ? err.message : "An unexpected error occurred";
    return { ok: false, error };
  }
}

export interface BankingView {
  transactions: ViewResult<BankTransactionRow[]>;
  /** Proposed matches between the lines and the books. */
  suggestions: ViewResult<SuggestionView[]>;
  /** What each matched line was posted to — the Category column's answer. */
  postings: ViewResult<BankPostingRow[]>;
  /** Which coded lines were recoded out of Uncategorized, and to what. */
  recodes: ViewResult<BankRecodeRow[]>;
}

/**
 * Everything the banking screen draws its lines with. `null` asks for every
 * bank account, which is how the review queue spans them. The reads run side
 * by side, on one client, and each keeps its own error, so one failed read
 * does not blank the others.
 *
 * Read by the page itself for the account the screen opens on (2.91), so the
 * lines are in the first HTML, and by `getBankingViewAction` whenever the
 * screen asks again.
 */
export async function readBankingView(sb: SupabaseClient, bankAccountId: string | null): Promise<BankingView> {
  const [transactions, suggestions, postings, recodes] = await Promise.all([
    settled(() => listBankTransactions(sb, bankAccountId)),
    settled(() => listSuggestions(sb, bankAccountId)),
    settled(() => listBankTransactionPostings(sb, bankAccountId)),
    settled(() => listBankRecodes(sb, bankAccountId)),
  ]);
  return { transactions, suggestions, postings, recodes };
}

/** The lines the page read for the account the screen opens on. */
export interface OpeningBankingView {
  bankAccountId: string;
  view: BankingView;
  /** The registers under the lines (2.92): statement imports, and bank feed syncs. */
  imports: ViewResult<BankStatementImportRow[]>;
  syncs: ViewResult<BankFeedSyncView[]>;
}

/**
 * The account Banking opens on, as the screen picks it: the one named in the
 * address if it is one of these, otherwise the first. Null with no accounts.
 */
export function openingBankAccountId(bankAccounts: readonly { id: string }[], requested: string | null): string | null {
  if (requested && bankAccounts.some((account) => account.id === requested)) return requested;
  return bankAccounts[0]?.id ?? null;
}

/**
 * Reads the opening account's lines, and the two registers under them, or
 * nothing when there is no account to open on. The registers were two more
 * Server Actions after the page had loaded, queued behind the suggestions.
 */
export async function readOpeningBankingView(
  sb: SupabaseClient,
  bankAccounts: readonly { id: string }[],
  requested: string | null,
): Promise<OpeningBankingView | null> {
  const bankAccountId = openingBankAccountId(bankAccounts, requested);
  if (!bankAccountId) return null;
  const [view, imports, syncs] = await Promise.all([
    readBankingView(sb, bankAccountId),
    settled(() => listBankStatementImports(sb, bankAccountId)),
    settled(() => listBankFeedSyncs(sb, bankAccountId)),
  ]);
  return { bankAccountId, view, imports, syncs };
}
