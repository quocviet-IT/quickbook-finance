import { describe, expect, it } from "vitest";
import {
  daysApart,
  DEFAULT_PAIR_WINDOW,
  findBankPairs,
  fundingAccountAllowed,
  lastFourDigits,
  namedTransferTarget,
  PAIR_WINDOW_OPTIONS,
  suggestFundingAccount,
  type PairBank,
  type PairLine,
} from "@/lib/domain/bank-pairs";

const line = (id: string, bankAccountId: string, txnDate: string, amountMinor: number, description = id): PairLine => ({
  id,
  bankAccountId,
  txnDate,
  amountMinor,
  description,
});

describe("daysApart", () => {
  it("counts whole days either way", () => {
    expect(daysApart("2026-09-30", "2026-10-02")).toBe(2);
    expect(daysApart("2026-10-02", "2026-09-30")).toBe(2);
    expect(daysApart("2026-09-30", "2026-09-30")).toBe(0);
  });
});

describe("findBankPairs", () => {
  it("pairs money out of one account with the same money into another as a transfer", () => {
    const facts = findBankPairs([line("out", "chk", "2026-09-10", -100000), line("in", "sav", "2026-09-11", 100000)], 7, { fundingEnabled: true });
    expect(facts.get("out")).toMatchObject({ kind: "transfer", counterpart: { id: "in" } });
    expect(facts.get("in")).toMatchObject({ kind: "transfer", counterpart: { id: "out" } });
  });
  it("pairs a deposit and a payment of the same amount on one account as funding, when funding is on", () => {
    const lines = [line("wire", "chk", "2026-02-09", 38994147), line("cheque", "chk", "2026-02-11", -38994147)];
    expect(findBankPairs(lines, 7, { fundingEnabled: true }).get("cheque")).toMatchObject({ kind: "funding", counterpart: { id: "wire" } });
    expect(findBankPairs(lines, 7, { fundingEnabled: false }).size).toBe(0);
  });
  it("offers nothing outside the window, or for two lines going the same way", () => {
    expect(findBankPairs([line("a", "chk", "2026-09-01", -500), line("b", "sav", "2026-09-20", 500)], 7, { fundingEnabled: true }).size).toBe(0);
    expect(findBankPairs([line("a", "chk", "2026-09-01", -500), line("b", "sav", "2026-09-02", -500)], 7, { fundingEnabled: true }).size).toBe(0);
  });
  it("offers no pair when a line has two candidates, and says how many", () => {
    const facts = findBankPairs(
      [line("out", "chk", "2026-09-10", -100000), line("in1", "sav", "2026-09-11", 100000), line("in2", "mm", "2026-09-12", 100000)],
      7,
      { fundingEnabled: true },
    );
    expect(facts.get("out")).toEqual({ kind: "ambiguous", rivals: 2 });
    expect(facts.get("in1")?.kind).not.toBe("transfer");
  });
  it("never uses a line twice, and never offers a transfer pair as funding", () => {
    const facts = findBankPairs(
      [line("out", "chk", "2026-09-10", -100000), line("in", "sav", "2026-09-10", 100000), line("dep", "chk", "2026-09-10", 100000)],
      7,
      { fundingEnabled: true },
    );
    // "out" has one transfer candidate ("in") and one funding candidate ("dep"): the transfer wins.
    expect(facts.get("out")).toMatchObject({ kind: "transfer", counterpart: { id: "in" } });
    expect(facts.get("dep")).toBeUndefined();
  });
  it("ignores zero amounts", () => {
    expect(findBankPairs([line("a", "chk", "2026-09-10", 0), line("b", "sav", "2026-09-10", 0)], 7, { fundingEnabled: true }).size).toBe(0);
  });
  it("knows its window options", () => {
    expect(PAIR_WINDOW_OPTIONS).toEqual([0, 1, 3, 7, 14, 30]);
    expect(DEFAULT_PAIR_WINDOW).toBe(7);
  });
});

describe("namedTransferTarget", () => {
  const banks: PairBank[] = [
    { id: "chk", glAccountId: "gl-chk", label: "Sample Bank · 1010", accountName: "Operating Bank Account", digits: "4821" },
    { id: "sav", glAccountId: "gl-sav", label: "Sample Savings · 1020", accountName: "Savings Account", digits: "7755" },
  ];
  it("finds the other account by its last four digits, or by its full name", () => {
    expect(namedTransferTarget({ bankAccountId: "chk", description: "ONLINE TRANSFER TO SAVINGS 7755" }, banks)?.id).toBe("sav");
    expect(namedTransferTarget({ bankAccountId: "sav", description: "Online transfer from Operating Bank Account" }, banks)?.id).toBe("chk");
  });
  it("needs a transfer word, and never names the line's own account", () => {
    expect(namedTransferTarget({ bankAccountId: "chk", description: "PAYMENT 7755" }, banks)).toBeNull();
    expect(namedTransferTarget({ bankAccountId: "sav", description: "TRANSFER 7755" }, banks)).toBeNull();
  });
  it("reads the last four digits from a masked number or a name", () => {
    expect(lastFourDigits("••4821")).toBe("4821");
    expect(lastFourDigits(null, "Chase 2859")).toBe("2859");
    expect(lastFourDigits("", "Savings")).toBeNull();
  });
});

describe("the funding account", () => {
  const acct = (id: string, account_code: string, name: string, account_type = "current_liability", status = "active", is_posting_account = true) => ({
    id,
    account_code,
    name,
    account_type,
    status,
    is_posting_account,
  });
  it("is an active posting liability", () => {
    expect(fundingAccountAllowed(acct("a", "2600", "Shareholder Loan"))).toBe(true);
    expect(fundingAccountAllowed(acct("a", "2600", "Shareholder Loan", "equity"))).toBe(false);
    expect(fundingAccountAllowed(acct("a", "2600", "Shareholder Loan", "long_term_liability", "inactive"))).toBe(false);
  });
  it("is suggested by name, first by code", () => {
    const accounts = [
      acct("x", "2100", "Sales Tax Payable"),
      acct("b", "2650", "Loan from Owner", "long_term_liability"),
      acct("a", "2600", "Shareholder Loan"),
    ];
    expect(suggestFundingAccount(accounts)).toBe("a");
    expect(suggestFundingAccount([acct("x", "2100", "Sales Tax Payable")])).toBeNull();
  });
});
