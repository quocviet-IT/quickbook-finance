import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanySettingRow } from "@/lib/db/types";
import type { CompanySettingsInput } from "@/lib/domain/schemas";

export class CompanyError extends Error {}

const COLS =
  "id,version,effective_from,legal_name,dba_name,ein_ref,address_line1,address_line2,city,region,postal_code,country," +
  "fiscal_year_start_month,base_currency_code,time_zone,accounting_basis,default_payment_terms_days,created_at";

export async function getCurrentCompanySettings(sb: SupabaseClient): Promise<CompanySettingRow | null> {
  const { data, error } = await sb.from("acc_company_setting_version")
    .select(COLS).order("effective_from", { ascending: false }).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new CompanyError(error.message);
  return (data as unknown as CompanySettingRow) ?? null;
}
export async function listCompanySettingVersions(sb: SupabaseClient): Promise<CompanySettingRow[]> {
  const { data, error } = await sb.from("acc_company_setting_version").select(COLS).order("version", { ascending: false });
  if (error) throw new CompanyError(error.message);
  return (data ?? []) as unknown as CompanySettingRow[];
}
export async function saveCompanySettings(sb: SupabaseClient, input: CompanySettingsInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_save_company_settings", {
    p_legal_name: input.legal_name, p_dba_name: input.dba_name || null, p_ein_ref: input.ein_ref || null,
    p_address_line1: input.address_line1 || null, p_address_line2: input.address_line2 || null, p_city: input.city || null,
    p_region: input.region || null, p_postal_code: input.postal_code || null, p_country: input.country || null,
    p_fiscal_year_start_month: input.fiscal_year_start_month, p_base_currency_code: input.base_currency_code,
    p_time_zone: input.time_zone, p_accounting_basis: input.accounting_basis, p_default_payment_terms_days: input.default_payment_terms_days,
  });
  if (error) throw new CompanyError(error.message);
  return data as string;
}
