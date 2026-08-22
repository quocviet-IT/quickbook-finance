import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composeAccountingDashboard,
  type AccountingDashboardSections,
} from "@/lib/services/accounting-dashboard/compose";
import { trialBalanceControl } from "@/lib/domain/accounting-dashboard/control-status";
import { freshnessOf } from "@/lib/domain/accounting-dashboard/freshness";
import type { AccountingDashboardContext } from "@/lib/services/accounting-dashboard/context";
import type { DerivedQueueItem } from "@/lib/domain/accounting-dashboard/types";
import type { WorkItemState } from "@/lib/domain/accounting-dashboard/lifecycle";
import { EMPTY_WORK_POLICY } from "@/lib/domain/accounting-dashboard/policy";
import { canWrite } from "@/lib/domain/roles";
import { createRequestMemo } from "@/lib/services/request-memo";

/**
 * The three ways this page is allowed to be less than whole.
 *
 * Spec Phase 5, item 7. Each is a shape a reader must be able to tell apart
 * from every other shape, and the failure mode they guard against is the same
 * one every time: a page that looks complete when it is not.
 *
 *   a section that could not be read must not read as a section with nothing
 *   in it;
 *
 *   a figure that is old must say so rather than looking current;
 *
 *   a refusal must be a refusal, not a silent no-op that leaves the screen
 *   showing a change nobody made.
 *
 * Synthetic on purpose. A timeout that only happens under load is a test that
 * only runs under load; these inject the failure directly, so they run in
 * milliseconds and cannot flake.
 */

const CONTEXT: AccountingDashboardContext = {
  asOf: "2026-08-21",
  currencyCode: "USD",
  currencyDecimals: 2,
  timeZone: "America/New_York",
  accountingBasis: "Accrual basis",
  fiscalYear: 2026,
  periods: [],
  currentPeriod: null,
  overduePeriods: [],
};

const ITEM: DerivedQueueItem = {
  key: "bill:1",
  sourceKind: "bill-due",
  sourceId: "1",
  title: "BILL-0001",
  reason: "Due today",
  severity: "high",
  amountMinor: 1_450_00,
  ageDays: 0,
  href: "/bills",
  actionLabel: "Pay",
  confirmedAt: "2026-08-21T09:00:00Z",
  blocksClose: false,
};

function sections(overrides: Partial<AccountingDashboardSections> = {}): AccountingDashboardSections {
  return {
    context: async () => CONTEXT,
    controls: async () => [
      trialBalanceControl({ balanced: true, differenceMinor: 0, evaluatedAt: "2026-08-21T09:00:00Z" }),
    ],
    queue: async () => [ITEM],
    secondary: async () => ({ trend: [], sourceMix: [], recentEntries: [] }),
    workState: async () => new Map<string, WorkItemState>(),
    retire: async () => 0,
    policy: async () => EMPTY_WORK_POLICY,
    insights: async () => ({ insights: [], sleeping: [] }),
    close: async () => null,
    ...overrides,
  };
}

const sb = {} as SupabaseClient;

/** A section that never answers, the way a query that has hung never answers. */
function timesOut<T>(): () => Promise<T> {
  return () =>
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error("statement timeout")), 0);
    });
}

describe("a section that times out", () => {
  it("costs itself and nothing else", async () => {
    const out = await composeAccountingDashboard(
      sb,
      sections({ secondary: timesOut(), insights: timesOut() }),
    );

    expect(out.secondary.dataState).toBe("unavailable");
    expect(out.insights.dataState).toBe("unavailable");
    // The two things an accountant came for.
    expect(out.queue.dataState).toBe("fresh");
    expect(out.queue.data).toHaveLength(1);
    expect(out.controls.dataState).toBe("fresh");
  });

  it("says it could not look, rather than showing nothing found", async () => {
    const out = await composeAccountingDashboard(sb, sections({ queue: timesOut() }));

    expect(out.queue.data).toBeNull();
    expect(out.queue.unavailableReason).toBeTruthy();
    // The sentence has to carry the distinction, because the reader only ever
    // sees the sentence. An empty list and a failed read look identical
    // otherwise, and one of them means "you are done for the day".
    expect(out.queue.unavailableReason).toMatch(/not a statement that there is no work/i);
  });

  it("never reports a database error to the reader", async () => {
    const out = await composeAccountingDashboard(
      sb,
      sections({
        controls: async () => {
          throw new Error('relation "acc_journal_line" does not exist');
        },
      }),
    );

    expect(out.controls.dataState).toBe("unavailable");
    expect(out.controls.unavailableReason).not.toMatch(/acc_journal_line|relation/i);
    expect(out.controls.unavailableReason).toMatch(/should be read as passing/i);
  });

  it("an unreadable policy leaves the rules asleep rather than guessing", async () => {
    const out = await composeAccountingDashboard(
      sb,
      sections({
        policy: async () => {
          throw new Error("policy table gone");
        },
      }),
    );

    expect(out.policy).toEqual(EMPTY_WORK_POLICY);
    expect(out.queue.dataState).toBe("fresh");
  });
});

describe("data that is old", () => {
  it("is stale, not absent, and not fresh", () => {
    const eleven = new Date("2026-08-21T09:00:00Z");
    const now = eleven.getTime() + 11 * 60 * 1000;
    expect(freshnessOf(eleven.toISOString(), now)).toBe("stale");
    expect(freshnessOf(new Date(now - 60_000).toISOString(), now)).toBe("fresh");
  });

  it("a section still carries its data when it is stale", async () => {
    // Staleness is judged in the browser against the reader's clock, so the
    // envelope always leaves the server fresh. What matters is that going
    // stale never empties it: an old figure is still a figure.
    const out = await composeAccountingDashboard(sb, sections());
    expect(freshnessOf(out.queue.generatedAt, Date.now() + 60 * 60 * 1000)).toBe("stale");
    expect(out.queue.data).toHaveLength(1);
  });
});

describe("a reader who may not change anything", () => {
  it("still gets the whole page", async () => {
    // Permission denial must not degrade into a broken screen. A viewer reads
    // the same queue, the same controls and the same explanations as anybody
    // else; what they do not get is the controls that write, and that is a
    // prop the page passes rather than a section it drops.
    const out = await composeAccountingDashboard(sb, sections());
    expect(out.queue.data).toHaveLength(1);
    expect(out.controls.data?.length).toBeGreaterThan(0);
  });

  it("cannot write, by the same rule the action checks", () => {
    // `changeWorkItemAction` guards with exactly this before it reaches the
    // database, which guards again. The refusal itself is proven end to end
    // against a real non-admin session by scripts/verify-work-item-state.mjs;
    // what is asserted here is that the rule it guards with says what we think.
    expect(canWrite("viewer")).toBe(false);
    expect(canWrite("accountant")).toBe(true);
  });
});

describe("the request memo", () => {
  it("asks once and hands the same answer to everyone who asked", async () => {
    const memo = createRequestMemo();
    const load = vi.fn(async () => "answer");
    const [a, b, c] = await Promise.all([
      memo("k", load),
      memo("k", load),
      memo("k", load),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(["answer", "answer", "answer"]);
  });

  it("keeps different questions apart", async () => {
    const memo = createRequestMemo();
    const load = vi.fn(async (n: string) => n);
    await Promise.all([memo("a", () => load("a")), memo("b", () => load("b"))]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares a failure rather than retrying a query that has just failed", async () => {
    const memo = createRequestMemo();
    const load = vi.fn(async () => {
      throw new Error("statement timeout");
    });
    const results = await Promise.allSettled([memo("k", load), memo("k", load)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
  });
});
