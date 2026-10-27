import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_CAP, canBecomeAdmin, type UserLike } from "@/lib/domain/access";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0172_two_admins_at_most.sql";
const raw = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8").replace(/\r\n/g, "\n");
const code = raw.replace(/--[^\n]*/g, "");

const user = (id: string, role: UserLike["role"], status: UserLike["status"] = "active"): UserLike => ({ id, role, status });

describe("canBecomeAdmin", () => {
  it("allows a second admin, refuses a third, and counts only those who hold access", () => {
    const one = [user("a", "admin"), user("b", "accountant")];
    expect(canBecomeAdmin(one, "b")).toBe(true);
    const two = [user("a", "admin"), user("b", "admin"), user("c", "accountant")];
    expect(canBecomeAdmin(two, "c")).toBe(false);
    expect(canBecomeAdmin(two, null)).toBe(false);
    // An invited admin holds access; a suspended or offboarded one does not.
    expect(canBecomeAdmin([user("a", "admin"), user("b", "admin", "invited")], null)).toBe(false);
    expect(canBecomeAdmin([user("a", "admin"), user("b", "admin", "suspended"), user("c", "admin", "offboarded")], null)).toBe(true);
  });

  it("keeps the option for someone who already is an admin", () => {
    const two = [user("a", "admin"), user("b", "admin")];
    expect(canBecomeAdmin(two, "a")).toBe(true);
    expect(ADMIN_CAP).toBe(2);
  });
});

describe("0172_two_admins_at_most", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("caps each company at two admins holding access, on every insert and every role or status change", () => {
    expect(code).toMatch(
      /select count\(\*\) from acc_app_user where role = 'admin' and status in \('invited', 'active'\)\) > 2 then\s+raise exception 'A company can have at most two admins/,
    );
    expect(code).toMatch(/after insert or update of role, status on acc_app_user\s+for each statement execute function acc_enforce_admin_cap\(\);/);
  });

  it("caps the platform register at two, as a statement the per-company replay holds back", () => {
    expect(code).toMatch(/if \(select count\(\*\) from onebook\.platform_admin\) > 2 then\s+raise exception 'At most two people/);
    expect(code).toMatch(/after insert or update on onebook\.platform_admin\s+for each statement execute function onebook\.enforce_platform_admin_cap\(\);/);
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    // Judged on the code, as the replay judges it: the header prose names the register too.
    expect(plan.statements.some((s) => /onebook\./.test(s.replace(/--[^\n]*/g, "")))).toBe(false);
    expect(plan.statements.some((s) => /acc_enforce_admin_cap/.test(s))).toBe(true);
  });

  it("stops rather than start over the limit, and names nobody", () => {
    expect(code.match(/raise exception '[^']*before applying 0172'/g)).toHaveLength(2);
    expect(raw).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
  });
});
