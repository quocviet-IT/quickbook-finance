# Beancount Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/reports/beancount` page that lets a user with `company.export` download the whole ledger as a valid Beancount v3 file, as specified in `docs/superpowers/specs/2026-09-26-beancount-export-design.md`.

**Architecture:** A pure domain module turns already-read data into the file's text and knows nothing about the database. A service module reads everything with paged queries and fails as a whole if any read fails. A server action checks permission, builds the text, records the export in the audit log through the existing RPC, and withholds the file if that record fails.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Ant Design 6, Supabase JS, Vitest, Node `crypto`.

## Global Constraints

- **Nothing in this work may change a figure in the books.** The only write is one audit row through the existing `acc_log_company_export` RPC. No insert, update, delete, upsert or posting RPC against a ledger table. **No migration.**
- `lib/domain/beancount.ts` imports only from `@/lib/domain/*`. A test enforces it.
- Money is integer minor units until the text is written. Amounts are formatted with the **entry's own currency's** `decimal_places`; never by dividing a float.
- Postings carry the **entry's own currency**, never `amount_base_minor` (spec §5.1).
- **The TIN (`ein_ref`) is never read and never written** (spec §3.1).
- **Every read is paged** with `.range()` and an `.order()`, page size 1,000. RPCs are paged too: `getTransactionList` in `lib/services/reports.ts` already does this.
- **All or nothing:** any failed read fails the whole export. No partial file is ever returned.
- If the audit write fails, the file is withheld.
- Permission is `company.export`, checked with `acc_has_permission`.
- Interface language is US English.
- **No real customer data** in any committed file. Test fixtures use invented names and amounts. `tests/unit/customer-data.test.ts` fails on this client's account markers.
- **Commits carry no `Co-Authored-By` trailer** in this repository.
- **Stage files individually.** Never `git add -A` or `git add .`.
- Run all commands from `ctyhp-accounting/`. All paths below are relative to it unless stated.

## File Structure

| File | Responsibility |
|---|---|
| `lib/domain/beancount.ts` | Pure: account naming, escaping, amount formatting, the document join, `buildBeancountFile`. |
| `lib/services/beancount.ts` | Paged reads into `BeancountInput`, and the page summary. |
| `app/(app)/reports/beancount/page.tsx` | Server shell: header, summary, permission state. |
| `app/(app)/reports/beancount/actions.ts` | One server action: permission, build, audit, return. |
| `app/(app)/reports/beancount/BeancountClient.tsx` | Summary figures, download button, instructions. |
| `lib/domain/report-catalog.ts` | One catalogue entry (modify). |
| `lib/domain/changelog.ts` | Release 1.63 (modify). |
| `tests/unit/beancount.test.ts` | Domain tests. |
| `tests/unit/beancount-service.test.ts` | Service tests with a stub client. |

---

### Task 1: Names, strings and amounts

The three small rules everything else is built from, and the purity guard.

**Files:**
- Create: `lib/domain/beancount.ts`
- Create: `tests/unit/beancount.test.ts`

**Interfaces:**
- Consumes: `AccountType` from `@/lib/domain/accounts`
- Produces: `BeancountError`, `BeancountAccount`, `sanitizeComponent(raw): string`, `accountNames(accounts): Map<string, string>`, `quote(text): string`, `tagSafe(text): string`, `formatAmount(minor, decimals): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/beancount.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/beancount.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/beancount"`

- [ ] **Step 3: Write the module**

Create `lib/domain/beancount.ts`:

```ts
/**
 * The ledger as a Beancount v3 file.
 *
 * Pure: it receives data already read and returns text. It imports nothing
 * from `@/lib/db` or `@/lib/services`, and a test in `tests/unit/beancount.test.ts`
 * fails if that changes — the export must be incapable of writing to the books.
 *
 * Money arrives as integer minor units in each entry's own currency and is only
 * turned into decimal text here, by that currency's `decimal_places`.
 */

import type { AccountType } from "@/lib/domain/accounts";

export class BeancountError extends Error {}

export interface BeancountAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
}

/**
 * Where each account type sits in Beancount's five roots. Beancount only knows
 * Assets, Liabilities, Equity, Income and Expenses; the middle segment keeps
 * OneBook's finer types visible in Fava's tree.
 */
const ACCOUNT_PREFIX: Record<AccountType, string> = {
  bank: "Assets:Bank",
  accounts_receivable: "Assets:Receivable",
  current_asset: "Assets:Current",
  fixed_asset: "Assets:Fixed",
  accounts_payable: "Liabilities:Payable",
  credit_card: "Liabilities:CreditCard",
  current_liability: "Liabilities:Current",
  equity: "Equity",
  income: "Income",
  other_income: "Income:Other",
  cost_of_goods_sold: "Expenses:COGS",
  expense: "Expenses",
  other_expense: "Expenses:Other",
};

/**
 * One component of an account name, as Beancount accepts it: an upper-case
 * letter or a digit first, then letters, digits and hyphens.
 *
 * Accents are decomposed and dropped rather than deleted with their letter, so
 * a Vietnamese name keeps its words; `đ` has no decomposition and is mapped by
 * hand.
 */
export function sanitizeComponent(raw: string): string {
  const ascii = raw
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  let cleaned = ascii.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned === "") return "Account";
  if (/^[a-z]/.test(cleaned)) cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  return cleaned;
}

/**
 * A Beancount name for every account, keyed by account id.
 *
 * The code leads because OneBook's names are not unique and its codes are. Two
 * codes can still clean up to the same text — `1010` and `1010.` — and merging
 * those would silently add two accounts' balances together, so every member of
 * a colliding group gets the first six characters of its id appended.
 */
export function accountNames(accounts: readonly BeancountAccount[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const a of accounts) {
    base.set(a.id, `${ACCOUNT_PREFIX[a.type]}:${sanitizeComponent(`${a.code}-${a.name}`)}`);
  }
  const holders = new Map<string, string[]>();
  for (const [id, name] of base) holders.set(name, [...(holders.get(name) ?? []), id]);

  const names = new Map<string, string>();
  for (const [name, ids] of holders) {
    for (const id of ids) {
      // Not through sanitizeComponent: that would upper-case a leading hex letter.
      const suffix = id.replace(/[^A-Za-z0-9]/g, "").slice(0, 6);
      names.set(id, ids.length === 1 ? name : `${name}-${suffix}`);
    }
  }
  if (new Set(names.values()).size !== names.size) {
    throw new BeancountError("Two accounts would share one Beancount name");
  }
  return names;
}

/** A Beancount string literal: backslash and quote escaped, line breaks and tabs as spaces. */
export function quote(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]+/g, " ");
  return `"${escaped}"`;
}

/** Text safe inside a `#tag` or `^link`: letters, digits, `-`, `_`, `/`, `.`. */
export function tagSafe(text: string): string {
  return text.replace(/[^A-Za-z0-9_./-]/g, "-");
}

