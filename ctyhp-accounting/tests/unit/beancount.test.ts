import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountNames,
  beancountEntryText,
  beancountFileName,
  beancountNameWidth,
  buildBeancountFile,
  buildBeancountLines,
  documentsByEntry,
  formatAmount,
  quote,
  sanitizeComponent,
  tagSafe,
  type BeancountAccount,
  type BeancountDocumentRows,
  type BeancountEntry,
  type BeancountInput,
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

const USD = { code: "USD", decimalPlaces: 2, isBase: true };
const EUR = { code: "EUR", decimalPlaces: 2, isBase: false };
const VND = { code: "VND", decimalPlaces: 0, isBase: false };

const BANK = acct({ id: "acc-bank", code: "1010", name: "Operating Checking", type: "bank" });
const AR = acct({ id: "acc-ar", code: "1100", name: "Accounts Receivable", type: "accounts_receivable" });
const SALES = acct({ id: "acc-sales", code: "4000", name: "Sales Revenue", type: "income" });

const entry = (over: Partial<BeancountEntry> = {}): BeancountEntry => ({
  id: "e1",
  entryNumber: "JE-000001",
  entryDate: "2025-01-15",
  description: "Invoice INV-000001",
  sourceType: "invoice",
  currencyCode: "USD",
  lines: [
    { accountId: "acc-ar", debitMinor: 120000, creditMinor: 0 },
    { accountId: "acc-sales", debitMinor: 0, creditMinor: 120000 },
  ],
  ...over,
});

const input = (over: Partial<BeancountInput> = {}): BeancountInput => ({
  company: { legalName: "Riverbend Trading LLC", fiscalYearStartMonth: 1, accountingBasis: "accrual" },
  generatedAt: "2026-09-26T08:00:00.000Z",
  accounts: [BANK, AR, SALES],
  entries: [],
  partyByEntryId: new Map(),
  documentByEntryId: new Map(),
  currencies: [USD, EUR, VND],
  prices: [],
  ...over,
});

