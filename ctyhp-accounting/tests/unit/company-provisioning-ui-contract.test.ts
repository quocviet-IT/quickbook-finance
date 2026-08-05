import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("company provisioning route", () => {
  const route = read("app", "api", "companies", "provision", "route.ts");

  it("is gated by the same secret as the other background work", () => {
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).toContain("export const maxDuration = 300");
  });

  it("delegates to the queue rather than provisioning itself", () => {
    expect(route).toContain("runPendingCompanyProvisioning");
    expect(route).not.toContain("create schema");
  });
});

describe("deployment carries the migration files", () => {
  it("traces supabase/migrations into the provisioning function", () => {
    const config = read("next.config.ts");
    expect(config).toContain("outputFileTracingIncludes");
    expect(config).toContain("/api/companies/provision");
    expect(config).toContain("./supabase/migrations/**");
  });

  it("keeps a scheduled sweep for anything left pending", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.some((cron) => cron.path === "/api/companies/provision")).toBe(true);
  });
});
