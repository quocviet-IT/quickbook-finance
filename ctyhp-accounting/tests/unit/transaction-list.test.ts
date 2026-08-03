import { describe, expect, it } from "vitest";
import {
  buildTransactionListSheet,
  transactionListTotals,
  type TransactionListRow,
} from "@/lib/domain/transaction-list";

const row = (over: Partial<TransactionListRow> = {}): TransactionListRow => ({
  entryId: "e1",
  entryNumber: "JE-000001",
  entryDate: "2026-08-01",
  description: "Gold wire purchase",
  sourceType: "expense",
  partyName: "Pacific Stone Supply",
  categoryLabel: "COGS - Materials",
  moneyLabel: "Cash in Bank",
  amountMinor: -125_000,
  currencyCode: "USD",
  reconciled: false,
  ...over,
});

describe("transactionListTotals", () => {
  it("separates money in from money out and nets them", () => {
    const totals = transactionListTotals([
      row({ amountMinor: -125_000 }),
      row({ amountMinor: 350_000 }),
      row({ amountMinor: -320_000 }),
    ]);
    expect(totals.inMinor).toBe(350_000);
    expect(totals.outMinor).toBe(445_000);
    expect(totals.netMinor).toBe(-95_000);
  });

  it("counts what still needs reconciling", () => {
    const totals = transactionListTotals([
      row({ reconciled: true }),
      row({ reconciled: false }),
      row({ reconciled: false }),
    ]);
    expect(totals.count).toBe(3);
    expect(totals.unreconciled).toBe(2);
  });

  it("is all zeros for an empty range rather than undefined", () => {
    expect(transactionListTotals([])).toEqual({
      count: 0,
      inMinor: 0,
      outMinor: 0,
      netMinor: 0,
      unreconciled: 0,
    });
  });
});

describe("buildTransactionListSheet", () => {
  const sheet = buildTransactionListSheet({
    rows: [row(), row({ entryId: "e2", amountMinor: 350_000, reconciled: true, partyName: null, moneyLabel: null })],
    companyName: "Aurora Fine Jewelry LLC",
    from: "2026-08-01",
    to: "2026-08-31",
    currencyCode: "USD",
  });

  it("carries the seven columns the report is asked for, in order", () => {
    expect(sheet.columns.map((c) => c.header)).toEqual([
      "Date",
      "Vendor/Customer Name",
      "Description",
      "Account Type",
      "Bank or Credit Card",
      "Amount",
      "Reconciled",
    ]);
  });

  it("exports the amount as a number so a spreadsheet can total it", () => {
    // A pre-formatted "-$1,250.00" string is what makes an exported report
    // useless for the analysis it was exported for.
    const amount = sheet.columns.find((c) => c.header === "Amount");
    expect(amount?.kind).toBe("money");
    expect(sheet.rows[0].amount).toBe(-1250);
  });

  it("writes Reconciled as Yes or No rather than true or false", () => {
    expect(sheet.rows[0].reconciled).toBe("No");
    expect(sheet.rows[1].reconciled).toBe("Yes");
  });

  it("leaves a missing counterparty or money account empty, not 'null'", () => {
    expect(sheet.rows[1].party).toBe("");
    expect(sheet.rows[1].money).toBe("");
  });

  it("names the file and subtitle after the range it covers", () => {
    expect(sheet.fileName).toContain("2026-08-01");
    expect(sheet.fileName).toContain("2026-08-31");
    expect(sheet.subtitle).toContain("2026-08-01");
    expect(sheet.subtitle).toContain("2026-08-31");
    expect(sheet.title).toBe("Transaction List by Date");
  });
});
