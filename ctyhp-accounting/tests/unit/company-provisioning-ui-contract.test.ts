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

describe("the companies screen", () => {
  const route = ["app", "(app)", "settings", "companies"];

  it("keeps the form and the list in their own components", () => {
    const page = read(...route, "page.tsx");
    expect(page).toContain("isPlatformAdmin");
    expect(page).toContain("export const maxDuration = 300");
    const client = read(...route, "CompaniesClient.tsx");
    expect(client).toContain("<NewCompanyModal");
    expect(client).toContain("getCompanyRequestAction");
    expect(client).toContain("retryCompanyRequestAction");
    expect(read(...route, "NewCompanyModal.tsx")).toContain("requestCompanyAction");
    expect(read(...route, "NewCompanyModal.tsx")).toContain("companySlugFromName");
  });

  it("offers the button where a company is chosen, and only to those who may", () => {
    const switcher = read("components", "CompanySwitcher.tsx");
    expect(switcher).toContain("canCreateCompany");
    expect(switcher).toContain("New company");
    expect(switcher).toContain("/settings/companies?new=1");
    expect(read("components", "AppShell.tsx")).toContain("canCreateCompany");
    expect(read("app", "(app)", "layout.tsx")).toContain("isPlatformAdmin");
  });

  it("keeps every new file below the 400-line ceiling", () => {
    for (const file of ["page.tsx", "CompaniesClient.tsx", "NewCompanyModal.tsx"]) {
      expect(read(...route, file).split(/\r?\n/).length, file).toBeLessThanOrEqual(400);
    }
  });
});
