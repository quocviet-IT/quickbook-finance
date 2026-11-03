import { timingSafeEqual } from "node:crypto";

/**
 * Whether a request comes from the company's OCR server: the bearer must be
 * OCR_WORKER_SECRET exactly, compared in constant time as CRON_SECRET is. With
 * no secret of at least 24 characters configured, OCR is not set up at all.
 */
export function workerAccess(authorization: string | null, configured: string | undefined): "ok" | "unauthorized" | "disabled" {
  const secret = configured?.trim() ?? "";
  if (secret.length < 24) return "disabled";
  const supplied = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  if (supplied.length !== secret.length) return "unauthorized";
  return timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)) ? "ok" : "unauthorized";
}
