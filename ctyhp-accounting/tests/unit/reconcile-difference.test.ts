import { describe, expect, it } from "vitest";
import {
  DIFFERENCE_LABELS,
  bookLineName,
  differenceHeading,
  differenceHint,
  explainDifference,
  linesCount,
  openingPartText,
  statementLineName,
  type DifferenceBookLine,
  type DifferenceStatementLine,
} from "@/lib/domain/reconcile-difference";
import { reconciliationStandings } from "@/lib/domain/reconcile-statement";

const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;

type Line = DifferenceStatementLine & { reference: string | null };
type Book = DifferenceBookLine & { reference: string | null };

const sline = (lineNo: number, txnDate: string, amountMinor: number, description: string, setAside = false): Line => ({
  lineNo,
  txnDate,
  amountMinor,
  description,
  reference: null,
  setAside,
});
const bline = (id: string, entryDate: string, signedMinor: number, cleared: boolean, entryNumber: string | null = `JE-${id}`): Book => ({
  journalLineId: id,
  entryNumber,
  entryDate,
  signedMinor,
  cleared,
  reference: null,
});

/** The workspace's detail, worked out the way acc_reconciliation_detail works it out. */
function detailOf(beginningMinor: number, statementEndingMinor: number, book: readonly Book[]) {
  const clearedTotalMinor = book.filter((b) => b.cleared).reduce((sum, b) => sum + b.signedMinor, 0);
  return { beginningMinor, clearedTotalMinor, statementEndingMinor, differenceMinor: statementEndingMinor - (beginningMinor + clearedTotalMinor) };
}

function explain(opening: number | null, beginning: number, ending: number, lines: readonly Line[], book: readonly Book[]) {
  const standings = lines.length ? reconciliationStandings({ endingDate: "2026-09-30", lines }, book).standings : null;
  return explainDifference(
    { detail: detailOf(beginning, ending, book), statement: { openingMinor: opening, lines }, standings, book },
    money,
  );
}

