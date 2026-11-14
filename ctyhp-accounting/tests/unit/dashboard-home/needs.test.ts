import { describe, expect, it } from "vitest";
import { dashboardNeeds, NOTHING_WAITING, type AttentionChecks } from "@/lib/domain/dashboard-needs";
import {
  homeClearLine,
  homeNeeds,
  homeUnavailableNote,
  needsByTab,
  type HomeNeedFacts,
} from "@/lib/domain/dashboard-home/needs";
import { formatBaseMoney } from "@/lib/format";

const AS_OF = "2026-11-13";

const checks: AttentionChecks = {
  backup: { lastBackup: "2026-11-10", expected: "2026-11-12" },
  waitingLines: 37,
  recurringDue: [{ name: "Sample rent", nextRunDate: "2026-11-01" }],
  neverReconciled: [],
  noLongerAgree: [],
  holding: [],
  futureDated: [],
  overBudget: null,
  unavailable: [],
};

const noFacts: HomeNeedFacts = {
  asOf: AS_OF,
  overdueInvoices: null,
  billsOverdue: null,
  billsDueSoon: null,
  cardActivity: null,
  approvals: null,
  monthsOpen: null,
  unavailable: [],
};

const facts: HomeNeedFacts = {
  asOf: AS_OF,
  overdueInvoices: { count: 4, amountMinor: 18_750_00, oldestDaysLate: 97 },
  billsOverdue: { count: 1, amountMinor: 2_800_00, oldestDaysLate: 12 },
  billsDueSoon: { count: 2, amountMinor: 4_200_00, firstDueDate: "2026-11-16" },
  cardActivity: { cards: 1, lines: 14, amountMinor: 1_234_56 },
  approvals: 3,
  monthsOpen: { count: 1, oldestPeriodEnd: "2026-10-31" },
  unavailable: [],
};

