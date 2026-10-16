import type { SupabaseClient } from "@supabase/supabase-js";
import type { NamedStatementOverride, StatementOverride } from "@/lib/domain/statement-overrides";
import { readAllPages } from "@/lib/services/paging";

export class StatementOverrideError extends Error {}

const fail = (message: string) => new StatementOverrideError(message);

/** One row of `acc_statement_overrides()` as PostgREST sends it: `bigint` columns arrive as strings. */
export function overrideFromRecord(r: Record<string, unknown>): StatementOverride {
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    batchId: String(r.batch_id),
    bankAccountId: String(r.bank_account_id),
    filename: String(r.filename ?? ""),
    importedAt: String(r.imported_at),
    overriddenBy: String(r.overridden_by),
    reason: String(r.override_reason ?? ""),
    outByMinor: Number(r.out_by_minor),
    openingMinor: Number(r.statement_opening_minor),
    closingMinor: Number(r.statement_closing_minor),
    firstLineDate: text(r.first_line_date),
    lastLineDate: text(r.last_line_date),
    settledByReconciliationId: text(r.settled_by_reconciliation_id),
    settledThrough: text(r.settled_through),
  };
}

/** User id → the name shown: the person's name, else their email. A failed read leaves no names. */
async function actorNames(sb: SupabaseClient): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data, error } = await sb.rpc("acc_actor_directory");
  if (error) return names;
  for (const a of (data ?? []) as Record<string, unknown>[]) {
    const name = String(a.full_name ?? "").trim() || String(a.email ?? "").trim();
    if (name) names.set(String(a.id), name);
  }
  return names;
}

/** What a sentence says when the directory cannot name the person. */
export const UNKNOWN_PERSON = "an unknown user";

/**
 * Every statement imported out of balance and not undone, open and settled,
 * oldest first. Callers filter by account or date. Settlement is the
 * database's answer, not recomputed here.
 */
export async function listStatementOverrides(sb: SupabaseClient): Promise<NamedStatementOverride[]> {
  const [rows, names] = await Promise.all([
    readAllPages<Record<string, unknown>>(
      (from, to) => sb.rpc("acc_statement_overrides").order("imported_at").order("batch_id").range(from, to),
      fail,
    ),
    actorNames(sb),
  ]);
  return rows.map((r) => {
    const override = overrideFromRecord(r);
    return { ...override, overriddenByName: names.get(override.overriddenBy) ?? UNKNOWN_PERSON };
  });
}
