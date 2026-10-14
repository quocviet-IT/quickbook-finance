import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { readPdfStatements, toStatementLines, type PdfStatement } from "@/lib/domain/pdf-statement";
import { parseOfx, parseQif } from "@/lib/domain/statement-files";
import { parseStatementRows, type StatementLine } from "@/lib/domain/statement-import";
import {
  PROOF_REFUSAL,
  PROOF_TEXT,
  dayAfter,
  fileFigures,
  importLinesLabel,
  openingBasisWords,
  pdfFigures,
  plainAmount,
  priorOfferLabel,
  proofPayload,
  proofRefusal,
  proveStatement,
  proveStatementPayload,
  sentWithoutProof,
  statementImportRows,
  statementProofPayloadSchema,
  type StatementProofPayload,
} from "@/lib/domain/statement-proof";
import { PDF_SCENARIOS, glyphsOf } from "../fixtures/pdf-statements";

/**
 * Proving a statement against the balances it prints (2.04). Every bank,
 * account, name and amount here is invented.
 */
const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

const pdfOf = (name: string): PdfStatement => {
  const scenario = PDF_SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`no scenario ${name}`);
  return readPdfStatements(glyphsOf(scenario))[0];
};
const line = (txn_date: string, amount_minor: number, description = "EXAMPLE LINE", running_balance_minor: number | null = null): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor,
  raw_line: `${txn_date},${description},${amount_minor}`,
});
const csv = (text: string) => parseStatementRows(parseCsv(text)).rows;

describe("a PDF", () => {
  it("proves itself by the balances it prints", () => {
    const pdf = pdfOf("debitCreditColumns");
    const proof = proveStatement({ kind: "pdf", lines: toStatementLines(pdf), figures: pdfFigures(pdf) }, money);
    expect(proof).toMatchObject({
      openingMinor: 100000,
      closingMinor: 118000,
      openingBasis: "printed",
      closingBasis: "printed",
      linesMinor: 18000,
      lineCount: 3,
      setAside: 0,
      differenceMinor: 0,
      proves: true,
      missing: null,
      chainBreak: null,
      hint: null,
    });
    expect(proof.sentences).toEqual({
      summary: "Opening $1,000.00 (printed) + 3 lines $180.00 = $1,180.00, the closing balance the statement prints ✓",
      detail: null,
      blocked: null,
      usePrior: null,
      openingBasis: "printed",
    });
  });

  it("proves itself by its running balances when it prints no totals, and says so", () => {
    const pdf = pdfOf("missingTotals");
    expect([pdf.openingBasis, pdf.closingBasis]).toEqual(["running", "running"]);
    const proof = proveStatement({ kind: "pdf", lines: toStatementLines(pdf), figures: pdfFigures(pdf) }, money);
    expect(proof).toMatchObject({ openingBasis: "running", closingBasis: "running", proves: true });
    expect(proof.sentences.summary).toBe(
      "Opening $1,000.00 (from the running balance) + 2 lines $180.00 = $1,180.00, the closing balance the statement prints ✓",
    );
  });

  it("says money out with a minus sign", () => {
    const pdf = pdfOf("signedAmount");
    const proof = proveStatement({ kind: "pdf", lines: toStatementLines(pdf), figures: pdfFigures(pdf) }, money);
    expect(proof.sentences.summary).toBe(
      "Opening $2,000.00 (printed) + 3 lines −$302.50 = $1,697.50, the closing balance the statement prints ✓",
    );
  });

  describe("with a misread line", () => {
    const pdf = pdfOf("debitCreditColumns");
    const misread = line("2026-01-12", -36000, "CHECK IMAGE 0042");
    const lines = [...toStatementLines(pdf), misread];

    it("is out, says by how much, names the one line it is out by, and is blocked", () => {
      const proof = proveStatement({ kind: "pdf", lines, figures: pdfFigures(pdf) }, money);
      expect(proof).toMatchObject({ proves: false, differenceMinor: -36000, linesMinor: -18000, lineCount: 4, hint: { index: 3 } });
      expect(proof.sentences.summary).toBe(
        "Out by $360.00. The opening $1,000.00 and the 4 lines come to $820.00; the statement closes at $1,180.00.",
      );
      expect(proof.sentences.detail).toBe(
        "It equals the statement line “CHECK IMAGE 0042” of Jan 12, 2026 (−360.00), which may have been misread. " +
          "Mark it Not a transaction if it is not one.",
      );
      expect(proof.sentences.blocked).toBe("Import is blocked until the statement adds up.");
    });

    it("adds up once that line is marked Not a transaction, which is neither counted nor imported", () => {
      const proof = proveStatement({ kind: "pdf", lines, figures: pdfFigures(pdf), aside: [3] }, money);
      expect(proof).toMatchObject({ proves: true, lineCount: 3, setAside: 1, linesMinor: 18000, hint: null });
      expect(proof.sentences.summary).toBe(
        "Opening $1,000.00 (printed) + 3 lines $180.00 = $1,180.00, the closing balance the statement prints ✓",
      );
      expect(statementImportRows(lines, [3])).toHaveLength(3);
    });

    it("names no line when two lines are the amount it is out by", () => {
      const twice = [...lines, line("2026-01-13", -36000, "CHECK IMAGE 0043")];
      const proof = proveStatement({ kind: "pdf", lines: twice, figures: { ...pdfFigures(pdf), closingMinor: 118000 - 36000 } }, money);
      expect(proof.differenceMinor).toBe(-36000);
      expect(proof.hint).toBeNull();
      expect(proof.sentences.detail).toBeNull();
    });

    it("names a line only when leaving it out would make the statement add up, sign and all", () => {
      const deposit = line("2026-01-12", 36000, "EXAMPLE DEPOSIT");
      const proof = proveStatement({ kind: "pdf", lines: [...toStatementLines(pdf), deposit], figures: pdfFigures(pdf) }, money);
      expect(proof.differenceMinor).toBe(36000);
      expect(proof.hint?.index).toBe(3);
      // Out by 360.00 the other way: leaving the 360.00 payment out would put it out by 720.00.
      const otherWay = proveStatement({ kind: "pdf", lines, figures: { ...pdfFigures(pdf), closingMinor: 46000 } }, money);
      expect(otherWay.differenceMinor).toBe(36000);
      expect(otherWay.hint).toBeNull();
    });
  });
});

