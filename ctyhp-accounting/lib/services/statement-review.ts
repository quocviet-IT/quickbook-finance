import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRow, BankTransactionRow } from "@/lib/db/types";
import { findBankPairs, lastFourDigits, namedTransferTarget, type PairBank, type PairLine } from "@/lib/domain/bank-pairs";
import { codableAccount, codingAccountOf } from "@/lib/domain/coding";
import {
  REVIEW_POST_CHUNK,
  reviewProposal,
  type ReviewDocument,
  type ReviewPairView,
  type ReviewPostItem,
  type ReviewProposal,
} from "@/lib/domain/statement-review";
import { registerClaim } from "@/lib/domain/register-claim";
import { listAccounts } from "./accounts";
import { getBankingPreference } from "./banking-preference";
import {
  approveReconciliation,
  categoriseBankTransaction,
  listBankAccounts,
  listSuggestions,
  settleFromBankTransaction,
} from "./banking";
import { listBankRules, loadHistory, suggestionsFrom } from "./coding";
import { repaymentContext } from "./repayment-register";
import { readAllPages } from "./paging";
import { loanSuggestionsFrom } from "@/lib/domain/loan-interest";
import { loadLoanMovements, loanAccountIds, postLoanPayment } from "./loan-payments";

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

  const [banks, lines, matches, documents, rules, history, accountRows, waiting, preference, baseRow, context] = await Promise.all([
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
    // Every account's: a transfer's other side sits on another bank account.
    listSuggestions(sb, null),
    openDocuments(sb),
    listBankRules(sb),
    loadHistory(sb),
    listAccounts(sb),
    // Every line in the company still waiting, for pairing: last month's cheque
    // can answer this month's deposit, and a transfer's other side is elsewhere.
    readAllPages<Pick<BankTransactionRow, "id" | "bank_account_id" | "txn_date" | "amount_minor" | "description">>(
      (from, to) =>
        sb
          .from("acc_bank_transaction")
          .select("id,bank_account_id,txn_date,amount_minor,description")
          .eq("status", "unmatched")
          .eq("pending", false)
          .is("provider_removed_at", null)
          .order("id")
          .range(from, to),
      fail,
    ),
    getBankingPreference(sb),
    sb.from("acc_currency").select("code").eq("is_base", true).maybeSingle(),
    repaymentContext(sb),
  ]);
  const bank = banks.find((b) => b.id === batch.bank_account_id);
  const currencyCode = bank?.currency_code ?? "USD";
  const codable = accountRows.filter((row) => codableAccount(codingAccountOf(row)));
  if (baseRow.error) throw fail(baseRow.error.message);
  const baseCode = (baseRow.data as { code: string } | null)?.code ?? "USD";
  const loanMovements = await loadLoanMovements(sb, loanAccountIds(context.repayments));

  // Most confident first, so the first seen for a line is its best.
  const bestMatch = new Map<string, { reconciliationId: string; entryNumber: string | null }>();
  for (const match of matches) {
    if (!bestMatch.has(match.bank_transaction_id)) {
      bestMatch.set(match.bank_transaction_id, { reconciliationId: match.id, entryNumber: match.target_number });
    }
  }
  const coding = new Map(
    suggestionsFrom({
      lines,
      rules,
      history,
      accounts: accountRows,
      matchedLineIds: new Set(bestMatch.keys()),
      repayments: context.repayments,
      related: context.related,
      baseCurrencyBankIds: context.baseCurrencyBankIds,
    }).map((s) => [s.transactionId, s]),
  );

  // --- Pairs: transfers between the company's bank accounts, and funding. ---
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const bankLabel = (id: string) => {
    const b = bankById.get(id);
    return b ? `${b.bank_name || b.account_name} · ${b.account_code}` : "another bank account";
  };
  // An open document of exactly this amount says what the money is; such a line never pairs.
  const hasExactDocument = (amountMinor: number) =>
    documents.some(
      (d) =>
        d.currencyCode === baseCode &&
        d.balanceDueMinor === Math.abs(amountMinor) &&
        d.direction === (amountMinor > 0 ? "receivable" : "payable"),
    );
  const pairable: PairLine[] = waiting
    .filter(
      (w) =>
        !bestMatch.has(w.id) &&
        bankById.get(w.bank_account_id)?.currency_code === baseCode &&
        !hasExactDocument(Number(w.amount_minor)),
    )
    .map((w) => ({
      id: w.id,
      bankAccountId: w.bank_account_id,
      txnDate: w.txn_date,
      amountMinor: Number(w.amount_minor),
      description: w.description ?? "",
    }));
  const facts = findBankPairs(pairable, preference.pairWindowDays, { fundingEnabled: Boolean(preference.fundingAccountId) });
  const fundingRow = accountRows.find((a) => a.id === preference.fundingAccountId);
  const fundingLabel = fundingRow ? `${fundingRow.account_code} ${fundingRow.name}` : "";
  const pairBanks: PairBank[] = banks.map((b) => ({
    id: b.id,
    glAccountId: b.account_id,
    label: bankLabel(b.id),
    accountName: b.account_name,
    digits: lastFourDigits(b.account_number_masked, b.account_name, b.bank_name),
  }));
  const pairView = (lineId: string, amountMinor: number): { pair: ReviewPairView | null; rivals: number } => {
    const fact = facts.get(lineId);
    if (!fact) return { pair: null, rivals: 0 };
    if (fact.kind === "ambiguous") return { pair: null, rivals: fact.rivals };
    const other = fact.counterpart;
    if (fact.kind === "transfer") {
      const direction = amountMinor < 0 ? "to" : "from";
      return {
        pair: {
          kind: "transfer",
          counterpartId: other.id,
          label: `Transfer ${direction} ${bankLabel(other.bankAccountId)}`,
          why: `The other side is on ${bankLabel(other.bankAccountId)}, ${other.txnDate}, for the same amount. Posting makes one transfer entry and matches both lines.`,
          also: "",
        },
        rivals: 0,
      };
    }
    return {
      pair: {
        kind: "funding",
        counterpartId: other.id,
        label: `Shareholder funding · ${fundingLabel}`,
        why: `Answered by ${other.description} of the same amount on ${other.txnDate} — the owner's money in and out, not income or a cost`,
        also: `possible shareholder funding with ${other.description} on ${other.txnDate}`,
      },
      rivals: 0,
    };
  };
  const namedFor = (row: BankTransactionRow) => {
    if (facts.get(row.id)?.kind === "transfer") return null;
    const target = namedTransferTarget({ bankAccountId: row.bank_account_id, description: row.description ?? "" }, pairBanks);
    if (!target) return null;
    const direction = Number(row.amount_minor) < 0 ? "to" : "from";
    return {
      accountId: target.glAccountId,
      label: `Transfer ${direction} ${target.label}`,
      why: `Reads as a transfer and names ${target.label}; no line there yet — posting moves the money without touching income or expense`,
    };
  };

  // Two of the register claiming one line: Review import names them instead of guessing.
  const chart = new Map(accountRows.map((row) => [row.id, codingAccountOf(row)]));
  const inBase = context.baseCurrencyBankIds.has(batch.bank_account_id);
  const registerRivalsOf = (row: BankTransactionRow): string[] => {
    const claim = registerClaim({
      repayments: context.repayments,
      related: context.related,
      line: { description: row.description ?? "", amountMinor: Number(row.amount_minor), inBaseCurrency: inBase },
      accounts: chart,
    });
    return claim?.kind === "rivals" ? claim.labels : [];
  };

  // Loan payments: the same split Bank Transactions shows, worked out over every
  // waiting line of the company so two payments to one loan carry in date order.
  const loans = new Map(
    loanSuggestionsFrom({
      lines: waiting.map((w) => ({
        id: w.id,
        bankAccountId: w.bank_account_id,
        date: w.txn_date,
        amountMinor: Number(w.amount_minor),
        description: w.description ?? "",
      })),
      repayments: context.repayments,
      related: context.related,
      baseCurrencyBankIds: context.baseCurrencyBankIds,
      accounts: chart,
      movements: loanMovements,
      excludeIds: new Set(bestMatch.keys()),
    }).map((view) => [view.transactionId, view]),
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
    lines: lines.map((row) => {
      const { pair, rivals } = pairView(row.id, Number(row.amount_minor));
      return {
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
          pair,
          pairRivals: rivals,
          namedTransfer: namedFor(row),
          registerRivals: registerRivalsOf(row),
          loan: loans.get(row.id) ?? null,
        }),
      };
    }),
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
  /** Post a transfer or funding pair; returns the entry numbers it made. */
  postPair: (sb: SupabaseClient, first: string, second: string, kind: "transfer" | "funding") => Promise<string[]>;
  /** Post a loan payment with the interest a person accepted; returns the entry number. */
  postLoan: (sb: SupabaseClient, transactionId: string, repaymentId: string, interestMinor: number) => Promise<string | null>;
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
  postPair: async (sb, first, second, kind) => {
    const { data, error } = await sb.rpc("acc_post_bank_pair", { p_first: first, p_second: second, p_kind: kind });
    if (error) throw fail(error.message);
    return ((data as { entries?: (string | null)[] } | null)?.entries ?? []).filter((n): n is string => Boolean(n));
  },
  postLoan: async (sb, transactionId, repaymentId, interestMinor) =>
    (await postLoanPayment(sb, transactionId, repaymentId, interestMinor)).entry_number,
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
      } else if (item.kind === "pair") {
        // Both lines in one database call: either both post, or neither does.
        const entries = await deps.postPair(sb, id, item.counterpartId, item.pairKind);
        outcomes.push({ id, ok: true, detail: entries.join(", ") || "Posted" });
      } else if (item.kind === "loan") {
        // The accounts and the principal are the database's; only the interest is ours.
        const entry = await deps.postLoan(sb, id, item.repaymentId, item.interestMinor);
        outcomes.push({ id, ok: true, detail: entry ?? "Posted" });
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
