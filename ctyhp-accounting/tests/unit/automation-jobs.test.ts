import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  runBankFeedAutomationJob,
  runDocumentScanAutomationJob,
  runRecurringAutomationJob,
} from "@/lib/services/automation-jobs";
import type { AutomationCompany } from "@/lib/domain/company-automation";

const COMPANIES: AutomationCompany[] = [
  { id: "id-1", slug: "ctyhp", schemaName: "public", legalName: "CTYHP" },
  { id: "id-2", slug: "aurora", schemaName: "co_aurora", legalName: "Aurora Ltd" },
];

/** A client that is nothing but the schema it was created for. */
function clientFor(schema: string) {
  return { schema } as unknown as SupabaseClient;
}
function schemaOf(sb: SupabaseClient): string {
  return (sb as unknown as { schema: string }).schema;
}

function rows(schema: string, count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({ id: `${schema}-${prefix}-${i}` }));
}

describe("runBankFeedAutomationJob", () => {
  it("gives every company its own connection quota", async () => {
    const createClient = vi.fn((schema: string) => clientFor(schema));
    const synced: string[] = [];

    const job = await runBankFeedAutomationJob({
      listCompanies: async () => COMPANIES,
      createClient,
      listConnections: async (sb) =>
        rows(schemaOf(sb), 25, "conn").map((row) => ({
          ...row,
          institution_name: `Bank of ${schemaOf(sb)}`,
          status: "connected",
        })),
      syncConnection: async (sb, connectionId) => {
        synced.push(connectionId);
        return { added: 1, modified: 0, removed: 0, suggestions: 1 };
      },
    });

    expect(createClient.mock.calls.map((call) => call[0])).toEqual(["public", "co_aurora"]);
    expect(synced.filter((id) => id.startsWith("public-")).length).toBe(20);
    expect(synced.filter((id) => id.startsWith("co_aurora-")).length).toBe(20);
    expect(job.companyCount).toBe(2);
    expect(job.connectionCount).toBe(40);
    expect(job.companies.map((row) => row.company.slug)).toEqual(["ctyhp", "aurora"]);
    const first = job.companies[0];
    expect(first.ok && first.result.results.every((item) => item.ok)).toBe(true);
  });

  it("skips a disconnected connection and reports a failing one", async () => {
    const job = await runBankFeedAutomationJob({
      listCompanies: async () => [COMPANIES[0]],
      createClient: (schema) => clientFor(schema),
      listConnections: async () => [
        { id: "live", institution_name: "Live Bank", status: "connected" },
        { id: "gone", institution_name: "Old Bank", status: "disconnected" },
        { id: "broken", institution_name: "Flaky Bank", status: "connected" },
      ],
      syncConnection: async (_sb, connectionId) => {
        if (connectionId === "broken") throw new Error("provider timed out");
        return { added: 0, modified: 0, removed: 0, suggestions: 0 };
      },
    });

    expect(job.connectionCount).toBe(2);
    const company = job.companies[0];
    if (!company.ok) throw new Error("company should not have failed");
    expect(company.result.results).toEqual([
      { connectionId: "live", institution: "Live Bank", ok: true, added: 0, modified: 0, removed: 0, suggestions: 0 },
      { connectionId: "broken", institution: "Flaky Bank", ok: false, error: "provider timed out" },
    ]);
  });

  it("fails the whole job when the register cannot be read", async () => {
    await expect(
      runBankFeedAutomationJob({
        listCompanies: async () => {
          throw new Error("Company register unavailable: permission denied");
        },
        createClient: (schema) => clientFor(schema),
        listConnections: async () => [],
        syncConnection: async () => ({ added: 0, modified: 0, removed: 0, suggestions: 0 }),
      }),
    ).rejects.toThrow(/register unavailable/i);
  });

  it("keeps one company's failure from stopping another", async () => {
    const job = await runBankFeedAutomationJob({
      listCompanies: async () => COMPANIES,
      createClient: (schema) => clientFor(schema),
      listConnections: async (sb) => {
        if (schemaOf(sb) === "public") throw new Error("connections unreadable");
        return [{ id: "ok", institution_name: "Aurora Bank", status: "connected" }];
      },
      syncConnection: async () => ({ added: 2, modified: 0, removed: 0, suggestions: 0 }),
    });

    expect(job.companies[0]).toMatchObject({ ok: false, error: "connections unreadable" });
    expect(job.companies[1].ok).toBe(true);
    expect(job.connectionCount).toBe(1);
    expect(job.failedCompanyCount).toBe(1);
  });
});

describe("runDocumentScanAutomationJob", () => {
  it("gives every company its own attachment quota", async () => {
    const createClient = vi.fn((schema: string) => clientFor(schema));
    const scanned: string[] = [];

    const job = await runDocumentScanAutomationJob({
      listCompanies: async () => COMPANIES,
      createClient,
      listAwaitingScan: async (sb, limit) =>
        rows(schemaOf(sb), 25, "doc")
          .slice(0, limit)
          .map((row) => ({ ...row, file_name: `${row.id}.pdf` })),
      scanAttachment: async (_sb, attachmentId) => {
        scanned.push(attachmentId);
        return { scan_status: "clean", scan_error: null };
      },
    });

    expect(createClient.mock.calls.map((call) => call[0])).toEqual(["public", "co_aurora"]);
    expect(scanned.filter((id) => id.startsWith("public-")).length).toBe(20);
    expect(scanned.filter((id) => id.startsWith("co_aurora-")).length).toBe(20);
    expect(job.companyCount).toBe(2);
    expect(job.attachmentCount).toBe(40);
  });

  it("reports a blocked scan as handled and a thrown scan as failed", async () => {
    const job = await runDocumentScanAutomationJob({
      listCompanies: async () => [COMPANIES[1]],
      createClient: (schema) => clientFor(schema),
      listAwaitingScan: async () => [
        { id: "a", file_name: "invoice.pdf" },
        { id: "b", file_name: "virus.pdf" },
        { id: "c", file_name: "broken.pdf" },
      ],
      scanAttachment: async (_sb, attachmentId) => {
        if (attachmentId === "b") return { scan_status: "blocked", scan_error: "EICAR-Test" };
        if (attachmentId === "c") throw new Error("scanner unreachable");
        return { scan_status: "clean", scan_error: null };
      },
    });

    const company = job.companies[0];
    if (!company.ok) throw new Error("company should not have failed");
    expect(company.result.results).toEqual([
      { attachmentId: "a", fileName: "invoice.pdf", status: "clean", ok: true, error: undefined },
      { attachmentId: "b", fileName: "virus.pdf", status: "blocked", ok: true, error: "EICAR-Test" },
      { attachmentId: "c", fileName: "broken.pdf", ok: false, error: "scanner unreachable" },
    ]);
  });
});

