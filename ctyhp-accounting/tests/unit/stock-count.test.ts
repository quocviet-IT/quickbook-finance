import { describe, expect, it } from "vitest";
import {
  countDifferenceMinor,
  countedTotalMinor,
  isDirty,
  lineValueMinor,
  parseCountSheet,
  stockCountErrorMessage,
  stockCountSheet,
  stockCountStatusLabel,
  validateStockCount,
  type StockCountDraft,
  type StockCountLineInput,
} from "@/lib/domain/stock-count";

const line = (over: Partial<StockCountLineInput> = {}): StockCountLineInput => ({
  name: "Brass bolt",
  sku: null,
  quantity: 10,
  unitCostMinor: 250,
  sellsForMinor: null,
  ...over,
});

describe("parseCountSheet", () => {
  it("reads name, quantity and cost", () => {
    const r = parseCountSheet("Brass bolt, 10, 2.50");
    expect(r.problems).toEqual([]);
    expect(r.lines).toEqual([{ name: "Brass bolt", sku: null, quantity: 10, unitCostMinor: 250, sellsForMinor: null }]);
  });

  it("reads the optional fourth column as sells for", () => {
    const r = parseCountSheet("Brass bolt, 10, 2.50, 4");
    expect(r.lines[0]).toMatchObject({ name: "Brass bolt", quantity: 10, unitCostMinor: 250, sellsForMinor: 400 });
  });

  it("lets a name contain commas, reading from the right", () => {
    const r = parseCountSheet("Bolt, brass, M8, 120, 0.35\nScrew, steel, 4 inch, 3, 1.10, 2");
    expect(r.problems).toEqual([]);
    expect(r.lines.map((l) => [l.name, l.quantity, l.unitCostMinor, l.sellsForMinor])).toEqual([
      ["Bolt, brass, M8", 120, 35, null],
      ["Screw, steel, 4 inch", 3, 110, 200],
    ]);
  });

  it("trims the fields and takes decimal quantities", () => {
    const r = parseCountSheet("   Copper wire  ,  12.5 ,  3  ");
    expect(r.lines[0]).toMatchObject({ name: "Copper wire", quantity: 12.5, unitCostMinor: 300 });
  });

  it("skips blank lines silently but counts them in the line numbers", () => {
    const r = parseCountSheet("Washer, 5, 1\n\n   \nNut, abc, 1\nBolt, 2, 1");
    expect(r.lines.map((l) => l.name)).toEqual(["Washer", "Bolt"]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].lineNumber).toBe(4);
    expect(r.problems[0].text).toBe("Nut, abc, 1");
  });

  it("refuses a line with no cost, and says so", () => {
    const r = parseCountSheet("Washer, 5");
    expect(r.lines).toEqual([]);
    expect(r.problems).toEqual([{ lineNumber: 1, text: "Washer, 5", reason: expect.stringContaining("cost") }]);
  });

  it("refuses a line with only a name", () => {
    expect(parseCountSheet("Washer").problems[0].reason).toMatch(/name, a quantity and a cost/);
  });

  it("refuses a missing name", () => {
    const r = parseCountSheet(", 5, 2");
    expect(r.problems[0]).toMatchObject({ lineNumber: 1, reason: "A name is required" });
    expect(parseCountSheet(" ,5,2").problems[0].reason).toBe("A name is required");
  });

  it("treats a fourth numeric field as sells for and a fifth as part of the name", () => {
    const four = parseCountSheet("Bolt, 5, 2, 3");
    expect(four.lines[0].sellsForMinor).toBe(300);
    const five = parseCountSheet("Bolt, 5, 2, 3, 4");
    expect(five.lines[0]).toMatchObject({ name: "Bolt, 5", quantity: 2, unitCostMinor: 300, sellsForMinor: 400 });
  });

  it("refuses negative numbers", () => {
    expect(parseCountSheet("Bolt, -5, 2").problems[0].reason).toBe("Quantity cannot be negative");
    expect(parseCountSheet("Bolt, 5, -2").problems[0].reason).toBe("Cost each cannot be negative");
    expect(parseCountSheet("Bolt, 5, 2, -1").problems[0].reason).toBe("Sells for cannot be negative");
  });

  it("refuses junk instead of guessing", () => {
    expect(parseCountSheet("Bolt, five, 2").problems[0].reason).toBe("Quantity “five” is not a number");
    expect(parseCountSheet("Bolt, 5, $2").problems[0].reason).toBe("Cost each “$2” is not a number");
    expect(parseCountSheet("Bolt, 5, 1e3").problems[0].reason).toContain("not a number");
    expect(parseCountSheet("Bolt, 5, ").problems[0].reason).toContain("is missing");
  });

  it("refuses more decimals than the currency or the quantity column holds", () => {
    expect(parseCountSheet("Bolt, 5, 2.505").problems[0].reason).toBe("Cost each can have at most 2 decimal places");
    expect(parseCountSheet("Bolt, 5, 2.5", 0).problems[0].reason).toBe("Cost each must be a whole number");
    expect(parseCountSheet("Bolt, 1.23456, 2").problems[0].reason).toBe("Quantity can have at most 4 decimal places");
    // trailing zeros are not extra decimals
    expect(parseCountSheet("Bolt, 5, 2.500").lines[0].unitCostMinor).toBe(250);
  });

  it("accepts thousands separators only where they cannot be a column break", () => {
    const tabs = parseCountSheet("Gasket, large\t1,200\t1,250.50");
    expect(tabs.problems).toEqual([]);
    expect(tabs.lines[0]).toMatchObject({ name: "Gasket, large", quantity: 1200, unitCostMinor: 125050 });

    const quoted = parseCountSheet('Gasket, "1,200", "1,250.50"');
    expect(quoted.problems).toEqual([]);
    expect(quoted.lines[0]).toMatchObject({ name: "Gasket", quantity: 1200, unitCostMinor: 125050 });
  });

  it("refuses a bare thousands comma instead of reading it as two columns", () => {
    const r = parseCountSheet("Gasket, 1,000, 2.50");
    expect(r.lines).toEqual([]);
    expect(r.problems[0].reason).toMatch(/thousands comma/);
    // a malformed group in a quoted or tabbed field is refused as well
    expect(parseCountSheet('Gasket, "1,20", 2').problems[0].reason).toMatch(/comma/);
  });

  it("reports good lines and bad lines together, by line number", () => {
    const r = parseCountSheet("A, 1, 1\nB, x, 1\nC, 3, 3\nD, 4\nE, 5, 5");
    expect(r.lines.map((l) => l.name)).toEqual(["A", "C", "E"]);
    expect(r.problems.map((p) => p.lineNumber)).toEqual([2, 4]);
  });

  it("reads Windows line endings", () => {
    expect(parseCountSheet("A, 1, 1\r\nB, 2, 2\r\n").lines).toHaveLength(2);
  });

  it("returns nothing for an empty paste", () => {
    expect(parseCountSheet("")).toEqual({ lines: [], problems: [] });
    expect(parseCountSheet("\n  \n")).toEqual({ lines: [], problems: [] });
  });
});

