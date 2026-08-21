import { describe, expect, it } from "vitest";
import {
  approvalsStep,
  bankReconciledStep,
  blockingFirst,
  closeHistoryEntry,
  closeProgress,
  closeRecommendation,
  controlAccountStep,
  draftDocumentsStep,
  medianDaysToClose,
  trialBalanceStep,
  type CloseStep,
} from "@/lib/domain/accounting-dashboard/close-checklist";

const PERIOD_END = "2026-03-31";
const PERIOD_START = "2026-03-01";

function step(overrides: Partial<CloseStep> = {}): CloseStep {
  return {
    key: "k",
    title: "t",
    status: "complete",
    passCondition: "p",
    evidence: "e",
    blocksClose: false,
    href: "/",
    workKey: null,
    ...overrides,
  };
}

describe("closeProgress", () => {
  it("reconciles: complete plus outstanding is exactly what applies", () => {
    // The spec's acceptance criterion, as an invariant. Every combination of
    // statuses has to satisfy it, not just the tidy ones.
    const combinations: CloseStep["status"][][] = [
      ["complete", "complete", "outstanding"],
      ["complete", "not-applicable", "unavailable"],
      ["unavailable", "unavailable"],
      ["not-applicable"],
      [],
      ["outstanding", "outstanding", "not-applicable", "unavailable", "complete"],
    ];
    for (const statuses of combinations) {
      const progress = closeProgress(statuses.map((status) => step({ status })));
      expect(progress.complete + progress.outstanding).toBe(progress.applicable);
      expect(
        progress.applicable + progress.notApplicable + progress.unavailable,
      ).toBe(statuses.length);
    }
  });

  it("a step nobody could check is neither progress nor failure", () => {
    const progress = closeProgress([
      step({ status: "complete" }),
      step({ status: "unavailable" }),
    ]);
    expect(progress.complete).toBe(1);
    expect(progress.outstanding).toBe(0);
    expect(progress.unavailable).toBe(1);
    // Not 50%. One of two applicable steps is done, and the other one is not a
    // step that applies — it is a step that could not be read.
    expect(progress.percent).toBe(100);
  });

  it("a percentage of nothing is null, not zero", () => {
    expect(closeProgress([]).percent).toBeNull();
    expect(closeProgress([step({ status: "not-applicable" })]).percent).toBeNull();
  });
});

describe("blockingFirst", () => {
  it("puts the thing that stops the close above the thing that does not", () => {
    const ordered = blockingFirst([
      step({ title: "done", status: "complete" }),
      step({ title: "advisory", status: "outstanding", blocksClose: false }),
      step({ title: "blocker", status: "outstanding", blocksClose: true }),
      step({ title: "unknown", status: "unavailable" }),
      step({ title: "n/a", status: "not-applicable" }),
    ]);
    expect(ordered.map((s) => s.title)).toEqual([
      "blocker",
      "advisory",
      "unknown",
      "done",
      "n/a",
    ]);
  });
});

describe("trialBalanceStep", () => {
  it("passes on a balanced ledger and names the date it checked", () => {
    const s = trialBalanceStep({ periodEnd: PERIOD_END, differenceMinor: 0 });
    expect(s.status).toBe("complete");
    expect(s.evidence).toContain(PERIOD_END);
    expect(s.blocksClose).toBe(true);
  });

  it("reports the difference rather than only that there is one", () => {
    const s = trialBalanceStep({ periodEnd: PERIOD_END, differenceMinor: -125_00 });
    expect(s.status).toBe("outstanding");
    expect(s.evidence).toContain("125.00");
  });

  it("a ledger that could not be read is never reported as balanced", () => {
    expect(trialBalanceStep({ periodEnd: PERIOD_END, differenceMinor: null }).status).toBe(
      "unavailable",
    );
  });
});

