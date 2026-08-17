import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type {
  BankAccountRow,
  BankConnectionRow,
  BankFeedAccountRow,
  BankTransactionRow,
} from "@/lib/db/types";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { statementRowHash } from "@/lib/domain/banking-import";
import {
  matchLedgerTransactions,
  type BankTxnLite,
  type LedgerMatchCandidate,
} from "@/lib/domain/reconciliation";
import { decryptBankToken, encryptBankToken } from "./bank-token-crypto";
import {
  exchangePlaidPublicToken as exchangePublicToken,
  getPlaidAccounts,
  PlaidError,
  syncPlaidTransactions,
  type PlaidTransaction,
} from "./plaid";

export class BankingError extends Error {}

export interface BankAccountWithGl extends BankAccountRow {
  account_code: string;
  account_name: string;
}

export async function listBankAccounts(sb: SupabaseClient): Promise<BankAccountWithGl[]> {
  const { data, error } = await sb
    .from("acc_bank_account")
    .select("id,account_id,bank_name,account_number_masked,currency_code,created_at,acc_account(account_code,name)")
    .order("created_at");
  if (error) throw new BankingError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as BankAccountRow),
    account_code: (r.acc_account as { account_code?: string } | null)?.account_code ?? "",
    account_name: (r.acc_account as { name?: string } | null)?.name ?? "",
  }));
}

/**
 * Link a bank account to a ledger account.
 *
 * `detail_type` is what kind of account the person setting it up says this is.
 * When the ledger account carries no classification yet, theirs is written to
 * it — a chart written before the classifications existed classifies itself as
 * it gets used. An account that already says what it is is never overwritten
 * here; that belongs in Chart of Accounts, where the change is deliberate.
 *
 * A cash-on-hand ledger account is refused by the database, not by this code.
 */
export async function createBankAccount(
  sb: SupabaseClient,
  input: {
    account_id: string;
    bank_name: string;
    account_number_masked?: string | null;
    currency_code: string;
    detail_type?: string | null;
  },
): Promise<BankAccountRow> {
  const { data, error } = await sb
    .from("acc_bank_account")
    .insert({
      account_id: input.account_id,
      bank_name: input.bank_name,
      account_number_masked: input.account_number_masked || null,
      currency_code: input.currency_code,
    })
    .select("*")
    .single();
  if (error) throw new BankingError(error.message);

  if (input.detail_type) {
    const { error: classifyError } = await sb
      .from("acc_account")
      .update({ detail_type: input.detail_type })
      .eq("id", input.account_id)
      .is("detail_type", null);
    // A failure here costs the classification, not the bank account.
    if (classifyError) console.warn("classifying the ledger account failed:", classifyError.message);
  }

  return data as unknown as BankAccountRow;
}

export interface ImportRow {
  txn_date: string;
  description: string;
  reference: string | null;
  amount_minor: number;
  running_balance_minor: number | null;
  raw_line: string;
}

export async function importStatement(
  sb: SupabaseClient,
  bankAccountId: string,
  filename: string,
  rows: ImportRow[],
): Promise<{ inserted: number; skipped: number }> {
  if (!rows.length) return { inserted: 0, skipped: 0 };

  const payload = rows.map((r) => ({
    txn_date: r.txn_date,
    description: r.description,
    reference: r.reference,
    amount_minor: r.amount_minor,
    running_balance_minor: r.running_balance_minor,
    raw_line: r.raw_line,
    raw_hash: statementRowHash([bankAccountId, r.txn_date, r.amount_minor, r.description, r.reference]),
    source: "file_upload",
  }));

  const { data, error } = await sb.rpc("acc_import_bank_statement", {
    p_bank_account_id: bankAccountId,
    p_filename: filename,
    p_rows: payload,
  });
  if (error) throw new BankingError(error.message);
  const result = (Array.isArray(data) ? data[0] : data) as
    | { inserted?: number; skipped?: number }
    | null;
  return {
    inserted: Number(result?.inserted ?? 0),
    skipped: Number(result?.skipped ?? rows.length),
  };
}

