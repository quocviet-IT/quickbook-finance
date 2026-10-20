import { describe, expect, it } from "vitest";
import type { SurfaceControl } from "@/lib/domain/work-surface/types";
import { feedHealthControl, statementReconciliationControl, unmatchedActivityControl } from "@/lib/domain/banking-surface/controls";
import { billsDueControl, receivedNotBilledControl, unappliedPaymentsControl } from "@/lib/domain/purchases-surface/rules";
import { overdueReceivablesControl, unappliedReceiptsControl, unissuedInvoicesControl } from "@/lib/domain/sales-surface/controls";
import { depreciationDueControl, inventoryQueueEmptyState, negativeStockControl, valuationTiesOutControl } from "@/lib/domain/inventory-surface/rules";
import { buildInventoryReview, inventoryReviewHeadline, type InventoryReviewRow } from "@/lib/domain/inventory-review";

/**
 * A check's title says what was found (UI review, 2026-10-20).
 *
 * It used to be the claim under test, so a failing check contradicted itself:
 * "Nothing owed is late — Needs attention", "Imported activity is accounted for
 * — Blocked". And a check with nothing to look at claimed a success about
 * nothing: "Every line of stock is moving" over an empty table. The claim is
 * the pass condition; the title is the result.
 */
const at = "2026-10-20T09:00:00Z";

