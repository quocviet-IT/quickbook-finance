import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_RENAME, accountNameProblem, typeLockedNote } from "@/lib/domain/account-rename";

/**
 * 3.0.26, item B of the defect report of 11 Nov 2026: an account's name is
 * edited in place, on an account with postings too, and its type and code stay
 * once it has postings. What it does on real books is proved by
 * scripts/verify-account-shape-guard.mjs; this holds the words, the migration
 * and the chart's wiring.
 */
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

describe("the words", () => {
  it("asks for a name, as the save schema does", () => {
    expect(accountNameProblem("")).toBe("Enter a name");
    expect(accountNameProblem("   ")).toBe("Enter a name");
    expect(accountNameProblem("x".repeat(121))).toBe("Keep the name to 120 characters");
    expect(accountNameProblem(" Office Supplies ")).toBeNull();
  });

  it("says what a rename does, and why the type stays", () => {
    expect(ACCOUNT_RENAME.renamed("6100", "Office Supplies")).toBe(
      "6100 is now Office Supplies. Reports, the journal and exports show the new name.",
    );
    expect(typeLockedNote("Expense")).toBe(
      "This account has postings, so its type stays Expense: changing it would move its balance to another line of the statements. Its name can be changed at any time.",
    );
  });
});

describe("0195_account_shape_guard", () => {
  const sql = read("supabase", "migrations", "0195_account_shape_guard.sql");
  const code = sql.replace(/--[^\n]*/g, "");

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("guards the type and the code, and only of an account with postings", () => {
    expect(code).toContain("before update of account_type, account_code on acc_account");
    // Fires before the parent-type guard (0125): triggers of one kind fire in the order of their names.
    expect(code).toContain("create trigger acc_account_has_postings_guard_trg");
    expect("acc_account_has_postings_guard_trg" < "acc_account_parent_type_trg").toBe(true);
    expect(code).toContain("exists (select 1 from acc_journal_line where account_id = old.id)");
    expect(code).toContain("so its code stays %");
    expect(code).toContain("so its type stays %");
  });

  it("leaves the name and the description alone, and changes no row", () => {
    expect(code).not.toMatch(/new\.name|new\.description/);
    expect(code).not.toMatch(/\bupdate acc_account\b|\bdelete from\b|\balter table\b/i);
  });

  it("is a trigger nobody calls", () => {
    expect(code).toContain("revoke all on function acc_account_shape_guard() from public, anon, authenticated;");
  });
});

describe("the chart", () => {
  const client = read("app", "(app)", "accounts", "AccountsClient.tsx");
  const actions = read("app", "(app)", "accounts", "actions.ts");

  it("renames in place in either view, for someone who may write", () => {
    expect(client).toContain("label={ACCOUNT_RENAME.button(account.name)}");
    expect(client).toContain("updateAccountAction(account.id, { name })");
    // In the name cell, which both views draw: not only in Setup's Actions column.
    const cell = client.slice(client.indexOf("const nameCell = "), client.indexOf("const balanceCell = "));
    expect(cell).toContain("setRenaming(account.id)");
    expect(cell).toContain("canWrite ?");
  });

  it("locks Account type in Edit account once the account has postings", () => {
    expect(client).toContain("accountHasPostingsAction(row.id)");
    expect(client).toContain("disabled={Boolean(editing) && editingHasPostings !== false}");
    expect(actions).toContain("export async function accountHasPostingsAction(");
  });
});
