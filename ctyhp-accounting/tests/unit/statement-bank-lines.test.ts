import { describe, expect, it } from "vitest";
import type { Standing } from "@/lib/domain/reconcile-statement";
import {
  NO_BANK_LINE_MATCHES,
  NO_RUN_LINES,
  addMatchCounts,
  addRunLines,
  bankLinesToCheck,
  bankLinesMatchedSentence,
  bankLinesNotMatchedSentence,
  completedMessage,
  reconciledBankPairs,
  runLinesSentence,
  statementBankLines,
  statementLineKey,
  type StatementBankLine,
  type StatementLineFields,
} from "@/lib/domain/statement-bank-lines";

const line = (txnDate: string, amountMinor: number, description: string, reference: string | null = null): StatementLineFields => ({
  txnDate,
  amountMinor,
  description,
  reference,
});
const txn = (id: string, l: StatementLineFields, extra: Partial<StatementBankLine> = {}): StatementBankLine => ({
  id,
  ...l,
  status: "unmatched",
  approvedLineId: null,
  ...extra,
});
const paired = (bookId: string, ticked = true): Standing => ({ kind: "paired", how: "date and amount", bookId, entryNumber: null, ticked });
const missing: Standing = { kind: "missing" };
const after: Standing = { kind: "after" };

describe("statementLineKey", () => {
  it("reads a statement line and its bank line the same way", () => {
    const long = "X".repeat(600);
    expect(statementLineKey(line("2026-07-05", 5000, long, "  1042  "))).toBe(
      statementLineKey(line("2026-07-05", 5000, long.slice(0, 500), "1042")),
    );
  });

  it("tells lines apart by date, amount, description and reference", () => {
    const base = line("2026-07-05", 5000, "DEPOSIT", "1");
    const keys = new Set([
      base,
      { ...base, txnDate: "2026-07-06" },
      { ...base, amountMinor: -5000 },
      { ...base, description: "DEPOSIT 2" },
      { ...base, reference: "2" },
    ].map(statementLineKey));
    expect(keys.size).toBe(5);
  });

  it("takes no description or reference as empty", () => {
    expect(statementLineKey(line("2026-07-05", 5000, "", null))).toBe(
      statementLineKey({ txnDate: "2026-07-05", amountMinor: 5000, description: null, reference: "  " }),
    );
  });
});

describe("reconciledBankPairs", () => {
  const deposit = line("2026-07-05", 50000, "DEPOSIT EXAMPLE");
  const fee = line("2026-07-30", -500, "SERVICE FEE");
  const late = line("2026-08-02", -700, "AFTER THE STATEMENT");

  it("pairs each paired, ticked statement line with the bank line it was imported as", () => {
    expect(
      reconciledBankPairs([deposit, fee], [paired("jl-dep"), paired("jl-fee")], [txn("t-fee", fee), txn("t-dep", deposit)]),
    ).toEqual([
      { bankTransactionId: "t-dep", journalLineId: "jl-dep" },
      { bankTransactionId: "t-fee", journalLineId: "jl-fee" },
    ]);
  });

  it("leaves out lines that are missing, after the statement, or paired but not ticked", () => {
    expect(
      reconciledBankPairs(
        [deposit, fee, late],
        [paired("jl-dep", false), missing, after],
        [txn("t-dep", deposit), txn("t-fee", fee), txn("t-late", late)],
      ),
    ).toEqual([]);
  });

  it("gives no pair for a line with no bank line", () => {
    expect(reconciledBankPairs([deposit, fee], [paired("jl-dep"), paired("jl-fee")], [txn("t-fee", fee)])).toEqual([
      { bankTransactionId: "t-fee", journalLineId: "jl-fee" },
    ]);
  });

  it("pairs identical lines in order, the first with the first", () => {
    expect(
      reconciledBankPairs([fee, fee], [paired("jl-1"), paired("jl-2")], [txn("t-1", fee), txn("t-2", fee), txn("t-3", fee)]),
    ).toEqual([
      { bankTransactionId: "t-1", journalLineId: "jl-1" },
      { bankTransactionId: "t-2", journalLineId: "jl-2" },
    ]);
  });

  it("keeps an identical bank line with the book line it is already matched to", () => {
    expect(
      reconciledBankPairs(
        [fee, fee],
        [paired("jl-1"), paired("jl-2")],
        [txn("t-1", fee, { status: "matched", approvedLineId: "jl-2" }), txn("t-2", fee)],
      ),
    ).toEqual([
      { bankTransactionId: "t-1", journalLineId: "jl-2" },
      { bankTransactionId: "t-2", journalLineId: "jl-1" },
    ]);
  });

  it("still hands over a bank line matched elsewhere, for the database to count", () => {
    expect(
      reconciledBankPairs([deposit], [paired("jl-dep")], [txn("t-dep", deposit, { status: "matched", approvedLineId: "jl-other" })]),
    ).toEqual([{ bankTransactionId: "t-dep", journalLineId: "jl-dep" }]);
  });

  it("gives an identical bank line still unmatched before one matched elsewhere", () => {
    expect(
      reconciledBankPairs(
        [fee],
        [paired("jl-1")],
        [txn("t-1", fee, { status: "matched", approvedLineId: "jl-other" }), txn("t-2", fee)],
      ),
    ).toEqual([{ bankTransactionId: "t-2", journalLineId: "jl-1" }]);
  });

  it("hands over the rest when there are more book lines than unmatched bank lines", () => {
    expect(
      reconciledBankPairs(
        [fee, fee],
        [paired("jl-1"), paired("jl-2")],
        [txn("t-1", fee, { status: "ignored" }), txn("t-2", fee)],
      ),
    ).toEqual([
      { bankTransactionId: "t-2", journalLineId: "jl-1" },
      { bankTransactionId: "t-1", journalLineId: "jl-2" },
    ]);
  });

  it("gives more book lines than bank lines no pair for the extra", () => {
    expect(
      reconciledBankPairs([fee, fee], [paired("jl-1"), paired("jl-2")], [txn("t-1", fee)]),
    ).toEqual([{ bankTransactionId: "t-1", journalLineId: "jl-1" }]);
  });
});

