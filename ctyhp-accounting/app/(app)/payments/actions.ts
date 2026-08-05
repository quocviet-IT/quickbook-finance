"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  recordPayment,
  listOpenInvoicesForCustomer,
  voidPayment,
  InvoicingError,
} from "@/lib/services/invoicing";
import { paymentCreateSchema, paymentVoidSchema } from "@/lib/domain/schemas";
import type { InvoiceRow } from "@/lib/db/types";

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
