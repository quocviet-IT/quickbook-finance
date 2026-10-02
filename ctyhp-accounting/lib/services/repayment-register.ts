import type { SupabaseClient } from "@supabase/supabase-js";
import type { RelatedCompany } from "@/lib/domain/related-companies";
import type { InterestMethod, RepaymentAccount, RepaymentKind } from "@/lib/domain/repayments";
import { listBankAccounts } from "./banking";
import { readAllPages } from "./paging";

/**
 * Reading the register — cards and loans (migration 0129) and related
 * companies (0131) — and the facts recognition needs beside it. Writing lives
 * in repayments.ts and related-companies.ts; this module is kept free of them
 * so coding.ts can use it.
 */
export class RepaymentError extends Error {}
const fail = (message: string) => new RepaymentError(message);

const COLUMNS =
  "id,kind,account_id,match_words,match_digits,interest_account_id,interest_method,annual_rate,fixed_interest_minor,is_active";
const RELATED_COLUMNS = "id,name,account_id,match_words,is_active";
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

export function relatedFromRow(row: Record<string, unknown>): RelatedCompany {
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? "",
    accountId: row.account_id as string,
    matchWords: (row.match_words as string | null) ?? "",
    isActive: Boolean(row.is_active),
  };
}

/** Every related company, by name. */
export async function listRelatedCompanies(sb: SupabaseClient): Promise<RelatedCompany[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from("acc_related_company").select(RELATED_COLUMNS).order("name").order("id").range(from, to),
    fail,
  );
  return rows.map(relatedFromRow);
}

export interface RepaymentContext {
  repayments: RepaymentAccount[];
  related: RelatedCompany[];
  /** Bank accounts in the base currency: only their lines can be claimed by the register. */
  baseCurrencyBankIds: Set<string>;
}

/** Bank accounts in the base currency: only their lines can be claimed by the register. */
export async function baseCurrencyBankIds(sb: SupabaseClient): Promise<Set<string>> {
  const [banks, base] = await Promise.all([
    listBankAccounts(sb),
    sb.from("acc_currency").select("code").eq("is_base", true).maybeSingle(),
  ]);
  if (base.error) throw fail(base.error.message);
  const code = (base.data as { code: string } | null)?.code ?? null;
  return new Set(banks.filter((bank) => code !== null && bank.currency_code === code).map((bank) => bank.id));
}

export async function repaymentContext(sb: SupabaseClient): Promise<RepaymentContext> {
  const [repayments, related, ids] = await Promise.all([listRepayments(sb), listRelatedCompanies(sb), baseCurrencyBankIds(sb)]);
  return { repayments, related, baseCurrencyBankIds: ids };
}
