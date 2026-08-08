import { describe, expect, it } from "vitest";
import { accountTypeReadings } from "@/lib/domain/account-type-readings";

/** Column order as a QuickBooks account list exports it. */
const MAPPING = {
  account_code: 0,
  name: 1,
  account_type: 2,
  description: 3,
  opening_balance_minor: 4,
};

const ROWS = [
  ["1000", "Checking", "Bank", "", "0"],
  ["1100", "Receivables", "Accounts receivable (A/R)", "", "0"],
  ["1400", "Prepaid Rent", "Other Current Asset", "", "0"],
  ["1410", "Deposits Held", "Other Current Asset", "", "0"],
  ["2100", "Visa", "Credit Card", "", "0"],
  ["6000", "Rent", "Expense", "", "0"],
  ["6100", "Utilities", "Expense", "", "0"],
  ["9000", "Mystery", "Widget Ledger", "", "0"],
];

describe("accountTypeReadings", () => {
  it("groups by the word rather than by the account", () => {
    // Ninety-five accounts are usually a dozen words. Reviewing the rows is
    // proof-reading; reviewing the words is review.
    const readings = accountTypeReadings(ROWS, MAPPING, 1);

    expect(readings).toHaveLength(6);
    const other = readings.find((r) => r.source === "Other Current Asset");
    expect(other?.rows).toBe(2);
    expect(other?.type).toBe("current_asset");
  });

  it("puts the word that decides the most accounts first", () => {
    const readings = accountTypeReadings(ROWS, MAPPING, 1);

    expect(readings[0].rows).toBe(2);
    expect(["Expense", "Other Current Asset"]).toContain(readings[0].source);
  });

  it("carries an example so an unfamiliar word can be placed", () => {
    const readings = accountTypeReadings(ROWS, MAPPING, 1);

    expect(readings.find((r) => r.source === "Credit Card")?.example).toBe("Visa");
  });

  it("says plainly when a word means nothing here", () => {
    const readings = accountTypeReadings(ROWS, MAPPING, 1);

    expect(readings.find((r) => r.source === "Widget Ledger")?.type).toBeNull();
  });

  it("takes the reader's answer over the matcher's, and marks it as theirs", () => {
    const readings = accountTypeReadings(ROWS, MAPPING, 1, {
      "Other Current Asset": "fixed_asset",
    });

    const other = readings.find((r) => r.source === "Other Current Asset");
    expect(other?.type).toBe("fixed_asset");
    expect(other?.chosen).toBe(true);
    // And an untouched word is still the matcher's reading, not marked.
    expect(readings.find((r) => r.source === "Expense")?.chosen).toBe(false);
  });

  it("has nothing to review when no type column is mapped", () => {
    expect(accountTypeReadings(ROWS, { ...MAPPING, account_type: null }, 1)).toEqual([]);
  });

  it("ignores a blank type cell rather than offering it as a word", () => {
    const rows = [...ROWS, ["9100", "Unset", "", "", "0"]];

    const readings = accountTypeReadings(rows, MAPPING, 1);

    expect(readings.map((r) => r.source)).not.toContain("");
  });
});
