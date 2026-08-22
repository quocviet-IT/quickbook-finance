import { describe, expect, it } from "vitest";
import {
  feedHealthControl,
  statementReconciliationControl,
  unmatchedActivityControl,
} from "@/lib/domain/banking-surface/controls";
import { unmatchedSeverity } from "@/lib/domain/banking-surface/queue-items";

const AT = "2026-08-22T09:00:00.000Z";
const AS_OF = "2026-08-22";

describe("unmatchedActivityControl", () => {
  it("passes when every settled line is accounted for", () => {
    const control = unmatchedActivityControl({
      asOf: AS_OF,
      unmatchedCount: 0,
      oldestAgeDays: null,
      pendingCount: 0,
      evaluatedAt: AT,
    });
    expect(control.status).toBe("healthy");
    expect(control.blocking).toBe(true);
  });

  it("blocks when lines are unmatched, and says how long the oldest has waited", () => {
    const control = unmatchedActivityControl({
      asOf: AS_OF,
      unmatchedCount: 212,
      oldestAgeDays: 96,
      pendingCount: 0,
      evaluatedAt: AT,
    });
    expect(control.status).toBe("blocked");
    expect(control.detail).toContain("212 lines");
    expect(control.detail).toContain("96 days");
  });

  it("says out loud that pending lines were excluded", () => {
    // Otherwise "3 unmatched" on a screen showing 5 unmatched rows looks like a
    // bug in the count rather than a decision about what has settled.
    const control = unmatchedActivityControl({
      asOf: AS_OF,
      unmatchedCount: 3,
      oldestAgeDays: 2,
      pendingCount: 2,
      evaluatedAt: AT,
    });
    expect(control.detail).toContain("2 pending lines excluded");
  });

  it("counts that could not be taken are never reported as clean", () => {
    const control = unmatchedActivityControl({
      asOf: AS_OF,
      unmatchedCount: null,
      oldestAgeDays: null,
      pendingCount: 0,
      evaluatedAt: AT,
    });
    expect(control.status).toBe("unavailable");
  });
});

describe("feedHealthControl", () => {
  it("a company with no feed is not failing a check it never opted into", () => {
    const control = feedHealthControl({
      connectionCount: 0,
      brokenCount: 0,
      brokenNames: [],
      evaluatedAt: AT,
    });
    expect(control.status).toBe("healthy");
    expect(control.detail).toContain("by file");
  });

  it("names the feeds that need attention", () => {
    const control = feedHealthControl({
      connectionCount: 3,
      brokenCount: 2,
      brokenNames: ["First National", "Harbor Credit Union"],
      evaluatedAt: AT,
    });
    expect(control.status).toBe("attention");
    expect(control.detail).toContain("First National");
    expect(control.detail).toContain("Harbor Credit Union");
  });

  it("a broken feed is work, not a control failure that blocks anything", () => {
    // Nothing already imported becomes wrong because the next sync failed.
    const control = feedHealthControl({
      connectionCount: 1,
      brokenCount: 1,
      brokenNames: ["First National"],
      evaluatedAt: AT,
    });
    expect(control.blocking).toBe(false);
  });

  it("connections that could not be read are never reported as connected", () => {
    expect(
      feedHealthControl({
        connectionCount: null,
        brokenCount: 0,
        brokenNames: [],
        evaluatedAt: AT,
      }).status,
    ).toBe("unavailable");
  });
});

describe("statementReconciliationControl", () => {
  it("passes when every account reaches the date asked for", () => {
    const control = statementReconciliationControl({
      accountCount: 2,
      behindNames: [],
      inProgressCount: 0,
      staleBefore: "2026-07-31",
      evaluatedAt: AT,
    });
    expect(control.status).toBe("healthy");
    expect(control.detail).toContain("2026-07-31");
  });

  it("a session left open part-way is worth saying even when nothing is behind", () => {
    const control = statementReconciliationControl({
      accountCount: 2,
      behindNames: [],
      inProgressCount: 1,
      staleBefore: "2026-07-31",
      evaluatedAt: AT,
    });
    expect(control.status).toBe("attention");
    expect(control.detail).toContain("1 session");
  });

  it("names the accounts that are behind", () => {
    const control = statementReconciliationControl({
      accountCount: 3,
      behindNames: ["Operating"],
      inProgressCount: 0,
      staleBefore: "2026-07-31",
      evaluatedAt: AT,
    });
    expect(control.status).toBe("attention");
    expect(control.detail).toContain("Operating");
  });

  it("a company with no bank account has nothing to reconcile", () => {
    const control = statementReconciliationControl({
      accountCount: 0,
      behindNames: [],
      inProgressCount: 0,
      staleBefore: "2026-07-31",
      evaluatedAt: AT,
    });
    expect(control.status).toBe("healthy");
    expect(control.passCondition).toContain("once a bank account exists");
  });
});

describe("unmatchedSeverity", () => {
  it("without a policy, reports age and calls nothing late", () => {
    expect(unmatchedSeverity(3, null)).toBe("low");
    expect(unmatchedSeverity(45, null)).toBe("medium");
    expect(unmatchedSeverity(120, null)).toBe("high");
    // Nothing reaches critical without a company saying what late means.
    expect(unmatchedSeverity(3650, null)).toBe("high");
  });

  it("with a policy, the company's own limit decides", () => {
    expect(unmatchedSeverity(3, 7)).toBe("medium");
    expect(unmatchedSeverity(8, 7)).toBe("high");
    expect(unmatchedSeverity(15, 7)).toBe("critical");
  });

  it("a limit of zero is a real policy: anything unmatched is already late", () => {
    expect(unmatchedSeverity(0, 0)).toBe("medium");
    expect(unmatchedSeverity(1, 0)).toBe("critical");
  });
});
