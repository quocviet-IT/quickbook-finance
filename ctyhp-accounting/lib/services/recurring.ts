import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RecurringDocumentType,
  RecurringRunRow,
  RecurringRunStatus,
  RecurringTemplateRow,
  RecurringTemplateStatus,
} from "@/lib/db/types";
import {
  addDays,
  billRecurringPayloadSchema,
  expenseRecurringPayloadSchema,
  invoiceRecurringPayloadSchema,
  journalRecurringPayloadSchema,
  recurringAmountMinor,
  type RecurringTemplateCreateInput,
} from "@/lib/domain/recurring";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { createDraftInvoice } from "./invoicing";
import { createDraftBill } from "./payables";
import { writeAudit } from "./audit";

export class RecurringError extends Error {}

export interface RecurringGenerationResult {
  runId: string;
  status: RecurringRunStatus;
  documentId: string | null;
  claimed: boolean;
}

interface ClaimRow {
  run_id: string;
  scheduled_date: string;
  document_type: RecurringDocumentType;
  payload_snapshot: Record<string, unknown>;
  run_status: RecurringRunStatus;
  document_id: string | null;
  approval_request_id: string | null;
  claimed: boolean;
}

export async function listRecurringTemplates(
  sb: SupabaseClient,
): Promise<RecurringTemplateRow[]> {
  const { data, error } = await sb
    .from("acc_recurring_template")
    .select("*")
    .order("next_run_date")
    .order("name");
  if (error) throw new RecurringError(error.message);
  return (data ?? []) as unknown as RecurringTemplateRow[];
}

