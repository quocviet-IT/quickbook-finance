import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 3.0.12: the invoice dialog is its own component, so the Invoices list and the
 * customer's page open the same one. Its Customer is a link to that customer.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const read = (file: string) =>
  readFileSync(join(process.cwd(), "app", "(app)", "invoices", file), "utf8").replace(/\r\n/g, "\n");

describe("the shared invoice dialog", () => {
  it("loads its own details and links the customer", () => {
    const dialog = read("InvoiceDetailDialog.tsx");
    expect(dialog).toContain("getInvoiceDetailAction(");
    expect(dialog).toContain("href={`/customers/${invoice.customer_id}`}");
  });

  it("is rendered by the list, which no longer loads the details itself", () => {
    const list = read("InvoicesClient.tsx");
    expect(list).toContain("<InvoiceDetailDialog");
    expect(list).not.toContain("getInvoiceDetailAction(");
  });
});