describe("line value and totals", () => {
  it("is quantity x cost, rounded to a whole minor unit", () => {
    expect(lineValueMinor(10, 250)).toBe(2500);
    expect(lineValueMinor(0, 250)).toBe(0);
    expect(lineValueMinor(12.5, 301)).toBe(3763); // 3762.5 rounds up
    expect(lineValueMinor(0.5, 1)).toBe(1);
    expect(lineValueMinor(0.4999, 1)).toBe(0);
    expect(lineValueMinor(1.0005, 100)).toBe(100); // 100.05
    expect(lineValueMinor(2.675, 100)).toBe(268); // 267.5, not lost to binary floating point
  });

  it("stays exact with large amounts", () => {
    expect(lineValueMinor(1_000_000, 99_999_999)).toBe(99_999_999_000_000);
  });

  it("sums the rounded line values, not the rounded sum", () => {
    const lines = [line({ quantity: 0.5, unitCostMinor: 1 }), line({ quantity: 0.5, unitCostMinor: 1 })];
    expect(countedTotalMinor(lines)).toBe(2);
    expect(countedTotalMinor([])).toBe(0);
  });

  it("takes the books from the count for the difference", () => {
    expect(countDifferenceMinor(120_000, 100_000)).toBe(20_000);
    expect(countDifferenceMinor(80_000, 100_000)).toBe(-20_000);
    expect(countDifferenceMinor(5, 5)).toBe(0);
  });
});

