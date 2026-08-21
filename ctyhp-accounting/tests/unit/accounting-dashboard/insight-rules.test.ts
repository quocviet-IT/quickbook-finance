import { describe, expect, it } from "vitest";
import { buildInsights, type InsightFacts } from "@/lib/domain/accounting-dashboard/insight-rules";
import { EMPTY_WORK_POLICY } from "@/lib/domain/accounting-dashboard/policy";
import {
  approvalsControl,
  subledgerControl,
  trialBalanceControl,
} from "@/lib/domain/accounting-dashboard/control-status";

const AT = "2026-08-21T09:00:00Z";
const TODAY = "2026-08-21";

/** Nothing wrong anywhere. Every rule's negative case starts here. */
const QUIET: InsightFacts = {
  asOf: TODAY,
  generatedAsOf: AT,
  policy: EMPTY_WORK_POLICY,
  controls: [
    trialBalanceControl({ balanced: true, differenceMinor: 0, evaluatedAt: AT }),
    subledgerControl("ar-to-gl", { differenceMinor: 0, evaluatedAt: AT }),
  ],
  overduePeriods: [],
  approvals: { pendingCount: 0, oldestAgeDays: null },
  unmatchedBank: { count: 0, oldestAgeDays: null },
  failedRecurringRuns: [],
  overdueAr: { nowMinor: 0, priorMinor: 0, rows: [] },
  overdueAp: { nowMinor: 0, priorMinor: 0, rows: [] },
  comparisonLabel: "July 2026",
};

const keys = (facts: InsightFacts) => buildInsights(facts).map((i) => i.ruleKey);

describe("buildInsights — determinism", () => {
  it("gives the same answer for the same facts, every time", () => {
    // The acceptance criterion the whole engine hangs on: no clock is read
    // inside a rule, so nothing about the output can drift between calls.
    const facts = { ...QUIET, overduePeriods: [{ id: "p1", label: "July 2026", periodEnd: "2026-07-31" }] };
    expect(JSON.stringify(buildInsights(facts))).toBe(JSON.stringify(buildInsights(facts)));
  });

  it("says nothing at all when nothing is wrong", () => {
    expect(buildInsights(QUIET)).toEqual([]);
  });
});

describe("trial-balance-out.v1", () => {
  it("fires when the ledger does not balance, and carries the difference", () => {
    const facts: InsightFacts = {
      ...QUIET,
      controls: [trialBalanceControl({ balanced: false, differenceMinor: 500, evaluatedAt: AT })],
    };
    const [insight] = buildInsights(facts);
    expect(insight.ruleKey).toBe("trial-balance-out.v1");
    expect(insight.severity).toBe("critical");
    expect(insight.amountMinor).toBe(500);
    expect(insight.evidence.length).toBeGreaterThan(0);
    expect(insight.recommendedAction.href).toBe("/reports?report=trial");
    expect(insight.generatedAsOf).toBe(AT);
  });

  it("does not fire when the ledger balances", () => {
    expect(keys(QUIET)).not.toContain("trial-balance-out.v1");
  });

  it("says nothing when the control could not be evaluated", () => {
    // Missing data is not evidence of a problem. An insight here would be a
    // claim about the books made from not having looked at them.
    const facts: InsightFacts = {
      ...QUIET,
      controls: [subledgerControl("ar-to-gl", { differenceMinor: null, evaluatedAt: AT })],
    };
    expect(keys(facts)).not.toContain("subledger-out.v1");
  });
});

describe("period-open-past-end.v1", () => {
  it("fires for a period still open after the last day it covers", () => {
    const facts: InsightFacts = {
      ...QUIET,
      overduePeriods: [
        { id: "p1", label: "June 2026", periodEnd: "2026-06-30" },
        { id: "p2", label: "July 2026", periodEnd: "2026-07-31" },
      ],
    };
    const [insight] = buildInsights(facts).filter((i) => i.ruleKey === "period-open-past-end.v1");
    expect(insight.summary).toMatch(/2 periods/);
    // The oldest is what a reader needs: it is the one holding everything up.
    expect(insight.summary).toMatch(/June 2026/);
    expect(insight.ageDays).toBe(52);
  });

  it("does not fire when every period is closed on time", () => {
    expect(keys(QUIET)).not.toContain("period-open-past-end.v1");
  });
});

describe("approval-beyond-sla.v1", () => {
  const waiting: InsightFacts = {
    ...QUIET,
    approvals: { pendingCount: 3, oldestAgeDays: 5 },
    controls: [approvalsControl({ pendingCount: 3, oldestAgeDays: 5, evaluatedAt: AT })],
  };

  it("stays asleep while nobody has set an SLA", () => {
    // The rule that most needs a policy: without one there is no such thing as
    // "late", and firing anyway would be inventing the company's deadline.
    expect(keys(waiting)).not.toContain("approval-beyond-sla.v1");
  });

  it("fires once the SLA is set and something has waited longer", () => {
    const facts = { ...waiting, policy: { ...EMPTY_WORK_POLICY, approvalSlaDays: 3 } };
    const [insight] = buildInsights(facts).filter((i) => i.ruleKey === "approval-beyond-sla.v1");
    expect(insight.summary).toMatch(/5 days/);
    expect(insight.ageDays).toBe(5);
  });

  it("does not fire at exactly the SLA — the day it is due is not late", () => {
    const facts = {
      ...waiting,
      approvals: { pendingCount: 1, oldestAgeDays: 3 },
      policy: { ...EMPTY_WORK_POLICY, approvalSlaDays: 3 },
    };
    expect(keys(facts)).not.toContain("approval-beyond-sla.v1");
  });

  it("honours an SLA of zero — a company may mean it", () => {
    const facts = {
      ...waiting,
      approvals: { pendingCount: 1, oldestAgeDays: 1 },
      policy: { ...EMPTY_WORK_POLICY, approvalSlaDays: 0 },
    };
    expect(keys(facts)).toContain("approval-beyond-sla.v1");
  });

  it("says nothing when nothing is waiting, whatever the SLA", () => {
    const facts = { ...QUIET, policy: { ...EMPTY_WORK_POLICY, approvalSlaDays: 0 } };
    expect(keys(facts)).not.toContain("approval-beyond-sla.v1");
  });
});