/** Integer minor units as decimal text, by the currency's own number of decimals. */
export function formatAmount(minor: number, decimals: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new BeancountError(`Amount ${minor} is not a whole number of minor units`);
  }
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(decimals + 1, "0");
  const whole = decimals === 0 ? digits : digits.slice(0, -decimals);
  const fraction = decimals === 0 ? "" : `.${digits.slice(-decimals)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/beancount.test.ts`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/beancount.ts ctyhp-accounting/tests/unit/beancount.test.ts
git commit -m "feat(beancount): account names, strings and amounts the way beancount reads them"
```

---

### Task 2: Which documents each entry belongs to

Joins invoices, bills, payments and their allocations onto journal entries, so an entry can carry its `^link`, `num:` and `due:`. Joined on `journal_entry_id`, which every one of those documents records — never on document numbers, which come from separate sequences and never match (this bit the Exception Report).

**Files:**
- Modify: `lib/domain/beancount.ts`
- Modify: `tests/unit/beancount.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `BeancountDocument`, `BeancountDocumentRows`, `documentsByEntry(rows): Map<string, BeancountDocument>`

- [ ] **Step 1: Write the failing tests**

Add `documentsByEntry` and `type BeancountDocumentRows` to the existing import from `@/lib/domain/beancount` in `tests/unit/beancount.test.ts`, then add this block **before** `describe("the beancount module", ...)`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/beancount.test.ts`
Expected: FAIL — `documentsByEntry is not exported`

- [ ] **Step 3: Write the implementation**

Append to `lib/domain/beancount.ts`:

```ts
/** What an entry carries from the document behind it. */
export interface BeancountDocument {
  /** Document numbers for `^link`, sorted, without duplicates. */
  links: string[];
  /** A payment's check number or wire reference, for `num:`. */
  reference: string | null;
  /** An invoice's or bill's due date, for `due:`. */
  dueDate: string | null;
}

interface NumberedDocument {
  id: string;
  number: string | null;
  dueDate: string | null;
  journalEntryId: string;
}

interface PaymentDocument {
  id: string;
  reference: string | null;
  journalEntryId: string;
}

interface Allocation {
  paymentId: string;
  documentId: string;
}

export interface BeancountDocumentRows {
  invoices: readonly NumberedDocument[];
  bills: readonly NumberedDocument[];
  payments: readonly PaymentDocument[];
  billPayments: readonly PaymentDocument[];
  paymentAllocations: readonly Allocation[];
  billPaymentAllocations: readonly Allocation[];
}

/**
 * The document behind each journal entry, keyed by entry id.
 *
 * Joined on `journal_entry_id`, which each document records. Not on document
 * numbers: a payment's number and its entry's number come from separate
 * sequences and are never equal.
 *
 * A document gets `^` its own number; a payment gets the numbers of the
 * documents it settled, so Fava groups an invoice with the payments against it.
 */
