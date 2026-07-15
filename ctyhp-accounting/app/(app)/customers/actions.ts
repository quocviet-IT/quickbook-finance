"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { createCustomer, InvoicingError } from "@/lib/services/invoicing";
import { customerCreateSchema } from "@/lib/domain/schemas";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createCustomerAction(raw: unknown): Promise<ActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = customerCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await createCustomer(sb, parsed.data);
    revalidatePath("/customers");
    revalidatePath("/invoices");
    return { ok: true };
  } catch (err) {
    const message = err instanceof InvoicingError || err instanceof Error ? err.message : "An unexpected error occurred";
    return { ok: false, error: message };
  }
}
