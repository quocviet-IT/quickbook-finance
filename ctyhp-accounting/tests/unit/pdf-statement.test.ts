import { describe, expect, it } from "vitest";
import {
  moneyMinor,
  readPdfStatements,
  readPeriod,
  rowsFromGlyphs,
  statementProof,
  toStatementLines,
  type PdfStatement,
} from "@/lib/domain/pdf-statement";
import { PDF_SCENARIOS, glyphsOf } from "../fixtures/pdf-statements";

const compact = (s: PdfStatement) => ({
  account: s.accountNumber,
  from: s.from,
  to: s.to,
  opening: s.openingMinor,
  closing: s.closingMinor,
  skipped: s.skipped,
  lines: s.lines.map((l) => [l.date, l.amountMinor, l.description, l.checkNumber, l.balanceMinor]),
});

describe("readPdfStatements", () => {
  it.each(PDF_SCENARIOS.map((s) => [s.name, s] as const))("%s", (_name, scenario) => {
    const statements = readPdfStatements(glyphsOf(scenario));
    expect(statements.map(compact)).toEqual(scenario.expected);
    for (const s of statements) expect(statementProof(s).differenceMinor).toBe(0);
  });

  it("reads nothing out of no glyphs", () => {
    expect(readPdfStatements([])).toEqual([]);
  });
});

describe("moneyMinor", () => {
  it.each([
    ["1,234.56", 123456],
    ["$1,234.56", 123456],
    ["(12.50)", -1250],
    ["-40.00", -4000],
    ["40.00-", -4000],
    ["0.00", 0],
    ["-0.00", 0],
    ["1101", null],
    ["12.5", null],
    ["", null],
  ] as const)("%s", (text, minor) => {
    expect(moneyMinor(text)).toBe(minor);
  });
});

describe("readPeriod", () => {
  it.each([
    ["Statement period Jan 1 - Jan 31, 2026", { from: "2026-01-01", to: "2026-01-31" }],
    ["Statement period Dec 15, 2025 - Jan 14, 2026", { from: "2025-12-15", to: "2026-01-14" }],
    ["Statement period Dec 15 - Jan 14, 2026", { from: "2025-12-15", to: "2026-01-14" }],
    ["Statement period: 01/01/2026 - 01/31/2026", { from: "2026-01-01", to: "2026-01-31" }],
    ["September 30, 2026\nBeginning balance on 9/1\nEnding balance on 9/30", { from: "2026-09-01", to: "2026-09-30" }],
    ["Statement date: November 30, 2026", { from: "", to: "2026-11-30" }],
    ["As of Nov 30, 2026", { from: "", to: "2026-11-30" }],
    ["Statement date: 11/30/2026", { from: "", to: "2026-11-30" }],
    ["No dates here", { from: "", to: "" }],
  ] as const)("%s", (text, period) => {
    expect(readPeriod(text)).toEqual(period);
  });
});

describe("rowsFromGlyphs", () => {
  it("reads each page top to bottom, one row per baseline, left to right, without blank pieces", () => {
    const rows = rowsFromGlyphs([
      { page: 2, x: 40, y: 760, text: "second page" },
      { page: 1, x: 300, y: 700.4, text: "right" },
      { page: 1, x: 40, y: 699.6, text: "left" },
      { page: 1, x: 40, y: 760, text: "top" },
      { page: 1, x: 90, y: 760, text: "  " },
    ]);
    expect(rows.map((r) => r.text)).toEqual(["top", "left right", "second page"]);
  });

  it("reads a date joined to the words after it as the date and the words", () => {
    const [row] = rowsFromGlyphs([{ page: 1, x: 40, y: 700, text: "03/14 EXAMPLE CLIENT DEPOSIT" }]);
    expect(row.cells.map((c) => c.text)).toEqual(["03/14", "EXAMPLE CLIENT DEPOSIT"]);
  });

  it("does not split a figure or words that only look like they start with a date", () => {
    const [row] = rowsFromGlyphs([
      { page: 1, x: 40, y: 700, text: "75.00 EXAMPLE" },
      { page: 1, x: 200, y: 700, text: "Total 3/4" },
    ]);
    expect(row.cells.map((c) => c.text)).toEqual(["75.00 EXAMPLE", "Total 3/4"]);
  });
});

describe("toStatementLines", () => {
  it("hands Import statement the lines, the cheque number as the reference", () => {
    const [statement] = readPdfStatements(glyphsOf(PDF_SCENARIOS.find((s) => s.name === "chequesRestated")!));
    expect(toStatementLines(statement)[0]).toEqual({
      txn_date: "2026-05-04",
      description: "Check 2001",
      reference: "2001",
      amount_minor: -4500,
      running_balance_minor: 75500,
      raw_line: "05/04 Check 2001 45.00 755.00",
      external_id: null,
    });
  });
});
