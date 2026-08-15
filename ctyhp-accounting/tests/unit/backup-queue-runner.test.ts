import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AutomationCompany } from "@/lib/domain/company-automation";
import { BACKUP_BATCH_LIMIT } from "@/lib/services/backup-queue";
import { runDueCompanyBackups } from "@/lib/services/backup-queue-runner";

/**
 * Task 4's `takeCompanyBackup` predates this queue and has no guard of its
 * own — a caller that hands it a signed-in session client would get a
 * snapshot of only what that person can read, silently. These tests exist
 * to pin the two things Task 4 changed under this task's feet: the result
 * now carries an optional `retentionWarning` that must not read as a failed
 * night, and the runner must default to the service-role automation client
 * rather than inventing a second way to build one.
 */

function company(id: string, slug: string, schemaName: string): AutomationCompany {
  return { id, slug, schemaName, legalName: slug };
}

/** A client that is nothing but the schema it was created for. */
function clientFor(schema: string) {
  return { schema } as unknown as SupabaseClient;
}
function schemaOf(sb: SupabaseClient): string {
  return (sb as unknown as { schema: string }).schema;
}

describe("runDueCompanyBackups", () => {
  it("reads every company's last snapshot date before choosing who tonight covers", async () => {
    const companies = [
      company("1", "a", "co_a"),
      company("2", "b", "co_b"),
      company("3", "c", "co_c"),
      company("4", "d", "co_d"),
    ];
    const lastBackupBySchema: Record<string, string | null> = {
      co_a: "2026-08-14",
      co_b: "2026-08-10", // longest waiting
      co_c: "2026-08-12",
      co_d: null, // never backed up — also belongs at the front
    };
    const attempted: string[] = [];

    const run = await runDueCompanyBackups({
      listCompanies: async () => companies,
      createClient: (schema) => clientFor(schema),
      readLastBackup: async (sb) => lastBackupBySchema[schemaOf(sb)],
      takeBackup: async (_sb, companyId) => {
        attempted.push(companyId);
        return { status: "stored", hash: `hash-${companyId}`, path: `p/${companyId}.zip`, sizeBytes: 10 };
      },
      today: "2026-08-15",
    });

    // "d" (never backed up) and "b" (oldest date) must be covered; the batch
    // limit is 3, so the third slot goes to "c" and "a" (most recent) waits.
    expect(attempted).toEqual(["4", "2", "3"]);
    expect(run.attempted).toBe(BACKUP_BATCH_LIMIT);
  });

  it("counts a stored night with a stuck retention pass as stored, not failed", async () => {
    // takeCompanyBackup's own contract: tonight's snapshot already succeeded
    // by the time retention runs, so a retention hiccup afterwards is a
    // caveat on a success, not a failed night. A queue that folded this into
    // `failed` would page someone for a problem that isn't tonight's backup.
    const run = await runDueCompanyBackups({
      listCompanies: async () => [company("1", "a", "co_a")],
      createClient: (schema) => clientFor(schema),
      readLastBackup: async () => null,
      takeBackup: async () => ({
        status: "stored",
        hash: "h",
        path: "p",
        sizeBytes: 1,
        retentionWarning: "3 expired backup file(s) could not be removed",
      }),
      today: "2026-08-15",
    });

    expect(run.failed).toBe(0);
    expect(run.stored).toBe(1);
    expect(run.results[0]).toMatchObject({
      ok: true,
      status: "stored",
      retentionWarning: "3 expired backup file(s) could not be removed",
    });
  });

  it("keeps one company's takeCompanyBackup failure from stopping or hiding the others", async () => {
    const companies = [company("1", "a", "co_a"), company("2", "b", "co_b")];
    const run = await runDueCompanyBackups({
      listCompanies: async () => companies,
      createClient: (schema) => clientFor(schema),
      readLastBackup: async () => null,
      takeBackup: async (_sb, companyId) => {
        if (companyId === "1") throw new Error("storage unreachable");
        return { status: "stored", hash: "h", path: "p", sizeBytes: 1 };
      },
      today: "2026-08-15",
    });

    expect(run.failed).toBe(1);
    expect(run.stored).toBe(1);
    expect(run.results).toContainEqual({ slug: "a", ok: false, error: "storage unreachable" });
    expect(run.results.find((r) => r.slug === "b")).toMatchObject({ ok: true, status: "stored" });
  });

  it("records a company whose last-snapshot date could not be read as failed, without blocking the rest", async () => {
    const companies = [
      company("1", "broken", "co_broken"),
      company("2", "old", "co_old"),
      company("3", "newer", "co_newer"),
    ];
    const attempted: string[] = [];
    const run = await runDueCompanyBackups({
      listCompanies: async () => companies,
      createClient: (schema) => clientFor(schema),
      readLastBackup: async (sb) => {
        if (schemaOf(sb) === "co_broken") throw new Error("permission denied for table acc_backup");
        return schemaOf(sb) === "co_old" ? "2026-08-01" : "2026-08-10";
      },
      takeBackup: async (_sb, companyId) => {
        attempted.push(companyId);
        return { status: "stored", hash: "h", path: "p", sizeBytes: 1 };
      },
      today: "2026-08-15",
    });

    expect(run.results).toContainEqual({
      slug: "broken",
      ok: false,
      error: "permission denied for table acc_backup",
    });
    // The unreadable company never reaches takeCompanyBackup at all...
    expect(attempted).not.toContain("1");
    // ...but the two readable companies still get ranked and attempted.
    expect(attempted).toEqual(["2", "3"]);
    expect(run.failed).toBe(1);
    expect(run.attempted).toBe(2);
  });

  it("never attempts more than BACKUP_BATCH_LIMIT even when every company is due", async () => {
    const companies = Array.from({ length: 10 }, (_, i) => company(`${i}`, `c${i}`, `co_${i}`));
    const attempted: string[] = [];
    const run = await runDueCompanyBackups({
      listCompanies: async () => companies,
      createClient: (schema) => clientFor(schema),
      readLastBackup: async () => null,
      takeBackup: async (_sb, companyId) => {
        attempted.push(companyId);
        return { status: "stored", hash: "h", path: "p", sizeBytes: 1 };
      },
      today: "2026-08-15",
    });

    expect(attempted).toHaveLength(BACKUP_BATCH_LIMIT);
    expect(run.attempted).toBe(BACKUP_BATCH_LIMIT);
  });

  it("fails the whole run when the company register itself cannot be read", async () => {
    // Same principle as the other automation jobs: without a trustworthy
    // register, a run that quietly covered nobody would look identical to a
    // quiet, uneventful night. It has to fail loudly instead.
    await expect(
      runDueCompanyBackups({
        listCompanies: async () => {
          throw new Error("Company register unavailable: permission denied");
        },
        createClient: (schema) => clientFor(schema),
        readLastBackup: async () => null,
        takeBackup: async () => ({ status: "stored", hash: "h", path: "p", sizeBytes: 1 }),
      }),
    ).rejects.toThrow(/register unavailable/i);
  });
});

