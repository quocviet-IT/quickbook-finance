import { describe, expect, it } from "vitest";
import {
  buildReconciliationReport,
  reconLineDescription,
  reconciliationProof,
  reconciliationReportSheet,
  reconciliationSummaryRows,
  type ReconReportInput,
  type ReconReportLine,
} from "@/lib/domain/reconciliation-report";
import { linesToTick } from "@/lib/domain/reconcile-ticks";

const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;

let n = 0;
const line = (signedMinor: number, cleared: boolean, extra: Partial<ReconReportLine> = {}): ReconReportLine => ({
  journalLineId: `l${++n}`,
  entryId: `e${n}`,
  entryNumber: `JE-${n}`,
  entryDate: "2026-09-15",
  sourceType: "journal",
  memo: null,
  reference: null,
  signedMinor,
  cleared,
  ...extra,
});

// Opening 1,000.00. Cleared on the statement: +500.00, -200.00, so it closes at 1,300.00.
// Outstanding at the date: a 75.00 deposit and a 25.00 check: the books say 1,350.00.
const base = (): ReconReportInput => ({
  completed: true,
  statementDate: "2026-09-30",
  beginningMinor: 100_000,
  statementEndingMinor: 130_000,
  bookBalanceMinor: 135_000,
  lines: [line(50_000, true), line(-20_000, true), line(7_500, false), line(-2_500, false, { reference: "1042" })],
  adjustmentEntryId: null,
  adjustmentReason: null,
  note: null,
});

