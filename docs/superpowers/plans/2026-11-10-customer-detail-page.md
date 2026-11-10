# Customer Detail Page (3.0.12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/customers/[id]`: a collections-first customer page with a facts strip, Receive payment and New invoice actions, and four tabs (Open invoices, Transactions, Contact & credit, Activity). Make the Customers list link to it, one line per row and overdue first.

**Architecture:** A server page reads the customer, its credit row and its open invoices with `Promise.all`. A client component renders the header and tabs. Transactions and Activity are read on demand through server actions. Pure rules (the facts strip and the transaction merge) live in `lib/domain/customer-detail.ts` and reads in `lib/services/customer-detail.ts`. The customer form and the invoice dialog are extracted from their list screens so the page reuses them. No migration.

**Tech Stack:** Next.js App Router (server components and server actions), Ant Design 6, Supabase (PostgREST), Vitest (node environment, no DOM library: UI wiring is pinned by source-reading contract tests).

**Spec:** `docs/superpowers/specs/2026-11-10-customer-detail-page-design.md`

## Global Constraints

- **Language and money:** UI text is US English, money is USD, dates are MM/DD/YYYY via `formatDate` and `formatMoney` from `@/lib/format`.
- **Attribution:** no Claude/Claude Code attribution in commits, PR bodies or files. Stage files by name, never `git add -A`.
- **CRLF:** contract tests that match multi-line source must normalise CRLF: `readFileSync(...).replace(/\r\n/g, "\n")`.
- **Tables:** go through `@/components/ui/DataTable`. A raw antd `<Table` fails `table-adoption.test.ts`. Measured widths come from `COLUMN` in `@/lib/design/table-metrics`, and an elastic column uses `flexColumn`. A list table must pass `fitsBox(sum(fixed), COLUMN.TEXT_MIN)`.
- **Inline colours:** use `tokenVar("…")` from `@/lib/design/tokens`, never `TOKENS.*`.
- **Overdue words:** use `invoiceAttention`/`invoiceAttentionLook`/`sortInvoicesByAttention` from `@/lib/domain/invoice-attention`, never a second rule.
- **Writes:** writers are `canWrite(role)`. Sales can read customers but cannot edit them.
- **Changelog:** add release `3.0.12` at the top of `RELEASES` in `lib/domain/changelog.ts`, dated 2026-11-10.
- **Gates before push:** `npx tsc --noEmit -p .`, `npx eslint <changed files>`, `npx vitest run tests/unit` (full suite), then a self-check on a local build (Meridian, all non-GET requests blocked).

All paths below are relative to `ctyhp-accounting/`.

---

### Task 1: Pure rules for the facts strip and the transactions list

**Files:**
- Create: `lib/domain/customer-detail.ts`
- Test: `tests/unit/customer-detail.test.ts`

**Interfaces:**
- Produces:
  - `customerFacts(input: CustomerFactsInput): CustomerFacts`
  - `mergeCustomerTransactions(parts: CustomerTransactionParts): CustomerTransaction[]`
  - `CUSTOMER_TRANSACTION_TYPES`
  - `transactionTypeLabel(type: CustomerTransactionType): string`

