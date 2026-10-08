# Reports Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ten reports of the client's mockup that OneBook's data already supports. Move Beancount to the last item of the sidebar's Accounting group, as the mockup has it.

**Architecture:**
- Each report is a page under `/reports/<slug>` on one shared client frame, `SimpleReport`. The frame draws the dates, Run, Copy/CSV/PDF/Excel/Print and the paper. It also draws a proof line wherever a total has something to equal.
- Each report's figures come from a pure module in `lib/domain/` and a paged read in `lib/services/party-reports.ts` or `lib/services/review-reports.ts`.
- The Report Center gains ten cards and hides a card the reader's role cannot open.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Ant Design 6, Supabase (PostgREST, one schema per company), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-08-reports-wave1-design.md`, read with its "Amendments from pre-building" section.

## Global Constraints

- UI text is US English.
- Report and card names are the mockup's. Page headings use the mockup's printed heading where it differs:
  - Customer Balance Summary
  - Vendor Balance Summary
  - Sales by Customer Summary
  - Expenses by Vendor Summary
- No database migration. Every report reads data OneBook already stores. If a step seems to need one, stop and ask.
- Every list read pages past PostgREST's 1,000-row cap (`readAllPages`, or a ranged RPC with a total order). PostgREST cuts silently.
- Read-only: no report, action or test writes to any company's books.
- Money is shown in the company's base currency. Every time is shown on the company's clock (`time_zone` in company settings), not the server's or UTC.
- A total that has something to equal shows a proof line under it. When the two disagree, it shows a warning with the difference; it never hides it.
- Who may open a report:
  - The Change Log needs `audit.read`. The catalog declares it, the Report Center hides the card, the page refuses with a notice, and the audit search RPC refuses as well.
  - The other nine reports are open to every company member, like the existing report pages.
- Server Components must not read Ant Design compound members (`Typography.Title` and the like) — the client components here are `"use client"`.
- In JSX text, write ’ rather than `&apos;`. The SWC build drops the leading space of a text node that follows an element when the node contains an HTML entity (seen: "Still agreesmeans").
- Invented data only in tests and fixtures (Example Retail, Example Supply…). The repository is public.
- Commits:
  - stage files by name (never `git add -A` / `git add .`);
  - no Co-Authored-By trailer, and no mention of Claude.
- Bash heredocs and `python -c` swallow backslashes. Write code with the Write and Edit tools.

## Amendments from pre-building (agreed spec, adjusted to what the code and data showed)

1. **Permissions.** No existing report page is gated: Row Level Security lets every company member read. So only the Change Log (`audit.read`) is gated, as above.
2. **Proof lines.** Open Invoices and Customer Balances are held to the **A/R control account**; Unpaid Bills and Vendor Balances to the A/P control account.
   - The A/R and A/P Aging read the same open-item list, so tying to them would prove nothing; the reports show the aging total as a line instead.
   - OneBook's aging is the current open position of documents dated on or before the as-of date (`acc_ar_ageing`), not a historical one. These reports follow the same rule.
3. **Sales by Customer is read from the ledger.**
   - It adds every posting to an `income` account in the period, under the customer of the invoice, credit memo or customer payment it came from.
   - In base currency, so sales tax is never in it and a foreign-currency invoice counts at its posted rate.
   - Postings with no customer document behind them go to a "(No customer)" row, so the total equals Income on the Profit and Loss.
   - Documents counts invoices. It shows "—" on the "(No customer)" row.
4. **Expenses by Vendor.**
   - It covers `cost_of_goods_sold`, `expense` and `other_expense` postings.
   - A line counts for the vendor of the bill, expense, vendor credit or bill payment behind it; anything else goes to "(No vendor)".
   - Its total equals cost of sales + expenses + other expenses on the Profit and Loss.
5. **Voided entries.**
   - An entry voided before the books kept the time of a void (10 such entries in one company) is dated by its entry date, and "When" reads "Not recorded".
   - Who voided a document comes from the audit log, and only for a reader with `audit.read`.
   - A reason sits under the description.
6. **Change Log.**
   - It lists the newest 1,000 entries (the ceiling of `acc_audit_search`) and says when there are more.
   - The Detail column leaves out ids, links, stamps and hashes, and cuts long values.
7. **Close Log.** The books record each close and reopen with its reason (`acc_period_event`) but not which close checks passed, so there is no "n of m checks" column. A year with no accounting periods shows a link to set them up.
8. **File layout.**
   - `lib/domain/<name>.ts` stays flat, because `lib/domain/reports.ts` and `lib/services/reports.ts` are already files.
   - Reads are grouped in `party-reports.ts` and `review-reports.ts`.
9. **Beancount** gets its own `loading.tsx`. Otherwise the Accounting overview's dashboard skeleton would show while the Beancount file builds.

## Verified before this plan was written

All of this ran on a local branch built from this plan's files:
- **Live check, read-only, on all six companies:** Open Invoices and Customer Balances equal the A/R Aging, Unpaid Bills and Vendor Balances the A/P Aging. Sales and Expenses by party equal the P&L for "This year" and "All dates". The review reports count what the books hold.
- **Gates:** typecheck, lint (0 errors), the unit suite, build, and bundle budget 11/11.
- **Smoke on PC-Test:** every page opens and states its proof line; 36 reports in the Report Center; the old Beancount address forwards with its query; no console errors.

## File structure

| File | Responsibility |
|---|---|
| `lib/domain/tie-out.ts` | A total beside what it must equal |
| `lib/domain/stamp.ts` | A moment on the company's clock |
| `lib/domain/report-run.ts` | `ReportWhen`, `ReportRunResult`, validating the dates an action receives |
| `lib/domain/open-items.ts` | Open Invoices / Unpaid Bills / party balances from the aging list, and their sheets |
| `lib/domain/party-activity.ts` | Sales by Customer / Expenses by Vendor from ledger lines, and their sheet |
| `lib/domain/reconciliation-list.ts` | Signed-off reconciliations and whether each still agrees |
| `lib/domain/close-log.ts` | Closes and reopens month by month |
| `lib/domain/voided-entries.ts` | Voided and reversed entries in a period |
| `lib/domain/change-log.ts` | Audit entries as a log, with a readable detail line |
| `lib/services/party-reports.ts` | Paged reads for the six customer and vendor reports |
| `lib/services/review-reports.ts` | Paged reads for the four review reports |
| `lib/services/report-context.ts` | What a report page needs: company, currency, today, time zone, presets |
| `components/reports/SimpleReport.tsx` | The shared frame: dates, Run, actions, paper |
| `components/reports/ProofLine.tsx` | The proof line under a total |
| `components/reports/OpenDocumentsReport.tsx`, `PartyBalancesReport.tsx`, `PartyActivityReport.tsx` | The three shared report bodies, each used by two pages |
| `app/(app)/reports/<slug>/` × 10 | Page, server action, and a client for the four review reports |
| `lib/domain/report-catalog.ts`, `components/reports/ReportsHub.tsx`, `app/(app)/reports/page.tsx` | Ten cards, a permission field, a hub that hides what a reader cannot open |
| `lib/domain/navigation.ts`, `app/(app)/accounting/beancount/` | Beancount in the sidebar; the old address forwards |
| `lib/domain/changelog.ts`, `lib/domain/system-guide.ts` | Release 1.92 and five guide steps |
| `tests/unit/*.test.ts`, `tests/live/reports-wave1.live.ts` | Unit tests per module; the read-only live check |

---

### Task 1: Pure report modules — open items, balances, party activity

**Files:**
- Create: `ctyhp-accounting/lib/domain/tie-out.ts`
- Create: `ctyhp-accounting/lib/domain/stamp.ts`
- Create: `ctyhp-accounting/lib/domain/report-run.ts`
- Create: `ctyhp-accounting/lib/domain/open-items.ts`
- Create: `ctyhp-accounting/lib/domain/party-activity.ts`
- Test: `ctyhp-accounting/tests/unit/open-items.test.ts`
- Test: `ctyhp-accounting/tests/unit/party-activity.test.ts`

**Interfaces:**
- Consumes: `fromMinor` (`lib/domain/money.ts`), `sanitizeExportFileName`, `ReportExportSheet` (`lib/domain/report-export.ts`) — existing.
- Produces: `tieOut(totalMinor, expectedMinor): TieOut`; `stampInTimeZone(iso, timeZone)`, `dateInTimeZone(iso, timeZone)`; `ReportWhen {from: string|null; to: string; fiscalYear: number|null}`, `ReportRunResult<T>`, `checkWhen(when, needs)`, `reportFailure(e)`; `OpenItemRow`, `DocumentAmount`, `openDocuments(rows, asOf, 'invoice'|'bill', amounts)`, `partyBalances(rows)`, `daysPastDue`, `ageLabel`, `openDocumentsSheet`, `partyBalancesSheet`, `AsOfSheetContext`; `PartyLedgerLine`, `partyActivity(lines, 'invoices'|'entryAccounts', noPartyLabel)`, `NO_CUSTOMER`, `NO_VENDOR`, `partyActivitySheet`.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/open-items.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import {
  ageLabel,
  daysPastDue,
  openDocuments,
  openDocumentsSheet,
  partyBalances,
  partyBalancesSheet,
  type DocumentAmount,
  type OpenItemRow,
} from "@/lib/domain/open-items";
import { tieOut } from "@/lib/domain/tie-out";

const row = (over: Partial<OpenItemRow>): OpenItemRow => ({
  partyId: "c1",
  partyName: "Example Retail",
  docType: "invoice",
  docNumber: "INV-1",
  docDate: "2026-09-01",
  dueDate: "2026-09-30",
  balanceMinor: 10_000,
  ...over,
});

const amounts = (list: DocumentAmount[]) => new Map(list.map((a) => [a.number, a]));

describe("age", () => {
  it("counts whole days past due, and reads not-yet-due as Current", () => {
    expect(daysPastDue("2026-09-30", "2026-09-30")).toBe(0);
    expect(daysPastDue("2026-09-30", "2026-10-01")).toBe(1);
    expect(daysPastDue("2026-10-15", "2026-10-01")).toBe(-14);
    expect(ageLabel(0)).toBe("Current");
    expect(ageLabel(-3)).toBe("Current");
    expect(ageLabel(1)).toBe("1 day");
    expect(ageLabel(45)).toBe("45 days");
  });
});

describe("openDocuments", () => {
  const rows = [
    row({ partyId: "c2", partyName: "Beta Stores", docNumber: "INV-3", dueDate: "2026-10-20", balanceMinor: 5_000 }),
    row({ docNumber: "INV-2", dueDate: "2026-08-31", balanceMinor: 2_500 }),
    row({ docNumber: "INV-1", dueDate: "2026-09-30", balanceMinor: 10_000 }),
    row({ docType: "credit_memo", docNumber: "CM-1", balanceMinor: -1_500 }),
    row({ docType: "payment", docNumber: "PMT-9", balanceMinor: -500 }),
  ];
  const report = openDocuments(
    rows,
    "2026-10-08",
    "invoice",
    amounts([
      { number: "INV-1", totalMinor: 12_000, balanceMinor: 10_000 },
      { number: "INV-2", totalMinor: 2_500, balanceMinor: 2_500 },
      { number: "INV-3", totalMinor: 5_000, balanceMinor: 5_000 },
    ]),
  );

  it("lists the invoices only, by customer then due date", () => {
    expect(report.lines.map((l) => l.docNumber)).toEqual(["INV-3", "INV-2", "INV-1"]);
    expect(report.lines.map((l) => l.partyName)).toEqual(["Beta Stores", "Example Retail", "Example Retail"]);
  });

  it("totals the invoices, takes the credits off, and lands on the aging total", () => {
    expect(report.documentsMinor).toBe(17_500);
    expect(report.creditsMinor).toBe(-2_000);
    expect(report.agingTotalMinor).toBe(15_500);
  });

  it("gives each invoice its days past due and its original amount", () => {
    const inv1 = report.lines.find((l) => l.docNumber === "INV-1")!;
    expect(inv1.daysPastDue).toBe(8);
    expect(inv1.amountMinor).toBe(12_000);
    expect(inv1.openMinor).toBe(10_000);
    expect(report.lines.find((l) => l.docNumber === "INV-3")!.daysPastDue).toBe(-12);
  });

  it("puts a foreign-currency invoice's amount at the rate of its open balance", () => {
    const foreign = openDocuments(
      [row({ docNumber: "INV-7", balanceMinor: 20_000 })],
      "2026-10-08",
      "invoice",
      // 100.00 open of 150.00 in the document's currency; 200.00 open in base.
      amounts([{ number: "INV-7", totalMinor: 15_000, balanceMinor: 10_000 }]),
    );
    expect(foreign.lines[0].amountMinor).toBe(30_000);
  });

  it("leaves the amount empty rather than guess when the invoice cannot be read", () => {
    const missing = openDocuments([row({ docNumber: "INV-8" })], "2026-10-08", "invoice", new Map());
    expect(missing.lines[0].amountMinor).toBeNull();
  });

  it("reads bills the same way for Unpaid Bills", () => {
    const bills = openDocuments(
      [row({ docType: "bill", docNumber: "B-1", balanceMinor: 4_000 }), row({ docType: "vendor_credit", docNumber: "VC-1", balanceMinor: -1_000 })],
      "2026-10-08",
      "bill",
      amounts([{ number: "B-1", totalMinor: 4_000, balanceMinor: 4_000 }]),
    );
    expect(bills.lines.map((l) => l.docNumber)).toEqual(["B-1"]);
    expect(bills.agingTotalMinor).toBe(3_000);
  });

  it("exports the table with the credits and the aging total under it", () => {
    const sheet = openDocumentsSheet(report, "invoice", { companyName: "Example Co", asOf: "2026-10-08", currencyCode: "USD", baseDecimals: 2 });
    expect(sheet.title).toBe("Open Invoices");
    expect(sheet.fileName).toBe("open-invoices-as-of-2026-10-08");
    expect(sheet.rows.at(-3)).toMatchObject({ party: "Total open invoices", open: 175 });
    expect(sheet.rows.at(-2)).toMatchObject({ party: "Credits and unapplied payments", open: -20 });
    expect(sheet.rows.at(-1)).toMatchObject({ party: "A/R Aging total", open: 155 });
    expect(sheet.rows[0]).toMatchObject({ num: "INV-3", age: "Current", amount: 50, open: 50 });
  });
});

describe("partyBalances", () => {
  it("nets each party's documents and credits, drops those at zero, and sorts by name", () => {
    const report = partyBalances([
      row({ partyId: "c2", partyName: "beta Stores", balanceMinor: 3_000 }),
      row({ partyId: "c1", partyName: "Alpha Gems", balanceMinor: 5_000 }),
      row({ partyId: "c1", partyName: "Alpha Gems", docType: "credit_memo", balanceMinor: -1_000 }),
      row({ partyId: "c3", partyName: "Cleared Co", balanceMinor: 2_000 }),
      row({ partyId: "c3", partyName: "Cleared Co", docType: "payment", balanceMinor: -2_000 }),
    ]);
    expect(report.lines).toEqual([
      { partyId: "c1", partyName: "Alpha Gems", balanceMinor: 4_000 },
      { partyId: "c2", partyName: "beta Stores", balanceMinor: 3_000 },
    ]);
    expect(report.totalMinor).toBe(7_000);
  });

  it("exports as the Balance Summary with a total", () => {
    const sheet = partyBalancesSheet(
      { lines: [{ partyId: "v1", partyName: "Example Supply", balanceMinor: 1_234 }], totalMinor: 1_234 },
      "vendor",
      { companyName: "Example Co", asOf: "2026-10-08", currencyCode: "USD", baseDecimals: 2 },
    );
    expect(sheet.title).toBe("Vendor Balance Summary");
    expect(sheet.rows).toEqual([
      { party: "Example Supply", balance: 12.34 },
      { party: "Total", balance: 12.34 },
    ]);
  });
});

describe("tieOut", () => {
  it("agrees only when the two are equal, and says by how much they part", () => {
    expect(tieOut(15_500, 15_500)).toEqual({ expectedMinor: 15_500, differenceMinor: 0, agrees: true });
    expect(tieOut(0, 14_639_000)).toEqual({ expectedMinor: 14_639_000, differenceMinor: -14_639_000, agrees: false });
  });
});
```

- [ ] **Step 2: Create `ctyhp-accounting/tests/unit/party-activity.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import { NO_CUSTOMER, NO_VENDOR, partyActivity, partyActivitySheet, type PartyLedgerLine } from "@/lib/domain/party-activity";

const line = (over: Partial<PartyLedgerLine>): PartyLedgerLine => ({
  entryId: "e1",
  accountId: "a1",
  amountMinor: 1_000,
  partyId: "c1",
  partyName: "Example Retail",
  invoiceId: null,
  ...over,
});

describe("partyActivity for sales", () => {
  const report = partyActivity(
    [
      line({ entryId: "e1", invoiceId: "i1", amountMinor: 30_000 }),
      line({ entryId: "e1", accountId: "a2", invoiceId: "i1", amountMinor: 5_000 }),
      line({ entryId: "e2", invoiceId: "i2", amountMinor: 10_000 }),
      // A credit memo for the same customer: takes sales off, is not a document.
      line({ entryId: "e3", invoiceId: null, amountMinor: -5_000 }),
      line({ entryId: "e4", partyId: "c2", partyName: "Beta Stores", invoiceId: "i3", amountMinor: 50_000 }),
      // A bank deposit coded to income.
      line({ entryId: "e5", partyId: null, partyName: null, amountMinor: 10_000 }),
    ],
    "invoices",
    NO_CUSTOMER,
  );

  it("ranks customers by total, largest first, with the unattributed row last", () => {
    expect(report.lines.map((l) => l.partyName)).toEqual(["Beta Stores", "Example Retail", NO_CUSTOMER]);
  });

  it("nets credit memos into the customer's total and counts invoices, not lines", () => {
    const example = report.lines.find((l) => l.partyId === "c1")!;
    expect(example.totalMinor).toBe(40_000);
    expect(example.count).toBe(2);
  });

  it("totals everything, the unattributed lines included, so it can equal the P&L", () => {
    expect(report.totalMinor).toBe(100_000);
    expect(report.unattributedCount).toBe(1);
    expect(report.lines.find((l) => l.partyId === null)!.totalMinor).toBe(10_000);
  });

  it("gives each row its share of the total", () => {
    expect(report.lines.map((l) => l.percent)).toEqual([50, 40, 10]);
  });
});

describe("partyActivity for spending", () => {
  it("counts an entry once per account it touches", () => {
    const report = partyActivity(
      [
        line({ entryId: "e1", accountId: "rent" }),
        line({ entryId: "e1", accountId: "utilities" }),
        line({ entryId: "e1", accountId: "utilities", amountMinor: 200 }),
        line({ entryId: "e2", accountId: "rent" }),
      ],
      "entryAccounts",
      NO_VENDOR,
    );
    expect(report.lines[0].count).toBe(3);
    expect(report.lines[0].totalMinor).toBe(3_200);
  });

  it("leaves out a party whose lines net to zero, and has no share when the total is zero", () => {
    const report = partyActivity(
      [line({ amountMinor: 1_000 }), line({ entryId: "e2", amountMinor: -1_000 })],
      "entryAccounts",
      NO_VENDOR,
    );
    expect(report.lines).toEqual([]);
    expect(report.totalMinor).toBe(0);
    const zeroTotal = partyActivity(
      [line({ amountMinor: 1_000 }), line({ partyId: "v2", partyName: "Other", amountMinor: -1_000 })],
      "entryAccounts",
      NO_VENDOR,
    );
    expect(zeroTotal.lines.every((l) => l.percent === null)).toBe(true);
  });
});

