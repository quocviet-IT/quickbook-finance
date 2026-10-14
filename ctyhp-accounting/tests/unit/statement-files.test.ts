import { describe, expect, it } from "vitest";
import { statementLineHash, statementRowHash } from "@/lib/domain/banking-import";
import {
  accountNumberDiffers,
  detectStatementFormat,
  joinDescription,
  parseOfx,
  parseQif,
  UNSUPPORTED_STATEMENT,
} from "@/lib/domain/statement-files";

const SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>000000000<ACCTID>99004821<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260915120000[-5:EST]
<TRNAMT>-6850.00
<FITID>2026091501
<NAME>PAYFLOW PAYROLL
<MEMO>PAYROLL 0915
</STMTTRN>
<STMTTRN>
<TRNTYPE>CHECK
<DTPOSTED>20260918
<TRNAMT>-312.40
<FITID>2026091802
<CHECKNUM>1042
<NAME>HARBOR POWER &amp; LIGHT
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>not-a-date
<TRNAMT>-1.00
<FITID>bad
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>4111000011112222</ACCTID></CCACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260920</DTPOSTED><TRNAMT>1250.00</TRNAMT>
<FITID>X-77</FITID><NAME>CUSTOMER DEPOSIT</NAME><REFNUM>R-9</REFNUM></STMTTRN></BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

describe("detectStatementFormat", () => {
  it("goes by the extension first", () => {
    expect(detectStatementFormat("sept.QFX", "")).toEqual({ format: "ofx" });
    expect(detectStatementFormat("sept.qbo", "")).toEqual({ format: "ofx" });
    expect(detectStatementFormat("sept.qif", "")).toEqual({ format: "qif" });
    expect(detectStatementFormat("sept.csv", "")).toEqual({ format: "csv" });
    expect(detectStatementFormat("sept.pdf", "")).toEqual({ format: "pdf" });
    expect(detectStatementFormat("sept.xlsx", "")).toEqual({ unsupported: UNSUPPORTED_STATEMENT });
  });
  it("looks inside a file whose name says nothing", () => {
    expect(detectStatementFormat("download", SGML)).toEqual({ format: "ofx" });
    expect(detectStatementFormat("download", "!Type:Bank\nD9/30'26\n^")).toEqual({ format: "qif" });
    expect(detectStatementFormat("download", "%PDF-1.7")).toEqual({ format: "pdf" });
    expect(detectStatementFormat("download.txt", "date,amount")).toEqual({ format: "csv" });
  });
});

describe("parseOfx", () => {
  it("reads SGML: dates, signed amounts, names, memos, cheque numbers and the bank's own id", () => {
    const result = parseOfx(SGML);
    expect(result.accountId).toBe("99004821");
    expect(result.skipped).toBe(1);
    expect(result.rows.map((r) => [r.txn_date, r.amount_minor, r.description, r.reference, r.external_id])).toEqual([
      // The memo says something the name does not ("0915"), so it is kept.
      ["2026-09-15", -685000, "PAYFLOW PAYROLL PAYROLL 0915", null, "2026091501"],
      ["2026-09-18", -31240, "HARBOR POWER & LIGHT", "1042", "2026091802"],
    ]);
  });
  it("reads XML, and a card statement's account", () => {
    const result = parseOfx(XML);
    expect(result.accountId).toBe("4111000011112222");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ txn_date: "2026-09-20", amount_minor: 125000, description: "CUSTOMER DEPOSIT", reference: "R-9", external_id: "X-77" });
  });
  it("finds nothing in a file with no transactions", () => {
    expect(parseOfx("<OFX></OFX>")).toEqual({ rows: [], skipped: 0, accountId: null, ledger: null, periodStart: null, periodEnd: null });
  });
});