- [ ] **Step 1: Write the failing test** at `tests/unit/customer-detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { customerFacts, mergeCustomerTransactions, transactionTypeLabel } from "@/lib/domain/customer-detail";
import type { CustomerCreditRow } from "@/lib/services/credit";

const TODAY = "2026-11-10";
const open = (id: string, due: string | null, balance: number, total = balance, status: "issued" | "partial" = "issued") => ({
  id, status, invoice_number: `INV-${id}`, due_date: due, total_minor: total, balance_due_minor: balance, created_at: "2026-01-01T00:00:00Z",
});
function credit(over: Partial<CustomerCreditRow["status"]> = {}): CustomerCreditRow {
  return {
    customerId: "c", name: "BlueRidge Foods", isActive: true, creditLimitMinor: null, creditTermsDays: null, creditHold: false,
    creditReviewedAt: null, openBalanceMinor: 1_000_000, overdueMinor: 1_000_000, oldestDueDate: "2026-04-23",
    salesWindowMinor: 0, hasBillingAddress: false,
    status: { state: "no_limit", label: "No limit set", availableMinor: null, utilization: null, overdueMinor: 1_000_000, daysSalesOutstanding: null, reasons: [], ...over },
  };
}

describe("customerFacts", () => {
  it("sums what is owed and overdue from the open invoices, and finds the latest one", () => {
    const facts = customerFacts({
      creditTermsDays: null, defaultTermsDays: 30, credit: credit(), today: TODAY,
      openInvoices: [open("4", "2026-04-23", 1_000_000, 2_680_000, "partial"), open("9", "2026-11-15", 50_000)],
    });
    expect(facts).toEqual({
      owedMinor: 1_050_000, openCount: 2, overdueMinor: 1_000_000, oldestLateDays: 201,
      availableMinor: null, limitMinor: null, termsDays: 30, termsAreDefault: true, dsoDays: null, creditKnown: true,
    });
  });

  it("uses the customer's own terms and the credit row's limit, availability and DSO", () => {
    const facts = customerFacts({
      creditTermsDays: 15, defaultTermsDays: 30, today: TODAY, openInvoices: [],
      credit: { ...credit({ state: "within_limit", availableMinor: 400_000, daysSalesOutstanding: 22.4 }), creditLimitMinor: 500_000 },
    });
    expect(facts).toMatchObject({ owedMinor: 0, openCount: 0, overdueMinor: 0, oldestLateDays: null, availableMinor: 400_000, limitMinor: 500_000, termsDays: 15, termsAreDefault: false, dsoDays: 22.4 });
  });

  it("says so when the credit status could not be read", () => {
    expect(customerFacts({ creditTermsDays: null, defaultTermsDays: 30, credit: null, today: TODAY, openInvoices: [] })).toMatchObject({
      creditKnown: false, availableMinor: null, limitMinor: null, dsoDays: null,
    });
  });
});

describe("mergeCustomerTransactions", () => {
  it("puts every kind of document in one list, newest first, typed and signed as the customer sees it", () => {
    const rows = mergeCustomerTransactions({
      invoices: [{ id: "i1", invoice_number: "INV-000004", issue_date: "2026-03-24", total_minor: 2_680_000, currency_code: "USD", status: "partial", memo: null }],
      payments: [{ id: "p1", payment_number: "PMT-000003", payment_date: "2026-03-30", amount_minor: 1_680_000, currency_code: "USD", status: "applied", memo: "RCV-1003" }],
      creditMemos: [{ id: "m1", credit_memo_number: "CM-000001", memo_date: "2026-03-30", total_minor: 5_000, currency_code: "USD", status: "applied", memo: null }],
      salesReceipts: [{ id: "s1", receipt_number: "SR-000001", receipt_date: "2026-02-01", total_minor: 9_900, currency_code: "USD", status: "posted", reference: "Card" }],
    });
    expect(rows.map((r) => [r.type, r.number, r.date, r.amountMinor, r.reference])).toEqual([
      ["payment", "PMT-000003", "2026-03-30", 1_680_000, "RCV-1003"],
      ["credit_memo", "CM-000001", "2026-03-30", 5_000, null],
      ["invoice", "INV-000004", "2026-03-24", 2_680_000, null],
      ["sales_receipt", "SR-000001", "2026-02-01", 9_900, "Card"],
    ]);
  });

  it("names each type for the reader", () => {
    expect(transactionTypeLabel("credit_memo")).toBe("Credit memo");
    expect(transactionTypeLabel("sales_receipt")).toBe("Sales receipt");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/customer-detail.test.ts`
Expected: FAIL with `Cannot find package '@/lib/domain/customer-detail'`.

- [ ] **Step 3: Implement** `lib/domain/customer-detail.ts`:

