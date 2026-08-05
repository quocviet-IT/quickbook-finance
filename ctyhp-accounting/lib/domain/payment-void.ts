import type { PaymentRow } from "@/lib/db/types";

/**
 * What a replacement payment starts from.
 *
 * A void payment is never revived — the number is spent and the history stays
 * readable. When the receipt was right but the entry was wrong, the answer is a
 * *new* payment that begins where the old one did, so the user retypes nothing
 * and the allocations are chosen again deliberately rather than inherited.
 */
type ReplacementSource = Pick<
  PaymentRow,
  | "customer_id"
  | "payment_date"
  | "currency_code"
  | "amount_minor"
  | "deposit_account_id"
  | "method"
  | "reference"
  | "memo"
>;

export interface PaymentReplacementDraft {
  customer_id: string;
  payment_date: string;
  currency_code: string;
  /** Major units: the form edge is the only place money stops being minor. */
  amount: number;
  deposit_account_id: string;
  method: string | null;
  reference: string | null;
  memo: string | null;
}

export function paymentReplacementDraft(
  payment: ReplacementSource,
  decimalPlaces: number,
): PaymentReplacementDraft {
  return {
    customer_id: payment.customer_id,
    payment_date: payment.payment_date,
    currency_code: payment.currency_code,
    amount: payment.amount_minor / 10 ** decimalPlaces,
    deposit_account_id: payment.deposit_account_id,
    method: payment.method,
    reference: payment.reference,
    memo: payment.memo,
  };
}
