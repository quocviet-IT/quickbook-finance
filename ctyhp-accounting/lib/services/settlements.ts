import type { SupabaseClient } from "@supabase/supabase-js";
import type { SettlementEvent, SettlementType } from "@/lib/domain/settlement";

export class SettlementError extends Error {}

function toEvent(row: Record<string, unknown>): SettlementEvent {
  return {
    settledOn: row.settled_on as string,
    settlementType: row.settlement_type as SettlementType,
    documentNumber: (row.document_number as string | null) ?? null,
    method: (row.method as string | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    memo: (row.memo as string | null) ?? null,
    amountMinor: Number(row.amount_minor),
  };
}

/** Everything that has settled one invoice: payments, credits, write-offs. */
export async function listInvoiceSettlements(
  sb: SupabaseClient,
  invoiceId: string,
): Promise<SettlementEvent[]> {
  const { data, error } = await sb.rpc("acc_invoice_settlements", { p_invoice_id: invoiceId });
  if (error) throw new SettlementError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toEvent);
}

/** The same for a bill: payments made, vendor credits applied, write-offs. */
export async function listBillSettlements(
  sb: SupabaseClient,
  billId: string,
): Promise<SettlementEvent[]> {
  const { data, error } = await sb.rpc("acc_bill_settlements", { p_bill_id: billId });
  if (error) throw new SettlementError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toEvent);
}
