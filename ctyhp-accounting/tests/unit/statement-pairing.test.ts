import { describe, expect, it } from "vitest";
import {
  cleanReference,
  matchStatement,
  pairStatement,
  type PairBookLine,
  type PairStatementLine,
} from "@/lib/domain/statement-pairing";

const line = (lineNo: number, date: string, amountMinor: number, reference: string | null = null): PairStatementLine => ({
  lineNo,
  date,
  amountMinor,
  reference,
});
const entry = (id: string, date: string, amountMinor: number, reference: string | null = null): PairBookLine => ({
  id,
  date,
  amountMinor,
  reference,
});
const summary = (result: ReturnType<typeof pairStatement>) => ({
  pairs: result.pairs.map((p) => [p.line.lineNo, p.book.id, p.how]),
  missing: result.missing.map((l) => l.lineNo),
  unseen: result.unseen.map((e) => e.id),
});

describe("pairStatement", () => {
  it("pairs the same date and amount before anything looser", () => {
    const result = pairStatement(
      [line(0, "2026-09-07", -1200)],
      [entry("near", "2026-09-05", -1200), entry("exact", "2026-09-07", -1200)],
    );
    expect(summary(result).pairs).toEqual([[0, "exact", "date and amount"]]);
  });

  it("pairs a cheque by its number when the dates are far apart", () => {
    const result = pairStatement([line(0, "2026-09-28", -60000, "1201")], [entry("chq", "2026-09-02", -60000, "1201")]);
    expect(summary(result).pairs).toEqual([[0, "chq", "cheque number"]]);
  });

  it("pairs the same amount within five days, and not at six", () => {
    expect(summary(pairStatement([line(0, "2026-09-10", 500)], [entry("a", "2026-09-05", 500)])).pairs).toEqual([
      [0, "a", "amount, within 5 days"],
    ]);
    expect(summary(pairStatement([line(0, "2026-09-11", 500)], [entry("a", "2026-09-05", 500)]))).toEqual({
      pairs: [],
      missing: [0],
      unseen: ["a"],
    });
  });

  it("uses each line once: a second identical statement line is missing", () => {
    const result = pairStatement([line(0, "2026-09-05", -500), line(1, "2026-09-05", -500)], [entry("fee", "2026-09-05", -500)]);
    expect(summary(result)).toEqual({ pairs: [[0, "fee", "date and amount"]], missing: [1], unseen: [] });
  });

  it("takes statement lines in file order, each the first free book line in book order", () => {
    const result = pairStatement(
      [line(0, "2026-09-08", 900), line(1, "2026-09-08", 900)],
      [entry("first", "2026-09-06", 900), entry("second", "2026-09-07", 900)],
    );
    expect(summary(result).pairs).toEqual([
      [0, "first", "amount, within 5 days"],
      [1, "second", "amount, within 5 days"],
    ]);
  });

  it("never pairs on an empty cheque number", () => {
    const result = pairStatement([line(0, "2026-09-28", -700, " ")], [entry("blank", "2026-09-01", -700, "")]);
    expect(summary(result).pairs).toEqual([]);
  });

  it("pairs nothing when either side is empty", () => {
    expect(summary(pairStatement([], [entry("a", "2026-09-05", 500)]))).toEqual({ pairs: [], missing: [], unseen: ["a"] });
    expect(summary(pairStatement([line(0, "2026-09-05", 500)], []))).toEqual({ pairs: [], missing: [0], unseen: [] });
  });
});

/**
 * 3.0.24 (item E of the defect report of 11 Nov 2026): a statement line that
 * fits more than one entry is left for a person, never guessed.
 */
