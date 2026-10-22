import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reconcileTableLoading, rowsForAccount } from "@/lib/domain/reconcile-alerts-screen";

/**
 * Switching the account on Reconcile left the previous account's
 * reconciliations listed under the new one until its own read landed: "never
 * been reconciled" above five Completed rows that belonged to the other account
 * (feature check, 2026-10-20). Measured on the sample company: five to ten
 * seconds.
 */
describe("the reconciliations listed on Reconcile", () => {
  const previous = [{ id: "r1" }, { id: "r2" }];

  it("are the ones read for the account now chosen", () => {
    expect(rowsForAccount("first", "first", previous)).toEqual(previous);
  });

  it("are none while the newly chosen account's read is on its way", () => {
    expect(rowsForAccount("second", "first", previous)).toEqual([]);
  });

  it("are none before anything has been read", () => {
    expect(rowsForAccount("first", null, previous)).toEqual([]);
    expect(rowsForAccount(undefined, null, [])).toEqual([]);
  });

  it("show the table loading while the chosen account has not been read", () => {
    // The page passes `loading || loadedFor !== bankId`.
    expect(reconcileTableLoading({ bankId: "second", loading: true, rowCount: 0, standingSettled: true })).toBe(true);
  });

  it("are drawn from the chosen account only, on the page itself", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/banking/reconcile/ReconcileListClient.tsx"), "utf8");
    expect(source).toContain("rowsForAccount(bankId, loadedFor, rows)");
    expect(source).toContain("dataSource={[...shownRows]}");
    expect(source).toContain("loading: loading || loadedFor !== bankId");
    expect(source).not.toContain("dataSource={rows}");
  });
});
