import { describe, expect, it } from "vitest";
import {
  approvalPolicyDraft,
  changedApprovalPolicies,
  thresholdMinor,
  type SavedApprovalPolicy,
} from "@/lib/domain/approval-policy-draft";

/** Approval Policies saves every changed row from one button, so it must know which rows changed. */
const policies: SavedApprovalPolicy[] = [
  { action_key: "journal.manual", enabled: false, threshold_minor: 100_000, require_segregation: true },
  { action_key: "period.reopen", enabled: false, threshold_minor: 0, require_segregation: true },
];
const usesThreshold = (key: string) => key !== "period.reopen";
const drafts = () => Object.fromEntries(policies.map((p) => [p.action_key, approvalPolicyDraft(p, 2)]));

describe("which approval policies changed", () => {
  it("finds none when the drafts are what is saved", () => {
    expect(changedApprovalPolicies(policies, drafts(), 2, usesThreshold)).toEqual([]);
  });

  it("finds a switch turned on, and only that row", () => {
    const d = drafts();
    d["journal.manual"] = { ...d["journal.manual"], enabled: true };
    expect(changedApprovalPolicies(policies, d, 2, usesThreshold).map((p) => p.action_key)).toEqual(["journal.manual"]);
  });

  it("compares a threshold in cents, so 1000 and 1000.00 are the same amount", () => {
    const d = drafts();
    d["journal.manual"] = { ...d["journal.manual"], thresholdMajor: 1000.0 };
    expect(changedApprovalPolicies(policies, d, 2, usesThreshold)).toEqual([]);
    d["journal.manual"] = { ...d["journal.manual"], thresholdMajor: 1000.01 };
    expect(changedApprovalPolicies(policies, d, 2, usesThreshold)).toHaveLength(1);
    expect(thresholdMinor(d["journal.manual"], 2)).toBe(100_001);
  });

  it("ignores a threshold on an action that has no amount", () => {
    const d = drafts();
    d["period.reopen"] = { ...d["period.reopen"], thresholdMajor: 50 };
    expect(changedApprovalPolicies(policies, d, 2, usesThreshold)).toEqual([]);
  });
});
