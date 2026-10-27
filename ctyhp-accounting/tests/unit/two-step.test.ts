import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_STEP_PATH, owesSecondStep, readCode, sessionRedirect, verifiedAppFactors } from "@/lib/domain/two-step";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0174_two_step_sign_in.sql";
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8").replace(/\r\n/g, "\n");
const raw = read("supabase", "migrations", FILE);
const code = raw.replace(/--[^\n]*/g, "");

const app = (status: string) => ({ factor_type: "totp", status });

describe("two-step sign-in rules", () => {
  it("counts only an authenticator app whose first code was accepted", () => {
    expect(verifiedAppFactors([app("verified"), app("unverified"), { factor_type: "phone", status: "verified" }])).toHaveLength(1);
    expect(verifiedAppFactors(undefined)).toEqual([]);
  });

  it("owes the second step only with a verified factor and a session below aal2", () => {
    expect(owesSecondStep([app("verified")], "aal1")).toBe(true);
    expect(owesSecondStep([app("verified")], null)).toBe(true);
    expect(owesSecondStep([app("verified")], "aal2")).toBe(false);
    expect(owesSecondStep([app("unverified")], "aal1")).toBe(false);
    expect(owesSecondStep([], "aal1")).toBe(false);
  });

  it("keeps the signed-out on /login and the signed-in off it, except for the code step", () => {
    expect(sessionRedirect("/dashboard", null, false)).toBe("/login");
    expect(sessionRedirect("/login", null, false)).toBeNull();
    expect(sessionRedirect("/login", "code", false)).toBeNull();
    expect(sessionRedirect("/login", null, true)).toBe("/dashboard");
    expect(sessionRedirect("/login", "code", true)).toBeNull();
    expect(sessionRedirect("/invoices", null, true)).toBeNull();
    expect(CODE_STEP_PATH).toBe("/login?step=code");
  });

  it("reads a code as six digits, spaces allowed", () => {
    expect(readCode("123 456")).toBe("123456");
    expect(readCode(" 123456 ")).toBe("123456");
    expect(readCode("12345")).toBeNull();
    expect(readCode("12a456")).toBeNull();
  });
});

describe("0174_two_step_sign_in", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("counts a member only when they have no verified factor or the session passed it", () => {
    expect(code).toMatch(
      /where u\.id = auth\.uid\(\) and u\.status in \('invited', 'active'\)\s+and \(coalesce\(auth\.jwt\(\) ->> 'aal', ''\) = 'aal2'\s+or not exists \(select 1 from auth\.mfa_factors f\s+where f\.user_id = u\.id and f\.status = 'verified'\)\);/,
    );
  });

  it("wraps every membership call in a row policy, once, by pattern", () => {
    expect(code).toMatch(/\(\?<!SELECT \)\(acc_current_role\\\(\\\)\|acc_is_staff\\\(\\\)\|acc_is_admin\\\(\\\)\|acc_has_permission/);
    expect(code).toMatch(/execute format\('alter policy %I on %I using \(%s\)'/);
    expect(code).toMatch(/execute format\('alter policy %I on %I with check \(%s\)'/);
  });

  it("runs the membership change in every company and the platform change once", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    const stripped = plan.statements.map((s) => s.replace(/--[^\n]*/g, ""));
    expect(stripped.some((s) => /function acc_current_role\(\)/.test(s))).toBe(true);
    expect(stripped.some((s) => /alter policy/.test(s) && /schemaname = 'co_probe'/.test(s))).toBe(true);
    expect(stripped.some((s) => /onebook\./.test(s))).toBe(false);
    expect(code).toMatch(/create or replace function onebook\.is_platform_admin\(\)/);
  });

  it("lets only Manage users reset someone else's second step, with a reason, in the audit log", () => {
    expect(code).toMatch(/if not acc_has_permission\('users\.manage'\) then/);
    expect(code).toMatch(/if p_user_id = auth\.uid\(\) then\s+raise exception 'You cannot reset your own two-step sign-in/);
    expect(code).toMatch(/raise exception 'A reason is required'/);
    expect(code).toMatch(/values \('acc_app_user', p_user_id, 'mfa_reset', auth\.uid\(\),/);
    expect(code).toMatch(/revoke all on function acc_mfa_reset_check\(uuid, text\) from public, anon;/);
  });
});

describe("the screens", () => {
  it("send a session that owes the code to the code step, before anything is read", () => {
    const layout = read("app", "(app)", "layout.tsx");
    expect(layout).toMatch(/if \(!user\) redirect\("\/login"\);\s+[\s\S]{0,300}if \(await owesSecondStepNow\(\)\) redirect\(CODE_STEP_PATH\);/);
    expect(read("proxy.ts")).toMatch(/sessionRedirect\(\s+request\.nextUrl\.pathname,\s+request\.nextUrl\.searchParams\.get\("step"\),\s+signedIn,\s+\)/);
  });

  it("offer the reset only for someone else who has a second step", () => {
    const users = read("app", "(app)", "settings", "users", "UsersClient.tsx");
    expect(users).toMatch(/if \(r\.mfa_enrolled && r\.id !== currentUserId && canCreateUsers\) \{/);
  });
});
