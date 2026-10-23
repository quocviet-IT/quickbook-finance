import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BALANCE_WORDS,
  CARD_FROM_FILES_NOT_READ,
  CARD_PDF_NOT_READ,
  balanceSideOf,
  bankAccountLabel,
  cardAddPlan,
  cardBookLines,
  cardDetail,
  cardFigures,
  cardHistoryFacts,
  cardStanding,
  cardStatement,
  cardStatementLines,
  flipSignsLabel,
  isCardAccountType,
  shown,
  stored,
  storedProof,
} from "@/lib/domain/card-account";
import { NO_MARKS, confirmStatement, statementDialogView } from "@/lib/domain/statement-import-dialog";
import { proveStatementPayload } from "@/lib/domain/statement-proof";
import { reconciliationStandings } from "@/lib/domain/reconcile-statement";
import { buildReconciliationReport, reconciliationProof, reconciliationSummaryRows } from "@/lib/domain/reconciliation-report";
import { statementAlerts, type BankLine } from "@/lib/domain/statement-alerts";
import { bankPanelHeading } from "@/lib/domain/bank-standing";
import type { StatementLine } from "@/lib/domain/statement-import";

/**
 * 2.45: a credit card in Bank Transactions and Bank Reconciliation. The books
 * keep a card debit positive — a charge negative, the balance owed negative —
 * and the screens that set it beside a statement show it as the statement
 * prints it. Invented figures throughout.
 */
const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;

describe("which accounts are cards, and the flip", () => {
  it("knows a card by its ledger type", () => {
    expect(isCardAccountType("credit_card")).toBe(true);
    expect(isCardAccountType("bank")).toBe(false);
    expect(isCardAccountType(undefined)).toBe(false);
    expect(balanceSideOf("credit_card")).toBe("card");
    expect(balanceSideOf("bank")).toBe("bank");
    expect(balanceSideOf(null)).toBe("bank");
  });

  it("turns a card's amounts round and back, leaves a bank's alone, and never makes −0", () => {
    expect(shown(-123456, "card")).toBe(123456);
    expect(stored(123456, "card")).toBe(-123456);
    expect(stored(shown(-4500, "card"), "card")).toBe(-4500);
    expect(shown(-4500, "bank")).toBe(-4500);
    expect(Object.is(shown(0, "card"), 0)).toBe(true);
  });

  it("names a card as one, and words its balances as owed", () => {
    expect(bankAccountLabel("Example Card · 2010", "card")).toBe("Example Card · 2010 · credit card");
    expect(bankAccountLabel("Example Bank · 1010", "bank")).toBe("Example Bank · 1010");
    expect(BALANCE_WORDS.card.ending).toBe("Statement balance owed");
    expect(BALANCE_WORDS.bank.ending).toBe("Statement ending");
    expect(BALANCE_WORDS.bank.note).toBeNull();
    expect(flipSignsLabel("card")).toBe("Flip signs: my file shows charges as positive");
    expect(flipSignsLabel("bank")).toBe("Flip signs: my file shows payments as positive");
    expect(CARD_PDF_NOT_READ).toContain("CSV");
    expect(CARD_FROM_FILES_NOT_READ).toContain("New reconciliation");
  });
});

