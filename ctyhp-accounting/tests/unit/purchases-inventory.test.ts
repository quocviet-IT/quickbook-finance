import { describe, expect, it } from "vitest";
import { NO_VENDOR } from "@/lib/domain/party-activity";
import {
  buildPurchasesInventory,
  isOpeningEntry,
  purchasesInventorySheet,
  yearProofText,
  type PurchaseLedgerLine,
  type PurchasesInventoryInput,
} from "@/lib/domain/purchases-inventory";

const ACCOUNTS = [
  { id: "inv", name: "Inventory", accountType: "current_asset" },
  { id: "cogs", name: "Cost of Goods Sold", accountType: "cost_of_goods_sold" },
  { id: "count", name: "Inventory Adjustments", accountType: "cost_of_goods_sold" },
  { id: "wd", name: "Inventory Write-down", accountType: "expense" },
  { id: "spoil", name: "Spoilage", accountType: "expense" },
  { id: "eq", name: "Owner Equity", accountType: "equity" },
  { id: "ap", name: "Accounts Payable", accountType: "accounts_payable" },
];

function line(entryId: string, entryDate: string, accountId: string, signedMinor: number, over: Partial<PurchaseLedgerLine> = {}): PurchaseLedgerLine {
  return { entryId, entryDate, sourceType: "manual", description: "x", sourceId: null, accountId, signedMinor, ...over };
}

function run(lines: PurchaseLedgerLine[], over: Partial<PurchasesInventoryInput> = {}) {
  return buildPurchasesInventory({
    lines,
    accounts: ACCOUNTS,
    inventoryAccountIds: new Set(["inv"]),
    equityEntryIds: new Set(),
    vendorOfSource: new Map(),
    fiscalStartMonth: 1,
    from: "2026-01-01",
    to: "2026-12-31",
    ...over,
  });
}

describe("a periodic book: purchases to cost of sales, a year-end count", () => {
  // Opening 1,000 brought in, 500 bought (a return of 50 later), count puts closing at 1,200.
  const lines = [
    line("o", "2026-01-01", "inv", 100_000, { sourceType: "opening_balance" }),
    line("o", "2026-01-01", "eq", -100_000, { sourceType: "opening_balance" }),
    line("b1", "2026-02-10", "cogs", 50_000, { sourceId: "bill1" }),
    line("b1", "2026-02-10", "ap", -50_000, { sourceId: "bill1" }),
    line("r1", "2026-03-05", "cogs", -5_000, { sourceId: "vc1" }),
    line("r1", "2026-03-05", "ap", 5_000, { sourceId: "vc1" }),
    // Year-end count: closing stock 120,000 against 100,000 opening.
    line("c", "2026-12-31", "inv", 20_000, { sourceType: "inventory_adjustment" }),
    line("c", "2026-12-31", "count", -20_000, { sourceType: "inventory_adjustment" }),
  ];
  const report = run(lines, {
    vendorOfSource: new Map([
      ["bill1", { id: "v1", name: "Example Supply" }],
      ["vc1", { id: "v1", name: "Example Supply" }],
    ]),
  });

  it("gives one year that adds up", () => {
    expect(report.years).toHaveLength(1);
    const y = report.years[0];
    expect(y).toMatchObject({
      label: "2026",
      openingMinor: 100_000,
      boughtMinor: 45_000,
      countAdjustmentMinor: 20_000,
      costOfSalesMinor: 45_000,
      closingMinor: 120_000,
      offByMinor: 0,
    });
    expect(report.offByYears).toEqual([]);
    expect(yearProofText(report, String)).toBe("That holds in every year shown.");
  });

  it("nets the return into what was bought, and counts entries", () => {
    expect(report.boughtMinor).toBe(45_000);
    expect(report.purchases).toBe(2);
    expect(report.suppliers).toBe(1);
    expect(report.onShelfMinor).toBe(120_000);
    expect(report.neverBought).toBe(false);
  });

  it("groups by supplier and by month, with shares", () => {
    expect(report.supplierRows).toEqual([
      { vendorId: "v1", name: "Example Supply", purchases: 2, amountMinor: 45_000, sharePercent: 100 },
    ]);
    expect(report.months.map((m) => [m.label, m.amountMinor])).toEqual([
      ["Feb 2026", 50_000],
      ["Mar 2026", -5_000],
    ]);
  });
});

