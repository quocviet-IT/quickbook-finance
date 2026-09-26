import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountNames,
  formatAmount,
  quote,
  sanitizeComponent,
  tagSafe,
  type BeancountAccount,
} from "@/lib/domain/beancount";

const acct = (over: Partial<BeancountAccount> = {}): BeancountAccount => ({
  id: "a1b2c3d4-0000-0000-0000-000000000001",
  code: "1010",
  name: "Operating Checking",
  type: "bank",
  ...over,
});

describe("sanitizeComponent", () => {
  it("turns spaces and punctuation into single hyphens", () => {
    expect(sanitizeComponent("1010-VAT Payable (Output)")).toBe("1010-VAT-Payable-Output");
  });

  it("keeps the letters of an accented or Vietnamese name", () => {
    expect(sanitizeComponent("6100-Chi phí điện nước")).toBe("6100-Chi-phi-dien-nuoc");
    expect(sanitizeComponent("Đầu tư")).toBe("Dau-tu");
  });

  it("upper-cases a leading lower-case letter", () => {
    expect(sanitizeComponent("cash-drawer")).toBe("Cash-drawer");
  });

  it("falls back to a fixed word when nothing usable is left", () => {
    expect(sanitizeComponent("()  --  !!")).toBe("Account");
  });
});

describe("accountNames", () => {
  it("builds the name from the type prefix and the code-led component", () => {
    const names = accountNames([acct()]);
    expect(names.get(acct().id)).toBe("Assets:Bank:1010-Operating-Checking");
  });

  it("maps every account type to its root", () => {
    const types: Array<[BeancountAccount["type"], string]> = [
      ["accounts_receivable", "Assets:Receivable:"],
      ["current_asset", "Assets:Current:"],
      ["fixed_asset", "Assets:Fixed:"],
      ["accounts_payable", "Liabilities:Payable:"],
      ["credit_card", "Liabilities:CreditCard:"],
      ["current_liability", "Liabilities:Current:"],
      ["equity", "Equity:"],
      ["income", "Income:"],
      ["other_income", "Income:Other:"],
      ["cost_of_goods_sold", "Expenses:COGS:"],
      ["expense", "Expenses:"],
      ["other_expense", "Expenses:Other:"],
    ];
    for (const [type, prefix] of types) {
      const a = acct({ id: `id-${type}`, type });
      expect(accountNames([a]).get(a.id)?.startsWith(prefix)).toBe(true);
    }
  });

  it("never lets two accounts share a name, even when their codes clean up the same", () => {
    const one = acct({ id: "aaaaaa11-0000-0000-0000-000000000000", code: "1010", name: "Cash" });
    const two = acct({ id: "bbbbbb22-0000-0000-0000-000000000000", code: "1010.", name: "Cash" });
    const names = accountNames([one, two]);
    expect(names.get(one.id)).toBe("Assets:Bank:1010-Cash-aaaaaa");
    expect(names.get(two.id)).toBe("Assets:Bank:1010-Cash-bbbbbb");
  });
});

describe("quote", () => {
  it("escapes the way Beancount reads a string", () => {
    expect(quote('He said "fine" \\ ok')).toBe('"He said \\"fine\\" \\\\ ok"');
  });

  it("turns line breaks and tabs into single spaces", () => {
    expect(quote("line one\r\nline two\tend")).toBe('"line one line two end"');
  });
});

describe("tagSafe", () => {
  it("keeps what a tag or link may contain and replaces the rest", () => {
    expect(tagSafe("bill_payment")).toBe("bill_payment");
    expect(tagSafe("INV 0001/A#")).toBe("INV-0001/A-");
  });
});

describe("formatAmount", () => {
  it("writes minor units with the currency's own decimals", () => {
    expect(formatAmount(120000, 2)).toBe("1200.00");
    expect(formatAmount(-5, 2)).toBe("-0.05");
    expect(formatAmount(150000, 0)).toBe("150000");
    expect(formatAmount(0, 2)).toBe("0.00");
  });

  it("refuses a value that is not a whole number of minor units", () => {
    expect(() => formatAmount(10.5, 2)).toThrow();
  });
});

describe("the beancount module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/beancount.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