describe("buildBeancountFile", () => {
  it("writes a small book exactly", () => {
    const text = buildBeancountFile(
      input({
        entries: [
          entry(),
          entry({
            id: "e2",
            entryNumber: "JE-000002",
            entryDate: "2025-02-03",
            description: "Payment received",
            sourceType: "payment",
            lines: [
              { accountId: "acc-bank", debitMinor: 120000, creditMinor: 0 },
              { accountId: "acc-ar", debitMinor: 0, creditMinor: 120000 },
            ],
          }),
        ],
        partyByEntryId: new Map([["e1", "Harbor Cafe"], ["e2", "Harbor Cafe"]]),
        documentByEntryId: new Map([
          ["e1", { links: ["INV-000001"], reference: null, dueDate: "2025-02-14" }],
          ["e2", { links: ["INV-000001"], reference: "1042", dueDate: null }],
        ]),
      }),
    );

    // The longest name is Assets:Receivable:1100-Accounts-Receivable (42), so
    // accounts pad to 44 and amounts right-align in 16.
    const a = (name: string) => name.padEnd(44);
    const n = (amount: string) => amount.padStart(16);
    expect(text).toBe(
      [
        ";; " + "=".repeat(58),
        ";; Riverbend Trading LLC - Beancount ledger",
        ";; Generated 2026-09-26 | Beancount v3 format",
        ";; " + "=".repeat(58),
        "",
        'option "title" "Riverbend Trading LLC"',
        'option "operating_currency" "USD"',
        ";; Fiscal year starts: January",
        ";; Basis: accrual",
        "",
        ";; --- Chart of accounts ---",
        "",
        ";; Assets",
        "2025-01-15 open Assets:Bank:1010-Operating-Checking",
        "2025-01-15 open Assets:Receivable:1100-Accounts-Receivable",
        "",
        ";; Income",
        "2025-01-15 open Income:4000-Sales-Revenue",
        "",
        ";; --- Transactions ---",
        "",
        ";; January 2025",
        "",
        '2025-01-15 * "Harbor Cafe" "Invoice INV-000001" #invoice ^INV-000001',
        '  entry: "JE-000001"',
        "  due: 2025-02-14",
        `  ${a("Assets:Receivable:1100-Accounts-Receivable")}${n("1200.00")} USD`,
        `  ${a("Income:4000-Sales-Revenue")}${n("-1200.00")} USD`,
        "",
        ";; February 2025",
        "",
        '2025-02-03 * "Harbor Cafe" "Payment received" #payment ^INV-000001',
        '  entry: "JE-000002"',
        '  num: "1042"',
        `  ${a("Assets:Bank:1010-Operating-Checking")}${n("1200.00")} USD`,
        `  ${a("Assets:Receivable:1100-Accounts-Receivable")}${n("-1200.00")} USD`,
        "",
        ";; --- End of file ---",
        "",
      ].join("\n"),
    );
  });

  it("writes only the narration when an entry has no counterparty", () => {
    const text = buildBeancountFile(input({ entries: [entry({ sourceType: "manual", description: "Month-end accrual" })] }));
    expect(text).toContain('2025-01-15 * "Month-end accrual" #manual\n');
  });

  it("orders entries by date then number, whatever order they arrive in", () => {
    const text = buildBeancountFile(
      input({
        entries: [
          entry({ id: "late", entryNumber: "JE-000009", entryDate: "2025-03-01" }),
          entry({ id: "b", entryNumber: "JE-000003", entryDate: "2025-01-15" }),
          entry({ id: "a", entryNumber: "JE-000002", entryDate: "2025-01-15" }),
        ],
      }),
    );
    const order = [...text.matchAll(/entry: "(JE-\d+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["JE-000002", "JE-000003", "JE-000009"]);
  });

  it("writes a zero-decimal currency without a decimal point", () => {
    const text = buildBeancountFile(
      input({
        entries: [
          entry({
            currencyCode: "VND",
            lines: [
              { accountId: "acc-bank", debitMinor: 150000, creditMinor: 0 },
              { accountId: "acc-sales", debitMinor: 0, creditMinor: 150000 },
            ],
          }),
        ],
      }),
    );
    expect(text).toMatch(/Assets:Bank:1010-Operating-Checking\s+150000 VND/);
    expect(text).toMatch(/Income:4000-Sales-Revenue\s+-150000 VND/);
  });

  it("adds price directives only for foreign currencies the book uses", () => {
    const text = buildBeancountFile(
      input({
        entries: [entry({ currencyCode: "EUR" })],
        prices: [
          { currencyCode: "EUR", rateDate: "2025-01-15", rateToBase: "1.0837000000" },
          { currencyCode: "VND", rateDate: "2025-01-15", rateToBase: "0.0000400000" },
          { currencyCode: "USD", rateDate: "2025-01-15", rateToBase: "1" },
        ],
      }),
    );
    expect(text).toContain(";; --- Prices ---\n\n2025-01-15 price EUR 1.0837 USD\n");
    expect(text).not.toContain("price VND");
    expect(text).not.toContain("price USD");
  });

  it("omits the prices section for a single-currency book", () => {
    const text = buildBeancountFile(input({ entries: [entry()] }));
    expect(text).not.toContain("--- Prices ---");
  });

  it("refuses an entry posting to an account missing from the chart", () => {
    const bad = entry({ lines: [{ accountId: "nowhere", debitMinor: 1, creditMinor: 0 }] });
    expect(() => buildBeancountFile(input({ entries: [bad] }))).toThrow(/JE-000001/);
  });

  it("refuses an entry in a currency it has no decimals for", () => {
    expect(() => buildBeancountFile(input({ entries: [entry({ currencyCode: "GBP" })] }))).toThrow(/GBP/);
  });

  it("never writes a TIN, whatever the company settings hold", () => {
    const text = buildBeancountFile(input({ entries: [entry()] }));
    // A label standing on its own, as the prototype's `;; TIN: ...` line was.
    // Case-sensitive and word-bounded: "Operating" contains "tin" and is fine.
    expect(text).not.toMatch(/\b(TIN|EIN)\b/);
  });

  it("balances every transaction it writes, per currency", () => {
    const text = buildBeancountFile(
      input({
        entries: [
          entry(),
          entry({
            id: "e2",
            entryNumber: "JE-000002",
            currencyCode: "EUR",
            lines: [
              { accountId: "acc-bank", debitMinor: 33317, creditMinor: 0 },
              { accountId: "acc-ar", debitMinor: 1, creditMinor: 0 },
              { accountId: "acc-sales", debitMinor: 0, creditMinor: 33318 },
            ],
          }),
          entry({
            id: "e3",
            entryNumber: "JE-000003",
            currencyCode: "VND",
            lines: [
              { accountId: "acc-bank", debitMinor: 2500000, creditMinor: 0 },
              { accountId: "acc-sales", debitMinor: 0, creditMinor: 2500000 },
            ],
          }),
        ],
      }),
    );
    // Read the file back the way bean-check starts: every transaction's postings
    // summed per currency must be exactly zero.
    const sums: Array<Map<string, number>> = [];
    for (const line of text.split("\n")) {
      if (/^\d{4}-\d{2}-\d{2} \*/.test(line)) sums.push(new Map());
      const posting = line.match(/^ {2}\S+\s+(-?\d+)(?:\.(\d+))?\s([A-Z]{3})$/);
      if (posting) {
        const minor = Number(posting[1] + (posting[2] ?? ""));
        const current = sums[sums.length - 1];
        current.set(posting[3], (current.get(posting[3]) ?? 0) + minor);
      }
    }
    expect(sums).toHaveLength(3);
    for (const bucket of sums) for (const total of bucket.values()) expect(total).toBe(0);
  });
});

describe("buildBeancountLines", () => {
  const book = () =>
    input({
      entries: [
        entry(),
        entry({
          id: "e2",
          entryNumber: "JE-000002",
          entryDate: "2025-02-03",
          description: "Payment received",
          sourceType: "payment",
          lines: [
            { accountId: "acc-bank", debitMinor: 120000, creditMinor: 0 },
            { accountId: "acc-ar", debitMinor: 0, creditMinor: 120000 },
          ],
        }),
      ],
      partyByEntryId: new Map([["e1", "Harbor Cafe"]]),
      documentByEntryId: new Map([["e1", { links: ["INV-000001"], reference: null, dueDate: "2025-02-14" }]]),
    });

  it("joins to exactly the file that is handed over", () => {
    const lines = buildBeancountLines(book());
    expect(`${lines.map((l) => l.text).join("\n")}\n`).toBe(buildBeancountFile(book()));
  });

  it("says which account each open line and posting belongs to, and where its name sits", () => {
    const lines = buildBeancountLines(book());
    const open = lines.find((l) => l.kind === "open" && l.accountId === "acc-sales");
    expect(open && open.kind === "open" ? open.text.slice(open.accountStart) : null).toBe("Income:4000-Sales-Revenue");

    const posting = lines.find((l) => l.kind === "posting" && l.entryId === "e1" && l.accountId === "acc-sales");
    if (!posting || posting.kind !== "posting") throw new Error("no posting");
    expect(posting.text.slice(2, posting.accountEnd)).toBe("Income:4000-Sales-Revenue");
    expect(posting.text.slice(posting.amountStart, posting.amountEnd)).toBe("-1200.00");
    expect(posting.credit).toBe(true);
    expect(posting.text.slice(posting.amountEnd)).toBe(" USD");
  });

  it("marks a debit posting as not a credit", () => {
    const lines = buildBeancountLines(book());
    const debit = lines.find((l) => l.kind === "posting" && l.entryId === "e2" && l.accountId === "acc-bank");
    if (!debit || debit.kind !== "posting") throw new Error("no posting");
    expect(debit.text.slice(debit.amountStart, debit.amountEnd)).toBe("1200.00");
    expect(debit.credit).toBe(false);
  });

  it("ties every header and metadata line to its entry", () => {
    const lines = buildBeancountLines(book());
    const header = lines.find((l) => l.kind === "txn" && l.entryId === "e1");
    expect(header?.text).toBe('2025-01-15 * "Harbor Cafe" "Invoice INV-000001" #invoice ^INV-000001');
    const meta = lines.filter((l) => l.kind === "meta" && l.entryId === "e1").map((l) => l.text);
    expect(meta).toEqual(['  entry: "JE-000001"', "  due: 2025-02-14"]);
  });
});

describe("beancountEntryText", () => {
  it("writes one entry exactly as the file does", () => {
    const b = input({
      entries: [entry()],
      partyByEntryId: new Map([["e1", "Harbor Cafe"]]),
      documentByEntryId: new Map([["e1", { links: ["INV-000001"], reference: null, dueDate: "2025-02-14" }]]),
    });
    const names = accountNames(b.accounts);
    const text = beancountEntryText(entry(), {
      names,
      nameWidth: beancountNameWidth(names),
      decimals: 2,
      party: "Harbor Cafe",
      document: { links: ["INV-000001"], reference: null, dueDate: "2025-02-14" },
    });
    expect(buildBeancountFile(b)).toContain(`${text}\n`);
    // Header, entry number, due date, two postings.
    expect(text.split("\n")).toHaveLength(5);
  });
});

describe("beancountFileName", () => {
  it("names the file after the company", () => {
    expect(beancountFileName("Riverbend Trading LLC")).toBe("riverbend-trading-llc.beancount");
  });

  it("falls back when the name yields nothing usable", () => {
    expect(beancountFileName("!!")).toBe("ledger.beancount");
  });
});

describe("the beancount module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/beancount.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
