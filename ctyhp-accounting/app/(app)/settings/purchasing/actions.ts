"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { purchasingConfigSchema } from "@/lib/domain/schemas";
import { PurchasingError, setPurchasingConfig } from "@/lib/services/purchasing";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function setPurchasingConfigAction(raw: unknown): Promise<ActionResult> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can change purchasing tolerances" };
  const parsed = purchasingConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await setPurchasingConfig(sb, parsed.data);
    revalidatePath("/settings/purchasing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof PurchasingError || e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
