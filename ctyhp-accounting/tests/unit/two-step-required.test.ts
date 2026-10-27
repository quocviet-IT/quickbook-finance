import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daysLeft, REQUIRED_PATH, twoStepRequirement } from "@/lib/domain/two-step";
import { planCompanySchema } from "@/lib/domain/schema-template";
import { totp } from "../../scripts/quality/totp.mjs";

const FILE = "0175_two_step_required.sql";
const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8").replace(/\r\n/g, "\n");
const raw = read("supabase", "migrations", FILE);
const code = raw.replace(/--[^\n]*/g, "");

const policy = { roles: ["admin", "accountant"], required_from: "2026-11-03T08:00:00Z" };
const before = new Date("2026-10-30T08:00:00Z");
const after = new Date("2026-11-03T08:00:01Z");

describe("what 2.66 asks of a person", () => {
  it("reminds an admin or accountant without a second step before the deadline, and stops them after", () => {
    expect(twoStepRequirement("admin", policy, false, before)).toEqual({ required: true, overdue: false, remind: true, requiredFrom: policy.required_from });
    expect(twoStepRequirement("accountant", policy, false, after)).toEqual({ required: true, overdue: true, remind: false, requiredFrom: policy.required_from });
  });

  it("asks nothing more of someone who has one, of sales and viewers, or without a policy", () => {
    expect(twoStepRequirement("admin", policy, true, after)).toMatchObject({ overdue: false, remind: false });
    expect(twoStepRequirement("sales", policy, false, after)).toEqual({ required: false, overdue: false, remind: false, requiredFrom: null });
    expect(twoStepRequirement("viewer", policy, false, after)).toMatchObject({ required: false });
    expect(twoStepRequirement("admin", null, false, after)).toMatchObject({ required: false, overdue: false });
    expect(twoStepRequirement(null, policy, false, after)).toMatchObject({ required: false });
  });

  it("counts whole days left, rounding up, and none once passed", () => {
    expect(daysLeft(policy.required_from, before)).toBe(4);
    expect(daysLeft(policy.required_from, new Date("2026-11-03T07:00:00Z"))).toBe(1);
    expect(daysLeft(policy.required_from, after)).toBe(0);
    expect(REQUIRED_PATH).toBe("/two-step-required");
  });
});

describe("the authenticator code the checks compute", () => {
  it("matches RFC 6238's SHA-1 test vectors, to six digits", () => {
    // The RFC's key is the ASCII "12345678901234567890"; this is it in base32.
    const key = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totp(key, 59_000)).toBe("287082");
    expect(totp(key, 1_111_111_109_000)).toBe("081804");
    expect(totp(key, 2_000_000_000_000)).toBe("279037");
  });
});

describe("0175_two_step_required", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("gives each company seven days from when it runs, for admins and accountants", () => {
    expect(code).toMatch(/roles\s+acc_app_role\[\] not null default '\{admin,accountant\}'/);
    expect(code).toMatch(/values \(now\(\) \+ interval '7 days'\)\s+on conflict \(id\) do nothing;/);
    expect(code).toMatch(/create policy acc_two_step_policy_read on acc_two_step_policy\s+for select using \(auth\.uid\(\) is not null\);/);
    expect(code).toMatch(/revoke all on acc_two_step_policy from anon, authenticated;\s+grant select on acc_two_step_policy to authenticated;/);
  });

  it("counts a required role only in an aal2 session from the deadline, and requires nothing without a policy row", () => {
    expect(code).toMatch(
      /and not \(u\.role = any \(coalesce\(\(select p\.roles from acc_two_step_policy p\), '\{\}'\)\)\s+and now\(\) >= coalesce\(\(select p\.required_from from acc_two_step_policy p\), 'infinity'\)\)/,
    );
  });

  it("runs the company part in every company and the platform part once", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    const stripped = plan.statements.map((s) => s.replace(/--[^\n]*/g, ""));
    expect(stripped.some((s) => /create table if not exists acc_two_step_policy/.test(s))).toBe(true);
    expect(stripped.some((s) => /function acc_current_role\(\)/.test(s))).toBe(true);
    expect(stripped.some((s) => /onebook\./.test(s))).toBe(false);
    expect(code).toMatch(/now\(\) < coalesce\(\(select p\.required_from from onebook\.two_step_policy p\), 'infinity'\)/);
  });
});

describe("the screens", () => {
  it("send an overdue admin or accountant to set it up, and remind before", () => {
    const layout = read("app", "(app)", "layout.tsx");
    expect(layout).toMatch(/if \(twoStep\.overdue\) redirect\(REQUIRED_PATH\);/);
    expect(layout).toMatch(/\{twoStep\.remind && twoStep\.requiredFrom \? <TwoStepReminder requiredFrom=\{twoStep\.requiredFrom\} \/> : null\}/);
  });

  it("keep the set-up page for those who owe it, outside the shell", () => {
    const page = read("app", "(auth)", "two-step-required", "page.tsx");
    expect(page).toMatch(/if \(!\(await twoStepStanding\(\)\)\.overdue\) redirect\("\/dashboard"\);/);
    expect(read("app", "(auth)", "two-step-required", "TwoStepRequiredClient.tsx")).toMatch(/<TwoStepClient email=\{email\} onSince=\{null\} required \/>/);
  });
});
