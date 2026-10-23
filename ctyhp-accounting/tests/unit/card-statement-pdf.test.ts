import { jsPDF } from "jspdf";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { glyphsFromDocument } from "@/lib/domain/pdf-glyphs";
import { rowsFromGlyphs, type PdfRow } from "@/lib/domain/pdf-statement";
import { CARD_SUMMARY_PROBLEMS, cardSummaryProblem, readCardStatementSummary } from "@/lib/domain/card-statement-pdf";
import { RUN_MESSAGES, cardRunStatement } from "@/lib/domain/statement-run";

/**
 * 2.46: a credit card statement's PDF, read for its summary only. The rows
 * follow the layout of the card issuer's own published sample statement — the
 * same labels, a sign printed in a cell of its own — with invented figures.
 */
const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;
const row = (...cells: [number, string][]): PdfRow => ({
  cells: cells.map(([x, text]) => ({ x, text })),
  text: cells.map(([, text]) => text).join(" "),
});

/** Page one of a card statement: the rewards box first, then the account summary, then the coupon. */
const SUMMARY_PAGE: PdfRow[] = [
  row([148, "New Balance"], [270, "REWARDS SUMMARY"]),
  row([148, "$1,076.00"]),
  row([277, "Previous points balance"], [482, "1,200"]),
  row([148, "Minimum Payment Due"]),
  row([277, "Points earned on purchases"], [496, "576"]),
  row([148, "$35.00"]),
  row([148, "Payment Due Date"]),
  row([148, "10/25/2026"]),
  row([15, "ACCOUNT SUMMARY"]),
  row([26, "Account Number: XXXX XXXX XXXX 4321"]),
  row([26, "Previous Balance"], [210, "$1,000.00"]),
  row([26, "Payment, Credits"], [203, "-"], [221, "$500.00"]),
  row([26, "Purchases"], [202, "+"], [222, "$556.00"]),
  row([26, "Cash Advances"], [226, "$0.00"]),
  row([26, "Balance Transfers"], [226, "$0.00"]),
  row([26, "Fees Charged"], [222, "$20.00"]),
  row([26, "Interest Charged"], [226, "$0.00"]),
  row([26, "New Balance"], [210, "$1,076.00"]),
  row([26, "Opening/Closing Date"], [174, "08/30/26"], [174.01, "- 09/29/26"]),
  row([26, "Credit Limit"], [210, "$5,000.00"]),
  row([26, "Available Credit"], [210, "$3,924.00"]),
  row([26, "Past Due Amount"], [226, "$0.00"]),
  row([20, "Payment Due Date: 10/25/26"]),
  row([20, "New Balance: $1,076.00"]),
];