export interface BankStatementImportRow {
  id: string;
  bank_account_id: string;
  account_code: string;
  account_name: string;
  filename: string;
  /** Rows the file held. */
  row_count: number;
  /** Lines of it still in the register. */
  lines_here: number;
  /** Lines the ledger now cites, which is what stops an undo. */
  locked_lines: number;
  imported_at: string;
  status: "active" | "voided";
  voided_at: string | null;
  void_reason: string | null;
}

/** Statement imports, newest first. Null means every bank account. */
export async function listBankStatementImports(
  sb: SupabaseClient,
  bankAccountId: string | null,
): Promise<BankStatementImportRow[]> {
  const { data, error } = await sb.rpc("acc_bank_statement_imports", {
    p_bank_account_id: bankAccountId,
  });
  if (error) throw new BankingError(error.message);
  return (data ?? []) as unknown as BankStatementImportRow[];
}

/**
 * Take back a statement import, removing every line it brought in.
 *
 * Refused the moment one of those lines has been matched: a bank line the
 * ledger points at cannot be removed without leaving the entry citing nothing.
 */
export async function undoBankStatementImport(
  sb: SupabaseClient,
  batchId: string,
  reason: string,
): Promise<number> {
  const { data, error } = await sb.rpc("acc_undo_bank_statement_import", {
    p_batch_id: batchId,
    p_reason: reason,
  });
  if (error) throw new BankingError(error.message);
  return Number(data ?? 0);
}

/** Remove a single unmatched bank line. Same refusal, one line at a time. */
export async function deleteBankTransaction(
  sb: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_delete_bank_transaction", { p_id: id, p_reason: reason });
  if (error) throw new BankingError(error.message);
}

/**
 * Delete a bank line, voiding the journal entry categorising it posted
 * first — Correction to RQ-06, 2026-08-17.
 *
 * `acc_delete_bank_transaction` only ever accepted an `unmatched` row, so
 * Delete was invisible on every row of a company where every line had been
 * categorised (categorising posts an entry — migration 0111). This composes
 * the existing, already-audited `acc_uncategorise_bank_transaction` and
 * `acc_delete_bank_transaction` in one server action rather than one line.
 *
 * Two RPC calls, not one atomic database function, by deliberate choice
 * under a deadline: a new migration needed `verify:company-provisioning`
 * and a schema change nobody could apply to the live database before this
 * had to ship. `acc_delete_payment` (migration 0106) shows the atomic
 * shape this would take if that trade were made later — one plpgsql
 * function calling `perform acc_void_payment(...)` before its own delete,
 * so a mid-way refusal rolls back everything. That is not what this does.
 *
 * The window this leaves: if the void below succeeds and the delete that
 * follows then fails — realistically only a concurrent edit to this exact
 * row in the instant between the two calls — the entry stays voided and the
 * line survives as `unmatched` rather than the pre-click state. That is
 * disclosed, not hidden: the thrown message says so, and the row is left
 * exactly where a deliberate "Remove category" click already leaves it
 * today, so pressing Delete again finishes the job. Every other failure
 * path (permission, a closed period, a settlement, an import batch, a
 * short reason) fails inside the first call or before either runs, so nothing
 * changes.
 */
