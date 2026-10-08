import { describe, expect, it } from "vitest";
import { changeLog, changeLogDetail, changeLogSheet, CHANGE_LOG_LIMIT, type ChangeLogEntry } from "@/lib/domain/change-log";
import { closeLog, closeLogSheet, type ClosePeriod } from "@/lib/domain/close-log";
import { reconciliationList, type SignedOffReconciliation } from "@/lib/domain/reconciliation-list";
import { checkWhen } from "@/lib/domain/report-run";
import { dateInTimeZone, stampInTimeZone } from "@/lib/domain/stamp";
import { voidedEntries, voidedEntriesSheet, type ReversedEntry, type VoidedEntry } from "@/lib/domain/voided-entries";

describe("reconciliationList", () => {
  const session = (over: Partial<SignedOffReconciliation>): SignedOffReconciliation => ({
    id: "r1",
    bankAccountId: "b1",
    bankAccountName: "1010 — Operating",
    statementEndingDate: "2026-08-31",
    statementEndingBalanceMinor: 100_000,
    completedAt: "2026-09-02T15:00:00Z",
    completedByName: "Example Person",
    ...over,
  });

  it("still agrees when no ticked entry has been voided, and is out by the voided lines otherwise", () => {
    const report = reconciliationList(
      [session({ id: "r1" }), session({ id: "r2", statementEndingDate: "2026-09-30" })],
      [
        { reconciliationId: "r2", entryNumber: "JE-000012", signedMinor: 2_500 },
        { reconciliationId: "r2", entryNumber: "JE-000009", signedMinor: -500 },
      ],
    );
    expect(report.lines.map((l) => [l.id, l.stillAgrees, l.differenceMinor])).toEqual([
      ["r2", false, 2_000],
      ["r1", true, 0],
    ]);
    expect(report.lines[0].voidedEntries).toEqual(["JE-000009", "JE-000012"]);
    expect(report.outOfAgreement).toBe(1);
  });

  it("groups by bank account, newest statement first within each", () => {
    const report = reconciliationList(
      [
        session({ id: "s1", bankAccountId: "b2", bankAccountName: "1020 — Savings", statementEndingDate: "2026-07-31" }),
        session({ id: "o1", statementEndingDate: "2026-07-31" }),
        session({ id: "o2", statementEndingDate: "2026-08-31" }),
      ],
      [],
    );
    expect(report.lines.map((l) => l.id)).toEqual(["o2", "o1", "s1"]);
  });
});

describe("closeLog", () => {
  const periods: ClosePeriod[] = [
    { id: "p2", label: "Feb 2026", periodStart: "2026-02-01", status: "open" },
    { id: "p1", label: "Jan 2026", periodStart: "2026-01-01", status: "closed" },
  ];

  it("lists each month's closes and reopens in order, and a month never closed as Open", () => {
    const report = closeLog(periods, [
      { periodId: "p1", event: "reopen", reason: "Late bill", actorName: "Example Person", createdAt: "2026-02-10T09:00:00Z" },
      { periodId: "p1", event: "close", reason: "", actorName: "Example Person", createdAt: "2026-02-03T09:00:00Z" },
      { periodId: "p1", event: "close", reason: "Bill entered", actorName: null, createdAt: "2026-02-11T09:00:00Z" },
    ]);
    expect(report.lines.map((l) => [l.month, l.monthStart, l.event, l.reason])).toEqual([
      ["Jan 2026", true, "Closed", null],
      ["Jan 2026", false, "Reopened", "Late bill"],
      ["Jan 2026", false, "Closed", "Bill entered"],
      ["Feb 2026", true, "Open", null],
    ]);
    expect(report.closedMonths).toBe(1);
    expect(report.reopenings).toBe(1);
  });

  it("exports the times in the company's time zone", () => {
    const sheet = closeLogSheet(
      closeLog(periods.slice(1), [{ periodId: "p1", event: "close", reason: "", actorName: null, createdAt: "2026-02-03T23:30:00Z" }]),
      { companyName: "Example Co", fiscalYear: 2026, currencyCode: "USD", timeZone: "America/New_York" },
    );
    expect(sheet.rows[0]).toMatchObject({ month: "Jan 2026", event: "Closed", at: "2026-02-03 18:30" });
  });
});

