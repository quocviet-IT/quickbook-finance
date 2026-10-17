import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sectionOf } from "@/lib/domain/account-sections";
import { BANK_DETAIL_TYPES } from "@/lib/domain/bank-account-detail";
import { CHART_TEMPLATES, chartTemplateStatements } from "@/lib/domain/chart-templates";

const retail = CHART_TEMPLATES.retail_jewelry.accounts;
const byCode = new Map(retail.map((a) => [a.code, a]));

/**
 * Every account a migration seeds, with its type: `('1210', 'Undeposited Funds', 'current_asset'`.
 * A name may carry a doubled quote (`'Owner''s Equity'`). On 2026-10-17 this finds exactly the
 * 27 system codes the template marks `system: true`.
 */
function seeded(): Map<string, string> {
  const dir = join(process.cwd(), "supabase/migrations");
  const out = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    for (const m of readFileSync(join(dir, file), "utf8").matchAll(/'(\d{4})',\s*'(?:[^']|'')+',\s*'([a-z_]+)'/g)) {
      out.set(m[1], m[2]);
    }
  }
  return out;
}

describe("the Retail & Jewelry template", () => {
  it("has the 85 accounts of the approved table, each code once", () => {
    expect(retail.length).toBe(85);
    expect(byCode.size).toBe(85);
  });

  it("keeps every system account at its seeded code and type, and puts nothing else on a seeded code", () => {
    const seeds = seeded();
    expect(retail.filter((a) => a.system).length).toBe(27);
    for (const a of retail) {
      if (a.system) expect(seeds.get(a.code), a.code).toBe(a.type);
      else expect(seeds.has(a.code), a.code).toBe(false);
    }
  });

  it("gives every sub-account a parent in the template of the same type", () => {
    for (const a of retail.filter((r) => r.parent)) {
      expect(byCode.get(a.parent!)?.type, a.code).toBe(a.type);
    }
  });

  it("files each account in the section the client asked for", () => {
    for (const a of retail) {
      expect(sectionOf({ account_type: a.type, detail_type: a.detailType ?? null }), a.code).toBe(a.section);
    }
  });

  it("marks exactly the contra accounts", () => {
    expect(retail.filter((a) => a.contra).map((a) => a.code)).toEqual(["1190", "1590", "3300", "4900", "4910"]);
  });

  it("gives bank accounts a bank detail type", () => {
    for (const a of retail.filter((r) => r.type === "bank")) {
      expect((BANK_DETAIL_TYPES as readonly string[]).includes(a.detailType ?? ""), a.code).toBe(true);
    }
  });

  it("files the non-current liabilities as long-term", () => {
    expect(["2500", "2600", "2700", "2990"].map((c) => byCode.get(c)?.type)).toEqual(Array(4).fill("long_term_liability"));
  });
});

describe("chartTemplateStatements", () => {
  it("does nothing for the standard chart", () => {
    expect(chartTemplateStatements("standard")).toEqual([]);
  });

  it("upserts every account by code, then sets every parent by code", () => {
    const statements = chartTemplateStatements("retail_jewelry");
    const upserts = statements.filter((s) => /insert into acc_account/i.test(s.sql));
    const parents = statements.filter((s) => /set parent_account_id/i.test(s.sql));
    expect(upserts.length).toBe(85);
    expect(parents.length).toBe(retail.filter((a) => a.parent).length);
    expect(upserts[0].sql).toMatch(/on conflict \(account_code\) do update/i);
    expect(statements.indexOf(parents[0])).toBeGreaterThan(statements.indexOf(upserts[upserts.length - 1]));
  });

  it("never changes an existing account's type", () => {
    const upsert = chartTemplateStatements("retail_jewelry")[0].sql;
    const update = upsert.slice(upsert.search(/do update/i));
    expect(update).not.toMatch(/account_type\s*=/i);
  });

  it("starts Undeposited Funds and Transfer Clearing ticked as clearing accounts, and nothing else", () => {
    const ticked = retail.filter((a) => a.clearing).map((a) => a.code).sort();
    expect(ticked).toEqual(["1090", "1210"]);
    for (const a of retail.filter((x) => x.clearing)) {
      expect(["current_asset", "current_liability"], a.code).toContain(a.type);
    }
    const statements = chartTemplateStatements("retail_jewelry").filter((s) => /insert into acc_account/i.test(s.sql));
    const flags = new Map(statements.map((s) => [s.params[0], s.params[6]]));
    expect(flags.get("1210")).toBe(true);
    expect(flags.get("1090")).toBe(true);
    expect(flags.get("1100")).toBe(false);
    expect(statements[0].sql).toMatch(/is_clearing = excluded\.is_clearing or acc_account\.is_clearing/);
  });

  it("imports nothing that could write to the books, and only types from other modules", () => {
    const src = readFileSync("lib/domain/chart-templates.ts", "utf8");
    expect(src).not.toMatch(/@\/lib\/(db|services)\//);
    expect(src).not.toMatch(/^import (?!type )/m);
  });
});
