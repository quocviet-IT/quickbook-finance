"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  journalRecurringPayloadSchema,
  recurringTemplateCreateSchema,
} from "@/lib/domain/recurring";
import {
  RecurringError,
  createRecurringTemplate,
  generateRecurringTemplate,
  getRecurringRun,
  markRecurringApproval,
  postRecurringExpense,
  postRecurringJournal,
  setRecurringTemplateStatus,
} from "@/lib/services/recurring";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function authorized(): Promise<boolean> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.rpc("acc_has_permission", {
    p_key: "recurring.manage",
  });
  return !error && data === true;
}

function message(error: unknown): string {
  if (error instanceof RecurringError || error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

function revalidateRecurringOutputs(): void {
  revalidatePath("/recurring");
  revalidatePath("/dashboard");
  revalidatePath("/invoices");
  revalidatePath("/bills");
  revalidatePath("/expenses");
  revalidatePath("/journal");
  revalidatePath("/approvals");
}

export async function createRecurringTemplateAction(
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  if (!(await authorized())) {
    return { ok: false, error: "You do not have permission to manage recurring transactions" };
  }
  const parsed = recurringTemplateCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid recurring schedule" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const template = await createRecurringTemplate(sb, parsed.data);
    revalidatePath("/recurring");
    return { ok: true, data: { id: template.id } };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function setRecurringTemplateStatusAction(
  templateId: string,
  status: "active" | "paused",
): Promise<ActionResult> {
  if (!(await authorized())) {
    return { ok: false, error: "You do not have permission to manage recurring transactions" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await setRecurringTemplateStatus(sb, templateId, status);
    revalidatePath("/recurring");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function generateRecurringTemplateAction(
  templateId: string,
): Promise<ActionResult<{
  runId: string;
  status: string;
  documentId: string | null;
  claimed: boolean;
}>> {
  if (!(await authorized())) {
    return { ok: false, error: "You do not have permission to run recurring transactions" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const result = await generateRecurringTemplate(sb, templateId);
    revalidateRecurringOutputs();
    return { ok: true, data: result };
  } catch (error) {
    revalidatePath("/recurring");
    return { ok: false, error: message(error) };
  }
}

export async function postRecurringDraftAction(
  runId: string,
): Promise<ActionResult<ControlledActionResponse>> {
  if (!(await authorized())) {
    return { ok: false, error: "You do not have permission to review recurring transactions" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const run = await getRecurringRun(sb, runId);
    if (run.status !== "pending_review") {
      return { ok: false, error: "This recurring transaction is not waiting for review" };
    }

    if (run.document_type === "expense") {
      const id = await postRecurringExpense(sb, runId);
      revalidateRecurringOutputs();
      return { ok: true, data: { id, submittedForApproval: false } };
    }
    if (run.document_type !== "journal") {
      return { ok: false, error: "Only recurring expenses and journals require posting review" };
    }

    const payload = journalRecurringPayloadSchema.parse(run.payload_snapshot);
    const amountMinor = payload.lines.reduce((sum, line) => sum + line.debit_minor, 0);
    const approvalPayload = {
      entry_date: run.scheduled_date,
      description: payload.description,
      source_ref: payload.source_ref || null,
      currency: "USD",
      lines: payload.lines,
      recurring_run_id: runId,
    };
    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "manual_journal",
      title: payload.description,
      amountMinor,
      reason: payload.description,
      payload: approvalPayload,
      execute: () => postRecurringJournal(sb, runId),
    });
    if (outcome.status === "submitted") {
      await markRecurringApproval(sb, runId, outcome.requestId);
    }
    revalidateRecurringOutputs();
    return { ok: true, data: toControlledActionResponse(outcome, String) };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