describe("voidedEntries", () => {
  const voided = (over: Partial<VoidedEntry>): VoidedEntry => ({
    entryId: "v1",
    entryNumber: "JE-000100",
    entryDate: "2026-09-10",
    description: "Invoice INV-1",
    amountMinor: 50_000,
    voidedAt: "2026-09-12T14:00:00Z",
    byName: null,
    ...over,
  });
  const reversed: ReversedEntry = {
    originalEntryId: "o1",
    originalNumber: "JE-000090",
    originalDate: "2026-09-01",
    description: "Rent posted twice",
    amountMinor: 120_000,
    reversalEntryId: "rv1",
    reversalNumber: "JE-000091",
    reason: "Posted twice",
    reversedAt: "2026-09-20T10:00:00Z",
    byName: "Example Person",
  };

  it("lists voids and reversals in the period, newest first", () => {
    const report = voidedEntries([voided({})], [reversed], { from: "2026-09-01", to: "2026-09-30" }, "UTC");
    expect(report.lines.map((l) => [l.action, l.entryNumber, l.reversalNumber, l.reason])).toEqual([
      ["Reversed", "JE-000090", "JE-000091", "Posted twice"],
      ["Voided", "JE-000100", null, null],
    ]);
    expect([report.voided, report.reversed]).toEqual([1, 1]);
  });

  it("dates by the void, in the company's time zone, not by the entry", () => {
    // 01:30 UTC on Oct 1 is still Sept 30 in New York.
    const late = voided({ voidedAt: "2026-10-01T01:30:00Z" });
    expect(voidedEntries([late], [], { from: "2026-09-01", to: "2026-09-30" }, "America/New_York").voided).toBe(1);
    expect(voidedEntries([late], [], { from: "2026-09-01", to: "2026-09-30" }, "UTC").voided).toBe(0);
  });

  it("dates a void the books did not time by its entry, and says so on export", () => {
    const untimed = voided({ voidedAt: null, entryDate: "2026-09-05" });
    const report = voidedEntries([untimed], [], { from: "2026-09-01", to: "2026-09-30" }, "UTC");
    expect(report.lines[0].actedAt).toBeNull();
    const sheet = voidedEntriesSheet(report, { companyName: "Example Co", from: "2026-09-01", to: "2026-09-30", currencyCode: "USD", baseDecimals: 2, timeZone: "UTC" });
    expect(sheet.rows[0]).toMatchObject({ entry: "JE-000100", action: "Voided", at: "Not recorded", amount: 500 });
  });
});

describe("changeLog", () => {
  const entry = (id: string, at: string): ChangeLogEntry => ({ id, at, who: "Example Person", what: "Updated", record: "Invoice", reference: "INV-1", detail: "memo: a → b" });

  it("orders newest first, and says when the audit search hit its ceiling", () => {
    const report = changeLog([entry("a", "2026-09-01T10:00:00Z"), entry("b", "2026-09-02T10:00:00Z")]);
    expect(report.lines.map((l) => l.id)).toEqual(["b", "a"]);
    expect(report.truncated).toBe(false);
    const full = changeLog(Array.from({ length: CHANGE_LOG_LIMIT }, (_, i) => entry(String(i), "2026-09-01T10:00:00Z")));
    expect(full.truncated).toBe(true);
  });

  it("exports the record with its reference, at the company's time", () => {
    const sheet = changeLogSheet(changeLog([entry("a", "2026-09-01T10:00:00Z")]), {
      companyName: "Example Co",
      from: "2026-09-01",
      to: "2026-09-30",
      currencyCode: "USD",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    expect(sheet.rows[0]).toEqual({ at: "2026-09-01 17:00", who: "Example Person", what: "Updated", record: "Invoice INV-1", detail: "memo: a → b" });
  });
});

describe("changeLogDetail", () => {
  it("shows what changed, before and after, leaving ids, links and stamps out", () => {
    expect(
      changeLogDetail({
        before_json: { id: "1", status: "draft", memo: "a", customer_id: "c", updated_at: "x" },
        after_json: { id: "1", status: "issued", memo: "a", customer_id: "c2", updated_at: "y" },
      }),
    ).toBe("status: draft → issued");
  });

  it("says what a new record holds, without a column of arrows from nothing", () => {
    expect(
      changeLogDetail({
        before_json: null,
        after_json: { id: "1", account_code: "1087", name: "Sample Feed", account_type: "bank", currency_code: "USD", created_by: "u" },
      }),
    ).toBe("account_code: 1087; account_type: bank; currency_code: USD (+1 more)");
  });

  it("cuts a long value, and is empty when nothing a reader needs changed", () => {
    const long = "x".repeat(60);
    expect(changeLogDetail({ before_json: { note: "" }, after_json: { note: long } })).toBe(`note: (empty) → ${"x".repeat(40)}…`);
    expect(changeLogDetail({ before_json: { id: "1", updated_at: "a" }, after_json: { id: "1", updated_at: "b" } })).toBe("");
  });
});

describe("stamps", () => {
  it("reads a moment on the company's clock", () => {
    expect(stampInTimeZone("2026-10-08T04:47:28Z", "Asia/Ho_Chi_Minh")).toBe("2026-10-08 11:47");
    expect(dateInTimeZone("2026-10-01T01:30:00Z", "America/New_York")).toBe("2026-09-30");
  });
});

describe("checkWhen", () => {
  it("accepts real dates in order, and a fiscal year in range", () => {
    expect(checkWhen({ from: "2026-01-01", to: "2026-10-08" }, "range")).toEqual({ from: "2026-01-01", to: "2026-10-08", fiscalYear: null });
    expect(checkWhen({ to: "2026-10-08" }, "asOf")).toEqual({ from: null, to: "2026-10-08", fiscalYear: null });
    expect(checkWhen({ fiscalYear: 2026 }, "fiscalYear")).toEqual({ from: null, to: "", fiscalYear: 2026 });
  });

  it("refuses anything else before a query runs", () => {
    expect(() => checkWhen({ from: "2026-10-08", to: "2026-01-01" }, "range")).toThrow("The start date is after the end date.");
    expect(() => checkWhen({ to: "2026-13-40" }, "asOf")).toThrow("Choose the date the report runs to.");
    expect(() => checkWhen({ to: "2026-10-08'; drop" }, "asOf")).toThrow();
    expect(() => checkWhen({ fiscalYear: 1999 }, "fiscalYear")).toThrow("Choose a fiscal year between 2000 and 2100.");
    expect(() => checkWhen(null, "range")).toThrow();
  });
});