describe("the difference, explained", () => {
  // An invented first reconciliation that began at 0 against a statement opening at $1,000.00.
  const lines = [
    sline(0, "2026-09-05", 50000, "EXAMPLE DEPOSIT"), // paired, ticked
    sline(1, "2026-09-10", -2000, "SERVICE FEE"), // not in the books
    sline(2, "2026-09-12", 30000, "EXAMPLE CLIENT PAYMENT"), // paired, not ticked
    sline(3, "2026-09-14", -7700, "MISREAD ROW", true), // set aside
    sline(4, "2026-10-02", 700, "AFTER THE DATE"), // after the statement date
  ];
  const book = [
    bline("d1", "2026-09-05", 50000, true),
    bline("d2", "2026-09-12", 30000, false),
    bline("t1", "2026-09-20", -1200, true, "JE-0031"), // ticked, on no statement line
    bline("u1", "2026-09-25", -999, false), // outstanding, not ticked
  ];
  // The statement proves itself: $1,000.00 + 500.00 − 20.00 + 300.00 = $1,780.00.
  const closing = 100000 + 50000 - 2000 + 30000;

  it("splits the difference into the opening, the lines the books lack, the ticks the statement lacks, and what is left", () => {
    const result = explain(100000, 0, closing, lines, book);
    // 1,780.00 − (0 + 500.00 − 12.00) = 1,292.00
    expect(result).toEqual({
      differenceMinor: 129200,
      opening: {
        beginningMinor: 0,
        openingMinor: 100000,
        amountMinor: 100000,
        text: "This reconciliation begins at $0.00; the statement opens at $1000.00.",
      },
      onStatement: { count: 1, amountMinor: -2000, ids: [1] },
      tickedNotOnStatement: { count: 1, amountMinor: -1200, ids: ["t1"] },
      // 1,292.00 − 1,000.00 − (−20.00) + (−12.00) = 300.00: the paired line not ticked.
      leftMinor: 30000,
      hint: "It equals the statement line “EXAMPLE CLIENT PAYMENT” of Sep 12, 2026 ($300.00). Check that one first.",
    });
  });

  it("leaves nothing to explain once that line is ticked", () => {
    const ticked = book.map((b) => (b.journalLineId === "d2" ? { ...b, cleared: true } : b));
    const result = explain(100000, 0, closing, lines, ticked);
    expect(result).toMatchObject({ differenceMinor: 99200, leftMinor: 0, hint: null });
  });

  it("says nothing when there is no difference", () => {
    const all = book.map((b) => (b.journalLineId === "u1" ? b : { ...b, cleared: true }));
    // Begins at the opening, and the statement's lines are all ticked or explained.
    expect(explain(100000, 100000, 100000 + 50000 + 30000 - 1200, lines, all)).toBeNull();
  });

  it("names a ticked book line when it is the one line the size of what is left", () => {
    // A statement that kept no lines: only the opening part and what is left.
    const ticked = [bline("k1", "2026-09-03", 45000, true, "JE-0101"), bline("k2", "2026-09-04", 5000, true, "JE-0102")];
    const result = explain(100000, 0, 195000, [], ticked);
    expect(result).toMatchObject({
      differenceMinor: 145000,
      opening: { amountMinor: 100000 },
      onStatement: null,
      tickedNotOnStatement: null,
      leftMinor: 45000,
      hint: "It equals JE-0101 of Sep 3, 2026 ($450.00). Check that one first.",
    });
  });

  it("names nothing when two lines are that size, or none is", () => {
    const twins = [bline("k1", "2026-09-03", 45000, true), bline("k2", "2026-09-04", -45000, true), bline("k3", "2026-09-05", 1000, true)];
    expect(explain(100000, 0, 100000 + 1000 + 45000, [], twins)).toMatchObject({ leftMinor: 45000, hint: null });
    expect(explain(100000, 0, 100000 + 1000 + 77, [], [bline("k3", "2026-09-05", 1000, true)])).toMatchObject({ leftMinor: 77, hint: null });
  });

  it("never names a line set aside, or a book line that is not ticked", () => {
    // What is left (77.00) is the size of the set-aside line and of an unticked book line only.
    const left = [sline(0, "2026-09-05", 7700, "MISREAD ROW", true)];
    const unticked = [bline("u", "2026-09-06", 7700, false)];
    expect(explain(null, 0, 7700, left, unticked)).toMatchObject({ leftMinor: 7700, hint: null });
  });

  it("shows no opening part when the statement's opening is unknown or where the reconciliation begins", () => {
    expect(explain(null, 0, 5000, [], [])).toMatchObject({ opening: null, leftMinor: 5000 });
    expect(explain(5000, 5000, 9000, [], [])).toMatchObject({ opening: null, leftMinor: 4000 });
  });

  it("without any statement, what is left is the whole difference", () => {
    const result = explainDifference(
      { detail: detailOf(0, 2500, []), statement: null, standings: null, book: [] },
      money,
    );
    expect(result).toEqual({
      differenceMinor: 2500,
      opening: null,
      onStatement: null,
      tickedNotOnStatement: null,
      leftMinor: 2500,
      hint: null,
    });
  });

  it("counts a statement line set aside or dated after the statement as neither missing nor left", () => {
    const result = explain(100000, 0, closing, lines, book)!;
    expect(result.onStatement?.ids).toEqual([1]);
  });
});

