import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrencyRow, TaxCodeRow } from "@/lib/db/types";

export async function listCurrencies(sb: SupabaseClient): Promise<CurrencyRow[]> {
  const { data, error } = await sb
    .from("acc_currency")
    .select("code,name,symbol,decimal_places,is_base")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CurrencyRow[];
}

export async function listTaxCodes(sb: SupabaseClient): Promise<TaxCodeRow[]> {
  const { data, error } = await sb
    .from("acc_tax_code")
    .select("id,code,name,rate_percent,direction,tax_account_id,is_active")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TaxCodeRow[];
}
