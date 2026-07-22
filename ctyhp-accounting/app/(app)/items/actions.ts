"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { createItem, updateItem, setItemActive, ItemsError } from "@/lib/services/items";
import { itemCreateSchema, itemUpdateSchema } from "@/lib/domain/schemas";

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
  if (err instanceof ItemsError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createItemAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = itemCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const it = await createItem(sb, parsed.data);
    revalidatePath("/items");
    return { ok: true, data: { id: it.id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function updateItemAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = itemUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await updateItem(sb, id, parsed.data);
    revalidatePath("/items");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function setItemActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await setItemActive(sb, id, active);
    revalidatePath("/items");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
