"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { createVendor, PayablesError } from "@/lib/services/payables";
import { vendorCreateSchema } from "@/lib/domain/schemas";

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

export async function createVendorAction(raw: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = vendorCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const v = await createVendor(sb, parsed.data);
    revalidatePath("/vendors");
    return { ok: true, data: { id: v.id, name: v.name } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
