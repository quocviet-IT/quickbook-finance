import { describe, it, expect } from "vitest";
import { signedBaseMinor, computeReconciliation, buildAdjustmentPosting } from "@/lib/domain/bankrec";

const dep = { debitMinor: 100_00, creditMinor: 0, amountBaseMinor: 100_00 };  // deposit +
const pay = { debitMinor: 0, creditMinor: 40_00, amountBaseMinor: 40_00 };    // payment -

describe("signedBaseMinor", () => {
  it("deposits are positive, payments negative", () => {
    expect(signedBaseMinor(dep)).toBe(100_00);
    expect(signedBaseMinor(pay)).toBe(-40_00);
  });
});

describe("computeReconciliation", () => {
  it("reconciled = beginning + cleared; difference = statement - reconciled", () => {
    const r = computeReconciliation(10_00, [dep, pay], 70_00); // 10 + (100-40) = 70
    expect(r.clearedTotalMinor).toBe(60_00);
    expect(r.reconciledBalanceMinor).toBe(70_00);
    expect(r.differenceMinor).toBe(0);
    expect(r.isBalanced).toBe(true);
  });
  it("flags a non-zero difference", () => {
    const r = computeReconciliation(0, [dep], 90_00); // reconciled 100, statement 90 -> diff -10
    expect(r.differenceMinor).toBe(-10_00);
    expect(r.isBalanced).toBe(false);
  });
});

describe("buildAdjustmentPosting", () => {
  it("positive difference debits the bank (increase)", () => {
    const ls = buildAdjustmentPosting({ bankAccountId: "bank", offsetAccountId: "fee", differenceMinor: 5_00 });
    expect(ls.find((l) => l.accountId === "bank")!.debitMinor).toBe(5_00);
    expect(ls.find((l) => l.accountId === "fee")!.creditMinor).toBe(5_00);
  });
  it("negative difference credits the bank (decrease)", () => {
    const ls = buildAdjustmentPosting({ bankAccountId: "bank", offsetAccountId: "fee", differenceMinor: -5_00 });
    expect(ls.find((l) => l.accountId === "bank")!.creditMinor).toBe(5_00);
    expect(ls.find((l) => l.accountId === "fee")!.debitMinor).toBe(5_00);
  });
});
