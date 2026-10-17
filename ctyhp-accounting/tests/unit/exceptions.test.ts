import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvFromExportSheet } from "@/lib/domain/report-export";
import { formatMoney } from "@/lib/format";
import type { BankStanding } from "@/lib/domain/bank-standing";
import type { ClearingStanding } from "@/lib/domain/clearing-accounts";
import type { BankAccountAlerts } from "@/lib/domain/statement-alerts";
import type { ReconciliationChange } from "@/lib/domain/reconciliation-changes";
import {
  CHECK_LABEL,
  buildExceptionReport,
  exceptionReportSheet,
  duplicateCheckNumbers,
  duplicateEntries,
  futureDatedEntries,
  holdingAccounts,
  clearingAccountsNotEmptied,
  clearingSentences,
  unreconciledBankAccounts,
  wrongWayBalances,
  yearTotalsFromMonthly,
  yearsWithIncomeAndNoCost,
  type ExceptionAccount,
  type ExceptionBankAccount,
  type ExceptionPaymentRef,
  type ExceptionReportInput,
  type LedgerBalance,
  type TransactionListRow,
} from "@/lib/domain/exceptions";

const account = (over: Partial<ExceptionAccount> = {}): ExceptionAccount => ({
  accountId: "a1",
  accountCode: "1000",
  name: "Cash on Hand",
  accountType: "bank",
  isContra: false,
  isClearing: false,
  detailType: null,
  debitBase: 0,
  creditBase: 0,
  ...over,
});

