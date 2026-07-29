import type { SupabaseClient } from "@supabase/supabase-js";

/** Invoice statuses whose journal entry must be reversed before the row can go. */
const POSTED_STATUSES = new Set(["issued", "partial", "paid"]);

/**
 * Delete everything carrying `marker`. Safe to call twice, and safe to call
 * before a run to clear residue from an interrupted one. Posted invoices are
 * voided first — a journal entry is never deleted out from under the ledger.
 */
export async function sweepMarker(
  sb: SupabaseClient,
  marker: string,
): Promise<{ invoices: number; customers: number }> {
  const { data: invoices, error: findError } = await sb
    .from("acc_invoice")
    .select("id, status")
    .eq("memo", marker);
  if (findError) throw new Error(`finding marked invoices failed: ${findError.message}`);

  let voided = 0;
  for (const invoice of invoices ?? []) {
    if (POSTED_STATUSES.has(invoice.status)) {
      const { error } = await sb.rpc("acc_void_invoice", { p_invoice_id: invoice.id });
      if (error) throw new Error(`voiding ${invoice.id} failed: ${error.message}`);
      voided += 1;
    }
  }
  if (voided > 0) {
    // Surfaced only in test output; the return value reports rows removed.
    console.info(`sweepMarker voided ${voided} posted invoice(s) before deleting them`);
  }

  if (invoices?.length) {
    const ids = invoices.map((row) => row.id);
    const { error: lineError } = await sb
      .from("acc_invoice_line")
      .delete()
      .in("invoice_id", ids);
    if (lineError) {
      throw new Error(`deleting marked invoice lines failed: ${lineError.message}`);
    }
    const { error: headerError } = await sb.from("acc_invoice").delete().in("id", ids);
    if (headerError) {
      throw new Error(`deleting marked invoices failed: ${headerError.message}`);
    }
  }

  const { data: customers, error: customerError } = await sb
    .from("acc_customer")
    .delete()
    .eq("name", marker)
    .select("id");
  if (customerError) {
    throw new Error(`deleting marked customers failed: ${customerError.message}`);
  }

  return { invoices: invoices?.length ?? 0, customers: customers?.length ?? 0 };
}
