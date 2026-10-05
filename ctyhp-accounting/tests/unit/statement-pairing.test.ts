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
