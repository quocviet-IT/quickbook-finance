import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_POSTING_DEFAULTS, type PostingDefaults } from "@/lib/domain/posting-defaults";
import type { PostingDefaultsInput } from "@/lib/domain/schemas";

export class PostingDefaultsError extends Error {}

/** The company's posting defaults (0187); none set reads as no defaults, not as an error. */
export async function getPostingDefaults(sb: SupabaseClient): Promise<PostingDefaults> {
  const { data, error } = await sb
    .from("acc_posting_default")
    .select("deposit_account_id,pay_from_account_id,income_account_id,expense_account_id")
    .maybeSingle();
  if (error) throw new PostingDefaultsError(error.message);
  if (!data) return NO_POSTING_DEFAULTS;
  const row = data as Record<string, string | null>;
  return {
    depositAccountId: row.deposit_account_id ?? null,
    payFromAccountId: row.pay_from_account_id ?? null,
    incomeAccountId: row.income_account_id ?? null,
    expenseAccountId: row.expense_account_id ?? null,
  };
}

/**
 * For a form's first paint: the defaults, or none when they cannot be read.
 * A default is help, so a failed read leaves the form as it was before there
 * were any rather than failing the page.
 */
export async function postingDefaultsOrNone(sb: SupabaseClient): Promise<PostingDefaults> {
  try {
    return await getPostingDefaults(sb);
  } catch {
    return NO_POSTING_DEFAULTS;
  }
}

export async function savePostingDefaults(sb: SupabaseClient, input: PostingDefaultsInput): Promise<void> {
  const { error } = await sb.rpc("acc_save_posting_defaults", {
    p_deposit_account_id: input.depositAccountId ?? null,
    p_pay_from_account_id: input.payFromAccountId ?? null,
    p_income_account_id: input.incomeAccountId ?? null,
    p_expense_account_id: input.expenseAccountId ?? null,
  });
  if (error) throw new PostingDefaultsError(error.message);
}
