import { describe, expect, it } from "vitest";
import { overdueSeverity } from "@/lib/domain/sales-surface/queue-items";
import {
  overdueReceivablesControl,
  unappliedReceiptsControl,
  unissuedInvoicesControl,
} from "@/lib/domain/sales-surface/controls";
import {
  billSeverity,
  billsDueControl,
  receivedNotBilledControl,
} from "@/lib/domain/purchases-surface/rules";
import {
  negativeStockControl,
  valuationTiesOutControl,
  valuationVarianceItem,
} from "@/lib/domain/inventory-surface/rules";

const AT = "2026-08-22T09:00:00.000Z";

describe("Sales — collection rules", () => {
  it("materiality can raise a tier and never lowers one", () => {
    // A small debt three months late is still three months late. Demoting it
    // would hide exactly the long tail nobody chases.
    expect(overdueSeverity(120, 1_00, 100_000)).toBe("critical");
    expect(overdueSeverity(120, 500_000, 100_000)).toBe("critical");
    expect(overdueSeverity(10, 500_000, 100_000)).toBe("medium");
    expect(overdueSeverity(10, 1_00, 100_000)).toBe("low");
  });

  it("with no threshold set, the amount plays no part at all", () => {
    expect(overdueSeverity(10, 5_000_000, null)).toBe("low");
    expect(overdueSeverity(95, 1_00, null)).toBe("critical");
  });

  it("the overdue control carries the money, because that is what decides who to ring", () => {
    const control = overdueReceivablesControl({
      overdueCount: 4,
      overdueMinor: 62_400_00,
      oldestDaysPastDue: 96,
      evaluatedAt: AT,
    });
    expect(control.status).toBe("attention");
    expect(control.detail).toContain("62,400.00");
    expect(control.detail).toContain("96 days");
  });

  it("an unapplied receipt is described by what it causes, not by what it is", () => {
    const control = unappliedReceiptsControl({ count: 2, amountMinor: 900_00, evaluatedAt: AT });
    expect(control.detail).toContain("look like they owe money they have paid");
  });

  it("drafts inside the window are not a failure", () => {
    const control = unissuedInvoicesControl({
      draftCount: 3,
      draftMinor: 0,
      staleCount: 0,
      staleAfterDays: 7,
      evaluatedAt: AT,
    });
    expect(control.status).toBe("healthy");
    expect(control.detail).toContain("3 drafts in progress");
  });

  it("ageing that could not be read is never reported as nothing overdue", () => {
    expect(
      overdueReceivablesControl({
        overdueCount: null,
        overdueMinor: 0,
        oldestDaysPastDue: null,
        evaluatedAt: AT,
      }).status,
    ).toBe("unavailable");
  });
});

describe("Purchases — settlement rules", () => {
  it("a bill not yet due is the lowest tier, and overdue climbs", () => {
    expect(billSeverity(-3, 100_00, null)).toBe("low");
    expect(billSeverity(1, 100_00, null)).toBe("medium");
    expect(billSeverity(45, 100_00, null)).toBe("high");
    expect(billSeverity(90, 100_00, null)).toBe("critical");
  });

  it("says what is due soon even when nothing is late", () => {
    const control = billsDueControl({
      overdueCount: 0,
      overdueMinor: 0,
      dueSoonCount: 3,
      dueSoonMinor: 4_500_00,
      evaluatedAt: AT,
    });
    expect(control.status).toBe("healthy");
    expect(control.detail).toContain("3 bills due within 7 days");
  });

  it("received-not-billed explains the liability rather than counting rows", () => {
    const control = receivedNotBilledControl({
      lineCount: 2,
      valueMinor: 8_000_00,
      oldestAgeDays: 74,
      evaluatedAt: AT,
    });
    expect(control.status).toBe("attention");
    expect(control.detail).toContain("the supplier has not invoiced yet");
    expect(control.detail).toContain("74 days");
  });

  it("receiving data that could not be read is never reported as all billed", () => {
    expect(
      receivedNotBilledControl({
        lineCount: null,
        valueMinor: 0,
        oldestAgeDays: null,
        evaluatedAt: AT,
      }).status,
    ).toBe("unavailable");
  });
});

describe("Inventory — the one blocking check in the product", () => {
  it("a variance blocks, and says both figures", () => {
    const control = valuationTiesOutControl({
      subledgerMinor: 26_900_00,
      controlMinor: 25_000_00,
      asOf: "2026-08-22",
      evaluatedAt: AT,
    });
    expect(control.status).toBe("blocked");
    expect(control.blocking).toBe(true);
    expect(control.detail).toContain("26,900.00");
    expect(control.detail).toContain("25,000.00");
    expect(control.detail).toContain("1,900.00");
  });

  it("ties out when both sides agree", () => {
    const control = valuationTiesOutControl({
      subledgerMinor: 25_000_00,
      controlMinor: 25_000_00,
      asOf: "2026-08-22",
      evaluatedAt: AT,
    });
    expect(control.status).toBe("healthy");
  });

  it("a side that could not be read is never reported as tying", () => {
    expect(
      valuationTiesOutControl({
        subledgerMinor: null,
        controlMinor: 0,
        asOf: "2026-08-22",
        evaluatedAt: AT,
      }).status,
    ).toBe("unavailable");
  });

  it("the variance item is the one row nobody may dismiss", () => {
    const item = valuationVarianceItem({
      differenceMinor: 1_900_00,
      detail: "out by 1,900.00",
      confirmedAt: AT,
    });
    expect(item.blocking).toBe(true);
    expect(item.severity).toBe("critical");
    // A stable key: the same variance keeps the same identity across reads, so
    // a decision about it survives.
    expect(item.key).toBe("control:inventory-ties-out");
  });

  it("negative stock explains the consequence, not just the count", () => {
    const control = negativeStockControl({
      itemCount: 40,
      negativeCount: 2,
      negativeNames: ["RING-18K", "CHAIN-22"],
      evaluatedAt: AT,
    });
    expect(control.status).toBe("attention");
    expect(control.detail).toContain("RING-18K");
    expect(control.detail).toContain("cost was taken at a rate nothing supports");
  });

  it("a company with no stock is not failing a check it never opted into", () => {
    const control = negativeStockControl({
      itemCount: 0,
      negativeCount: 0,
      negativeNames: [],
      evaluatedAt: AT,
    });
    expect(control.status).toBe("healthy");
    expect(control.passCondition).toContain("once an item is tracked");
  });
});
