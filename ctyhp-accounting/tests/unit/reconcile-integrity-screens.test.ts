import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fitsBox } from "@/lib/design/table-metrics";
import {
  CHANGED_ELASTIC_FLOOR,
  CHANGED_FIXED_WIDTHS,
  CHANGED_MIN_WIDTH,
  TRANSFER_ELASTIC_FLOOR,
  TRANSFER_FIXED_WIDTHS,
  TRANSFER_MIN_WIDTH,
} from "@/app/(app)/reports/exceptions/integrity-columns";
import {
  CHECK_LABEL,
  buildExceptionReport,
  exceptionReportSheet,
  type ExceptionBankAccount,
  type ExceptionReportInput,
} from "@/lib/domain/exceptions";
import { describeStanding, reconcileCard, toBankStanding, withReconciliationChanges, type BankStanding } from "@/lib/domain/bank-standing";
import type { ReconciliationChange } from "@/lib/domain/reconciliation-changes";
import type { TransferRow } from "@/lib/domain/transfer-legs";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

describe("the reconciliation-integrity tables", () => {
  it("fit the 1280 box", () => {
    expect(fitsBox(CHANGED_FIXED_WIDTHS.reduce((a, b) => a + b, 0), CHANGED_ELASTIC_FLOOR)).toBe(true);
    expect(fitsBox(TRANSFER_FIXED_WIDTHS.reduce((a, b) => a + b, 0), TRANSFER_ELASTIC_FLOOR)).toBe(true);
  });

  it("give every text column a floor and the amount the wide money column", () => {
    const source = read("app/(app)/reports/exceptions/ExceptionsClient.tsx");
    for (const floor of ["CHANGED_ACCOUNT_FLOOR", "CHANGED_SENTENCES_FLOOR", "TRANSFER_CLEARED_FLOOR", "TRANSFER_OPEN_FLOOR", "TRANSFER_DESTINATION_FLOOR"]) {
      expect(source).toContain(`floor: ${floor}`);
    }
    expect(source).toMatch(/key: "amount", width: COLUMN\.MONEY_WIDE/);
    expect(source).not.toMatch(/scroll=\{\{\s*x/);
  });

  it("are held to their measured width on a phone and scroll in their own box", () => {
    const css = read("app/(app)/reports/exceptions/integrity-tables.module.css");
    expect(css).toContain(`min-width: ${CHANGED_MIN_WIDTH}px;`);
    expect(css).toContain(`min-width: ${TRANSFER_MIN_WIDTH}px;`);
    expect(css).toMatch(/\.changedTable[^{]*ant-table-content/);
    expect(css).toMatch(/\.transferTable[^{]*ant-table-content/);
    const source = read("app/(app)/reports/exceptions/ExceptionsClient.tsx");
    expect(source).toContain("integrityStyles.changedTable");
    expect(source).toContain("integrityStyles.transferTable");
  });

  it("print their dates from the row, never from a clock", () => {
    const source = read("app/(app)/reports/exceptions/ExceptionsClient.tsx");
    const section = source.slice(source.indexOf("CHECK_LABEL.noLongerAgree"), source.indexOf("CHECK_LABEL.futureDated"));
    expect(section).not.toMatch(/new Date|toLocale|Date\.now/);
  });
});

const banks: ExceptionBankAccount[] = [
  { bankAccountId: "b-chk", accountId: "a-chk", accountName: "Example Checking", lastReconciledDate: null },
  { bankAccountId: "b-sav", accountId: "a-sav", accountName: "Example Savings", lastReconciledDate: null },
  { bankAccountId: "b-res", accountId: "a-res", accountName: "Example Reserve", lastReconciledDate: null },
];

const emptyInput = (over: Partial<ExceptionReportInput> = {}): ExceptionReportInput => ({
  to: "2026-09-30",
  today: "2026-09-01",
  accounts: [],
  bankAccounts: banks,
  yearTotals: [],
  entriesInRange: [],
  entriesAfterToday: [],
  paymentReferences: [],
  unavailable: [],
  ...over,
});

const transferRow = (over: Partial<TransferRow>): TransferRow => ({
  rowKey: "",
  rowKind: "leg",
  entryId: "t1",
  entryNumber: "JE-900001",
  entryDate: "2026-06-10",
  bankAccountId: null,
  journalLineId: null,
  signedMinor: null,
  tickedReconciliationId: null,
  tickedStatementDate: null,
  coveredThrough: "2026-06-30",
  candidateSource: null,
  candidateId: null,
  candidateBankAccountId: null,
  candidateDate: null,
  candidateEntryId: null,
  candidateEntryNumber: null,
  reversedByEntryId: null,
  reversedByEntryNumber: null,
  reversalOfEntryId: null,
  ...over,
});

/** The reviewer's regression, with invented accounts and amounts. */
const sending = transferRow({ rowKey: "leg:1", bankAccountId: "b-chk", journalLineId: "l1", signedMinor: -100000, tickedReconciliationId: "r1", tickedStatementDate: "2026-06-30" });
const receiving = transferRow({ rowKey: "leg:2", bankAccountId: "b-sav", journalLineId: "l2", signedMinor: 100000 });
const evidence = transferRow({
  rowKey: "candidate:l2:ledger_line:c",
  rowKind: "candidate",
  bankAccountId: "b-sav",
  journalLineId: "l2",
  signedMinor: 100000,
  candidateSource: "ledger_line",
  candidateId: "c",
  candidateBankAccountId: "b-res",
  candidateDate: "2026-06-10",
  candidateEntryId: "e2",
  candidateEntryNumber: "JE-900002",
});
const correction = [
  transferRow({ rowKey: "leg:3", entryId: "t3", entryNumber: "JE-900003", entryDate: "2026-06-13", bankAccountId: "b-sav", journalLineId: "l3", signedMinor: -100000 }),
  transferRow({ rowKey: "leg:4", entryId: "t3", entryNumber: "JE-900003", entryDate: "2026-06-13", bankAccountId: "b-res", journalLineId: "l4", signedMinor: 100000 }),
];
const meta = { companyName: "Example Trading LLC", currencyCode: "USD", decimals: 2, from: "2026-01-01", to: "2026-09-30" };

describe("Transfers cleared on one side only, through the report", () => {
  it("is named once and counted among the thirteen", () => {
    expect(CHECK_LABEL.transferOneSide).toBe("Transfers cleared on one side only");
    expect(buildExceptionReport(emptyInput()).checksRun).toBe(13);
  });

  it("fixture A: before the correction there is one question, naming the third account", () => {
    const report = buildExceptionReport(emptyInput({ transferRows: [sending, receiving, evidence] }));
    expect(report.transferOneSide).toHaveLength(1);
    expect(report.questionsRaised).toBe(1);
    expect(report.transferOneSide[0]).toMatchObject({
      entryNumber: "JE-900001",
      clearedAccountName: "Example Checking",
      openAccountName: "Example Savings",
      destinationName: "Example Reserve",
    });
    const sheet = exceptionReportSheet(report, meta).rows.find((r) => r.check === CHECK_LABEL.transferOneSide);
    expect(sheet?.name).toBe(
      "JE-900001 cleared on Example Checking (Jun 30, 2026 statement) and not on Example Savings. Likely went to Example Reserve (1 candidate found).",
    );
    expect(sheet?.amount).toBe(1000);
  });

  it("fixture B: after the correction there is no question, and the correcting entry is named", () => {
    const report = buildExceptionReport(emptyInput({ transferRows: [sending, receiving, evidence, ...correction] }));
    expect(report.transferOneSide).toEqual([]);
    expect(report.questionsRaised).toBe(0);
    expect(report.transferSummary.corrected).toHaveLength(1);
    expect(report.transferSummary.corrected[0]).toMatchObject({
      entryNumber: "JE-900001",
      correctingEntryNumber: "JE-900003",
      movedToName: "Example Reserve",
    });
    expect(JSON.stringify(exceptionReportSheet(report, meta))).not.toMatch(/revers/i);
  });

  it("fixture C: statements that stop short are counted, not flagged", () => {
    const short = transferRow({ ...receiving, coveredThrough: "2026-05-31" });
    const report = buildExceptionReport(emptyInput({ transferRows: [sending, short] }));
    expect(report.transferOneSide).toEqual([]);
    expect(report.transferSummary.notYetCheckable).toBe(1);
    expect(report.questionsRaised).toBe(0);
  });

  it("names an account the list does not hold instead of dropping the transfer", () => {
    const report = buildExceptionReport(emptyInput({ bankAccounts: [banks[0]], transferRows: [sending, receiving] }));
    expect(report.transferOneSide[0].openAccountName).toBe("A bank account not on the list");
  });

  it("finds nothing when the check could not run, and says so in the sheet", () => {
    const report = buildExceptionReport(emptyInput({ unavailable: ["transferOneSide"], transferRows: [sending, receiving] }));
    expect(report.transferOneSide).toEqual([]);
    const row = exceptionReportSheet(report, meta).rows.find((r) => r.check === CHECK_LABEL.transferOneSide);
    expect(row?.name).toBe("Could not run");
  });
});

describe("the No longer agrees badge counts what the Exceptions check lists", () => {
  const standing = (id: string, over: Record<string, unknown> = {}): BankStanding =>
    toBankStanding({ bank_account_id: id, last_completed_date: "2026-06-30", last_closing_minor: "100000", book_minor: "100000", ...over });

  const change = (over: Partial<ReconciliationChange> & Pick<ReconciliationChange, "kind" | "reconciliationId" | "bankAccountId">): ReconciliationChange => ({
    changeKey: `${over.kind}:${over.reconciliationId}`,
    statementEndingDate: "2026-06-30",
    completedAt: "2026-07-02T10:00:00Z",
    entryId: "e",
    entryNumber: "JE-900001",
    entryDate: "2026-06-12",
    signedMinor: 100,
    reversalEntryId: null,
    reversalEntryNumber: null,
    differenceMinor: null,
    ...over,
  });

  const changes = [
    change({ kind: "voided", reconciliationId: "r1", bankAccountId: "b-chk" }),
    change({ kind: "reversed", reconciliationId: "r2", bankAccountId: "b-chk", statementEndingDate: "2026-05-31", reversalEntryNumber: "JE-900009" }),
    change({ kind: "added", reconciliationId: "r3", bankAccountId: "b-sav" }),
  ];

  it("gives the same count per account as the check has rows", () => {
    const merged = withReconciliationChanges([standing("b-chk"), standing("b-sav"), standing("b-res")], changes, "2026-09-30");
    const report = buildExceptionReport(emptyInput({ reconciliationChanges: changes }));
    for (const s of merged) {
      expect(s.changedReconciliations).toBe(report.noLongerAgree.filter((r) => r.bankAccountId === s.bankAccountId).length);
    }
    expect(merged.map((s) => s.changedReconciliations)).toEqual([2, 1, 0]);
  });

  it("badges a reversal, an added entry and a drift, which the voided count never saw", () => {
    const [chk, , res] = withReconciliationChanges([standing("b-chk"), standing("b-sav"), standing("b-res")], changes, "2026-09-30");
    expect(describeStanding(chk, "2026-09-30", money).noLongerAgrees).toBe("No longer agrees: 2 reconciliations have changed since they were signed off");
    expect(describeStanding(res, "2026-09-30", money).noLongerAgrees).toBeNull();
    const one = withReconciliationChanges([standing("b-sav")], changes, "2026-09-30")[0];
    expect(reconcileCard("Example Savings", one, "2026-09-30", money).noLongerAgrees).toBe(
      "No longer agrees: the Jun 30, 2026 reconciliation has changed since it was signed off",
    );
  });

  it("falls back to the voided count when the changes were not read", () => {
    const plain = standing("b-chk", { void_ticked_count: 2, void_ticked_minor: "15000", void_reconciliation_date: "2026-06-30" });
    expect(plain.changedReconciliations).toBeUndefined();
    expect(describeStanding(plain, "2026-09-30", money).noLongerAgrees).toBe(
      "No longer agrees: 2 entries ticked on the Jun 30, 2026 reconciliation were voided ($150.00)",
    );
  });

  it("leaves out a reconciliation that ends after the report date", () => {
    const [chk] = withReconciliationChanges([standing("b-chk")], changes, "2026-06-15");
    expect(chk.changedReconciliations).toBe(1);
  });
});
