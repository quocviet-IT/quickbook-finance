import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const FILE = "0171_master_data_read_only.sql";
const strip = (sql: string) => sql.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
const code = strip(readFileSync(join(DIR, FILE), "utf8"));

/** Read off the live database on 2026-10-26, the same in all seven schemas. */
const WRITE_POLICIES: [string, string][] = [
  ["acc_account", "acc_account_write"],
  ["acc_bank_account", "acc_bank_account_write"],
  ["acc_bank_rule", "acc_bank_rule_del"],
  ["acc_bank_rule", "acc_bank_rule_ins"],
  ["acc_bank_rule", "acc_bank_rule_upd"],
  ["acc_banking_preference", "acc_banking_preference_ins"],
  ["acc_banking_preference", "acc_banking_preference_upd"],
  ["acc_customer", "acc_customer_write"],
  ["acc_item", "acc_item_write"],
  ["acc_recurring_template", "acc_recurring_template_insert"],
  ["acc_recurring_template", "acc_recurring_template_update"],
  ["acc_related_company", "acc_related_company_del"],
  ["acc_related_company", "acc_related_company_ins"],
  ["acc_related_company", "acc_related_company_upd"],
  ["acc_repayment_account", "acc_repayment_account_del"],
  ["acc_repayment_account", "acc_repayment_account_ins"],
  ["acc_repayment_account", "acc_repayment_account_upd"],
  ["acc_tax_code", "acc_tax_code_admin"],
  ["acc_vendor", "acc_vendor_write"],
];
const TABLES = [...new Set(WRITE_POLICIES.map(([t]) => t))];

describe("0171_master_data_read_only", () => {
  it("starts with the schema search path, so it runs in every company", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("drops all nineteen write policies on the eleven tables, and no read policy", () => {
    expect(TABLES).toHaveLength(11);
    for (const [table, policy] of WRITE_POLICIES) {
      expect(code, `${policy} on ${table}`).toMatch(new RegExp(`drop policy if exists ${policy} on ${table};`));
    }
    expect(code.match(/drop policy if exists/g)).toHaveLength(19);
    expect(code).not.toMatch(/drop policy if exists \w*(_read|_sel|_select)\b/);
  });

  it("revokes writing on all eleven from a session, and keeps reading", () => {
    const listed = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean).sort();
    const revoke = code.match(/revoke insert, update, delete, truncate on([\s\S]*?)from authenticated, anon;/);
    const grant = code.match(/grant select on([\s\S]*?)to authenticated;/);
    expect(listed(revoke![1])).toEqual([...TABLES].sort());
    expect(listed(grant![1])).toEqual([...TABLES].sort());
  });

  it("creates nothing and changes no row", () => {
    expect(code).not.toMatch(/create (policy|table|function|or replace)/i);
    expect(code).not.toMatch(/insert into|update acc_|delete from/i);
  });

  it("is not undone: no later migration gives a session a write policy or grant on these tables", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql") && f > FILE)) {
      const sql = strip(readFileSync(join(DIR, file), "utf8"));
      for (const m of sql.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(all|insert|update|delete)\b/gi)) {
        expect(TABLES, `${file}: ${m[1]} on ${m[2]}`).not.toContain(m[2]);
      }
      for (const m of sql.matchAll(/grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+([^;]+?)\s+to\s+[^;]*authenticated/gi)) {
        for (const table of TABLES) {
          expect(new RegExp(`\\b${table}\\b`).test(m[2]), `${file} grants writing ${table}`).toBe(false);
        }
      }
    }
  });
});

describe("the application", () => {
  /** No service, screen or component writes these tables directly any more. */
  it("writes none of the eleven tables except through their functions", () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
      );
    const files = ["app", "lib", "components"].flatMap((d) => sources(join(process.cwd(), d)));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const table of TABLES) {
        const re = new RegExp(`from\\(\\s*["'\`]${table}["'\`]\\s*\\)([\\s\\S]{0,400})`, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          re.lastIndex = m.index + 1;
          const tail = m[1].split(/;|\bfrom\(/)[0];
          expect(/\.(insert|update|upsert|delete)\(/.test(tail), `${file} writes ${table} directly`).toBe(false);
        }
      }
    }
  });
});
