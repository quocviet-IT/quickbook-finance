import { describe, expect, it } from "vitest";
import { excludedRowsCsv } from "@/lib/domain/excluded-rows";
import { parseCsv } from "@/lib/csv";

const HEADERS = ["Date", "Description", "Bank account", "Chart of account", "Amount"];
// Made up, in the shape of a Wave export: invented bank, dates, cheque and amounts.
const ROWS = [
  ["4/7/2026", "Card deposit", "Riverbend Bank CK 4471", "Sales", "1200"],
  ["4/9/2026", "Fee waived, in full", "Riverbend Bank CK 4471", "Bank Charges", "0.00"],
  ["5/14/2026", "Check 2045", "Riverbend Bank CK 4471", "Loan from Owner", "-1250"],
];

describe("excludedRowsCsv", () => {
  // parseCsv keys by the header lower-cased, which is how every other caller
  // reads a file back. The assertions follow it rather than fighting it.
  it("carries the line number, the reason, and the file's own row", () => {
    const csv = excludedRowsCsv(HEADERS, ROWS, [
      { line: 3, reason: "No money", message: "This row carries no amount." },
    ]);
    const parsed = parseCsv(csv);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]["line in file"]).toBe("3");
    expect(parsed[0]["why it was left out"]).toBe("No money");
    // The row it points at is the second data row: line 3 counts the header.
    expect(parsed[0]["description"]).toBe("Fee waived, in full");
    expect(parsed[0]["amount"]).toBe("0.00");
  });

  it("keeps a comma inside a field from shifting a column", () => {
    // The description above holds a comma on purpose: a naive join would move
    // every column after it, and the file would open silently wrong.
    const csv = excludedRowsCsv(HEADERS, ROWS, [
      { line: 3, reason: "No money", message: "Nothing to post." },
    ]);

    expect(csv).toContain('"Fee waived, in full"');
    expect(parseCsv(csv)[0]["chart of account"]).toBe("Bank Charges");
  });

  it("orders by the line in the file, however the reasons arrived", () => {
    const csv = excludedRowsCsv(HEADERS, ROWS, [
      { line: 4, reason: "Problem", message: "Amount and Debit/Credit disagree." },
      { line: 2, reason: "Already imported", message: "Already in the bank register." },
      { line: 3, reason: "No money", message: "Nothing to post." },
    ]);

    expect(parseCsv(csv).map((row) => row["line in file"])).toEqual(["2", "3", "4"]);
  });

  it("writes an empty row rather than throwing when a line is out of range", () => {
    // A line number that does not match the file means something upstream is
    // wrong; losing the reason with it would hide that.
    const csv = excludedRowsCsv(HEADERS, ROWS, [
      { line: 99, reason: "Problem", message: "Somewhere past the end." },
    ]);
    const parsed = parseCsv(csv);

    expect(parsed[0]["line in file"]).toBe("99");
    expect(parsed[0]["description"]).toBe("");
  });

  it("does not let two columns of one name swallow each other", () => {
    const headers = ["Amount", "Amount"];
    const rows = [["10", "20"]];

    const parsed = parseCsv(
      excludedRowsCsv(headers, rows, [{ line: 2, reason: "Problem", message: "x" }]),
    );

    // parseCsv keys by header, so the last wins there — but the CSV itself must
    // carry both values, in order.
    const line = excludedRowsCsv(headers, rows, [
      { line: 2, reason: "Problem", message: "x" },
    ]).split("\r\n")[1];
    expect(line.endsWith("10,20")).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});
