import { describe, expect, it } from "vitest";
import {
  buildPayRun,
  describePayRun,
  describeTerms,
  discountAmountMinor,
  discountAnnualisedRate,
  discountDueDateFrom,
  dueDateFrom,
  parsePaymentTerms,
  rankPayable,
  type PayableBill,
} from "@/lib/domain/payment-terms";

describe("parsePaymentTerms", () => {
  it("reads the terms already on file", () => {
    expect(parsePaymentTerms("Net 30")).toEqual({ netDays: 30, discountPercent: 0, discountDays: 0 });
    expect(parsePaymentTerms("Net 15")).toEqual({ netDays: 15, discountPercent: 0, discountDays: 0 });
    expect(parsePaymentTerms("Due on receipt")).toEqual({
      netDays: 0,
      discountPercent: 0,
      discountDays: 0,
    });
  });

  it("reads the discount shorthand a US supplier writes", () => {
    expect(parsePaymentTerms("1/10 net 30")).toEqual({
      netDays: 30,
      discountPercent: 1,
      discountDays: 10,
    });
    expect(parsePaymentTerms("2/10, n/30")).toEqual({
      netDays: 30,
      discountPercent: 2,
      discountDays: 10,
    });
    expect(parsePaymentTerms("1.5/15 NET 45")).toEqual({
      netDays: 45,
      discountPercent: 1.5,
      discountDays: 15,
    });
  });

  it("does not care about spacing or case", () => {
    expect(parsePaymentTerms("net30")?.netDays).toBe(30);
    expect(parsePaymentTerms("  NET  60  ")?.netDays).toBe(60);
    expect(parsePaymentTerms("COD")?.netDays).toBe(0);
    expect(parsePaymentTerms("45 days")?.netDays).toBe(45);
  });

  it("refuses what it cannot read rather than guessing a due date", () => {
    expect(parsePaymentTerms("pay when you can")).toBeNull();
    expect(parsePaymentTerms("")).toBeNull();
    expect(parsePaymentTerms(null)).toBeNull();
  });
});

describe("terms arithmetic", () => {
  const oneTenNetThirty = { netDays: 30, discountPercent: 1, discountDays: 10 };

  it("works out both dates from the bill date", () => {
    expect(dueDateFrom("2026-07-15", oneTenNetThirty)).toBe("2026-08-14");
    expect(discountDueDateFrom("2026-07-15", oneTenNetThirty)).toBe("2026-07-25");
  });

  it("crosses a month end without drama", () => {
    expect(dueDateFrom("2026-01-31", { netDays: 30, discountPercent: 0, discountDays: 0 })).toBe(
      "2026-03-02",
    );
  });

  it("has no discount date when the vendor offers no discount", () => {
    expect(discountDueDateFrom("2026-07-15", { netDays: 30, discountPercent: 0, discountDays: 0 })).toBeNull();
  });

  it("rounds the discount half up, to the cent", () => {
    expect(discountAmountMinor(100_000, oneTenNetThirty)).toBe(1_000);
    // 1% of 1,234.55 is 12.3455 → 12.35
    expect(discountAmountMinor(123_455, oneTenNetThirty)).toBe(1_235);
    expect(discountAmountMinor(100_000, { netDays: 30, discountPercent: 0, discountDays: 0 })).toBe(0);
  });

  it("says what the discount is worth as an annual rate", () => {
    // 1/10 net 30: 1% for paying 20 days early ≈ 18.4% a year.
    expect(discountAnnualisedRate(oneTenNetThirty)).toBeCloseTo(0.1843, 3);
    // 2/10 net 30 is nearly twice as good.
    expect(discountAnnualisedRate({ netDays: 30, discountPercent: 2, discountDays: 10 })).toBeCloseTo(
      0.3724,
      3,
    );
  });

  it("has no rate to quote when nothing is given up by waiting", () => {
    expect(discountAnnualisedRate({ netDays: 10, discountPercent: 1, discountDays: 10 })).toBeNull();
    expect(discountAnnualisedRate({ netDays: 30, discountPercent: 0, discountDays: 0 })).toBeNull();
  });

  it("reads terms back the way they were written", () => {
    expect(describeTerms(oneTenNetThirty)).toBe("1/10 net 30");
    expect(describeTerms({ netDays: 30, discountPercent: 0, discountDays: 0 })).toBe("Net 30");
    expect(describeTerms({ netDays: 0, discountPercent: 0, discountDays: 0 })).toBe("Due on receipt");
  });
});

const bill = (over: Partial<PayableBill> = {}): PayableBill => ({
  billId: "b1",
  billNumber: "BILL-000001",
  vendorId: "v1",
  vendorName: "Aurora Gemstone Supply Inc.",
  billDate: "2026-07-01",
  dueDate: "2026-07-31",
  termsLabel: "Net 30",
  currencyCode: "USD",
  totalMinor: 100_000,
  balanceDueMinor: 100_000,
  discountDueDate: null,
  discountAmountMinor: 0,
  discountTakenMinor: 0,
  status: "open",
  ...over,
});

