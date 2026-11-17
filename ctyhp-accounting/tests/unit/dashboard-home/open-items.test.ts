import { describe, expect, it } from "vitest";
import { bucketOf, computeAging } from "@/lib/domain/aging";
import {
  dueSoonSummary,
  nextBills,
  overdueSummary,
  owesLongest,
  projection,
  projections,
  PROJECTION_HORIZONS,
  splitOpenSide,
  type OpenItemRow,
} from "@/lib/domain/dashboard-home/open-items";

const AS_OF = "2026-11-13";

function item(
  entityId: string,
  docType: string,
  dueDate: string,
  balanceMinor: number,
  docNumber: string | null = null,
): OpenItemRow {
  return { entityId, entityName: `Sample ${entityId}`, docType, docNumber, dueDate, balanceMinor, bucket: bucketOf(dueDate, AS_OF) };
}

// Invoices overdue, due within the week and later; a credit memo and an
// unapplied payment, both negative as acc_ar_ageing returns them.
const receivables: OpenItemRow[] = [
  item("c1", "invoice", "2026-08-08", 7_400_00, "INV-1"), // 97 days late
  item("c2", "invoice", "2026-09-22", 5_150_00, "INV-2"), // 52 days late
  item("c1", "invoice", "2026-10-23", 1_000_00, "INV-3"), // 21 days late
  item("c3", "invoice", "2026-11-13", 2_000_00, "INV-4"), // due today: due soon
  item("c3", "invoice", "2026-11-20", 4_200_00, "INV-5"), // due in 7 days: due soon
  item("c4", "invoice", "2026-11-21", 3_900_00, "INV-6"), // due in 8 days: later
  item("c4", "invoice", "2026-12-20", 6_100_00, "INV-7"), // later
  item("c2", "credit_memo", "2026-10-01", -500_00, "CM-1"),
  item("c4", "payment", "2026-11-10", -250_00, "PMT-1"),
];

describe("splitOpenSide", () => {
  it("splits the open invoices by due date and nets the credits, adding back to the aging report's total", () => {
    const side = splitOpenSide(receivables, AS_OF, "invoice");
    expect(side).toMatchObject({
      overdueMinor: 13_550_00,
      overdueDocuments: 3,
      dueSoonMinor: 6_200_00,
      dueSoonDocuments: 2,
      laterMinor: 10_000_00,
      laterDocuments: 2,
      creditsMinor: -750_00,
      documents: 7,
    });
    // The same total and buckets the aging report computes from the same rows.
    const report = computeAging(receivables.map((r) => ({ dueDate: r.dueDate, balanceMinor: r.balanceMinor })), AS_OF);
    expect(side.totalMinor).toBe(report.total);
    expect(side.totalMinor).toBe(side.overdueMinor + side.dueSoonMinor + side.laterMinor + side.creditsMinor);
    expect(side.buckets).toEqual(report.buckets);
    expect(Object.values(side.buckets).reduce((a, b) => a + b, 0)).toBe(side.totalMinor);
  });

  it("counts only the bills as documents on the payables side", () => {
    const payables = [
      item("v1", "bill", "2026-11-01", 2_800_00, "B-1"),
      item("v1", "vendor_credit", "2026-11-01", -300_00, "VC-1"),
      item("v2", "bill_payment", "2026-11-05", -100_00, null),
    ];
    const side = splitOpenSide(payables, AS_OF, "bill");
    expect(side).toMatchObject({ documents: 1, overdueDocuments: 1, overdueMinor: 2_800_00, creditsMinor: -400_00, totalMinor: 2_400_00 });
  });

  it("is all zeros with nothing open", () => {
    expect(splitOpenSide([], AS_OF, "invoice")).toMatchObject({ totalMinor: 0, documents: 0, creditsMinor: 0 });
  });
});

describe("owesLongest", () => {
  it("lists the customers by their oldest overdue invoice, with their overdue total and days late", () => {
    expect(owesLongest(receivables, AS_OF, 5)).toEqual([
      { customerId: "c1", name: "Sample c1", overdueMinor: 8_400_00, oldestDueDate: "2026-08-08", daysLate: 97 },
      { customerId: "c2", name: "Sample c2", overdueMinor: 5_150_00, oldestDueDate: "2026-09-22", daysLate: 52 },
    ]);
  });

  it("stops at the limit", () => {
    expect(owesLongest(receivables, AS_OF, 1).map((r) => r.customerId)).toEqual(["c1"]);
  });
});

describe("nextBills", () => {
  it("lists open bills soonest due first, a late one with negative days, and leaves credits out", () => {
    const payables = [
      item("v2", "bill", "2026-12-02", 3_900_00, "B-7"),
      item("v1", "bill", "2026-11-16", 2_750_00, "B-5"),
      item("v3", "bill", "2026-11-01", 2_800_00, null),
      item("v1", "vendor_credit", "2026-10-01", -300_00, "VC-1"),
    ];
    expect(nextBills(payables, AS_OF, 5)).toEqual([
      { vendorName: "Sample v3", billNumber: null, dueDate: "2026-11-01", daysUntilDue: -12, balanceMinor: 2_800_00 },
      { vendorName: "Sample v1", billNumber: "B-5", dueDate: "2026-11-16", daysUntilDue: 3, balanceMinor: 2_750_00 },
      { vendorName: "Sample v2", billNumber: "B-7", dueDate: "2026-12-02", daysUntilDue: 19, balanceMinor: 3_900_00 },
    ]);
    expect(nextBills(payables, AS_OF, 2)).toHaveLength(2);
  });
});

