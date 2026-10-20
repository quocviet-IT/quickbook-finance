import { describe, expect, it } from "vitest";
import { journalEntryAmountMinor } from "@/lib/domain/journal-entry-amount";
import { journalReportSheet } from "@/lib/domain/ledger-report-sheets";
import type { JournalEntrySummary } from "@/lib/services/journal";

/** Journal Entries and the Journal Report show each entry's amount (UI review, 2026-10-20). */
describe("a journal entry's amount", () => {
  it("is the sum of its debits, which a balanced entry's credits equal", () => {
    expect(
      journalEntryAmountMinor([
        { debitMinor: 125_000, creditMinor: 0 },
        { debitMinor: 0, creditMinor: 100_000 },
        { debitMinor: 0, creditMinor: 25_000 },
      ]),
    ).toBe(125_000);
  });

  it("shows the larger side when an entry does not balance, rather than hide the difference", () => {
    expect(journalEntryAmountMinor([{ debitMinor: 10_000, creditMinor: 0 }, { debitMinor: 0, creditMinor: 12_000 }])).toBe(12_000);
  });

  it("is zero for an entry with no lines", () => {
    expect(journalEntryAmountMinor([])).toBe(0);
  });

  it("is carried into the Journal Report's export, beside each of the entry's lines", () => {
    const entry: JournalEntrySummary = {
      id: "e1",
      entryNumber: "JE-000001",
      entryDate: "2026-10-01",
      description: "Example deposit",
      sourceType: "manual",
      sourceId: null,
      status: "posted",
      isReversed: false,
      reversalEntryId: null,
      isReversal: false,
      adjusting: null,
      lines: [
        { accountCode: "1010", accountName: "Operating Bank Account", debitMinor: 125_000, creditMinor: 0, memo: null },
        { accountCode: "4000", accountName: "Sales Revenue", debitMinor: 0, creditMinor: 125_000, memo: null },
      ],
    };
    const sheet = journalReportSheet([entry], { from: "2026-10-01", to: "2026-10-31" }, { companyName: "Example Co", currencyCode: "USD", baseDecimals: 2 });
    expect(sheet.columns.map((c) => c.header)).toContain("Entry amount");
    expect(sheet.rows.map((row) => row.amount)).toEqual([1250, 1250]);
  });
});
