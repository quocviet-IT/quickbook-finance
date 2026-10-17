"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canWrite, getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { draftProblem, savedMessage, type ComparisonDraft } from "@/lib/domain/balance-comparison";
import { saveBalanceComparison } from "@/lib/services/balance-comparison";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const NO_PERMISSION = "You do not have permission to save a balance comparison";

const draftSchema = z.object({
  asOf: z.string(),
  comparedWith: z.string(),
  note: z.string(),
  lines: z.array(
    z.union([
      z.object({ accountId: z.string().min(1), otherMinor: z.number().int() }),
      z.object({ externalCode: z.string(), externalName: z.string(), otherMinor: z.number().int() }),
    ]),
  ),
});

/**
 * Keep the typed figures for one date. Only that date's figures are replaced.
 * The database refuses anyone who is not staff and says why in plain words;
 * that message is the one shown.
 */
export async function saveBalanceComparisonAction(
  input: ComparisonDraft,
): Promise<ActionResult<{ kept: number; message: string }>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The figures could not be read. Reload the page and try again." };
  const draft = parsed.data as ComparisonDraft;
  const problem = draftProblem(draft);
  if (problem) return { ok: false, error: problem };
  try {
    const sb = await createSupabaseServerClient();
    const kept = await saveBalanceComparison(sb, draft);
    revalidatePath("/reports/balance-comparison");
    return { ok: true, data: { kept, message: savedMessage(kept, draft.asOf) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The comparison could not be saved." };
  }
}
