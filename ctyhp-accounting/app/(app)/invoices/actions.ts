"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  createDraftInvoice,
  issueInvoice,
  voidInvoice,
  createCustomer,
  getInvoiceLines,
  getInvoiceDocumentSource,
  InvoicingError,
} from "@/lib/services/invoicing";
import type { InvoiceLineRow } from "@/lib/db/types";
import { invoiceCreateSchema, customerCreateSchema } from "@/lib/domain/schemas";
import {
  buildInvoiceDocument,
  type InvoiceDocument,
} from "@/lib/domain/invoice-document";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  if (err instanceof InvoicingError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createCustomerAction(raw: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = customerCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const c = await createCustomer(sb, parsed.data);
    revalidatePath("/invoices");
    return { ok: true, data: { id: c.id, name: c.name } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function createInvoiceAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = invoiceCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const inv = await createDraftInvoice(sb, parsed.data);
    revalidatePath("/invoices");
    return { ok: true, data: { id: inv.id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function getInvoiceLinesAction(id: string): Promise<ActionResult<InvoiceLineRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    const lines = await getInvoiceLines(sb, id);
    return { ok: true, data: lines };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * The printable form of one invoice. Built on the server so the balance check
 * in buildInvoiceDocument fails as a normal action error rather than inside a
 * PDF call in the browser. Reading is not gated by canWrite: anyone who may
 * see the invoice may print it, and RLS decides who that is.
 */
export async function getInvoiceDocumentAction(
  id: string,
): Promise<ActionResult<InvoiceDocument>> {
  try {
    const sb = await createSupabaseServerClient();
    const source = await getInvoiceDocumentSource(sb, id);
    return { ok: true, data: buildInvoiceDocument(source) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function issueInvoiceAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await issueInvoice(sb, id);
    revalidatePath("/invoices");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidInvoiceAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidInvoice(sb, id);
    revalidatePath("/invoices");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
