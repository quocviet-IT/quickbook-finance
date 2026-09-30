"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import { reviewPostItemsSchema } from "@/lib/domain/schemas";
import { postReviewItems, type ReviewOutcome } from "@/lib/services/statement-review";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Post up to fifty ticked lines of one import; each is reported on its own. */
export async function postReviewItemsAction(batchId: string, raw: unknown): Promise<ActionResult<{ outcomes: ReviewOutcome[] }>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: "You do not have permission to post bank lines" };
  const parsed = reviewPostItemsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid lines" };
  try {
    const sb = await createSupabaseServerClient();
    const outcomes = await postReviewItems(sb, parsed.data);
    revalidatePath("/banking");
    revalidatePath(`/banking/imports/${batchId}`);
    revalidatePath("/reports");
    return { ok: true, data: { outcomes } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not post these lines" };
  }
}