```ts
/**
 * What a customer's page says about them: the facts strip and the list of
 * every document. Pure (3.0.12, docs/superpowers/specs/2026-11-10-customer-detail-page-design.md).
 *
 * Owed and overdue are summed from the open invoices the page lists, so the
 * strip and the table under it can never disagree. "Overdue" is
 * invoiceAttention's rule. Limit, availability and DSO come from the credit
 * row, because they depend on more than the open invoices.
 */
import { invoiceAttention, type AttentionInvoice } from "@/lib/domain/invoice-attention";
import type { CustomerCreditRow } from "@/lib/services/credit";

export interface CustomerFactsInput {
  creditTermsDays: number | null;
  defaultTermsDays: number;
  /** Null when the credit status could not be read. */
  credit: CustomerCreditRow | null;
  openInvoices: readonly AttentionInvoice[];
  today: string;
}

export interface CustomerFacts {
  owedMinor: number;
  openCount: number;
  overdueMinor: number;
  /** Days past due of the latest open invoice; null when none is overdue. */
  oldestLateDays: number | null;
  availableMinor: number | null;
  limitMinor: number | null;
  termsDays: number;
  termsAreDefault: boolean;
  dsoDays: number | null;
  creditKnown: boolean;
}

export function customerFacts(input: CustomerFactsInput): CustomerFacts {
  let owedMinor = 0;
  let overdueMinor = 0;
  let oldestLateDays: number | null = null;
  for (const invoice of input.openInvoices) {
    owedMinor += invoice.balance_due_minor;
    const attention = invoiceAttention(invoice, input.today);
    if (attention.kind === "overdue") {
      overdueMinor += invoice.balance_due_minor;
      oldestLateDays = Math.max(oldestLateDays ?? 0, attention.days);
    }
  }
  return {
    owedMinor,
    openCount: input.openInvoices.length,
    overdueMinor,
    oldestLateDays,
    availableMinor: input.credit?.status.availableMinor ?? null,
    limitMinor: input.credit?.creditLimitMinor ?? null,
    termsDays: input.creditTermsDays ?? input.defaultTermsDays,
    termsAreDefault: input.creditTermsDays === null,
    dsoDays: input.credit?.status.daysSalesOutstanding ?? null,
    creditKnown: input.credit !== null,
  };
}

export const CUSTOMER_TRANSACTION_TYPES = ["invoice", "payment", "credit_memo", "sales_receipt"] as const;
export type CustomerTransactionType = (typeof CUSTOMER_TRANSACTION_TYPES)[number];

const TYPE_LABELS: Record<CustomerTransactionType, string> = {
  invoice: "Invoice",
  payment: "Payment",
  credit_memo: "Credit memo",
  sales_receipt: "Sales receipt",
};

export function transactionTypeLabel(type: CustomerTransactionType): string {
  return TYPE_LABELS[type];
}

export interface CustomerTransaction {
  id: string;
  type: CustomerTransactionType;
  date: string;
  number: string | null;
  reference: string | null;
  amountMinor: number;
  currencyCode: string;
  status: string;
}

export interface CustomerTransactionParts {
  invoices: { id: string; invoice_number: string | null; issue_date: string; total_minor: number; currency_code: string; status: string; memo: string | null }[];
  payments: { id: string; payment_number: string | null; payment_date: string; amount_minor: number; currency_code: string; status: string; memo: string | null }[];
  creditMemos: { id: string; credit_memo_number: string | null; memo_date: string; total_minor: number; currency_code: string; status: string; memo: string | null }[];
  salesReceipts: { id: string; receipt_number: string; receipt_date: string; total_minor: number; currency_code: string; status: string; reference: string | null }[];
}

/** Newest first; on one date, payments and credits before the invoices they settle. */
export function mergeCustomerTransactions(parts: CustomerTransactionParts): CustomerTransaction[] {
  const rank: Record<CustomerTransactionType, number> = { payment: 0, credit_memo: 1, sales_receipt: 2, invoice: 3 };
  const rows: CustomerTransaction[] = [
    ...parts.invoices.map((r) => ({ id: r.id, type: "invoice" as const, date: r.issue_date, number: r.invoice_number, reference: r.memo, amountMinor: r.total_minor, currencyCode: r.currency_code, status: r.status })),
    ...parts.payments.map((r) => ({ id: r.id, type: "payment" as const, date: r.payment_date, number: r.payment_number, reference: r.memo, amountMinor: r.amount_minor, currencyCode: r.currency_code, status: r.status })),
    ...parts.creditMemos.map((r) => ({ id: r.id, type: "credit_memo" as const, date: r.memo_date, number: r.credit_memo_number, reference: r.memo, amountMinor: r.total_minor, currencyCode: r.currency_code, status: r.status })),
    ...parts.salesReceipts.map((r) => ({ id: r.id, type: "sales_receipt" as const, date: r.receipt_date, number: r.receipt_number, reference: r.reference, amountMinor: r.total_minor, currencyCode: r.currency_code, status: r.status })),
  ];
  return rows.sort((a, b) => b.date.localeCompare(a.date) || rank[a.type] - rank[b.type] || (b.number ?? "").localeCompare(a.number ?? ""));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/customer-detail.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/customer-detail.ts ctyhp-accounting/tests/unit/customer-detail.test.ts
git commit -m "feat(customers): facts and transaction rules for the customer page (3.0.12)"
```

---

### Task 2: Customer-scoped reads

**Files:**
- Create: `lib/services/customer-detail.ts`
- Test: `tests/unit/customer-detail-service.test.ts`

**Interfaces:**
- Consumes:
  - `mergeCustomerTransactions` and `CustomerTransaction` from Task 1;
  - `listOpenInvoicesForCustomer(sb, id)` from `lib/services/invoicing.ts`;
  - `listCustomerCredit(sb)` from `lib/services/credit.ts`;
  - `readAllPages` from `lib/services/paging.ts`.
- Produces:
  - `getCustomerDetail(sb, id): Promise<CustomerDetail | null>`
  - `listCustomerTransactions(sb, id, range: { from: string | null; to: string | null }): Promise<CustomerTransaction[]>`
  - `CustomerDetail = { customer: CustomerRow; credit: CustomerCreditRow | null; creditError: string | null; openInvoices: InvoiceRow[] }`. The page works out Paid as total minus balance.

- [ ] **Step 1: Write the failing test** at `tests/unit/customer-detail-service.test.ts`. Build the fake client like `tests/unit/balance-comparison-service.test.ts` `fakeClient`: `from(table)` returns a builder whose `select`, `eq`, `neq`, `gte`, `lte`, `in`, `gt`, `order` and `range` record their arguments and return the builder. `maybeSingle()` resolves `{ data: rows[0] ?? null, error: null }`, and awaiting the builder resolves `{ data: rows, error: null }`. Then test:

