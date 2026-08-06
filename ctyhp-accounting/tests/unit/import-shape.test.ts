import { describe, expect, it } from "vitest";
import { fieldsFor, type ImportTarget } from "@/lib/domain/import-mapping";
import {
  describeShapeMismatch,
  detectFileShape,
  templateCsvFor,
} from "@/lib/domain/import-shape";

const TARGETS: ImportTarget[] = [
  "chart_of_accounts",
  "customers",
  "vendors",
  "items",
  "invoices",
  "transactions",
];

/** The headers of the file attached to feedback report 428ca4db. */
const WAVE_ACCOUNT_TRANSACTIONS = [
  "ACCOUNT NUMBER",
  "DATE",
  "DESCRIPTION",
  "DEBIT (In Business Currency)",
  "CREDIT (In Business Currency)",
  "BALANCE (In Business Currency)",
];

const QUICKBOOKS_CHART = ["Account Number", "Account Name", "Type", "Description", "Balance"];

describe("templateCsvFor", () => {
  it("writes the header row from the mapper's own labels, for every target", () => {
    for (const target of TARGETS) {
      const [header, example, ...rest] = templateCsvFor(target).trim().split("\n");
      const labels = fieldsFor(target).map((field) => field.label);
      expect(header.split(",").length, target).toBe(labels.length);
      expect(example.split(",").length, target).toBe(labels.length);
      expect(rest, target).toEqual([]);
      // Derived, not a second list: every label appears in the header row.
      for (const label of labels) expect(header, `${target}/${label}`).toContain(label);
    }
  });

  it("answers the report's question with a chart of accounts example", () => {
    const csv = templateCsvFor("chart_of_accounts");
    expect(csv).toContain("Account code");
    expect(csv).toContain("121");
  });
});

describe("detectFileShape", () => {
  it("recognises the file from the report as Wave's account transactions", () => {
    const detection = detectFileShape(WAVE_ACCOUNT_TRANSACTIONS);

    expect(detection.looksLikeLedgerDetail).toBe(true);
    expect(detection.looksLikeWaveAccountTransactions).toBe(true);
    // It must not claim this is a chart of accounts; that belief is the bug.
    expect(detection.target).not.toBe("chart_of_accounts");
    expect(detection.matchedRequired).toBeLessThan(detection.requiredTotal);
  });

  it("keeps ledger detail and the Wave report as two separate signals", () => {
    const noBalance = detectFileShape(["Account", "Date", "Description", "Debit", "Credit"]);

    expect(noBalance.looksLikeLedgerDetail).toBe(true);
    expect(noBalance.looksLikeWaveAccountTransactions).toBe(false);
  });

  it("recognises a genuine chart of accounts export", () => {
    const detection = detectFileShape(QUICKBOOKS_CHART);

    expect(detection.target).toBe("chart_of_accounts");
    expect(detection.matchedRequired).toBe(detection.requiredTotal);
    expect(detection.looksLikeLedgerDetail).toBe(false);
  });

  it("guesses nothing rather than wrongly, for an unrecognisable file", () => {
    const detection = detectFileShape(["foo", "bar", "baz"]);

    expect(detection.target).toBeNull();
    expect(detection.looksLikeLedgerDetail).toBe(false);
    expect(detection.looksLikeWaveAccountTransactions).toBe(false);
  });

  it("says nothing about an empty file", () => {
    const detection = detectFileShape([]);

    expect(detection.target).toBeNull();
    expect(detection.looksLikeWaveAccountTransactions).toBe(false);
  });
});

describe("describeShapeMismatch", () => {
  it("stays quiet when the file and the tab agree", () => {
    expect(describeShapeMismatch("chart_of_accounts", detectFileShape(QUICKBOOKS_CHART))).toBeNull();
  });

  it("names the Wave report and says it has no tab yet", () => {
    const message = describeShapeMismatch(
      "chart_of_accounts",
      detectFileShape(WAVE_ACCOUNT_TRANSACTIONS),
    );

    expect(message).toBeTruthy();
    expect(message).toMatch(/one row per transaction/i);
    expect(message).toMatch(/chart of accounts/i);
  });

  it("points at the tab a recognised file belongs in", () => {
    const message = describeShapeMismatch("customers", detectFileShape(QUICKBOOKS_CHART));

    expect(message).toMatch(/chart of accounts/i);
  });
});
