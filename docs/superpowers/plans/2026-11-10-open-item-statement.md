# Open-item customer statement (3.0.13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A printable open-item statement for one customer at `/customers/[id]/statement?asOf=YYYY-MM-DD`, with Print, Download PDF and Email, reachable from the customer page and from A/R Aging.

**Architecture:**
- The items are the `acc_ar_ageing` RPC's rows for one customer. A/R Aging reads the same RPC, so a statement totals what that customer's A/R Aging row does. Unused credit memos and unapplied payments come back as negative rows and reduce the total; the user chose this on 10/11.
- One pure module, `lib/domain/open-item-statement.ts`, builds every string the screen, the PDF and the email show, so the three cannot disagree.
- The PDF goes through the invoice renderer, which gains an optional table of its own and a footnote.

**Tech Stack:** Next.js App Router (server page + client component), Ant Design 6, Supabase/PostgREST, jsPDF + jspdf-autotable, Vitest (node environment).

**Spec:** section "3.0.13" of `docs/superpowers/specs/2026-11-10-customer-detail-page-design.md`.

## Global Constraints

- All UI text is US English. Money is USD in the base currency. Dates on screen use `formatDate` (`11/10/2026`); long dates read `November 10, 2026`.
- Inline colours go through `tokenVar()`. CSS modules use `--ob-*` custom properties only, the ones `components/reports/report-paper.module.css` and `app/(app)/customers/[id]/*.module.css` already use: `--ob-surface-card`, `--ob-border-default`, `--ob-text-secondary`, `--ob-money-negative`.
- Never use a raw antd `<Table`. Use `DataTable` or `ReportTable`. The printed sheet is a plain HTML `<table>`, as `components/reports/StatementTable.tsx` is.
- Tests run in Vitest's node environment from `ctyhp-accounting/`: `npx vitest run <files>`. Contract tests read source with `readFileSync` and normalise CRLF (`.replace(/\r\n/g, "\n")`) before matching.
- Commits:
  - No `Co-Authored-By` or other attribution lines; this repository's rule.
  - Stage files by name; never `git add -A` or `git add .`.
  - Never stage `.superpowers/`, `data/`, or anything from a real company's ledger.
- The statement shows no Customer row data that the customer page does not already show, and needs no migration.
- Wording that must be used verbatim is in the code below. Copy it exactly.

## Decisions (settled; do not reopen)

1. **Source:** `acc_ar_ageing(p_as_of)` filtered by `customer_id`. Its balances are the **current** open amounts converted to base currency, and `p_as_of` only limits documents to those dated on or before it and sets the ageing day. The footnote says so whenever `asOf` is not the company's today.
2. **Negative lines:** credit memos and payments with money left over are listed with negative Amount and Outstanding, and Total due is the sum of every line. A negative sum reads **Credit balance** with the absolute amount, and the pay note is left out.
3. **Ageing:** buckets use `computeAging`, the function A/R Aging uses. A credit or payment is aged from its own date, as A/R Aging does. All five buckets are always shown.
4. **Due:** "—" for credits and payments. "Overdue" (email and count) means an invoice past its due date, never a payment.
5. **Entry point on the customer page:** a **Statement** button for everyone who can open the page. This departs from the spec, which puts Statement inside the ⋯ menu: the ⋯ menu is shown only to writers, and readers need the statement too. Note it in the PR.
6. **A/R Aging:** a small Statement link beside each customer's name in the "By customer" view, and under each customer's name in the Summary grid's column heading. There is no new column, so `AGING_PARTY_FIXED_WIDTHS` is unchanged. A/P Aging gets no link.

## File structure

| File | Responsibility |
|---|---|
| `ctyhp-accounting/lib/format.ts` (modify) | `formatLongDate` |
| `ctyhp-accounting/lib/domain/aging.ts` (modify) | export `daysPastDue` |
| `ctyhp-accounting/lib/domain/invoice-document.ts` (modify) | `DocumentTable` type |
| `ctyhp-accounting/lib/domain/open-item-statement.ts` (create) | the statement model, email, PDF document, file name, `asOf` parsing |
| `ctyhp-accounting/lib/services/open-item-statement.ts` (create) | reads the customer, their RPC rows and their documents' details |
| `ctyhp-accounting/lib/client/invoice-pdf.ts` (modify) | optional `table` and `footnote`; `downloadOpenItemStatementPdf` |
| `ctyhp-accounting/components/statements/OpenItemStatementSheet.tsx` + `open-item-statement.module.css` (create) | the A4 sheet on screen and on paper |
| `ctyhp-accounting/app/(app)/customers/[id]/statement/page.tsx`, `OpenItemStatementClient.tsx`, `loading.tsx` (create) | the route, its toolbar and its loading state |
| `ctyhp-accounting/app/(app)/customers/[id]/CustomerDetailClient.tsx` (modify) | Statement button |
| `ctyhp-accounting/components/reports/AgingByPartyTable.tsx` + `aging-party.module.css` (modify/create) | optional `statementHref` |
| `ctyhp-accounting/app/(app)/reports/ar-aging/ArAgingClient.tsx` (modify) | passes `statementHref` |
| `ctyhp-accounting/app/(app)/reports/customer-statement/page.tsx`, `CustomerStatementClient.tsx` (modify) | `?customer=` |
| `ctyhp-accounting/lib/domain/changelog.ts` (modify) | 3.0.13 entry |

---

### Task 1: The statement model

**Files:**
- Modify: `ctyhp-accounting/lib/format.ts` (after `formatDate`, ~line 90)
- Modify: `ctyhp-accounting/lib/domain/aging.ts:20` (`function daysPastDue` → `export function daysPastDue`)
- Modify: `ctyhp-accounting/lib/domain/invoice-document.ts` (add `DocumentTable` after `DocumentTotal`, ~line 96)
- Create: `ctyhp-accounting/lib/domain/open-item-statement.ts`
- Test: `ctyhp-accounting/tests/unit/open-item-statement.test.ts`

**Interfaces:**
- Consumes:
  - `computeAging`, `AGING_BUCKETS` from `lib/domain/aging`;
  - `documentSeller`, `documentBillTo` and the types `DocumentCompany`, `DocumentCustomer`, `DocumentSeller`, `DocumentBillTo`, `PrintedDocument` from `lib/domain/invoice-document`;
  - `statementDocType`, `statementPayNote` from `lib/domain/party-statement`;
  - `formatDate`, `formatMoney` from `lib/format`.
- Produces (used by Tasks 2–5):
  - `formatLongDate(value: string): string`
  - `daysPastDue(dueDate: string, asOf: string): number`
  - `interface DocumentTable { head: string[]; body: string[][]; rightAligned: number[] }`
  - `OpenItemSource`, `OpenItemDetail`, `OpenItemStatement`, `OpenItemStatementLine`, `StatementPrintedDocument`
  - `parseStatementAsOf(value: string | string[] | undefined, today: string): string`
  - `buildOpenItemStatement(input: OpenItemStatementInput): OpenItemStatement`
  - `openItemStatementEmail(s: OpenItemStatement): { to: string; subject: string; body: string; href: string }`
  - `openItemStatementDocument(s: OpenItemStatement): StatementPrintedDocument`
  - `openItemStatementFileName(s: OpenItemStatement): string`

