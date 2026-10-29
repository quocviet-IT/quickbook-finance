import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  approvalPolicyDraft,
  approvalPolicyStatus,
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

/** A reviewer read "Every policy starts off." as the state of books that had five of seven on. */
describe("what the notice says about the policies in force", () => {
  const seven = (on: number) => Array.from({ length: 7 }, (_, i) => ({ enabled: i < on }));

  it("counts the actions that need approval, out of all of them", () => {
    expect(approvalPolicyStatus(seven(5))).toBe("Approval is on for 5 of 7 controlled actions");
    expect(approvalPolicyStatus(seven(1))).toBe("Approval is on for 1 of 7 controlled actions");
  });

  it("says plainly when none or all are on", () => {
    expect(approvalPolicyStatus(seven(0))).toBe("Approval is off for all 7 controlled actions");
    expect(approvalPolicyStatus(seven(7))).toBe("Approval is on for all 7 controlled actions");
    expect(approvalPolicyStatus([])).toBe("No controlled actions are set up");
  });

  it("leads the screen's notice, and the default is said about new companies only", () => {
    const client = readFileSync(join(process.cwd(), "app", "(app)", "settings", "approvals", "ApprovalPoliciesClient.tsx"), "utf8");
    expect(client).toContain("message={approvalPolicyStatus(policies)}");
    expect(client).not.toContain("Every policy starts off.");
    expect(client).toContain("A new company starts with every policy off.");
  });
});
