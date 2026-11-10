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

  it("can leave its customer unlinked, for the customer's own page", () => {
    const dialog = read("InvoiceDetailDialog.tsx");
    expect(dialog).toContain("linkCustomer?: boolean");
    expect(dialog).toContain("linkCustomer = true");
    expect(dialog).toMatch(/linkCustomer \?[\s\S]*?href=\{`\/customers\/\$\{invoice.customer_id\}`\}[\s\S]*?\) : \(\s+invoice\.customer_name/);
  });

  it("gives the list's dialog Issue and Void only to those who hold them", () => {
    const list = read("InvoicesClient.tsx");
    expect(list).toContain("onIssue={canIssue ? startIssue : undefined}");
    expect(list).toContain("onVoid={canVoid ? confirmVoid : undefined}");
    expect(list).not.toMatch(/onVoid=\{voidInv/);
  });

  it("is rendered by the list, which no longer loads the details itself", () => {
    const list = read("InvoicesClient.tsx");
    expect(list).toContain("<InvoiceDetailDialog");
    expect(list).not.toContain("getInvoiceDetailAction(");
  });
});
