import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { balanceBreaks, glyphsFromOcrPages } from "@/lib/domain/ocr-statement";
import { readPdfStatements, rowsFromGlyphs, statementProof, type PdfGlyph } from "@/lib/domain/pdf-statement";

const dir = join(__dirname, "../fixtures/ocr");
const text = (file: string) => readFileSync(join(dir, file), "utf8");
interface Truth {
  opening: number;
  closing: number;
  lines: { date: string; amount: number; balance: number | null; check?: string | null }[];
}
const truthOf = (file: string) => JSON.parse(text(file)) as Truth;

describe("dates written with the month's name, read from OCR", () => {
  it("reads a two-page statement dated 'Oct 03' line for line", () => {
    const truth = truthOf("month-dates-2page.json");
    const pages = [
      { page: 1, text: text("month-dates-2page.p1.md") },
      { page: 2, text: text("month-dates-2page.p2.md") },
    ];
    const [s] = readPdfStatements(glyphsFromOcrPages(pages));
    expect(s.lines).toHaveLength(32);
    expect(s.lines.map((l) => [l.date, l.amountMinor, l.balanceMinor])).toEqual(
      truth.lines.map((l) => [l.date, l.amount, l.balance]),
    );
    expect(s.openingMinor).toBe(truth.opening);
    expect(s.closingMinor).toBe(truth.closing);
    expect(statementProof(s).differenceMinor).toBe(0);
    expect(balanceBreaks(s.lines, s.openingMinor)).toEqual([]);
  });

  it("reads the 17 lines of a phone photo of page 1", () => {
    const truth = truthOf("phone-photo.json");
    const [s] = readPdfStatements(glyphsFromOcrPages([{ page: 1, text: text("phone-photo.md") }]));
    expect(s.lines).toHaveLength(17);
    expect(s.lines.map((l) => [l.date, l.amountMinor, l.balanceMinor])).toEqual(
      truth.lines.map((l) => [l.date, l.amount, l.balance]),
    );
  });
});

describe("a table of checks headed 'Date paid'", () => {
  it("reads all 20 lines including the 6 checks", () => {
    const truth = truthOf("checks-paid.json");
    const [s] = readPdfStatements(glyphsFromOcrPages([{ page: 1, text: text("checks-paid.md") }]));
    expect(s.lines).toHaveLength(20);
    const key = (d: string, a: number) => `${d}|${a}`;
    expect(s.lines.map((l) => key(l.date, l.amountMinor)).sort()).toEqual(
      truth.lines.map((l) => key(l.date, l.amount)).sort(),
    );
    const checks = s.lines.filter((l) => l.checkNumber).map((l) => [l.checkNumber, l.date, l.amountMinor]);
    expect(checks).toEqual(
      truth.lines.filter((l) => l.check).map((l) => [l.check, l.date, l.amount]),
    );
    expect(checks).toHaveLength(6);
    expect(statementProof(s).differenceMinor).toBe(0);
  });
});

/** Glyphs on a grid: rows from the top, a heading, then rows of [date, description, amount, balance]. */
function grid(header: string[], period: string, rows: string[][], opening = "Beginning balance $1,000.00", closing = "Ending balance $1,000.00"): PdfGlyph[] {
  const xs = [40, 130, 360, 460];
  const out: PdfGlyph[] = [];
  const put = (y: number, cells: [number, string][]) => cells.forEach(([x, t]) => out.push({ page: 1, x, y, text: t }));
  put(760, [[40, "Example Bank"]]);
  put(745, [[40, period]]);
  put(730, [[40, "Account number: 0000-4444"]]);
  put(715, [[40, opening]]);
  put(700, [[40, closing]]);
  put(670, header.map((h, i) => [xs[i], h] as [number, string]));
  rows.forEach((r, k) => put(650 - k * 15, r.map((t, i) => [xs[i], t] as [number, string])));
  return out;
}

