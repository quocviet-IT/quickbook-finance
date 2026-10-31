import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const DIR = join(process.cwd(), "supabase/migrations");
const FILE = "0184_audit_read_follows_permission.sql";
const raw = readFileSync(join(DIR, FILE), "utf8").replace(/\r/g, "");
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const strip = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const sql = norm(strip(raw));

describe("0184: the audit log's read policy asks for audit.read", () => {
  it("replaces the member-wide policy with one that checks the permission", () => {
    expect(sql).toContain("drop policy if exists acc_audit_read on acc_audit_log;");
    expect(sql).toContain(
      "create policy acc_audit_read on acc_audit_log for select using ((select acc_has_permission('audit.read')));",
    );
    expect(sql).not.toContain("acc_current_role() is not null");
  });

  it("reaches every company schema, not only public", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    const company = norm(strip(plan.statements.join("\n")));
    expect(company).toContain("set search_path = co_example");
    expect(company).toContain("create policy acc_audit_read on acc_audit_log");
  });

  it("is the last migration to define acc_audit_read, so nothing later undoes it", () => {
    const later = readdirSync(DIR)
      .filter((name) => name.endsWith(".sql") && name > FILE)
      .filter((name) => /create policy acc_audit_read\b/i.test(strip(readFileSync(join(DIR, name), "utf8"))));
    expect(later).toEqual([]);
  });
});
