import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StatementLine } from "@/lib/domain/statement-import";
import { NO_MARKS, confirmStatement, statementDialogView, type DialogMarks, type StatementDialogInput } from "@/lib/domain/statement-import-dialog";
import { checkStatementLinesFrom, lineKeyTexts } from "@/lib/domain/statement-line-keys";
import { EDIT_BANK_ACCOUNT, type ElsewhereBankLine } from "@/lib/domain/statement-other-accounts";
import type { StatementFigures } from "@/lib/domain/statement-proof";
import { importedSummary, type StatementLinesCheck } from "@/lib/domain/statement-repeats";

/**
 * 3.0.22: one statement is not imported into two bank accounts, and a bank
 * account's name can be corrected. The rule itself is proved in
 * statement-other-accounts.test.ts; this proves it reaches the dialog, the
 * server and the screen. Every bank, name and amount here is invented.
 */
const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

const line = (txn_date: string, amount_minor: number, description: string): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${description},${amount_minor}`,
});

/** An invented statement: opening $1,000.00, three lines, closing $1,180.00. */
const LINES = [line("2026-03-02", 50000, "DEPOSIT"), line("2026-03-09", -30000, "RENT"), line("2026-03-20", -2000, "SERVICE FEE")];
const PRINTED: StatementFigures = { openingMinor: 100000, closingMinor: 118000, start: "2026-03-01", end: "2026-03-31" };
const ACCOUNTS = { here: "Second Checking · 1025", labels: { "acct-a": "First Checking · 1015", "acct-b": "Second Checking · 1025" } };

const held = (index: number): { index: number; bankAccountId: string; bankLineId: string } => ({ index, bankAccountId: "acct-a", bankLineId: `line-${index}` });
const check = (indexes: number[], whole = false): StatementLinesCheck => ({
  present: [],
  otherSource: [],
  otherAccount: { lines: indexes.map(held), whole: whole ? "acct-a" : null },
});

const input = (over: Partial<StatementDialogInput> = {}): StatementDialogInput => ({
  purpose: "import",
  kind: "pdf",
  lines: LINES,
  figures: PRINTED,
  prior: null,
  marks: NO_MARKS,
  check: check([]),
  accounts: ACCOUNTS,
  canOverride: false,
  ...over,
});
const marks = (over: Partial<DialogMarks>): DialogMarks => ({ ...NO_MARKS, ...over });
const view = (over: Partial<StatementDialogInput> = {}) => statementDialogView(input(over), money);

describe("the import dialog, when another bank account holds some of the lines", () => {
  it("skips them, names the account, and still imports the rest", () => {
    const v = view({ check: check([0, 1]) });
    expect(v.otherAccounts).toEqual([
      { bankAccountId: "acct-a", label: "First Checking · 1015", indexes: [0, 1], title: "2 of 3 lines are already in Bank Transactions under First Checking · 1015" },
    ]);
    expect(v.skip).toEqual([0, 1]);
    expect(v.otherAccountSkipped).toBe(2);
    expect(v.elsewhere).toBeNull();
    expect(v.okDisabled).toBe(false);
  });

  it("imports a line the person ticks back", () => {
    const v = view({ check: check([0, 1]), marks: marks({ back: [1] }) });
    expect(v.skip).toEqual([0]);
    expect(v.otherAccountSkipped).toBe(1);
  });

  it("sends the skipped lines marked skip, and says how many another account holds", () => {
    const v = view({ check: check([0, 1]) });
    const sent = confirmStatement(LINES, NO_MARKS, v);
    expect(sent.rows.map((row) => row.skip === true)).toEqual([true, true, false]);
    expect(sent.otherAccount).toBe(2);
  });

  it("counts a line both rules mark once", () => {
    const both: StatementLinesCheck = { ...check([0, 1]), otherSource: [{ index: 1, source: "books", bankLineId: "own-1" }] };
    const v = view({ check: both });
    expect(v.skip).toEqual([0, 1]);
  });

  it("says nothing of other accounts where they were not read", () => {
    const v = view({ check: { present: [], otherSource: [] }, accounts: undefined });
    expect(v.otherAccounts).toEqual([]);
    expect(v.elsewhere).toBeNull();
    expect(v.otherAccountSkipped).toBe(0);
  });
});

describe("the import dialog, when another bank account holds the whole statement", () => {
  const whole = () => view({ check: check([0, 1, 2], true) });

  it("refuses it in one sentence that names both accounts", () => {
    expect(whole().elsewhere).toBe(
      "Every line of this statement is already in Bank Transactions under First Checking · 1015, so it is not imported into Second Checking · 1025 as well: " +
        "the same money would be in the books twice. To correct a bank account's name or number, use Edit account on Bank Transactions.",
    );
  });

  it("cannot be imported, though the statement adds up", () => {
    const v = whole();
    expect(v.proof.proves).toBe(true);
    expect(v.okDisabled).toBe(true);
  });

  it("is not imported line by line either: a tick back counts for nothing", () => {
    const v = view({ check: check([0, 1, 2], true), marks: marks({ back: [0, 1, 2] }) });
    expect(v.skip).toEqual([0, 1, 2]);
    expect(v.okDisabled).toBe(true);
  });
});

describe("checkStatementLinesFrom", () => {
  const keys = new Map(lineKeyTexts("acct-b", LINES).map(({ key, texts }) => [key, texts]));
  const elsewhere: ElsewhereBankLine[] = LINES.map((l, i) => ({
    id: `line-${i}`,
    bankAccountId: "acct-a",
    txnDate: l.txn_date,
    amountMinor: l.amount_minor,
    description: l.description,
  }));

  it("reads the other accounts' lines when it is given them", () => {
    const found = checkStatementLinesFrom(LINES, [], { keys, bankLines: [], elsewhere });
    expect(found.otherAccount?.whole).toBe("acct-a");
    expect(found.otherAccount?.lines.map((l) => l.index)).toEqual([0, 1, 2]);
  });

  it("leaves the answer out when it was not given them", () => {
    expect(checkStatementLinesFrom(LINES, [], { keys, bankLines: [] }).otherAccount).toBeUndefined();
  });
});

describe("what is said after the import", () => {
  it("tells the lines under another bank account from those from another source", () => {
    expect(importedSummary({ inserted: 22, alreadyHere: 0, otherSource: 10, otherAccount: 8, repeats: [] })).toBe(
      "Imported 22 lines. 2 skipped as already in Bank Transactions from another source; 8 skipped as already under another bank account.",
    );
    expect(importedSummary({ inserted: 0, alreadyHere: 0, otherSource: 8, otherAccount: 8, repeats: [] })).toBe(
      "Imported 0 lines. 8 skipped as already under another bank account.",
    );
  });

  it("never says more were under another account than were skipped at all", () => {
    expect(importedSummary({ inserted: 5, alreadyHere: 0, otherSource: 1, otherAccount: 4, repeats: [] })).toBe(
      "Imported 5 lines. 1 skipped as already under another bank account.",
    );
  });
});

// --- The server, the database and the screen -----------------------------------

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
/** The body of one exported async function of a source file: from its declaration to the next export. */
function action(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("the server refuses another account's statement before anything is written", () => {
  const banking = read("app", "(app)", "banking", "actions.ts");
  const reconcile = read("app", "(app)", "banking", "reconcile", "statement-actions.ts");

  it("on Import statement, before the import", () => {
    const body = action(banking, "importStatementAction");
    expect(body.indexOf("refuseAnotherAccountsStatement(")).toBeGreaterThan(0);
    expect(body.indexOf("refuseAnotherAccountsStatement(")).toBeLessThan(body.indexOf("await importStatement("));
  });

  it("on a reconciliation's own statement, before it is kept", () => {
    const body = action(reconcile, "importStatementIntoReconciliationAction");
    expect(body.indexOf("refuseAnotherAccountsStatement(")).toBeGreaterThan(0);
    expect(body.indexOf("refuseAnotherAccountsStatement(")).toBeLessThan(body.indexOf("setReconciliationStatement("));
  });

  it("on a run of statement files, before the month is started", () => {
    const body = action(reconcile, "reconcileRunMonthAction");
    expect(body.indexOf("refuseAnotherAccountsStatement(")).toBeGreaterThan(0);
    expect(body.indexOf("refuseAnotherAccountsStatement(")).toBeLessThan(body.indexOf("createReconciliationFromStatement("));
  });

  it("adding or editing a bank account refuses a number another account has", () => {
    const service = read("lib", "services", "banking.ts");
    const create = service.slice(service.indexOf("export async function createBankAccount("), service.indexOf("export async function updateBankAccount("));
    const update = service.slice(service.indexOf("export async function updateBankAccount("), service.indexOf("export interface ImportRow"));
    expect(create.indexOf("refuseNumberInUse(")).toBeLessThan(create.indexOf('rpc("acc_save_bank_account"'));
    expect(create).toContain("refuseNumberInUse(sb, input.account_number_masked, null)");
    expect(update.indexOf("refuseNumberInUse(")).toBeLessThan(update.indexOf('rpc("acc_update_bank_account"'));
    expect(update).toContain("refuseNumberInUse(sb, input.account_number_masked, id)");
  });
});

describe("0191_edit_bank_account", () => {
  const sql = read("supabase", "migrations", "0191_edit_bank_account.sql");
  /** Without its prose, so naming a thing in a comment never reads as doing it. */
  const code = sql.replace(/--[^\n]*/g, "");

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(code).toMatch(/^\s*set search_path = public;/);
    expect(code).not.toMatch(/\bpublic\.\w/);
  });

  it("checks its caller first, as adding a bank account does", () => {
    const body = code.slice(code.indexOf("create or replace function acc_update_bank_account("), code.indexOf("$$;") + 3);
    expect(body).toMatch(/security definer set search_path = public/);
    expect(body.slice(body.indexOf("begin")).split("\n")[1]).toMatch(/if not acc_is_staff\(\) then/);
  });

  it("writes the name and the number, and nothing else", () => {
    const columns = [...code.matchAll(/array\[([^\]]*)\]/g)].flatMap((list) => [...list[1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]));
    expect(columns).toEqual(["bank_name", "account_number_masked"]);
    expect(code).toMatch(/acc_write_master\('acc_bank_account', p_id, p_values,/);
  });

  it("is open to signed-in users and closed to everyone else", () => {
    expect(code).toMatch(/revoke all on function acc_update_bank_account\(uuid, jsonb\) from public, anon;/);
    expect(code).toMatch(/grant execute on function acc_update_bank_account\(uuid, jsonb\) to authenticated, service_role;/);
  });

  it("changes nothing that exists: one new function, no table or column", () => {
    expect(code).not.toMatch(/\b(alter|drop|truncate|delete from|update )\b/i);
    expect(code.match(/create or replace function/g)).toHaveLength(1);
  });
});

describe("Edit account on Bank Transactions", () => {
  const screen = read("app", "(app)", "banking", "BankingClient.tsx");
  const dialog = read("app", "(app)", "banking", "EditBankAccountModal.tsx");

  it("is the button the sentences send people to", () => {
    expect(EDIT_BANK_ACCOUNT.button).toBe("Edit account");
    expect(screen).toContain("{EDIT_BANK_ACCOUNT.button}");
    expect(screen).toContain("<EditBankAccountModal");
  });

  it("is not offered while every account is showing", () => {
    expect(screen).toContain("disabled={allAccounts || !selected}");
  });

  it("offers the name and the number, and only shows the ledger account", () => {
    expect(dialog).toContain('name="bank_name"');
    expect(dialog).toContain('name="account_number_masked"');
    expect(dialog).not.toContain('name="account_id"');
    expect(dialog).not.toContain('name="currency_code"');
    expect(dialog).toContain("updateBankAccountAction(account.id, values)");
  });
});
