import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0098_bank_transaction_categories.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("bank transaction category migration", () => {
  it("adds a label table that cannot hold the same name twice", () => {
    expect(sql).toMatch(/create table if not exists acc_bank_category/i);
    expect(sql).toMatch(/create unique index[\s\S]{0,80}lower\(btrim\(name\)\)/i);
    expect(sql).toMatch(/is_active\s+boolean not null default true/i);
    // Attribution is the database's job, not the application's.
    expect(sql).toContain("acc_stamp_actor()");
  });

  it("puts the user's label in its own column, beside the bank's own category", () => {
    expect(sql).toMatch(
      /alter table acc_bank_transaction[\s\S]{0,120}add column if not exists bank_category_id uuid/i,
    );
    expect(sql).toMatch(/references acc_bank_category \(id\) on delete set null/i);
    // The feed's `category` column must not be touched by this migration.
    expect(sql).not.toMatch(/set category\s*=/i);
    expect(sql).not.toMatch(/drop column[\s\S]{0,40}category\b/i);
  });

  it("writes a label through a function that can reach nothing else", () => {
    const setter = sql.slice(sql.indexOf("function acc_set_bank_transaction_category"));
    expect(setter).toContain("acc_is_staff()");
    expect(setter).toMatch(/update acc_bank_transaction\s+set bank_category_id =/i);
    const write = setter.slice(setter.indexOf("update acc_bank_transaction"));
    for (const column of [
      "amount_minor",
      "txn_date",
      "description",
      "reference",
      "raw_hash",
      "status",
    ]) {
      expect(write, column).not.toMatch(new RegExp(`${column}\\s*=`));
    }
  });

  it("returns the existing label when the same name arrives again", () => {
    const upsert = sql.slice(
      sql.indexOf("function acc_upsert_bank_category"),
      sql.indexOf("function acc_set_bank_transaction_category"),
    );
    expect(upsert).toContain("acc_is_staff()");
    expect(upsert).toMatch(/lower\(btrim\(name\)\) = lower\(v_name\)/i);
    expect(upsert).toMatch(/length\(v_name\) = 0/);
    expect(upsert).toMatch(/length\(v_name\) > 60/);
  });

  it("leaves the immutability trigger alone", () => {
    expect(sql).not.toContain("acc_block_bank_txn_edit");
    expect(sql).not.toContain("acc_bank_txn_immutable");
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
