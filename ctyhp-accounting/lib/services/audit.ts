import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  table_name: string;
  record_id: string | null;
  action: "insert" | "update" | "delete" | "post" | "void";
  before?: unknown;
  after?: unknown;
}

/** Append an entry to acc_audit_log, stamping the current user as actor. */
export async function writeAudit(sb: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { data } = await sb.auth.getUser();
  const { error } = await sb.from("acc_audit_log").insert({
    table_name: entry.table_name,
    record_id: entry.record_id,
    action: entry.action,
    actor_id: data.user?.id ?? null,
    before_json: entry.before ?? null,
    after_json: entry.after ?? null,
  });
  if (error) {
    // Audit must not silently vanish; surface it.
    throw new Error(`Failed to write audit log: ${error.message}`);
  }
}
