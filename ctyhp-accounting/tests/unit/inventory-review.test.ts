import { describe, expect, it } from "vitest";
import {
  buildInventoryReview,
  describeInventoryReview,
  netRealisableValue,
  reviewStock,
  SELLING_COST_RATE,
  type InventoryReviewRow,
} from "@/lib/domain/inventory-review";

const item = (over: Partial<InventoryReviewRow> = {}): InventoryReviewRow => ({
  itemId: "i1",
  itemCode: "JEWELRY-DEMO-RING-001",
  name: "18K Gold Diamond Ring",
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

describe("netRealisableValue", () => {
  it("is the selling price less what it costs to sell", () => {
    // 4 × 2,600.00, less 10% of getting them sold.
    expect(netRealisableValue(item())).toBe(936_000);
    expect(SELLING_COST_RATE).toBe(0.1);
  });

  it("declines to guess for an item with no selling price", () => {
    expect(netRealisableValue(item({ salesPriceMinor: null }))).toBeNull();
    expect(netRealisableValue(item({ salesPriceMinor: 0 }))).toBeNull();
  });

  it("never goes below zero", () => {
    expect(netRealisableValue(item({ salesPriceMinor: 1, qtyOnHand: 0 }))).toBe(0);
  });
});

describe("reviewStock", () => {
  it("leaves stock that is selling alone", () => {
    const row = reviewStock(item(), "2026-08-01", 90);
    expect(row.verdict).toBe("moving");
    expect(row.shortfallMinor).toBe(0);
    expect(row.monthsOfCover).toBeCloseTo(6, 1);
  });

  it("flags stock that has not moved in three months", () => {
    // The Diamond Stud Earrings: 108 days idle, the largest holding on file.
    const row = reviewStock(
      item({
        name: "Diamond Stud Earrings",
        lastMovementOn: "2026-04-15",
        lastSaleOn: "2026-04-15",
        qtySoldInWindow: 0,
        qtyOnHand: 8,
        valueMinor: 560_000,
        salesPriceMinor: 145_000,
      }),
      "2026-08-01",
      90,
    );
    expect(row.verdict).toBe("slow_moving");
    expect(row.daysSinceMovement).toBe(108);
    expect(row.reason).toBe("No movement in 108 days");
  });

  it("calls stock stale when it is old and has never sold at all", () => {
    const row = reviewStock(
      item({ lastMovementOn: "2026-01-01", lastSaleOn: null, qtySoldInWindow: 0 }),
      "2026-08-01",
      90,
    );
    expect(row.verdict).toBe("stale");
    expect(row.reason).toContain("never sold");
  });

  it("puts a write-down ahead of how fast something is selling", () => {
    // Cost 480,000 against a realisable 4 × 100.00 less 10% = 36,000.
    const row = reviewStock(item({ salesPriceMinor: 10_000 }), "2026-08-01", 90);
    expect(row.verdict).toBe("above_nrv");
    expect(row.nrvMinor).toBe(36_000);
    expect(row.shortfallMinor).toBe(444_000);
    expect(row.reason).toContain("4,440.00 above value");
  });

  it("does not write anything down when value exceeds cost", () => {
    const row = reviewStock(item(), "2026-08-01", 90);
    expect(row.nrvMinor).toBeGreaterThan(row.valueMinor);
    expect(row.shortfallMinor).toBe(0);
  });

  it("says nothing about an item with no stock", () => {
    const row = reviewStock(item({ qtyOnHand: 0, valueMinor: 0 }), "2026-08-01", 90);
    expect(row.verdict).toBe("empty");
    expect(row.shortfallMinor).toBe(0);
  });

  it("has no months of cover to quote when nothing sold", () => {
    const row = reviewStock(item({ qtySoldInWindow: 0 }), "2026-08-01", 90);
    expect(row.monthsOfCover).toBeNull();
  });
});

describe("buildInventoryReview", () => {
  const review = () =>
    buildInventoryReview(
      [
        item({ itemId: "fine", name: "Moving item" }),
        item({
          itemId: "idle",
          name: "Diamond Stud Earrings",
          valueMinor: 560_000,
          lastMovementOn: "2026-04-15",
          qtySoldInWindow: 0,
        }),
        item({ itemId: "cheap", name: "Overvalued item", salesPriceMinor: 10_000 }),
        item({ itemId: "gone", name: "Sold out", qtyOnHand: 0, valueMinor: 0 }),
      ],
      "2026-08-01",
      90,
      "average_cost",
    );

  it("puts what needs a decision first, biggest value first within that", () => {
    expect(review().rows.map((row) => row.itemId)).toEqual(["cheap", "idle", "fine", "gone"]);
  });

  it("adds up what is at stake", () => {
    expect(review().totals).toEqual({
      valueMinor: 1_520_000,
      slowMovingMinor: 1_040_000,
      shortfallMinor: 444_000,
      writtenDownMinor: 0,
    });
  });

  it("leads with the write-downs, then the idle stock", () => {
    const message = describeInventoryReview(review())!;
    expect(message).toContain("1 item(s) carried above realisable value");
    expect(message).toContain("4,440.00 to write down");
    expect(message).toContain("1 item(s) slow moving");
  });

  it("says nothing when every line is healthy", () => {
    const clean = buildInventoryReview([item()], "2026-08-01", 90, "average_cost");
    expect(clean.needsAttention).toEqual([]);
    expect(describeInventoryReview(clean)).toBeNull();
  });

  it("carries the method through, because the report has to state it", () => {
    expect(review().method).toBe("average_cost");
  });

  it("reads an empty stock list as nothing to review", () => {
    const empty = buildInventoryReview([], "2026-08-01", 90, "average_cost");
    expect(empty.rows).toEqual([]);
    expect(empty.totals.valueMinor).toBe(0);
  });
});
