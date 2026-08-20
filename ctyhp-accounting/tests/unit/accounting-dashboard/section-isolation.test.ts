import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composeAccountingDashboard,
  type AccountingDashboardSections,
} from "@/lib/services/accounting-dashboard/compose";
import { trialBalanceControl } from "@/lib/domain/accounting-dashboard/control-status";
import type { AccountingDashboardContext } from "@/lib/services/accounting-dashboard/context";
import type { PriorityQueueItem } from "@/lib/domain/accounting-dashboard/types";

const CONTEXT: AccountingDashboardContext = {
  asOf: "2026-08-20",
  currencyCode: "USD",
  currencyDecimals: 2,
  timeZone: "America/New_York",
  accountingBasis: "Accrual basis",
  fiscalYear: 2026,
  periods: [],
  currentPeriod: null,
  overduePeriods: [],
};

const QUEUE_ITEM: PriorityQueueItem = {
  key: "bill:1",
  sourceKind: "bill-due",
  sourceId: "1",
  title: "BILL-0001",
  reason: "Due today · Harbor Metals",
  severity: "high",
  ageDays: 0,
  href: "/bills",
  actionLabel: "Pay",
  confirmedAt: "2026-08-20T09:00:00Z",
  blocksClose: false,
};

function sections(overrides: Partial<AccountingDashboardSections> = {}): AccountingDashboardSections {
  return {
    context: async () => CONTEXT,
    controls: async () => [
      trialBalanceControl({ balanced: true, differenceMinor: 0, evaluatedAt: "2026-08-20T09:00:00Z" }),
    ],
    queue: async () => [QUEUE_ITEM],
    secondary: async () => ({ trend: [], sourceMix: [], recentEntries: [] }),
    ...overrides,
  };
}

const sb = {} as SupabaseClient;

describe("composeAccountingDashboard section isolation", () => {
  it("reports every section fresh when every section answers", async () => {
    const out = await composeAccountingDashboard(sb, sections());
    expect(out.controls.dataState).toBe("fresh");
    expect(out.queue.dataState).toBe("fresh");
    expect(out.secondary.dataState).toBe("fresh");
  });

  it("keeps the queue and controls when the secondary analysis fails", async () => {
    // The reason this whole redesign exists: a twelve-month trend query must
    // not be able to take the accountant's work list with it.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await composeAccountingDashboard(
      sb,
      sections({
        secondary: async () => {
          throw new Error("statement timeout");
        },
      }),
    );
    spy.mockRestore();

    expect(out.secondary.dataState).toBe("unavailable");
    expect(out.secondary.data).toBeNull();
    expect(out.secondary.unavailableReason).toMatch(/unaffected/i);
    expect(out.queue.dataState).toBe("fresh");
    expect(out.queue.data).toHaveLength(1);
    expect(out.controls.dataState).toBe("fresh");
  });

  it("never leaks a database message into the reason a person reads", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await composeAccountingDashboard(
      sb,
      sections({
        controls: async () => {
          throw new Error('relation "acc_secret_table" does not exist');
        },
      }),
    );
    spy.mockRestore();

    expect(out.controls.unavailableReason).not.toMatch(/acc_secret_table/);
    expect(out.controls.unavailableReason).toMatch(/should be read as passing/i);
  });

  it("still shows the queue's own work when the controls cannot be evaluated", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await composeAccountingDashboard(
      sb,
      sections({
        controls: async () => {
          throw new Error("ledger unavailable");
        },
      }),
    );
    spy.mockRestore();

    expect(out.controls.dataState).toBe("unavailable");
    expect(out.queue.dataState).toBe("fresh");
    expect(out.queue.data?.map((i) => i.key)).toEqual(["bill:1"]);
  });

  it("merges failing controls into the queue, ahead of ordinary work", async () => {
    const out = await composeAccountingDashboard(
      sb,
      sections({
        controls: async () => [
          trialBalanceControl({
            balanced: false,
            differenceMinor: 500,
            evaluatedAt: "2026-08-20T09:00:00Z",
          }),
        ],
      }),
    );
    expect(out.queue.data?.map((i) => i.key)).toEqual(["control:trial-balance", "bill:1"]);
  });

  it("says the queue is unavailable rather than empty when it could not be built", async () => {
    // "No work" and "we could not look" must never render the same way.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await composeAccountingDashboard(
      sb,
      sections({
        queue: async () => {
          throw new Error("timeout");
        },
      }),
    );
    spy.mockRestore();

    expect(out.queue.dataState).toBe("unavailable");
    expect(out.queue.data).toBeNull();
    expect(out.queue.unavailableReason).toMatch(/not a statement that there is no work/i);
  });
});
