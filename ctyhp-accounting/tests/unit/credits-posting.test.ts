import { describe, it, expect } from "vitest";
import {
  buildCreditMemoPosting, buildVendorCreditPosting, buildRefundPosting, buildWriteOffPosting,
} from "@/lib/domain/posting";

const bal = (ls: { debitMinor: number; creditMinor: number }[]) =>
  ls.reduce((s, l) => s + l.debitMinor, 0) === ls.reduce((s, l) => s + l.creditMinor, 0);

describe("buildCreditMemoPosting", () => {
  it("debits income and tax, credits AR for the total", () => {
    const ls = buildCreditMemoPosting({
      arAccountId: "ar", taxPayableAccountId: "tax",
      lines: [{ incomeAccountId: "inc", subtotalMinor: 100_00, taxMinor: 8_00 }],
    });
    const ar = ls.find((l) => l.accountId === "ar")!;
    expect(ar.creditMinor).toBe(108_00);
    expect(ls.find((l) => l.accountId === "inc")!.debitMinor).toBe(100_00);
    expect(ls.find((l) => l.accountId === "tax")!.debitMinor).toBe(8_00);
    expect(bal(ls)).toBe(true);
  });
});

describe("buildVendorCreditPosting", () => {
  it("debits AP total and credits expense", () => {
    const ls = buildVendorCreditPosting({ apAccountId: "ap", lines: [{ expenseAccountId: "exp", amountMinor: 50_00 }] });
    expect(ls.find((l) => l.accountId === "ap")!.debitMinor).toBe(50_00);
    expect(ls.find((l) => l.accountId === "exp")!.creditMinor).toBe(50_00);
    expect(bal(ls)).toBe(true);
  });
});

describe("buildRefundPosting", () => {
  it("debits AR and credits bank", () => {
    const ls = buildRefundPosting({ arAccountId: "ar", bankAccountId: "bank", amountMinor: 25_00 });
    expect(ls.find((l) => l.accountId === "ar")!.debitMinor).toBe(25_00);
    expect(ls.find((l) => l.accountId === "bank")!.creditMinor).toBe(25_00);
    expect(bal(ls)).toBe(true);
  });
});

describe("buildWriteOffPosting", () => {
  it("AR write-off debits offset expense and credits AR", () => {
    const ls = buildWriteOffPosting({ side: "ar", controlAccountId: "ar", offsetAccountId: "baddebt", amountMinor: 40_00 });
    expect(ls.find((l) => l.accountId === "baddebt")!.debitMinor).toBe(40_00);
    expect(ls.find((l) => l.accountId === "ar")!.creditMinor).toBe(40_00);
    expect(bal(ls)).toBe(true);
  });
  it("AP write-off debits AP and credits offset income", () => {
    const ls = buildWriteOffPosting({ side: "ap", controlAccountId: "ap", offsetAccountId: "otherinc", amountMinor: 3_00 });
    expect(ls.find((l) => l.accountId === "ap")!.debitMinor).toBe(3_00);
    expect(ls.find((l) => l.accountId === "otherinc")!.creditMinor).toBe(3_00);
    expect(bal(ls)).toBe(true);
  });
});
