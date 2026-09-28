"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { manualJournalSchema, reverseEntrySchema } from "@/lib/domain/schemas";
import { createManualJournal, reverseEntry, listJournalEntries, countJournalEntries, JOURNAL_LIST_LIMIT, listReversedEntries, JournalError, type JournalFilters, type JournalEntrySummary, type ReversedEntryRow } from "@/lib/services/journal";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";
import { hasPermission } from "@/lib/services/access";
import {
  markAdjustingSchema,
  unmarkAdjustingSchema,
  type AdjustingResult,
} from "@/lib/domain/adjusting-entries";
import { markAdjusting, unmarkAdjusting } from "@/lib/services/adjusting-entries";

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

export async function listJournalAction(
  filters: JournalFilters,
): Promise<ActionResult<{ entries: JournalEntrySummary[]; total: number; limit: number }>> {
  try {
    const sb = await createSupabaseServerClient();
    // The count is asked for beside the rows so the screen can say how many it
    // is not showing. Without it a truncated list is indistinguishable from a
    // complete one, which is how three years of entries went missing in
    // silence.
    const [entries, total] = await Promise.all([
      listJournalEntries(sb, filters),
      countJournalEntries(sb, filters),
    ]);
    return { ok: true, data: { entries, total, limit: JOURNAL_LIST_LIMIT } };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

export async function listReversedAction(): Promise<ActionResult<ReversedEntryRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listReversedEntries(sb) };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** The database checks this too; asking first gives a plain sentence instead of an error code. */
async function adjustingGuard(sb: Session): Promise<string | null> {
  return (await hasPermission(sb, "journal.post"))
    ? null
    : "Marking an adjusting entry needs the Post manual journals permission.";
}

function afterAdjusting(result: AdjustingResult) {
  if (result.kind === "done") {
    revalidatePath("/journal");
    revalidatePath("/reports/working-trial-balance");
  }
}

/** Mark an entry adjusting, or change its note. Moves the entry between two report columns; changes no figure. */
export async function markAdjustingAction(raw: unknown): Promise<ActionResult<AdjustingResult>> {
  const parsed = markAdjustingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const denied = await adjustingGuard(sb);
    if (denied) return { ok: false, error: denied };
    const result = await markAdjusting(sb, parsed.data.entryId, parsed.data.note || null, parsed.data.confirmClosed);
    afterAdjusting(result);
    return { ok: true, data: result };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

/** Take the adjusting mark off an entry, and its note with it. */
export async function unmarkAdjustingAction(raw: unknown): Promise<ActionResult<AdjustingResult>> {
  const parsed = unmarkAdjustingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const denied = await adjustingGuard(sb);
    if (denied) return { ok: false, error: denied };
    const result = await unmarkAdjusting(sb, parsed.data.entryId, parsed.data.confirmClosed);
    afterAdjusting(result);
    return { ok: true, data: result };
  } catch (err) { return { ok: false, error: msg(err) }; }
}
