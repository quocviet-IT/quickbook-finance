// app/(app)/reports/cash-flow/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { cashFlowDetailSchema, cashFlowRangeSchema } from "@/lib/domain/schemas";
import {
  getCashFlow,
  getCashFlowDetails,
  CashFlowError,
  type CashFlowDetail,
  type CashFlowReport,
} from "@/lib/services/cashflow";

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

export async function cashFlowDetailAction(
  raw: unknown,
): Promise<ActionResult<CashFlowDetail[]>> {
  const parsed = cashFlowDetailSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }
  try {
    const sb = await createSupabaseServerClient();
    return {
      ok: true,
      data: await getCashFlowDetails(
        sb,
        parsed.data.from,
        parsed.data.to,
        parsed.data.lineCode,
      ),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof CashFlowError || error instanceof Error
          ? error.message
          : "An unexpected error occurred",
    };
  }
}
