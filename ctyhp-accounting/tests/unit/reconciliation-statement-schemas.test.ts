import { describe, expect, it } from "vitest";
import { reconciliationFromStatementSchema, reconciliationStatementSchema } from "@/lib/domain/schemas";

const line = {
  txn_date: "2026-09-05",
  description: "FEE",
  reference: null,
  amount_minor: -500,
  running_balance_minor: null,
  raw_line: "x",
};
const statement = { file_name: "september.pdf", opening_minor: 75000, closing_minor: 74500, lines: [line] };
const start = {
  ...statement,
  bank_account_id: "6f1c1d4e-0a3b-4c2d-9e8f-1a2b3c4d5e6f",
  period_from: "2026-09-01",
  statement_date: "2026-09-30",
  closing_minor: 74500,
  bring_forward: true,
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

describe("reconciliationFromStatementSchema", () => {
  it("takes a statement to start from, brought forward", () => {
    expect(reconciliationFromStatementSchema.safeParse(start).success).toBe(true);
  });

  it("refuses bringing forward without the period's start or the opening balance", () => {
    const message = "Bringing forward needs the statement's period and opening balance";
    expect(firstIssue(reconciliationFromStatementSchema.safeParse({ ...start, period_from: null }))).toBe(message);
    expect(firstIssue(reconciliationFromStatementSchema.safeParse({ ...start, opening_minor: null }))).toBe(message);
    expect(
      reconciliationFromStatementSchema.safeParse({ ...start, period_from: null, opening_minor: null, bring_forward: false }).success,
    ).toBe(true);
  });

  it("refuses a start with no closing balance or no statement date", () => {
    expect(reconciliationFromStatementSchema.safeParse({ ...start, closing_minor: null }).success).toBe(false);
    expect(reconciliationFromStatementSchema.safeParse({ ...start, statement_date: "" }).success).toBe(false);
  });
});
