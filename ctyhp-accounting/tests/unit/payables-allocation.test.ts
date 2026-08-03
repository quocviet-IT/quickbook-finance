import { describe, expect, it } from "vitest";
import { allocateAcrossBills } from "@/lib/domain/payables";

const bill = (id: string, balanceDueMinor: number, discountMinor = 0) => ({
  billId: id,
  balanceDueMinor,
  discountMinor,
});

describe("allocateAcrossBills", () => {
  it("settles bills in order until the payment runs out", () => {
    expect(
      allocateAcrossBills(80_000, [bill("b1", 50_000), bill("b2", 50_000)]),
    ).toEqual({ b1: 50_000, b2: 30_000 });
  });

  it("leaves nothing allocated to a bill it cannot reach", () => {
    expect(allocateAcrossBills(50_000, [bill("b1", 50_000), bill("b2", 50_000)])).toEqual({
      b1: 50_000,
    });
  });

  it("never allocates more than a bill's balance", () => {
    expect(allocateAcrossBills(90_000, [bill("b1", 50_000)])).toEqual({ b1: 50_000 });
  });

  it("pays a discounted bill with the cash the discount leaves", () => {
    // 1/10 net 30 on a 50,000 bill: 500 comes off, 49,500 in cash settles it.
    expect(allocateAcrossBills(60_000, [bill("b1", 50_000, 500)])).toEqual({ b1: 49_500 });
  });

  it("skips a discounted bill it cannot settle in full", () => {
    // acc_pay_bills only checks payment + discount <= balance, so a partial
    // payment carrying the whole discount would be accepted -- and would
    // relieve more payable than the early payment actually earned. Better to
    // pay a later bill in full than to claim a discount that was not earned.
    expect(allocateAcrossBills(40_000, [bill("b1", 50_000, 500), bill("b2", 30_000)])).toEqual({
      b2: 30_000,
    });
  });

  it("allocates nothing when there is no payment to spread", () => {
    expect(allocateAcrossBills(0, [bill("b1", 50_000)])).toEqual({});
  });

  it("ignores a bill with nothing left owing", () => {
    expect(allocateAcrossBills(50_000, [bill("b1", 0), bill("b2", 20_000)])).toEqual({
      b2: 20_000,
    });
  });

  it("works in whole minor units, so no allocation carries a fraction of a cent", () => {
    const result = allocateAcrossBills(33_333, [bill("b1", 10_000), bill("b2", 10_000)]);
    for (const amount of Object.values(result)) expect(Number.isInteger(amount)).toBe(true);
  });
});
