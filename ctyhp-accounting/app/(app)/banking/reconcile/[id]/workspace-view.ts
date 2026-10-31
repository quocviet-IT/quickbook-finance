import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getReconciliationDetail,
  getReconciliationLines,
  getReconciliationStatement,
  type ReconDetail,
  type ReconLineView,
  type ReconStatement,
} from "@/lib/services/bankrec";
import { settled, type ViewResult } from "../../banking-view";

/** Everything the reconciliation screen draws its figures with. */
export interface ReconcileWorkspaceView {
  lines: ViewResult<ReconLineView[]>;
  detail: ViewResult<ReconDetail>;
  statement: ViewResult<ReconStatement>;
}

/**
 * The three reads behind the reconciliation screen, side by side on one
 * client, each keeping its own error.
 *
 * They were three Server Actions sent together with Promise.all, after the
 * page had loaded and again after every tick. Next sends a page's Server
 * Actions one after another, so each reload was three round trips in a row.
 * Read by the page for the first paint (2.92) and by
 * `reconcileWorkspaceAction` for every reload after.
 */
export async function readReconcileWorkspace(sb: SupabaseClient, reconciliationId: string): Promise<ReconcileWorkspaceView> {
  const [lines, detail, statement] = await Promise.all([
    settled(() => getReconciliationLines(sb, reconciliationId)),
    settled(() => getReconciliationDetail(sb, reconciliationId)),
    settled(() => getReconciliationStatement(sb, reconciliationId)),
  ]);
  return { lines, detail, statement };
}
