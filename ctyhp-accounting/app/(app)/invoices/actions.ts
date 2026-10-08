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
import { searchAudit } from "@/lib/services/access";
import { listInvoiceSettlements } from "@/lib/services/settlements";
import type { SettlementEvent } from "@/lib/domain/settlement";
import type { AuditEntryRow, InvoiceLineRow } from "@/lib/db/types";
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

/** One part of a combined read: its own answer or its own error, never the others'. */
async function settled<T>(read: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export interface InvoiceDetail {
  lines: ActionResult<InvoiceLineRow[]>;
  /** Payments, credits and write-offs against the invoice, oldest first. */
  settlements: ActionResult<SettlementEvent[]>;
  /** The change history, newest first; null when it was not asked for. */
  audit: ActionResult<AuditEntryRow[]> | null;
}

/**
 * Reads only: what the invoice drawer shows, in one request.
 *
 * These were three Server Actions — lines and settlements in a Promise.all,
 * then the change history — and Next dispatches Server Actions one at a time
 * per client ("Sequential dispatch" in its Server Actions guide), so opening an
 * invoice was three trips in a row. Here the reads run side by side on one
 * client, each keeping its own error.
 *
 * `withAudit` is the page's answer to whether the viewer holds `audit.read`.
 * It decides only whether the history is asked for: `acc_audit_search` refuses
 * the call without that permission whatever the browser sends.
 */
export async function getInvoiceDetailAction(id: string, withAudit: boolean): Promise<InvoiceDetail> {
  let sb: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    sb = await createSupabaseServerClient();
  } catch (err) {
    const failed = { ok: false, error: msg(err) };
    return { lines: failed, settlements: failed, audit: withAudit ? failed : null };
  }
  const [lines, settlements, audit] = await Promise.all([
    settled(() => getInvoiceLines(sb, id)),
    settled(() => listInvoiceSettlements(sb, id)),
    withAudit
      ? settled(() =>
          searchAudit(sb, {
            table_name: "acc_invoice",
            record_id: id,
            actor_id: null,
            action: null,
            from: null,
            to: null,
            limit: 200,
          }),
        )
      : Promise.resolve(null),
  ]);
  return { lines, settlements, audit };
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

/**
 * `overrideReason` is only accepted when the customer's credit limit or hold
 * would otherwise refuse the invoice; the database rejects a reason supplied
 * for an invoice that does not need one, so the two can never drift apart.
 */
export async function issueInvoiceAction(
  id: string,
  overrideReason?: string,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await issueInvoice(sb, id, overrideReason);
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
