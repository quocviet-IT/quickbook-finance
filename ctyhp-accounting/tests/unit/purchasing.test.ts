import { describe, expect, it } from "vitest";
import {
  poLineTotalMinor,
  poReceiptStatus,
  remainingQty,
  threeWayMatchLine,
  varianceBps,
  withinToleranceBps,
} from "@/lib/domain/purchasing";

describe("poLineTotalMinor", () => {
  it("extends a whole quantity", () => {
    expect(poLineTotalMinor(3, 1250)).toBe(3750); // 3 x $12.50 = $37.50
  });

  it("extends a fractional quantity", () => {
    expect(poLineTotalMinor(2.5, 999)).toBe(2498); // 2497.5 -> 2498 (half up)
  });

  it("rounds a half-cent up, away from zero", () => {
    expect(poLineTotalMinor(0.5, 101)).toBe(51); // 50.5 -> 51
  });

  it("is zero at zero cost", () => {
    expect(poLineTotalMinor(10, 0)).toBe(0);
  });

  it("rejects a non-integer unit cost", () => {
    expect(() => poLineTotalMinor(1, 12.5)).toThrow();
  });
});

describe("remainingQty", () => {
  it("subtracts what was received", () => {
    expect(remainingQty(10, 4)).toBe(6);
  });

  it("never goes negative", () => {
    expect(remainingQty(10, 12)).toBe(0);
  });
});

describe("poReceiptStatus", () => {
  it("is open when nothing has arrived", () => {
    expect(poReceiptStatus([{ quantity: 5, qty_received: 0, is_closed: false }])).toBe("open");
  });

  it("is partial when some quantity is in", () => {
    expect(
      poReceiptStatus([
        { quantity: 5, qty_received: 2, is_closed: false },
        { quantity: 3, qty_received: 0, is_closed: false },
      ]),
    ).toBe("partial");
  });

  it("is received when every line is full", () => {
    expect(
      poReceiptStatus([
        { quantity: 5, qty_received: 5, is_closed: false },
        { quantity: 3, qty_received: 3, is_closed: false },
      ]),
    ).toBe("received");
  });

  it("treats a short-closed line as settled", () => {
    expect(
      poReceiptStatus([
        { quantity: 5, qty_received: 5, is_closed: false },
        { quantity: 3, qty_received: 1, is_closed: true },
      ]),
    ).toBe("received");
  });

  it("is open for an empty line set", () => {
    expect(poReceiptStatus([])).toBe("open");
  });
});

describe("varianceBps", () => {
  it("is zero when actual equals expected", () => {
    expect(varianceBps(1000, 1000)).toBe(0);
  });

  it("is positive when billed above the order", () => {
    expect(varianceBps(1000, 1100)).toBe(1000); // +10%
  });

  it("is negative when billed below the order", () => {
    expect(varianceBps(1000, 950)).toBe(-500); // -5%
  });

  it("is zero when both sides are zero", () => {
    expect(varianceBps(0, 0)).toBe(0);
  });

  it("is a full 10000 bps when expected is zero but actual is not", () => {
    expect(varianceBps(0, 500)).toBe(10000);
  });
});

describe("withinToleranceBps", () => {
  it("accepts a variance exactly at the boundary", () => {
    expect(withinToleranceBps(1000, 1020, 200)).toBe(true); // +2% at a 2% tolerance
  });

  it("rejects a variance one basis point over", () => {
    expect(withinToleranceBps(10000, 10201, 200)).toBe(false); // +2.01%
  });

  it("applies the tolerance to under-billing too", () => {
    expect(withinToleranceBps(1000, 900, 200)).toBe(false); // -10%
  });
});

const CONFIG = { priceToleranceBps: 200, qtyToleranceBps: 0 };

describe("threeWayMatchLine", () => {
  it("passes when the bill matches the receipt and the order price", () => {
    const m = threeWayMatchLine(
      { orderedQty: 10, receivedQty: 4, alreadyBilledQty: 0, billQty: 4, poUnitCostMinor: 1000, billUnitCostMinor: 1000 },
      CONFIG,
    );
    expect(m).toEqual({ priceOk: true, qtyOk: true, requiresApproval: false, exceptions: [] });
  });

  it("passes a price inside tolerance", () => {
    const m = threeWayMatchLine(
      { orderedQty: 10, receivedQty: 10, alreadyBilledQty: 0, billQty: 10, poUnitCostMinor: 1000, billUnitCostMinor: 1015 },
      CONFIG,
    );
    expect(m.priceOk).toBe(true);
    expect(m.requiresApproval).toBe(false);
  });

  it("flags billing more than was received", () => {
    const m = threeWayMatchLine(
      { orderedQty: 10, receivedQty: 4, alreadyBilledQty: 0, billQty: 5, poUnitCostMinor: 1000, billUnitCostMinor: 1000 },
      CONFIG,
    );
    expect(m.qtyOk).toBe(false);
    expect(m.requiresApproval).toBe(true);
    expect(m.exceptions).toEqual([
      { kind: "quantity", expectedValue: 4, actualValue: 5, varianceBps: 2500 },
    ]);
  });

  it("counts quantity already billed on earlier bills", () => {
    const m = threeWayMatchLine(
      { orderedQty: 10, receivedQty: 6, alreadyBilledQty: 4, billQty: 3, poUnitCostMinor: 1000, billUnitCostMinor: 1000 },
      CONFIG,
    );
    expect(m.qtyOk).toBe(false);
    expect(m.exceptions[0]).toEqual({ kind: "quantity", expectedValue: 6, actualValue: 7, varianceBps: 1667 });
  });

  it("allows over-billing within an explicit quantity tolerance", () => {
    const m = threeWayMatchLine(
      { orderedQty: 100, receivedQty: 100, alreadyBilledQty: 0, billQty: 102, poUnitCostMinor: 1000, billUnitCostMinor: 1000 },
      { priceToleranceBps: 200, qtyToleranceBps: 200 },
    );
    expect(m.qtyOk).toBe(true);
    expect(m.requiresApproval).toBe(false);
  });

  it("flags a price outside tolerance", () => {
    const m = threeWayMatchLine(
      { orderedQty: 10, receivedQty: 10, alreadyBilledQty: 0, billQty: 10, poUnitCostMinor: 1000, billUnitCostMinor: 1100 },
      CONFIG,
    );
    expect(m.priceOk).toBe(false);
    expect(m.exceptions).toEqual([{ kind: "price", expectedValue: 1000, actualValue: 1100, varianceBps: 1000 }]);
  });

  it("reports both exceptions when quantity and price are both out", () => {
    const m = threeWayMatchLine(
      { orderedQty: 10, receivedQty: 2, alreadyBilledQty: 0, billQty: 5, poUnitCostMinor: 1000, billUnitCostMinor: 1500 },
      CONFIG,
    );
    expect(m.requiresApproval).toBe(true);
    expect(m.exceptions.map((e) => e.kind)).toEqual(["quantity", "price"]);
  });

  it("does not flag a fractional quantity that ties out exactly", () => {
    const m = threeWayMatchLine(
      { orderedQty: 3, receivedQty: 0.3, alreadyBilledQty: 0.1, billQty: 0.2, poUnitCostMinor: 500, billUnitCostMinor: 500 },
      CONFIG,
    );
    expect(m.qtyOk).toBe(true); // 0.1 + 0.2 === 0.3 only with an epsilon-tolerant compare
  });
});
