import { describe, it, expect } from "vitest";
import { itemToInvoiceLineDefaults, itemToBillLineDefaults } from "@/lib/domain/items";

const base = {
  description: "Consulting",
  sales_price_minor: 15000,
  income_account_id: "inc",
  sales_tax_code_id: "tax",
  purchase_cost_minor: 9000,
  expense_account_id: "exp",
};

describe("itemToInvoiceLineDefaults", () => {
  it("maps the sales side of an item to invoice-line defaults", () => {
    expect(itemToInvoiceLineDefaults(base)).toEqual({
      description: "Consulting",
      unit_price_minor: 15000,
      income_account_id: "inc",
      tax_code_id: "tax",
    });
  });
});

describe("itemToBillLineDefaults", () => {
  it("maps the purchase side of an item to bill-line defaults", () => {
    expect(itemToBillLineDefaults(base)).toEqual({
      description: "Consulting",
      amount_minor: 9000,
      expense_account_id: "exp",
    });
  });
});
