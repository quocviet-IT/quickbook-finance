"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { openingBalanceSchema } from "@/lib/domain/schemas";
import { postOpeningBalances, JournalError } from "@/lib/services/journal";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
function msg(err: unknown): string {
  if (err instanceof JournalError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function postOpeningBalancesAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = openingBalanceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await postOpeningBalances(sb, parsed.data);
    revalidatePath("/opening-balances");
    return { ok: true, data: { id } };
  } catch (err) { return { ok: false, error: msg(err) }; }
}
