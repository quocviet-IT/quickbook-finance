import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = ["app", "(app)", "banking"];
const read = (file: string) => readFileSync(join(process.cwd(), ...route, file), "utf8");

/**
 * The Category column names an account, and choosing one posts.
 *
 * It used to hold a free-form label: a word somebody had to invent first, saved
 * beside the line and posted nowhere. Every company had zero of them, so the
 * control was an empty dropdown and a reader reported, exactly, that they could
 * not categorise a transaction. These assertions pin the replacement.
 */
describe("the banking category column", () => {
  it("puts the control in its own component, and posting is what it does", () => {
    const cell = read("CategoriseCell.tsx");
    expect(cell).toContain("categoriseBankTransactionAction");
    expect(cell).toContain("uncategoriseBankTransactionAction");
    // Searching is the whole complaint: a chart of ninety-five accounts cannot
    // be scrolled, and the reader asked to type a word and see what matches.
    expect(cell).toContain("showSearch");
    expect(cell).toContain("searchAccounts");
    // Ranked here, not by the dropdown: an exact code first, then the chart's
    // own wording, then a word that means the same thing.
    expect(cell).toContain("filterOption={false}");
  });

  it("says which report the money lands in, and which side of the books", () => {
    // "If it is debit, if it is credit, anything" — a code and a name alone do
    // not tell an accountant what choosing this account will do.
    const cell = read("CategoriseCell.tsx");
    expect(cell).toContain("ACCOUNT_TYPE_LABEL");
    expect(cell).toContain("normalBalanceOf");
  });

  it("does not ask a line the books have already answered", () => {
    // "Uncategorized" sat beside "Matched" on fifteen lines that were in the
    // ledger. A line with an entry shows the account that entry posted to.
    const cell = read("CategoriseCell.tsx");
    expect(cell).toContain("posting.account_code");
    expect(cell).toContain("entry_number");
    expect(cell).toMatch(/status !== "unmatched"/);
  });

  it("only offers to take back an entry this screen could have made", () => {
    // An invoice settled from a bank line, or a transactions import, owns its
    // own entry and its own undo. Reversing either from here would leave the
    // thing that owns it pointing at nothing.
    expect(read("CategoriseCell.tsx")).toContain("posting.own_entry");
  });

  it("shows the column between the amount and the match", () => {
    const table = read("BankTransactionsTable.tsx");
    expect(table).toContain("<CategoriseCell");
    const amountAt = table.indexOf('title: "Amount"');
    const categoryAt = table.indexOf('title: "Category"');
    const matchAt = table.indexOf('title: "Match"');
    expect(amountAt).toBeGreaterThan(-1);
    expect(categoryAt).toBeGreaterThan(amountAt);
    expect(matchAt).toBeGreaterThan(categoryAt);
  });

  it("lets the list be narrowed by the account posted to, and to the lines with none", () => {
    const client = read("BankingClient.tsx");
    expect(client).toContain("All accounts posted to");
    expect(client).toContain("Not categorised yet");
    expect(client).toContain("getBankPostingsAction");
  });

  it("never touches the feed's own category through this column", () => {
    // What the bank said is what the bank said; it belongs under the
    // description and is not an accounting decision.
    const cell = read("CategoriseCell.tsx");
    expect(cell).not.toMatch(/transaction\.category\b/);
    expect(cell).not.toContain("bank_category_id");
  });

  it("offers only accounts money may actually land in", () => {
    const client = read("BankingClient.tsx");
    expect(client).toContain("is_posting_account");
    expect(client).toMatch(/status === "active"/);
  });

  it("keeps every banking component under the 400-line ceiling", () => {
    for (const file of [
      "BankTransactionsTable.tsx",
      "CategoriseCell.tsx",
      "BankImportList.tsx",
      "DeleteBankLineModal.tsx",
    ]) {
      expect(read(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(400);
    }
  });
});