```ts
it("returns null for a customer that does not exist", async () => {
  const sb = fakeClient({ acc_customer: [] });
  await expect(getCustomerDetail(sb, "missing")).resolves.toBeNull();
});

it("reads each kind of document by this customer and the date range only", async () => {
  const sb = fakeClient({ acc_invoice: [], acc_payment: [], acc_credit_memo: [], acc_sales_receipt: [] });
  await listCustomerTransactions(sb, "c1", { from: "2025-11-10", to: "2026-11-10" });
  for (const table of ["acc_invoice", "acc_payment", "acc_credit_memo", "acc_sales_receipt"]) {
    const call = sb.calls.find((c) => c.table === table)!;
    expect(call.eq).toContainEqual(["customer_id", "c1"]);
    expect(call.gte.length).toBe(1);
    expect(call.lte.length).toBe(1);
  }
  // A draft invoice is not a transaction yet.
  expect(sb.calls.find((c) => c.table === "acc_invoice")!.neq).toContainEqual(["status", "draft"]);
});

it("keeps the page when the credit status cannot be read", async () => {
  const sb = fakeClient({ acc_customer: [{ id: "c1", name: "BlueRidge Foods" }], acc_invoice: [] }, { error: { message: "rpc down" } });
  const detail = await getCustomerDetail(sb, "c1");
  expect(detail?.credit).toBeNull();
  expect(detail?.creditError).toBe("Credit status could not be read");
});
```

- [ ] **Step 2: Run it and watch it fail.** `npx vitest run tests/unit/customer-detail-service.test.ts` should fail with a missing module.

- [ ] **Step 3: Implement** `lib/services/customer-detail.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerRow, InvoiceRow } from "@/lib/db/types";
import { listOpenInvoicesForCustomer } from "@/lib/services/invoicing";
import { listCustomerCredit, type CustomerCreditRow } from "@/lib/services/credit";
import { readAllPages } from "@/lib/services/paging";
import { mergeCustomerTransactions, type CustomerTransaction, type CustomerTransactionParts } from "@/lib/domain/customer-detail";

export class CustomerDetailError extends Error {}

export interface CustomerDetail {
  customer: CustomerRow;
  credit: CustomerCreditRow | null;
  creditError: string | null;
  openInvoices: InvoiceRow[];
}

/** One customer, with what the top of their page needs. Null when there is no such customer. */
export async function getCustomerDetail(sb: SupabaseClient, id: string): Promise<CustomerDetail | null> {
  const { data, error } = await sb.from("acc_customer").select("*").eq("id", id).maybeSingle();
  if (error) throw new CustomerDetailError(error.message);
  if (!data) return null;
  const [openInvoices, credit] = await Promise.all([
    listOpenInvoicesForCustomer(sb, id),
    // The credit read covers every customer (one RPC); a failure must not take the page down.
    listCustomerCredit(sb).then(
      (rows) => ({ row: rows.find((r) => r.customerId === id) ?? null, error: null }),
      () => ({ row: null, error: "Credit status could not be read" }),
    ),
  ]);
  return { customer: data as CustomerRow, credit: credit.row, creditError: credit.error, openInvoices };
}

/** Every invoice (once issued), payment, credit memo and sales receipt for this customer in the range. */
export async function listCustomerTransactions(
  sb: SupabaseClient,
  id: string,
  range: { from: string | null; to: string | null },
): Promise<CustomerTransaction[]> {
  const fail = (message: string) => new CustomerDetailError(message);
  const between = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q, column: string) => {
    let next = q;
    if (range.from) next = next.gte(column, range.from);
    if (range.to) next = next.lte(column, range.to);
    return next;
  };
  const [invoices, payments, creditMemos, salesReceipts] = await Promise.all([
    readAllPages<CustomerTransactionParts["invoices"][number]>((f, t) =>
      between(sb.from("acc_invoice").select("id,invoice_number,issue_date,total_minor,currency_code,status,memo").eq("customer_id", id).neq("status", "draft"), "issue_date").order("issue_date").order("id").range(f, t), fail),
    readAllPages<CustomerTransactionParts["payments"][number]>((f, t) =>
      between(sb.from("acc_payment").select("id,payment_number,payment_date,amount_minor,currency_code,status,memo").eq("customer_id", id), "payment_date").order("payment_date").order("id").range(f, t), fail),
    readAllPages<CustomerTransactionParts["creditMemos"][number]>((f, t) =>
      between(sb.from("acc_credit_memo").select("id,credit_memo_number,memo_date,total_minor,currency_code,status,memo").eq("customer_id", id).neq("status", "draft"), "memo_date").order("memo_date").order("id").range(f, t), fail),
    readAllPages<CustomerTransactionParts["salesReceipts"][number]>((f, t) =>
      between(sb.from("acc_sales_receipt").select("id,receipt_number,receipt_date,total_minor,currency_code,status,reference").eq("customer_id", id), "receipt_date").order("receipt_date").order("id").range(f, t), fail),
  ]);
  return mergeCustomerTransactions({ invoices, payments, creditMemos, salesReceipts });
}
```

If `readAllPages`'s generic fetch type does not accept the builder (`PromiseLike<PageResult>`), cast the builder `as unknown as PromiseLike<PageResult>`, the way `balance-comparison.ts` does. Check that file and follow it exactly.

- [ ] **Step 4: Run it and watch it pass.** Then run `npx tsc --noEmit -p .`; it should exit 0.

- [ ] **Step 5: Commit** the service and its test: `feat(customers): reads for one customer's page (3.0.12)`.

---

### Task 3: Extract the customer form into `CustomerFormModal`

