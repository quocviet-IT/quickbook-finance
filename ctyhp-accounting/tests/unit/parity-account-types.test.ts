import { describe, expect, it } from "vitest";
import { prototypeAccountType } from "@/lib/parity/account-types";

describe("prototypeAccountType", () => {
  it("types assets by the prototype's own classes, long-lived first", () => {
    expect(prototypeAccountType("Assets:FixedAssets:Equipment")).toBe("fixed_asset");
    expect(prototypeAccountType("Assets:AccumulatedDepreciation")).toBe("fixed_asset");
    expect(prototypeAccountType("Assets:Bank:Example-1234")).toBe("bank");
    expect(prototypeAccountType("Assets:PettyCash")).toBe("bank");
    expect(prototypeAccountType("Assets:AccountsReceivable")).toBe("accounts_receivable");
    expect(prototypeAccountType("Assets:Inventory")).toBe("current_asset");
  });
  it("types liabilities: long-term, then credit cards, then accounts payable, then current", () => {
    expect(prototypeAccountType("Liabilities:NotePayable:Example")).toBe("long_term_liability");
    expect(prototypeAccountType("Liabilities:LongTerm:ExampleLoan")).toBe("long_term_liability");
    expect(prototypeAccountType("Liabilities:CreditCard:Example-4321")).toBe("credit_card");
    expect(prototypeAccountType("Liabilities:AccountsPayable")).toBe("accounts_payable");
    expect(prototypeAccountType("Liabilities:SalesTaxPayable")).toBe("current_liability");
    expect(prototypeAccountType("Liabilities:GiftCards")).toBe("current_liability");
  });
  it("splits income and expenses into the prototype's Profit and Loss sections", () => {
    expect(prototypeAccountType("Income:Sales")).toBe("income");
    expect(prototypeAccountType("Income:InterestIncome")).toBe("other_income");
    expect(prototypeAccountType("Income:OtherIncome:Misc")).toBe("other_income");
    expect(prototypeAccountType("Expenses:CostOfGoodsSold:Materials")).toBe("cost_of_goods_sold");
    expect(prototypeAccountType("Expenses:InterestExpense")).toBe("other_expense");
    expect(prototypeAccountType("Expenses:TaxExpense")).toBe("other_expense");
    expect(prototypeAccountType("Expenses:Rent")).toBe("expense");
    expect(prototypeAccountType("Equity:OpeningBalances")).toBe("equity");
  });
  it("refuses a name outside the five roots", () => {
    expect(prototypeAccountType("Misc:Thing")).toBeNull();
  });
});
