import { describe, expect, it } from "vitest";
import {
  checkInvoiceAgainstCredit,
  creditStateColor,
  creditStatus,
  daysSalesOutstanding,
  sortByCreditRisk,
  suggestCreditLimitMinor,
  type CreditStatus,
} from "@/lib/domain/credit";

const LIMIT = 1_000_00; // $1,000.00 in minor units

describe("creditStatus", () => {
  it("reports headroom against the limit", () => {
    const status = creditStatus({
      creditLimitMinor: LIMIT,
      creditHold: false,
      openBalanceMinor: 250_00,
      overdueMinor: 0,
    });
    expect(status.state).toBe("within_limit");
    expect(status.availableMinor).toBe(750_00);
    expect(status.utilization).toBeCloseTo(0.25);
    expect(status.reasons).toEqual([]);
  });

  it("warns from 80% of the limit", () => {
    const near = creditStatus({
      creditLimitMinor: LIMIT,
      creditHold: false,
      openBalanceMinor: 800_00,
      overdueMinor: 0,
    });
    expect(near.state).toBe("near_limit");

    const under = creditStatus({
      creditLimitMinor: LIMIT,
      creditHold: false,
      openBalanceMinor: 799_99,
      overdueMinor: 0,
    });
    expect(under.state).toBe("within_limit");
  });

  it("says by how much an account is over, in money", () => {
    const status = creditStatus({
      creditLimitMinor: LIMIT,
      creditHold: false,
      openBalanceMinor: 1_250_00,
      overdueMinor: 0,
    });
    expect(status.state).toBe("over_limit");
    expect(status.availableMinor).toBe(-250_00);
    expect(status.reasons).toEqual(["$250.00 over the $1,000.00 limit"]);
  });

  it("puts a hold above every other state", () => {
    const status = creditStatus({
      creditLimitMinor: LIMIT,
      creditHold: true,
      openBalanceMinor: 10_00,
      overdueMinor: 0,
    });
    expect(status.state).toBe("hold");
    expect(status.reasons).toEqual(["The account is on credit hold"]);
  });

  it("treats a zero limit as cash only, not as no limit", () => {
    const status = creditStatus({
      creditLimitMinor: 0,
      creditHold: false,
      openBalanceMinor: 1_00,
      overdueMinor: 0,
    });
    expect(status.state).toBe("over_limit");
    expect(status.utilization).toBe(1);
  });

  it("enforces nothing when no limit has been set", () => {
    const status = creditStatus({
      creditLimitMinor: null,
      creditHold: false,
      openBalanceMinor: 99_999_00,
      overdueMinor: 0,
    });
    expect(status.state).toBe("no_limit");
    expect(status.availableMinor).toBeNull();
    expect(status.utilization).toBeNull();
  });

  it("still reports overdue money on an account that is inside its limit", () => {
    const status = creditStatus({
      creditLimitMinor: LIMIT,
      creditHold: false,
      openBalanceMinor: 100_00,
      overdueMinor: 100_00,
    });
    expect(status.state).toBe("within_limit");
    expect(status.reasons).toEqual(["$100.00 is past due"]);
  });
});

describe("daysSalesOutstanding", () => {
  it("measures the balance against what was invoiced over the window", () => {
    // $3,000 owed on $9,000 invoiced in 90 days → 30 days outstanding.
    expect(daysSalesOutstanding(3_000_00, 9_000_00, 90)).toBe(30);
  });

  it("has no answer when nothing was invoiced", () => {
    expect(daysSalesOutstanding(1_000_00, 0, 90)).toBeNull();
    expect(daysSalesOutstanding(0, 0, 90)).toBeNull();
  });

  it("is reported by creditStatus when the window is supplied", () => {
    const status = creditStatus({
      creditLimitMinor: null,
      creditHold: false,
      openBalanceMinor: 3_000_00,
      overdueMinor: 0,
      salesWindowMinor: 9_000_00,
      salesWindowDays: 90,
    });
    expect(status.daysSalesOutstanding).toBe(30);
  });
});

