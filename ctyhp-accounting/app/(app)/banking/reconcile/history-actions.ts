"use server";
/**
 * Reconciliation history and the flow around it (2.03): bringing an account's
 * history forward from Reconcile history or from inside a reconciliation,
 * discarding a reconciliation in progress, and setting a misread statement line
 * aside. Writes need someone who can write; reads are open to a viewer.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import {
  historyBroughtForwardNote,
  withStandings,
  type HistoryAccount,
  type HistoryPreview,
} from "@/lib/domain/reconcile-history";
import { getBankStanding } from "@/lib/services/bank-standing";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import type { SessionHistoryFacts } from "@/lib/domain/reconcile-statement";
import {
  historyBringForwardSchema,
  historyPreviewSchema,
  reconciliationDiscardSchema,
  statementLineAsideSchema,
} from "@/lib/domain/schemas";
import { BankRecError } from "@/lib/services/bankrec";
import {
  bringHistoryForward,
  bringHistoryForwardFromSession,
  discardReconciliation,
  getHistoryPreview,
  getReconciliationHistory,
  getSessionHistoryAdvice,
  setStatementLineAside,
  type BroughtForwardHistory,
} from "@/lib/services/reconcile-history";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
async function readGuard(): Promise<string | null> {
  return (await getUserRole()) ? null : "Not authorized";
}
function msg(e: unknown): string {
  return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred";
}
const isId = (id: string) => z.uuid().safeParse(id).success;
const NOT_FOUND = "Reconciliation not found";

function revalidateHistory(...reconciliationIds: (string | null)[]) {
  for (const path of ["/banking/reconcile", "/banking/reconcile/history", "/banking"]) revalidatePath(path);
  for (const id of reconciliationIds) if (id) revalidatePath(`/banking/reconcile/${id}`);
}

export interface DiscardedReconciliation {
  /** The ticks removed with the reconciliation. */
  ticksRemoved: number;
}

/**
 * Discards a reconciliation in progress: its ticks and statement lines go with
 * it; the statement file, its bank lines and any entries added from it stay.
 */
export async function discardReconciliationAction(
  reconciliationId: string,
  raw: unknown,
): Promise<ActionResult<DiscardedReconciliation>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isId(reconciliationId)) return { ok: false, error: NOT_FOUND };
  const parsed = reconciliationDiscardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const ticksRemoved = await discardReconciliation(sb, reconciliationId, parsed.data.reason);
    revalidateHistory(reconciliationId);
    return { ok: true, data: { ticksRemoved } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Brings the history forward from inside a reconciliation in progress. The day
 * and the balance are read from the stored reconciliation and its statement
 * file on the server; the screen sends only which reconciliation.
 */
export async function bringHistoryForwardFromSessionAction(
  reconciliationId: string,
): Promise<ActionResult<BroughtForwardHistory & { fileWarning: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isId(reconciliationId)) return { ok: false, error: NOT_FOUND };
  try {
    const sb = await createSupabaseServerClient();
    const result = await bringHistoryForwardFromSession(sb, reconciliationId);
    revalidateHistory(reconciliationId, result.reconciliationId);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Brings an account's history forward from Reconcile history, proved by the
 * statement's balance on the day the person names. The database refuses unless
 * the books hold exactly that balance.
 */
export async function bringHistoryForwardAction(raw: unknown): Promise<ActionResult<BroughtForwardHistory>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = historyBringForwardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const { bank_account_id, through, balance_minor } = parsed.data;
  try {
    const sb = await createSupabaseServerClient();
    const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
    const result = await bringHistoryForward(
      sb,
      bank_account_id,
      through,
      balance_minor,
      historyBroughtForwardNote(balance_minor, through, money),
    );
    revalidateHistory(result.reconciliationId, result.rebasedReconciliationId);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Sets a statement line aside as not a transaction, or brings it back. A line paired with the books is refused. */
export async function setStatementLineAsideAction(reconciliationId: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isId(reconciliationId)) return { ok: false, error: NOT_FOUND };
  const parsed = statementLineAsideSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await setStatementLineAside(sb, reconciliationId, parsed.data.line_no, parsed.data.aside);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Every bank account's reconciliation history, as Banking lists the accounts. Reads only. */
export async function reconciliationHistoryAction(): Promise<ActionResult<HistoryAccount[]>> {
  const denied = await readGuard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const { asOf } = await getBankingContext(sb);
    // One round trip for the client; a standing that cannot be read leaves the columns blank, not the page.
    const [history, standings] = await Promise.all([
      getReconciliationHistory(sb),
      getBankStanding(sb, asOf).catch(() => null),
    ]);
    return { ok: true, data: withStandings(history, standings) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** What the books hold on an account through a day: Reconcile history's live preview. Reads only. */
export async function historyPreviewAction(raw: unknown): Promise<ActionResult<HistoryPreview>> {
  const denied = await readGuard();
  if (denied) return { ok: false, error: denied };
  const parsed = historyPreviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getHistoryPreview(sb, parsed.data.bank_account_id, parsed.data.through) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * What a reconciliation's offer to bring the history forward rests on; null
 * when it has nothing to offer. The screen words it with sessionHistoryAdvice.
 * Reads only.
 */
export async function sessionHistoryAdviceAction(reconciliationId: string): Promise<ActionResult<SessionHistoryFacts | null>> {
  const denied = await readGuard();
  if (denied) return { ok: false, error: denied };
  if (!isId(reconciliationId)) return { ok: false, error: NOT_FOUND };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSessionHistoryAdvice(sb, reconciliationId) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
