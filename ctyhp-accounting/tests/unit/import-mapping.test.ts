import { describe, expect, it } from "vitest";
import {
  applyMapping,
  describeParsedImport,
  fieldsFor,
  proposeMapping,
  splitAccountName,
  translateAccountType,
} from "@/lib/domain/import-mapping";

describe("proposeMapping", () => {
  it("reads a QuickBooks Online chart of accounts export", () => {
    const headers = ["Account Number", "Account Name", "Type", "Detail Type", "Balance"];
    const mapping = proposeMapping(headers, "chart_of_accounts");
    expect(mapping.columns.account_code).toBe(0);
    expect(mapping.columns.name).toBe(1);
    expect(mapping.columns.account_type).toBe(2);
    expect(mapping.columns.opening_balance_minor).toBe(4);
    expect(mapping.missingRequired).toEqual([]);
  });

  it("reads a Wave customer export", () => {
    const headers = ["Customer name", "Email", "Phone number", "City", "Province/State", "Country"];
    const mapping = proposeMapping(headers, "customers");
    expect(mapping.columns.name).toBe(0);
    expect(mapping.columns.email).toBe(1);
    expect(mapping.columns.phone).toBe(2);
    expect(mapping.columns.city).toBe(3);
    expect(mapping.columns.region).toBe(4);
    expect(mapping.missingRequired).toEqual([]);
  });

  it("does not care about case, spacing or punctuation", () => {
    const mapping = proposeMapping(["  ACCOUNT_NUMBER ", "account-name", "TYPE"], "chart_of_accounts");
    expect(mapping.columns.account_code).toBe(0);
    expect(mapping.columns.name).toBe(1);
    expect(mapping.columns.account_type).toBe(2);
  });

  it("never uses one column for two fields", () => {
    const mapping = proposeMapping(["Name", "Description"], "items");
    const used = Object.values(mapping.columns).filter((v) => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it("reports the columns it did not use rather than ignoring them", () => {
    const mapping = proposeMapping(
      ["Customer name", "Loyalty tier", "Referred by"],
      "customers",
    );
    expect(mapping.unmapped).toEqual(["Loyalty tier", "Referred by"]);
  });

  it("says which required fields are still unmapped, so the import can refuse", () => {
    const mapping = proposeMapping(["Notes", "Colour"], "chart_of_accounts");
    expect(mapping.missingRequired).toEqual(["account_code", "name", "account_type"]);
  });

  it("matches nothing when the file has no headers at all", () => {
    const mapping = proposeMapping([], "vendors");
    expect(mapping.missingRequired).toContain("name");
    expect(mapping.unmapped).toEqual([]);
  });
});

describe("translateAccountType", () => {
  it("maps the QuickBooks types a real chart uses", () => {
    expect(translateAccountType("Bank")).toBe("bank");
    expect(translateAccountType("Accounts receivable (A/R)")).toBe("accounts_receivable");
    expect(translateAccountType("Accounts payable (A/P)")).toBe("accounts_payable");
    expect(translateAccountType("Credit Card")).toBe("credit_card");
    expect(translateAccountType("Other Current Asset")).toBe("current_asset");
    expect(translateAccountType("Fixed Asset")).toBe("fixed_asset");
    expect(translateAccountType("Other Current Liability")).toBe("current_liability");
    expect(translateAccountType("Long Term Liabilities")).toBe("current_liability");
    expect(translateAccountType("Equity")).toBe("equity");
    expect(translateAccountType("Income")).toBe("income");
    expect(translateAccountType("Cost of Goods Sold")).toBe("cost_of_goods_sold");
    expect(translateAccountType("Expenses")).toBe("expense");
    expect(translateAccountType("Other Income")).toBe("other_income");
    expect(translateAccountType("Other Expense")).toBe("other_expense");
  });

  it("puts a credit card in liabilities, not in banks", () => {
    // The word "card" is not a bank account, and filing it as one would put a
    // debt in the assets.
    expect(translateAccountType("Credit Card")).not.toBe("bank");
  });

  it("prefers the more specific reading when two could match", () => {
    expect(translateAccountType("Cost of Goods Sold")).toBe("cost_of_goods_sold");
    expect(translateAccountType("Other Income")).toBe("other_income");
    expect(translateAccountType("Depreciation Expense")).toBe("other_expense");
  });

  it("passes one of our own type names straight through", () => {
    expect(translateAccountType("accounts_receivable")).toBe("accounts_receivable");
    expect(translateAccountType("Cost Of Goods Sold")).toBe("cost_of_goods_sold");
  });

  it("refuses what it does not recognise instead of guessing", () => {
    expect(translateAccountType("Widget Ledger")).toBeNull();
    expect(translateAccountType("")).toBeNull();
  });
});

describe("splitAccountName", () => {
  it("splits the parent chain QuickBooks writes into one cell", () => {
    expect(splitAccountName("Operating Expenses:Rent:Showroom")).toEqual({
      name: "Showroom",
      parents: ["Operating Expenses", "Rent"],
    });
  });

  it("leaves a plain name alone", () => {
    expect(splitAccountName("Sales Revenue")).toEqual({ name: "Sales Revenue", parents: [] });
  });

  it("tolerates the spacing people actually type", () => {
    expect(splitAccountName(" Parent : Child ")).toEqual({ name: "Child", parents: ["Parent"] });
  });
});

describe("applyMapping", () => {
  const chartMapping = { account_code: 0, name: 1, account_type: 2, description: null, opening_balance_minor: 3 };

  it("reads a well-formed file", () => {
    const parsed = applyMapping(
      [
        ["1000", "Business Checking", "Bank", "12,500.00"],
        ["4000", "Sales Revenue", "Income", ""],
      ],
      chartMapping,
      "chart_of_accounts",
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      account_code: "1000",
      name: "Business Checking",
      account_type: "bank",
      opening_balance_minor: 1_250_000,
    });
    expect(parsed.records[1].opening_balance_minor).toBe(0);
  });

  it("numbers a problem row the way a spreadsheet does", () => {
    const parsed = applyMapping(
      [
        ["1000", "Checking", "Bank", "1.00"],
        ["9999", "Mystery", "Widget Ledger", "1.00"],
      ],
      chartMapping,
      "chart_of_accounts",
    );
    // Data row two is row three on screen, because of the header.
    expect(parsed.problems[0].row).toBe(3);
    expect(parsed.problems[0].message).toContain("Widget Ledger");
    expect(parsed.records).toHaveLength(1);
  });

  it("keeps a row out entirely rather than importing half of it", () => {
    const parsed = applyMapping([["", "No code", "Bank", "1.00"]], chartMapping, "chart_of_accounts");
    expect(parsed.records).toEqual([]);
    expect(parsed.problems[0].message).toContain("Account code is required");
  });

  it("counts blank rows instead of complaining about them", () => {
    const parsed = applyMapping(
      [["", "", "", ""], ["1000", "Checking", "Bank", "1.00"], ["", "", "", ""]],
      chartMapping,
      "chart_of_accounts",
    );
    expect(parsed.blankRows).toBe(2);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.problems).toEqual([]);
  });

  it("reads the money formats an export actually contains", () => {
    const parsed = applyMapping(
      [
        ["1000", "A", "Bank", "$1,234.56"],
        ["1010", "B", "Bank", "(500.00)"],
      ],
      chartMapping,
      "chart_of_accounts",
    );
    expect(parsed.records[0].opening_balance_minor).toBe(123_456);
    expect(parsed.records[1].opening_balance_minor).toBe(-50_000);
  });

  it("reads the ways a file says yes", () => {
    const mapping = { item_code: null, name: 0, description: null, sales_price_minor: null, purchase_cost_minor: null, is_inventory: 1 };
    const parsed = applyMapping(
      [["Ring", "Yes"], ["Service", "No"], ["Stone", "Inventory Part"]],
      mapping,
      "items",
    );
    expect(parsed.records.map((r) => r.is_inventory)).toEqual([true, false, true]);
  });

  it("leaves an unmapped optional column empty rather than failing", () => {
    const parsed = applyMapping(
      [["Daniel Carter"]],
      { name: 0, email: null, contact_name: null, phone: null, city: null, region: null, postal_code: null, country: null, opening_balance_minor: null },
      "customers",
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.records[0]).toMatchObject({ name: "Daniel Carter", email: null, opening_balance_minor: 0 });
  });

  it("reads an empty file as nothing to do", () => {
    const parsed = applyMapping([], chartMapping, "chart_of_accounts");
    expect(parsed.records).toEqual([]);
    expect(describeParsedImport(parsed, "chart_of_accounts")).toBe("0 chart of accounts ready.");
  });

  it("says what the file holds in one line", () => {
    const parsed = applyMapping(
      [["1000", "Checking", "Bank", "1.00"], ["", "", "", ""], ["9999", "X", "Nonsense", ""]],
      chartMapping,
      "chart_of_accounts",
    );
    const summary = describeParsedImport(parsed, "chart_of_accounts");
    expect(summary).toContain("1 chart of accounts ready");
    expect(summary).toContain("1 row(s) need attention");
    expect(summary).toContain("1 blank row(s) skipped");
  });
});

describe("fieldsFor", () => {
  it("gives every target a required name", () => {
    for (const target of ["chart_of_accounts", "customers", "vendors", "items"] as const) {
      const required = fieldsFor(target).filter((f) => f.required).map((f) => f.key);
      expect(required, target).toContain("name");
    }
  });
});
