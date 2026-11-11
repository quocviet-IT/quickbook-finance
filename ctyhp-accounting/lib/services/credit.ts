import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDIT_SALES_WINDOW_DAYS, creditStatus, type CreditStatus } from "@/lib/domain/credit";
import { readAllPages } from "./paging";

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

export { CREDIT_SALES_WINDOW_DAYS };

/**
 * Every customer with what they owe today, or one customer with `customerId`.
 * The balances come from the open invoices each time this is called — there is
 * no stored exposure to go stale — and the status is decided by the same pure
 * rules the invoice screen uses.
 *
 * Read a page at a time (3.0.14): PostgREST stops an RPC's answer at 1,000 rows
 * without a word, which would drop customers past the thousandth by name. The
 * RPC orders by name; the id breaks ties between two customers of one name.
 */
export async function listCustomerCredit(
  sb: SupabaseClient,
  options: { asOf?: string; windowDays?: number; customerId?: string } = {},
): Promise<CustomerCreditRow[]> {
  const windowDays = options.windowDays ?? CREDIT_SALES_WINDOW_DAYS;
  const data = await readAllPages<Record<string, unknown>>(
    (from, to) => {
      const query = sb.rpc("acc_customer_credit_status", {
        p_as_of: options.asOf ?? null,
        p_sales_window_days: windowDays,
      });
      // One customer's page needs one row back, not every customer's.
      const scoped = options.customerId ? query.eq("customer_id", options.customerId) : query;
      return scoped.order("name").order("customer_id").range(from, to);
    },
    (message) => new CreditError(message),
  );

  return data.map((row) => {
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
