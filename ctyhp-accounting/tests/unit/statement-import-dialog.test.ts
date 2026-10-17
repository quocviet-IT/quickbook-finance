import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { statementLineHash } from "@/lib/domain/banking-import";
import type { StatementLine } from "@/lib/domain/statement-import";
import { checkStatementLinesFrom, lineKeyTexts, type StatementLineFacts } from "@/lib/domain/statement-line-keys";
import { PROOF_REFUSAL, PROOF_TEXT, type StatementFigures } from "@/lib/domain/statement-proof";
import type { StatementLinesCheck } from "@/lib/domain/statement-repeats";
import {
  CHECKING_LINES,
  NOT_A_TRANSACTION,
  NO_MARKS,
  OTHER_SOURCE_NOTE,
  OVERRIDE_DIALOG,
  OVERRIDE_REASON_MAX,
  confirmStatement,
  linesCheckFailed,
  overrideReasonProblem,
  previewLineLabel,
  statementDialogView,
  type DialogMarks,
  type StatementDialogInput,
} from "@/lib/domain/statement-import-dialog";

/**
 * The statement import dialog's state (2.04): what it shows and what it sends.
 * Every bank, name and amount here is invented.
 */
const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

const line = (txn_date: string, amount_minor: number, description = "EXAMPLE LINE"): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${description},${amount_minor}`,
});

/** An invented PDF statement: opening $1,000.00, three lines, closing $1,180.00. */
const LINES = [line("2026-03-02", 50000, "DEPOSIT"), line("2026-03-09", -30000, "RENT"), line("2026-03-20", -2000, "SERVICE FEE")];
const PRINTED: StatementFigures = { openingMinor: 100000, closingMinor: 118000, start: "2026-03-01", end: "2026-03-31" };
const NOTHING_HERE: StatementLinesCheck = { present: [], otherSource: [] };

const input = (over: Partial<StatementDialogInput> = {}): StatementDialogInput => ({
  purpose: "import",
  kind: "pdf",
  lines: LINES,
  figures: PRINTED,
  prior: null,
  marks: NO_MARKS,
  check: NOTHING_HERE,
  canOverride: false,
  ...over,
});
const marks = (over: Partial<DialogMarks>): DialogMarks => ({ ...NO_MARKS, ...over });
const view = (over: Partial<StatementDialogInput> = {}) => statementDialogView(input(over), money);

describe("a statement that adds up", () => {
  it("says so with its basis, and imports in one click", () => {
    const v = view();
    expect(v.tone).toBe("adds");
    expect(v.proof.sentences.summary).toBe(
      "Opening $1,000.00 (printed) + 3 lines $180.00 = $1,180.00, the closing balance the statement prints ✓",
    );
    expect(v.blocked).toBeNull();
    expect(v.override).toBeNull();
    expect(v.okLabel).toBe("Import 3 lines");
    expect(v.okDisabled).toBe(false);
    expect(v.showOpeningField).toBe(false);
    expect(v.showClosingField).toBe(false);
  });

  it("waits for the server to say which lines are already here before it can be imported", () => {
    const v = view({ check: null });
    expect(v.checking).toBe(true);
    expect(v.okDisabled).toBe(true);
    expect(v.tone).toBe("adds");
  });

  it("has nothing to import while every line is ticked Not a transaction", () => {
    const v = view({ figures: { ...PRINTED, closingMinor: 100000 }, marks: marks({ aside: [0, 1, 2] }) });
    expect(v.proof.proves).toBe(true);
    expect(v.okLabel).toBe("Import 0 lines");
    expect(v.okDisabled).toBe(true);
  });
});

describe("a statement that is out", () => {
  // The closing is $5.00 lower than the lines take it: no line is $5.00, so there is no hint.
  const OUT: StatementFigures = { ...PRINTED, closingMinor: 117500 };

  it("blocks the import, with the spec's sentences", () => {
    const v = view({ figures: OUT });
    expect(v.tone).toBe("out");
    expect(v.proof.sentences.summary).toBe(
      "Out by $5.00. The opening $1,000.00 and the 3 lines come to $1,180.00; the statement closes at $1,175.00.",
    );
    expect(v.blocked).toBe("Import is blocked until the statement adds up.");
    expect(v.okLabel).toBe("Import 3 lines");
    expect(v.okDisabled).toBe(true);
  });

  it("offers Import anyway… to an administrator, and tells anyone else who can", () => {
    expect(view({ figures: OUT, canOverride: true }).override).toBe("button");
    expect(view({ figures: OUT, canOverride: false }).override).toBe("sentence");
    expect(PROOF_TEXT.importAnyway).toBe("Import anyway…");
    expect(PROOF_TEXT.adminCanOverride).toBe("An administrator can import it anyway, with a reason.");
  });

  it("names the one line it is out by, and adds up once that line is ticked Not a transaction", () => {
    // A $20.00 fee read that the statement does not have: the closing leaves it out.
    const misread = { ...PRINTED, closingMinor: 120000 };
    const out = view({ figures: misread });
    expect(out.proof.sentences.detail).toBe(
      "It equals the statement line “SERVICE FEE” of 03/20/2026 (−20.00), which may have been misread. Mark it Not a transaction if it is not one.",
    );
    const fixed = view({ figures: misread, marks: marks({ aside: [2] }) });
    expect(fixed.tone).toBe("adds");
    expect(fixed.okLabel).toBe("Import 2 lines");
    expect(fixed.okDisabled).toBe(false);
  });
});

describe("a balance missing", () => {
  const NO_CLOSING: StatementFigures = { ...PRINTED, closingMinor: null };

  it("says which in the server's words, shows the field, and offers no override", () => {
    const v = view({ figures: NO_CLOSING, canOverride: true });
    expect(v.tone).toBe("missing");
    expect(v.missingText).toBe(PROOF_REFUSAL.noClosing);
    expect(v.blocked).toBe(PROOF_TEXT.blocked);
    expect(v.override).toBeNull();
    expect(v.showClosingField).toBe(true);
    expect(v.showOpeningField).toBe(false);
    expect(v.okDisabled).toBe(true);
  });

  it("keeps the field while the figure is typed, and imports once it adds up", () => {
    const v = view({ figures: NO_CLOSING, marks: marks({ typedClosingMinor: 118000 }) });
    expect(v.tone).toBe("adds");
    expect(v.proof.closingBasis).toBe("typed");
    expect(v.showClosingField).toBe(true);
    expect(v.okDisabled).toBe(false);
    expect(view({ figures: NO_CLOSING, marks: marks({ typedClosingMinor: 117000 }) }).tone).toBe("out");
  });

  it("names both, and the opening, as the server would", () => {
    expect(view({ kind: "csv", figures: undefined }).missingText).toBe(PROOF_REFUSAL.noBalances);
    expect(view({ figures: { ...PRINTED, openingMinor: null, start: null } }).missingText).toBe(PROOF_REFUSAL.noOpening);
  });

  it("offers the prior statement's closing when the start is not known, and hides the field once it is taken", () => {
    const qif = { kind: "qif" as const, figures: {}, prior: { date: "2026-02-28", endingMinor: 100000 } };
    const offered = view({ ...qif, marks: marks({ typedClosingMinor: 118000 }) });
    expect(offered.priorOffer).toEqual({ label: "Use $1,000.00 (the closing of the reconciliation to 02/28/2026)", taken: false });
    expect(offered.showOpeningField).toBe(true);
    expect(offered.missingText).toBe(PROOF_REFUSAL.noOpening);

    const taken = view({ ...qif, marks: marks({ typedClosingMinor: 118000, usePrior: true }) });
    expect(taken.priorOffer).toEqual({ label: "Use $1,000.00 (the closing of the reconciliation to 02/28/2026)", taken: true });
    expect(taken.showOpeningField).toBe(false);
    expect(taken.tone).toBe("adds");
    expect(taken.proof.sentences.summary).toContain("Opening $1,000.00 (from the reconciliation to 02/28/2026)");
  });
});

describe("lines ticked Not a transaction", () => {
  it("are left out of what is sent, and counted as set aside", () => {
    const v = view({ figures: { ...PRINTED, closingMinor: 120000 }, marks: marks({ aside: [2] }) });
    const sent = confirmStatement(LINES, marks({ aside: [2] }), v);
    expect(sent.rows.map((row) => row.description)).toEqual(["DEPOSIT", "RENT"]);
    expect(sent.aside).toEqual([2]);
    expect(sent.proof).toEqual({
      opening_minor: 100000,
      closing_minor: 120000,
      opening_basis: "printed",
      closing_basis: "printed",
      set_aside: 1,
      override: null,
    });
  });

  it("are answered in the browser: each tick works out again, from what was read once, which lines are already here", () => {
    const account = "acct-dialog";
    const payroll = [line("2026-03-31", -41230, "PAYROLL"), line("2026-03-31", -41230, "PAYROLL"), line("2026-03-31", -41230, "PAYROLL")];
    // Read once for the statement: the lines' keys, and the account's bank
    // lines, which hold the first payroll line from an earlier statement.
    const facts: StatementLineFacts = {
      keys: new Map(
        lineKeyTexts(account, payroll).map(({ key, texts }) => [key, texts.map((text) => createHash("sha256").update(text).digest("hex"))]),
      ),
      bankLines: [
        { id: "bl-1", txnDate: "2026-03-31", amountMinor: -41230, rawHash: statementLineHash(account, payroll[0]), sourceKind: "import", importBatchId: "batch-old" },
      ],
    };
    const figures = { openingMinor: 200000, closingMinor: 200000 - 2 * 41230 };
    const tick = (aside: number[]) =>
      view({ lines: payroll, figures, marks: marks({ aside }), check: checkStatementLinesFrom(payroll, aside, facts) });

    expect(tick([]).repeats.map((group) => group.text)).toEqual([
      "3 identical lines on 03/31/2026 (−412.30): 1 already in Bank Transactions, 2 will be imported.",
    ]);
    // The first ticked: the second is sent with the key the first had, so it is the one already here.
    const ticked = tick([0]);
    expect(checkStatementLinesFrom(payroll, [0], facts).present).toEqual([1]);
    expect(ticked.repeats.map((group) => group.text)).toEqual([
      "2 identical lines on 03/31/2026 (−412.30): 1 already in Bank Transactions, 1 will be imported.",
    ]);
    expect(ticked.checking).toBe(false);
    expect(ticked.okDisabled).toBe(false);
  });
});

describe("lines already in Bank Transactions from another source", () => {
  const check: StatementLinesCheck = {
    present: [],
    otherSource: [
      { index: 0, source: "books", bankLineId: "bl-1" },
      { index: 1, source: "feed", bankLineId: "bl-2" },
    ],
  };

  it("are skipped by default, still counted, and sent marked skip", () => {
    const v = view({ check });
    expect(v.otherSource.map((l) => l.index)).toEqual([0, 1]);
    expect(v.skip).toEqual([0, 1]);
    expect(v.okLabel).toBe("Import 3 lines");
    const sent = confirmStatement(LINES, NO_MARKS, v);
    expect(sent.rows.map((row) => row.skip ?? false)).toEqual([true, true, false]);
  });

  it("are imported when ticked back", () => {
    const v = view({ check, marks: marks({ back: [1] }) });
    expect(v.skip).toEqual([0]);
    expect(confirmStatement(LINES, marks({ back: [1] }), v).rows.map((row) => row.skip ?? false)).toEqual([true, false, false]);
  });

  it("leave out a line ticked Not a transaction", () => {
    const v = view({ check, marks: marks({ aside: [1] }), figures: { ...PRINTED, closingMinor: 148000 } });
    expect(v.otherSource.map((l) => l.index)).toEqual([0]);
    expect(v.skip).toEqual([0]);
  });

  it("are never asked about when attaching, and nothing is said about importing", () => {
    const v = view({ purpose: "attach", check, canOverride: true, figures: { ...PRINTED, closingMinor: 117500 } });
    expect(v.otherSource).toEqual([]);
    expect(v.skip).toEqual([]);
    expect(v.repeats).toEqual([]);
    expect(v.checking).toBe(false);
    expect(v.blocked).toBe("Attaching is blocked until the statement adds up.");
    expect(v.override).toBeNull();
    expect(view({ purpose: "attach", check: null }).okDisabled).toBe(false);
  });
});

describe("repeated lines", () => {
  const PAYROLL = [
    line("2026-03-31", -41230, "PAYROLL"),
    line("2026-03-31", -41230, "PAYROLL"),
    line("2026-03-31", -41230, "PAYROLL"),
  ];

  it("are counted, with how many are already here and how many will be imported", () => {
    const v = view({
      lines: PAYROLL,
      figures: { openingMinor: 200000, closingMinor: 200000 - 3 * 41230 },
      check: { present: [0], otherSource: [] },
    });
    expect(v.repeats.map((group) => group.text)).toEqual([
      "3 identical lines on 03/31/2026 (−412.30): 1 already in Bank Transactions, 2 will be imported.",
    ]);
    expect(confirmStatement(PAYROLL, NO_MARKS, v).repeats).toBe(v.repeats);
  });
});

describe("importing anyway", () => {
  it("needs a reason that is not blank, of 500 characters or fewer", () => {
    expect(overrideReasonProblem("")).toBe("Give a reason for importing a statement that does not add up");
    expect(overrideReasonProblem("   ")).toBe("Give a reason for importing a statement that does not add up");
    expect(overrideReasonProblem("x".repeat(OVERRIDE_REASON_MAX + 1))).toBe("Keep the reason to 500 characters or fewer");
    expect(overrideReasonProblem("The bank printed a duplicate line; confirmed by phone")).toBeNull();
  });

  it("sends the reason, trimmed, only when given", () => {
    const v = view({ figures: { ...PRINTED, closingMinor: 117500 }, canOverride: true });
    expect(confirmStatement(LINES, NO_MARKS, v).proof.override).toBeNull();
    expect(confirmStatement(LINES, NO_MARKS, v, { reason: "  Checked with the bank  " }).proof.override).toEqual({
      reason: "Checked with the bank",
    });
  });

  it("says what the reason is for", () => {
    expect(OVERRIDE_DIALOG).toEqual({
      title: "Import a statement that does not add up?",
      kept: "The reason is kept with the import and in the audit log.",
      reasonLabel: "Reason",
      placeholder: "Reason (required)",
      ok: "Import anyway",
    });
  });
});

describe("the preview's words", () => {
  it("are fixed", () => {
    expect(NOT_A_TRANSACTION).toBe("Not a transaction");
    expect(OTHER_SOURCE_NOTE).toBe("These lines are skipped. Tick one to import it as well.");
    expect(CHECKING_LINES).toBe("Checking the lines against Bank Transactions…");
    expect(previewLineLabel(line("2026-03-31", -41230, "PAYROLL"), money)).toBe("03/31/2026 · PAYROLL · -$412.30");
    expect(previewLineLabel(line("2026-03-31", 500, ""), money)).toBe("03/31/2026 · (no description) · $5.00");
  });

  it("say when the lines could not be checked, and how to try again", () => {
    expect(linesCheckFailed("An unexpected error occurred.")).toBe(
      "The lines could not be checked against Bank Transactions (An unexpected error occurred), so nothing can be imported yet. Choose the file again to try once more.",
    );
    expect(linesCheckFailed("  ")).toContain("(the server did not answer)");
  });
});