describe("a CSV", () => {
  const chained = [
    "Date,Description,Amount,Balance",
    "03/02/2026,EXAMPLE DEPOSIT,1000.00,11000.00",
    "03/14/2026,EXAMPLE SUPPLIES,-412.30,10587.70",
    "03/20/2026,EXAMPLE FEE,-100.00,10487.70",
  ].join("\n");

  it("proves itself by its running balances: its first balance less its first line, and its last balance", () => {
    const proof = proveStatement({ kind: "csv", lines: csv(chained) }, money);
    expect(proof).toMatchObject({ openingMinor: 1000000, closingMinor: 1048770, openingBasis: "running", closingBasis: "running", proves: true });
    expect(proof.sentences.summary).toBe(
      "Opening $10,000.00 (from the running balance) + 3 lines $487.70 = $10,487.70, the closing balance the statement prints ✓",
    );
  });

  it("is read oldest first when the file lists the newest first", () => {
    const [heading, ...rows] = chained.split("\n");
    const newestFirst = [heading, ...rows.reverse()].join("\n");
    expect(proveStatement({ kind: "csv", lines: csv(newestFirst) }, money)).toMatchObject({
      openingMinor: 1000000,
      closingMinor: 1048770,
      proves: true,
    });
  });

  it("names where the balance jumps when a line is missing", () => {
    const missingLine = chained.replace("10487.70", "10437.70");
    const lines = csv(missingLine);
    const proof = proveStatement({ kind: "csv", lines }, money);
    expect(proof).toMatchObject({ proves: false, differenceMinor: 5000, chainBreak: { index: 1 } });
    expect(lines[proof.chainBreak!.index].txn_date).toBe("2026-03-14");
    expect(proof.sentences.summary).toBe(
      "Out by $50.00. The opening $10,000.00 and the 3 lines come to $10,487.70; the statement closes at $10,437.70.",
    );
    expect(proof.sentences.detail).toBe("The balance jumps after the line of Mar 14, 2026 (−412.30).");
  });

  it("finds the same jump in a file listed newest first", () => {
    const [heading, ...rows] = chained.replace("10487.70", "10437.70").split("\n");
    const lines = csv([heading, ...rows.reverse()].join("\n"));
    const proof = proveStatement({ kind: "csv", lines }, money);
    expect(lines[proof.chainBreak!.index].txn_date).toBe("2026-03-14");
    expect(proof.sentences.detail).toBe("The balance jumps after the line of Mar 14, 2026 (−412.30).");
  });

  it("follows the balances across lines that print none", () => {
    const sparse = [line("2026-03-02", 1000, "A", 11000), line("2026-03-03", -200, "B"), line("2026-03-04", -300, "C", 10500)];
    expect(proveStatement({ kind: "csv", lines: sparse }, money)).toMatchObject({ openingMinor: 10000, closingMinor: 10500, proves: true });
    const jumped = [line("2026-03-02", 1000, "A", 11000), line("2026-03-03", -200, "B"), line("2026-03-04", -300, "C", 10400)];
    const proof = proveStatement({ kind: "csv", lines: jumped }, money);
    expect(proof.chainBreak?.index).toBe(0);
    expect(proof.sentences.detail).toBe("The balance jumps after the line of Mar 2, 2026 (10.00).");
  });

  it("takes no closing from a last line that prints no balance", () => {
    const proof = proveStatement({ kind: "csv", lines: [line("2026-03-02", 1000, "A", 11000), line("2026-03-03", -200, "B")] }, money);
    expect(proof).toMatchObject({ openingMinor: 10000, closingMinor: null, missing: "closing", proves: false });
  });

  describe("without a balance column", () => {
    const plain = csv(["Date,Description,Amount", "03/02/2026,EXAMPLE DEPOSIT,1000.00", "03/14/2026,EXAMPLE SUPPLIES,-412.30"].join("\n"));

    it("cannot prove itself: both balances are missing, and it is blocked", () => {
      const proof = proveStatement({ kind: "csv", lines: plain }, money);
      expect(proof).toMatchObject({ openingMinor: null, closingMinor: null, missing: "both", differenceMinor: null, proves: false });
      expect(proof.sentences).toMatchObject({ summary: null, detail: null, blocked: "Import is blocked until the statement adds up." });
    });

    it("proves itself with the balances typed from the statement", () => {
      const proof = proveStatement({ kind: "csv", lines: plain, typedOpeningMinor: 500000, typedClosingMinor: 558770 }, money);
      expect(proof).toMatchObject({ openingBasis: "typed", closingBasis: "typed", proves: true });
      expect(proof.sentences.summary).toBe(
        "Opening $5,000.00 (typed) + 2 lines $587.70 = $5,587.70, the closing balance the statement prints ✓",
      );
    });

    it("says which balance is still missing", () => {
      expect(proveStatement({ kind: "csv", lines: plain, typedOpeningMinor: 500000 }, money).missing).toBe("closing");
      expect(proveStatement({ kind: "csv", lines: plain, typedClosingMinor: 500000 }, money).missing).toBe("opening");
    });
  });

  it("never lets a typed balance stand in for one the file gives", () => {
    const proof = proveStatement({ kind: "csv", lines: csv(chained), typedOpeningMinor: 1, typedClosingMinor: 2 }, money);
    expect(proof).toMatchObject({ openingMinor: 1000000, closingMinor: 1048770, openingBasis: "running", closingBasis: "running" });
  });
});