export async function deleteBankTransactionWithVoid(
  sb: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  const { data: txn, error: txnError } = await sb
    .from("acc_bank_transaction")
    .select("status")
    .eq("id", id)
    .single();
  if (txnError) throw new BankingError(txnError.message);
  const status = (txn as { status: string } | null)?.status;

  if (status !== "matched") {
    // Unmatched (nothing to void) or ignored (acc_delete_bank_transaction's
    // own status check names it) both go straight to the existing delete.
    await deleteBankTransaction(sb, id, reason);
    return;
  }

  // A line settled against an invoice or bill carries an approved
  // reconciliation with no journal_line_id at all — acc_uncategorise_bank_transaction
  // only knows lines *it* can take back, and would answer "not categorised",
  // which reads as if nothing had ever happened to this line. It has:
  // naming the real reason is what a refusal owes the reader.
  const { data: settled, error: settledError } = await sb
    .from("acc_reconciliation")
    .select("id")
    .eq("bank_transaction_id", id)
    .eq("status", "approved")
    .is("journal_line_id", null)
    .maybeSingle();
  if (settledError) throw new BankingError(settledError.message);
  if (settled) {
    throw new BankingError(
      "This line was settled against an invoice or bill. Remove that payment first, then delete the line.",
    );
  }

  // Every other refusal — a transactions-import batch, a match owned by
  // something else, a closed period — is already this function's own
  // message; none of it is repeated here.
  await uncategoriseBankTransaction(sb, id, reason);

  try {
    await deleteBankTransaction(sb, id, reason);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "an unexpected error";
    throw new BankingError(
      `The journal entry was voided, but the line itself could not be deleted: ${detail} ` +
        "The line is now unmatched and awaiting review — press Delete again once that is resolved.",
    );
  }
}

export interface BankPostingRow {
  bank_transaction_id: string;
  journal_entry_id: string;
  entry_number: string | null;
  account_id: string;
  account_code: string;
  account_name: string;
  source_type: string;
  /** Whether Banking may take this entry back, or something else owns it. */
  own_entry: boolean;
}

/**
 * What each matched line was actually posted to.
 *
 * The screen asked "which category?" beside a line already marked matched — a
 * question the books had answered and it had no way to read. This is the
 * answer: the account on the other side of the entry, and whether undoing it
 * from here would be reversing something this screen did or something that
 * belongs to an invoice, a bill or an import.
 */
export async function listBankTransactionPostings(
  sb: SupabaseClient,
  bankAccountId: string | null,
): Promise<BankPostingRow[]> {
  const { data, error } = await sb.rpc("acc_bank_transaction_postings", {
    p_bank_account_id: bankAccountId,
  });
  if (error) throw new BankingError(error.message);
  return (data ?? []) as unknown as BankPostingRow[];
}

/**
 * Say which account the other side of this money belongs to, and post it.
 *
 * One line in, one entry out. The bank's own ledger account on one side, the
 * account chosen on the other — the same shape the transactions import posts,
 * because it is the same act done one row at a time.
 */
export async function categoriseBankTransaction(
  sb: SupabaseClient,
  transactionId: string,
  accountId: string,
): Promise<{ entry_number: string | null; account_code: string; account_name: string }> {
  const { data, error } = await sb.rpc("acc_categorise_bank_transaction", {
    p_transaction_id: transactionId,
    p_account_id: accountId,
  });
  if (error) throw new BankingError(error.message);
  return (Array.isArray(data) ? data[0] : data) as {
    entry_number: string | null;
    account_code: string;
    account_name: string;
  };
}

/** Take it back: the entry is voided, and the line awaits review again. */
export async function uncategoriseBankTransaction(
  sb: SupabaseClient,
  transactionId: string,
  reason?: string,
): Promise<number> {
  const { data, error } = await sb.rpc("acc_uncategorise_bank_transaction", {
    p_transaction_id: transactionId,
    p_reason: reason ?? null,
  });
  if (error) throw new BankingError(error.message);
  return Number(data ?? 0);
}

/** Null means every bank account, for the review queue that spans them all. */
export async function listBankTransactions(
  sb: SupabaseClient,
  bankAccountId: string | null,
): Promise<BankTransactionRow[]> {
  let query = sb
    .from("acc_bank_transaction")
    // The label's name comes along, so the list does not ask once per row.
    .select("*,acc_bank_category(name)")
    .is("provider_removed_at", null);
  if (bankAccountId) query = query.eq("bank_account_id", bankAccountId);
  const { data, error } = await query.order("txn_date", { ascending: false });
  if (error) throw new BankingError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as BankTransactionRow),
    bank_category_name: (row.acc_bank_category as { name?: string } | null)?.name ?? null,
  }));
}

/** The labels a bookkeeper may choose from, in the order they read them. */
export interface BankConnectionView extends BankConnectionRow {
  accounts: BankFeedAccountRow[];
}

