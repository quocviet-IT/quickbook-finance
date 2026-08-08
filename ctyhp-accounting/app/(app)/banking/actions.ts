"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, getSessionUser } from "@/lib/auth";
import {
  createBankAccount,
  importStatement,
  categoriseBankTransaction,
  uncategoriseBankTransaction,
  listBankTransactionPostings,
  type BankPostingRow,
  listBankStatementImports,
  undoBankStatementImport,
  deleteBankTransaction,
  type BankStatementImportRow,
  listBankTransactions,
  generateSuggestions,
  listSuggestions,
  approveReconciliation,
  rejectReconciliation,
  type ImportRow,
  type SuggestionView,
  BankingError,
  connectPlaidBank,
  syncBankConnection,
  listSettlementCandidates,
  settleFromBankTransaction,
  type PlaidAccountMappingInput,
  type SettlementCandidateRow,
} from "@/lib/services/banking";
import { createPlaidLinkToken } from "@/lib/services/plaid";
import type { BankTransactionRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

async function guardPermission(permission: string): Promise<string | null> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("acc_has_permission", { p_key: permission });
  if (error || data !== true) return "You do not have permission to perform this action";
  return null;
}
function msg(err: unknown): string {
  if (err instanceof BankingError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createBankAccountAction(input: {
  account_id: string;
  bank_name: string;
  account_number_masked?: string | null;
  currency_code: string;
  /** The kind chosen in the dialog; classifies the ledger account if it has none. */
  detail_type?: string | null;
}): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!input.account_id) return { ok: false, error: "Select a General Ledger bank account" };
  if (input.currency_code !== USD_CURRENCY_CODE) {
    return { ok: false, error: "This company supports USD bank accounts only" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await createBankAccount(sb, input);
    revalidatePath("/banking");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function importStatementAction(
  bankAccountId: string,
  filename: string,
  rows: ImportRow[],
): Promise<ActionResult<{ inserted: number; skipped: number }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!rows.length) return { ok: false, error: "No rows to import" };
  try {
    const sb = await createSupabaseServerClient();
    const res = await importStatement(sb, bankAccountId, filename, rows);
    revalidatePath("/banking");
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Statement imports, and the two ways back out of one.
 *
 * Importing a statement had no reverse at all: it posts nothing to the ledger,
 * so there was no entry to void, and the lines could only be removed through a
 * database connection. Somebody put a 1,566-row file through the tab, realised
 * it imports into one bank account while their file covered eight, and had to
 * ask for help. These three are that help, in the screen.
 */
export async function getStatementImportsAction(
  bankAccountId: string | null,
): Promise<ActionResult<BankStatementImportRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listBankStatementImports(sb, bankAccountId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function undoStatementImportAction(
  batchId: string,
  reason: string,
): Promise<ActionResult<{ removed: number }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const removed = await undoBankStatementImport(sb, batchId, reason);
    revalidatePath("/banking");
    return { ok: true, data: { removed } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function deleteBankTransactionAction(
  id: string,
  reason: string,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await deleteBankTransaction(sb, id, reason);
    revalidatePath("/banking");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Categorising a bank line, which means posting it.
 *
 * The Category column used to hold a free-form label that posted nowhere, and
 * every company had zero of them — so the control was an empty dropdown, and
 * the reader's complaint was exact: they could not categorise a transaction.
 */
export async function categoriseBankTransactionAction(
  transactionId: string,
  accountId: string,
): Promise<
  ActionResult<{ entry_number: string | null; account_code: string; account_name: string }>
> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const posted = await categoriseBankTransaction(sb, transactionId, accountId);
    revalidatePath("/banking");
    revalidatePath("/reports");
    return { ok: true, data: posted };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Take it back: the entry is voided, and the line awaits review again. */
export async function uncategoriseBankTransactionAction(
  transactionId: string,
  reason?: string,
): Promise<ActionResult<{ voided: number }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const voided = await uncategoriseBankTransaction(sb, transactionId, reason);
    revalidatePath("/banking");
    revalidatePath("/reports");
    return { ok: true, data: { voided } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Reads only: what each matched line on this account was posted to. */
export async function getBankPostingsAction(
  bankAccountId: string | null,
): Promise<ActionResult<BankPostingRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listBankTransactionPostings(sb, bankAccountId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** `null` asks for every bank account, which is how the review queue spans them. */
export async function getTransactionsAction(
  bankAccountId: string | null,
): Promise<ActionResult<BankTransactionRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listBankTransactions(sb, bankAccountId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function generateSuggestionsAction(bankAccountId: string): Promise<ActionResult<{ count: number }>> {
  const denied = await guardPermission("banking.match");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const count = await generateSuggestions(sb, bankAccountId);
    return { ok: true, data: { count } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function getSuggestionsAction(
  bankAccountId: string | null,
): Promise<ActionResult<SuggestionView[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listSuggestions(sb, bankAccountId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function approveReconciliationAction(id: string): Promise<ActionResult> {
  const denied = await guardPermission("banking.match");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await approveReconciliation(sb, id);
    revalidatePath("/banking");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function rejectReconciliationAction(id: string): Promise<ActionResult> {
  const denied = await guardPermission("banking.match");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await rejectReconciliation(sb, id);
    revalidatePath("/banking");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function createPlaidLinkTokenAction(): Promise<ActionResult<{ linkToken: string }>> {
  const denied = await guardPermission("bank_feed.manage");
  if (denied) return { ok: false, error: denied };
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired" };
  try {
    return { ok: true, data: { linkToken: await createPlaidLinkToken(user.id) } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function connectPlaidBankAction(input: {
  publicToken: string;
  institutionId: string | null;
  institutionName: string;
  mappings: PlaidAccountMappingInput[];
}): Promise<ActionResult<{ connectionId: string; added: number; suggestions: number }>> {
  const denied = await guardPermission("bank_feed.manage");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const result = await connectPlaidBank(sb, input);
    revalidatePath("/banking");
    return {
      ok: true,
      data: {
        connectionId: result.connectionId,
        added: result.sync.added,
        suggestions: result.sync.suggestions,
      },
    };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function syncBankConnectionAction(
  connectionId: string,
): Promise<ActionResult<{ added: number; modified: number; removed: number; suggestions: number }>> {
  const denied = await guardPermission("bank_feed.manage");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const result = await syncBankConnection(sb, connectionId);
    revalidatePath("/banking");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export interface SettlementCandidatesView {
  direction: "receivable" | "payable";
  currencyCode: string;
  amountMinor: number;
  candidates: SettlementCandidateRow[];
}

/** Open documents this bank line could be settling, unranked. */
export async function getSettlementCandidatesAction(
  bankTransactionId: string,
): Promise<ActionResult<SettlementCandidatesView>> {
  const denied = await guardPermission("banking.match");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listSettlementCandidates(sb, bankTransactionId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Post the receipt or bill payment this bank line represents and close the line
 * off. Every rule is in `acc_settle_from_bank_transaction`; this only carries
 * the call and revalidates the screens whose figures just moved.
 */
export async function settleFromBankTransactionAction(input: {
  bankTransactionId: string;
  allocations: { document_id: string; amount_minor: number }[];
  method: string | null;
  memo: string | null;
}): Promise<ActionResult<{ settlementId: string }>> {
  const denied = await guardPermission("banking.match");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const settlementId = await settleFromBankTransaction(sb, input);
    revalidatePath("/banking");
    revalidatePath("/invoices");
    revalidatePath("/bills");
    revalidatePath("/payments");
    revalidatePath("/pay-bills");
    revalidatePath("/dashboard");
    return { ok: true, data: { settlementId } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Create a label, or reuse the one that already has this name.
 *
 * The name is trimmed here so the screen and the database agree on what was
 * typed; everything else about uniqueness belongs to `acc_upsert_bank_category`.
 */