describe("parseOfx: the period and the ledger balance (2.04)", () => {
  const sgml = (tail: string) => `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>000000000<ACCTID>99004821<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901000000.000[-5:EST]
<DTEND>20260930235959.000[-5:EST]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260915
<TRNAMT>-50.00
<FITID>F-1
<NAME>EXAMPLE FEE
</STMTTRN>
</BANKTRANLIST>
${tail}
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("reads DTSTART and DTEND as days, and LEDGERBAL with the day it is as of", () => {
    const result = parseOfx(sgml("<LEDGERBAL><BALAMT>1234.56<DTASOF>20260930120000.000[-5:EST]</LEDGERBAL>"));
    expect(result.periodStart).toBe("2026-09-01");
    expect(result.periodEnd).toBe("2026-09-30");
    expect(result.ledger).toEqual({ minor: 123456, asOf: "2026-09-30" });
    expect(result.rows).toHaveLength(1);
  });

  it("reads XML and a negative balance, and never AVAILBAL", () => {
    const xml =
      "<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>4111000011112222</ACCTID></CCACCTFROM>" +
      "<BANKTRANLIST><DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>" +
      "<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260810</DTPOSTED><TRNAMT>-75.00</TRNAMT><FITID>C-1</FITID><NAME>EXAMPLE CARD</NAME></STMTTRN>" +
      "</BANKTRANLIST><LEDGERBAL><BALAMT>-1075.00</BALAMT><DTASOF>20260831</DTASOF></LEDGERBAL>" +
      "<AVAILBAL><BALAMT>3925.00</BALAMT><DTASOF>20260831</DTASOF></AVAILBAL></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>";
    const result = parseOfx(xml);
    expect(result).toMatchObject({ periodStart: "2026-08-01", periodEnd: "2026-08-31", ledger: { minor: -107500, asOf: "2026-08-31" } });
  });

  it("reads no balance from a file of two statements, nor a period", () => {
    const one = sgml("<LEDGERBAL><BALAMT>10.00<DTASOF>20260930</LEDGERBAL>");
    const two = `${one}\n${one}`;
    const result = parseOfx(two);
    expect([result.ledger, result.periodStart, result.periodEnd]).toEqual([null, null, null]);
    expect(result.rows).toHaveLength(2);
  });

  it("leaves the ledger balance out when it cannot be read, and its date when there is none", () => {
    expect(parseOfx(sgml("<LEDGERBAL><BALAMT>n/a<DTASOF>20260930</LEDGERBAL>")).ledger).toBeNull();
    expect(parseOfx(sgml("<LEDGERBAL><BALAMT>10.00</LEDGERBAL>")).ledger).toEqual({ minor: 1000, asOf: null });
  });
});

describe("parseQif", () => {
  const QIF = [
    "!Account",
    "NOperating",
    "TBank",
    "^",
    "!Type:Bank",
    "D9/30'26",
    "T-15.00",
    "PMONTHLY SERVICE FEE",
    "^",
    "D09/22/2026",
    "U-1,250.00",
    "PNORTHWIND SUPPLY CO",
    "MWIRE",
    "N2231",
    "^",
    "D9/5' 6",
    "T100.00",
    "POLD DEPOSIT",
    "^",
    "Dgarbage",
    "T1.00",
    "^",
    "!Type:Invst",
    "D9/30'26",
    "T5.00",
    "^",
  ].join("\n");

  it("reads bank records in both year forms, T or U, payee, memo and number", () => {
    const result = parseQif(QIF);
    expect(result.rows.map((r) => [r.txn_date, r.amount_minor, r.description, r.reference])).toEqual([
      ["2026-09-30", -1500, "MONTHLY SERVICE FEE", null],
      ["2026-09-22", -125000, "NORTHWIND SUPPLY CO WIRE", "2231"],
      ["2006-09-05", 10000, "OLD DEPOSIT", null],
    ]);
  });
  it("skips and counts unreadable records and sections that are not bank, cash or card", () => {
    expect(parseQif(QIF).skipped).toBe(2);
  });

  it("has no opening when it carries no Opening Balance record", () => {
    expect(parseQif(QIF).openingMinor).toBeNull();
  });

  it("reads an Opening Balance record as the opening, not as a line (2.04)", () => {
    const withOpening = ["!Type:Bank", "D9/1'26", "T2,500.00", "POpening Balance", "L[Example Checking]", "^", "D9/30'26", "T-15.00", "PMONTHLY SERVICE FEE", "^"].join("\n");
    const result = parseQif(withOpening);
    expect(result.openingMinor).toBe(250000);
    expect(result.rows.map((r) => [r.txn_date, r.amount_minor, r.description])).toEqual([["2026-09-30", -1500, "MONTHLY SERVICE FEE"]]);
    expect(result.skipped).toBe(0);
  });

  it("takes neither of two Opening Balance records, and imports neither as a line", () => {
    const two = ["!Type:Bank", "D9/1'26", "T100.00", "POPENING BALANCE", "^", "D9/1'26", "T200.00", "P Opening Balance ", "^", "D9/2'26", "T-5.00", "PFEE", "^"].join("\n");
    const result = parseQif(two);
    expect(result.openingMinor).toBeNull();
    expect(result.rows).toHaveLength(1);
  });
});

describe("joinDescription", () => {
  it("adds the memo only when it says something the name does not", () => {
    expect(joinDescription("PAYFLOW PAYROLL", "PAYROLL")).toBe("PAYFLOW PAYROLL");
    expect(joinDescription("NORTHWIND", "WIRE")).toBe("NORTHWIND WIRE");
    expect(joinDescription(null, "WIRE")).toBe("WIRE");
  });
});

describe("accountNumberDiffers", () => {
  it("compares the last four digits when both sides have them", () => {
    expect(accountNumberDiffers("99004821", "••4821")).toBe(false);
    expect(accountNumberDiffers("99004822", "••4821")).toBe(true);
    expect(accountNumberDiffers("99004822", null)).toBe(false);
    expect(accountNumberDiffers(null, "••4821")).toBe(false);
  });
});

describe("statementLineHash", () => {
  const base = { txn_date: "2026-09-15", amount_minor: -685000, description: "PAYFLOW PAYROLL", reference: null };
  it("keys a line with a bank id on that id, so a reworded re-download is the same line", () => {
    expect(statementLineHash("acct", { ...base, external_id: "F1" })).toBe(
      statementLineHash("acct", { ...base, description: "PAYFLOW PAYROLL 0915", external_id: "F1" }),
    );
  });
  it("keys a line without one exactly as imports always have", () => {
    expect(statementLineHash("acct", base)).toBe(statementRowHash(["acct", "2026-09-15", -685000, "PAYFLOW PAYROLL", null]));
  });
});
