"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { hasPermission, searchAudit } from "@/lib/services/access";
import { listCustomerTransactions } from "@/lib/services/customer-detail";
import { customerIdSchema, customerTransactionRangeSchema } from "@/lib/domain/schemas";
import type { CustomerTransaction } from "@/lib/domain/customer-detail";
import type { AuditEntryRow } from "@/lib/db/types";

/**
 * The reads a customer's page makes after it has arrived (3.0.12): the
 * Transactions tab for the range chosen, and the Activity tab when it is
 * opened. Reads only; the database's row security decides what this company
 * member may see, as it does for the page itself.
 */

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "An unexpected error occurred";
}

/** Every invoice, payment, credit memo and sales receipt for this customer in the range. */
export async function getCustomerTransactionsAction(
  id: string,
  range: { from: string | null; to: string | null },
): Promise<ActionResult<CustomerTransaction[]>> {
  const parsedId = customerIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Customer not found" };
  const parsedRange = customerTransactionRangeSchema.safeParse(range);
  if (!parsedRange.success) return { ok: false, error: parsedRange.error.issues[0]?.message ?? "Invalid dates" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listCustomerTransactions(sb, parsedId.data, parsedRange.data) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** The customer's change history, for roles that hold audit.read. */
export async function getCustomerActivityAction(id: string): Promise<ActionResult<AuditEntryRow[]>> {
  const parsedId = customerIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message ?? "Customer not found" };
  try {
    const sb = await createSupabaseServerClient();
    if (!(await hasPermission(sb, "audit.read"))) {
      return { ok: false, error: "Your role cannot read the change history. It needs the audit.read permission." };
    }
    const entries = await searchAudit(sb, {
      table_name: "acc_customer",
      record_id: parsedId.data,
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