- [ ] **Step 1: Write the failing test** — `tests/unit/open-item-statement.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { formatLongDate } from "@/lib/format";
import { daysPastDue } from "@/lib/domain/aging";
import {
  buildOpenItemStatement,
  openItemAmountMinor,
  openItemDescription,
  openItemStatementDocument,
  openItemStatementEmail,
  openItemStatementFileName,
  parseStatementAsOf,
  type OpenItemSource,
  type OpenItemStatementInput,
} from "@/lib/domain/open-item-statement";

const company = {
  legal_name: "Meridian Goods LLC",
  dba_name: null,
  address_line1: "100 Market Street",
  address_line2: null,
  city: "San Francisco",
  region: "CA",
  postal_code: "94105",
  country: "United States",
  phone: "+1 415 555 0100",
  email: "ar@meridian.example",
  pay_note: "Pay by ACH to account 000123456, routing 121000248.",
};
const customer = {
  name: "BlueRidge Foods",
  email: "billing@blueridge.example",
  contact_name: "Dana Lee",
  phone: "+1 828 555 0199",
  address_line1: "12 Mill Road",
  address_line2: null,
  city: "Asheville",
  region: "NC",
  postal_code: "28801",
  country: "United States",
};

const overdueInvoice: OpenItemSource = {
  docType: "invoice",
  docNumber: "INV-000004",
  docDate: "2026-03-24",
  dueDate: "2026-04-23",
  outstandingMinor: 1_000_000,
  detail: { totalMinor: 2_680_000, openMinor: 1_000_000, currencyCode: "USD", note: "Wholesale order, spring collection" },
};
const unappliedPayment: OpenItemSource = {
  docType: "payment",
  docNumber: "PMT-000009",
  docDate: "2026-10-01",
  dueDate: "2026-10-01",
  outstandingMinor: -120_000,
  detail: { totalMinor: 500_000, openMinor: 120_000, currencyCode: "USD", note: "RCV-1010" },
};
const currentInvoice: OpenItemSource = {
  docType: "invoice",
  docNumber: "INV-000011",
  docDate: "2026-11-01",
  dueDate: "2026-12-01",
  outstandingMinor: 250_000,
  detail: { totalMinor: 250_000, openMinor: 250_000, currencyCode: "USD", note: null },
};

const input = (over: Partial<OpenItemStatementInput> = {}): OpenItemStatementInput => ({
  asOf: "2026-11-10",
  today: "2026-11-10",
  company,
  customer,
  // Out of order on purpose: the statement sorts by date.
  items: [currentInvoice, overdueInvoice, unappliedPayment],
  currencyCode: "USD",
  decimals: 2,
  ...over,
});

describe("formatLongDate", () => {
  it("writes the month out", () => {
    expect(formatLongDate("2026-11-10")).toBe("November 10, 2026");
    expect(formatLongDate("2026-01-05")).toBe("January 5, 2026");
  });
  it("returns anything else as it was", () => {
    expect(formatLongDate("soon")).toBe("soon");
  });
});

describe("daysPastDue", () => {
  it("counts calendar days from the due date", () => {
    expect(daysPastDue("2026-04-23", "2026-11-10")).toBe(201);
    expect(daysPastDue("2026-12-01", "2026-11-10")).toBe(-21);
  });
});

describe("parseStatementAsOf", () => {
  it("keeps a real date", () => {
    expect(parseStatementAsOf("2026-10-31", "2026-11-10")).toBe("2026-10-31");
  });
  it("falls back to today for anything else", () => {
    expect(parseStatementAsOf(undefined, "2026-11-10")).toBe("2026-11-10");
    expect(parseStatementAsOf("2026-02-30", "2026-11-10")).toBe("2026-11-10");
    expect(parseStatementAsOf("yesterday", "2026-11-10")).toBe("2026-11-10");
    expect(parseStatementAsOf(["2026-10-31", "2026-10-30"], "2026-11-10")).toBe("2026-11-10");
  });
});

describe("openItemDescription", () => {
  it("names each kind of line", () => {
    expect(openItemDescription("invoice", "Wholesale order")).toBe("Wholesale order");
    expect(openItemDescription("invoice", null)).toBe("Invoice");
    expect(openItemDescription("credit_memo", "Damaged stock")).toBe("Credit memo: Damaged stock");
    expect(openItemDescription("credit_memo", "  ")).toBe("Credit memo");
    expect(openItemDescription("payment", "RCV-1010")).toBe("Payment received, ref RCV-1010");
    expect(openItemDescription("payment", null)).toBe("Payment received");
  });
  it("cuts a long description to 44 characters", () => {
    const text = openItemDescription("invoice", "Custom engagement ring set with matching   wedding bands and engraving");
    expect(text).toHaveLength(44);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toContain("  ");
  });
});

describe("openItemAmountMinor", () => {
  it("is the document's total, signed as its outstanding", () => {
    expect(openItemAmountMinor(overdueInvoice, "USD")).toBe(2_680_000);
    expect(openItemAmountMinor(unappliedPayment, "USD")).toBe(-500_000);
  });
  it("converts a foreign document at the rate its outstanding was converted", () => {
    const euro: OpenItemSource = {
      ...overdueInvoice,
      outstandingMinor: 540_000,
      detail: { totalMinor: 1_000_000, openMinor: 500_000, currencyCode: "EUR", note: null },
    };
    expect(openItemAmountMinor(euro, "USD")).toBe(1_080_000);
  });
  it("falls back to the outstanding when the document was not found", () => {
    expect(openItemAmountMinor({ ...overdueInvoice, detail: null }, "USD")).toBe(1_000_000);
  });
});

describe("buildOpenItemStatement", () => {
  const s = buildOpenItemStatement(input());

  it("lists the lines by date with their ages", () => {
    expect(s.lines.map((l) => l.docNumber)).toEqual(["INV-000004", "PMT-000009", "INV-000011"]);
    expect(s.lines[0]).toMatchObject({
      date: "03/24/2026",
      description: "Wholesale order, spring collection",
      due: "04/23/2026",
      age: "201 days",
      amount: "$26,800.00",
      outstanding: "$10,000.00",
      overdue: true,
    });
    expect(s.lines[1]).toMatchObject({ due: "—", age: "40 days", amount: "-$5,000.00", outstanding: "-$1,200.00", overdue: false });
    expect(s.lines[2]).toMatchObject({ description: "Invoice", due: "12/01/2026", age: "current", overdue: false });
  });

  it("ages the buckets as A/R Aging does and nets the total", () => {
    expect(s.buckets.map((b) => [b.label, b.amount])).toEqual([
      ["Current", "$2,500.00"],
      ["1–30 days", "$0.00"],
      ["31–60 days", "-$1,200.00"],
      ["61–90 days", "$0.00"],
      ["Over 90 days", "$10,000.00"],
    ]);
    expect(s.totalMinor).toBe(1_130_000);
    expect(s.totalLabel).toBe("Total due");
    expect(s.totalAmount).toBe("$11,300.00");
    expect(s.overdueCount).toBe(1);
  });

  it("carries the header, the party and the pay note", () => {
    expect(s.asOfText).toBe("11/10/2026");
    expect(s.asOfLong).toBe("November 10, 2026");
    expect(s.companyName).toBe("Meridian Goods LLC");
    expect(s.party.name).toBe("BlueRidge Foods");
    expect(s.party.lines).toContain("billing@blueridge.example");
    expect(s.payNote).toBe(company.pay_note);
    expect(s.emptyText).toBeNull();
  });

  it("says the figures are as at today, and why some are negative", () => {
    expect(s.footnote).toBe(
      "Every figure is as at November 10, 2026. Anything paid after that date is not reflected here. " +
        "Payments not yet applied and unused credits are shown as negative amounts and reduce the total.",
    );
  });

  it("says plainly that a past date only limits and ages the documents", () => {
    const past = buildOpenItemStatement(input({ asOf: "2026-10-31", items: [overdueInvoice] }));
    expect(past.footnote).toBe(
      "Lists what was dated on or before October 31, 2026, aged to that date. " +
        "Amounts outstanding are as they stand on November 10, 2026.",
    );
  });

  it("reads Credit balance when credits exceed what is owed, and asks for nothing", () => {
    const credit = buildOpenItemStatement(input({ items: [unappliedPayment] }));
    expect(credit.totalLabel).toBe("Credit balance");
    expect(credit.totalAmount).toBe("$1,200.00");
    expect(credit.payNote).toBeNull();
  });

  it("says nothing is outstanding when there are no items", () => {
    const empty = buildOpenItemStatement(input({ items: [] }));
    expect(empty.lines).toEqual([]);
    expect(empty.emptyText).toBe("Nothing outstanding as of November 10, 2026.");
    expect(empty.totalAmount).toBe("$0.00");
    expect(empty.payNote).toBeNull();
  });
});

describe("openItemStatementEmail", () => {
  it("addresses the customer with the prototype's wording", () => {
    const mail = openItemStatementEmail(buildOpenItemStatement(input()));
    expect(mail.to).toBe("billing@blueridge.example");
    expect(mail.subject).toBe("Statement from Meridian Goods LLC as of 11/10/2026");
    expect(mail.body.split("\r\n")).toEqual([
      "Dear BlueRidge Foods,",
      "",
      "A statement of your account with Meridian Goods LLC as at November 10, 2026.",
      "",
      "  03/24/2026   INV-000004   $10,000.00   due 04/23/2026   201 days overdue",
      "  10/01/2026   PMT-000009   -$1,200.00",
      "  11/01/2026   INV-000011   $2,500.00   due 12/01/2026",
      "",
      "Total due: $11,300.00 USD",
      "",
      "1 of these is past the due date.",
      "",
      company.pay_note,
      "",
      "If any line does not match your own records, tell me which one and I will look into it.",
      "",
      "Meridian Goods LLC",
    ]);
    expect(mail.href.startsWith("mailto:billing@blueridge.example?subject=Statement%20from%20Meridian")).toBe(true);
    expect(mail.href).toContain("%0D%0A");
  });

  it("lists at most 15 documents", () => {
    const many = Array.from({ length: 17 }, (_, i) => ({
      ...currentInvoice,
      docNumber: `INV-1${String(i).padStart(5, "0")}`,
    }));
    const body = openItemStatementEmail(buildOpenItemStatement(input({ items: many }))).body;
    expect(body.split("\r\n").filter((line) => line.startsWith("  11/01/2026"))).toHaveLength(15);
    expect(body).toContain("  …and 2 more, listed in the attached statement.");
  });

  it("opens without a recipient when the customer has no email", () => {
    const mail = openItemStatementEmail(buildOpenItemStatement(input({ customer: { ...customer, email: null } })));
    expect(mail.to).toBe("");
    expect(mail.href.startsWith("mailto:?subject=")).toBe(true);
  });

  it("says nothing is outstanding instead of listing", () => {
    const body = openItemStatementEmail(buildOpenItemStatement(input({ items: [] }))).body;
    expect(body).toContain("Nothing is outstanding on your account as at November 10, 2026.");
    expect(body).not.toContain("Total due");
  });
});

describe("openItemStatementDocument", () => {
  it("is what the PDF draws", () => {
    const doc = openItemStatementDocument(buildOpenItemStatement(input()));
    expect(doc.title).toBe("Statement");
    expect(doc.partyHeading).toBe("STATEMENT FOR");
    expect(doc.meta).toEqual([
      { label: "As of", value: "11/10/2026" },
      { label: "Open items", value: "3" },
    ]);
    expect(doc.table.head).toEqual(["Date", "Description", "Due", "Age", "Amount", "Outstanding"]);
    expect(doc.table.rightAligned).toEqual([2, 3, 4, 5]);
    expect(doc.table.body[0]).toEqual([
      "03/24/2026\nINV-000004",
      "Wholesale order, spring collection",
      "04/23/2026",
      "201 days",
      "$26,800.00",
      "$10,000.00",
    ]);
    expect(doc.totals.map((t) => t.label)).toEqual([
      "Current",
      "1–30 days",
      "31–60 days",
      "61–90 days",
      "Over 90 days",
      "Total due",
    ]);
    expect(doc.memo).toBeNull();
    expect(doc.lines).toEqual([]);
  });

  it("prints only the empty sentence when nothing is open", () => {
    const doc = openItemStatementDocument(buildOpenItemStatement(input({ items: [] })));
    expect(doc.table.body).toEqual([]);
    expect(doc.totals).toEqual([]);
    expect(doc.memo).toBe("Nothing outstanding as of November 10, 2026.");
  });
});

describe("openItemStatementFileName", () => {
  it("names the customer and the day", () => {
    expect(openItemStatementFileName(buildOpenItemStatement(input()))).toBe("statement-blueridge-foods-2026-11-10.pdf");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/open-item-statement.test.ts`
