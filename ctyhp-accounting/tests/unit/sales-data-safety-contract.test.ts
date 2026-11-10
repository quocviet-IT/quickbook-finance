import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The 3.0.8 review of the Sales screens found five ways to lose or misread
 * data. The rules live in lib/domain/invoice-void.ts, lib/domain/audit.ts and
 * lib/client/destructive-confirm.ts and are tested there; this pins that the
 * screens actually use them.
 */
// A Windows checkout has CRLF line endings; CI's has LF.
const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const invoices = () => read("app", "(app)", "invoices", "InvoicesClient.tsx");
const customers = () => read("app", "(app)", "customers", "CustomerFormModal.tsx");

/** The opening tag of the `<Modal` whose title attribute is `title`. */
function modalTag(source: string, title: string): string {
  // The forms sit at different indentations, so the whitespace is not fixed.
  const lines = source.split("\n");
  const at = lines.findIndex(
    (line, i) => line.trim() === "<Modal" && lines[i + 1]?.trim() === `title=${title}`,
  );
  expect(at, `a <Modal title=${title}>`).toBeGreaterThanOrEqual(0);
  const indent = lines[at].length - lines[at].trimStart().length;
  const end = lines.findIndex((line, i) => i > at && line === `${" ".repeat(indent)}>`);
  return lines.slice(at, end).join("\n");
}

describe("a half-written form is not thrown away by a stray key or click", () => {
  it("New invoice asks before discarding, and a click outside does not close it", () => {
    const source = invoices();
    const tag = modalTag(source, '"New invoice"');
    expect(tag).toContain("maskClosable={false}");
    expect(tag).toContain("onCancel={closeCreate}");
    expect(source).toMatch(/function closeCreate\(\)[\s\S]{0,400}closeOrConfirmDiscard\(/);
    expect(source).toMatch(/useUnsavedGuard\(open && createDirty, modal, "this invoice"\)/);
  });

  it("the customer form does the same", () => {
    const source = customers();
    const tag = modalTag(source, '{customer ? `Edit ${customer.name}` : "New customer"}');
    expect(tag).toContain("maskClosable={false}");
    expect(tag).toContain("onCancel={closeForm}");
    expect(source).toMatch(/function closeForm\(\)[\s\S]{0,400}closeOrConfirmDiscard\(/);
    expect(source).toMatch(/useUnsavedGuard\(open && dirty, modal, "this customer"\)/);
  });

  // 3.0.9: the estimate form shares the invoice's line editor and lost its
  // lines the same way.
  it("the estimate form does the same, from its Cancel button too", () => {
    const source = read("app", "(app)", "estimates", "EstimateFormModal.tsx");
    expect(source).toMatch(/<Modal title=\{title\} open onCancel=\{closeForm\} maskClosable=\{false\}/);
    expect(source).toMatch(/<Button key="close" onClick=\{closeForm\}>/);
    expect(source).toMatch(/function closeForm\(\)[\s\S]{0,400}closeOrConfirmDiscard\(/);
    expect(source).toMatch(/useUnsavedGuard\(dirty, modal, "this estimate"\)/);
  });
});

describe("voiding a bill (3.0.9)", () => {
  const bills = () => read("app", "(app)", "bills", "BillsClient.tsx");

  it("asks through the destructive dialog, with the words the bill's state calls for", () => {
    const source = bills();
    expect(source).toMatch(/modal\.confirm\(\s*destructiveConfirmProps\(\{\s*\.\.\.billVoidConfirm\(bill\)/);
    expect(source).not.toContain("Bills with payments applied cannot be voided");
  });

  it("offers Void by the database's rule, disabled with its reason when money is applied", () => {
    const source = bills();
    expect(source).toContain("const voidOption = billVoidOption(r);");
    expect(source).toMatch(/disabled: voidOption\.blockedReason !== null/);
  });
});

describe("voiding an invoice", () => {
  it("asks through the destructive dialog, with the words the invoice's state calls for", () => {
    const source = invoices();
    expect(source).toMatch(/modal\.confirm\(\s*destructiveConfirmProps\(\{\s*\.\.\.invoiceVoidConfirm\(invoice\)/);
    // The sentence that described a journal entry a draft does not have.
    expect(source).not.toContain("an invoice with payments applied cannot be voided");
  });

  it("offers Void by the database's rule, disabled with its reason when money is applied", () => {
    const source = invoices();
    expect(source).toContain("const voidOption = invoiceVoidOption(r);");
    expect(source).toMatch(/disabled: voidOption\.blockedReason !== null/);
  });
});

describe("change history shows amounts as money", () => {
  it("the trail on a document formats each entry in that entry's currency", () => {
    const source = read("components", "audit", "DocumentAuditTrail.tsx");
    expect(source).toContain("summarizeAuditChanges(diffAuditEntry(entry), 3, auditEntryCurrency(entry))");
    expect(source).toContain("auditDisplayValue(");
  });

  it("so does the company audit log", () => {
    expect(read("app", "(app)", "settings", "audit", "AuditClient.tsx")).toContain("auditEntryCurrency(r)");
  });
});