describe("partyActivitySheet", () => {
  it("leaves the document count empty on the no-customer line, which has no invoice to count", () => {
    const sheet = partyActivitySheet(
      {
        lines: [
          { partyId: "c1", partyName: "Example Retail", count: 2, totalMinor: 6_000, percent: 60 },
          { partyId: null, partyName: NO_CUSTOMER, count: 0, totalMinor: 4_000, percent: 40 },
        ],
        totalMinor: 10_000,
        unattributedCount: 3,
      },
      "sales",
      { companyName: "Example Co", from: "2026-01-01", to: "2026-10-08", currencyCode: "USD", baseDecimals: 2 },
    );
    expect(sheet.rows.map((r) => r.count)).toEqual([2, null, null]);
  });

  it("exports the summary with its counts, shares and a total row", () => {
    const sheet = partyActivitySheet(
      { lines: [{ partyId: "v1", partyName: "Example Supply", count: 2, totalMinor: 3_333, percent: 33.333 }], totalMinor: 10_000, unattributedCount: 0 },
      "expenses",
      { companyName: "Example Co", from: "2026-01-01", to: "2026-10-08", currencyCode: "USD", baseDecimals: 2 },
    );
    expect(sheet.title).toBe("Expenses by Vendor Summary");
    expect(sheet.columns.map((c) => c.header)).toEqual(["Vendor", "Entries", "Total", "% of spend"]);
    expect(sheet.rows).toEqual([
      { party: "Example Supply", count: 2, total: 33.33, percent: 33.3 },
      { party: "Total", count: null, total: 100, percent: 100 },
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

```bash
npx vitest run tests/unit/open-items.test.ts tests/unit/party-activity.test.ts
```

Expected: FAIL — the modules under `lib/domain/` do not exist yet ("Failed to resolve import").

- [ ] **Step 4: Create `ctyhp-accounting/lib/domain/tie-out.ts`** with exactly this content:

```ts
/**
 * A report's proof line: its total beside the figure it has to equal, and the
 * difference when they part. A report that disagrees with its own books says
 * so; it does not hide the gap.
 */
export interface TieOut {
  /** What the report's total has to equal. */
  expectedMinor: number;
  /** The report's total less what it has to equal; 0 when they agree. */
  differenceMinor: number;
  agrees: boolean;
}

export function tieOut(totalMinor: number, expectedMinor: number): TieOut {
  const differenceMinor = totalMinor - expectedMinor;
  return { expectedMinor, differenceMinor, agrees: differenceMinor === 0 };
}
```

- [ ] **Step 5: Create `ctyhp-accounting/lib/domain/stamp.ts`** with exactly this content:

```ts
/**
 * A stored moment as the company reads it: `2026-10-08 11:47`, in the
 * company's own time zone — the clock its people kept when they did the thing —
 * not the server's and not UTC.
 */
export function stampInTimeZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** The calendar date of a moment in a time zone: `2026-10-08`. */
export function dateInTimeZone(iso: string, timeZone: string): string {
  return stampInTimeZone(iso, timeZone).slice(0, 10);
}
```

- [ ] **Step 6: Create `ctyhp-accounting/lib/domain/report-run.ts`** with exactly this content:

```ts
/**
 * What a report page asks its server action for, and what comes back. Shared by
 * the report pages built on `SimpleReport`, so each one's action and screen
 * agree on the shape without each page declaring its own copy.
 */

/** The dates a report is run for. `from` is null for an as-of report. */
export interface ReportWhen {
  from: string | null;
  to: string;
  /** Set for a report run by fiscal year. */
  fiscalYear: number | null;
}

export interface ReportRunResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What a report action accepts from the browser: real calendar dates, a start
 * no later than the end, a fiscal year in range. Anything else is refused with
 * a reason, before any query runs.
 */
export function checkWhen(when: unknown, needs: "asOf" | "range" | "fiscalYear" | "none"): ReportWhen {
  const w = (when ?? {}) as Partial<ReportWhen>;
  const isDate = (value: unknown): value is string =>
    typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (needs === "fiscalYear") {
    const year = Number(w.fiscalYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Choose a fiscal year between 2000 and 2100.");
    return { from: null, to: "", fiscalYear: year };
  }
  if (needs === "none") return { from: null, to: isDate(w.to) ? w.to : "", fiscalYear: null };
  if (!isDate(w.to)) throw new Error("Choose the date the report runs to.");
  if (needs === "asOf") return { from: null, to: w.to, fiscalYear: null };
  if (!isDate(w.from)) throw new Error("Choose the date the report runs from.");
  if (w.from > w.to) throw new Error("The start date is after the end date.");
  return { from: w.from, to: w.to, fiscalYear: null };
}

/** The message a report action returns for a failure it did not expect. */
export function reportFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The report could not be produced.";
}
```

- [ ] **Step 7: Create `ctyhp-accounting/lib/domain/open-items.ts`** with exactly this content:

```ts
/**
 * Open Invoices, Unpaid Bills, Customer Balances and Vendor Balances: four
 * readings of the one open-item list the A/R and A/P Aging reports already read
 * (`acc_ar_ageing` / `acc_ap_ageing`).
 *
 * That list is the current open position: every document dated on or before
 * the as-of date, at what is still open on it today, in base currency. Credit
 * memos, vendor credits and unapplied payments are in it with a negative
 * balance. The aging reports net the lot, and so do the balances here; the
 * open-document reports list invoices (or bills) only and say what the credits
 * take off, so their total still ties to the aging.
 *
 * Pure: rows in, report out.
 */

import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

/** One row of `acc_ar_ageing` / `acc_ap_ageing`, as the reports read it. */
export interface OpenItemRow {
  partyId: string;
  partyName: string;
  /** invoice, credit_memo, payment — or bill, vendor_credit, bill_payment. */
  docType: string;
  docNumber: string | null;
  docDate: string;
  dueDate: string;
  /** Base currency, what is still open; negative for a credit or an unapplied payment. */
  balanceMinor: number;
}

/** What a document was for in the first place, by its number. */
export interface DocumentAmount {
  number: string;
  /** In the document's own currency. */
  totalMinor: number;
  balanceMinor: number;
}

export interface OpenDocumentLine {
  key: string;
  partyId: string;
  partyName: string;
  docNumber: string | null;
  docDate: string;
  dueDate: string;
  /** Days past due on the as-of date; 0 or less is not yet due. */
  daysPastDue: number;
  /** The document's original amount in base currency, or null when it could not be read. */
  amountMinor: number | null;
  openMinor: number;
}

export interface OpenDocumentsReport {
  lines: OpenDocumentLine[];
  /** The open balance of the documents listed. */
  documentsMinor: number;
  /** Credits and unapplied payments: what they take off, as a negative number (0 when none). */
  creditsMinor: number;
  /** documentsMinor + creditsMinor: the Aging total for the same date. */
  agingTotalMinor: number;
}

export interface PartyBalanceLine {
  partyId: string;
  partyName: string;
  balanceMinor: number;
}

export interface PartyBalancesReport {
  lines: PartyBalanceLine[];
  totalMinor: number;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole calendar days from the due date to the as-of date. */
export function daysPastDue(dueDate: string, asOf: string): number {
  return Math.round(dayNumber(asOf) - dayNumber(dueDate));
}

/** "Current" when not yet due, otherwise "N days". */
export function ageLabel(days: number): string {
  if (days <= 0) return "Current";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

const byName = (a: string, b: string) => a.localeCompare(b, "en-US", { sensitivity: "base" });

/**
 * The documents still open on the as-of date, one line each, by party then due
 * date. `documentType` is "invoice" for Open Invoices and "bill" for Unpaid
 * Bills; every other row of the list is a credit and is totalled, not listed.
 *
 * A document's original amount comes from `amounts` (keyed by number) and is
 * put in base currency at the same rate as its open balance, so a
 * foreign-currency invoice reads consistently across its two columns.
 */
export function openDocuments(
  rows: readonly OpenItemRow[],
  asOf: string,
  documentType: "invoice" | "bill",
  amounts: ReadonlyMap<string, DocumentAmount>,
): OpenDocumentsReport {
  const lines: OpenDocumentLine[] = [];
  let documentsMinor = 0;
  let creditsMinor = 0;
  for (const row of rows) {
    if (row.docType !== documentType) {
      creditsMinor += row.balanceMinor;
      continue;
    }
    documentsMinor += row.balanceMinor;
    const source = row.docNumber ? amounts.get(row.docNumber) : undefined;
    const amountMinor =
      source && source.balanceMinor !== 0
        ? Math.round((source.totalMinor * row.balanceMinor) / source.balanceMinor)
        : null;
    lines.push({
      key: `${row.partyId}:${row.docNumber ?? row.docDate}`,
      partyId: row.partyId,
      partyName: row.partyName,
      docNumber: row.docNumber,
      docDate: row.docDate,
      dueDate: row.dueDate,
      daysPastDue: daysPastDue(row.dueDate, asOf),
      amountMinor,
      openMinor: row.balanceMinor,
    });
  }
  lines.sort(
    (a, b) =>
      byName(a.partyName, b.partyName) ||
      a.partyId.localeCompare(b.partyId) ||
      a.dueDate.localeCompare(b.dueDate) ||
      (a.docNumber ?? "").localeCompare(b.docNumber ?? ""),
  );
  return { lines, documentsMinor, creditsMinor, agingTotalMinor: documentsMinor + creditsMinor };
}

/** What each party owes (or is owed), netting its credits; parties at zero are left out. */
export function partyBalances(rows: readonly OpenItemRow[]): PartyBalancesReport {
  const byParty = new Map<string, PartyBalanceLine>();
  for (const row of rows) {
    const line = byParty.get(row.partyId) ?? { partyId: row.partyId, partyName: row.partyName, balanceMinor: 0 };
    line.balanceMinor += row.balanceMinor;
    byParty.set(row.partyId, line);
  }
  const lines = [...byParty.values()]
    .filter((line) => line.balanceMinor !== 0)
    .sort((a, b) => byName(a.partyName, b.partyName) || a.partyId.localeCompare(b.partyId));
  return { lines, totalMinor: lines.reduce((sum, line) => sum + line.balanceMinor, 0) };
}

// --- Export -------------------------------------------------------------------

export interface AsOfSheetContext {
  companyName: string;
  asOf: string;
  currencyCode: string;
  baseDecimals: number;
}

/** Open Invoices or Unpaid Bills as the table shows it, with the credits and the aging total under it. */
export function openDocumentsSheet(
  report: OpenDocumentsReport,
  kind: "invoice" | "bill",
  ctx: AsOfSheetContext,
): ReportExportSheet {
  const money = (minor: number | null) => (minor === null ? null : fromMinor(minor, ctx.baseDecimals));
  const invoices = kind === "invoice";
  const total = (party: string, open: number) => ({ date: "", num: "", party, due: "", age: "", amount: null, open: money(open) });
  return {
    fileName: sanitizeExportFileName(`${invoices ? "open-invoices" : "unpaid-bills"}-as-of-${ctx.asOf}`),
    companyName: ctx.companyName,
    title: invoices ? "Open Invoices" : "Unpaid Bills",
    subtitle: `As of ${ctx.asOf}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "date", header: "Date", kind: "text", width: 12 },
      { key: "num", header: "Num", kind: "text", width: 14 },
      { key: "party", header: invoices ? "Customer" : "Vendor", kind: "text", width: 30 },
      { key: "due", header: "Due", kind: "text", width: 12 },
      { key: "age", header: "Age", kind: "text", width: 10 },
      { key: "amount", header: "Amount", kind: "money", width: 16 },
      { key: "open", header: "Open balance", kind: "money", width: 16 },
    ],
    rows: [
      ...report.lines.map((line) => ({
        date: line.docDate,
        num: line.docNumber ?? "",
        party: line.partyName,
        due: line.dueDate,
        age: ageLabel(line.daysPastDue),
        amount: money(line.amountMinor),
        open: money(line.openMinor),
      })),
      total(invoices ? "Total open invoices" : "Total unpaid bills", report.documentsMinor),
      total("Credits and unapplied payments", report.creditsMinor),
      total(invoices ? "A/R Aging total" : "A/P Aging total", report.agingTotalMinor),
    ],
  };
}

/** Customer Balance Summary or Vendor Balance Summary. */
export function partyBalancesSheet(
  report: PartyBalancesReport,
  kind: "customer" | "vendor",
  ctx: AsOfSheetContext,
): ReportExportSheet {
  const customers = kind === "customer";
  return {
    fileName: sanitizeExportFileName(`${kind}-balances-as-of-${ctx.asOf}`),
    companyName: ctx.companyName,
    title: customers ? "Customer Balance Summary" : "Vendor Balance Summary",
    subtitle: `As of ${ctx.asOf}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "party", header: customers ? "Customer" : "Vendor", kind: "text", width: 36 },
      { key: "balance", header: "Balance", kind: "money", width: 18 },
    ],
    rows: [
      ...report.lines.map((line) => ({ party: line.partyName, balance: fromMinor(line.balanceMinor, ctx.baseDecimals) })),
      { party: "Total", balance: fromMinor(report.totalMinor, ctx.baseDecimals) },
    ],
  };
}
```

- [ ] **Step 8: Create `ctyhp-accounting/lib/domain/party-activity.ts`** with exactly this content:

```ts
/**
 * Sales by Customer and Expenses by Vendor: the ledger's income (or spending)
 * for a period, divided by who it was with.
 *
 * Both read posted ledger lines in base currency, so sales tax — which posts to
 * a liability, not to income — is never in them, and a foreign-currency
 * document counts at the rate it was posted at. A line whose entry came from no
 * customer (or vendor) document still counts, on one row of its own, so the
 * report's total is the Profit and Loss's for the same period.
 *
 * Pure: lines in, report out.
 */

import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

/** One posted ledger line on an income (or expense) account, signed so that a sale (or a spend) is positive. */
export interface PartyLedgerLine {
  entryId: string;
  accountId: string;
  amountMinor: number;
  /** The customer or vendor on the document the entry came from; null when there is none. */
  partyId: string | null;
  partyName: string | null;
  /** The invoice the line came from, for counting documents; null for anything else. */
  invoiceId: string | null;
}

export interface PartyActivityLine {
  /** null for the row of lines that came from no customer or vendor document. */
  partyId: string | null;
  partyName: string;
  /** Documents (invoices) for sales; entries, counted once per account, for spending. */
  count: number;
  totalMinor: number;
  /** Share of the grand total, 0–100; null when the grand total is 0. */
  percent: number | null;
}

export interface PartyActivityReport {
  lines: PartyActivityLine[];
  totalMinor: number;
  /** How many lines' entries came from no customer or vendor document. */
  unattributedCount: number;
}

export type PartyCount = "invoices" | "entryAccounts";

export const NO_CUSTOMER = "(No customer)";
export const NO_VENDOR = "(No vendor)";

const byName = (a: string, b: string) => a.localeCompare(b, "en-US", { sensitivity: "base" });

/**
 * One row per party, largest total first, then the row of lines with no party
 * last. `count` decides what the count column counts: distinct invoices (sales)
 * or distinct (entry, account) pairs — an entry touching three expense accounts
 * counts three, as the client's mockup counts it.
 */
export function partyActivity(
  lines: readonly PartyLedgerLine[],
  count: PartyCount,
  noPartyLabel: string,
): PartyActivityReport {
  interface Bucket {
    partyId: string | null;
    partyName: string;
    totalMinor: number;
    keys: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  let unattributedCount = 0;
  for (const line of lines) {
    const key = line.partyId ?? "";
    if (!line.partyId) unattributedCount += 1;
    const bucket =
      buckets.get(key) ??
      { partyId: line.partyId, partyName: line.partyId ? (line.partyName ?? "") : noPartyLabel, totalMinor: 0, keys: new Set<string>() };
    bucket.totalMinor += line.amountMinor;
    if (count === "invoices") {
      if (line.invoiceId) bucket.keys.add(line.invoiceId);
    } else {
      bucket.keys.add(`${line.entryId}:${line.accountId}`);
    }
    buckets.set(key, bucket);
  }

  const totalMinor = [...buckets.values()].reduce((sum, b) => sum + b.totalMinor, 0);
  const percentOf = (minor: number) => (totalMinor === 0 ? null : (minor / totalMinor) * 100);

  const named = [...buckets.values()]
    .filter((b) => b.partyId !== null && b.totalMinor !== 0)
    .sort((a, b) => b.totalMinor - a.totalMinor || byName(a.partyName, b.partyName));
  const unnamed = buckets.get("");
  const ordered = unnamed && unnamed.totalMinor !== 0 ? [...named, unnamed] : named;

  return {
    lines: ordered.map((b) => ({
      partyId: b.partyId,
      partyName: b.partyName,
      count: b.keys.size,
      totalMinor: b.totalMinor,
      percent: percentOf(b.totalMinor),
    })),
    totalMinor,
    unattributedCount,
  };
}

// --- Export -------------------------------------------------------------------

/** Sales by Customer Summary or Expenses by Vendor Summary. */
export function partyActivitySheet(
  report: PartyActivityReport,
  kind: "sales" | "expenses",
  ctx: { companyName: string; from: string; to: string; currencyCode: string; baseDecimals: number },
): ReportExportSheet {
  const sales = kind === "sales";
  return {
    fileName: sanitizeExportFileName(`${sales ? "sales-by-customer" : "expenses-by-vendor"}-${ctx.from}-to-${ctx.to}`),
    companyName: ctx.companyName,
    title: sales ? "Sales by Customer Summary" : "Expenses by Vendor Summary",
    subtitle: `${ctx.from} to ${ctx.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "party", header: sales ? "Customer" : "Vendor", kind: "text", width: 36 },
      { key: "count", header: sales ? "Documents" : "Entries", kind: "number", width: 12 },
      { key: "total", header: "Total", kind: "money", width: 18 },
      { key: "percent", header: sales ? "% of sales" : "% of spend", kind: "percent", width: 12 },
    ],
    rows: [
      ...report.lines.map((line) => ({
        party: line.partyName,
        // Sales with no customer have no invoice to count.
        count: sales && line.partyId === null ? null : line.count,
        total: fromMinor(line.totalMinor, ctx.baseDecimals),
        percent: line.percent === null ? null : Math.round(line.percent * 10) / 10,
      })),
      {
        party: "Total",
        count: null,
        total: fromMinor(report.totalMinor, ctx.baseDecimals),
        percent: report.totalMinor === 0 ? null : 100,
      },
    ],
  };
}
```

- [ ] **Step 9: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/tie-out.ts" "lib/domain/stamp.ts" "lib/domain/report-run.ts" "lib/domain/open-items.ts" "lib/domain/party-activity.ts" "tests/unit/open-items.test.ts" "tests/unit/party-activity.test.ts"
npx vitest run tests/unit/open-items.test.ts tests/unit/party-activity.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; every listed test file passes.

Expected test totals: open-items 11 tests, party-activity 8 tests, all passing.

- [ ] **Step 10: Commit**

```bash
git add "lib/domain/tie-out.ts" "lib/domain/stamp.ts" "lib/domain/report-run.ts" "lib/domain/open-items.ts" "lib/domain/party-activity.ts" "tests/unit/open-items.test.ts" "tests/unit/party-activity.test.ts"
git commit -m "feat(reports): open items, party balances and party activity, pure"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; do not mention Claude in the message.

---

### Task 2: Pure report modules — reconciliations, close log, voided entries, change log

**Files:**
- Create: `ctyhp-accounting/lib/domain/reconciliation-list.ts`
- Create: `ctyhp-accounting/lib/domain/close-log.ts`
- Create: `ctyhp-accounting/lib/domain/voided-entries.ts`
- Create: `ctyhp-accounting/lib/domain/change-log.ts`
- Test: `ctyhp-accounting/tests/unit/review-reports.test.ts`

**Interfaces:**
- Consumes (Task 1): `stampInTimeZone`, `dateInTimeZone` (`lib/domain/stamp.ts`), `checkWhen` (tested here). Existing: `diffAuditEntry`, `formatAuditValue`, `summarizeAuditChanges`, `AuditEntryLike` (`lib/domain/audit.ts`).
- Produces: `SignedOffReconciliation`, `VoidedClearedLine`, `reconciliationList(sessions, voided)`, `reconciliationListSheet`; `ClosePeriod`, `CloseEvent`, `closeLog(periods, events)`, `closeLogSheet`; `VoidedEntry` (voidedAt may be null), `ReversedEntry`, `voidedEntries(voided, reversed, range, timeZone)`, `voidedEntriesSheet`; `ChangeLogEntry`, `CHANGE_LOG_LIMIT` (1000), `changeLog(entries)`, `changeLogDetail(entry)`, `changeLogSheet`.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/review-reports.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import { changeLog, changeLogDetail, changeLogSheet, CHANGE_LOG_LIMIT, type ChangeLogEntry } from "@/lib/domain/change-log";
import { closeLog, closeLogSheet, type ClosePeriod } from "@/lib/domain/close-log";
import { reconciliationList, type SignedOffReconciliation } from "@/lib/domain/reconciliation-list";
import { checkWhen } from "@/lib/domain/report-run";
import { dateInTimeZone, stampInTimeZone } from "@/lib/domain/stamp";
import { voidedEntries, voidedEntriesSheet, type ReversedEntry, type VoidedEntry } from "@/lib/domain/voided-entries";

describe("reconciliationList", () => {
  const session = (over: Partial<SignedOffReconciliation>): SignedOffReconciliation => ({
    id: "r1",
    bankAccountId: "b1",
    bankAccountName: "1010 — Operating",
    statementEndingDate: "2026-08-31",
    statementEndingBalanceMinor: 100_000,
    completedAt: "2026-09-02T15:00:00Z",
    completedByName: "Example Person",
    ...over,
  });

  it("still agrees when no ticked entry has been voided, and is out by the voided lines otherwise", () => {
    const report = reconciliationList(
      [session({ id: "r1" }), session({ id: "r2", statementEndingDate: "2026-09-30" })],
      [
        { reconciliationId: "r2", entryNumber: "JE-000012", signedMinor: 2_500 },
        { reconciliationId: "r2", entryNumber: "JE-000009", signedMinor: -500 },
      ],
    );
    expect(report.lines.map((l) => [l.id, l.stillAgrees, l.differenceMinor])).toEqual([
      ["r2", false, 2_000],
      ["r1", true, 0],
    ]);
    expect(report.lines[0].voidedEntries).toEqual(["JE-000009", "JE-000012"]);
    expect(report.outOfAgreement).toBe(1);
  });

  it("groups by bank account, newest statement first within each", () => {
    const report = reconciliationList(
      [
        session({ id: "s1", bankAccountId: "b2", bankAccountName: "1020 — Savings", statementEndingDate: "2026-07-31" }),
        session({ id: "o1", statementEndingDate: "2026-07-31" }),
        session({ id: "o2", statementEndingDate: "2026-08-31" }),
      ],
      [],
    );
    expect(report.lines.map((l) => l.id)).toEqual(["o2", "o1", "s1"]);
  });
});

describe("closeLog", () => {
  const periods: ClosePeriod[] = [
    { id: "p2", label: "Feb 2026", periodStart: "2026-02-01", status: "open" },
    { id: "p1", label: "Jan 2026", periodStart: "2026-01-01", status: "closed" },
  ];

  it("lists each month's closes and reopens in order, and a month never closed as Open", () => {
    const report = closeLog(periods, [
      { periodId: "p1", event: "reopen", reason: "Late bill", actorName: "Example Person", createdAt: "2026-02-10T09:00:00Z" },
      { periodId: "p1", event: "close", reason: "", actorName: "Example Person", createdAt: "2026-02-03T09:00:00Z" },
      { periodId: "p1", event: "close", reason: "Bill entered", actorName: null, createdAt: "2026-02-11T09:00:00Z" },
    ]);
    expect(report.lines.map((l) => [l.month, l.monthStart, l.event, l.reason])).toEqual([
      ["Jan 2026", true, "Closed", null],
      ["Jan 2026", false, "Reopened", "Late bill"],
      ["Jan 2026", false, "Closed", "Bill entered"],
      ["Feb 2026", true, "Open", null],
    ]);
    expect(report.closedMonths).toBe(1);
    expect(report.reopenings).toBe(1);
  });

  it("exports the times in the company's time zone", () => {
    const sheet = closeLogSheet(
      closeLog(periods.slice(1), [{ periodId: "p1", event: "close", reason: "", actorName: null, createdAt: "2026-02-03T23:30:00Z" }]),
      { companyName: "Example Co", fiscalYear: 2026, currencyCode: "USD", timeZone: "America/New_York" },
    );
    expect(sheet.rows[0]).toMatchObject({ month: "Jan 2026", event: "Closed", at: "2026-02-03 18:30" });
  });
});

describe("voidedEntries", () => {
  const voided = (over: Partial<VoidedEntry>): VoidedEntry => ({
    entryId: "v1",
    entryNumber: "JE-000100",
    entryDate: "2026-09-10",
    description: "Invoice INV-1",
    amountMinor: 50_000,
    voidedAt: "2026-09-12T14:00:00Z",
    byName: null,
    ...over,
  });
  const reversed: ReversedEntry = {
    originalEntryId: "o1",
    originalNumber: "JE-000090",
    originalDate: "2026-09-01",
    description: "Rent posted twice",
    amountMinor: 120_000,
    reversalEntryId: "rv1",
    reversalNumber: "JE-000091",
    reason: "Posted twice",
    reversedAt: "2026-09-20T10:00:00Z",
    byName: "Example Person",
  };

  it("lists voids and reversals in the period, newest first", () => {
    const report = voidedEntries([voided({})], [reversed], { from: "2026-09-01", to: "2026-09-30" }, "UTC");
    expect(report.lines.map((l) => [l.action, l.entryNumber, l.reversalNumber, l.reason])).toEqual([
      ["Reversed", "JE-000090", "JE-000091", "Posted twice"],
      ["Voided", "JE-000100", null, null],
    ]);
    expect([report.voided, report.reversed]).toEqual([1, 1]);
  });

  it("dates by the void, in the company's time zone, not by the entry", () => {
    // 01:30 UTC on Oct 1 is still Sept 30 in New York.
    const late = voided({ voidedAt: "2026-10-01T01:30:00Z" });
    expect(voidedEntries([late], [], { from: "2026-09-01", to: "2026-09-30" }, "America/New_York").voided).toBe(1);
    expect(voidedEntries([late], [], { from: "2026-09-01", to: "2026-09-30" }, "UTC").voided).toBe(0);
  });

  it("dates a void the books did not time by its entry, and says so on export", () => {
    const untimed = voided({ voidedAt: null, entryDate: "2026-09-05" });
    const report = voidedEntries([untimed], [], { from: "2026-09-01", to: "2026-09-30" }, "UTC");
    expect(report.lines[0].actedAt).toBeNull();
    const sheet = voidedEntriesSheet(report, { companyName: "Example Co", from: "2026-09-01", to: "2026-09-30", currencyCode: "USD", baseDecimals: 2, timeZone: "UTC" });
    expect(sheet.rows[0]).toMatchObject({ entry: "JE-000100", action: "Voided", at: "Not recorded", amount: 500 });
  });
});

describe("changeLog", () => {
  const entry = (id: string, at: string): ChangeLogEntry => ({ id, at, who: "Example Person", what: "Updated", record: "Invoice", reference: "INV-1", detail: "memo: a → b" });

  it("orders newest first, and says when the audit search hit its ceiling", () => {
    const report = changeLog([entry("a", "2026-09-01T10:00:00Z"), entry("b", "2026-09-02T10:00:00Z")]);
    expect(report.lines.map((l) => l.id)).toEqual(["b", "a"]);
    expect(report.truncated).toBe(false);
    const full = changeLog(Array.from({ length: CHANGE_LOG_LIMIT }, (_, i) => entry(String(i), "2026-09-01T10:00:00Z")));
    expect(full.truncated).toBe(true);
  });

  it("exports the record with its reference, at the company's time", () => {
    const sheet = changeLogSheet(changeLog([entry("a", "2026-09-01T10:00:00Z")]), {
      companyName: "Example Co",
      from: "2026-09-01",
      to: "2026-09-30",
      currencyCode: "USD",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    expect(sheet.rows[0]).toEqual({ at: "2026-09-01 17:00", who: "Example Person", what: "Updated", record: "Invoice INV-1", detail: "memo: a → b" });
  });
});

describe("changeLogDetail", () => {
  it("shows what changed, before and after, leaving ids, links and stamps out", () => {
    expect(
      changeLogDetail({
        before_json: { id: "1", status: "draft", memo: "a", customer_id: "c", updated_at: "x" },
        after_json: { id: "1", status: "issued", memo: "a", customer_id: "c2", updated_at: "y" },
      }),
    ).toBe("status: draft → issued");
  });

  it("says what a new record holds, without a column of arrows from nothing", () => {
    expect(
      changeLogDetail({
        before_json: null,
        after_json: { id: "1", account_code: "1087", name: "Sample Feed", account_type: "bank", currency_code: "USD", created_by: "u" },
      }),
    ).toBe("account_code: 1087; account_type: bank; currency_code: USD (+1 more)");
  });

  it("cuts a long value, and is empty when nothing a reader needs changed", () => {
    const long = "x".repeat(60);
    expect(changeLogDetail({ before_json: { note: "" }, after_json: { note: long } })).toBe(`note: (empty) → ${"x".repeat(40)}…`);
    expect(changeLogDetail({ before_json: { id: "1", updated_at: "a" }, after_json: { id: "1", updated_at: "b" } })).toBe("");
  });
});

describe("stamps", () => {
  it("reads a moment on the company's clock", () => {
    expect(stampInTimeZone("2026-10-08T04:47:28Z", "Asia/Ho_Chi_Minh")).toBe("2026-10-08 11:47");
    expect(dateInTimeZone("2026-10-01T01:30:00Z", "America/New_York")).toBe("2026-09-30");
  });
});

describe("checkWhen", () => {
  it("accepts real dates in order, and a fiscal year in range", () => {
    expect(checkWhen({ from: "2026-01-01", to: "2026-10-08" }, "range")).toEqual({ from: "2026-01-01", to: "2026-10-08", fiscalYear: null });
    expect(checkWhen({ to: "2026-10-08" }, "asOf")).toEqual({ from: null, to: "2026-10-08", fiscalYear: null });
    expect(checkWhen({ fiscalYear: 2026 }, "fiscalYear")).toEqual({ from: null, to: "", fiscalYear: 2026 });
  });

  it("refuses anything else before a query runs", () => {
    expect(() => checkWhen({ from: "2026-10-08", to: "2026-01-01" }, "range")).toThrow("The start date is after the end date.");
    expect(() => checkWhen({ to: "2026-13-40" }, "asOf")).toThrow("Choose the date the report runs to.");
    expect(() => checkWhen({ to: "2026-10-08'; drop" }, "asOf")).toThrow();
    expect(() => checkWhen({ fiscalYear: 1999 }, "fiscalYear")).toThrow("Choose a fiscal year between 2000 and 2100.");
    expect(() => checkWhen(null, "range")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
npx vitest run tests/unit/review-reports.test.ts
```

Expected: FAIL — `lib/domain/reconciliation-list.ts` and its siblings do not exist yet.

- [ ] **Step 3: Create `ctyhp-accounting/lib/domain/reconciliation-list.ts`** with exactly this content:

```ts
/**
 * Reconciliation Report: every statement reconciliation that was signed off,
 * and whether it still agrees with the books.
 *
 * A signed-off reconciliation balanced on the day it was signed. The only way
 * it stops balancing afterwards is that an entry it ticked is voided — the
 * cleared total counts posted entries only — and the database lists exactly
 * those lines (`acc_reconciliation_discrepancies`). So a reconciliation still
 * agrees when none of its ticked lines has been voided, and when one has, it is
 * out by the voided lines' amounts.
 *
 * Pure: sessions and voided lines in, report out.
 */

import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { stampInTimeZone } from "./stamp";

export interface SignedOffReconciliation {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  statementEndingDate: string;
  statementEndingBalanceMinor: number;
  completedAt: string | null;
  completedByName: string | null;
}

/** A line a signed-off reconciliation ticked whose entry has since been voided. */
export interface VoidedClearedLine {
  reconciliationId: string;
  entryNumber: string;
  /** Signed as the bank sees it: money in positive. */
  signedMinor: number;
}

export interface ReconciliationListLine extends SignedOffReconciliation {
  stillAgrees: boolean;
  /** What the reconciliation is now out by: the sum of its voided lines. 0 when it agrees. */
  differenceMinor: number;
  /** The entry numbers of its voided lines, for the reader to look up. */
  voidedEntries: string[];
}

export interface ReconciliationListReport {
  lines: ReconciliationListLine[];
  /** How many no longer agree. */
  outOfAgreement: number;
}

const byName = (a: string, b: string) => a.localeCompare(b, "en-US", { sensitivity: "base" });

/** By bank account, then the newest statement first. */
export function reconciliationList(
  sessions: readonly SignedOffReconciliation[],
  voided: readonly VoidedClearedLine[],
): ReconciliationListReport {
  const byReconciliation = new Map<string, VoidedClearedLine[]>();
  for (const line of voided) {
    const list = byReconciliation.get(line.reconciliationId) ?? [];
    list.push(line);
    byReconciliation.set(line.reconciliationId, list);
  }
  const lines = sessions
    .map((session): ReconciliationListLine => {
      const lost = byReconciliation.get(session.id) ?? [];
      const differenceMinor = lost.reduce((sum, line) => sum + line.signedMinor, 0);
      return {
        ...session,
        stillAgrees: lost.length === 0,
        differenceMinor,
        voidedEntries: [...new Set(lost.map((line) => line.entryNumber))].sort(),
      };
    })
    .sort(
      (a, b) =>
        byName(a.bankAccountName, b.bankAccountName) ||
        a.bankAccountId.localeCompare(b.bankAccountId) ||
        b.statementEndingDate.localeCompare(a.statementEndingDate),
    );
  return { lines, outOfAgreement: lines.filter((line) => !line.stillAgrees).length };
}

export function reconciliationListSheet(
  report: ReconciliationListReport,
  ctx: { companyName: string; today: string; currencyCode: string; baseDecimals: number; timeZone: string },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`reconciliation-report-${ctx.today}`),
    companyName: ctx.companyName,
    title: "Reconciliation Report",
    subtitle: `Signed-off reconciliations as of ${ctx.today}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "account", header: "Bank account", kind: "text", width: 30 },
      { key: "ending", header: "Statement ending", kind: "text", width: 14 },
      { key: "balance", header: "Ending balance", kind: "money", width: 16 },
      { key: "by", header: "Signed off by", kind: "text", width: 28 },
      { key: "at", header: "Signed off", kind: "text", width: 20 },
      { key: "agrees", header: "Still agrees", kind: "text", width: 12 },
      { key: "difference", header: "Out by", kind: "money", width: 14 },
      { key: "voided", header: "Voided entries", kind: "text", width: 24 },
    ],
    rows: report.lines.map((line) => ({
      account: line.bankAccountName,
      ending: line.statementEndingDate,
      balance: fromMinor(line.statementEndingBalanceMinor, ctx.baseDecimals),
      by: line.completedByName ?? "",
      at: line.completedAt ? stampInTimeZone(line.completedAt, ctx.timeZone) : "",
      agrees: line.stillAgrees ? "Yes" : "No",
      difference: line.stillAgrees ? null : fromMinor(line.differenceMinor, ctx.baseDecimals),
      voided: line.voidedEntries.join(", "),
    })),
  };
}
```

- [ ] **Step 4: Create `ctyhp-accounting/lib/domain/close-log.ts`** with exactly this content:

```ts
/**
 * Month-End Close Log: every close and reopen of a fiscal year's months, with
 * when, by whom and why.
 *
 * The books record each close and reopen (`acc_period_event`) with its reason,
 * but not which close checks passed at the time, so this log does not show a
 * check count: it would have to be invented.
 *
 * Pure: periods and events in, log out.
 */

import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { stampInTimeZone } from "./stamp";

export interface ClosePeriod {
  id: string;
  label: string;
  periodStart: string;
  status: "open" | "closed";
}

export interface CloseEvent {
  periodId: string;
  event: "close" | "reopen";
  reason: string;
  actorName: string | null;
  createdAt: string;
}

export type CloseLogEvent = "Closed" | "Reopened" | "Open";

export interface CloseLogLine {
  key: string;
  periodId: string;
  month: string;
  /** Only on a month's first line, so a month reads as one block. */
  monthStart: boolean;
  event: CloseLogEvent;
  /** null on the line of a month that has never been closed. */
  at: string | null;
  by: string | null;
  reason: string | null;
  /** The month's status now, on its first line. */
  statusNow: "open" | "closed";
}

export interface CloseLogReport {
  lines: CloseLogLine[];
  closedMonths: number;
  reopenings: number;
}

/** Month by month in order; within a month, its events in the order they happened. */
export function closeLog(periods: readonly ClosePeriod[], events: readonly CloseEvent[]): CloseLogReport {
  const byPeriod = new Map<string, CloseEvent[]>();
  for (const event of events) {
    const list = byPeriod.get(event.periodId) ?? [];
    list.push(event);
    byPeriod.set(event.periodId, list);
  }
  const lines: CloseLogLine[] = [];
  for (const period of [...periods].sort((a, b) => a.periodStart.localeCompare(b.periodStart))) {
    const own = (byPeriod.get(period.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (own.length === 0) {
      lines.push({
        key: `${period.id}:open`,
        periodId: period.id,
        month: period.label,
        monthStart: true,
        event: "Open",
        at: null,
        by: null,
        reason: null,
        statusNow: period.status,
      });
      continue;
    }
    own.forEach((event, index) => {
      lines.push({
        key: `${period.id}:${index}`,
        periodId: period.id,
        month: period.label,
        monthStart: index === 0,
        event: event.event === "close" ? "Closed" : "Reopened",
        at: event.createdAt,
        by: event.actorName,
        reason: event.reason.trim() === "" ? null : event.reason,
        statusNow: period.status,
      });
    });
  }
  return {
    lines,
    closedMonths: periods.filter((period) => period.status === "closed").length,
    reopenings: events.filter((event) => event.event === "reopen").length,
  };
}

export function closeLogSheet(
  report: CloseLogReport,
  ctx: { companyName: string; fiscalYear: number; currencyCode: string; timeZone: string },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`month-end-close-log-fy${ctx.fiscalYear}`),
    companyName: ctx.companyName,
    title: "Month-End Close Log",
    subtitle: `Fiscal year ${ctx.fiscalYear}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "month", header: "Month", kind: "text", width: 16 },
      { key: "event", header: "Event", kind: "text", width: 12 },
      { key: "at", header: "When", kind: "text", width: 20 },
      { key: "by", header: "By", kind: "text", width: 28 },
      { key: "reason", header: "Reason or note", kind: "text", width: 48 },
    ],
    rows: report.lines.map((line) => ({
      month: line.month,
      event: line.event,
      at: line.at ? stampInTimeZone(line.at, ctx.timeZone) : "",
      by: line.by ?? "",
      reason: line.reason ?? "",
    })),
  };
}
```

- [ ] **Step 5: Create `ctyhp-accounting/lib/domain/voided-entries.ts`** with exactly this content:

```ts
/**
 * Voided and Reversed Entries — OneBook's answer to the mockup's Bin.
 *
 * OneBook never deletes a posted entry. A document's void marks its entry void
 * (it stays, with the time it was voided); a reversal posts a second entry that
 * undoes the first and keeps the reason. This report lists both, dated by when
 * the void or reversal happened in the company's own time zone, newest first.
 * Nothing here puts an entry back: posting it again is a new entry.
 *
 * Pure: entries in, report out.
 */

import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { dateInTimeZone, stampInTimeZone } from "./stamp";

export interface VoidedEntry {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  /** The entry's debits, base currency. */
  amountMinor: number;
  /** When it was voided; null for an entry voided before the books kept the time. */
  voidedAt: string | null;
  /** Who voided it, when the audit log says; null otherwise. */
  byName: string | null;
}

export interface ReversedEntry {
  originalEntryId: string;
  originalNumber: string;
  originalDate: string;
  description: string;
  amountMinor: number;
  reversalEntryId: string;
  reversalNumber: string;
  reason: string;
  reversedAt: string;
  byName: string | null;
}

export interface VoidedEntriesLine {
  key: string;
  action: "Voided" | "Reversed";
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  amountMinor: number;
  /** null when the books did not keep the time of the void. */
  actedAt: string | null;
  by: string | null;
  reason: string | null;
  reversalEntryId: string | null;
  reversalNumber: string | null;
}

export interface VoidedEntriesReport {
  lines: VoidedEntriesLine[];
  voided: number;
  reversed: number;
}

export function voidedEntries(
  voided: readonly VoidedEntry[],
  reversed: readonly ReversedEntry[],
  range: { from: string; to: string },
  timeZone: string,
): VoidedEntriesReport {
  const inRange = (day: string) => day >= range.from && day <= range.to;
  // A void the books did not time is dated by its entry, the only date it has.
  const voidedWithin = (entry: VoidedEntry) =>
    entry.voidedAt ? inRange(dateInTimeZone(entry.voidedAt, timeZone)) : inRange(entry.entryDate);
  const sortKey = (line: VoidedEntriesLine) => line.actedAt ?? `${line.entryDate}T00:00:00`;
  const lines: VoidedEntriesLine[] = [
    ...voided.filter(voidedWithin).map(
      (entry): VoidedEntriesLine => ({
        key: `void:${entry.entryId}`,
        action: "Voided",
        entryId: entry.entryId,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        description: entry.description,
        amountMinor: entry.amountMinor,
        actedAt: entry.voidedAt,
        by: entry.byName,
        reason: null,
        reversalEntryId: null,
        reversalNumber: null,
      }),
    ),
    ...reversed.filter((entry) => inRange(dateInTimeZone(entry.reversedAt, timeZone))).map(
      (entry): VoidedEntriesLine => ({
        key: `reverse:${entry.originalEntryId}`,
        action: "Reversed",
        entryId: entry.originalEntryId,
        entryNumber: entry.originalNumber,
        entryDate: entry.originalDate,
        description: entry.description,
        amountMinor: entry.amountMinor,
        actedAt: entry.reversedAt,
        by: entry.byName,
        reason: entry.reason.trim() === "" ? null : entry.reason,
        reversalEntryId: entry.reversalEntryId,
        reversalNumber: entry.reversalNumber,
      }),
    ),
  ].sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.entryNumber.localeCompare(b.entryNumber));
  return {
    lines,
    voided: lines.filter((line) => line.action === "Voided").length,
    reversed: lines.filter((line) => line.action === "Reversed").length,
  };
}

export function voidedEntriesSheet(
  report: VoidedEntriesReport,
  ctx: { companyName: string; from: string; to: string; currencyCode: string; baseDecimals: number; timeZone: string },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`voided-and-reversed-entries-${ctx.from}-to-${ctx.to}`),
    companyName: ctx.companyName,
    title: "Voided and Reversed Entries",
    subtitle: `${ctx.from} to ${ctx.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "date", header: "Date of entry", kind: "text", width: 12 },
      { key: "entry", header: "Entry", kind: "text", width: 14 },
      { key: "description", header: "Description", kind: "text", width: 36 },
      { key: "amount", header: "Amount", kind: "money", width: 16 },
      { key: "action", header: "Action", kind: "text", width: 10 },
      { key: "by", header: "By", kind: "text", width: 28 },
      { key: "at", header: "When", kind: "text", width: 18 },
      { key: "reason", header: "Reason", kind: "text", width: 36 },
      { key: "reversal", header: "Reversal entry", kind: "text", width: 14 },
    ],
    rows: report.lines.map((line) => ({
      date: line.entryDate,
      entry: line.entryNumber,
      description: line.description,
      amount: fromMinor(line.amountMinor, ctx.baseDecimals),
      action: line.action,
      by: line.by ?? "",
      at: line.actedAt ? stampInTimeZone(line.actedAt, ctx.timeZone) : "Not recorded",
      reason: line.reason ?? "",
      reversal: line.reversalNumber ?? "",
    })),
  };
}
```

- [ ] **Step 6: Create `ctyhp-accounting/lib/domain/change-log.ts`** with exactly this content:

```ts
/**
 * Change Log: what changed in the books, when and by whom, read from the audit
 * log the database keeps for every audited table.
 *
 * The audit search returns at most 1,000 entries, newest first. A period with
 * more says so instead of quietly showing the newest thousand as if they were
 * all of it.
 *
 * Pure: audit entries (already described) in, report out.
 */

import { diffAuditEntry, formatAuditValue, summarizeAuditChanges, type AuditEntryLike } from "./audit";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";
import { stampInTimeZone } from "./stamp";

/** Keys, links and stamps: true, but a reader learns nothing from a uuid or a hash. */
const NOT_FOR_READING = /(^id$|_id$|_by$|_at$|_hash$)/;
/** A value longer than this is cut, so one field cannot fill the cell. */
const VALUE_LENGTH = 40;
const FIELDS_SHOWN = 3;

const clip = (value: string) => (value.length > VALUE_LENGTH ? `${value.slice(0, VALUE_LENGTH)}…` : value);

/**
 * One line a reader can scan for an audit entry: for a change, the fields that
 * changed, before and after; for a record added or removed, what it held. Ids,
 * links and timestamps are left out — the When and Record columns carry those.
 */
export function changeLogDetail(entry: Pick<AuditEntryLike, "before_json" | "after_json">): string {
  const changes = diffAuditEntry(entry)
    .filter((change) => !NOT_FOR_READING.test(change.field))
    .map((change) => ({
      ...change,
      before: change.before === null ? null : clip(change.before),
      after: change.after === null ? null : clip(change.after),
    }));
  if (changes.length === 0) return "";
  const added = changes.every((change) => change.before === null);
  const removed = changes.every((change) => change.after === null);
  if (!added && !removed) return summarizeAuditChanges(changes, FIELDS_SHOWN);
  const shown = changes
    .slice(0, FIELDS_SHOWN)
    .map((change) => `${change.field}: ${formatAuditValue(added ? change.after : change.before)}`)
    .join("; ");
  const rest = changes.length - FIELDS_SHOWN;
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
}

/** The audit search's ceiling (`acc_audit_search`). */
export const CHANGE_LOG_LIMIT = 1000;

export interface ChangeLogEntry {
  id: string;
  at: string;
  who: string;
  /** Added, Changed, Voided… */
  what: string;
  /** Invoice, Bill, Account… */
  record: string;
  /** The record's own number or name, when the snapshot holds one. */
  reference: string | null;
  /** `status: draft → issued; memo: … (+2 more)`. */
  detail: string;
}

export interface ChangeLogReport {
  lines: ChangeLogEntry[];
  /** True when the search hit its ceiling, so older changes in the period are not shown. */
  truncated: boolean;
}

export function changeLog(entries: readonly ChangeLogEntry[]): ChangeLogReport {
  const lines = [...entries].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { lines, truncated: entries.length >= CHANGE_LOG_LIMIT };
}

export function changeLogSheet(
  report: ChangeLogReport,
  ctx: { companyName: string; from: string; to: string; currencyCode: string; timeZone: string },
): ReportExportSheet {
  return {
    fileName: sanitizeExportFileName(`change-log-${ctx.from}-to-${ctx.to}`),
    companyName: ctx.companyName,
    title: "Change Log",
    subtitle: `${ctx.from} to ${ctx.to}`,
    currencyCode: ctx.currencyCode,
    columns: [
      { key: "at", header: "When", kind: "text", width: 20 },
      { key: "who", header: "Who", kind: "text", width: 28 },
      { key: "what", header: "What", kind: "text", width: 14 },
      { key: "record", header: "Record", kind: "text", width: 28 },
      { key: "detail", header: "Detail", kind: "text", width: 60 },
    ],
    rows: report.lines.map((line) => ({
      at: stampInTimeZone(line.at, ctx.timeZone),
      who: line.who,
      what: line.what,
      record: line.reference ? `${line.record} ${line.reference}` : line.record,
      detail: line.detail,
    })),
  };
}
```

- [ ] **Step 7: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/reconciliation-list.ts" "lib/domain/close-log.ts" "lib/domain/voided-entries.ts" "lib/domain/change-log.ts" "tests/unit/review-reports.test.ts"
npx vitest run tests/unit/review-reports.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; every listed test file passes.

Expected: 15 tests passing in review-reports.test.ts.

- [ ] **Step 8: Commit**

```bash
git add "lib/domain/reconciliation-list.ts" "lib/domain/close-log.ts" "lib/domain/voided-entries.ts" "lib/domain/change-log.ts" "tests/unit/review-reports.test.ts"
git commit -m "feat(reports): reconciliation list, close log, voided entries and change log, pure"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; do not mention Claude in the message.

---

### Task 3: Reads — party reports, review reports, page context; live check

**Files:**
- Create: `ctyhp-accounting/lib/services/report-context.ts`
- Create: `ctyhp-accounting/lib/services/party-reports.ts`
- Create: `ctyhp-accounting/lib/services/review-reports.ts`
- Test: `ctyhp-accounting/tests/live/reports-wave1.live.ts`

**Interfaces:**
- Consumes (Tasks 1–2): every pure function above. Existing: `readAllPages`, `PAGE_SIZE` (`lib/services/paging.ts`), `getLedgerBalances` (`lib/services/reports.ts`), `buildProfitAndLoss` (`lib/domain/reports.ts`), `searchAudit`, `hasPermission` (`lib/services/access.ts`), `getDiscrepancies` (`lib/services/bankrec.ts`), `describeAuditActivity`, `todayInTimeZone` (`lib/services/dashboard.ts`), `getCurrentCompanySettings`, `listCurrencies`, `postedEntryDateSpan`, `resolveActiveCompany`.
- Produces: `getOpenInvoices(sb, asOf, today)`, `getUnpaidBills`, `getCustomerBalances`, `getVendorBalances`, `getSalesByCustomer(sb, from, to)`, `getExpensesByVendor`, types `OpenDocumentsResult {report, control: TieOut}`, `PartyBalancesResult`, `PartyActivityResult {report, proof: TieOut}`; `getReconciliationList(sb)`, `getChangeLog(sb, from, to)`, `getCloseLog(sb, fiscalYear)`, `getVoidedEntries(sb, range, timeZone, canReadAudit)`; `reportPageContext(sb): ReportPageContext {companyName, isSample, currencyCode, decimals, today, timeZone, presets}`, `companyClock(sb)`.

- [ ] **Step 1: Create `ctyhp-accounting/lib/services/report-context.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveActiveCompany } from "@/lib/db/company";
import type { PresetContext } from "@/lib/domain/report-presets";
import { getCurrentCompanySettings } from "./company";
import { todayInTimeZone } from "./dashboard";
import { postedEntryDateSpan } from "./exceptions";
import { listCurrencies } from "./reference";

/** What every report page needs before it draws anything: who, in what money, and what day it is. */
export interface ReportPageContext {
  companyName: string;
  isSample: boolean;
  currencyCode: string;
  decimals: number;
  /** The company's today, in its own time zone. */
  today: string;
  timeZone: string;
  /** For the period presets: fiscal year and the span of posted entries. */
  presets: PresetContext;
}

/** The company's today and time zone, for a report action that needs no more. */
export async function companyClock(sb: SupabaseClient): Promise<{ today: string; timeZone: string }> {
  const settings = await getCurrentCompanySettings(sb);
  const timeZone = settings?.time_zone || "UTC";
  return { today: todayInTimeZone(timeZone), timeZone };
}

export async function reportPageContext(sb: SupabaseClient): Promise<ReportPageContext> {
  const [entity, currencies, settings, span] = await Promise.all([
    resolveActiveCompany(),
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
    postedEntryDateSpan(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  const timeZone = settings?.time_zone || "UTC";
  const today = todayInTimeZone(timeZone);
  return {
    companyName: entity.active?.dbaName || entity.active?.legalName || settings?.legal_name || "Company name not set",
    isSample: entity.active?.isSample ?? false,
    currencyCode: base?.code ?? "USD",
    decimals: base?.decimal_places ?? 2,
    today,
    timeZone,
    presets: {
      today,
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
      firstEntryDate: span.first,
      lastEntryDate: span.last,
    },
  };
}
```

- [ ] **Step 2: Create `ctyhp-accounting/lib/services/party-reports.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProfitAndLoss, type LedgerBalance } from "@/lib/domain/reports";
import {
  openDocuments,
  partyBalances,
  type DocumentAmount,
  type OpenDocumentsReport,
  type OpenItemRow,
  type PartyBalancesReport,
} from "@/lib/domain/open-items";
import { partyActivity, NO_CUSTOMER, NO_VENDOR, type PartyActivityReport, type PartyLedgerLine } from "@/lib/domain/party-activity";
import { tieOut, type TieOut } from "@/lib/domain/tie-out";
import { getLedgerBalances } from "./reports";
import { readAllPages } from "./paging";

/**
 * The reports about customers and vendors: what is open with each, and what
 * each was sold or spent in a period. Read-only; every list is paged past
 * PostgREST's thousand-row cap.
 */
export class PartyReportError extends Error {}

const fail = (message: string) => new PartyReportError(message);

type Side = "receivable" | "payable";

const SIDE = {
  receivable: {
    rpc: "acc_ar_ageing",
    partyId: "customer_id",
    partyName: "customer_name",
    controlType: "accounts_receivable",
  },
  payable: {
    rpc: "acc_ap_ageing",
    partyId: "vendor_id",
    partyName: "vendor_name",
    controlType: "accounts_payable",
  },
} as const;

/**
 * The open-item list the aging reports read, every row of it. The function
 * orders nothing itself, so the read orders it — by document type and number,
 * which are unique together, then party and date — before paging it.
 */
async function openItemRows(sb: SupabaseClient, side: Side, asOf: string): Promise<OpenItemRow[]> {
  const s = SIDE[side];
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc(s.rpc, { p_as_of: asOf })
        .order("doc_type")
        .order("doc_number")
        .order(s.partyId)
        .order("doc_date")
        .range(from, to),
    fail,
  );
  return rows.map((r) => ({
    partyId: r[s.partyId] as string,
    partyName: r[s.partyName] as string,
    docType: r.doc_type as string,
    docNumber: (r.doc_number as string | null) ?? null,
    docDate: r.doc_date as string,
    dueDate: r.due_date as string,
    balanceMinor: Number(r.balance_minor),
  }));
}

/**
 * The control account's balance, signed the way the list is: what customers
 * owe is debit-positive, what is owed to vendors credit-positive. Read as of
 * today, as the aging reports read it — the list is today's open position,
 * whatever date its documents are cut off at.
 */
async function controlBalance(sb: SupabaseClient, side: Side, today: string): Promise<number> {
  const balances = await getLedgerBalances(sb, null, today);
  const net = balances
    .filter((row) => row.accountType === SIDE[side].controlType)
    .reduce((sum, row) => sum + (row.debitBase - row.creditBase), 0);
  return side === "receivable" ? net : -net;
}

/** What each open invoice (or bill) was for in the first place, by its number. */
async function documentAmounts(
  sb: SupabaseClient,
  side: Side,
  asOf: string,
): Promise<Map<string, DocumentAmount>> {
  const table = side === "receivable" ? "acc_invoice" : "acc_bill";
  const number = side === "receivable" ? "invoice_number" : "bill_number";
  const date = side === "receivable" ? "issue_date" : "bill_date";
  const open = side === "receivable" ? ["issued", "partial"] : ["open", "partial"];
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from(table)
        .select(`id,${number},total_minor,balance_due_minor`)
        .in("status", open)
        .gt("balance_due_minor", 0)
        .lte(date, asOf)
        .order("id")
        .range(from, to),
    fail,
  );
  const amounts = new Map<string, DocumentAmount>();
  for (const r of rows) {
    const key = r[number] as string | null;
    if (!key) continue;
    amounts.set(key, {
      number: key,
      totalMinor: Number(r.total_minor),
      balanceMinor: Number(r.balance_due_minor),
    });
  }
  return amounts;
}

export interface OpenDocumentsResult {
  report: OpenDocumentsReport;
  /** The aging total beside the control account. */
  control: TieOut;
}

async function openDocumentsFor(sb: SupabaseClient, side: Side, asOf: string, today: string): Promise<OpenDocumentsResult> {
  const [rows, amounts, controlMinor] = await Promise.all([
    openItemRows(sb, side, asOf),
    documentAmounts(sb, side, asOf),
    controlBalance(sb, side, today),
  ]);
  const report = openDocuments(rows, asOf, side === "receivable" ? "invoice" : "bill", amounts);
  return { report, control: tieOut(report.agingTotalMinor, controlMinor) };
}

export function getOpenInvoices(sb: SupabaseClient, asOf: string, today: string): Promise<OpenDocumentsResult> {
  return openDocumentsFor(sb, "receivable", asOf, today);
}

export function getUnpaidBills(sb: SupabaseClient, asOf: string, today: string): Promise<OpenDocumentsResult> {
  return openDocumentsFor(sb, "payable", asOf, today);
}

export interface PartyBalancesResult {
  report: PartyBalancesReport;
  control: TieOut;
}

async function balancesFor(sb: SupabaseClient, side: Side, asOf: string, today: string): Promise<PartyBalancesResult> {
  const [rows, controlMinor] = await Promise.all([openItemRows(sb, side, asOf), controlBalance(sb, side, today)]);
  const report = partyBalances(rows);
  return { report, control: tieOut(report.totalMinor, controlMinor) };
}

export function getCustomerBalances(sb: SupabaseClient, asOf: string, today: string): Promise<PartyBalancesResult> {
  return balancesFor(sb, "receivable", asOf, today);
}

export function getVendorBalances(sb: SupabaseClient, asOf: string, today: string): Promise<PartyBalancesResult> {
  return balancesFor(sb, "payable", asOf, today);
}

// --- Sales by customer, expenses by vendor --------------------------------------

interface PartyRef {
  partyId: string | null;
}

/** id → the customer (or vendor) on it, for one document table, every row. */
async function partyOfDocuments(
  sb: SupabaseClient,
  table: string,
  partyColumn: "customer_id" | "vendor_id",
): Promise<Map<string, PartyRef>> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from(table).select(`id,${partyColumn}`).order("id").range(from, to),
    fail,
  );
  return new Map(rows.map((r) => [r.id as string, { partyId: (r[partyColumn] as string | null) ?? null }]));
}

