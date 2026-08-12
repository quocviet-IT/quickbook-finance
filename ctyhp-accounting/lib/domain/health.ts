/**
 * What "the application is up" means, and how the answer is shaped.
 *
 * Pure on purpose. Deciding a verdict from a set of results, and deciding what
 * an unauthenticated caller is allowed to be told, are rules — and rules belong
 * where a test can hold them to account rather than where a network sits in
 * the way.
 */

export const HEALTH_CHECKS = ["database", "authentication", "configuration"] as const;

export type HealthCheckName = (typeof HEALTH_CHECKS)[number];
export type CheckStatus = "ok" | "fail";
export type OverallStatus = "ok" | "down";

export interface CheckResult {
  name: HealthCheckName;
  status: CheckStatus;
}

export interface HealthPayload {
  status: OverallStatus;
  checkedAt: string;
  checks: CheckResult[];
}

/**
 * Up only when everything is up.
 *
 * There is no middle state, because there is no middle reality: the database,
 * the sign-in service and the configuration are each a condition for anyone to
 * do anything at all. An empty list reads as down — it means the probes never
 * ran, and "no news is good news" is the wrong default for a health check.
 */
export function overallStatus(results: readonly CheckResult[]): OverallStatus {
  if (results.length === 0) return "down";
  return results.every((result) => result.status === "ok") ? "ok" : "down";
}

/** Monitors key off the status code, not the body, so the code has to be right. */
export function httpStatusFor(status: OverallStatus): 200 | 503 {
  return status === "ok" ? 200 : 503;
}

/**
 * The whole of what an unauthenticated caller is told.
 *
 * Built here rather than assembled at the route so there is one place that
 * decides what crosses the wire — and one place for a test to prove that no
 * error message, host name or version ever joins it.
 */
export function buildPayload(results: readonly CheckResult[], checkedAt: string): HealthPayload {
  return {
    status: overallStatus(results),
    checkedAt,
    checks: results.map(({ name, status }) => ({ name, status })),
  };
}

/**
 * A value that was never actually configured.
 *
 * Catches the wording shipped in .env.local.example as well as the REPLACE
 * prefix that lib/db/admin.ts already tests for, because a deployment carrying
 * either behaves as if the whole service were down and the reason is invisible.
 */
export function isPlaceholder(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return true;
  if (/^REPLACE/i.test(trimmed)) return true;
  return /YOUR-PROJECT-REF|your-anon-key/i.test(trimmed);
}

export function checkConfiguration(env: { url?: string; anonKey?: string }): CheckResult {
  const configured = !isPlaceholder(env.url) && !isPlaceholder(env.anonKey) && parses(env.url);
  return { name: "configuration", status: configured ? "ok" : "fail" };
}

function parses(url: string | undefined): boolean {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    // Not swallowed: a malformed URL is precisely the failure this reports.
    return false;
  }
}
