import { describe, expect, it } from "vitest";
import type { LedgerBalance } from "@/lib/domain/reports";
import {
  RETAINED_EARNINGS_KEY,
  RETAINED_EARNINGS_LABEL,
  buildWorkingTrialBalance,
  type AdjustingEntry,
  type WorkingTrialBalance,
  type WorkingTrialBalanceInput,
} from "@/lib/domain/working-trial-balance";

type Account = Pick<LedgerBalance, "accountId" | "accountCode" | "name" | "accountType">;
const acct = (accountId: string, accountCode: string, name: string, accountType: Account["accountType"]): Account => ({
  accountId,
  accountCode,
  name,
  accountType,
});
const CASH = acct("cash", "1000", "Cash", "bank");
const PAYABLE = acct("ap", "2000", "Accounts Payable", "accounts_payable");
const ACCRUED = acct("accrued", "2100", "Accrued Liabilities", "current_liability");
const EQUITY = acct("equity", "3000", "Owner's Equity", "equity");
const SALES = acct("sales", "4000", "Sales", "income");
const RENT = acct("rent", "6100", "Rent", "expense");

const bal = (a: Account, debitBase: number, creditBase: number): LedgerBalance => ({ ...a, debitBase, creditBase });

/** 2025: $10,000 put in, $5,000 sold, $2,000 rent paid. */
const BEFORE = [
  bal(CASH, 1_500_000, 200_000),
  bal(PAYABLE, 0, 0),
  bal(ACCRUED, 0, 0),
  bal(EQUITY, 0, 1_000_000),
  bal(SALES, 0, 500_000),
  bal(RENT, 200_000, 0),
];

/** Q1 2026: $4,000 sold, $1,000 rent paid, and $500 of March rent accrued at the quarter end. */
const MOVEMENTS = [
  bal(CASH, 400_000, 100_000),
  bal(PAYABLE, 0, 0),
  bal(ACCRUED, 0, 50_000),
  bal(EQUITY, 0, 0),
  bal(SALES, 0, 400_000),
  bal(RENT, 150_000, 0),
];

const ACCRUAL: AdjustingEntry = {
  entryId: "je-accrual",
  entryNumber: "JE-000120",
  entryDate: "2026-03-31",
  description: "Rent accrual",
  name: "Harbour Property Ltd",
  note: "March rent billed in April",
  lines: [
    { accountId: "rent", accountCode: "6100", accountName: "Rent", accountType: "expense", debitBase: 50_000, creditBase: 0 },
    {
      accountId: "accrued",
      accountCode: "2100",
      accountName: "Accrued Liabilities",
      accountType: "current_liability",
      debitBase: 0,
      creditBase: 50_000,
    },
  ],
};

const Q1 = { from: "2026-01-01", to: "2026-03-31" };
const build = (over: Partial<WorkingTrialBalanceInput> = {}) =>
  buildWorkingTrialBalance({ ...Q1, before: BEFORE, movements: MOVEMENTS, adjusting: [ACCRUAL], ...over });
const row = (r: WorkingTrialBalance, key: string) => r.rows.find((x) => x.key === key);

describe("buildWorkingTrialBalance", () => {
  it("carries a balance-sheet account forward and starts income afresh", () => {
    const r = build();
    expect(row(r, "cash")).toMatchObject({ unadjusted: 1_600_000, adjustment: 0, adjusted: 1_600_000 });
    expect(row(r, "sales")).toMatchObject({ unadjusted: -400_000, adjustment: 0, adjusted: -400_000 });
  });

  it("puts a marked entry in the middle column and only there", () => {
    const r = build();
    expect(row(r, "rent")).toMatchObject({ unadjusted: 100_000, adjustment: 50_000, adjusted: 150_000 });
    expect(row(r, "accrued")).toMatchObject({ unadjusted: 0, adjustment: -50_000, adjusted: -50_000 });
  });

  it("carries the result of earlier periods on one retained-earnings line", () => {
    expect(row(build(), RETAINED_EARNINGS_KEY)).toEqual({
      key: RETAINED_EARNINGS_KEY,
      accountId: null,
      accountCode: "",
      name: RETAINED_EARNINGS_LABEL,
      unadjusted: -300_000,
      adjustment: 0,
      adjusted: -300_000,
    });
  });

  it("balances all three column pairs, which the prototype checks", () => {
    const r = build();
    expect(r.totals).toEqual({
      unadjustedDebit: 1_700_000,
      unadjustedCredit: 1_700_000,
      adjustmentDebit: 50_000,
      adjustmentCredit: 50_000,
      adjustedDebit: 1_750_000,
      adjustedCredit: 1_750_000,
    });
    expect(r.balanced).toBe(true);
  });

  it("lists the balance sheet, then retained earnings, then profit and loss, and leaves out empty accounts", () => {
    expect(build().rows.map((x) => x.key)).toEqual(["cash", "accrued", "equity", RETAINED_EARNINGS_KEY, "sales", "rent"]);
  });

  it("ignores a marked entry dated outside the range", () => {
    const outside: AdjustingEntry = { ...ACCRUAL, entryId: "je-old", entryDate: "2025-12-31" };
    const r = build({ adjusting: [ACCRUAL, outside] });
    expect(row(r, "rent")?.adjustment).toBe(50_000);
    expect(r.adjustingEntryCount).toBe(1);
  });

  it("counts accounts, not the retained-earnings line", () => {
    expect(build().accountCount).toBe(5);
  });

  it("has no retained-earnings line when nothing came before", () => {
    const r = build({ before: [] });
    expect(row(r, RETAINED_EARNINGS_KEY)).toBeUndefined();
    expect(r.balanced).toBe(true);
  });

  it("says so when the columns do not agree", () => {
    const r = build({ movements: [bal(CASH, 100, 0)], before: [], adjusting: [] });
    expect(r.balanced).toBe(false);
  });

  it("is empty, and balanced, for an empty book", () => {
    const r = build({ before: [], movements: [], adjusting: [] });
    expect(r.rows).toEqual([]);
    expect(r.balanced).toBe(true);
    expect(r.adjustments).toEqual([]);
  });
});

describe("the adjustments list", () => {
  const EARLIER: AdjustingEntry = {
    ...ACCRUAL,
    entryId: "je-feb",
    entryNumber: "JE-000090",
    entryDate: "2026-02-28",
    name: "Coastline Insurance",
    note: null,
    description: "Prepaid insurance used in February",
  };

  it("numbers the entries AJE 1, AJE 2 in date order", () => {
    const r = build({ adjusting: [ACCRUAL, EARLIER] });
    expect(r.adjustments.filter((a) => a.first).map((a) => [a.number, a.date])).toEqual([
      ["AJE 1", "2026-02-28"],
      ["AJE 2", "2026-03-31"],
    ]);
  });

  it("puts number, date, name and why on each entry's first posting only", () => {
    const [first, second] = build().adjustments;
    expect(first).toMatchObject({
      entryId: "je-accrual",
      first: true,
      number: "AJE 1",
      date: "2026-03-31",
      name: "Harbour Property Ltd",
      account: "6100 Rent",
      debit: 50_000,
      credit: 0,
      why: "March rent billed in April",
    });
    expect(second).toMatchObject({
      entryId: "je-accrual",
      first: false,
      number: null,
      date: null,
      name: null,
      account: "2100 Accrued Liabilities",
      debit: 0,
      credit: 50_000,
      why: null,
    });
  });

  it("gives the entry's description as the reason when there is no note", () => {
    const r = build({ adjusting: [EARLIER] });
    expect(r.adjustments[0].why).toBe("Prepaid insurance used in February");
  });
});