async function partyNames(sb: SupabaseClient, table: "acc_customer" | "acc_vendor"): Promise<Map<string, string>> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from(table).select("id,name").order("id").range(from, to),
    fail,
  );
  return new Map(rows.map((r) => [r.id as string, r.name as string]));
}

interface PostedLine {
  entryId: string;
  accountId: string;
  /** Base currency, debit positive. */
  signedMinor: number;
  sourceId: string | null;
}

/** Every posted line in the period on the given accounts. */
async function postedLines(
  sb: SupabaseClient,
  accountIds: readonly string[],
  from: string,
  to: string,
): Promise<PostedLine[]> {
  if (accountIds.length === 0) return [];
  const rows = await readAllPages<Record<string, unknown>>(
    (start, end) =>
      sb
        .from("acc_journal_line")
        .select("id,account_id,debit_minor,amount_base_minor,journal_entry_id,acc_journal_entry!inner(entry_date,status,source_id)")
        .in("account_id", accountIds as string[])
        .eq("acc_journal_entry.status", "posted")
        .gte("acc_journal_entry.entry_date", from)
        .lte("acc_journal_entry.entry_date", to)
        .order("id")
        .range(start, end),
    fail,
  );
  return rows.map((r) => {
    const entry = r.acc_journal_entry as { source_id: string | null };
    const base = Number(r.amount_base_minor);
    return {
      entryId: r.journal_entry_id as string,
      accountId: r.account_id as string,
      signedMinor: Number(r.debit_minor) > 0 ? base : -base,
      sourceId: entry.source_id ?? null,
    };
  });
}