/**
 * 2.44: a statement reconciled after its lines came in another way — a CSV
 * export coded line by line — is not imported again, so the line it is in Bank
 * Transactions as is the CSV's, worded the bank's other way.
 */
describe("a statement whose lines came into Bank Transactions another way", () => {
  // The statement's words, and the CSV's for the same money on the same day.
  const deposit = line("2026-07-14", 250000, "Zelle Payment From Example Customer 10000000001");
  const csvDeposit = line("2026-07-14", 250000, "ZELLE FROM EXAMPLE CUSTOMER ON 07/14");
  const fee = line("2026-07-31", -1500, "Monthly Service Fee");
  const csvFee = line("2026-07-31", -1500, "MONTHLY SERVICE FEE");

  it("finds the line of another source on the same day for the same amount, after the statement's own", () => {
    const groups = statementBankLines([deposit, fee], [txn("csv-dep", csvDeposit), txn("own-fee", fee), txn("csv-fee", csvFee)]);
    expect(groups.get(statementLineKey(deposit))).toEqual({ own: [], other: [txn("csv-dep", csvDeposit)] });
    expect(groups.get(statementLineKey(fee))).toEqual({ own: [txn("own-fee", fee)], other: [txn("csv-fee", csvFee)] });
  });

  it("never takes a bank line that is another of the statement's lines as a line of another source", () => {
    const refund = line("2026-07-14", 250000, "Reversal Example Customer");
    const groups = statementBankLines([deposit, refund], [txn("own-refund", refund)]);
    expect(groups.get(statementLineKey(deposit))).toEqual({ own: [], other: [] });
  });

  it("counts a CSV line already matched to the very book line ticked as already matched, not as matched elsewhere", () => {
    expect(
      reconciledBankPairs([deposit], [paired("jl-dep")], [txn("csv-dep", csvDeposit, { status: "matched", approvedLineId: "jl-dep" })]),
    ).toEqual([{ bankTransactionId: "csv-dep", journalLineId: "jl-dep" }]);
  });

  it("matches a CSV line still waiting in Bank Transactions to the book line ticked, so nobody codes it twice", () => {
    expect(reconciledBankPairs([deposit, fee], [paired("jl-dep"), paired("jl-fee")], [txn("csv-dep", csvDeposit), txn("csv-fee", csvFee)])).toEqual([
      { bankTransactionId: "csv-dep", journalLineId: "jl-dep" },
      { bankTransactionId: "csv-fee", journalLineId: "jl-fee" },
    ]);
  });

  it("hands over no line of another source matched to some other entry, or ignored: it may be another payment", () => {
    expect(
      reconciledBankPairs(
        [deposit, fee],
        [paired("jl-dep"), paired("jl-fee")],
        [txn("csv-dep", csvDeposit, { status: "matched", approvedLineId: "jl-other" }), txn("csv-fee", csvFee, { status: "ignored" })],
      ),
    ).toEqual([]);
  });

  it("prefers the statement's own bank line, and pairs each bank line once across lines of one day and amount", () => {
    const second = line("2026-07-14", 250000, "Zelle Payment From Another Customer 10000000002");
    const pairs = reconciledBankPairs(
      [deposit, second],
      [paired("jl-1"), paired("jl-2")],
      [txn("own-dep", deposit), txn("csv-a", csvDeposit), txn("csv-b", { ...csvDeposit, description: "ZELLE FROM ANOTHER" })],
    );
    expect(pairs).toEqual([
      { bankTransactionId: "own-dep", journalLineId: "jl-1" },
      { bankTransactionId: "csv-a", journalLineId: "jl-2" },
    ]);
    expect(new Set(pairs.map((p) => p.bankTransactionId)).size).toBe(pairs.length);
  });

  it("keeps a line of another source with the book line it is matched to, whichever statement line comes first", () => {
    const second = line("2026-07-14", 250000, "Zelle Payment From Another Customer 10000000002");
    expect(
      reconciledBankPairs(
        [deposit, second],
        [paired("jl-1"), paired("jl-2")],
        [txn("csv-a", csvDeposit), txn("csv-b", csvDeposit, { status: "matched", approvedLineId: "jl-2" })],
      ),
    ).toEqual([
      { bankTransactionId: "csv-b", journalLineId: "jl-2" },
      { bankTransactionId: "csv-a", journalLineId: "jl-1" },
    ]);
  });
});

