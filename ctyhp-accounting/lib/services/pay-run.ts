import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPayRun, type PayRun, type PayableBill } from "@/lib/domain/payment-terms";

export class PayRunError extends Error {}

/**
 * Every open bill, ranked by what should be paid next.
 *
 * The database returns the facts about each bill; the ranking is a rule and
 * lives in lib/domain/payment-terms.ts, where the tests are.
 */
export async function getPayRun(sb: SupabaseClient, asOf: string): Promise<PayRun> {
  const { data, error } = await sb.rpc("acc_payables_priority", { p_as_of: asOf });
  if (error) throw new PayRunError(error.message);

  const bills: PayableBill[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    billId: r.bill_id as string,
    billNumber: (r.bill_number as string | null) ?? null,
    vendorId: r.vendor_id as string,
    vendorName: r.vendor_name as string,
    billDate: r.bill_date as string,
    dueDate: (r.due_date as string | null) ?? null,
    termsLabel: (r.terms_label as string | null) ?? null,
    currencyCode: r.currency_code as string,
    totalMinor: Number(r.total_minor),
    balanceDueMinor: Number(r.balance_due_minor),
    discountDueDate: (r.discount_due_date as string | null) ?? null,
    discountAmountMinor: Number(r.discount_amount_minor ?? 0),
    discountTakenMinor: Number(r.discount_taken_minor ?? 0),
    status: r.status as string,
  }));

  return buildPayRun(bills, asOf);
}
