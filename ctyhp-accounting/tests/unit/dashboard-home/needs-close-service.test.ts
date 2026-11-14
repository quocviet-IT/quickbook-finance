import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionChecks } from "@/lib/domain/dashboard-needs";

const attention = vi.hoisted(() => ({ checks: null as unknown, fail: false, calls: [] as unknown[] }));
const close = vi.hoisted(() => ({ readiness: null as unknown, contexts: [] as unknown[] }));

vi.mock("@/lib/services/exceptions", () => ({
  getAttentionChecks: vi.fn(async (...args: unknown[]) => {
    attention.calls.push(args);
    if (attention.fail) throw new Error("boom");
    return attention.checks;
  }),
}));
vi.mock("@/lib/services/accounting-dashboard/context", () => ({
  getAccountingContext: vi.fn(async () => ({
    asOf: "2026-11-14",
    currencyCode: "USD",
    currencyDecimals: 2,
    timeZone: "America/New_York",
    accountingBasis: "Accrual basis",
    fiscalYear: 2026,
    periods: [
      { id: "p9", label: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-09-30", status: "closed" },
      { id: "p10", label: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "open" },
      { id: "p11", label: "2026-11", periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "open" },
    ],
    currentPeriod: null,
    overduePeriods: [],
  })),
}));
vi.mock("@/lib/services/accounting-dashboard/close-readiness", () => ({
  getCloseReadiness: vi.fn(async (_sb: unknown, context: unknown) => {
    close.contexts.push(context);
    return close.readiness;
  }),
}));

import { getDashboardHome, getHomeClose, getHomeNeeds } from "@/lib/services/dashboard-home";
import { createRequestMemo } from "@/lib/services/request-memo";
import { fakeSupabase, type FakeHandlers } from "./fake-supabase";

const AS_OF = "2026-11-13";
const USD = { code: "USD", decimals: 2 };

const CLEAR: AttentionChecks = {
  waitingLines: 0,
  recurringDue: [],
  neverReconciled: [],
  noLongerAgree: [],
  holding: [],
  futureDated: [],
  overBudget: null,
  unavailable: [],
};

function handlers(over: FakeHandlers["rpc"] = {}): FakeHandlers {
  return {
    rpc: {
      acc_ar_ageing: () => ({
        data: [
          { customer_id: "c1", customer_name: "Sample Retail Co.", doc_type: "invoice", doc_number: "INV-1", doc_date: "2026-07-09", due_date: "2026-08-08", balance_minor: 7_400_00 },
          { customer_id: "c2", customer_name: "Demo Boutique LLC", doc_type: "invoice", doc_number: "INV-2", doc_date: "2026-10-01", due_date: "2026-12-01", balance_minor: 1_000_00 },
        ],
      }),
      acc_ap_ageing: () => ({
        data: [
          { vendor_id: "v1", vendor_name: "Demo Metals Supply", doc_type: "bill", doc_number: "B-1", doc_date: "2026-10-02", due_date: "2026-11-01", balance_minor: 2_800_00 },
          { vendor_id: "v2", vendor_name: "Sample Packaging Co.", doc_type: "bill", doc_number: "B-2", doc_date: "2026-10-17", due_date: "2026-11-16", balance_minor: 2_750_00 },
          { vendor_id: "v1", vendor_name: "Demo Metals Supply", doc_type: "vendor_credit", doc_number: "VC-1", doc_date: "2026-11-02", due_date: "2026-11-02", balance_minor: -100_00 },
        ],
      }),
      acc_ledger_balances: () => ({ data: [] }),
      // Debit positive as the books keep a card: charges are negative.
      acc_unreconciled_cards: () => ({ data: [{ card_count: 1, item_count: "14", amount_minor: "-123456" }] }),
      ...over,
    },
    tables: {
      acc_approval_request: () => ({ count: 3 }),
      acc_accounting_period: () => ({ data: [{ period_end: "2026-09-30" }], count: 2 }),
    },
  };
}

beforeEach(() => {
  attention.checks = CLEAR;
  attention.fail = false;
  attention.calls = [];
  close.readiness = null;
  close.contexts = [];
});

describe("getHomeNeeds", () => {
  it("adds the money rows to the existing checks, in base currency from the aging reports", async () => {
    attention.checks = { ...CLEAR, waitingLines: 37 };
    const { sb } = fakeSupabase(handlers());
    const report = await getHomeNeeds(sb, { asOf: AS_OF, baseCurrency: USD, backups: false });
    expect(report.needs.map((n) => [n.key, n.count, n.tab, n.tone, n.action])).toEqual([
      ["overdueInvoices", 1, "money-in", "danger", "Review"],
      ["billsOverdue", 1, "money-out", "danger", "Pay"],
      ["waiting", 37, "banking", "warning", "Code"],
      ["billsDueSoon", 1, "money-out", "warning", "Pay"],
      ["cardActivity", 14, "banking", "warning", "Reconcile"],
      ["approvals", 3, "overview", "info", "Approve"],
      ["monthsOpen", 2, "banking", "info", "Continue"],
    ]);
    const byKey = Object.fromEntries(report.needs.map((n) => [n.key, n]));
    expect(byKey.overdueInvoices.detail).toBe("$7,400.00 · oldest 97 days late");
    // The card's charges as its statement prints them: positive.
    expect(byKey.cardActivity.detail).toContain("$1,234.56 on 1 card");
    expect(byKey.monthsOpen.detail).toBe("The oldest is September 2026");
    expect(report.note).toBeNull();
    // The backup check is asked for only for someone who may see the backups.
    expect(attention.calls[0]).toEqual([sb, AS_OF, { backups: false }]);
  });

  it("is clear only about the checks that ran, and names those that could not", async () => {
    const { sb } = fakeSupabase(handlers({ acc_ap_ageing: () => ({ error: { message: "boom" } }), acc_ar_ageing: () => ({ data: [] }), acc_unreconciled_cards: () => ({ data: [{ card_count: 0, item_count: 0, amount_minor: 0 }] }) }));
    const quiet = { ...handlers(), tables: { acc_approval_request: () => ({ count: 0 }), acc_accounting_period: () => ({ data: [], count: 0 }) } };
    const { sb: clearSb } = fakeSupabase({ ...quiet, rpc: { ...quiet.rpc, acc_ar_ageing: () => ({ data: [] }), acc_ap_ageing: () => ({ data: [] }), acc_unreconciled_cards: () => ({ data: [] }) } });
    const clear = await getHomeNeeds(clearSb, { asOf: AS_OF, baseCurrency: USD, backups: true });
    expect(clear).toEqual({ needs: [], clear: "Nothing is waiting. Every check came back clear.", note: null });

    const partly = await getHomeNeeds(sb, { asOf: AS_OF, baseCurrency: USD, backups: true });
    expect(partly.needs.map((n) => n.key)).not.toContain("billsOverdue");
    expect(partly.note).toBe("2 checks could not run just now, so overdue bills and bills due in the next 7 days are not counted here.");
    expect(partly.clear).toBe("Nothing is waiting among the checks that ran.");
  });

  it("counts every existing check unavailable when they could not be read at all", async () => {
    attention.fail = true;
    const { sb } = fakeSupabase(handlers());
    const report = await getHomeNeeds(sb, { asOf: AS_OF, baseCurrency: USD, backups: false });
    expect(report.note).toMatch(/^7 checks could not run just now/);
    expect(report.needs.map((n) => n.key)).toContain("overdueInvoices");
  });

  it("shares the aging reads with getDashboardHome through the request's memo", async () => {
    const { sb, requests } = fakeSupabase(handlers());
    const memo = createRequestMemo();
    await getDashboardHome(sb, { asOf: AS_OF, fiscalStartMonth: 1, baseCurrency: USD, memo });
    await getHomeNeeds(sb, { asOf: AS_OF, baseCurrency: USD, backups: false, memo });
    expect(requests.filter((r) => r === "rpc:acc_ar_ageing")).toHaveLength(1);
    expect(requests.filter((r) => r === "rpc:acc_ap_ageing")).toHaveLength(1);
  });

  it("reads the cards' figure here now, as the statement prints it (the place unreconciled-cards-247 pins)", () => {
    const src = readFileSync(join(process.cwd(), "lib/services/dashboard-home/index.ts"), "utf8").replaceAll("\r\n", "\n");
    expect(src).toMatch(/sb\.rpc\("acc_unreconciled_cards", \{ p_as_of: asOf \}\)/);
    expect(src).toMatch(/shown\(Number\(c\.amount_minor \?\? 0\), "card"\)/);
  });
});

describe("getHomeClose", () => {
  it("is null when the company has no period to close", async () => {
    const { sb } = fakeSupabase({});
    await expect(getHomeClose(sb, { asOf: AS_OF })).resolves.toBeNull();
  });

  it("turns the real checklist into the widget's steps, on the page's own day", async () => {
    close.readiness = {
      period: { id: "p10", label: "2026-10", periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "open" },
      steps: [
        { key: "trial-balance", title: "The trial balance balances", status: "complete", passCondition: "", evidence: "", blocksClose: true, href: "/reports?report=trial&asOf=2026-10-31", workKey: null },
        { key: "bank-reconciled", title: "The bank is reconciled through the period end", status: "outstanding", passCondition: "", evidence: "", blocksClose: true, href: "/banking/reconcile", workKey: null },
        { key: "depreciation-posted", title: "Depreciation is posted", status: "not-applicable", passCondition: "", evidence: "", blocksClose: false, href: "/fixed-assets", workKey: null },
      ],
      progress: { complete: 1, outstanding: 1, notApplicable: 1, unavailable: 0, applicable: 2, percent: 50 },
      gateBlockers: null,
      history: [{ periodLabel: "2026-09", periodEnd: "2026-09-30", closedOn: "2026-10-08", daysToClose: 8 }],
      medianDaysToClose: null,
    };
    const { sb } = fakeSupabase({});
    const result = await getHomeClose(sb, { asOf: AS_OF });
    expect(result).toEqual({
      periodLabel: "October 2026",
      periodEnd: "2026-10-31",
      steps: [
        { key: "trial-balance", title: "The trial balance balances", status: "complete", href: "/reports?report=trial&asOf=2026-10-31" },
        { key: "bank-reconciled", title: "The bank is reconciled through the period end", status: "outstanding", href: "/banking/reconcile" },
        { key: "depreciation-posted", title: "Depreciation is posted", status: "not-applicable", href: "/fixed-assets" },
      ],
      complete: 1,
      applicable: 2,
      lastClosedLabel: "September 2026",
    });
    // The checklist is asked about the page's day: October is overdue, November is current.
    expect(close.contexts[0]).toMatchObject({
      asOf: AS_OF,
      currentPeriod: { id: "p11" },
      overduePeriods: [{ id: "p10" }],
    });
  });
});
