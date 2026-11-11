import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { OPEN_INVOICE_STATUSES, isOpenInvoice, onlyOpenInvoices } from "@/lib/domain/open-invoice";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("what an open invoice is (3.0.16)", () => {
  it("is issued or partly paid, with money still owed", () => {
    expect(OPEN_INVOICE_STATUSES).toEqual(["issued", "partial"]);
    expect(isOpenInvoice({ status: "issued", balance_due_minor: 100 })).toBe(true);
    expect(isOpenInvoice({ status: "partial", balance_due_minor: 1 })).toBe(true);
    expect(isOpenInvoice({ status: "issued", balance_due_minor: 0 })).toBe(false);
    expect(isOpenInvoice({ status: "paid", balance_due_minor: 0 })).toBe(false);
    expect(isOpenInvoice({ status: "draft", balance_due_minor: 500 })).toBe(false);
    expect(isOpenInvoice({ status: "void", balance_due_minor: 500 })).toBe(false);
  });

  it("narrows a read with the same two filters, and keeps the builder for chaining", () => {
    const calls: unknown[][] = [];
    const builder = {
      in: (...args: unknown[]) => (calls.push(["in", ...args]), builder),
      gt: (...args: unknown[]) => (calls.push(["gt", ...args]), builder),
    };
    expect(onlyOpenInvoices(builder)).toBe(builder);
    expect(calls).toEqual([
      ["in", "status", ["issued", "partial"]],
      ["gt", "balance_due_minor", 0],
    ]);
  });

  it("is written out nowhere else: every read and check uses this module", () => {
    // A copy of the rule is how the customer page, Receive payment and bank
    // matching could come to disagree about what is owed.
    const offenders = ["lib", "app", "components"]
      .flatMap(sourceFiles)
      .filter((path) => !path.replace(/\\/g, "/").endsWith("lib/domain/open-invoice.ts"))
      .filter((path) => {
        const source = read(path);
        return (
          /\.from\("acc_invoice"\)[\s\S]{0,400}?\.in\("status", \["issued", "partial"\]\)/.test(source) ||
          /status === "issued" \|\| \w+\.status === "partial"\) &&\s*\w+\.balance_due_minor > 0/.test(source)
        );
      })
      .map((path) => relative(ROOT, join(ROOT, path)));
    expect(offenders).toEqual([]);
  });

  it("is what the services read with", () => {
    for (const path of [
      "lib/services/customer-detail.ts",
      "lib/services/invoicing.ts",
      "lib/services/banking.ts",
      "lib/services/credits.ts",
      "lib/services/statement-review.ts",
      "lib/services/work-queue.ts",
    ]) {
      expect(read(path), path).toContain("onlyOpenInvoices(");
    }
    expect(read("app/(app)/invoices/InvoicesClient.tsx")).toContain("isOpenInvoice(invoice)");
  });
});

describe("the invoice status tag (3.0.16)", () => {
  const tag = read("components/invoices/InvoiceStatusTag.tsx");

  it("is built once, from the attention rule, with the invoice's own status as the fallback", () => {
    expect(tag).toContain("invoiceAttentionLook(invoiceAttention(invoice, today))");
    expect(tag).toContain('look.tone === "danger" ? "overdue" : "due_soon"');
    expect(tag).toContain("<StatusTag status={invoice.status} labels={PAID_LABELS} />");
  });

  it("is used by Invoices, the customer page and the invoice dialog, which no longer build it", () => {
    for (const path of [
      "app/(app)/invoices/InvoicesClient.tsx",
      "app/(app)/customers/[id]/CustomerDetailClient.tsx",
      "app/(app)/invoices/InvoiceDetailDialog.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toContain('from "@/components/invoices/InvoiceStatusTag"');
      expect(source, path).not.toContain("invoiceAttentionLook(");
    }
    expect(read("app/(app)/invoices/InvoiceDetailDialog.tsx")).toContain(
      "<InvoiceAttentionTag invoice={invoice} today={today} />",
    );
  });
});
