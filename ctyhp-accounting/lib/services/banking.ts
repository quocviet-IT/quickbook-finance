import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankAccountRow, BankTransactionRow } from "@/lib/db/types";
import {
  matchTransactions,
  type BankTxnLite,
  type PaymentLite,
} from "@/lib/domain/reconciliation";
import { writeAudit } from "./audit";

export class BankingError extends Error {}

/** Deterministic short hash (djb2) used to dedupe re-imported statement lines. */
export function rawHash(parts: (string | number | null | undefined)[]): string {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

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

export async function createBankAccount(
  sb: SupabaseClient,
  input: { account_id: string; bank_name: string; account_number_masked?: string | null; currency_code: string },
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

  const { data: batch, error: e1 } = await sb
    .from("acc_bank_import_batch")
    .insert({ bank_account_id: bankAccountId, filename, row_count: rows.length })
    .select("id")
    .single();
  if (e1) throw new BankingError(e1.message);
  const batchId = (batch as { id: string }).id;

  const toInsert = rows.map((r) => ({
    bank_account_id: bankAccountId,
    import_batch_id: batchId,
    txn_date: r.txn_date,
    description: r.description,
    reference: r.reference,
    amount_minor: r.amount_minor,
    running_balance_minor: r.running_balance_minor,
    raw_line: r.raw_line,
    raw_hash: rawHash([bankAccountId, r.txn_date, r.amount_minor, r.description, r.reference]),
  }));

  const { data, error } = await sb
    .from("acc_bank_transaction")
    .upsert(toInsert, { onConflict: "bank_account_id,raw_hash", ignoreDuplicates: true })
    .select("id");
  if (error) throw new BankingError(error.message);

  const inserted = (data ?? []).length;
  await writeAudit(sb, {
    table_name: "acc_bank_transaction",
    record_id: batchId,
    action: "insert",
    after: { imported: inserted, filename },
  });
  return { inserted, skipped: rows.length - inserted };
}

export async function listBankTransactions(
  sb: SupabaseClient,
  bankAccountId: string,
): Promise<BankTransactionRow[]> {
  const { data, error } = await sb
    .from("acc_bank_transaction")
    .select("*")
    .eq("bank_account_id", bankAccountId)
    .order("txn_date", { ascending: false });
  if (error) throw new BankingError(error.message);
  return (data ?? []) as unknown as BankTransactionRow[];
}

/** Generate reconciliation suggestions for a bank account's unmatched txns. */
export async function generateSuggestions(sb: SupabaseClient, bankAccountId: string): Promise<number> {
  const { data: txnData, error: e1 } = await sb
    .from("acc_bank_transaction")
    .select("id,txn_date,amount_minor,description,reference")
    .eq("bank_account_id", bankAccountId)
    .eq("status", "unmatched");
  if (e1) throw new BankingError(e1.message);

  const { data: approved } = await sb.from("acc_reconciliation").select("payment_id").eq("status", "approved");
  const takenPayments = new Set((approved ?? []).map((r) => r.payment_id as string).filter(Boolean));

  const { data: payData, error: e2 } = await sb
    .from("acc_payment")
    .select("id,payment_number,payment_date,amount_minor,acc_customer(name)")
    .neq("status", "void");
  if (e2) throw new BankingError(e2.message);

  const txns: BankTxnLite[] = (txnData ?? []).map((t) => ({
    id: t.id as string,
    txnDate: t.txn_date as string,
    amountMinor: Number(t.amount_minor),
    description: (t.description as string) ?? "",
    reference: (t.reference as string) ?? null,
  }));
  const payments: PaymentLite[] = ((payData ?? []) as unknown as Record<string, unknown>[])
    .filter((p) => !takenPayments.has(p.id as string))
    .map((p) => ({
      id: p.id as string,
      paymentDate: p.payment_date as string,
      amountMinor: Number(p.amount_minor),
      number: (p.payment_number as string) ?? null,
      customerName: (p.acc_customer as { name?: string } | null)?.name ?? "",
    }));

  const suggestions = matchTransactions(txns, payments);
  if (!suggestions.length) return 0;

  const { data, error } = await sb
    .from("acc_reconciliation")
    .upsert(
      suggestions.map((s) => ({
        bank_transaction_id: s.bankTransactionId,
        payment_id: s.paymentId,
        rule_applied: s.rule,
        confidence: s.confidence,
        status: "suggested",
      })),
      { onConflict: "bank_transaction_id,payment_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new BankingError(error.message);
  return (data ?? []).length;
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
  payment_id: string;
  payment_number: string | null;
}

export async function listSuggestions(sb: SupabaseClient, bankAccountId: string): Promise<SuggestionView[]> {
  const { data, error } = await sb
    .from("acc_reconciliation")
    .select(
      "id,confidence,rule_applied,status,bank_transaction_id,payment_id," +
        "acc_bank_transaction!inner(txn_date,description,amount_minor,bank_account_id),acc_payment(payment_number)",
    )
    .eq("status", "suggested")
    .eq("acc_bank_transaction.bank_account_id", bankAccountId)
    .order("confidence", { ascending: false });
  if (error) throw new BankingError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const txn = r.acc_bank_transaction as { txn_date: string; description: string; amount_minor: number };
    const pay = r.acc_payment as { payment_number?: string } | null;
    return {
      id: r.id as string,
      confidence: Number(r.confidence),
      rule_applied: (r.rule_applied as string) ?? null,
      status: r.status as string,
      bank_transaction_id: r.bank_transaction_id as string,
      txn_date: txn.txn_date,
      txn_description: txn.description,
      amount_minor: Number(txn.amount_minor),
      payment_id: r.payment_id as string,
      payment_number: pay?.payment_number ?? null,
    };
  });
}

export async function approveReconciliation(sb: SupabaseClient, id: string): Promise<void> {
  const { data: rec, error: e0 } = await sb
    .from("acc_reconciliation")
    .select("bank_transaction_id")
    .eq("id", id)
    .single();
  if (e0) throw new BankingError(e0.message);

  const { error: e1 } = await sb
    .from("acc_reconciliation")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (e1) throw new BankingError(e1.message);

  const { error: e2 } = await sb
    .from("acc_bank_transaction")
    .update({ status: "matched" })
    .eq("id", (rec as { bank_transaction_id: string }).bank_transaction_id);
  if (e2) throw new BankingError(e2.message);

  await writeAudit(sb, { table_name: "acc_reconciliation", record_id: id, action: "update", after: { status: "approved" } });
}

export async function rejectReconciliation(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb
    .from("acc_reconciliation")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new BankingError(error.message);
}
