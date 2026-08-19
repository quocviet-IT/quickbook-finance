import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Only the one behavioural "wiring" test below touches these — every other
// test in this file injects both `listCompanies` and `createClient`
// explicitly and never reaches the real default, so it never sees these
// mocks either.
const automationMocks = vi.hoisted(() => ({
  createSupabaseAutomationClient: vi.fn(),
  listActiveAutomationCompanies: vi.fn(),
}));
vi.mock("@/lib/db/automation", () => automationMocks);

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

  it("still logs which company's last-snapshot read failed, not only the run result", async () => {
    // The review of the previous commit found this exact failure invisible:
    // `run.results` already names the company, but nothing before this line
    // ever read that field — no screen, no persisted row, no log. A caught
    // error turned into a quiet return value is swallowing unless it also
    // reaches a human somewhere, so this pins the log call and that it names
    // the company, not just that a company somewhere failed.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const companies = [company("1", "brokenreader", "co_brokenreader"), company("2", "ok", "co_ok")];
    await runDueCompanyBackups({
      listCompanies: async () => companies,
      createClient: (schema) => clientFor(schema),
      readLastBackup: async (sb) => {
        if (schemaOf(sb) === "co_brokenreader") throw new Error("permission denied for table acc_backup");
        return null;
      },
      takeBackup: async () => ({ status: "stored", hash: "h", path: "p", sizeBytes: 1 }),
      today: "2026-08-15",
    });
    const logged = consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("brokenreader");
    expect(logged).toContain("permission denied for table acc_backup");
    consoleError.mockRestore();
  });

  it("still logs which company's takeCompanyBackup call failed, not only the run result", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const companies = [company("1", "failingwriter", "co_failingwriter"), company("2", "ok", "co_ok")];
    await runDueCompanyBackups({
      listCompanies: async () => companies,
      createClient: (schema) => clientFor(schema),
      readLastBackup: async () => null,
      takeBackup: async (_sb, companyId) => {
        if (companyId === "1") throw new Error("storage unreachable");
        return { status: "stored", hash: "h", path: "p", sizeBytes: 1 };
      },
      today: "2026-08-15",
    });
    const logged = consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("failingwriter");
    expect(logged).toContain("storage unreachable");
    consoleError.mockRestore();
  });

  it("also logs a run-level summary when any company failed, once per failure plus one for the run", async () => {
    // Per-company lines alone still require someone to already be grepping
    // for them. This second line is what a run-level reader (or an
    // alert rule keyed on this job's log output) can key off directly,
    // and it is the same count the route below turns into a non-200 status.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
    // One call for the failed company itself, one more for the run as a whole.
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("does not log a run-level summary on a night nothing failed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = await runDueCompanyBackups({
      listCompanies: async () => [company("1", "a", "co_a")],
      createClient: (schema) => clientFor(schema),
      readLastBackup: async () => null,
      takeBackup: async () => ({ status: "stored", hash: "h", path: "p", sizeBytes: 1 }),
      today: "2026-08-15",
    });
    expect(run.failed).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
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

  it("actually calls the automation-client factory for each company schema when no client is injected", async () => {
    // The assertion above is textual: it would still pass if `createClient`
    // stopped defaulting to `createSupabaseAutomationClient` and called
    // something built inline instead, so long as the import line stayed in
    // the file for some unrelated reason. This drives the real default path
    // — no `createClient` or `listCompanies` in deps — and checks the one
    // thing that actually matters: the imported factory is what gets called,
    // once per company schema, not a stand-in for it.
    automationMocks.listActiveAutomationCompanies
      .mockReset()
      .mockResolvedValue([company("1", "a", "co_a"), company("2", "b", "co_b")]);
    automationMocks.createSupabaseAutomationClient
      .mockReset()
      .mockImplementation((schema: string) => clientFor(schema));

    await runDueCompanyBackups({
      readLastBackup: async () => null,
      takeBackup: async () => ({ status: "stored", hash: "h", path: "p", sizeBytes: 1 }),
      today: "2026-08-15",
    });

    expect(automationMocks.listActiveAutomationCompanies).toHaveBeenCalled();
    expect(automationMocks.createSupabaseAutomationClient).toHaveBeenCalledWith("co_a");
    expect(automationMocks.createSupabaseAutomationClient).toHaveBeenCalledWith("co_b");
  });

  it("hands takeBackup the exact client the automation factory built for that company's write, not merely a same-shaped one", async () => {
    // The read phase (readLastBackup, used to rank who is due) already calls
    // the factory for every company on its own — so a `toHaveBeenCalledWith`
    // assertion on the factory alone, like the test above, is satisfied by
    // that read-phase call and says nothing about what `takeBackup` itself
    // is handed. An edit that kept the read phase wired to the factory while
    // building a differently-sourced client for the write call — same
    // `{schema}` shape, wrong origin — would still pass every assertion
    // above. This instead captures the object `takeBackup` actually receives
    // and checks it is the exact instance the factory returned for that
    // write, by reference, not merely one that looks like it.
    automationMocks.listActiveAutomationCompanies
      .mockReset()
      .mockResolvedValue([company("1", "a", "co_a"), company("2", "b", "co_b")]);
    const builtByFactory: Record<string, SupabaseClient> = {};
    automationMocks.createSupabaseAutomationClient.mockReset().mockImplementation((schema: string) => {
      const client = clientFor(schema);
      // Called once per company for the read phase, then again per due
      // company for the write phase — the later call is the one that
      // matters here, and it overwrites the earlier one before takeBackup
      // for that company ever runs (the loop below is sequential).
      builtByFactory[schema] = client;
      return client;
    });
    const receivedByTakeBackup: Record<string, SupabaseClient> = {};

    await runDueCompanyBackups({
      readLastBackup: async () => null,
      takeBackup: async (sb, companyId) => {
        const schema = companyId === "1" ? "co_a" : "co_b";
        receivedByTakeBackup[schema] = sb;
        return { status: "stored", hash: "h", path: "p", sizeBytes: 1 };
      },
      today: "2026-08-15",
    });

    expect(receivedByTakeBackup.co_a).toBe(builtByFactory.co_a);
    expect(receivedByTakeBackup.co_b).toBe(builtByFactory.co_b);
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

  afterEach(() => {
    vi.doUnmock("@/lib/services/backup-queue-runner");
    vi.resetModules();
    delete process.env.CRON_SECRET;
  });

  it("answers with a non-200 status when the run reports a failed company, since Vercel's cron log keeps only the status code and discards the body", async () => {
    const secret = "a".repeat(32);
    process.env.CRON_SECRET = secret;
    vi.resetModules();
    vi.doMock("@/lib/services/backup-queue-runner", () => ({
      runDueCompanyBackups: vi.fn(async () => ({
        attempted: 2,
        stored: 1,
        skipped: 0,
        failed: 1,
        results: [
          { slug: "a", ok: true, status: "stored" },
          { slug: "b", ok: false, error: "storage unreachable" },
        ],
      })),
    }));

    const { POST } = await import("@/app/api/backups/run/route");
    const response = await POST(
      new Request("http://localhost/api/backups/run", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );

    expect(response.status).not.toBe(200);
    const body = await response.json();
    expect(body.failed).toBe(1);
  });

  it("answers 200 when the run reports no failures", async () => {
    const secret = "b".repeat(32);
    process.env.CRON_SECRET = secret;
    vi.resetModules();
    vi.doMock("@/lib/services/backup-queue-runner", () => ({
      runDueCompanyBackups: vi.fn(async () => ({
        attempted: 1,
        stored: 1,
        skipped: 0,
        failed: 0,
        results: [{ slug: "a", ok: true, status: "stored" }],
      })),
    }));

    const { POST } = await import("@/app/api/backups/run/route");
    const response = await POST(
      new Request("http://localhost/api/backups/run", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("logs before answering 500 when the run itself throws, so an empty Vercel function log does not read as a per-company failure that got lost", async () => {
    // Vercel's cron log keeps path, status and duration and discards the
    // body — the same fact the run's own non-200 status exists to work
    // around. Without a console.error here, a register-read failure (every
    // company skipped, nothing attempted) is indistinguishable in the log
    // from a per-company failure that was logged and lost some other way;
    // an operator can only tell them apart by re-invoking the endpoint by
    // hand with CRON_SECRET in hand.
    const secret = "c".repeat(32);
    process.env.CRON_SECRET = secret;
    vi.resetModules();
    vi.doMock("@/lib/services/backup-queue-runner", () => ({
      runDueCompanyBackups: vi.fn(async () => {
        throw new Error("Company register unavailable: permission denied");
      }),
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("@/app/api/backups/run/route");
    const response = await POST(
      new Request("http://localhost/api/backups/run", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );

    expect(response.status).toBe(500);
    const logged = consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("Company register unavailable: permission denied");
    consoleError.mockRestore();
  });
});