export async function listBankConnections(sb: SupabaseClient): Promise<BankConnectionView[]> {
  const [{ data: connections, error: connectionError }, { data: accounts, error: accountError }] = await Promise.all([
    sb.from("acc_bank_connection").select("*").order("created_at"),
    sb.from("acc_bank_feed_account").select("*").eq("is_active", true).order("created_at"),
  ]);
  if (connectionError) throw new BankingError(connectionError.message);
  if (accountError) throw new BankingError(accountError.message);
  const feedAccounts = (accounts ?? []) as unknown as BankFeedAccountRow[];
  return ((connections ?? []) as unknown as BankConnectionRow[]).map((connection) => ({
    ...connection,
    accounts: feedAccounts.filter((account) => account.connection_id === connection.id),
  }));
}

export interface PlaidAccountMappingInput {
  provider_account_id: string;
  bank_account_id: string;
}

export interface ConnectedPlaidResult {
  connectionId: string;
  sync: BankFeedSyncResult;
}

export async function connectPlaidBank(
  sb: SupabaseClient,
  input: {
    publicToken: string;
    institutionId: string | null;
    institutionName: string;
    mappings: PlaidAccountMappingInput[];
  },
): Promise<ConnectedPlaidResult> {
  if (!input.publicToken || !input.institutionName || !input.mappings.length) {
    throw new BankingError("Institution and at least one account mapping are required");
  }

  const { accessToken, itemId } = await exchangePublicToken(input.publicToken);
  const providerAccounts = await getPlaidAccounts(accessToken);
  const selectedProviderIds = new Set(input.mappings.map((mapping) => mapping.provider_account_id));
  const selectedAccounts = providerAccounts.filter((account) => selectedProviderIds.has(account.account_id));
  if (selectedAccounts.length !== input.mappings.length) {
    throw new BankingError("One or more selected provider accounts are no longer available");
  }

  const { data: currencies, error: currencyError } = await sb
    .from("acc_currency")
    .select("code,decimal_places");
  if (currencyError) throw new BankingError(currencyError.message);
  const decimals = new Map((currencies ?? []).map((row) => [row.code as string, Number(row.decimal_places)]));
  const mappingByProvider = new Map(input.mappings.map((mapping) => [mapping.provider_account_id, mapping]));

  const accounts = selectedAccounts.map((account) => {
    const currency = account.balances.iso_currency_code?.toUpperCase();
    if (currency !== USD_CURRENCY_CODE) {
      throw new BankingError(`${account.name} is not a USD account`);
    }
    if (!decimals.has(currency)) {
      throw new BankingError("USD currency configuration is missing");
    }
    const mapping = mappingByProvider.get(account.account_id);
    if (!mapping) throw new BankingError(`Ledger mapping is missing for ${account.name}`);
    const current = account.balances.current;
    return {
      bank_account_id: mapping.bank_account_id,
      provider_account_id: account.account_id,
      account_name: account.official_name || account.name,
      account_mask: account.mask,
      account_type: account.type,
      account_subtype: account.subtype,
      currency_code: currency,
      last_balance_minor: current === null ? null : Math.round(current * 10 ** (decimals.get(currency) ?? 2)),
    };
  });

  const encryptedToken = encryptBankToken(accessToken);
  const { data, error } = await sb.rpc("acc_save_bank_connection", {
    p_provider_item_id: itemId,
    p_institution_id: input.institutionId,
    p_institution_name: input.institutionName,
    p_encrypted_access_token: encryptedToken,
    p_accounts: accounts,
  });
  if (error) throw new BankingError(error.message);
  const connectionId = data as string;
  const sync = await syncBankConnection(sb, connectionId);
  return { connectionId, sync };
}

interface NormalizedFeedTransaction {
  external_transaction_id: string;
  provider_account_id: string;
  txn_date: string;
  authorized_date: string | null;
  description: string;
  merchant_name: string | null;
  category: string | null;
  reference: string | null;
  amount_minor: number;
  pending: boolean;
  running_balance_minor: null;
  raw_line: string;
  raw_hash: string;
}

