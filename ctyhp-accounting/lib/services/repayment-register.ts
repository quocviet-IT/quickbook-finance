import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterestMethod, RepaymentAccount, RepaymentKind } from "@/lib/domain/repayments";
import { listBankAccounts } from "./banking";
import { readAllPages } from "./paging";

/**
 * Reading the register of cards and loans (migration 0129), and the facts
 * recognition needs beside it. Writing lives in repayments.ts, which reads
 * coding history; this module is kept free of that so coding.ts can use it.
 */
export class RepaymentError extends Error {}
const fail = (message: string) => new RepaymentError(message);

const COLUMNS =
  "id,kind,account_id,match_words,match_digits,interest_account_id,interest_method,annual_rate,fixed_interest_minor,is_active";
const numberOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export function repaymentFromRow(row: Record<string, unknown>): RepaymentAccount {
  return {
    id: row.id as string,
    kind: row.kind as RepaymentKind,
    accountId: row.account_id as string,
    matchWords: (row.match_words as string | null) ?? "",
    matchDigits: (row.match_digits as string | null) ?? null,
    interestAccountId: (row.interest_account_id as string | null) ?? null,
    interestMethod: (row.interest_method as InterestMethod | null) ?? null,
    annualRate: numberOrNull(row.annual_rate),
    fixedInterestMinor: numberOrNull(row.fixed_interest_minor),
    isActive: Boolean(row.is_active),
  };
}

export async function listRepayments(sb: SupabaseClient): Promise<RepaymentAccount[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from("acc_repayment_account").select(COLUMNS).order("created_at").order("id").range(from, to),
    fail,
  );
  return rows.map(repaymentFromRow);
}

export interface RepaymentContext {
  repayments: RepaymentAccount[];
  /** Bank accounts in the base currency: only their lines can be repayments. */
  baseCurrencyBankIds: Set<string>;
}

export async function repaymentContext(sb: SupabaseClient): Promise<RepaymentContext> {
  const [repayments, banks, base] = await Promise.all([
    listRepayments(sb),
    listBankAccounts(sb),
    sb.from("acc_currency").select("code").eq("is_base", true).maybeSingle(),
  ]);
  if (base.error) throw fail(base.error.message);
  const code = (base.data as { code: string } | null)?.code ?? null;
  return {
    repayments,
    baseCurrencyBankIds: new Set(banks.filter((bank) => code !== null && bank.currency_code === code).map((bank) => bank.id)),
  };
}