describe("a perpetual book: a receipt to inventory, then a sale that nets out", () => {
  const lines = [
    line("g", "2026-04-01", "inv", 80_000, { sourceType: "goods_receipt", sourceId: "gr1" }),
    line("g", "2026-04-01", "ap", -80_000, { sourceType: "goods_receipt", sourceId: "gr1" }),
    // The sale's cost: cost of sales against inventory, in one entry.
    line("s", "2026-05-01", "cogs", 30_000, { sourceType: "invoice", sourceId: "inv1" }),
    line("s", "2026-05-01", "inv", -30_000, { sourceType: "invoice", sourceId: "inv1" }),
  ];
  const report = run(lines, { vendorOfSource: new Map([["gr1", { id: "v2", name: "Beta Wholesale" }]]) });

  it("counts only the receipt as a purchase", () => {
    expect(report.purchases).toBe(1);
    expect(report.boughtMinor).toBe(80_000);
    expect(report.supplierRows.map((r) => r.name)).toEqual(["Beta Wholesale"]);
  });

  it("still adds up, the sale reducing stock through cost of sales", () => {
    const y = report.years[0];
    expect(y.boughtMinor).toBe(80_000);
    expect(y.costOfSalesMinor).toBe(30_000);
    expect(y.closingMinor).toBe(50_000);
    expect(y.offByMinor).toBe(0);
  });
});

describe("an opening entry, caught by each of the three rules", () => {
  const cases: [string, Partial<PurchaseLedgerLine>, string[]][] = [
    ["its source", { sourceType: "opening_balance", description: "Start" }, []],
    ["its description", { description: "OPENING BALANCES as of 1 Jan" }, []],
    ["an equity line", { description: "Take on stock" }, ["o"]],
  ];
  for (const [name, over, equity] of cases) {
    it(`by ${name}`, () => {
      const report = run([line("o", "2026-01-01", "inv", 70_000, over), line("o", "2026-01-01", "cogs", 0, over)], {
        equityEntryIds: new Set(equity),
      });
      expect(report.neverBought).toBe(true);
      expect(report.boughtMinor).toBe(0);
      expect(report.years[0]).toMatchObject({ openingMinor: 70_000, boughtMinor: 0, closingMinor: 70_000, offByMinor: 0 });
    });
  }

  it("is not an opening entry when none of them holds", () => {
    expect(isOpeningEntry({ id: "e", sourceType: "bill", description: "Reopening balance" }, new Set())).toBe(false);
  });

  it("carries an earlier year's closing forward as the next opening", () => {
    const report = run(
      [
        line("a", "2025-03-01", "cogs", 10_000),
        line("c", "2025-12-31", "inv", 10_000, { sourceType: "inventory_adjustment" }),
        line("c", "2025-12-31", "count", -10_000, { sourceType: "inventory_adjustment" }),
        line("b", "2026-03-01", "cogs", 5_000),
      ],
      { from: "2025-01-01" },
    );
    expect(report.years.map((y) => [y.label, y.openingMinor, y.closingMinor])).toEqual([
      ["2025", 0, 10_000],
      ["2026", 10_000, 10_000],
    ]);
  });
});

describe("returns as credits", () => {
  it("reduce the total and the supplier's amount, and a net-zero entry is not a purchase", () => {
    const report = run([
      line("b", "2026-02-01", "cogs", 20_000, { sourceId: "bill1" }),
      line("r", "2026-02-15", "cogs", -8_000, { sourceId: "vc1" }),
      // Bought and returned in one entry: nets to zero, so not a purchase.
      line("z", "2026-02-20", "cogs", 5_000),
      line("z", "2026-02-20", "inv", -5_000),
    ]);
    expect(report.boughtMinor).toBe(12_000);
    expect(report.purchases).toBe(2);
  });
});

describe("an off-by year", () => {
  it("is flagged when cost of sales sits in an entry that brought stock in, and names the year", () => {
    const report = run([
      line("o", "2026-01-01", "inv", 100_000, { sourceType: "opening_balance" }),
      line("o", "2026-01-01", "cogs", 4_000, { sourceType: "opening_balance" }),
    ]);
    const y = report.years[0];
    expect(y.offByMinor).toBe(-4_000);
    expect(report.offByYears).toHaveLength(1);
    expect(yearProofText(report, (m) => `$${m / 100}`)).toBe(
      "One year is off by $40 in 2026, usually stock bought or written off through neither account.",
    );
  });

  it("does not trip on a write-down to a non-cost-of-sales account: the write-down is a count entry", () => {
    const report = run([
      line("b", "2026-02-01", "cogs", 50_000),
      line("w", "2026-12-31", "wd", 7_000),
      line("w", "2026-12-31", "inv", -7_000),
    ]);
    const y = report.years[0];
    expect(y.countAdjustmentMinor).toBe(-7_000);
    expect(y.offByMinor).toBe(0);
    expect(report.purchases).toBe(1);
  });

  it("treats an unnamed loss to inventory as a purchase credit, and still adds up", () => {
    const report = run([line("b", "2026-02-01", "cogs", 50_000), line("l", "2026-03-01", "spoil", 7_000), line("l", "2026-03-01", "inv", -7_000)]);
    expect(report.boughtMinor).toBe(43_000);
    expect(report.years[0].offByMinor).toBe(0);
  });

  it("says how many years when several are off", () => {
    const off = (year: number) => [
      line(`o${year}`, `${year}-01-01`, "inv", 1_000, { sourceType: "opening_balance" }),
      line(`o${year}`, `${year}-01-01`, "cogs", 100, { sourceType: "opening_balance" }),
    ];
    const report = run([...off(2025), ...off(2026)], { from: "2025-01-01" });
    expect(yearProofText(report, String)).toMatch(/^2 years are off by /);
  });
});