describe("a reconciliation's figures, shown", () => {
  const detail = {
    beginningMinor: -100000,
    statementEndingMinor: -123456,
    clearedTotalMinor: -23456,
    reconciledBalanceMinor: -123456,
    differenceMinor: 0,
    status: "in_progress",
  };

  it("turns every figure of a card, keeps a bank's object as it is", () => {
    expect(cardDetail(detail, "card")).toEqual({
      beginningMinor: 100000,
      statementEndingMinor: 123456,
      clearedTotalMinor: 23456,
      reconciledBalanceMinor: 123456,
      differenceMinor: 0,
      status: "in_progress",
    });
    expect(cardDetail(detail, "bank")).toBe(detail);
  });

  it("turns a kept statement, its lines and balances, and the book lines the same way, so they still pair", () => {
    const statement = {
      endingDate: "2026-09-30",
      openingMinor: -100000,
      closingMinor: -123456,
      lines: [
        { lineNo: 1, txnDate: "2026-09-04", description: "EXAMPLE STORE", reference: null, amountMinor: -45600, balanceMinor: null, setAside: false },
        { lineNo: 2, txnDate: "2026-09-15", description: "PAYMENT THANK YOU", reference: null, amountMinor: 50000, balanceMinor: null, setAside: false },
      ],
    };
    const book = [
      { journalLineId: "j1", entryId: "e1", entryNumber: "JE-1", entryDate: "2026-09-04", sourceType: "bank", memo: null, signedMinor: -45600, cleared: false, reference: null },
      { journalLineId: "j2", entryId: "e2", entryNumber: "JE-2", entryDate: "2026-09-15", sourceType: "bank", memo: null, signedMinor: 50000, cleared: false, reference: null },
    ];
    const shownStatement = cardStatement(statement, "card");
    expect(shownStatement.openingMinor).toBe(100000);
    expect(shownStatement.closingMinor).toBe(123456);
    expect(shownStatement.lines.map((l) => l.amountMinor)).toEqual([45600, -50000]);
    const shownBook = cardBookLines(book, "card");
    expect(shownBook.map((l) => l.signedMinor)).toEqual([45600, -50000]);
    const asStored = reconciliationStandings(statement, book);
    const asShown = reconciliationStandings(shownStatement, shownBook);
    expect(asShown.standings).toEqual(asStored.standings);
    expect(asShown.paired).toBe(2);
    expect(cardStatement(statement, "bank")).toBe(statement);
  });

  it("turns what bringing the history forward rests on, the standing, and Add all's lines", () => {
    expect(cardHistoryFacts({ through: "2026-08-31", openingMinor: -100000, bookBalanceMinor: -100000, entries: 3, reconciled: false }, "card"))
      .toMatchObject({ openingMinor: 100000, bookBalanceMinor: 100000 });
    expect(
      cardStanding(
        { lastClosingMinor: -100000, sinceNetMinor: -23456, earlierOpenNetMinor: 0, voidTickedMinor: 0, bookMinor: -123456 },
        "card",
      ),
    ).toEqual({ lastClosingMinor: 100000, sinceNetMinor: 23456, earlierOpenNetMinor: 0, voidTickedMinor: 0, bookMinor: 123456 });
    expect(cardStanding({ lastClosingMinor: null, sinceNetMinor: 0, earlierOpenNetMinor: 0, voidTickedMinor: 0, bookMinor: 0 }, "card").lastClosingMinor)
      .toBeNull();
    expect(cardAddPlan({ items: [{ amountMinor: -1500 }], held: [], cannot: [{ amountMinor: 2000 }] }, "card")).toEqual({
      items: [{ amountMinor: 1500 }],
      held: [],
      cannot: [{ amountMinor: -2000 }],
    });
  });
});

describe("importing a card statement: shown as printed, sent the books' way round", () => {
  // A card CSV as Chase exports it: purchases negative, a payment positive — the books' own sign.
  const line = (txn_date: string, amount_minor: number, description: string): StatementLine => ({
    txn_date,
    description,
    reference: null,
    amount_minor,
    running_balance_minor: null,
    raw_line: `${txn_date},${description},${amount_minor}`,
  });
  const lines = [line("2026-09-04", -45600, "EXAMPLE STORE"), line("2026-09-10", -12000, "EXAMPLE CAFE"), line("2026-09-15", 50000, "PAYMENT THANK YOU")];
  // The statement prints: previous balance 1,000.00, new balance 1,076.00 (1,000.00 + 456.00 + 120.00 − 500.00).
  const marks = { ...NO_MARKS, typedOpeningMinor: 100000, typedClosingMinor: 107600 };

  it("proves the statement on the balances typed as printed, and lists charges positive", () => {
    const shownLines = cardStatementLines(lines, "card");
    expect(shownLines.map((l) => l.amount_minor)).toEqual([45600, 12000, -50000]);
    const view = statementDialogView(
      { purpose: "import", kind: "csv", lines: shownLines, prior: null, marks, check: { present: [], otherSource: [] }, canOverride: false },
      money,
    );
    expect(view.proof.proves).toBe(true);
    expect(view.okDisabled).toBe(false);
  });

  it("sends the lines as read and the balances owed as negatives, which the server's own rule proves again", () => {
    const view = statementDialogView(
      { purpose: "import", kind: "csv", lines: cardStatementLines(lines, "card"), prior: null, marks, check: { present: [], otherSource: [] }, canOverride: false },
      money,
    );
    const confirmed = confirmStatement(lines, marks, view, null);
    const proof = storedProof(confirmed.proof, "card");
    expect(confirmed.rows.map((r) => r.amount_minor)).toEqual([-45600, -12000, 50000]);
    expect(proof).toMatchObject({ opening_minor: -100000, closing_minor: -107600 });
    expect(proveStatementPayload(confirmed.rows, proof, money).proves).toBe(true);
  });

  it("would not prove if the balances owed were sent as typed: the flip is what makes it add up", () => {
    const view = statementDialogView(
      { purpose: "import", kind: "csv", lines: cardStatementLines(lines, "card"), prior: null, marks, check: { present: [], otherSource: [] }, canOverride: false },
      money,
    );
    const confirmed = confirmStatement(lines, marks, view, null);
    expect(proveStatementPayload(confirmed.rows, confirmed.proof, money).proves).toBe(false);
  });

  it("turns an OFX's balances and leaves a bank's alone", () => {
    expect(cardFigures({ openingMinor: -100000, closingMinor: -107600, ledgerMinor: -107600 }, "card")).toEqual({
      openingMinor: 100000,
      closingMinor: 107600,
      ledgerMinor: 107600,
    });
    expect(cardFigures(undefined, "card")).toBeUndefined();
    expect(storedProof({ opening_minor: 5, closing_minor: null }, "bank")).toEqual({ opening_minor: 5, closing_minor: null });
  });
});