describe("controlAccountStep", () => {
  const base = { controlKey: "ar", label: "Accounts Receivable", periodEnd: PERIOD_END };

  it("ties when both sides read the same", () => {
    const s = controlAccountStep({
      ...base,
      hasSubledger: true,
      subledgerMinor: 500_00,
      controlMinor: 500_00,
    });
    expect(s.status).toBe("complete");
    expect(s.evidence).toContain("500.00");
  });

  it("shows both sides and the difference when it is out", () => {
    const s = controlAccountStep({
      ...base,
      hasSubledger: true,
      subledgerMinor: 500_00,
      controlMinor: 450_00,
    });
    expect(s.status).toBe("outstanding");
    expect(s.evidence).toContain("500.00");
    expect(s.evidence).toContain("450.00");
    expect(s.evidence).toContain("50.00");
  });

  it("no subledger and an empty control account is not applicable, not a failure", () => {
    const s = controlAccountStep({
      controlKey: "inventory",
      label: "Inventory",
      periodEnd: PERIOD_END,
      hasSubledger: false,
      subledgerMinor: 0,
      controlMinor: 0,
    });
    expect(s.status).toBe("not-applicable");
  });

  it("no subledger but a balance is outstanding, because the close gate refuses it", () => {
    // acc_period_close_blockers treats a control with no subledger as out by
    // its whole balance. If this said "not applicable" the screen would promise
    // a close the database is about to refuse.
    const s = controlAccountStep({
      controlKey: "inventory",
      label: "Inventory",
      periodEnd: PERIOD_END,
      hasSubledger: false,
      subledgerMinor: 0,
      controlMinor: 900_00,
    });
    expect(s.status).toBe("outstanding");
    expect(s.blocksClose).toBe(true);
    expect(s.evidence).toContain("900.00");
  });
});

describe("draftDocumentsStep", () => {
  it("is outstanding while a draft is dated inside the period", () => {
    const s = draftDocumentsStep({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      draftCount: 2,
    });
    expect(s.status).toBe("outstanding");
    expect(s.evidence).toContain("2 documents");
    // A draft has not posted, so it cannot put the ledger out.
    expect(s.blocksClose).toBe(false);
  });

  it("reads as one document, not 1 documents", () => {
    const s = draftDocumentsStep({
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      draftCount: 1,
    });
    expect(s.evidence).toContain("1 document ");
    expect(s.evidence).toContain(" is ");
  });

  it("passes when nothing is left in draft", () => {
    expect(
      draftDocumentsStep({ periodStart: PERIOD_START, periodEnd: PERIOD_END, draftCount: 0 })
        .status,
    ).toBe("complete");
  });
});

describe("bankReconciledStep", () => {
  it("passes only when the reconciliation reaches the period end", () => {
    expect(
      bankReconciledStep({
        periodEnd: PERIOD_END,
        hasBankAccount: true,
        lastCompletedOn: "2026-03-31",
        unmatchedCount: 0,
      }).status,
    ).toBe("complete");
  });

  it("a reconciliation that stops short of the period end is not enough", () => {
    const s = bankReconciledStep({
      periodEnd: PERIOD_END,
      hasBankAccount: true,
      lastCompletedOn: "2026-02-28",
      unmatchedCount: 0,
    });
    expect(s.status).toBe("outstanding");
    expect(s.evidence).toContain("2026-02-28");
  });

  it("a company with no bank account has nothing to reconcile", () => {
    expect(
      bankReconciledStep({
        periodEnd: PERIOD_END,
        hasBankAccount: false,
        lastCompletedOn: null,
        unmatchedCount: 0,
      }).status,
    ).toBe("not-applicable");
  });

  it("banking that did not answer is never reported as reconciled", () => {
    expect(
      bankReconciledStep({
        periodEnd: PERIOD_END,
        hasBankAccount: true,
        lastCompletedOn: "2026-03-31",
        unmatchedCount: null,
      }).status,
    ).toBe("unavailable");
  });
});

describe("approvalsStep", () => {
  it("counts only what was requested by the period end", () => {
    const s = approvalsStep({ periodEnd: PERIOD_END, pendingCount: 3 });
    expect(s.status).toBe("outstanding");
    expect(s.evidence).toContain(PERIOD_END);
  });

  it("an unreadable queue is not an empty queue", () => {
    expect(approvalsStep({ periodEnd: PERIOD_END, pendingCount: null }).status).toBe(
      "unavailable",
    );
  });
});

