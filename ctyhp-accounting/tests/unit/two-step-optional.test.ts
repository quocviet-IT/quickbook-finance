import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";
import { ACTIVITY_VERBS } from "@/lib/domain/audit-entities";

const FILE = "0176_two_step_optional.sql";
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8").replace(/\r\n/g, "\n");
const raw = read("supabase", "migrations", FILE);
const code = raw.replace(/--[^\n]*/g, "");

describe("0176_two_step_optional", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("empties every company's deadline, and the platform's once", () => {
    expect(code).toMatch(/^delete from acc_two_step_policy;$/m);
    expect(code).toMatch(/^delete from onebook\.two_step_policy;$/m);
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    const stripped = plan.statements.map((s) => s.replace(/--[^\n]*/g, ""));
    expect(stripped.some((s) => /delete from acc_two_step_policy/.test(s))).toBe(true);
    expect(stripped.some((s) => /onebook\./.test(s))).toBe(false);
  });

  it("records someone turning their own second step off, only as a member", () => {
    expect(code).toMatch(/if acc_current_role\(\) is null then\s+raise exception 'Not authorized: you are not a member of this company'/);
    expect(code).toMatch(/values \('acc_app_user', auth\.uid\(\), 'mfa_off', auth\.uid\(\),/);
    expect(code).toMatch(/revoke all on function acc_record_two_step_off\(int\) from public, anon;/);
    expect(ACTIVITY_VERBS.mfa_off).toBe("Two-step sign-in turned off");
  });
});

describe("turning it off", () => {
  it("is offered on the account page when the role does not require it", () => {
    expect(read("app", "(app)", "account", "two-step", "page.tsx")).toMatch(/canTurnOff=\{!standing\.required\}/);
    const client = read("app", "(app)", "account", "two-step", "TwoStepClient.tsx");
    expect(client).toMatch(/\{canTurnOff \? \(/);
    expect(client).toMatch(/await sb\.auth\.mfa\.unenroll\(\{ factorId: factor\.id \}\);/);
    expect(client).toMatch(/await recordTwoStepOffAction\(factors\.length\);/);
  });

  it("no longer tells anyone it is required", () => {
    expect(read("app", "(app)", "settings", "users", "UsersClient.tsx")).toMatch(/Two-step sign-in is recommended, not required/);
    expect(read("app", "(app)", "account", "two-step", "TwoStepClient.tsx")).not.toMatch(/Admins and accountants must have it/);
  });
});
