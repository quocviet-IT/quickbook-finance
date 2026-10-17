import { describe, expect, it } from "vitest";
import {
  ALREADY_RECONCILED,
  BRING_HISTORY_FORWARD,
  DISCARD_CONFIRMATION,
  DISCARD_RECONCILIATION,
  NOT_A_TRANSACTION,
  PAIRED_LINE_REFUSAL,
  RESTORE_LINE,
  SESSION_HISTORY_REFUSAL,
  SET_ASIDE_MESSAGE,
  asideActionFor,
  bringForwardAdvice,
  bringHistoryForwardConfirmation,
  broughtForwardNote,
  closingAdvice,
  dayBefore,
  discardedMessage,
  discardedReturnPath,
  entriesCount,
  openingAdvice,
  pairedHowLabel,
  pairingMessage,
  reconciliationStandings,
  sessionHistoryAdvice,
  sessionHistoryRefusal,
  sessionHistoryStart,
  setAsideRefusal,
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
      text: "The books hold $5000.00 on 08/31/2026 — the statement opens at $5000.00. The 214 earlier lines can be brought forward as reconciled.",
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
      text: "The books hold $4900.00 on 08/31/2026, and the statement opens at $5000.00: $100.00 apart. The earlier lines stay open and are reconciled with this statement.",
    });
  });

  it("says the books hold no opening balance when nothing is posted before the statement", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 0, openLines: 0 }, statement, money)).toEqual({
      canBringForward: false,
      through: "2026-08-31",
      text: "The books hold $0.00 on 08/31/2026, and the statement opens at $5000.00. The books have nothing before this statement: the difference is an opening balance they do not hold yet.",
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
      "Brought forward, proved by the opening balance on the statement for 09/01/2026 – 09/30/2026",
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

  it("leaves a line set aside out of the pairing: it takes no book line and is not missing", () => {
    // Line 0 would pair with "a" by date and amount; set aside, it is not a transaction.
    const aside = lines.map((l) => (l.lineNo === 0 || l.lineNo === 2 ? { ...l, setAside: true } : l));
    const result = statementStandings(aside, book, "2026-09-30");
    expect(result.standings).toEqual([
      { kind: "aside" },
      { kind: "paired", how: "cheque number", bookId: "b", entryNumber: "BP-7", ticked: false },
      { kind: "aside" },
      { kind: "after" },
    ]);
    expect(result).toMatchObject({ paired: 1, missing: 0, after: 1, aside: 2, flipped: false });
    // The book line the set-aside line would have taken is outstanding again.
    expect(result.outstanding.sort()).toEqual(["a", "c"]);
  });

  it("carries a kept statement line's mark through to its standing", () => {
    const result = reconciliationStandings(
      { endingDate: "2026-09-30", lines: [{ lineNo: 0, txnDate: "2026-09-05", amountMinor: -1200, reference: null, setAside: true }] },
      [{ journalLineId: "a", entryDate: "2026-09-05", signedMinor: -1200, reference: null, entryNumber: "JE-1", cleared: true }],
    );
    expect(result.standings).toEqual([{ kind: "aside" }]);
    expect(result.outstanding).toEqual(["a"]);
  });
});

describe("setting a statement line aside", () => {
  it("refuses a line paired with the books, and allows any other — and bringing any line back", () => {
    const paired = { kind: "paired", how: "date and amount", bookId: "a", entryNumber: "JE-1", ticked: true } as const;
    expect(setAsideRefusal(paired, true)).toBe(PAIRED_LINE_REFUSAL);
    expect(PAIRED_LINE_REFUSAL).toBe("This line is paired with the books, so it is a transaction.");
    expect(setAsideRefusal({ kind: "missing" }, true)).toBeNull();
    expect(setAsideRefusal({ kind: "after" }, true)).toBeNull();
    expect(setAsideRefusal({ kind: "aside" }, true)).toBeNull();
    expect(setAsideRefusal(paired, false)).toBeNull();
    expect(setAsideRefusal(undefined, true)).toBeNull();
  });

  it("names the mark and the way back as the spec does", () => {
    expect([NOT_A_TRANSACTION, RESTORE_LINE]).toEqual(["Not a transaction", "Restore"]);
  });

  it("says, once a line is set aside, that its bank line stays in Bank Transactions", () => {
    expect(SET_ASIDE_MESSAGE).toBe(
      "Set aside as not a transaction. Its line stays in Bank Transactions — exclude it there if it is not real.",
    );
  });

  it("offers Not a transaction on a line the books do not have, Restore on one set aside, and nothing else", () => {
    expect(asideActionFor({ kind: "missing" })).toEqual({ label: "Not a transaction", aside: true });
    expect(asideActionFor({ kind: "aside" })).toEqual({ label: "Restore", aside: false });
    const paired = { kind: "paired", how: "date and amount", bookId: "a", entryNumber: "JE-1", ticked: false } as const;
    expect(asideActionFor(paired)).toBeNull();
    expect(asideActionFor({ kind: "after" })).toBeNull();
    expect(asideActionFor(undefined)).toBeNull();
  });

  it("never offers to set aside a line the server would refuse", () => {
    const standings = [
      { kind: "missing" },
      { kind: "aside" },
      { kind: "after" },
      { kind: "paired", how: "check number", bookId: "b", entryNumber: null, ticked: true },
    ] as const;
    for (const standing of standings) {
      const action = asideActionFor(standing);
      if (action) expect(setAsideRefusal(standing, action.aside), standing.kind).toBeNull();
    }
  });
});

