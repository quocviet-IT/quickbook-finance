import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { BACKUP_BUCKET, BACKUP_KEEP, BackupError, takeCompanyBackup } from "@/lib/services/backup";

interface RetentionRow {
  id: string;
  takenAt: string;
  storagePath: string;
}

interface StubOptions {
  previousHash?: string | null;
  auditFails?: boolean;
  /** Fails the final `acc_backup` insert that records tonight's stored snapshot. */
  registerFails?: boolean;
  /**
   * Which storage paths should fail to `remove()`. `true` fails every
   * removal call regardless of path — enough for tests that only ever
   * trigger one. A `Set` fails only the named paths, so a retention pass
   * touching several snapshots can fail one and succeed on the rest.
   */
  removeFails?: true | Set<string>;
  /** Rows `applyRetention`'s `status = stored` query hands back. */
  retentionRows?: RetentionRow[];
  /**
   * Which `acc_backup` row ids should fail `delete()`. Same shape as
   * `removeFails` — `true` fails every row-delete, a `Set` fails only the
   * named ids, so one row can fail while an earlier one already failed its
   * blob removal.
   */
  deleteFails?: true | Set<string>;
  /** Fails the skip-branch insert for a reason that is not a duplicate key. */
  skipInsertFails?: boolean;
  /** Simulates the migration's `unique (taken_at, content_hash)` firing on the skip-branch insert. */
  skipInsertConflicts?: boolean;
  /** Simulates the same unique violation on the final stored-branch insert instead. */
  registerInsertConflicts?: boolean;
}

/** Shape of the error Postgres reports for a unique-constraint violation, SQLSTATE 23505. */
const DUPLICATE_KEY_ERROR = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "acc_backup_taken_at_content_hash_key"',
};

/** `BACKUP_KEEP` snapshots that are not expired, plus `expiredCount` older ones that are. */
function retentionFixture(expiredCount: number): RetentionRow[] {
  const total = BACKUP_KEEP + expiredCount;
  return Array.from({ length: total }, (_, i) => ({
    id: `id-${i}`,
    // Index 0 is the oldest — `taken_at` climbs with `i`, matching a real
    // `order("taken_at", { ascending: false })` result once sorted.
    takenAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
    storagePath: `company-1/2026-01-${String(i + 1).padStart(2, "0")}-abc.zip`,
  }));
}

/**
 * Enough of Supabase to drive the service.
 *
 * The datasets are deliberately tiny — this test is about the decisions the
 * service makes, not about the export, which has its own tests.
 */
