import { describe, expect, it } from "vitest";
import {
  buildControlReconciliation,
  buildPostingReport,
  checkControl,
  checkPosting,
  describeControlExceptions,
  describePostingExceptions,
  expectationOf,
  type ControlRow,
  type PostingRow,
} from "@/lib/domain/gl-posting";

const doc = (over: Partial<PostingRow> = {}): PostingRow => ({
  sourceType: "invoice",
  documentId: "d1",
  documentNumber: "INV-000001",
  documentDate: "2026-07-15",
  partyName: "Daniel Carter",
  documentStatus: "issued",
  amountMinor: 120_000,
  journalEntryId: "e1",
  entryNumber: "JE-000001",
  entryDate: "2026-07-15",
  entryStatus: "posted",
  entryTotalMinor: 120_000,
  ...over,
});

describe("expectationOf", () => {
  it("expects a live document on the ledger", () => {
    for (const status of ["issued", "partial", "paid", "open", "applied", "posted"]) {
      expect(expectationOf(status)).toBe("expected");
    }
  });

  it("keeps drafts and voids off it", () => {
    for (const status of ["draft", "void", "rejected", "cancelled"]) {
      expect(expectationOf(status)).toBe("none");
    }
  });
});

describe("checkPosting", () => {
  it("passes a live document with a posted entry that carries its total", () => {
    const check = checkPosting(doc());
    expect(check.verdict).toBe("posted");
    expect(check.isException).toBe(false);
  });

  it("flags a live document with no journal entry at all", () => {
    const check = checkPosting(doc({ journalEntryId: null, entryStatus: null, entryTotalMinor: 0 }));
    expect(check.verdict).toBe("missing_entry");
    expect(check.isException).toBe(true);
  });

  it("flags a live document whose entry never posted", () => {
    expect(checkPosting(doc({ entryStatus: "draft" })).verdict).toBe("entry_not_posted");
  });

  it("flags an entry that does not carry the document total", () => {
    const check = checkPosting(doc({ amountMinor: 120_000, entryTotalMinor: 95_000 }));
    expect(check.verdict).toBe("amount_mismatch");
    expect(check.isException).toBe(true);
  });

  it("accepts an entry larger than the document — tax and splits ride on the same entry", () => {
    expect(checkPosting(doc({ amountMinor: 100_000, entryTotalMinor: 108_250 })).verdict).toBe(
      "posted",
    );
  });

  it("says nothing about a zero-value document either way", () => {
    expect(checkPosting(doc({ amountMinor: 0, entryTotalMinor: 0 })).verdict).toBe("posted");
  });

  it("treats a draft with no entry as correct, not as an exception", () => {
    const check = checkPosting(
      doc({ documentStatus: "draft", journalEntryId: null, entryStatus: null, entryTotalMinor: 0 }),
    );
    expect(check.verdict).toBe("off_ledger");
    expect(check.isException).toBe(false);
  });

  it("treats a void document whose entry was voided as correct", () => {
    expect(checkPosting(doc({ documentStatus: "void", entryStatus: "void" })).verdict).toBe(
      "off_ledger",
    );
  });

  it("flags a draft that somehow carries a posted entry", () => {
    const check = checkPosting(doc({ documentStatus: "draft" }));
    expect(check.verdict).toBe("posted_in_error");
    expect(check.isException).toBe(true);
  });
});

describe("buildPostingReport", () => {
  const report = () =>
    buildPostingReport([
      doc({ documentId: "a" }),
      doc({ documentId: "b", documentStatus: "draft", journalEntryId: null, entryStatus: null }),
      doc({ documentId: "c", journalEntryId: null, entryStatus: null, entryTotalMinor: 0 }),
      doc({ documentId: "d", documentStatus: "void", entryStatus: "void" }),
    ]);

  it("counts what it found", () => {
    expect(report().summary).toEqual({
      documents: 4,
      posted: 1,
      offLedger: 2,
      exceptions: 1,
      liveTotalMinor: 240_000,
    });
  });

  it("lifts the exceptions out so nobody has to hunt for them", () => {
    expect(report().exceptions.map((row) => row.documentId)).toEqual(["c"]);
  });

  it("says nothing when everything posted", () => {
    const clean = buildPostingReport([doc(), doc({ documentId: "b" })]);
    expect(clean.exceptions).toEqual([]);
    expect(describePostingExceptions(clean)).toBeNull();
  });

  it("names each kind of problem in one sentence", () => {
    const message = describePostingExceptions(report());
    expect(message).toContain("1 document(s) need attention");
    expect(message).toContain("no journal entry");
  });

  it("reads an empty period as clean, not as broken", () => {
    const empty = buildPostingReport([]);
    expect(empty.summary.documents).toBe(0);
    expect(describePostingExceptions(empty)).toBeNull();
  });
});

const control = (over: Partial<ControlRow> = {}): ControlRow => ({
  controlKey: "ar",
  label: "Accounts Receivable",
  accountCodes: "1100",
  hasSubledger: true,
  subledgerMinor: 850_548,
  controlMinor: 850_548,
  ...over,
});

describe("checkControl", () => {
  it("ties out when the subledger equals the control account", () => {
    const check = checkControl(control());
    expect(check.varianceMinor).toBe(0);
    expect(check.tiesOut).toBe(true);
    expect(check.isException).toBe(false);
  });

  it("reports the variance with its sign — subledger less ledger", () => {
    const check = checkControl(control({ subledgerMinor: 834_310, controlMinor: 850_548 }));
    expect(check.varianceMinor).toBe(-16_238);
    expect(check.isException).toBe(true);
  });

  it("treats one cent as a real difference", () => {
    expect(checkControl(control({ controlMinor: 850_549 })).tiesOut).toBe(false);
  });

  it("accepts an account with no subledger when it is empty", () => {
    const check = checkControl(
      control({ controlKey: "undeposited", hasSubledger: false, subledgerMinor: 0, controlMinor: 0 }),
    );
    expect(check.tiesOut).toBe(true);
    expect(check.isException).toBe(false);
  });

  it("flags money sitting in an account nothing feeds", () => {
    const check = checkControl(
      control({
        controlKey: "undeposited",
        label: "Undeposited Funds",
        hasSubledger: false,
        subledgerMinor: 0,
        controlMinor: 45_000,
      }),
    );
    expect(check.varianceMinor).toBe(45_000);
    expect(check.isException).toBe(true);
  });
});

describe("buildControlReconciliation", () => {
  it("is clean only when every account ties out", () => {
    const clean = buildControlReconciliation("2026-08-01", [
      control(),
      control({ controlKey: "ap", label: "Accounts Payable", subledgerMinor: 300_00, controlMinor: 300_00 }),
    ]);
    expect(clean.allTieOut).toBe(true);
    expect(describeControlExceptions(clean)).toBeNull();
  });

  it("names every account that is out, and by how much", () => {
    const out = buildControlReconciliation("2026-08-01", [
      control({ subledgerMinor: 834_310, controlMinor: 850_548 }),
      control({
        controlKey: "undeposited",
        label: "Undeposited Funds",
        hasSubledger: false,
        subledgerMinor: 0,
        controlMinor: 45_000,
      }),
    ]);
    expect(out.allTieOut).toBe(false);
    const message = describeControlExceptions(out)!;
    expect(message).toContain("2 control account(s) do not tie out as of 2026-08-01");
    expect(message).toContain("Accounts Receivable is out by 162.38");
    expect(message).toContain("Undeposited Funds holds 450.00 with no subledger behind it");
  });
});
