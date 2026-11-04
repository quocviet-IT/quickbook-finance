import { MIN_SECRET_LENGTH, bearerMatches } from "./bearer-secret";

/**
 * Whether a request comes from the company's OCR server: the bearer must be
 * OCR_WORKER_SECRET exactly, compared as CRON_SECRET is (bearerMatches). With
 * no secret of at least 24 characters configured, OCR is not set up at all.
 */
export function workerAccess(authorization: string | null, configured: string | undefined): "ok" | "unauthorized" | "disabled" {
  if ((configured?.trim() ?? "").length < MIN_SECRET_LENGTH) return "disabled";
  return bearerMatches(authorization, configured) ? "ok" : "unauthorized";
}