Expected: FAIL (`formatLongDate` and `@/lib/domain/open-item-statement` do not exist).

- [ ] **Step 3: Add `formatLongDate`** to `lib/format.ts`, after `formatDate`; it reuses that file's `ISO_DATE`:

```ts
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * `2026-11-10` as `November 10, 2026`, for sentences a customer reads (the
 * open-item statement, 3.0.13). Like {@link formatDate} it works on the string
 * alone, so no time zone can move the day; anything else comes back as it was.
 */
export function formatLongDate(value: string): string {
  const match = ISO_DATE.exec(value);
  if (!match) return value;
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}
```

- [ ] **Step 4: Export `daysPastDue`** in `lib/domain/aging.ts`: change `function daysPastDue(` to `export function daysPastDue(`. Nothing else changes.

- [ ] **Step 5: Add `DocumentTable`** to `lib/domain/invoice-document.ts`, directly after `interface DocumentTotal`:

```ts
/**
 * Columns of a document's own, for one whose lines are not an invoice's
 * Description · Qty · Unit price · Amount (the open-item statement, 3.0.13).
 */
export interface DocumentTable {
  head: string[];
  body: string[][];
  /** The columns set right, as amounts are, by index. */
  rightAligned: number[];
}
```

- [ ] **Step 6: Write `lib/domain/open-item-statement.ts`**