describe("a card's reconciliation report", () => {
  // Shown as printed: previous balance owed 1,000.00, a charge of 456.00 cleared, a payment of 500.00 cleared,
  // new balance owed 956.00; a charge of 120.00 in the books not yet on the statement.
  const input = {
    completed: true,
    statementDate: "2026-09-30",
    beginningMinor: 100000,
    statementEndingMinor: 95600,
    bookBalanceMinor: 107600,
    lines: [
      { journalLineId: "a", entryId: "ea", entryNumber: "JE-1", entryDate: "2026-09-04", sourceType: "bank", memo: null, reference: null, signedMinor: 45600, cleared: true },
      { journalLineId: "b", entryId: "eb", entryNumber: "JE-2", entryDate: "2026-09-15", sourceType: "bank", memo: null, reference: null, signedMinor: -50000, cleared: true },
      { journalLineId: "c", entryId: "ec", entryNumber: "JE-3", entryDate: "2026-09-29", sourceType: "bank", memo: null, reference: null, signedMinor: 12000, cleared: false },
    ],
    adjustmentEntryId: null,
    adjustmentReason: null,
    note: null,
    side: "card" as const,
  };

  it("sets out charges and payments, and proves out on the balance owed", () => {
    const report = buildReconciliationReport(input);
    expect(report.sections.map((s) => s.title)).toEqual([
      "Cleared charges",
      "Cleared payments and credits",
      "Charges in the books, not yet on the statement",
      "Payments and credits in the books, not yet on the statement",
    ]);
    expect(report.provesOut).toBe(true);
    const labels = reconciliationSummaryRows(report, input).map((row) => row.label);
    expect(labels).toEqual([
      "Previous balance owed",
      "Charges cleared (1)",
      "Payments and credits cleared (1)",
      "New balance owed",
      "Charges not yet on the statement (1)",
      "Payments and credits not yet on the statement (0)",
      "Balance owed in the books at 09/30/2026",
    ]);
    expect(reconciliationProof(report, input, money).detail).toContain("plus the charges and less the payments and credits the card issuer had not yet posted");
  });

  it("words a bank account's report as before", () => {
    const report = buildReconciliationReport({ ...input, side: undefined });
    expect(report.sections[0].title).toBe("Cleared deposits and other credits");
  });
});

describe("around a card", () => {
  it("never watches a card for going below zero, and still finds its ghost groups", () => {
    const lines: BankLine[] = [
      {
        lineId: "l1",
        entryId: "e1",
        entryNumber: "JE-1",
        date: "2026-09-04",
        amountMinor: -45600,
        payee: "Example Store",
        narration: "",
        codedTo: ["6100 Office Supplies"],
        sourceType: "bank",
        cleared: false,
      },
    ];
    const asBank = statementAlerts(lines, null);
    const asCard = statementAlerts(lines, null, true);
    expect(asBank.negative).not.toBeNull();
    expect(asCard.negative).toBeNull();
    expect(asCard.ghosts).toEqual(asBank.ghosts);
  });

  it("heads the Balance Sheet's panel by the kinds it lists", () => {
    expect(bankPanelHeading(false, false)).toBe("Bank accounts");
    expect(bankPanelHeading(true, false)).toBe("Bank and cash accounts");
    expect(bankPanelHeading(false, true)).toBe("Bank and card accounts");
    expect(bankPanelHeading(true, true)).toBe("Bank, card and cash accounts");
  });
});

describe("migration 0159", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0159_credit_card_bank_accounts.sql", import.meta.url), "utf8");

  it("lets a bank account record belong to a Credit Card ledger account, and still refuses the cash tin", () => {
    expect(sql).toContain("if v_type not in ('bank', 'credit_card') then");
    expect(sql).toContain("if v_type = 'bank' and v_detail = 'cash_on_hand' then");
  });

  it("lets a card with a bank account record teach the coding suggestions, and changes nothing else", () => {
    expect(sql).toMatch(/a\.account_type = 'credit_card'\s+and exists \(select 1 from acc_bank_account ba where ba\.account_id = a\.id\)/);
    expect(sql).not.toMatch(/\b(drop table|delete from|update acc_|insert into)\b/i);
  });
});
