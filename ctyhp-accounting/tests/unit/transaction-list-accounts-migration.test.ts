import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0105_transaction_list_accounts.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0105_transaction_list_accounts", () => {
  it("returns the accounts each entry touched", () => {
    expect(code).toMatch(/account_ids\s+uuid\[\]/);
  });

  it("keeps the signature the report already calls", () => {
    expect(code).toMatch(/acc_transaction_list\(\s*p_from\s+date,\s*p_to\s+date\s*\)/);
    expect(code).toMatch(/grant execute on function acc_transaction_list\(date, date\)/);
  });

  it("reads, and only reads", () => {
    expect(code).toMatch(/language sql stable/);
    expect(code).not.toMatch(/insert\s+into/i);
    expect(code).not.toMatch(/update\s+acc_/i);
  });

  it("reaches a company created tomorrow, not only the ones that exist today", () => {
    // `planCompanySchema` is what provisioning replays into a new schema. If the
    // statement is not in that plan, the next company has a report without the
    // column and a filter that cannot work.
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    const statements = plan.statements.join("\n");
    expect(statements).toMatch(/account_ids/);
    expect(statements).toMatch(/set search_path = co_probe/);
    expect(plan.skipped, "nothing here is global").toEqual([]);
  });
});
