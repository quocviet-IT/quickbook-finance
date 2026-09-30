import { describe, expect, it } from "vitest";
import {
  detectDateOrder,
  detectStatementColumns,
  parseStatementRows,
  statementColumnsComplete,
} from "@/lib/domain/statement-import";

describe("detectStatementColumns", () => {
  it("recognises the headings banks use, and says when it has enough", () => {
    const found = detectStatementColumns(["posting date", "details", "paid out", "paid in", "balance"]);
    expect(found.columns).toEqual({
      date: "posting date",
      description: "details",
      amount: null,
      moneyOut: "paid out",
      moneyIn: "paid in",
      reference: null,
      balance: "balance",
    });
    expect(found.complete).toBe(true);
  });
  it("says so when it cannot find a date or an amount", () => {
    expect(detectStatementColumns(["when", "what", "how much"]).complete).toBe(false);
    expect(statementColumnsComplete({ date: "when", description: null, amount: null, moneyOut: null, moneyIn: null, reference: null, balance: null })).toBe(false);
  });
});

describe("parseStatementRows with chosen columns", () => {
  const records = [
    { when: "03/04/2026", what: "Harbor Power & Light", "how much": "-312.40", ref: "A1" },
    { when: "13/04/2026", what: "Customer deposit", "how much": "1,250.00", ref: "" },
  ];
  const columns = { date: "when", description: "what", amount: "how much", moneyOut: null, moneyIn: null, reference: "ref", balance: null };

  it("reads the columns it was told to, in the date order it was told", () => {
    const result = parseStatementRows(records, { columns, dateOrder: "dmy" });
    expect(result.skipped).toBe(0);
    expect(result.rows.map((r) => [r.txn_date, r.description, r.amount_minor, r.reference])).toEqual([
      ["2026-04-03", "Harbor Power & Light", -31240, "A1"],
      ["2026-04-13", "Customer deposit", 125000, null],
    ]);
  });
  it("flips signs for a file that writes payments as positive", () => {
    const result = parseStatementRows(records, { columns, dateOrder: "dmy", flipSigns: true });
    expect(result.rows.map((r) => r.amount_minor)).toEqual([31240, -125000]);
  });
  it("reads money out and money in columns when chosen", () => {
    const split = [{ d: "2026-09-01", n: "Rent", o: "2,400.00", i: "" }, { d: "2026-09-02", n: "Refund", o: "", i: "15.00" }];
    const result = parseStatementRows(split, {
      columns: { date: "d", description: "n", amount: null, moneyOut: "o", moneyIn: "i", reference: null, balance: null },
    });
    expect(result.rows.map((r) => r.amount_minor)).toEqual([-240000, 1500]);
  });
  it("still guesses the columns when none are chosen", () => {
    const result = parseStatementRows([{ date: "2026-09-01", description: "Rent", amount: "-10.00" }]);
    expect(result.rows[0].amount_minor).toBe(-1000);
  });
});

describe("detectDateOrder", () => {
  it("reads a first number over 12 as a day, and a second one as a month's day", () => {
    expect(detectDateOrder(["03/04/2026", "13/04/2026"])).toBe("dmy");
    expect(detectDateOrder(["03/04/2026", "04/15/2026"])).toBe("mdy");
  });
  it("falls back to month first when nothing tells", () => {
    expect(detectDateOrder(["03/04/2026", "2026-04-03", ""])).toBe("mdy");
  });
});