function stub(options: StubOptions = {}) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const deletedIds: string[] = [];
  const sb = {
    from(table: string) {
      let lastEq: { column: string; value: unknown } | undefined;
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: (column: string, value: unknown) => {
          lastEq = { column, value };
          return chain;
        },
        limit: () => chain,
        range: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "acc_backup"
                ? options.previousHash === undefined
                  ? null
                  : { content_hash: options.previousHash }
                : { filename: "0114_backups.sql" },
            error: null,
          }),
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, ...row });
          const isSkipInsert = table === "acc_backup" && row.status === "skipped";
          const isStoredInsert = table === "acc_backup" && row.status === "stored";
          // Distinctive per failure mode on purpose: a message like "no" is a
          // substring of ordinary English ("not recorded", "onebook-backups")
          // and would still be found by a broken assertion, hiding the very
          // regression the test claims to catch.
          const error =
            table === "acc_audit_log" && options.auditFails
              ? { message: "audit-boom" }
              : isStoredInsert && options.registerFails
                ? { message: "register-boom" }
                : isStoredInsert && options.registerInsertConflicts
                  ? DUPLICATE_KEY_ERROR
                  : isSkipInsert && options.skipInsertFails
                    ? { message: "skip-insert-boom" }
                    : isSkipInsert && options.skipInsertConflicts
                      ? DUPLICATE_KEY_ERROR
                      : null;
          return Promise.resolve({ error });
        },
        // `applyRetention`'s `delete().eq("id", ...)` is its own chain, not
        // the generic `then` below, so the id it targets can be recorded —
        // the retention tests assert on exactly which rows survive.
        delete: () => ({
          eq: (column: string, value: unknown) => {
            if (table === "acc_backup" && column === "id") {
              deletedIds.push(String(value));
              const df = options.deleteFails;
              const failed = df === true || (df instanceof Set && df.has(String(value)));
              if (failed) {
                return Promise.resolve({
                  data: null,
                  error: { message: `simulated row-delete failure for ${value}` },
                });
              }
            }
            return Promise.resolve({ data: [], error: null });
          },
        }),
        then: (resolve: (value: unknown) => unknown) => {
          // Only `applyRetention`'s own `select(...).eq("status", "stored")`
          // query should see the retention fixture — the previous-hash
          // lookup shares the table but terminates on `.maybeSingle()`
          // above, never reaching here. Shaped snake_case, the way Supabase
          // actually returns it — `applyRetention` is what renames it.
          const data =
            table === "acc_backup" && lastEq?.column === "status" && lastEq.value === "stored"
              ? (options.retentionRows ?? []).map((row) => ({
                  id: row.id,
                  taken_at: row.takenAt,
                  storage_path: row.storagePath,
                }))
              : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
    storage: {
      from() {
        return {
          upload: (path: string) => {
            uploaded.push(path);
            return Promise.resolve({ error: null });
          },
          remove: (paths: string[]) => {
            removed.push(...paths);
            const rf = options.removeFails;
            const failedPath = rf === true ? paths[0] : paths.find((p) => rf?.has(p));
            return Promise.resolve({
              error: failedPath ? { message: `simulated storage failure for ${failedPath}` } : null,
            });
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { sb, uploaded, removed, inserted, deletedIds };
}

interface LiveRow {
  taken_at: string;
  content_hash: string;
  status: string;
}

/**
 * A fake `acc_backup` table that actually enforces the migration's own
 * `unique (taken_at, content_hash)`, instead of a stand-in error flag like
 * `stub()`'s `registerInsertConflicts`/`skipInsertConflicts` options above.
 *
 * One test needs this: calling `takeCompanyBackup` twice against the *same*
 * store, the way an operator re-invoking the endpoint tonight actually
 * would, so the conflict it hits is the real one production produces, not a
 * simulation of it.
 */
function liveBackupClient(rows: LiveRow[]): SupabaseClient {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: () => chain,
        limit: () => chain,
        range: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => {
          if (table !== "acc_backup") {
            return Promise.resolve({ data: { filename: "0114_backups.sql" }, error: null });
          }
          const stored = rows
            .filter((row) => row.status === "stored")
            .sort((a, b) => b.taken_at.localeCompare(a.taken_at));
          return Promise.resolve({
            data: stored[0] ? { content_hash: stored[0].content_hash } : null,
            error: null,
          });
        },
        insert: (row: Record<string, unknown>) => {
          if (table !== "acc_backup") return Promise.resolve({ error: null });
          const takenAt = row.taken_at as string;
          const hash = row.content_hash as string;
          const conflict = rows.some((r) => r.taken_at === takenAt && r.content_hash === hash);
          if (conflict) return Promise.resolve({ error: DUPLICATE_KEY_ERROR });
          rows.push({ taken_at: takenAt, content_hash: hash, status: row.status as string });
          return Promise.resolve({ error: null });
        },
        delete: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        // Retention's own `status = stored` read. Nothing in this fixture is
        // ever old enough to expire, and that pass is not what the one test
        // using this client is about.
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  } as unknown as SupabaseClient;
}

describe("taking a company's nightly snapshot", () => {
  it("stores the first one, because there is nothing to compare it with", async () => {
    const { sb, uploaded } = stub({ previousHash: undefined });
    const result = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    expect(result.status).toBe("stored");
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatch(/^company-1\/2026-08-16-[0-9a-f]{8}\.zip$/);
  });

  it("skips a night the books did not move, and writes no file", async () => {
    const first = stub({ previousHash: undefined });
    const seen = await takeCompanyBackup(first.sb, "company-1", "2026-08-16");

    const again = stub({ previousHash: seen.hash });
    const result = await takeCompanyBackup(again.sb, "company-1", "2026-08-17");
    expect(result.status).toBe("skipped");
    expect(result.path).toBeNull();
    expect(again.uploaded).toHaveLength(0);
  });

  it("keeps no file when the taxpayer data could not be recorded", async () => {
    // The manual export already refuses to hand over an archive it could not
    // record, because the snapshot carries taxpayer identification numbers. An
    // unattended job inherits the rule rather than being an exception to it.
    const { sb, removed } = stub({ previousHash: undefined, auditFails: true });
    await expect(takeCompanyBackup(sb, "company-1", "2026-08-16")).rejects.toThrow(/record/i);
    expect(removed).toHaveLength(1);
  });

  it("admits a taxpayer-data file was left behind when cleanup itself fails, and says where", async () => {
    // The audit write fails (so the file must not be kept) and the cleanup
    // remove() *also* fails — the file is still sitting in the bucket. The
    // thrown message must say so in exact terms, not claim success: nobody
    // goes looking for a leak the error denies exists.
    const { sb } = stub({ previousHash: undefined, auditFails: true, removeFails: true });
    let caught: unknown;
    try {
      await takeCompanyBackup(sb, "company-1", "2026-08-16");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BackupError);
    const message = (caught as Error).message;
    // States plainly that a file was left behind, not removed.
    expect(message).toMatch(/left behind/i);
    // Names where, precisely enough that a person can find and delete it.
    expect(message).toContain(BACKUP_BUCKET);
    expect(message).toMatch(/company-1\/2026-08-16-[0-9a-f]{8}\.zip/);
    // Keeps the original cause too — the audit failure that started this.
    // `/audit-boom/` is the stub's distinctive audit-error message, not a
    // fragment like `/no/` that ordinary prose ("not recorded", the bucket
    // name "onebook-backups") would also satisfy on its own.
    expect(message).toMatch(/audit-boom/);
  });

  it("names the bucket and path when the register row fails after the audit row already exists", async () => {
    // Upload succeeds, the audit row is written, and only then does the
    // acc_backup register insert fail — a transient PostgREST error on a
    // night whose books changed. Retention only ever reads acc_backup, so
    // that file is invisible to every future retention pass; the error text
    // is where a person looks first, and it must say the file and the audit
    // row exist while the register row does not.
    const { sb } = stub({ previousHash: undefined, registerFails: true });
    let caught: unknown;
    try {
      await takeCompanyBackup(sb, "company-1", "2026-08-16");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BackupError);
    const message = (caught as Error).message;
    expect(message).toContain(BACKUP_BUCKET);
    expect(message).toMatch(/company-1\/2026-08-16-[0-9a-f]{8}\.zip/);
    // Says plainly what does and does not exist, not just the raw DB error.
    expect(message).toMatch(/audit/i);
    expect(message).toMatch(/register-boom/);
  });
});

describe("retention", () => {
  it("does not delete the row for a snapshot whose blob could not be removed", async () => {
    // If the blob removal fails but the row is deleted anyway, the row —
    // the only record of that storage path — is gone forever, and no later
    // retention pass can ever find the orphaned blob again.
    //
    // Tonight's snapshot itself still stores fine here, so the call resolves
    // rather than rejects (see the "runs into trouble" describe block below)
    // — the trouble shows up as `retentionWarning` instead.
    const expiredPath = "company-1/2026-01-01-abc.zip";
    const { sb, deletedIds } = stub({
      previousHash: undefined,
      retentionRows: retentionFixture(1),
      removeFails: new Set([expiredPath]),
    });
    const result = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    expect(result.retentionWarning).toBeDefined();
    expect(deletedIds).not.toContain("id-0");
  });

  it("still removes the other expired snapshots when one blob removal fails", async () => {
    // Two expired snapshots; only the older one's blob removal fails. The
    // failure of one should not block cleanup of the other — see the
    // reasoning in applyRetention's comment.
    const failingPath = "company-1/2026-01-01-abc.zip";
    const { sb, removed, deletedIds } = stub({
      previousHash: undefined,
      retentionRows: retentionFixture(2),
      removeFails: new Set([failingPath]),
    });
    const result = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    expect(result.retentionWarning).toBeDefined();
    // Both removals were attempted...
    expect(removed).toContain("company-1/2026-01-01-abc.zip");
    expect(removed).toContain("company-1/2026-01-02-abc.zip");
    // ...but only the one that actually left the bucket had its row dropped.
    expect(deletedIds).not.toContain("id-0");
    expect(deletedIds).toContain("id-1");
  });

  it("names the stuck path in the retention warning instead of swallowing the failure", async () => {
    const { sb } = stub({
      previousHash: undefined,
      retentionRows: retentionFixture(1),
      removeFails: new Set(["company-1/2026-01-01-abc.zip"]),
    });
    const result = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    const message = result.retentionWarning;
    expect(message).toBeDefined();
    expect(message).toContain(BACKUP_BUCKET);
    expect(message).toContain("company-1/2026-01-01-abc.zip");
  });

  it("does not drop the earlier stuck path when a later row-delete also fails", async () => {
    // Deletion runs oldest-first. The oldest expired snapshot's blob removal
    // fails and is pushed to `stuck`; the next one's blob removes cleanly but
    // its row delete then errors, which throws immediately inside
    // applyRetention. That throw must not forget the first path just because
    // it was recorded earlier in the loop — otherwise the one nightly report
    // of "what's stuck" silently loses whatever failed before the row-delete
    // that ended the pass.
    const stuckPath = "company-1/2026-01-01-abc.zip"; // oldest, id-0
    const laterId = "id-1"; // next oldest, whose row-delete fails
    const { sb } = stub({
      previousHash: undefined,
      retentionRows: retentionFixture(2),
      removeFails: new Set([stuckPath]),
      deleteFails: new Set([laterId]),
    });
    const result = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    const message = result.retentionWarning;
    expect(message).toBeDefined();
    // The row-delete failure that actually threw.
    expect(message).toMatch(/simulated row-delete failure for id-1/);
    // The earlier stuck blob must still be named, not silently dropped.
    expect(message).toContain(stuckPath);
  });
});

describe("when retention runs into trouble after tonight's snapshot was already stored", () => {
  it("reports the trouble on the result instead of rejecting a call that succeeded", async () => {
    // Tonight's snapshot uploaded, was audited, and was registered — it is
    // stored. Retention afterwards gets stuck on an expired blob it cannot
    // remove. Rejecting here would tell a caller tonight's backup failed,
    // which did not happen; the cron route (next in line) would then record
    // a false failure for a night that in fact succeeded.
    const { sb } = stub({
      previousHash: undefined,
      retentionRows: retentionFixture(1),
      removeFails: true,
    });
    const result = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    expect(result.status).toBe("stored");
    expect(result.path).not.toBeNull();
    expect(result.retentionWarning).toBeDefined();
    expect(result.retentionWarning).toMatch(/could not be removed/i);
  });

  it("still logs the retention failure loudly instead of only setting a field nobody reads", async () => {
    // A caught error turned into a quiet return value is swallowing unless
    // it is also surfaced somewhere a human or monitor will see it. This
    // pins the log call so a future edit that drops it fails the suite,
    // rather than only being noticed the night the field goes unread.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sb } = stub({
      previousHash: undefined,
      retentionRows: retentionFixture(1),
      removeFails: true,
    });
    await takeCompanyBackup(sb, "company-1", "2026-08-16");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("a second run on the same night", () => {
  it("comes back as skipped rather than failed, the operator's own verification re-run", async () => {
    // The earlier fix claimed a re-run is harmless because of `upsert: true`
    // on the storage upload alone. That claim never covered the acc_backup
    // insert, which migration 0114 deliberately guards with
    // `unique (taken_at, content_hash)`. This uses a fake table that
    // enforces that same constraint for real, across two real calls against
    // one shared store, rather than an injected error flag — so it
    // reproduces the actual conflict a second same-night run hits.
    const rows: LiveRow[] = [];
    const sb = liveBackupClient(rows);

    const first = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    expect(first.status).toBe("stored");

    const second = await takeCompanyBackup(sb, "company-1", "2026-08-16");
    expect(second.status).toBe("skipped");
    expect(second.path).toBeNull();
  });
});

describe("a duplicate-key error on the skip insert", () => {
  it("is treated as tonight already being covered, not a failure", async () => {
    // shouldSkip only routes into the skip branch when the freshly computed
    // hash matches `previousHash`, so learn what hash this fixture actually
    // produces first — the same trick the "skips a night" test above uses —
    // rather than guessing a value that would fall through to the stored
    // branch and never exercise this insert at all.
    const learn = stub({ previousHash: undefined });
    const seen = await takeCompanyBackup(learn.sb, "company-1", "2026-08-16");

    const { sb } = stub({ previousHash: seen.hash, skipInsertConflicts: true });
    const result = await takeCompanyBackup(sb, "company-1", "2026-08-17");
    expect(result.status).toBe("skipped");
    expect(result.path).toBeNull();
  });

  it("still throws when the skip insert fails for a reason that is not a duplicate key", async () => {
    // The fix must check the error code, not swallow every skip-insert
    // failure outright — a real, unrelated failure here (permissions,
    // network) must still surface as a failed night.
    const learn = stub({ previousHash: undefined });
    const seen = await takeCompanyBackup(learn.sb, "company-1", "2026-08-16");

    const { sb } = stub({ previousHash: seen.hash, skipInsertFails: true });
    await expect(takeCompanyBackup(sb, "company-1", "2026-08-17")).rejects.toThrow(/skip-insert-boom/);
  });
});

describe("a duplicate-key error on the stored insert", () => {
  it("still throws, unlike the skip branch, because this run's own audit row already claims a backupId no acc_backup row will carry", async () => {
    // Deliberately not mirrored from the skip branch: by the time this
    // insert runs, takeCompanyBackup has already written a real,
    // non-idempotent acc_audit_log row under a freshly generated backupId.
    // A same-day duplicate here means another run raced this one and its
    // acc_backup row already exists — the content itself is safe (same path,
    // same bytes, the upload above is upsert: true) — but folding this into
    // a quiet "stored" would hide that this run's own audit row now names an
    // id no acc_backup row will ever carry. That mismatch belongs in front
    // of a human, so it stays an error.
    const { sb } = stub({ previousHash: undefined, registerInsertConflicts: true });
    let caught: unknown;
    try {
      await takeCompanyBackup(sb, "company-1", "2026-08-16");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BackupError);
    const message = (caught as Error).message;
    expect(message).toMatch(/already exists/i);
  });
});
