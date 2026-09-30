import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BankTransactionRow } from "@/lib/db/types";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import {
  REVIEW_POST_CHUNK,
  reviewProposal,
  type ReviewDocument,
  type ReviewPostItem,
  type ReviewProposal,
} from "@/lib/domain/statement-review";
import { listAccounts } from "./accounts";
import {
  approveReconciliation,
  categoriseBankTransaction,
  listBankAccounts,
  listSuggestions,
  settleFromBankTransaction,
} from "./banking";
import { listBankRules, loadHistory, suggestionsFrom } from "./coding";
import { readAllPages } from "./paging";

/**
 * Review import: every line one statement import brought in, with the one
 * thing OneBook proposes for it, and the posting of what a person ticked.
 *
 * Nothing here decides a ledger rule. Posting walks each ticked line through
 * the call the same action takes by hand — approving a match, settling a
 * document, categorising — and each of those RPCs keeps its own guards.
 */
export class StatementReviewError extends Error {}
const fail = (message: string) => new StatementReviewError(message);

export interface ReviewBatch {
  id: string;
  filename: string;
  rowCount: number;
  importedAt: string;
  status: string;
  bankAccountId: string;
  bankLabel: string;
  currencyCode: string;
}

export interface ReviewLineView {
  id: string;
  txnDate: string;
  description: string;
  reference: string | null;
  amountMinor: number;
  proposal: ReviewProposal;
}

export interface ImportReview {
  batch: ReviewBatch;
  lines: ReviewLineView[];
  /** Accounts a line may be coded to, for the picker. */
  accounts: { id: string; label: string }[];
  /** The same accounts as chart rows, for the rule form. */
  ruleAccounts: AccountRow[];
}

async function openDocuments(sb: SupabaseClient): Promise<ReviewDocument[]> {
  const [invoices, bills] = await Promise.all([
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_invoice")
          .select("id,invoice_number,balance_due_minor,currency_code,acc_customer(name)")
          .in("status", ["issued", "partial"])
          .gt("balance_due_minor", 0)
          .order("id")
          .range(from, to),
      fail,
    ),
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_bill")
          .select("id,bill_number,balance_due_minor,currency_code,acc_vendor(name)")
          .in("status", ["open", "partial"])
          .gt("balance_due_minor", 0)
          .order("id")
          .range(from, to),
      fail,
    ),
  ]);
  return [
    ...invoices.map((row) => ({
      documentId: row.id as string,
      documentNumber: (row.invoice_number as string) ?? null,
      partyName: (row.acc_customer as { name?: string } | null)?.name ?? "—",
      balanceDueMinor: Number(row.balance_due_minor),
      currencyCode: row.currency_code as string,
      direction: "receivable" as const,
    })),
    ...bills.map((row) => ({
      documentId: row.id as string,
      documentNumber: (row.bill_number as string) ?? null,
      partyName: (row.acc_vendor as { name?: string } | null)?.name ?? "—",
      balanceDueMinor: Number(row.balance_due_minor),
      currencyCode: row.currency_code as string,
      direction: "payable" as const,
    })),
  ];
}

export async function loadImportReview(sb: SupabaseClient, batchId: string): Promise<ImportReview | null> {
  const { data: batchRow, error } = await sb
    .from("acc_bank_import_batch")
    .select("id,bank_account_id,filename,row_count,imported_at,status")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw fail(error.message);
  if (!batchRow) return null;
  const batch = batchRow as {
    id: string;
    bank_account_id: string;
    filename: string | null;
    row_count: number;
    imported_at: string;
    status: string;
  };

  const [banks, lines, matches, documents, rules, history, accountRows] = await Promise.all([
    listBankAccounts(sb),
    readAllPages<BankTransactionRow>(
      (from, to) =>
        sb
          .from("acc_bank_transaction")
          .select("*")
          .eq("import_batch_id", batchId)
          .is("provider_removed_at", null)
          .order("txn_date")
          .order("id")
          .range(from, to),
      fail,
    ),
    listSuggestions(sb, batch.bank_account_id),
    openDocuments(sb),
    listBankRules(sb),
    loadHistory(sb),
    listAccounts(sb),
  ]);
  const bank = banks.find((b) => b.id === batch.bank_account_id);
  const currencyCode = bank?.currency_code ?? "USD";
  const codable = accountRows.filter((row) => codableAccount(codingAccountOf(row)));

  // Most confident first, so the first seen for a line is its best.
  const bestMatch = new Map<string, { reconciliationId: string; entryNumber: string | null }>();
  for (const match of matches) {
    if (!bestMatch.has(match.bank_transaction_id)) {
      bestMatch.set(match.bank_transaction_id, { reconciliationId: match.id, entryNumber: match.target_number });
    }
  }
  const coding = new Map(
    suggestionsFrom({ lines, rules, history, accounts: accountRows, matchedLineIds: new Set(bestMatch.keys()) }).map((s) => [
      s.transactionId,
      s,
    ]),
  );

  return {
    batch: {
      id: batch.id,
      filename: batch.filename ?? "Statement",
      rowCount: Number(batch.row_count),
      importedAt: batch.imported_at,
      status: batch.status,
      bankAccountId: batch.bank_account_id,
      bankLabel: bank ? `${bank.bank_name || bank.account_name} · ${bank.account_code}` : "Bank account",
      currencyCode,
    },
    lines: lines.map((row) => ({
      id: row.id,
      txnDate: row.txn_date,
      description: row.description ?? "",
      reference: row.reference,
      amountMinor: Number(row.amount_minor),
      proposal: reviewProposal({
        line: { id: row.id, status: row.status, pending: row.pending, amountMinor: Number(row.amount_minor), currencyCode },
        match: bestMatch.get(row.id) ?? null,
        documents,
        coding: coding.get(row.id) ?? null,
      }),
    })),
    accounts: codable.map((row) => ({ id: row.id, label: `${row.account_code} — ${row.name}` })),
    ruleAccounts: codable,
  };
}

