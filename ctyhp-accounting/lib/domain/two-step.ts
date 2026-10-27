/**
 * Two-step sign-in (2.65): a six-digit code from an authenticator app after
 * the password, built on Supabase Auth's TOTP factors.
 *
 * Supabase marks each session's token with an assurance level: aal1 after a
 * password, aal2 after the code. Someone with a verified factor whose session
 * is still aal1 owes the second step. The database refuses such a session
 * everything (0174, acc_current_role); these rules only route the screens.
 *
 * Pure, so a test can reach them without Next or Supabase.
 */

export type AssuranceLevel = "aal1" | "aal2";

export interface FactorLike {
  factor_type: string;
  status: string;
}

/** A factor that counts: an authenticator app whose first code was accepted. */
export function verifiedAppFactors<T extends FactorLike>(factors: readonly T[] | null | undefined): T[] {
  return (factors ?? []).filter((f) => f.factor_type === "totp" && f.status === "verified");
}

/** True when this person has a second step and this session has not passed it. */
export function owesSecondStep(factors: readonly FactorLike[] | null | undefined, sessionLevel: string | null | undefined): boolean {
  return verifiedAppFactors(factors).length > 0 && sessionLevel !== "aal2";
}

/** The login page's step that asks for the code. */
export const CODE_STEP_PATH = "/login?step=code";

/**
 * Where the proxy sends a request, or null to let it through. A signed-in
 * visitor is kept off /login unless they were sent there for the code step:
 * the app layout sends a session that owes it to /login?step=code, and
 * bouncing that back to the dashboard would loop.
 */
export function sessionRedirect(path: string, step: string | null, signedIn: boolean): "/login" | "/dashboard" | null {
  const onLogin = path === "/login";
  if (!signedIn) return onLogin ? null : "/login";
  if (onLogin && step !== "code") return "/dashboard";
  return null;
}

/** Where an admin or accountant past the deadline sets it up before anything else (2.66). */
export const REQUIRED_PATH = "/two-step-required";

export interface TwoStepPolicy {
  roles: readonly string[];
  /** ISO timestamp. */
  required_from: string;
}

export interface TwoStepRequirement {
  /** This role must have a second step (it may still be before the deadline). */
  required: boolean;
  /** Required, not set up, and the deadline has passed: set it up before anything else. */
  overdue: boolean;
  /** Required, not set up, deadline still ahead: remind. */
  remind: boolean;
  requiredFrom: string | null;
}

/**
 * What 2.66 asks of this person in this company. Mirrors 0175's rule in
 * acc_current_role(); the database decides, this only chooses the screen. No
 * policy row means nothing is required, as in the database.
 */
export function twoStepRequirement(
  role: string | null,
  policy: TwoStepPolicy | null,
  enrolled: boolean,
  now: Date = new Date(),
): TwoStepRequirement {
  const required = Boolean(role && policy && policy.roles.includes(role));
  const requiredFrom = required ? policy!.required_from : null;
  const due = requiredFrom !== null && now.getTime() >= new Date(requiredFrom).getTime();
  return {
    required,
    overdue: required && !enrolled && due,
    remind: required && !enrolled && !due,
    requiredFrom,
  };
}

/** Whole days left before the deadline, rounded up; 0 once it has passed. */
export function daysLeft(requiredFrom: string, now: Date = new Date()): number {
  const ms = new Date(requiredFrom).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** A code as typed, spaces dropped; null unless it is six digits. */
export function readCode(raw: string): string | null {
  const digits = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}
