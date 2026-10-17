import { describe, expect, it } from "vitest";
import { buildExceptionReport, CHECK_LABEL, exceptionReportSheet, statementOverrideSentence, type ExceptionReportInput } from "@/lib/domain/exceptions";
import type { NamedStatementOverride } from "@/lib/domain/statement-overrides";

/** The twelfth check: statements imported out of balance (2.11). Invented data only. */
const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

const override = (over: Partial<NamedStatementOverride> = {}): NamedStatementOverride => ({
  batchId: "batch-1",
  bankAccountId: "b1",
  filename: "example-june.csv",
  importedAt: "2026-09-10T02:30:00Z",
  overriddenBy: "user-1",
  overriddenByName: "Dana Example",
  reason: "Bank confirmed its printed total is wrong",
  outByMinor: 1250,
  openingMinor: 100000,
  closingMinor: 150000,
  firstLineDate: "2026-09-01",
  lastLineDate: "2026-09-30",
  settledByReconciliationId: null,
  settledThrough: null,
  ...over,
});

const input = (over: Partial<ExceptionReportInput> = {}): ExceptionReportInput => ({
  to: "2026-09-30",
  today: "2026-09-26",
  accounts: [],
  bankAccounts: [{ bankAccountId: "b1", accountId: "g1", accountName: "Business Checking", lastReconciledDate: null }],
  yearTotals: [],
  entriesInRange: [],
  entriesAfterToday: [],
  paymentReferences: [],
  unavailable: [],
  timeZone: "America/Los_Angeles",
  ...over,
});

const meta = { companyName: "Riverbend Trading LLC", currencyCode: "USD", decimals: 2, from: "2026-01-01", to: "2026-09-30" };

describe("the statements imported out of balance check", () => {
  it("is named, and the report runs thirteen checks", () => {
    expect(CHECK_LABEL.statementOverride).toBe("Statements imported out of balance");
    expect(buildExceptionReport(input()).checksRun).toBe(13);
  });

  it("lists open overrides only", () => {
    const report = buildExceptionReport(
      input({
        statementOverrides: [
          override(),
          override({ batchId: "batch-2", settledByReconciliationId: "rec-1", settledThrough: "2026-09-30" }),
        ],
      }),
    );
    expect(report.statementOverride.map((r) => r.batchId)).toEqual(["batch-1"]);
    expect(report.questionsRaised).toBe(1);
  });

  it("lists two made on one day in the order they were made, not by their ids", () => {
    const report = buildExceptionReport(
      input({
        statementOverrides: [
          override({ batchId: "batch-a", importedAt: "2026-09-10T20:15:00Z" }),
          override({ batchId: "batch-z", importedAt: "2026-09-10T16:05:00Z" }),
        ],
      }),
    );
    expect(report.statementOverride.map((r) => r.batchId)).toEqual(["batch-z", "batch-a"]);
  });

  it("carries account, file, moment in the company's zone, person, shortfall, reason and the day it opened", () => {
    const [row] = buildExceptionReport(input({ statementOverrides: [override()] })).statementOverride;
    expect(row).toMatchObject({
      accountName: "Business Checking",
      filename: "example-june.csv",
      importedDay: "2026-09-09",
      importedDate: "Sep 9, 2026",
      importedTime: "7:30 PM",
      byName: "Dana Example",
      outByMinor: 1250,
      reason: "Bank confirmed its printed total is wrong",
      openSince: "2026-09-09",
    });
    expect(statementOverrideSentence(row, money)).toBe(
      "example-june.csv, imported Sep 9, 2026 at 7:30 PM by Dana Example, out by $12.50: “Bank confirmed its printed total is wrong”. Open since Sep 9, 2026.",
    );
  });

  it("lists the oldest first", () => {
    const report = buildExceptionReport(
      input({
        statementOverrides: [
          override({ batchId: "late", importedAt: "2026-09-20T12:00:00Z" }),
          override({ batchId: "early", importedAt: "2026-09-05T12:00:00Z" }),
        ],
      }),
    );
    expect(report.statementOverride.map((r) => r.batchId)).toEqual(["early", "late"]);
  });

  it("finds nothing when none is passed, and says Could not run when its read failed", () => {
    expect(buildExceptionReport(input()).statementOverride).toEqual([]);
    const failed = buildExceptionReport(input({ statementOverrides: [override()], unavailable: ["statementOverride"] }));
    expect(failed.statementOverride).toEqual([]);
    const rows = exceptionReportSheet(failed, meta).rows.filter((r) => r.check === CHECK_LABEL.statementOverride);
    expect(rows).toEqual([{ check: CHECK_LABEL.statementOverride, date: "", type: "", name: "Could not run", account: "", amount: null }]);
  });

  it("writes the same facts into the sheet", () => {
    const sheet = exceptionReportSheet(buildExceptionReport(input({ statementOverrides: [override()] })), meta);
    expect(sheet.rows.filter((r) => r.check === CHECK_LABEL.statementOverride)).toEqual([
      {
        check: CHECK_LABEL.statementOverride,
        date: "2026-09-09",
        type: "Imported out of balance",
        name: "example-june.csv, imported Sep 9, 2026 at 7:30 PM by Dana Example, out by $12.50: “Bank confirmed its printed total is wrong”. Open since Sep 9, 2026.",
        account: "Business Checking",
        amount: 12.5,
      },
    ]);
  });

  it("says Nothing found in the sheet when none is open", () => {
    const rows = exceptionReportSheet(buildExceptionReport(input()), meta).rows;
    expect(rows.find((r) => r.check === CHECK_LABEL.statementOverride)?.name).toBe("Nothing found");
  });

  it("names an account it cannot find rather than dropping the override", () => {
    const report = buildExceptionReport(input({ bankAccounts: [], statementOverrides: [override()] }));
    expect(report.statementOverride[0].accountName).toBe("Unknown account");
  });
});
