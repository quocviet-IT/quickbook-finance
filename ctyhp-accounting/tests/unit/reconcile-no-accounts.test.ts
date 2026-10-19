import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chosenBankId, reconcileTableLoading } from "@/lib/domain/reconcile-alerts-screen";

/**
 * Reported 2026-10-19 with a screenshot of the Meridian sample company: Bank
 * Reconciliation spun for ever, over an empty account box and two disabled
 * buttons. A company with no bank account has nothing to read, so the read
 * never ran and never settled, and the table's spinner waited for it.
 * Meridian and one real company had no bank account.
 */
describe("the reconcile table's spinner", () => {
  it("never spins for a company with no bank account, because there is nothing to read", () => {
    const bankId = chosenBankId([], null);
    expect(bankId).toBeUndefined();
    expect(reconcileTableLoading({ bankId, loading: false, rowCount: 0, standingSettled: false })).toBe(false);
  });

  it("spins while an account's reconciliations or its standing are still being read", () => {
    expect(reconcileTableLoading({ bankId: "b1", loading: true, rowCount: 0, standingSettled: false })).toBe(true);
    expect(reconcileTableLoading({ bankId: "b1", loading: false, rowCount: 0, standingSettled: false })).toBe(true);
  });

  it("stops once both reads are in", () => {
    expect(reconcileTableLoading({ bankId: "b1", loading: false, rowCount: 0, standingSettled: true })).toBe(false);
    expect(reconcileTableLoading({ bankId: "b1", loading: false, rowCount: 3, standingSettled: false })).toBe(false);
  });
});

describe("Bank Reconciliation with no bank account", () => {
  const source = readFileSync(join(process.cwd(), "app/(app)/banking/reconcile/ReconcileListClient.tsx"), "utf8");

  it("says so, and points to where an account is added", () => {
    expect(source).toContain("No bank account to reconcile yet");
    expect(source).toMatch(/href="\/banking"/);
  });

  it("takes the spinner from the shared rule, not its own expression", () => {
    expect(source).toContain("reconcileTableLoading(");
  });
});
