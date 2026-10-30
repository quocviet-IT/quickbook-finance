/**
 * When the nightly backups are due (2.89, 2.90), for the runs that take them and
 * the screens that watch them.
 *
 * vercel.json calls the backup route at 12:00, 12:10 and 12:20 UTC; the later
 * calls carry ?pass=2 and ?pass=3, and pass 3 is the night's last. A snapshot is
 * dated by the UTC day it was taken, so by 12:30 UTC (the last run's 300 seconds
 * and a little more) every company should hold one dated today.
 *
 * Pure: a moment in, dates out. UTC on purpose, as the runs are.
 */

/** The ?pass= of the night's last run. */
export const FINAL_BACKUP_PASS = "3";

/** By this UTC time of day the night's runs are over. */
export const BACKUPS_DONE_BY_UTC = "12:30";

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The date the latest snapshot should carry at this moment: today once the night's runs are over, yesterday before. */
export function expectedBackupDate(now: Date): string {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  return iso.slice(11, 16) >= BACKUPS_DONE_BY_UTC ? day : shiftDay(day, -1);
}

/** How many nights' snapshots are missing: 0 when the latest is on time; at least 1 when there is none at all. */
export function nightsMissed(lastBackup: string | null, expected: string): number {
  if (lastBackup === null) return 1;
  if (lastBackup >= expected) return 0;
  const [ly, lm, ld] = lastBackup.split("-").map(Number);
  const [ey, em, ed] = expected.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(ly, lm - 1, ld)) / 86_400_000);
}