**Files:**
- Create: `app/(app)/customers/CustomerFormModal.tsx`
- Modify: `app/(app)/customers/CustomersClient.tsx` (remove the form state and Modal and render `<CustomerFormModal>`)
- Test: `tests/unit/customer-form-shared.test.ts`, and update the regexes in `tests/unit/sales-data-safety-contract.test.ts` and `tests/unit/sales-forms-contract.test.ts` that read `CustomersClient.tsx` so they read `CustomerFormModal.tsx`.

**Interfaces:**
- Produces: `export default function CustomerFormModal(props: { open: boolean; customer: CustomerRow | null; usStates: { code: string; name: string }[]; onClose: () => void; onSaved?: () => void })`. `customer === null` means New customer. Its body is the current Modal, Form, `submit`, `closeForm`, `dirty`/`useUnsavedGuard`, `saveError`, `validateOrFocus` and `customerSavedMessage` code from `CustomersClient.tsx`, moved without behaviour change. `open` drives the Modal. When `customer` changes, the form loads its values (the current `openEdit` body runs in a `useEffect` on `[open, customer]`). After a save it calls `onSaved?.()` and then `router.refresh()`.

- [ ] **Step 1: Write the failing test** at `tests/unit/customer-form-shared.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
describe("one customer form for the list and the customer page", () => {
  it("lives in CustomerFormModal and the list renders it", () => {
    const form = read("app", "(app)", "customers", "CustomerFormModal.tsx");
    expect(form).toContain("closeOrConfirmDiscard(");
    expect(form).toContain("validateOrFocus(");
    expect(form).toContain('type="email"');
    const list = read("app", "(app)", "customers", "CustomersClient.tsx");
    expect(list).toContain("<CustomerFormModal");
    expect(list).not.toContain("updateCustomerAction");
  });
});
```

- [ ] **Step 2:** Run it and watch it fail.
- [ ] **Step 3:** Move the code into `CustomerFormModal.tsx` as described under Interfaces. In `CustomersClient.tsx`, keep `const [formFor, setFormFor] = useState<{ customer: CustomerRow | null } | null>(null)`. Make `openCreate` call `setFormFor({ customer: null })` and the Edit icon call `setFormFor({ customer: row })`, then render `<CustomerFormModal open={formFor !== null} customer={formFor?.customer ?? null} usStates={usStates} onClose={() => setFormFor(null)} />`.
- [ ] **Step 4:** Point the two contract tests' customer-form regexes at `CustomerFormModal.tsx`. Keep the same assertions: `maskClosable={false}`, `onCancel={closeForm}`, `useUnsavedGuard(open && dirty, modal, "this customer")`, `setSaveError(...)`, `message.success(customerSavedMessage(` and the email and phone types. Run `npx vitest run tests/unit/customer-form-shared.test.ts tests/unit/sales-data-safety-contract.test.ts tests/unit/sales-forms-contract.test.ts`; all should pass.
- [ ] **Step 5:** Commit: `refactor(customers): one customer form for the list and the customer page (3.0.12)`.

---

### Task 4: Extract the invoice dialog into `InvoiceDetailDialog`

**Files:**
- Create: `app/(app)/invoices/InvoiceDetailDialog.tsx`
- Modify: `app/(app)/invoices/InvoicesClient.tsx` (remove the View lines Modal, its state and `viewInvoiceLines`, and render `<InvoiceDetailDialog>`)
- Test: `tests/unit/invoice-dialog-shared.test.ts`, and update `tests/unit/invoice-list-layout.test.ts` "the invoice dialog" block to read `InvoiceDetailDialog.tsx`.

**Interfaces:**
- Produces: `export default function InvoiceDetailDialog(props)`.
  - Data props: `invoice: InvoiceWithCustomer | null` (null means closed), `currencies: CurrencyRow[]`, `actors: ActorRow[]` and `canReadAudit: boolean`.
  - Action props: `onClose: () => void`, `onDownloadPdf: (inv) => void`, `pdfBusy: boolean`, `onIssue?: (inv) => void`, `issueBusy?: boolean`, `onVoid?: (inv) => void`. `onIssue` and `onVoid` are omitted when the viewer may not issue or void.
  - Inside, it holds the `viewLines`/`viewAudit`/`viewSettlements`/`viewEstimate` state and loads them with `getInvoiceDetailAction(invoice.id, canReadAudit)` in a `useEffect` on `invoice?.id`. The header, totals, settlements, audit trail and footer JSX move over unchanged.
  - **New:** the header's Customer value becomes `<Link href={`/customers/${invoice.customer_id}`}>{invoice.customer_name}</Link>`.
- Consumes: `invoiceVoidOption`, `invoiceAttention` and `invoiceAttentionLook`, which already exist.

- [ ] **Step 1: Write the failing test** at `tests/unit/invoice-dialog-shared.test.ts`. Read both files with CRLF normalised and assert:
  - `InvoiceDetailDialog.tsx` contains `getInvoiceDetailAction(` and `` href={`/customers/${invoice.customer_id}`} ``;
  - `InvoicesClient.tsx` contains `<InvoiceDetailDialog` and no longer contains `getInvoiceDetailAction(`.
