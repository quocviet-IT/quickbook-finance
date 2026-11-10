import { describe, expect, it } from "vitest";
import { billVoidConfirm, billVoidOption, type VoidableBill } from "@/lib/domain/bill-void";
import { VOID_BLOCKED_BY_SETTLEMENT } from "@/lib/domain/document-void";

const POSTED: VoidableBill = {
  status: "open",
  bill_number: "BILL-000003",
  vendor_name: "Cascade Office Supply",
  total_minor: 620_000,
  balance_due_minor: 620_000,
  entry_number: "JE-000015",
};

const DRAFT: VoidableBill = { ...POSTED, status: "draft", bill_number: null, entry_number: null };

describe("billVoidOption", () => {
  it("offers Void on a draft and on a posted bill nothing has been paid against", () => {
    expect(billVoidOption(DRAFT)).toEqual({ offered: true, blockedReason: null });
    expect(billVoidOption(POSTED)).toEqual({ offered: true, blockedReason: null });
  });

  // acc_void_bill (0169) refuses a non-draft bill whose balance due differs
  // from its total; the menu offered Void anyway and the database said no
  // only after the reader had confirmed.
  it("says why Void is unavailable once money is applied", () => {
    const partial = { ...POSTED, status: "partial" as const, balance_due_minor: 100_000 };
    expect(billVoidOption(partial)).toEqual({ offered: true, blockedReason: VOID_BLOCKED_BY_SETTLEMENT });
  });

  it("does not offer Void on a paid or an already void bill", () => {
    expect(billVoidOption({ ...POSTED, status: "paid", balance_due_minor: 0 })).toEqual({ offered: false });
    expect(billVoidOption({ ...POSTED, status: "void", balance_due_minor: 0 })).toEqual({ offered: false });
  });
});

describe("billVoidConfirm", () => {
  it("names a posted bill, the journal entry it reverses, and who stops being owed", () => {
    expect(billVoidConfirm(POSTED)).toEqual({
      title: "Void BILL-000003?",
      content:
        "This reverses journal entry JE-000015, so the bill comes off the ledger and is no longer owed to Cascade Office Supply.",
    });
  });

  it("names a draft by its vendor and says the ledger does not change", () => {
    expect(billVoidConfirm(DRAFT)).toEqual({
      title: "Void the draft bill from Cascade Office Supply?",
      content:
        "Nothing has been posted for a draft, so the ledger does not change. The draft stays in the list, marked Void.",
    });
  });
});
