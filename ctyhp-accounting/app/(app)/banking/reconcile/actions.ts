"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import {
  balanceGroupRemoveSchema, reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema,
} from "@/lib/domain/schemas";
import { GHOST_GONE, payeeKeyOf, type GhostGroup, type NegativeWatch } from "@/lib/domain/statement-alerts";
import { hasPermission } from "@/lib/services/access";
import {
  getBalanceEntryBlockers, getStatementAlerts, removeBalanceEntries,
  type BalanceEntryBlocker, type RemovedBalanceEntries,
} from "@/lib/services/statement-alerts";
import {
  createReconciliation, setCleared, setClearedMany, recordAdjustment, completeReconciliation, reopenReconciliation,
  getDiscrepancies,
  BankRecError, type DiscrepancyRow,
} from "@/lib/services/bankrec";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { readReconcileAccount, type ReconcileAccountView } from "./account-view";
import { readReconcileWorkspace, type ReconcileWorkspaceView } from "./[id]/workspace-view";
import { matchAfterCompletion, type CompletionMatching } from "@/lib/services/statement-bank-lines";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createReconciliationAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await createReconciliation(sb, parsed.data); revalidatePath("/banking/reconcile"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function setClearedAction(reconciliationId: string, journalLineId: string, cleared: boolean): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await setCleared(sb, reconciliationId, journalLineId, cleared); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

const clearedManySchema = z.object({
  reconciliationId: z.uuid(),
  journalLineIds: z.array(z.uuid()).min(1).max(10_000),
  cleared: z.boolean(),
});

/**
 * "Tick everything shown" and "Clear the ticks": many lines in one call. Every
 * line passes acc_set_cleared's checks, or none changes.
 */
export async function setClearedManyAction(
  reconciliationId: string,
  journalLineIds: string[],
  cleared: boolean,
): Promise<ActionResult<{ changed: number }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = clearedManySchema.safeParse({ reconciliationId, journalLineIds, cleared });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const changed = await setClearedMany(sb, parsed.data.reconciliationId, parsed.data.journalLineIds, parsed.data.cleared);
    return { ok: true, data: { changed } };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function recordAdjustmentAction(reconciliationId: string, raw: unknown): Promise<ActionResult<{ entryId: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const entryId = await recordAdjustment(sb, reconciliationId, parsed.data); return { ok: true, data: { entryId } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** Completes a reconciliation, then matches its bank lines in Bank Transactions (1.85); a matching failure is said, not undone. */
export async function completeReconciliationAction(id: string): Promise<ActionResult<CompletionMatching>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await completeReconciliation(sb, id);
    const matching = await matchAfterCompletion(sb, id);
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return { ok: true, data: matching };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function reopenReconciliationAction(
  id: string,
  raw: unknown,
): Promise<ActionResult<ControlledActionResponse>> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can reopen a reconciliation" };
  const parsed = reconciliationReopenSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "reconciliation_reopen",
      title: "Bank reconciliation reopen",
      amountMinor: 0,
      reason: parsed.data.reason,
      payload: { reconciliation_id: id },
      execute: async () => {
        await reopenReconciliation(sb, id, parsed.data);
        return id;
      },
    });
    revalidatePath("/banking/reconcile");
    revalidatePath(`/banking/reconcile/${id}`);
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true, data: toControlledActionResponse(outcome, String) };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/**
 * Reads only: the reconciliation screen's lines, figures and statement in one
 * request (2.92). They were three actions, which Next sent one after another
 * on every reload; see readReconcileWorkspace.
 */
export async function reconcileWorkspaceAction(id: string): Promise<ReconcileWorkspaceView> {
  try {
    const sb = await createSupabaseServerClient();
    return await readReconcileWorkspace(sb, id);
  } catch (e) {
    const failed = { ok: false, error: msg(e) };
    return { lines: failed, detail: failed, statement: failed };
  }
}
export async function discrepanciesAction(bankAccountId: string): Promise<ActionResult<DiscrepancyRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getDiscrepancies(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/**
 * One bank account's reconciliations and its standing against its statements
 * at the company's today, for any signed-in role, in one request. Reads only.
 * The screen sends it ahead of the statement alerts (see readReconcileAccount).
 */
export async function reconcileAccountAction(bankAccountId: string): Promise<ActionResult<ReconcileAccountView>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  if (!z.uuid().safeParse(bankAccountId).success) return { ok: false, error: "Choose a bank account" };
  try {
    const sb = await createSupabaseServerClient();
    const { asOf } = await getBankingContext(sb);
    return { ok: true, data: await readReconcileAccount(sb, bankAccountId, asOf) };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** A flagged group with the entries that stand in the way of removing it (none, when it can go). */
export type GhostGroupView = GhostGroup & { blockers: BalanceEntryBlocker[] };

export interface StatementAlertsView {
  ghosts: GhostGroupView[];
  negative: NegativeWatch | null;
}

/**
 * Both statement alerts for one bank account, for any signed-in role.
 *
 * Who may remove is the database's call, so the blockers (which only staff may
 * ask for) are read for people who can write, and left empty for a viewer, who
 * is not offered the button anyway.
 */
export async function statementAlertsAction(bankAccountId: string): Promise<ActionResult<StatementAlertsView>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  if (!z.uuid().safeParse(bankAccountId).success) return { ok: false, error: "Choose a bank account" };
  try {
    const sb = await createSupabaseServerClient();
    const found = await getStatementAlerts(sb, bankAccountId);
    const ghosts: GhostGroupView[] = [];
    for (const group of found.ghosts) {
      const blockers = canWrite(role) ? await getBalanceEntryBlockers(sb, group.entryIds) : [];
      ghosts.push({ ...group, blockers });
    }
    return { ok: true, data: { ghosts, negative: found.negative } };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/**
 * Remove one flagged group: every entry in it, or none.
 *
 * The screen sends the account and the payee, not a list of entries. The group
 * is found again here, from the books as they are now, so a stale card cannot
 * remove entries that have since changed. The database function refuses the
 * whole request if any entry cannot go, and says which; that message is passed
 * on as it is.
 */
export async function removeBalanceGroupAction(raw: unknown): Promise<ActionResult<RemovedBalanceEntries>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = balanceGroupRemoveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    if (!(await hasPermission(sb, "journal.post"))) {
      return { ok: false, error: "Removing entries needs the Post manual journals permission." };
    }
    const { bankAccountId, payee, reason } = parsed.data;
    const found = await getStatementAlerts(sb, bankAccountId);
    const group = found.ghosts.find((g) => payeeKeyOf(g.payee) === payeeKeyOf(payee));
    if (!group) return { ok: false, error: GHOST_GONE };
    const result = await removeBalanceEntries(sb, bankAccountId, group.entryIds, reason);
    for (const path of ["/banking/reconcile", "/banking", "/journal", "/reports", "/reports/exceptions", "/dashboard"]) {
      revalidatePath(path);
    }
    return { ok: true, data: result };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}
