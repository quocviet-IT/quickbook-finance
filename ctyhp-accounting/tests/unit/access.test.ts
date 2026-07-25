import { describe, expect, it } from "vitest";
import {
  approvalRequired,
  canDecide,
  describeStatusChange,
  isLastActiveAdmin,
  CONTROLLED_ACTIONS,
  PERMISSION_CATEGORIES,
} from "@/lib/domain/access";
import {
  approvalDecisionSchema,
  approvalPolicySchema,
  userInviteSchema,
  userStatusSchema,
} from "@/lib/domain/schemas";

describe("approvalRequired", () => {
  it("is false when the policy is disabled, whatever the amount", () => {
    expect(approvalRequired({ enabled: false, thresholdMinor: 0 }, 1_000_000)).toBe(false);
  });

  it("is true at exactly the threshold", () => {
    expect(approvalRequired({ enabled: true, thresholdMinor: 50000 }, 50000)).toBe(true);
  });

  it("is false below the threshold", () => {
    expect(approvalRequired({ enabled: true, thresholdMinor: 50000 }, 49999)).toBe(false);
  });

  it("is true above the threshold", () => {
    expect(approvalRequired({ enabled: true, thresholdMinor: 50000 }, 50001)).toBe(true);
  });

  it("compares the absolute amount, so a credit is treated like a debit", () => {
    expect(approvalRequired({ enabled: true, thresholdMinor: 100 }, -500)).toBe(true);
  });

  it("is true for an on/off policy with a zero threshold", () => {
    expect(approvalRequired({ enabled: true, thresholdMinor: 0 }, 0)).toBe(true);
  });
});

describe("canDecide", () => {
  const requester = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("lets someone else approve", () => {
    expect(canDecide({ requestedBy: requester, requireSegregation: true }, other)).toEqual({ ok: true });
  });

  it("blocks the requester when segregation is on, with the reason", () => {
    const r = canDecide({ requestedBy: requester, requireSegregation: true }, requester);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/your own request/i);
  });

  it("allows self-approval when segregation is off", () => {
    expect(canDecide({ requestedBy: requester, requireSegregation: false }, requester)).toEqual({ ok: true });
  });
});

describe("isLastActiveAdmin", () => {
  const users = [
    { id: "u1", role: "admin" as const, status: "active" as const },
    { id: "u2", role: "accountant" as const, status: "active" as const },
    { id: "u3", role: "admin" as const, status: "suspended" as const },
  ];

  it("is true for the only active admin", () => {
    expect(isLastActiveAdmin(users, "u1")).toBe(true);
  });

  it("is false for a non-admin", () => {
    expect(isLastActiveAdmin(users, "u2")).toBe(false);
  });

  it("is false for a suspended admin (they are not holding the door open)", () => {
    expect(isLastActiveAdmin(users, "u3")).toBe(false);
  });

  it("is false once a second active admin exists", () => {
    const two = [...users, { id: "u4", role: "admin" as const, status: "active" as const }];
    expect(isLastActiveAdmin(two, "u1")).toBe(false);
  });

  it("counts an invited admin as active for lock-out purposes", () => {
    const invited = [
      { id: "u1", role: "admin" as const, status: "active" as const },
      { id: "u5", role: "admin" as const, status: "invited" as const },
    ];
    expect(isLastActiveAdmin(invited, "u1")).toBe(false);
  });
});

describe("describeStatusChange", () => {
  it("describes a suspension", () => {
    expect(describeStatusChange("active", "suspended")).toMatch(/suspend/i);
  });

  it("describes a reactivation", () => {
    expect(describeStatusChange("suspended", "active")).toMatch(/reactivat/i);
  });

  it("describes offboarding", () => {
    expect(describeStatusChange("active", "offboarded")).toMatch(/offboard/i);
  });
});

describe("controlled action catalog", () => {
  it("covers exactly the six wired actions", () => {
    expect(CONTROLLED_ACTIONS.map((a) => a.key)).toEqual([
      "manual_journal",
      "write_off",
      "inventory_adjustment",
      "period_reopen",
      "reconciliation_reopen",
      "vendor_tax_profile",
    ]);
  });

  it("marks the two on/off policies as amount-independent", () => {
    const onOff = CONTROLLED_ACTIONS.filter((a) => !a.usesThreshold).map((a) => a.key);
    expect(onOff).toEqual([
      "period_reopen",
      "reconciliation_reopen",
      "vendor_tax_profile",
    ]);
  });

  it("lists permission categories for the matrix UI", () => {
    expect(PERMISSION_CATEGORIES).toContain("Governance");
  });
});

describe("access schemas", () => {
  it("accepts a valid invitation", () => {
    const r = userInviteSchema.safeParse({ email: "new@ctyhp.vn", full_name: "New Person", role: "accountant" });
    expect(r.success).toBe(true);
  });

  it("rejects an invitation with a bad email", () => {
    expect(userInviteSchema.safeParse({ email: "nope", role: "accountant" }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(userInviteSchema.safeParse({ email: "a@b.vn", role: "owner" }).success).toBe(false);
  });

  it("requires a reason for a status change", () => {
    expect(userStatusSchema.safeParse({ status: "suspended", reason: "" }).success).toBe(false);
    expect(userStatusSchema.safeParse({ status: "suspended", reason: "Left the company" }).success).toBe(true);
  });

  it("rejects a negative approval threshold", () => {
    const r = approvalPolicySchema.safeParse({
      action_key: "manual_journal",
      enabled: true,
      threshold_minor: -1,
      require_segregation: true,
    });
    expect(r.success).toBe(false);
  });

  it("requires a note when rejecting", () => {
    expect(approvalDecisionSchema.safeParse({ note: "" }).success).toBe(false);
    expect(approvalDecisionSchema.safeParse({ note: "Not supported by evidence" }).success).toBe(true);
  });
});
