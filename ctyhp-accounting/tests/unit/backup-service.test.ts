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
  /**
   * Which storage paths should fail to `remove()`. `true` fails every
   * removal call regardless of path — enough for tests that only ever
   * trigger one. A `Set` fails only the named paths, so a retention pass
   * touching several snapshots can fail one and succeed on the rest.
   */
  removeFails?: true | Set<string>;
  /** Rows `applyRetention`'s `status = stored` query hands back. */
  retentionRows?: RetentionRow[];
}

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
          return Promise.resolve({
            error: table === "acc_audit_log" && options.auditFails ? { message: "no" } : null,
          });
        },
        // `applyRetention`'s `delete().eq("id", ...)` is its own chain, not
        // the generic `then` below, so the id it targets can be recorded —
        // the retention tests assert on exactly which rows survive.
        delete: () => ({
          eq: (column: string, value: unknown) => {
            if (table === "acc_backup" && column === "id") deletedIds.push(String(value));
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
    expect(message).toMatch(/no/);
  });
});

describe("retention", () => {
  it("does not delete the row for a snapshot whose blob could not be removed", async () => {
    // If the blob removal fails but the row is deleted anyway, the row —
    // the only record of that storage path — is gone forever, and no later
    // retention pass can ever find the orphaned blob again.
    const expiredPath = "company-1/2026-01-01-abc.zip";
    const { sb, deletedIds } = stub({
      previousHash: undefined,
      retentionRows: retentionFixture(1),
      removeFails: new Set([expiredPath]),
    });
    await expect(takeCompanyBackup(sb, "company-1", "2026-08-16")).rejects.toThrow(BackupError);
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
    await expect(takeCompanyBackup(sb, "company-1", "2026-08-16")).rejects.toThrow(BackupError);
    // Both removals were attempted...
    expect(removed).toContain("company-1/2026-01-01-abc.zip");
    expect(removed).toContain("company-1/2026-01-02-abc.zip");
    // ...but only the one that actually left the bucket had its row dropped.
    expect(deletedIds).not.toContain("id-0");
    expect(deletedIds).toContain("id-1");
  });

  it("names the stuck path in the error instead of swallowing the failure", async () => {
    const { sb } = stub({
      previousHash: undefined,
      retentionRows: retentionFixture(1),
      removeFails: new Set(["company-1/2026-01-01-abc.zip"]),
    });
    let caught: unknown;
    try {
      await takeCompanyBackup(sb, "company-1", "2026-08-16");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BackupError);
    const message = (caught as Error).message;
    expect(message).toContain(BACKUP_BUCKET);
    expect(message).toContain("company-1/2026-01-01-abc.zip");
  });
});
