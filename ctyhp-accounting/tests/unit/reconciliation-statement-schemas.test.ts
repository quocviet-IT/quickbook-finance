import { describe, expect, it } from "vitest";
import {
  historyBringForwardSchema,
  historyPreviewSchema,
  reconciliationDiscardSchema,
  reconciliationStatementSchema,
  runMonthSchema,
  runPreviewSchema,
  statementLineAsideSchema,
} from "@/lib/domain/schemas";

const line = {
  txn_date: "2026-09-05",
  description: "FEE",
  reference: null,
  amount_minor: -500,
  running_balance_minor: null,
  raw_line: "x",
};
const proof = { opening_minor: 75000, closing_minor: 74500, opening_basis: "printed", closing_basis: "printed", set_aside: 0, override: null };
const statement = { file_name: "september.pdf", lines: [line], proof };
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

  it("takes a line marked skip, and keeps the mark (2.04)", () => {
    const parsed = reconciliationStatementSchema.parse({ ...statement, lines: [line, { ...line, skip: true }] });
    expect(parsed.lines.map((l) => l.skip)).toEqual([undefined, true]);
    expect(reconciliationStatementSchema.safeParse({ ...statement, lines: [{ ...line, skip: "yes" }] }).success).toBe(false);
  });

  it("needs the statement's proof, and fills in what an older proof leaves out", () => {
    expect(reconciliationStatementSchema.safeParse({ file_name: "september.pdf", lines: [line] }).success).toBe(false);
    const parsed = reconciliationStatementSchema.parse({
      ...statement,
      proof: { opening_minor: 75000, closing_minor: 74500, opening_basis: "printed", closing_basis: "typed" },
    });
    expect(parsed.proof).toEqual({ ...proof, closing_basis: "typed" });
  });

  it("refuses a balance that does not say where it came from, or a basis of no known kind", () => {
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, proof: { ...proof, opening_basis: null } }))).toBe(
      "Say where the opening balance came from: printed, running, prior or typed",
    );
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, proof: { ...proof, closing_basis: null } }))).toBe(
      "Say where the closing balance came from: printed, running, ledger or typed",
    );
    expect(reconciliationStatementSchema.safeParse({ ...statement, proof: { ...proof, opening_basis: "books" } }).success).toBe(false);
    expect(reconciliationStatementSchema.safeParse({ ...statement, proof: { ...proof, closing_basis: "prior" } }).success).toBe(false);
  });

  it("takes a missing balance, which the action refuses with the proof's own words", () => {
    expect(
      reconciliationStatementSchema.safeParse({ ...statement, proof: { ...proof, opening_minor: null, opening_basis: null } }).success,
    ).toBe(true);
  });
});

describe("runMonthSchema", () => {
  it("takes a month to sign, and the bring-forward step", () => {
    expect(runMonthSchema.safeParse(month).success).toBe(true);
    expect(runMonthSchema.safeParse({ ...month, sign: false }).success).toBe(true);
    expect(runMonthSchema.safeParse(bringForward).success).toBe(true);
  });

  it("refuses a month with no proof, no statement date or no lines", () => {
    expect(runMonthSchema.safeParse({ ...month, proof: undefined }).success).toBe(false);
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

describe("reconciliationDiscardSchema", () => {
  it("takes a reason, trimmed, and refuses none", () => {
    expect(reconciliationDiscardSchema.parse({ reason: "  Started on the wrong statement " })).toEqual({ reason: "Started on the wrong statement" });
    expect(firstIssue(reconciliationDiscardSchema.safeParse({ reason: "   " }))).toBe("A reason is required to discard a reconciliation");
    expect(reconciliationDiscardSchema.safeParse({ reason: "x".repeat(301) }).success).toBe(false);
  });
});

describe("historyBringForwardSchema and historyPreviewSchema", () => {
  const bring = { bank_account_id: BANK, through: "2026-08-31", balance_minor: 512340 };

  it("take an account, a real day and, to bring forward, a balance in whole cents", () => {
    expect(historyBringForwardSchema.safeParse(bring).success).toBe(true);
    expect(historyBringForwardSchema.safeParse({ ...bring, balance_minor: -2500 }).success).toBe(true);
    expect(historyPreviewSchema.safeParse({ bank_account_id: BANK, through: "2026-08-31" }).success).toBe(true);
  });

  it("refuse a day that does not exist, a balance in part-cents, and no account", () => {
    expect(firstIssue(historyBringForwardSchema.safeParse({ ...bring, through: "2026-02-30" }))).toBe("A statement date must be a real day");
    expect(firstIssue(historyBringForwardSchema.safeParse({ ...bring, balance_minor: 1.5 }))).toBe(
      "The statement balance must be a whole minor-unit amount",
    );
    expect(firstIssue(historyPreviewSchema.safeParse({ bank_account_id: "bank", through: "2026-08-31" }))).toBe("Select a bank account");
  });
});

describe("statementLineAsideSchema", () => {
  it("takes a line number and whether it is set aside or brought back", () => {
    expect(statementLineAsideSchema.safeParse({ line_no: 0, aside: true }).success).toBe(true);
    expect(statementLineAsideSchema.safeParse({ line_no: 7, aside: false }).success).toBe(true);
    expect(firstIssue(statementLineAsideSchema.safeParse({ line_no: -1, aside: true }))).toBe("Choose a statement line");
    expect(statementLineAsideSchema.safeParse({ line_no: 1 }).success).toBe(false);
  });
});