export interface PartyActivityResult {
  report: PartyActivityReport;
  /** The report's total beside the Profit and Loss's for the same period. */
  proof: TieOut;
}

function accountsOfType(balances: readonly LedgerBalance[], types: readonly string[]): string[] {
  return balances.filter((row) => types.includes(row.accountType)).map((row) => row.accountId);
}

/**
 * Sales by Customer: the income accounts' postings for the period, by the
 * customer on the invoice, credit memo or payment each came from. Its total is
 * the Profit and Loss's Income for the same period.
 */
export async function getSalesByCustomer(sb: SupabaseClient, from: string, to: string): Promise<PartyActivityResult> {
  const balances = await getLedgerBalances(sb, from, to);
  const incomeIds = accountsOfType(balances, ["income"]);
  const [lines, invoices, creditMemos, payments, names] = await Promise.all([
    postedLines(sb, incomeIds, from, to),
    partyOfDocuments(sb, "acc_invoice", "customer_id"),
    partyOfDocuments(sb, "acc_credit_memo", "customer_id"),
    partyOfDocuments(sb, "acc_payment", "customer_id"),
    partyNames(sb, "acc_customer"),
  ]);
  const ledger: PartyLedgerLine[] = lines.map((line) => {
    const source = line.sourceId;
    const ref = source ? (invoices.get(source) ?? creditMemos.get(source) ?? payments.get(source)) : undefined;
    const partyId = ref?.partyId ?? null;
    return {
      entryId: line.entryId,
      accountId: line.accountId,
      // Income is credit-natural: a sale credits it.
      amountMinor: -line.signedMinor,
      partyId,
      partyName: partyId ? (names.get(partyId) ?? "A customer no longer on file") : null,
      invoiceId: source && invoices.has(source) ? source : null,
    };
  });
  const report = partyActivity(ledger, "invoices", NO_CUSTOMER);
  const income = buildProfitAndLoss(balances).income.total;
  return { report, proof: tieOut(report.totalMinor, income) };
}

/**
 * Expenses by Vendor: the cost of sales, expense and other expense accounts'
 * postings for the period, by the vendor on the bill, expense, vendor credit or
 * bill payment each came from. Its total is the Profit and Loss's cost of sales
 * plus expenses plus other expenses for the same period.
 */
export async function getExpensesByVendor(sb: SupabaseClient, from: string, to: string): Promise<PartyActivityResult> {
  const balances = await getLedgerBalances(sb, from, to);
  const spendIds = accountsOfType(balances, ["cost_of_goods_sold", "expense", "other_expense"]);
  const [lines, bills, expenses, vendorCredits, billPayments, names] = await Promise.all([
    postedLines(sb, spendIds, from, to),
    partyOfDocuments(sb, "acc_bill", "vendor_id"),
    partyOfDocuments(sb, "acc_expense", "vendor_id"),
    partyOfDocuments(sb, "acc_vendor_credit", "vendor_id"),
    partyOfDocuments(sb, "acc_bill_payment", "vendor_id"),
    partyNames(sb, "acc_vendor"),
  ]);
  const ledger: PartyLedgerLine[] = lines.map((line) => {
    const source = line.sourceId;
    const ref = source
      ? (bills.get(source) ?? expenses.get(source) ?? vendorCredits.get(source) ?? billPayments.get(source))
      : undefined;
    const partyId = ref?.partyId ?? null;
    return {
      entryId: line.entryId,
      accountId: line.accountId,
      // Spending is debit-natural.
      amountMinor: line.signedMinor,
      partyId,
      partyName: partyId ? (names.get(partyId) ?? "A vendor no longer on file") : null,
      invoiceId: null,
    };
  });
  const report = partyActivity(ledger, "entryAccounts", NO_VENDOR);
  const pnl = buildProfitAndLoss(balances);
  const expected = pnl.costOfGoodsSold.total + pnl.operatingExpenses.total + pnl.otherExpenses.total;
  return { report, proof: tieOut(report.totalMinor, expected) };
}
```

- [ ] **Step 3: Create `ctyhp-accounting/lib/services/review-reports.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeLog, changeLogDetail, CHANGE_LOG_LIMIT, type ChangeLogEntry, type ChangeLogReport } from "@/lib/domain/change-log";
import { closeLog, type CloseEvent, type ClosePeriod, type CloseLogReport } from "@/lib/domain/close-log";
import {
  reconciliationList,
  type ReconciliationListReport,
  type SignedOffReconciliation,
  type VoidedClearedLine,
} from "@/lib/domain/reconciliation-list";
import { voidedEntries, type ReversedEntry, type VoidedEntriesReport, type VoidedEntry } from "@/lib/domain/voided-entries";
import { searchAudit } from "./access";
import { getDiscrepancies } from "./bankrec";
import { describeAuditActivity } from "./dashboard";
import { PAGE_SIZE, readAllPages } from "./paging";

/**
 * The review reports: reconciliations that were signed off, what changed in
 * the books, the month-end closes, and the entries that were voided or
 * reversed. All read-only; every list is paged past PostgREST's cap.
 */
export class ReviewReportError extends Error {}

const fail = (message: string) => new ReviewReportError(message);

/** User id → the name a report shows: the person's name, or their email when they have none. */
async function actorNames(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await sb.rpc("acc_actor_directory");
  if (error) throw fail(error.message);
  const names = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; email: string | null; full_name: string | null }[]) {
    const name = r.full_name?.trim() || r.email?.trim() || "";
    if (name) names.set(r.id, name);
  }
  return names;
}

// --- Reconciliation Report -------------------------------------------------------

export async function getReconciliationList(sb: SupabaseClient): Promise<ReconciliationListReport> {
  const [sessions, accounts, names] = await Promise.all([
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_statement_reconciliation")
          .select("id,bank_account_id,statement_ending_date,statement_ending_balance_minor,completed_at,completed_by")
          .eq("status", "completed")
          .order("id")
          .range(from, to),
      fail,
    ),
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_bank_account")
          .select("id,bank_name,account_number_masked,acc_account(account_code,name)")
          .order("id")
          .range(from, to),
      fail,
    ),
    actorNames(sb),
  ]);
  const accountName = new Map(
    accounts.map((r) => {
      const gl = r.acc_account as { account_code?: string; name?: string } | null;
      const label = gl?.account_code ? `${gl.account_code} — ${gl.name ?? ""}` : ((r.bank_name as string) ?? "Bank account");
      const masked = r.account_number_masked as string | null;
      return [r.id as string, masked ? `${label} (${masked})` : label] as const;
    }),
  );
  const signedOff: SignedOffReconciliation[] = sessions.map((r) => ({
    id: r.id as string,
    bankAccountId: r.bank_account_id as string,
    bankAccountName: accountName.get(r.bank_account_id as string) ?? "A bank account no longer on file",
    statementEndingDate: r.statement_ending_date as string,
    statementEndingBalanceMinor: Number(r.statement_ending_balance_minor),
    completedAt: (r.completed_at as string | null) ?? null,
    completedByName: r.completed_by ? (names.get(r.completed_by as string) ?? null) : null,
  }));
  // Only accounts with a signed-off reconciliation can have one that stopped agreeing.
  const withSignedOff = [...new Set(signedOff.map((session) => session.bankAccountId))];
  const voided = (await Promise.all(withSignedOff.map((id) => getDiscrepancies(sb, id)))).flat();
  const lost: VoidedClearedLine[] = voided.map((line) => ({
    reconciliationId: line.reconciliationId,
    entryNumber: line.entryNumber ?? "",
    signedMinor: line.signedMinor,
  }));
  return reconciliationList(signedOff, lost);
}

// --- Change Log -------------------------------------------------------------------------

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/**
 * What changed between two dates, newest first, from the audit log. The
 * database refuses anybody without `audit.read`; this does not ask again.
 */
export async function getChangeLog(sb: SupabaseClient, from: string, to: string): Promise<ChangeLogReport> {
  const rows = await searchAudit(sb, { from, to, limit: CHANGE_LOG_LIMIT });
  const entries: ChangeLogEntry[] = rows.map((row) => {
    const activity = describeAuditActivity(row);
    return {
      id: row.id,
      at: row.created_at,
      who: row.actor_email ?? "System",
      what: capitalize(activity.verb.replaceAll("_", " ")),
      record: capitalize(activity.entity),
      reference: activity.reference,
      detail: changeLogDetail(row),
    };
  });
  return changeLog(entries);
}

// --- Month-End Close Log ---------------------------------------------------------------

export async function getCloseLog(sb: SupabaseClient, fiscalYear: number): Promise<CloseLogReport> {
  const periodRows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_accounting_period")
        .select("id,label,period_start,status")
        .eq("fiscal_year", fiscalYear)
        .order("period_start")
        .range(from, to),
    fail,
  );
  const periods: ClosePeriod[] = periodRows.map((r) => ({
    id: r.id as string,
    label: r.label as string,
    periodStart: r.period_start as string,
    status: r.status as ClosePeriod["status"],
  }));
  if (periods.length === 0) return closeLog([], []);
  const [eventRows, names] = await Promise.all([
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_period_event")
          .select("id,period_id,event,reason,actor_id,created_at")
          .in("period_id", periods.map((p) => p.id))
          .order("id")
          .range(from, to),
      fail,
    ),
    actorNames(sb),
  ]);
  const events: CloseEvent[] = eventRows
    .filter((r) => r.event === "close" || r.event === "reopen")
    .map((r) => ({
      periodId: r.period_id as string,
      event: r.event as CloseEvent["event"],
      reason: (r.reason as string | null) ?? "",
      actorName: r.actor_id ? (names.get(r.actor_id as string) ?? null) : null,
      createdAt: r.created_at as string,
    }));
  return closeLog(periods, events);
}

// --- Voided and Reversed Entries ---------------------------------------------------------

/** A day either side, so a moment near midnight in the company's zone is not cut off by UTC. */
function widen(from: string, to: string): { start: string; end: string } {
  const shift = (iso: string, days: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString();
  };
  return { start: shift(from, -1), end: shift(to, 2) };
}

type CountedPage = { data: unknown; error: { message: string } | null; count?: number | null };

/**
 * `readAllPages`, with the pages after the first read side by side. The first
 * page asks for the row count; the rest are fetched eight at a time. Rows added
 * after the count are still read: while a page comes back full, the next is
 * asked for, as `readAllPages` does. Like it, only correct for a totally
 * ordered query.
 */
async function readPagesSideBySide<T>(
  fetchPage: (from: number, to: number, withCount: boolean) => PromiseLike<CountedPage>,
): Promise<T[]> {
  const first = await fetchPage(0, PAGE_SIZE - 1, true);
  if (first.error) throw fail(first.error.message);
  const rows = [...((first.data ?? []) as T[])];
  let last = rows.length;
  const total = first.count ?? 0;
  const starts: number[] = [];
  for (let start = PAGE_SIZE; start < total; start += PAGE_SIZE) starts.push(start);
  for (let i = 0; i < starts.length; i += CHUNKS_IN_FLIGHT) {
    const pages = await Promise.all(starts.slice(i, i + CHUNKS_IN_FLIGHT).map((s) => fetchPage(s, s + PAGE_SIZE - 1, false)));
    for (const page of pages) {
      if (page.error) throw fail(page.error.message);
      const data = (page.data ?? []) as T[];
      rows.push(...data);
      last = data.length;
    }
  }
  for (let start = PAGE_SIZE * (starts.length + 1); last === PAGE_SIZE; start += PAGE_SIZE) {
    const page = await fetchPage(start, start + PAGE_SIZE - 1, false);
    if (page.error) throw fail(page.error.message);
    const data = (page.data ?? []) as T[];
    rows.push(...data);
    last = data.length;
  }
  return rows;
}

/** Ids per request: 200 uuids keep the URL well inside what the gateway takes. */
const ID_CHUNK = 200;
/** Chunks in flight at once. A book that was re-imported can hold thousands of voided entries. */
const CHUNKS_IN_FLIGHT = 8;

/** Entry id → its debits in base currency. */
async function entryAmounts(sb: SupabaseClient, entryIds: readonly string[]): Promise<Map<string, number>> {
  const chunks: string[][] = [];
  for (let i = 0; i < entryIds.length; i += ID_CHUNK) chunks.push(entryIds.slice(i, i + ID_CHUNK));
  const readChunk = (chunk: string[]) =>
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_journal_line")
          .select("id,journal_entry_id,debit_minor,amount_base_minor")
          .in("journal_entry_id", chunk)
          .gt("debit_minor", 0)
          .order("id")
          .range(from, to),
      fail,
    );
  const amounts = new Map<string, number>();
  for (let i = 0; i < chunks.length; i += CHUNKS_IN_FLIGHT) {
    const pages = await Promise.all(chunks.slice(i, i + CHUNKS_IN_FLIGHT).map(readChunk));
    for (const r of pages.flat()) {
      const id = r.journal_entry_id as string;
      amounts.set(id, (amounts.get(id) ?? 0) + Number(r.amount_base_minor));
    }
  }
  return amounts;
}

/**
 * Who voided each document, from the audit log, by the document's id. Only for
 * a reader who may read the audit log; for anybody else the column stays empty
 * rather than reading around the permission.
 */
async function voidedBy(sb: SupabaseClient, from: string, to: string): Promise<Map<string, string>> {
  const rows = await searchAudit(sb, { action: "void", from, to, limit: CHANGE_LOG_LIMIT });
  const by = new Map<string, string>();
  for (const row of rows) if (row.record_id && row.actor_email) by.set(row.record_id, row.actor_email);
  return by;
}

