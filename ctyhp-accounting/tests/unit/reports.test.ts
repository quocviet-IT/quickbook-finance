import { describe, it, expect } from "vitest";
import {
  buildTrialBalance,
  buildProfitAndLoss,
  buildBalanceSheet,
  type LedgerBalance,
} from "@/lib/domain/reports";

// Cumulative balances after: issue $378.88 invoice (sub 350, tax 28.88) and
// receive full payment. Amounts in minor units (USD cents).
const rows: LedgerBalance[] = [
  { accountCode: "1010", name: "Operating Bank Account", accountType: "bank", debitBase: 37888, creditBase: 0 },
  { accountCode: "1100", name: "Accounts Receivable", accountType: "accounts_receivable", debitBase: 37888, creditBase: 37888 },
  { accountCode: "2100", name: "Sales Tax Payable", accountType: "current_liability", debitBase: 0, creditBase: 2888 },
  { accountCode: "4000", name: "Sales Revenue", accountType: "income", debitBase: 0, creditBase: 35000 },
];

describe("trial balance", () => {
  it("nets each account and balances", () => {
    const tb = buildTrialBalance(rows);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(37888);
    expect(tb.totalCredit).toBe(37888);
    // AR nets to zero -> omitted.
    expect(tb.lines.find((l) => l.accountCode === "1100")).toBeUndefined();
    expect(tb.lines.find((l) => l.accountCode === "1010")!.debit).toBe(37888);
    expect(tb.lines.find((l) => l.accountCode === "4000")!.credit).toBe(35000);
  });
});

describe("profit and loss", () => {
  it("computes income and net income", () => {
    const pnl = buildProfitAndLoss(rows);
    expect(pnl.income.total).toBe(35000);
    expect(pnl.costOfGoodsSold.total).toBe(0);
    expect(pnl.grossProfit).toBe(35000);
    expect(pnl.netIncome).toBe(35000);
  });
});

describe("balance sheet", () => {
  it("balances with current earnings", () => {
    const bs = buildBalanceSheet(rows);
    expect(bs.totalAssets).toBe(37888);
    expect(bs.totalLiabilities).toBe(2888);
    // equity booked 0 + current earnings 35000
    expect(bs.totalEquity).toBe(35000);
    expect(bs.balanced).toBe(true);
    expect(bs.equity.lines.find((l) => l.name === "Current earnings")!.amount).toBe(35000);
  });
});
