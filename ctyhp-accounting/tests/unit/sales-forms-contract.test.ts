import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 3.0.10: the a11y and empty-state findings from the 3.0.8 review of the
 * Sales screens. The behaviour lives in lib/domain/sales-form.ts and
 * lib/client/validate-or-focus.ts (tested there); this pins that the screens
 * use it.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const lines = () => read("components", "SalesLineItems.tsx");
const invoices = () => read("app", "(app)", "invoices", "InvoicesClient.tsx");
const customers = () => read("app", "(app)", "customers", "CustomerFormModal.tsx");
const customerPage = () =>
  read("app", "(app)", "customers", "[id]", "CustomerDetailClient.tsx");
const customerList = () => read("app", "(app)", "customers", "CustomersClient.tsx");
const estimate = () => read("app", "(app)", "estimates", "EstimateFormModal.tsx");

describe("the line items editor is a table with a heading on every column", () => {
  it("has a header row naming each column, with an amount per line", () => {
    const source = lines();
    expect(source).toContain("<table");
    for (const heading of ["Item", "Description", "Qty", "Unit price", "Amount", "Income account", "Tax"]) {
      expect(source, heading).toMatch(new RegExp(`<th[^>]*>\\s*${heading}`));
    }
    expect(source).toContain("salesLineAmountMinor(");
  });

  // Placeholders were the only labels: a filled-in "1" said nothing.
  it("labels every field for a screen reader by line and column, not by placeholder", () => {
    const source = lines();
    for (const column of ["item", "description", "quantity", "unit price", "income account", "tax"]) {
      expect(source, column).toContain(`aria-label={\`Line \${index + 1} ${column}\`}`);
    }
    expect(source).not.toMatch(/placeholder="(Description|Quantity|Unit price|Income account)"/);
  });

  it("says what to do in each error, not just the field's name", () => {
    const source = lines();
    expect(source).toContain('"Enter a quantity"');
    expect(source).toContain('"Enter a unit price"');
    expect(source).toContain('"Choose an income account"');
    expect(source).not.toMatch(/message: "(Quantity|Price|Account)"/);
  });
});

describe("the invoice, estimate and customer forms", () => {
  it("mark required fields and move focus to the first wrong one on Save", () => {
    for (const [name, source] of [
      ["invoices", invoices()],
      ["customers", customers()],
      ["estimate", estimate()],
    ] as const) {
      expect(source, name).not.toContain("requiredMark={false}");
      expect(source, name).toContain("validateOrFocus(");
    }
  });

  it("keep a failed save's reason in the form instead of a toast that disappears", () => {
    const invoice = invoices();
    expect(invoice).not.toContain('message.error(res.error ?? "Failed to create invoice")');
    expect(invoice.match(/setCreateError\(res\.error \?\? "Failed to create invoice"\)/g)).toHaveLength(2);
    const customer = customers();
    expect(customer).toContain('setSaveError(res.error ?? "Failed to save the customer")');
    expect(customer).not.toContain('message.error(res.error ?? "Failed to save the customer")');
  });

  it("name the record when it is saved", () => {
    expect(invoices()).toContain("message.success(draftInvoiceCreatedMessage(");
    expect(customers()).toContain("message.success(customerSavedMessage(");
  });
});

describe("customer contact details", () => {
  it("use email and phone fields, and an email on the customer page opens the mail program", () => {
    const source = customers();
    const page = customerPage();
    expect(source).toMatch(/name="email" label="Email"[\s\S]{0,80}<Input type="email"/);
    expect(source).toMatch(/name="phone" label="Phone"[\s\S]{0,80}<Input type="tel"/);
    expect(page).toContain("href={`mailto:${customer.email}`}");
  });
});

describe("empty lists say what to do next", () => {
  it("offer New invoice when there are none, and Clear filters when filters hide them all", () => {
    const source = invoices();
    expect(source).toMatch(/emptyAction=\{/);
    expect(source).toContain("Clear filters");
    expect(source).toContain("function clearFilters()");
  });

  it("do the same for customers", () => {
    const source = customerList();
    expect(source).toMatch(/emptyAction=\{/);
    expect(source).toContain("Clear filters");
    expect(source).toContain("function clearFilters()");
  });
});
