/**
 * Access-control rules: when an approval is required, who may decide it, and
 * the lock-out guard that keeps an installation from removing its last admin.
 *
 * These are the single definition of each rule; `acc_approval_required`,
 * `acc_approve_request`, and `acc_set_user_role/status` in
 * `supabase/migrations/0037_access_control_functions.sql` re-derive the same
 * logic server-side, because the UI may only *explain* an access decision — it
 * may never be the one making it.
 */
import type { AppRole, UserStatus } from "@/lib/db/types";
import type { Minor } from "./money";

export interface ApprovalPolicyLike {
  enabled: boolean;
  thresholdMinor: Minor;
}

/** A policy applies when it is on and the amount reaches its threshold. */
export function approvalRequired(policy: ApprovalPolicyLike, amountMinor: Minor): boolean {
  return policy.enabled && Math.abs(amountMinor) >= policy.thresholdMinor;
}

export interface DecideInput {
  requestedBy: string | null;
  requireSegregation: boolean;
}

/**
 * Segregation of duties: with it on, the requester cannot be the approver
 * (US-FR-012). The reason is returned so a disabled button can say why.
 */
export function canDecide(input: DecideInput, approverId: string): { ok: boolean; reason?: string } {
  if (input.requireSegregation && input.requestedBy === approverId) {
    return {
      ok: false,
      reason: "You cannot approve your own request while segregation of duties is enabled",
    };
  }
  return { ok: true };
}

/** Statuses that still hold an account open — the same set `acc_current_role()` accepts. */
const HOLDS_ACCESS: UserStatus[] = ["invited", "active"];

export interface UserLike {
  id: string;
  role: AppRole;
  status: UserStatus;
}

/**
 * Would removing this user's admin access leave nobody able to administer?
 * Mirrors `acc_active_admin_count()`; an invited admin counts, a suspended one
 * does not, because a suspended admin cannot let anyone back in.
 */
export function isLastActiveAdmin(users: UserLike[], userId: string): boolean {
  const target = users.find((u) => u.id === userId);
  if (!target || target.role !== "admin" || !HOLDS_ACCESS.includes(target.status)) return false;
  return users.filter((u) => u.role === "admin" && HOLDS_ACCESS.includes(u.status)).length <= 1;
}

/** One wording for a status change, used in confirmations and audit reasons. */
export function describeStatusChange(from: UserStatus, to: UserStatus): string {
  if (to === "suspended") return "Suspend this user — access is revoked immediately";
  if (to === "offboarded") return "Offboard this user — access is revoked and the history is kept";
  if (to === "active" && from === "suspended") return "Reactivate this user";
  if (to === "active") return "Activate this user";
  return `Change status from ${from} to ${to}`;
}

export interface ControlledAction {
  key: string;
  label: string;
  /** False for on/off policies where the amount is always zero. */
  usesThreshold: boolean;
}

/** The controlled actions wired to the approval engine (spec §4). */
export const CONTROLLED_ACTIONS: ControlledAction[] = [
  { key: "manual_journal", label: "Manual journal entry", usesThreshold: true },
  { key: "write_off", label: "Balance write-off", usesThreshold: true },
  { key: "inventory_adjustment", label: "Inventory adjustment", usesThreshold: true },
  { key: "period_reopen", label: "Accounting period reopen", usesThreshold: false },
  { key: "reconciliation_reopen", label: "Reconciliation reopen", usesThreshold: false },
  { key: "vendor_tax_profile", label: "Vendor tax profile change", usesThreshold: false },
];

/** Display order for the permission matrix. */
export const PERMISSION_CATEGORIES = [
  "Accounting",
  "Sales",
  "Purchases",
  "Receivables",
  "Banking",
  "Inventory",
  "Close",
  "Governance",
] as const;
