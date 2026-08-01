"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  createAccount,
  updateAccount,
  setAccountStatus,
  AccountServiceError,
} from "@/lib/services/accounts";
import {
  accountCreateSchema,
  accountUpdateSchema,
  accountStatusSchema,
} from "@/lib/domain/schemas";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guardWrite(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function messageFrom(err: unknown): string {
  if (err instanceof AccountServiceError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

/** Returns the new account's id so a caller can select what it just created. */
export async function createAccountAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; account_code: string; name: string }>> {
  const denied = await guardWrite();
  if (denied) return { ok: false, error: denied };
  const parsed = accountCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const account = await createAccount(sb, parsed.data);
    revalidatePath("/accounts");
    revalidatePath("/banking");
    return {
      ok: true,
      data: { id: account.id, account_code: account.account_code, name: account.name },
    };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}

export async function updateAccountAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await guardWrite();
  if (denied) return { ok: false, error: denied };
  const parsed = accountUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await updateAccount(sb, id, parsed.data);
    revalidatePath("/accounts");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}

export async function setAccountStatusAction(id: string, status: unknown): Promise<ActionResult> {
  const denied = await guardWrite();
  if (denied) return { ok: false, error: denied };
  const parsed = accountStatusSchema.safeParse(status);
  if (!parsed.success) return { ok: false, error: "Invalid status" };
  try {
    const sb = await createSupabaseServerClient();
    await setAccountStatus(sb, id, parsed.data);
    revalidatePath("/accounts");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: messageFrom(err) };
  }
}
