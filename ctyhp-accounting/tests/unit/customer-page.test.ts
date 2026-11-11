import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, fitsBox } from "@/lib/design/table-metrics";
import {
  OPEN_INVOICE_FIXED_WIDTHS,
  TRANSACTION_FIXED_WIDTHS,
} from "@/app/(app)/customers/[id]/CustomerDetailClient";

/**
 * 3.0.12: a page for each customer, collections first
 * (docs/superpowers/specs/2026-11-10-customer-detail-page-design.md). The
 * figures are lib/domain/customer-detail.ts and the reads
 * lib/services/customer-detail.ts, each tested on its own; this pins how the
 * page is put together.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const route = (file: string) => read("app", "(app)", "customers", "[id]", file);

const page = route("page.tsx");
const client = route("CustomerDetailClient.tsx");
const sum = (widths: readonly number[]) => widths.reduce((total, px) => total + px, 0);

describe("the customer page's tables fit 1280px", () => {
  it("open invoices: the number is the elastic column, at its floor", () => {
    expect(OPEN_INVOICE_FIXED_WIDTHS).toEqual([
      COLUMN.DATE,
      COLUMN.DATE,
      COLUMN.MONEY,
      COLUMN.MONEY,
      COLUMN.MONEY,
      COLUMN.STATUS,
      150,
    ]);
    expect(fitsBox(sum(OPEN_INVOICE_FIXED_WIDTHS), COLUMN.CODE)).toBe(true);
    expect(client).toMatch(/flexColumn<InvoiceWithCustomer>\(\{\s+title: "Number",[\s\S]*?floor: COLUMN\.CODE/);
  });

  it("transactions: the reference is the elastic column, at its floor", () => {
    expect(TRANSACTION_FIXED_WIDTHS).toEqual([COLUMN.DATE, 120, COLUMN.CODE, COLUMN.MONEY, COLUMN.STATUS]);
    expect(fitsBox(sum(TRANSACTION_FIXED_WIDTHS), COLUMN.TEXT_MIN)).toBe(true);
    expect(client).toMatch(/flexColumn<CustomerTransaction>\(\{\s+title: "Reference"/);
  });

  it("is held to its box: no table asks to scroll sideways", () => {
    expect(client).not.toContain("fit={false}");
  });
});

describe("the server page", () => {
  it("reads the customer and everything the page needs at once, and 404s an unknown id", () => {
    expect(page).toContain("params: Promise<{ id: string }>");
    expect(page).toContain("Promise.all([");
    expect(page).toContain("getCustomerDetail(");
    expect(page).toContain("notFound()");
    for (const read of [
      "getUserRole()",
      "listCurrencies(sb)",
      "listUsStates(sb)",
      "listActors(sb)",
      'hasPermission(sb, "audit.read")',
      "getCurrentCompanySettings(sb)",
    ]) {
      expect(page, read).toContain(read);
    }
  });

  it("is headed by the name, under Customers", () => {
    expect(page).toContain("title={customer.name}");
    expect(page).toContain('{ title: "Customers", href: "/customers" }');
    expect(page).toContain("{ title: customer.name }");
    expect(page).toContain("default_payment_terms_days ?? 30");
    expect(page).toContain("canWrite={canWrite(role)}");
    // New invoice follows invoice.create, as the Invoices page does: a Sales user has it without canWrite.
    expect(page).toContain('holdsPermission("invoice.create")');
    expect(page).toContain("canCreateInvoice={canCreateInvoice}");
    expect(client).toContain("canCreateInvoice: boolean;");
    expect(client).toMatch(/canCreateInvoice && customer\.is_active \? \(\s+<Link[\s\S]*?New invoice/);
    expect(client).toContain("canCreateInvoice && customer.is_active");
    expect(client).toContain("linkCustomer={false}");
    expect(client).toContain('format="MM/DD/YYYY"');
    expect(client).not.toContain("Every change made");
  });

  it("has a loading skeleton and a not-found page that leads back to Customers", () => {
    expect(route("loading.tsx")).toContain('<PageLoading title="Loading customer" />');
    const notFound = route("not-found.tsx");
    expect(notFound).toContain('title="Customer not found"');
    expect(notFound).toContain('description="It may have been removed, or the link is wrong."');
    expect(notFound).toContain('href="/customers"');
  });
});

describe("the customer page, Receive payment", () => {
  it("stays writers-only", () => {
    expect(client).toMatch(/\{canWrite \? \(\s*<Link href=\{receivePaymentHref\}>/);
  });
});

describe("the customer page", () => {
  it("opens on open invoices, then transactions, contact and credit, activity", () => {
    expect(client).toContain('defaultActiveKey="open"');
    const tabs: [string, string][] = [
      ["open", "Open invoices"],
      ["transactions", "Transactions"],
      ["contact", "Contact & credit"],
      ["activity", "Activity"],
    ];
    let previous = -1;
    for (const [key, label] of tabs) {
      const at = client.indexOf(`key: "${key}"`);
      expect(at, key).toBeGreaterThan(previous);
      expect(client.slice(at, at + 400), key).toContain(label);
      previous = at;
    }
  });

  it("acts on the customer: Receive payment and New invoice open with them chosen", () => {
    expect(client).toContain("`/payments?new=1&customer=${customer.id}`");
    expect(client).toContain("`/invoices?new=1&customer=${customer.id}`");
    // An inactive customer can still pay, but cannot be invoiced.
    expect(client).toMatch(/customer\.is_active \?[\s\S]{0,120}newInvoiceHref/);
    expect(client).toContain("<RowActionsMenu");
    expect(client).toContain('label: "Edit customer"');
  });

  it("builds the strip and the table from the shared rules and components", () => {
    expect(client).toContain("sortInvoicesByAttention(");
    expect(client).toContain("customerFacts(");
    expect(client).toContain("<InvoiceDetailDialog");
    expect(client).toContain("<CustomerFormModal");
    expect(client).toContain("invoiceAttentionLook(");
    expect(client).toContain("describeDso(");
  });

  it("says what each figure means, including when it cannot be worked out", () => {
    for (const words of [
      "Owed now",
      "Overdue",
      "Available credit",
      "Terms",
      "DSO",
      "No limit set",
      "Credit status could not be read",
      "Company default",
      "Net ${",
      "overdue first",
    ]) {
      expect(client, words).toContain(words);
    }
  });

  it("leaves issuing and voiding to Invoices", () => {
    const dialog = client.slice(client.indexOf("<InvoiceDetailDialog"));
    const props = dialog.slice(0, dialog.indexOf("/>"));
    expect(props).toContain("onDownloadPdf={downloadPdf}");
    expect(props).not.toContain("onIssue");
    expect(props).not.toContain("onVoid");
  });

  it("says when a table is empty and what to do next", () => {
    expect(client).toContain('"Nothing owed"');
    expect(client).toContain('"No transactions in this period"');
    expect(client).toContain("Show all dates");
  });

  it("reads transactions for the chosen range, 25 rows a page", () => {
    expect(client).toContain("getCustomerTransactionsAction(");
    expect(client).toContain("<DatePicker.RangePicker");
    expect(client).toContain("<Segmented");
    expect(client).toContain('subtract(12, "month")');
    expect(client).toContain("pageSizeOptionsFor(TRANSACTIONS_PAGE_SIZE)");
    expect(client).toContain("const TRANSACTIONS_PAGE_SIZE = 25;");
  });

  it("reads the change history only when Activity is opened, and only for audit.read", () => {
    // Once in the file: inside the Activity tab's load.
    expect(client.match(/getCustomerActivityAction\(/g)).toHaveLength(1);
    const load = client.slice(client.indexOf("async function loadActivity("));
    expect(load.indexOf("getCustomerActivityAction(")).toBeGreaterThan(0);
    expect(load.indexOf("getCustomerActivityAction(")).toBeLessThan(load.indexOf("\n  }\n"));
    // Loaded by opening the tab, not on arrival.
    expect(client).not.toContain("useEffect(");
    expect(client).toMatch(/key === "activity" && canReadAudit[^\n]*\n\s*void loadActivity\(\)/);
    // Shown the way a document shows its own, in dollars when the record names no currency.
    expect(client).toContain("<ChangeHistoryTable");
    expect(client).toContain('currencyFallback="USD"');
    expect(client).toContain("<ChangeHistoryUnavailable");
  });

  it("draws its colours from the theme's variables, never the light values", () => {
    expect(client).not.toContain("TOKENS.");
  });
});

describe("the change history is one table, shared", () => {
  const trail = read("components", "audit", "DocumentAuditTrail.tsx");

  it("DocumentAuditTrail draws it with the table the customer page uses", () => {
    expect(trail).toContain("export function ChangeHistoryTable(");
    expect(trail).toContain("export function ChangeHistoryUnavailable(");
    expect(trail).toContain("<ChangeHistoryTable");
    expect(trail).toContain("auditEntryCurrency(entry) ?? currencyFallback ?? null");
  });

  it("gives every reader a Statement button, ungated", () => {
    const client = route("CustomerDetailClient.tsx");
    expect(client).toContain("href={`/customers/${customer.id}/statement`}");
    expect(client).toContain(">Statement</Button>");
    expect(client).not.toMatch(/canWrite \|\| canCreateInvoice \?/);
  });
});
