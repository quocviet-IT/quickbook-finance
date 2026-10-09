import { describe, expect, it } from "vitest";
import {
  buildPeriods,
  buildSalesTaxLiability,
  classifyEntries,
  fiscalYearLabel,
  readsAsSalesTax,
  resolveTaxAccounts,
  salesTaxLiabilitySheet,
  unlinkedWarning,
  type SalesTaxLiabilityData,
  type TaxLedgerLine,
} from "@/lib/domain/sales-tax-liability";

const tax = (entryId: string, entryDate: string, creditMinor: number): TaxLedgerLine => ({ entryId, entryDate, kind: "tax", creditMinor });
const income = (entryId: string, entryDate: string, creditMinor: number): TaxLedgerLine => ({ entryId, entryDate, kind: "income", creditMinor });

describe("classifying entries", () => {
  it("counts a taxed sale as taxable and collected", () => {
    const [day] = classifyEntries([income("a", "2026-01-05", 100_00), tax("a", "2026-01-05", 8_00)]);
    expect(day).toMatchObject({ taxableMinor: 100_00, collectedMinor: 8_00, exemptMinor: 0, paidMinor: 0, adjustmentMinor: 0 });
  });

  it("counts a sale with no tax line as exempt", () => {
    const [day] = classifyEntries([income("a", "2026-01-05", 50_00)]);
    expect(day).toMatchObject({ taxableMinor: 0, exemptMinor: 50_00, collectedMinor: 0 });
  });

  it("takes a credit memo off taxable and collected, both being debits", () => {
    const days = classifyEntries([
      income("a", "2026-01-05", 100_00),
      tax("a", "2026-01-05", 8_00),
      income("m", "2026-01-06", -25_00),
      tax("m", "2026-01-06", -2_00),
    ]);
    const taxable = days.reduce((s, d) => s + d.taxableMinor, 0);
    const collected = days.reduce((s, d) => s + d.collectedMinor, 0);
    expect(taxable).toBe(75_00);
    expect(collected).toBe(6_00);
  });

  it("counts a debit to the tax account with no income as paid over", () => {
    const [day] = classifyEntries([tax("p", "2026-02-10", -30_00)]);
    expect(day).toMatchObject({ paidMinor: 30_00, adjustmentMinor: 0 });
  });

  it("counts a credit to the tax account with no income as an adjustment", () => {
    const [day] = classifyEntries([tax("j", "2026-02-10", 4_00)]);
    expect(day).toMatchObject({ paidMinor: 0, adjustmentMinor: 4_00, collectedMinor: 0 });
  });

  it("adds entries up by day, in date order", () => {
    const days = classifyEntries([income("b", "2026-03-02", 10_00), income("a", "2026-03-01", 20_00), income("c", "2026-03-02", 5_00)]);
    expect(days.map((d) => [d.date, d.exemptMinor])).toEqual([
      ["2026-03-01", 20_00],
      ["2026-03-02", 15_00],
    ]);
  });
});

describe("periods", () => {
  it("builds calendar months, clipping the first and last", () => {
    const p = buildPeriods("2026-01-15", "2026-03-10", "monthly", 1);
    expect(p.map((x) => [x.label, x.start, x.end])).toEqual([
      ["Jan 2026", "2026-01-15", "2026-01-31"],
      ["Feb 2026", "2026-02-01", "2026-02-28"],
      ["Mar 2026", "2026-03-01", "2026-03-10"],
    ]);
  });

  it("builds calendar quarters, clipping the first and last", () => {
    const p = buildPeriods("2025-11-20", "2026-05-05", "quarterly", 7);
    expect(p.map((x) => [x.label, x.start, x.end])).toEqual([
      ["Q4 2025", "2025-11-20", "2025-12-31"],
      ["Q1 2026", "2026-01-01", "2026-03-31"],
      ["Q2 2026", "2026-04-01", "2026-05-05"],
    ]);
  });

  it("builds fiscal years labelled by the year they start in, FY when the year does not start in January", () => {
    const p = buildPeriods("2025-09-01", "2026-08-31", "yearly", 7);
    expect(p.map((x) => [x.label, x.start, x.end])).toEqual([
      ["FY2025", "2025-09-01", "2026-06-30"],
      ["FY2026", "2026-07-01", "2026-08-31"],
    ]);
    expect(fiscalYearLabel(2026, 7)).toBe("FY2026");
    expect(fiscalYearLabel(2026, 1)).toBe("2026");
    const calendar = buildPeriods("2025-03-01", "2026-02-01", "yearly", 1);
    expect(calendar.map((x) => [x.label, x.start, x.end])).toEqual([
      ["2025", "2025-03-01", "2025-12-31"],
      ["2026", "2026-01-01", "2026-02-01"],
    ]);
  });

  it("gives one period for a one-day range", () => {
    expect(buildPeriods("2026-02-28", "2026-02-28", "quarterly", 1)).toHaveLength(1);
  });
});

