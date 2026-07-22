"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
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
} from "@/lib/services/banking";
import type { BankTransactionRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
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
}): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!input.account_id || !input.currency_code) return { ok: false, error: "Select a GL account and currency" };
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
  const denied = await guard();
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
  const denied = await guard();
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
  const denied = await guard();
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
