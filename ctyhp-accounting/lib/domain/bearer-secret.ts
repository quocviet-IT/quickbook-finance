import { timingSafeEqual } from "node:crypto";

/** A secret shorter than this is as good as none, so it never matches. */
export const MIN_SECRET_LENGTH = 24;

/**
 * Whether an Authorization header carries `configured` as its bearer token,
 * compared in constant time. Every server-to-server route checks its caller
 * here: the cron routes against CRON_SECRET, the OCR worker against
 * OCR_WORKER_SECRET.
 *
 * The lengths are compared in bytes, not characters, before timingSafeEqual:
 * a bearer with the right number of characters but a non-ASCII one among them
 * is longer in bytes, and timingSafeEqual throws on buffers of different sizes
 * — which turned a wrong key into a 500 instead of a 401.
 */
export function bearerMatches(authorization: string | null, configured: string | undefined): boolean {
  const secret = configured?.trim() ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return false;
  const expected = Buffer.from(secret);
  const given = Buffer.from(authorization?.replace(/^Bearer\s+/i, "") ?? "");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(expected, given);
}