describe("a line that fits more than one entry", () => {
  const unsure = (result: ReturnType<typeof pairStatement>) =>
    result.ambiguous.map((a) => [a.line.lineNo, a.candidates.map((c) => c.id), a.how]);

  it("is not paired when the books hold the same money twice on the day the bank shows it once", () => {
    const result = pairStatement([line(0, "2026-08-14", 50000)], [entry("first", "2026-08-14", 50000), entry("again", "2026-08-14", 50000)]);
    expect(summary(result)).toEqual({ pairs: [], missing: [], unseen: ["first", "again"] });
    expect(unsure(result)).toEqual([[0, ["first", "again"], "date and amount"]]);
  });

  it("is not paired when two entries within the window fit it equally", () => {
    const result = pairStatement([line(0, "2026-09-10", -2500)], [entry("before", "2026-09-08", -2500), entry("after", "2026-09-12", -2500)]);
    expect(result.pairs).toEqual([]);
    expect(unsure(result)).toEqual([[0, ["before", "after"], "amount, within 5 days"]]);
  });

  it("is paired when the other entry fits only by weaker evidence", () => {
    // The same day beats a day apart; a check number beats the window.
    expect(unsure(pairStatement([line(0, "2026-09-07", -1200)], [entry("near", "2026-09-05", -1200), entry("exact", "2026-09-07", -1200)]))).toEqual([]);
    const check = pairStatement(
      [line(0, "2026-09-28", -60000, "1201")],
      [entry("chq", "2026-09-02", -60000, "1201"), entry("other", "2026-09-27", -60000)],
    );
    expect(summary(check).pairs).toEqual([[0, "chq", "cheque number"]]);
    expect(unsure(check)).toEqual([]);
  });

  it("is paired when as many lines as entries are alike: whichever way round, every entry is ticked", () => {
    const result = pairStatement(
      [line(0, "2026-09-08", 900), line(1, "2026-09-08", 900)],
      [entry("first", "2026-09-06", 900), entry("second", "2026-09-07", 900)],
    );
    expect(unsure(result)).toEqual([]);
    expect(result.pairs).toHaveLength(2);
  });

  it("is settled by an entry a person has ticked: that one is taken, and it is no guess", () => {
    const result = pairStatement(
      [line(0, "2026-08-14", 50000)],
      [entry("first", "2026-08-14", 50000), { ...entry("again", "2026-08-14", 50000), cleared: true }],
    );
    expect(summary(result)).toEqual({ pairs: [[0, "again", "date and amount"]], missing: [], unseen: ["first"] });
    expect(unsure(result)).toEqual([]);
  });

  it("pairs within the window the company sets", () => {
    const lines = [line(0, "2026-09-12", 500)];
    const book = [entry("a", "2026-09-05", 500)];
    expect(summary(pairStatement(lines, book, 5)).pairs).toEqual([]);
    expect(summary(pairStatement(lines, book, 7)).pairs).toEqual([[0, "a", "amount, within 7 days"]]);
    expect(summary(pairStatement([line(0, "2026-09-05", 500)], book, 0)).pairs).toEqual([[0, "a", "date and amount"]]);
  });

  it("carries the window into matchStatement", () => {
    const match = matchStatement([line(0, "2026-09-12", 500)], [entry("a", "2026-09-05", 500)], "2026-09-30", 7);
    expect(match.pairs.map((p) => p.how)).toEqual(["amount, within 7 days"]);
  });
});

describe("matchStatement", () => {
  it("reads a statement whose signs run the other way, and says so", () => {
    const result = matchStatement(
      [line(0, "2026-09-05", 1200), line(1, "2026-09-09", -5000)],
      [entry("out", "2026-09-05", -1200), entry("in", "2026-09-09", 5000)],
      "2026-09-30",
    );
    expect(result.flipped).toBe(true);
    expect(result.pairs.map((p) => p.book.id)).toEqual(["out", "in"]);
  });

  it("keeps the statement as written on a tie", () => {
    const result = matchStatement([line(0, "2026-09-05", 1200)], [entry("a", "2026-09-05", 1200), entry("b", "2026-09-05", -1200)], "2026-09-30");
    expect(result.flipped).toBe(false);
    expect(result.pairs.map((p) => p.book.id)).toEqual(["a"]);
  });

  it("leaves out and counts statement lines dated after the statement date", () => {
    const result = matchStatement([line(0, "2026-09-30", 100), line(1, "2026-10-01", 200)], [entry("a", "2026-09-30", 100)], "2026-09-30");
    expect(result.ignored).toBe(1);
    expect(result.missing).toEqual([]);
    expect(result.pairs).toHaveLength(1);
  });
});

describe("cleanReference", () => {
  it("keeps letters, digits and hyphens, as the prototype does", () => {
    expect(cleanReference(" 1201 ")).toBe("1201");
    expect(cleanReference("#1201")).toBe("1201");
    expect(cleanReference("CHK-77.")).toBe("CHK-77");
    expect(cleanReference(null)).toBe("");
  });
});