export async function listRecurringRuns(
  sb: SupabaseClient,
  limit = 100,
): Promise<RecurringRunRow[]> {
  const { data, error } = await sb
    .from("acc_recurring_run")
    .select("*,acc_recurring_template(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new RecurringError(error.message);
  return ((data ?? []) as unknown as Array<
    RecurringRunRow & { acc_recurring_template: { name?: string } | null }
  >).map((run) => ({
    ...run,
    template_name: run.acc_recurring_template?.name ?? "Recurring transaction",
  }));
}

export async function listDueRecurringTemplates(
  sb: SupabaseClient,
  asOf: string,
  limit = 50,
): Promise<RecurringTemplateRow[]> {
  const { data, error } = await sb
    .from("acc_recurring_template")
    .select("*")
    .eq("status", "active")
    .lte("next_run_date", asOf)
    .order("next_run_date")
    .limit(limit);
  if (error) throw new RecurringError(error.message);
  return (data ?? []) as unknown as RecurringTemplateRow[];
}

export async function createRecurringTemplate(
  sb: SupabaseClient,
  input: RecurringTemplateCreateInput,
): Promise<RecurringTemplateRow> {
  const { data: authData } = await sb.auth.getUser();
  const row = {
    name: input.name,
    document_type: input.document_type,
    frequency: input.frequency,
    interval_count: input.interval_count,
    start_date: input.start_date,
    next_run_date: input.start_date,
    end_date: input.end_date || null,
    payload: input.payload,
    total_minor: recurringAmountMinor(input),
    created_by: authData.user?.id ?? null,
    updated_by: authData.user?.id ?? null,
  };
  const { data, error } = await sb.from("acc_recurring_template").insert(row).select("*").single();
  if (error) throw new RecurringError(error.message);
  const created = data as unknown as RecurringTemplateRow;
  await writeAudit(sb, {
    table_name: "acc_recurring_template",
    record_id: created.id,
    action: "insert",
    after: created,
  });
  return created;
}

export async function setRecurringTemplateStatus(
  sb: SupabaseClient,
  templateId: string,
  status: Exclude<RecurringTemplateStatus, "ended">,
): Promise<void> {
  const { data: authData } = await sb.auth.getUser();
  const { data: before, error: readError } = await sb
    .from("acc_recurring_template")
    .select("*")
    .eq("id", templateId)
    .single();
  if (readError) throw new RecurringError(readError.message);
  if ((before as { status: RecurringTemplateStatus }).status === "ended") {
    throw new RecurringError("An ended schedule cannot be resumed");
  }
  const { data: after, error } = await sb
    .from("acc_recurring_template")
    .update({
      status,
      updated_by: authData.user?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId)
    .select("*")
    .single();
  if (error) throw new RecurringError(error.message);
  await writeAudit(sb, {
    table_name: "acc_recurring_template",
    record_id: templateId,
    action: "update",
    before,
    after,
  });
}

export async function generateRecurringTemplate(
  sb: SupabaseClient,
  templateId: string,
): Promise<RecurringGenerationResult> {
  const { data, error } = await sb.rpc("acc_claim_recurring_run", {
    p_template_id: templateId,
  });
  if (error) throw new RecurringError(error.message);
  const claim = (Array.isArray(data) ? data[0] : data) as ClaimRow | undefined;
  if (!claim) throw new RecurringError("Recurring run could not be claimed");
  if (!claim.claimed) {
    return {
      runId: claim.run_id,
      status: claim.run_status,
      documentId: claim.document_id,
      claimed: false,
    };
  }

  try {
    let status: RecurringRunStatus = "pending_review";
    let documentId: string | null = null;

    if (claim.document_type === "invoice") {
      const payload = invoiceRecurringPayloadSchema.parse(claim.payload_snapshot);
      const existing = await findGeneratedDocument(sb, "acc_invoice", claim.run_id);
      documentId =
        existing ??
        (
          await createDraftInvoice(
            sb,
            {
              customer_id: payload.customer_id,
              issue_date: claim.scheduled_date,
              due_date: addDays(claim.scheduled_date, payload.due_days),
              currency_code: USD_CURRENCY_CODE,
              memo: payload.memo,
              lines: payload.lines,
            },
            { recurringRunId: claim.run_id },
          )
        ).id;
      status = "generated";
    } else if (claim.document_type === "bill") {
      const payload = billRecurringPayloadSchema.parse(claim.payload_snapshot);
      const existing = await findGeneratedDocument(sb, "acc_bill", claim.run_id);
      documentId =
        existing ??
        (
          await createDraftBill(
            sb,
            {
              vendor_id: payload.vendor_id,
              vendor_ref: payload.vendor_ref,
              bill_date: claim.scheduled_date,
              due_date: addDays(claim.scheduled_date, payload.due_days),
              currency_code: USD_CURRENCY_CODE,
              memo: payload.memo,
              lines: payload.lines,
            },
            { recurringRunId: claim.run_id },
          )
        ).id;
      status = "generated";
    } else if (claim.document_type === "expense") {
      expenseRecurringPayloadSchema.parse(claim.payload_snapshot);
    } else {
      journalRecurringPayloadSchema.parse(claim.payload_snapshot);
    }

    const completion = await sb.rpc("acc_complete_recurring_run", {
      p_run_id: claim.run_id,
      p_status: status,
      p_document_id: documentId,
    });
    if (completion.error) throw new RecurringError(completion.error.message);
    return { runId: claim.run_id, status, documentId, claimed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recurring generation failed";
    const current = await sb
      .from("acc_recurring_run")
      .select("status,document_id")
      .eq("id", claim.run_id)
      .single();
    if (!current.error && current.data?.status !== "generated") {
      await sb.rpc("acc_fail_recurring_run", { p_run_id: claim.run_id, p_error: message });
    }
    throw new RecurringError(message);
  }
}

export async function getRecurringRun(
  sb: SupabaseClient,
  runId: string,
): Promise<RecurringRunRow> {
  const { data, error } = await sb.from("acc_recurring_run").select("*").eq("id", runId).single();
  if (error) throw new RecurringError(error.message);
  return data as unknown as RecurringRunRow;
}

export async function postRecurringExpense(
  sb: SupabaseClient,
  runId: string,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_post_recurring_expense", { p_run_id: runId });
  if (error) throw new RecurringError(error.message);
  return data as string;
}

export async function postRecurringJournal(
  sb: SupabaseClient,
  runId: string,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_post_recurring_journal", { p_run_id: runId });
  if (error) throw new RecurringError(error.message);
  return data as string;
}

export async function markRecurringApproval(
  sb: SupabaseClient,
  runId: string,
  requestId: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_mark_recurring_approval", {
    p_run_id: runId,
    p_request_id: requestId,
  });
  if (error) throw new RecurringError(error.message);
}

async function findGeneratedDocument(
  sb: SupabaseClient,
  table: "acc_invoice" | "acc_bill",
  runId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("recurring_run_id", runId)
    .maybeSingle();
  if (error) throw new RecurringError(error.message);
  return (data?.id as string | undefined) ?? null;
}