export interface BankFeedSyncResult {
  added: number;
  modified: number;
  removed: number;
  suggestions: number;
}

function normalizePlaidTransaction(
  transaction: PlaidTransaction,
  decimalsByAccount: Map<string, number>,
): NormalizedFeedTransaction {
  const decimalPlaces = decimalsByAccount.get(transaction.account_id);
  if (decimalPlaces === undefined) {
    throw new BankingError(`No mapped currency was found for provider account ${transaction.account_id}`);
  }
  const raw = JSON.stringify(transaction);
  return {
    external_transaction_id: transaction.transaction_id,
    provider_account_id: transaction.account_id,
    txn_date: transaction.date,
    authorized_date: transaction.authorized_date,
    description: transaction.merchant_name || transaction.name || "Bank transaction",
    merchant_name: transaction.merchant_name,
    category:
      transaction.personal_finance_category?.detailed ||
      transaction.personal_finance_category?.primary ||
      null,
    reference: null,
    // Plaid is positive for money out; the accounting app is positive for money in.
    amount_minor: -Math.round(transaction.amount * 10 ** decimalPlaces),
    pending: transaction.pending,
    running_balance_minor: null,
    raw_line: raw,
    raw_hash: createHash("sha256").update(raw).digest("hex"),
  };
}

async function collectPlaidChanges(
  accessToken: string,
  initialCursor: string | null,
): Promise<{
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: string[];
  nextCursor: string;
}> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: string[] = [];
    let cursor = initialCursor;
    try {
      while (true) {
        const page = await syncPlaidTransactions(accessToken, cursor);
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed.map((row) => row.transaction_id));
        cursor = page.next_cursor;
        if (!page.has_more) return { added, modified, removed, nextCursor: page.next_cursor };
      }
    } catch (error) {
      if (error instanceof PlaidError && error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt === 0) {
        continue;
      }
      throw error;
    }
  }
  throw new BankingError("Plaid transaction pagination could not stabilize");
}

function chunks<T>(rows: T[], size = 200): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

