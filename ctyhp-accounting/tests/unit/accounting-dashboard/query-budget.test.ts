import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_SECTIONS,
  getAccountingDashboard,
} from "@/lib/services/accounting-dashboard";

/**
 * What one page load actually asks the database for.
 *
 * This is a budget, not a benchmark. The Phase 5 acceptance criterion — "no
 * more than one aggregate call for the selected window" — is the kind of thing
 * that holds the day it ships and quietly stops holding six months later, when
 * somebody adds a helpful per-month read to a service two layers down. A
 * stopwatch would not catch that on a small company's books. This does.
 *
 * The client is a double that answers everything with nothing, so every code
 * path runs and nothing is fetched. What is asserted is the shape of the
 * traffic, never its content.
 */

interface Traffic {
  rpc: string[];
  from: string[];
}

/**
 * A Supabase client that says "no rows" to everything.
 *
 * The builder returns itself for every filter so any chain length works, and is
 * thenable so `await sb.from(...).select(...)` resolves. Deliberately generous:
 * a double that had to be taught each new filter would break on unrelated work
 * and get deleted.
 */
function countingClient(): { sb: SupabaseClient; traffic: Traffic } {
  const traffic: Traffic = { rpc: [], from: [] };
  const empty = { data: [], error: null, count: 0 };

  const builder = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(empty).then(resolve),
      catch: () => Promise.resolve(empty),
      finally: () => Promise.resolve(empty),
    };
    for (const method of [
      "select", "eq", "neq", "gt", "gte", "lt", "lte", "is", "in", "or", "not",
      "order", "limit", "range", "filter", "contains", "overlaps", "match",
      "maybeSingle", "single", "returns", "csv", "abortSignal", "head",
    ]) {
      self[method] = () => self;
    }
    return self;
  };

  const sb = {
    rpc: (name: string) => {
      traffic.rpc.push(name);
      return builder();
    },
    from: (table: string) => {
      traffic.from.push(table);
      return builder();
    },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  } as unknown as SupabaseClient;

  return { sb, traffic };
}

const count = (list: string[], name: string) => list.filter((n) => n === name).length;

describe("what one accounting dashboard load costs", () => {
  it("reads the twelve-month window with one aggregate call, not twelve", async () => {
    const { sb, traffic } = countingClient();
    await getAccountingDashboard(sb);

    // The criterion, as arithmetic. Before Phase 5 the same window cost
    // twelve separate reads, one per month.
    expect(count(traffic.rpc, "acc_monthly_ledger_balances")).toBe(1);
  });

  it("asks for the ledger as of today once, though two sections want it", async () => {
    const { sb, traffic } = countingClient();
    await getAccountingDashboard(sb);

    // Four sections wanted this read: the controls, the insights, and both
    // ageing reports, each of which nets a control account by scanning the
    // whole balance table. Their independence is deliberate; paying four times
    // for it was not. Exactly two remain, and the second is the previous
    // period's balance — a different question, correctly asked separately.
    expect(count(traffic.rpc, "acc_ledger_balances")).toBe(2);
  });

  it("does not fetch the main dashboard's whole payload to use one field of it", async () => {
    const { sb, traffic } = countingClient();
    await getAccountingDashboard(sb);

    // getDashboardAnalytics pulled metrics, cash flow, inventory, the operating
    // pulse and the audit trail, and this page kept none of them. These are the
    // RPCs that came with it and should no longer appear.
    for (const rpc of ["acc_cash_flow", "acc_inventory_valuation", "acc_audit_search"]) {
      expect(count(traffic.rpc, rpc), `${rpc} should not be read by /accounting`).toBe(0);
    }
  });

  it("daily mode buys nothing from the close checklist", async () => {
    const { sb, traffic } = countingClient();
    await getAccountingDashboard(sb, "daily");

    expect(count(traffic.rpc, "acc_period_close_blockers")).toBe(0);
    expect(count(traffic.rpc, "acc_period_close_history")).toBe(0);
  });

  it("close mode asks the close gate once", async () => {
    const { sb, traffic } = countingClient();
    // The double has no periods, so there is nothing to close and the section
    // returns null without asking. Injecting a period is what makes the count
    // meaningful, and it is the only thing this test stubs.
    await getAccountingDashboard(sb, "close", {
      ...DEFAULT_SECTIONS,
      context: async () => ({
        asOf: "2026-08-21",
        currencyCode: "USD",
        currencyDecimals: 2,
        timeZone: "UTC",
        accountingBasis: "Accrual basis",
        fiscalYear: 2026,
        periods: [],
        currentPeriod: null,
        overduePeriods: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            label: "July 2026",
            periodStart: "2026-07-01",
            periodEnd: "2026-07-31",
            status: "open",
          },
        ],
      }),
    });

    expect(count(traffic.rpc, "acc_period_close_blockers")).toBe(1);
    expect(count(traffic.rpc, "acc_period_close_history")).toBe(1);
  });

  it("the whole load stays inside a stated budget", async () => {
    const { sb, traffic } = countingClient();
    await getAccountingDashboard(sb);
    const total = traffic.rpc.length + traffic.from.length;

    // Measured, both sides: 61 reads before Phase 5, 25 after — of which
    // `acc_ledger_balances` alone went from 21 to 2. This is not a target to
    // optimise towards; it is a ceiling that makes a regression visible. Raise
    // it deliberately, in a commit that says why.
    expect(total, `reads: ${[...traffic.rpc, ...traffic.from].sort().join(", ")}`).toBeLessThanOrEqual(28);
  });
});
