"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { recordExpense, voidExpense, PayablesError } from "@/lib/services/payables";
import { expenseCreateSchema } from "@/lib/domain/schemas";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  if (err instanceof PayablesError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function recordExpenseAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = expenseCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await recordExpense(sb, parsed.data);
    revalidatePath("/expenses");
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidExpenseAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidExpense(sb, id);
    revalidatePath("/expenses");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
