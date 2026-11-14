import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "@/lib/format";

/**
 * The few words a record's browser tab is titled with (3.0.32): a customer's
 * name, a purchase order's number. One column of one row, read by its id, so
 * the tab does not cost the page a second read of everything it shows; Next
 * streams the title in after the page.
 *
 * A failed read is answered with null, and the tab then names the screen
 * alone. That is not the error going unnoticed: the page reads the same record
 * itself and reports a failure where the reader is looking.
 */

async function oneValue(
  sb: SupabaseClient,
  table: string,
  column: string,
  id: string,
): Promise<string | null> {
  const { data, error } = await sb.from(table).select(column).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const value = (data as unknown as Record<string, unknown>)[column];
  return typeof value === "string" && value.trim() ? value : null;
}

export function customerTitle(sb: SupabaseClient, id: string): Promise<string | null> {
  return oneValue(sb, "acc_customer", "name", id);
}

export async function purchaseOrderTitle(sb: SupabaseClient, id: string): Promise<string | null> {
  const number = await oneValue(sb, "acc_purchase_order", "po_number", id);
  return number ? `Purchase Order ${number}` : null;
}

export async function stockCountTitle(sb: SupabaseClient, id: string): Promise<string | null> {
  const number = await oneValue(sb, "acc_stock_count", "count_number", id);
  return number ? `Stock Count ${number}` : null;
}

export function savedReportTitle(sb: SupabaseClient, id: string): Promise<string | null> {
  return oneValue(sb, "acc_saved_report", "title", id);
}

/** "Checking, 03/31/2026": which account, and the statement it is reconciled to. */
export async function reconciliationTitle(sb: SupabaseClient, id: string): Promise<string | null> {
  // A bank account is named by the ledger account it posts to (acc_account), as Banking shows it.
  const { data, error } = await sb
    .from("acc_statement_reconciliation")
    .select("statement_ending_date,bank_account:acc_bank_account(acc_account(name))")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  type Named = { name?: string } | { name?: string }[] | null | undefined;
  type Bank = { acc_account?: Named } | { acc_account?: Named }[] | null;
  const first = <T,>(value: T | T[] | null | undefined): T | undefined => (Array.isArray(value) ? value[0] : (value ?? undefined));
  const row = data as unknown as { statement_ending_date: string | null; bank_account: Bank };
  const account = first(first(row.bank_account)?.acc_account)?.name;
  const ending = row.statement_ending_date ? formatDate(row.statement_ending_date) : null;
  const parts = [account, ending].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}
