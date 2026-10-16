import { afterEach, describe, expect, it } from "vitest";
import {
  importRecordDetail,
  importRecordDetailOf,
  overrideFacts,
  overrideMoment,
  overrideStatus,
  reconciliationNotice,
  reconciliationReportLine,
  type NamedStatementOverride,
} from "@/lib/domain/statement-overrides";
import { overrideFromRecord } from "@/lib/services/statement-overrides";

/** Statements imported out of balance (2.11). Every name, file and amount here is invented. */
const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

const override = (over: Partial<NamedStatementOverride> = {}): NamedStatementOverride => ({
  batchId: "batch-1",
  bankAccountId: "bank-1",
  filename: "example-june.csv",
  importedAt: "2026-10-08T18:47:00Z",
  overriddenBy: "user-1",
  overriddenByName: "Dana Example",
  reason: "Bank confirmed its printed total is wrong",
  outByMinor: 1234,
  openingMinor: 100000,
  closingMinor: 150000,
  firstLineDate: "2026-09-01",
  lastLineDate: "2026-09-30",
  settledByReconciliationId: null,
  settledThrough: null,
  ...over,
});

describe("an override's status", () => {
  it("is open until the database names the reconciliation that settled it", () => {
    expect(overrideStatus(override())).toBe("open");
  });

  it("is settled once it does, whatever the dates say", () => {
    expect(overrideStatus(override({ settledByReconciliationId: "rec-1", settledThrough: "2026-09-30" }))).toBe("settled");
    // The edge: a reconciliation ending on the last line's day settles it, and the database says so.
    expect(overrideStatus(override({ lastLineDate: "2026-09-30", settledByReconciliationId: "rec-1", settledThrough: "2026-09-30" }))).toBe("settled");
  });

  it("is not recomputed here: a reconciliation date without an id leaves it open", () => {
    expect(overrideStatus(override({ settledThrough: "2026-10-31" }))).toBe("open");
    expect(overrideStatus(override({ lastLineDate: null }))).toBe("open");
  });
});

describe("the three sentences", () => {
  const facts = overrideFacts(override(), "America/New_York");

  it("prints the moment in the company's time zone", () => {
    expect(facts).toEqual({ outByMinor: 1234, name: "Dana Example", date: "Oct 8, 2026", time: "14:47", reason: "Bank confirmed its printed total is wrong" });
  });

  it("reads the import record while open", () => {
    expect(importRecordDetailOf(override(), "America/New_York", money)).toBe(
      "Out by $12.34. Imported by Dana Example on Oct 8, 2026 at 14:47: “Bank confirmed its printed total is wrong”. Open until a reconciliation through Sep 30, 2026 is completed.",
    );
  });

  it("reads the import record once settled", () => {
    const settled = override({ settledByReconciliationId: "rec-1", settledThrough: "2026-10-15" });
    expect(importRecordDetailOf(settled, "America/New_York", money)).toBe(
      "Out by $12.34. Imported by Dana Example on Oct 8, 2026 at 14:47: “Bank confirmed its printed total is wrong”. Settled by the reconciliation to Oct 15, 2026.",
    );
  });

  it("does not invent a date for an import with no lines", () => {
    expect(importRecordDetail(facts, { status: "open", lastLineDate: null }, money)).toMatch(/Open until a reconciliation is completed\.$/);
  });

  it("reads the notice above a reconciliation in progress", () => {
    expect(reconciliationNotice(facts, money)).toBe(
      "A statement in this period was imported out of balance: out by $12.34, by Dana Example on Oct 8, 2026, “Bank confirmed its printed total is wrong”. Completing this reconciliation settles it.",
    );
  });

  it("reads the line in the report of the reconciliation that settled it", () => {
    expect(reconciliationReportLine(facts, money)).toBe(
      "Settles a statement imported out of balance: out by $12.34, by Dana Example on Oct 8, 2026, “Bank confirmed its printed total is wrong”.",
    );
  });
});

describe("the company's time zone, not the machine's", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it("gives the same text whatever TZ the process runs under", () => {
    const readings = ["UTC", "Asia/Tokyo", "America/Los_Angeles"].map((tz) => {
      process.env.TZ = tz;
      return overrideMoment("2026-10-08T03:30:00Z", "America/New_York");
    });
    for (const reading of readings) expect(reading).toEqual({ date: "Oct 7, 2026", time: "23:30" });
  });

  it("follows the company's zone across midnight", () => {
    expect(overrideMoment("2026-10-08T03:30:00Z", "America/New_York")).toEqual({ date: "Oct 7, 2026", time: "23:30" });
    expect(overrideMoment("2026-10-08T03:30:00Z", "Asia/Tokyo")).toEqual({ date: "Oct 8, 2026", time: "12:30" });
  });
});

describe("a row of acc_statement_overrides()", () => {
  it("reads bigint strings as numbers and a missing settlement as null", () => {
    const row = overrideFromRecord({
      batch_id: "b",
      bank_account_id: "a",
      filename: "f.csv",
      imported_at: "2026-10-08T18:47:00Z",
      overridden_by: "u",
      override_reason: "r",
      out_by_minor: "-1250",
      statement_opening_minor: "100000",
      statement_closing_minor: "150000",
      first_line_date: null,
      last_line_date: null,
      settled_by_reconciliation_id: null,
      settled_through: null,
    });
    expect(row).toMatchObject({ outByMinor: -1250, openingMinor: 100000, closingMinor: 150000, firstLineDate: null, settledThrough: null });
  });
});
