import { describe, expect, it } from "vitest";
import {
  ageLabel,
  daysPastDue,
  openDocuments,
  openDocumentsSheet,
  partyBalances,
  partyBalancesSheet,
  type DocumentAmount,
  type OpenItemRow,
} from "@/lib/domain/open-items";
import { tieOut } from "@/lib/domain/tie-out";

const row = (over: Partial<OpenItemRow>): OpenItemRow => ({
  partyId: "c1",
  partyName: "Example Retail",
  docType: "invoice",
  docNumber: "INV-1",
  docDate: "2026-09-01",
  dueDate: "2026-09-30",
  balanceMinor: 10_000,
  ...over,
});

const amounts = (list: DocumentAmount[]) => new Map(list.map((a) => [a.number, a]));

describe("age", () => {
  it("counts whole days past due, and reads not-yet-due as Current", () => {
    expect(daysPastDue("2026-09-30", "2026-09-30")).toBe(0);
    expect(daysPastDue("2026-09-30", "2026-10-01")).toBe(1);
    expect(daysPastDue("2026-10-15", "2026-10-01")).toBe(-14);
    expect(ageLabel(0)).toBe("Current");
    expect(ageLabel(-3)).toBe("Current");
    expect(ageLabel(1)).toBe("1 day");
    expect(ageLabel(45)).toBe("45 days");
  });
});

describe("openDocuments", () => {
  const rows = [
    row({ partyId: "c2", partyName: "Beta Stores", docNumber: "INV-3", dueDate: "2026-10-20", balanceMinor: 5_000 }),
    row({ docNumber: "INV-2", dueDate: "2026-08-31", balanceMinor: 2_500 }),
    row({ docNumber: "INV-1", dueDate: "2026-09-30", balanceMinor: 10_000 }),
    row({ docType: "credit_memo", docNumber: "CM-1", balanceMinor: -1_500 }),
    row({ docType: "payment", docNumber: "PMT-9", balanceMinor: -500 }),
  ];
  const report = openDocuments(
    rows,
    "2026-10-08",
    "invoice",
    amounts([
      { number: "INV-1", totalMinor: 12_000, balanceMinor: 10_000 },
      { number: "INV-2", totalMinor: 2_500, balanceMinor: 2_500 },
      { number: "INV-3", totalMinor: 5_000, balanceMinor: 5_000 },
    ]),
  );

  it("lists the invoices only, by customer then due date", () => {
    expect(report.lines.map((l) => l.docNumber)).toEqual(["INV-3", "INV-2", "INV-1"]);
    expect(report.lines.map((l) => l.partyName)).toEqual(["Beta Stores", "Example Retail", "Example Retail"]);
  });

  it("totals the invoices, takes the credits off, and lands on the aging total", () => {
    expect(report.documentsMinor).toBe(17_500);
    expect(report.creditsMinor).toBe(-2_000);
    expect(report.agingTotalMinor).toBe(15_500);
  });

  it("gives each invoice its days past due and its original amount", () => {
    const inv1 = report.lines.find((l) => l.docNumber === "INV-1")!;
    expect(inv1.daysPastDue).toBe(8);
    expect(inv1.amountMinor).toBe(12_000);
    expect(inv1.openMinor).toBe(10_000);
    expect(report.lines.find((l) => l.docNumber === "INV-3")!.daysPastDue).toBe(-12);
  });

  it("puts a foreign-currency invoice's amount at the rate of its open balance", () => {
    const foreign = openDocuments(
      [row({ docNumber: "INV-7", balanceMinor: 20_000 })],
      "2026-10-08",
      "invoice",
      // 100.00 open of 150.00 in the document's currency; 200.00 open in base.
      amounts([{ number: "INV-7", totalMinor: 15_000, balanceMinor: 10_000 }]),
    );
    expect(foreign.lines[0].amountMinor).toBe(30_000);
  });

  it("leaves the amount empty rather than guess when the invoice cannot be read", () => {
    const missing = openDocuments([row({ docNumber: "INV-8" })], "2026-10-08", "invoice", new Map());
    expect(missing.lines[0].amountMinor).toBeNull();
  });

  it("gives two unnumbered invoices for one customer on one date different keys", () => {
    const twin = openDocuments(
      [row({ docNumber: null, balanceMinor: 1_000 }), row({ docNumber: null, balanceMinor: 2_000 })],
      "2026-10-08",
      "invoice",
      new Map(),
    );
    expect(twin.lines).toHaveLength(2);
    expect(twin.lines[0].key).not.toBe(twin.lines[1].key);
  });

  it("reads bills the same way for Unpaid Bills", () => {
    const bills = openDocuments(
      [row({ docType: "bill", docNumber: "B-1", balanceMinor: 4_000 }), row({ docType: "vendor_credit", docNumber: "VC-1", balanceMinor: -1_000 })],
      "2026-10-08",
      "bill",
      amounts([{ number: "B-1", totalMinor: 4_000, balanceMinor: 4_000 }]),
    );
    expect(bills.lines.map((l) => l.docNumber)).toEqual(["B-1"]);
    expect(bills.agingTotalMinor).toBe(3_000);
  });

  it("exports the table with the credits and the aging total under it", () => {
    const sheet = openDocumentsSheet(report, "invoice", { companyName: "Example Co", asOf: "2026-10-08", currencyCode: "USD", baseDecimals: 2 });
    expect(sheet.title).toBe("Open Invoices");
    expect(sheet.fileName).toBe("open-invoices-as-of-2026-10-08");
    expect(sheet.rows.at(-3)).toMatchObject({ party: "Total open invoices", open: 175 });
    expect(sheet.rows.at(-2)).toMatchObject({ party: "Credits and unapplied payments", open: -20 });
    expect(sheet.rows.at(-1)).toMatchObject({ party: "A/R Aging total", open: 155 });
    expect(sheet.rows[0]).toMatchObject({ num: "INV-3", age: "Current", amount: 50, open: 50 });
  });
});