export function documentsByEntry(rows: BeancountDocumentRows): Map<string, BeancountDocument> {
  const out = new Map<string, BeancountDocument>();

  const addDocuments = (docs: readonly NumberedDocument[]) => {
    for (const d of docs) {
      out.set(d.journalEntryId, { links: d.number ? [d.number] : [], reference: null, dueDate: d.dueDate });
    }
  };

  const addPayments = (
    payments: readonly PaymentDocument[],
    allocations: readonly Allocation[],
    documents: readonly NumberedDocument[],
  ) => {
    const numberOf = new Map(documents.map((d) => [d.id, d.number]));
    for (const p of payments) {
      const links = new Set<string>();
      for (const a of allocations) {
        if (a.paymentId !== p.id) continue;
        const n = numberOf.get(a.documentId);
        if (n) links.add(n);
      }
      const reference = p.reference?.trim() ? p.reference.trim() : null;
      out.set(p.journalEntryId, { links: [...links].sort(), reference, dueDate: null });
    }
  };

  addDocuments(rows.invoices);
  addDocuments(rows.bills);
  addPayments(rows.payments, rows.paymentAllocations, rows.invoices);
  addPayments(rows.billPayments, rows.billPaymentAllocations, rows.bills);
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/beancount.test.ts`
Expected: PASS, 17 tests

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/beancount.ts ctyhp-accounting/tests/unit/beancount.test.ts
git commit -m "feat(beancount): an entry knows the document it came from, joined by entry id"
```

---

### Task 3: The file itself

**Files:**
- Modify: `lib/domain/beancount.ts`
- Modify: `tests/unit/beancount.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2
- Produces: `BeancountLine`, `BeancountEntry`, `BeancountCurrency`, `BeancountPrice`, `BeancountCompany`, `BeancountInput`, `buildBeancountFile(input): string`, `beancountFileName(legalName): string`

- [ ] **Step 1: Write the failing tests**

Add `buildBeancountFile`, `beancountFileName`, `type BeancountInput` and `type BeancountEntry` to the import in `tests/unit/beancount.test.ts`, then add **before** `describe("the beancount module", ...)`:

```ts
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

describe("beancountFileName", () => {
  it("names the file after the company", () => {
    expect(beancountFileName("Riverbend Trading LLC")).toBe("riverbend-trading-llc.beancount");
  });

  it("falls back when the name yields nothing usable", () => {
    expect(beancountFileName("!!")).toBe("ledger.beancount");
  });
});
```

The balance parser above reads `-0.05` as `-005`. That is `-5`, which is correct for a negative amount under one unit — but a negative amount with a zero whole part must keep its sign. `formatAmount` writes `-0.05`, the regex captures `-0` and `05`, and `Number("-005")` is `-5`. Correct.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/beancount.test.ts`
Expected: FAIL — `buildBeancountFile is not exported`

- [ ] **Step 3: Write the implementation**

Add `import { companySlugFromName } from "@/lib/domain/company-slug";` beside the existing import at the top of `lib/domain/beancount.ts`, then append:

```ts
export interface BeancountLine {
  accountId: string;
  debitMinor: number;
  creditMinor: number;
}

export interface BeancountEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  sourceType: string;
  /** The entry's own currency — the one it is required to balance in. */
  currencyCode: string;
  lines: BeancountLine[];
}

export interface BeancountCurrency {
  code: string;
  decimalPlaces: number;
  isBase: boolean;
}

export interface BeancountPrice {
  currencyCode: string;
  rateDate: string;
  /** Units of base currency per one unit of this currency, as the database stored it. */
  rateToBase: string;
}

export interface BeancountCompany {
  legalName: string;
  fiscalYearStartMonth: number;
  accountingBasis: "accrual" | "cash";
}

export interface BeancountInput {
  company: BeancountCompany;
  /** The export's single clock reading, ISO. */
  generatedAt: string;
  accounts: readonly BeancountAccount[];
  /** Posted entries only. Voided entries are not in the books, so not in the file. */
  entries: readonly BeancountEntry[];
  partyByEntryId: ReadonlyMap<string, string>;
  documentByEntryId: ReadonlyMap<string, BeancountDocument>;
  currencies: readonly BeancountCurrency[];
  prices: readonly BeancountPrice[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ROOTS = ["Assets", "Liabilities", "Equity", "Income", "Expenses"] as const;

/** Comment text on one line. */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}

/** A rate as the database stored it, without trailing zeros. */
function trimRate(rate: string): string {
  return rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
}

/**
 * The whole ledger as Beancount v3 text.
 *
 * Postings carry each entry's own currency: OneBook guarantees an entry balances
 * in that currency, while its base-currency figures are rounded line by line and
 * can be out by a minor unit — which `bean-check` would reject.
 */
export function buildBeancountFile(input: BeancountInput): string {
  const base = input.currencies.find((c) => c.isBase);
  if (!base) throw new BeancountError("No base currency is set");
  const decimalsOf = new Map(input.currencies.map((c) => [c.code, c.decimalPlaces]));

  const names = accountNames(input.accounts);
  const nameWidth = Math.max(0, ...[...names.values()].map((n) => n.length)) + 2;

  const entries = [...input.entries].sort(
    (x, y) => x.entryDate.localeCompare(y.entryDate) || x.entryNumber.localeCompare(y.entryNumber),
  );
  // Every account opens on the book's first date, which is on or before any
  // posting to it by construction.
  const openDate = entries[0]?.entryDate ?? input.generatedAt.slice(0, 10);

  const out: string[] = [];
  const rule = `;; ${"=".repeat(58)}`;
  out.push(
    rule,
    `;; ${oneLine(input.company.legalName)} - Beancount ledger`,
    `;; Generated ${input.generatedAt.slice(0, 10)} | Beancount v3 format`,
    rule,
    "",
    `option "title" ${quote(input.company.legalName)}`,
    `option "operating_currency" ${quote(base.code)}`,
    `;; Fiscal year starts: ${MONTHS[input.company.fiscalYearStartMonth - 1] ?? String(input.company.fiscalYearStartMonth)}`,
    `;; Basis: ${input.company.accountingBasis}`,
    "",
    ";; --- Chart of accounts ---",
    "",
  );

  for (const root of ROOTS) {
    const inRoot = [...names.values()].filter((n) => n.startsWith(`${root}:`)).sort();
    if (inRoot.length === 0) continue;
    out.push(`;; ${root}`);
    for (const n of inRoot) out.push(`${openDate} open ${n}`);
    out.push("");
  }

  const used = new Set(entries.map((e) => e.currencyCode));
  const prices = input.prices
    .filter((p) => p.currencyCode !== base.code && used.has(p.currencyCode))
    .sort((x, y) => x.rateDate.localeCompare(y.rateDate) || x.currencyCode.localeCompare(y.currencyCode));
  if (prices.length > 0) {
    out.push(";; --- Prices ---", "");
    for (const p of prices) out.push(`${p.rateDate} price ${p.currencyCode} ${trimRate(p.rateToBase)} ${base.code}`);
    out.push("");
  }

  out.push(";; --- Transactions ---", "");
  if (entries.length === 0) out.push("; No posted entries.", "");

  let month = "";
  for (const e of entries) {
    const m = e.entryDate.slice(0, 7);
    if (m !== month) {
      month = m;
      out.push(`;; ${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`, "");
    }

    const decimals = decimalsOf.get(e.currencyCode);
    if (decimals === undefined) {
      throw new BeancountError(`Entry ${e.entryNumber} is in ${e.currencyCode}, which has no currency record`);
    }

    const party = input.partyByEntryId.get(e.id);
    const doc = input.documentByEntryId.get(e.id);
    let header = `${e.entryDate} *`;
    if (party) header += ` ${quote(party)}`;
    header += ` ${quote(e.description ?? "")} #${tagSafe(e.sourceType)}`;
    for (const link of doc?.links ?? []) header += ` ^${tagSafe(link)}`;
    out.push(header, `  entry: ${quote(e.entryNumber)}`);
    if (doc?.reference) out.push(`  num: ${quote(doc.reference)}`);
    if (doc?.dueDate) out.push(`  due: ${doc.dueDate}`);

    for (const l of e.lines) {
      const account = names.get(l.accountId);
      if (!account) throw new BeancountError(`Entry ${e.entryNumber} posts to an account that is not in the chart`);
      const amount = formatAmount(l.debitMinor - l.creditMinor, decimals);
      out.push(`  ${account.padEnd(nameWidth)}${amount.padStart(16)} ${e.currencyCode}`);
    }
    out.push("");
  }

  out.push(";; --- End of file ---");
  return `${out.join("\n")}\n`;
}

