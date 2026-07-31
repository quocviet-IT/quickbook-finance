"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, getSessionUser } from "@/lib/auth";
import {
  createBankAccount,
  importStatement,
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
  type PlaidAccountMappingInput,
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

export async function getTransactionsAction(bankAccountId: string): Promise<ActionResult<BankTransactionRow[]>> {
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

export async function getSuggestionsAction(bankAccountId: string): Promise<ActionResult<SuggestionView[]>> {
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