```ts
/**
 * The open-item statement (3.0.13): what one customer still owes on a day,
 * line by line and aged, as the prototype lays it out (statementHTML and
 * statementEmail in Accounting System-v4.html).
 *
 * Every string the page, the PDF and the email show is built here, so the
 * three cannot disagree. The items are acc_ar_ageing's, the rows A/R Aging
 * reads, so a customer's statement totals what their A/R Aging row does. A
 * credit memo or a payment with money left over is a negative line and comes
 * off the total.
 */
import { AGING_BUCKETS, computeAging, daysPastDue } from "./aging";
import {
  documentBillTo,
  documentSeller,
  type DocumentBillTo,
  type DocumentCompany,
  type DocumentCustomer,
  type DocumentSeller,
  type DocumentTable,
  type PrintedDocument,
} from "./invoice-document";
import { statementDocType, statementPayNote } from "./party-statement";
import { formatDate, formatLongDate, formatMoney } from "@/lib/format";

/** The prototype cuts a description at 44 characters. */
export const STATEMENT_DESCRIPTION_MAX = 44;
/** Lines listed in the email; a longer list keeps the mailto link short enough for every mail program. */
export const STATEMENT_EMAIL_MAX_LINES = 15;

const BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "Over 90 days",
};

export const STATEMENT_TABLE_HEAD = ["Date", "Description", "Due", "Age", "Amount", "Outstanding"];

/** A document's own figures, in its own currency. */
export interface OpenItemDetail {
  /** Its total, positive. */
  totalMinor: number;
  /** What is still open of it, positive. */
  openMinor: number;
  currencyCode: string;
  /** An invoice's memo, a credit memo's memo or reason, a payment's reference. */
  note: string | null;
}

/** One acc_ar_ageing row for the customer, with its document's figures when they were found. */
export interface OpenItemSource {
  docType: string;
  docNumber: string | null;
  docDate: string;
  /** A credit memo's or a payment's own date. */
  dueDate: string;
  /** Base currency; negative for a credit memo or a payment. */
  outstandingMinor: number;
  detail: OpenItemDetail | null;
}

export interface OpenItemStatementInput {
  asOf: string;
  /** The company's today, which says whether the figures are as at `asOf`. */
  today: string;
  company: DocumentCompany;
  customer: DocumentCustomer;
  items: OpenItemSource[];
  currencyCode: string;
  decimals: number;
}

export interface OpenItemStatementLine {
  key: string;
  docType: string;
  date: string;
  docNumber: string;
  description: string;
  due: string;
  age: string;
  ageDays: number;
  amount: string;
  outstanding: string;
  outstandingMinor: number;
  /** An invoice past its due date; never a payment or a credit. */
  overdue: boolean;
}

export interface OpenItemStatementBucket {
  key: string;
  label: string;
  amount: string;
  amountMinor: number;
}

export interface OpenItemStatement {
  asOf: string;
  asOfText: string;
  asOfLong: string;
  seller: DocumentSeller;
  party: DocumentBillTo;
  companyName: string;
  customerName: string;
  customerEmail: string | null;
  currencyCode: string;
  lines: OpenItemStatementLine[];
  buckets: OpenItemStatementBucket[];
  totalMinor: number;
  totalLabel: "Total due" | "Credit balance";
  /** Never negative: a credit balance is said in its label. */
  totalAmount: string;
  overdueCount: number;
  payNote: string | null;
  emptyText: string | null;
  footnote: string;
}

export type StatementPrintedDocument = PrintedDocument & {
  partyHeading: string;
  table: DocumentTable;
  footnote: string;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The statement's day from `?asOf=`: a real calendar date, or the company's today. */
export function parseStatementAsOf(value: string | string[] | undefined, today: string): string {
  if (typeof value !== "string") return today;
  const match = ISO.exec(value);
  if (!match) return today;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? value : today;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > STATEMENT_DESCRIPTION_MAX ? `${flat.slice(0, STATEMENT_DESCRIPTION_MAX - 1)}…` : flat;
}

/** What a line is, in the customer's terms. */
export function openItemDescription(docType: string, note: string | null | undefined): string {
  const text = note?.trim() || null;
  switch (docType) {
    case "invoice":
      return shorten(text ?? "Invoice");
    case "credit_memo":
      return shorten(text ? `Credit memo: ${text}` : "Credit memo");
    case "payment":
      return shorten(text ? `Payment received, ref ${text}` : "Payment received");
    default:
      return shorten(statementDocType(docType));
  }
}

/**
 * The document's amount in base currency, signed as its outstanding is. A
 * foreign document is converted at the rate its outstanding was, so the two
 * columns agree.
 */
export function openItemAmountMinor(item: OpenItemSource, baseCurrency: string): number {
  const detail = item.detail;
  if (!detail || detail.openMinor <= 0) return item.outstandingMinor;
  const sign = item.outstandingMinor < 0 ? -1 : 1;
  if (detail.currencyCode === baseCurrency) return sign * detail.totalMinor;
  return sign * Math.round((detail.totalMinor * Math.abs(item.outstandingMinor)) / detail.openMinor);
}

function ageText(days: number): string {
  if (days <= 0) return "current";
  return days === 1 ? "1 day" : `${days} days`;
}

export function buildOpenItemStatement(input: OpenItemStatementInput): OpenItemStatement {
  const { asOf, today, company, customer, currencyCode, decimals } = input;
  const money = (minor: number) => formatMoney(minor, currencyCode, decimals);
  const items = [...input.items].sort((a, b) =>
    a.docDate === b.docDate ? (a.docNumber ?? "").localeCompare(b.docNumber ?? "") : a.docDate < b.docDate ? -1 : 1,
  );
  const lines: OpenItemStatementLine[] = items.map((item, index) => {
    const ageDays = Math.max(0, daysPastDue(item.dueDate, asOf));
    const isInvoice = item.docType === "invoice";
    return {
      key: `${item.docType}:${item.docNumber ?? `#${index}`}`,
      docType: item.docType,
      date: formatDate(item.docDate),
      docNumber: item.docNumber ?? "—",
      description: openItemDescription(item.docType, item.detail?.note),
      due: isInvoice ? formatDate(item.dueDate) : "—",
      age: ageText(ageDays),
      ageDays,
      amount: money(openItemAmountMinor(item, currencyCode)),
      outstanding: money(item.outstandingMinor),
      outstandingMinor: item.outstandingMinor,
      overdue: isInvoice && ageDays > 0,
    };
  });
  const { buckets, total } = computeAging(
    items.map((item) => ({ dueDate: item.dueDate, balanceMinor: item.outstandingMinor })),
    asOf,
  );
  const seller = documentSeller(company);
  const asOfLong = formatLongDate(asOf);
  const footnote = [
    asOf === today
      ? `Every figure is as at ${asOfLong}. Anything paid after that date is not reflected here.`
      : `Lists what was dated on or before ${asOfLong}, aged to that date. Amounts outstanding are as they stand on ${formatLongDate(today)}.`,
    lines.some((line) => line.outstandingMinor < 0)
      ? "Payments not yet applied and unused credits are shown as negative amounts and reduce the total."
      : null,
  ]
    .filter((sentence): sentence is string => sentence !== null)
    .join(" ");

  return {
    asOf,
    asOfText: formatDate(asOf),
    asOfLong,
    seller,
    party: documentBillTo(customer),
    companyName: seller.displayName,
    customerName: customer.name,
    customerEmail: customer.email?.trim() || null,
    currencyCode,
    lines,
    buckets: AGING_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: BUCKET_LABELS[bucket.key],
      amountMinor: buckets[bucket.key] ?? 0,
      amount: money(buckets[bucket.key] ?? 0),
    })),
    totalMinor: total,
    totalLabel: total < 0 ? "Credit balance" : "Total due",
    totalAmount: money(Math.abs(total)),
    overdueCount: lines.filter((line) => line.overdue).length,
    payNote: statementPayNote("customer", total, company.pay_note),
    emptyText: lines.length === 0 ? `Nothing outstanding as of ${asOfLong}.` : null,
    footnote,
  };
}

/**
 * The Email button's message: the prototype's wording, for the user's own mail
 * program. The app sends no mail; the user attaches the PDF.
 */
export function openItemStatementEmail(s: OpenItemStatement): {
  to: string;
  subject: string;
  body: string;
  href: string;
} {
  const subject = `Statement from ${s.companyName} as of ${s.asOfText}`;
  const out = [`Dear ${s.customerName},`, "", `A statement of your account with ${s.companyName} as at ${s.asOfLong}.`, ""];
  if (s.lines.length === 0) {
    out.push(`Nothing is outstanding on your account as at ${s.asOfLong}.`);
  } else {
    for (const line of s.lines.slice(0, STATEMENT_EMAIL_MAX_LINES)) {
      const parts = [line.date, line.docNumber, line.outstanding];
      if (line.docType === "invoice") parts.push(`due ${line.due}`);
      if (line.overdue) parts.push(`${line.ageDays} ${line.ageDays === 1 ? "day" : "days"} overdue`);
      out.push(`  ${parts.join("   ")}`);
    }
    const more = s.lines.length - STATEMENT_EMAIL_MAX_LINES;
    if (more > 0) out.push(`  …and ${more} more, listed in the attached statement.`);
    out.push("", `${s.totalLabel}: ${s.totalAmount} ${s.currencyCode}`);
    if (s.overdueCount > 0) {
      out.push("", `${s.overdueCount} of these ${s.overdueCount === 1 ? "is" : "are"} past the due date.`);
    }
  }
  if (s.payNote) out.push("", s.payNote);
  out.push("", "If any line does not match your own records, tell me which one and I will look into it.", "", s.companyName);
  const body = out.join("\r\n");
  const to = s.customerEmail ?? "";
  const address = encodeURIComponent(to).replace(/%40/g, "@");
  return {
    to,
    subject,
    body,
    href: `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

/** What lib/client/invoice-pdf draws for the statement. */
export function openItemStatementDocument(s: OpenItemStatement): StatementPrintedDocument {
  return {
    title: "Statement",
    watermark: null,
    seller: s.seller,
    billTo: s.party,
    meta: [
      { label: "As of", value: s.asOfText },
      { label: "Open items", value: String(s.lines.length) },
    ],
    lines: [],
    table: {
      head: STATEMENT_TABLE_HEAD,
      body: s.lines.map((line) => [
        `${line.date}\n${line.docNumber}`,
        line.description,
        line.due,
        line.age,
        line.amount,
        line.outstanding,
      ]),
      rightAligned: [2, 3, 4, 5],
    },
    totals: s.lines.length
      ? [
          ...s.buckets.map((bucket) => ({ label: bucket.label, amount: bucket.amount })),
          { label: s.totalLabel, amount: s.totalAmount },
        ]
      : [],
    memo: s.emptyText,
    payNote: s.payNote,
    partyHeading: "STATEMENT FOR",
    footnote: s.footnote,
  };
}

/** `statement-blueridge-foods-2026-11-10.pdf`, as `invoiceDocumentFileName` names an invoice. */
export function openItemStatementFileName(s: OpenItemStatement): string {
  const slug = s.customerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "customer";
  return `statement-${slug}-${s.asOf}.pdf`;
}
```

- [ ] **Step 7: Run the tests to make sure they pass**

Run: `npx vitest run tests/unit/open-item-statement.test.ts tests/unit/aging.test.ts tests/unit/aging-pivot.test.ts tests/unit/invoice-pdf.test.ts`
Expected: PASS. If an expected string differs (for example, the negative-money format from `Intl`), fix the code, not the expectation. The test strings are the spec. The one exception is a formatting detail you can show comes from `formatMoney` itself; report it.

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "open-item-statement|lib/format|aging.ts|invoice-document" ; echo done`
Expected: no lines before `done`.

