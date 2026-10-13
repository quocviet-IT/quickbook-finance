"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { estimateIdSchema, estimateSaveSchema } from "@/lib/domain/schemas";
import {
  estimateStateOf,
  type EstimateInvoicePrefill,
  type EstimateState,
} from "@/lib/domain/estimates";
import { buildEstimateDocument, type EstimateDocument } from "@/lib/domain/estimate-document";
import { companyClock } from "@/lib/services/report-context";
import {
  deleteEstimate,
  getEstimateDetail,
  getEstimateDocumentSource,
  getEstimateInvoicePrefill,
  listEstimates,
  saveEstimate,
  setEstimateDeclined,
  type EstimateDetail,
  type EstimateListRow,
  type SavedEstimate,
} from "@/lib/services/estimates";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** A list row with the state it is in on the company's today. */
export interface EstimateListEntry extends EstimateListRow {
  state: EstimateState;
}

export interface EstimateRegister {
  /** The company's today, in its own time zone: the day every state was worked out for. */
  today: string;
  estimates: EstimateListEntry[];
}

export interface EstimateDetailView extends EstimateDetail {
  state: EstimateState;
  today: string;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "An unexpected error occurred";
}

function invalid(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid data";
}

/** Every estimate write shows on the Estimates list and in the dashboard's recent activity. */
function revalidate(): void {
  revalidatePath("/estimates");
  revalidatePath("/dashboard");
}

// --- Reads: anyone who can see the books (RLS decides), writers or not ---

/** The Estimates list, each row with its state on the company's today. */
export async function listEstimatesAction(): Promise<ActionResult<EstimateRegister>> {
  try {
    const sb = await createSupabaseServerClient();
    const [rows, clock] = await Promise.all([listEstimates(sb), companyClock(sb)]);
    return {
      ok: true,
      data: {
        today: clock.today,
        estimates: rows.map((row) => ({ ...row, state: estimateStateOf(row, clock.today) })),
      },
    };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** One estimate: header, lines, every invoice made from it, and its state today. */
export async function getEstimateDetailAction(id: string): Promise<ActionResult<EstimateDetailView>> {
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const [detail, clock] = await Promise.all([getEstimateDetail(sb, parsedId.data), companyClock(sb)]);
    return {
      ok: true,
      data: { ...detail, state: estimateStateOf(detail.estimate, clock.today), today: clock.today },
    };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * The printable form of one estimate. Built on the server so the balance
 * check in buildEstimateDocument fails as an ordinary action error, as the
 * invoice's does. Read-only roles download the PDF too.
 */
export async function getEstimateDocumentAction(id: string): Promise<ActionResult<EstimateDocument>> {
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const source = await getEstimateDocumentSource(sb, parsedId.data);
    return { ok: true, data: buildEstimateDocument(source) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * What the New invoice form opens with when it is opened from this estimate.
 * Writers only: it exists to turn the estimate into an invoice. `blocked`
 * carries the words to show instead when that cannot happen now.
 */
export async function getEstimateInvoicePrefillAction(
  id: string,
): Promise<ActionResult<EstimateInvoicePrefill>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const prefill = await getEstimateInvoicePrefill(sb, parsedId.data);
    if (!prefill) return { ok: false, error: "Estimate not found" };
    return { ok: true, data: prefill };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

// --- Writes: canWrite here, acc_is_staff() in the database ---

/** Create (`id` null) or edit an estimate. The number is assigned on the first save. */
export async function saveEstimateAction(
  id: string | null,
  raw: unknown,
): Promise<ActionResult<SavedEstimate>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (id !== null) {
    const parsedId = estimateIdSchema.safeParse(id);
    if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  }
  const parsed = estimateSaveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: invalid(parsed.error) };
  try {
    const sb = await createSupabaseServerClient();
    const saved = await saveEstimate(sb, id, parsed.data);
    revalidate();
    return { ok: true, data: saved };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

async function setDeclined(
  id: string,
  declined: boolean,
): Promise<ActionResult<{ id: string; estimate_number: string; declined_at: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const result = await setEstimateDeclined(sb, parsedId.data, declined);
    revalidate();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Mark declined. No confirmation; the toast is estimateMessages.declined. */
export async function declineEstimateAction(
  id: string,
): Promise<ActionResult<{ id: string; estimate_number: string; declined_at: string | null }>> {
  return setDeclined(id, true);
}

/** Reopen a declined estimate. No confirmation; the toast is estimateMessages.reopened. */
export async function reopenEstimateAction(
  id: string,
): Promise<ActionResult<{ id: string; estimate_number: string; declined_at: string | null }>> {
  return setDeclined(id, false);
}

/**
 * Delete an estimate that never had an invoice made from it. The screen asks
 * first (estimateMessages.deleteConfirm); a refusal is the database's words.
 */
export async function deleteEstimateAction(
  id: string,
): Promise<ActionResult<{ id: string; estimate_number: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const result = await deleteEstimate(sb, parsedId.data);
    revalidate();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
