"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { manualJournalSchema, reverseEntrySchema } from "@/lib/domain/schemas";
import { createManualJournal, reverseEntry, listJournalEntries, listReversedEntries, JournalError, type JournalFilters, type JournalEntrySummary, type ReversedEntryRow } from "@/lib/services/journal";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(err: unknown): string {
  if (err instanceof JournalError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createJournalAction(raw: unknown): Promise<ActionResult<ControlledActionResponse>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = manualJournalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const entryDate = parsed.data.entry_date || new Date().toISOString().slice(0, 10);
    const input = { ...parsed.data, entry_date: entryDate };
    const amountMinor = input.lines.reduce((sum, line) => sum + line.debit_minor, 0);
    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "manual_journal",
      title: input.description?.trim() || "Manual journal entry",
      amountMinor,
      reason:
        input.description?.trim() ||
        input.source_ref?.trim() ||
        "Manual journal entry submitted for review",
      payload: {
        entry_date: entryDate,
        description: input.description || null,
        source_ref: input.source_ref || null,
        currency: input.currency_code,
        lines: input.lines,
      },
      execute: () => createManualJournal(sb, input),
    });
    revalidatePath("/journal");
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true, data: toControlledActionResponse(outcome, String) };
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
