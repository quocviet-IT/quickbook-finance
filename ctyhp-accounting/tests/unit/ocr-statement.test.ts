import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  balanceBreaks,
  glyphsFromOcrPages,
  ocrResultSchema,
  OCR_MAX_PAGES,
} from "@/lib/domain/ocr-statement";
import { readPdfStatements, rowsFromGlyphs, statementProof } from "@/lib/domain/pdf-statement";

const dir = join(__dirname, "../fixtures/ocr");
const truth = JSON.parse(readFileSync(join(dir, "made-up-statement.json"), "utf8")) as {
  rows: { date: string; amount: string; kind: "deposit" | "withdrawal"; balance: string }[];
  summary: { beginning: string; ending: string };
};
const cents = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
const page = (file: string) => ({ page: 1, text: readFileSync(join(dir, file), "utf8") });

describe("glyphsFromOcrPages", () => {
  it("lays table cells on a grid wide enough for the column rules", () => {
    const glyphs = glyphsFromOcrPages([
      { page: 1, text: "<table><tr><td>Date</td><td>Description</td><td>Balance</td></tr><tr><td>10/02/2026</td><td>FEE</td><td>1.00</td></tr></table>" },
    ]);
    const rows = rowsFromGlyphs(glyphs);
    expect(rows.map((r) => r.text)).toEqual(["Date Description Balance", "10/02/2026 FEE 1.00"]);
    const xs = rows[0].cells.map((c) => c.x);
    expect(xs[1] - xs[0]).toBeGreaterThan(140);
  });

  it("drops the layout tags and keeps the words", () => {
    const glyphs = glyphsFromOcrPages([{ page: 1, text: "<|ref|>title<|/ref|><|det|>[[1,2,3,4]]<|/det|>EXAMPLE BANK\n<|det|>text [5,6,7,8]<|/det|>Page 1 of 1" }]);
    expect(rowsFromGlyphs(glyphs).map((r) => r.text)).toEqual(["EXAMPLE BANK", "Page 1 of 1"]);
  });

  it("keeps a colspan in its columns and decodes entities", () => {
    const glyphs = glyphsFromOcrPages([{ page: 1, text: '<table><tr><td colspan="2">A &amp; B</td><td>C</td></tr></table>' }]);
    const [row] = rowsFromGlyphs(glyphs);
    expect(row.text).toBe("A & B C");
    expect(row.cells[1].x - row.cells[0].x).toBeGreaterThan(290);
  });

  it("leaves an out-of-range numeric entity as it was", () => {
    const run = () => glyphsFromOcrPages([{ page: 1, text: "A &#x110000; B &#99999999; C" }]);
    expect(run).not.toThrow();
    expect(rowsFromGlyphs(run())[0].text).toBe("A &#x110000; B &#99999999; C");
  });

  it("keeps the columns a rowspan still holds in the rows below", () => {
    const glyphs = glyphsFromOcrPages([
      { page: 1, text: '<table><tr><td rowspan="2">10/02/2026</td><td>A</td><td>1.00</td></tr><tr><td>B</td><td>2.00</td></tr></table>' },
    ]);
    const x = (t: string) => glyphs.find((g) => g.text === t)!.x;
    expect(x("B")).toBe(x("A"));
    expect(x("2.00")).toBe(x("1.00"));
  });

  it("orders pages one after another", () => {
    const glyphs = glyphsFromOcrPages([{ page: 2, text: "second" }, { page: 1, text: "first" }]);
    expect(rowsFromGlyphs(glyphs).map((r) => r.text)).toEqual(["first", "second"]);
  });
});

describe.each(["made-up-statement-clean.md", "made-up-statement-poor.md"])("the made-up statement read by OCR (%s)", (file) => {
  const statements = readPdfStatements(glyphsFromOcrPages([page(file)]));
  const s = statements.find((x) => x.lines.length) ?? null;

  it("is read as one statement with every line", () => {
    expect(s).not.toBeNull();
    expect(s!.lines).toHaveLength(14);
  });

  it("reads every amount the right way round and every balance", () => {
    expect(s!.lines.map((l) => l.amountMinor)).toEqual(
      truth.rows.map((r) => (r.kind === "deposit" ? 1 : -1) * cents(r.amount)),
    );
    expect(s!.lines.map((l) => l.balanceMinor)).toEqual(truth.rows.map((r) => cents(r.balance)));
  });

  it("adds up: opening plus the lines is the closing balance", () => {
    expect(s!.openingMinor).toBe(cents(truth.summary.beginning));
    expect(s!.closingMinor).toBe(cents(truth.summary.ending));
    expect(statementProof(s!).differenceMinor).toBe(0);
    expect(balanceBreaks(s!.lines, s!.openingMinor)).toEqual([]);
  });
});

describe("balanceBreaks", () => {
  const line = (amountMinor: number, balanceMinor: number | null) =>
    ({ date: "2026-10-01", description: "x", checkNumber: null, amountMinor, balanceMinor, raw: "x" });

  it("names the line whose balance does not follow from the one before", () => {
    expect(balanceBreaks([line(100, 1100), line(-50, 1080), line(10, 1090)], 1000)).toEqual([1]);
  });

  it("checks the first line against the opening, and skips lines with no balance", () => {
    expect(balanceBreaks([line(100, 1200), line(5, null), line(5, 1210)], 1000)).toEqual([0]);
  });
});

describe("balanceBreaks across lines with no printed balance", () => {
  const line = (amountMinor: number, balanceMinor: number | null) =>
    ({ date: "2026-10-01", description: "x", checkNumber: null, amountMinor, balanceMinor, raw: "x" });

  it("carries the balance over a line that prints none", () => {
    expect(balanceBreaks([line(100, 1100), line(-50, null), line(10, 1060)], 1000)).toEqual([]);
    expect(balanceBreaks([line(100, 1100), line(-50, null), line(10, 1070)], 1000)).toEqual([2]);
  });
});

describe("ocrResultSchema", () => {
  it("accepts the worker's answer and refuses too many pages", () => {
    expect(ocrResultSchema.safeParse({ engine: "e", pages: [{ page: 1, text: "t" }] }).success).toBe(true);
    expect(ocrResultSchema.safeParse({ engine: "e", pages: [{ page: 1, text: "t".repeat(100_001) }] }).success).toBe(false);
    const many = Array.from({ length: OCR_MAX_PAGES + 1 }, (_, i) => ({ page: i + 1, text: "t" }));
    expect(ocrResultSchema.safeParse({ engine: "e", pages: many }).success).toBe(false);
  });
});