describe("the reconciliation report, as the approved design sets it out", () => {
  it("splits the lines into the four halves, in the design's order, with their totals", () => {
    const report = buildReconciliationReport(base());
    expect(report.sections.map((s) => [s.key, s.lines.length, s.totalMinor])).toEqual([
      ["cleared-in", 1, 50_000],
      ["cleared-out", 1, -20_000],
      ["outstanding-in", 1, 7_500],
      ["outstanding-out", 1, -2_500],
    ]);
    expect(report.sections.map((s) => s.title)).toEqual([
      "Cleared deposits and other credits",
      "Cleared payments and checks",
      "Deposits in the books, not yet on the statement",
      "Payments in the books, not yet on the statement",
    ]);
  });

  it("proves out when the ticked lines come to the closing balance and the bridge comes to the books", () => {
    const input = base();
    const report = buildReconciliationReport(input);
    expect(report.clearedBalanceMinor).toBe(130_000);
    expect(report.bridgedBookMinor).toBe(135_000);
    expect(report.provesOut).toBe(true);
    const proof = reconciliationProof(report, input, money);
    expect(proof.headline).toBe("This reconciliation proves out.");
    expect(proof.detail).toContain("comes to $1350.00, which is exactly the balance in the books on 09/30/2026.");
  });

  it("says a ticked entry has been changed since sign-off, and how far it is out", () => {
    const input = base();
    input.lines = [line(49_000, true), ...input.lines.slice(1)];
    const report = buildReconciliationReport(input);
    expect(report.statementAgrees).toBe(false);
    expect(report.provesOut).toBe(false);
    const rows = reconciliationSummaryRows(report, input);
    expect(rows.find((r) => r.key === "cleared-now")).toMatchObject({ kind: "warning", amountMinor: 129_000 });
    const proof = reconciliationProof(report, input, money);
    expect(proof.headline).toBe("This reconciliation no longer proves out.");
    expect(proof.detail).toContain("now come to $1290.00 against the $1300.00 signed off, a difference of -$10.00");
  });

  it("says when an entry dated before the statement was added or changed in the books since", () => {
    const input = { ...base(), bookBalanceMinor: 136_000 };
    const report = buildReconciliationReport(input);
    expect(report.statementAgrees).toBe(true);
    expect(report.booksAgree).toBe(false);
    const warnings = reconciliationSummaryRows(report, input).filter((r) => r.kind === "warning");
    expect(warnings.map((r) => [r.label, r.amountMinor])).toEqual([["What the books say at 09/30/2026", 136_000]]);
    expect(reconciliationProof(report, input, money).detail).toContain("but the books say $1360.00 on that date, a difference of $10.00");
  });

  it("names the adjustment that closed the difference, and how it was signed off", () => {
    const input = base();
    input.lines = [...input.lines, line(-300, true, { entryId: "adj" })];
    input.statementEndingMinor = 129_700;
    input.bookBalanceMinor = 134_700;
    input.adjustmentEntryId = "adj";
    input.adjustmentReason = "Bank fee not in the books";
    input.note = "Agreed against the bank statements.";
    const report = buildReconciliationReport(input);
    expect(report.adjustmentMinor).toBe(-300);
    expect(report.provesOut).toBe(true);
    const { detail } = reconciliationProof(report, input, money);
    expect(detail).toContain("An adjustment of -$3.00 was posted to close the difference on the day: Bank fee not in the books.");
    expect(detail).toContain("How it was signed off: Agreed against the bank statements.");
    expect(detail).not.toContain("..");
  });

  it("speaks of a reconciliation still in progress as one, never as proved", () => {
    const input = { ...base(), completed: false, statementEndingMinor: 131_000 };
    const report = buildReconciliationReport(input);
    const proof = reconciliationProof(report, input, money);
    expect(proof.headline).toBe("This reconciliation is still in progress.");
    expect(proof.detail).toContain("a difference of $10.00");
    expect(reconciliationSummaryRows(report, input).find((r) => r.key === "cleared-now")?.label).toBe(
      "What the lines ticked so far come to",
    );
  });

  it("lays the bridge out top to bottom: the bank's half, then the books'", () => {
    const input = base();
    const rows = reconciliationSummaryRows(buildReconciliationReport(input), input);
    expect(rows.map((r) => r.label)).toEqual([
      "Statement opening balance",
      "Deposits and other credits cleared (1)",
      "Payments and checks cleared (1)",
      "Statement closing balance",
      "Deposits not yet on the statement (1)",
      "Payments not yet on the statement (1)",
      "Balance in the books at 09/30/2026",
    ]);
    expect(rows.filter((r) => r.kind === "total").map((r) => r.amountMinor)).toEqual([130_000, 135_000]);
    expect(rows.find((r) => r.gapBefore)?.key).toBe("outstanding-in");
  });

  it("exports the bridge, then every half's lines and total", () => {
    const input = base();
    const sheet = reconciliationReportSheet(buildReconciliationReport(input), input, {
      companyName: "Sample Co",
      accountLabel: "Sample Bank · 1010",
      currencyCode: "USD",
      baseDecimals: 2,
    });
    expect(sheet.title).toBe("Reconciliation Report");
    expect(sheet.subtitle).toBe("Sample Bank · 1010 · statement of 09/30/2026");
    expect(sheet.rows.filter((r) => r.section === "Summary")).toHaveLength(7);
    const totals = sheet.rows.filter((r) => String(r.description).startsWith("Total, "));
    expect(totals.map((r) => r.amount)).toEqual([500, -200, 75, -25]);
    expect(sheet.rows.find((r) => r.reference === "1042")).toMatchObject({ amount: -25, description: "", entry: expect.stringMatching(/^Journal JE-\d+$/) });
  });

  it("describes a line by its memo, and never repeats where it came from", () => {
    expect(reconLineDescription(line(1, true, { memo: "  Deposit  " }))).toBe("Deposit");
    expect(reconLineDescription(line(1, true, { sourceType: "payment" }))).toBe("");
  });
});

describe("Tick everything shown and Clear the ticks", () => {
  const lines = [
    { journalLineId: "a", cleared: true },
    { journalLineId: "b", cleared: false },
    { journalLineId: "c", cleared: false },
  ];

  it("sends only the lines whose tick changes", () => {
    expect(linesToTick(lines, true)).toEqual(["b", "c"]);
    expect(linesToTick(lines, false)).toEqual(["a"]);
    expect(linesToTick([], true)).toEqual([]);
  });
});