describe("rankPayable", () => {
  it("puts an overdue bill first and says how late it is", () => {
    const row = rankPayable(bill({ dueDate: "2026-02-11" }), "2026-08-01");
    expect(row.priority).toBe("overdue");
    expect(row.daysOverdue).toBe(171);
    expect(row.reason).toBe("171 day(s) overdue");
  });

  it("counts the day it falls due as due, not overdue", () => {
    const row = rankPayable(bill({ dueDate: "2026-08-01" }), "2026-08-01");
    expect(row.priority).toBe("due_soon");
    expect(row.reason).toBe("Due today");
  });

  it("flags a discount that lapses within the week, with the money at stake", () => {
    const row = rankPayable(
      bill({ dueDate: "2026-08-20", discountDueDate: "2026-08-05", discountAmountMinor: 1_000 }),
      "2026-08-01",
    );
    expect(row.priority).toBe("discount_expiring");
    expect(row.daysToDiscount).toBe(4);
    expect(row.discountAvailableMinor).toBe(1_000);
    expect(row.payTodayMinor).toBe(99_000);
    expect(row.reason).toContain("Discount of 10.00 until 2026-08-05");
  });

  it("leaves a distant discount scheduled rather than shouting about it", () => {
    const row = rankPayable(
      bill({ dueDate: "2026-09-30", discountDueDate: "2026-08-20", discountAmountMinor: 1_000 }),
      "2026-08-01",
    );
    expect(row.priority).toBe("scheduled");
  });

  it("stops offering a discount the day after it expires, and falls back to the due date", () => {
    const row = rankPayable(
      bill({ dueDate: "2026-08-10", discountDueDate: "2026-07-31", discountAmountMinor: 1_000 }),
      "2026-08-01",
    );
    expect(row.discountAvailableMinor).toBe(0);
    expect(row.payTodayMinor).toBe(100_000);
    expect(row.priority).toBe("due_soon");
  });

  it("does not offer a discount already taken", () => {
    const row = rankPayable(
      bill({
        dueDate: "2026-08-20",
        discountDueDate: "2026-08-05",
        discountAmountMinor: 1_000,
        discountTakenMinor: 1_000,
      }),
      "2026-08-01",
    );
    expect(row.discountAvailableMinor).toBe(0);
  });

  it("never offers more discount than the balance left to pay", () => {
    const row = rankPayable(
      bill({
        balanceDueMinor: 500,
        dueDate: "2026-08-20",
        discountDueDate: "2026-08-05",
        discountAmountMinor: 1_000,
      }),
      "2026-08-01",
    );
    expect(row.discountAvailableMinor).toBe(500);
    expect(row.payTodayMinor).toBe(0);
  });

  it("sends a bill with no due date to a person instead of scheduling it", () => {
    const row = rankPayable(bill({ dueDate: null }), "2026-08-01");
    expect(row.priority).toBe("due_soon");
    expect(row.reason).toBe("No due date on this bill");
  });
});

describe("buildPayRun", () => {
  const run = () =>
    buildPayRun(
      [
        bill({ billId: "later", dueDate: "2026-10-01", balanceDueMinor: 20_000 }),
        bill({ billId: "soon", dueDate: "2026-08-10", balanceDueMinor: 30_000 }),
        bill({ billId: "worst", dueDate: "2026-02-11", balanceDueMinor: 1_490_000 }),
        bill({ billId: "late-small", dueDate: "2026-07-05", balanceDueMinor: 56_000 }),
        bill({
          billId: "discount",
          dueDate: "2026-08-25",
          balanceDueMinor: 100_000,
          discountDueDate: "2026-08-04",
          discountAmountMinor: 1_000,
        }),
      ],
      "2026-08-01",
    );

  it("orders by why, not by date: overdue, then discount, then due, then the rest", () => {
    expect(run().rows.map((row) => row.billId)).toEqual([
      "worst",
      "late-small",
      "discount",
      "soon",
      "later",
    ]);
  });

  it("adds up each band, and what is still on the table in discounts", () => {
    expect(run().totals).toEqual({
      overdueMinor: 1_546_000,
      dueSoonMinor: 130_000,
      scheduledMinor: 20_000,
      discountAvailableMinor: 1_000,
      totalMinor: 1_696_000,
    });
  });

  it("leads with the worst thing on the list", () => {
    const message = describePayRun(run())!;
    expect(message).toContain("2 bill(s) overdue");
    expect(message).toContain("the oldest is Aurora Gemstone Supply Inc. at 171 days");
    expect(message).toContain("10.00 of early payment discount lapses");
  });

  it("says nothing when nothing is pressing", () => {
    const calm = buildPayRun([bill({ dueDate: "2026-12-01" })], "2026-08-01");
    expect(describePayRun(calm)).toBeNull();
  });

  it("reads an empty payables ledger as nothing to do", () => {
    const empty = buildPayRun([], "2026-08-01");
    expect(empty.rows).toEqual([]);
    expect(empty.totals.totalMinor).toBe(0);
    expect(describePayRun(empty)).toBeNull();
  });
});