/** Each check, run as it passes, as it fails, and as it could not run. */
const CASES: { name: string; passing: SurfaceControl; failing: SurfaceControl; unknown: SurfaceControl; failingTitle: string }[] = [
  {
    name: "unmatched bank activity",
    passing: unmatchedActivityControl({ asOf: "2026-10-19", unmatchedCount: 0, oldestAgeDays: null, pendingCount: 0, evaluatedAt: at }),
    failing: unmatchedActivityControl({ asOf: "2026-10-19", unmatchedCount: 47, oldestAgeDays: 166, pendingCount: 0, evaluatedAt: at }),
    unknown: unmatchedActivityControl({ asOf: "2026-10-19", unmatchedCount: null, oldestAgeDays: null, pendingCount: 0, evaluatedAt: at }),
    failingTitle: "47 imported lines are not accounted for",
  },
  {
    name: "bank feeds",
    passing: feedHealthControl({ connectionCount: 2, brokenCount: 0, brokenNames: [], evaluatedAt: at }),
    failing: feedHealthControl({ connectionCount: 2, brokenCount: 2, brokenNames: ["Example Bank", "Example Bank"], evaluatedAt: at }),
    unknown: feedHealthControl({ connectionCount: null, brokenCount: 0, brokenNames: [], evaluatedAt: at }),
    failingTitle: "2 bank feeds are not syncing",
  },
  {
    name: "statement reconciliation",
    passing: statementReconciliationControl({ accountCount: 3, behindNames: [], inProgressCount: 0, staleBefore: "2026-09-30", evaluatedAt: at }),
    failing: statementReconciliationControl({ accountCount: 3, behindNames: ["Operating", "Savings"], inProgressCount: 0, staleBefore: "2026-09-30", evaluatedAt: at }),
    unknown: statementReconciliationControl({ accountCount: null, behindNames: [], inProgressCount: 0, staleBefore: "2026-09-30", evaluatedAt: at }),
    failingTitle: "2 accounts are not reconciled",
  },
  {
    name: "bills due",
    passing: billsDueControl({ overdueCount: 0, overdueMinor: 0, dueSoonCount: 0, dueSoonMinor: 0, evaluatedAt: at }),
    failing: billsDueControl({ overdueCount: 1, overdueMinor: 99_000, dueSoonCount: 0, dueSoonMinor: 0, evaluatedAt: at }),
    unknown: billsDueControl({ overdueCount: null, overdueMinor: 0, dueSoonCount: 0, dueSoonMinor: 0, evaluatedAt: at }),
    failingTitle: "1 bill is overdue",
  },
  {
    name: "received and not billed",
    passing: receivedNotBilledControl({ lineCount: 0, valueMinor: 0, oldestAgeDays: null, evaluatedAt: at }),
    failing: receivedNotBilledControl({ lineCount: 2, valueMinor: 50_000, oldestAgeDays: 12, evaluatedAt: at }),
    unknown: receivedNotBilledControl({ lineCount: null, valueMinor: 0, oldestAgeDays: null, evaluatedAt: at }),
    failingTitle: "2 received lines are not billed",
  },
  {
    name: "unapplied supplier payments",
    passing: unappliedPaymentsControl({ count: 0, amountMinor: 0, evaluatedAt: at }),
    failing: unappliedPaymentsControl({ count: 1, amountMinor: 10_000, evaluatedAt: at }),
    unknown: unappliedPaymentsControl({ count: null, amountMinor: 0, evaluatedAt: at }),
    failingTitle: "1 supplier payment is not applied",
  },
  {
    name: "overdue receivables",
    passing: overdueReceivablesControl({ overdueCount: 0, overdueMinor: 0, oldestDaysPastDue: null, evaluatedAt: at }),
    failing: overdueReceivablesControl({ overdueCount: 3, overdueMinor: 300_000, oldestDaysPastDue: 40, evaluatedAt: at }),
    unknown: overdueReceivablesControl({ overdueCount: null, overdueMinor: 0, oldestDaysPastDue: null, evaluatedAt: at }),
    failingTitle: "3 invoices are past due",
  },
  {
    name: "unapplied receipts",
    passing: unappliedReceiptsControl({ count: 0, amountMinor: 0, evaluatedAt: at }),
    failing: unappliedReceiptsControl({ count: 2, amountMinor: 20_000, evaluatedAt: at }),
    unknown: unappliedReceiptsControl({ count: null, amountMinor: 0, evaluatedAt: at }),
    failingTitle: "2 receipts are not applied",
  },
  {
    name: "invoices left in draft",
    passing: unissuedInvoicesControl({ draftCount: 0, draftMinor: 0, staleCount: 0, staleAfterDays: 14, evaluatedAt: at }),
    failing: unissuedInvoicesControl({ draftCount: 4, draftMinor: 80_000, staleCount: 1, staleAfterDays: 14, evaluatedAt: at }),
    unknown: unissuedInvoicesControl({ draftCount: null, draftMinor: 0, staleCount: 0, staleAfterDays: 14, evaluatedAt: at }),
    failingTitle: "1 invoice has waited too long in draft",
  },
  {
    name: "negative stock",
    passing: negativeStockControl({ itemCount: 5, negativeCount: 0, negativeNames: [], evaluatedAt: at }),
    failing: negativeStockControl({ itemCount: 5, negativeCount: 2, negativeNames: ["Ring", "Chain"], evaluatedAt: at }),
    unknown: negativeStockControl({ itemCount: null, negativeCount: 0, negativeNames: [], evaluatedAt: at }),
    failingTitle: "2 items are below zero",
  },
  {
    name: "stock against the ledger",
    passing: valuationTiesOutControl({ subledgerMinor: 100_000, controlMinor: 100_000, asOf: "2026-10-19", evaluatedAt: at }),
    failing: valuationTiesOutControl({ subledgerMinor: 100_000, controlMinor: 98_000, asOf: "2026-10-19", evaluatedAt: at }),
    unknown: valuationTiesOutControl({ subledgerMinor: null, controlMinor: 0, asOf: "2026-10-19", evaluatedAt: at }),
    failingTitle: "Stock does not tie to the ledger",
  },
  {
    name: "depreciation",
    passing: depreciationDueControl({ assetCount: 3, dueCount: 0, dueMinor: 0, evaluatedAt: at }),
    failing: depreciationDueControl({ assetCount: 3, dueCount: 1, dueMinor: 12_500, evaluatedAt: at }),
    unknown: depreciationDueControl({ assetCount: null, dueCount: 0, dueMinor: 0, evaluatedAt: at }),
    failingTitle: "1 asset has depreciation to post",
  },
];

