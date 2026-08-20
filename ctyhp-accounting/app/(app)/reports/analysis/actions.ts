"use server";
import { revalidatePath } from "next/cache";
import { getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { AccountType } from "@/lib/domain/accounts";
import {
  buildWhatIfAnalysis,
  freezeAnalysisSchema,
  type AdjustableAccount,
  type FreezeAnalysisInput,
} from "@/lib/domain/financial-analysis";
import type { LedgerBalance } from "@/lib/domain/reports";
import { canWrite } from "@/lib/domain/roles";
import {
  archiveFinancialAnalysis,
  FinancialAnalysisError,
  freezeFinancialAnalysis,
} from "@/lib/services/financial-analysis";
import { getLedgerBalances } from "@/lib/services/reports";

export interface AnalysisActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(error: unknown): string {
  if (error instanceof FinancialAnalysisError || error instanceof Error) return error.message;
  return "An unexpected error occurred";
}

async function loadAccounts(
  sb: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<AdjustableAccount[]> {
  const { data, error } = await sb
    .from("acc_account")
    .select("id,account_code,name,account_type")
    .eq("is_active", true)
    .order("account_code");
  if (error) throw new FinancialAnalysisError(error.message);
  return (data ?? []).map((a) => ({
    accountId: a.id as string,
    accountCode: a.account_code as string,
    name: a.name as string,
    accountType: a.account_type as AccountType,
  }));
}

export async function getAnalysisDataAction(
  from: string,
  to: string,
): Promise<
  AnalysisActionResult<{
    pnlRows: LedgerBalance[];
    bsRows: LedgerBalance[];
    accounts: AdjustableAccount[];
  }>
> {
  try {
    const sb = await createSupabaseServerClient();
    const [pnlRows, bsRows, accounts] = await Promise.all([
      getLedgerBalances(sb, from, to),
      getLedgerBalances(sb, null, to),
      loadAccounts(sb),
    ]);
    return { ok: true, data: { pnlRows, bsRows, accounts } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function freezeAnalysisAction(
  input: FreezeAnalysisInput,
): Promise<AnalysisActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to freeze an analysis" };
  const parsed = freezeAnalysisSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That analysis cannot be frozen" };
  }
  try {
    const sb = await createSupabaseServerClient();
    // The snapshot is recomputed here, from the ledger this session is allowed
    // to read — never accepted from the client (CLAUDE.md: never trust
    // client-sent totals).
    const [pnlRows, bsRows, accounts] = await Promise.all([
      getLedgerBalances(sb, parsed.data.periodStart, parsed.data.periodEnd),
      getLedgerBalances(sb, null, parsed.data.periodEnd),
      loadAccounts(sb),
    ]);
    const snapshot = buildWhatIfAnalysis(pnlRows, bsRows, parsed.data.adjustments, accounts);
    const id = await freezeFinancialAnalysis(sb, parsed.data, snapshot);
    revalidatePath("/reports/analysis");
    return { ok: true, data: { id } };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}

export async function archiveAnalysisAction(
  id: string,
  reason: string | null,
): Promise<AnalysisActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to archive an analysis" };
  try {
    const sb = await createSupabaseServerClient();
    await archiveFinancialAnalysis(sb, id, reason);
    revalidatePath("/reports/analysis");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: msg(error) };
  }
}
