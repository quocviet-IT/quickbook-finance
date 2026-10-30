import { describe, expect, it } from "vitest";
import {
  dateOrderChoices,
  dateOrderNotice,
  detectDateOrder,
  detectStatementColumns,
  parseStatementRows,
  readDateOrder,
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

describe("readDateOrder", () => {
  it("is settled by any date with a number over 12, wherever it is in the file", () => {
    expect(readDateOrder(["03/04/2026", "05/06/2026", "13/04/2026"])).toEqual({ order: "dmy", settled: true, example: null });
    expect(readDateOrder(["03/04/2026", "04/15/2026"])).toEqual({ order: "mdy", settled: true, example: null });
  });
  it("is settled when no date reads two ways, or when dates are written with dots", () => {
    expect(readDateOrder(["2026-04-03", "05/05/2026", ""])).toMatchObject({ order: "mdy", settled: true });
    expect(readDateOrder(["03.04.2026", "05.06.2026"])).toEqual({ order: "dmy", settled: true, example: null });
  });
  it("asks, with the file's first date that reads two ways, when nothing tells", () => {
    expect(readDateOrder(["05/05/2026", "03/04/2026", "06/07/2026"])).toEqual({ order: "mdy", settled: false, example: "03/04/2026" });
  });
});

describe("dateOrderNotice", () => {
  it("shows both readings until someone chooses, and the one chosen after", () => {
    expect(dateOrderNotice("03/04/2026", "mdy", false)).toEqual({
      title: "Check which way round the dates are written",
      description:
        "Every date in this file reads two ways: 03/04/2026 is March 4, 2026 month first, or April 3, 2026 day first. They are read month first until you choose.",
    });
    expect(dateOrderNotice("03/04/2026", "dmy", true)).toEqual({ title: "Dates read day first: 03/04/2026 is April 3, 2026", description: null });
    expect(dateOrderChoices("3-4-26").map((c) => c.label)).toEqual(["Month first · March 4, 2026", "Day first · April 3, 2026"]);
  });
});
