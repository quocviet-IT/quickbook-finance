import { describe, expect, it } from "vitest";
import {
  approvalRequired,
  canDecide,
  describeStatusChange,
  emptyGrants,
  isLastActiveAdmin,
  CONTROLLED_ACTIONS,
  PERMISSION_CATEGORIES,
} from "@/lib/domain/access";
import { canWrite } from "@/lib/domain/roles";
import {
  approvalDecisionSchema,
  approvalPolicySchema,
  userCreateSchema,
  userStatusSchema,
  APP_ROLES,
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
  const strongPassword = "Jewelry!2026Secure";

  it("accepts a valid user account", () => {
    const r = userCreateSchema.safeParse({
      email: "new@ctyhp.vn",
      full_name: "New Person",
      role: "accountant",
      password: strongPassword,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a user account with a bad email", () => {
    expect(userCreateSchema.safeParse({ email: "nope", role: "accountant", password: strongPassword }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(userCreateSchema.safeParse({ email: "a@b.vn", role: "owner", password: strongPassword }).success).toBe(false);
  });

  it("rejects a weak administrator-assigned password", () => {
    expect(userCreateSchema.safeParse({ email: "a@b.vn", role: "viewer", password: "password" }).success).toBe(false);
  });

  it("rejects a password containing the new user's own name — the Microsoft rule", () => {
    const r = userCreateSchema.safeParse({
      email: "a@b.vn",
      full_name: "Kim Thanh",
      role: "viewer",
      password: "Thanh#2026x",
    });
    expect(r.success).toBe(false);
  });

  it("accepts three of the four character kinds, as the Microsoft standard asks", () => {
    const r = userCreateSchema.safeParse({
      email: "a@b.vn",
      full_name: "",
      role: "viewer",
      password: "Harbor2026x",
    });
    expect(r.success).toBe(true);
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

describe("application roles", () => {
  it("carries a sales role between accountant and viewer", () => {
    expect(APP_ROLES).toEqual(["admin", "accountant", "sales", "viewer"]);
  });

  it("keeps sales out of every ledger write", () => {
    // canWrite is the allow-list 44 call sites rely on. If someone ever widens
    // it, sales silently gains invoice, payment and journal posting -- so this
    // assertion is the one that matters most in this file.
    expect(canWrite("sales")).toBe(false);
    expect(canWrite("admin")).toBe(true);
    expect(canWrite("accountant")).toBe(true);
    expect(canWrite("viewer")).toBe(false);
  });

  it("gives the permission matrix a cell for every role", () => {
    // A missing key renders an undefined cell rather than an off switch.
    const grants = emptyGrants();
    for (const role of APP_ROLES) expect(grants[role]).toBe(false);
    expect(Object.keys(grants).sort()).toEqual([...APP_ROLES].sort());
  });
});
