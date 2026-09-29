import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0126_bank_rules.sql"), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("0126 bank rules", () => {
  const sql = body();

  it("keeps rules with the checks the form relies on", () => {
    expect(sql).toMatch(/create table if not exists acc_bank_rule/i);
    expect(sql).toMatch(/match_kind in \('words', 'regex'\)/i);
    expect(sql).toMatch(/direction in \('in', 'out', 'any'\)/i);
    expect(sql).toMatch(/length\(btrim\(match_text\)\) between 1 and 200/i);
    expect(sql).toMatch(/min_minor is null or max_minor is null or min_minor <= max_minor/i);
    expect(sql).toMatch(/account_id\s+uuid not null references acc_account \(id\)/i);
  });

  it("stamps and audits every change", () => {
    expect(sql).toMatch(/before insert or update on acc_bank_rule\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql).toMatch(/after insert or update or delete on acc_bank_rule\s+for each row execute function acc_audit_row_change\(\)/i);
  });

  it("lets staff write, and staff and viewers read", () => {
    expect(sql).toMatch(/alter table acc_bank_rule enable row level security/i);
    expect(sql).toMatch(/for select using \(acc_is_staff\(\) or acc_current_role\(\) = 'viewer'\)/i);
    expect(sql).toMatch(/for insert with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/for update using \(acc_is_staff\(\)\) with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/for delete using \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/revoke all on acc_bank_rule from public, anon/i);
    expect(sql).toMatch(/grant select, insert, update, delete on acc_bank_rule to authenticated/i);
  });

  it("reorders in one statement, staff only, listing every rule once", () => {
    expect(sql).toMatch(/function acc_reorder_bank_rules\(p_ids uuid\[\]\)/i);
    expect(sql).toMatch(/raise exception 'The new order must list every rule once'/i);
    expect(sql).toMatch(/grant execute on function acc_reorder_bank_rules\(uuid\[\]\) to authenticated, service_role/i);
  });

  it("reads history as the invoker, from posted entries of one bank leg and one other", () => {
    const fn = sql.slice(sql.search(/function acc_coding_history\(\)/i));
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toMatch(/e\.status = 'posted'/i);
    expect(fn).toMatch(/having count\(\*\) filter \(where is_bank\) = 1\s+and count\(\*\) filter \(where not is_bank\) = 1/i);
    expect(fn).toMatch(/r\.status = 'approved'/i);
    expect(fn).toMatch(/order by e\.id/i);
    expect(sql).toMatch(/grant execute on function acc_coding_history\(\) to authenticated, service_role/i);
  });
});
