import { describe, expect, it } from "vitest";
import {
  bankTable,
  billDueLook,
  booksNote,
  cardBalance,
  CASH_MONTH_OPTIONS,
  cashMonthsLabel,
  daysLate,
  DUE_OPTIONS,
  dueLabel,
  dueWindowOf,
  earlierOpenSentence,
  formatChange,
  homeTabHref,
  homeTabOf,
  HOME_TABS,
  HORIZON_OPTIONS,
  horizonLabel,
  lastPostedIndex,
  ledgerDifference,
  missingMonthsSentence,
  netIncomeLabel,
  otherCurrencies,
  payablesLine,
  PERIOD_OPTIONS,
  percentChange,
  periodLabel,
  periodUnread,
  receivablesLine,
  stepsDone,
  tiesToLedger,
} from "@/components/dashboard-home/view";
import { homePeriodRanges } from "@/lib/domain/dashboard-home/ranges";
import type { HomeBank, HomeBankAccount, HomeMonth, HomeStatus } from "@/lib/domain/dashboard-home/types";
import { formatMoney } from "@/lib/format";

const money = (minor: number) => formatMoney(minor, "USD", 2);

const status = (over: Partial<HomeStatus> = {}): HomeStatus => ({
  asOf: "2026-11-13",
  postedThrough: "2026-11-12",
  bankLinesThrough: "2026-11-12",
  lastClosed: { label: "September 2026", periodEnd: "2026-09-30" },
  behind: false,
  missingMonths: [],
  firstUse: false,
  ...over,
});

const month = (key: string, posted = true): HomeMonth => ({ key, label: key.slice(5), year: Number(key.slice(0, 4)), posted });

describe("the Dashboard's tabs (3.0.38)", () => {
  it("has the four tabs, in order, under their URL keys", () => {
    expect(HOME_TABS.map((tab) => tab.key)).toEqual(["overview", "money-in", "money-out", "banking"]);
    expect(HOME_TABS.map((tab) => tab.label)).toEqual(["Overview", "Money in", "Money out", "Banking and close"]);
  });

  it("reads the tab from the address, Overview for anything else", () => {
    expect(homeTabOf("money-in")).toBe("money-in");
    expect(homeTabOf(["banking", "overview"])).toBe("banking");
    expect(homeTabOf("money")).toBe("overview");
    expect(homeTabOf(null)).toBe("overview");
  });

  it("keeps Overview's address bare and names the others", () => {
    expect(homeTabHref("overview")).toBe("/dashboard");
    expect(homeTabHref("money-out")).toBe("/dashboard?tab=money-out");
  });
});

describe("the period a card shows", () => {
  it("offers the seven periods the service reads, in the agreed order (3.0.41)", () => {
    expect(PERIOD_OPTIONS.map((option) => option.value)).toEqual(["month", "lastMonth", "last3", "quarter", "year", "last12", "lastYear"]);
    expect(PERIOD_OPTIONS.map((option) => option.label)).toEqual([
      "This month",
      "Last month",
      "Last 3 months",
      "This quarter",
      "This year",
      "Last 12 months",
      "Last year",
    ]);
    // Each option is named as the service names the period.
    const ranges = homePeriodRanges("2026-11-17", 1);
    for (const option of PERIOD_OPTIONS) expect(ranges[option.value].label, option.value).toBe(option.label);
  });

  it("says which period could not be read", () => {
    expect(periodLabel("last12")).toBe("Last 12 months");
    expect(periodUnread("lastYear")).toBe("Last year could not be read.");
  });

  it("offers Cash flow six or twelve months, and its footer says which", () => {
    expect(CASH_MONTH_OPTIONS).toEqual([
      { value: 6, label: "Last 6 months" },
      { value: 12, label: "Last 12 months" },
    ]);
    expect(cashMonthsLabel(6)).toBe("Last 6 months");
    expect(cashMonthsLabel(12)).toBe("Last 12 months");
  });

  it("offers Invoices and Bills what falls due in 7 or 30 days, and reads the matching fields", () => {
    expect(DUE_OPTIONS).toEqual([
      { value: 7, label: "Due in 7 days" },
      { value: 30, label: "Due in 30 days" },
    ]);
    for (const option of DUE_OPTIONS) expect(dueLabel(option.value)).toBe(option.label);
    const side = {
      totalMinor: 20_000_00,
      documents: 4,
      overdueMinor: 12_550_00,
      overdueDocuments: 2,
      dueSoonMinor: 3_000_00,
      dueSoonDocuments: 1,
      laterMinor: 4_700_00,
      laterDocuments: 1,
      within30: { dueMinor: 7_700_00, dueDocuments: 2, laterMinor: 0, laterDocuments: 0 },
      creditsMinor: -250_00,
      buckets: { current: 7_700_00, d1_30: 0, d31_60: 5_150_00, d61_90: 7_400_00, d90_plus: -250_00 },
    };
    expect(dueWindowOf(side, 7)).toEqual({ dueMinor: 3_000_00, dueDocuments: 1, laterMinor: 4_700_00, laterDocuments: 1 });
    expect(dueWindowOf(side, 30)).toEqual(side.within30);
  });

  it("offers the forecast 30, 60 or 90 days ahead, and opens its sentence with the same words", () => {
    expect(HORIZON_OPTIONS.map((option) => option.value)).toEqual([30, 60, 90]);
    for (const option of HORIZON_OPTIONS) expect(horizonLabel(option.value)).toBe(option.label);
    expect(horizonLabel(90)).toBe("Next 90 days");
  });

  it("measures a change against the size of the prior figure, and refuses a zero or missing one", () => {
    expect(percentChange(115, 100)).toBeCloseTo(15);
    expect(percentChange(-50, -100)).toBeCloseTo(50);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(10, null)).toBeNull();
    expect(formatChange(15.24)).toBe("+15.2%");
    expect(formatChange(-3)).toBe("-3.0%");
    expect(formatChange(0.01)).toBe("0.0%");
  });
});

