import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActorRow,
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
  UserCreateInput,
  UserRoleInput,
  UserStatusInput,
} from "@/lib/domain/schemas";
import { createSupabaseAdminClient } from "@/lib/db/admin";

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
 * Every colleague who could appear as the actor on a document or an audit
 * entry. Readable by any signed-in role — unlike `listUsers`, which is part of
 * user administration and carries roles and account status with it.
 */
export async function listActors(sb: SupabaseClient): Promise<ActorRow[]> {
  const { data, error } = await sb.rpc("acc_actor_directory");
  if (error) throw new AccessError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    email: (r.email as string) ?? "",
    full_name: (r.full_name as string) ?? "",
  }));
}

/**
 * Create a confirmed account with the password supplied by the administrator,
 * then record its application role. Supabase Admin createUser does not send an
 * email, and the password is never written to application tables or audit data.
 *
 * **One grant decides access, and it is the `acc_app_user` row.** Since 0123 the
 * register derives entitlement from that row rather than keeping its own list,
 * so a user is entitled to this company the moment the row exists and stops
 * being entitled the moment it is suspended — one column, one effect.
 *
 * That is what makes the sequence below safe without a distributed transaction.
 * The register write that follows is bookkeeping: who granted whom, and when.
 * If it fails, the account is still correct and still usable; the two writes can
 * no longer disagree about anything that matters, because only one of them is
 * consulted.
 *
 * The history is worth keeping in view. This function once wrote only the
 * `acc_app_user` row, and every user it created was born unable to open the
 * company they were created in — the register was the gate then, and nobody
 * noticed until one signed in. The fix at the time was to write both. The fix
 * now is that only one of them answers the question.
 */
export async function createUser(
  sb: SupabaseClient,
  companyId: string,
  input: UserCreateInput,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name || "" },
  });
  if (error) throw new AccessError(`Could not create the user: ${error.message}`);
  const userId = data.user?.id;
  if (!userId) throw new AccessError("The identity provider did not return a user id");

  const { error: eRow } = await sb.from("acc_app_user").upsert(
    {
      id: userId,
      full_name: input.full_name || "",
      role: input.role,
      status: "active",
      invited_at: null,
    },
    { onConflict: "id" },
  );
  if (eRow) {
    await admin.auth.admin.deleteUser(userId);
    throw new AccessError(eRow.message);
  }

  // The account is now usable: entitlement is the row above, and it exists.
  //
  // What follows records *who granted this and when*, which the role row does
  // not carry. Only the service role may write the register, by design — an
  // application session must not be able to hand out access to other companies.
  //
  // A failure here no longer rolls the account back, and that is the change:
  // undoing a working account to keep an audit note tidy would trade something
  // that matters for something that does not. It is reported and left for
  // `onebook.entitlement_drift()` to surface.
  const register = createSupabaseAdminClient("onebook");
  const { error: eMember } = await register
    .from("company_member")
    .upsert({ company_id: companyId, user_id: userId }, { ignoreDuplicates: true });
  if (eMember) {
    console.error(
      `user ${userId} was created and is entitled to company ${companyId}, ` +
        `but the register note failed: ${eMember.message}`,
    );
  }

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

/**
 * How many people hold `approval.decide` and can actually sign off. With fewer
 * than two, a policy that requires segregation of duties blocks its action for
 * everyone — the UI warns before an admin enables that.
 */
export async function getApproverCount(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.rpc("acc_approver_count");
  if (error) throw new AccessError(error.message);
  return Number(data ?? 0);
}