describe("closeRecommendation", () => {
  it("an overdue period recommends close mode without any policy at all", () => {
    const r = closeRecommendation({
      today: "2026-04-10",
      overdueCount: 1,
      oldestOverdueLabel: "March 2026",
      currentPeriodEnd: "2026-04-30",
      closeWindowDays: null,
    });
    expect(r.recommended).toBe(true);
    expect(r.reason).toContain("March 2026");
    expect(r.sleepingOn).toBeNull();
  });

  it("names the oldest when several are overdue", () => {
    const r = closeRecommendation({
      today: "2026-04-10",
      overdueCount: 3,
      oldestOverdueLabel: "January 2026",
      currentPeriodEnd: "2026-04-30",
      closeWindowDays: null,
    });
    expect(r.reason).toContain("3 periods");
    expect(r.reason).toContain("January 2026");
  });

  it("without a window nobody chose, the approaching-deadline trigger sleeps and says so", () => {
    const r = closeRecommendation({
      today: "2026-04-29",
      overdueCount: 0,
      oldestOverdueLabel: null,
      currentPeriodEnd: "2026-04-30",
      closeWindowDays: null,
    });
    expect(r.recommended).toBe(false);
    expect(r.sleepingOn).toBe("closeWindowDays");
  });

  it("recommends inside the window the company set", () => {
    const r = closeRecommendation({
      today: "2026-04-27",
      overdueCount: 0,
      oldestOverdueLabel: null,
      currentPeriodEnd: "2026-04-30",
      closeWindowDays: 5,
    });
    expect(r.recommended).toBe(true);
    expect(r.reason).toContain("3 days");
  });

  it("stays quiet outside the window", () => {
    const r = closeRecommendation({
      today: "2026-04-10",
      overdueCount: 0,
      oldestOverdueLabel: null,
      currentPeriodEnd: "2026-04-30",
      closeWindowDays: 5,
    });
    expect(r.recommended).toBe(false);
    expect(r.sleepingOn).toBeNull();
  });

  it("a window of zero means the last day only, and is a real policy", () => {
    const onTheDay = closeRecommendation({
      today: "2026-04-30",
      overdueCount: 0,
      oldestOverdueLabel: null,
      currentPeriodEnd: "2026-04-30",
      closeWindowDays: 0,
    });
    expect(onTheDay.recommended).toBe(true);
    expect(onTheDay.reason).toContain("ends today");

    const dayBefore = closeRecommendation({
      today: "2026-04-29",
      overdueCount: 0,
      oldestOverdueLabel: null,
      currentPeriodEnd: "2026-04-30",
      closeWindowDays: 0,
    });
    expect(dayBefore.recommended).toBe(false);
    // Zero is a decision, so the trigger is awake — it simply has not fired.
    expect(dayBefore.sleepingOn).toBeNull();
  });
});

describe("days to close", () => {
  it("measures from the period end to the day it was closed", () => {
    const entry = closeHistoryEntry({
      periodLabel: "March 2026",
      periodEnd: "2026-03-31",
      closedAt: "2026-04-12T09:30:00.000Z",
    });
    expect(entry?.daysToClose).toBe(12);
    expect(entry?.closedOn).toBe("2026-04-12");
  });

  it("never reports a negative number of days", () => {
    const entry = closeHistoryEntry({
      periodLabel: "March 2026",
      periodEnd: "2026-03-31",
      closedAt: "2026-03-20T09:30:00.000Z",
    });
    expect(entry?.daysToClose).toBe(0);
  });

  it("one close is not a typical figure", () => {
    const one = [
      closeHistoryEntry({ periodLabel: "M", periodEnd: "2026-03-31", closedAt: "2026-04-12" })!,
    ];
    expect(medianDaysToClose(one)).toBeNull();
  });

  it("takes the middle of what actually happened", () => {
    const history = [
      closeHistoryEntry({ periodLabel: "A", periodEnd: "2026-01-31", closedAt: "2026-02-05" })!,
      closeHistoryEntry({ periodLabel: "B", periodEnd: "2026-02-28", closedAt: "2026-03-20" })!,
      closeHistoryEntry({ periodLabel: "C", periodEnd: "2026-03-31", closedAt: "2026-04-10" })!,
    ];
    // 5, 20, 10 → sorted 5, 10, 20 → 10
    expect(medianDaysToClose(history)).toBe(10);
  });
});
