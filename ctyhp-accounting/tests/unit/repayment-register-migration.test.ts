import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "@/lib/domain/company-export";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0129_repayment_register.sql"), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
}

describe("0129 repayment register", () => {
  const sql = body();
  it("keeps one entry per account, a card or a loan", () => {
    expect(sql).toMatch(/create table if not exists acc_repayment_account/i);
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/kind\s+text not null check \(kind in \('card', 'loan'\)\)/i);
    expect(sql).toMatch(/account_id\s+uuid not null unique references acc_account \(id\)/i);
    expect(sql).toMatch(/match_digits\s+text check \(match_digits ~ '\^\[0-9\]\{4\}\$'\)/i);
  });
  it("needs words or digits, and keeps interest off a card and on a loan", () => {
    expect(sql).toMatch(/constraint acc_repayment_account_says_how_ck\s+check \(btrim\(match_words\) <> '' or match_digits is not null\)/i);
    expect(sql).toMatch(/constraint acc_repayment_account_card_ck/i);
    expect(sql).toMatch(/constraint acc_repayment_account_loan_ck/i);
    expect(sql).toMatch(/constraint acc_repayment_account_rate_ck/i);
    expect(sql).toMatch(/constraint acc_repayment_account_fixed_ck/i);
  });
  it("is staff-written, viewer-readable and audited", () => {
    expect(sql).toMatch(/after insert or update or delete on acc_repayment_account\s+for each row execute function acc_audit_row_change\(\)/i);
    expect(sql).toMatch(/before insert or update on acc_repayment_account\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql).toMatch(/for select using \(acc_is_staff\(\) or acc_current_role\(\) = 'viewer'\)/i);
    expect(sql).toMatch(/for delete using \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/revoke all on acc_repayment_account from public, anon/i);
    expect(sql).toMatch(/grant select, insert, update, delete on acc_repayment_account to authenticated/i);
  });
  it("travels with the company export", () => {
    expect(EXPORT_TABLES).toContain("acc_repayment_account");
    expect(EXPORT_TABLES.indexOf("acc_repayment_account")).toBeGreaterThan(EXPORT_TABLES.indexOf("acc_account"));
  });
});
