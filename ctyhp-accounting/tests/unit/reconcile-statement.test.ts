import { describe, expect, it } from "vitest";
import {
  bringForwardAdvice,
  broughtForwardNote,
  closingAdvice,
  dayBefore,
  openingAdvice,
  pairingMessage,
  reconciliationStandings,
  statementStandings,
  type StandingBookLine,
} from "@/lib/domain/reconcile-statement";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

describe("dayBefore", () => {
  it("steps back across a month and a year", () => {
    expect(dayBefore("2026-09-01")).toBe("2026-08-31");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29");
  });
});

describe("bringForwardAdvice", () => {
  const statement = { from: "2026-09-01", openingMinor: 500000 };

  it("offers to bring the earlier lines forward when the books agree with the opening balance", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 500000, openLines: 214 }, statement, money)).toEqual({
      canBringForward: true,
      through: "2026-08-31",
      text: "The books hold $5000.00 on Aug 31, 2026 — the statement opens at $5000.00. The 214 earlier lines can be brought forward as reconciled.",
    });
  });

  it("says one line in the singular", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 500000, openLines: 1 }, statement, money)?.text).toContain(
      "The 1 earlier line can be brought forward",
    );
  });

  it("says by how much they differ, and that the earlier lines stay open", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 490000, openLines: 3 }, statement, money)).toEqual({
      canBringForward: false,
      through: "2026-08-31",
      text: "The books hold $4900.00 on Aug 31, 2026, and the statement opens at $5000.00: $100.00 apart. The earlier lines stay open and are reconciled with this statement.",
    });
  });

  it("says the books hold no opening balance when nothing is posted before the statement", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 0, openLines: 0 }, statement, money)).toEqual({
      canBringForward: false,
      through: "2026-08-31",
      text: "The books hold $0.00 on Aug 31, 2026, and the statement opens at $5000.00. The books have nothing before this statement: the difference is an opening balance they do not hold yet.",
    });
  });

  it("says nothing once the account has a reconciliation, or the statement prints no start or opening", () => {
    const preview = { hasReconciliations: false, bookBalanceMinor: 500000, openLines: 2 };
    expect(bringForwardAdvice({ ...preview, hasReconciliations: true }, statement, money)).toBeNull();
    expect(bringForwardAdvice(preview, { from: null, openingMinor: 500000 }, money)).toBeNull();
    expect(bringForwardAdvice(preview, { from: "2026-09-01", openingMinor: null }, money)).toBeNull();
  });

  it("says nothing when the books hold nothing earlier and the statement opens at zero", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 0, openLines: 0 }, { from: "2026-09-01", openingMinor: 0 }, money)).toBeNull();
  });
});

describe("the sentences on a reconciliation", () => {
  it("names the statement's period in the brought-forward note", () => {
    expect(broughtForwardNote("2026-09-01", "2026-09-30")).toBe(
      "Brought forward, proved by the opening balance on the statement for Sep 1 – Sep 30, 2026",
    );
  });

  it("says when the statement closes on another figure, and nothing when it agrees", () => {
    expect(closingAdvice(555825, 560000, money)).toBe("The statement closes at $5558.25; this reconciliation says $5600.00.");
    expect(closingAdvice(560000, 560000, money)).toBeNull();
    expect(closingAdvice(null, 560000, money)).toBeNull();
  });

  it("says when the statement opens where the reconciliation does not begin", () => {
    expect(openingAdvice(500000, 450000, money)).toBe(
      "The statement opens at $5000.00; this reconciliation begins at $4500.00. A statement may be missing, or the last reconciliation closed on a different figure.",
    );
    expect(openingAdvice(500000, 500000, money)).toBeNull();
  });
});

describe("statementStandings", () => {
  const book: StandingBookLine[] = [
    { id: "a", date: "2026-09-05", amountMinor: -1200, reference: null, entryNumber: "JE-1", cleared: true },
    { id: "b", date: "2026-09-02", amountMinor: -60000, reference: "1201", entryNumber: "BP-7", cleared: false },
    { id: "c", date: "2026-09-20", amountMinor: 9900, reference: null, entryNumber: "PMT-3", cleared: false },
  ];
  const lines = [
    { lineNo: 0, date: "2026-09-05", amountMinor: -1200, reference: null },
    { lineNo: 1, date: "2026-09-28", amountMinor: -60000, reference: "1201" },
    { lineNo: 2, date: "2026-09-29", amountMinor: -500, reference: null },
    { lineNo: 3, date: "2026-10-02", amountMinor: 700, reference: null },
  ];

  it("says how each line paired, whether its book line is ticked, and what is not in the books", () => {
    const result = statementStandings(lines, book, "2026-09-30");
    expect(result.standings).toEqual([
      { kind: "paired", how: "date and amount", bookId: "a", entryNumber: "JE-1", ticked: true },
      { kind: "paired", how: "cheque number", bookId: "b", entryNumber: "BP-7", ticked: false },
      { kind: "missing" },
      { kind: "after" },
    ]);
    expect(result).toMatchObject({ paired: 2, missing: 1, after: 1, flipped: false, outstanding: ["c"] });
  });

  it("reads a reconciliation's kept statement and book lines the same way", () => {
    const result = reconciliationStandings(
      { endingDate: "2026-09-30", lines: lines.map((l) => ({ ...l, txnDate: l.date })) },
      book.map((b) => ({ ...b, journalLineId: b.id, entryDate: b.date, signedMinor: b.amountMinor })),
    );
    expect(result).toEqual(statementStandings(lines, book, "2026-09-30"));
  });
});

describe("pairingMessage", () => {
  it("counts what paired and was ticked, and sends what is missing to Bank Transactions", () => {
    expect(pairingMessage({ lines: 12, paired: 10, ticked: 3, missing: 2, after: 0, flipped: false })).toBe(
      "10 of 12 statement lines paired with the books; 3 newly ticked. 2 not in the books — code them in Bank Transactions, then Match again.",
    );
    expect(pairingMessage({ lines: 1, paired: 0, ticked: 0, missing: 1, after: 0, flipped: true })).toBe(
      "0 of 1 statement line paired with the books; 0 newly ticked. 1 not in the books — code it in Bank Transactions, then Match again. The statement's amounts were read the other way round to pair them.",
    );
  });
});
