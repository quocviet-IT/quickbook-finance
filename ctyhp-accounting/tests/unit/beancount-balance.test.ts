import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  balanceAssertions,
  nextDay,
  type BalanceAssertionRows,
  type BankLedgerLine,
  type CompletedReconciliation,
} from "@/lib/domain/beancount-balance";

const BANK = { id: "bank-1", glAccountId: "gl-1010", currencyCode: "USD" };

const recon = (over: Partial<CompletedReconciliation> = {}): CompletedReconciliation => ({
  id: "r-jul",
  bankAccountId: "bank-1",
  statementDate: "2026-07-31",
  statementMinor: 1248000,
  completedAt: "2026-08-03T10:00:00.000Z",
  ...over,
});

const line = (over: Partial<BankLedgerLine> = {}): BankLedgerLine => ({
  id: "l-1",
  accountId: "gl-1010",
  debitMinor: 0,
  creditMinor: 0,
  entryDate: "2026-07-10",
  currencyCode: "USD",
  status: "posted",
  postedAt: "2026-07-10T09:00:00.000Z",
  voidedAt: null,
  ...over,
});

// A July statement: a deposit and a payment cleared, one cheque still out.
// Statement 12,480.00; books 11,354.60.
const deposit = line({ id: "l-dep", debitMinor: 1500000, entryDate: "2026-07-02" });
const payment = line({ id: "l-pay", creditMinor: 252000, entryDate: "2026-07-12" });
const cheque = line({ id: "l-chq", creditMinor: 112540, entryDate: "2026-07-28" });

const rows = (over: Partial<BalanceAssertionRows> = {}): BalanceAssertionRows => ({
  reconciliations: [recon()],
  bankAccounts: [BANK],
  lines: [deposit, payment, cheque],
  cleared: [
    { reconciliationId: "r-jul", journalLineId: "l-dep" },
    { reconciliationId: "r-jul", journalLineId: "l-pay" },
  ],
  ...over,
});

