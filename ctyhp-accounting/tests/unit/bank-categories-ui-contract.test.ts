import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = ["app", "(app)", "banking"];
const read = (file: string) => readFileSync(join(process.cwd(), ...route, file), "utf8");

describe("the banking category column", () => {
  it("puts the label control in its own component", () => {
    const cell = read("BankCategoryCell.tsx");
    expect(cell).toContain("setBankTransactionCategoryAction");
    expect(cell).toContain("createBankCategoryAction");
    // Typing a name that does not exist has to be offered, or "freely" is a lie.
    expect(cell).toMatch(/Create\s/);
  });

  it("shows the column between the amount and the match", () => {
    const table = read("BankTransactionsTable.tsx");
    expect(table).toContain("<BankCategoryCell");
    const amountAt = table.indexOf('title: "Amount"');
    const categoryAt = table.indexOf('title: "Category"');
    const matchAt = table.indexOf('title: "Match"');
    expect(amountAt).toBeGreaterThan(-1);
    expect(categoryAt).toBeGreaterThan(amountAt);
    expect(matchAt).toBeGreaterThan(categoryAt);
  });

  it("lets the list be narrowed to a label, and to the lines with none", () => {
    const client = read("BankingClient.tsx");
    expect(client).toContain("bankCategories");
    expect(client).toContain("All categories");
    expect(client).toContain("Uncategorized");
    expect(read("page.tsx")).toContain("listBankCategories");
  });

  it("never touches the feed's own category through this column", () => {
    const cell = read("BankCategoryCell.tsx");
    expect(cell).not.toMatch(/transaction\.category\b/);
    expect(cell).toContain("bank_category_id");
  });

  it("keeps every banking component under the 400-line ceiling", () => {
    for (const file of ["BankTransactionsTable.tsx", "BankCategoryCell.tsx"]) {
      expect(read(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(400);
    }
  });
});
