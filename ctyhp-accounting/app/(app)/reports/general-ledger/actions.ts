"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getGeneralLedger, JournalError, type GeneralLedger } from "@/lib/services/journal";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function generalLedgerAction(accountId: string, from: string, to: string): Promise<ActionResult<GeneralLedger>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getGeneralLedger(sb, accountId, from, to) };
  } catch (err) {
    return { ok: false, error: err instanceof JournalError || err instanceof Error ? err.message : "An unexpected error occurred" };
  }
}