describe("wrongWayBalances", () => {
  it("flags an expense account carrying a credit balance", () => {
    const rows = wrongWayBalances([
      account({ accountId: "e1", accountCode: "6100", name: "Payroll Taxes", accountType: "expense", creditBase: 8_250_00 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].accountCode).toBe("6100");
    expect(rows[0].balanceMinor).toBe(-8_250_00);
  });

  it("leaves an account carrying its normal balance alone", () => {
    const rows = wrongWayBalances([account({ accountType: "expense", debitBase: 500_00 })]);
    expect(rows).toEqual([]);
  });

  it("does not flag a contra account, which is meant to point the other way", () => {
    const rows = wrongWayBalances([
      account({
        accountCode: "1590",
        name: "Accumulated Depreciation",
        accountType: "fixed_asset",
        isContra: true,
        creditBase: 42_000_00,
      }),
    ]);
    expect(rows).toEqual([]);
  });

  it("ignores an account with no balance at all", () => {
    const rows = wrongWayBalances([account({ accountType: "income" })]);
    expect(rows).toEqual([]);
  });

  it("puts the largest question first", () => {
    const rows = wrongWayBalances([
      account({ accountId: "s", accountCode: "6100", accountType: "expense", creditBase: 100_00 }),
      account({ accountId: "b", accountCode: "6200", accountType: "expense", creditBase: 900_00 }),
    ]);
    expect(rows.map((r) => r.accountCode)).toEqual(["6200", "6100"]);
  });

  it("goes by the contra flag, not by what an account is called", () => {
    const rows = wrongWayBalances([
      account({
        accountCode: "6300",
        name: "Contra Costa Office Rent",
        accountType: "expense",
        creditBase: 1_000_00,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].accountCode).toBe("6300");
  });
});

describe("holdingAccounts", () => {
  it("flags anything left in Uncategorized", () => {
    const rows = holdingAccounts([
      account({ accountCode: "9000", name: "Uncategorized Expense", accountType: "expense", debitBase: 150_000_00 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].balanceMinor).toBe(150_000_00);
  });

  it("matches Suspense and Ask My Accountant too", () => {
    const rows = holdingAccounts([
      account({ accountId: "s1", accountCode: "9100", name: "Suspense", accountType: "current_asset", debitBase: 10_00 }),
      account({ accountId: "s2", accountCode: "9200", name: "Ask My Accountant", accountType: "current_asset", debitBase: 20_00 }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("stays silent when the holding account has been cleared to zero", () => {
    expect(holdingAccounts([account({ name: "Uncategorized Income", accountType: "income" })])).toEqual([]);
  });

  it("does not flag an ordinary account", () => {
    expect(holdingAccounts([account({ name: "Sales Revenue", accountType: "income", creditBase: 900_00 })])).toEqual([]);
  });
});

const standing = (over: Partial<ClearingStanding> = {}): ClearingStanding => ({
  accountId: "c1",
  balanceMinor: 1_234_500,
  lastMovementDate: "2025-12-29",
  openCount: 16,
  openOldestDate: "2025-12-02",
  openMinor: 1_234_500,
  ...over,
});

const clearingAccount = (over: Partial<ExceptionAccount> = {}): ExceptionAccount =>
  account({
    accountId: "c1",
    accountCode: "1250",
    name: "Card Settlements",
    accountType: "current_asset",
    detailType: "undeposited_funds",
    isClearing: true,
    debitBase: 1_234_500,
    ...over,
  });

const dollars = (minor: number) => `$${(minor / 100).toFixed(2)}`;

describe("clearingAccountsNotEmptied", () => {
  it("is named once", () => {
    expect(CHECK_LABEL.clearing).toBe("Clearing accounts that have not emptied");
    expect(Object.keys(CHECK_LABEL)).not.toContain("undeposited");
  });

  it("leaves receipts standing at the end of a year, read eight months later, first in order", () => {
    const rows = clearingAccountsNotEmptied(
      [
        account({ accountId: "z", name: "Zeta Tills", accountType: "current_asset", isClearing: true, debitBase: 5_000, creditBase: 0 }),
        clearingAccount(),
      ],
      [standing(), standing({ accountId: "z", balanceMinor: 5_000, openMinor: 5_000, openCount: 1, openOldestDate: "2026-08-20", lastMovementDate: "2026-08-25" })],
      "2026-08-31",
    );
    expect(rows.map((r) => [r.accountId, r.leftStanding])).toEqual([
      ["c1", true],
      ["z", false],
    ]);
    const view = clearingSentences(rows[0], "2026-08-31", dollars);
    expect(view.composition).toBe("$12345.00 across 16 receipts, oldest 12/02/2025");
    expect(view.idle).toBe("No movement for 245 days, since 12/29/2025");
    expect(rows[0].balanceMinor).toBe(1_234_500);
  });

  it("calls the items entries on an account that is not undeposited funds", () => {
    const rows = clearingAccountsNotEmptied(
      [clearingAccount({ detailType: "transfer_clearing" })],
      [standing({ openCount: 3 })],
      "2026-08-31",
    );
    expect(clearingSentences(rows[0], "2026-08-31", dollars).composition).toBe(
      "$12345.00 across 3 entries, oldest 12/02/2025",
    );
  });

  it("lists a liability clearing account with a credit balance, signed as the checks show balances", () => {
    const rows = clearingAccountsNotEmptied(
      [
        account({
          accountId: "w1",
          accountCode: "2250",
          name: "Wages Payable Clearing",
          accountType: "current_liability",
          detailType: null,
          isClearing: true,
          creditBase: 80_000,
        }),
      ],
      [standing({ accountId: "w1", balanceMinor: -80_000, openMinor: 80_000, openCount: 4, openOldestDate: "2026-07-01", lastMovementDate: "2026-08-28" })],
      "2026-08-31",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].balanceMinor).toBe(-80_000);
    expect(rows[0].leftStanding).toBe(false);
    expect(clearingSentences(rows[0], "2026-08-31", dollars).composition).toBe("$800.00 across 4 entries, oldest 07/01/2026");
  });

  it("does not list an account that has emptied", () => {
    const rows = clearingAccountsNotEmptied(
      [clearingAccount({ debitBase: 700_00, creditBase: 700_00 })],
      [standing({ balanceMinor: 0, openMinor: 0, openCount: 0, openOldestDate: null })],
      "2026-08-31",
    );
    expect(rows).toEqual([]);
  });

  it("does not list an account that carries a balance but is not ticked as a clearing account", () => {
    const rows = clearingAccountsNotEmptied(
      [clearingAccount({ isClearing: false, name: "Undeposited Funds", accountCode: "1210" })],
      [standing()],
      "2026-08-31",
    );
    expect(rows).toEqual([]);
  });

  it("lists a ticked account with a balance and no standing as left standing, never as healthy", () => {
    const rows = clearingAccountsNotEmptied([clearingAccount()], [], "2026-08-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].leftStanding).toBe(true);
    const view = clearingSentences(rows[0], "2026-08-31", dollars);
    expect(view.composition).toBeNull();
    expect(view.idle).toBeNull();
  });

  it("puts accounts left standing first and then orders by name", () => {
    const old = { lastMovementDate: "2026-01-02", openOldestDate: "2026-01-02" };
    const fresh = { lastMovementDate: "2026-08-29", openOldestDate: "2026-08-20" };
    const rows = clearingAccountsNotEmptied(
      [
        clearingAccount({ accountId: "a", name: "Alpha" }),
        clearingAccount({ accountId: "b", name: "Bravo" }),
        clearingAccount({ accountId: "c", name: "Charlie" }),
      ],
      [standing({ accountId: "a", ...fresh }), standing({ accountId: "b", ...old }), standing({ accountId: "c", ...old })],
      "2026-08-31",
    );
    expect(rows.map((r) => r.name)).toEqual(["Bravo", "Charlie", "Alpha"]);
  });
});

const bank = (over: Partial<ExceptionBankAccount> = {}): ExceptionBankAccount => ({
  bankAccountId: "b1",
  accountId: "a1",
  accountName: "Business Checking",
  lastReconciledDate: null,
  ...over,
});

describe("unreconciledBankAccounts", () => {
  const balances = new Map<string, number>([["a1", 41_780_00]]);

  it("flags a bank account nobody has ever reconciled", () => {
    const rows = unreconciledBankAccounts([bank()], balances, "2026-09-30");
    expect(rows).toHaveLength(1);
    expect(rows[0].lastReconciledDate).toBeNull();
    expect(rows[0].balanceMinor).toBe(41_780_00);
  });

  it("flags one whose last reconciliation stops short of the report date", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-06-30" })], balances, "2026-09-30");
    expect(rows).toHaveLength(1);
  });

  it("leaves one reconciled exactly to the report date alone", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-09-30" })], balances, "2026-09-30");
    expect(rows).toEqual([]);
  });

  it("leaves one reconciled beyond the report date alone", () => {
    const rows = unreconciledBankAccounts([bank({ lastReconciledDate: "2026-10-31" })], balances, "2026-09-30");
    expect(rows).toEqual([]);
  });

  it("says nothing about a closed account with no balance to prove", () => {
    const rows = unreconciledBankAccounts([bank()], new Map([["a1", 0]]), "2026-09-30");
    expect(rows).toEqual([]);
  });
});

const bal = (over: Partial<LedgerBalance> = {}): LedgerBalance => ({
  accountId: "x",
  accountCode: "4000",
  name: "Sales Revenue",
  accountType: "income",
  debitBase: 0,
  creditBase: 0,
  ...over,
});

describe("yearTotalsFromMonthly", () => {
  it("sums income as credits less debits, and cost as debits less credits", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [bal({ creditBase: 100_00 }), bal({ accountCode: "6000", accountType: "expense", debitBase: 40_00 })]],
      ["2026-02", [bal({ creditBase: 50_00, debitBase: 10_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([
      { year: "2026", incomeMinor: 140_00, costMinor: 40_00 },
    ]);
  });

  it("counts other income and other expense on the right sides", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [
        bal({ accountType: "other_income", creditBase: 30_00 }),
        bal({ accountType: "other_expense", debitBase: 7_00 }),
        bal({ accountType: "cost_of_goods_sold", debitBase: 3_00 }),
      ]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([
      { year: "2026", incomeMinor: 30_00, costMinor: 10_00 },
    ]);
  });

  it("ignores balance sheet accounts entirely", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2026-01", [bal({ accountType: "bank", debitBase: 900_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth)).toEqual([{ year: "2026", incomeMinor: 0, costMinor: 0 }]);
  });

  it("separates the years and returns them oldest first", () => {
    const byMonth = new Map<string, LedgerBalance[]>([
      ["2025-12", [bal({ creditBase: 10_00 })]],
      ["2024-06", [bal({ creditBase: 20_00 })]],
    ]);
    expect(yearTotalsFromMonthly(byMonth).map((y) => y.year)).toEqual(["2024", "2025"]);
  });
});

describe("yearsWithIncomeAndNoCost", () => {
  it("flags a year with revenue and nothing spent against it", () => {
    const rows = yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 500_000_00, costMinor: 0 }]);
    expect(rows).toEqual([{ year: "2024", incomeMinor: 500_000_00, costMinor: 0, entryCount: null }]);
  });

  it("says how many entries the flagged year has, when that was counted", () => {
    const rows = yearsWithIncomeAndNoCost(
      [{ year: "2024", incomeMinor: 500_000_00, costMinor: 0 }],
      new Map([["2024", 37]]),
    );
    expect(rows[0].entryCount).toBe(37);
  });

  it("does not flag a year with even one cost in it", () => {
    expect(yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 500_000_00, costMinor: 1 }])).toEqual([]);
  });

  it("does not flag a year with no income either — that is a quiet year, not a broken one", () => {
    expect(yearsWithIncomeAndNoCost([{ year: "2024", incomeMinor: 0, costMinor: 0 }])).toEqual([]);
  });
});

const txn = (over: Partial<TransactionListRow> = {}): TransactionListRow => ({
  entryId: "t1",
  entryNumber: "JE-000001",
  entryDate: "2026-03-04",
  description: "Monthly rent",
  sourceType: "manual",
  partyName: "Harbour Property Ltd",
  categoryLabel: "Rent",
  moneyLabel: "Business Checking",
  amountMinor: -4_500_00,
  currencyCode: "USD",
  reconciled: false,
  accountIds: ["rent", "checking"],
  ...over,
});

describe("duplicateEntries", () => {
  const noRefs = new Map<string, string>();

  it("groups two entries alike in date, party, accounts and amount", () => {
    const groups = duplicateEntries([txn(), txn({ entryId: "t2", entryNumber: "JE-000002" })], noRefs);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.entryId)).toEqual(["t1", "t2"]);
  });

  it("reports nothing when the amounts differ", () => {
    expect(duplicateEntries([txn(), txn({ entryId: "t2", amountMinor: -4_500_01 })], noRefs)).toEqual([]);
  });

  it("reports nothing when the accounts differ", () => {
    expect(
      duplicateEntries([txn(), txn({ entryId: "t2", accountIds: ["rent", "savings"] })], noRefs),
    ).toEqual([]);
  });

  it("does not care what order the accounts arrive in", () => {
    const groups = duplicateEntries(
      [txn(), txn({ entryId: "t2", accountIds: ["checking", "rent"] })],
      noRefs,
    );
    expect(groups).toHaveLength(1);
  });

  it("separates two entries carrying different references", () => {
    const refs = new Map<string, string>([["t1", "1018"], ["t2", "1019"]]);
    expect(duplicateEntries([txn(), txn({ entryId: "t2" })], refs)).toEqual([]);
  });

  it("groups two entries carrying the same reference", () => {
    const refs = new Map<string, string>([["t1", "1018"], ["t2", "1018"]]);
    expect(duplicateEntries([txn(), txn({ entryId: "t2" })], refs)).toHaveLength(1);
  });

  it("treats a missing party the same as another missing party", () => {
    const groups = duplicateEntries(
      [txn({ partyName: null }), txn({ entryId: "t2", partyName: null })],
      noRefs,
    );
    expect(groups).toHaveLength(1);
  });

  it("names a bank line by its description, so two payers on one day are not one payment", () => {
    // A bank line has no customer or vendor; the bank's text is who paid. The
    // prototype keys on that payee, and so must this — otherwise every
    // same-amount transfer on a day is called a duplicate of the others.
    const bank = { sourceType: "bank", partyName: null, amountMinor: 1_00 };
    const groups = duplicateEntries(
      [
        txn({ ...bank, description: "Zelle payment from ALICE EXAMPLE 1001" }),
        txn({ ...bank, entryId: "t2", description: "Zelle payment from BOB SAMPLE 2002" }),
      ],
      noRefs,
    );
    expect(groups).toEqual([]);
  });

  it("still groups a bank line that arrived twice with the same description", () => {
    const bank = { sourceType: "bank", partyName: null, description: "Zelle payment from ALICE EXAMPLE 1001" };
    const groups = duplicateEntries([txn(bank), txn({ ...bank, entryId: "t2" })], noRefs);
    expect(groups).toHaveLength(1);
  });

  it("returns the groups oldest first", () => {
    const groups = duplicateEntries(
      [
        txn({ entryId: "n1", entryDate: "2026-05-01" }),
        txn({ entryId: "n2", entryDate: "2026-05-01" }),
        txn({ entryId: "o1", entryDate: "2026-01-01" }),
        txn({ entryId: "o2", entryDate: "2026-01-01" }),
      ],
      noRefs,
    );
    expect(groups.map((g) => g.entries[0].entryDate)).toEqual(["2026-01-01", "2026-05-01"]);
  });

  it("does not group two entries whose party and reference merely concatenate alike", () => {
    const refs = new Map<string, string>([["t1", "x"], ["t2", "1018|x"]]);
    const groups = duplicateEntries(
      [txn({ partyName: "Smith|1018" }), txn({ entryId: "t2", partyName: "Smith" })],
      refs,
    );
    expect(groups).toEqual([]);
  });
});

describe("futureDatedEntries", () => {
  it("flags an entry dated after today", () => {
    const rows = futureDatedEntries([txn({ entryDate: "2027-01-04" })], "2026-09-26");
    expect(rows).toHaveLength(1);
  });

  it("leaves today's own entries alone", () => {
    expect(futureDatedEntries([txn({ entryDate: "2026-09-26" })], "2026-09-26")).toEqual([]);
  });

  it("leaves the past alone", () => {
    expect(futureDatedEntries([txn({ entryDate: "2026-09-25" })], "2026-09-26")).toEqual([]);
  });

  it("returns the soonest first", () => {
    const rows = futureDatedEntries(
      [txn({ entryId: "b", entryDate: "2027-05-01" }), txn({ entryId: "a", entryDate: "2026-12-01" })],
      "2026-09-26",
    );
    expect(rows.map((r) => r.entryId)).toEqual(["a", "b"]);
  });
});

const pay = (over: Partial<ExceptionPaymentRef> = {}): ExceptionPaymentRef => ({
  paymentId: "p1",
  kind: "vendor",
  paymentNumber: "BP-000001",
  journalEntryId: "e1",
  paymentDate: "2026-04-02",
  reference: "1018",
  accountId: "checking",
  accountName: "Business Checking",
  partyName: "Northwood Metals",
  amountMinor: 30_000_00,
  ...over,
});

describe("duplicateCheckNumbers", () => {
  it("flags one number against one account twice", () => {
    const rows = duplicateCheckNumbers([pay(), pay({ paymentId: "p2", partyName: "Someone else" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].reference).toBe("1018");
    expect(rows[0].payments).toHaveLength(2);
  });

  it("does not flag the same number in two different check books", () => {
    const rows = duplicateCheckNumbers([
      pay(),
      pay({ paymentId: "p2", accountId: "savings", accountName: "Business Savings" }),
    ]);
    expect(rows).toEqual([]);
  });

  it("ignores payments carrying no reference", () => {
    const rows = duplicateCheckNumbers([
      pay({ reference: "" }),
      pay({ paymentId: "p2", reference: "   " }),
    ]);
    expect(rows).toEqual([]);
  });

  it("treats surrounding spaces as the same number", () => {
    const rows = duplicateCheckNumbers([pay(), pay({ paymentId: "p2", reference: " 1018 " })]);
    expect(rows).toHaveLength(1);
  });

  it("matches a customer payment against a vendor payment on one account", () => {
    const rows = duplicateCheckNumbers([pay(), pay({ paymentId: "p2", kind: "customer" })]);
    expect(rows).toHaveLength(1);
  });
});

const emptyInput = (over: Partial<ExceptionReportInput> = {}): ExceptionReportInput => ({
  to: "2026-09-30",
  today: "2026-09-26",
  accounts: [],
  bankAccounts: [],
  yearTotals: [],
  entriesInRange: [],
  entriesAfterToday: [],
  paymentReferences: [],
  unavailable: [],
  ...over,
});

describe("buildExceptionReport", () => {
  it("runs thirteen checks and raises nothing on an empty book", () => {
    const report = buildExceptionReport(emptyInput());
    expect(report.checksRun).toBe(13);
    expect(report.questionsRaised).toBe(0);
    expect(report.entriesExamined).toBe(0);
    expect(report.unavailable).toEqual([]);
  });

  it("carries through the checks whose data could not be read", () => {
    const report = buildExceptionReport(
      emptyInput({
        unavailable: ["incomeNoCost"],
        accounts: [account({ accountCode: "9000", name: "Suspense", accountType: "current_asset", debitBase: 12_00 })],
      }),
    );
    expect(report.unavailable).toEqual(["incomeNoCost"]);
    // The other nine still ran.
    expect(report.holding).toHaveLength(1);
  });

  it("counts the entries it examined from the range, not from every read", () => {
    const report = buildExceptionReport(
      emptyInput({ entriesInRange: [txn(), txn({ entryId: "t2" })], entriesAfterToday: [txn({ entryId: "t3", entryDate: "2027-01-01" })] }),
    );
    expect(report.entriesExamined).toBe(2);
  });

  it("adds every check's findings into one count of questions", () => {
    const report = buildExceptionReport(
      emptyInput({
        accounts: [
          account({ accountId: "h", accountCode: "9000", name: "Uncategorized Expense", accountType: "expense", debitBase: 150_000_00 }),
        ],
        entriesAfterToday: [txn({ entryId: "f1", entryDate: "2027-01-01" })],
      }),
    );
    // one holding account, one wrong-way balance it is not, one future entry
    expect(report.holding).toHaveLength(1);
    expect(report.futureDated).toHaveLength(1);
    expect(report.questionsRaised).toBe(2);
  });

  it("derives the bank balance lookup from the accounts it was given", () => {
    const report = buildExceptionReport(
      emptyInput({
        accounts: [account({ accountId: "a1", accountType: "bank", debitBase: 41_780_00 })],
        bankAccounts: [{ bankAccountId: "b1", accountId: "a1", accountName: "Business Checking", lastReconciledDate: null }],
      }),
    );
    expect(report.unreconciled).toHaveLength(1);
    expect(report.unreconciled[0].balanceMinor).toBe(41_780_00);
  });

  it("tells two same-day payments apart by the reference their own entry carries", () => {
    const report = buildExceptionReport(
      emptyInput({
        entriesInRange: [
          txn({ entryId: "je-1", entryNumber: "JE-000101" }),
          txn({ entryId: "je-2", entryNumber: "JE-000102" }),
        ],
        paymentReferences: [
          pay({ paymentId: "p1", paymentNumber: "BP-000001", journalEntryId: "je-1", reference: "1018" }),
          pay({ paymentId: "p2", paymentNumber: "BP-000002", journalEntryId: "je-2", reference: "1019" }),
        ],
      }),
    );
    expect(report.duplicates).toEqual([]);
  });
});

describe("the two statement checks", () => {
  const alerts: BankAccountAlerts[] = [
    {
      bankAccountId: "b1",
      accountName: "Business Checking",
      ghosts: [
        { payee: "Payroll", rows: [], agree: 4, of: 4, offsetMinor: 0, runs: 1, totalMinor: -90_000, entryIds: ["a", "b", "c", "d"] },
      ],
      negative: {
        nowMinor: -2_500,
        last: { date: "2026-03-31", endingMinor: 40_000 },
        worst: { date: "2026-05-04", balanceMinor: -7_500 },
        outstanding: [],
        outstandingCount: 6,
      },
    },
    { bankAccountId: "b2", accountName: "Savings", ghosts: [], negative: null },
  ];
  const meta = { companyName: "Riverbend Trading LLC", currencyCode: "USD", decimals: 2, from: "2026-01-01", to: "2026-09-26" };

  it("names both checks", () => {
    expect(CHECK_LABEL.statementBalance).toBe("Entries that look like a statement balance");
    expect(CHECK_LABEL.belowZero).toBe("Bank accounts below zero since their last statement");
  });

  it("raises one question per flagged group and per flagged account", () => {
    const report = buildExceptionReport(emptyInput({ statementAlerts: alerts }));
    expect(report.statementBalance).toHaveLength(1);
    expect(report.statementBalance[0]).toMatchObject({ bankAccountId: "b1", payee: "Payroll", entryCount: 4, totalMinor: -90_000 });
    expect(report.belowZero).toHaveLength(1);
    expect(report.belowZero[0]).toMatchObject({ bankAccountId: "b1", nowMinor: -2_500, worstMinor: -7_500, outstandingCount: 6 });
    expect(report.questionsRaised).toBe(2);
  });

  it("finds nothing when no alerts were supplied", () => {
    const report = buildExceptionReport(emptyInput());
    expect(report.statementBalance).toEqual([]);
    expect(report.belowZero).toEqual([]);
  });

  it("says Could not run for a statement check whose data could not be read, and Nothing found when it ran", () => {
    const report = buildExceptionReport(emptyInput({ unavailable: ["belowZero"] }));
    const byCheck = new Map(exceptionReportSheet(report, meta).rows.map((r) => [r.check, r.name]));
    expect(byCheck.get(CHECK_LABEL.belowZero)).toBe("Could not run");
    expect(byCheck.get(CHECK_LABEL.statementBalance)).toBe("Nothing found");
  });

  it("writes their rows into the sheet", () => {
    const sheet = exceptionReportSheet(buildExceptionReport(emptyInput({ statementAlerts: alerts })), meta);
    expect(sheet.rows.filter((r) => r.check === CHECK_LABEL.statementBalance)).toEqual([
      { check: CHECK_LABEL.statementBalance, date: "", type: "4 entries", name: "Payroll", account: "Business Checking", amount: -900 },
    ]);
    expect(sheet.rows.filter((r) => r.check === CHECK_LABEL.belowZero)).toEqual([
      {
        check: CHECK_LABEL.belowZero,
        date: "2026-05-04",
        type: "Last reconciled 2026-03-31",
        name: "Lowest -75.00 · 6 payments not yet on a statement",
        account: "Business Checking",
        amount: -25,
      },
    ]);
  });
});

describe("exceptionReportSheet", () => {
  const meta = { companyName: "Riverbend Trading LLC", currencyCode: "USD", decimals: 2, from: "2026-01-01", to: "2026-09-26" };

  it("keeps every check, saying which found nothing and which could not run", () => {
    const report = buildExceptionReport(emptyInput({ unavailable: ["incomeNoCost"] }));
    const sheet = exceptionReportSheet(report, meta);
    expect(sheet.rows).toHaveLength(13);
    const byCheck = new Map(sheet.rows.map((r) => [r.check, r.name]));
    expect(byCheck.get("A year with income and no costs")).toBe("Could not run");
    expect(byCheck.get("Entries dated in the future")).toBe("Nothing found");
  });

  it("names a bank line by its description when it has no customer or vendor", () => {
    const a = txn({ entryId: "a", partyName: null, description: "ZELLE FROM HARBOR CAFE", sourceType: "bank" });
    const b = txn({ entryId: "b", entryNumber: "JE-000002", partyName: null, description: "ZELLE FROM HARBOR CAFE", sourceType: "bank" });
    const report = buildExceptionReport(emptyInput({ entriesInRange: [a, b] }));
    const rows = exceptionReportSheet(report, meta).rows.filter((r) => r.check === "Entries recorded more than once");
    expect(rows.map((r) => [r.type, r.name, r.amount])).toEqual([
      ["Bank JE-000001", "ZELLE FROM HARBOR CAFE", -4500],
      ["Bank JE-000002", "ZELLE FROM HARBOR CAFE", -4500],
    ]);
  });

  it("titles the sheet with the report's range and basis", () => {
    const sheet = exceptionReportSheet(buildExceptionReport(emptyInput()), meta);
    expect(sheet.title).toBe("Exception Report");
    expect(sheet.subtitle).toBe("01/01/2026 – 09/26/2026 · Accrual basis");
    expect(sheet.fileName).toBe("exception-report-2026-01-01-to-2026-09-26");
  });
});

describe("csvFromExportSheet", () => {
  it("writes money as a plain number and quotes a value holding a comma", () => {
    const csv = csvFromExportSheet({
      fileName: "x",
      companyName: "Cascade Precious Metals, Inc.",
      title: "Exception Report",
      subtitle: "Jan 1, 2026 – Sep 26, 2026",
      currencyCode: "USD",
      columns: [
        { key: "name", header: "Name" },
        { key: "amount", header: "Amount", kind: "money" },
      ],
      rows: [
        { name: "Harbor Cafe, Inc.", amount: -1234.5 },
        { name: "Nothing found", amount: null },
      ],
    });
    expect(csv.split("\n")).toEqual([
      '"Cascade Precious Metals, Inc."',
      "Exception Report",
      // The range has commas in it, so it is quoted like any other value.
      '"Jan 1, 2026 – Sep 26, 2026"',
      "Currency: USD",
      "",
      "Name,Amount",
      '"Harbor Cafe, Inc.",-1234.50',
      "Nothing found,",
    ]);
  });
});

describe("the exceptions module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/exceptions.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });

  it("does not let the service decide which account is a clearing account", () => {
    const service = readFileSync("lib/services/exceptions.ts", "utf8");
    expect(service).not.toMatch(/undeposited/i);
    expect(service).not.toMatch(/UNDEPOSITED_(NAME|CODE)/);
    expect(readFileSync("lib/domain/exceptions.ts", "utf8")).not.toMatch(/UNDEPOSITED_(NAME|CODE)|undepositedFunds/);
  });
});

describe("the clearing check in the report", () => {
  const meta = { companyName: "Riverbend Trading LLC", currencyCode: "USD", decimals: 2, from: "2026-01-01", to: "2026-08-31" };
  const input = () =>
    emptyInput({
      to: "2026-08-31",
      accounts: [clearingAccount()],
      clearingStanding: [standing()],
    });

  it("counts its rows among the questions and still runs thirteen checks", () => {
    const report = buildExceptionReport(input());
    expect(report.clearing).toHaveLength(1);
    expect(report.questionsRaised).toBe(1);
    expect(report.checksRun).toBe(13);
  });

  it("carries a failed read as unavailable, not as nothing found", () => {
    const report = buildExceptionReport(emptyInput({ unavailable: ["clearing"], accounts: [clearingAccount()] }));
    expect(report.clearing).toEqual([]);
    expect(report.questionsRaised).toBe(0);
    expect(report.unavailable).toEqual(["clearing"]);
    const rows = exceptionReportSheet(report, meta).rows.filter((r) => r.check === CHECK_LABEL.clearing);
    expect(rows).toEqual([{ check: CHECK_LABEL.clearing, date: "", type: "", name: "Could not run", account: "", amount: null }]);
  });

  it("says Nothing found when no ticked account holds a balance", () => {
    const rows = exceptionReportSheet(buildExceptionReport(emptyInput()), meta).rows.filter((r) => r.check === CHECK_LABEL.clearing);
    expect(rows.map((r) => r.name)).toEqual(["Nothing found"]);
  });

  it("exports the oldest open date, Left standing, the sentence the screen shows, the account and the balance", () => {
    const report = buildExceptionReport(input());
    const rows = exceptionReportSheet(report, meta).rows.filter((r) => r.check === CHECK_LABEL.clearing);
    expect(rows).toEqual([
      {
        check: "Clearing accounts that have not emptied",
        date: "2025-12-02",
        type: "Left standing",
        name: "$12,345.00 across 16 receipts, oldest 12/02/2025 · No movement for 245 days, since 12/29/2025",
        account: "1250 Card Settlements",
        amount: 12_345,
      },
    ]);
    // One source: the export's words are the screen's words, both of them.
    const formatted = (minor: number) => formatMoney(minor, "USD", 2);
    const view = clearingSentences(report.clearing[0], meta.to, formatted);
    expect(rows[0].name).toBe(`${view.composition} · ${view.idle}`);
  });

  it("exports Clearing for an account that is not left standing, with the date blank when none is known", () => {
    const report = buildExceptionReport(
      emptyInput({
        to: "2026-08-31",
        accounts: [clearingAccount()],
        clearingStanding: [standing({ lastMovementDate: "2026-08-29", openOldestDate: "2026-08-20" })],
      }),
    );
    const row = exceptionReportSheet(report, meta).rows.find((r) => r.check === CHECK_LABEL.clearing);
    expect(row?.type).toBe("Clearing");
    expect(row?.date).toBe("2026-08-20");
    const noStanding = exceptionReportSheet(
      buildExceptionReport(emptyInput({ to: "2026-08-31", accounts: [clearingAccount()] })),
      meta,
    ).rows.find((r) => r.check === CHECK_LABEL.clearing);
    expect(noStanding).toMatchObject({ date: "", type: "Left standing", name: "" });
  });
});

describe("Reconciliations that no longer agree", () => {
  const meta = { companyName: "Riverbend Trading LLC", currencyCode: "USD", decimals: 2, from: "2026-01-01", to: "2026-09-26" };
  const standing = (over: Partial<BankStanding> = {}): BankStanding => ({
    bankAccountId: "b1",
    lastCompletedId: "r1",
    lastCompletedDate: "2026-06-30",
    lastClosingMinor: 100_000,
    lastBroughtForward: false,
    sinceCount: 0,
    sinceNetMinor: 0,
    earlierOpenCount: 0,
    earlierOpenNetMinor: 0,
    voidTickedCount: 0,
    voidTickedMinor: 0,
    voidReconciliationDate: null,
    bookMinor: 0,
    ...over,
  });
  const banks = [
    bank({ bankAccountId: "b1", accountId: "a1", accountName: "Business Checking" }),
    bank({ bankAccountId: "b2", accountId: "a2", accountName: "Ascent Savings" }),
    bank({ bankAccountId: "b3", accountId: "a3", accountName: "Payroll Account" }),
  ];

  it("is named once", () => {
    expect(CHECK_LABEL.noLongerAgree).toBe("Reconciliations that no longer agree");
  });

  const change = (over: Partial<ReconciliationChange> & Pick<ReconciliationChange, "kind">): ReconciliationChange => ({
    changeKey: `${over.kind}:${over.reconciliationId ?? "r1"}:${over.entryId ?? ""}`,
    reconciliationId: "r1",
    bankAccountId: "b1",
    statementEndingDate: "2026-06-30",
    completedAt: "2026-07-02T10:00:00Z",
    entryId: null,
    entryNumber: null,
    entryDate: null,
    signedMinor: null,
    reversalEntryId: null,
    reversalEntryNumber: null,
    differenceMinor: null,
    ...over,
  });

  it("lists every reconciliation with a change, sorted by account name then statement date", () => {
    const report = buildExceptionReport(
      emptyInput({
        bankAccounts: banks,
        reconciliationChanges: [
          change({ kind: "voided", reconciliationId: "r1", bankAccountId: "b1", entryId: "e1", entryNumber: "JE-900001", signedMinor: 500 }),
          change({ kind: "reversed", reconciliationId: "r2", bankAccountId: "b2", statementEndingDate: "2026-05-31", entryId: "e2", entryNumber: "JE-900002", reversalEntryNumber: "JE-900009" }),
          change({ kind: "added", reconciliationId: "r3", bankAccountId: "b1", statementEndingDate: "2026-03-31", entryId: "e3", entryNumber: "JE-900003", entryDate: "2026-03-30" }),
          change({ kind: "voided", reconciliationId: "r9", bankAccountId: "zz", entryId: "e9", entryNumber: "JE-900008", signedMinor: 1 }),
        ],
      }),
    );
    expect(report.noLongerAgree.map((r) => [r.accountName, r.statementEndingDate])).toEqual([
      ["Ascent Savings", "2026-05-31"],
      ["Business Checking", "2026-03-31"],
      ["Business Checking", "2026-06-30"],
    ]);
  });

  it("counts toward the questions raised, and finds nothing without changes", () => {
    const withVoid = buildExceptionReport(
      emptyInput({
        bankAccounts: banks,
        reconciliationChanges: [change({ kind: "voided", entryId: "e1", entryNumber: "JE-900001", signedMinor: 100 })],
      }),
    );
    expect(withVoid.questionsRaised).toBe(1);
    expect(withVoid.checksRun).toBe(13);
    expect(buildExceptionReport(emptyInput({ bankAccounts: banks })).noLongerAgree).toEqual([]);
  });

  it("leaves out a reconciliation whose statement ends after the report date", () => {
    const report = buildExceptionReport(
      emptyInput({
        to: "2026-06-29",
        bankAccounts: banks,
        reconciliationChanges: [change({ kind: "voided", entryId: "e1", entryNumber: "JE-900001", signedMinor: 100 })],
      }),
    );
    expect(report.noLongerAgree).toEqual([]);
  });

  it("carries the since figures onto an account not agreed, and null when unknown", () => {
    const balances = new Map<string, number>([
      ["a1", 41_780_00],
      ["a2", 5_00],
    ]);
    const rows = unreconciledBankAccounts(
      [bank({ bankAccountId: "b1", accountId: "a1" }), bank({ bankAccountId: "b2", accountId: "a2", accountName: "Ascent Savings" })],
      balances,
      "2026-09-30",
      [standing({ bankAccountId: "b1", sinceCount: 7, sinceNetMinor: -3_300 })],
    );
    const byId = new Map(rows.map((r) => [r.bankAccountId, r]));
    expect(byId.get("b1")).toMatchObject({ sinceCount: 7, sinceNetMinor: -3_300 });
    expect(byId.get("b2")).toMatchObject({ sinceCount: null, sinceNetMinor: null });
  });

  it("writes the new rows and the since wording into the sheet", () => {
    const report = buildExceptionReport(
      emptyInput({
        accounts: [
          account({ accountId: "a1", accountCode: "1000", name: "Business Checking", debitBase: 500_00 }),
          account({ accountId: "a2", accountCode: "1010", name: "Ascent Savings", debitBase: 200_00 }),
          account({ accountId: "a3", accountCode: "1020", name: "Payroll Account", debitBase: 100_00 }),
        ],
        bankAccounts: banks,
        bankStanding: [
          standing({ bankAccountId: "b1", sinceCount: 1, sinceNetMinor: 50 }),
          standing({ bankAccountId: "b2", sinceCount: 4, sinceNetMinor: 90 }),
        ],
        reconciliationChanges: [
          change({ kind: "voided", bankAccountId: "b1", entryId: "e1", entryNumber: "JE-900001", signedMinor: 2_500 }),
          change({ kind: "drift", bankAccountId: "b1", differenceMinor: 3_700 }),
          change({ kind: "added", reconciliationId: "r2", bankAccountId: "b2", statementEndingDate: "2026-05-31", entryId: "e2", entryNumber: "JE-900002", entryDate: "2026-05-30" }),
        ],
      }),
    );
    const rows = exceptionReportSheet(report, meta).rows;
    expect(rows.filter((r) => r.check === CHECK_LABEL.noLongerAgree)).toEqual([
      {
        check: CHECK_LABEL.noLongerAgree,
        date: "2026-05-31",
        type: "Changed after sign-off",
        name: "JE-900002, dated 05/30/2026, was posted after the reconciliation was signed off.",
        account: "Ascent Savings",
        amount: null,
      },
      {
        check: CHECK_LABEL.noLongerAgree,
        date: "2026-06-30",
        type: "Changed after sign-off",
        name: "JE-900001 was voided. The reconciliation no longer adds up: it is out by $12.00.",
        account: "Business Checking",
        amount: null,
      },
    ]);
    const names = new Map(rows.filter((r) => r.check === CHECK_LABEL.unreconciled).map((r) => [r.account, r.name]));
    expect(names.get("Business Checking")).toBe("1 entry since");
    expect(names.get("Ascent Savings")).toBe("4 entries since");
    expect(names.get("Payroll Account")).toBe("");
  });

  it("says Nothing since in the sheet when nothing has gone in, as Reconcile history does", () => {
    const report = buildExceptionReport(
      emptyInput({
        accounts: [account({ accountId: "a1", accountCode: "1000", name: "Business Checking", debitBase: 500_00 })],
        bankAccounts: banks,
        bankStanding: [standing({ bankAccountId: "b1", sinceCount: 0, sinceNetMinor: 0 })],
      }),
    );
    const row = exceptionReportSheet(report, meta).rows.find((r) => r.check === CHECK_LABEL.unreconciled && r.account === "Business Checking");
    expect(row?.name).toBe("Nothing since");
  });

  it("says Could not run when the standing could not be read", () => {
    const rows = exceptionReportSheet(buildExceptionReport(emptyInput({ unavailable: ["noLongerAgree"] })), meta).rows;
    expect(rows.find((r) => r.check === CHECK_LABEL.noLongerAgree)?.name).toBe("Could not run");
  });
});