```bash
git add ctyhp-accounting/lib/format.ts ctyhp-accounting/lib/domain/aging.ts ctyhp-accounting/lib/domain/invoice-document.ts ctyhp-accounting/lib/domain/open-item-statement.ts ctyhp-accounting/tests/unit/open-item-statement.test.ts
git commit -m "feat(statements): the open-item statement model, email and PDF document (3.0.13)"
```

---

### Task 2: Reading one customer's open items

**Files:**
- Create: `ctyhp-accounting/lib/services/open-item-statement.ts`
- Test: `ctyhp-accounting/tests/unit/open-item-statement-service.test.ts`

**Interfaces:**
- Consumes:
  - `OpenItemSource`, `OpenItemDetail` (Task 1);
  - `readAllPages` from `lib/services/paging`;
  - `CustomerRow` from `lib/db/types`.
- Produces:
  - `class OpenItemStatementError extends Error`
  - `readOpenItemStatement(sb: SupabaseClient, customerId: string, asOf: string): Promise<{ customer: CustomerRow; items: OpenItemSource[] } | null>`. It returns `null` when no customer has that id.

- [ ] **Step 1: Write the failing test.** Copy the `fakeClient` builder from `tests/unit/customer-detail-service.test.ts`, with its `vi.mock("server-only", () => ({}))`, and extend it:
  - `rpc(name, args)` returns a builder that records `eq`, `order` and `range` calls and resolves to the given RPC rows;
  - `.in(column, values)` filters a table's rows to those whose `column` is in `values`.

  The test cases:
  1. **Unknown customer.** An empty `acc_customer` → `null`, and `rpc` is never called.
  2. **The RPC call.** It is `acc_ar_ageing` with `{ p_as_of: "2026-11-10" }`, `eq("customer_id", <id>)`, ordered by `doc_date` then `doc_number`, and read through `range` (from `readAllPages`).
  3. **Matching details.** RPC rows give an invoice `INV-000004` (1000000), a credit memo `CM-000002` (-50000) and a payment `PMT-000009` (-120000). Each one gets its detail:
     - invoice: `{ totalMinor: 2680000, openMinor: 1000000, currencyCode: "USD", note: "Spring order" }`, from `acc_invoice` memo "Spring order";
     - credit memo: `{ totalMinor: 50000, openMinor: 50000, currencyCode: "USD", note: "Damaged stock" }`, from `acc_credit_memo` memo `null` and reason "Damaged stock";
     - payment: `{ totalMinor: 500000, openMinor: 120000, currencyCode: "USD", note: "RCV-1010" }`, from `acc_payment` reference "RCV-1010".
     - Each detail read filters `eq("customer_id", id)` and `in(<number column>, [...numbers])`.
  4. **Unmatched row.** An RPC row with `doc_number: null`, or with a number missing from its table, gets `detail: null` and is still returned.
  5. **Skipped reads.** No payment rows → `acc_payment` is never read.
  6. **Errors.** An RPC error throws `OpenItemStatementError` with the RPC's message.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/open-item-statement-service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/services/open-item-statement.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerRow } from "@/lib/db/types";
import type { OpenItemDetail, OpenItemSource } from "@/lib/domain/open-item-statement";
import { readAllPages } from "./paging";

export class OpenItemStatementError extends Error {}

type Raw = Record<string, unknown>;

/** Each document kind: its table, its number column, and how its row reads as an item's detail. */
const DETAIL_READS = {
  invoice: {
    table: "acc_invoice",
    number: "invoice_number",
    columns: "invoice_number,total_minor,balance_due_minor,currency_code,memo",
    detail: (r: Raw): OpenItemDetail => ({
      totalMinor: Number(r.total_minor),
      openMinor: Number(r.balance_due_minor),
      currencyCode: String(r.currency_code),
      note: (r.memo as string | null) ?? null,
    }),
  },
  credit_memo: {
    table: "acc_credit_memo",
    number: "credit_memo_number",
    columns: "credit_memo_number,total_minor,balance_remaining_minor,currency_code,memo,reason",
    detail: (r: Raw): OpenItemDetail => ({
      totalMinor: Number(r.total_minor),
      openMinor: Number(r.balance_remaining_minor),
      currencyCode: String(r.currency_code),
      note: ((r.memo as string | null)?.trim() || (r.reason as string | null)) ?? null,
    }),
  },
  payment: {
    table: "acc_payment",
    number: "payment_number",
    columns: "payment_number,amount_minor,unapplied_minor,currency_code,reference",
    detail: (r: Raw): OpenItemDetail => ({
      totalMinor: Number(r.amount_minor),
      openMinor: Number(r.unapplied_minor),
      currencyCode: String(r.currency_code),
      note: (r.reference as string | null) ?? null,
    }),
  },
} as const;

type Kind = keyof typeof DETAIL_READS;

/**
 * One customer's open items on a day (3.0.13): the rows acc_ar_ageing gives
 * A/R Aging, for this customer only, with each document's own total and note.
 * A document that cannot be found still appears, from the row alone.
 */
export async function readOpenItemStatement(
  sb: SupabaseClient,
  customerId: string,
  asOf: string,
): Promise<{ customer: CustomerRow; items: OpenItemSource[] } | null> {
  const fail = (message: string) => new OpenItemStatementError(message);
  const found = await sb.from("acc_customer").select("*").eq("id", customerId).maybeSingle();
  if (found.error) throw fail(found.error.message);
  if (!found.data) return null;

  const rows = await readAllPages<Raw>(
    (from, to) =>
      sb
        .rpc("acc_ar_ageing", { p_as_of: asOf })
        .eq("customer_id", customerId)
        .order("doc_date")
        .order("doc_number")
        .range(from, to),
    fail,
  );

  const details = new Map<string, OpenItemDetail>();
  await Promise.all(
    (Object.keys(DETAIL_READS) as Kind[]).map(async (kind) => {
      const read = DETAIL_READS[kind];
      const numbers = rows
        .filter((r) => r.doc_type === kind && typeof r.doc_number === "string")
        .map((r) => r.doc_number as string);
      if (numbers.length === 0) return;
      const { data, error } = await sb
        .from(read.table)
        .select(read.columns)
        .eq("customer_id", customerId)
        .in(read.number, numbers);
      if (error) throw fail(error.message);
      for (const r of (data ?? []) as Raw[]) details.set(`${kind}:${r[read.number] as string}`, read.detail(r));
    }),
  );

  const items: OpenItemSource[] = rows.map((r) => {
    const docNumber = (r.doc_number as string | null) ?? null;
    return {
      docType: String(r.doc_type),
      docNumber,
      docDate: String(r.doc_date),
      dueDate: String(r.due_date),
      outstandingMinor: Number(r.balance_minor),
      detail: docNumber ? (details.get(`${String(r.doc_type)}:${docNumber}`) ?? null) : null,
    };
  });
  return { customer: found.data as CustomerRow, items };
}
```

If `readAllPages`'s `PageResult` type does not accept the RPC builder, adapt the call the way `listCustomerTransactions` in `lib/services/customer-detail.ts` adapts its reads. Do not cast to `any`.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run tests/unit/open-item-statement-service.test.ts tests/unit/customer-detail-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "open-item-statement" ; echo done` → nothing before `done`.

```bash
git add ctyhp-accounting/lib/services/open-item-statement.ts ctyhp-accounting/tests/unit/open-item-statement-service.test.ts
git commit -m "feat(statements): read one customer's open items from the A/R ageing (3.0.13)"
```

---

### Task 3: The statement's PDF

**Files:**
- Modify: `ctyhp-accounting/lib/client/invoice-pdf.ts`
- Test: `ctyhp-accounting/tests/unit/invoice-pdf.test.ts` (add cases; the existing ones must stay green unchanged)