describe("a check's title", () => {
  for (const c of CASES) {
    it(`for ${c.name}, says what was found: passing, failing, or not checked`, () => {
      expect(c.passing.status).toBe("healthy");
      expect(["attention", "blocked"]).toContain(c.failing.status);
      expect(c.unknown.status).toBe("unavailable");
      // Failing, it states the failure — never the claim it failed.
      expect(c.failing.title).toBe(c.failingTitle);
      expect(c.failing.title).not.toBe(c.passing.title);
      // Not run, it says so — never the claim it could not test.
      expect(c.unknown.title).toMatch(/could not be checked$/);
    });
  }

  it("with nothing to check, says there is nothing, and is drawn as nothing to check rather than a pass", () => {
    const nothing = [
      feedHealthControl({ connectionCount: 0, brokenCount: 0, brokenNames: [], evaluatedAt: at }),
      statementReconciliationControl({ accountCount: 0, behindNames: [], inProgressCount: 0, staleBefore: "2026-09-30", evaluatedAt: at }),
      negativeStockControl({ itemCount: 0, negativeCount: 0, negativeNames: [], evaluatedAt: at }),
      depreciationDueControl({ assetCount: 0, dueCount: 0, dueMinor: 0, evaluatedAt: at }),
    ];
    expect(nothing.map((c) => c.title)).toEqual([
      "No bank feed is connected",
      "No bank account to reconcile",
      "No item is tracked as inventory",
      "No fixed asset to depreciate",
    ]);
    for (const c of nothing) {
      expect(c.status).toBe("healthy");
      expect(c.notApplicable).toBe(true);
    }
    // A real pass is not marked as having nothing to check.
    for (const c of CASES) expect(c.passing.notApplicable).toBeUndefined();
  });

  it("names a reconciliation left open even when every account is current", () => {
    const open = statementReconciliationControl({ accountCount: 3, behindNames: [], inProgressCount: 1, staleBefore: "2026-09-30", evaluatedAt: at });
    expect(open.status).toBe("attention");
    expect(open.title).toBe("1 reconciliation is left open");
  });
});

describe("the inventory queue when it is empty", () => {
  const stock = (itemCount: number) => negativeStockControl({ itemCount, negativeCount: 0, negativeNames: [], evaluatedAt: at });
  const assets = (assetCount: number) => depreciationDueControl({ assetCount, dueCount: 0, dueMinor: 0, evaluatedAt: at });

  it("says there is nothing, not that the stock is straight, when nothing is held", () => {
    expect(inventoryQueueEmptyState([stock(0), assets(0)])).toEqual({
      title: "Nothing to sort out",
      evidence: "No item is tracked as inventory, and no fixed asset is registered.",
    });
  });

  it("says the stock is straight when there is stock to be straight", () => {
    expect(inventoryQueueEmptyState([stock(5), assets(2)])).toEqual({
      title: "Stock is straight",
      evidence: "Nothing is below zero, the stock ties to the ledger, and no depreciation is waiting to be posted.",
    });
  });

  it("does not call it a clean bill of health when the checks could not run", () => {
    expect(inventoryQueueEmptyState(null).evidence).toContain("not a clean bill of health");
  });
});

describe("the inventory review's headline", () => {
  const row = (over: Partial<InventoryReviewRow> = {}): InventoryReviewRow => ({
    itemId: "i1",
    itemCode: "RING-1",
    name: "Example Ring",
    qtyOnHand: 4,
    valueMinor: 480_000,
    unitCostMinor: 120_000,
    salesPriceMinor: 260_000,
    lastMovementOn: "2026-07-10",
    lastSaleOn: "2026-07-10",
    qtySoldInWindow: 2,
    writtenDownMinor: 0,
    ...over,
  });

  it("says there is nothing to review when nothing is on hand, in a neutral tone", () => {
    const headline = inventoryReviewHeadline(buildInventoryReview([], "2026-10-19", 90, "average_cost"));
    expect(headline).toEqual({ tone: "info", message: "No stock is on hand at 10/19/2026, so there is nothing to review." });
    const zero = inventoryReviewHeadline(buildInventoryReview([row({ qtyOnHand: 0, valueMinor: 0 })], "2026-10-19", 90, "average_cost"));
    expect(zero.tone).toBe("info");
  });

  it("counts what it looked at when everything is moving", () => {
    expect(inventoryReviewHeadline(buildInventoryReview([row()], "2026-08-01", 90, "average_cost")).message).toBe(
      "The one item on hand is moving and is not carried above what it would fetch.",
    );
    const two = inventoryReviewHeadline(buildInventoryReview([row(), row({ itemId: "i2" })], "2026-08-01", 90, "average_cost"));
    expect(two).toEqual({ tone: "success", message: "All 2 items on hand are moving, and none is carried above what it would fetch." });
  });
});