describe("the report", () => {
  const data = (over: Partial<SalesTaxLiabilityData> = {}): SalesTaxLiabilityData => ({
    from: "2026-01-01",
    to: "2026-06-30",
    fiscalStartMonth: 1,
    basis: "codes",
    openingMinor: 0,
    ledgerClosingMinor: 0,
    unlinked: [],
    days: [],
    ...over,
  });

  it("runs the owed figure on from the opening balance", () => {
    const days = classifyEntries([
      income("a", "2026-01-10", 1000_00),
      tax("a", "2026-01-10", 80_00),
      income("b", "2026-02-10", 500_00),
      income("c", "2026-04-02", 200_00),
      tax("c", "2026-04-02", 16_00),
      tax("p", "2026-04-20", -90_00),
      tax("j", "2026-05-01", 3_00),
    ]);
    const report = buildSalesTaxLiability(data({ days, openingMinor: 20_00, ledgerClosingMinor: 29_00 }), "quarterly");
    expect(report.periods.map((p) => p.label)).toEqual(["Q1 2026", "Q2 2026"]);
    const [q1, q2] = report.periods;
    expect(q1).toMatchObject({ grossMinor: 1500_00, taxableMinor: 1000_00, exemptMinor: 500_00, collectedMinor: 80_00, paidMinor: 0, owedMinor: 100_00 });
    expect(q1.ratePercent).toBeCloseTo(8);
    expect(q2).toMatchObject({ grossMinor: 200_00, collectedMinor: 16_00, paidMinor: 90_00, adjustmentMinor: 3_00, owedMinor: 29_00 });
    expect(report.total).toMatchObject({ grossMinor: 1700_00, taxableMinor: 1200_00, exemptMinor: 500_00, collectedMinor: 96_00, paidMinor: 90_00, owedMinor: 29_00 });
    expect(report.collectedMinor).toBe(96_00);
    expect(report.paidMinor).toBe(90_00);
    expect(report.owedAtEndMinor).toBe(29_00);
    expect(report.effectiveRatePercent).toBeCloseTo(8);
    expect(report.openingMinor).toBe(20_00);
    expect(report.proof.agrees).toBe(true);
  });

  it("reports the same totals whatever the period size", () => {
    const days = classifyEntries([income("a", "2026-01-10", 100_00), tax("a", "2026-01-10", 7_00), tax("p", "2026-05-20", -4_00)]);
    for (const g of ["monthly", "quarterly", "yearly"] as const) {
      const report = buildSalesTaxLiability(data({ days }), g);
      expect(report.total.collectedMinor, g).toBe(7_00);
      expect(report.owedAtEndMinor, g).toBe(3_00);
    }
    expect(buildSalesTaxLiability(data({ days }), "monthly").periods).toHaveLength(6);
  });

  it("states the difference when the closing figure is not the ledger balance", () => {
    const days = classifyEntries([income("a", "2026-01-10", 100_00), tax("a", "2026-01-10", 7_00)]);
    const report = buildSalesTaxLiability(data({ days, ledgerClosingMinor: 9_00 }), "yearly");
    expect(report.proof).toEqual({ expectedMinor: 9_00, differenceMinor: -2_00, agrees: false });
  });

  it("has no rate where nothing was taxable, and ignores days outside the range", () => {
    const days = classifyEntries([income("a", "2026-01-10", 100_00), income("z", "2025-12-31", 900_00)]);
    const report = buildSalesTaxLiability(data({ days }), "quarterly");
    expect(report.periods[0].ratePercent).toBeNull();
    expect(report.effectiveRatePercent).toBeNull();
    expect(report.total.exemptMinor).toBe(100_00);
  });

  it("exports the opening row only when it is not zero, then a total", () => {
    const money = (m: number) => (m / 100).toFixed(2);
    const base = buildSalesTaxLiability(data(), "yearly");
    const plain = salesTaxLiabilitySheet(base, { companyName: "Acme", currencyCode: "USD", money });
    expect(plain.rows.map((r) => r.period)).toEqual(["2026", "Total"]);
    const opened = salesTaxLiabilitySheet(buildSalesTaxLiability(data({ openingMinor: 5_00, ledgerClosingMinor: 5_00 }), "yearly"), {
      companyName: "Acme",
      currencyCode: "USD",
      money,
    });
    expect(opened.rows[0]).toMatchObject({ period: "Owed before this range", owed: "5.00" });
    expect(opened.rows.at(-1)).toMatchObject({ period: "Total", rate: "" });
  });
});

