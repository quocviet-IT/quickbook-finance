import { describe, expect, it } from "vitest";
import { searchAccounts, type SearchableAccount } from "@/lib/domain/account-search";

/** A chart in the words another product used, which is how they arrive. */
const CHART: SearchableAccount[] = [
  { id: "a", account_code: "1010", name: "Operating Bank Account", account_type: "bank" },
  { id: "b", account_code: "4000", name: "Sales", account_type: "income" },
  { id: "c", account_code: "4100", name: "Service Revenue", account_type: "income" },
  { id: "d", account_code: "6000", name: "Operating Expenses", account_type: "expense" },
  { id: "e", account_code: "6010", name: "Showroom Rent", account_type: "expense" },
  { id: "f", account_code: "6540", name: "Salaries and Wages", account_type: "expense" },
  { id: "g", account_code: "6600", name: "Bank Service Charges", account_type: "expense" },
  { id: "h", account_code: "6700", name: "Courier and Postage", account_type: "expense" },
];

const codes = (query: string) =>
  searchAccounts(CHART, query).map((hit) => hit.account.account_code);

describe("searchAccounts", () => {
  it("finds the word the chart actually uses", () => {
    expect(codes("rent")).toEqual(["6010"]);
  });

  it("finds a word that means the same thing", () => {
    // The reader types "payroll"; this chart says "Salaries and Wages". They
    // will not try three spellings — they will decide the search is broken.
    expect(codes("payroll")).toContain("6540");
    expect(codes("wages")).toContain("6540");
    expect(codes("staff")).toContain("6540");
  });

  it("finds a fee by the word the chart calls a charge", () => {
    expect(codes("fee")).toContain("6600");
  });

  it("finds shipping under the word courier", () => {
    expect(codes("shipping")).toContain("6700");
  });

  it("puts an exact code first, because it can only mean one account", () => {
    expect(codes("6010")[0]).toBe("6010");
  });

  it("prefers the chart's own word over a word that means the same", () => {
    // "Sales" is named that; "Service Revenue" only answers through a synonym.
    const found = codes("sales");
    expect(found[0]).toBe("4000");
    expect(found).toContain("4100");
    expect(found.indexOf("4000")).toBeLessThan(found.indexOf("4100"));
  });

  it("puts the closer answer first when several start with the word", () => {
    // A chart with no account simply called "Sales": typing it should still
    // reach the revenue account before the two tax accounts.
    const taxy = [
      { id: "x", account_code: "2100", name: "Sales Tax Payable", account_type: "current_liability" as const },
      { id: "y", account_code: "2110", name: "Sales Tax Receivable", account_type: "current_asset" as const },
      { id: "z", account_code: "4000", name: "Sales Revenue", account_type: "income" as const },
    ];

    expect(searchAccounts(taxy, "sales")[0].account.account_code).toBe("4000");
  });

  it("says which word found an account the reader did not type", () => {
    const hit = searchAccounts(CHART, "payroll").find((h) => h.account.account_code === "6540");
    expect(hit?.via).toBeTruthy();
    // And says nothing when the word typed is the word in the name.
    expect(searchAccounts(CHART, "rent")[0].via).toBeNull();
  });

  it("matches a code by its beginning, the way somebody types one", () => {
    expect(codes("60")).toEqual(["6000", "6010"]);
  });

  it("returns the whole chart before anything is typed", () => {
    expect(searchAccounts(CHART, "")).toHaveLength(CHART.length);
    expect(searchAccounts(CHART, "   ")).toHaveLength(CHART.length);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(codes("zzz")).toEqual([]);
  });

  it("ignores case and stray spacing", () => {
    expect(codes("  SHOWROOM  ")).toEqual(["6010"]);
  });
});
