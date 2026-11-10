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
