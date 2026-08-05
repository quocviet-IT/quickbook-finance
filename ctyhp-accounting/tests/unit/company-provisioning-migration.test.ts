import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0097_company_provisioning_requests.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("company provisioning request migration", () => {
  it("adds the platform admin list and seeds it from today's administrators", () => {
    expect(sql).toMatch(/create table if not exists onebook\.platform_admin/i);
    expect(sql).toMatch(/create or replace function onebook\.is_platform_admin\(\)/i);
    expect(sql).toMatch(/from public\.acc_app_user/i);
    expect(sql).toMatch(/role = 'admin'/);
  });

  it("adds a request queue with a closed state machine", () => {
    expect(sql).toMatch(/create table if not exists onebook\.company_request/i);
    expect(sql).toMatch(/status\s+text not null default 'pending'/i);
    expect(sql).toMatch(/check \(status in \('pending', 'running', 'ready', 'failed'\)\)/i);
    for (const column of [
      "slug",
      "legal_name",
      "is_sample",
      "display_order",
      "requested_by",
      "attempts",
      "error",
      "company_id",
    ]) {
      expect(sql, column).toContain(column);
    }
  });

  it("claims one request at a time and cannot double-provision", () => {
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/create or replace function onebook\.claim_company_request\(\)/i);
    expect(sql).toMatch(/create or replace function onebook\.complete_company_request\(/i);
    expect(sql).toMatch(/create or replace function onebook\.fail_company_request\(/i);
    expect(sql).toMatch(/create or replace function onebook\.retry_company_request\(/i);
  });

  it("refuses a slug already taken by a company or by an unfinished request", () => {
    const fn = sql.slice(sql.indexOf("function onebook.request_company"));
    expect(fn).toMatch(/is_platform_admin\(\)/);
    expect(fn).toMatch(/from onebook\.company\s+where slug = /i);
    expect(fn).toMatch(/status in \('pending', 'running'\)/i);
    expect(fn).toMatch(/\^\[a-z\]\[a-z0-9_\]\{1,40\}\$/);
  });

  it("keeps the register out of every company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    // Every statement names `onebook.`, so a company gets none of it.
    expect(plan.statements).toEqual([]);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });
});