/** `<company-slug>.beancount`, or `ledger.beancount` when the name yields no slug. */
export function beancountFileName(legalName: string): string {
  const slug = companySlugFromName(legalName).replace(/_/g, "-");
  return `${slug || "ledger"}.beancount`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/beancount.test.ts`
Expected: PASS, 29 tests

- [ ] **Step 5: Type-check and commit**

Run: `npm run typecheck`
Expected: no output

```bash
git add ctyhp-accounting/lib/domain/beancount.ts ctyhp-accounting/tests/unit/beancount.test.ts
git commit -m "feat(beancount): the ledger as one beancount file, balanced in each entry's currency"
```

---

### Task 4: The service — paged reads, all or nothing

**Files:**
- Create: `lib/services/beancount.ts`
- Create: `tests/unit/beancount-service.test.ts`

**Interfaces:**
- Consumes: `documentsByEntry`, `BeancountInput`, `BeancountEntry`, `BeancountAccount` from `@/lib/domain/beancount`; `getTransactionList` from `@/lib/services/reports` (already paged); `getCurrentCompanySettings` from `@/lib/services/company`. **Not** `listCurrencies` — it returns USD only; see `readCurrencies`.
- Produces: `BeancountExportError`, `BEANCOUNT_SOURCES`, `readBeancountInput(sb, generatedAt): Promise<BeancountInput>`, `BeancountSummary`, `readBeancountSummary(sb): Promise<BeancountSummary>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/beancount-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readBeancountInput, readBeancountSummary } from "@/lib/services/beancount";

type Row = Record<string, unknown>;
type Filter = [string, string, unknown];

interface Table {
  rows: Row[];
  /** Fail this request number (1-based) with an error, to prove all-or-nothing. */
  failOnPage?: number;
}

/**
 * A stub of the supabase-js builder. `.range(from, to)` returns that slice and
 * no more, the way PostgREST does; `.limit()` and a `head` count are answered
 * from the same rows, filtered by the `.eq()` calls made.
 */
function fakeClient(tables: Record<string, Table>, rpcRows: Row[] = []) {
  const calls: Array<{ table: string; filters: Filter[] }> = [];

  // Pages are counted per table across the whole run, so `failOnPage: 2` fails
  // the second page that table is asked for, whichever query asks.
  const pagesServed = new Map<string, number>();

  function builder(table: string) {
    const filters: Filter[] = [];
    let head = false;
    let limitTo: number | null = null;
    const matching = () =>
      (tables[table]?.rows ?? []).filter((r) => filters.every(([op, col, v]) => (op === "eq" ? r[col] === v : true)));
    const b: Record<string, unknown> = {
      select: (_cols: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return b;
      },
      eq: (col: string, v: unknown) => {
        filters.push(["eq", col, v]);
        return b;
      },
      not: (col: string, _op: string, v: unknown) => {
        filters.push(["not", col, v]);
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        limitTo = n;
        return b;
      },
      range: async (from: number, to: number) => {
        const page = (pagesServed.get(table) ?? 0) + 1;
        pagesServed.set(table, page);
        calls.push({ table, filters: [...filters] });
        if (tables[table]?.failOnPage === page) return { data: null, error: { message: `${table} page ${page} failed` } };
        return { data: matching().slice(from, to + 1), error: null };
      },
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      // Awaiting the builder itself: a head count, or a plain (possibly limited) read.
      then: (resolve: (v: unknown) => void) => {
        if (head) return resolve({ count: matching().length, data: null, error: null });
        const rows = matching();
        return resolve({ data: limitTo === null ? rows : rows.slice(0, limitTo), error: null });
      },
    };
    return b;
  }

  const sb = {
    from: (table: string) => builder(table),
    rpc: () => ({
      range: async (from: number, to: number) => ({ data: rpcRows.slice(from, to + 1), error: null }),
    }),
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const settings = {
  rows: [{ legal_name: "Riverbend Trading LLC", fiscal_year_start_month: 1, accounting_basis: "accrual" }],
};
// Read straight from the table, so a non-USD currency is present here even
// though the app's own picker offers only USD.
const currencies = {
  rows: [
    { code: "EUR", decimal_places: 2, is_base: false },
    { code: "USD", decimal_places: 2, is_base: true },
  ],
};

function entryRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    entry_number: `JE-${String(i).padStart(6, "0")}`,
    entry_date: "2025-01-15",
    description: `Entry ${i}`,
    source_type: "manual",
    currency_code: "USD",
    status: "posted",
    acc_journal_line: [
      { account_id: "acc-sales", debit_minor: 0, credit_minor: 100, line_order: 2 },
      { account_id: "acc-bank", debit_minor: 100, credit_minor: 0, line_order: 1 },
    ],
  }));
}

const baseTables = (entries: Row[]): Record<string, Table> => ({
  acc_account: {
    rows: [
      { id: "acc-bank", account_code: "1010", name: "Operating Checking", account_type: "bank" },
      { id: "acc-sales", account_code: "4000", name: "Sales Revenue", account_type: "income" },
    ],
  },
  acc_journal_entry: { rows: entries },
  acc_invoice: { rows: [] },
  acc_bill: { rows: [] },
  acc_payment: { rows: [] },
  acc_bill_payment: { rows: [] },
  acc_payment_allocation: { rows: [] },
  acc_bill_payment_allocation: { rows: [] },
  acc_exchange_rate: { rows: [] },
  acc_currency: currencies,
  acc_company_setting_version: settings,
});

