import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanySetupFacts, CompanySummary } from "@/lib/domain/company-setup";

export class CompanySetupError extends Error {}

type Counted = { count: number | null; error: { message: string } | null };

function counted(result: Counted): number {
  if (result.error) throw new CompanySetupError(result.error.message);
  return result.count ?? 0;
}

/** How many posted entries the books hold: shared by the checklist and the company summary. */
function postedEntryCount(sb: SupabaseClient) {
  return sb.from("acc_journal_entry").select("id", { count: "exact", head: true }).eq("status", "posted");
}

/**
 * What the setup checklist (3.00) reads, all in one round of parallel reads,
 * through the client of the company being checked, so Row Level Security
 * decides what the reader may see as it does everywhere else.
 */
export async function readCompanySetupFacts(sb: SupabaseClient): Promise<CompanySetupFacts> {
  const [versions, opening, first, entries, banks, people] = await Promise.all([
    sb
      .from("acc_company_setting_version")
      .select("version,created_by,address_line1,city,phone,email,time_zone,fiscal_year_start_month")
      .order("version", { ascending: false }),
    sb
      .from("acc_journal_entry")
      .select("entry_date")
      .eq("source_type", "opening_balance")
      .eq("status", "posted")
      .order("entry_date")
      .limit(1),
    sb.from("acc_journal_entry").select("entry_date").eq("status", "posted").order("entry_date").limit(1),
    postedEntryCount(sb),
    sb.from("acc_bank_account").select("id", { count: "exact", head: true }),
    sb.rpc("acc_actor_directory"),
  ]);
  for (const result of [versions, opening, first, people]) {
    if (result.error) throw new CompanySetupError(result.error.message);
  }

  const rows = (versions.data ?? []) as Array<{
    created_by: string | null;
    address_line1: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    time_zone: string;
    fiscal_year_start_month: number;
  }>;
  const newest = rows[0];
  const filled = (value: string | null) => Boolean(value?.trim());

  return {
    settings: newest
      ? {
          savedByPerson: rows.some((row) => row.created_by !== null),
          hasAddress: filled(newest.address_line1) || filled(newest.city),
          hasContact: filled(newest.phone) || filled(newest.email),
          timeZone: newest.time_zone,
          fiscalYearStartMonth: newest.fiscal_year_start_month,
        }
      : null,
    openingBalanceDate: ((opening.data ?? [])[0] as { entry_date: string } | undefined)?.entry_date ?? null,
    firstEntryDate: ((first.data ?? [])[0] as { entry_date: string } | undefined)?.entry_date ?? null,
    postedEntries: counted(entries),
    bankAccounts: counted(banks),
    people: ((people.data ?? []) as unknown[]).length,
  };
}

export async function readCompanySummary(sb: SupabaseClient): Promise<CompanySummary> {
  const [entries, invoices, bills, accounts] = await Promise.all([
    postedEntryCount(sb),
    sb.from("acc_invoice").select("id", { count: "exact", head: true }).not("status", "in", "(draft,void)"),
    sb.from("acc_bill").select("id", { count: "exact", head: true }).not("status", "in", "(draft,void)"),
    sb.from("acc_account").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);
  return {
    postedEntries: counted(entries),
    invoices: counted(invoices),
    bills: counted(bills),
    activeAccounts: counted(accounts),
  };
}