describe("the identity, on invented reconciliations", () => {
  /** A small deterministic generator, so the figures are invented and the run repeatable. */
  function seeded(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  it("difference = opening + on the statement − ticked here + left, and left is what the paired, unticked lines hold", () => {
    for (let run = 1; run <= 40; run++) {
      const rand = seeded(run);
      const lines: Line[] = [];
      const book: Book[] = [];
      let lineNo = 0;
      let amount = 1000 + run; // every amount distinct, so pairing is unambiguous
      const expected = { onStatement: 0, ticked: 0, left: 0, sumOnStatement: 0 };
      let closingLines = 0;
      for (let i = 0; i < 25; i++) {
        amount += 137;
        const signed = rand() < 0.5 ? -amount : amount;
        const day = `2026-09-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`;
        const kind = Math.floor(rand() * 6);
        if (kind === 0) {
          lines.push(sline(lineNo++, day, signed, `PAID ${i}`));
          book.push(bline(`p${i}`, day, signed, true));
          closingLines += signed;
        } else if (kind === 1) {
          lines.push(sline(lineNo++, day, signed, `PAID LATE ${i}`));
          book.push(bline(`q${i}`, day, signed, false));
          closingLines += signed;
          expected.left += signed;
        } else if (kind === 2) {
          lines.push(sline(lineNo++, day, signed, `MISSING ${i}`));
          closingLines += signed;
          expected.onStatement += 1;
          expected.sumOnStatement += signed;
        } else if (kind === 3) {
          lines.push(sline(lineNo++, day, signed, `MISREAD ${i}`, true));
        } else if (kind === 4) {
          book.push(bline(`t${i}`, day, signed, true));
          expected.ticked += signed;
        } else {
          book.push(bline(`u${i}`, day, signed, false));
        }
      }
      const opening = Math.floor(rand() * 500000);
      const beginning = rand() < 0.5 ? 0 : opening;
      const result = explain(opening, beginning, opening + closingLines, lines, book);
      const detail = detailOf(beginning, opening + closingLines, book);
      if (detail.differenceMinor === 0) {
        expect(result).toBeNull();
        continue;
      }
      expect(result).not.toBeNull();
      const r = result!;
      expect(r.onStatement?.count ?? 0).toBe(expected.onStatement);
      expect(r.onStatement?.amountMinor ?? 0).toBe(expected.sumOnStatement);
      expect(r.tickedNotOnStatement?.amountMinor ?? 0).toBe(expected.ticked);
      expect(r.leftMinor).toBe(expected.left);
      expect((r.opening?.amountMinor ?? 0) + (r.onStatement?.amountMinor ?? 0) - (r.tickedNotOnStatement?.amountMinor ?? 0) + r.leftMinor).toBe(
        detail.differenceMinor,
      );
    }
  });
});

describe("the sentences", () => {
  it("labels each part as the spec does", () => {
    expect(DIFFERENCE_LABELS).toEqual({
      opening: "Opening",
      onStatement: "On the statement, not in the books",
      tickedNotOnStatement: "Ticked here, not on the statement",
      left: "Left to explain",
    });
  });

  it("says where the reconciliation begins and where the statement opens", () => {
    expect(openingPartText(0, 100000, money)).toBe("This reconciliation begins at $0.00; the statement opens at $1000.00.");
  });

  it("names a line short", () => {
    expect(statementLineName({ description: "  SERVICE FEE ", txnDate: "2026-09-05" })).toBe("the statement line “SERVICE FEE” of Sep 5, 2026");
    expect(statementLineName({ description: "", txnDate: "2026-09-05" })).toBe("the statement line of Sep 5, 2026");
    expect(bookLineName({ entryNumber: "JE-000123", entryDate: "2026-09-05" })).toBe("JE-000123 of Sep 5, 2026");
    expect(bookLineName({ entryNumber: null, entryDate: "2026-09-05" })).toBe("the entry of Sep 5, 2026");
    expect(differenceHint("JE-000123 of Sep 5, 2026", -1200, money)).toBe("It equals JE-000123 of Sep 5, 2026 (-$12.00). Check that one first.");
  });

  it("heads the parts with the difference, and counts each part's lines", () => {
    expect(differenceHeading(13575, money)).toBe("The difference of $135.75, explained");
    expect(differenceHeading(-4800, money)).toBe("The difference of -$48.00, explained");
    expect([linesCount(0), linesCount(1), linesCount(2), linesCount(1204)]).toEqual(["0 lines", "1 line", "2 lines", "1,204 lines"]);
  });
});