export interface ReviewOutcome {
  id: string;
  ok: boolean;
  /** What was done: "Matched", "Settled", or the entry number. */
  detail?: string;
  error?: string;
}

export interface ReviewPostDeps {
  lineState: (sb: SupabaseClient, id: string) => Promise<{ status: string; pending: boolean; amountMinor: number } | null>;
  matchOf: (sb: SupabaseClient, reconciliationId: string) => Promise<{ bankTransactionId: string; status: string } | null>;
  approve: (sb: SupabaseClient, reconciliationId: string) => Promise<void>;
  settle: typeof settleFromBankTransaction;
  categorise: (sb: SupabaseClient, transactionId: string, accountId: string) => Promise<{ entry_number: string | null }>;
}

const defaultDeps: ReviewPostDeps = {
  lineState: async (sb, id) => {
    const { data, error } = await sb.from("acc_bank_transaction").select("status,pending,amount_minor").eq("id", id).maybeSingle();
    if (error) throw fail(error.message);
    if (!data) return null;
    const row = data as { status: string; pending: boolean; amount_minor: number };
    return { status: row.status, pending: row.pending, amountMinor: Number(row.amount_minor) };
  },
  matchOf: async (sb, reconciliationId) => {
    const { data, error } = await sb.from("acc_reconciliation").select("bank_transaction_id,status").eq("id", reconciliationId).maybeSingle();
    if (error) throw fail(error.message);
    if (!data) return null;
    const row = data as { bank_transaction_id: string; status: string };
    return { bankTransactionId: row.bank_transaction_id, status: row.status };
  },
  approve: approveReconciliation,
  settle: settleFromBankTransaction,
  categorise: categoriseBankTransaction,
};

/** Post what a person ticked, one line after another; a refusal stops only its own line. */
export async function postReviewItems(
  sb: SupabaseClient,
  items: readonly ReviewPostItem[],
  deps: ReviewPostDeps = defaultDeps,
): Promise<ReviewOutcome[]> {
  if (items.length > REVIEW_POST_CHUNK) throw fail(`Post at most ${REVIEW_POST_CHUNK} lines at a time`);
  const outcomes: ReviewOutcome[] = [];
  for (const item of items) {
    const id = item.transactionId;
    try {
      const state = await deps.lineState(sb, id);
      if (!state) {
        outcomes.push({ id, ok: false, error: "This line is no longer on the statement, so nothing was posted" });
        continue;
      }
      if (state.status !== "unmatched" || state.pending) {
        outcomes.push({ id, ok: false, error: "This line was already handled, so nothing was posted" });
        continue;
      }
      if (item.kind === "match") {
        const match = await deps.matchOf(sb, item.reconciliationId);
        if (!match || match.bankTransactionId !== id || match.status !== "suggested") {
          outcomes.push({ id, ok: false, error: "That ledger match is no longer on offer, so nothing was posted" });
          continue;
        }
        await deps.approve(sb, item.reconciliationId);
        outcomes.push({ id, ok: true, detail: "Matched" });
      } else if (item.kind === "document") {
        await deps.settle(sb, {
          bankTransactionId: id,
          allocations: [{ document_id: item.documentId, amount_minor: Math.abs(state.amountMinor) }],
          method: null,
          memo: null,
        });
        outcomes.push({ id, ok: true, detail: "Settled" });
      } else {
        const posted = await deps.categorise(sb, id, item.accountId);
        outcomes.push({ id, ok: true, detail: posted.entry_number ?? "Posted" });
      }
    } catch (err) {
      outcomes.push({ id, ok: false, error: err instanceof Error ? err.message : "Could not post this line" });
    }
  }
  return outcomes;
}
