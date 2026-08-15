import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { takeCompanyBackup } from "@/lib/services/backup";

interface StubOptions {
  previousHash?: string | null;
  auditFails?: boolean;
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
  const sb = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: () => chain,
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
        delete: () => chain,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
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
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { sb, uploaded, removed, inserted };
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
});
