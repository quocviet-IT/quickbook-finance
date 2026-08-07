import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanySettingRow } from "@/lib/db/types";
import type { CompanySettingsInput } from "@/lib/domain/schemas";

export class CompanyError extends Error {}

const COLS =
  "id,version,effective_from,legal_name,dba_name,ein_ref,address_line1,address_line2,city,region,postal_code,country," +
  "fiscal_year_start_month,base_currency_code,time_zone,accounting_basis,default_payment_terms_days," +
  "inventory_valuation_method,inventory_policy_memo,created_at";

export async function getCurrentCompanySettings(sb: SupabaseClient): Promise<CompanySettingRow | null> {
  const { data, error } = await sb.from("acc_company_setting_version")
    .select(COLS).order("effective_from", { ascending: false }).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new CompanyError(error.message);
  return (data as unknown as CompanySettingRow) ?? null;
}
/**
 * Keep the company register's name in step with the company's own settings.
 *
 * The name lives twice: in `acc_company_setting_version`, which is the
 * company's versioned record of itself, and in `onebook.company`, which is what
 * the switcher and the Companies list read. Correcting a typo in the first left
 * the second saying something else — the books said "Pacific Four Nine" while
 * every screen still said "Pacific Four Nice".
 *
 * The settings are the truth and the register follows them. The register has no
 * write policy for an application session, so the caller passes a client that
 * can: this function only decides what the change is.
 */
export async function syncCompanyRegisterName(
  register: SupabaseClient,
  schemaName: string,
  legalName: string,
  dbaName: string | null,
): Promise<void> {
  const { data, error } = await register
    .from("company")
    .update({ legal_name: legalName, dba_name: dbaName })
    .eq("schema_name", schemaName)
    .select("id");
  if (error) throw new CompanyError(error.message);
  if ((data ?? []).length === 0) {
    throw new CompanyError(
      `The company register has no entry for ${schemaName}, so the new name was not carried across to the company switcher.`,
    );
  }
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
    p_time_zone: input.time_zone, p_accounting_basis: input.accounting_basis,
    p_default_payment_terms_days: input.default_payment_terms_days,
    p_inventory_valuation_method: input.inventory_valuation_method ?? null,
    p_inventory_policy_memo: input.inventory_policy_memo || null,
  });
  if (error) throw new CompanyError(error.message);
  return data as string;
}