describe("what a run says about the statement lines", () => {
  it("says the lines already in Bank Transactions were left as they were", () => {
    expect(runLinesSentence({ added: 0, alreadyHere: 134 })).toBe(
      "134 statement lines were already in Bank Transactions and were left as they were — not imported or categorized again.",
    );
    expect(runLinesSentence({ added: 0, alreadyHere: 1 })).toBe(
      "1 statement line was already in Bank Transactions and was left as it was — not imported or categorized again.",
    );
  });

  it("says how many lines Bank Transactions did not have went there", () => {
    expect(runLinesSentence({ added: 2, alreadyHere: 10 })).toBe(
      "10 statement lines were already in Bank Transactions and were left as they were — not imported or categorized again. " +
        "2 statement lines Bank Transactions did not have were added there.",
    );
    expect(runLinesSentence({ added: 1, alreadyHere: 0 })).toBe("1 statement line Bank Transactions did not have was added there.");
  });

  it("says nothing when there were no lines, and adds months up", () => {
    expect(runLinesSentence(NO_RUN_LINES)).toBe("");
    expect(addRunLines({ added: 1, alreadyHere: 2 }, { added: 3, alreadyHere: 4 })).toEqual({ added: 4, alreadyHere: 6 });
  });
});

describe("what matching says", () => {
  const counts = (extra: Partial<typeof NO_BANK_LINE_MATCHES>) => ({ ...NO_BANK_LINE_MATCHES, ...extra });

  it("counts the bank lines left for the person to check", () => {
    expect(bankLinesToCheck(counts({ matched: 5, already: 2 }))).toBe(0);
    expect(bankLinesToCheck(counts({ matched: 1, elsewhere: 1, ignored: 2, differs: 1 }))).toBe(4);
  });

  it("adds two runs' counts", () => {
    expect(addMatchCounts(counts({ matched: 2, ignored: 1 }), counts({ matched: 3, already: 4, elsewhere: 1, differs: 2 }))).toEqual({
      matched: 5,
      already: 4,
      elsewhere: 1,
      ignored: 1,
      differs: 2,
    });
  });

  it("says how many bank lines are matched", () => {
    expect(completedMessage(counts({ matched: 12, already: 3 }), null)).toBe(
      "Reconciliation completed. 12 bank lines matched in Bank Transactions.",
    );
    expect(completedMessage(counts({ matched: 1 }), null)).toBe("Reconciliation completed. 1 bank line matched in Bank Transactions.");
  });

  it("says nothing more when nothing was matched or left", () => {
    expect(completedMessage(counts({ already: 4 }), null)).toBe("Reconciliation completed.");
    expect(completedMessage(null, null)).toBe("Reconciliation completed.");
  });

  it("names the lines left as they were, and where to look", () => {
    expect(completedMessage(counts({ matched: 12, elsewhere: 2 }), null)).toBe(
      "Reconciliation completed. 12 bank lines matched in Bank Transactions. 2 are matched to another entry — check them in Bank Transactions.",
    );
    expect(bankLinesMatchedSentence(counts({ matched: 3, elsewhere: 1, ignored: 2, differs: 1 }))).toBe(
      "3 bank lines matched in Bank Transactions. 1 is matched to another entry, 2 are ignored and 1 has the opposite sign to the books — check them in Bank Transactions.",
    );
    expect(bankLinesMatchedSentence(counts({ ignored: 1 }))).toBe("Of the bank lines, 1 is ignored — check it in Bank Transactions.");
  });

  it("says when the bank lines could not be matched, and that the month is signed", () => {
    expect(completedMessage(null, "connection lost")).toBe(
      "Reconciliation completed. Its bank lines could not be matched in Bank Transactions (connection lost); approve them there.",
    );
  });

  it("names the month when a run signed several", () => {
    expect(bankLinesNotMatchedSentence("connection lost", "Jul 31, 2026")).toBe(
      "The bank lines to Jul 31, 2026 could not be matched in Bank Transactions (connection lost); approve them there.",
    );
  });
});
