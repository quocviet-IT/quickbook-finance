// app/(app)/reports/cash-flow/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { cashFlowRangeSchema } from "@/lib/domain/schemas";
import { getCashFlow, CashFlowError, type CashFlowReport } from "@/lib/services/cashflow";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function cashFlowAction(raw: unknown): Promise<ActionResult<CashFlowReport>> {
  const parsed = cashFlowRangeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getCashFlow(sb, parsed.data.from, parsed.data.to) };
  } catch (e) {
    return { ok: false, error: e instanceof CashFlowError || e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
