import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const FILE = "0165_document_tables_read_only.sql";
const strip = (sql: string) => sql.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
const code = strip(readFileSync(join(DIR, FILE), "utf8"));

const DOCUMENT_TABLES = [
  "acc_invoice", "acc_invoice_line", "acc_payment", "acc_payment_allocation",
  "acc_bill", "acc_bill_line", "acc_bill_payment", "acc_bill_payment_allocation",
  "acc_expense", "acc_expense_line",
  "acc_credit_memo", "acc_credit_memo_line", "acc_credit_memo_allocation",
  "acc_vendor_credit", "acc_vendor_credit_line", "acc_vendor_credit_allocation",
  "acc_customer_refund", "acc_write_off",
];

/** Every write policy any migration up to and including 0164 created on a document table. */
function writePoliciesBefore0165(): { policy: string; table: string }[] {
  const found = new Map<string, { policy: string; table: string }>();
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < FILE).sort()) {
    const sql = strip(readFileSync(join(DIR, file), "utf8"));
    for (const m of sql.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(all|insert|update|delete)\b/gi)) {
      if (DOCUMENT_TABLES.includes(m[2])) found.set(`${m[1]} ${m[2]}`, { policy: m[1], table: m[2] });
    }
    for (const m of sql.matchAll(/drop policy\s+(?:if exists\s+)?(\w+)\s+on\s+(\w+)/gi)) {
      found.delete(`${m[1]} ${m[2]}`);
    }
  }
  return [...found.values()];
}

describe("0165_document_tables_read_only", () => {
  it("starts with the schema search path, so it runs in every company", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("drops every write policy the earlier migrations left on a document table", () => {
    // Ten are written out in the migrations; 0019 made the other sixteen in a
    // loop, <table>_ins and <table>_upd for each of its eight tables. All 26
    // were read off the live database on 2026-10-24.
    const loop = strip(readFileSync(join(DIR, "0019_ar_ap_credits.sql"), "utf8"));
    const looped = loop.match(/foreach t in array array\[([\s\S]*?)\] loop/)![1].match(/acc_\w+/g)!;
    expect(loop).toContain("create policy %I on %I for insert with check (acc_is_staff())$f$, t||'_ins', t)");
    expect(loop).toContain("create policy %I on %I for update using (acc_is_staff())$f$, t||'_upd', t)");
    const standing = [
      ...writePoliciesBefore0165(),
      ...looped.flatMap((table) => [
        { policy: `${table}_ins`, table },
        { policy: `${table}_upd`, table },
      ]),
    ];
    expect(standing.length).toBe(26);
    for (const { policy, table } of standing) {
      expect(code, `${policy} on ${table}`).toMatch(new RegExp(`drop policy if exists ${policy} on ${table};`));
    }
    expect(code.match(/drop policy if exists/g)).toHaveLength(26);
  });

  it("revokes writing from a session on all eighteen tables, and keeps reading", () => {
    const revoke = code.match(/revoke insert, update, delete, truncate on([\s\S]*?)from authenticated, anon;/);
    const grant = code.match(/grant select on([\s\S]*?)to authenticated;/);
    const listed = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean).sort();
    expect(listed(revoke![1])).toEqual([...DOCUMENT_TABLES].sort());
    expect(listed(grant![1])).toEqual([...DOCUMENT_TABLES].sort());
  });

  it("creates nothing, posts nothing and drops no read policy", () => {
    expect(code).not.toMatch(/create (policy|table|function|or replace)/i);
    expect(code).not.toMatch(/acc_post_entry|insert into|update acc_|delete from/i);
    expect(code).not.toMatch(/drop policy if exists \w*(_read|_sel)\b/);
  });

  it("is not undone: no later migration gives a session a write policy on a document table again", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql") && f > FILE)) {
      const sql = strip(readFileSync(join(DIR, file), "utf8"));
      for (const m of sql.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(all|insert|update|delete)\b/gi)) {
        expect(DOCUMENT_TABLES, `${file}: ${m[1]} on ${m[2]}`).not.toContain(m[2]);
      }
      for (const m of sql.matchAll(/grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+([^;]+?)\s+to\s+[^;]*authenticated/gi)) {
        for (const table of DOCUMENT_TABLES) {
          expect(new RegExp(`\\b${table}\\b`).test(m[2]), `${file} grants writing ${table}`).toBe(false);
        }
      }
    }
  });
});