describe("readBeancountInput", () => {
  it("reads a book of more than a thousand entries whole, in order", async () => {
    const { sb } = fakeClient(baseTables(entryRows(2345)));
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.entries).toHaveLength(2345);
    expect(input.entries[1000].entryNumber).toBe("JE-001000");
  });

  it("reads posted entries only", async () => {
    const { sb, calls } = fakeClient(baseTables(entryRows(3)));
    await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    const entryCalls = calls.filter((c) => c.table === "acc_journal_entry");
    expect(entryCalls.length).toBeGreaterThan(0);
    for (const c of entryCalls) expect(c.filters).toContainEqual(["eq", "status", "posted"]);
  });

  it("puts each entry's lines in their recorded order", async () => {
    const { sb } = fakeClient(baseTables(entryRows(1)));
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.entries[0].lines.map((l) => l.accountId)).toEqual(["acc-bank", "acc-sales"]);
  });

  it("fails as a whole when any page of any read fails", async () => {
    const tables = baseTables(entryRows(2345));
    tables.acc_journal_entry.failOnPage = 2;
    const { sb } = fakeClient(tables);
    await expect(readBeancountInput(sb, "2026-09-26T08:00:00.000Z")).rejects.toThrow(/acc_journal_entry/);
  });

  it("never reads the TIN", async () => {
    const tables = baseTables(entryRows(1));
    tables.acc_company_setting_version.rows[0].ein_ref = "00-0000000";
    const { sb } = fakeClient(tables);
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(JSON.stringify(input.company)).not.toContain("00-0000000");
  });

  it("reads every currency record, not only the ones the app offers today", async () => {
    // listCurrencies returns USD only. An entry left in another currency must
    // still format, or the whole export fails.
    const { sb } = fakeClient(baseTables(entryRows(1)));
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.currencies.map((c) => c.code)).toEqual(["EUR", "USD"]);
  });

  it("takes each entry's counterparty from the transaction list", async () => {
    const { sb } = fakeClient(baseTables(entryRows(2)), [
      { entry_id: "e1", party_name: "Harbor Cafe", entry_date: "2025-01-15", amount_minor: 0, account_ids: [] },
    ]);
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.partyByEntryId.get("e1")).toBe("Harbor Cafe");
    expect(input.partyByEntryId.has("e0")).toBe(false);
  });
});

