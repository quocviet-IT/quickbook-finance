"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import {
  AGREES_MESSAGE,
  countDifferenceMinor,
  countedTotalMinor,
  stockCountErrorMessage,
  validateStockCount,
} from "@/lib/domain/stock-count";
import { executeOrSubmitForApproval } from "@/lib/services/approval-flow";
import {
  createStockCount,
  getBookValue,
  getEntryNumber,
  getStockCount,
  markStockCountPending,
  postStockCount,
  saveStockCount,
} from "@/lib/services/stock-count";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** How a post ended: the entry it wrote, or the approval request it was sent as. */
export type PostStockCountOutcome =
  | { kind: "posted"; entryId: string; entryNumber: string | null }
  | { kind: "submitted"; requestId: string };

const NO_PERMISSION = "You do not have permission to change stock counts";

function msg(e: unknown): string {
  return e instanceof Error ? stockCountErrorMessage(e.message) : "An unexpected error occurred";
}

function revalidateCounts(id?: string) {
  revalidatePath("/inventory/stock-count");
  if (id) revalidatePath(`/inventory/stock-count/${id}`);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the as-of date");

/** Open the current draft, or start one dated `asOf` (the company's today) from the previous count. */
export async function createStockCountAction(asOf: string): Promise<ActionResult<{ id: string }>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const date = isoDate.safeParse(asOf);
  if (!date.success) return { ok: false, error: date.error.issues[0]?.message ?? "Choose the as-of date" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await createStockCount(sb, date.data);
    revalidateCounts(id);
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

const lineSchema = z.object({
  name: z.string(),
  sku: z.string().nullable(),
  quantity: z.number(),
  unitCostMinor: z.number(),
  sellsForMinor: z.number().nullable(),
});

const saveSchema = z.object({
  id: z.uuid(),
  asOf: z.string(),
  memo: z.string().nullable(),
  lines: z.array(lineSchema),
});

/** Save the draft: its date, memo and the whole set of lines, in one step. */
export async function saveStockCountAction(raw: unknown): Promise<ActionResult<{ saved: number }>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The count could not be read; reload the page and try again" };
  const input = parsed.data;
  const problems = validateStockCount(input);
  if (problems.length > 0) {
    const first = problems[0];
    return { ok: false, error: first.lineNumber === null ? first.reason : `Line ${first.lineNumber}: ${first.reason}` };
  }
  try {
    const sb = await createSupabaseServerClient();
    const saved = await saveStockCount(sb, input);
    revalidateCounts(input.id);
    return { ok: true, data: { saved } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** What the books say the stock is worth on a date, for the draft screen when the as-of date changes. */
export async function bookValueAction(asOf: string): Promise<ActionResult<{ bookMinor: number }>> {
  const date = isoDate.safeParse(asOf);
  if (!date.success) return { ok: false, error: date.error.issues[0]?.message ?? "Choose the as-of date" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: { bookMinor: await getBookValue(sb, date.data) } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

const postSchema = z.object({
  id: z.uuid(),
  inventoryAccountId: z.uuid("Choose the inventory account"),
  offsetAccountId: z.uuid("Choose the offset account"),
});

/**
 * Post the count as one adjusting entry, or send it for a second person's
 * approval when the inventory-adjustment policy asks for that at this size.
 *
 * The approval amount is the size of the difference, worked out here from the
 * saved lines and the books on the as-of date. The database recomputes the
 * difference when it posts, and again when the request is approved.
 */
export async function postStockCountAction(raw: unknown): Promise<ActionResult<PostStockCountOutcome>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const { id, inventoryAccountId, offsetAccountId } = parsed.data;
  try {
    const sb = await createSupabaseServerClient();
    const found = await getStockCount(sb, id);
    if (!found) return { ok: false, error: "Stock count not found" };
    if (found.count.status !== "draft") {
      return { ok: false, error: `Stock count ${found.count.count_number} is not a draft, so it cannot be posted` };
    }

    const counted = countedTotalMinor(
      found.lines.map((l) => ({ quantity: l.quantity, unitCostMinor: l.unit_cost_minor })),
    );
    const difference = countDifferenceMinor(counted, await getBookValue(sb, found.count.as_of));
    if (difference === 0) return { ok: false, error: AGREES_MESSAGE };

    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "inventory_adjustment",
      title: `Stock count ${found.count.count_number}`,
      amountMinor: Math.abs(difference),
      reason: `Stock count ${found.count.count_number} as of ${found.count.as_of}`,
      payload: {
        stock_count_id: id,
        inventory_account_id: inventoryAccountId,
        offset_account_id: offsetAccountId,
      },
      execute: () => postStockCount(sb, { id, inventoryAccountId, offsetAccountId }),
    });

    let result: PostStockCountOutcome;
    if (outcome.status === "submitted") {
      try {
        await markStockCountPending(sb, id, outcome.requestId);
      } catch (e) {
        revalidatePath("/approvals");
        revalidateCounts(id);
        return { ok: false, error: `The request was sent for approval, but the count could not be linked to it: ${msg(e)}` };
      }
      result = { kind: "submitted", requestId: outcome.requestId };
    } else {
      result = { kind: "posted", entryId: outcome.result, entryNumber: await getEntryNumber(sb, outcome.result) };
    }

    revalidateCounts(id);
    revalidatePath("/approvals");
    revalidatePath("/journal");
    revalidatePath("/dashboard");
    revalidatePath("/reports/inventory-valuation");
    revalidatePath("/reports/purchases-inventory");
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
