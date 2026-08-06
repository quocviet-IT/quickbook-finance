import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsvGrid } from "@/lib/csv";
import {
  isWaveLedgerGrid,
  parseLedgerDate,
  parseLedgerMoney,
  parseWaveLedger,
  waveLedgerPayload,
} from "@/lib/domain/wave-ledger";

function fixture(name: string): string[][] {
  return parseCsvGrid(readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8"));
}

const grid = fixture("wave-account-transactions.csv");
const parse = parseWaveLedger(grid);

describe("parseLedgerMoney", () => {
  it("reads the shapes Wave writes", () => {
    expect(parseLedgerMoney("$1,200.00")).toBe(120000);
    expect(parseLedgerMoney("$0.00")).toBe(0);
    expect(parseLedgerMoney("")).toBe(0);
    expect(parseLedgerMoney("($45.50)")).toBe(-4550);
    expect(parseLedgerMoney("-$45.50")).toBe(-4550);
  });
});

describe("parseLedgerDate", () => {
  it("turns a US date into an ISO one", () => {
    expect(parseLedgerDate("8/29/2024")).toBe("2024-08-29");
    expect(parseLedgerDate("12/31/2022")).toBe("2022-12-31");
  });

  it("refuses anything that is not a date", () => {
    expect(parseLedgerDate("Totals and Ending Balance")).toBeNull();
    expect(parseLedgerDate("")).toBeNull();
  });
});

describe("isWaveLedgerGrid", () => {
  it("recognises the report by its header", () => {
    expect(isWaveLedgerGrid(grid)).toBe(true);
  });

  it("does not claim a plain transactions export", () => {
    expect(isWaveLedgerGrid([["Date", "Description", "Amount"], ["1/1/2023", "x", "1"]])).toBe(
      false,
    );
  });
});

describe("parseWaveLedger sections", () => {
  it("finds every account however the file names it", () => {
    expect(parse.sections.map((section) => section.account)).toEqual([
      "121 - Checking",
      "Opening Balance Equity",
      "Taxes – Corporate Tax",
      "Sales",
    ]);
  });

  it("ignores an account name repeated on a data row", () => {
    const sales = parse.sections.find((section) => section.account === "Sales");
    expect(sales?.rows).toBe(1);
    expect(sales?.creditMinor).toBe(5000);
  });

  it("agrees with the totals the file reports for itself", () => {
    expect(parse.sectionMismatches).toEqual([]);
    const checking = parse.sections.find((section) => section.account === "121 - Checking");
    expect(checking?.debitMinor).toBe(125000);
    expect(checking?.reportedDebitMinor).toBe(125000);
  });
});

describe("parseWaveLedger entries", () => {
  it("groups the rows by date", () => {
    expect(parse.entries.map((entry) => entry.date)).toEqual([
      "2023-01-02",
      "2023-01-03",
      "2023-02-01",
    ]);
  });

  it("makes every entry balance", () => {
    for (const entry of parse.entries) {
      expect(entry.lines.reduce((sum, line) => sum + line.signedMinor, 0)).toBe(0);
    }
    expect(parse.unbalancedDates).toEqual([]);
  });

  it("debits with a positive amount and credits with a negative one", () => {
    const january2 = parse.entries[0];
    expect(january2.lines).toEqual([
      { account: "121 - Checking", signedMinor: 120000, description: "Beginning Balance" },
      { account: "Opening Balance Equity", signedMinor: -120000, description: "Beginning Balance" },
    ]);
  });

  it("leaves out a row carrying no money and counts it", () => {
    expect(parse.skippedZeroRows).toBe(1);
    expect(parse.lineCount).toBe(6);
  });

  it("reports the range it covers", () => {
    expect(parse.fromDate).toBe("2023-01-02");
    expect(parse.toDate).toBe("2023-02-01");
    expect(parse.totalDebitMinor).toBe(155000);
  });
});

describe("parseWaveLedger balances", () => {
  it("nets each account, and the nets cancel out", () => {
    expect(parse.balances).toEqual([
      { account: "121 - Checking", signedMinor: 95000 },
      { account: "Opening Balance Equity", signedMinor: -120000 },
      { account: "Taxes – Corporate Tax", signedMinor: 30000 },
      { account: "Sales", signedMinor: -5000 },
    ]);
    expect(parse.balances.reduce((sum, line) => sum + line.signedMinor, 0)).toBe(0);
  });
});

describe("an unbalanced date", () => {
  it("is named rather than guessed at", () => {
    const bad = parseWaveLedger(fixture("wave-account-transactions-unbalanced.csv"));
    expect(bad.unbalancedDates).toEqual([{ date: "2023-03-01", differenceMinor: 4000 }]);
  });
});

describe("waveLedgerPayload", () => {
  it("sends the dated entries for the whole history", () => {
    const payload = waveLedgerPayload(parse, "history", "2023-12-31");
    expect(payload).toHaveLength(3);
    expect(payload[0].date).toBe("2023-01-02");
  });

  it("sends one entry as of the chosen date for balances", () => {
    const payload = waveLedgerPayload(parse, "balances", "2023-12-31");
    expect(payload).toHaveLength(1);
    expect(payload[0].date).toBe("2023-12-31");
    expect(payload[0].lines).toHaveLength(4);
    expect(payload[0].lines[0]).toEqual({
      account: "121 - Checking",
      signedMinor: 95000,
      description: "Closing balance",
    });
  });
});
