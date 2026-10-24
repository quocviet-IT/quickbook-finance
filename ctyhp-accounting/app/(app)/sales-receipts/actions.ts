"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { salesReceiptCreateSchema, salesReceiptVoidSchema } from "@/lib/domain/schemas";
import {
  buildSalesReceiptDocument,
  type SalesReceiptDocument,
  type SalesReceiptLineRow,
  type SalesReceiptRow,
} from "@/lib/domain/sales-receipts";
import {
  createSalesReceipt,
  getSalesReceiptDetail,
  getSalesReceiptDocumentSource,
  listSalesReceipts,
  voidSalesReceipt,
} from "@/lib/services/sales-receipts";

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
  return err instanceof Error ? err.message : "An unexpected error occurred";
}

function invalid(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid data";
}

/** A receipt posts to the ledger, so every screen that reads money may have moved. */
function revalidate(): void {
  revalidatePath("/sales-receipts");
  revalidatePath("/sales");
  revalidatePath("/dashboard");
}

// --- Reads: anyone who can see the books (RLS decides) ---

export async function listSalesReceiptsAction(): Promise<ActionResult<SalesReceiptRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listSalesReceipts(sb) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function getSalesReceiptDetailAction(
  id: string,
): Promise<ActionResult<{ receipt: SalesReceiptRow; lines: SalesReceiptLineRow[] }>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSalesReceiptDetail(sb, id) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** The printable receipt, built on the server so the PDF is drawn from what the books hold. */
export async function getSalesReceiptDocumentAction(id: string): Promise<ActionResult<SalesReceiptDocument>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: buildSalesReceiptDocument(await getSalesReceiptDocumentSource(sb, id)) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

// --- Writes ---

/** Record a sale paid on the spot; it posts as it saves. */
export async function createSalesReceiptAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; receipt_number: string; total_minor: number }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = salesReceiptCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: invalid(parsed.error) };
  try {
    const sb = await createSupabaseServerClient();
    const saved = await createSalesReceipt(sb, parsed.data);
    revalidate();
    return { ok: true, data: saved };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Void a receipt with a reason. Its number stays; its entry stops counting. */
export async function voidSalesReceiptAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = salesReceiptVoidSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: invalid(parsed.error) };
  try {
    const sb = await createSupabaseServerClient();
    await voidSalesReceipt(sb, parsed.data.id, parsed.data.reason);
    revalidate();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
