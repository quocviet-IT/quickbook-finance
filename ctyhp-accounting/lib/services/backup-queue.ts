import "server-only";

/**
 * How long one run keeps starting snapshots, in milliseconds.
 *
 * It was a count, three companies a night, which left each of seven companies
 * two or three days between snapshots (follow-up review, 2026-10-28). A time
 * budget covers every company each night while they fit, and only when they
 * stop fitting does the night end early, with the rest first in line tomorrow.
 *
 * Measured: the largest company takes 18.6 seconds to read. The route's ceiling
 * is 300 seconds, so a snapshot started just inside 200 has a hundred seconds,
 * five times the largest, to finish.
 */
export const BACKUP_TIME_BUDGET_MS = 200_000;

export interface BackupCandidate {
  slug: string;
  /** ISO date of the last snapshot, or null if the company has never had one. */
  lastBackup: string | null;
}

/**
 * Every company, in the order a run covers them: never backed up first, then
 * longest waiting.
 *
 * The run decides how many it reaches (BACKUP_TIME_BUDGET_MS). The order is what
 * keeps a short night fair: whoever it leaves out is the longest waiting
 * tomorrow, so no company is passed over twice while others go every night.
 */
export function companiesDueForBackup<T extends BackupCandidate>(companies: readonly T[]): T[] {
  return [...companies].sort((a, b) => (a.lastBackup ?? "").localeCompare(b.lastBackup ?? ""));
}
