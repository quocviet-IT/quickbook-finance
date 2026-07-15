"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole } from "@/lib/auth";
import { getLedgerBalances } from "@/lib/services/reports";
import type { LedgerBalance } from "@/lib/domain/reports";

export interface ActionResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

export async function getLedgerBalancesAction(
  from: string | null,
  to: string,
): Promise<ActionResult<LedgerBalance[]>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    const sb = await createSupabaseServerClient();
    const rows = await getLedgerBalances(sb, from, to);
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load report" };
  }
}