export async function getVoidedEntries(
  sb: SupabaseClient,
  range: { from: string; to: string },
  timeZone: string,
  canReadAudit: boolean,
): Promise<VoidedEntriesReport> {
  const { start, end } = widen(range.from, range.to);
  const voidColumns = "id,entry_number,entry_date,description,voided_at,source_id";
  const [timedVoids, untimedVoids, linkRows, names, auditBy, timedLines, untimedLines] = await Promise.all([
    readPagesSideBySide<Record<string, unknown>>((from, to, withCount) =>
      sb
        .from("acc_journal_entry")
        .select(voidColumns, withCount ? { count: "exact" } : undefined)
        .eq("status", "void")
        .gte("voided_at", start)
        .lt("voided_at", end)
        .order("id")
        .range(from, to),
    ),
    // Voided before the books kept the time: dated by the entry instead.
    readPagesSideBySide<Record<string, unknown>>((from, to, withCount) =>
      sb
        .from("acc_journal_entry")
        .select(voidColumns, withCount ? { count: "exact" } : undefined)
        .eq("status", "void")
        .is("voided_at", null)
        .gte("entry_date", range.from)
        .lte("entry_date", range.to)
        .order("id")
        .range(from, to),
    ),
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb
          .from("acc_journal_reversal_link")
          .select(
            "id,reason,created_by,created_at," +
              "orig:acc_journal_entry!acc_journal_reversal_link_original_entry_id_fkey(id,entry_number,entry_date,description)," +
              "rev:acc_journal_entry!acc_journal_reversal_link_reversal_entry_id_fkey(id,entry_number)",
          )
          .gte("created_at", start)
          .lt("created_at", end)
          .order("id")
          .range(from, to),
      fail,
    ),
    actorNames(sb),
    canReadAudit ? voidedBy(sb, range.from, range.to) : Promise.resolve(new Map<string, string>()),
    // The voided entries' debits, read by the same windows as the entries
    // themselves rather than id by id: a re-imported book can hold thousands.
    readPagesSideBySide<Record<string, unknown>>((from, to, withCount) =>
      sb
        .from("acc_journal_line")
        .select(
          "id,journal_entry_id,amount_base_minor,acc_journal_entry!inner(status,voided_at)",
          withCount ? { count: "exact" } : undefined,
        )
        .gt("debit_minor", 0)
        .eq("acc_journal_entry.status", "void")
        .gte("acc_journal_entry.voided_at", start)
        .lt("acc_journal_entry.voided_at", end)
        .order("id")
        .range(from, to),
    ),
    readPagesSideBySide<Record<string, unknown>>((from, to, withCount) =>
      sb
        .from("acc_journal_line")
        .select(
          "id,journal_entry_id,amount_base_minor,acc_journal_entry!inner(status,voided_at,entry_date)",
          withCount ? { count: "exact" } : undefined,
        )
        .gt("debit_minor", 0)
        .eq("acc_journal_entry.status", "void")
        .is("acc_journal_entry.voided_at", null)
        .gte("acc_journal_entry.entry_date", range.from)
        .lte("acc_journal_entry.entry_date", range.to)
        .order("id")
        .range(from, to),
    ),
  ]);
  const voidRows = [...timedVoids, ...untimedVoids];

  type EntryRef = { id: string; entry_number: string; entry_date?: string; description?: string };
  const links = linkRows.map((r) => ({
    reason: (r.reason as string | null) ?? "",
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
    orig: r.orig as EntryRef,
    rev: r.rev as EntryRef,
  }));
  // A reversed entry is still posted, so its debits are read by its id.
  const amounts = await entryAmounts(sb, links.map((l) => l.orig.id));
  for (const r of [...timedLines, ...untimedLines]) {
    const id = r.journal_entry_id as string;
    amounts.set(id, (amounts.get(id) ?? 0) + Number(r.amount_base_minor));
  }

  const voided: VoidedEntry[] = voidRows.map((r) => ({
    entryId: r.id as string,
    entryNumber: r.entry_number as string,
    entryDate: r.entry_date as string,
    description: (r.description as string | null) ?? "",
    amountMinor: amounts.get(r.id as string) ?? 0,
    voidedAt: (r.voided_at as string | null) ?? null,
    byName: r.source_id ? (auditBy.get(r.source_id as string) ?? null) : null,
  }));
  const reversed: ReversedEntry[] = links.map((link) => ({
    originalEntryId: link.orig.id,
    originalNumber: link.orig.entry_number,
    originalDate: link.orig.entry_date ?? "",
    description: link.orig.description ?? "",
    amountMinor: amounts.get(link.orig.id) ?? 0,
    reversalEntryId: link.rev.id,
    reversalNumber: link.rev.entry_number,
    reason: link.reason,
    reversedAt: link.createdAt,
    byName: link.createdBy ? (names.get(link.createdBy) ?? null) : null,
  }));
  return voidedEntries(voided, reversed, range, timeZone);
}
```

- [ ] **Step 4: Create `ctyhp-accounting/tests/live/reports-wave1.live.ts`** with exactly this content:

```ts
/**
 * The ten reports of wave 1, run against every company's books — read-only.
 *
 * For every company the smoke user belongs to, each report is built from the
 * same reads its screen makes, then held to the report it has to agree with:
 *   - Open Invoices and Customer Balances total the A/R Aging;
 *   - Unpaid Bills and Vendor Balances total the A/P Aging;
 *   - Sales by Customer totals the Profit and Loss's Income, and Expenses by
 *     Vendor its cost of sales plus expenses, for this year and for all dates;
 *   - the review reports run, and what they count matches a direct count.
 * Whether each aging agrees with its control account is printed, not asserted:
 * that is the books' own state, and the A/R Aging screen reports it the same way.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/reports-wave1.live.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { presetRange } from "@/lib/domain/report-presets";
import { getApAging, getArAging } from "@/lib/services/aging";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
import {
  getCustomerBalances,
  getExpensesByVendor,
  getOpenInvoices,
  getSalesByCustomer,
  getUnpaidBills,
  getVendorBalances,
} from "@/lib/services/party-reports";
import { getCloseLog, getReconciliationList, getVoidedEntries } from "@/lib/services/review-reports";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
  timeZone: string;
  fiscalStartMonth: number;
  first: string | null;
  last: string | null;
}

const companies: Company[] = [];

beforeAll(async () => {
  const s = await smokeSession();
  if (!s.session) throw new Error("The smoke sign-in returned no session.");
  const auth = { persistSession: false };
  const headers = { Authorization: `Bearer ${s.session.access_token}` };
  const control = createClient(s.supabaseUrl, s.anonKey, { db: { schema: "onebook" }, auth, global: { headers } });
  const { data, error } = await control.rpc("my_companies");
  if (error) throw new Error(`my_companies: ${error.message}`);
  for (const row of (data ?? []) as { legal_name: string; schema_name: string }[]) {
    const sb = createClient(s.supabaseUrl, s.anonKey, {
      db: { schema: row.schema_name },
      auth,
      global: { headers },
    }) as unknown as SupabaseClient;
    const [settings, span] = await Promise.all([getCurrentCompanySettings(sb), postedEntryDateSpan(sb)]);
    const timeZone = settings?.time_zone ?? "UTC";
    companies.push({
      name: row.schema_name,
      sb,
      today: todayInTimeZone(timeZone),
      timeZone,
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
      first: span.first,
      last: span.last,
    });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

describe("wave 1 reports on every company's books", () => {
  it("Open Invoices and Customer Balances total the A/R Aging", async () => {
    for (const c of companies) {
      const [open, balances, aging] = await Promise.all([
        getOpenInvoices(c.sb, c.today, c.today),
        getCustomerBalances(c.sb, c.today, c.today),
        getArAging(c.sb, c.today, { reconcileAsOf: c.today }),
      ]);
      console.log(
        `${c.name}: open invoices ${open.report.lines.length}, credits ${open.report.creditsMinor}, ` +
          `aging ${aging.total}, control ${open.control.expectedMinor} (${open.control.agrees ? "agrees" : `out by ${open.control.differenceMinor}`})`,
      );
      expect(open.report.agingTotalMinor, c.name).toBe(aging.total);
      expect(balances.report.totalMinor, c.name).toBe(aging.total);
      expect(open.control.expectedMinor, c.name).toBe(aging.controlBalanceMinor);
      expect(open.report.lines.every((line) => line.amountMinor !== null), `${c.name}: every open invoice has its amount`).toBe(true);
    }
  });

  it("Unpaid Bills and Vendor Balances total the A/P Aging", async () => {
    for (const c of companies) {
      const [open, balances, aging] = await Promise.all([
        getUnpaidBills(c.sb, c.today, c.today),
        getVendorBalances(c.sb, c.today, c.today),
        getApAging(c.sb, c.today, { reconcileAsOf: c.today }),
      ]);
      console.log(
        `${c.name}: unpaid bills ${open.report.lines.length}, aging ${aging.total}, ` +
          `control ${open.control.expectedMinor} (${open.control.agrees ? "agrees" : `out by ${open.control.differenceMinor}`})`,
      );
      expect(open.report.agingTotalMinor, c.name).toBe(aging.total);
      expect(balances.report.totalMinor, c.name).toBe(aging.total);
      expect(open.control.expectedMinor, c.name).toBe(aging.controlBalanceMinor);
      expect(open.report.lines.every((line) => line.amountMinor !== null), `${c.name}: every unpaid bill has its amount`).toBe(true);
    }
  });

  it("Sales by Customer and Expenses by Vendor tie to the Profit and Loss", async () => {
    for (const c of companies) {
      const ctx = { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last };
      for (const preset of ["year", "all"] as const) {
        const { from, to } = presetRange(preset, ctx);
        const [sales, spend] = await Promise.all([getSalesByCustomer(c.sb, from, to), getExpensesByVendor(c.sb, from, to)]);
        const named = (lines: { partyId: string | null }[]) => lines.filter((line) => line.partyId !== null).length;
        console.log(
          `${c.name} ${preset}: sales ${sales.report.totalMinor} over ${named(sales.report.lines)} customers ` +
            `(${sales.report.unattributedCount} lines with none); spend ${spend.report.totalMinor} over ` +
            `${named(spend.report.lines)} vendors (${spend.report.unattributedCount} lines with none)`,
        );
        expect(sales.proof.agrees, `${c.name} ${preset}: sales out by ${sales.proof.differenceMinor}`).toBe(true);
        expect(spend.proof.agrees, `${c.name} ${preset}: spend out by ${spend.proof.differenceMinor}`).toBe(true);
      }
    }
  });

  it("the review reports run, and count what the books hold", async () => {
    for (const c of companies) {
      const fiscalYear = Number(presetRange("year", { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last }).from.slice(0, 4));
      const started = Date.now();
      const [recs, close, voided] = await Promise.all([
        getReconciliationList(c.sb),
        getCloseLog(c.sb, fiscalYear),
        getVoidedEntries(c.sb, { from: c.first ?? c.today, to: c.today }, c.timeZone, false),
      ]);
      const [{ count: completed }, { count: voidCount }, { count: reversalCount }] = await Promise.all([
        c.sb.from("acc_statement_reconciliation").select("id", { count: "exact", head: true }).eq("status", "completed"),
        c.sb.from("acc_journal_entry").select("id", { count: "exact", head: true }).eq("status", "void"),
        c.sb.from("acc_journal_reversal_link").select("id", { count: "exact", head: true }),
      ]);
      console.log(
        `${c.name}: reconciliations ${recs.lines.length} (${recs.outOfAgreement} out), close log ${close.lines.length} lines ` +
          `(${close.closedMonths} closed, ${close.reopenings} reopenings), voided ${voided.voided}, reversed ${voided.reversed}`,
      );
      expect(recs.lines.length, c.name).toBe(completed ?? 0);
      expect(voided.voided, c.name).toBe(voidCount ?? 0);
      console.log(`${c.name}: voided entries read in ${Date.now() - started} ms`);
      expect(voided.reversed, c.name).toBe(reversalCount ?? 0);
      expect(close.lines.length, c.name).toBeGreaterThanOrEqual(close.closedMonths);
    }
  });
});
```

- [ ] **Step 5: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/services/report-context.ts" "lib/services/party-reports.ts" "lib/services/review-reports.ts" "tests/live/reports-wave1.live.ts"
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files.

- [ ] **Step 6: Run the live check (read-only, every company)**

```bash
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/reports-wave1.live.ts --reporter=verbose
```

Expected: 4 tests pass. It signs in as the smoke user (`scripts/smoke-environment.mjs`) and only selects or calls read-only RPCs. The printed lines show, per company, whether each aging agrees with its control account — one company (books loaded as journal entries) is out by its whole control balance on both sides; that is the books' state and is printed, not asserted. The voided-entries read of the company with about 7,000 voided entries takes several seconds; that is expected. Report the full output in your report file.

- [ ] **Step 7: Commit**

```bash
git add "lib/services/report-context.ts" "lib/services/party-reports.ts" "lib/services/review-reports.ts" "tests/live/reports-wave1.live.ts"
git commit -m "feat(reports): read the ten reports, paged, with their proof lines"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; do not mention Claude in the message.

---

### Task 4: The report frame, and the six customer and vendor reports

**Files:**
- Create: `ctyhp-accounting/components/reports/SimpleReport.tsx`
- Create: `ctyhp-accounting/components/reports/ProofLine.tsx`
- Create: `ctyhp-accounting/components/reports/OpenDocumentsReport.tsx`
- Create: `ctyhp-accounting/components/reports/PartyBalancesReport.tsx`
- Create: `ctyhp-accounting/components/reports/PartyActivityReport.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/open-invoices/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/open-invoices/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/unpaid-bills/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/unpaid-bills/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/customer-balances/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/customer-balances/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/vendor-balances/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/vendor-balances/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/sales-by-customer/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/sales-by-customer/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/expenses-by-vendor/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/expenses-by-vendor/page.tsx`

**Interfaces:**
- Consumes (Tasks 1–3): `ReportWhen`, `ReportRunResult`, `checkWhen`, `reportFailure`, the sheets, `tieOut` results, the six `get…` reads, `reportPageContext`, `companyClock`. Existing UI: `ReportPaper`, `StatRow`, `ReportFoot`, `reportPaperStyles` (`.rpt`, `.r`, `.rGrand`, `.muted`, `.mono`, `.negative`, `.foot`), `ReportExportButtons`, `FilterBar`, `DataTable`, `flexColumn`, `clientTablePagination`, `pageSizeOptionsFor`, `COLUMN`, `formatMoney`, `PERIOD_PRESETS`, `presetRange`, `rangeText`, `longDate`, `shortDate`, `printReport`, `watchReportPrinting`, `downloadTextFile`, `csvFromExportSheet`, `tsvFromExportSheet`, `PageHeader`, `ReportEntityBadge`.
- Produces: `SimpleReport<T>` with `SimpleReportPeriod` (`asOf` | `range` | `fiscalYear` | `none`), `ProofLine`, `OpenDocumentsReport`, `PartyBalancesReport`, `PartyActivityReport`, `TOTALS_STYLE`; six routes under `/reports/`.

- [ ] **Step 1: Create `ctyhp-accounting/components/reports/SimpleReport.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, App, Button, DatePicker, InputNumber, Select, Space, Spin } from "antd";
import { CopyOutlined, PrinterOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { ReportPaper, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { downloadTextFile } from "@/lib/client/download";
import { printReport, watchReportPrinting } from "@/lib/client/print-report";
import { csvFromExportSheet, tsvFromExportSheet, type ReportExportSheet } from "@/lib/domain/report-export";
import {
  PERIOD_PRESETS,
  longDate,
  presetRange,
  rangeText,
  type PeriodPreset,
  type PresetContext,
} from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";

/** How a report is dated: as of a day, over a period, by fiscal year, or not at all. */
export type SimpleReportPeriod =
  | { kind: "asOf"; today: string }
  | { kind: "range"; ctx: PresetContext; preset: Exclude<PeriodPreset, "custom"> }
  | { kind: "fiscalYear"; current: number }
  | { kind: "none"; today: string; caption: string };

export interface SimpleReportProps<T> {
  companyName: string;
  /** The report's printed heading. */
  title: string;
  currencyCode: string;
  period: SimpleReportPeriod;
  /** The page's server action. */
  load: (when: ReportWhen) => Promise<ReportRunResult<T>>;
  /** What the screen shows of the data — the filters the page keeps for itself. */
  view?: (data: T) => T;
  /** What Copy, CSV, PDF and Excel hand over; built from the same view as the screen. */
  sheet: (data: T, when: ReportWhen) => ReportExportSheet;
  /** The report itself, on the paper. */
  render: (data: T, when: ReportWhen) => ReactNode;
  /** Filters of the page's own, beside the dates. */
  filters?: ReactNode;
  /** What the spinner says while the report is run. */
  runningText?: string;
}

function initialWhen(period: SimpleReportPeriod): ReportWhen {
  switch (period.kind) {
    case "asOf":
      return { from: null, to: period.today, fiscalYear: null };
    case "range": {
      const range = presetRange(period.preset, period.ctx);
      return { from: range.from, to: range.to, fiscalYear: null };
    }
    case "fiscalYear":
      return { from: null, to: "", fiscalYear: period.current };
    case "none":
      return { from: null, to: period.today, fiscalYear: null };
  }
}

function caption(period: SimpleReportPeriod, when: ReportWhen): string {
  switch (period.kind) {
    case "asOf":
      return `As of ${longDate(when.to)}`;
    case "range":
      return rangeText(when.from, when.to);
    case "fiscalYear":
      return `Fiscal year ${when.fiscalYear}`;
    case "none":
      return period.caption;
  }
}

/**
 * One report on paper, the way the client's prototype lays every report out:
 * the dates on the left of a bar, Run, then Copy, CSV, PDF, Excel and Print on
 * the right; under it the report on a sheet headed by the company, the
 * report's name and its dates. Runs once on arrival, then whenever a period is
 * chosen or Run is pressed. Every action hands over what the screen shows.
 */
