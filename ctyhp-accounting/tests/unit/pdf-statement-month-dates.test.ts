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

/** Glyphs for a free layout: header columns at xs, then rows of cells at the same xs. */
function table(xs: number[], header: string[], rows: string[][], period = "October 1, 2026 - October 31, 2026"): PdfGlyph[] {
  const out: PdfGlyph[] = [];
  const put = (y: number, cells: string[]) => cells.forEach((t, i) => t && out.push({ page: 1, x: xs[i], y, text: t }));
  out.push({ page: 1, x: 40, y: 760, text: "Example Bank" }, { page: 1, x: 40, y: 745, text: period });
  out.push({ page: 1, x: 40, y: 730, text: "Account number: 0000-4444" });
  out.push({ page: 1, x: 40, y: 715, text: "Beginning balance $1,000.00" }, { page: 1, x: 40, y: 700, text: "Ending balance $1,200.00" });
  put(670, header);
  rows.forEach((r, k) => put(650 - k * 15, r));
  return out;
}

describe("a month and a number at the start of a description", () => {
  it("is not split off as a date when the date column is first", () => {
    const [s] = readPdfStatements(
      grid(["Date", "Description", "Amount", "Balance"], "October 1, 2026 - October 31, 2026", [
        ["Oct 3", "MAR 15 PAYMENT", "120.00", "5,120.00"],
      ], "Beginning balance $5,000.00", "Ending balance $5,120.00"),
    );
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].date).toBe("2026-10-03");
    expect(s.lines[0].description).toContain("MAR 15 PAYMENT");
  });

  it("does not steal the date when the date column is not first", () => {
    const [s] = readPdfStatements(
      table([40, 130, 300, 400], ["Check No.", "Date paid", "Description", "Amount"], [
        ["1001", "Oct 3", "MAR 15 PAYMENT", "-120.00"],
        ["1002", "Oct 9", "MAY 2 SUPPLIES", "-80.00"],
      ]),
    );
    expect(s.lines.map((l) => [l.date, l.amountMinor])).toEqual([
      ["2026-10-03", -12000],
      ["2026-10-09", -8000],
    ]);
  });

  it("splits only the leftmost cell of a row", () => {
    const rows = rowsFromGlyphs([
      { page: 1, x: 40, y: 600, text: "1001" },
      { page: 1, x: 130, y: 600, text: "MAR 15 PAYMENT" },
    ]);
    expect(rows[0].cells.map((c) => c.text)).toEqual(["1001", "MAR 15 PAYMENT"]);
  });
});

describe("repeated date headings", () => {
  it("keeps both columns of a two-up 'Date paid' table", () => {
    const [s] = readPdfStatements(
      table([40, 110, 180, 300, 370, 440], ["Check No.", "Date paid", "Amount", "Check No.", "Date paid", "Amount"], [
        ["1001", "10/03", "120.00", "1004", "10/05", "40.00"],
        ["1002", "10/04", "80.00", "1005", "10/07", "60.00"],
      ]),
    );
    expect(s.lines.map((l) => [l.date, Math.abs(l.amountMinor)]).sort()).toEqual([
      ["2026-10-03", 12000],
      ["2026-10-04", 8000],
      ["2026-10-05", 4000],
      ["2026-10-07", 6000],
    ]);
  });

  it("does not make a grid of 'Trans date' beside 'Post date'", () => {
    const [s] = readPdfStatements(
      table([40, 110, 180, 360, 460], ["Trans date", "Post date", "Description", "Amount", "Balance"], [
        ["10/02", "10/03", "ACH DEPOSIT", "250.00", "1,250.00"],
        ["10/04", "10/05", "CARD PURCHASE", "-50.00", "1,200.00"],
      ]),
    );
    expect(s.lines.map((l) => [l.date, l.amountMinor])).toEqual([
      ["2026-10-02", 25000],
      ["2026-10-04", -5000],
    ]);
  });
});

describe("a printed year never swallows what follows the date", () => {
  const head = ["Date", "Description", "Amount", "Balance"];
  const period = "October 1, 2026 - October 31, 2026";
  it("keeps the amount glued after the day: 'Oct 10 2000.00'", () => {
    const glyphs = grid(head, period, [], "Beginning balance $1,000.00", "Ending balance $3,000.00");
    glyphs.push({ page: 1, x: 40, y: 650, text: "Oct 10 2000.00" }, { page: 1, x: 130, y: 650, text: "ACH DEPOSIT" }, { page: 1, x: 460, y: 650, text: "3,000.00" });
    const [s] = readPdfStatements(glyphs);
    expect(s.lines.map((l) => [l.date, l.amountMinor])).toEqual([["2026-10-10", 200000]]);
  });
  it("ignores a year far from the period: 'Oct 03 2015 PAYMENT'", () => {
    const glyphs = grid(head, period, [], "Beginning balance $1,000.00", "Ending balance $1,250.00");
    glyphs.push({ page: 1, x: 40, y: 650, text: "Oct 03 2015 PAYMENT" }, { page: 1, x: 360, y: 650, text: "250.00" }, { page: 1, x: 460, y: 650, text: "1,250.00" });
    const [s] = readPdfStatements(glyphs);
    expect(s.lines.map((l) => l.date)).toEqual(["2026-10-03"]);
    expect(s.lines[0].description).toContain("2015 PAYMENT");
  });
  it("still reads a printed year close to the period", () => {
    const [s] = readPdfStatements(
      grid(head, period, [["Oct 3, 2026", "ACH DEPOSIT", "250.00", "1,250.00"]], "Beginning balance $1,000.00", "Ending balance $1,250.00"),
    );
    expect(s.lines.map((l) => l.date)).toEqual(["2026-10-03"]);
  });
  it("still reads Dec 30, 2026 and Jan 04, 2027 on a year-end period", () => {
    const [s] = readPdfStatements(
      grid(head, "December 15, 2026 - January 14, 2027", [
        ["Dec 30, 2026", "ACH DEPOSIT", "100.00", "1,100.00"],
        ["Jan 04, 2027", "ACH DEPOSIT", "100.00", "1,200.00"],
      ], "Beginning balance $1,000.00", "Ending balance $1,200.00"),
    );
    expect(s.lines.map((l) => l.date)).toEqual(["2026-12-30", "2027-01-04"]);
  });
});