describe("bringing the history forward from inside a reconciliation", () => {
  const session = { status: "in_progress", periodStart: "2026-09-01", openingMinor: 512340, beginningMinor: 0 };

  it("brings it forward through the day before the statement's period, at the balance the statement opens with", () => {
    expect(sessionHistoryRefusal(session)).toBeNull();
    expect(sessionHistoryStart(session)).toEqual({ through: "2026-08-31", openingMinor: 512340 });
  });

  it("offers nothing, and says why, when the session is done, its file names no start or opening, or it begins there already", () => {
    const cases = [
      [{ ...session, status: "completed" }, SESSION_HISTORY_REFUSAL.notInProgress],
      [{ ...session, periodStart: null, fileUnreadable: true }, SESSION_HISTORY_REFUSAL.unreadFile],
      [{ ...session, periodStart: null }, SESSION_HISTORY_REFUSAL.noStart],
      [{ ...session, openingMinor: null }, SESSION_HISTORY_REFUSAL.noStart],
      [{ ...session, beginningMinor: 512340 }, SESSION_HISTORY_REFUSAL.begins],
    ] as const;
    for (const [s, why] of cases) {
      expect(sessionHistoryRefusal(s)).toBe(why);
      expect(sessionHistoryStart(s)).toBeNull();
    }
  });

  const facts = { through: "2026-08-31", openingMinor: 512340, bookBalanceMinor: 512340, entries: 214, reconciled: false };

  it("offers the button when the books through that day hold exactly the opening", () => {
    expect(sessionHistoryAdvice(facts, money)).toEqual({
      canBringForward: true,
      through: "2026-08-31",
      entries: 214,
      text: "Everything in the books up to 08/31/2026 adds up to $5123.40, the balance this statement opens with.",
    });
  });

  it("says by how much the books are out, in either direction", () => {
    expect(sessionHistoryAdvice({ ...facts, bookBalanceMinor: 498765 }, money)).toMatchObject({
      canBringForward: false,
      text: "The books on 08/31/2026 read $4987.65; the statement opens at $5123.40. Out by $135.75.",
    });
    expect(sessionHistoryAdvice({ ...facts, bookBalanceMinor: 700000 }, money)?.text).toBe(
      "The books on 08/31/2026 read $7000.00; the statement opens at $5123.40. Out by $1876.60.",
    );
  });

  it("says the account was reconciled before, whatever the figures", () => {
    expect(sessionHistoryAdvice({ ...facts, reconciled: true }, money)).toMatchObject({
      canBringForward: false,
      text: "This account already has a completed reconciliation.",
    });
    expect(ALREADY_RECONCILED).toBe("This account already has a completed reconciliation.");
  });

  it("says nothing when there is nothing to offer, and offers no button with nothing to bring", () => {
    expect(sessionHistoryAdvice(null, money)).toBeNull();
    expect(sessionHistoryAdvice({ ...facts, entries: 0 }, money)?.canBringForward).toBe(false);
  });

  it("asks before marking, counting the entries", () => {
    expect(BRING_HISTORY_FORWARD).toBe("Bring the history forward");
    expect(bringHistoryForwardConfirmation(214, "2026-08-31")).toBe(
      "214 entries up to 08/31/2026 will be marked reconciled. Nothing is posted to the books.",
    );
    expect(bringHistoryForwardConfirmation(1, "2026-08-31")).toBe(
      "1 entry up to 08/31/2026 will be marked reconciled. Nothing is posted to the books.",
    );
    expect([entriesCount(0), entriesCount(1), entriesCount(1204)]).toEqual(["0 entries", "1 entry", "1,204 entries"]);
  });
});

describe("discarding a reconciliation", () => {
  it("says what goes and what stays, and returns to Reconcile", () => {
    expect(DISCARD_RECONCILIATION).toBe("Discard this reconciliation");
    expect(DISCARD_CONFIRMATION).toBe(
      "Its ticks and the statement lines kept with it are removed, along with any line set aside as not a transaction. The statement file and its bank lines stay, and any entries added to the books from it stay in the books.",
    );
    expect(discardedReturnPath("bank-1")).toBe("/banking/reconcile?account=bank-1");
  });

  it("says it was discarded, counting the ticks that went with it", () => {
    expect(discardedMessage(0)).toBe("Reconciliation discarded.");
    expect(discardedMessage(1)).toBe("Reconciliation discarded, with its 1 tick.");
    expect(discardedMessage(1204)).toBe("Reconciliation discarded, with its 1,204 ticks.");
  });
});

describe("pairingMessage", () => {
  it("counts what paired and was ticked, and sends what is missing to Bank Transactions", () => {
    expect(pairingMessage({ lines: 12, paired: 10, ticked: 3, missing: 2, after: 0, flipped: false })).toBe(
      "10 of 12 statement lines paired with the books; 3 newly ticked. 2 not in the books — code them in Bank Transactions, then Match again.",
    );
    expect(pairingMessage({ lines: 1, paired: 0, ticked: 0, missing: 1, after: 0, flipped: true })).toBe(
      "0 of 1 statement line paired with the books; 0 newly ticked. 1 not in the books — code it in Bank Transactions, then Match again. The statement's amounts were read the other way around to pair them.",
    );
  });
});

describe("pairedHowLabel", () => {
  it("says check, not cheque, and leaves the other two as they are", () => {
    expect(pairedHowLabel("cheque number")).toBe("check number");
    expect(pairedHowLabel("date and amount")).toBe("date and amount");
    expect(pairedHowLabel("amount, within 5 days")).toBe("amount, within 5 days");
  });
});
