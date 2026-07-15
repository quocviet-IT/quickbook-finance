"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { recordPayment, listOpenInvoicesForCustomer, InvoicingError } from "@/lib/services/invoicing";
import { paymentCreateSchema } from "@/lib/domain/schemas";
import type { InvoiceRow } from "@/lib/db/types";

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
