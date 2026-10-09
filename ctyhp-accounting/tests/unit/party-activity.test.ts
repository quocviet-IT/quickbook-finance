import { describe, expect, it } from "vitest";
import { NO_CUSTOMER, NO_VENDOR, partyActivity, partyActivitySheet, type PartyLedgerLine } from "@/lib/domain/party-activity";

const line = (over: Partial<PartyLedgerLine>): PartyLedgerLine => ({
  entryId: "e1",
  accountId: "a1",
  amountMinor: 1_000,
  partyId: "c1",
  partyName: "Example Retail",
  invoiceId: null,
  ...over,
});

describe("partyActivity for sales", () => {
  const report = partyActivity(
    [
      line({ entryId: "e1", invoiceId: "i1", amountMinor: 30_000 }),
      line({ entryId: "e1", accountId: "a2", invoiceId: "i1", amountMinor: 5_000 }),
      line({ entryId: "e2", invoiceId: "i2", amountMinor: 10_000 }),
      // A credit memo for the same customer: takes sales off, is not a document.
      line({ entryId: "e3", invoiceId: null, amountMinor: -5_000 }),
      line({ entryId: "e4", partyId: "c2", partyName: "Beta Stores", invoiceId: "i3", amountMinor: 50_000 }),
      // A bank deposit coded to income.
      line({ entryId: "e5", partyId: null, partyName: null, amountMinor: 10_000 }),
    ],
    "invoices",
    NO_CUSTOMER,
  );

  it("ranks customers by total, largest first, with the unattributed row last", () => {
    expect(report.lines.map((l) => l.partyName)).toEqual(["Beta Stores", "Example Retail", NO_CUSTOMER]);
  });

  it("nets credit memos into the customer's total and counts invoices, not lines", () => {
    const example = report.lines.find((l) => l.partyId === "c1")!;
    expect(example.totalMinor).toBe(40_000);
    expect(example.count).toBe(2);
  });

  it("totals everything, the unattributed lines included, so it can equal the P&L", () => {
    expect(report.totalMinor).toBe(100_000);
    expect(report.unattributedCount).toBe(1);
    expect(report.lines.find((l) => l.partyId === null)!.totalMinor).toBe(10_000);
  });

  it("gives each row its share of the total", () => {
    expect(report.lines.map((l) => l.percent)).toEqual([50, 40, 10]);
  });
});

describe("partyActivity for spending", () => {
  it("counts an entry once per account it touches", () => {
    const report = partyActivity(
      [
        line({ entryId: "e1", accountId: "rent" }),
        line({ entryId: "e1", accountId: "utilities" }),
        line({ entryId: "e1", accountId: "utilities", amountMinor: 200 }),
        line({ entryId: "e2", accountId: "rent" }),
      ],
      "entryAccounts",
      NO_VENDOR,
    );
    expect(report.lines[0].count).toBe(3);
    expect(report.lines[0].totalMinor).toBe(3_200);
  });

  it("leaves out a party whose lines net to zero, and has no share when the total is zero", () => {
    const report = partyActivity(
      [line({ amountMinor: 1_000 }), line({ entryId: "e2", amountMinor: -1_000 })],
      "entryAccounts",
      NO_VENDOR,
    );
    expect(report.lines).toEqual([]);
    expect(report.totalMinor).toBe(0);
    const zeroTotal = partyActivity(
      [line({ amountMinor: 1_000 }), line({ partyId: "v2", partyName: "Other", amountMinor: -1_000 })],
      "entryAccounts",
      NO_VENDOR,
    );
    expect(zeroTotal.lines.every((l) => l.percent === null)).toBe(true);
  });
});

describe("partyActivitySheet", () => {
  it("leaves the document count empty on the no-customer line, which has no invoice to count", () => {
    const sheet = partyActivitySheet(
      {
        lines: [
          { partyId: "c1", partyName: "Example Retail", count: 2, totalMinor: 6_000, percent: 60 },
          { partyId: null, partyName: NO_CUSTOMER, count: 0, totalMinor: 4_000, percent: 40 },
        ],
        totalMinor: 10_000,
        unattributedCount: 3,
      },
      "sales",
      { companyName: "Example Co", from: "2026-01-01", to: "2026-10-08", currencyCode: "USD", baseDecimals: 2 },
    );
    expect(sheet.rows.map((r) => r.count)).toEqual([2, null, null]);
  });

  it("exports the summary with its counts, shares and a total row", () => {
    const sheet = partyActivitySheet(
      { lines: [{ partyId: "v1", partyName: "Example Supply", count: 2, totalMinor: 3_333, percent: 33.333 }], totalMinor: 10_000, unattributedCount: 0 },
      "expenses",
      { companyName: "Example Co", from: "2026-01-01", to: "2026-10-08", currencyCode: "USD", baseDecimals: 2 },
    );
    expect(sheet.title).toBe("Expenses by Vendor Summary");
    expect(sheet.columns.map((c) => c.header)).toEqual(["Vendor", "Entries", "Total", "% of spend"]);
    expect(sheet.rows).toEqual([
      { party: "Example Supply", count: 2, total: 33.33, percent: 33.3 },
      { party: "Total", count: null, total: 100, percent: 100 },
    ]);
  });
});
