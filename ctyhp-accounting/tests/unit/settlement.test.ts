import { describe, expect, it } from "vitest";
import {
  buildSettlementHistory,
  daysBetween,
  describeNoOpenInvoices,
  lastSettlementDate,
  outstandingAge,
  settlementTypeLabel,
  unappliedRemainderMinor,
  type SettlementEvent,
} from "@/lib/domain/settlement";

const payment = (over: Partial<SettlementEvent> = {}): SettlementEvent => ({
  settledOn: "2026-07-10",
  settlementType: "payment",
  documentNumber: "PMT-000004",
  method: "Check",
  reference: "1042",
  memo: null,
  amountMinor: 400_00,
  ...over,
});

describe("buildSettlementHistory", () => {
  it("runs the balance down in date order", () => {
    const history = buildSettlementHistory({
      totalMinor: 1_000_00,
      balanceDueMinor: 350_00,
      events: [
        payment({ settledOn: "2026-07-20", amountMinor: 250_00, documentNumber: "PMT-000009" }),
        payment({ settledOn: "2026-07-10", amountMinor: 400_00 }),
      ],
    });

    expect(history.lines.map((line) => [line.documentNumber, line.balanceAfterMinor])).toEqual([
      ["PMT-000004", 600_00],
      ["PMT-000009", 350_00],
    ]);
    expect(history.settledMinor).toBe(650_00);
    expect(history.reconciles).toBe(true);
  });

  it("counts a credit memo and a write-off as settlements too", () => {
    const history = buildSettlementHistory({
      totalMinor: 500_00,
      balanceDueMinor: 0,
      events: [
        payment({ settledOn: "2026-07-01", amountMinor: 300_00 }),
        {
          settledOn: "2026-07-05",
          settlementType: "credit_memo",
          documentNumber: "CM-000001",
          method: null,
          reference: null,
          memo: "Damaged ring returned",
          amountMinor: 150_00,
        },
        {
          settledOn: "2026-07-09",
          settlementType: "write_off",
          documentNumber: "WO-000001",
          method: null,
          reference: null,
          memo: "Balance uncollectable",
          amountMinor: 50_00,
        },
      ],
    });
    expect(history.settledMinor).toBe(500_00);
    expect(history.lines.at(-1)!.balanceAfterMinor).toBe(0);
    expect(history.reconciles).toBe(true);
  });

  it("says so when the settlements do not add up to the document's own balance", () => {
    const history = buildSettlementHistory({
      totalMinor: 1_000_00,
      balanceDueMinor: 900_00, // the ledger says 900 but only 50 settled
      events: [payment({ amountMinor: 50_00 })],
    });
    expect(history.reconciles).toBe(false);
  });

  it("reports an untouched document as fully outstanding", () => {
    const history = buildSettlementHistory({
      totalMinor: 200_00,
      balanceDueMinor: 200_00,
      events: [],
    });
    expect(history.lines).toEqual([]);
    expect(history.settledMinor).toBe(0);
    expect(history.reconciles).toBe(true);
    expect(lastSettlementDate(history)).toBeNull();
  });

  it("names the last day money landed", () => {
    const history = buildSettlementHistory({
      totalMinor: 1_000_00,
      balanceDueMinor: 350_00,
      events: [payment({ settledOn: "2026-07-20" }), payment({ settledOn: "2026-07-10" })],
    });
    expect(lastSettlementDate(history)).toBe("2026-07-20");
  });

  it("labels each kind the way the table reads", () => {
    expect(settlementTypeLabel("payment")).toBe("Payment");
    expect(settlementTypeLabel("credit_memo")).toBe("Credit memo");
    expect(settlementTypeLabel("vendor_credit")).toBe("Vendor credit");
    expect(settlementTypeLabel("write_off")).toBe("Write-off");
  });
});

describe("daysBetween", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween("2026-07-01", "2026-07-31")).toBe(30);
    expect(daysBetween("2026-07-31", "2026-07-01")).toBe(-30);
    expect(daysBetween("2026-07-01", "2026-07-01")).toBe(0);
  });

  it("crosses a month and a leap day without drifting", () => {
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
    expect(daysBetween("2024-02-27", "2024-03-01")).toBe(3);
  });
});

describe("outstandingAge", () => {
  it("ages a document from its issue date and its due date separately", () => {
    expect(
      outstandingAge({ issueDate: "2026-06-01", dueDate: "2026-07-01", asOf: "2026-07-31" }),
    ).toEqual({ ageDays: 60, overdueDays: 30, isOverdue: true });
  });

  it("is not overdue before the due date", () => {
    expect(
      outstandingAge({ issueDate: "2026-07-20", dueDate: "2026-08-20", asOf: "2026-07-31" }),
    ).toEqual({ ageDays: 11, overdueDays: 0, isOverdue: false });
  });

  it("treats a document with no due date as never overdue", () => {
    expect(
      outstandingAge({ issueDate: "2026-01-01", dueDate: null, asOf: "2026-07-31" }),
    ).toEqual({ ageDays: 211, overdueDays: 0, isOverdue: false });
  });
});

describe("unappliedRemainderMinor", () => {
  it("reports the part of a receipt that lands on no invoice", () => {
    expect(unappliedRemainderMinor(50_000, 30_000)).toBe(20_000);
  });

  it("is silent when the receipt is fully applied", () => {
    expect(unappliedRemainderMinor(50_000, 50_000)).toBeNull();
  });

  it("is silent when nothing has been entered yet", () => {
    expect(unappliedRemainderMinor(0, 0)).toBeNull();
  });

  it("does not report a negative remainder as unapplied cash", () => {
    // Over-allocating is its own error, already shown in red. It must not also
    // claim a credit is waiting on the customer's account.
    expect(unappliedRemainderMinor(30_000, 50_000)).toBeNull();
  });
});

describe("describeNoOpenInvoices", () => {
  it("asks for a customer before blaming the ledger", () => {
    expect(describeNoOpenInvoices(null)).toBe("Select a customer to see their open invoices");
  });

  it("names the customer and says what recording anyway would do", () => {
    const text = describeNoOpenInvoices("Cormorant Gallery");
    expect(text).toContain("Cormorant Gallery has no open invoices");
    expect(text).toContain("credit");
  });
});
