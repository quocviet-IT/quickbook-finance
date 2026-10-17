import { describe, expect, it } from "vitest";
import {
  candidateNote,
  checkTransfers,
  correctedSentence,
  destinationSentence,
  toTransferRow,
  transferNote,
  type TransferRow,
} from "@/lib/domain/transfer-legs";

/** All invented: three accounts, one transfer of $1,000.00 on a June day. */
const CHECKING = "acct-checking";
const SAVINGS = "acct-savings";
const RESERVE = "acct-reserve";
const TODAY = "2026-09-01";

const NAMES: Record<string, string> = { [CHECKING]: "Example Checking", [SAVINGS]: "Example Savings", [RESERVE]: "Example Reserve" };
const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

const base: TransferRow = {
  rowKey: "",
  rowKind: "leg",
  entryId: "",
  entryNumber: "",
  entryDate: "2026-06-10",
  bankAccountId: null,
  journalLineId: null,
  signedMinor: null,
  tickedReconciliationId: null,
  tickedStatementDate: null,
  coveredThrough: null,
  candidateSource: null,
  candidateId: null,
  candidateBankAccountId: null,
  candidateDate: null,
  candidateEntryId: null,
  candidateEntryNumber: null,
  reversedByEntryId: null,
  reversedByEntryNumber: null,
  reversalOfEntryId: null,
};

const leg = (over: Partial<TransferRow> & Pick<TransferRow, "entryId" | "entryNumber" | "bankAccountId" | "signedMinor">): TransferRow => ({
  ...base,
  rowKey: `leg:${over.journalLineId ?? over.entryId + over.bankAccountId}`,
  journalLineId: `${over.entryId}:${over.bankAccountId}`,
  ...over,
});

/** The transfer: Checking pays out and is ticked on a June statement; Savings receives and is not ticked. */
const transfer = (over: { savingsCovered?: string | null; savingsTicked?: boolean; checkingTicked?: boolean } = {}): TransferRow[] => [
  leg({
    entryId: "e1",
    entryNumber: "JE-900001",
    bankAccountId: CHECKING,
    signedMinor: -100000,
    tickedReconciliationId: over.checkingTicked === false ? null : "r-checking",
    tickedStatementDate: over.checkingTicked === false ? null : "2026-06-30",
    coveredThrough: "2026-06-30",
  }),
  leg({
    entryId: "e1",
    entryNumber: "JE-900001",
    bankAccountId: SAVINGS,
    signedMinor: 100000,
    tickedReconciliationId: over.savingsTicked ? "r-savings" : null,
    tickedStatementDate: over.savingsTicked ? "2026-06-30" : null,
    coveredThrough: over.savingsCovered === undefined ? "2026-06-30" : over.savingsCovered,
  }),
];

/** A third account shows the amount that day: a ledger line there. */
const evidence = (over: Partial<TransferRow> = {}): TransferRow => ({
  ...base,
  rowKey: "candidate:savings-line:ledger_line:c1",
  rowKind: "candidate",
  entryId: "e1",
  entryNumber: "JE-900001",
  bankAccountId: SAVINGS,
  journalLineId: `e1:${SAVINGS}`,
  signedMinor: 100000,
  coveredThrough: "2026-06-30",
  candidateSource: "ledger_line",
  candidateId: "l-reserve",
  candidateBankAccountId: RESERVE,
  candidateDate: "2026-06-10",
  candidateEntryId: "e-reserve",
  candidateEntryNumber: "JE-900002",
  ...over,
});

/** The correcting entry: Savings pays the money on to Reserve three days later. */
const correction = (): TransferRow[] => [
  leg({ entryId: "e3", entryNumber: "JE-900003", entryDate: "2026-06-13", bankAccountId: SAVINGS, signedMinor: -100000, coveredThrough: "2026-06-30" }),
  leg({ entryId: "e3", entryNumber: "JE-900003", entryDate: "2026-06-13", bankAccountId: RESERVE, signedMinor: 100000, coveredThrough: "2026-06-30" }),
];

