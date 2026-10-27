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

/** A code as typed, spaces dropped; null unless it is six digits. */
export function readCode(raw: string): string | null {
  const digits = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}