describe("stockCountStatusLabel", () => {
  it("names the three states as the screen does", () => {
    expect(stockCountStatusLabel("draft")).toBe("Draft");
    expect(stockCountStatusLabel("pending_approval")).toBe("Waiting for approval");
    expect(stockCountStatusLabel("posted")).toBe("Posted");
  });
});

describe("isDirty", () => {
  const saved: StockCountDraft = { asOf: "2026-06-30", memo: "June", lines: [line(), line({ name: "Nut", sku: "N-1" })] };
  const copy = (): StockCountDraft => ({ ...saved, lines: saved.lines.map((l) => ({ ...l })) });

  it("is clean when nothing changed", () => {
    expect(isDirty(saved, copy())).toBe(false);
  });

  it("sees a changed date, memo or line field", () => {
    expect(isDirty(saved, { ...copy(), asOf: "2026-07-01" })).toBe(true);
    expect(isDirty(saved, { ...copy(), memo: "July" })).toBe(true);
    for (const patch of [
      { name: "Bolt" },
      { sku: "B-9" },
      { quantity: 11 },
      { unitCostMinor: 251 },
      { sellsForMinor: 500 },
    ]) {
      const c = copy();
      expect(isDirty(saved, { ...c, lines: [{ ...c.lines[0], ...patch }, c.lines[1]] }), JSON.stringify(patch)).toBe(true);
    }
  });

  it("sees a line added, removed or reordered", () => {
    expect(isDirty(saved, { ...copy(), lines: [...saved.lines, line()] })).toBe(true);
    expect(isDirty(saved, { ...copy(), lines: saved.lines.slice(1) })).toBe(true);
    expect(isDirty(saved, { ...copy(), lines: [saved.lines[1], saved.lines[0]] })).toBe(true);
  });

  it("treats an empty memo or SKU and an absent one as the same, and ignores stray spaces", () => {
    const a: StockCountDraft = { asOf: "2026-06-30", memo: null, lines: [line({ sku: null })] };
    const b: StockCountDraft = { asOf: "2026-06-30", memo: "  ", lines: [line({ sku: "", name: " Brass bolt " })] };
    expect(isDirty(a, b)).toBe(false);
  });
});

describe("validateStockCount", () => {
  const ok = (over: Partial<StockCountDraft> = {}): StockCountDraft => ({
    asOf: "2026-06-30",
    memo: null,
    lines: [line()],
    ...over,
  });

  it("passes a good sheet, and an empty one", () => {
    expect(validateStockCount(ok())).toEqual([]);
    expect(validateStockCount(ok({ lines: [] }))).toEqual([]);
  });

  it("names the line each problem is on", () => {
    const problems = validateStockCount(
      ok({
        lines: [
          line(),
          line({ name: "  " }),
          line({ quantity: -1 }),
          line({ unitCostMinor: -5 }),
          line({ sellsForMinor: -1 }),
          line({ unitCostMinor: 2.5 }),
          line({ quantity: Number.NaN }),
        ],
      }),
    );
    expect(problems).toEqual([
      { lineNumber: 2, reason: "A name is required" },
      { lineNumber: 3, reason: "The quantity cannot be negative" },
      { lineNumber: 4, reason: "The cost each cannot be negative" },
      { lineNumber: 5, reason: "Sells for cannot be negative" },
      { lineNumber: 6, reason: "Enter the cost each" },
      { lineNumber: 7, reason: "Enter a quantity" },
    ]);
  });

  it("allows 2,000 lines and refuses 2,001", () => {
    expect(validateStockCount(ok({ lines: Array.from({ length: 2000 }, () => line()) }))).toEqual([]);
    const p = validateStockCount(ok({ lines: Array.from({ length: 2001 }, () => line()) }));
    expect(p).toEqual([{ lineNumber: null, reason: expect.stringContaining("at most 2,000 lines") }]);
  });

  it("needs a date and a memo that fits", () => {
    expect(validateStockCount(ok({ asOf: "" }))[0].reason).toBe("Choose the as-of date");
    expect(validateStockCount(ok({ memo: "x".repeat(501) }))[0].reason).toContain("memo is too long");
  });

  it("refuses names and SKUs longer than the database holds", () => {
    expect(validateStockCount(ok({ lines: [line({ name: "n".repeat(201) })] }))[0].reason).toContain("name is too long");
    expect(validateStockCount(ok({ lines: [line({ sku: "s".repeat(101) })] }))[0].reason).toContain("SKU is too long");
  });
});

