/**
 * Pure role predicates, kept out of `lib/auth.ts` because that module is
 * server-only and these are the part worth unit-testing.
 *
 * Both are allow-lists on purpose. A role that is not named here cannot write,
 * which is what lets a new role be added without auditing every call site.
 * Never rewrite either as a deny-list.
 */
import type { AppRole } from "@/lib/db/types";

export function canWrite(role: AppRole | null): boolean {
  return role === "admin" || role === "accountant";
}

/** Config that only admins may change (tax rates, currencies, COA approval). */
export function isAdmin(role: AppRole | null): boolean {
  return role === "admin";
}
