import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0136_match_reconciled_bank_lines.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8");
/** The migration without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0136_match_reconciled_bank_lines", () => {
  it("never posts: matching a bank line moves no balance", () => {
    expect(code).not.toMatch(/acc_post_entry/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)/i);
  });

  it("asks who may complete a reconciliation, and matches only a completed one", () => {
    expect(code).toMatch(/if not acc_is_staff\(\) then/);
    expect(code).toMatch(/v_rec\.status <> 'completed'/);
  });

  it("never changes an approved match: it only rejects suggestions", () => {
    expect(code).toMatch(/set status = 'rejected'[\s\S]{0,200}and status = 'suggested'/);
    expect(code).not.toMatch(/delete\s+from\s+acc_reconciliation\b/i);
  });

  it("is closed to anon and open to signed-in users", () => {
    expect(code).toMatch(/revoke all on function acc_match_reconciled_bank_lines\(uuid, jsonb\) from public, anon;/);
    expect(code).toMatch(/grant execute on function acc_match_reconciled_bank_lines\(uuid, jsonb\) to authenticated, service_role;/);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql }], "co_example");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toMatch(/set search_path = co_example/);
  });
});
