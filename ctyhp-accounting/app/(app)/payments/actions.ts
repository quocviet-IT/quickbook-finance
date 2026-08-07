"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { hasPermission, searchAudit } from "@/lib/services/access";
import {
  recordPayment,
  listOpenInvoicesForCustomer,
  voidPayment,
  deletePayment,
  updatePaymentDetails,
  correctPayment,
  getPaymentDetail,
  InvoicingError,
} from "@/lib/services/invoicing";
import {
  paymentCreateSchema,
  paymentVoidSchema,
  paymentDeleteSchema,
  paymentCorrectionSchema,
  paymentDetailsSchema,
} from "@/lib/domain/schemas";
import type { AuditEntryRow, InvoiceRow, PaymentDetail } from "@/lib/db/types";

/**
 * Every cached view a receipt shows up in. Voiding one moves an invoice back to
 * outstanding, so the aging report and the statement are as wrong as the
 * payments list until they are rebuilt.
 */
const PAYMENT_VOID_REVALIDATION_PATHS = [
  "/payments",
  "/invoices",
  "/sales",
  "/dashboard",
  "/reports/ar-aging",
  "/reports/customer-statement",
  "/reports/cash-flow",
  "/reports/transactions",
] as const;

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(err: unknown): string {
  if (err instanceof InvoicingError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function getOpenInvoicesAction(customerId: string): Promise<ActionResult<InvoiceRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    const rows = await listOpenInvoicesForCustomer(sb, customerId);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function recordPaymentAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = paymentCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await recordPayment(sb, parsed.data);
    revalidatePath("/payments");
    revalidatePath("/invoices");
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Void a posted receipt.
 *
 * The permission check is repeated here even though `acc_void_payment` makes
 * its own: the action is the door a browser can reach, and it should refuse
 * before it ever opens a database connection. Everything about *what* voiding
 * means stays in the RPC.
 */
export async function voidPaymentAction(paymentId: string, reason: string): Promise<ActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = paymentVoidSchema.safeParse({ payment_id: paymentId, reason });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await voidPayment(sb, parsed.data.payment_id, parsed.data.reason);
    for (const path of PAYMENT_VOID_REVALIDATION_PATHS) revalidatePath(path);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Delete a receipt.
 *
 * Administrators only, and said here as well as in the database: the menu item
 * is hidden from everybody else, and hiding a control the server would refuse
 * anyway is what stops people discovering a refusal by clicking.
 */
export async function deletePaymentAction(
  paymentId: string,
  reason: string,
): Promise<ActionResult<{ paymentNumber: string | null }>> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an administrator can delete a payment" };
  const parsed = paymentDeleteSchema.safeParse({ payment_id: paymentId, reason });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const removed = await deletePayment(sb, parsed.data.payment_id, parsed.data.reason);
    for (const path of PAYMENT_VOID_REVALIDATION_PATHS) revalidatePath(path);
    return { ok: true, data: removed };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** What a receipt settled and how it posted. Read-only, so the session is the gate. */
export async function getPaymentDetailAction(payment: {
  id: string;
  journal_entry_id: string | null;
}): Promise<ActionResult<PaymentDetail>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getPaymentDetail(sb, payment) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** The change history of one receipt, for whoever may read the audit log. */
export async function getPaymentAuditAction(
  paymentId: string,
): Promise<ActionResult<AuditEntryRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    if (!(await hasPermission(sb, "audit.read"))) {
      return { ok: false, error: "You do not have permission to perform this action" };
    }
    const entries = await searchAudit(sb, {
      table_name: "acc_payment",
      record_id: paymentId,
      actor_id: null,
      action: null,
      from: null,
      to: null,
      limit: 200,
    });
    return { ok: true, data: entries };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Fix what a receipt says about itself. Only `/payments` is revalidated: none of
 * these fields reaches a balance, so no report can have changed.
 */
export async function updatePaymentDetailsAction(raw: unknown): Promise<ActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = paymentDetailsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await updatePaymentDetails(sb, parsed.data);
    revalidatePath("/payments");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Void a receipt and record its corrected self; one call, one transaction. */
export async function correctPaymentAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = paymentCorrectionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await correctPayment(sb, parsed.data);
    for (const path of PAYMENT_VOID_REVALIDATION_PATHS) revalidatePath(path);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