describe("fixture A: before the correction", () => {
  const check = checkTransfers([...transfer(), evidence()], TODAY);

  it("raises one exception", () => {
    expect(check.flagged).toHaveLength(1);
    expect(check.corrected).toEqual([]);
    expect(check.notYetCheckable).toBe(0);
  });

  it("says where it cleared, where it did not and how much", () => {
    const [f] = check.flagged;
    expect(f.entryNumber).toBe("JE-900001");
    expect(f.entryDate).toBe("2026-06-10");
    expect(f.amountMinor).toBe(100000);
    expect(NAMES[f.clearedBankAccountId]).toBe("Example Checking");
    expect(f.clearedStatementDate).toBe("2026-06-30");
    expect(NAMES[f.openBankAccountId]).toBe("Example Savings");
  });

  it("names the third account as the likely destination", () => {
    const [f] = check.flagged;
    expect(f.destination?.bankAccountId).toBe(RESERVE);
    expect(destinationSentence(NAMES[f.destination?.bankAccountId ?? ""])).toBe("Likely went to Example Reserve");
    expect(f.candidateCount).toBe(1);
    expect(candidateNote(f.candidateCount)).toBe("1 candidate found");
  });
});

describe("fixture B: after the correction", () => {
  const check = checkTransfers([...transfer(), evidence(), ...correction()], TODAY);

  it("raises no exception and reports the transfer as corrected", () => {
    expect(check.flagged).toEqual([]);
    expect(check.corrected).toHaveLength(1);
    expect(check.corrected[0].entryNumber).toBe("JE-900001");
  });

  it("names the correcting entry and where the money went, and never offers to reverse anything", () => {
    const [c] = check.corrected;
    expect(c.correctingEntryNumber).toBe("JE-900003");
    expect(NAMES[c.movedToBankAccountId ?? ""]).toBe("Example Reserve");
    const sentence = correctedSentence(c, NAMES[c.movedToBankAccountId ?? ""], money);
    expect(sentence).toBe("JE-900001 was corrected by JE-900003 and moved $1000.00 to Example Reserve.");
    const everything = [sentence, transferNote(check), destinationSentence(null), candidateNote(2) ?? ""].join(" ");
    expect(everything).not.toMatch(/revers|void|undo/i);
  });

  it("does not count a correction more than 7 days away", () => {
    const late = correction().map((r) => ({ ...r, entryDate: "2026-06-20" }));
    const again = checkTransfers([...transfer(), evidence(), ...late], TODAY);
    expect(again.flagged).toHaveLength(1);
    expect(again.corrected).toEqual([]);
  });

  it("does not count a correction that moves the money back to the account it came from", () => {
    const back = correction().map((r) => (r.bankAccountId === RESERVE ? { ...r, bankAccountId: CHECKING } : r));
    expect(checkTransfers([...transfer(), evidence(), ...back], TODAY).corrected).toEqual([]);
  });
});

describe("fixture C: not yet checkable", () => {
  it("counts it and does not flag it when the receiving account's statements stop before the date", () => {
    const check = checkTransfers(transfer({ savingsCovered: "2026-05-31" }), TODAY);
    expect(check.flagged).toEqual([]);
    expect(check.notYetCheckable).toBe(1);
  });

  it("counts a receiving account with no completed statement at all", () => {
    expect(checkTransfers(transfer({ savingsCovered: null }), TODAY).notYetCheckable).toBe(1);
  });
});

describe("what is not raised", () => {
  it("gives nothing for a transfer more than 30 days old cleared on both sides", () => {
    const check = checkTransfers(transfer({ savingsTicked: true }), TODAY);
    expect(check).toEqual({ flagged: [], notYetCheckable: 0, corrected: [], skipped: 0 });
  });

  it("gives nothing when neither leg is ticked yet", () => {
    expect(checkTransfers(transfer({ checkingTicked: false }), TODAY).flagged).toEqual([]);
  });

  it("waits until the entry is more than 30 days old, by the date it is given", () => {
    expect(checkTransfers(transfer(), "2026-07-10").flagged).toEqual([]);
    expect(checkTransfers(transfer(), "2026-07-11").flagged).toHaveLength(1);
  });

  it("says no other account shows it when there is no evidence", () => {
    const [f] = checkTransfers(transfer(), TODAY).flagged;
    expect(f.destination).toBeNull();
    expect(f.candidateCount).toBe(0);
    expect(destinationSentence(null)).toBe("No other account shows it");
    expect(candidateNote(0)).toBeNull();
  });

  it("does not take the account the money left as its destination", () => {
    const [f] = checkTransfers([...transfer(), evidence({ candidateBankAccountId: CHECKING })], TODAY).flagged;
    expect(f.destination).toBeNull();
  });

  it("skips an entry with more than two bank lines and counts it", () => {
    const skippedRow: TransferRow = { ...base, rowKey: "skipped:e9", rowKind: "skipped", entryId: "e9", entryNumber: "JE-900009" };
    const check = checkTransfers([...transfer({ savingsTicked: true }), skippedRow], TODAY);
    expect(check.skipped).toBe(1);
    expect(check.flagged).toEqual([]);
    expect(transferNote(check)).toBe("0 transfers · 0 could not be checked yet · 0 corrected · 1 skipped");
  });
});

