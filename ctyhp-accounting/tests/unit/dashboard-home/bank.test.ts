import { describe, expect, it } from "vitest";
import type { BankStanding, StandingView } from "@/lib/domain/bank-standing";
import type { LedgerBalance } from "@/lib/domain/reports";
import { bankAccountStatus, cashOnHand, homeBank } from "@/lib/domain/dashboard-home/bank";
import { formatBaseMoney } from "@/lib/format";

const AS_OF = "2026-11-13";
const view = (tone: StandingView["tone"], noLongerAgrees: string | null = null): StandingView => ({ tone, text: "", noLongerAgrees, ageDays: null });

describe("bankAccountStatus", () => {
  it("says an account has gone quiet first: no bank lines for more than 45 days", () => {
    expect(
      bankAccountStatus({ linesToCode: 37, standingView: view("positive"), reconciledThrough: "2026-10-31", lastLineDate: "2026-09-28", asOf: AS_OF }),
    ).toEqual({ tone: "danger", statusText: "No bank lines since 09/28/2026", kind: "stale" });
  });

  it("is not stale at exactly 45 days, nor when the account never had lines", () => {
    // September 29 to November 13 is 45 days.
    expect(bankAccountStatus({ linesToCode: 0, standingView: view("positive"), reconciledThrough: "2026-10-31", lastLineDate: "2026-09-29", asOf: AS_OF }).kind).toBe("standing");
    expect(bankAccountStatus({ linesToCode: 0, standingView: view("neutral"), reconciledThrough: null, lastLineDate: null, asOf: AS_OF }).kind).toBe("standing");
  });

  it("then lines waiting to be coded", () => {
    expect(bankAccountStatus({ linesToCode: 37, standingView: view("positive"), reconciledThrough: "2026-10-31", lastLineDate: "2026-11-12", asOf: AS_OF })).toEqual({
      tone: "warning",
      statusText: "37 lines to code",
      kind: "toCode",
    });
    expect(bankAccountStatus({ linesToCode: 1, standingView: view("positive"), reconciledThrough: null, lastLineDate: "2026-11-12", asOf: AS_OF }).statusText).toBe("1 line to code");
  });

  it("then how it stands against its statements, in the standing's tone", () => {
    const base = { linesToCode: 0, lastLineDate: "2026-11-12", asOf: AS_OF };
    expect(bankAccountStatus({ ...base, standingView: view("positive"), reconciledThrough: "2026-10-31" })).toEqual({
      tone: "positive",
      statusText: "Reconciled through 10/31/2026",
      kind: "standing",
    });
    expect(bankAccountStatus({ ...base, standingView: view("warning"), reconciledThrough: "2026-08-31" }).tone).toBe("warning");
    expect(bankAccountStatus({ ...base, standingView: view("danger"), reconciledThrough: null }).statusText).toBe("Never reconciled");
    expect(bankAccountStatus({ ...base, standingView: view("danger", "No longer agrees: …"), reconciledThrough: "2026-10-31" })).toEqual({
      tone: "danger",
      statusText: "Reconciliation no longer agrees",
      kind: "standing",
    });
  });
});

const standing = (bankAccountId: string, over: Partial<BankStanding> = {}): BankStanding => ({
  bankAccountId,
  lastCompletedId: "r1",
  lastCompletedDate: "2026-10-31",
  lastClosingMinor: 0,
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

const ledger = (accountId: string, accountType: LedgerBalance["accountType"], debitBase: number, creditBase: number): LedgerBalance => ({
  accountId,
  accountCode: accountId,
  name: `Sample ${accountId}`,
  accountType,
  debitBase,
  creditBase,
});

describe("homeBank", () => {
  const balances = [
    ledger("gl-checking", "bank", 200_000_00, 31_095_89),
    ledger("gl-savings", "bank", 52_000_00, 0),
    ledger("gl-cash", "bank", 1_250_00, 0), // Cash on Hand: no bank account record
    ledger("gl-card", "credit_card", 4_000_00, 19_263_86),
    ledger("gl-undeposited", "current_asset", 4_200_00, 0),
  ];
  const bank = homeBank({
    records: [
      { id: "card", accountId: "gl-card", name: "Sample Card", masked: "3333", isCard: true },
      { id: "checking", accountId: "gl-checking", name: "Sample Checking", masked: "4821", isCard: false },
      { id: "savings", accountId: "gl-savings", name: "Sample Savings", masked: null, isCard: false },
    ],
    standings: [
      standing("checking", { bookMinor: 168_904_11, lastClosingMinor: 170_214_11 }),
      standing("savings", { bookMinor: 52_000_00, lastClosingMinor: 52_000_00 }),
      // The books keep a card debit positive: owing 15,263.86 is -15,263.86.
      standing("card", { bookMinor: -15_263_86, lastClosingMinor: -15_263_86, lastCompletedDate: "2026-09-30" }),
    ],
    linesToCode: new Map([["checking", 37]]),
    lastLineDates: new Map([["checking", "2026-11-12"], ["savings", "2026-11-01"], ["card", "2026-11-10"]]),
    balances,
    asOf: AS_OF,
    money: formatBaseMoney,
  });

  it("lists bank accounts first and cards after, a card's balance owed positive as the Banking screens show it", () => {
    expect(bank.accounts.map((a) => [a.id, a.bookMinor, a.statementMinor])).toEqual([
      ["checking", 168_904_11, 170_214_11],
      ["savings", 52_000_00, 52_000_00],
      ["card", 15_263_86, 15_263_86],
    ]);
    expect(bank.accounts[0]).toMatchObject({
      tone: "warning",
      statusText: "37 lines to code",
      href: "/banking?queue=unmatched&account=checking",
      reconciledThrough: "2026-10-31",
      linesToCode: 37,
      lastLineDate: "2026-11-12",
      masked: "4821",
    });
    expect(bank.accounts[1]).toMatchObject({ tone: "positive", statusText: "Reconciled through 10/31/2026", href: "/banking/reconcile?account=savings" });
  });

  it("totals every bank-type ledger account, so the total equals Cash on hand, and names the cash with no bank account behind it", () => {
    expect(bank.totalBookMinor).toBe(cashOnHand(balances));
    expect(bank.totalBookMinor).toBe(168_904_11 + 52_000_00 + 1_250_00);
    expect(bank.otherCash).toEqual({ accounts: 1, bookMinor: 1_250_00 });
    const listed = bank.accounts.filter((a) => !a.isCard).reduce((s, a) => s + a.bookMinor, 0);
    expect(listed + (bank.otherCash?.bookMinor ?? 0)).toBe(bank.totalBookMinor);
  });

  it("has no other cash when every bank-type account with a balance has a bank account record", () => {
    const only = homeBank({
      records: [{ id: "checking", accountId: "gl-checking", name: "Sample Checking", masked: null, isCard: false }],
      standings: [standing("checking", { bookMinor: 10_00 })],
      linesToCode: new Map(),
      lastLineDates: new Map(),
      balances: [ledger("gl-checking", "bank", 10_00, 0), ledger("gl-cash", "bank", 0, 0)],
      asOf: AS_OF,
      money: formatBaseMoney,
    });
    expect(only.otherCash).toBeNull();
    expect(only.totalBookMinor).toBe(10_00);
  });
});