export async function syncBankConnection(
  sb: SupabaseClient,
  connectionId: string,
): Promise<BankFeedSyncResult> {
  const { data: connection, error: connectionError } = await sb
    .from("acc_bank_connection")
    .select("id,sync_cursor,status")
    .eq("id", connectionId)
    .single();
  if (connectionError) throw new BankingError(connectionError.message);
  if ((connection as { status: string }).status === "disconnected") {
    throw new BankingError("This bank connection is disconnected");
  }

  const { data: runId, error: beginError } = await sb.rpc("acc_begin_bank_feed_sync", {
    p_connection_id: connectionId,
  });
  if (beginError) throw new BankingError(beginError.message);

  const totals = { added: 0, modified: 0, removed: 0, suggestions: 0 };
  let nextCursor = (connection as { sync_cursor: string | null }).sync_cursor;
  try {
    const [{ data: encryptedToken, error: tokenError }, { data: mappings, error: mappingError }] = await Promise.all([
      sb.rpc("acc_get_bank_connection_token", { p_connection_id: connectionId }),
      sb
        .from("acc_bank_feed_account")
        .select("bank_account_id,provider_account_id,currency_code")
        .eq("connection_id", connectionId)
        .eq("is_active", true),
    ]);
    if (tokenError) throw new BankingError(tokenError.message);
    if (mappingError) throw new BankingError(mappingError.message);

    const currencyCodes = [...new Set((mappings ?? []).map((row) => row.currency_code as string))];
    const { data: currencies, error: currencyError } = await sb
      .from("acc_currency")
      .select("code,decimal_places")
      .in("code", currencyCodes);
    if (currencyError) throw new BankingError(currencyError.message);
    const currencyDecimals = new Map((currencies ?? []).map((row) => [row.code as string, Number(row.decimal_places)]));
    const decimalsByAccount = new Map(
      (mappings ?? []).map((row) => [
        row.provider_account_id as string,
        currencyDecimals.get(row.currency_code as string) ?? 2,
      ]),
    );

    const changes = await collectPlaidChanges(
      decryptBankToken(encryptedToken as string),
      (connection as { sync_cursor: string | null }).sync_cursor,
    );
    nextCursor = changes.nextCursor;
    const added = changes.added
      .filter((row) => decimalsByAccount.has(row.account_id))
      .map((row) => normalizePlaidTransaction(row, decimalsByAccount));
    const modified = changes.modified
      .filter((row) => decimalsByAccount.has(row.account_id))
      .map((row) => normalizePlaidTransaction(row, decimalsByAccount));

    const pageCount = Math.max(chunks(added).length, chunks(modified).length, chunks(changes.removed).length, 1);
    const addedChunks = chunks(added);
    const modifiedChunks = chunks(modified);
    const removedChunks = chunks(changes.removed);
    for (let index = 0; index < pageCount; index++) {
      const { data: applied, error: applyError } = await sb.rpc("acc_apply_bank_feed_page", {
        p_connection_id: connectionId,
        p_added: addedChunks[index] ?? [],
        p_modified: modifiedChunks[index] ?? [],
        p_removed: removedChunks[index] ?? [],
      });
      if (applyError) throw new BankingError(applyError.message);
      const counts = applied as { added?: number; modified?: number; removed?: number };
      totals.added += Number(counts.added ?? 0);
      totals.modified += Number(counts.modified ?? 0);
      totals.removed += Number(counts.removed ?? 0);
    }

    for (const bankAccountId of new Set((mappings ?? []).map((row) => row.bank_account_id as string))) {
      totals.suggestions += await generateSuggestions(sb, bankAccountId);
    }

    const { error: finishError } = await sb.rpc("acc_finish_bank_feed_sync", {
      p_run_id: runId,
      p_cursor: nextCursor,
      p_added_count: totals.added,
      p_modified_count: totals.modified,
      p_removed_count: totals.removed,
      p_matched_count: totals.suggestions,
      p_error_message: null,
    });
    if (finishError) throw new BankingError(finishError.message);
    return totals;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bank feed synchronization failed";
    await sb.rpc("acc_finish_bank_feed_sync", {
      p_run_id: runId,
      p_cursor: nextCursor,
      p_added_count: totals.added,
      p_modified_count: totals.modified,
      p_removed_count: totals.removed,
      p_matched_count: totals.suggestions,
      p_error_message: message.slice(0, 1000),
    });
    throw error instanceof BankingError ? error : new BankingError(message);
  }
}