describe("wiring", () => {
  it("defaults to the service-role automation client, never a session client", () => {
    // A cron tick has no signed-in session to carry a permission check for.
    // Handed a session client instead, takeCompanyBackup would silently
    // snapshot only what that person can read — a short backup that still
    // looks perfectly valid. This pins the default to the one client every
    // other background job already uses, so a future edit that swaps it out
    // for something session-scoped fails the suite instead of shipping.
    const source = readFileSync(
      join(process.cwd(), "lib/services/backup-queue-runner.ts"),
      "utf8",
    );
    expect(source).toContain(
      'import { createSupabaseAutomationClient, listActiveAutomationCompanies } from "@/lib/db/automation"',
    );
    expect(source).not.toMatch(/createSupabaseServerClient/);
  });
});

describe("app/api/backups/run/route.ts", () => {
  it("reuses the timing-safe authorization block and delegates the run", () => {
    const source = readFileSync(join(process.cwd(), "app/api/backups/run/route.ts"), "utf8");
    expect(source).toContain("timingSafeEqual");
    expect(source).toContain(
      'import { runDueCompanyBackups } from "@/lib/services/backup-queue-runner"',
    );
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("export const maxDuration = 300");
    // The route owns authorization and the HTTP shape only — no per-item work
    // or service-role client of its own.
    expect(source).not.toContain("for (const");
    expect(source).not.toContain("createSupabaseAutomationClient");
  });
});