describe("homeNeeds", () => {
  it("puts each existing check on its tab with its button's word", () => {
    const needs = homeNeeds(dashboardNeeds(checks, formatBaseMoney), noFacts, formatBaseMoney);
    expect(needs.map((n) => [n.key, n.tab, n.tone, n.action])).toEqual([
      ["backup", "banking", "danger", "Review"],
      ["waiting", "banking", "warning", "Code"],
      ["recurringDue", "overview", "warning", "Post"],
    ]);
    // The rest of the row is the existing check's own.
    expect(needs[1]).toMatchObject({ title: "Bank lines waiting to be coded", href: "/banking?queue=unmatched", count: 37 });
  });

  it("maps all eight existing kinds", () => {
    const every: AttentionChecks = {
      backup: { lastBackup: null, expected: "2026-11-12" },
      waitingLines: 1,
      recurringDue: [{ name: "Sample", nextRunDate: "2026-11-01" }],
      neverReconciled: [{ bankAccountId: "b", accountName: "Sample Checking", balanceMinor: 1_00, lastReconciledDate: null } as never],
      noLongerAgree: [{ accountName: "Sample Checking", statementEndingDate: "2026-10-31" } as never],
      holding: [{ accountCode: "1999", name: "Sample Suspense", balanceMinor: 1_00 } as never],
      futureDated: [{ entryNumber: "JE-1", entryDate: "2027-11-13" } as never],
      overBudget: [{ accountCode: "6100", name: "Sample", actualMinor: 2_00, budgetMinor: 1_00 }],
      unavailable: [],
    };
    const needs = homeNeeds(dashboardNeeds(every, formatBaseMoney), noFacts, formatBaseMoney);
    expect(Object.fromEntries(needs.map((n) => [n.key, `${n.tab}:${n.action}`]))).toEqual({
      waiting: "banking:Code",
      neverReconciled: "banking:Reconcile",
      noLongerAgree: "banking:Review",
      backup: "banking:Review",
      recurringDue: "overview:Post",
      holding: "overview:Review",
      futureDated: "overview:Review",
      overBudget: "overview:Review",
    });
  });

  it("adds the money rows, danger first, then warning, then info, keeping the order inside each tone", () => {
    const needs = homeNeeds(dashboardNeeds(checks, formatBaseMoney), facts, formatBaseMoney);
    expect(needs.map((n) => [n.key, n.tone])).toEqual([
      ["backup", "danger"],
      ["overdueInvoices", "danger"],
      ["billsOverdue", "danger"],
      ["waiting", "warning"],
      ["recurringDue", "warning"],
      ["billsDueSoon", "warning"],
      ["cardActivity", "warning"],
      ["approvals", "info"],
      ["monthsOpen", "info"],
    ]);
  });

  it("words the money rows in base currency and links them to their queues", () => {
    const byKey = Object.fromEntries(homeNeeds([], facts, formatBaseMoney).map((n) => [n.key, n]));
    expect(byKey.overdueInvoices).toEqual({
      key: "overdueInvoices",
      tab: "money-in",
      count: 4,
      tone: "danger",
      title: "Invoices overdue",
      detail: "$18,750.00 · oldest 97 days late",
      href: "/invoices?queue=overdue&asOf=2026-11-13",
      action: "Review",
    });
    expect(byKey.billsOverdue).toMatchObject({ tab: "money-out", title: "Bill overdue", detail: "$2,800.00 · oldest 12 days late", href: "/bills?queue=due&through=2026-11-20", action: "Pay" });
    expect(byKey.billsDueSoon).toMatchObject({ tab: "money-out", tone: "warning", title: "Bills due in the next 7 days", detail: "$4,200.00 · first on 11/16/2026", href: "/bills?queue=due&through=2026-11-20", action: "Pay" });
    expect(byKey.cardActivity).toMatchObject({ tab: "banking", count: 14, title: "Card activity not reconciled", href: "/banking/reconcile", action: "Reconcile" });
    expect(byKey.cardActivity.detail).toContain("$1,234.56");
    expect(byKey.approvals).toMatchObject({ tab: "overview", tone: "info", count: 3, title: "Approvals waiting", href: "/approvals", action: "Approve" });
    expect(byKey.monthsOpen).toMatchObject({ tab: "banking", tone: "info", title: "Month not closed", detail: "October 2026 has ended and is still open", href: "/accounting?mode=close", action: "Continue" });
  });

  it("leaves out a row with nothing to count", () => {
    const quiet: HomeNeedFacts = { ...facts, approvals: 0, cardActivity: { cards: 1, lines: 0, amountMinor: 0 }, monthsOpen: { count: 0, oldestPeriodEnd: "2026-10-31" } };
    expect(homeNeeds([], quiet, formatBaseMoney).map((n) => n.key)).toEqual(["overdueInvoices", "billsOverdue", "billsDueSoon"]);
  });
});

describe("needsByTab", () => {
  it("counts every row on Overview and each tab's own rows on the others", () => {
    const needs = homeNeeds(dashboardNeeds(checks, formatBaseMoney), facts, formatBaseMoney);
    expect(needsByTab(needs)).toEqual({ overview: 9, "money-in": 1, "money-out": 2, banking: 4 });
    expect(needsByTab([])).toEqual({ overview: 0, "money-in": 0, "money-out": 0, banking: 0 });
  });
});

describe("when checks could not run", () => {
  it("names them, and is clear only about the checks that ran", () => {
    expect(homeUnavailableNote([])).toBeNull();
    expect(homeUnavailableNote(["overdueInvoices"])).toBe("1 check could not run just now, so overdue invoices is not counted here.");
    expect(homeUnavailableNote(["waiting", "approvals", "billsOverdue", "billsDueSoon", "monthsOpen"])).toBe(
      "5 checks could not run just now, so lines waiting on Bank Transactions, approvals waiting, overdue bills and 2 more are not counted here.",
    );
    expect(homeClearLine([], 14)).toBe(NOTHING_WAITING);
    expect(homeClearLine(["approvals"], 14)).toBe("Nothing is waiting among the checks that ran.");
    expect(homeClearLine(["approvals", "monthsOpen"], 2)).toBeNull();
  });
});
