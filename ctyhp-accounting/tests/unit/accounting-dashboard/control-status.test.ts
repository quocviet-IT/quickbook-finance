import { describe, expect, it } from "vitest";
import {
  approvalsControl,
  bankReconciliationControl,
  periodStatusControl,
  subledgerControl,
  trialBalanceControl,
  unavailableControl,
} from "@/lib/domain/accounting-dashboard/control-status";

const AT = "2026-08-20T09:00:00Z";

describe("trialBalanceControl", () => {
  it("is healthy and blocks close when the ledger balances", () => {
    const c = trialBalanceControl({ balanced: true, differenceMinor: 0, evaluatedAt: AT });
    expect(c).toMatchObject({ key: "trial-balance", status: "healthy", blocksClose: true });
    expect(c.differenceMinor).toBe(0);
  });

  it("is blocked, not merely attention, when debits and credits differ", () => {
    // A trial balance that does not balance stops a period being closed, so it
    // is the one control whose failure is a blocker rather than a warning.
    const c = trialBalanceControl({ balanced: false, differenceMinor: 500, evaluatedAt: AT });
    expect(c.status).toBe("blocked");
    expect(c.differenceMinor).toBe(500);
    expect(c.detail).toMatch(/5\.00/);
  });
});

describe("subledgerControl", () => {
  it("is healthy when the subledger agrees with its control account to the cent", () => {
    const c = subledgerControl("ar-to-gl", { differenceMinor: 0, evaluatedAt: AT });
    expect(c).toMatchObject({ key: "ar-to-gl", status: "healthy", blocksClose: true });
  });

  it("needs attention, and names the difference, when it does not tie out", () => {
    const c = subledgerControl("ap-to-gl", { differenceMinor: 1234, evaluatedAt: AT });
    expect(c.status).toBe("attention");
    expect(c.detail).toMatch(/12\.34/);
  });

  it("is unavailable — never healthy — when it could not be evaluated", () => {
    // The one rule that matters most here: a control we could not compute must
    // not read as a control that passed.
    const c = subledgerControl("inventory-to-gl", { differenceMinor: null, evaluatedAt: AT });
    expect(c.status).toBe("unavailable");
    expect(c.detail).toMatch(/could not be evaluated/i);
    expect(c.differenceMinor).toBeUndefined();
  });
});

describe("periodStatusControl", () => {
  it("is healthy when no open period is past its end date", () => {
    const c = periodStatusControl({ openCount: 4, overdueCount: 0, evaluatedAt: AT });
    expect(c.status).toBe("healthy");
    expect(c.detail).toMatch(/4 open/);
  });

  it("needs attention when a period is open past its end date", () => {
    const c = periodStatusControl({ openCount: 12, overdueCount: 7, evaluatedAt: AT });
    expect(c.status).toBe("attention");
    expect(c.detail).toMatch(/7/);
  });
});

describe("approvalsControl", () => {
  it("is healthy with nothing waiting", () => {
    const c = approvalsControl({ pendingCount: 0, oldestAgeDays: null, evaluatedAt: AT });
    expect(c.status).toBe("healthy");
  });

  it("needs attention with work waiting, and says how long the oldest has waited", () => {
    const c = approvalsControl({ pendingCount: 3, oldestAgeDays: 5, evaluatedAt: AT });
    expect(c.status).toBe("attention");
    expect(c.detail).toMatch(/3/);
    expect(c.detail).toMatch(/5 days/);
  });

  it("does not block the close — an approval queue is not a ledger failure", () => {
    expect(approvalsControl({ pendingCount: 9, oldestAgeDays: 40, evaluatedAt: AT }).blocksClose).toBe(
      false,
    );
  });
});

describe("bankReconciliationControl", () => {
  it("is healthy when a reconciliation is complete and nothing is unmatched", () => {
    const c = bankReconciliationControl({
      lastCompletedOn: "2026-07-31",
      unmatchedCount: 0,
      evaluatedAt: AT,
    });
    expect(c.status).toBe("healthy");
    expect(c.detail).toMatch(/2026-07-31/);
  });

  it("needs attention while transactions are unmatched, naming both facts", () => {
    const c = bankReconciliationControl({
      lastCompletedOn: null,
      unmatchedCount: 4,
      evaluatedAt: AT,
    });
    expect(c.status).toBe("attention");
    expect(c.detail).toMatch(/4/);
    expect(c.detail).toMatch(/never|no completed/i);
  });
});

describe("unavailableControl", () => {
  it("carries its reason into the detail and never claims health", () => {
    const c = unavailableControl("bank-reconciliation", "The bank feed did not answer.", AT);
    expect(c.status).toBe("unavailable");
    expect(c.detail).toBe("The bank feed did not answer.");
    expect(c.evaluatedAt).toBe(AT);
  });
});

describe("every control", () => {
  it("states the condition it passes on, so a status is never only a colour", () => {
    const all = [
      trialBalanceControl({ balanced: true, differenceMinor: 0, evaluatedAt: AT }),
      subledgerControl("ar-to-gl", { differenceMinor: 0, evaluatedAt: AT }),
      periodStatusControl({ openCount: 1, overdueCount: 0, evaluatedAt: AT }),
      approvalsControl({ pendingCount: 0, oldestAgeDays: null, evaluatedAt: AT }),
      bankReconciliationControl({ lastCompletedOn: null, unmatchedCount: 0, evaluatedAt: AT }),
      unavailableControl("period-status", "No fiscal year is configured.", AT),
    ];
    for (const control of all) {
      expect(control.passCondition.length).toBeGreaterThan(10);
      expect(control.title.length).toBeGreaterThan(2);
      expect(control.href.startsWith("/")).toBe(true);
      expect(control.evaluatedAt).toBe(AT);
    }
  });
});
