import type { AppRole } from "@/lib/db/types";

/**
 * The permission matrix's unsaved changes (3.0.34).
 *
 * Each switch used to write the moment it was flipped: a slip of the mouse
 * took a permission from every accountant at once, with no chance to look the
 * change over. Now flipping a switch only records it here; Save writes them
 * together, after showing them, and Discard puts the matrix back.
 *
 * A draft holds only cells that differ from what is saved: flipping a switch
 * back to where it was removes it, so "nothing to save" is never a lie.
 */
export type PermissionDrafts = Readonly<Record<string, boolean>>;

export const cellKey = (role: AppRole, permissionKey: string) => `${role}:${permissionKey}`;

/** The drafts after one switch is flipped to `allowed`, given what is saved. */
export function flip(drafts: PermissionDrafts, role: AppRole, permissionKey: string, allowed: boolean, saved: boolean): PermissionDrafts {
  const key = cellKey(role, permissionKey);
  const next = { ...drafts };
  if (allowed === saved) delete next[key];
  else next[key] = allowed;
  return next;
}

export interface PermissionChange {
  role: AppRole;
  permission_key: string;
  label: string;
  allowed: boolean;
}

/** The pending changes in the matrix's own order: by permission, then by role. */
export function pendingChanges(
  drafts: PermissionDrafts,
  permissions: readonly { key: string; label: string }[],
  roles: readonly AppRole[],
): PermissionChange[] {
  const changes: PermissionChange[] = [];
  for (const permission of permissions) {
    for (const role of roles) {
      const allowed = drafts[cellKey(role, permission.key)];
      if (allowed !== undefined) changes.push({ role, permission_key: permission.key, label: permission.label, allowed });
    }
  }
  return changes;
}

const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/** One change in words: "Accountant gets Approve bills", "Sales loses Edit items". */
export function describeChange(change: { role: string; label: string; allowed: boolean }): string {
  return `${roleName(change.role)} ${change.allowed ? "gets" : "loses"} ${change.label}`;
}