describe("partyBalances", () => {
  it("nets each party's documents and credits, drops those at zero, and sorts by name", () => {
    const report = partyBalances([
      row({ partyId: "c2", partyName: "beta Stores", balanceMinor: 3_000 }),
      row({ partyId: "c1", partyName: "Alpha Gems", balanceMinor: 5_000 }),
      row({ partyId: "c1", partyName: "Alpha Gems", docType: "credit_memo", balanceMinor: -1_000 }),
      row({ partyId: "c3", partyName: "Cleared Co", balanceMinor: 2_000 }),
      row({ partyId: "c3", partyName: "Cleared Co", docType: "payment", balanceMinor: -2_000 }),
    ]);
    expect(report.lines).toEqual([
      { partyId: "c1", partyName: "Alpha Gems", balanceMinor: 4_000 },
      { partyId: "c2", partyName: "beta Stores", balanceMinor: 3_000 },
    ]);
    expect(report.totalMinor).toBe(7_000);
  });

  it("exports as the Balance Summary with a total", () => {
    const sheet = partyBalancesSheet(
      { lines: [{ partyId: "v1", partyName: "Example Supply", balanceMinor: 1_234 }], totalMinor: 1_234 },
      "vendor",
      { companyName: "Example Co", asOf: "2026-10-08", currencyCode: "USD", baseDecimals: 2 },
    );
    expect(sheet.title).toBe("Vendor Balance Summary");
    expect(sheet.rows).toEqual([
      { party: "Example Supply", balance: 12.34 },
      { party: "Total", balance: 12.34 },
    ]);
  });
});

describe("tieOut", () => {
  it("agrees only when the two are equal, and says by how much they part", () => {
    expect(tieOut(15_500, 15_500)).toEqual({ expectedMinor: 15_500, differenceMinor: 0, agrees: true });
    expect(tieOut(0, 14_639_000)).toEqual({ expectedMinor: 14_639_000, differenceMinor: -14_639_000, agrees: false });
  });
});