describe("months not entered yet", () => {
  it("finds the last month that is posted", () => {
    expect(lastPostedIndex([month("2026-09"), month("2026-10", false), month("2026-11", false)])).toBe(0);
    expect(lastPostedIndex([month("2026-11", false)])).toBe(-1);
  });

  it("says which months look empty and why", () => {
    expect(missingMonthsSentence(["October", "November"])).toBe("October and November look empty because they are not entered yet.");
    expect(missingMonthsSentence(["November"])).toBe("November looks empty because it is not entered yet.");
    expect(missingMonthsSentence([])).toBe("");
  });
});

describe("the note above the figures", () => {
  it("says how far the books reach when they are current", () => {
    expect(booksNote(status())).toEqual({
      kind: "current",
      postedThrough: "2026-11-12",
      bankLinesThrough: "2026-11-12",
      lastClosed: "September 2026",
    });
  });

  it("warns when the books are behind, naming the months", () => {
    expect(booksNote(status({ behind: true, postedThrough: "2026-09-30", missingMonths: ["October", "November"] }))).toEqual({
      kind: "behind",
      since: "2026-09-30",
      missing: "October and November look empty because they are not entered yet.",
    });
  });

  it("is a first use when nothing is posted at all", () => {
    expect(booksNote(status({ firstUse: true, postedThrough: null, behind: true }))).toEqual({ kind: "first-use" });
  });
});

describe("the lines under the four figures", () => {
  const receivables = { valueMinor: 6_431_000, ledgerMinor: 6_431_000, series: [], overdueMinor: 1_875_000, overdueInvoices: 4 };
  const payables = { valueMinor: 2_748_000, ledgerMinor: 2_748_000, series: [], overdueMinor: 0, overdueBills: 0, dueSoonMinor: 420_000, dueSoonBills: 2 };

  it("leads with what is overdue, in red, then the count", () => {
    expect(receivablesLine(receivables, money)).toEqual({ tone: "danger", lead: "$18,750.00 overdue", rest: " · 4 invoices" });
  });

  it("falls back to what is due in 7 days for bills, in amber", () => {
    expect(payablesLine(payables, money)).toEqual({ tone: "warning", lead: "$4,200.00 due in 7 days", rest: " · 2 bills" });
  });

  it("says nothing is open, rather than nothing overdue, when nothing is", () => {
    expect(receivablesLine({ ...receivables, valueMinor: 0, ledgerMinor: 0, overdueMinor: 0 }, money).lead).toBe("No open invoices");
    expect(payablesLine({ ...payables, valueMinor: 0, ledgerMinor: 0, dueSoonMinor: 0 }, money).lead).toBe("No open bills");
    expect(payablesLine({ ...payables, dueSoonMinor: 0 }, money).lead).toBe("Nothing due in 7 days");
  });

  it("says what the ledger shows when the open documents do not add up to it", () => {
    // Books entered as journal entries: a balance in the ledger and no invoice behind it.
    const noInvoices = { ...receivables, valueMinor: 0, ledgerMinor: 25_000_000, overdueMinor: 0, overdueInvoices: 0 };
    expect(tiesToLedger(noInvoices)).toBe(false);
    expect(receivablesLine(noInvoices, money)).toEqual({ tone: "warning", lead: "Ledger shows $250,000.00", rest: "" });
    expect(payablesLine({ ...payables, ledgerMinor: 3_000_000, dueSoonMinor: 0 }, money)).toEqual({
      tone: "warning",
      lead: "Ledger shows $30,000.00",
      rest: "",
    });
    // Something overdue is still said first.
    expect(receivablesLine({ ...receivables, ledgerMinor: 7_000_000 }, money).lead).toBe("$18,750.00 overdue");
    expect(tiesToLedger(receivables)).toBe(true);
  });

  it("puts the difference from the ledger in a sentence, and says nothing when there is none", () => {
    expect(ledgerDifference("Accounts Receivable", 0, 25_000_000, money)).toBe(
      "Accounts Receivable in the ledger is $250,000.00, $250,000.00 more than what is listed here.",
    );
    expect(ledgerDifference("Accounts Payable", 2_748_000, 2_500_000, money)).toBe(
      "Accounts Payable in the ledger is $25,000.00, $2,480.00 less than what is listed here.",
    );
    expect(ledgerDifference("Accounts Payable", 2_748_000, 2_748_000, money)).toBeNull();
  });

  it("says which months of earlier years are still open, so the close card never reads as all closed", () => {
    expect(earlierOpenSentence({ count: 11, oldestPeriodEnd: "2025-01-31" })).toBe(
      "11 months of earlier years are still open, the oldest January 2025.",
    );
    expect(earlierOpenSentence({ count: 1, oldestPeriodEnd: "2025-06-30" })).toBe("June 2025, from an earlier year, is still open.");
  });

  it("names the month of the net income figure", () => {
    expect(netIncomeLabel([month("2026-10"), month("2026-11")])).toBe("Net income, November");
  });
});