describe("the supplier fallback", () => {
  const report = run(
    [
      line("a", "2026-02-01", "cogs", 30_000, { sourceId: "bill1" }),
      line("b", "2026-02-02", "cogs", 10_000, { sourceId: "unknown-doc" }),
      line("c", "2026-02-03", "inv", 10_000),
    ],
    { vendorOfSource: new Map([["bill1", { id: "v1", name: "Example Supply" }]]) },
  );

  it("sends entries with no vendor document to (No vendor), largest supplier first", () => {
    expect(report.supplierRows.map((r) => [r.name, r.purchases, r.amountMinor])).toEqual([
      ["Example Supply", 1, 30_000],
      [NO_VENDOR, 2, 20_000],
    ]);
    expect(report.suppliers).toBe(1);
    expect(report.supplierTotal).toEqual({ purchases: 3, amountMinor: 50_000 });
  });

  it("gives shares that add to 100", () => {
    expect(report.supplierRows.reduce((s, r) => s + (r.sharePercent ?? 0), 0)).toBeCloseTo(100);
  });
});

describe("the period and the empty states", () => {
  const lines = [line("a", "2025-06-01", "cogs", 10_000), line("b", "2026-06-01", "cogs", 20_000)];

  it("limits the stat figures, suppliers and months to the range, but the year table to the books", () => {
    const report = run(lines, { from: "2026-01-01", to: "2026-12-31" });
    expect(report.boughtMinor).toBe(20_000);
    expect(report.months).toHaveLength(1);
    expect(report.years.map((y) => y.label)).toEqual(["2025", "2026"]);
  });

  it("is empty for a period with nothing bought, without saying nothing was ever bought", () => {
    const report = run(lines, { from: "2024-01-01", to: "2024-12-31" });
    expect(report.neverBought).toBe(false);
    expect(report.supplierRows).toEqual([]);
    expect(report.months).toEqual([]);
    expect(report.purchases).toBe(0);
  });

  it("says nothing was ever bought when the books have no purchase line", () => {
    const report = run([]);
    expect(report.neverBought).toBe(true);
    expect(report.years).toEqual([]);
    expect(yearProofText(report, String)).toBe("That holds in every year shown.");
  });

  it("follows a July fiscal year", () => {
    const report = run([line("a", "2026-06-30", "cogs", 1_000), line("b", "2026-07-01", "cogs", 2_000)], { fiscalStartMonth: 7 });
    expect(report.years.map((y) => y.label)).toEqual(["Jul 2025 – Jun 2026", "Jul 2026 – Jun 2027"]);
  });
});

describe("the export sheet", () => {
  it("stacks the three tables and ends the supplier table with a Total", () => {
    const report = run([line("a", "2026-02-01", "cogs", 30_000, { sourceId: "bill1" })], {
      vendorOfSource: new Map([["bill1", { id: "v1", name: "Example Supply" }]]),
    });
    const sheet = purchasesInventorySheet(report, { companyName: "Test Co", currencyCode: "USD", money: (m) => `$${(m / 100).toFixed(2)}` });
    expect(sheet.fileName).toBe("purchases-and-inventory-2026-01-01-to-2026-12-31");
    expect(sheet.rows.map((r) => `${r.section}|${r.item}`)).toEqual([
      "Year by year|2026",
      "Who it was bought from|Example Supply",
      "Who it was bought from|Total",
      "Month by month|Feb 2026",
    ]);
  });
});

describe("a stock count entry", () => {
  // The count posts against a plain cost of sales account, whose name does not read as an
  // adjustment. Only its source says it is a count.
  const lines = [
    line("o", "2026-01-01", "inv", 100_000, { sourceType: "opening_balance" }),
    line("b", "2026-02-10", "cogs", 50_000, { sourceId: "bill1" }),
    line("b", "2026-02-10", "ap", -50_000, { sourceId: "bill1" }),
    line("c", "2026-12-31", "inv", 20_000, { sourceType: "stock_count", sourceId: "sc1" }),
    line("c", "2026-12-31", "cogs", -20_000, { sourceType: "stock_count", sourceId: "sc1" }),
  ];
  const report = run(lines, { vendorOfSource: new Map([["bill1", { id: "v1", name: "Example Supply" }]]) });

  it("is a count adjustment, not a negative purchase", () => {
    expect(report.years[0]).toMatchObject({
      openingMinor: 100_000,
      boughtMinor: 50_000,
      countAdjustmentMinor: 20_000,
      closingMinor: 120_000,
    });
    expect(report.purchases).toBe(1);
    expect(report.boughtMinor).toBe(50_000);
  });
});
