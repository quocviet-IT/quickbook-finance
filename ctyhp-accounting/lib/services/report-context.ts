import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveActiveCompany } from "@/lib/db/company";
import type { PresetContext } from "@/lib/domain/report-presets";
import { getCurrentCompanySettings } from "./company";
import { todayInTimeZone } from "./dashboard";
import { postedEntryDateSpan } from "./exceptions";
import { listCurrencies } from "./reference";

/** What every report page needs before it draws anything: who, in what money, and what day it is. */
export interface ReportPageContext {
  companyName: string;
  isSample: boolean;
  currencyCode: string;
  decimals: number;
  /** The company's today, in its own time zone. */
  today: string;
  timeZone: string;
  /** For the period presets: fiscal year and the span of posted entries. */
  presets: PresetContext;
}

/** The company's today and time zone, for a report action that needs no more. */
export async function companyClock(sb: SupabaseClient): Promise<{ today: string; timeZone: string }> {
  const settings = await getCurrentCompanySettings(sb);
  const timeZone = settings?.time_zone || "UTC";
  return { today: todayInTimeZone(timeZone), timeZone };
}

export async function reportPageContext(sb: SupabaseClient): Promise<ReportPageContext> {
  const [entity, currencies, settings, span] = await Promise.all([
    resolveActiveCompany(),
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
    postedEntryDateSpan(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  const timeZone = settings?.time_zone || "UTC";
  const today = todayInTimeZone(timeZone);
  return {
    companyName: entity.active?.dbaName || entity.active?.legalName || settings?.legal_name || "Company name not set",
    isSample: entity.active?.isSample ?? false,
    currencyCode: base?.code ?? "USD",
    decimals: base?.decimal_places ?? 2,
    today,
    timeZone,
    presets: {
      today,
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
      firstEntryDate: span.first,
      lastEntryDate: span.last,
    },
  };
}