export default function SimpleReport<T>(props: SimpleReportProps<T>) {
  const { message } = App.useApp();
  const { period, load, view, sheet: buildSheet } = props;
  const first = useMemo(() => initialWhen(period), [period]);

  const [preset, setPreset] = useState<PeriodPreset>(period.kind === "range" ? period.preset : "custom");
  const [draft, setDraft] = useState<ReportWhen>(first);
  const [ran, setRan] = useState<ReportWhen>(first);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchReportPrinting(), []);

  const run = useCallback(
    async (when: ReportWhen) => {
      if (when.from && when.from > when.to) {
        setError("The start date is after the end date.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await load(when);
        if (!result.ok || result.data === undefined) {
          setError(result.error ?? "The report could not be produced.");
          return;
        }
        setData(result.data);
        setRan(when);
      } catch {
        setError("The report could not be produced. Check the connection and run it again.");
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(first);
    // Run once on arrival; afterwards a period choice or Run runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => (data === null ? null : view ? view(data) : data), [data, view]);
  const sheet = useMemo(() => (shown === null ? null : buildSheet(shown, ran)), [shown, ran, buildSheet]);

  const choosePreset = (key: PeriodPreset) => {
    setPreset(key);
    if (key === "custom" || period.kind !== "range") return;
    const range = presetRange(key, period.ctx);
    const next = { from: range.from, to: range.to, fiscalYear: null };
    setDraft(next);
    void run(next);
  };

  const copy = async () => {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(tsvFromExportSheet(sheet));
      message.success("Copied. Paste it into a spreadsheet and the columns stay.");
    } catch {
      message.error("The browser would not let this page copy. Use CSV instead.");
    }
  };

  const idle = !sheet || loading;
  const label = (text: string) => <span className={styles.muted}>{text}</span>;

  const paper = (
    <div className="report-print-area">
      <ReportPaper companyName={props.companyName} title={props.title} range={caption(period, ran)} currencyCode={props.currencyCode}>
        {shown !== null ? (
          props.render(shown, ran)
        ) : (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            {loading ? (
              <Space orientation="vertical" size={12}>
                <Spin size="large" />
                <span className={styles.muted}>{props.runningText ?? "Running the report…"}</span>
              </Space>
            ) : (
              <span className={styles.muted}>The report has not been run.</span>
            )}
          </div>
        )}
      </ReportPaper>
    </div>
  );

  return (
    <div>
      <FilterBar
        ariaLabel="Report dates, filters and exports"
        actions={
          <Space wrap>
            <Button icon={<CopyOutlined />} disabled={idle} onClick={() => void copy()}>
              Copy this report
            </Button>
            <Button disabled={idle} onClick={() => sheet && downloadTextFile(`${sheet.fileName}.csv`, csvFromExportSheet(sheet))}>
              CSV
            </Button>
            {sheet ? <ReportExportButtons sheet={sheet} disabled={loading} /> : null}
            <Button icon={<PrinterOutlined />} disabled={idle} onClick={printReport}>
              Print
            </Button>
          </Space>
        }
      >
        {period.kind === "range" ? (
          <>
            <Select<PeriodPreset>
              aria-label="Period"
              value={preset}
              onChange={choosePreset}
              options={PERIOD_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
              style={{ width: 150 }}
            />
            <DatePicker
              aria-label="From"
              prefix={label("From")}
              value={draft.from ? dayjs(draft.from) : null}
              allowClear={false}
              onChange={(d) => {
                if (!d) return;
                setDraft({ ...draft, from: d.format("YYYY-MM-DD") });
                setPreset("custom");
              }}
            />
            <DatePicker
              aria-label="To"
              prefix={label("To")}
              value={dayjs(draft.to)}
              allowClear={false}
              onChange={(d) => {
                if (!d) return;
                setDraft({ ...draft, to: d.format("YYYY-MM-DD") });
                setPreset("custom");
              }}
            />
          </>
        ) : null}
        {period.kind === "asOf" ? (
          <DatePicker
            aria-label="As of"
            prefix={label("As of")}
            value={dayjs(draft.to)}
            allowClear={false}
            onChange={(d) => d && setDraft({ ...draft, to: d.format("YYYY-MM-DD") })}
          />
        ) : null}
        {period.kind === "fiscalYear" ? (
          <InputNumber
            aria-label="Fiscal year"
            prefix={label("FY")}
            min={2000}
            max={2100}
            value={draft.fiscalYear ?? period.current}
            onChange={(value) => setDraft({ ...draft, fiscalYear: Number(value ?? period.current) })}
            style={{ width: 120 }}
          />
        ) : null}
        {props.filters}
        <Button type="primary" onClick={() => void run(draft)} loading={loading}>
          Run
        </Button>
      </FilterBar>

      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}

      {shown !== null && loading ? (
        <Spin spinning description="Running the report again…">
          {paper}
        </Spin>
      ) : (
        paper
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `ctyhp-accounting/components/reports/ProofLine.tsx`** with exactly this content:

```tsx
"use client";

import type { ReactNode } from "react";
import { Alert } from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";
import { reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import type { TieOut } from "@/lib/domain/tie-out";

/**
 * A report's proof line, under its total: what the total has to equal, and
 * either that it does or by how much it does not. A gap is shown as a warning,
 * with what usually causes it, never smoothed over.
 */
export default function ProofLine({
  against,
  tie,
  money,
  whenOut,
}: {
  /** What the total is held to: "the A/R control account", "Income on the Profit and Loss". */
  against: string;
  tie: TieOut;
  money: (minor: number) => string;
  /** What usually causes a gap, said under the warning. */
  whenOut: ReactNode;
}) {
  if (tie.agrees) {
    return (
      <div className={styles.foot}>
        <CheckCircleOutlined aria-hidden="true" style={{ marginInlineEnd: 6 }} />
        The total equals {against}: {money(tie.expectedMinor)}.
      </div>
    );
  }
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginTop: 16 }}
      title={`The total does not equal ${against} (${money(tie.expectedMinor)}): it is out by ${money(tie.differenceMinor)}.`}
      description={whenOut}
    />
  );
}
```

- [ ] **Step 3: Create `ctyhp-accounting/components/reports/OpenDocumentsReport.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useState } from "react";
import { Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import ProofLine from "@/components/reports/ProofLine";
import { StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { ageLabel, openDocumentsSheet, type OpenDocumentLine } from "@/lib/domain/open-items";
import { shortDate } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import type { OpenDocumentsResult } from "@/lib/services/party-reports";

const PAGE_SIZE = 50;

/** A short totals block, right-aligned under the list, in the statements' ruled style. */
export const TOTALS_STYLE = { width: "auto", minWidth: 360, marginLeft: "auto", marginTop: 16 } as const;

/**
 * Open Invoices and Unpaid Bills: every invoice (or bill) still open on the
 * as-of date, by customer (or vendor) and due date, then what credits take
 * off, the aging total, and whether it agrees with the control account.
 */
export default function OpenDocumentsReport({
  kind,
  companyName,
  currencyCode,
  decimals,
  today,
  load,
}: {
  kind: "invoice" | "bill";
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<OpenDocumentsResult>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const invoices = kind === "invoice";
  const sheet = useCallback(
    (data: OpenDocumentsResult, when: ReportWhen) =>
      openDocumentsSheet(data.report, kind, { companyName, asOf: when.to, currencyCode, baseDecimals: decimals }),
    [kind, companyName, currencyCode, decimals],
  );

  return (
    <SimpleReport<OpenDocumentsResult>
      companyName={companyName}
      title={invoices ? "Open Invoices" : "Unpaid Bills"}
      currencyCode={currencyCode}
      period={{ kind: "asOf", today }}
      load={load}
      sheet={sheet}
      runningText={invoices ? "Reading the open invoices…" : "Reading the unpaid bills…"}
      render={({ report, control }) => {
        const overdue = report.lines.filter((line) => line.daysPastDue > 0).reduce((sum, line) => sum + line.openMinor, 0);
        return (
          <>
            <StatRow
              items={[
                { label: invoices ? "Open invoices" : "Unpaid bills", value: report.lines.length.toLocaleString("en-US") },
                { label: "Open balance", value: money(report.documentsMinor) },
                { label: "Past due", value: money(overdue), danger: overdue > 0 },
              ]}
            />
            <DataTable<OpenDocumentLine>
              rowKey="key"
              dataSource={report.lines}
              pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
              emptyTitle={invoices ? "No open invoices" : "No unpaid bills"}
              emptyDescription={invoices ? "Every invoice dated by this day is paid." : "Every bill dated by this day is paid."}
              columns={[
                { title: "Date", dataIndex: "docDate", width: COLUMN.DATE + 20, render: (d: string) => shortDate(d) },
                { title: "Num", dataIndex: "docNumber", width: COLUMN.CODE, render: (n: string | null) => <span className={styles.mono}>{n ?? "—"}</span> },
                flexColumn<OpenDocumentLine>({ title: invoices ? "Customer" : "Vendor", dataIndex: "partyName" }),
                { title: "Due", dataIndex: "dueDate", width: COLUMN.DATE + 20, render: (d: string) => shortDate(d) },
                {
                  title: "Age",
                  dataIndex: "daysPastDue",
                  width: COLUMN.STATUS,
                  render: (days: number) => (
                    <Tag color={days <= 0 ? "green" : days > 60 ? "red" : "orange"}>{ageLabel(days)}</Tag>
                  ),
                },
                {
                  title: "Amount",
                  dataIndex: "amountMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (minor: number | null) => (minor === null ? "—" : money(minor)),
                },
                {
                  title: "Open balance",
                  dataIndex: "openMinor",
                  width: COLUMN.MONEY_WIDE,
                  align: "right",
                  render: (minor: number) => money(minor),
                },
              ]}
            />
            <table className={styles.rpt} style={TOTALS_STYLE} aria-label="Totals">
              <tbody>
                <tr>
                  <td>{invoices ? "Total open invoices" : "Total unpaid bills"}</td>
                  <td className={styles.r}>{money(report.documentsMinor)}</td>
                </tr>
                <tr>
                  <td>Credits and unapplied payments</td>
                  <td className={styles.r}>{money(report.creditsMinor)}</td>
                </tr>
                <tr className={styles.rGrand}>
                  <td>{invoices ? "A/R Aging total" : "A/P Aging total"}</td>
                  <td className={styles.r}>{money(report.agingTotalMinor)}</td>
                </tr>
              </tbody>
            </table>
            <ProofLine
              against={invoices ? "the A/R control account" : "the A/P control account"}
              tie={control}
              money={money}
              whenOut={
                invoices
                  ? "An entry posted straight to the receivables account, with no invoice, credit memo or payment behind it, moves the account but not this list. The A/R Aging shows the same gap."
                  : "An entry posted straight to the payables account, with no bill, vendor credit or payment behind it, moves the account but not this list. The A/P Aging shows the same gap."
              }
            />
          </>
        );
      }}
    />
  );
}
```

- [ ] **Step 4: Create `ctyhp-accounting/components/reports/PartyBalancesReport.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import { TOTALS_STYLE } from "@/components/reports/OpenDocumentsReport";
import ProofLine from "@/components/reports/ProofLine";
import { StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { partyBalancesSheet, type PartyBalanceLine } from "@/lib/domain/open-items";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import type { PartyBalancesResult } from "@/lib/services/party-reports";

const PAGE_SIZE = 50;

/**
 * Customer Balance Summary and Vendor Balance Summary: what each customer owes
 * (or each vendor is owed) on the as-of date, credits netted, then the total
 * and whether it agrees with the control account.
 */
export default function PartyBalancesReport({
  kind,
  companyName,
  currencyCode,
  decimals,
  today,
  load,
}: {
  kind: "customer" | "vendor";
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<PartyBalancesResult>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const customers = kind === "customer";
  const sheet = useCallback(
    (data: PartyBalancesResult, when: ReportWhen) =>
      partyBalancesSheet(data.report, kind, { companyName, asOf: when.to, currencyCode, baseDecimals: decimals }),
    [kind, companyName, currencyCode, decimals],
  );

  return (
    <SimpleReport<PartyBalancesResult>
      companyName={companyName}
      title={customers ? "Customer Balance Summary" : "Vendor Balance Summary"}
      currencyCode={currencyCode}
      period={{ kind: "asOf", today }}
      load={load}
      sheet={sheet}
      runningText="Reading the balances…"
      render={({ report, control }) => (
        <>
          <StatRow
            items={[
              { label: customers ? "Customers with a balance" : "Vendors with a balance", value: report.lines.length.toLocaleString("en-US") },
              { label: "Total", value: money(report.totalMinor) },
            ]}
          />
          <DataTable<PartyBalanceLine>
            rowKey="partyId"
            dataSource={report.lines}
            pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
            emptyTitle={customers ? "No customer owes anything" : "Nothing is owed to any vendor"}
            emptyDescription="Every document dated by this day is settled."
            columns={[
              flexColumn<PartyBalanceLine>({ title: customers ? "Customer" : "Vendor", dataIndex: "partyName" }),
              {
                title: "Balance",
                dataIndex: "balanceMinor",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (minor: number) => <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>,
              },
            ]}
          />
          <table className={styles.rpt} style={TOTALS_STYLE} aria-label="Total">
            <tbody>
              <tr className={styles.rGrand}>
                <td>Total</td>
                <td className={styles.r}>{money(report.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
          <ProofLine
            against={customers ? "the A/R control account" : "the A/P control account"}
            tie={control}
            money={money}
            whenOut={
              customers
                ? "An entry posted straight to the receivables account, with no invoice, credit memo or payment behind it, moves the account but not these balances. The A/R Aging shows the same gap."
                : "An entry posted straight to the payables account, with no bill, vendor credit or payment behind it, moves the account but not these balances. The A/P Aging shows the same gap."
            }
          />
        </>
      )}
    />
  );
}
```

- [ ] **Step 5: Create `ctyhp-accounting/components/reports/PartyActivityReport.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useState } from "react";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import { TOTALS_STYLE } from "@/components/reports/OpenDocumentsReport";
import ProofLine from "@/components/reports/ProofLine";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { partyActivitySheet, type PartyActivityLine } from "@/lib/domain/party-activity";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import type { PartyActivityResult } from "@/lib/services/party-reports";

const PAGE_SIZE = 50;

const percent = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

/**
 * Sales by Customer Summary and Expenses by Vendor Summary: the period's income
 * (or spending) by who it was with, largest first, with the lines no customer
 * or vendor document stands behind on a row of their own — so the total is the
 * Profit and Loss's, and the proof line says so.
 */
export default function PartyActivityReport({
  kind,
  companyName,
  currencyCode,
  decimals,
  presets,
  load,
}: {
  kind: "sales" | "expenses";
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  load: (when: ReportWhen) => Promise<ReportRunResult<PartyActivityResult>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sales = kind === "sales";
  const sheet = useCallback(
    (data: PartyActivityResult, when: ReportWhen) =>
      partyActivitySheet(data.report, kind, { companyName, from: when.from ?? when.to, to: when.to, currencyCode, baseDecimals: decimals }),
    [kind, companyName, currencyCode, decimals],
  );

  return (
    <SimpleReport<PartyActivityResult>
      companyName={companyName}
      title={sales ? "Sales by Customer Summary" : "Expenses by Vendor Summary"}
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "year" }}
      load={load}
      sheet={sheet}
      runningText={sales ? "Adding up the sales…" : "Adding up the spending…"}
      render={({ report, proof }) => (
        <>
          <StatRow
            items={[
              {
                label: sales ? "Customers" : "Vendors",
                value: report.lines.filter((line) => line.partyId !== null).length.toLocaleString("en-US"),
              },
              { label: sales ? "Sales" : "Spending", value: money(report.totalMinor) },
            ]}
          />
          <DataTable<PartyActivityLine>
            rowKey={(line) => line.partyId ?? "none"}
            dataSource={report.lines}
            pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
            emptyTitle={sales ? "No sales in this period" : "No spending in this period"}
            emptyDescription="Widen the dates."
            columns={[
              flexColumn<PartyActivityLine>({
                title: sales ? "Customer" : "Vendor",
                key: "party",
                render: (_: unknown, line: PartyActivityLine) =>
                  line.partyId ? line.partyName : <span className={styles.muted}>{line.partyName}</span>,
              }),
              {
                title: sales ? "Documents" : "Entries",
                key: "count",
                width: COLUMN.QTY + 20,
                align: "right",
                // Postings with no customer have no invoice to count: a dash, not a zero.
                render: (_: unknown, line: PartyActivityLine) => (sales && line.partyId === null ? "—" : line.count),
              },
              {
                title: "Total",
                dataIndex: "totalMinor",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (minor: number) => <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>,
              },
              {
                title: sales ? "% of sales" : "% of spend",
                dataIndex: "percent",
                width: COLUMN.QTY + 12,
                align: "right",
                render: (value: number | null) => <span className={styles.muted}>{percent(value)}</span>,
              },
            ]}
          />
          <table className={styles.rpt} style={TOTALS_STYLE} aria-label="Total">
            <tbody>
              <tr className={styles.rGrand}>
                <td>Total</td>
                <td className={styles.r}>{money(report.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
          <ProofLine
            against={sales ? "Income on the Profit and Loss" : "cost of sales and expenses on the Profit and Loss"}
            tie={proof}
            money={money}
            whenOut="Run the Profit and Loss for the same dates; the two read the same posted entries, so a gap is a fault in this report. Please report it."
          />
          <ReportFoot>
            {sales ? (
              <>
                <strong>How it counts.</strong> Every posting to an income account in the period, in base currency, so
                sales tax is never in it. A posting from an invoice, credit memo or customer payment counts for that
                customer; Documents counts their invoices. Postings from anything else — a bank deposit coded to income,
                a journal entry — are on the line {"“(No customer)”"}.
              </>
            ) : (
              <>
                <strong>How it counts.</strong> Every posting to a cost of sales, expense or other expense account in the
                period, in base currency. A posting from a bill, expense, vendor credit or bill payment counts for that
                vendor; Entries counts each entry once per account it touches. Postings from anything else — bank lines
                coded to an expense, journal entries, depreciation — are on the line {"“(No vendor)”"}.
              </>
            )}
          </ReportFoot>
        </>
      )}
    />
  );
}
```

- [ ] **Step 6: Create `ctyhp-accounting/app/(app)/reports/open-invoices/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getOpenInvoices, type OpenDocumentsResult } from "@/lib/services/party-reports";
import { companyClock } from "@/lib/services/report-context";

/** Open Invoices: read-only. Nothing this action can be asked to do changes a figure. */
export async function openInvoicesAction(when: ReportWhen): Promise<ReportRunResult<OpenDocumentsResult>> {
  try {
    const checked = checkWhen(when, "asOf");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getOpenInvoices(sb, checked.to, (await companyClock(sb)).today) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 7: Create `ctyhp-accounting/app/(app)/reports/open-invoices/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import OpenDocumentsReport from "@/components/reports/OpenDocumentsReport";
import { openInvoicesAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OpenInvoicesPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Open Invoices"
        description="Every invoice still open, by customer and due date, with how long it is past due."
      />
      <OpenDocumentsReport kind="invoice" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} load={openInvoicesAction} />
    </div>
  );
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/reports/unpaid-bills/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getUnpaidBills, type OpenDocumentsResult } from "@/lib/services/party-reports";
import { companyClock } from "@/lib/services/report-context";

/** Unpaid Bills: read-only. Nothing this action can be asked to do changes a figure. */
export async function unpaidBillsAction(when: ReportWhen): Promise<ReportRunResult<OpenDocumentsResult>> {
  try {
    const checked = checkWhen(when, "asOf");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getUnpaidBills(sb, checked.to, (await companyClock(sb)).today) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/reports/unpaid-bills/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import OpenDocumentsReport from "@/components/reports/OpenDocumentsReport";
import { unpaidBillsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function UnpaidBillsPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Unpaid Bills"
        description="Every bill still unpaid, by vendor and due date, with how long it is past due."
      />
      <OpenDocumentsReport kind="bill" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} load={unpaidBillsAction} />
    </div>
  );
}
```

- [ ] **Step 10: Create `ctyhp-accounting/app/(app)/reports/customer-balances/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getCustomerBalances, type PartyBalancesResult } from "@/lib/services/party-reports";
import { companyClock } from "@/lib/services/report-context";

/** Customer Balance Summary: read-only. Nothing this action can be asked to do changes a figure. */
export async function customerBalancesAction(when: ReportWhen): Promise<ReportRunResult<PartyBalancesResult>> {
  try {
    const checked = checkWhen(when, "asOf");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getCustomerBalances(sb, checked.to, (await companyClock(sb)).today) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 11: Create `ctyhp-accounting/app/(app)/reports/customer-balances/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PartyBalancesReport from "@/components/reports/PartyBalancesReport";
import { customerBalancesAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CustomerBalancesPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Customer Balance Summary"
        description="What each customer owes, with their credits netted, and whether the total agrees with receivables."
      />
      <PartyBalancesReport kind="customer" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} load={customerBalancesAction} />
    </div>
  );
}
```

- [ ] **Step 12: Create `ctyhp-accounting/app/(app)/reports/vendor-balances/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getVendorBalances, type PartyBalancesResult } from "@/lib/services/party-reports";
import { companyClock } from "@/lib/services/report-context";

/** Vendor Balance Summary: read-only. Nothing this action can be asked to do changes a figure. */
export async function vendorBalancesAction(when: ReportWhen): Promise<ReportRunResult<PartyBalancesResult>> {
  try {
    const checked = checkWhen(when, "asOf");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getVendorBalances(sb, checked.to, (await companyClock(sb)).today) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 13: Create `ctyhp-accounting/app/(app)/reports/vendor-balances/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PartyBalancesReport from "@/components/reports/PartyBalancesReport";
import { vendorBalancesAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function VendorBalancesPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Vendor Balance Summary"
        description="What is owed to each vendor, with their credits netted, and whether the total agrees with payables."
      />
      <PartyBalancesReport kind="vendor" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} load={vendorBalancesAction} />
    </div>
  );
}
```

- [ ] **Step 14: Create `ctyhp-accounting/app/(app)/reports/sales-by-customer/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getSalesByCustomer, type PartyActivityResult } from "@/lib/services/party-reports";

/** Sales by Customer Summary: read-only. Nothing this action can be asked to do changes a figure. */
export async function salesByCustomerAction(when: ReportWhen): Promise<ReportRunResult<PartyActivityResult>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSalesByCustomer(sb, checked.from!, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 15: Create `ctyhp-accounting/app/(app)/reports/sales-by-customer/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PartyActivityReport from "@/components/reports/PartyActivityReport";
import { salesByCustomerAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SalesByCustomerPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Sales by Customer Summary"
        description="The period's income by customer, largest first, adding up to Income on the Profit and Loss."
      />
      <PartyActivityReport kind="sales" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} presets={ctx.presets} load={salesByCustomerAction} />
    </div>
  );
}
```

- [ ] **Step 16: Create `ctyhp-accounting/app/(app)/reports/expenses-by-vendor/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getExpensesByVendor, type PartyActivityResult } from "@/lib/services/party-reports";

/** Expenses by Vendor Summary: read-only. Nothing this action can be asked to do changes a figure. */
export async function expensesByVendorAction(when: ReportWhen): Promise<ReportRunResult<PartyActivityResult>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getExpensesByVendor(sb, checked.from!, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 17: Create `ctyhp-accounting/app/(app)/reports/expenses-by-vendor/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import PartyActivityReport from "@/components/reports/PartyActivityReport";
import { expensesByVendorAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExpensesByVendorPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Expenses by Vendor Summary"
        description="The period's spending by vendor, largest first, adding up to cost of sales and expenses on the Profit and Loss."
      />
      <PartyActivityReport kind="expenses" companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} presets={ctx.presets} load={expensesByVendorAction} />
    </div>
  );
}
```

- [ ] **Step 18: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "components/reports/SimpleReport.tsx" "components/reports/ProofLine.tsx" "components/reports/OpenDocumentsReport.tsx" "components/reports/PartyBalancesReport.tsx" "components/reports/PartyActivityReport.tsx" "app/(app)/reports/open-invoices/actions.ts" "app/(app)/reports/open-invoices/page.tsx" "app/(app)/reports/unpaid-bills/actions.ts" "app/(app)/reports/unpaid-bills/page.tsx" "app/(app)/reports/customer-balances/actions.ts" "app/(app)/reports/customer-balances/page.tsx" "app/(app)/reports/vendor-balances/actions.ts" "app/(app)/reports/vendor-balances/page.tsx" "app/(app)/reports/sales-by-customer/actions.ts" "app/(app)/reports/sales-by-customer/page.tsx" "app/(app)/reports/expenses-by-vendor/actions.ts" "app/(app)/reports/expenses-by-vendor/page.tsx"
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files.

- [ ] **Step 19: Commit**

```bash
git add "components/reports/SimpleReport.tsx" "components/reports/ProofLine.tsx" "components/reports/OpenDocumentsReport.tsx" "components/reports/PartyBalancesReport.tsx" "components/reports/PartyActivityReport.tsx" "app/(app)/reports/open-invoices/actions.ts" "app/(app)/reports/open-invoices/page.tsx" "app/(app)/reports/unpaid-bills/actions.ts" "app/(app)/reports/unpaid-bills/page.tsx" "app/(app)/reports/customer-balances/actions.ts" "app/(app)/reports/customer-balances/page.tsx" "app/(app)/reports/vendor-balances/actions.ts" "app/(app)/reports/vendor-balances/page.tsx" "app/(app)/reports/sales-by-customer/actions.ts" "app/(app)/reports/sales-by-customer/page.tsx" "app/(app)/reports/expenses-by-vendor/actions.ts" "app/(app)/reports/expenses-by-vendor/page.tsx"
git commit -m "feat(reports): Open Invoices, Unpaid Bills, balances and activity by customer and vendor"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; do not mention Claude in the message.

---

### Task 5: The four review reports

**Files:**
- Create: `ctyhp-accounting/app/(app)/reports/reconciliations/ReconciliationsClient.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/reconciliations/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/reconciliations/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/change-log/ChangeLogClient.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/change-log/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/change-log/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/close-log/CloseLogClient.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/close-log/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/close-log/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/voided-entries/VoidedEntriesClient.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/voided-entries/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/voided-entries/page.tsx`

**Interfaces:**
- Consumes (Tasks 2–4): the review reads and sheets, `SimpleReport`, `CHANGE_LOG_PERMISSIONS` (created in Task 6 — see the note below), `currentAccess` (`lib/db/settings-access.ts`), `canShowNavItem` (`lib/domain/navigation.ts`), `EmptyState` (`components/ui/PageStates.tsx`), `EntryDetailDrawer`, `fiscalYearForDate` (`lib/domain/fiscal.ts`), `secondaryLine` (`components/ui/columns`).
- Note: `app/(app)/reports/change-log/page.tsx` imports `CHANGE_LOG_PERMISSIONS` from `lib/domain/report-catalog.ts`, which Task 6 adds. So that this task typechecks on its own, do Task 6's Edits 1 and 2 of `lib/domain/report-catalog.ts` (the `anyPermissions` field and `CHANGE_LOG_PERMISSIONS`) as the first step of this task and commit them with this task; Task 6 then skips those two edits.
- Produces: four routes under `/reports/`.

- [ ] **Step 1: Create `ctyhp-accounting/app/(app)/reports/reconciliations/ReconciliationsClient.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Select, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import {
  reconciliationListSheet,
  type ReconciliationListLine,
  type ReconciliationListReport,
} from "@/lib/domain/reconciliation-list";
import { longDate, shortDate } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { stampInTimeZone } from "@/lib/domain/stamp";

const PAGE_SIZE = 50;

/**
 * Reconciliation Report: every signed-off statement reconciliation, newest
 * first within each bank account, and whether it still agrees with the books.
 */
export default function ReconciliationsClient({
  companyName,
  currencyCode,
  decimals,
  today,
  timeZone,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  today: string;
  timeZone: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<ReconciliationListReport>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [account, setAccount] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<{ value: string; label: string }[]>([]);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);

  const view = useCallback(
    (report: ReconciliationListReport): ReconciliationListReport => {
      const lines = account ? report.lines.filter((line) => line.bankAccountId === account) : report.lines;
      return { lines, outOfAgreement: lines.filter((line) => !line.stillAgrees).length };
    },
    [account],
  );
  const sheet = useCallback(
    (report: ReconciliationListReport) =>
      reconciliationListSheet(report, { companyName, today, currencyCode, baseDecimals: decimals, timeZone }),
    [companyName, today, currencyCode, decimals, timeZone],
  );
  const loadAndList = useCallback(
    async (when: ReportWhen) => {
      const result = await load(when);
      if (result.ok && result.data) {
        const seen = new Map<string, string>();
        for (const line of result.data.lines) seen.set(line.bankAccountId, line.bankAccountName);
        setAccounts([...seen].map(([value, label]) => ({ value, label })));
      }
      return result;
    },
    [load],
  );
  const caption = useMemo(() => `Signed-off reconciliations, as of ${longDate(today)}`, [today]);

  return (
    <SimpleReport<ReconciliationListReport>
      companyName={companyName}
      title="Reconciliation Report"
      currencyCode={currencyCode}
      period={{ kind: "none", today, caption }}
      load={loadAndList}
      view={view}
      sheet={sheet}
      runningText="Checking every signed-off reconciliation…"
      filters={
        <Select
          allowClear
          aria-label="Bank account"
          placeholder="All bank accounts"
          style={{ minWidth: 240 }}
          value={account ?? undefined}
          onChange={(value) => setAccount(value ?? null)}
          options={accounts}
        />
      }
      render={(report) => (
        <>
          <StatRow
            items={[
              { label: "Signed off", value: report.lines.length.toLocaleString("en-US") },
              { label: "No longer agree", value: report.outOfAgreement, danger: report.outOfAgreement > 0 },
            ]}
          />
          <DataTable<ReconciliationListLine>
            rowKey="id"
            dataSource={report.lines}
            pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
            emptyTitle="No reconciliation has been signed off"
            emptyDescription="Reconcile a bank account against its statement under Banking › Reconcile."
            columns={[
              flexColumn<ReconciliationListLine>({ title: "Bank account", dataIndex: "bankAccountName" }),
              {
                title: "Statement ending",
                dataIndex: "statementEndingDate",
                width: COLUMN.DATE + 32,
                render: (d: string) => shortDate(d),
              },
              {
                title: "Ending balance",
                dataIndex: "statementEndingBalanceMinor",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (minor: number) => money(minor),
              },
              {
                title: "Signed off",
                key: "signed",
                width: 220,
                render: (_: unknown, line: ReconciliationListLine) => (
                  <span>
                    {line.completedAt ? stampInTimeZone(line.completedAt, timeZone) : "—"}
                    {line.completedByName ? <span className={styles.muted}> · {line.completedByName}</span> : null}
                  </span>
                ),
              },
              {
                title: "Still agrees",
                key: "agrees",
                width: 190,
                render: (_: unknown, line: ReconciliationListLine) =>
                  line.stillAgrees ? (
                    <Tag color="green">Yes</Tag>
                  ) : (
                    <span title={`Voided since: ${line.voidedEntries.join(", ")}`}>
                      <Tag color="red">No</Tag>
                      <span className={styles.negative}>out by {money(line.differenceMinor)}</span>
                    </span>
                  ),
              },
              {
                title: "",
                key: "open",
                width: 70,
                render: (_: unknown, line: ReconciliationListLine) => (
                  <Link href={`/banking/reconcile/${line.id}/report`}>Open</Link>
                ),
              },
            ]}
          />
          <ReportFoot>
            <strong>Still agrees</strong> means none of the entries the reconciliation ticked has been voided since it was
            signed off. When one has, the reconciliation is out by that entry’s amount; hover over No to see which
            entries, and open the reconciliation to deal with it.
          </ReportFoot>
        </>
      )}
    />
  );
}
```

- [ ] **Step 2: Create `ctyhp-accounting/app/(app)/reports/reconciliations/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getReconciliationList } from "@/lib/services/review-reports";
import type { ReconciliationListReport } from "@/lib/domain/reconciliation-list";

/** Reconciliation Report: read-only. Nothing this action can be asked to do changes a figure. */
export async function reconciliationsAction(when: ReportWhen): Promise<ReportRunResult<ReconciliationListReport>> {
  try {
    checkWhen(when, "none");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getReconciliationList(sb) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 3: Create `ctyhp-accounting/app/(app)/reports/reconciliations/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { reportPageContext } from "@/lib/services/report-context";
import ReconciliationsClient from "./ReconciliationsClient";
import { reconciliationsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReconciliationsPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Reconciliation Report"
        description="Every bank reconciliation that was signed off, and whether it still agrees with the books."
      />
      <ReconciliationsClient companyName={ctx.companyName} currencyCode={ctx.currencyCode} decimals={ctx.decimals} today={ctx.today} timeZone={ctx.timeZone} load={reconciliationsAction} />
    </div>
  );
}
```

- [ ] **Step 4: Create `ctyhp-accounting/app/(app)/reports/change-log/ChangeLogClient.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useState } from "react";
import { Alert, Select, Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import { StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { changeLogSheet, CHANGE_LOG_LIMIT, type ChangeLogEntry, type ChangeLogReport } from "@/lib/domain/change-log";
import type { PresetContext } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { stampInTimeZone } from "@/lib/domain/stamp";

const PAGE_SIZE = 50;
/** Room for a two-word action; a longer one, "Match from reconciliation", wraps inside its tag. */
const COLUMN_WHAT = 150;
const WRAPPING_TAG = { whiteSpace: "normal", height: "auto", lineHeight: "18px" } as const;

const WHAT_COLOR: Record<string, string | undefined> = {
  Created: "green",
  Posted: "blue",
  Voided: "red",
  Reversed: "orange",
  Deleted: "red",
};

/** Change Log: what changed in the books between two dates, newest first. */
export default function ChangeLogClient({
  companyName,
  currencyCode,
  presets,
  timeZone,
  load,
}: {
  companyName: string;
  currencyCode: string;
  presets: PresetContext;
  timeZone: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<ChangeLogReport>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [record, setRecord] = useState<string | null>(null);
  const [records, setRecords] = useState<string[]>([]);

  const view = useCallback(
    (report: ChangeLogReport): ChangeLogReport =>
      record ? { ...report, lines: report.lines.filter((line) => line.record === record) } : report,
    [record],
  );
  const sheet = useCallback(
    (report: ChangeLogReport, when: ReportWhen) =>
      changeLogSheet(report, { companyName, from: when.from ?? when.to, to: when.to, currencyCode, timeZone }),
    [companyName, currencyCode, timeZone],
  );
  const loadAndList = useCallback(
    async (when: ReportWhen) => {
      const result = await load(when);
      if (result.ok && result.data) setRecords([...new Set(result.data.lines.map((line) => line.record))].sort());
      return result;
    },
    [load],
  );

  return (
    <SimpleReport<ChangeLogReport>
      companyName={companyName}
      title="Change Log"
      currencyCode={currencyCode}
      period={{ kind: "range", ctx: presets, preset: "month" }}
      load={loadAndList}
      view={view}
      sheet={sheet}
      runningText="Reading the audit log…"
      filters={
        <Select
          allowClear
          aria-label="Record type"
          placeholder="All records"
          style={{ minWidth: 200 }}
          value={record ?? undefined}
          onChange={(value) => setRecord(value ?? null)}
          options={records.map((value) => ({ value, label: value }))}
        />
      }
      render={(report) => (
        <>
          <StatRow items={[{ label: "Changes", value: report.lines.length.toLocaleString("en-US") }]} />
          {report.truncated ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title={`Only the newest ${CHANGE_LOG_LIMIT.toLocaleString("en-US")} changes are shown.`}
              description="This period holds more. Narrow the dates to see the rest."
            />
          ) : null}
          <DataTable<ChangeLogEntry>
            rowKey="id"
            dataSource={report.lines}
            pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
            emptyTitle="Nothing changed in this period"
            emptyDescription="Widen the dates."
            columns={[
              { title: "When", dataIndex: "at", width: 150, render: (at: string) => stampInTimeZone(at, timeZone) },
              { title: "Who", dataIndex: "who", width: 220, ellipsis: true },
              {
                title: "What",
                dataIndex: "what",
                width: COLUMN_WHAT,
                render: (what: string) => (
                  <Tag color={WHAT_COLOR[what]} style={WRAPPING_TAG}>
                    {what}
                  </Tag>
                ),
              },
              {
                title: "Record",
                key: "record",
                width: 220,
                render: (_: unknown, line: ChangeLogEntry) => (
                  <span>
                    {line.record}
                    {line.reference ? <span className={styles.mono}> {line.reference}</span> : null}
                  </span>
                ),
              },
              flexColumn<ChangeLogEntry>({
                title: "Detail",
                key: "detail",
                render: (_: unknown, line: ChangeLogEntry) => (
                  <span className={styles.muted} title={line.detail}>
                    {line.detail || "—"}
                  </span>
                ),
              }),
            ]}
          />
        </>
      )}
    />
  );
}
```

- [ ] **Step 5: Create `ctyhp-accounting/app/(app)/reports/change-log/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import type { ChangeLogReport } from "@/lib/domain/change-log";
import { getChangeLog } from "@/lib/services/review-reports";

/**
 * Change Log: read-only. The audit search itself refuses anybody without
 * `audit.read`, so a reader the page let through by mistake still sees nothing.
 */
export async function changeLogAction(when: ReportWhen): Promise<ReportRunResult<ChangeLogReport>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getChangeLog(sb, checked.from!, checked.to) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 6: Create `ctyhp-accounting/app/(app)/reports/change-log/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/PageStates";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { currentAccess } from "@/lib/db/settings-access";
import { CHANGE_LOG_PERMISSIONS } from "@/lib/domain/report-catalog";
import { canShowNavItem } from "@/lib/domain/navigation";
import { reportPageContext } from "@/lib/services/report-context";
import ChangeLogClient from "./ChangeLogClient";
import { changeLogAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ChangeLogPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, access] = await Promise.all([reportPageContext(sb), currentAccess()]);
  // Fails closed: an unread permission list is not a yes here, unlike in the sidebar.
  const allowed =
    access.role !== null &&
    canShowNavItem({ anyPermissions: [...CHANGE_LOG_PERMISSIONS] }, { role: access.role, permissionKeys: access.permissionKeys ?? [] });
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Change Log"
        description="What changed in the books, when, and by whom — from the audit log."
      />
      {allowed ? (
        <ChangeLogClient
          companyName={ctx.companyName}
          currencyCode={ctx.currencyCode}
          presets={ctx.presets}
          timeZone={ctx.timeZone}
          load={changeLogAction}
        />
      ) : (
        <EmptyState
          title="This report reads the audit log"
          description="Your role cannot read the audit log. An administrator can give it the permission to under Settings › Permissions."
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create `ctyhp-accounting/app/(app)/reports/close-log/CloseLogClient.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { closeLogSheet, type CloseLogLine, type CloseLogReport } from "@/lib/domain/close-log";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { stampInTimeZone } from "@/lib/domain/stamp";

const EVENT_COLOR: Record<CloseLogLine["event"], string | undefined> = {
  Closed: "blue",
  Reopened: "orange",
  Open: undefined,
};

/** Month-End Close Log: every close and reopen of a fiscal year's months. */
export default function CloseLogClient({
  companyName,
  currencyCode,
  fiscalYear,
  timeZone,
  load,
}: {
  companyName: string;
  currencyCode: string;
  fiscalYear: number;
  timeZone: string;
  load: (when: ReportWhen) => Promise<ReportRunResult<CloseLogReport>>;
}) {
  const sheet = useCallback(
    (report: CloseLogReport, when: ReportWhen) =>
      closeLogSheet(report, { companyName, fiscalYear: when.fiscalYear ?? fiscalYear, currencyCode, timeZone }),
    [companyName, fiscalYear, currencyCode, timeZone],
  );

  return (
    <SimpleReport<CloseLogReport>
      companyName={companyName}
      title="Month-End Close Log"
      currencyCode={currencyCode}
      period={{ kind: "fiscalYear", current: fiscalYear }}
      load={load}
      sheet={sheet}
      runningText="Reading the closes…"
      render={(report) => (
        <>
          <StatRow
            items={[
              { label: "Months closed", value: report.closedMonths },
              { label: "Reopenings", value: report.reopenings, danger: report.reopenings > 0 },
            ]}
          />
          <DataTable<CloseLogLine>
            rowKey="key"
            dataSource={report.lines}
            pagination={false}
            rowClassName={(line) => (line.monthStart ? styles.groupStart : "")}
            emptyTitle="No accounting periods for this fiscal year"
            emptyDescription="Months are closed one accounting period at a time, and this year has none set up yet."
            emptyAction={<Link href="/settings/periods">Set up accounting periods</Link>}
            columns={[
              {
                title: "Month",
                key: "month",
                width: 150,
                render: (_: unknown, line: CloseLogLine) => (line.monthStart ? <strong>{line.month}</strong> : null),
              },
              {
                title: "Event",
                dataIndex: "event",
                width: 120,
                render: (event: CloseLogLine["event"]) => <Tag color={EVENT_COLOR[event]}>{event}</Tag>,
              },
              {
                title: "When",
                dataIndex: "at",
                width: 150,
                render: (at: string | null) => (at ? stampInTimeZone(at, timeZone) : "—"),
              },
              { title: "By", dataIndex: "by", width: 200, ellipsis: true, render: (by: string | null) => by ?? "—" },
              flexColumn<CloseLogLine>({
                title: "Reason or note",
                key: "reason",
                render: (_: unknown, line: CloseLogLine) => (
                  <span className={styles.muted} title={line.reason ?? ""}>
                    {line.reason ?? "—"}
                  </span>
                ),
              }),
            ]}
          />
          <ReportFoot>
            Every close and every reopen is listed, with the reason given at the time. The books do not keep which close
            checks passed when a month was closed, so this log does not show a count of them.
          </ReportFoot>
        </>
      )}
    />
  );
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/reports/close-log/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import { getCloseLog } from "@/lib/services/review-reports";
import type { CloseLogReport } from "@/lib/domain/close-log";

/** Month-End Close Log: read-only. Nothing this action can be asked to do changes a figure. */
export async function closeLogAction(when: ReportWhen): Promise<ReportRunResult<CloseLogReport>> {
  try {
    const checked = checkWhen(when, "fiscalYear");
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getCloseLog(sb, checked.fiscalYear!) };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/reports/close-log/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { fiscalYearForDate } from "@/lib/domain/fiscal";
import { reportPageContext } from "@/lib/services/report-context";
import CloseLogClient from "./CloseLogClient";
import { closeLogAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CloseLogPage() {
  const sb = await createSupabaseServerClient();
  const ctx = await reportPageContext(sb);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Month-End Close Log"
        description="Every close and reopen of the year's months: when, by whom, and why."
      />
      <CloseLogClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        fiscalYear={fiscalYearForDate(ctx.today, ctx.presets.fiscalStartMonth)}
        timeZone={ctx.timeZone}
        load={closeLogAction}
      />
    </div>
  );
}
```

- [ ] **Step 10: Create `ctyhp-accounting/app/(app)/reports/voided-entries/VoidedEntriesClient.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useState } from "react";
import { Tag } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { ReportFoot, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import SimpleReport from "@/components/reports/SimpleReport";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import type { PresetContext } from "@/lib/domain/report-presets";
import { shortDate } from "@/lib/domain/report-presets";
import type { ReportRunResult, ReportWhen } from "@/lib/domain/report-run";
import { stampInTimeZone } from "@/lib/domain/stamp";
import { voidedEntriesSheet, type VoidedEntriesLine, type VoidedEntriesReport } from "@/lib/domain/voided-entries";

const PAGE_SIZE = 50;

/**
 * Voided and Reversed Entries: OneBook's Bin. Every entry voided or reversed in
 * the period, newest first; clicking an entry opens it.
 */
export default function VoidedEntriesClient({
  companyName,
  currencyCode,
  decimals,
  presets,
  timeZone,
  canReadAudit,
  load,
}: {
  companyName: string;
  currencyCode: string;
  decimals: number;
  presets: PresetContext;
  timeZone: string;
  /** Whether the reader may see who voided a document (it comes from the audit log). */
  canReadAudit: boolean;
  load: (when: ReportWhen) => Promise<ReportRunResult<VoidedEntriesReport>>;
}) {
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const sheet = useCallback(
    (report: VoidedEntriesReport, when: ReportWhen) =>
      voidedEntriesSheet(report, { companyName, from: when.from ?? when.to, to: when.to, currencyCode, baseDecimals: decimals, timeZone }),
    [companyName, currencyCode, decimals, timeZone],
  );
  const entryLink = (id: string, number: string) => (
    <a
      className={styles.accountLink}
      onClick={(event) => {
        event.preventDefault();
        setOpenEntry(id);
      }}
      href="#"
      title="Open this entry"
    >
      <span className={styles.mono}>{number}</span>
    </a>
  );

  return (
    <>
      <SimpleReport<VoidedEntriesReport>
        companyName={companyName}
        title="Voided and Reversed Entries"
        currencyCode={currencyCode}
        period={{ kind: "range", ctx: presets, preset: "year" }}
        load={load}
        sheet={sheet}
        runningText="Reading the voided and reversed entries…"
        render={(report) => (
          <>
            <StatRow
              items={[
                { label: "Voided", value: report.voided.toLocaleString("en-US") },
                { label: "Reversed", value: report.reversed.toLocaleString("en-US") },
              ]}
            />
            <DataTable<VoidedEntriesLine>
              rowKey="key"
              dataSource={report.lines}
              pagination={clientTablePagination(pageSize, setPageSize, pageSizeOptionsFor(PAGE_SIZE))}
              emptyTitle="Nothing was voided or reversed in this period"
              emptyDescription="Widen the dates."
              columns={[
                { title: "Date", dataIndex: "entryDate", width: COLUMN.DATE + 20, render: (d: string) => shortDate(d) },
                {
                  title: "Entry",
                  key: "entry",
                  width: COLUMN.CODE,
                  render: (_: unknown, line: VoidedEntriesLine) => entryLink(line.entryId, line.entryNumber),
                },
                flexColumn<VoidedEntriesLine>({
                  title: "Description",
                  key: "description",
                  // The reason sits under what was undone: most voids have none, and a column of dashes
                  // would take the room the description needs.
                  render: (_: unknown, line: VoidedEntriesLine) => (
                    <div style={{ minWidth: 0 }}>
                      <span title={line.description}>{line.description || "—"}</span>
                      {line.reason ? secondaryLine(`Reason: ${line.reason}`) : null}
                    </div>
                  ),
                }),
                { title: "Amount", dataIndex: "amountMinor", width: COLUMN.MONEY_WIDE, align: "right", render: (m: number) => money(m) },
                {
                  title: "Action",
                  key: "action",
                  width: 170,
                  render: (_: unknown, line: VoidedEntriesLine) => (
                    <span style={{ whiteSpace: "nowrap" }}>
                      <Tag color={line.action === "Voided" ? "red" : "orange"}>{line.action}</Tag>
                      {line.reversalEntryId && line.reversalNumber ? (
                        <span title="The entry that undid it">→ {entryLink(line.reversalEntryId, line.reversalNumber)}</span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  title: "When",
                  key: "when",
                  width: 190,
                  render: (_: unknown, line: VoidedEntriesLine) => (
                    <span>
                      {line.actedAt ? stampInTimeZone(line.actedAt, timeZone) : <span className={styles.muted}>Not recorded</span>}
                      {line.by ? <span className={styles.muted}> · {line.by}</span> : null}
                    </span>
                  ),
                },
              ]}
            />
            <ReportFoot>
              <strong>Nothing here can be put back.</strong> OneBook never deletes a posted entry: voiding a document voids its
              entry, and reversing an entry posts a second one that undoes it. To record the transaction again, post it as a
              new entry. An entry voided before the books kept the time of a void is dated by the entry itself.
              {canReadAudit ? null : " Who voided a document is kept in the audit log, which your role cannot read."}
            </ReportFoot>
          </>
        )}
      />
      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </>
  );
}
```

- [ ] **Step 11: Create `ctyhp-accounting/app/(app)/reports/voided-entries/actions.ts`** with exactly this content:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import type { VoidedEntriesReport } from "@/lib/domain/voided-entries";
import { hasPermission } from "@/lib/services/access";
import { companyClock } from "@/lib/services/report-context";
import { getVoidedEntries } from "@/lib/services/review-reports";

/**
 * Voided and Reversed Entries: read-only. Who voided a document comes from the
 * audit log, so it is asked for only when the reader may read that log.
 */
export async function voidedEntriesAction(when: ReportWhen): Promise<ReportRunResult<VoidedEntriesReport>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    const [{ timeZone }, canReadAudit] = await Promise.all([companyClock(sb), hasPermission(sb, "audit.read")]);
    return {
      ok: true,
      data: await getVoidedEntries(sb, { from: checked.from!, to: checked.to }, timeZone, canReadAudit),
    };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
```

- [ ] **Step 12: Create `ctyhp-accounting/app/(app)/reports/voided-entries/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { hasPermission } from "@/lib/services/access";
import { reportPageContext } from "@/lib/services/report-context";
import VoidedEntriesClient from "./VoidedEntriesClient";
import { voidedEntriesAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function VoidedEntriesPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, canReadAudit] = await Promise.all([reportPageContext(sb), hasPermission(sb, "audit.read")]);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Voided and Reversed Entries"
        description="Every entry voided or reversed in a period. OneBook never deletes a posted entry, so nothing is lost."
      />
      <VoidedEntriesClient
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        presets={ctx.presets}
        timeZone={ctx.timeZone}
        canReadAudit={canReadAudit}
        load={voidedEntriesAction}
      />
    </div>
  );
}
```

- [ ] **Step 13: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "app/(app)/reports/reconciliations/ReconciliationsClient.tsx" "app/(app)/reports/reconciliations/actions.ts" "app/(app)/reports/reconciliations/page.tsx" "app/(app)/reports/change-log/ChangeLogClient.tsx" "app/(app)/reports/change-log/actions.ts" "app/(app)/reports/change-log/page.tsx" "app/(app)/reports/close-log/CloseLogClient.tsx" "app/(app)/reports/close-log/actions.ts" "app/(app)/reports/close-log/page.tsx" "app/(app)/reports/voided-entries/VoidedEntriesClient.tsx" "app/(app)/reports/voided-entries/actions.ts" "app/(app)/reports/voided-entries/page.tsx"
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files.

- [ ] **Step 14: Commit**

```bash
git add "app/(app)/reports/reconciliations/ReconciliationsClient.tsx" "app/(app)/reports/reconciliations/actions.ts" "app/(app)/reports/reconciliations/page.tsx" "app/(app)/reports/change-log/ChangeLogClient.tsx" "app/(app)/reports/change-log/actions.ts" "app/(app)/reports/change-log/page.tsx" "app/(app)/reports/close-log/CloseLogClient.tsx" "app/(app)/reports/close-log/actions.ts" "app/(app)/reports/close-log/page.tsx" "app/(app)/reports/voided-entries/VoidedEntriesClient.tsx" "app/(app)/reports/voided-entries/actions.ts" "app/(app)/reports/voided-entries/page.tsx" "lib/domain/report-catalog.ts"
git commit -m "feat(reports): Reconciliation Report, Change Log, Month-End Close Log, Voided and Reversed Entries"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; do not mention Claude in the message.

---

### Task 6: Report Center cards, permission-aware hub, Beancount in the sidebar

**Files:**
- Create: `ctyhp-accounting/tests/unit/reports-wave1-catalog.test.ts`
- Create: `ctyhp-accounting/app/(app)/accounting/beancount/loading.tsx`
- Modify: `ctyhp-accounting/lib/domain/report-catalog.ts`
- Modify: `ctyhp-accounting/components/reports/ReportsHub.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/page.tsx`
- Modify: `ctyhp-accounting/lib/domain/navigation.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/beancount/page.tsx (rewritten as a redirect)`

**Interfaces:**
- Consumes (Tasks 4–5): the ten routes. Existing: `currentAccess`, `REPORT_CATALOG`, `NAV`.
- Produces: `ReportDefinition.anyPermissions?: readonly string[]`, `CHANGE_LOG_PERMISSIONS`, `canOpenReport(report, permissionKeys)`; `ReportsHub({ permissionKeys })`; sidebar item `{ key: "/accounting/beancount", label: "Beancount" }` last in Accounting.
- Edits 1 and 2 of `lib/domain/report-catalog.ts` were already applied in Task 5; skip them here (the remaining edits still apply in order).

- [ ] **Step 1: Write the failing test** — create `ctyhp-accounting/tests/unit/reports-wave1-catalog.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/domain/navigation";
import { CHANGE_LOG_PERMISSIONS, REPORT_CATALOG, canOpenReport } from "@/lib/domain/report-catalog";

const WAVE_1 = [
  ["open-invoices", "Open Invoices", "/reports/open-invoices", "receivables"],
  ["customer-balances", "Customer Balances", "/reports/customer-balances", "receivables"],
  ["sales-by-customer", "Sales by Customer", "/reports/sales-by-customer", "receivables"],
  ["unpaid-bills", "Unpaid Bills", "/reports/unpaid-bills", "payables"],
  ["vendor-balances", "Vendor Balances", "/reports/vendor-balances", "payables"],
  ["expenses-by-vendor", "Expenses by Vendor", "/reports/expenses-by-vendor", "payables"],
  ["reconciliation-report", "Reconciliation Report", "/reports/reconciliations", "accounting"],
  ["change-log", "Change Log", "/reports/change-log", "accounting"],
  ["month-end-close-log", "Month-End Close Log", "/reports/close-log", "accounting"],
  ["voided-entries", "Voided and Reversed Entries", "/reports/voided-entries", "accounting"],
] as const;

const appRoute = (href: string) => join(process.cwd(), "app", "(app)", ...href.split("/").filter(Boolean), "page.tsx");

describe("the Report Center after wave 1", () => {
  it("offers the ten new reports under the mockup's names, each on a page that exists", () => {
    for (const [id, title, href, group] of WAVE_1) {
      const report = REPORT_CATALOG.find((r) => r.id === id);
      expect(report, id).toMatchObject({ title, href, group });
      expect(existsSync(appRoute(href)), href).toBe(true);
    }
  });

  it("no longer carries Beancount, which lives in the sidebar now", () => {
    expect(REPORT_CATALOG.some((r) => r.href.includes("beancount"))).toBe(false);
    expect(REPORT_CATALOG).toHaveLength(36);
  });

  it("asks for audit.read before offering the Change Log, and for nothing else before the rest", () => {
    const changeLog = REPORT_CATALOG.find((r) => r.id === "change-log")!;
    expect(changeLog.anyPermissions).toEqual(CHANGE_LOG_PERMISSIONS);
    expect(canOpenReport(changeLog, ["audit.read"])).toBe(true);
    expect(canOpenReport(changeLog, ["journal.post"])).toBe(false);
    // A permission list that could not be read refuses, rather than opening onto a refusal.
    expect(canOpenReport(changeLog, null)).toBe(false);
    expect(REPORT_CATALOG.filter((r) => r.anyPermissions?.length).map((r) => r.id)).toEqual(["change-log"]);
    expect(canOpenReport(REPORT_CATALOG.find((r) => r.id === "open-invoices")!, null)).toBe(true);
  });

  it("checks the Change Log's permission on the page itself, from the same list", () => {
    const page = readFileSync(appRoute("/reports/change-log"), "utf8");
    expect(page).toMatch(/CHANGE_LOG_PERMISSIONS/);
    expect(page).toMatch(/permissionKeys: access\.permissionKeys \?\? \[\]/);
  });
});

describe("Beancount in the sidebar", () => {
  it("is the last item of Accounting, as in the client's mockup", () => {
    const accounting = NAV.find((item) => item.key === "accounting");
    const children = accounting && "children" in accounting ? accounting.children : [];
    expect(children.at(-1)).toEqual({ key: "/accounting/beancount", label: "Beancount" });
    expect(existsSync(appRoute("/accounting/beancount"))).toBe(true);
  });

  it("keeps its old address, which forwards with the query string", () => {
    const old = readFileSync(appRoute("/reports/beancount"), "utf8");
    expect(old).toMatch(/redirect\(rest \? `\/accounting\/beancount\?\$\{rest\}` : "\/accounting\/beancount"\)/);
  });

  it("does not load behind the Accounting overview's dashboard skeleton", () => {
    expect(existsSync(join(process.cwd(), "app", "(app)", "accounting", "beancount", "loading.tsx"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npx vitest run tests/unit/reports-wave1-catalog.test.ts
```

Expected: FAIL — the ten cards are not in the catalog, Beancount still is, and `/accounting/beancount` does not exist.

- [ ] **Step 3: Edit `ctyhp-accounting/lib/domain/report-catalog.ts`**

Edit 1 of 7 — find:

```ts
  internalReport?: InternalReportId;
}
```

replace with:

```ts
  internalReport?: InternalReportId;
  /**
   * Permissions any one of which opens the report, as a sidebar item declares
   * them. Absent: anybody in the company may open it. The page enforces the
   * same rule on the server; the Report Center only hides what would refuse.
   */
  anyPermissions?: readonly string[];
}
```

Edit 2 of 7 — find:

```ts
  anyPermissions?: readonly string[];
}

export const REPORT_GROUPS: ReportGroupDefinition[] = [
```

replace with:

```ts
  anyPermissions?: readonly string[];
}

/** The Change Log reads the audit log, which only these permissions may read. */
export const CHANGE_LOG_PERMISSIONS = ["audit.read"] as const;

export const REPORT_GROUPS: ReportGroupDefinition[] = [
```

Edit 3 of 7 — find:

```ts
  {
    id: "beancount-export",
    title: "Beancount Export",
    description: "Download the whole ledger as a Beancount v3 file, with a balance line per reconciled statement, for bean-check and Fava.",
    href: "/reports/beancount",
    group: "accounting",
  },
  {
    id: "accounts-receivable-aging",
```

replace with:

```ts
  {
    id: "accounts-receivable-aging",
```

Edit 4 of 7 — find:

```ts
  {
    id: "accounts-payable-aging",
```

replace with:

```ts
  {
    id: "open-invoices",
    title: "Open Invoices",
    description: "Every invoice still open on a date, by customer and due date, with how long it is past due.",
    href: "/reports/open-invoices",
    group: "receivables",
  },
  {
    id: "customer-balances",
    title: "Customer Balances",
    description: "What each customer owes on a date, credits netted, held to the receivables account.",
    href: "/reports/customer-balances",
    group: "receivables",
  },
  {
    id: "sales-by-customer",
    title: "Sales by Customer",
    description: "A period's income by customer, largest first, adding up to Income on the Profit and Loss.",
    href: "/reports/sales-by-customer",
    group: "receivables",
  },
  {
    id: "accounts-payable-aging",
```

Edit 5 of 7 — find:

```ts
    href: "/reports/vendor-statement",
    group: "payables",
```

replace with:

```ts
    href: "/reports/vendor-statement",
    group: "payables",
  },
  {
    id: "unpaid-bills",
    title: "Unpaid Bills",
    description: "Every bill still unpaid on a date, by vendor and due date, with how long it is past due.",
    href: "/reports/unpaid-bills",
    group: "payables",
  },
  {
    id: "vendor-balances",
    title: "Vendor Balances",
    description: "What is owed to each vendor on a date, credits netted, held to the payables account.",
    href: "/reports/vendor-balances",
    group: "payables",
  },
  {
    id: "expenses-by-vendor",
    title: "Expenses by Vendor",
    description: "A period's spending by vendor, largest first, adding up to cost of sales and expenses on the Profit and Loss.",
    href: "/reports/expenses-by-vendor",
    group: "payables",
```

Edit 6 of 7 — find:

```ts
  {
    id: "inventory-valuation",
```

replace with:

```ts
  {
    id: "reconciliation-report",
    title: "Reconciliation Report",
    description: "Every bank reconciliation that was signed off, and whether it still agrees with the books.",
    href: "/reports/reconciliations",
    group: "accounting",
  },
  {
    id: "change-log",
    title: "Change Log",
    description: "What changed in the books, when, and by whom, from the audit log.",
    href: "/reports/change-log",
    group: "accounting",
    anyPermissions: CHANGE_LOG_PERMISSIONS,
  },
  {
    id: "month-end-close-log",
    title: "Month-End Close Log",
    description: "Every close and reopen of a fiscal year's months, with when, by whom and why.",
    href: "/reports/close-log",
    group: "accounting",
  },
  {
    id: "voided-entries",
    title: "Voided and Reversed Entries",
    description: "Every entry voided or reversed in a period. Nothing is deleted in OneBook, so nothing is lost.",
    href: "/reports/voided-entries",
    group: "accounting",
  },
  {
    id: "inventory-valuation",
```

Edit 7 of 7 — find:

```ts

export function getReportGroup(groupId: ReportGroupId) {
```

replace with:

```ts

/**
 * Whether a reader may open a report. A permission list that could not be read
 * (null) refuses a report that asks for one: a hidden card costs a click, a
 * card that opens onto a refusal costs trust.
 */
export function canOpenReport(
  report: Pick<ReportDefinition, "anyPermissions">,
  permissionKeys: readonly string[] | null,
): boolean {
  if (!report.anyPermissions?.length) return true;
  return permissionKeys !== null && report.anyPermissions.some((key) => permissionKeys.includes(key));
}

export function getReportGroup(groupId: ReportGroupId) {
```

- [ ] **Step 4: Edit `ctyhp-accounting/components/reports/ReportsHub.tsx`**

Edit 1 of 14 — find:

```tsx
  FileTextOutlined,
  InboxOutlined,
```

replace with:

```tsx
  FileTextOutlined,
  HistoryOutlined,
  InboxOutlined,
```

Edit 2 of 14 — find:

```tsx
  StarOutlined,
  TeamOutlined,
```

replace with:

```tsx
  StarOutlined,
  StopOutlined,
  TeamOutlined,
```

Edit 3 of 14 — find:

```tsx
  REPORT_GROUPS,
  type ReportDefinition,
```

replace with:

```tsx
  REPORT_GROUPS,
  canOpenReport,
  type ReportDefinition,
```

Edit 4 of 14 — find:

```tsx
  "sales-tax": <PercentageOutlined />,
};
```

replace with:

```tsx
  "sales-tax": <PercentageOutlined />,
  "open-invoices": <FileTextOutlined />,
  "customer-balances": <TeamOutlined />,
  "sales-by-customer": <BarChartOutlined />,
  "unpaid-bills": <FileTextOutlined />,
  "vendor-balances": <ShopOutlined />,
  "expenses-by-vendor": <BarChartOutlined />,
  "reconciliation-report": <BankOutlined />,
  "change-log": <HistoryOutlined />,
  "month-end-close-log": <ClockCircleOutlined />,
  "voided-entries": <StopOutlined />,
};
```

Edit 5 of 14 — find:

```tsx

function reportsFromIds(ids: string[]) {
  return ids
```

replace with:

```tsx

function reportsFromIds(catalog: readonly ReportDefinition[], ids: string[]) {
  return ids
```

Edit 6 of 14 — find:

```tsx
  return ids
    .map((id) => REPORT_CATALOG.find((report) => report.id === id))
    .filter((report): report is ReportDefinition => Boolean(report));
```

replace with:

```tsx
  return ids
    .map((id) => catalog.find((report) => report.id === id))
    .filter((report): report is ReportDefinition => Boolean(report));
```

Edit 7 of 14 — find:

```tsx

export default function ReportsHub() {
  const [activeGroup, setActiveGroup] = useState<HubTab>(ALL_REPORTS);
```

replace with:

```tsx

/**
 * The Report Center. `permissionKeys` is the reader's (null when it could not
 * be read); a report that needs a permission the reader lacks is not offered.
 */
export default function ReportsHub({ permissionKeys }: { permissionKeys: readonly string[] | null }) {
  const catalog = useMemo(() => REPORT_CATALOG.filter((report) => canOpenReport(report, permissionKeys)), [permissionKeys]);
  const [activeGroup, setActiveGroup] = useState<HubTab>(ALL_REPORTS);
```

Edit 8 of 14 — find:

```tsx
      return activeGroup === ALL_REPORTS
        ? REPORT_CATALOG
        : REPORT_CATALOG.filter((report) => report.group === activeGroup);
    }
```

replace with:

```tsx
      return activeGroup === ALL_REPORTS
        ? catalog
        : catalog.filter((report) => report.group === activeGroup);
    }
```

Edit 9 of 14 — find:

```tsx

    return REPORT_CATALOG.filter((report) => {
      const group = REPORT_GROUPS.find((item) => item.id === report.group);
```

replace with:

```tsx

    return catalog.filter((report) => {
      const group = REPORT_GROUPS.find((item) => item.id === report.group);
```

Edit 10 of 14 — find:

```tsx
    });
  }, [activeGroup, normalizedQuery]);

```

replace with:

```tsx
    });
  }, [activeGroup, normalizedQuery, catalog]);

```

Edit 11 of 14 — find:

```tsx

  const favoriteReports = reportsFromIds(favoriteIds);
  const recentReports = reportsFromIds(recentIds).filter(
    (report) => !favoriteIds.includes(report.id),
```

replace with:

```tsx

  const favoriteReports = reportsFromIds(catalog, favoriteIds);
  const recentReports = reportsFromIds(catalog, recentIds).filter(
    (report) => !favoriteIds.includes(report.id),
```

Edit 12 of 14 — find:

```tsx
          id: ALL_REPORTS,
          label: `All reports (${REPORT_CATALOG.length})`,
          description: "Every report in One Book, whatever workflow it belongs to.",
```

replace with:

```tsx
          id: ALL_REPORTS,
          label: `All reports (${catalog.length})`,
          description: "Every report in One Book, whatever workflow it belongs to.",
```

Edit 13 of 14 — find:

```tsx
              items={[
                { key: ALL_REPORTS, label: `All reports (${REPORT_CATALOG.length})` },
                ...REPORT_GROUPS.map((group) => ({ key: group.id, label: group.label })),
```

replace with:

```tsx
              items={[
                { key: ALL_REPORTS, label: `All reports (${catalog.length})` },
                ...REPORT_GROUPS.map((group) => ({ key: group.id, label: group.label })),
```

Edit 14 of 14 — find:

```tsx
                options={[
                  { value: ALL_REPORTS, label: `All reports (${REPORT_CATALOG.length})` },
                  ...REPORT_GROUPS.map((group) => ({ value: group.id, label: group.label })),
```

replace with:

```tsx
                options={[
                  { value: ALL_REPORTS, label: `All reports (${catalog.length})` },
                  ...REPORT_GROUPS.map((group) => ({ value: group.id, label: group.label })),
```

- [ ] **Step 5: Edit `ctyhp-accounting/app/(app)/reports/page.tsx`**

Edit 1 of 3 — find:

```tsx
import { hasPermission } from "@/lib/services/access";
import PageHeader from "@/components/PageHeader";
```

replace with:

```tsx
import { hasPermission } from "@/lib/services/access";
import { currentAccess } from "@/lib/db/settings-access";
import PageHeader from "@/components/PageHeader";
```

Edit 2 of 3 — find:

```tsx
  if (!isInternalReportId(requestedReport)) {
    return (
```

replace with:

```tsx
  if (!isInternalReportId(requestedReport)) {
    const access = await currentAccess();
    return (
```

Edit 3 of 3 — find:

```tsx
        />
        <ReportsHub />
      </div>
```

replace with:

```tsx
        />
        <ReportsHub permissionKeys={access.permissionKeys} />
      </div>
```

- [ ] **Step 6: Edit `ctyhp-accounting/lib/domain/navigation.ts`**

Edit 1 of 1 — find:

```ts
      { key: "/opening-balances", label: "Opening Balances" },
    ],
```

replace with:

```ts
      { key: "/opening-balances", label: "Opening Balances" },
      // The client's mockup keeps Beancount here, last under Accounting: the whole
      // ledger as one plain-text file is a view of the books, not a report.
      { key: "/accounting/beancount", label: "Beancount" },
    ],
```

- [ ] **Step 7: Move Beancount under Accounting**

```bash
git mv "app/(app)/reports/beancount" "app/(app)/accounting/beancount"
```

This moves `page.tsx`, `BeancountClient.tsx` and `actions.ts` unchanged.

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/accounting/beancount/loading.tsx`**

```tsx
import { PageLoading } from "@/components/ui/PageStates";

/**
 * The Accounting overview's skeleton is the dashboard's shape; under it this
 * page would load behind a picture of a different screen. The plain one instead.
 */
export default function BeancountLoading() {
  return <PageLoading title="Loading the Beancount file" />;
}
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/reports/beancount/page.tsx`** (the old address, now a redirect):

```tsx
import { redirect } from "next/navigation";

/**
 * Beancount moved to the sidebar's Accounting group (`/accounting/beancount`).
 * This address stays so an old link, a bookmark or an earlier release note
 * still lands on the page, with its query string.
 */
export default async function BeancountMoved({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  const rest = query.toString();
  redirect(rest ? `/accounting/beancount?${rest}` : "/accounting/beancount");
}
```

- [ ] **Step 10: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/report-catalog.ts" "components/reports/ReportsHub.tsx" "app/(app)/reports/page.tsx" "lib/domain/navigation.ts" "tests/unit/reports-wave1-catalog.test.ts" "app/(app)/accounting/beancount/loading.tsx" "app/(app)/reports/beancount/page.tsx"
npx vitest run tests/unit/reports-wave1-catalog.test.ts tests/unit/navigation.test.ts tests/unit/report-catalog.test.ts tests/unit/changelog.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; every listed test file passes.

Expected: reports-wave1-catalog 7 tests, and the existing navigation, report-catalog and changelog tests, all passing.

- [ ] **Step 11: Commit**

```bash
git add "lib/domain/report-catalog.ts" "components/reports/ReportsHub.tsx" "app/(app)/reports/page.tsx" "lib/domain/navigation.ts" "tests/unit/reports-wave1-catalog.test.ts" "app/(app)/accounting/beancount/loading.tsx" "app/(app)/reports/beancount/page.tsx" "app/(app)/accounting/beancount/page.tsx" "app/(app)/accounting/beancount/BeancountClient.tsx" "app/(app)/accounting/beancount/actions.ts"
git commit -m "feat(reports): the ten reports in the Report Center; Beancount in the sidebar"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; do not mention Claude in the message.

---

### Task 7: Changelog and Guide

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`
- Modify: `ctyhp-accounting/lib/domain/system-guide.ts`

**Interfaces:**
- Consumes: the routes of Tasks 4–6 (the changelog and guide tests require every route to exist).
- Produces: release 1.92; five guide steps.


- [ ] **Step 1: Edit `ctyhp-accounting/lib/domain/changelog.ts`**

Edit 1 of 1 — find:

```ts
export const RELEASES: Release[] = [
  {
```

replace with:

```ts
export const RELEASES: Release[] = [
  {
    version: "1.92",
    date: "2026-10-08",
    headline: "Ten more reports from the client's mockup, and Beancount in the sidebar.",
    changes: [
      {
        kind: "added",
        title: "Open Invoices, Customer Balances and Sales by Customer",
        detail:
          "In the Report Center under Receivables. Open Invoices lists every invoice still open on a date, with how long it is past due; Customer Balances nets each customer's credits. Both end with the A/R Aging total and say whether it agrees with the receivables account. Sales by Customer adds up a period's income by customer; income no invoice stands behind is on a line of its own, so the total is Income on the Profit and Loss.",
        route: "/reports/open-invoices",
      },
      {
        kind: "added",
        title: "Unpaid Bills, Vendor Balances and Expenses by Vendor",
        detail:
          "In the Report Center under Payables, the same three for what is owed: Unpaid Bills, Vendor Balances held to the payables account, and Expenses by Vendor, which adds up to cost of sales and expenses on the Profit and Loss.",
        route: "/reports/unpaid-bills",
      },
      {
        kind: "added",
        title: "Reconciliation Report",
        detail:
          "Every bank reconciliation that was signed off, and whether it still agrees with the books. A reconciliation stops agreeing when an entry it ticked is voided; the report says by how much, and which entries.",
        route: "/reports/reconciliations",
      },
      {
        kind: "added",
        title: "Change Log and Month-End Close Log",
        detail:
          "The Change Log lists what changed in the books, when and by whom, for anybody whose role may read the audit log. The Month-End Close Log lists every close and reopen of a fiscal year's months, with the reason given at the time.",
        route: "/reports/change-log",
      },
      {
        kind: "added",
        title: "Voided and Reversed Entries",
        detail:
          "Every entry voided or reversed in a period, dated by when it happened. OneBook never deletes a posted entry, so there is nothing to put back: to record the transaction again, post it as a new entry.",
        route: "/reports/voided-entries",
      },
      {
        kind: "changed",
        title: "Beancount is in the sidebar",
        detail: "Beancount moved from the Report Center to the sidebar, last under Accounting. Old links still open it.",
        route: "/accounting/beancount",
      },
    ],
  },
  {
```

- [ ] **Step 2: Edit `ctyhp-accounting/lib/domain/system-guide.ts`**

Edit 1 of 5 — find:

```ts
        note: "This report ties to the Accounts Receivable control account by design.",
      },
    ],
  },
```

replace with:

```ts
        note: "This report ties to the Accounts Receivable control account by design.",
      },
      {
        action: "List the open invoices, and what each customer owes",
        control: "Open Invoices",
        route: "/reports/open-invoices",
        note:
          "Customer Balances nets each customer's credits; both end with the A/R Aging total and say whether it " +
          "agrees with the receivables account. Sales by Customer adds up a period's income by customer.",
      },
    ],
  },
```

Edit 2 of 5 — find:

```ts
        note: "Ties to the Accounts Payable control account.",
      },
```

replace with:

```ts
        note: "Ties to the Accounts Payable control account.",
      },
      {
        action: "List the unpaid bills, and what is owed to each vendor",
        control: "Unpaid Bills",
        route: "/reports/unpaid-bills",
        note:
          "Vendor Balances nets each vendor's credits and is held to the payables account. Expenses by Vendor " +
          "adds up a period's spending by vendor, to the Profit and Loss's cost of sales and expenses.",
      },
```

Edit 3 of 5 — find:

```ts
        note: "Needs permission and a reason, and the reopen is audited.",
      },
    ],
  },
```

replace with:

```ts
        note: "Needs permission and a reason, and the reopen is audited.",
      },
      {
        action: "Check that signed-off reconciliations still agree",
        control: "Reconciliation Report",
        route: "/reports/reconciliations",
        note:
          "A reconciliation stops agreeing when an entry it ticked is voided. The report says which ones, by how " +
          "much, and opens each.",
      },
    ],
  },
```

Edit 4 of 5 — find:

```ts
          "usually a reversal in the open period rather than a reopen.",
      },
```

replace with:

```ts
          "usually a reversal in the open period rather than a reopen.",
      },
      {
        action: "See every close and reopen of the year",
        control: "Month-End Close Log",
        route: "/reports/close-log",
        note: "When, by whom, and the reason given at the time, month by month.",
      },
      {
        action: "Take the whole ledger as one plain-text file",
        control: "Beancount",
        route: "/accounting/beancount",
        note:
          "Last under Accounting in the sidebar. The file is for bean-check and Fava, with a balance line per " +
          "reconciled statement.",
      },
```

Edit 5 of 5 — find:

```ts
        note: "Every protected write records the actor, the action and the before and after values.",
      },
```

replace with:

```ts
        note: "Every protected write records the actor, the action and the before and after values.",
      },
      {
        action: "Review what changed, and what was voided or reversed",
        control: "Change Log",
        route: "/reports/change-log",
        note:
          "The Change Log reads the audit log and needs the same permission. Voided and Reversed Entries lists " +
          "every entry voided or reversed in a period; nothing in OneBook is deleted.",
      },
```

- [ ] **Step 3: Check the release number**

Read `RELEASES[0].version` on `origin/main`. If it is no longer `1.91`, change `"1.92"` in the edit above to the next free number above main's (release numbers follow the order releases reach main).

- [ ] **Step 4: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/changelog.ts" "lib/domain/system-guide.ts"
npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; every listed test file passes.

- [ ] **Step 5: Commit**

```bash
git add "lib/domain/changelog.ts" "lib/domain/system-guide.ts"
git commit -m "docs(changelog): 1.92 ten reports from the mockup; Beancount in the sidebar"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; do not mention Claude in the message.

---

### Task 8: Live check, screenshots, push (controller)

**Files:**
- None (no code).

**Interfaces:**
- Consumes: the whole branch.

No code. Nothing is written to any company's books.

- [ ] **Step 1:** Whole-suite gates: `npx tsc --noEmit -p .`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run quality:budget`. `tests/unit/quality-query-timing.test.ts` can time out at 5 s while a build runs on the same machine; rerun it alone before calling it a failure.
- [ ] **Step 2:** Run the live check of Task 3 again on the finished branch.
- [ ] **Step 3:** `next start` on a port of its own (detached, PowerShell `Start-Process`), then a read-only Playwright pass on PC-Test: every report opens, runs without an error, and states its proof line; the Report Center shows 36 reports to an administrator and no Beancount card; `/reports/beancount?from=old-link` lands on `/accounting/beancount?from=old-link`; Beancount is the last Accounting item. No console errors.
- [ ] **Step 4:** Screenshots, light and dark, scrolled to the top, waiting for every spinner and for the Beancount page's heading; staff emails blurred in anything shared; an approval page. Nothing is pushed until the user approves the shots; then a data scan; then push.