describe("nextDay", () => {
  it("moves to the next calendar day across month, year and leap-day ends", () => {
    expect(nextDay("2026-07-31")).toBe("2026-08-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
  });
});

describe("balanceAssertions", () => {
  it("asserts the book balance on the statement date, dated the next day", () => {
    expect(balanceAssertions(rows(), "USD")).toEqual([
      {
        kind: "balance",
        reconciliationId: "r-jul",
        date: "2026-08-01",
        accountId: "gl-1010",
        statementDate: "2026-07-31",
        amountMinor: 1135460,
        currencyCode: "USD",
        statementMinor: 1248000,
        unclearedCount: 1,
      },
    ]);
  });

  it("does not count lines after the statement date or on other accounts", () => {
    const later = line({ id: "l-aug", debitMinor: 99900, entryDate: "2026-08-01", postedAt: "2026-08-01T09:00:00.000Z" });
    const elsewhere = line({ id: "l-other", accountId: "gl-1020", debitMinor: 50000 });
    const [a] = balanceAssertions(rows({ lines: [deposit, payment, cheque, later, elsewhere] }), "USD");
    expect(a.kind === "balance" && a.amountMinor).toBe(1135460);
  });

  it("does not count an entry posted after completion, even one dated inside the period", () => {
    const backdated = line({ id: "l-late", creditMinor: 5000, entryDate: "2026-07-20", postedAt: "2026-08-05T12:00:00.000Z" });
    const [a] = balanceAssertions(rows({ lines: [deposit, payment, cheque, backdated] }), "USD");
    expect(a.kind === "balance" && a.amountMinor).toBe(1135460);
  });

  it("counts an entry voided after completion, and not one voided before it", () => {
    const voidedLater = line({ id: "l-vl", creditMinor: 3000, status: "void", voidedAt: "2026-08-10T08:00:00.000Z" });
    const voidedEarlier = line({ id: "l-ve", creditMinor: 7000, status: "void", voidedAt: "2026-07-15T08:00:00.000Z" });
    const [a] = balanceAssertions(rows({ lines: [deposit, payment, cheque, voidedLater, voidedEarlier] }), "USD");
    expect(a.kind === "balance" && a.amountMinor).toBe(1135460 - 3000);
  });

  it("writes a skip rather than a guess when a void in the period has no void time", () => {
    const unknown = line({ id: "l-unk", creditMinor: 4000, status: "void", voidedAt: null });
    expect(balanceAssertions(rows({ lines: [deposit, unknown] }), "USD")).toEqual([
      {
        kind: "skipped",
        reason: "unknown-void",
        reconciliationId: "r-jul",
        date: "2026-08-01",
        accountId: "gl-1010",
        statementDate: "2026-07-31",
      },
    ]);
  });

  it("ignores a void without a void time when it was posted after completion", () => {
    const unknownLater = line({ id: "l-unk", creditMinor: 4000, status: "void", voidedAt: null, postedAt: "2026-08-06T09:00:00.000Z" });
    const [a] = balanceAssertions(rows({ lines: [deposit, payment, cheque, unknownLater] }), "USD");
    expect(a.kind).toBe("balance");
  });

  it("skips a bank account that is not in the base currency", () => {
    const [a] = balanceAssertions(rows({ bankAccounts: [{ ...BANK, currencyCode: "EUR" }] }), "USD");
    expect(a).toMatchObject({ kind: "skipped", reason: "currency", currencyCode: "EUR" });
  });

  it("skips when a counted line is in another currency", () => {
    const euroLine = line({ id: "l-eur", debitMinor: 1000, currencyCode: "EUR" });
    const [a] = balanceAssertions(rows({ lines: [deposit, euroLine] }), "USD");
    expect(a).toMatchObject({ kind: "skipped", reason: "currency", currencyCode: "EUR" });
  });

  it("writes one assertion per completed reconciliation, in date order", () => {
    const june = recon({ id: "r-jun", statementDate: "2026-06-30", statementMinor: 0, completedAt: "2026-07-02T10:00:00.000Z" });
    const out = balanceAssertions(rows({ reconciliations: [recon(), june] }), "USD");
    expect(out.map((a) => [a.reconciliationId, a.date])).toEqual([
      ["r-jun", "2026-07-01"],
      ["r-jul", "2026-08-01"],
    ]);
  });

  it("counts as uncleared only lines that neither this nor an earlier reconciliation cleared", () => {
    // A June cheque, still out in June, cleared in July.
    const juneCheque = line({ id: "l-jun", creditMinor: 10000, entryDate: "2026-06-25", postedAt: "2026-06-25T09:00:00.000Z" });
    const june = recon({ id: "r-jun", statementDate: "2026-06-30", statementMinor: 0, completedAt: "2026-07-02T10:00:00.000Z" });
    const out = balanceAssertions(
      rows({
        reconciliations: [june, recon()],
        lines: [juneCheque, deposit, payment, cheque],
        cleared: [
          { reconciliationId: "r-jul", journalLineId: "l-jun" },
          { reconciliationId: "r-jul", journalLineId: "l-dep" },
          { reconciliationId: "r-jul", journalLineId: "l-pay" },
        ],
      }),
      "USD",
    );
    const byId = new Map(out.map((a) => [a.reconciliationId, a]));
    expect(byId.get("r-jun")).toMatchObject({ kind: "balance", amountMinor: -10000, unclearedCount: 1 });
    expect(byId.get("r-jul")).toMatchObject({ kind: "balance", unclearedCount: 1 });
  });

  it("ignores clearing records of a reconciliation that is not completed", () => {
    const out = balanceAssertions(
      rows({ cleared: [...rows().cleared, { reconciliationId: "r-open", journalLineId: "l-chq" }] }),
      "USD",
    );
    expect(out[0]).toMatchObject({ unclearedCount: 1 });
  });

  it("refuses a reconciliation whose bank account was not read", () => {
    expect(() => balanceAssertions(rows({ bankAccounts: [] }), "USD")).toThrow(/bank account/);
  });
});

describe("the beancount-balance module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/beancount-balance.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