**Interfaces:**
- Consumes: `DocumentTable` (Task 1); `buildOpenItemStatement` and `openItemStatementDocument` (Task 1), in the test only.
- Produces:
  - `RenderableDocument` gains `table?: DocumentTable` and `footnote?: string | null`.
  - `downloadOpenItemStatementPdf(doc: RenderableDocument, fileName: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests.** Add to `tests/unit/invoice-pdf.test.ts`. jsPDF writes text uncompressed by default, so the PDF's bytes contain its strings:

```ts
import { buildOpenItemStatement, openItemStatementDocument } from "@/lib/domain/open-item-statement";

function statementInput(items: Parameters<typeof buildOpenItemStatement>[0]["items"]) {
  return {
    asOf: "2026-11-10",
    today: "2026-11-10",
    company: { ...source.company, pay_note: "Pay by ACH to account 000123456." },
    customer: source.customer,
    items,
    currencyCode: "USD",
    decimals: 2,
  };
}
const invoiceItem = {
  docType: "invoice",
  docNumber: "INV-000004",
  docDate: "2026-03-24",
  dueDate: "2026-04-23",
  outstandingMinor: 1_000_000,
  detail: { totalMinor: 2_680_000, openMinor: 1_000_000, currencyCode: "USD", note: "Spring order" },
};

describe("renderInvoicePdf: the open-item statement (3.0.13)", () => {
  const text = async (items: typeof invoiceItem[]) => {
    const pdf = await renderInvoicePdf(openItemStatementDocument(buildOpenItemStatement(statementInput(items))));
    return new TextDecoder("latin1").decode(new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer));
  };

  it("draws the statement's own columns, totals, pay note and footnote", async () => {
    const out = await text([invoiceItem]);
    for (const s of ["Statement", "STATEMENT FOR", "Outstanding", "Over 90 days", "Total due", "How to pay", "Every figure is as at"]) {
      expect(out).toContain(s);
    }
    expect(out).not.toContain("Unit price");
  });

  it("draws no table when nothing is open, only the sentence", async () => {
    const out = await text([]);
    expect(out).toContain("Nothing outstanding as of November 10, 2026.");
    expect(out).not.toContain("Outstanding");
    expect(out).not.toContain("Total due");
  });
});
```

The footnote may be split across lines by `splitTextToSize`, so match a prefix that fits one line, as above. Because "Nothing outstanding" has a lower-case "o", `not.toContain("Outstanding")` checks only that the table's heading is absent.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/unit/invoice-pdf.test.ts`
Expected: the new cases FAIL ("Unit price" is drawn, and the footnote is missing).

- [ ] **Step 3: Extend the renderer.** In `lib/client/invoice-pdf.ts`:

Change the type import and `RenderableDocument`:

```ts
import type { DocumentTable, InvoiceDocument, PrintedDocument } from "@/lib/domain/invoice-document";

/**
 * What this renderer draws: an invoice, or an estimate, which adds a closing
 * line under its note (lib/domain/estimate-document), or a sales receipt,
 * which also names its customer "Sold to" (lib/domain/sales-receipts), or the
 * open-item statement (lib/domain/open-item-statement, 3.0.13), which brings
 * columns of its own and a footnote.
 */
export type RenderableDocument = PrintedDocument & {
  footer?: string | null;
  partyHeading?: string;
  /** Columns instead of an invoice's; an empty body draws no table at all. */
  table?: DocumentTable;
  /** A muted note at the very end, after How to pay. */
  footnote?: string | null;
};
```

Replace the single `autoTable(pdf, { ... })` call with:

```ts
  const table = doc.table;
  // A statement with nothing open says so in its memo; a heading over no rows says nothing.
  if (!table || table.body.length > 0) {
    autoTable(pdf, {
      startY: billY + 16,
      head: [table ? table.head : ["Description", "Qty", "Unit price", "Amount"]],
      body: table ? table.body : doc.lines.map((line) => [line.description, line.quantity, line.unitPrice, line.amount]),
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 6, textColor: INK },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255] },
      columnStyles: table
        ? Object.fromEntries(table.rightAligned.map((index) => [index, { halign: "right" as const }]))
        : {
            1: { halign: "right", cellWidth: 50 },
            2: { halign: "right", cellWidth: 90 },
            3: { halign: "right", cellWidth: 90 },
          },
      margin: { left: MARGIN, right: MARGIN },
    });
  }
```

`totalsY` already falls back to `billY` when no table was drawn (`pdf.lastAutoTable?.finalY ?? billY`). Keep it.

After the `if (doc.payNote) { ... }` block and before `if (doc.footer)`, add:

```ts
  if (doc.footnote) {
    const footnoteLines: string[] = pdf.splitTextToSize(doc.footnote, pageWidth - MARGIN * 2);
    if (footY + footnoteLines.length * 12 > pdf.internal.pageSize.getHeight() - 48) {
      pdf.addPage();
      footY = 64;
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    pdf.text(footnoteLines, MARGIN, footY);
    footY += footnoteLines.length * pdf.getLineHeight() + 8;
  }
```

After `downloadSalesReceiptPdf`, add:

