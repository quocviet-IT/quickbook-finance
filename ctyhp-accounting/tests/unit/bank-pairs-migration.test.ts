import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0127_bank_pairs.sql"), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
}

describe("0127 bank pairs", () => {
  const sql = body();
  it("keeps one row of banking preference, staff-written and audited", () => {
    expect(sql).toMatch(/create table if not exists acc_banking_preference/i);
    // A uuid key, because the shared audit trigger records rows by id.
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/singleton\s+boolean not null default true unique check \(singleton\)/i);
    expect(sql).toMatch(/pair_window_days in \(0, 1, 3, 7, 14, 30\)/i);
    expect(sql).toMatch(/after insert or update or delete on acc_banking_preference\s+for each row execute function acc_audit_row_change\(\)/i);
    expect(sql).toMatch(/for select using \(acc_is_staff\(\) or acc_current_role\(\) = 'viewer'\)/i);
    expect(sql).toMatch(/for update using \(acc_is_staff\(\)\) with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/revoke all on acc_banking_preference from public, anon/i);
  });
  it("posts a pair in one call, staff only, funding to the preference's account", () => {
    expect(sql).toMatch(/function acc_post_bank_pair\(p_first uuid, p_second uuid, p_kind text\)/i);
    expect(sql).toMatch(/raise exception 'A pair needs two different lines'/i);
    expect(sql).toMatch(/v_fund_id := v_pref\.funding_account_id/i);
    expect(sql).toMatch(/grant execute on function acc_post_bank_pair\(uuid, uuid, text\) to authenticated, service_role/i);
  });
  it("takes a transfer back whole", () => {
    const fn = sql.slice(sql.search(/function acc_uncategorise_bank_transaction/i));
    expect(fn).toMatch(/where r\.journal_line_id = l\.id and l\.journal_entry_id = v_entry/i);
  });
});
