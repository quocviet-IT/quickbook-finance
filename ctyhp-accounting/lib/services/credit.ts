import type { SupabaseClient } from "@supabase/supabase-js";
import { creditStatus, type CreditStatus } from "@/lib/domain/credit";

export class CreditError extends Error {}

export interface CustomerCreditRow {
  customerId: string;
  name: string;
  isActive: boolean;
  creditLimitMinor: number | null;
  creditTermsDays: number | null;
  creditHold: boolean;
  creditReviewedAt: string | null;
  openBalanceMinor: number;
  overdueMinor: number;
  oldestDueDate: string | null;
  salesWindowMinor: number;
  hasBillingAddress: boolean;
  status: CreditStatus;
}

export const CREDIT_SALES_WINDOW_DAYS = 90;

/**
 * Every customer with what they owe today. The balances come from the open
 * invoices each time this is called — there is no stored exposure to go stale —
 * and the status is decided by the same pure rules the invoice screen uses.
 */
export async function listCustomerCredit(
  sb: SupabaseClient,
  options: { asOf?: string; windowDays?: number } = {},
): Promise<CustomerCreditRow[]> {
  const windowDays = options.windowDays ?? CREDIT_SALES_WINDOW_DAYS;
  const { data, error } = await sb.rpc("acc_customer_credit_status", {
    p_as_of: options.asOf ?? null,
    p_sales_window_days: windowDays,
  });
  if (error) throw new CreditError(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const creditLimitMinor =
      row.credit_limit_minor === null || row.credit_limit_minor === undefined
        ? null
        : Number(row.credit_limit_minor);
    const openBalanceMinor = Number(row.open_balance_minor ?? 0);
    const overdueMinor = Number(row.overdue_minor ?? 0);
    const salesWindowMinor = Number(row.sales_window_minor ?? 0);
    const creditHold = Boolean(row.credit_hold);

    return {
      customerId: row.customer_id as string,
      name: row.name as string,
      isActive: Boolean(row.is_active),
      creditLimitMinor,
      creditTermsDays:
        row.credit_terms_days === null || row.credit_terms_days === undefined
          ? null
          : Number(row.credit_terms_days),
      creditHold,
      creditReviewedAt: (row.credit_reviewed_at as string | null) ?? null,
      openBalanceMinor,
      overdueMinor,
      oldestDueDate: (row.oldest_due_date as string | null) ?? null,
      salesWindowMinor,
      hasBillingAddress: Boolean(row.has_billing_address),
      status: creditStatus({
        creditLimitMinor,
        creditHold,
        openBalanceMinor,
        overdueMinor,
        salesWindowMinor,
        salesWindowDays: windowDays,
      }),
    };
  });
}