describe("runRecurringAutomationJob", () => {
  function template(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      name: `Template ${id}`,
      start_date: "2026-01-01",
      next_run_date: "2026-01-01",
      end_date: null as string | null,
      frequency: "monthly" as const,
      interval_count: 1,
      ...overrides,
    };
  }

  it("resets the occurrence budget for every company", async () => {
    const generated: string[] = [];
    // Ten weekly templates per company, each able to claim its 12-occurrence
    // cap: 120 possible, so the company cap of 100 is what has to bite.
    const templates = Array.from({ length: 10 }, (_, i) =>
      template(`t${i}`, { frequency: "weekly", interval_count: 1 }),
    );

    const job = await runRecurringAutomationJob("2027-01-01", {
      listCompanies: async () => COMPANIES,
      createClient: (schema) => clientFor(schema),
      listDueTemplates: async (sb) =>
        templates.map((row) => ({ ...row, id: `${schemaOf(sb)}-${row.id}` })),
      generateTemplate: async (sb, templateId) => {
        generated.push(templateId);
        return { runId: `run-${generated.length}`, status: "posted", documentId: "doc", claimed: true };
      },
    });

    expect(generated.filter((id) => id.startsWith("public-")).length).toBe(100);
    expect(generated.filter((id) => id.startsWith("co_aurora-")).length).toBe(100);
    expect(job.companyCount).toBe(2);
    expect(job.scheduleCount).toBe(20);
    expect(job.asOf).toBe("2027-01-01");
  });

  it("caps a single template at twelve occurrences and honours its end date", async () => {
    const job = await runRecurringAutomationJob("2027-01-01", {
      listCompanies: async () => [COMPANIES[0]],
      createClient: (schema) => clientFor(schema),
      listDueTemplates: async () => [
        template("weekly", { frequency: "weekly", interval_count: 1 }),
        template("ends", { frequency: "monthly", end_date: "2026-03-31" }),
      ],
      generateTemplate: async () => ({
        runId: "run",
        status: "posted",
        documentId: "doc",
        claimed: true,
      }),
    });

    const company = job.companies[0];
    if (!company.ok) throw new Error("company should not have failed");
    const perTemplate = company.result.results.reduce<Record<string, number>>((acc, row) => {
      acc[row.templateId] = (acc[row.templateId] ?? 0) + 1;
      return acc;
    }, {});
    expect(perTemplate.weekly).toBe(12);
    expect(perTemplate.ends).toBe(3);
  });

  it("stops a template on its first error and leaves the other company running", async () => {
    const job = await runRecurringAutomationJob("2026-02-01", {
      listCompanies: async () => COMPANIES,
      createClient: (schema) => clientFor(schema),
      listDueTemplates: async (sb) => {
        if (schemaOf(sb) === "public") throw new Error("templates unreadable");
        return [template("t1"), template("t2")];
      },
      generateTemplate: async (_sb, templateId) => {
        if (templateId === "t1") throw new Error("period is closed");
        return { runId: "run", status: "posted", documentId: null, claimed: false };
      },
    });

    expect(job.companies[0]).toMatchObject({ ok: false, error: "templates unreadable" });
    const aurora = job.companies[1];
    if (!aurora.ok) throw new Error("aurora should not have failed");
    expect(aurora.result.results).toEqual([
      {
        templateId: "t1",
        name: "Template t1",
        scheduledDate: "2026-01-01",
        ok: false,
        error: "period is closed",
      },
      {
        templateId: "t2",
        name: "Template t2",
        scheduledDate: "2026-01-01",
        ok: true,
        status: "posted",
        documentId: null,
      },
    ]);
    expect(job.failedCompanyCount).toBe(1);
  });
});

describe("cron route contracts", () => {
  const ROUTES = [
    { file: "app/api/bank-feeds/sync/route.ts", job: "runBankFeedAutomationJob" },
    { file: "app/api/recurring/run/route.ts", job: "runRecurringAutomationJob" },
    { file: "app/api/documents/scan/route.ts", job: "runDocumentScanAutomationJob" },
  ];

  it.each(ROUTES)("$file delegates its work to $job", ({ file, job }) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");

    expect(source).toContain(`import { ${job} } from "@/lib/services/automation-jobs"`);
    // The route keeps the secret check and the runtime configuration...
    expect(source).toContain("timingSafeEqual");
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("export const maxDuration = 300");
    // ...and stops owning per-item work or the service-role client.
    expect(source).not.toContain("for (const");
    expect(source).not.toContain("createSupabaseAutomationClient");
  });

  it.each(ROUTES)("$file reports how many companies ran", ({ file }) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toMatch(/\.\.\.(job|result)\b/);
  });
});
