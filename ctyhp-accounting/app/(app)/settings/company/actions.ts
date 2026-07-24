"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { companySettingsSchema } from "@/lib/domain/schemas";
import { saveCompanySettings, listCompanySettingVersions, CompanyError } from "@/lib/services/company";
import type { CompanySettingRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
function msg(e: unknown): string { return e instanceof CompanyError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function saveCompanySettingsAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can change company settings" };
  const parsed = companySettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await saveCompanySettings(sb, parsed.data); revalidatePath("/settings/company"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listCompanySettingVersionsAction(): Promise<ActionResult<CompanySettingRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listCompanySettingVersions(sb) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
