"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { manualJournalSchema, reverseEntrySchema } from "@/lib/domain/schemas";
import { createManualJournal, reverseEntry, listJournalEntries, listReversedEntries, JournalError, type JournalFilters, type JournalEntrySummary, type ReversedEntryRow } from "@/lib/services/journal";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(err: unknown): string {
  if (err instanceof JournalError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createJournalAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = manualJournalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await createManualJournal(sb, parsed.data);
    revalidatePath("/journal");
    return { ok: true, data: { id } };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

export async function reverseEntryAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = reverseEntrySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await reverseEntry(sb, parsed.data);
    revalidatePath("/journal");
    return { ok: true, data: { id } };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

export async function listJournalAction(filters: JournalFilters): Promise<ActionResult<JournalEntrySummary[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listJournalEntries(sb, filters) };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

export async function listReversedAction(): Promise<ActionResult<ReversedEntryRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listReversedEntries(sb) };
  } catch (err) { return { ok: false, error: msg(err) }; }
}
