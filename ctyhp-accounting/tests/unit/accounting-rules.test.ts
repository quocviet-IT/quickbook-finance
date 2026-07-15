import { describe, it, expect } from "vitest";
import {
  normalBalanceOf,
  statementSectionOf,
  naturalBalance,
  assertNoCycle,
} from "@/lib/domain/accounts";
import { computeInvoiceLine, sumInvoiceTotals, toMinor, fromMinor } from "@/lib/domain/money";
import {
  buildInvoicePosting,
  buildPaymentPosting,
  isBalanced,
  reverse,
  assertBalanced,
} from "@/lib/domain/posting";

describe("account rules", () => {
  it("derives normal balance from type", () => {
    expect(normalBalanceOf("bank")).toBe("debit");
    expect(normalBalanceOf("expense")).toBe("debit");
    expect(normalBalanceOf("income")).toBe("credit");
    expect(normalBalanceOf("accounts_payable")).toBe("credit");
    expect(normalBalanceOf("equity")).toBe("credit");
  });

  it("classifies statement section", () => {
    expect(statementSectionOf("bank")).toBe("balance_sheet");
    expect(statementSectionOf("income")).toBe("profit_and_loss");
    expect(statementSectionOf("cost_of_goods_sold")).toBe("profit_and_loss");
    expect(statementSectionOf("equity")).toBe("balance_sheet");
  });

  it("computes natural balance in the account's own direction", () => {
    // A revenue account credited 1000 shows +1000 naturally.
    expect(naturalBalance("income", 0, 1000)).toBe(1000);
    // A bank account debited 1000 shows +1000 naturally.
    expect(naturalBalance("bank", 1000, 0)).toBe(1000);
  });

  it("detects hierarchy cycles", () => {
    const parents: Record<string, string | null> = { a: null, b: "a", c: "b" };
    const parentOf = (id: string) => parents[id] ?? null;
    // Attaching a under c would make a its own ancestor.
    expect(() => assertNoCycle("a", "c", parentOf)).toThrow();
    // Attaching a fresh node under c is fine.
    expect(() => assertNoCycle("d", "c", parentOf)).not.toThrow();
  });
});

describe("money", () => {
  it("round-trips decimal <-> minor units", () => {
    expect(toMinor(12.34, 2)).toBe(1234);
    expect(fromMinor(1234, 2)).toBe(12.34);
    // VND has 0 decimal places.
    expect(toMinor(150000, 0)).toBe(150000);
  });

  it("computes an invoice line with tax", () => {
    const line = computeInvoiceLine({ quantity: 3, unitPriceMinor: 10000, taxRatePercent: 10 });
    expect(line.subtotalMinor).toBe(30000);
    expect(line.taxMinor).toBe(3000);
    expect(line.totalMinor).toBe(33000);
  });

  it("handles fractional quantity with rounding", () => {
    // 2.5 units @ 333 minor = 832.5 -> 833
    const line = computeInvoiceLine({ quantity: 2.5, unitPriceMinor: 333, taxRatePercent: 0 });
    expect(line.subtotalMinor).toBe(833);
  });

  it("sums invoice totals", () => {
    const totals = sumInvoiceTotals([
      { subtotalMinor: 30000, taxMinor: 3000, totalMinor: 33000 },
      { subtotalMinor: 5000, taxMinor: 500, totalMinor: 5500 },
    ]);
    expect(totals).toEqual({ subtotalMinor: 35000, taxTotalMinor: 3500, totalMinor: 38500 });
  });
});

describe("double-entry posting", () => {
  it("builds a balanced invoice posting with tax", () => {
    const lines = buildInvoicePosting({
      arAccountId: "ar",
      taxPayableAccountId: "tax",
      lines: [
        { incomeAccountId: "sales", subtotalMinor: 30000, taxMinor: 3000 },
        { incomeAccountId: "sales", subtotalMinor: 5000, taxMinor: 500 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    const ar = lines.find((l) => l.accountId === "ar")!;
    expect(ar.debitMinor).toBe(38500);
    // Same income account is grouped into a single credit line.
    const sales = lines.filter((l) => l.accountId === "sales");
    expect(sales).toHaveLength(1);
    expect(sales[0].creditMinor).toBe(35000);
    const tax = lines.find((l) => l.accountId === "tax")!;
    expect(tax.creditMinor).toBe(3500);
  });

  it("omits the tax line when there is no tax", () => {
    const lines = buildInvoicePosting({
      arAccountId: "ar",
      taxPayableAccountId: null,
      lines: [{ incomeAccountId: "sales", subtotalMinor: 10000, taxMinor: 0 }],
    });
    expect(lines.find((l) => l.accountId === "tax")).toBeUndefined();
    expect(isBalanced(lines)).toBe(true);
  });

  it("throws when tax exists but no tax account is provided", () => {
    expect(() =>
      buildInvoicePosting({
        arAccountId: "ar",
        taxPayableAccountId: null,
        lines: [{ incomeAccountId: "sales", subtotalMinor: 10000, taxMinor: 1000 }],
      }),
    ).toThrow();
  });

  it("builds a balanced payment posting", () => {
    const lines = buildPaymentPosting({ depositAccountId: "bank", arAccountId: "ar", amountMinor: 33000 });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountId === "bank")!.debitMinor).toBe(33000);
    expect(lines.find((l) => l.accountId === "ar")!.creditMinor).toBe(33000);
  });

  it("reversal swaps debit and credit and stays balanced", () => {
    const original = buildPaymentPosting({ depositAccountId: "bank", arAccountId: "ar", amountMinor: 33000 });
    const rev = reverse(original);
    expect(rev.find((l) => l.accountId === "bank")!.creditMinor).toBe(33000);
    expect(isBalanced(rev)).toBe(true);
  });

  it("rejects a line with both debit and credit", () => {
    expect(() => assertBalanced([{ accountId: "x", debitMinor: 10, creditMinor: 10 }])).toThrow();
  });
});
