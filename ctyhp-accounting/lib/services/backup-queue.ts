import "server-only";

/**
 * How many companies one run covers.
 *
 * Measured: the largest company takes 18.6 seconds to read. Three fits inside
 * the 300-second ceiling the other cron routes already ask for, with room for a
 * company several times the size of today's largest.
 */
export const BACKUP_BATCH_LIMIT = 3;

export interface BackupCandidate {
  slug: string;
  /** ISO date of the last snapshot, or null if the company has never had one. */
  lastBackup: string | null;
}

/**
 * The companies this run should cover, longest-waiting first.
 *
 * A company gets a snapshot within the cycle rather than every night. Snapshots
 * are skipped anyway when nothing changed, and this exists to recover from a
 * mistake days old rather than minutes — so covering everyone eventually beats
 * a run that grows until it times out and covers nobody.
 */
export function companiesDueForBackup<T extends BackupCandidate>(companies: readonly T[]): T[] {
  return [...companies]
    .sort((a, b) => (a.lastBackup ?? "").localeCompare(b.lastBackup ?? ""))
    .slice(0, BACKUP_BATCH_LIMIT);
}