/** Generate one-to-one match suggestions against posted lines in the linked bank GL account. */
export async function generateSuggestions(sb: SupabaseClient, bankAccountId: string): Promise<number> {
  const { data: bankAccount, error: bankError } = await sb
    .from("acc_bank_account")
    .select("account_id")
    .eq("id", bankAccountId)
    .single();
  if (bankError) throw new BankingError(bankError.message);

  const [{ data: txnData, error: txnError }, { data: approved, error: approvedError }, { data: lineData, error: lineError }] =
    await Promise.all([
      sb
        .from("acc_bank_transaction")
        .select("id,txn_date,amount_minor,description,reference")
        .eq("bank_account_id", bankAccountId)
        .eq("status", "unmatched")
        .eq("pending", false)
        .is("provider_removed_at", null),
      sb.from("acc_reconciliation").select("journal_line_id").eq("status", "approved").not("journal_line_id", "is", null),
      sb
        .from("acc_journal_line")
        .select(
          "id,journal_entry_id,debit_minor,credit_minor,memo," +
            "acc_journal_entry!inner(id,entry_number,entry_date,description,source_type,source_id,source_ref,status)",
        )
        .eq("account_id", (bankAccount as { account_id: string }).account_id)
        .eq("acc_journal_entry.status", "posted"),
    ]);
  if (txnError) throw new BankingError(txnError.message);
  if (approvedError) throw new BankingError(approvedError.message);
  if (lineError) throw new BankingError(lineError.message);

  const takenLines = new Set((approved ?? []).map((row) => row.journal_line_id as string).filter(Boolean));
  const txns: BankTxnLite[] = (txnData ?? []).map((txn) => ({
    id: txn.id as string,
    txnDate: txn.txn_date as string,
    amountMinor: Number(txn.amount_minor),
    description: (txn.description as string) ?? "",
    reference: (txn.reference as string) ?? null,
  }));
  const candidates: LedgerMatchCandidate[] = ((lineData ?? []) as unknown as Record<string, unknown>[])
    .filter((line) => !takenLines.has(line.id as string))
    .map((line) => {
      const entry = line.acc_journal_entry as {
        id: string;
        entry_number: string;
        entry_date: string;
        description: string | null;
        source_type: string;
        source_id: string | null;
        source_ref: string | null;
      };
      return {
        journalLineId: line.id as string,
        journalEntryId: line.journal_entry_id as string,
        entryDate: entry.entry_date,
        amountMinor: Number(line.debit_minor) - Number(line.credit_minor),
        entryNumber: entry.entry_number,
        sourceType: entry.source_type,
        sourceId: entry.source_id,
        description: `${entry.description ?? ""} ${(line.memo as string | null) ?? ""}`.trim(),
        reference: entry.source_ref,
      };
    });

  const suggestions = matchLedgerTransactions(txns, candidates);
  if (!suggestions.length) return 0;
  const { data, error } = await sb.rpc("acc_upsert_bank_match_suggestions", {
    p_suggestions: suggestions.map((suggestion) => ({
      bank_transaction_id: suggestion.bankTransactionId,
      journal_line_id: suggestion.journalLineId,
      rule_applied: suggestion.rule,
      confidence: suggestion.confidence,
    })),
  });
  if (error) throw new BankingError(error.message);
  return Number(data ?? 0);
}

export interface SuggestionView {
  id: string;
  confidence: number;
  rule_applied: string | null;
  status: string;
  bank_transaction_id: string;
  txn_date: string;
  txn_description: string;
  amount_minor: number;
  journal_line_id: string | null;
  journal_entry_id: string | null;
  target_number: string | null;
  target_type: string;
  target_description: string | null;
}

/** Null means every bank account, matching `listBankTransactions`. */
export async function listSuggestions(
  sb: SupabaseClient,
  bankAccountId: string | null,
): Promise<SuggestionView[]> {
  let query = sb
    .from("acc_reconciliation")
    .select(
      "id,confidence,rule_applied,status,bank_transaction_id,payment_id,journal_line_id," +
        "acc_bank_transaction!inner(txn_date,description,amount_minor,bank_account_id)," +
        "acc_payment(payment_number)," +
        "acc_journal_line(id,journal_entry_id,acc_journal_entry(entry_number,description,source_type))",
    )
    .eq("status", "suggested");
  if (bankAccountId) query = query.eq("acc_bank_transaction.bank_account_id", bankAccountId);
  const { data, error } = await query.order("confidence", { ascending: false });
  if (error) throw new BankingError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const txn = row.acc_bank_transaction as { txn_date: string; description: string; amount_minor: number };
    const payment = row.acc_payment as { payment_number?: string } | null;
    const line = row.acc_journal_line as {
      id?: string;
      journal_entry_id?: string;
      acc_journal_entry?: { entry_number?: string; description?: string | null; source_type?: string };
    } | null;
    const entry = line?.acc_journal_entry;
    return {
      id: row.id as string,
      confidence: Number(row.confidence),
      rule_applied: (row.rule_applied as string) ?? null,
      status: row.status as string,
      bank_transaction_id: row.bank_transaction_id as string,
      txn_date: txn.txn_date,
      txn_description: txn.description,
      amount_minor: Number(txn.amount_minor),
      journal_line_id: (row.journal_line_id as string) ?? null,
      journal_entry_id: line?.journal_entry_id ?? null,
      target_number: entry?.entry_number ?? payment?.payment_number ?? null,
      target_type: entry?.source_type ?? "payment",
      target_description: entry?.description ?? null,
    };
  });
}

