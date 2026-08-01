import { describe, expect, it } from "vitest";
import {
  describeStatementParse,
  normalizeStatementDate,
  parseStatementAmount,
  parseStatementRows,
} from "@/lib/domain/statement-import";

describe("normalizeStatementDate", () => {
  it("takes an ISO date as it is", () => {
    expect(normalizeStatementDate("2026-07-31")).toBe("2026-07-31");
  });

  it("reads US order by default", () => {
    expect(normalizeStatementDate("7/31/2026")).toBe("2026-07-31");
    expect(normalizeStatementDate("07/04/2026")).toBe("2026-07-04");
  });

  it("reads day-first when the file says so", () => {
    expect(normalizeStatementDate("04/07/2026", "dmy")).toBe("2026-07-04");
  });

  it("treats a first number over twelve as a day, whatever the setting", () => {
    expect(normalizeStatementDate("31/07/2026")).toBe("2026-07-31");
  });

  it("refuses what it cannot read rather than guessing", () => {
    expect(normalizeStatementDate("31 July 2026")).toBeNull();
    expect(normalizeStatementDate("")).toBeNull();
    expect(normalizeStatementDate("13/13/2026")).toBeNull();
  });
});

describe("parseStatementAmount", () => {
  it("reads a plain amount", () => {
    expect(parseStatementAmount("1234.56")).toBe(123456);
    expect(parseStatementAmount("$1,234.56")).toBe(123456);
  });

  it("reads the accounting minus sign", () => {
    expect(parseStatementAmount("(1,234.56)")).toBe(-123456);
    expect(parseStatementAmount("-1234.56")).toBe(-123456);
  });

  it("reads a European decimal comma when no dot contradicts it", () => {
    expect(parseStatementAmount("1.234,56")).toBe(123456);
    expect(parseStatementAmount("1234,56")).toBe(123456);
  });

  it("keeps zero as zero and nothing as nothing", () => {
    expect(parseStatementAmount("0.00")).toBe(0);
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("n/a")).toBeNull();
  });
});

describe("parseStatementRows", () => {
  it("reads the common single-amount export", () => {
    const result = parseStatementRows([
      { date: "7/15/2026", description: "Customer ACH deposit", amount: "2,806.51", balance: "27,120.27" },
    ]);
    expect(result.skipped).toBe(0);
    expect(result.rows[0]).toEqual({
      txn_date: "2026-07-15",
      description: "Customer ACH deposit",
      reference: null,
      amount_minor: 280651,
      running_balance_minor: 2712027,
      raw_line: "7/15/2026,Customer ACH deposit,2,806.51,27,120.27",
    });
  });

  it("reads separate debit and credit columns, debit as money leaving", () => {
    const result = parseStatementRows([
      { date: "2026-07-03", description: "Showroom rent", debit: "3,200.00", credit: "" },
      { date: "2026-07-05", description: "Deposit", debit: "", credit: "1,786.13" },
    ]);
    expect(result.rows.map((row) => row.amount_minor)).toEqual([-320000, 178613]);
  });

  it("finds the columns under the headings banks actually use", () => {
    const result = parseStatementRows([
      {
        "posting date": "2026-07-08",
        narrative: "Wire from North Star Bridal",
        "check number": "10428",
        value: "17,320.00",
      },
    ]);
    expect(result.rows[0].description).toBe("Wire from North Star Bridal");
    expect(result.rows[0].reference).toBe("10428");
    expect(result.rows[0].amount_minor).toBe(1732000);
  });

  it("skips and counts a row it cannot read rather than importing a wrong one", () => {
    const result = parseStatementRows([
      { date: "not a date", description: "Mystery", amount: "100.00" },
      { date: "2026-07-09", description: "No amount", amount: "" },
      { date: "2026-07-10", description: "Good", amount: "10.00" },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });

  it("reads an empty file as nothing, not as an error", () => {
    expect(parseStatementRows([])).toEqual({ rows: [], skipped: 0 });
  });
});

describe("describeStatementParse", () => {
  it("says what is about to be imported, in one line", () => {
    const result = parseStatementRows([
      { date: "2026-07-03", description: "Rent", amount: "-3200.00" },
      { date: "2026-07-15", description: "Deposit", amount: "2806.51" },
    ]);
    expect(describeStatementParse(result)).toBe(
      "2 transaction(s) from 2026-07-03 to 2026-07-15, net -$393.49",
    );
  });

  it("counts the rows it had to skip", () => {
    const result = parseStatementRows([
      { date: "2026-07-03", description: "Rent", amount: "-3200.00" },
      { date: "", description: "Broken", amount: "" },
    ]);
    expect(describeStatementParse(result)).toContain("1 unreadable row(s) skipped");
  });

  it("says plainly when there is nothing readable", () => {
    expect(describeStatementParse({ rows: [], skipped: 3 })).toContain("No readable rows");
    expect(describeStatementParse({ rows: [], skipped: 0 })).toBe("No rows found in this file.");
  });
});