```ts
/** Saves the open-item statement (3.0.13) under the name lib/domain/open-item-statement gives it. */
export async function downloadOpenItemStatementPdf(doc: RenderableDocument, fileName: string): Promise<void> {
  const pdf = await renderInvoicePdf(doc);
  pdf.save(fileName);
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run tests/unit/invoice-pdf.test.ts tests/unit/open-item-statement.test.ts`
Expected: PASS, every existing invoice, estimate and sales-receipt case included.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "invoice-pdf" ; echo done` → nothing before `done`.

```bash
git add ctyhp-accounting/lib/client/invoice-pdf.ts ctyhp-accounting/tests/unit/invoice-pdf.test.ts
git commit -m "feat(statements): draw the open-item statement through the invoice PDF renderer (3.0.13)"
```

---

### Task 4: The statement page

**Files:**
- Create: `ctyhp-accounting/components/statements/OpenItemStatementSheet.tsx`
- Create: `ctyhp-accounting/components/statements/open-item-statement.module.css`
- Create: `ctyhp-accounting/app/(app)/customers/[id]/statement/page.tsx`
- Create: `ctyhp-accounting/app/(app)/customers/[id]/statement/OpenItemStatementClient.tsx`
- Create: `ctyhp-accounting/app/(app)/customers/[id]/statement/loading.tsx`
- Test: `ctyhp-accounting/tests/unit/open-item-statement-page.test.ts`

**Interfaces:**
- Consumes:
  - from Task 1: `parseStatementAsOf`, `buildOpenItemStatement`, `openItemStatementEmail`, `openItemStatementDocument`, `openItemStatementFileName`, `OpenItemStatement`;
  - from Task 2: `readOpenItemStatement`;
  - from Task 3: `downloadOpenItemStatementPdf`;
  - existing: `printReport` and `watchReportPrinting` (`lib/client/print-report`), `companyToday` and `getCurrentCompanySettings` (`lib/services/company`), `listCurrencies` (`lib/services/reference`), `customerIdSchema` (`lib/domain/schemas`), `PageHeader`, `FilterBar`.
- Produces: the route `/customers/<id>/statement?asOf=YYYY-MM-DD`. Task 5 links to it.

**Requirements:**
- **Server page (`page.tsx`):**
  - `export const dynamic = "force-dynamic"`.
  - Props: `{ params: Promise<{ id: string }>; searchParams: Promise<{ asOf?: string | string[] }> }`.
  - Validate the id with `customerIdSchema` (an invalid id → `notFound()`).
  - Read `companyToday(sb)`, then `asOf = parseStatementAsOf(query.asOf, today)`.
  - Read in parallel: `readOpenItemStatement(sb, id, asOf)`, `getCurrentCompanySettings(sb)` and `listCurrencies(sb)`. `null` → `notFound()`.
  - The company falls back, when settings are null, to `{ legal_name: "Company name not set", dba_name: null, address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null }`.
  - Base currency is the `is_base` row's `code` and `decimal_places`, or `"USD"` and `2`.
  - `PageHeader`:
    - title: `Statement for ${customer.name}`;
    - breadcrumb: Customers (`/customers`) / customer name (`/customers/<id>`) / Statement.
  - Render `<OpenItemStatementClient key={asOf} statement={statement} customerId={id} />`.
- **Client (`OpenItemStatementClient.tsx`, `"use client"`):**
  - `useEffect(() => watchReportPrinting(), [])`, so Ctrl+P prints the sheet alone.
  - A `FilterBar` with `ariaLabel="Statement options"`.
  - The filters, as children:
    - an antd `DatePicker`, `aria-label="As of"`, `format="MM/DD/YYYY"`, `allowClear={false}`, value `dayjs(statement.asOf)`. On change it `router.push`es `/customers/<id>/statement?asOf=<YYYY-MM-DD>`.
    - a `next/link` **Activity statement** to `/reports/customer-statement?customer=<id>`.
  - The actions:
    - **Print** (`PrinterOutlined`), which calls `printReport()`.
    - **Download PDF** (`DownloadOutlined`, `loading` while busy). It calls `downloadOpenItemStatementPdf(openItemStatementDocument(statement), openItemStatementFileName(statement))`. On a failure it shows `message.error("The PDF could not be made. Try again.")` through `App.useApp()`.
    - **Email** (`MailOutlined`), an antd `Button` with `href={openItemStatementEmail(statement).href}`, computed with `useMemo`.
      - When `statement.customerEmail` is null, wrap it in a `Tooltip` titled "No email saved for this customer: your mail program opens without a recipient."
      - Always add the Tooltip-free hint text "Attach the PDF before sending." as the button's `title` attribute.
  - Below the bar: `<div className={styles.scroller}><div className="report-print-area"><OpenItemStatementSheet statement={statement} /></div></div>`. The `scroller` class comes from `open-item-statement.module.css`.
- **Sheet (`OpenItemStatementSheet.tsx`, no `"use client"`, no antd):** semantic HTML in this order.
  1. **Top row.**
     - Left: the seller's `displayName` (large); its `legalLine` when set; each of `seller.lines`.
     - Right: "Statement" (large, accent) over a small two-row table, `As of | asOfText` and `Open items | lines.length`.
  2. **Party block.** The label "Statement for", `party.name`, each of `party.lines`.
  3. **Lines.** When `lines.length > 0`, a `<table>` with headings Date · Description · Due · Age · Amount · Outstanding; the last four are right-aligned.
     - Each row's Date cell has the date with the document number beneath it, in secondary text.
     - The Age cell uses `--ob-money-negative` when `line.overdue`.
     - A row with a negative outstanding sets Amount and Outstanding in `--ob-text-secondary`.
  4. **Totals.** A right-aligned two-column table: the five buckets (label | amount), then a strong row `totalLabel | totalAmount`.
  5. **Empty state.** When there are no lines, `<p>` with `emptyText` instead of 3 and 4.
  6. **How to pay.** `payNote` when set: `<p><strong>How to pay.</strong> {payNote}</p>`.
  7. **Footnote.** `footnote` in small secondary text.
  - The root is `<article className={styles.sheet} aria-label={`Statement for ${customerName}`}>`.
- **CSS (`open-item-statement.module.css`):**
  - `.sheet`: an A4-proportioned paper with `max-width: 794px`, `min-width: 640px`, `margin: 0 auto` and padding of about 48px. Colours as `.paper` in `report-paper.module.css`: `var(--ob-surface-card)` and a `1px solid var(--ob-border-default)` border, with the same shadow. Numbers use `font-variant-numeric: tabular-nums`.
  - `.scroller { overflow-x: auto; }`. On a 390px phone the sheet scrolls inside it, and the page itself must not scroll sideways.
  - `@media print`: the sheet has no border, shadow, `min-width` or `max-width`, and padding 0; `.scroller` has `overflow: visible`.
  - Every colour is a `var(--ob-…)` token.
- **`loading.tsx`:** an antd `Skeleton` in a box of the sheet's width (`active`, `paragraph={{ rows: 12 }}`). Keep it a server component that uses only `Skeleton`; never `Typography.*` compound members (see the RSC trap with antd compound components).

- [ ] **Step 1: Write the failing contract test** `tests/unit/open-item-statement-page.test.ts`. Read each new file with `readFileSync` and normalise CRLF, then assert:
  - **page.tsx:**
    - contains `customerIdSchema.safeParse(id)`, `notFound()`, `companyToday(sb)` and `parseStatementAsOf(`, plus `readOpenItemStatement(sb, id, asOf)`;
    - contains `Statement for ${customer.name}` (as `` `Statement for ${` ``) and `href: \`/customers/${id}\`` or an equivalent breadcrumb link to the customer;
    - matches `/key=\{asOf\}/`.
  - **Client:**
    - contains `watchReportPrinting()` inside a `useEffect`, `printReport()`, `downloadOpenItemStatementPdf(` and `openItemStatementEmail(statement)`;
    - contains `` `/reports/customer-statement?customer=${customerId}` `` and `` `/customers/${customerId}/statement?asOf=` ``;
    - contains `className="report-print-area"` and the strings `"Print"`, `"Download PDF"`, `"Email"` and `"Activity statement"`;
    - contains `"Attach the PDF before sending."`.
  - **Sheet:**
    - contains `"Statement for"`, `"How to pay."`, `statement.footnote` and `statement.emptyText`;
    - has the six headings `Date`, `Description`, `Due`, `Age`, `Amount`, `Outstanding` in that order;
    - does not import from `antd`.
  - **CSS:**
    - matches `/max-width:\s*794px/`, `/overflow-x:\s*auto/` and `/@media print/`;
    - matches no hex colour inside rule bodies, i.e. `/#[0-9a-fA-F]{3,6}\b/` is absent; the box-shadow `rgba(...)` copied from `.paper` is allowed.
  - **loading.tsx:** contains `Skeleton` and not `Typography`.

- [ ] **Step 2: Run it to make sure it fails** — `npx vitest run tests/unit/open-item-statement-page.test.ts` → FAIL (files missing).

- [ ] **Step 3: Write the five files** to the requirements above. Use `App.useApp()` for `message`, as `CustomerDetailClient.tsx` does. Use `useRouter` from `next/navigation`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/open-item-statement-page.test.ts tests/unit/open-item-statement.test.ts tests/unit/invoice-pdf.test.ts`, then the app-wide guards that scan every route and component: `npx vitest run tests/unit/table-fit-contract.test.ts tests/unit/inline-tokens*.test.ts tests/unit/rsc*.test.ts tests/unit/*antd*.test.ts`. Not every pattern may match a file; that is fine.
Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "statement" ; echo done` → nothing before `done`.
Run: `npx eslint "app/(app)/customers/[id]/statement" components/statements` → no errors.

```bash
git add "ctyhp-accounting/app/(app)/customers/[id]/statement/page.tsx" "ctyhp-accounting/app/(app)/customers/[id]/statement/OpenItemStatementClient.tsx" "ctyhp-accounting/app/(app)/customers/[id]/statement/loading.tsx" ctyhp-accounting/components/statements/OpenItemStatementSheet.tsx ctyhp-accounting/components/statements/open-item-statement.module.css ctyhp-accounting/tests/unit/open-item-statement-page.test.ts
git commit -m "feat(statements): the open-item statement page with Print, Download PDF and Email (3.0.13)"
```

---

### Task 5: Ways in

**Files:**
- Modify: `ctyhp-accounting/app/(app)/customers/[id]/CustomerDetailClient.tsx` (header actions, ~lines 247–275)
- Modify: `ctyhp-accounting/components/reports/AgingByPartyTable.tsx`
- Create: `ctyhp-accounting/components/reports/aging-party.module.css`
- Modify: `ctyhp-accounting/app/(app)/reports/ar-aging/ArAgingClient.tsx` (the `<AgingByPartyTable` call, ~line 122)
- Modify: `ctyhp-accounting/app/(app)/reports/customer-statement/page.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/customer-statement/CustomerStatementClient.tsx`
- Test: `ctyhp-accounting/tests/unit/customer-page.test.ts` (add); create `ctyhp-accounting/tests/unit/statement-entry-points.test.ts`

**Interfaces:**
- Consumes: the route from Task 4.
- Produces:
  - `AgingByPartyTable` prop `statementHref?: (entityId: string) => string`;
  - `CustomerStatementClient` prop `initialCustomerId?: string`.

**Requirements:**
1. **Customer page.** The FilterBar's `actions` always render. Their order:
   - Receive payment (writers);
   - New invoice (`canCreateInvoice && customer.is_active`);
   - **Statement** for everyone: `<Link href={`/customers/${customer.id}/statement`}><Button icon={<FileTextOutlined />}>Statement</Button></Link>`;
   - the ⋯ menu (writers).
   Remove the outer `canWrite || canCreateInvoice ? … : null` so a reader still gets Statement.
2. **AgingByPartyTable.** Add the optional prop `statementHref`.
   - **"party" view.** Render the name cell as `<span className={styles.name}><span className={styles.label} title={row.entityName}>{row.entityName}</span>{statementHref ? <Link className={styles.statement} href={statementHref(row.entityId)} aria-label={`Statement for ${row.entityName}`}>Statement</Link> : null}</span>`, then the existing `overdueLine(...)`.
   - **"grid" view.** When `statementHref` is set, each customer column's `title` becomes `<><span title={column.entityName}>{column.entityName}</span><Link className={styles.statementBlock} href={statementHref(column.entityId)} aria-label={`Statement for ${column.entityName}`}>Statement</Link></>`. Otherwise it stays `column.entityName`.
   - **Widths.** Add no column, and leave `AGING_PARTY_FIXED_WIDTHS` unchanged.
   - **CSS (`aging-party.module.css`).**
     - `.name { display: flex; align-items: baseline; gap: 8px; min-width: 0; }`
     - `.label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
     - `.statement { flex: none; font-size: 12px; }`
     - `.statementBlock { display: block; font-size: 12px; font-weight: normal; }`
     - `@media print { .statement, .statementBlock { display: none; } }`, so a printed aging report carries no links.
3. **ArAgingClient.** Pass `statementHref={(id) => `/customers/${id}/statement?asOf=${ranAsOf}`}` to `AgingByPartyTable`. A/P Aging's caller is unchanged.
4. **Customer statement report.**
   - `page.tsx` takes `searchParams: Promise<{ customer?: string | string[] }>`. It computes `initialCustomerId`: the `customer` value when it is a string naming an id in `customers`, otherwise `undefined`. It passes `initialCustomerId` to the client.
   - The client starts `useState<string | undefined>(initialCustomerId)`.
   - Check in the code that `SimpleReport` runs the report on mount once `waitFor` is null. If it does not, leave it; the self-check will show it.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/unit/customer-page.test.ts`, add a case that reads `CustomerDetailClient.tsx` (CRLF-normalised) and asserts:
    - it contains `` href={`/customers/${customer.id}/statement`} `` and `>Statement</Button>`;
    - the actions are not gated: the source no longer matches `/canWrite \|\| canCreateInvoice \?/`.
  - Create `tests/unit/statement-entry-points.test.ts`, asserting:
    - **AgingByPartyTable.tsx:** contains `statementHref?: (entityId: string) => string`, `statementHref(row.entityId)`, `statementHref(column.entityId)` and `` aria-label={`Statement for ${row.entityName}`} ``.
    - **ArAgingClient.tsx:** contains `` `/customers/${id}/statement?asOf=${ranAsOf}` ``.
    - **ApAgingClient.tsx** (`app/(app)/reports/ap-aging/ApAgingClient.tsx`; check the path): does not contain `statementHref`.
    - **customer-statement/page.tsx:** contains `searchParams` and `initialCustomerId`, and checks membership with `customers.some(`.
    - **CustomerStatementClient.tsx:** contains `useState<string | undefined>(initialCustomerId)`.
    - **aging-party.module.css:** matches `/@media print/`.

- [ ] **Step 2: Run them to make sure they fail** — `npx vitest run tests/unit/customer-page.test.ts tests/unit/statement-entry-points.test.ts` → FAIL.

- [ ] **Step 3: Make the changes** above.

- [ ] **Step 4: Run the tests**, the affected suites included:
  `npx vitest run tests/unit/customer-page.test.ts tests/unit/customer-page-actions.test.ts tests/unit/statement-entry-points.test.ts tests/unit/table-fit-batch-2b.test.ts tests/unit/aging-pivot.test.ts`, plus any test that greps `AgingByPartyTable`, `ArAgingClient` or `CustomerStatementClient`. Find them with `grep -rl -E "AgingByPartyTable|ArAgingClient|CustomerStatementClient|customer-statement" tests/unit`.
  Expected: PASS.

- [ ] **Step 5: Typecheck, lint and commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "AgingByPartyTable|ArAgingClient|CustomerDetailClient|customer-statement" ; echo done` → nothing before `done`.
Run `npx eslint` on the changed files → no errors.

```bash
git add "ctyhp-accounting/app/(app)/customers/[id]/CustomerDetailClient.tsx" ctyhp-accounting/components/reports/AgingByPartyTable.tsx ctyhp-accounting/components/reports/aging-party.module.css "ctyhp-accounting/app/(app)/reports/ar-aging/ArAgingClient.tsx" "ctyhp-accounting/app/(app)/reports/customer-statement/page.tsx" "ctyhp-accounting/app/(app)/reports/customer-statement/CustomerStatementClient.tsx" ctyhp-accounting/tests/unit/customer-page.test.ts ctyhp-accounting/tests/unit/statement-entry-points.test.ts
git commit -m "feat(statements): Statement from the customer page and A/R Aging; the activity statement takes ?customer= (3.0.13)"
```

---

### Task 6: Changelog 3.0.13

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts` (a new first entry in `RELEASES`)
- Test: `ctyhp-accounting/tests/unit/changelog.test.ts` (run; it checks routes exist and versions ascend)

- [ ] **Step 1: Add the entry** at the top of `RELEASES`:

```ts
  {
    version: "3.0.13",
    date: "2026-11-11",
    headline: "A statement of what a customer still owes, to print, save as PDF or email, from their page or from A/R Aging.",
    changes: [
      {
        kind: "added",
        title: "Open-item statement",
        detail:
          "Statement on a customer's page opens one sheet listing every invoice they have not paid in full, with its date, number, due date, how many days late it is, its amount and what is still outstanding. Under the list: the totals for Current, 1–30, 31–60, 61–90 and Over 90 days, Total due, and How to pay from Settings. A payment not yet applied to an invoice and a credit memo not yet used are listed as negative amounts and come off Total due, so the statement totals what the customer's row on A/R Aging does. Choose another As of date at the top; the footnote says what that date changes.",
        route: "/customers",
      },
      {
        kind: "added",
        title: "Print, Download PDF and Email",
        detail:
          "Print prints the sheet alone. Download PDF saves it as statement-<customer>-<date>.pdf. Email opens your mail program with the customer's address, the subject \"Statement from <company> as of <date>\" and a short summary of each line and the total; attach the PDF before sending, as OneBook sends no mail itself.",
        route: "/customers",
      },
      {
        kind: "added",
        title: "Statement from A/R Aging",
        detail:
          "On Accounts Receivable Aging, each customer has a Statement link beside their name in the By customer view and under their name in the Summary grid. It opens the statement as of the date the report was run.",
        route: "/reports/ar-aging",
      },
      {
        kind: "changed",
        title: "Customer Statement opens on the customer",
        detail:
          "The activity statement under Reports can now be opened for one customer from a link, and the open-item statement links to it as Activity statement.",
        route: "/reports/customer-statement",
      },
    ],
  },
```

Check that the `kind` values `"added"` and `"changed"` exist in `ChangeEntry`. If the type names them differently, use its names and say so in the report.

- [ ] **Step 2: Run the tests** — `npx vitest run tests/unit/changelog.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add ctyhp-accounting/lib/domain/changelog.ts
git commit -m "docs(changelog): 3.0.13, the open-item customer statement"
```

---

## Self-check after the tasks (controller, not a task)

- Run the full unit suite, `tsc`, `eslint` on the changed files, and `next build` (`npm ci` in the worktree, run in the background).
- Run a Playwright self-check on a local build against the Meridian sample company, with every write blocked:
  - BlueRidge Foods' statement at 1440px, 1280px and 390px;
  - Print preview, by emulating print media;
  - the Download PDF file;
  - the Email `href`;
  - A/R Aging's Statement links in the party and grid views;
  - the customer page's Statement button;
  - `/reports/customer-statement?customer=<id>`.
- Check that the statement's Total due equals BlueRidge's Total on A/R Aging for the same date, and that the page does not scroll sideways at 390px.