describe("a reversed transfer", () => {
  /** The original, reversed by JE-900004, and the reversal itself with its two legs. */
  const reversedPair = (): TransferRow[] => [
    ...transfer().map((r) => ({ ...r, reversedByEntryId: "e4", reversedByEntryNumber: "JE-900004" })),
    leg({ entryId: "e4", entryNumber: "JE-900004", entryDate: "2026-06-12", bankAccountId: CHECKING, signedMinor: 100000, reversalOfEntryId: "e1", coveredThrough: "2026-06-30" }),
    leg({ entryId: "e4", entryNumber: "JE-900004", entryDate: "2026-06-12", bankAccountId: SAVINGS, signedMinor: -100000, reversalOfEntryId: "e1", coveredThrough: "2026-06-30" }),
  ];

  it("is not flagged, and is counted as corrected by the reversal", () => {
    const check = checkTransfers([...reversedPair(), evidence()], TODAY);
    expect(check.flagged).toEqual([]);
    expect(check.corrected).toHaveLength(1);
    expect(check.corrected[0]).toMatchObject({ entryNumber: "JE-900001", correctingEntryNumber: "JE-900004", movedToBankAccountId: null });
    expect(correctedSentence(check.corrected[0], null, money)).toBe("JE-900001 was reversed by JE-900004.");
  });

  it("never judges the reversing entry as a transfer of its own", () => {
    const onlyReversal = reversedPair().filter((r) => r.entryId === "e4");
    expect(checkTransfers(onlyReversal, TODAY)).toEqual({ flagged: [], notYetCheckable: 0, corrected: [], skipped: 0 });
    // Even with one side ticked, an entry that reverses another is left out.
    const ticked = onlyReversal.map((r) => (r.bankAccountId === CHECKING ? { ...r, tickedReconciliationId: "r-x", tickedStatementDate: "2026-06-30" } : r));
    expect(checkTransfers(ticked, TODAY).flagged).toEqual([]);
  });

  it("reads the reversal columns of an RPC row", () => {
    const row = toTransferRow({
      row_key: "leg:1", row_kind: "leg", entry_id: "e1", entry_number: "JE-900001", entry_date: "2026-06-10",
      reversed_by_entry_id: "e4", reversed_by_entry_number: "JE-900004", reversal_of_entry_id: null,
    });
    expect(row).toMatchObject({ reversedByEntryId: "e4", reversedByEntryNumber: "JE-900004", reversalOfEntryId: null });
  });
});

describe("the likely destination, best first", () => {
  it("prefers a held statement line over a ledger line, then the nearer date", () => {
    const statement = evidence({
      rowKey: "candidate:l:statement_line:s1",
      candidateSource: "statement_line",
      candidateId: "s1",
      candidateBankAccountId: "acct-other",
      candidateDate: "2026-06-16",
      candidateEntryId: null,
      candidateEntryNumber: null,
    });
    const [f] = checkTransfers([...transfer(), evidence(), statement], TODAY).flagged;
    expect(f.destination?.bankAccountId).toBe("acct-other");
    expect(f.destination?.source).toBe("statement_line");
    expect(f.candidateCount).toBe(2);
    expect(candidateNote(f.candidateCount)).toBe("2 candidates found");

    const nearer = evidence({ rowKey: "candidate:l:ledger_line:c0", candidateBankAccountId: "acct-near", candidateDate: "2026-06-10" });
    const farther = evidence({ rowKey: "candidate:l:ledger_line:c2", candidateBankAccountId: "acct-far", candidateDate: "2026-06-14" });
    const [g] = checkTransfers([...transfer(), farther, nearer], TODAY).flagged;
    expect(g.destination?.bankAccountId).toBe("acct-near");
  });
});

describe("toTransferRow", () => {
  it("reads an RPC row, bigint strings and all", () => {
    const row = toTransferRow({
      row_key: "leg:1",
      row_kind: "leg",
      entry_id: "e1",
      entry_number: "JE-900001",
      entry_date: "2026-06-10",
      bank_account_id: CHECKING,
      journal_line_id: "l1",
      signed_minor: "-100000",
      ticked_reconciliation_id: "r1",
      ticked_statement_date: "2026-06-30",
      covered_through: "2026-06-30",
    });
    expect(row.signedMinor).toBe(-100000);
    expect(row.candidateSource).toBeNull();
    expect(() => toTransferRow({ ...row, row_kind: "other", row_key: "x", entry_id: "e", entry_number: "n", entry_date: "2026-01-01" })).toThrow();
  });
});
