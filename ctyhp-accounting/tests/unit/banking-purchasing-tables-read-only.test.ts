import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const FILE = "0168_banking_purchasing_tables_read_only.sql";
const strip = (sql: string) => sql.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
const code = strip(readFileSync(join(DIR, FILE), "utf8"));

/** Read off the live database on 2026-10-26, the same in all seven schemas. */
const WRITE_POLICIES: [string, string][] = [
  ["acc_bank_transaction", "acc_bank_txn_write"],
  ["acc_bank_import_batch", "acc_bank_batch_write"],
  ["acc_bank_category", "acc_bank_category_ins"],
  ["acc_bank_category", "acc_bank_category_upd"],
  ["acc_reconciliation", "acc_recon_write"],
  ["acc_reconciliation_line", "acc_recon_line_ins"],
  ["acc_reconciliation_line", "acc_recon_line_del"],
  ["acc_statement_reconciliation", "acc_stmt_recon_ins"],
  ["acc_statement_reconciliation", "acc_stmt_recon_upd"],
  ["acc_purchase_order", "acc_po_write"],
  ["acc_purchase_order_line", "acc_po_line_write"],
  ["acc_goods_receipt", "acc_receipt_write"],
  ["acc_goods_receipt_line", "acc_receipt_line_write"],
  ["acc_tax_payment", "acc_tax_payment_write"],
  ["acc_journal_reversal_link", "acc_reversal_link_insert"],
  ["acc_currency", "acc_currency_admin"],
  ["acc_exchange_rate", "acc_exchange_admin"],
  ["acc_purchasing_config", "acc_purchasing_config_write"],
  ["acc_afda_rate", "acc_afda_rate_write"],
  ["acc_1099_box", "acc_1099_box_write"],
];
const TABLES = [...new Set(WRITE_POLICIES.map(([t]) => t))];

describe("0168_banking_purchasing_tables_read_only", () => {
  it("starts with the schema search path, so it runs in every company", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("drops all twenty write policies on the seventeen tables, and no read policy", () => {
    expect(TABLES).toHaveLength(17);
    for (const [table, policy] of WRITE_POLICIES) {
      expect(code, `${policy} on ${table}`).toMatch(new RegExp(`drop policy if exists ${policy} on ${table};`));
    }
    expect(code.match(/drop policy if exists/g)).toHaveLength(20);
    expect(code).not.toMatch(/drop policy if exists \w*(_read|_sel)\b/);
  });

  it("revokes writing on all seventeen from a session, and keeps reading", () => {
    const listed = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean).sort();
    const revoke = code.match(/revoke insert, update, delete, truncate on([\s\S]*?)from authenticated, anon;/);
    const grant = code.match(/grant select on([\s\S]*?)to authenticated;/);
    expect(listed(revoke![1])).toEqual([...TABLES].sort());
    expect(listed(grant![1])).toEqual([...TABLES].sort());
  });

  it("creates nothing and posts nothing", () => {
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