describe("projection", () => {
  it("adds invoices and takes off bills due in the next 30 days, leaves credits out and reports what is late", () => {
    const payables = [
      item("v1", "bill", "2026-11-16", 2_750_00),
      item("v2", "bill", "2026-12-13", 1_000_00), // day 30: in
      item("v2", "bill", "2026-12-14", 9_000_00), // day 31: out
      item("v3", "bill", "2026-11-01", 2_800_00), // late: out, reported
      item("v1", "vendor_credit", "2026-11-20", -300_00),
    ];
    const result = projection(100_000_00, receivables, payables, AS_OF);
    expect(result).toEqual({
      through: "2026-12-13",
      // INV-4 to INV-6 are due inside the window, INV-7 after it; the credits are not counted.
      invoicesDueMinor: 2_000_00 + 4_200_00 + 3_900_00,
      billsDueMinor: 3_750_00,
      projectedMinor: 100_000_00 + 10_100_00 - 3_750_00,
      overdueLeftOutMinor: 13_550_00,
      overdueBillsLeftOutMinor: 2_800_00,
    });
  });
});

describe("projections (3.0.41)", () => {
  const payables = [
    item("v1", "bill", "2026-11-16", 2_750_00),
    item("v2", "bill", "2026-12-13", 1_000_00), // day 30
    item("v2", "bill", "2026-12-14", 9_000_00), // day 31
    item("v4", "bill", "2027-02-11", 500_00), // day 90: in the last horizon only
    item("v4", "bill", "2027-02-12", 700_00), // day 91: in none
    item("v3", "bill", "2026-11-01", 2_800_00), // late: out, reported
    item("v1", "vendor_credit", "2026-11-20", -300_00),
  ];

  it("looks 30, 60 and 90 days ahead from the same rows, each the open documents due in its window", () => {
    const all = projections(100_000_00, receivables, payables, AS_OF);
    expect(Object.keys(all)).toEqual(["30", "60", "90"]);
    // Each is exactly projection() at its horizon.
    for (const days of PROJECTION_HORIZONS) expect(all[days]).toEqual(projection(100_000_00, receivables, payables, AS_OF, days));
    expect(all[30]).toMatchObject({ through: "2026-12-13", invoicesDueMinor: 10_100_00, billsDueMinor: 3_750_00 });
    // 60 days: INV-7 (December 20) and the December 14 bill come in.
    expect(all[60]).toMatchObject({ through: "2027-01-12", invoicesDueMinor: 16_200_00, billsDueMinor: 12_750_00, projectedMinor: 100_000_00 + 16_200_00 - 12_750_00 });
    // 90 days: through February 11, the bill due that day included and the one due the next day not.
    expect(all[90]).toMatchObject({ through: "2027-02-11", invoicesDueMinor: 16_200_00, billsDueMinor: 13_250_00, projectedMinor: 100_000_00 + 16_200_00 - 13_250_00 });
    // What is late is left out of every horizon alike.
    for (const days of PROJECTION_HORIZONS) {
      expect(all[days]).toMatchObject({ overdueLeftOutMinor: 13_550_00, overdueBillsLeftOutMinor: 2_800_00 });
    }
  });

  it("sums, at every horizon, the invoices and bills due from asOf through its last day, and nothing else", () => {
    const all = projections(0, receivables, payables, AS_OF);
    for (const days of PROJECTION_HORIZONS) {
      const through = all[days].through;
      const due = (rows: readonly OpenItemRow[], type: string) =>
        rows.filter((r) => r.docType === type && r.balanceMinor > 0 && r.dueDate >= AS_OF && r.dueDate <= through).reduce((s, r) => s + r.balanceMinor, 0);
      expect(all[days].invoicesDueMinor, String(days)).toBe(due(receivables, "invoice"));
      expect(all[days].billsDueMinor, String(days)).toBe(due(payables, "bill"));
    }
  });
});

describe("the facts behind Needs attention", () => {
  it("counts overdue invoices with the oldest one's days late, and bills due within the week", () => {
    expect(overdueSummary(receivables, AS_OF, "invoice")).toEqual({ count: 3, amountMinor: 13_550_00, oldestDaysLate: 97 });
    expect(dueSoonSummary(receivables, AS_OF, "invoice")).toEqual({ count: 2, amountMinor: 6_200_00, firstDueDate: "2026-11-13" });
    expect(overdueSummary([], AS_OF, "bill")).toBeNull();
    expect(dueSoonSummary([], AS_OF, "bill")).toBeNull();
  });
});