describe("overdue-ar-increased.v1", () => {
  const rows = [
    { entityId: "c1", entityName: "Aurora Retail", balanceMinor: 700_00 },
    { entityId: "c2", entityName: "Harbor Metals", balanceMinor: 200_00 },
    { entityId: "c3", entityName: "Elena Brooks", balanceMinor: 100_00 },
  ];

  it("fires when overdue receivables grew, and names where it is concentrated", () => {
    const facts: InsightFacts = {
      ...QUIET,
      overdueAr: { nowMinor: 1_000_00, priorMinor: 400_00, rows },
    };
    const [insight] = buildInsights(facts).filter((i) => i.ruleKey === "overdue-ar-increased.v1");
    expect(insight.changePercent).toBe(150);
    // The headline figure of "it grew" is the growth, not the total. The total
    // is in the summary, where a reader can see both at once.
    expect(insight.amountMinor).toBe(60_000);
    expect(insight.summary).toMatch(/1,000\.00/);
    // Concentration, never causation.
    expect(insight.summary).toMatch(/represent/i);
    expect(insight.summary).not.toMatch(/caused|because/i);
    expect(insight.evidence.some((e) => String(e.value).includes("Aurora Retail"))).toBe(true);
  });

  it("does not fire when overdue receivables fell", () => {
    const facts: InsightFacts = {
      ...QUIET,
      overdueAr: { nowMinor: 100_00, priorMinor: 400_00, rows },
    };
    expect(keys(facts)).not.toContain("overdue-ar-increased.v1");
  });

  it("does not fire on an increase below the materiality a company set", () => {
    const facts: InsightFacts = {
      ...QUIET,
      policy: { ...EMPTY_WORK_POLICY, materialityMinor: 50_000 },
      overdueAr: { nowMinor: 41_000, priorMinor: 40_000, rows },
    };
    expect(keys(facts)).not.toContain("overdue-ar-increased.v1");
  });

  it("fires on any increase when no materiality has been set", () => {
    // Unconfigured must not silently mean "ignore everything small". With no
    // threshold the honest behaviour is to report and let a person judge.
    const facts: InsightFacts = {
      ...QUIET,
      overdueAr: { nowMinor: 41_000, priorMinor: 40_000, rows },
    };
    expect(keys(facts)).toContain("overdue-ar-increased.v1");
  });

  it("says nothing when there was nothing before and nothing now", () => {
    expect(keys(QUIET)).not.toContain("overdue-ar-increased.v1");
  });
});

describe("recurring-run-failed.v1", () => {
  it("fires and names the template", () => {
    const facts: InsightFacts = {
      ...QUIET,
      failedRecurringRuns: [{ id: "r1", templateName: "Monthly rent", runDate: "2026-08-15" }],
    };
    const [insight] = buildInsights(facts).filter((i) => i.ruleKey === "recurring-run-failed.v1");
    expect(insight.summary).toMatch(/Monthly rent/);
    expect(insight.recommendedAction.href).toBe("/recurring");
  });

  it("does not fire when every run posted", () => {
    expect(keys(QUIET)).not.toContain("recurring-run-failed.v1");
  });
});

describe("every insight", () => {
  it("carries evidence, a timestamp, and somewhere to go", () => {
    const facts: InsightFacts = {
      ...QUIET,
      policy: { materialityMinor: 0, approvalSlaDays: 1, unmatchedBankAgeDays: 7 },
      controls: [trialBalanceControl({ balanced: false, differenceMinor: 5, evaluatedAt: AT })],
      overduePeriods: [{ id: "p1", label: "June 2026", periodEnd: "2026-06-30" }],
      approvals: { pendingCount: 2, oldestAgeDays: 9 },
      unmatchedBank: { count: 4, oldestAgeDays: 30 },
      failedRecurringRuns: [{ id: "r1", templateName: "Rent", runDate: "2026-08-01" }],
      overdueAr: { nowMinor: 900_00, priorMinor: 100_00, rows: [] },
    };
    const insights = buildInsights(facts);
    expect(insights.length).toBeGreaterThanOrEqual(6);
    for (const insight of insights) {
      expect(insight.ruleKey).toMatch(/\.v\d+$/);
      expect(insight.evidence.length).toBeGreaterThan(0);
      expect(insight.generatedAsOf).toBe(AT);
      expect(insight.recommendedAction.href.startsWith("/")).toBe(true);
      expect(insight.summary.length).toBeGreaterThan(10);
    }
  });

  it("puts the worst first", () => {
    const facts: InsightFacts = {
      ...QUIET,
      controls: [trialBalanceControl({ balanced: false, differenceMinor: 5, evaluatedAt: AT })],
      failedRecurringRuns: [{ id: "r1", templateName: "Rent", runDate: "2026-08-01" }],
    };
    expect(buildInsights(facts)[0].ruleKey).toBe("trial-balance-out.v1");
  });
});
