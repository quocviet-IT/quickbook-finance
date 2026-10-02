import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "@/lib/domain/company-export";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0131_related_company.sql"), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
}

describe("0131 related company register", () => {
  const sql = body();
  it("keeps one company per account, with a name and the words its bank prints", () => {
    expect(sql).toMatch(/create table if not exists acc_related_company/i);
    expect(sql).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/account_id\s+uuid not null unique references acc_account \(id\)/i);
    expect(sql).toMatch(/constraint acc_related_company_name_ck\s+check \(length\(btrim\(name\)\) between 1 and 120\)/i);
    expect(sql).toMatch(/constraint acc_related_company_words_ck\s+check \(btrim\(match_words\) <> '' and length\(match_words\) <= 200\)/i);
  });
  it("keeps names unique in any case", () => {
    expect(sql).toMatch(/create unique index if not exists acc_related_company_name_key\s+on acc_related_company \(lower\(btrim\(name\)\)\)/i);
  });
  it("is staff-written, viewer-readable and audited", () => {
    expect(sql).toMatch(/after insert or update or delete on acc_related_company\s+for each row execute function acc_audit_row_change\(\)/i);
    expect(sql).toMatch(/before insert or update on acc_related_company\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql).toMatch(/for select using \(acc_is_staff\(\) or acc_current_role\(\) = 'viewer'\)/i);
    expect(sql).toMatch(/for insert with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/for update using \(acc_is_staff\(\)\) with check \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/for delete using \(acc_is_staff\(\)\)/i);
    expect(sql).toMatch(/revoke all on acc_related_company from public, anon/i);
    expect(sql).toMatch(/grant select, insert, update, delete on acc_related_company to authenticated/i);
    expect(sql).toMatch(/grant all on acc_related_company to service_role/i);
  });
  it("changes nothing that exists", () => {
    expect(sql).not.toMatch(/alter table (?!acc_related_company)/i);
    expect(sql).not.toMatch(/drop table/i);
  });
  it("travels with the company export", () => {
    expect(EXPORT_TABLES).toContain("acc_related_company");
    expect(EXPORT_TABLES.indexOf("acc_related_company")).toBeGreaterThan(EXPORT_TABLES.indexOf("acc_account"));
  });
});
