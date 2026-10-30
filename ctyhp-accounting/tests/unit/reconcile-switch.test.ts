import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reconcileTableLoading, rowsForAccount } from "@/lib/domain/reconcile-alerts-screen";

const mocks = vi.hoisted(() => ({ listReconciliations: vi.fn(), getBankStandingWithChanges: vi.fn() }));
vi.mock("@/lib/services/bankrec", () => ({ listReconciliations: mocks.listReconciliations }));
vi.mock("@/lib/services/bank-standing", () => ({ getBankStandingWithChanges: mocks.getBankStandingWithChanges }));
vi.mock("@/lib/services/banking", () => ({ BankingError: class BankingError extends Error {} }));

import { readReconcileAccount } from "@/app/(app)/banking/reconcile/account-view";

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
    expect(source).toContain("rows={[...shownRows]}");
    expect(source).toContain("loading: loading || loadedFor !== bankId");
    expect(source).not.toContain("rows={rows}");
  });
});

/**
 * The 5 to 10 seconds itself (2.91). Each switch sent three Server Actions,
 * which Next runs one after another: the statement alerts first (a child's
 * passive effect), reading the whole ledger, then the standing, then the list.
 * Measured on production 30/10: the table settled 1.7 to 2.9 seconds after a
 * switch, the alerts alone 0.7 to 2.3.
 */
describe("reading an account on Reconcile", () => {
  const sb = { name: "company client" } as never;
  const source = readFileSync(join(process.cwd(), "app/(app)/banking/reconcile/ReconcileListClient.tsx"), "utf8");

  it("reads the list and the standing card together, each keeping its own failure", async () => {
    mocks.listReconciliations.mockResolvedValue([{ id: "r1" }]);
    mocks.getBankStandingWithChanges.mockRejectedValue(new Error("standing unavailable"));
    const view = await readReconcileAccount(sb, "b1", "2026-10-30");
    expect(mocks.listReconciliations).toHaveBeenCalledWith(sb, "b1");
    expect(mocks.getBankStandingWithChanges).toHaveBeenCalledWith(sb, "2026-10-30");
    expect(view).toEqual({
      bankAccountId: "b1",
      reconciliations: { ok: true, data: [{ id: "r1" }] },
      standing: { ok: false, error: "standing unavailable" },
    });
  });

  it("finds this account's standing among them all, or none", async () => {
    mocks.listReconciliations.mockResolvedValue([]);
    mocks.getBankStandingWithChanges.mockResolvedValue([{ bankAccountId: "b2" }, { bankAccountId: "b1", state: "never" }]);
    expect((await readReconcileAccount(sb, "b1", "2026-10-30")).standing).toEqual({ ok: true, data: { bankAccountId: "b1", state: "never" } });
    expect((await readReconcileAccount(sb, "b3", "2026-10-30")).standing).toEqual({ ok: true, data: null });
  });

  it("sends one request per switch, from a layout effect, ahead of the alerts", () => {
    expect(source).toContain("await reconcileAccountAction(id)");
    expect(source).not.toMatch(/bankStandingAction|listReconciliationsAction/);
    expect(source).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]{0,200}?void load\(bankId\);/);
    const panel = readFileSync(join(process.cwd(), "app/(app)/banking/reconcile/StatementAlertsPanel.tsx"), "utf8");
    // The alerts ask from a passive effect, so they queue behind the list.
    expect(panel).toMatch(/useEffect\(\(\) => \{\s*ask\(bankAccountId\);/);
  });

  it("opens on what the page read, and reads again only when the account changes", () => {
    const page = readFileSync(join(process.cwd(), "app/(app)/banking/reconcile/page.tsx"), "utf8");
    expect(page).toMatch(/readReconcileAccount\(sb, id, context\.asOf\)/);
    expect(page).toContain("opening={opening}");
    expect(source).toMatch(/opening && opening\.bankAccountId === bankId && opening\.reconciliations\.ok \? opening : null/);
    expect(source).toMatch(/const already = openedOn\.current !== undefined && openedOn\.current === bankId;\s*openedOn\.current = undefined;\s*if \(already\) return;/);
  });
});