describe("reading a card statement's summary", () => {
  it("reads its cycle, previous and new balance, parts and card, and finds that it adds up", () => {
    expect(readCardStatementSummary(SUMMARY_PAGE)).toEqual({
      from: "2026-08-30",
      to: "2026-09-29",
      previousMinor: 100000,
      newMinor: 107600,
      parts: { paymentsCredits: 50000, purchases: 55600, cashAdvances: 0, balanceTransfers: 0, fees: 2000, interest: 0 },
      accountLast4: "4321",
      outByMinor: 0,
    });
  });

  it("is not fooled by the rewards box's New Balance with no figure, or the points earned on purchases", () => {
    const summary = readCardStatementSummary(SUMMARY_PAGE)!;
    expect(summary.newMinor).toBe(107600);
    expect(summary.parts.purchases).toBe(55600);
  });

  it("says when the summary does not add up, and refuses it", () => {
    const misread = SUMMARY_PAGE.map((r) => (r.text.startsWith("Fees Charged") ? row([26, "Fees Charged"], [222, "$25.00"]) : r));
    const summary = readCardStatementSummary(misread)!;
    expect(summary.outByMinor).toBe(-500);
    expect(cardSummaryProblem(summary, money)).toBe(CARD_SUMMARY_PROBLEMS.doesNotAddUp("$5.00"));
  });

  it("reads a credit balance as negative, and a four-digit year", () => {
    const credit = [
      row([26, "Previous Balance"], [210, "$20.00"]),
      row([26, "Payment, Credits"], [203, "-"], [221, "$32.00"]),
      row([26, "New Balance"], [210, "-$12.00"]),
      row([26, "Opening/Closing Date"], [174, "12/15/2025 - 01/14/2026"]),
      row([26, "Credit Limit"], [210, "$5,000.00"]),
    ];
    expect(readCardStatementSummary(credit)).toMatchObject({ from: "2025-12-15", to: "2026-01-14", previousMinor: 2000, newMinor: -1200, outByMinor: null });
  });

  it("reads a closing date printed on its own", () => {
    const rows = [
      row([26, "Previous Balance"], [210, "$0.00"]),
      row([26, "New Balance"], [210, "$45.00"]),
      row([26, "Statement Closing Date: 09/29/2026"]),
      row([26, "Minimum Payment Due"], [210, "$25.00"]),
    ];
    expect(readCardStatementSummary(rows)).toMatchObject({ from: null, to: "2026-09-29" });
  });

  it("is not a card statement without a credit limit or minimum payment, nor without its balances", () => {
    const bank = [row([26, "Beginning Balance"], [210, "$1,000.00"]), row([26, "Ending Balance"], [210, "$900.00"])];
    expect(readCardStatementSummary(bank)).toBeNull();
    expect(readCardStatementSummary([row([26, "Previous Balance"], [210, "$1,000.00"]), row([26, "New Balance"], [210, "$900.00"])])).toBeNull();
    expect(readCardStatementSummary([row([26, "Credit Limit"], [210, "$5,000.00"])])).toBeNull();
  });

  it("says what is missing before a month can be proved", () => {
    const base = readCardStatementSummary(SUMMARY_PAGE)!;
    expect(cardSummaryProblem(base, money)).toBeNull();
    expect(cardSummaryProblem({ ...base, newMinor: null }, money)).toBe(CARD_SUMMARY_PROBLEMS.noNewBalance);
    expect(cardSummaryProblem({ ...base, previousMinor: null }, money)).toBe(CARD_SUMMARY_PROBLEMS.noPreviousBalance);
    expect(cardSummaryProblem({ ...base, to: null }, money)).toBe(CARD_SUMMARY_PROBLEMS.noClosingDate);
  });
});

describe("a card statement as one statement of a run", () => {
  const summary = readCardStatementSummary(SUMMARY_PAGE)!;

  it("carries its balances as printed and no lines", () => {
    expect(cardRunStatement("2026-09.pdf", summary, "****4321", money)).toEqual({
      key: "2026-09.pdf#card",
      fileName: "2026-09.pdf",
      source: "PDF",
      from: "2026-08-30",
      to: "2026-09-29",
      openingMinor: 100000,
      closingMinor: 107600,
      lines: [],
      problem: null,
      outByMinor: null,
      openingBasis: "printed",
      closingBasis: "printed",
      balancesOnly: true,
    });
  });

  it("is marked when it is another card's, or when its summary cannot prove a month", () => {
    expect(cardRunStatement("x.pdf", summary, "****9999", money).problem).toBe(RUN_MESSAGES.notThisAccount);
    expect(cardRunStatement("x.pdf", { ...summary, to: null }, "****4321", money).problem).toBe(CARD_SUMMARY_PROBLEMS.noClosingDate);
  });
});

describe("a card statement read end to end through pdf.js", () => {
  it("reads the summary of a printed PDF, the sign in a cell of its own", async () => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    doc.setFontSize(9);
    SUMMARY_PAGE.forEach((r, i) => {
      for (const cell of r.cells) doc.text(cell.text, cell.x + 20, 60 + i * 14);
    });
    const task = getDocument({ data: new Uint8Array(doc.output("arraybuffer")), verbosity: 0 });
    try {
      const glyphs = await glyphsFromDocument(await task.promise);
      expect(readCardStatementSummary(rowsFromGlyphs(glyphs))).toMatchObject({
        from: "2026-08-30",
        to: "2026-09-29",
        previousMinor: 100000,
        newMinor: 107600,
        accountLast4: "4321",
        outByMinor: 0,
      });
    } finally {
      await task.destroy();
    }
  }, 20_000);
});