- [ ] **Step 2:** Run it and watch it fail.
- [ ] **Step 3:** Move the code. `InvoicesClient` keeps `const [viewing, setViewing] = useState<InvoiceWithCustomer | null>(null)`, and the "View lines" menu item calls `setViewing(r)`. `issue()` and `voidInv()` call `setViewing(null)` on success, replacing `setLinesOpen(false)`. Keep `VIEW_INVOICE_MODAL_WIDTH` and `INVOICE_LINES_FIXED_WIDTHS` exported from `InvoicesClient.tsx`, because `table-fit-batch-1.test.ts` imports them, and import them into the dialog.
- [ ] **Step 4:** Point `invoice-list-layout.test.ts`'s dialog assertions at `InvoiceDetailDialog.tsx`; they check `startIssue(`/`confirmVoid(` through the callback props, so update them to `onIssue(` and `onVoid(`. Run `npx vitest run tests/unit/invoice-dialog-shared.test.ts tests/unit/invoice-list-layout.test.ts tests/unit/table-fit-batch-1.test.ts tests/unit/detail-reads-one-request.test.ts`; all should pass.
- [ ] **Step 5:** Commit: `refactor(invoices): the invoice dialog as its own component, with the customer linked (3.0.12)`.

---

### Task 5: Open New invoice and Receive payment with the customer chosen

**Files:**
- Modify: `app/(app)/invoices/page.tsx` (read `customer` from `searchParams`)
- Modify: `app/(app)/invoices/InvoicesClient.tsx` (new prop `initialCustomerId: string | null`)
- Modify: `app/(app)/payments/page.tsx` and `app/(app)/payments/PaymentsClient.tsx` (new prop `initialCustomerId`)
- Modify: `app/(app)/payments/ReceivePaymentModal.tsx` (new prop `initialCustomerId?: string | null`)
- Test: `tests/unit/customer-prefill.test.ts`

**Interfaces:**
- Produces: `/invoices?new=1&customer=<id>` and `/payments?new=1&customer=<id>` open their form with that customer chosen. An unknown id is ignored, and so is an inactive one for invoices.

- [ ] **Step 1: Write the failing test** at `tests/unit/customer-prefill.test.ts`. It reads the five files and asserts:
  - both pages contain `params.customer` (or `(await searchParams).customer`);
  - `InvoicesClient.tsx` contains `initialCustomerId` and `applyCustomerDefaults(initialCustomerId)`;
  - `ReceivePaymentModal.tsx` contains `customer_id: initialCustomerId` and `loadOpenInvoices(initialCustomerId)`.
- [ ] **Step 2:** Run it and watch it fail.
- [ ] **Step 3:** Implement.
  - **Invoices page:** `const prefillCustomer = params.customer && customers.some((c) => c.id === params.customer && c.is_active) ? params.customer : null;`. Pass `initialCustomerId={prefillCustomer}`.
  - **InvoicesClient:** add a one-shot `useEffect`:

```ts
useEffect(() => {
  if (!open || !initialCustomerId || prefilled.current) return;
  prefilled.current = true;
  form.setFieldValue("customer_id", initialCustomerId);
  applyCustomerDefaults(initialCustomerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [open, initialCustomerId]);
```

    `prefilled` is a `useRef(false)`. It runs once, so a later New invoice starts empty.
  - **Payments page:** validate the id exists in `customers` and pass `initialCustomerId`. **PaymentsClient** passes it to `ReceivePaymentModal` only for the first session (`receiveSession === 0`, no `basis`).
  - **ReceivePaymentModal:**
    - `initialValues` for an ordinary receipt gains `customer_id: initialCustomerId ?? undefined`.
    - Add an effect: `useEffect(() => { if (draft || !initialCustomerId) return; void loadOpenInvoices(initialCustomerId); }, [])`. It needs an `// eslint-disable-next-line react-hooks/exhaustive-deps` comment, the same as the existing draft effect.
- [ ] **Step 4:** Run the test, then `npx tsc --noEmit -p .`; both should pass.
- [ ] **Step 5:** Commit: `feat(sales): open New invoice and Receive payment with a customer chosen (3.0.12)`.

---

### Task 6: The customer page