describe("readBeancountSummary", () => {
  it("counts entries and accounts and names the currencies in use", async () => {
    const { sb } = fakeClient(baseTables(entryRows(4)));
    const summary = await readBeancountSummary(sb);
    expect(summary.entryCount).toBe(4);
    expect(summary.accountCount).toBe(2);
    expect(summary.currencies).toEqual(["USD"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/beancount-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/services/beancount"`

- [ ] **Step 3: Write the service**

Create `lib/services/beancount.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import {
  documentsByEntry,
  type BeancountAccount,
  type BeancountEntry,
  type BeancountInput,
  type BeancountPrice,
} from "@/lib/domain/beancount";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { getTransactionList } from "@/lib/services/reports";

/**
 * Reading the whole ledger for a Beancount file.
 *
 * Every call here reads. There is no insert, update, delete or posting RPC, and
 * there must never be one.
 *
 * Two rules the Exception Report learned and this file keeps:
 * - PostgREST caps any response at 1,000 rows and says nothing, so every read
 *   is paged, with an order that makes the pages stable.
 * - A ledger file cannot be partial. A file missing one page of entries still
 *   parses and still passes bean-check — with the wrong balances. So any failed
 *   read fails the whole export; nothing here catches and carries on.
 */
export class BeancountExportError extends Error {}

/** Every source read for the file, counted into the export's audit record. */
export const BEANCOUNT_SOURCES = [
  "acc_account",
  "acc_journal_entry",
  "acc_journal_line",
  "acc_transaction_list",
  "acc_invoice",
  "acc_bill",
  "acc_payment",
  "acc_bill_payment",
  "acc_payment_allocation",
  "acc_bill_payment_allocation",
  "acc_currency",
  "acc_exchange_rate",
  "acc_company_setting_version",
] as const;

const PAGE = 1000;

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/** Read every page, stopping on the first short one; throw on any error. */
async function readAll<T>(label: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new BeancountExportError(`Reading ${label} failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

interface AccountRow { id: string; account_code: string; name: string; account_type: AccountType }
interface LineRow { account_id: string; debit_minor: number; credit_minor: number; line_order: number }
interface EntryRow {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  source_type: string;
  currency_code: string;
  acc_journal_line: LineRow[];
}
interface NumberedRow { id: string; number: string | null; due_date: string | null; journal_entry_id: string }
interface PaymentRow { id: string; reference: string | null; journal_entry_id: string }
interface RateRow { currency_code: string; rate_date: string; rate_to_base: number | string }
interface CurrencyRow { code: string; decimal_places: number; is_base: boolean }

/**
 * Every currency record, not the app's picker list.
 *
 * `listCurrencies` in `lib/services/reference.ts` deliberately returns USD only,
 * because that is what a user may choose today. The ledger can still hold an
 * entry in another currency from before that rule, and a file that could not
 * format it would fail the whole export — so this reads the table itself.
 */
function readCurrencies(sb: SupabaseClient): Promise<CurrencyRow[]> {
  return readAll<CurrencyRow>("acc_currency", (f, t) =>
    sb.from("acc_currency").select("code,decimal_places,is_base").order("code").range(f, t));
}

/** Everything `buildBeancountFile` needs. Throws if any read fails. */
export async function readBeancountInput(sb: SupabaseClient, generatedAt: string): Promise<BeancountInput> {
  const [
    accounts,
    entries,
    transactions,
    invoices,
    bills,
    payments,
    billPayments,
    paymentAllocations,
    billPaymentAllocations,
    rates,
    currencies,
    company,
  ] = await Promise.all([
    readAll<AccountRow>("acc_account", (f, t) =>
      sb.from("acc_account").select("id,account_code,name,account_type").order("account_code").range(f, t)),
    readAll<EntryRow>("acc_journal_entry", (f, t) =>
      sb
        .from("acc_journal_entry")
        .select(
          "id,entry_number,entry_date,description,source_type,currency_code," +
            "acc_journal_line(account_id,debit_minor,credit_minor,line_order)",
        )
        .eq("status", "posted")
        .order("entry_date")
        .order("entry_number")
        .range(f, t)),
    getTransactionList(sb, "0001-01-01", "9999-12-31"),
    readAll<NumberedRow>("acc_invoice", (f, t) =>
      sb
        .from("acc_invoice")
        .select("id,number:invoice_number,due_date,journal_entry_id")
        .not("journal_entry_id", "is", null)
        .order("id")
        .range(f, t)),
    readAll<NumberedRow>("acc_bill", (f, t) =>
      sb
        .from("acc_bill")
        .select("id,number:bill_number,due_date,journal_entry_id")
        .not("journal_entry_id", "is", null)
        .order("id")
        .range(f, t)),
    readAll<PaymentRow>("acc_payment", (f, t) =>
      sb.from("acc_payment").select("id,reference,journal_entry_id").not("journal_entry_id", "is", null).order("id").range(f, t)),
    readAll<PaymentRow>("acc_bill_payment", (f, t) =>
      sb
        .from("acc_bill_payment")
        .select("id,reference,journal_entry_id")
        .not("journal_entry_id", "is", null)
        .order("id")
        .range(f, t)),
    readAll<{ payment_id: string; invoice_id: string }>("acc_payment_allocation", (f, t) =>
      sb.from("acc_payment_allocation").select("payment_id,invoice_id").order("id").range(f, t)),
    readAll<{ bill_payment_id: string; bill_id: string }>("acc_bill_payment_allocation", (f, t) =>
      sb.from("acc_bill_payment_allocation").select("bill_payment_id,bill_id").order("id").range(f, t)),
    readAll<RateRow>("acc_exchange_rate", (f, t) =>
      sb
        .from("acc_exchange_rate")
        .select("currency_code,rate_date,rate_to_base")
        .order("rate_date")
        .order("currency_code")
        .range(f, t)),
    readCurrencies(sb),
    getCurrentCompanySettings(sb),
  ]);

  if (!company) throw new BeancountExportError("Company settings are not set, so the file would have no title");

  const partyByEntryId = new Map<string, string>();
  for (const t of transactions) if (t.partyName) partyByEntryId.set(t.entryId, t.partyName);

  const toNumbered = (r: NumberedRow) => ({ id: r.id, number: r.number, dueDate: r.due_date, journalEntryId: r.journal_entry_id });
  const toPayment = (r: PaymentRow) => ({ id: r.id, reference: r.reference, journalEntryId: r.journal_entry_id });

  return {
    // Only the three fields the file names. `ein_ref` — the TIN — is never
    // copied out of the settings row, so it cannot reach the file.
    company: {
      legalName: company.legal_name,
      fiscalYearStartMonth: company.fiscal_year_start_month,
      accountingBasis: company.accounting_basis,
    },
    generatedAt,
    accounts: accounts.map<BeancountAccount>((a) => ({
      id: a.id,
      code: a.account_code,
      name: a.name,
      type: a.account_type,
    })),
    entries: entries.map<BeancountEntry>((e) => ({
      id: e.id,
      entryNumber: e.entry_number,
      entryDate: String(e.entry_date).slice(0, 10),
      description: e.description,
      sourceType: e.source_type,
      currencyCode: e.currency_code,
      lines: [...(e.acc_journal_line ?? [])]
        .sort((x, y) => x.line_order - y.line_order)
        .map((l) => ({ accountId: l.account_id, debitMinor: Number(l.debit_minor), creditMinor: Number(l.credit_minor) })),
    })),
    partyByEntryId,
    documentByEntryId: documentsByEntry({
      invoices: invoices.map(toNumbered),
      bills: bills.map(toNumbered),
      payments: payments.map(toPayment),
      billPayments: billPayments.map(toPayment),
      paymentAllocations: paymentAllocations.map((a) => ({ paymentId: a.payment_id, documentId: a.invoice_id })),
      billPaymentAllocations: billPaymentAllocations.map((a) => ({ paymentId: a.bill_payment_id, documentId: a.bill_id })),
    }),
    currencies: currencies.map((c) => ({ code: c.code, decimalPlaces: c.decimal_places, isBase: c.is_base })),
    prices: rates.map<BeancountPrice>((r) => ({
      currencyCode: r.currency_code,
      rateDate: String(r.rate_date).slice(0, 10),
      rateToBase: String(r.rate_to_base),
    })),
  };
}

export interface BeancountSummary {
  entryCount: number;
  accountCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Currencies at least one posted entry is in. */
  currencies: string[];
}

/** What the page shows before anyone downloads. Counts, not the ledger. */
export async function readBeancountSummary(sb: SupabaseClient): Promise<BeancountSummary> {
  const count = async (query: PromiseLike<{ count: number | null; error: { message: string } | null }>, label: string) => {
    const { count: n, error } = await query;
    if (error) throw new BeancountExportError(`Counting ${label} failed: ${error.message}`);
    return n ?? 0;
  };
  const edge = async (ascending: boolean) => {
    const { data, error } = await sb
      .from("acc_journal_entry")
      .select("entry_date")
      .eq("status", "posted")
      .order("entry_date", { ascending })
      .limit(1);
    if (error) throw new BeancountExportError(`Reading the book's dates failed: ${error.message}`);
    const rows = (data ?? []) as { entry_date: string }[];
    return rows.length > 0 ? String(rows[0].entry_date).slice(0, 10) : null;
  };

  const currencyRows = await readCurrencies(sb);
  const [entryCount, accountCount, firstDate, lastDate, perCurrency] = await Promise.all([
    count(sb.from("acc_journal_entry").select("id", { count: "exact", head: true }).eq("status", "posted"), "entries"),
    count(sb.from("acc_account").select("id", { count: "exact", head: true }), "accounts"),
    edge(true),
    edge(false),
    Promise.all(
      currencyRows.map(async (c) => ({
        code: c.code,
        n: await count(
          sb
            .from("acc_journal_entry")
            .select("id", { count: "exact", head: true })
            .eq("status", "posted")
            .eq("currency_code", c.code),
          `${c.code} entries`,
        ),
      })),
    ),
  ]);

  return {
    entryCount,
    accountCount,
    firstDate,
    lastDate,
    currencies: perCurrency.filter((c) => c.n > 0).map((c) => c.code).sort(),
  };
}
```

`acc_invoice.invoice_number` is selected as `number:invoice_number` — a PostgREST column alias — so both document tables arrive in one shape. If typecheck or the stub rejects the alias, select the real column name and map it in `toNumbered` instead; do not change the domain shape.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/beancount-service.test.ts`
Expected: PASS, 8 tests

If the TIN test fails because the stub's settings row is not what `getCurrentCompanySettings` reads, read `lib/services/company.ts` for its column list and table, and make the stub match — the assertion must stay as written.

- [ ] **Step 5: Type-check, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean; no lint errors in the new files

```bash
git add ctyhp-accounting/lib/services/beancount.ts ctyhp-accounting/tests/unit/beancount-service.test.ts
git commit -m "feat(beancount): read the whole book in pages, and fail whole if any page fails"
```

---

### Task 5: The page, the action and the catalogue entry

**Files:**
- Create: `app/(app)/reports/beancount/actions.ts`
- Create: `app/(app)/reports/beancount/page.tsx`
- Create: `app/(app)/reports/beancount/BeancountClient.tsx`
- Modify: `lib/domain/report-catalog.ts`

**Interfaces:**
- Consumes: `readBeancountInput`, `readBeancountSummary`, `BEANCOUNT_SOURCES`, `BeancountSummary` from Task 4; `buildBeancountFile`, `beancountFileName` from Task 3; `readSchemaVersion` from `@/lib/services/company-export`; `downloadTextFile` from `@/lib/client/download`
- Produces: `beancountExportAction(): Promise<ActionResult<BeancountExportResult>>`

- [ ] **Step 1: Write the server action**

Create `app/(app)/reports/beancount/actions.ts`:

```ts
"use server";
import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/db/server";
import { beancountFileName, buildBeancountFile } from "@/lib/domain/beancount";
import { BEANCOUNT_SOURCES, readBeancountInput } from "@/lib/services/beancount";
import { readSchemaVersion } from "@/lib/services/company-export";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface BeancountExportResult {
  fileName: string;
  text: string;
  entryCount: number;
}

/**
 * The whole ledger as a Beancount file.
 *
 * Follows the company ZIP export (`app/(app)/settings/company/actions.ts`): the
 * same permission, the same audit record, and the same rule that an export the
 * audit log did not record is not handed over (US-FR-013). The audit row is the
 * only write; nothing here touches the books.
 */
export async function beancountExportAction(): Promise<ActionResult<BeancountExportResult>> {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." };

  const { data: allowed, error: permissionError } = await sb.rpc("acc_has_permission", {
    p_key: "company.export",
  });
  if (permissionError || allowed !== true) {
    return { ok: false, error: "You do not have permission to export company data" };
  }

  try {
    const generatedAt = new Date().toISOString();
    const [input, schemaVersion] = await Promise.all([readBeancountInput(sb, generatedAt), readSchemaVersion(sb)]);
    const text = buildBeancountFile(input);
    const lineCount = input.entries.reduce((n, e) => n + e.lines.length, 0);

    // The audit RPC takes a fixed set of keys; each is filled truthfully. It has
    // no field for the format, so this row looks like a ZIP export's and is told
    // apart by the hash — a limitation the design records and accepts.
    const { error: auditError } = await sb.rpc("acc_log_company_export", {
      p_summary: {
        generated_at: generatedAt,
        schema_version: schemaVersion,
        manifest_sha256: createHash("sha256").update(text, "utf8").digest("hex"),
        table_count: BEANCOUNT_SOURCES.length,
        total_rows: input.entries.length + lineCount,
        included_sensitive: false,
      },
    });
    if (auditError) return { ok: false, error: `The export was not recorded: ${auditError.message}` };

    return {
      ok: true,
      data: { fileName: beancountFileName(input.company.legalName), text, entryCount: input.entries.length },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An unexpected error occurred" };
  }
}
```

- [ ] **Step 2: Write the page**

Create `app/(app)/reports/beancount/page.tsx`:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import { readBeancountSummary, type BeancountSummary } from "@/lib/services/beancount";
import BeancountClient from "./BeancountClient";

export const dynamic = "force-dynamic";

export default async function BeancountPage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();

  let summary: BeancountSummary | null = null;
  let summaryError: string | null = null;
  try {
    summary = await readBeancountSummary(sb);
  } catch (e) {
    summaryError = e instanceof Error ? e.message : "The book could not be summarised.";
  }
  const permission = await sb.rpc("acc_has_permission", { p_key: "company.export" });
  const canExport = permission.error === null && permission.data === true;

  return (
    <div>
      <PageHeader
        meta={
          <ReportEntityBadge
            companyName={entity.active?.dbaName || entity.active?.legalName || "No company selected"}
            isSample={entity.active?.isSample ?? false}
          />
        }
        title="Beancount Export"
        description="The whole ledger as a Beancount v3 file, for bean-check and Fava. Nothing here changes a figure."
      />
      <BeancountClient summary={summary} summaryError={summaryError} canExport={canExport} />
    </div>
  );
}
```

- [ ] **Step 3: Write the client**

Create `app/(app)/reports/beancount/BeancountClient.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Alert, App, Button, Card, Space, Statistic, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { downloadTextFile } from "@/lib/client/download";
import type { BeancountSummary } from "@/lib/services/beancount";
import { beancountExportAction } from "./actions";

/**
 * One button and what to do with the file afterwards. The file itself is not
 * shown: a book of several thousand entries is too heavy to render.
 */
export default function BeancountClient({
  summary,
  summaryError,
  canExport,
}: {
  summary: BeancountSummary | null;
  summaryError: string | null;
  canExport: boolean;
}) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    const result = await beancountExportAction();
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "The file could not be produced.");
      return;
    }
    downloadTextFile(result.data.fileName, result.data.text, "text/plain;charset=utf-8");
    message.success(`${result.data.fileName} saved, ${result.data.entryCount} entries.`);
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {summaryError ? <Alert type="error" showIcon message={summaryError} /> : null}

      {summary ? (
        <Space size="large" wrap>
          <Statistic title="Posted entries" value={summary.entryCount} />
          <Statistic title="Accounts" value={summary.accountCount} />
          <Statistic title="First entry" value={summary.firstDate ?? "—"} />
          <Statistic title="Last entry" value={summary.lastDate ?? "—"} />
          <Statistic title="Currencies" value={summary.currencies.join(", ") || "—"} />
        </Space>
      ) : null}

      {!canExport ? (
        <Alert
          type="info"
          showIcon
          message="Exporting the ledger needs the Export company data permission."
          description="This file is the whole book, so it is held to the same permission as exporting the company."
        />
      ) : null}

      <div>
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => void download()} loading={busy} disabled={!canExport}>
          Download .beancount file
        </Button>
      </div>

      {error ? <Alert type="error" showIcon message={error} /> : null}

      <Card title="Running it">
        <Typography.Paragraph>
          Install once with <Typography.Text code>pip install beancount fava</Typography.Text>. Then{" "}
          <Typography.Text code>bean-check &lt;file&gt;</Typography.Text> proves the books balance, and{" "}
          <Typography.Text code>fava &lt;file&gt;</Typography.Text> opens them at{" "}
          <Typography.Text code>localhost:5000</Typography.Text>.
        </Typography.Paragraph>
        <Typography.Paragraph>
          <strong>Documents survive the export.</strong> Invoices and bills carry a tag and a link; the payment that
          settles one carries the same link, so Fava groups them. Due dates travel as{" "}
          <Typography.Text code>due:</Typography.Text> metadata, and every transaction carries its OneBook entry number
          as <Typography.Text code>entry:</Typography.Text>.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Amounts are in each entry&apos;s own currency, which is the currency OneBook requires it to balance in.
          Price directives let Fava convert them to the base currency.
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
```

- [ ] **Step 4: Add the catalogue entry**

In `lib/domain/report-catalog.ts`, add this object to `REPORT_CATALOG` directly after the `exception-report` entry:

```ts
  {
    id: "beancount-export",
    title: "Beancount Export",
    description: "Download the whole ledger as a Beancount v3 file for bean-check and Fava.",
    href: "/reports/beancount",
    group: "accounting",
  },
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean; no lint errors in the new files.

Run: `npx vitest run`
Expected: whole suite passes, including `tests/unit/rsc-antd.test.ts`, `tests/unit/report-catalog.test.ts`, `tests/unit/navigation.test.ts` and `tests/unit/customer-data.test.ts`. Print the full summary line; do not trim it.

- [ ] **Step 6: Commit**

```bash
git add "ctyhp-accounting/app/(app)/reports/beancount/actions.ts" "ctyhp-accounting/app/(app)/reports/beancount/page.tsx" "ctyhp-accounting/app/(app)/reports/beancount/BeancountClient.tsx" ctyhp-accounting/lib/domain/report-catalog.ts
git commit -m "feat(beancount): a page that hands over the ledger, recorded, to those allowed it"
```

---

### Task 6: Gates, changelog, and the file checked by beancount itself

**Files:**
- Modify: `lib/domain/changelog.ts`

- [ ] **Step 1: Changelog**

Add a new release at the top of `RELEASES` in `lib/domain/changelog.ts`. The current top is `1.62`:

```ts
  {
    version: "1.63",
    date: "2026-09-26",
    headline: "The whole ledger as a Beancount file.",
    changes: [
      {
        kind: "added",
        title: "Beancount Export",
        detail:
          "Download every posted entry as a Beancount v3 file, ready for bean-check and Fava. Invoices and the payments that settle them share a link, so they stay grouped, and each transaction keeps its OneBook entry number. Amounts are in each entry's own currency. Downloading needs the Export company data permission and is recorded in the audit log.",
        route: "/reports/beancount",
      },
    ],
  },
```

Run: `npx vitest run tests/unit/changelog.test.ts`
Expected: PASS.

Commit:

```bash
git add ctyhp-accounting/lib/domain/changelog.ts
git commit -m "chore(changelog): 1.63, the Beancount export"
```

- [ ] **Step 2: Full suite**

Run: `npx vitest run`. Print the whole summary line.

- [ ] **Step 3: Build, start detached, smoke**

Run: `npm run build`. Then start the server detached from PowerShell — from a Bash tool it dies and every request reads `fetch failed`, which is not a regression. Plain `npm` produces no process here; use `npm.cmd`:

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory "C:\Users\pit010\QUICKBOOK_WEBAPP\ctyhp-accounting" -WindowStyle Hidden
```

Poll `http://localhost:3000` (or 3001) until it answers, then:

`node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000 --only=reports/beancount` — expect 200, no error boundary.
`node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000` — expect every route 200.

Bound every wait. If anything stalls for minutes, stop it and report rather than waiting.

- [ ] **Step 4: Acceptance on real books — never committed**

This proves the file is right, which no unit test can. **The file it produces is real customer data. It must live only in the session scratchpad** (`C:\Users\pit010\AppData\Local\Temp\claude\c--Users-pit010-QUICKBOOK-WEBAPP\4f1c3eb7-b3c4-4b1c-9fbf-52a1303a119d\scratchpad`), never under the repository.

1. Install beancount into a virtual environment in the scratchpad — not into the repository and not globally:
   ```bash
   python -m venv "<scratchpad>/bean-venv"
   "<scratchpad>/bean-venv/Scripts/python" -m pip install beancount
   ```
2. Sign in as the smoke user and download the file for the Pacific Four Nine company through the page's action, saving it into the scratchpad. `scripts/smoke-environment.mjs` shows how to authenticate; a small throwaway script in the scratchpad may call the action's underlying functions with a signed-in client.
3. Run `"<scratchpad>/bean-venv/Scripts/bean-check" "<scratchpad>/pacific.beancount"`. **Expected: no output, exit 0.**
4. Compare balances: use beancount's Python API from the venv to compute each account's balance per currency, and compare every base-currency account against OneBook's trial balance for the same account (`acc_ledger_balances(null, today)`). They must agree exactly. Report the number of accounts compared and any difference.
5. Delete nothing in the repository; leave the scratchpad files where they are. Confirm with `git status` that nothing new under the repository is staged or untracked because of this step.

If `bean-check` reports an error, **do not change the test fixtures to hide it**. Report the error line verbatim; it is a real defect in the generator.

- [ ] **Step 5: Report**

State plainly: the test count, whether smoke passed, `bean-check`'s result, and how many accounts matched the trial balance. Name anything that did not pass.

---

## Notes for whoever executes this

- The design is `docs/superpowers/specs/2026-09-26-beancount-export-design.md`. Where this plan and the design disagree, the design wins — raise the disagreement.
- `Accounting-System-v3.html` at the repository root holds real customer ledgers. Never commit it, never copy data from it into tests.
- The Exception Report's lessons apply here and are already built in: join payments to entries by `journal_entry_id`, never by document number; page every read, RPCs included; and never let a failed read produce a partial result silently. Here a failed read fails the export.
