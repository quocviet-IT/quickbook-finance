import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Invoice statuses whose journal entry must be reversed before the row can go. */
const POSTED_STATUSES = new Set(["issued", "partial", "paid"]);

/**
 * The maintenance channel. Since migration 0066 an application session cannot
 * delete a numbered document — that is the control the accountant asked for —
 * so removing test residue is a service-role act, outside the application, and
 * it leaves a documented note behind for the number it frees.
 */
function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Delete everything carrying `marker`. Safe to call twice, and safe to call
 * before a run to clear residue from an interrupted one. Posted invoices are
 * voided first — a journal entry is never deleted out from under the ledger.
 */
export async function sweepMarker(
  sb: SupabaseClient,
  marker: string,
): Promise<{ invoices: number; customers: number }> {
  await sweepMarkedPayments(sb, marker);

  const { data: invoices, error: findError } = await sb
    .from("acc_invoice")
    .select("id, status, invoice_number")
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
    const numbered = invoices.filter((row) => row.invoice_number !== null);
    const admin = numbered.length > 0 ? adminClient() : null;
    if (numbered.length > 0 && !admin) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is required to remove a numbered test invoice — " +
          "an application session may not delete one.",
      );
    }
    const remover = admin ?? sb;

    const ids = invoices.map((row) => row.id);
    const { error: lineError } = await remover
      .from("acc_invoice_line")
      .delete()
      .in("invoice_id", ids);
    if (lineError) {
      throw new Error(`deleting marked invoice lines failed: ${lineError.message}`);
    }
    const { error: headerError } = await remover.from("acc_invoice").delete().in("id", ids);
    if (headerError) {
      throw new Error(`deleting marked invoices failed: ${headerError.message}`);
    }
    if (admin) await noteFreedNumbers(admin, numbered, marker);
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

/**
 * A number the sweep freed is a real break in the invoice sequence. Recording
 * why keeps the integrity report meaningful: what it still flags is what nobody
 * can account for.
 */
async function noteFreedNumbers(
  admin: SupabaseClient,
  invoices: { invoice_number: string | null }[],
  marker: string,
): Promise<void> {
  const rows = invoices
    .map((invoice) => Number(invoice.invoice_number!.replace(/\D/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => ({
      sequence_key: "invoice",
      number_value: value,
      reason: `Removed by the end-to-end test sweep (${marker})`,
    }));
  if (rows.length === 0) return;
  const { error } = await admin
    .from("acc_number_gap_note")
    .upsert(rows, { onConflict: "sequence_key,number_value" });
  if (error) throw new Error(`recording freed invoice numbers failed: ${error.message}`);
}

/**
 * Customer payments have no void path in the application — a received payment
 * is not something a bookkeeper takes back, they refund it — and an invoice
 * with payments applied cannot be voided. So a test that recorded one has to
 * be unwound outside the application: drop the allocation, void the journal
 * entry it posted (reports read posted entries only, so the ledger nets to
 * zero), then remove the payment row itself.
 */
async function sweepMarkedPayments(sb: SupabaseClient, marker: string): Promise<void> {
  const { data: payments, error } = await sb
    .from("acc_payment")
    .select("id, journal_entry_id")
    .eq("memo", marker);
  if (error) throw new Error(`finding marked payments failed: ${error.message}`);
  if (!payments?.length) return;

  const admin = adminClient();
  if (!admin) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required to remove a test payment — " +
        "the application has no path that unwinds one.",
    );
  }

  const ids = payments.map((row) => row.id);
  const entryIds = payments
    .map((row) => row.journal_entry_id)
    .filter((id): id is string => Boolean(id));

  // acc_void_invoice refuses an invoice whose balance no longer equals its
  // total, so the allocations have to be given back to the invoices before the
  // payment rows go, or the invoice can never be voided or removed.
  const applied = await admin
    .from("acc_payment_allocation")
    .select("invoice_id, amount_minor")
    .in("payment_id", ids);
  if (applied.error) {
    throw new Error(`reading marked payment allocations failed: ${applied.error.message}`);
  }
  const restoreByInvoice = new Map<string, number>();
  for (const row of (applied.data ?? []) as { invoice_id: string; amount_minor: number }[]) {
    restoreByInvoice.set(
      row.invoice_id,
      (restoreByInvoice.get(row.invoice_id) ?? 0) + Number(row.amount_minor),
    );
  }

  const allocations = await admin.from("acc_payment_allocation").delete().in("payment_id", ids);
  if (allocations.error) {
    throw new Error(`deleting marked payment allocations failed: ${allocations.error.message}`);
  }

  for (const [invoiceId, amount] of restoreByInvoice) {
    const current = await admin
      .from("acc_invoice")
      .select("balance_due_minor")
      .eq("id", invoiceId)
      .maybeSingle();
    if (current.error || !current.data) continue;
    const restored = Number((current.data as { balance_due_minor: number }).balance_due_minor) + amount;
    const update = await admin
      .from("acc_invoice")
      .update({ balance_due_minor: restored, status: "issued" })
      .eq("id", invoiceId);
    if (update.error) {
      throw new Error(`restoring invoice balance failed: ${update.error.message}`);
    }
  }
  if (entryIds.length) {
    const voided = await admin
      .from("acc_journal_entry")
      .update({ status: "void" })
      .in("id", entryIds);
    if (voided.error) {
      throw new Error(`voiding marked payment entries failed: ${voided.error.message}`);
    }
  }
  const removed = await admin.from("acc_payment").delete().in("id", ids);
  if (removed.error) {
    throw new Error(`deleting marked payments failed: ${removed.error.message}`);
  }
  console.info(`sweepMarker removed ${ids.length} test payment(s) with the service role`);
}