describe("invoices and bills", () => {
  it("reads a bill's due date as late, today, soon or later", () => {
    expect(billDueLook(-12)).toEqual({ tone: "danger", label: "12 days late" });
    expect(billDueLook(0)).toEqual({ tone: "warning", label: "Due today" });
    expect(billDueLook(3)).toEqual({ tone: "warning", label: "Due in 3 days" });
    expect(billDueLook(1)).toEqual({ tone: "warning", label: "Due in 1 day" });
    expect(billDueLook(19)).toEqual({ tone: "neutral", label: "Due in 19 days" });
    expect(daysLate(1)).toBe("1 day late");
  });

  it("counts payments in other currencies apart, and says nothing when there are none", () => {
    expect(otherCurrencies(0)).toBe("");
    expect(otherCurrencies(1)).toBe(" + 1 in other currency");
    expect(otherCurrencies(2)).toBe(" + 2 in other currencies");
  });
});

describe("the bank accounts table", () => {
  const account = (over: Partial<HomeBankAccount>): HomeBankAccount => ({
    id: "a",
    name: "Example Checking",
    masked: "••4821",
    isCard: false,
    bookMinor: 0,
    statementMinor: null,
    reconciledThrough: null,
    linesToCode: 0,
    lastLineDate: null,
    tone: "neutral",
    statusText: "Never reconciled",
    href: "/banking/reconcile?account=a",
    ...over,
  });

  it("lists bank accounts and the cash outside them above Cash on hand, and the cards apart", () => {
    const bank: HomeBank = {
      accounts: [
        account({ id: "checking", bookMinor: 16_890_411 }),
        account({ id: "card", name: "Demo Card", isCard: true, bookMinor: 1_526_386 }),
        account({ id: "savings", name: "Sample Savings", bookMinor: 5_200_000 }),
      ],
      otherCash: { accounts: 1, bookMinor: 25_000 },
      totalBookMinor: 22_115_411,
    };
    const table = bankTable(bank);
    expect(table.banks.map((row) => row.id)).toEqual(["checking", "savings"]);
    expect(table.cards.map((row) => row.id)).toEqual(["card"]);
    // The rows above the total add up to it; the card is not in it.
    const above = table.banks.reduce((sum, row) => sum + row.bookMinor, 0) + (table.otherCash?.bookMinor ?? 0);
    expect(above).toBe(table.cashMinor);
  });

  it("says a card's balance as owed, or in credit when overpaid", () => {
    expect(cardBalance(1_526_386, money)).toBe("$15,263.86 owed");
    expect(cardBalance(-5_000, money)).toBe("$50.00 in credit");
  });
});

describe("the close", () => {
  it("counts the steps done", () => {
    expect(stepsDone(5, 7)).toBe("5 of 7 steps done");
    expect(stepsDone(0, 1)).toBe("0 of 1 step done");
  });
});
