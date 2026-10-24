import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, RELEASES } from "@/lib/domain/changelog";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

describe("a new company's settings (2.49)", () => {
  it("are written when the company is provisioned, under the name it was created with", () => {
    const src = read("lib/services/company-provisioning.ts");
    expect(src).toContain("insert into ${schema}.acc_company_setting_version (version, legal_name) values (1, $1)");
    expect(src).toMatch(/\[input\.legalName\],/);
    // Inside the same transaction as the schema, after the chart: a company that cannot be given its settings is not left behind.
    const settingsInsert = src.indexOf("insert into ${schema}.acc_company_setting_version");
    expect(settingsInsert).toBeGreaterThan(src.indexOf("for (const statement of chartTemplateStatements(template.key))"));
    expect(settingsInsert).toBeLessThan(src.indexOf("`insert into onebook.company (slug, schema_name"));
  });

  it("are checked by the provisioning self-check", () => {
    const src = read("scripts/verify-company-provisioning.mjs");
    expect(src).toContain('"it has its company settings, named as it was created"');
  });
});

describe("the Beancount export before company settings are saved", () => {
  it("is titled from the company list, and the page says so", () => {
    const actions = read("app/(app)/accounting/beancount/actions.ts");
    expect(actions.match(/readBeancountInput\(sb, .*await registerName\(\)\)/g)).toHaveLength(2);
    const page = read("app/(app)/accounting/beancount/page.tsx");
    expect(page).toContain("settingsSaved={company !== null}");
    expect(page).toContain("company?.legal_name ?? entity.active?.legalName ?? displayName");
    const client = read("app/(app)/accounting/beancount/BeancountClient.tsx");
    expect(client).toContain('title="Company settings have never been saved"');
    expect(client).toContain('<Link href="/settings/company">Settings › Company</Link>');
  });
});

describe("the 2.49 release in the release notes", () => {
  const release = RELEASES.find((r) => r.version === "2.49")!;
  const said = release.changes.map((c) => `${c.title} ${c.detail ?? ""}`).join(" ");

  it("is listed, dated the day it was built, and newer releases sit above it", () => {
    expect(release).toBeDefined();
    expect(Number(APP_VERSION)).toBeGreaterThanOrEqual(2.49);
    expect(release.date).toBe("2026-10-24");
  });

  it("says what a new company starts with and what the export does without settings", () => {
    for (const words of [
      "Creating a company now also saves its company settings",
      "US dollars, January, the accrual basis and the default time zone",
      "no longer says the ledger could not be read",
      "takes its title from the company list",
    ]) {
      expect(said).toContain(words);
    }
  });
});
