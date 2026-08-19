/**
 * Pure rules for scheduled backups: what identifies a snapshot's content,
 * whether tonight's is worth keeping, which old ones retention deletes, and
 * whether a snapshot may be loaded back. No database or filesystem access
 * lives here — the caller does the reading and writing, this module only
 * decides.
 */

import { sha256Hex } from "@/lib/domain/company-export";

/**
 * Turns a parsed export manifest into the `path -> sha256` record
 * `snapshotHash` below compares.
 *
 * The manifest carries `generatedAt` and `generatedBy` alongside `files[]`,
 * and a ZIP's own bytes embed timestamps too — both change on every run
 * whatever the books did. This function is the one place that keeps them out
 * of a snapshot's identity: it takes only `files` from the manifest, so a
 * caller cannot reintroduce the timestamp or the actor by building the
 * record a different way, because this is the only way offered. Takes the
 * narrowest shape that does the job, not a full manifest type, so it works
 * on anything shaped like one.
 */
export function snapshotDescription(manifest: {
  files: Array<{ path: string; sha256: string }>;
}): Record<string, string> {
  return Object.fromEntries(manifest.files.map((file) => [file.path, file.sha256]));
}

/**
 * What decides whether tonight's books differ from last night's.
 *
 * Takes the `path -> sha256` pairs `snapshotDescription` above produces, not
 * a manifest or ZIP bytes directly — that function is what keeps a
 * timestamp or an actor's email from ever reaching here and making two
 * exports of an unchanged company hash differently.
 *
 * Sorted before hashing so the answer depends on the content and not on the
 * order the files happened to be built in. Hashed with `sha256Hex` — the same
 * digest the export already uses for each file — so a snapshot's identity
 * never depends on a second SHA-256 implementation agreeing with the first.
 */
export async function snapshotHash(fileHashes: Record<string, string>): Promise<string> {
  const canonical = Object.keys(fileHashes)
    .sort()
    .map((name) => `${name}:${fileHashes[name]}`)
    .join("\n");
  return sha256Hex(canonical);
}

/**
 * Whether tonight can be left alone.
 *
 * Most companies here hold a few hundred rows and may go weeks untouched.
 * Thirty identical snapshots in a row is not safety, it is noise that buries
 * the ones actually worth looking at. A company with no snapshot yet is never
 * skipped — skipping it would leave the company with none at all.
 */
export function shouldSkip(current: string, previous: string | null): boolean {
  return previous !== null && current === previous;
}

/** The snapshots past the retention limit, oldest first. */
export function expiredBackups<T extends { id: string; takenAt: string }>(
  backups: readonly T[],
  keep: number,
): T[] {
  const newestFirst = [...backups].sort((a, b) => {
    // Two snapshots can share a `takenAt` (same-second cron overlap, or test
    // fixtures). `sort` is stable, so without a tiebreaker the survivor would
    // be decided by whatever order the caller's query happened to return
    // them in — not a real ordering. `id` makes the choice deterministic
    // instead of an accident of database query order.
    const byTime = b.takenAt.localeCompare(a.takenAt);
    return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
  });
  // `slice(keep)` on the newest-first list is everything past the limit;
  // reversing puts them oldest-first, which is the order they should be
  // deleted in so an interrupted run leaves the newest ones intact.
  return newestFirst.slice(keep).reverse();
}

export type RestoreCompatibility = "ok" | "snapshot-is-newer";

/**
 * Whether this code can load that snapshot.
 *
 * Migration filenames sort in the order they were applied, so comparing them
 * as strings compares the schemas they describe. An older snapshot loads:
 * columns added since take their defaults. A newer one holds columns this
 * code has never heard of, and loading it anyway would drop them without a
 * word — so it is refused, and so is a snapshot that cannot say what it was
 * taken on, rather than let it slip through on a lexicographic accident.
 */
export function restoreCompatibility(
  snapshotVersion: string,
  currentVersion: string,
): RestoreCompatibility {
  if (snapshotVersion === "unknown") return "snapshot-is-newer";
  return snapshotVersion > currentVersion ? "snapshot-is-newer" : "ok";
}
