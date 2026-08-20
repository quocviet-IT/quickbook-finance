import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialAnalysisRow } from "@/lib/db/types";
import type { FreezeAnalysisInput, WhatIfAnalysis } from "@/lib/domain/financial-analysis";

export class FinancialAnalysisError extends Error {}

const LIST_COLUMNS =
  "id,title,notes,period_start,period_end,adjustments,snapshot,status," +
  "created_by,created_at,archived_by,archived_at,archive_reason";

export async function freezeFinancialAnalysis(
  sb: SupabaseClient,
  input: FreezeAnalysisInput,
  snapshot: WhatIfAnalysis,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_freeze_financial_analysis", {
    p_title: input.title,
    p_notes: input.notes,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_adjustments: input.adjustments,
    p_snapshot: snapshot,
  });
  if (error) throw new FinancialAnalysisError(error.message);
  return data as string;
}

export async function listFinancialAnalyses(
  sb: SupabaseClient,
  includeArchived: boolean,
): Promise<FinancialAnalysisRow[]> {
  let query = sb
    .from("acc_financial_analysis")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false });
  if (!includeArchived) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw new FinancialAnalysisError(error.message);
  return (data ?? []) as unknown as FinancialAnalysisRow[];
}

export async function archiveFinancialAnalysis(
  sb: SupabaseClient,
  id: string,
  reason: string | null,
): Promise<void> {
  const { error } = await sb.rpc("acc_archive_financial_analysis", {
    p_id: id,
    p_reason: reason,
  });
  if (error) throw new FinancialAnalysisError(error.message);
}
