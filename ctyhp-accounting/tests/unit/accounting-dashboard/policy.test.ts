import { describe, expect, it } from "vitest";
import {
  EMPTY_WORK_POLICY,
  POLICY_FIELD_LABEL,
  isConfigured,
  ruleNeeds,
  sleepingRules,
  type WorkPolicy,
} from "@/lib/domain/accounting-dashboard/policy";

const CONFIGURED: WorkPolicy = {
  materialityMinor: 100_000,
  approvalSlaDays: 3,
  unmatchedBankAgeDays: 14,
};

describe("isConfigured", () => {
  it("is false for a field nobody has set", () => {
    expect(isConfigured(EMPTY_WORK_POLICY, "materialityMinor")).toBe(false);
    expect(isConfigured(EMPTY_WORK_POLICY, "approvalSlaDays")).toBe(false);
  });

  it("is true once a company has chosen a number", () => {
    expect(isConfigured(CONFIGURED, "materialityMinor")).toBe(true);
    expect(isConfigured(CONFIGURED, "unmatchedBankAgeDays")).toBe(true);
  });

  it("treats zero as configured — a company may mean it", () => {
    // Zero days is a real answer: "an approval waiting at all is late". Only
    // null means nobody has said. Reading zero as unset would quietly override
    // the strictest policy a company can hold.
    expect(isConfigured({ ...EMPTY_WORK_POLICY, approvalSlaDays: 0 }, "approvalSlaDays")).toBe(true);
  });

  it("refuses a negative as unconfigured rather than honouring nonsense", () => {
    expect(isConfigured({ ...EMPTY_WORK_POLICY, approvalSlaDays: -1 }, "approvalSlaDays")).toBe(
      false,
    );
  });
});

describe("sleepingRules", () => {
  it("names every rule that cannot fire for want of a policy", () => {
    const asleep = sleepingRules(EMPTY_WORK_POLICY);
    expect(asleep).toContain("approval-beyond-sla.v1");
    expect(asleep).toContain("bank-unmatched-beyond-age.v1");
  });

  it("names nothing once the policy is complete", () => {
    expect(sleepingRules(CONFIGURED)).toEqual([]);
  });

  it("wakes only the rule whose own field was set", () => {
    const asleep = sleepingRules({ ...EMPTY_WORK_POLICY, approvalSlaDays: 3 });
    expect(asleep).not.toContain("approval-beyond-sla.v1");
    expect(asleep).toContain("bank-unmatched-beyond-age.v1");
  });
});

describe("ruleNeeds", () => {
  it("says which policy a rule is waiting on, so the screen can name it", () => {
    expect(ruleNeeds("approval-beyond-sla.v1")).toBe("approvalSlaDays");
    expect(ruleNeeds("bank-unmatched-beyond-age.v1")).toBe("unmatchedBankAgeDays");
  });

  it("says nothing for a rule that needs no policy at all", () => {
    // The trial balance is out or it is not. No company policy makes that
    // more or less true, and a rule that reported otherwise would be wrong.
    expect(ruleNeeds("trial-balance-out.v1")).toBeNull();
  });
});

describe("POLICY_FIELD_LABEL", () => {
  it("gives every field a name a person would recognise", () => {
    for (const key of Object.keys(EMPTY_WORK_POLICY) as (keyof WorkPolicy)[]) {
      expect(POLICY_FIELD_LABEL[key].length).toBeGreaterThan(3);
    }
  });
});