**Files:**
- Create: `app/(app)/customers/[id]/page.tsx`, `app/(app)/customers/[id]/loading.tsx`, `app/(app)/customers/[id]/not-found.tsx`, `app/(app)/customers/[id]/actions.ts` and `app/(app)/customers/[id]/CustomerDetailClient.tsx`
- Test: `tests/unit/customer-page.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: the route `/customers/[id]`.
  - `export const OPEN_INVOICE_FIXED_WIDTHS` comes from `CustomerDetailClient.tsx`: Number `COLUMN.CODE`, Issued `COLUMN.DATE`, Due `COLUMN.DATE`, Total, Paid and Balance due each `COLUMN.MONEY`, Status `COLUMN.STATUS` and Actions 150. It has no elastic column, so the table is `fit={false}`. Add it to the matrix list in `tests/unit/table-fit-contract.test.ts` only if that test requires it. Otherwise give Number `flexColumn` and drop `COLUMN.CODE` from the array.
  - The actions are `getCustomerTransactionsAction(id, { from, to })` and `getCustomerActivityAction(id)`, both returning `ActionResult<…>`.

- [ ] **Step 1: Write the failing test** at `tests/unit/customer-page.test.ts`:
  - `fitsBox(sum(OPEN_INVOICE_FIXED_WIDTHS), 0)` holds, when the table has no elastic column.
  - `page.tsx` calls `getCustomerDetail(` and `notFound()`.
  - `CustomerDetailClient.tsx` has these tab keys and labels: `"open"` "Open invoices", `"transactions"` "Transactions", `"contact"` "Contact & credit" and `"activity"` "Activity".
  - It links `` `/payments?new=1&customer=${customer.id}` `` and `` `/invoices?new=1&customer=${customer.id}` ``.
  - It uses `sortInvoicesByAttention(`, `customerFacts(`, `<InvoiceDetailDialog` and `<CustomerFormModal`.
  - It calls `getCustomerActivityAction(` only inside the Activity tab's load.
- [ ] **Step 2:** Run it and watch it fail.
- [ ] **Step 3: Implement.**
  - **`page.tsx`**
    - `params: Promise<{ id: string }>`.
    - Read in `Promise.all`: `getCustomerDetail`, `getUserRole`, `listCurrencies`, `listUsStates`, `listActors`, `hasPermission(sb, "audit.read")` and `getCurrentCompanySettings`.
    - If the detail is null, call `notFound()`.
    - Render `PageHeader` with `title={customer.name}` and `breadcrumbItems={[{ title: "Customers", href: "/customers" }, { title: customer.name }]}`, then `<CustomerDetailClient …/>` with `defaultTermsDays = settings?.default_payment_terms_days ?? 30` and `canWrite={canWrite(role)}`.
  - **`loading.tsx`:** `<PageLoading title="Loading customer" />`.
  - **`not-found.tsx`:** `EmptyState` titled "Customer not found", with the description "It may have been removed, or the link is wrong." and an action linking to `/customers`.
  - **`actions.ts`** (`"use server"`):
    - Validate `id` with the existing uuid schema used by other actions; search `lib/domain/schemas.ts` for one.
    - `getCustomerTransactionsAction` calls `listCustomerTransactions`.
    - `getCustomerActivityAction` checks `hasPermission(sb, "audit.read")`, then returns `searchAudit(sb, { table_name: "acc_customer", record_id: id, limit: 200 })`.
    - Both use the repo's `ActionResult` and error-mapping pattern from `app/(app)/invoices/actions.ts`.
  - **`CustomerDetailClient.tsx`**
    - **Header row:** name with `StatusTag` for active/inactive and the credit-state `Tag` (`creditStateColor`). Under it the contact line: email `<a href={`mailto:…`}>`, phone `<a href={`tel:…`}>` and city/state, each missing value said in words, then an **Add contact details** link that opens `CustomerFormModal` (writers only). Buttons go on the right.
      - **Receive payment** is the primary link button.
      - **New invoice** is hidden when inactive.
      - **⋯** is `RowActionsMenu` with Edit customer.
    - **Facts strip:** a 5-cell grid from `customerFacts`.
      - **Owed now:** `formatMoney`, with "*n* open invoices".
      - **Overdue:** in the danger colour when greater than 0, with "oldest *n* days late".
      - **Available credit:** "—" with "No limit set" when the limit is null, or "Credit status could not be read" when `!creditKnown`.
      - **Terms:** `Net ${termsDays}`, with "Company default" when `termsAreDefault`.
      - **DSO:** `describeDso(dso, CREDIT_SALES_WINDOW_DAYS)` from `lib/domain/credit`.
      - Colours come from `tokenVar`.
    - **Tabs** (antd `Tabs`, `defaultActiveKey="open"`):
      - **Open invoices:**
        - A note line: `${n} open invoices · ${money} due · overdue first`.
        - `DataTable` over `sortInvoicesByAttention(openInvoices, today)` with columns Number (link button that calls `setViewing(inv)`), Issued, Due, Total, Paid (`total - balance`), Balance due, Status (`invoiceAttentionLook` tag or `StatusTag` with `PAID_LABELS`) and Actions (a "Receive payment" link to the payments prefill URL).
        - Empty state: "Nothing owed", plus New invoice for writers.
      - **Transactions:**
        - A Type `Segmented` (All, Invoices, Payments, Credit memos, Sales receipts) and a `DatePicker.RangePicker`, defaulting to [today − 12 months, today].
        - It loads through `getCustomerTransactionsAction` when the tab is first opened and on each range change.
        - `DataTable` columns: Date, Type (`transactionTypeLabel`), Number, Reference (`flexColumn`), Amount (right-aligned) and Status (`StatusTag`). Pagination is 25 rows.
        - Empty state: "No transactions in this period", with a button that clears the range.
      - **Contact & credit:**
        - Two `Descriptions` (bordered, `column={1}`), Contact and Credit, with an Edit button for writers that opens `CustomerFormModal`.
        - Credit shows Limit ("Not set"), Terms, Hold (Yes/No), Last reviewed (`formatDate`) and the review note.
      - **Activity:**
        - If `canReadAudit`, it loads `getCustomerActivityAction` on first open and renders the change-history `DataTable` the same way `DocumentAuditTrail` does, using `summarizeAuditChanges(diffAuditEntry(entry), 3, null)`. Customers have no currency; `credit_limit_minor` is USD, so pass `"USD"`.
        - Otherwise it shows the same `Alert` text as `DocumentAuditTrail`.
    - It also renders `<InvoiceDetailDialog invoice={viewing} … onClose={() => setViewing(null)} onDownloadPdf={…} />` without `onIssue` or `onVoid`. Issuing and voiding stay on Invoices, and the dialog's footer still offers Download PDF.
- [ ] **Step 4:** Run `npx vitest run tests/unit/customer-page.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts`, then `npx tsc --noEmit -p .`; all should pass.
- [ ] **Step 5:** Commit: `feat(customers): a page for each customer, collections first (3.0.12)`.

---

### Task 7: The Customers list links to it, one line per row, overdue first

**Files:**
- Modify: `app/(app)/customers/CustomersClient.tsx`
- Test: `tests/unit/customer-list-layout.test.ts`

**Interfaces:**
- Produces: `export const CUSTOMER_LIST_FIXED_WIDTHS` covering Credit limit, Owed now, Overdue, Available, Credit status, Status and Actions.

- [ ] **Step 1: Write the failing test.**
  - `fitsBox(sum(CUSTOMER_LIST_FIXED_WIDTHS), COLUMN.TEXT_MIN)` is true.
  - The source contains `` href={`/customers/${row.id}`} ``.
  - It does not contain `secondaryLine(`.
  - It contains `title: "Overdue"`.
  - It contains a sort by `overdueMinor` that opens the list with the largest overdue first.
- [ ] **Step 2:** Run it and watch it fail.
- [ ] **Step 3: Implement.**
  - The Customer cell is `<Link href={`/customers/${row.id}`}>{row.name}</Link>`; remove the email/city line.
  - Add an `Overdue` column after `Owed now`: right-aligned, `formatMoney`, "—" when 0, with a `sorter`.
  - `visibleCustomers` is sorted with overdue rows first, largest overdue first, then by name.
  - Widths: Credit limit, Owed now, Overdue and Available are `COLUMN.MONEY` (116 each); Credit status is 140, Status 100 and Actions 80. That is 784 in total, which leaves 200 for Customer at 984. If `fitsBox` fails, trim Credit status to 130.
- [ ] **Step 4:** Run the new test and `tests/unit/sales-forms-contract.test.ts` (whose `mailto:` assertion now moves to the customer page; update it to read `CustomerDetailClient.tsx`). Both should pass.
- [ ] **Step 5:** Commit: `feat(customers): the list links to each customer, one line per row, overdue first (3.0.12)`.

---

### Task 8: Changelog, full gates, self-check and PR

**Files:**
- Modify: `lib/domain/changelog.ts` (release 3.0.12)

- [ ] **Step 1:** Add release `3.0.12` (date 2026-11-10) with these entries:
  - **Added** "A page for each customer" (route `/customers`). It describes the header, the facts strip, Receive payment and New invoice, and the four tabs.
  - **Changed** "Customers list" (route `/customers`): links, one line per row, an Overdue column, overdue first.
  - **Changed** "New invoice and Receive payment can open with a customer chosen" (route `/invoices`).
  - **Changed** "An invoice's customer links to their page" (route `/invoices`).
- [ ] **Step 2:** Run the gates.
  - `npx tsc --noEmit -p .` must exit 0.
  - `npx eslint` on every changed file must exit 0.
  - `npx vitest run tests/unit` must pass everything. Re-run any test that only times out under load (`quality-query-timing`) on its own.
- [ ] **Step 3: Self-check on a local build.**
  - Run `npm ci` in the worktree, because Turbopack refuses a `node_modules` junction. Copy `.env.local` in, build with `run_in_background`, and start the server detached from PowerShell.
  - Run a Playwright script under `.quality-results/`, with every non-GET request aborted except the read server actions, that:
    - opens `/customers` and checks the links, the one-line 40px rows and the order;
    - opens BlueRidge Foods and checks the facts (Owed $10,000.00, Overdue $10,000.00, 201 days late), the open invoice row and its tag widths (measured, not clipped), the dialog from INV-000004 with its customer link, the Transactions tab (INV-000004 and PMT-000003), Contact & credit with Edit opening the form, and Activity;
    - checks that Receive payment lands on `/payments` with BlueRidge chosen and its open invoices loaded (writes blocked, nothing saved);
    - checks that New invoice lands on `/invoices` with BlueRidge chosen and its due date set;
    - repeats at 1280px and 390px.
  - Screenshot each step and look at every screenshot.
- [ ] **Step 4: Clean up.** Stop the server by PID, delete `.env.local` and the scripts, then run the pre-push check as its own command: `origin/main` unchanged, only this branch's files, and a scan for attribution and secrets.
- [ ] **Step 5: Commit, push and open the PR.**
  - Commit the changelog.
  - Push with `git -c "lfs.https://github.com/quocviet-IT/quickbook-finance.git/info/lfs.access=basic" push -u origin feat/customer-detail-page-v312`.
  - Open the PR through the GitHub API (`git credential fill` token). The body has no attribution.
  - Wait for CI.
