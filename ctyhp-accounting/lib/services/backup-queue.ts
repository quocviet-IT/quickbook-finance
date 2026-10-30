import "server-only";

/**
 * How long one run keeps starting snapshots, in milliseconds.
 *
 * It was a count, three companies a night, which left each of seven companies
 * two or three days between snapshots (follow-up review, 2026-10-28). 2.74 made
 * it a time budget, on the measure that the largest company took 18.6 seconds.
 * The nightly runs since measure 35 to 40 seconds for a small company and 60 to
 * 75 for the largest (29 October: five companies in 226 seconds), so one run
 * covered five of seven and left two for the next night.
 *
 * Now the night has three runs (vercel.json: 12:00, 12:10 and 12:20 UTC), and
 * each later run takes only the companies with no snapshot yet that day. The
 * budget is 180 seconds so that a snapshot started just inside it, at the
 * largest measured 75 seconds and half again for growth, still ends inside the
 * route's 300.
 */
export const BACKUP_TIME_BUDGET_MS = 180_000;

export interface BackupCandidate {
  slug: string;
  /** ISO date of the last snapshot, or null if the company has never had one. */
  lastBackup: string | null;
}

/**
 * The companies a run covers, in order: never backed up first, then longest
 * waiting. A company with a snapshot (or a skip) already dated today is done
 * for the night, so a later run that night covers only the rest.
 *
 * The run decides how many it reaches (BACKUP_TIME_BUDGET_MS). The order is what
 * keeps a short night fair: whoever one run leaves out is first for the next,
 * so no company is passed over while others go every night.
 */
export function companiesDueForBackup<T extends BackupCandidate>(companies: readonly T[], today?: string): T[] {
  return companies
    .filter((c) => today === undefined || c.lastBackup === null || c.lastBackup < today)
    .sort((a, b) => (a.lastBackup ?? "").localeCompare(b.lastBackup ?? ""));
}