describe("checkInvoiceAgainstCredit", () => {
  const base = (over: Partial<Parameters<typeof checkInvoiceAgainstCredit>[0]> = {}) => {
    const status = creditStatus({
      creditLimitMinor: over.creditLimitMinor ?? LIMIT,
      creditHold: over.creditHold ?? false,
      openBalanceMinor: over.openBalanceMinor ?? 0,
      overdueMinor: over.status?.overdueMinor ?? 0,
    });
    return checkInvoiceAgainstCredit({
      status,
      creditLimitMinor: LIMIT,
      creditHold: false,
      openBalanceMinor: 0,
      invoiceTotalMinor: 100_00,
      ...over,
    });
  };

  it("lets an invoice through that stays inside the limit", () => {
    const check = base({ openBalanceMinor: 100_00, invoiceTotalMinor: 200_00 });
    expect(check.blocked).toBe(false);
    expect(check.warning).toBe(false);
    expect(check.projectedBalanceMinor).toBe(300_00);
    expect(check.projectedAvailableMinor).toBe(700_00);
    expect(check.message).toBeNull();
  });

  it("blocks the invoice that crosses the limit, and says by how much", () => {
    const check = base({ openBalanceMinor: 900_00, invoiceTotalMinor: 200_00 });
    expect(check.blocked).toBe(true);
    expect(check.projectedBalanceMinor).toBe(1_100_00);
    expect(check.projectedAvailableMinor).toBe(-100_00);
    expect(check.message).toContain("$1,100.00");
    expect(check.message).toContain("$1,000.00 limit");
  });

  it("allows the invoice that lands exactly on the limit", () => {
    const check = base({ openBalanceMinor: 900_00, invoiceTotalMinor: 100_00 });
    expect(check.blocked).toBe(false);
    expect(check.projectedAvailableMinor).toBe(0);
    // Still worth a word: it uses the whole limit.
    expect(check.warning).toBe(true);
  });

  it("blocks anything for a customer on hold, however small", () => {
    const check = base({ creditHold: true, invoiceTotalMinor: 1 });
    expect(check.blocked).toBe(true);
    expect(check.message).toContain("credit hold");
  });

  it("never blocks when no limit is set", () => {
    const check = base({ creditLimitMinor: null, invoiceTotalMinor: 999_999_00 });
    expect(check.blocked).toBe(false);
    expect(check.projectedAvailableMinor).toBeNull();
  });

  it("mentions a missing billing address without blocking on it", () => {
    const check = base({ hasBillingAddress: false });
    expect(check.blocked).toBe(false);
    expect(check.warning).toBe(true);
    expect(check.message).toContain("Bill to");
  });

  it("mentions money already past due", () => {
    const status = creditStatus({
      creditLimitMinor: LIMIT,
      creditHold: false,
      openBalanceMinor: 200_00,
      overdueMinor: 150_00,
    });
    const check = checkInvoiceAgainstCredit({
      status,
      creditLimitMinor: LIMIT,
      creditHold: false,
      openBalanceMinor: 200_00,
      invoiceTotalMinor: 100_00,
    });
    expect(check.blocked).toBe(false);
    expect(check.message).toContain("$150.00 is already past due");
  });
});

describe("suggestCreditLimitMinor", () => {
  it("covers a repeat order of the largest invoice, rounded to a round number", () => {
    // $1,667.05 largest → $3,334.10 → rounded up to $3,500.
    expect(
      suggestCreditLimitMinor({ largestInvoiceMinor: 1_667_05, openBalanceMinor: 1_752_57 }),
    ).toBe(3_500_00);
  });

  it("never suggests a limit an existing balance is already over", () => {
    const suggested = suggestCreditLimitMinor({
      largestInvoiceMinor: 100_00,
      openBalanceMinor: 9_000_00,
    });
    expect(suggested).toBeGreaterThan(9_000_00);
    expect(suggested % 500_00).toBe(0);
  });

  it("keeps a floor for a customer who has barely traded", () => {
    expect(
      suggestCreditLimitMinor({ largestInvoiceMinor: 162_38, openBalanceMinor: 162_38 }),
    ).toBe(1_000_00);
  });

  it("takes a different floor when the business sets one", () => {
    expect(
      suggestCreditLimitMinor({
        largestInvoiceMinor: 0,
        openBalanceMinor: 0,
        floorMinor: 2_500_00,
      }),
    ).toBe(2_500_00);
  });

  it("lands exactly on a round figure when the arithmetic already does", () => {
    expect(
      suggestCreditLimitMinor({ largestInvoiceMinor: 1_750_00, openBalanceMinor: 0 }),
    ).toBe(3_500_00);
  });
});

describe("presentation helpers", () => {
  it("paints hold and over-limit alike, and an unset limit neutrally", () => {
    expect(creditStateColor("hold")).toBe("red");
    expect(creditStateColor("over_limit")).toBe("red");
    expect(creditStateColor("near_limit")).toBe("orange");
    expect(creditStateColor("within_limit")).toBe("green");
    expect(creditStateColor("no_limit")).toBe("default");
  });

  it("opens a review with the accounts that are in trouble", () => {
    const row = (name: string, status: CreditStatus, openBalanceMinor: number) => ({
      name,
      status,
      openBalanceMinor,
    });
    const held = creditStatus({ creditLimitMinor: LIMIT, creditHold: true, openBalanceMinor: 10_00, overdueMinor: 0 });
    const over = creditStatus({ creditLimitMinor: LIMIT, creditHold: false, openBalanceMinor: 1_500_00, overdueMinor: 0 });
    const near = creditStatus({ creditLimitMinor: LIMIT, creditHold: false, openBalanceMinor: 850_00, overdueMinor: 0 });
    const fine = creditStatus({ creditLimitMinor: LIMIT, creditHold: false, openBalanceMinor: 0, overdueMinor: 0 });

    expect(
      sortByCreditRisk([row("fine", fine, 0), row("near", near, 850_00), row("over", over, 1_500_00), row("held", held, 10_00)]).map(
        (r) => r.name,
      ),
    ).toEqual(["held", "over", "near", "fine"]);
  });
});