describe("finding the tax accounts", () => {
  const accounts = [
    { id: "pay", name: "Sales Tax Payable", accountType: "current_liability" },
    { id: "other", name: "State tax payable (old)", accountType: "current_liability" },
    { id: "ap", name: "Accounts Payable", accountType: "accounts_payable" },
    { id: "bank", name: "Sales tax payable account", accountType: "bank" },
    { id: "payroll", name: "Payroll Liabilities", accountType: "current_liability" },
  ];

  it("reads names letters only", () => {
    expect(readsAsSalesTax("2200 - Sales-Tax Payable")).toBe(true);
    expect(readsAsSalesTax("Tax (State) Payable")).toBe(true);
    expect(readsAsSalesTax("Payroll Liabilities")).toBe(false);
    expect(readsAsSalesTax("Payable tax")).toBe(false);
    expect(readsAsSalesTax("Income Tax Payable")).toBe(false);
    expect(readsAsSalesTax("Payroll Tax Payable")).toBe(false);
    expect(readsAsSalesTax("Taxes Payable")).toBe(true);
    expect(readsAsSalesTax("Sales Tax Payable")).toBe(true);
    expect(readsAsSalesTax("State sales tax")).toBe(true);
  });

  it("uses the accounts sales codes post to, and ignores other directions", () => {
    const found = resolveTaxAccounts(accounts, [
      { direction: "sales", taxAccountId: "pay" },
      { direction: "purchase", taxAccountId: "ap" },
      { direction: "sales", taxAccountId: null },
    ]);
    expect(found.basis).toBe("codes");
    expect(found.accountIds).toEqual(["pay"]);
  });

  it("warns of a liability account that reads as sales tax but no rate posts to", () => {
    const found = resolveTaxAccounts(accounts, [{ direction: "sales", taxAccountId: "pay" }]);
    expect(found.unlinked).toEqual([{ id: "other", name: "State tax payable (old)" }]);
    expect(unlinkedWarning(found.unlinked)).toBe(
      "“State tax payable (old)” reads as sales tax, but no tax rate posts to it, so it is not in these figures.",
    );
    expect(unlinkedWarning([])).toBeNull();
    const linked = resolveTaxAccounts(accounts, [
      { direction: "sales", taxAccountId: "pay" },
      { direction: "sales", taxAccountId: "other" },
    ]);
    expect(linked.unlinked).toEqual([]);
    expect(linked.accountIds.sort()).toEqual(["other", "pay"]);
  });

  it("falls back to liability accounts named for sales tax when no sales code has an account", () => {
    const found = resolveTaxAccounts(accounts, [{ direction: "purchase", taxAccountId: "ap" }]);
    expect(found.basis).toBe("names");
    expect(found.accountIds.sort()).toEqual(["other", "pay"]);
    expect(found.unlinked).toEqual([]);
  });

  it("has no tax account when nothing qualifies", () => {
    const found = resolveTaxAccounts([{ id: "x", name: "Loans", accountType: "long_term_liability" }], []);
    expect(found).toEqual({ accountIds: [], basis: "none", unlinked: [] });
  });
});