describe("month-name dates in a text PDF", () => {
  const head = ["Date posted", "Description", "Amount", "Balance"];
  it("reads 'Oct 3' and 'Oct 14', taking the year from the period line", () => {
    const [s] = readPdfStatements(
      grid(head, "October 1, 2026 - October 31, 2026", [
        ["Oct 3", "ACH DEPOSIT", "250.00", "1,250.00"],
        ["Oct 14", "CARD PURCHASE", "-50.00", "1,200.00"],
      ], "Beginning balance $1,000.00", "Ending balance $1,200.00"),
    );
    expect(s.lines.map((l) => [l.date, l.amountMinor, l.balanceMinor])).toEqual([
      ["2026-10-03", 25000, 125000],
      ["2026-10-14", -5000, 120000],
    ]);
  });

  it("never reads a month word in a description as the row's date", () => {
    const [s] = readPdfStatements(
      grid(head, "October 1, 2026 - October 31, 2026", [
        ["Oct 3", "MAY SUPPLIES", "-100.00", "900.00"],
        ["Oct 4", "JUNE RENT DEPOSIT", "300.00", "1,200.00"],
      ], "Beginning balance $1,000.00", "Ending balance $1,200.00"),
    );
    expect(s.lines.map((l) => [l.date, l.description])).toEqual([
      ["2026-10-03", "MAY SUPPLIES"],
      ["2026-10-04", "JUNE RENT DEPOSIT"],
    ]);
  });

  it("puts December before the new year and January in it", () => {
    const [s] = readPdfStatements(
      grid(head, "December 15, 2026 - January 14, 2027", [
        ["Dec 30", "ACH DEPOSIT", "100.00", "1,100.00"],
        ["Jan 04", "ACH DEPOSIT", "100.00", "1,200.00"],
      ], "Beginning balance $1,000.00", "Ending balance $1,200.00"),
    );
    expect(s.lines.map((l) => l.date)).toEqual(["2026-12-30", "2027-01-04"]);
  });

  it("reads the date forms a bank prints, with the cell's own year when it has one", () => {
    const forms: [string, string][] = [
      ["Oct 03", "2026-10-03"],
      ["October 3", "2026-10-03"],
      ["Oct. 3", "2026-10-03"],
      ["Oct 03, 2025", "2025-10-03"],
      ["Oct 3 2025", "2025-10-03"],
      ["03 Oct", "2026-10-03"],
      ["3 Oct 2025", "2025-10-03"],
      ["03-Oct", "2026-10-03"],
      ["3-Oct-25", "2025-10-03"],
      ["OCT 03", "2026-10-03"],
    ];
    for (const [label, iso] of forms) {
      const [s] = readPdfStatements(
        grid(head, "October 1, 2026 - October 31, 2026", [[label, "ACH DEPOSIT", "250.00", "1,250.00"]], "Beginning balance $1,000.00", "Ending balance $1,250.00"),
      );
      expect(s.lines.map((l) => l.date), label).toEqual([iso]);
    }
  });

  it("reads a month-name date joined to the words after it", () => {
    const rows = rowsFromGlyphs([{ page: 1, x: 40, y: 600, text: "Oct 03 ACH DEPOSIT" }]);
    expect(rows[0].cells.map((c) => c.text)).toEqual(["Oct 03", "ACH DEPOSIT"]);
  });

  it("does not take a figure, a page counter or a statement date for a row date", () => {
    const rows = rowsFromGlyphs([
      { page: 1, x: 40, y: 600, text: "Page 1 of 2" },
      { page: 1, x: 40, y: 580, text: "75.00 Oct" },
    ]);
    expect(rows[0].cells).toHaveLength(1);
    expect(rows[1].cells).toHaveLength(1);
    const [s] = readPdfStatements(
      grid(head, "Statement date: November 30, 2026", [["Nov 5", "ACH DEPOSIT", "250.00", "1,250.00"]], "Beginning balance $1,000.00", "Ending balance $1,250.00"),
    );
    expect(s.to).toBe("2026-11-30");
    expect(s.lines.map((l) => l.date)).toEqual(["2026-11-05"]);
  });
});

describe("date column headings", () => {
  const synonyms = [
    "Date paid", "Date posted", "Posted", "Post date", "Posting date", "Trans date",
    "Transaction date", "Effective date", "Value date", "Date cleared",
  ];
  it.each(synonyms)("takes '%s' as the date column", (name) => {
    const [s] = readPdfStatements(
      grid([name, "Description", "Amount", "Balance"], "October 1, 2026 - October 31, 2026", [["10/03", "ACH DEPOSIT", "250.00", "1,250.00"]], "Beginning balance $1,000.00", "Ending balance $1,250.00"),
    );
    expect(s.lines.map((l) => l.date)).toEqual(["2026-10-03"]);
  });
});
