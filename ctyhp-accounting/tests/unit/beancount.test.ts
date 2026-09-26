import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountNames,
  documentsByEntry,
  formatAmount,
  quote,
  sanitizeComponent,
  tagSafe,
  type BeancountAccount,
  type BeancountDocumentRows,
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

const noRows = (over: Partial<BeancountDocumentRows> = {}): BeancountDocumentRows => ({
  invoices: [],
  bills: [],
  payments: [],
  billPayments: [],
  paymentAllocations: [],
  billPaymentAllocations: [],
  ...over,
});

describe("documentsByEntry", () => {
  it("gives an invoice's entry its number as a link and its due date", () => {
    const docs = documentsByEntry(
      noRows({ invoices: [{ id: "i1", number: "INV-000001", dueDate: "2025-02-14", journalEntryId: "e1" }] }),
    );
    expect(docs.get("e1")).toEqual({ links: ["INV-000001"], reference: null, dueDate: "2025-02-14" });
  });

  it("links a payment's entry to every invoice it settled, and carries its reference", () => {
    const docs = documentsByEntry(
      noRows({
        invoices: [
          { id: "i1", number: "INV-000001", dueDate: null, journalEntryId: "e1" },
          { id: "i2", number: "INV-000002", dueDate: null, journalEntryId: "e2" },
        ],
        payments: [{ id: "p1", reference: "1042", journalEntryId: "e3" }],
        paymentAllocations: [
          { paymentId: "p1", documentId: "i2" },
          { paymentId: "p1", documentId: "i1" },
        ],
      }),
    );
    expect(docs.get("e3")).toEqual({ links: ["INV-000001", "INV-000002"], reference: "1042", dueDate: null });
  });

  it("does the same for bills and bill payments", () => {
    const docs = documentsByEntry(
      noRows({
        bills: [{ id: "b1", number: "BILL-000007", dueDate: "2025-03-01", journalEntryId: "e1" }],
        billPayments: [{ id: "bp1", reference: " 2210 ", journalEntryId: "e2" }],
        billPaymentAllocations: [{ paymentId: "bp1", documentId: "b1" }],
      }),
    );
    expect(docs.get("e1")).toEqual({ links: ["BILL-000007"], reference: null, dueDate: "2025-03-01" });
    expect(docs.get("e2")).toEqual({ links: ["BILL-000007"], reference: "2210", dueDate: null });
  });

  it("ignores a blank reference and a document with no number", () => {
    const docs = documentsByEntry(
      noRows({
        invoices: [{ id: "i1", number: null, dueDate: null, journalEntryId: "e1" }],
        payments: [{ id: "p1", reference: "   ", journalEntryId: "e2" }],
      }),
    );
    expect(docs.get("e1")).toEqual({ links: [], reference: null, dueDate: null });
    expect(docs.get("e2")).toEqual({ links: [], reference: null, dueDate: null });
  });
});

describe("the beancount module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/beancount.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
