import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AppUserRow,
  ApprovalPolicyRow,
  ApprovalRequestRow,
  AuditEntryRow,
  PermissionRow,
  RolePermissionRow,
} from "@/lib/db/types";
import type {
  ApprovalPolicyInput,
  ApprovalSubmitInput,
  AuditFilterInput,
  RolePermissionInput,
  UserInviteInput,
  UserRoleInput,
  UserStatusInput,
} from "@/lib/domain/schemas";
import { createSupabaseAdminClient } from "@/lib/db/admin";
import { writeAudit } from "./audit";

export class AccessError extends Error {}

// --- Users ---

export async function listUsers(sb: SupabaseClient): Promise<AppUserRow[]> {
  const { data, error } = await sb.rpc("acc_list_users");
  if (error) throw new AccessError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    email: (r.email as string) ?? "",
    full_name: (r.full_name as string) ?? "",
    role: r.role as AppUserRow["role"],
    status: r.status as AppUserRow["status"],
    mfa_enrolled: Boolean(r.mfa_enrolled),
    last_sign_in: (r.last_sign_in as string | null) ?? null,
    invited_at: (r.invited_at as string | null) ?? null,
    status_reason: (r.status_reason as string | null) ?? null,
  }));
}

/**
 * Invite a user: create the auth account through the admin API, then record the
 * application role. The admin API is the only step that needs the service role;
 * the acc_app_user row is written with the caller's own client so RLS still
 * applies to it.
 */
export async function inviteUser(sb: SupabaseClient, input: UserInviteInput): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email);
  if (error) throw new AccessError(`Could not send the invitation: ${error.message}`);
  const userId = data.user?.id;
  if (!userId) throw new AccessError("The identity provider did not return a user id");

  const { error: eRow } = await sb.from("acc_app_user").upsert(
    {
      id: userId,
      full_name: input.full_name || "",
      role: input.role,
      status: "invited",
      invited_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (eRow) throw new AccessError(eRow.message);

  await writeAudit(sb, {
    table_name: "acc_app_user",
    record_id: userId,
    action: "insert",
    after: { email: input.email, role: input.role, status: "invited" },
  });
  return userId;
}

export async function setUserRole(
  sb: SupabaseClient,
  userId: string,
  input: UserRoleInput,
): Promise<void> {
  const { error } = await sb.rpc("acc_set_user_role", {
    p_user_id: userId,
    p_role: input.role,
    p_reason: input.reason,
  });
  if (error) throw new AccessError(error.message);
}

export async function setUserStatus(
  sb: SupabaseClient,
  userId: string,
  input: UserStatusInput,
): Promise<void> {
  const { error } = await sb.rpc("acc_set_user_status", {
    p_user_id: userId,
    p_status: input.status,
    p_reason: input.reason,
  });
  if (error) throw new AccessError(error.message);
}

// --- Permissions ---

export interface PermissionMatrix {
  permissions: PermissionRow[];
  assignments: RolePermissionRow[];
}

export async function getPermissionMatrix(sb: SupabaseClient): Promise<PermissionMatrix> {
  const [perms, assigns] = await Promise.all([
    sb.from("acc_permission").select("key,label,category,description,is_enforced").order("category").order("key"),
    sb.from("acc_role_permission").select("role,permission_key,allowed"),
  ]);
  if (perms.error) throw new AccessError(perms.error.message);
  if (assigns.error) throw new AccessError(assigns.error.message);
  return {
    permissions: (perms.data ?? []) as unknown as PermissionRow[],
    assignments: (assigns.data ?? []) as unknown as RolePermissionRow[],
  };
}

export async function setRolePermission(
  sb: SupabaseClient,
  input: RolePermissionInput,
): Promise<void> {
  const { error } = await sb.rpc("acc_set_role_permission", {
    p_role: input.role,
    p_key: input.permission_key,
    p_allowed: input.allowed,
  });
  if (error) throw new AccessError(error.message);
}

// --- Approval policies ---

export async function listApprovalPolicies(sb: SupabaseClient): Promise<ApprovalPolicyRow[]> {
  const { data, error } = await sb
    .from("acc_approval_policy")
    .select("action_key,label,description,enabled,threshold_minor,require_segregation,updated_at")
    .order("label");
  if (error) throw new AccessError(error.message);
  return (data ?? []) as unknown as ApprovalPolicyRow[];
}

export async function setApprovalPolicy(
  sb: SupabaseClient,
  input: ApprovalPolicyInput,
): Promise<void> {
  const { error } = await sb.rpc("acc_set_approval_policy", {
    p_action_key: input.action_key,
    p_enabled: input.enabled,
    p_threshold_minor: input.threshold_minor,
    p_require_segregation: input.require_segregation,
  });
  if (error) throw new AccessError(error.message);
}

// --- Approval requests ---

const REQUEST_COLS =
  "id,action_key,title,amount_minor,payload,reason,status,requested_by,requested_at," +
  "decided_by,decided_at,decision_note,result_id,error_message";

export async function listApprovalRequests(
  sb: SupabaseClient,
  status?: ApprovalRequestRow["status"],
): Promise<ApprovalRequestRow[]> {
  let query = sb.from("acc_approval_request").select(REQUEST_COLS).order("requested_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new AccessError(error.message);
  return (data ?? []) as unknown as ApprovalRequestRow[];
}

export async function submitForApproval(
  sb: SupabaseClient,
  input: ApprovalSubmitInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_submit_for_approval", {
    p_action_key: input.action_key,
    p_title: input.title || null,
    p_amount_minor: input.amount_minor,
    p_payload: input.payload,
    p_reason: input.reason,
  });
  if (error) throw new AccessError(error.message);
  return String(data);
}

/** Approving executes the request's intended call inside the same transaction. */
export async function approveRequest(
  sb: SupabaseClient,
  id: string,
  note: string,
): Promise<string | null> {
  const { data, error } = await sb.rpc("acc_approve_request", { p_request_id: id, p_note: note });
  if (error) throw new AccessError(error.message);
  return data ? String(data) : null;
}

export async function rejectRequest(sb: SupabaseClient, id: string, note: string): Promise<void> {
  const { error } = await sb.rpc("acc_reject_request", { p_request_id: id, p_note: note });
  if (error) throw new AccessError(error.message);
}

export async function cancelRequest(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_cancel_request", { p_request_id: id });
  if (error) throw new AccessError(error.message);
}

export async function countPendingApprovals(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb
    .from("acc_approval_request")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw new AccessError(error.message);
  return count ?? 0;
}

// --- Audit history ---

export async function searchAudit(
  sb: SupabaseClient,
  filter: AuditFilterInput,
): Promise<AuditEntryRow[]> {
  const { data, error } = await sb.rpc("acc_audit_search", {
    p_table: filter.table_name || null,
    p_record_id: filter.record_id || null,
    p_actor_id: filter.actor_id || null,
    p_action: filter.action || null,
    p_from: filter.from || null,
    p_to: filter.to || null,
    p_limit: filter.limit,
  });
  if (error) throw new AccessError(error.message);
  return (data ?? []) as unknown as AuditEntryRow[];
}

/**
 * Ask the server whether the current user holds a permission. Used by pages to
 * decide what to render; the RPC that performs the action checks it again, so
 * this is presentation only.
 */
export async function hasPermission(sb: SupabaseClient, key: string): Promise<boolean> {
  const { data, error } = await sb.rpc("acc_has_permission", { p_key: key });
  if (error) throw new AccessError(error.message);
  return Boolean(data);
}