export async function approveReconciliation(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_decide_bank_match", {
    p_reconciliation_id: id,
    p_decision: "approved",
  });
  if (error) throw new BankingError(error.message);
}

export async function rejectReconciliation(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_decide_bank_match", {
    p_reconciliation_id: id,
    p_decision: "rejected",
  });
  if (error) throw new BankingError(error.message);
}

// --- Settling a document straight from a bank line ---------------------------

/** An open invoice or bill that a bank line could be settling. */
export interface SettlementCandidateRow {
  documentId: string;
  documentNumber: string | null;
  documentDate: string;
  balanceDueMinor: number;
  currencyCode: string;
  partyName: string;
}

/**
 * Documents on the side of the ledger this bank line moves money on.
 *
 * The sign decides: money in can only settle invoices, money out only bills.
 * Ranking happens in `lib/domain/bank-settlement.ts`; this only fetches.
 */
export async function listSettlementCandidates(
  sb: SupabaseClient,
  bankTransactionId: string,
): Promise<{ direction: "receivable" | "payable"; currencyCode: string; amountMinor: number; candidates: SettlementCandidateRow[] }> {
  const { data: txn, error: txnError } = await sb
    .from("acc_bank_transaction")
    .select("id,amount_minor,txn_date,bank_account_id")
    .eq("id", bankTransactionId)
    .single();
  if (txnError) throw new BankingError(txnError.message);

  const { data: bank, error: bankError } = await sb
    .from("acc_bank_account")
    .select("currency_code")
    .eq("id", (txn as { bank_account_id: string }).bank_account_id)
    .single();
  if (bankError) throw new BankingError(bankError.message);

  const amountMinor = Number((txn as { amount_minor: number }).amount_minor);
  const currencyCode = (bank as { currency_code: string }).currency_code;
  const direction = amountMinor > 0 ? "receivable" : "payable";

  if (direction === "receivable") {
    const { data, error } = await sb
      .from("acc_invoice")
      .select("id,invoice_number,issue_date,balance_due_minor,currency_code,acc_customer(name)")
      .in("status", ["issued", "partial"])
      .gt("balance_due_minor", 0);
    if (error) throw new BankingError(error.message);
    return {
      direction,
      currencyCode,
      amountMinor,
      candidates: ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
        documentId: row.id as string,
        documentNumber: (row.invoice_number as string) ?? null,
        documentDate: row.issue_date as string,
        balanceDueMinor: Number(row.balance_due_minor),
        currencyCode: row.currency_code as string,
        partyName: (row.acc_customer as { name?: string } | null)?.name ?? "—",
      })),
    };
  }

  const { data, error } = await sb
    .from("acc_bill")
    .select("id,bill_number,bill_date,balance_due_minor,currency_code,acc_vendor(name)")
    .in("status", ["open", "partial"])
    .gt("balance_due_minor", 0);
  if (error) throw new BankingError(error.message);
  return {
    direction,
    currencyCode,
    amountMinor,
    candidates: ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      documentId: row.id as string,
      documentNumber: (row.bill_number as string) ?? null,
      documentDate: row.bill_date as string,
      balanceDueMinor: Number(row.balance_due_minor),
      currencyCode: row.currency_code as string,
      partyName: (row.acc_vendor as { name?: string } | null)?.name ?? "—",
    })),
  };
}

/**
 * Post the settlement and close the bank line off, in one database call.
 * Every ledger rule lives in the RPC; nothing is decided here.
 */
export async function settleFromBankTransaction(
  sb: SupabaseClient,
  input: {
    bankTransactionId: string;
    allocations: { document_id: string; amount_minor: number }[];
    method: string | null;
    memo: string | null;
  },
): Promise<string> {
  const { data, error } = await sb.rpc("acc_settle_from_bank_transaction", {
    p_bank_transaction_id: input.bankTransactionId,
    p_allocations: input.allocations,
    p_method: input.method,
    p_memo: input.memo,
  });
  if (error) throw new BankingError(error.message);
  return data as string;
}
