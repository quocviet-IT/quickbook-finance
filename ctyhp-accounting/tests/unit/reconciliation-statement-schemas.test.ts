import { describe, expect, it } from "vitest";
import { reconciliationStatementSchema, runMonthSchema, runPreviewSchema } from "@/lib/domain/schemas";

const line = {
  txn_date: "2026-09-05",
  description: "FEE",
  reference: null,
  amount_minor: -500,
  running_balance_minor: null,
  raw_line: "x",
};
const statement = { file_name: "september.pdf", opening_minor: 75000, closing_minor: 74500, lines: [line] };
const BANK = "6f1c1d4e-0a3b-4c2d-9e8f-1a2b3c4d5e6f";
const month = { ...statement, kind: "month", bank_account_id: BANK, statement_date: "2026-09-30", sign: true };
const bringForward = { kind: "bring_forward", bank_account_id: BANK, period_from: "2026-09-01", statement_date: "2026-09-30", opening_minor: 75000 };
const preview = {
  bank_account_id: BANK,
  statements: [
    {
      key: "september.pdf#0",
      from: "2026-09-01",
      to: "2026-09-30",
      opening_minor: 75000,
      closing_minor: 74500,
      lines: [{ txn_date: "2026-09-05", amount_minor: -500, reference: null }],
    },
  ],
};
const firstIssue = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

describe("reconciliationStatementSchema", () => {
  it("takes a statement with its lines", () => {
    expect(reconciliationStatementSchema.safeParse(statement).success).toBe(true);
  });

  it("takes up to 5,000 lines, and refuses none or more", () => {
    expect(reconciliationStatementSchema.safeParse({ ...statement, lines: Array.from({ length: 5000 }, () => line) }).success).toBe(true);
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, lines: [] }))).toBe("The statement has no lines");
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, lines: Array.from({ length: 5001 }, () => line) }))).toBe(
      "A statement can hold at most 5,000 lines",
    );
  });

  it("refuses a day that does not exist, and a date that is not an ISO day", () => {
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, lines: [{ ...line, txn_date: "2026-02-31" }] }))).toBe(
      "A statement date must be a real day",
    );
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, lines: [{ ...line, txn_date: "09/05/2026" }] }))).toBe(
      "A statement date is required",
    );
  });

  it("refuses an amount that is not whole cents", () => {
    expect(reconciliationStatementSchema.safeParse({ ...statement, lines: [{ ...line, amount_minor: 1.5 }] }).success).toBe(false);
  });
});

describe("runMonthSchema", () => {
  it("takes a month to sign, and the bring-forward step", () => {
    expect(runMonthSchema.safeParse(month).success).toBe(true);
    expect(runMonthSchema.safeParse({ ...month, sign: false }).success).toBe(true);
    expect(runMonthSchema.safeParse(bringForward).success).toBe(true);
  });

  it("refuses a month with no closing balance, no statement date or no lines", () => {
    expect(runMonthSchema.safeParse({ ...month, closing_minor: null }).success).toBe(false);
    expect(runMonthSchema.safeParse({ ...month, statement_date: "2026-02-31" }).success).toBe(false);
    expect(runMonthSchema.safeParse({ ...month, lines: [] }).success).toBe(false);
  });

  it("refuses bringing forward without the period's start or the opening balance", () => {
    expect(runMonthSchema.safeParse({ ...bringForward, period_from: null }).success).toBe(false);
    expect(runMonthSchema.safeParse({ ...bringForward, opening_minor: null }).success).toBe(false);
  });

  it("refuses a step of no known kind", () => {
    expect(runMonthSchema.safeParse({ ...month, kind: "everything" }).success).toBe(false);
  });
});

describe("runPreviewSchema", () => {
  it("takes the statements of a run", () => {
    expect(runPreviewSchema.safeParse(preview).success).toBe(true);
  });

  it("refuses an empty run, and one of more than 60 statements", () => {
    expect(firstIssue(runPreviewSchema.safeParse({ ...preview, statements: [] }))).toBe("Choose at least one statement");
    expect(firstIssue(runPreviewSchema.safeParse({ ...preview, statements: Array.from({ length: 61 }, () => preview.statements[0]) }))).toBe(
      "A run can hold at most 60 statements",
    );
  });

  it("takes 10,000 statement lines in all, and refuses one more", () => {
    const withLines = (n: number) => ({ ...preview.statements[0], lines: Array.from({ length: n }, () => preview.statements[0].lines[0]) });
    expect(runPreviewSchema.safeParse({ ...preview, statements: [withLines(5000), withLines(5000)] }).success).toBe(true);
    expect(firstIssue(runPreviewSchema.safeParse({ ...preview, statements: [withLines(5000), withLines(5000), withLines(1)] }))).toBe(
      "A run can hold at most 10,000 statement lines",
    );
  });

  it("refuses a statement with no closing balance", () => {
    expect(runPreviewSchema.safeParse({ ...preview, statements: [{ ...preview.statements[0], closing_minor: null }] }).success).toBe(false);
  });
});
