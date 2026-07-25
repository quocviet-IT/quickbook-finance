"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { auditFilterSchema } from "@/lib/domain/schemas";
import { AccessError, searchAudit } from "@/lib/services/access";
import type { AuditEntryRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function searchAuditAction(raw: unknown): Promise<ActionResult<AuditEntryRow[]>> {
  const parsed = auditFilterSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filter" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await searchAudit(sb, parsed.data) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof AccessError || e instanceof Error ? e.message : "An unexpected error occurred",
    };
  }
}