describe("stockCountSheet", () => {
  const base = {
    companyName: "Example Co",
    currencyCode: "USD",
    decimals: 2,
    countNumber: "SC-000007",
    asOf: "2026-06-30",
    status: "draft",
    memo: "Year end",
    lines: [line({ sku: "B-1", sellsForMinor: 400 }), line({ name: "Nut", quantity: 3, unitCostMinor: 99 })],
    bookMinor: 2000,
  };

  it("prints every line, then the counted total, the books and the difference", () => {
    const sheet = stockCountSheet(base);
    expect(sheet.title).toBe("Stock Count");
    expect(sheet.subtitle).toBe("SC-000007 · As of 2026-06-30 · Draft · Year end");
    expect(sheet.fileName).toBe("stock-count-SC-000007");
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.rows[0]).toEqual({ name: "Brass bolt", sku: "B-1", quantity: 10, cost: 2.5, value: 25, sellsFor: 4 });
    expect(sheet.rows[1]).toMatchObject({ name: "Nut", value: 2.97, sellsFor: null });
    expect(sheet.rows[2]).toMatchObject({ name: "Counted at cost", value: 27.97 });
    expect(sheet.rows[3]).toMatchObject({ name: "On the books", value: 20 });
    expect(sheet.rows[4]).toMatchObject({ name: "Difference", value: 7.97 });
    expect(sheet.columns.map((c) => c.key)).toEqual(["name", "sku", "quantity", "cost", "value", "sellsFor"]);
  });

  it("leaves out the books and difference when they are not known, and the memo when empty", () => {
    const sheet = stockCountSheet({ ...base, bookMinor: null, memo: null, status: "posted" });
    expect(sheet.rows.map((r) => r.name)).toEqual(["Brass bolt", "Nut", "Counted at cost"]);
    expect(sheet.subtitle).toBe("SC-000007 · As of 2026-06-30 · Posted");
  });

  it("writes whole-unit currencies without decimals", () => {
    const sheet = stockCountSheet({ ...base, decimals: 0, currencyCode: "VND", bookMinor: null });
    expect(sheet.rows[0]).toMatchObject({ cost: 250, value: 2500 });
  });
});

describe("stockCountErrorMessage", () => {
  it("says a closed period in plain words", () => {
    expect(stockCountErrorMessage("Accounting period for 2026-03-31 is closed")).toBe(
      "That date falls in a closed accounting period. Choose a later date, or reopen the period.",
    );
  });

  it("rewrites the item-tracking and agreement refusals, and passes the rest through", () => {
    expect(
      stockCountErrorMessage("This company tracks stock item by item; adjust items on the Products & Services page"),
    ).toContain("Products & Services");
    expect(stockCountErrorMessage("The count already agrees with the books.")).toBe("The count agrees with the books.");
    expect(stockCountErrorMessage("Not authorized to post a stock count")).toBe(
      "You do not have permission to change stock counts",
    );
    expect(stockCountErrorMessage("Line 3: a name is required")).toBe("Line 3: a name is required");
  });
});
