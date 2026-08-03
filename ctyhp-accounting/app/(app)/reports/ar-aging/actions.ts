"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  getArAging,
  getAfdaEvaluation,
  postAfdaAdjustment,
  AgingError,
  type AgingReport,
  type AfdaEvaluation,
} from "@/lib/services/aging";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function arAgingAction(asOf: string): Promise<ActionResult<AgingReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getArAging(sb, asOf) }; }
  catch (e) { return { ok: false, error: e instanceof AgingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}

export async function afdaEvaluationAction(asOf: string): Promise<ActionResult<AfdaEvaluation>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getAfdaEvaluation(sb, asOf) }; }
  catch (e) { return { ok: false, error: e instanceof AgingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}

/** Posts to the ledger; every rule is in acc_post_afda_adjustment. */
export async function postAfdaAdjustmentAction(
  asOf: string,
  memo: string | null,
): Promise<ActionResult<{ entryId: string; requiredMinor: number; adjustmentMinor: number }>> {
  try {
    const sb = await createSupabaseServerClient();
    const result = await postAfdaAdjustment(sb, asOf, memo);
    revalidatePath("/reports/ar-aging");
    revalidatePath("/reports/balance-sheet");
    revalidatePath("/reports/profit-and-loss");
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e instanceof AgingError || e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