describe("an OFX", () => {
  const ofx = (ledger: string, list = "<DTSTART>20260901<DTEND>20260930") => `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>000000000<ACCTID>00004444<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
${list}
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260904<TRNAMT>250.00<FITID>E-1<NAME>EXAMPLE CUSTOMER</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260921<TRNAMT>-40.00<FITID>E-2<NAME>EXAMPLE FEE</STMTTRN>
</BANKTRANLIST>
${ledger}
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const prior = { date: "2026-08-31", endingMinor: 100000 };

  it("closes at its LEDGERBAL as of the end date, and opens at the last reconciliation's closing when it starts the day after", () => {
    const read = parseOfx(ofx("<LEDGERBAL><BALAMT>1210.00<DTASOF>20260930235959.000[-5:EST]</LEDGERBAL>"));
    const proof = proveStatement({ kind: "ofx", lines: read.rows, figures: fileFigures(read), prior }, money);
    expect(proof).toMatchObject({
      openingMinor: 100000,
      openingBasis: "prior",
      closingMinor: 121000,
      closingBasis: "ledger",
      proves: true,
      prior: { status: "auto", date: "2026-08-31", endingMinor: 100000 },
    });
    expect(proof.sentences.summary).toBe(
      "Opening $1,000.00 (from the reconciliation to Aug 31, 2026) + 2 lines $210.00 = $1,210.00, the closing balance the statement prints ✓",
    );
    expect(proof.sentences.usePrior).toBeNull();
  });

  it("does not use a LEDGERBAL as of a later day: it can hold lines the file does not", () => {
    const read = parseOfx(ofx("<LEDGERBAL><BALAMT>1100.00<DTASOF>20261005</LEDGERBAL>"));
    const proof = proveStatement({ kind: "ofx", lines: read.rows, figures: fileFigures(read), prior }, money);
    expect(proof).toMatchObject({ closingMinor: null, closingBasis: null, missing: "closing" });
  });

  it("does not use a LEDGERBAL as of a day before the end", () => {
    const read = parseOfx(ofx("<LEDGERBAL><BALAMT>1210.00<DTASOF>20260929</LEDGERBAL>"));
    expect(proveStatement({ kind: "ofx", lines: read.rows, figures: fileFigures(read) }, money).closingMinor).toBeNull();
  });

  it("measures the end by the last line's day when the file gives no DTEND", () => {
    const onLastLine = parseOfx(ofx("<LEDGERBAL><BALAMT>1210.00<DTASOF>20260921</LEDGERBAL>", "<DTSTART>20260901"));
    expect(onLastLine.periodEnd).toBeNull();
    expect(proveStatement({ kind: "ofx", lines: onLastLine.rows, figures: fileFigures(onLastLine), prior }, money)).toMatchObject({
      closingBasis: "ledger",
      proves: true,
    });
  });

  it("leaves the opening to be typed when it starts on another day than the day after the last reconciliation", () => {
    const read = parseOfx(ofx("<LEDGERBAL><BALAMT>1210.00<DTASOF>20260930</LEDGERBAL>", "<DTSTART>20260905<DTEND>20260930"));
    const proof = proveStatement({ kind: "ofx", lines: read.rows, figures: fileFigures(read), prior, usePrior: true }, money);
    expect(proof).toMatchObject({ openingMinor: null, missing: "opening", prior: { status: "refused" } });
    expect(proof.sentences.usePrior).toBeNull();
    const typed = proveStatement({ kind: "ofx", lines: read.rows, figures: fileFigures(read), prior, typedOpeningMinor: 100000 }, money);
    expect(typed).toMatchObject({ openingBasis: "typed", proves: true });
  });
});

describe("a QIF", () => {
  const qif = (opening: boolean) =>
    [
      "!Type:Bank",
      ...(opening ? ["D9/1'26", "T1,000.00", "POpening Balance", "^"] : []),
      "D9/4'26",
      "T250.00",
      "PEXAMPLE CUSTOMER",
      "^",
      "D9/21'26",
      "T-40.00",
      "PEXAMPLE FEE",
      "^",
    ].join("\n");

  it("opens at its Opening Balance record and closes at the balance typed", () => {
    const read = parseQif(qif(true));
    const blocked = proveStatement({ kind: "qif", lines: read.rows, figures: fileFigures(read) }, money);
    expect(blocked).toMatchObject({ openingMinor: 100000, openingBasis: "printed", missing: "closing", lineCount: 2 });
    const proof = proveStatement({ kind: "qif", lines: read.rows, figures: fileFigures(read), typedClosingMinor: 121000 }, money);
    expect(proof).toMatchObject({ closingBasis: "typed", proves: true });
  });

  describe("without one, the prior statement's closing", () => {
    const read = parseQif(qif(false));
    const prior = { date: "2026-08-31", endingMinor: 100000 };

    it("is offered with a button, not taken, when the statement's start is not known", () => {
      const proof = proveStatement({ kind: "qif", lines: read.rows, figures: fileFigures(read), prior, typedClosingMinor: 121000 }, money);
      expect(proof).toMatchObject({ openingMinor: null, missing: "opening", prior: { status: "offered" } });
      expect(proof.sentences.usePrior).toBe("Use $1,000.00 (the closing of the reconciliation to Aug 31, 2026)");
    });

    it("is taken when the person presses the button", () => {
      const proof = proveStatement(
        { kind: "qif", lines: read.rows, figures: fileFigures(read), prior, usePrior: true, typedClosingMinor: 121000 },
        money,
      );
      expect(proof).toMatchObject({ openingMinor: 100000, openingBasis: "prior", proves: true, prior: { status: "taken" } });
      expect(proof.sentences.openingBasis).toBe("from the reconciliation to Aug 31, 2026");
    });

    it("gives way to a typed opening when the button is not pressed", () => {
      const proof = proveStatement(
        { kind: "qif", lines: read.rows, figures: fileFigures(read), prior, typedOpeningMinor: 100000, typedClosingMinor: 121000 },
        money,
      );
      expect(proof).toMatchObject({ openingBasis: "typed", proves: true, prior: { status: "offered" } });
    });

    it("is not offered when a line falls on or before that reconciliation's date", () => {
      const early = [...read.rows, line("2026-08-31", -500, "EXAMPLE LATE FEE")];
      const proof = proveStatement({ kind: "qif", lines: early, figures: fileFigures(read), prior, usePrior: true }, money);
      expect(proof).toMatchObject({ openingMinor: null, prior: { status: "refused" } });
      expect(proof.sentences.usePrior).toBeNull();
    });

    it("is offered again once that line is marked Not a transaction", () => {
      const early = [...read.rows, line("2026-08-31", -500, "EXAMPLE LATE FEE")];
      expect(proveStatement({ kind: "qif", lines: early, aside: [2], figures: fileFigures(read), prior }, money).prior.status).toBe("offered");
    });
  });
});

describe("the prior closing", () => {
  it("is not involved when the file gives the opening, or when the account has never been reconciled", () => {
    const pdf = pdfOf("debitCreditColumns");
    const prior = { date: "2025-12-31", endingMinor: 1 };
    expect(proveStatement({ kind: "pdf", lines: toStatementLines(pdf), figures: pdfFigures(pdf), prior }, money).prior).toEqual({
      status: "none",
      date: "2025-12-31",
      endingMinor: 1,
    });
    expect(proveStatement({ kind: "qif", lines: [line("2026-01-05", 100)] }, money).prior.status).toBe("none");
  });

  it("is taken for a PDF that prints no opening when its period starts the day after", () => {
    const pdf: PdfStatement = { ...pdfOf("debitCreditColumns"), openingMinor: null, openingBasis: null };
    const proof = proveStatement(
      { kind: "pdf", lines: toStatementLines(pdf), figures: pdfFigures(pdf), prior: { date: "2025-12-31", endingMinor: 100000 } },
      money,
    );
    expect(proof).toMatchObject({ openingBasis: "prior", proves: true, prior: { status: "auto" } });
  });
});

describe("the words", () => {
  it("are the spec's", () => {
    expect(PROOF_TEXT).toEqual({
      blocked: "Import is blocked until the statement adds up.",
      adminCanOverride: "An administrator can import it anyway, with a reason.",
      importAnyway: "Import anyway…",
      openingField: "Opening balance printed on the statement",
      closingField: "Closing balance printed on the statement",
      attachBlocked: "Attaching is blocked until the statement adds up.",
    });
    expect(importLinesLabel(42)).toBe("Import 42 lines");
    expect(importLinesLabel(1)).toBe("Import 1 line");
    expect(importLinesLabel(1204)).toBe("Import 1,204 lines");
  });

  it("offer the prior statement's closing on a button", () => {
    expect(priorOfferLabel({ date: "2026-02-28", endingMinor: 123450 }, money)).toBe(
      "Use $1,234.50 (the closing of the reconciliation to Feb 28, 2026)",
    );
  });

  it("say each basis of the opening in words", () => {
    expect(openingBasisWords("printed", null)).toBe("printed");
    expect(openingBasisWords("running", null)).toBe("from the running balance");
    expect(openingBasisWords("prior", "2026-02-28")).toBe("from the reconciliation to Feb 28, 2026");
    expect(openingBasisWords("typed", null)).toBe("typed");
  });

  it("print a line's amount as the statement does", () => {
    expect(plainAmount(-41230, money)).toBe("−412.30");
    expect(plainAmount(123456, money)).toBe("1,234.56");
    expect(plainAmount(0, money)).toBe("0.00");
  });

  it("count one line as a line", () => {
    const proof = proveStatement({ kind: "csv", lines: [line("2026-03-02", 1000, "A", 11000)] }, money);
    expect(proof.sentences.summary).toBe(
      "Opening $100.00 (from the running balance) + 1 line $10.00 = $110.00, the closing balance the statement prints ✓",
    );
  });
});

describe("dayAfter", () => {
  it("crosses months, years and leap days", () => {
    expect(dayAfter("2026-02-28")).toBe("2026-03-01");
    expect(dayAfter("2028-02-28")).toBe("2028-02-29");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
  });
});

describe("what the import sends", () => {
  const lines = [line("2026-03-02", 1000, "A"), line("2026-03-03", -36000, "MISREAD"), line("2026-03-04", -200, "B")];

  it("sends every line but those marked Not a transaction, in file order, those already here from another source marked skip", () => {
    expect(statementImportRows(lines, [1], [2])).toEqual([lines[0], { ...lines[2], skip: true }]);
    expect(statementImportRows(lines)).toEqual(lines);
  });

  it("sends the proof as the database takes it, the override's reason trimmed", () => {
    const proof = proveStatement({ kind: "csv", lines, aside: [1], typedOpeningMinor: 5000, typedClosingMinor: 5800 }, money);
    expect(proofPayload(proof)).toEqual({
      opening_minor: 5000,
      closing_minor: 5800,
      opening_basis: "typed",
      closing_basis: "typed",
      set_aside: 1,
      override: null,
    });
    expect(proofPayload(proof, { reason: "  The bank misprinted the closing  " }).override).toEqual({ reason: "The bank misprinted the closing" });
  });
});

describe("the server's proof", () => {
  const payload = (over: Partial<StatementProofPayload> = {}): StatementProofPayload => ({
    opening_minor: 10000,
    closing_minor: 10800,
    opening_basis: "printed",
    closing_basis: "printed",
    set_aside: 0,
    override: null,
    ...over,
  });
  const rows = [line("2026-03-02", 1000), { ...line("2026-03-03", -200), skip: true }];

  it("counts every line sent, those marked skip included", () => {
    const proof = proveStatementPayload(rows, payload(), money);
    expect(proof).toMatchObject({ proves: true, lineCount: 2, linesMinor: 800 });
    expect(proofRefusal(proof, null)).toBeNull();
    expect(proveStatementPayload(rows.slice(0, 1), payload(), money).proves).toBe(false);
  });

  it("refuses a statement that does not add up, in the dialog's own words, unless it carries an override", () => {
    const out = proveStatementPayload(rows, payload({ closing_minor: 10000 }), money);
    expect(proofRefusal(out, null)).toBe(
      "Out by $8.00. The opening $100.00 and the 2 lines come to $108.00; the statement closes at $100.00. " +
        "Import is blocked until the statement adds up.",
    );
    expect(proofRefusal(out, { reason: "The bank misprinted the closing" })).toBeNull();
    expect(proofRefusal(out, null, PROOF_TEXT.attachBlocked)).toMatch(/Attaching is blocked until the statement adds up\.$/);
  });

  it("refuses a missing balance, override or not", () => {
    const reason = { reason: "Because" };
    expect(proofRefusal(proveStatementPayload(rows, payload({ opening_minor: null, opening_basis: null }), money), reason)).toBe(
      PROOF_REFUSAL.noOpening,
    );
    expect(proofRefusal(proveStatementPayload(rows, payload({ closing_minor: null, closing_basis: null }), money), reason)).toBe(
      PROOF_REFUSAL.noClosing,
    );
    expect(
      proofRefusal(
        proveStatementPayload(rows, payload({ opening_minor: null, opening_basis: null, closing_minor: null, closing_basis: null }), money),
        reason,
      ),
    ).toBe(PROOF_REFUSAL.noBalances);
  });

  it("is the dialog's proof, worked out again from what the dialog sends", () => {
    const pdf = pdfOf("debitCreditColumns");
    const lines = [...toStatementLines(pdf), line("2026-01-12", -36000, "CHECK IMAGE 0042")];
    for (const aside of [[], [3]]) {
      const dialog = proveStatement({ kind: "pdf", lines, aside, figures: pdfFigures(pdf) }, money);
      const server = proveStatementPayload(statementImportRows(lines, aside), proofPayload(dialog), money);
      expect([server.proves, server.differenceMinor, server.setAside]).toEqual([dialog.proves, dialog.differenceMinor, dialog.setAside]);
      expect(server.sentences.summary).toBe(dialog.sentences.summary);
    }
  });
});

describe("sentWithoutProof", () => {
  it("knows a payload a screen from before 2.04 sent", () => {
    expect(sentWithoutProof({ file_name: "a.pdf", lines: [] })).toBe(true);
    expect(sentWithoutProof({ file_name: "a.pdf", lines: [], proof: null })).toBe(true);
    expect(sentWithoutProof({ file_name: "a.pdf", lines: [], proof: {} })).toBe(false);
    expect(sentWithoutProof(null)).toBe(false);
    expect(sentWithoutProof("text")).toBe(false);
  });
});

describe("statementProofPayloadSchema", () => {
  const base = { opening_minor: 10000, closing_minor: 10800, opening_basis: "printed", closing_basis: "ledger" };
  const firstIssue = (value: unknown) => statementProofPayloadSchema.safeParse(value).error?.issues[0]?.message;

  it("fills in nothing set aside and no override", () => {
    expect(statementProofPayloadSchema.parse(base)).toEqual({ ...base, set_aside: 0, override: null });
  });

  it("takes an override with a reason, trimmed, and refuses a blank one or one over 500 characters", () => {
    expect(statementProofPayloadSchema.parse({ ...base, override: { reason: "  Bank error  " } }).override).toEqual({ reason: "Bank error" });
    expect(firstIssue({ ...base, override: { reason: "   " } })).toBe("Give a reason for importing a statement that does not add up");
    expect(firstIssue({ ...base, override: { reason: "x".repeat(501) } })).toBe("Keep the reason to 500 characters or fewer");
    expect(statementProofPayloadSchema.safeParse({ ...base, override: { reason: "x".repeat(500) } }).success).toBe(true);
  });

  it("refuses part-cents, a negative number set aside, and a basis of no known kind", () => {
    expect(firstIssue({ ...base, opening_minor: 1.5 })).toBe("The opening balance must be a whole minor-unit amount");
    expect(firstIssue({ ...base, set_aside: -1 })).toBe("The number of lines marked Not a transaction cannot be negative");
    expect(statementProofPayloadSchema.safeParse({ ...base, closing_basis: "books" }).success).toBe(false);
  });
});
