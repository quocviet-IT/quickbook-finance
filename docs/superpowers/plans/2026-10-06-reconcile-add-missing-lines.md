# Add the statement lines the books do not have (1.82) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a reconciliation that does not agree, one button adds every statement line the books do not have — coded by its suggestion or to Uncategorized Income/Expense — and Bank Transactions recodes a line out of Uncategorized without touching the month it was reconciled in.

**Architecture:** Migration 0134 adds two holding accounts to every chart (known by `detail_type`), an all-or-nothing `acc_add_statement_lines_to_books` that codes each line through the existing `acc_categorise_bank_transaction`, a recode that posts a second same-day entry (`source_type = 'bank'`, `source_id` = the entry it recodes), a guard on taking back a line in a signed-off month, and coding history that learns through recodes. A pure domain module decides what the box shows; a service reads and posts; the reconciliation workspace shows the box; Bank Transactions gains Recode, Undo recode and a "Needs coding" filter.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Ant Design 6, Zod 4, Supabase Postgres (one schema per company), Vitest.

Spec: `docs/superpowers/specs/2026-10-06-reconcile-add-missing-lines-design.md`.

## Global Constraints

- US English UI. Money in integer minor units. Nothing completes a reconciliation without the person's click: "Add all" posts and ticks, Complete stays the person's.
- Like the prototype, a line no suggestion places goes to Uncategorized Income (money in) or Uncategorized Expense (money out); the preview is read only; no per-line choice before posting (the user's decision).
- A line is recoded by a second entry the same day; the bank line's own entry is never changed or voided by a recode (the user's decision).
- Only OneBook's existing suggestions place a line (card, related company, rule, history) — no transfer, invoice/bill or loan recognition (the user's decision).
- Adding is all or nothing: one SQL call, one transaction.
- Taking back a coded line (Change) refuses a line ticked in a completed reconciliation (approved behaviour change).
- No real statement, bank name, account number or figure in the repository: fixtures are invented. The prototype stays outside the repository.
- Migration 0134 is **not applied to the live database by any task**. The verify script applies it inside a transaction that is always rolled back. It goes live only after the user approves, in Task 6, by the controller — and before this code is deployed.
- Run everything from `ctyhp-accounting/`. Never pipe test output through `head`/`tail`; read the pass/fail lines.
- Write every file with the Write or Edit tool — never a bash heredoc, `echo` or `python -c`, which eat backslashes. Write paths exactly as given — never with backslash escapes such as `\(` or `\]` (on Windows they create stray directories such as `app/(app`).
- A `"use server"` file exports only async functions and types.
- New tables on new screens use `components/ui/DataTable` (enforced by `tests/unit/table-adoption.test.ts`).
- Stage files by name; never `git add -A`. Write commit messages with `printf` in Git Bash to `../.superpowers/sdd/commit-msg.txt` (never PowerShell — it writes a BOM), check with `od -c ../.superpowers/sdd/commit-msg.txt | head -1` that the first bytes are not `357 273 277`, then `git commit -F ../.superpowers/sdd/commit-msg.txt`. No Co-Authored-By trailer. After each task, `git status --short --untracked-files=all` (from the repository root) shows no file the task did not name, and `ls -b app` shows no stray directory.

Every file below was run before this plan was written: the migration through its verify script on all six companies (288 passed, 0 failed, rolled back) and through the company-provisioning self-check (17 passed, rolled back); the domain tests; `tsc --noEmit`, `eslint`, the whole unit suite and `next build` with every task's files in place.

Where a step says "apply these edits", each edit is a find/replace: find the exact text (it occurs once), replace it with the text given. The edits were worked out from the checked files and proved by applying them to the file as it is on the branch.

---

### Task 1: Migration 0134 and its verification

**Files:**
- Create: `supabase/migrations/0134_add_missing_statement_lines.sql`
- Create: `scripts/verify-add-missing-lines.mjs`
- Modify: `scripts/verify-company-provisioning.mjs` (one edit)

**Interfaces:**
- Produces (SQL, every company schema):
  - accounts with `detail_type` `uncategorized_income` (income) and `uncategorized_expense` (expense);
  - `acc_add_statement_lines_to_books(p_reconciliation_id uuid, p_items jsonb) returns jsonb` — `p_items`: `[{ line_no int, bank_transaction_id uuid, account_id uuid }]`, 1–500; returns `[{ line_no, entry_id, entry_number }]`;
  - `acc_recode_uncategorized(p_bank_transaction_id uuid, p_account_id uuid) returns jsonb` — `{ entry_id, entry_number, account_code, account_name }`;
  - `acc_undo_recode(p_bank_transaction_id uuid) returns jsonb` — `{ entry_id, entry_number }`;
  - `acc_bank_recodes(p_bank_account_id uuid default null)` returns rows `(bank_transaction_id, original_entry_id, recode_entry_id, entry_number, account_id, account_code, account_name)`;
  - `acc_uncategorise_bank_transaction` refuses a line in a completed reconciliation and voids its recode;
  - `acc_coding_history()` reports a recoded entry's new account and leaves out one still in Uncategorized.

- [ ] **Step 1: The verify script first.** Create `scripts/verify-add-missing-lines.mjs`:

```js
/**
 * Behavioural verification of migration 0134 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0134 has not been applied it is applied first, inside that transaction,
 * and every account, bank line, entry and reconciliation the checks need is
 * made there too — so nothing is left behind. A refusal is tried inside a
 * savepoint, so the books it is tried on stay as they were.
 *
 * Run: node --env-file=.env.local scripts/verify-add-missing-lines.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0134_add_missing_statement_lines.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const HOLDING = ["uncategorized_income", "uncategorized_expense"];

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 8 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
/** Runs `sql`, expecting the database to refuse it with a message holding `expect`; the books are left as they were. */
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    check(label, error.message.includes(expect), error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
/** Runs `body` and puts the books back afterwards. */
async function thenUndo(body) {
  await client.query("savepoint trial");
  try {
    await body();
  } finally {
    await client.query("rollback to savepoint trial");
  }
}

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0134 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- the two holding accounts
      const holding = async () =>
        all(
          `select detail_type, account_type::text as type, account_code from acc_account
            where detail_type = any($1) and status = 'active' order by detail_type`,
          [HOLDING],
        );
      const held = await holding();
      check(
        "one Uncategorized Income and one Uncategorized Expense, of the right types",
        held.length === 2 && held[0].detail_type === "uncategorized_expense" && held[0].type === "expense" &&
          held[1].detail_type === "uncategorized_income" && held[1].type === "income",
        JSON.stringify(held),
      );
      console.log(`  (codes: income ${held.find((h) => h.type === "income")?.account_code}, expense ${held.find((h) => h.type === "expense")?.account_code})`);
      for (const statement of statements) await client.query(statement);
      check("applying 0134 again changes nothing", JSON.stringify(await holding()) === JSON.stringify(held));
      const uncatIn = (await one(`select id from acc_account where detail_type = 'uncategorized_income' and status = 'active'`)).id;
      const uncatOut = (await one(`select id from acc_account where detail_type = 'uncategorized_expense' and status = 'active'`)).id;

      // ---- the books: a bank account, a deposit in them, and a July statement
      //      with three lines they do not have and one after the statement date
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-AM-B", "Verify add-missing bank", "bank");
      const gl2 = await account("ZZ-VERIFY-AM-B2", "Verify add-missing other bank", "bank");
      const charges = await account("ZZ-VERIFY-AM-X", "Verify add-missing charges", "expense");
      const sales = await account("ZZ-VERIFY-AM-I", "Verify add-missing sales", "income");
      const bankAccount = async (ledger) =>
        (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [
          ledger, base.code,
        ])).id;
      const bank = await bankAccount(gl);
      const otherBank = await bankAccount(gl2);

      await client.query("set local role authenticated");
      await as(admin.id);
      await one(`select acc_post_manual_journal('2026-07-05', 'Client deposit', null, $1, $2::jsonb) as id`, [
        base.code,
        JSON.stringify([
          { account_id: gl, debit_minor: 50000, credit_minor: 0 },
          { account_id: sales, debit_minor: 0, credit_minor: 50000 },
        ]),
      ]);
      const LINES = [
        { txn_date: "2026-07-05", description: "DEPOSIT 0041", reference: null, amount_minor: 50000 },
        { txn_date: "2026-07-15", description: "INCOMING WIRE EXAMPLE", reference: null, amount_minor: 3000 },
        { txn_date: "2026-07-28", description: "POS EXAMPLE SHOP", reference: null, amount_minor: -4200 },
        { txn_date: "2026-07-30", description: "SERVICE FEE", reference: null, amount_minor: -1500 },
        { txn_date: "2026-08-02", description: "AFTER THE STATEMENT", reference: null, amount_minor: -700 },
      ];
      const importLines = (bankId, lines) =>
        one(`select * from acc_import_bank_statement($1, 'verify.csv', $2::jsonb)`, [
          bankId,
          JSON.stringify(lines.map((l, i) => ({
            ...l,
            raw_line: l.description,
            raw_hash: createHash("sha256").update(`verify-am-${bankId}-${i}`).digest("hex"),
            source: "file_upload",
          }))),
        ]);
      await importLines(bank, LINES);
      await importLines(otherBank, [LINES[2]]);
      const txnOf = async (bankId, description) =>
        (await one(`select id from acc_bank_transaction where bank_account_id = $1 and description = $2`, [bankId, description])).id;
      const wire = await txnOf(bank, "INCOMING WIRE EXAMPLE");
      const shop = await txnOf(bank, "POS EXAMPLE SHOP");
      const fee = await txnOf(bank, "SERVICE FEE");
      const after = await txnOf(bank, "AFTER THE STATEMENT");
      const elsewhere = await txnOf(otherBank, "POS EXAMPLE SHOP");
      const rec = (await one(
        `select acc_create_reconciliation_from_statement($1, '2026-07-31', 47300, 'verify.csv', 0, $2::jsonb) as id`,
        [bank, JSON.stringify(LINES.map((l) => ({ ...l, balance_minor: null })))],
      )).id;
      const lineNo = async (description) =>
        Number((await one(`select line_no from acc_reconciliation_statement_line where reconciliation_id = $1 and description = $2`, [rec, description])).line_no);
      const items = {
        wire: { line_no: await lineNo("INCOMING WIRE EXAMPLE"), bank_transaction_id: wire, account_id: uncatIn },
        shop: { line_no: await lineNo("POS EXAMPLE SHOP"), bank_transaction_id: shop, account_id: uncatOut },
        fee: { line_no: await lineNo("SERVICE FEE"), bank_transaction_id: fee, account_id: charges },
        after: { line_no: await lineNo("AFTER THE STATEMENT"), bank_transaction_id: after, account_id: charges },
      };
      const ADD = `select acc_add_statement_lines_to_books($1, $2::jsonb) as out`;
      const add = (list) => [rec, JSON.stringify(list)];

      // ---- what adding refuses: every refusal posts nothing
      await refused("a statement line paired with another line's bank transaction is refused", ADD,
        add([items.wire, { ...items.shop, bank_transaction_id: fee }]), "does not agree with its bank transaction");
      await refused("another bank account's transaction is refused", ADD,
        add([{ ...items.shop, bank_transaction_id: elsewhere }]), "is not among this bank account's transactions");
      await refused("a line dated after the statement is refused", ADD, add([items.after]), "is dated after the statement");
      await thenUndo(async () => {
        await client.query("reset role");
        await client.query(
          `insert into acc_statement_reconciliation (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor, status)
           values ($1, '2026-07-20', 0, 0, 'completed')`,
          [bank],
        );
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a line dated in a month already signed off is refused", ADD, add([items.wire]),
          "is dated in a month already reconciled, to Jul 20, 2026");
      });
      await refused("a line listed twice is refused", ADD, add([items.fee, items.fee]), "listed twice");
      await refused("more than 500 lines are refused", ADD,
        add(Array.from({ length: 501 }, (_, i) => ({ ...items.fee, line_no: i }))), "At most 500");
      await refused("an empty list is refused", ADD, add([]), "nothing to add");
      await refused("an item missing its bank line is refused, said as such", ADD,
        add([{ line_no: items.fee.line_no, account_id: charges }]), "needs its line_no, bank_transaction_id and account_id");
      await thenUndo(async () => {
        await one(`select acc_categorise_bank_transaction($1, $2)`, [fee, charges]);
        await refused("a line already coded in Bank Transactions is refused, with the line named", ADD,
          add([items.shop, items.fee]), "The line Jul 30, 2026 SERVICE FEE -15.00 could not be added");
      });
      await thenUndo(async () => {
        await client.query("reset role");
        await client.query(
          `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
           values (2026, 7, '2026-07-01', '2026-07-31', 'Jul 2026', 'closed')
           on conflict (period_start) do update set status = 'closed'`,
        );
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a closed period refuses the whole list", ADD, add([items.wire, items.fee]), "closed");
      });
      await thenUndo(async () => {
        await client.query("reset role");
        await client.query(`update acc_statement_reconciliation set status = 'completed' where id = $1`, [rec]);
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a completed reconciliation is refused", ADD, add([items.fee]), "not in progress");
      });
      await thenUndo(async () => {
        await client.query("reset role");
        await client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]);
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a viewer cannot add lines", ADD, add([items.fee]), "Not authorized");
      });
      const posted = async () => Number((await one(`select count(*) as n from acc_journal_entry where status = 'posted' and source_type = 'bank'`)).n);
      const before = await posted();

      // ---- adding them
      const out = (await one(ADD, add([items.wire, items.shop, items.fee]))).out;
      check("three lines added, each with an entry", Array.isArray(out) && out.length === 3 && out.every((o) => o.entry_number), JSON.stringify(out));
      check("three entries posted", (await posted()) === before + 3);
      const statuses = await all(`select status::text from acc_bank_transaction where id = any($1)`, [[wire, shop, fee]]);
      check("their bank lines are matched", statuses.every((s) => s.status === "matched"), JSON.stringify(statuses));
      const entryOf = async (txn) =>
        one(
          `select e.id, e.entry_date::text, e.description, o.account_id, o.debit_minor, o.credit_minor
             from acc_reconciliation r
             join acc_journal_line l on l.id = r.journal_line_id
             join acc_journal_entry e on e.id = l.journal_entry_id
             join acc_journal_line o on o.journal_entry_id = e.id and o.account_id <> $2
            where r.bank_transaction_id = $1 and r.status = 'approved'`,
          [txn, gl],
        );
      const shopEntry = await entryOf(shop);
      const wireEntry = await entryOf(wire);
      check("money out with no place goes to Uncategorized Expense, dated as the bank has it",
        shopEntry.account_id === uncatOut && Number(shopEntry.debit_minor) === 4200 && shopEntry.entry_date === "2026-07-28", JSON.stringify(shopEntry));
      check("money in with no place goes to Uncategorized Income",
        wireEntry.account_id === uncatIn && Number(wireEntry.credit_minor) === 3000, JSON.stringify(wireEntry));
      check("a line with a place goes there", (await entryOf(fee)).account_id === charges);
      const audit = await one(`select after_json from acc_audit_log where table_name = 'acc_statement_reconciliation' and record_id = $1 and action = 'add_statement_lines'`, [rec]);
      check("the addition is in the audit log", audit?.after_json?.lines === 3, JSON.stringify(audit));

      // ---- ticked, then: taking a line back still works while the month is open
      const bookLines = (await all(
        `select l.id from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
          where l.account_id = $1 and e.status = 'posted' and e.entry_date <= '2026-07-31'`,
        [gl],
      )).map((r) => r.id);
      await one(`select acc_set_cleared_many($1, $2::uuid[], true)`, [rec, bookLines]);
      const cleared = async () => Number((await one(`select acc_recon_cleared_total($1) as n`, [rec])).n);
      check("ticked, the month reaches its statement's 47,300", (await cleared()) === 47300, String(await cleared()));
      await thenUndo(async () => {
        const voided = Number((await one(`select acc_uncategorise_bank_transaction($1) as n`, [fee])).n);
        check("a line ticked in a reconciliation still in progress can still be taken back", voided === 1);
      });
      await thenUndo(async () => {
        await one(`select acc_recode_uncategorized($1, $2)`, [wire, sales]);
        await one(`select acc_uncategorise_bank_transaction($1)`, [wire]);
        const left = Number((await one(`select count(*) as n from acc_journal_entry where source_type = 'bank' and source_id = $1 and status = 'posted'`, [wireEntry.id])).n);
        check("taking a recoded line back takes its recode too", left === 0, String(left));
      });

      // ---- history before any recode: a line in Uncategorized teaches nothing
      const history = async (entryId) => (await all(`select account_id from acc_coding_history() where entry_id = $1`, [entryId]))[0]?.account_id ?? null;
      check("coding history leaves out a line still in Uncategorized", (await history(shopEntry.id)) === null);
      check("coding history still holds an ordinary coded line", (await history((await entryOf(fee)).id)) === charges);

      // ---- the month is signed off
      await one(`select acc_complete_reconciliation($1)`, [rec]);
      await refused("taking back a coded line in a signed-off month is refused", `select acc_uncategorise_bank_transaction($1)`, [fee],
        "This line is reconciled to Jul 31, 2026. Reopen that reconciliation to change it.");
      await refused("taking back an Uncategorized line in a signed-off month points to Recode", `select acc_uncategorise_bank_transaction($1)`, [shop],
        "This line is reconciled to Jul 31, 2026. Recode it instead, or reopen that reconciliation.");
      const signedTotal = await cleared();

      // ---- recoding
      const RECODE = `select acc_recode_uncategorized($1, $2) as out`;
      await refused("recoding a line not in Uncategorized is refused", RECODE, [fee, charges], "not to Uncategorized");
      await refused("recoding into an Uncategorized account is refused", RECODE, [shop, uncatIn], "not an Uncategorized one");
      await refused("recoding into a bank account is refused", RECODE, [shop, gl2], "A bank account is not a category");
      await thenUndo(async () => {
        await client.query("reset role");
        const batch = (await one(
          `insert into acc_import_batch (source, mode, file_name, sha256, entry_count, line_count, total_minor)
           values ('wave_ledger', 'history', 'verify.csv', $1, 0, 0, 0) returning id`,
          [createHash("sha256").update(`verify-am-batch-${bank}`).digest("hex")],
        )).id;
        await client.query(`update acc_bank_transaction set transaction_batch_id = $1 where id = $2`, [batch, shop]);
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a line a transactions import owns is not recoded", RECODE, [shop, charges], "came from a transactions import");
      });
      const recoded = (await one(RECODE, [shop, charges])).out;
      check("recoding returns its entry", Boolean(recoded?.entry_number), JSON.stringify(recoded));
      const recodeLines = await all(
        `select l.account_id, l.debit_minor, l.credit_minor, e.entry_date::text, e.source_type::text, e.source_id, e.description
           from acc_journal_entry e join acc_journal_line l on l.journal_entry_id = e.id
          where e.id = $1 order by l.debit_minor desc`,
        [recoded.entry_id],
      );
      check(
        "money out is recoded Dr the account, Cr Uncategorized Expense, same day, tied to the entry it recodes",
        recodeLines.length === 2 && recodeLines[0].account_id === charges && Number(recodeLines[0].debit_minor) === 4200 &&
          recodeLines[1].account_id === uncatOut && Number(recodeLines[1].credit_minor) === 4200 &&
          recodeLines[0].entry_date === "2026-07-28" && recodeLines[0].source_type === "bank" &&
          recodeLines[0].source_id === shopEntry.id && recodeLines[0].description === "Recode: POS EXAMPLE SHOP",
        JSON.stringify(recodeLines),
      );
      check("recoding leaves the signed-off month exactly as it was", (await cleared()) === signedTotal);
      await refused("a second recode is refused", RECODE, [shop, sales], "already recoded");
      await refused("taking back a recoded line in a signed-off month points to Undo recode", `select acc_uncategorise_bank_transaction($1)`, [shop],
        "To move it to another account, Undo recode and recode it again");
      const inRecode = (await one(RECODE, [wire, sales])).out;
      const inLines = await all(`select account_id, debit_minor, credit_minor from acc_journal_line where journal_entry_id = $1 order by debit_minor desc`, [inRecode.entry_id]);
      check("money in is recoded Dr Uncategorized Income, Cr the account",
        inLines[0].account_id === uncatIn && Number(inLines[0].debit_minor) === 3000 && inLines[1].account_id === sales && Number(inLines[1].credit_minor) === 3000,
        JSON.stringify(inLines));
      const recodes = await all(`select bank_transaction_id, account_id from acc_bank_recodes($1)`, [bank]);
      check("Bank Transactions can read both recodes and where they went",
        recodes.length === 2 && recodes.some((r) => r.bank_transaction_id === shop && r.account_id === charges) &&
          recodes.some((r) => r.bank_transaction_id === wire && r.account_id === sales),
        JSON.stringify(recodes));
      check("coding history learns the account a line was recoded to", (await history(shopEntry.id)) === charges);

      // ---- taking a recode back
      const UNDO = `select acc_undo_recode($1) as out`;
      const undone = (await one(UNDO, [shop])).out;
      const undoneStatus = (await one(`select status::text from acc_journal_entry where id = $1`, [undone.entry_id])).status;
      check("taking a recode back voids it", undone.entry_id === recoded.entry_id && undoneStatus === "void", undoneStatus);
      check("…and the line is back in Uncategorized", (await all(`select 1 from acc_bank_recodes($1) where bank_transaction_id = $2`, [bank, shop])).length === 0);
      check("…and history forgets it again", (await history(shopEntry.id)) === null);
      await refused("taking back a recode that is not there is refused", UNDO, [shop], "no recode to take back");
      check("it can be recoded again", Boolean((await one(RECODE, [shop, charges])).out?.entry_number));

      // ---- who may call what
      const grants = await one(
        `select has_function_privilege('anon', 'acc_add_statement_lines_to_books(uuid, jsonb)', 'execute')
             or has_function_privilege('anon', 'acc_recode_uncategorized(uuid, uuid)', 'execute')
             or has_function_privilege('anon', 'acc_undo_recode(uuid)', 'execute')
             or has_function_privilege('anon', 'acc_bank_recodes(uuid)', 'execute')
             or has_function_privilege('anon', 'acc_uncategorise_bank_transaction(uuid, text)', 'execute')
             or has_function_privilege('anon', 'acc_coding_history()', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_add_statement_lines_to_books(uuid, jsonb)', 'execute')
            and has_function_privilege('authenticated', 'acc_recode_uncategorized(uuid, uuid)', 'execute')
            and has_function_privilege('authenticated', 'acc_undo_recode(uuid)', 'execute')
            and has_function_privilege('authenticated', 'acc_bank_recodes(uuid)', 'execute') as signed_in`,
      );
      check("closed to anon, open to signed-in users", grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
      await as(OUTSIDER);
      check("someone outside the company reads no recodes", (await all(`select 1 from acc_bank_recodes($1)`, [bank])).length === 0);
      await refused("someone outside the company cannot recode", RECODE, [wire, charges], "Not authorized");
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  clearTimeout(killer);
  await client.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it — it fails.**

Run: `node --env-file=.env.local scripts/verify-add-missing-lines.mjs`
Expected: it stops with `ENOENT` (the migration file does not exist yet).

- [ ] **Step 3: The migration.** Create `supabase/migrations/0134_add_missing_statement_lines.sql`:

```sql
-- ============================================================================
-- 1.82 — the statement lines the books do not have, added in one click.
--
-- A month that does not agree because the bank shows a fee, interest or a
-- deposit nobody recorded used to send the person to Bank Transactions to code
-- each line. Now the reconciliation adds them all: each through the same
-- function that codes one line there, coded by its suggestion, or — when no
-- rule, history or register places it — to an Uncategorized account, to be
-- recoded later.
--
-- Recoding never touches the bank line. It posts a second entry that moves the
-- amount from Uncategorized to the account it belongs in, so a month already
-- signed off stays exactly as it was signed. The recode entry is a `bank` entry
-- whose source_id is the entry it recodes: every check that means "an entry
-- Bank Transactions coded" asks for source_id is null, so the two never mix.
--
-- And taking a coded line back (Change in Bank Transactions) now refuses a line
-- ticked in a completed reconciliation: voiding it would silently change a
-- month somebody signed off.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Two holding accounts in every chart, known by their detail type.
--
--    A chart that already has one keeps it. One already named "Uncategorized
--    Income" or "Uncategorized Expense" is given the detail type rather than a
--    twin. Otherwise the account is made at 4999 / 6999, or at the highest free
--    code below it.
-- ----------------------------------------------------------------------------
do $$
declare
  v_spec record;
  v_id   uuid;
  v_code text;
  v_try  int;
begin
  for v_spec in
    select * from (values
      ('uncategorized_income',  'income'::acc_account_type,  'Uncategorized Income',  4999, 4950),
      ('uncategorized_expense', 'expense'::acc_account_type, 'Uncategorized Expense', 6999, 6950)
    ) as s(detail, kind, label, top_code, bottom_code)
  loop
    if exists (select 1 from acc_account where detail_type = v_spec.detail and status = 'active') then
      continue;
    end if;

    select id into v_id
      from acc_account
     where account_type = v_spec.kind
       and status = 'active'
       and is_posting_account
       and lower(btrim(name)) = lower(v_spec.label)
     order by account_code
     limit 1;
    if v_id is not null then
      update acc_account set detail_type = v_spec.detail, updated_at = now() where id = v_id;
      continue;
    end if;

    v_code := null;
    for v_try in reverse v_spec.top_code .. v_spec.bottom_code loop
      if not exists (select 1 from acc_account where account_code = v_try::text) then
        v_code := v_try::text;
        exit;
      end if;
    end loop;
    if v_code is null then
      raise exception 'No free account code from % down to % for %', v_spec.top_code, v_spec.bottom_code, v_spec.label;
    end if;

    insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, detail_type, cash_flow_role)
    values (v_code, v_spec.label, v_spec.kind, 'USD', true, v_spec.detail, 'operating');
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Add the statement lines the books do not have: every one or none.
--
--    p_items: [{ "line_no": int, "bank_transaction_id": uuid, "account_id": uuid }]
--    Each statement line is paired with the bank line it was imported as, and
--    must agree with it on date and amount. Each is then coded by
--    acc_categorise_bank_transaction — the entry, the closed-period guard and
--    the bank match coding one line makes. One failure undoes them all, and
--    the message names the line.
-- ----------------------------------------------------------------------------
create or replace function acc_add_statement_lines_to_books(p_reconciliation_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rec    acc_statement_reconciliation;
  v_item   jsonb;
  v_line   acc_reconciliation_statement_line;
  v_txn    acc_bank_transaction;
  v_posted jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_count  int;
  v_what   text;
  v_signed_through date;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to add statement lines to the books';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'There is nothing to add';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 500 then
    raise exception 'At most 500 lines can be added at a time';
  end if;

  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then
    raise exception 'This reconciliation is not in progress';
  end if;
  -- The newest month this account has signed off before this one: a line dated
  -- in it would change that month's books, so it is not added from here.
  select max(statement_ending_date) into v_signed_through
    from acc_statement_reconciliation
   where bank_account_id = v_rec.bank_account_id and status = 'completed'
     and statement_ending_date < v_rec.statement_ending_date;

  if exists (
    select 1 from jsonb_array_elements(p_items) x
     where x->>'line_no' is null or x->>'bank_transaction_id' is null or x->>'account_id' is null
  ) then
    raise exception 'Each line to add needs its line_no, bank_transaction_id and account_id';
  end if;
  if (select count(distinct x->>'line_no') from jsonb_array_elements(p_items) x) <> v_count
     or (select count(distinct x->>'bank_transaction_id') from jsonb_array_elements(p_items) x) <> v_count then
    raise exception 'A statement line or a bank line is listed twice';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_line
      from acc_reconciliation_statement_line
     where reconciliation_id = p_reconciliation_id and line_no = (v_item->>'line_no')::int;
    if not found then
      raise exception 'Statement line % is not part of this reconciliation', v_item->>'line_no';
    end if;
    v_what := format('%s %s %s', to_char(v_line.txn_date, 'Mon FMDD, YYYY'),
                     coalesce(nullif(btrim(v_line.description), ''), '(no description)'),
                     to_char(v_line.amount_minor::numeric / 100, 'FM999999999990.00'));
    if v_line.txn_date > v_rec.statement_ending_date then
      raise exception 'The line % is dated after the statement', v_what;
    end if;
    if v_signed_through is not null and v_line.txn_date <= v_signed_through then
      raise exception 'The line % is dated in a month already reconciled, to %', v_what,
        to_char(v_signed_through, 'Mon FMDD, YYYY');
    end if;

    select * into v_txn from acc_bank_transaction where id = (v_item->>'bank_transaction_id')::uuid for update;
    if not found or v_txn.bank_account_id <> v_rec.bank_account_id then
      raise exception 'The line % is not among this bank account''s transactions', v_what;
    end if;
    if v_txn.txn_date <> v_line.txn_date or v_txn.amount_minor <> v_line.amount_minor then
      raise exception 'The line % does not agree with its bank transaction', v_what;
    end if;

    begin
      v_posted := acc_categorise_bank_transaction(v_txn.id, (v_item->>'account_id')::uuid);
    exception when others then
      raise exception 'The line % could not be added: %', v_what, sqlerrm;
    end;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_no', v_line.line_no, 'entry_id', v_posted->'entry_id', 'entry_number', v_posted->'entry_number'));
  end loop;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_statement_reconciliation', p_reconciliation_id, 'add_statement_lines', auth.uid(),
          jsonb_build_object('lines', v_count));
  return v_out;
end;
$$;

revoke all on function acc_add_statement_lines_to_books(uuid, jsonb) from public, anon;
grant execute on function acc_add_statement_lines_to_books(uuid, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Recode a line from Uncategorized, and take a recode back.
--
--    The bank line's entry stays as it is. A second entry, dated the same day,
--    moves the amount off the Uncategorized account onto the one chosen:
--    money out — Dr the account, Cr Uncategorized Expense; money in — Dr
--    Uncategorized Income, Cr the account.
-- ----------------------------------------------------------------------------
create or replace function acc_recode_uncategorized(p_bank_transaction_id uuid, p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn    acc_bank_transaction;
  v_gl     uuid;
  v_entry  acc_journal_entry;
  v_other  acc_journal_line;
  v_hold   acc_account;
  v_target acc_account;
  v_lines  int;
  v_amount bigint;
  v_recode uuid;
  v_number text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to recode a bank transaction';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_bank_transaction_id;
  if v_txn.id is null then raise exception 'Bank transaction not found'; end if;
  -- An import's Undo voids the entries it made; a recode it knows nothing of
  -- would be left moving money off an account that no longer holds it.
  if v_txn.transaction_batch_id is not null then
    raise exception 'This line came from a transactions import, which owns its entry. Correct it with a journal entry instead.';
  end if;
  select account_id into v_gl from acc_bank_account where id = v_txn.bank_account_id;

  select e.* into v_entry
    from acc_reconciliation r
    join acc_journal_line l on l.id = r.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_transaction_id = p_bank_transaction_id and r.status = 'approved'
   limit 1;
  if v_entry.id is null then raise exception 'This line is not coded'; end if;
  if v_entry.status <> 'posted' or v_entry.source_type <> 'bank' or v_entry.source_id is not null then
    raise exception 'Only a line coded in Bank Transactions can be recoded';
  end if;
  -- One recode at a time, and never against an entry taken back meanwhile: a
  -- second click, or Change in another tab, waits here — then the entry is
  -- read again, as whatever finished first left it.
  select * into v_entry from acc_journal_entry where id = v_entry.id for update;
  if v_entry.status <> 'posted' then
    raise exception 'This line''s entry was taken back meanwhile, so there is nothing to recode';
  end if;

  select count(*) into v_lines from acc_journal_line where journal_entry_id = v_entry.id;
  select * into v_other from acc_journal_line where journal_entry_id = v_entry.id and account_id <> v_gl limit 1;
  select * into v_hold from acc_account where id = v_other.account_id;
  if v_lines <> 2 or v_hold.id is null
     or coalesce(v_hold.detail_type, '') not in ('uncategorized_income', 'uncategorized_expense') then
    raise exception 'This line is coded to %, not to Uncategorized', coalesce(v_hold.name, 'more than one account');
  end if;
  if exists (select 1 from acc_journal_entry where source_type = 'bank' and source_id = v_entry.id and status = 'posted') then
    raise exception 'This line is already recoded';
  end if;

  select * into v_target from acc_account where id = p_account_id;
  if v_target.id is null then raise exception 'Account not found'; end if;
  if v_target.status <> 'active' or not v_target.is_posting_account then
    raise exception 'Money cannot be posted to % — it is not an active posting account', v_target.name;
  end if;
  if coalesce(v_target.detail_type, '') in ('uncategorized_income', 'uncategorized_expense') then
    raise exception 'Choose the account the line belongs in, not an Uncategorized one';
  end if;
  if v_target.account_type = 'bank' then
    raise exception 'A bank account is not a category: record a transfer instead';
  end if;

  v_amount := v_other.debit_minor + v_other.credit_minor;
  v_recode := acc_post_entry(
    v_entry.entry_date,
    left('Recode: ' || coalesce(nullif(btrim(v_entry.description), ''), 'bank line'), 500),
    'bank', v_entry.id, v_entry.currency_code,
    case when v_other.debit_minor > 0 then
      jsonb_build_array(
        jsonb_build_object('account_id', v_target.id, 'debit_minor', v_amount, 'credit_minor', 0,
          'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo),
        jsonb_build_object('account_id', v_hold.id, 'debit_minor', 0, 'credit_minor', v_amount,
          'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo)
      )
    else
      jsonb_build_array(
        jsonb_build_object('account_id', v_hold.id, 'debit_minor', v_amount, 'credit_minor', 0,
          'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo),
        jsonb_build_object('account_id', v_target.id, 'debit_minor', 0, 'credit_minor', v_amount,
          'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo)
      )
    end);

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_bank_transaction', p_bank_transaction_id, 'recode', auth.uid(),
          jsonb_build_object('journal_entry_id', v_entry.id, 'account_id', v_hold.id),
          jsonb_build_object('journal_entry_id', v_recode, 'account_id', v_target.id));

  select entry_number into v_number from acc_journal_entry where id = v_recode;
  return jsonb_build_object('entry_id', v_recode, 'entry_number', v_number,
                            'account_code', v_target.account_code, 'account_name', v_target.name);
end;
$$;

create or replace function acc_undo_recode(p_bank_transaction_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_entry  uuid;
  v_recode acc_journal_entry;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a bank transaction';
  end if;

  select e.id into v_entry
    from acc_reconciliation r
    join acc_journal_line l on l.id = r.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_transaction_id = p_bank_transaction_id and r.status = 'approved'
   limit 1;
  select * into v_recode
    from acc_journal_entry
   where v_entry is not null and source_type = 'bank' and source_id = v_entry and status = 'posted'
   for update;
  if v_recode.id is null then raise exception 'This line has no recode to take back'; end if;

  update acc_journal_entry set status = 'void', voided_at = now() where id = v_recode.id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_transaction', p_bank_transaction_id, 'undo_recode', auth.uid(),
          jsonb_build_object('journal_entry_id', v_recode.id));
  return jsonb_build_object('entry_id', v_recode.id, 'entry_number', v_recode.entry_number);
end;
$$;

revoke all on function acc_recode_uncategorized(uuid, uuid) from public, anon;
grant execute on function acc_recode_uncategorized(uuid, uuid) to authenticated, service_role;
revoke all on function acc_undo_recode(uuid) from public, anon;
grant execute on function acc_undo_recode(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Which coded lines have been recoded, and to what — for Bank Transactions.
--    Security invoker: what a reader may see is what the ledger's own policies
--    let them read.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_recodes(p_bank_account_id uuid default null)
returns table (
  bank_transaction_id uuid,
  original_entry_id   uuid,
  recode_entry_id     uuid,
  entry_number        text,
  account_id          uuid,
  account_code        text,
  account_name        text
)
language sql stable security invoker set search_path = public as $$
  select r.bank_transaction_id, e.id, re.id, re.entry_number, a.id, a.account_code, a.name
    from acc_reconciliation r
    join acc_bank_transaction t on t.id = r.bank_transaction_id
    join acc_journal_line bl on bl.id = r.journal_line_id
    join acc_journal_entry e on e.id = bl.journal_entry_id
                            and e.status = 'posted' and e.source_type = 'bank' and e.source_id is null
    join acc_journal_entry re on re.source_type = 'bank' and re.source_id = e.id and re.status = 'posted'
    join acc_journal_line rl on rl.journal_entry_id = re.id
    join acc_account a on a.id = rl.account_id
                      and coalesce(a.detail_type, '') not in ('uncategorized_income', 'uncategorized_expense')
   where r.status = 'approved'
     and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id)
   order by r.bank_transaction_id;
$$;

revoke all on function acc_bank_recodes(uuid) from public, anon;
grant execute on function acc_bank_recodes(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Taking a coded line back refuses a line in a signed-off month, and takes
--    its recode with it. Otherwise as 0127 left it.
-- ----------------------------------------------------------------------------
create or replace function acc_uncategorise_bank_transaction(
  p_transaction_id uuid,
  p_reason text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_txn     acc_bank_transaction;
  v_entry   uuid;
  v_source  acc_journal_source;
  v_ref     uuid;
  v_voided  int;
  v_signed  date;
  v_holding boolean;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a bank transaction';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_transaction_id;
  if v_txn.id is null then raise exception 'Bank transaction not found'; end if;
  if v_txn.transaction_batch_id is not null then
    raise exception
      'This line came from a transactions import. Undo that import instead — it owns the entry.';
  end if;

  select e.id, e.source_type, e.source_id into v_entry, v_source, v_ref
    from acc_reconciliation r
    join acc_journal_line l on l.id = r.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_transaction_id = p_transaction_id
   limit 1;
  if v_entry is null then
    raise exception 'This line is not categorised';
  end if;
  if v_source <> 'bank' or v_ref is not null then
    raise exception
      'This line was matched by something that owns its entry (%), not by categorising it.',
      v_source;
  end if;
  -- Locked as a recode locks it, so the two never cross: one waits for the
  -- other, and the recode then finds the entry voided, or this finds its recode.
  perform 1 from acc_journal_entry where id = v_entry for update;

  -- A line ticked in a completed reconciliation belongs to a month somebody
  -- signed off. Voiding it would change that month without a word.
  select sr.statement_ending_date into v_signed
    from acc_reconciliation_line rl
    join acc_statement_reconciliation sr on sr.id = rl.reconciliation_id and sr.status = 'completed'
    join acc_journal_line l on l.id = rl.journal_line_id
   where l.journal_entry_id = v_entry
   order by sr.statement_ending_date
   limit 1;
  if v_signed is not null then
    select exists (
      select 1 from acc_journal_line l join acc_account a on a.id = l.account_id
       where l.journal_entry_id = v_entry
         and coalesce(a.detail_type, '') in ('uncategorized_income', 'uncategorized_expense')
    ) into v_holding;
    if exists (select 1 from acc_journal_entry where source_type = 'bank' and source_id = v_entry and status = 'posted') then
      raise exception 'This line is reconciled to %. To move it to another account, Undo recode and recode it again — or reopen that reconciliation.',
        to_char(v_signed, 'Mon FMDD, YYYY');
    end if;
    if v_holding then
      raise exception 'This line is reconciled to %. Recode it instead, or reopen that reconciliation.',
        to_char(v_signed, 'Mon FMDD, YYYY');
    end if;
    raise exception 'This line is reconciled to %. Reopen that reconciliation to change it.',
      to_char(v_signed, 'Mon FMDD, YYYY');
  end if;

  update acc_journal_entry set status = 'void', voided_at = now()
   where id = v_entry and status = 'posted';
  get diagnostics v_voided = row_count;
  -- Its recode, if it has one, goes with it: left alone it would move money
  -- off an Uncategorized account that no longer holds any.
  update acc_journal_entry set status = 'void', voided_at = now()
   where source_type = 'bank' and source_id = v_entry and status = 'posted';

  -- Every line this entry answered for goes back to waiting: a transfer is one
  -- entry reconciled to two bank lines, and taking it back releases both.
  with released as (
    delete from acc_reconciliation r
     using acc_journal_line l
     where r.journal_line_id = l.id and l.journal_entry_id = v_entry
    returning r.bank_transaction_id
  )
  update acc_bank_transaction set status = 'unmatched'
   where id in (select bank_transaction_id from released) or id = p_transaction_id;
  delete from acc_reconciliation where bank_transaction_id = p_transaction_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_transaction', p_transaction_id, 'uncategorise', auth.uid(),
          jsonb_build_object('journal_entry_id', v_entry,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return v_voided;
end;
$$;

revoke all on function acc_uncategorise_bank_transaction(uuid, text) from public, anon;
grant execute on function acc_uncategorise_bank_transaction(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Coding history learns through recodes. A line still sitting in
--    Uncategorized teaches nothing; a recoded one teaches the account it was
--    recoded to — so a fee moved to Bank Charges once is suggested there next
--    month. Otherwise as 0126 left it.
-- ----------------------------------------------------------------------------
create or replace function acc_coding_history()
returns table (
  entry_id          uuid,
  entry_date        date,
  direction         text,
  account_id        uuid,
  entry_description text,
  other_memo        text,
  bank_description  text
)
language sql stable set search_path = public as $$
  with lines as (
    select l.id, l.journal_entry_id, l.account_id, l.memo,
           l.debit_minor - l.credit_minor as net,
           a.account_type = 'bank' as is_bank,
           coalesce(a.detail_type, '') in ('uncategorized_income', 'uncategorized_expense') as is_holding
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id and e.status = 'posted'
      join acc_account a on a.id = l.account_id
  ),
  shaped as (
    select journal_entry_id
      from lines
     group by journal_entry_id
    having count(*) filter (where is_bank) = 1
       and count(*) filter (where not is_bank) = 1
  )
  select e.id,
         e.entry_date,
         case when b.net >= 0 then 'in' else 'out' end,
         coalesce(rc.account_id, o.account_id),
         e.description,
         o.memo,
         (select t.description
            from acc_reconciliation r
            join acc_bank_transaction t on t.id = r.bank_transaction_id
           where r.journal_line_id = b.id and r.status = 'approved'
           limit 1)
    from shaped s
    join acc_journal_entry e on e.id = s.journal_entry_id
    join lines b on b.journal_entry_id = s.journal_entry_id and b.is_bank
    join lines o on o.journal_entry_id = s.journal_entry_id and not o.is_bank
    left join lateral (
      select rl.account_id
        from acc_journal_entry re
        join acc_journal_line rl on rl.journal_entry_id = re.id and rl.account_id <> o.account_id
       where re.source_type = 'bank' and re.source_id = e.id and re.status = 'posted'
       limit 1
    ) rc on o.is_holding
   where not o.is_holding or rc.account_id is not null
   order by e.id;
$$;

revoke all on function acc_coding_history() from public, anon;
grant execute on function acc_coding_history() to authenticated, service_role;
```

- [ ] **Step 4: Run the verify script again.**

Run: `node --env-file=.env.local scripts/verify-add-missing-lines.mjs`
Expected: every company prints `(0134 applied inside the transaction, never committed)`; the last line reads `288 passed, 0 failed`. Nothing is committed to the database: every company's transaction is rolled back.

- [ ] **Step 5: A new company has the accounts.** In `scripts/verify-company-provisioning.mjs` apply this edit:

Edit 1 of 1 — find:

```js
    "the non-current liabilities are long-term",
    ["2500", "2600", "2700", "2990"].every((c) => built.get(c)?.type === "long_term_liability"),
  );
} catch (error) {
  failed += 1;
  console.log(`  FAIL  provisioning threw — ${error.message}`);
```

replace with:

```js
    "the non-current liabilities are long-term",
    ["2500", "2600", "2700", "2990"].every((c) => built.get(c)?.type === "long_term_liability"),
  );
  // Migration 0134: a line nothing places goes to one of these.
  const holding = [...built.values()].filter((a) => a.detail_type === "uncategorized_income" || a.detail_type === "uncategorized_expense");
  check(
    "one Uncategorized Income and one Uncategorized Expense",
    holding.length === 2 &&
      holding.some((a) => a.detail_type === "uncategorized_income" && a.type === "income") &&
      holding.some((a) => a.detail_type === "uncategorized_expense" && a.type === "expense"),
    holding.map((a) => a.account_code).join(", "),
  );
} catch (error) {
  failed += 1;
  console.log(`  FAIL  provisioning threw — ${error.message}`);
```

Run: `npm run verify:company-provisioning`
Expected: `17 passed, 0 failed`, including `one Uncategorized Income and one Uncategorized Expense`, then `ROLLBACK — the probe company never existed.`

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/0134_add_missing_statement_lines.sql scripts/verify-add-missing-lines.mjs scripts/verify-company-provisioning.mjs
printf 'feat(db): 0134 add the statement lines the books do not have, and recode them\n\nTwo holding accounts in every chart, an all-or-nothing add through the\nexisting categorise function, a recode that never touches the bank line,\nChange refusing a line in a signed-off month, and coding history that learns\nthrough recodes. Verified in rolled-back transactions on every company.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: The Uncategorized accounts and the add-list, in the domain

**Files:**
- Create: `lib/domain/uncategorized.ts`
- Create: `lib/domain/add-missing.ts`
- Create: `tests/unit/add-missing.test.ts`
- Modify: `lib/domain/account-detail.ts` (two edits)
- Modify: `tests/unit/account-detail.test.ts` (one edit)

**Interfaces:**
- Consumes: `Standing` from `lib/domain/reconcile-statement.ts` (`{kind:"paired",...} | {kind:"missing"} | {kind:"after"}`).
- Produces:
  - `lib/domain/uncategorized.ts`: `HOLDING_DETAIL_TYPES`, `HoldingDetailType`, `isHoldingDetail(detail)`, `HoldingAccount {id,label}`, `HoldingAccounts {income,expense}`, `holdingAccountsOf(accounts)`, `holdingAccountIds(accounts): Set<string>`, `needsCoding(postedToAccountId, holdingIds, recoded): boolean`;
  - `lib/domain/add-missing.ts`: `ADD_MISSING_LIMIT = 500`, `AddStatementLine`, `AddBankLine`, `AddSuggestion`, `AddSource`, `AddItem`, `CannotAddReason`, `CannotAdd`, `AddMissingPlan {missing, items, cannot, uncategorized, blocked}`, `CANNOT_ADD_NOTE`, `ADD_BLOCKED`, `UNCATEGORIZED_WHY`, `planAddMissing(input): AddMissingPlan`, `addedMessage(added, uncategorized): string`;
  - `detailLabel` reads the two holding detail types.

- [ ] **Step 1: The tests.** Create `tests/unit/add-missing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ADD_BLOCKED,
  ADD_MISSING_LIMIT,
  CANNOT_ADD_NOTE,
  UNCATEGORIZED_WHY,
  addedMessage,
  addedNotPairedMessage,
  planAddMissing,
  type AddBankLine,
  type AddStatementLine,
  type AddSuggestion,
} from "@/lib/domain/add-missing";
import type { Standing } from "@/lib/domain/reconcile-statement";
import { holdingAccountIds, holdingAccountsOf, isHoldingDetail, needsCoding } from "@/lib/domain/uncategorized";

const holding = {
  income: { id: "uncat-in", label: "4999 — Uncategorized Income" },
  expense: { id: "uncat-out", label: "6999 — Uncategorized Expense" },
};
const missing: Standing = { kind: "missing" };
const paired: Standing = { kind: "paired", how: "date and amount", bookId: "b1", entryNumber: "JE-1", ticked: true };
const after: Standing = { kind: "after" };

const line = (lineNo: number, txnDate: string, amountMinor: number, description: string, reference: string | null = null): AddStatementLine => ({
  lineNo,
  txnDate,
  amountMinor,
  description,
  reference,
});
const txn = (id: string, l: AddStatementLine, extra: Partial<AddBankLine> = {}): AddBankLine => ({
  id,
  txnDate: l.txnDate,
  description: l.description,
  reference: l.reference,
  amountMinor: l.amountMinor,
  status: "unmatched",
  suggested: false,
  ...extra,
});
const rule: AddSuggestion = { accountId: "charges", accountLabel: "6400 — Bank Charges", source: "rule", short: "Rule 1", why: "Rule 1: SERVICE FEE" };

const deposit = line(0, "2026-07-05", 50000, "DEPOSIT 0041");
const wire = line(1, "2026-07-15", 3000, "INCOMING WIRE");
const shop = line(2, "2026-07-28", -4200, "POS EXAMPLE SHOP");
const fee = line(3, "2026-07-30", -1500, "SERVICE FEE");
const late = line(4, "2026-08-02", -700, "AFTER THE STATEMENT");

describe("planAddMissing", () => {
  it("adds each missing line through its bank line: by its suggestion, or to Uncategorized by direction", () => {
    const plan = planAddMissing({
      lines: [deposit, wire, shop, fee, late],
      standings: [paired, missing, missing, missing, after],
      flipped: false,
      transactions: [txn("t-dep", deposit, { status: "matched" }), txn("t-wire", wire), txn("t-shop", shop), txn("t-fee", fee), txn("t-late", late)],
      suggestions: new Map([["t-fee", rule]]),
      holding,
    });
    expect(plan.missing).toBe(3);
    expect(plan.blocked).toBeNull();
    expect(plan.cannot).toEqual([]);
    expect(plan.items.map((i) => [i.lineNo, i.transactionId, i.accountId, i.source])).toEqual([
      [1, "t-wire", "uncat-in", "uncategorized"],
      [2, "t-shop", "uncat-out", "uncategorized"],
      [3, "t-fee", "charges", "rule"],
    ]);
    expect(plan.items[0].why).toBe(UNCATEGORIZED_WHY);
    expect(plan.items[2]).toMatchObject({ accountLabel: "6400 — Bank Charges", short: "Rule 1", why: "Rule 1: SERVICE FEE" });
    expect(plan.uncategorized).toBe(2);
  });

  it("pairs identical lines of one day one to one, in the order they were imported", () => {
    const one = line(1, "2026-07-30", -500, "ATM FEE");
    const two = line(2, "2026-07-30", -500, "ATM FEE");
    const plan = planAddMissing({
      lines: [one, two],
      standings: [missing, missing],
      flipped: false,
      transactions: [txn("first", one), txn("second", two)],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items.map((i) => [i.lineNo, i.transactionId])).toEqual([
      [1, "first"],
      [2, "second"],
    ]);
  });

  it("reads a reference the way the statement keeps it: trimmed", () => {
    const check = line(1, "2026-07-02", -60000, "CHECK", "1201");
    const plan = planAddMissing({
      lines: [check],
      standings: [missing],
      flipped: false,
      transactions: [txn("t-check", check, { reference: " 1201 " })],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items.map((i) => i.transactionId)).toEqual(["t-check"]);
  });

  it("says why a line cannot be added: no bank line, coded already, excluded, or a match suggested", () => {
    const a = line(1, "2026-07-10", -100, "A");
    const b = line(2, "2026-07-11", -200, "B");
    const c = line(3, "2026-07-12", -300, "C");
    const d = line(4, "2026-07-13", -400, "D");
    const plan = planAddMissing({
      lines: [a, b, c, d],
      standings: [missing, missing, missing, missing],
      flipped: false,
      transactions: [txn("t-b", b, { status: "matched" }), txn("t-c", c, { status: "ignored" }), txn("t-d", d, { suggested: true })],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items).toEqual([]);
    expect(plan.cannot.map((x) => [x.lineNo, x.reason, x.note])).toEqual([
      [1, "not-found", CANNOT_ADD_NOTE["not-found"]],
      [2, "coded", CANNOT_ADD_NOTE.coded],
      [3, "ignored", CANNOT_ADD_NOTE.ignored],
      [4, "suggested", CANNOT_ADD_NOTE.suggested],
    ]);
  });

  it("leaves out a line of 0.00 and a line dated in a month already signed off", () => {
    const zero = line(1, "2026-07-10", 0, "ZERO");
    const old = line(2, "2026-06-28", -900, "LATE CHARGE");
    const plan = planAddMissing({
      lines: [zero, old, fee],
      standings: [missing, missing, missing],
      flipped: false,
      transactions: [txn("t-zero", zero), txn("t-old", old), txn("t-fee", fee)],
      suggestions: new Map([["t-fee", rule]]),
      holding,
      signedThrough: "2026-06-30",
    });
    expect(plan.cannot.map((x) => [x.lineNo, x.reason, x.note])).toEqual([
      [1, "zero", CANNOT_ADD_NOTE.zero],
      [2, "signed", CANNOT_ADD_NOTE.signed],
    ]);
    expect(plan.items.map((i) => i.transactionId)).toEqual(["t-fee"]);
  });

  it("never gives one bank line to two statement lines", () => {
    const one = line(1, "2026-07-30", -500, "ATM FEE");
    const two = line(2, "2026-07-30", -500, "ATM FEE");
    const plan = planAddMissing({
      lines: [one, two],
      standings: [missing, missing],
      flipped: false,
      transactions: [txn("only", one)],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items.map((i) => [i.lineNo, i.transactionId])).toEqual([[1, "only"]]);
    expect(plan.cannot.map((x) => [x.lineNo, x.reason])).toEqual([[2, "not-found"]]);
  });

  it("adds nothing from a statement read the other way around", () => {
    const plan = planAddMissing({
      lines: [fee],
      standings: [missing],
      flipped: true,
      transactions: [txn("t-fee", fee)],
      suggestions: new Map(),
      holding,
    });
    expect(plan).toEqual({ missing: 1, items: [], cannot: [], uncategorized: 0, blocked: ADD_BLOCKED.flipped });
  });

  it("adds nothing when a line needs an Uncategorized account the chart does not have", () => {
    const plan = planAddMissing({
      lines: [shop],
      standings: [missing],
      flipped: false,
      transactions: [txn("t-shop", shop)],
      suggestions: new Map(),
      holding: { income: holding.income, expense: null },
    });
    expect(plan.items).toEqual([]);
    expect(plan.blocked).toBe(ADD_BLOCKED.noHolding);
  });

  it(`stops at more than ${ADD_MISSING_LIMIT} lines`, () => {
    const lines = Array.from({ length: ADD_MISSING_LIMIT + 1 }, (_, i) => line(i, "2026-07-30", -(i + 1), `FEE ${i}`));
    const plan = planAddMissing({
      lines,
      standings: lines.map(() => missing),
      flipped: false,
      transactions: lines.map((l, i) => txn(`t-${i}`, l)),
      suggestions: new Map(),
      holding,
    });
    expect([plan.missing, plan.items.length, plan.uncategorized, plan.blocked]).toEqual([ADD_MISSING_LIMIT + 1, 0, 0, ADD_BLOCKED.tooMany]);
  });

  it("has nothing to say when every line is in the books", () => {
    expect(
      planAddMissing({ lines: [deposit], standings: [paired], flipped: false, transactions: [], suggestions: new Map(), holding }),
    ).toEqual({ missing: 0, items: [], cannot: [], uncategorized: 0, blocked: null });
  });
});

describe("addedMessage", () => {
  it("says how many were added, and how many went to Uncategorized", () => {
    expect(addedMessage(3, 1)).toBe("3 entries added from the statement and ticked; 1 went to Uncategorized.");
    expect(addedMessage(1, 0)).toBe("1 entry added from the statement and ticked.");
  });

  it("says the lines are in the books when pairing them afterwards failed", () => {
    expect(addedNotPairedMessage(2, 1, "timeout")).toBe(
      "2 entries added from the statement, 1 to Uncategorized, but pairing them with the statement failed (timeout). Click Match again to tick them.",
    );
    expect(addedNotPairedMessage(1, 0, "timeout")).toBe(
      "1 entry added from the statement, but pairing it with the statement failed (timeout). Click Match again to tick it.",
    );
  });
});

describe("the Uncategorized accounts", () => {
  const chart = [
    { id: "a", account_code: "4999", name: "Uncategorized Income", detail_type: "uncategorized_income", status: "active" },
    { id: "b", account_code: "6999", name: "Uncategorized Expense", detail_type: "uncategorized_expense", status: "active" },
    { id: "c", account_code: "6400", name: "Bank Charges", detail_type: null, status: "active" },
  ];

  it("are found by their detail type", () => {
    expect(holdingAccountsOf(chart)).toEqual({
      income: { id: "a", label: "4999 — Uncategorized Income" },
      expense: { id: "b", label: "6999 — Uncategorized Expense" },
    });
    expect([...holdingAccountIds(chart)]).toEqual(["a", "b"]);
    expect([isHoldingDetail("uncategorized_expense"), isHoldingDetail("undeposited_funds"), isHoldingDetail(null)]).toEqual([true, false, false]);
  });

  it("a line posted to one and not recoded needs coding", () => {
    const ids = holdingAccountIds(chart);
    expect([needsCoding("b", ids, false), needsCoding("b", ids, true), needsCoding("c", ids, false), needsCoding(undefined, ids, false)]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});
```

In `tests/unit/account-detail.test.ts` apply this edit:

Edit 1 of 1 — find:

```ts
    expect(detailLabel("fixed_asset", "Contra fixed asset")).toBe("Contra fixed asset");
    expect(detailLabel("expense", null)).toBeNull();
  });
});

describe("the contra flag on an account", () => {
```

replace with:

```ts
    expect(detailLabel("fixed_asset", "Contra fixed asset")).toBe("Contra fixed asset");
    expect(detailLabel("expense", null)).toBeNull();
  });

  it("says what the two Uncategorized holding accounts are for", () => {
    expect(detailLabel("income", "uncategorized_income")).toBe("Holding account — money in not yet coded");
    expect(detailLabel("expense", "uncategorized_expense")).toBe("Holding account — money out not yet coded");
  });
});

describe("the contra flag on an account", () => {
```

- [ ] **Step 2: Run them — they fail.**

Run: `npx vitest run tests/unit/add-missing.test.ts tests/unit/account-detail.test.ts`
Expected: FAIL — `@/lib/domain/add-missing` cannot be resolved, and the holding-label test fails.

- [ ] **Step 3: The modules.** Create `lib/domain/uncategorized.ts`:

```ts
/**
 * The two holding accounts a bank line goes to when nothing places it
 * (migration 0134): Uncategorized Income for money in, Uncategorized Expense
 * for money out. Known by their detail type, never by name or code — a chart
 * keeps whatever code its own convention gave them.
 */
export const HOLDING_DETAIL_TYPES = ["uncategorized_income", "uncategorized_expense"] as const;
export type HoldingDetailType = (typeof HOLDING_DETAIL_TYPES)[number];

export function isHoldingDetail(detail: string | null | undefined): detail is HoldingDetailType {
  return (HOLDING_DETAIL_TYPES as readonly string[]).includes(detail ?? "");
}

export interface HoldingAccount {
  id: string;
  /** "6999 — Uncategorized Expense" */
  label: string;
}

export interface HoldingAccounts {
  income: HoldingAccount | null;
  expense: HoldingAccount | null;
}

interface AccountLike {
  id: string;
  account_code: string;
  name: string;
  detail_type: string | null;
  status: string;
}

export function holdingAccountsOf(accounts: readonly AccountLike[]): HoldingAccounts {
  const find = (detail: HoldingDetailType): HoldingAccount | null => {
    const account = accounts.find((a) => a.detail_type === detail && a.status === "active");
    return account ? { id: account.id, label: `${account.account_code} — ${account.name}` } : null;
  };
  return { income: find("uncategorized_income"), expense: find("uncategorized_expense") };
}

/** The ids of the holding accounts in a chart, for telling a posting that sits in one. */
export function holdingAccountIds(accounts: readonly AccountLike[]): Set<string> {
  return new Set(accounts.filter((a) => isHoldingDetail(a.detail_type)).map((a) => a.id));
}

/** A line coded to Uncategorized and not recoded yet — what Bank Transactions' "Needs coding" lists. */
export function needsCoding(postedToAccountId: string | null | undefined, holdingIds: ReadonlySet<string>, recoded: boolean): boolean {
  return Boolean(postedToAccountId && holdingIds.has(postedToAccountId) && !recoded);
}
```

Create `lib/domain/add-missing.ts`:

```ts
/**
 * The statement lines the books do not have, as "Add all N to the books"
 * adds them (1.82, after the prototype's recAddMissing in p24.html).
 *
 * Each line the pairing left "missing" is paired with the bank line it was
 * imported as — same date, amount, description and reference, the n-th of
 * identical lines with the n-th — and coded by that bank line's suggestion
 * (card, related company, rule, history) or, when nothing places it, to
 * Uncategorized Income or Expense by its direction, to be recoded later. A line
 * that cannot be added says why. Pure: the service reads, this decides.
 */
import type { Standing } from "./reconcile-statement";
import type { HoldingAccounts } from "./uncategorized";

/** The most lines one click adds; matches acc_add_statement_lines_to_books. */
export const ADD_MISSING_LIMIT = 500;

export interface AddStatementLine {
  lineNo: number;
  txnDate: string;
  description: string;
  reference: string | null;
  amountMinor: number;
}

export interface AddBankLine {
  id: string;
  txnDate: string;
  description: string | null;
  reference: string | null;
  amountMinor: number;
  status: string;
  /** The matcher suggests a book line for it: it may already be in the books. */
  suggested: boolean;
}

export interface AddSuggestion {
  accountId: string;
  accountLabel: string;
  source: "rule" | "history" | "card" | "related";
  /** "Rule 3", "11 of 11", "Card" */
  short: string;
  why: string;
}

export type AddSource = AddSuggestion["source"] | "uncategorized";

export interface AddItem {
  lineNo: number;
  txnDate: string;
  description: string;
  amountMinor: number;
  transactionId: string;
  accountId: string;
  accountLabel: string;
  source: AddSource;
  short: string;
  why: string;
}

export type CannotAddReason = "not-found" | "coded" | "ignored" | "suggested" | "zero" | "signed";

export interface CannotAdd {
  lineNo: number;
  txnDate: string;
  description: string;
  amountMinor: number;
  reason: CannotAddReason;
  note: string;
}

export interface AddMissingPlan {
  /** Statement lines the books do not have, dated on or before the statement date. */
  missing: number;
  items: AddItem[];
  cannot: CannotAdd[];
  /** Of the items, how many go to Uncategorized. */
  uncategorized: number;
  /** Why nothing can be added from here, when nothing can. */
  blocked: string | null;
}

export const CANNOT_ADD_NOTE: Record<CannotAddReason, string> = {
  "not-found": "Not in Bank Transactions — import the statement again, or add it there.",
  coded: "Already in the books — click Match again.",
  ignored: "Excluded in Bank Transactions — include it there to add it.",
  suggested: "Bank Transactions suggests a match in the books for it — approve or reject that first.",
  zero: "A line of 0.00 has nothing to post.",
  signed: "Dated in a month already reconciled — add it in Bank Transactions if it belongs there.",
};

export const ADD_BLOCKED = {
  flipped:
    "This statement shows money in and out the other way around from the books, so nothing is added from here. Check the signs of its lines in Bank Transactions.",
  tooMany: `More than ${ADD_MISSING_LIMIT} lines — code them in Bank Transactions.`,
  noHolding: "This company has no active Uncategorized accounts, so lines nothing places cannot be added from here.",
} as const;

export const UNCATEGORIZED_WHY = "Nothing places this line, so it goes to Uncategorized, to recode later.";

/**
 * The key a statement line and its bank line share. The statement keeps a
 * description cut to 500 characters and a reference trimmed to 80, where the
 * bank line keeps them as the file gave them — so both are read the same way.
 */
function lineKey(txnDate: string, amountMinor: number, description: string | null, reference: string | null): string {
  const ref = (reference ?? "").trim().slice(0, 80);
  return JSON.stringify([txnDate, amountMinor, (description ?? "").slice(0, 500), ref]);
}

export function planAddMissing(input: {
  lines: readonly AddStatementLine[];
  /** One per line, in the same order (reconciliationStandings). */
  standings: readonly Standing[];
  flipped: boolean;
  /** The bank account's lines; identical lines in the order they were imported. */
  transactions: readonly AddBankLine[];
  /** The suggestion for each waiting bank line, by its id. */
  suggestions: ReadonlyMap<string, AddSuggestion>;
  holding: HoldingAccounts;
  /**
   * The statement date of the account's newest completed reconciliation before
   * this one, when there is one: a line dated on or before it belongs to a
   * month somebody signed off, and is not added from here.
   */
  signedThrough?: string | null;
}): AddMissingPlan {
  const missingLines = input.lines.filter((_, i) => input.standings[i]?.kind === "missing");
  const empty = (blocked: string | null): AddMissingPlan => ({
    missing: missingLines.length,
    items: [],
    cannot: [],
    uncategorized: 0,
    blocked,
  });
  if (!missingLines.length) return empty(null);
  if (input.flipped) return empty(ADD_BLOCKED.flipped);

  const groups = new Map<string, AddBankLine[]>();
  for (const txn of input.transactions) {
    const key = lineKey(txn.txnDate, txn.amountMinor, txn.description, txn.reference);
    groups.set(key, [...(groups.get(key) ?? []), txn]);
  }
  const taken = new Set<string>();

  const items: AddItem[] = [];
  const cannot: CannotAdd[] = [];
  for (const line of missingLines) {
    const group = groups.get(lineKey(line.txnDate, line.amountMinor, line.description, line.reference)) ?? [];
    const free = group.find((txn) => !taken.has(txn.id) && txn.status === "unmatched" && !txn.suggested);
    const said = { lineNo: line.lineNo, txnDate: line.txnDate, description: line.description, amountMinor: line.amountMinor };
    if (line.amountMinor === 0 || (input.signedThrough && line.txnDate <= input.signedThrough)) {
      const reason: CannotAddReason = line.amountMinor === 0 ? "zero" : "signed";
      cannot.push({ ...said, reason, note: CANNOT_ADD_NOTE[reason] });
      continue;
    }
    if (!free) {
      const rest = group.filter((txn) => !taken.has(txn.id));
      const reason: CannotAddReason = rest.some((t) => t.status === "unmatched" && t.suggested)
        ? "suggested"
        : rest.some((t) => t.status === "matched")
          ? "coded"
          : rest.some((t) => t.status === "ignored")
            ? "ignored"
            : "not-found";
      cannot.push({ ...said, reason, note: CANNOT_ADD_NOTE[reason] });
      continue;
    }
    taken.add(free.id);
    const suggestion = input.suggestions.get(free.id);
    if (suggestion) {
      items.push({
        ...said,
        transactionId: free.id,
        accountId: suggestion.accountId,
        accountLabel: suggestion.accountLabel,
        source: suggestion.source,
        short: suggestion.short,
        why: suggestion.why,
      });
      continue;
    }
    const holding = line.amountMinor > 0 ? input.holding.income : input.holding.expense;
    if (!holding) return { ...empty(ADD_BLOCKED.noHolding), cannot };
    items.push({
      ...said,
      transactionId: free.id,
      accountId: holding.id,
      accountLabel: holding.label,
      source: "uncategorized",
      short: "",
      why: UNCATEGORIZED_WHY,
    });
  }

  const blocked = items.length > ADD_MISSING_LIMIT ? ADD_BLOCKED.tooMany : null;
  return {
    missing: missingLines.length,
    items: blocked ? [] : items,
    cannot,
    uncategorized: blocked ? 0 : items.filter((item) => item.source === "uncategorized").length,
    blocked,
  };
}

/** When the lines were posted but pairing them afterwards failed: they are in the books, not yet ticked. */
export function addedNotPairedMessage(added: number, uncategorized: number, problem: string): string {
  const them = added === 1 ? "it" : "them";
  const head = `${added} ${added === 1 ? "entry" : "entries"} added from the statement`;
  const holding = uncategorized ? `, ${uncategorized} to Uncategorized` : "";
  return `${head}${holding}, but pairing ${them} with the statement failed (${problem}). Click Match again to tick ${them}.`;
}

/** The message after adding: "3 entries added from the statement and ticked; 1 went to Uncategorized." */
export function addedMessage(added: number, uncategorized: number): string {
  const head = `${added} ${added === 1 ? "entry" : "entries"} added from the statement and ticked`;
  return uncategorized ? `${head}; ${uncategorized} went to Uncategorized.` : `${head}.`;
}
```

In `lib/domain/account-detail.ts` apply these edits:

Edit 1 of 2 — find:

```ts
 */
import type { AccountType } from "./accounts";
import { BANK_DETAIL_TYPES, bankDetailLabel } from "./bank-account-detail";

export const CURRENT_ASSET_DETAIL_TYPES = ["undeposited_funds", "transfer_clearing"] as const;
export type CurrentAssetDetailType = (typeof CURRENT_ASSET_DETAIL_TYPES)[number];
```

replace with:

```ts
 */
import type { AccountType } from "./accounts";
import { BANK_DETAIL_TYPES, bankDetailLabel } from "./bank-account-detail";
import { isHoldingDetail, type HoldingDetailType } from "./uncategorized";

/** The two holding accounts migration 0134 gives every chart. */
const HOLDING_LABELS: Record<HoldingDetailType, string> = {
  uncategorized_income: "Holding account — money in not yet coded",
  uncategorized_expense: "Holding account — money out not yet coded",
};

export const CURRENT_ASSET_DETAIL_TYPES = ["undeposited_funds", "transfer_clearing"] as const;
export type CurrentAssetDetailType = (typeof CURRENT_ASSET_DETAIL_TYPES)[number];
```

Edit 2 of 2 — find:

```ts
export function detailLabel(type: AccountType, detail: string | null): string | null {
  if (type === "bank") return bankDetailLabel(detail);
  if (isCurrentAssetDetail(detail)) return CURRENT_ASSET_LABELS[detail];
  return detail;
}
```

replace with:

```ts
export function detailLabel(type: AccountType, detail: string | null): string | null {
  if (type === "bank") return bankDetailLabel(detail);
  if (isCurrentAssetDetail(detail)) return CURRENT_ASSET_LABELS[detail];
  if (isHoldingDetail(detail)) return HOLDING_LABELS[detail];
  return detail;
}
```

- [ ] **Step 4: Run them — they pass.**

Run: `npx vitest run tests/unit/add-missing.test.ts tests/unit/account-detail.test.ts`
Expected: both files pass (add-missing: 14 tests).
Run: `npx eslint lib/domain/uncategorized.ts lib/domain/add-missing.ts lib/domain/account-detail.ts tests/unit/add-missing.test.ts tests/unit/account-detail.test.ts` — Expected: prints nothing.

- [ ] **Step 5: Commit.**

```bash
git add lib/domain/uncategorized.ts lib/domain/add-missing.ts lib/domain/account-detail.ts tests/unit/add-missing.test.ts tests/unit/account-detail.test.ts
printf 'feat(reconcile): what Add all adds, and the Uncategorized accounts, in the domain\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: Add all in the reconciliation

**Files:**
- Create: `lib/services/add-missing.ts`
- Create: `app/(app)/banking/reconcile/[id]/AddMissingBox.tsx`
- Modify: `app/(app)/banking/reconcile/statement-actions.ts` (edits)
- Modify: `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` (edits)

**Interfaces:**
- Consumes: Task 1's `acc_add_statement_lines_to_books`; Task 2's `planAddMissing`, `AddMissingPlan`, `AddItem`, `AddSuggestion`, `AddBankLine`, `ADD_MISSING_LIMIT`, `addedMessage`, `holdingAccountsOf`; existing `getReconciliationStatement`, `getReconciliationLines`, `pairAndTick` (`lib/services/bankrec.ts`), `listSuggestions` (`lib/services/banking.ts`), `codingSuggestions` (`lib/services/coding.ts`), `listAccounts` (`lib/services/accounts.ts`), `readAllPages` (`lib/services/paging.ts`).
- Produces: `getAddMissingPlan(sb, reconciliationId): Promise<AddMissingPlan>`, `addMissingLines(sb, reconciliationId, shown: {lineNo, accountId}[]): Promise<AddedLines {added, uncategorized, outcome}>`, `AddMissingError`; server actions `addMissingPlanAction(reconciliationId)` and `addMissingLinesAction(reconciliationId, shown)`; the box in the workspace.

- [ ] **Step 1: The service.** Create `lib/services/add-missing.ts`:

```ts
/**
 * Adding the statement lines the books do not have (1.82): what the
 * reconciliation's box shows, worked out from the kept statement, the books,
 * the account's bank lines and their coding suggestions; and the click that
 * posts them all through acc_add_statement_lines_to_books, then pairs and ticks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { planAddMissing, type AddBankLine, type AddMissingPlan, type AddSuggestion } from "@/lib/domain/add-missing";
import { reconciliationStandings, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { holdingAccountsOf } from "@/lib/domain/uncategorized";
import { listAccounts } from "./accounts";
import { listSuggestions } from "./banking";
import { getReconciliationLines, getReconciliationStatement, listReconciliations, pairAndTick } from "./bankrec";
import { codingSuggestions } from "./coding";
import { readAllPages } from "./paging";

export class AddMissingError extends Error {}

async function bankLinesBetween(sb: SupabaseClient, bankAccountId: string, from: string, to: string) {
  // Paged, oldest first; the id settles lines of one day, so identical lines
  // keep one order however many pages the read takes.
  return readAllPages<Record<string, unknown>>(
    (start, end) =>
      sb
        .from("acc_bank_transaction")
        .select("id,txn_date,description,reference,amount_minor,status")
        .eq("bank_account_id", bankAccountId)
        .is("provider_removed_at", null)
        .gte("txn_date", from)
        .lte("txn_date", to)
        .order("txn_date")
        .order("id")
        .range(start, end),
    (message) => new AddMissingError(message),
  );
}

/** What "Add all N to the books" would add to this reconciliation, and what it cannot. */
export async function getAddMissingPlan(sb: SupabaseClient, reconciliationId: string): Promise<AddMissingPlan> {
  const [statement, book] = await Promise.all([
    getReconciliationStatement(sb, reconciliationId),
    getReconciliationLines(sb, reconciliationId),
  ]);
  const standings = reconciliationStandings(statement, book);
  const missingDates = statement.lines.filter((_, i) => standings.standings[i]?.kind === "missing").map((l) => l.txnDate).sort();
  if (!missingDates.length || standings.flipped) {
    return planAddMissing({
      lines: statement.lines,
      standings: standings.standings,
      flipped: standings.flipped,
      transactions: [],
      suggestions: new Map(),
      holding: { income: null, expense: null },
    });
  }

  const bankAccountId = statement.bankAccountId;
  const [rows, matches, coding, accounts, reconciliations] = await Promise.all([
    bankLinesBetween(sb, bankAccountId, missingDates[0], missingDates[missingDates.length - 1]),
    listSuggestions(sb, bankAccountId),
    codingSuggestions(sb, bankAccountId),
    listAccounts(sb),
    listReconciliations(sb, bankAccountId),
  ]);
  // The newest month signed off before this one: a line dated in it is not added from here.
  const signedThrough =
    reconciliations
      .filter((r) => r.status === "completed" && r.statement_ending_date < statement.endingDate)
      .map((r) => r.statement_ending_date)
      .sort()
      .at(-1) ?? null;
  const suggested = new Set(matches.map((m) => m.bank_transaction_id));
  const transactions: AddBankLine[] = rows.map((row) => ({
    id: row.id as string,
    txnDate: row.txn_date as string,
    description: (row.description as string | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    amountMinor: Number(row.amount_minor),
    status: row.status as string,
    suggested: suggested.has(row.id as string),
  }));
  const suggestions = new Map<string, AddSuggestion>(
    coding.map((s) => [s.transactionId, { accountId: s.accountId, accountLabel: s.accountLabel, source: s.source, short: s.short, why: s.why }]),
  );
  return planAddMissing({
    lines: statement.lines,
    standings: standings.standings,
    flipped: false,
    transactions,
    suggestions,
    holding: holdingAccountsOf(accounts),
    signedThrough,
  });
}

export interface AddedLines {
  added: number;
  uncategorized: number;
  /** Null when pairing failed after the lines were posted. */
  outcome: PairingOutcome | null;
  /** Why pairing failed, when it did: the lines are in the books, not yet ticked. */
  pairingError: string | null;
}

/** Shown to the person: a line and the account it would post to. */
export interface ShownItem {
  lineNo: number;
  accountId: string;
}

const sameItems = (a: readonly ShownItem[], b: readonly ShownItem[]) => {
  const key = (items: readonly ShownItem[]) => items.map((i) => `${i.lineNo}:${i.accountId}`).sort().join(",");
  return key(a) === key(b);
};

/**
 * Posts every line the plan adds, or none; then pairs and ticks. The plan is
 * worked out again here, and it must be the one the person was shown: a
 * suggestion or a bank line that changed since is not posted unseen.
 */
export async function addMissingLines(sb: SupabaseClient, reconciliationId: string, shown: readonly ShownItem[]): Promise<AddedLines> {
  const plan = await getAddMissingPlan(sb, reconciliationId);
  if (plan.blocked) throw new AddMissingError(plan.blocked);
  if (!plan.items.length) throw new AddMissingError("There is nothing to add");
  if (!sameItems(plan.items, shown)) {
    throw new AddMissingError("The lines to add changed since this page was drawn, so nothing was posted. Look them over again.");
  }
  const { error } = await sb.rpc("acc_add_statement_lines_to_books", {
    p_reconciliation_id: reconciliationId,
    p_items: plan.items.map((item) => ({ line_no: item.lineNo, bank_transaction_id: item.transactionId, account_id: item.accountId })),
  });
  if (error) throw new AddMissingError(error.message);
  // The lines are in the books now, whatever happens next: a pairing that fails
  // is said as such, never as lines that were not added.
  const added = { added: plan.items.length, uncategorized: plan.uncategorized };
  try {
    return { ...added, outcome: await pairAndTick(sb, reconciliationId), pairingError: null };
  } catch (e) {
    return { ...added, outcome: null, pairingError: e instanceof Error ? e.message : "an unexpected error" };
  }
}
```

- [ ] **Step 2: The actions.** In `app/(app)/banking/reconcile/statement-actions.ts` apply these edits:

Edit 1 of 4 — find:

```ts
 * The session itself — ticking, completing, reopening — is in actions.ts.
 */
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
```

replace with:

```ts
 * The session itself — ticking, completing, reopening — is in actions.ts.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
```

Edit 2 of 4 — find:

```ts
  BankRecError, type ReconStatement, type StatementFileInput,
} from "@/lib/services/bankrec";
import { generateSuggestions, importStatement } from "@/lib/services/banking";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
```

replace with:

```ts
  BankRecError, type ReconStatement, type StatementFileInput,
} from "@/lib/services/bankrec";
import { generateSuggestions, importStatement } from "@/lib/services/banking";
import { AddMissingError, addMissingLines, getAddMissingPlan, type AddedLines } from "@/lib/services/add-missing";
import { ADD_MISSING_LIMIT, type AddMissingPlan } from "@/lib/domain/add-missing";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
```

Edit 3 of 4 — find:

```ts
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export interface StatementImportSummary {
  /** New lines in Bank Transactions; a line already there is a duplicate. */
```

replace with:

```ts
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string {
  return e instanceof BankRecError || e instanceof AddMissingError || e instanceof Error ? e.message : "An unexpected error occurred";
}

export interface StatementImportSummary {
  /** New lines in Bank Transactions; a line already there is a duplicate. */
```

Edit 4 of 4 — find:

```ts
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationStatement(sb, reconciliationId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

replace with:

```ts
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationStatement(sb, reconciliationId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** What "Add all N to the books" would add to this reconciliation, and what it cannot. Reads only. */
export async function addMissingPlanAction(reconciliationId: string): Promise<ActionResult<AddMissingPlan>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getAddMissingPlan(sb, reconciliationId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

const shownSchema = z
  .array(z.object({ lineNo: z.number().int().nonnegative(), accountId: z.uuid() }))
  .min(1, "There is nothing to add")
  .max(ADD_MISSING_LIMIT, `At most ${ADD_MISSING_LIMIT} lines can be added at a time`);

/**
 * Adds the statement lines the books do not have — every one or none — as the
 * person was shown them, then pairs and ticks. The reconciliation is not
 * completed: Complete stays the person's click.
 */
export async function addMissingLinesAction(reconciliationId: string, shown: unknown): Promise<ActionResult<AddedLines>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = shownSchema.safeParse(shown);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const added = await addMissingLines(sb, reconciliationId, parsed.data);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    revalidatePath("/banking");
    revalidatePath("/reports");
    return { ok: true, data: added };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
```

- [ ] **Step 3: The box.** Create `app/(app)/banking/reconcile/[id]/AddMissingBox.tsx`:

```tsx
"use client";
import Link from "next/link";
import { Alert, Button, Space, Tag, Tooltip, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import type { AddItem, AddMissingPlan } from "@/lib/domain/add-missing";
import { shortDate } from "@/lib/domain/pdf-statement-view";

/**
 * The statement lines the books do not have, and one click that adds them all
 * (the prototype's "Add all N to the books", p24b.html). The table shows what
 * each line will post to before anything is posted, so the click asks nothing
 * more.
 */
interface Props {
  plan: AddMissingPlan;
  bankAccountId: string;
  money: (minor: number) => string;
  adding: boolean;
  onAdd: () => void;
}

const INTRO =
  "Adding them posts real entries, dated as the bank has them and coded by your rules — anything a rule cannot place goes to Uncategorized, to recode later. They are ticked straight away, because the bank has already cleared them.";

export default function AddMissingBox({ plan, bankAccountId, money, adding, onAdd }: Props) {
  const { missing, items, cannot, blocked } = plan;
  return (
    <Alert
      type="warning"
      showIcon
      title={`The bank shows ${missing} ${missing === 1 ? "thing" : "things"} your books do not.`}
      description={
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Text>{INTRO}</Typography.Text>
          {blocked ? <Typography.Text strong>{blocked}</Typography.Text> : null}
          {items.length ? (
            <DataTable<AddItem>
              rowKey="lineNo"
              size="small"
              pagination={false}
              dataSource={items}
              columns={[
                { title: "Date", render: (_, item) => shortDate(item.txnDate, true), width: 120 },
                { title: "Description", dataIndex: "description" },
                { title: "Amount", align: "right", render: (_, item) => money(item.amountMinor), width: 130 },
                {
                  title: "Would post to",
                  width: 300,
                  render: (_, item) => (
                    <Space size={6} wrap>
                      <Tooltip title={item.why}>
                        <span>{item.accountLabel}</span>
                      </Tooltip>
                      {item.source === "uncategorized" ? (
                        <Tag color="gold">needs coding</Tag>
                      ) : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {item.short}
                        </Typography.Text>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          ) : null}
          {cannot.length ? (
            <div>
              <Typography.Text type="secondary">Not added from here:</Typography.Text>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {cannot.map((line) => (
                  <li key={line.lineNo}>
                    {shortDate(line.txnDate, true)} · {line.description || "(no description)"} · {money(line.amountMinor)} — {line.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Space size="middle" wrap>
            {items.length && !blocked ? (
              <Button type="primary" loading={adding} onClick={onAdd}>
                Add all {items.length} to the books
              </Button>
            ) : null}
            <Link href={`/banking?account=${bankAccountId}&queue=unmatched`}>or code them one by one in Bank Transactions</Link>
          </Space>
        </Space>
      }
    />
  );
}
```

In `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` apply these edits (the box replaces the old "Code the N lines the books do not have" link):

Edit 1 of 5 — find:

```tsx
  reopenReconciliationAction,
} from "../actions";
import {
  importStatementIntoReconciliationAction,
  matchAgainAction,
  reconciliationStatementAction,
  setStatementEndingAction,
} from "../statement-actions";
import type { ReconLineView, ReconDetail, ReconStatement, ReconStatementLine } from "@/lib/services/bankrec";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import StandingTag from "../StandingTag";
```

replace with:

```tsx
  reopenReconciliationAction,
} from "../actions";
import {
  addMissingLinesAction,
  addMissingPlanAction,
  importStatementIntoReconciliationAction,
  matchAgainAction,
  reconciliationStatementAction,
  setStatementEndingAction,
} from "../statement-actions";
import { addedMessage, addedNotPairedMessage, type AddMissingPlan } from "@/lib/domain/add-missing";
import AddMissingBox from "./AddMissingBox";
import type { ReconLineView, ReconDetail, ReconStatement, ReconStatementLine } from "@/lib/services/bankrec";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
import StandingTag from "../StandingTag";
```

Edit 2 of 5 — find:

```tsx
  const [statementLinesPageSize, setStatementLinesPageSize] = useState<number>(
    STATEMENT_LINES_DEFAULT_PAGE_SIZE,
  );

  const load = useCallback(async () => {
    setLoading(true);
```

replace with:

```tsx
  const [statementLinesPageSize, setStatementLinesPageSize] = useState<number>(
    STATEMENT_LINES_DEFAULT_PAGE_SIZE,
  );
  // The plan, with the lines it was worked out for.
  const [addPlan, setAddPlan] = useState<{ key: string; plan: AddMissingPlan } | null>(null);
  const [adding, setAdding] = useState(false);
  // Asks for the plan again when an add was refused because it changed.
  const [planAsked, setPlanAsked] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
```

Edit 3 of 5 — find:

```tsx
  const money = (m: number) => formatMoney(m, baseCurrency, baseDecimals);
  const completed = detail?.status === "completed";
  const working = canWrite && !completed;
  const statementClosing = statement?.closingMinor ?? null;
  const closing = detail ? closingAdvice(statementClosing, detail.statementEndingMinor, money) : null;
  const opening = statement && detail ? openingAdvice(statement.openingMinor, detail.beginningMinor, money) : null;
```

replace with:

```tsx
  const money = (m: number) => formatMoney(m, baseCurrency, baseDecimals);
  const completed = detail?.status === "completed";
  const working = canWrite && !completed;

  // What "Add all" would add is worked out on the server, and only when the
  // lines the books do not have change — ticking a line does not change them.
  const missingKey = useMemo(
    () =>
      statement && standings
        ? statement.lines.filter((_, i) => standings.standings[i]?.kind === "missing").map((line) => line.lineNo).join(",")
        : "",
    [statement, standings],
  );
  useEffect(() => {
    if (!missingKey || !working) return;
    let live = true;
    const key = missingKey;
    void addMissingPlanAction(reconciliationId).then((res) => {
      if (!live) return;
      if (res.ok && res.data) {
        setAddPlan({ key, plan: res.data });
      } else {
        setAddPlan(null);
        message.error(res.error ?? "Could not work out what to add");
      }
    });
    return () => {
      live = false;
    };
  }, [missingKey, working, reconciliationId, planAsked, message]);
  // Shown only for the lines it was worked out for: while the next plan is on
  // its way, the box waits rather than offering the last one.
  const shownPlan =
    missingKey && working && addPlan && addPlan.key === missingKey && addPlan.plan.missing > 0 ? addPlan.plan : null;

  async function addAll() {
    if (!shownPlan) return;
    setAdding(true);
    const res = await addMissingLinesAction(
      reconciliationId,
      shownPlan.items.map((item) => ({ lineNo: item.lineNo, accountId: item.accountId })),
    );
    setAdding(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "The lines could not be added");
      setAddPlan(null);
      setPlanAsked((n) => n + 1);
      return;
    }
    const { added, uncategorized, pairingError } = res.data;
    if (pairingError) message.warning(addedNotPairedMessage(added, uncategorized, pairingError), 10);
    else message.success(addedMessage(added, uncategorized), 8);
    setAddPlan(null);
    void load();
  }
  const statementClosing = statement?.closingMinor ?? null;
  const closing = detail ? closingAdvice(statementClosing, detail.statementEndingMinor, money) : null;
  const opening = statement && detail ? openingAdvice(statement.openingMinor, detail.beginningMinor, money) : null;
```

Edit 4 of 5 — find:

```tsx
          Reopen
        </Button>
      )}
      <div>
        <Space size="small" style={{ marginBottom: 8 }} wrap>
          <Typography.Text strong>Statement lines</Typography.Text>
```

replace with:

```tsx
          Reopen
        </Button>
      )}
      {shownPlan ? (
        <AddMissingBox plan={shownPlan} bankAccountId={bankAccount.id} money={money} adding={adding} onAdd={() => void addAll()} />
      ) : null}
      <div>
        <Space size="small" style={{ marginBottom: 8 }} wrap>
          <Typography.Text strong>Statement lines</Typography.Text>
```

Edit 5 of 5 — find:

```tsx
              {standings.after > 0 ? <Tag>{standings.after} after the statement date</Tag> : null}
            </Space>
          ) : null}
          {standings && standings.missing > 0 ? (
            <Link href="/banking">
              Code the {standings.missing} line{standings.missing === 1 ? "" : "s"} the books do not have
            </Link>
          ) : null}
        </Space>
        {standings?.flipped ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
```

replace with:

```tsx
              {standings.after > 0 ? <Tag>{standings.after} after the statement date</Tag> : null}
            </Space>
          ) : null}
        </Space>
        {standings?.flipped ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
```

- [ ] **Step 4: Typecheck, lint, the tests near it.**

Run: `npm run typecheck` — Expected: no errors (allow up to 15 minutes; if the only error is in a stale `.next/types/validator.ts`, delete `.next` and run it again).
Run: `npx eslint lib/services/add-missing.ts "app/(app)/banking/reconcile"` — Expected: prints nothing.
Run: `npx vitest run tests/unit/table-adoption.test.ts tests/unit/add-missing.test.ts tests/unit/reconcile-statement-service.test.ts` — Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add lib/services/add-missing.ts "app/(app)/banking/reconcile/statement-actions.ts" "app/(app)/banking/reconcile/[id]/AddMissingBox.tsx" "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx"
printf 'feat(reconcile): add all the lines the bank shows and the books do not\n\nThe box lists each line and the account it would post to; one click posts\nevery one or none, as the person was shown them, then pairs and ticks.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: Recode in Bank Transactions

**Files:**
- Modify: `lib/services/banking.ts` (one edit)
- Modify: `app/(app)/banking/actions.ts` (edits)
- Modify: `app/(app)/banking/CategoriseCell.tsx` (edits)
- Modify: `app/(app)/banking/BankTransactionsTable.tsx` (edits)
- Modify: `app/(app)/banking/BankTransactionsFilters.tsx` (edits)
- Modify: `app/(app)/banking/BankingClient.tsx` (edits)

**Interfaces:**
- Consumes: Task 1's `acc_recode_uncategorized`, `acc_undo_recode`, `acc_bank_recodes`; Task 2's `isHoldingDetail`, `holdingAccountIds`, `needsCoding`.
- Produces: `BankRecodeRow`, `listBankRecodes(sb, bankAccountId)`, `recodeUncategorized(sb, transactionId, accountId)`, `undoRecode(sb, transactionId)`; actions `recodeUncategorizedAction`, `undoRecodeAction`, `getBankRecodesAction`; `CategoriseCell` props `holding?: boolean`, `recode?: BankRecodeRow | null`; `BankTransactionsTable` props `holdingIds`, `recodes`; `BankTransactionsFilters` prop `needsCodingCount` and the Posted-to option `needs_coding`.

- [ ] **Step 1: The service.** In `lib/services/banking.ts` apply this edit:

Edit 1 of 1 — find:

```ts
  return Number(data ?? 0);
}

/** Null means every bank account, for the review queue that spans them all. */
export async function listBankTransactions(
  sb: SupabaseClient,
```

replace with:

```ts
  return Number(data ?? 0);
}

/** A line coded to Uncategorized and moved on: the recode entry and where it put the money. */
export interface BankRecodeRow {
  bank_transaction_id: string;
  original_entry_id: string;
  recode_entry_id: string;
  entry_number: string | null;
  account_id: string;
  account_code: string;
  account_name: string;
}

/** Reads only: which coded lines have been recoded out of Uncategorized, and to what. */
export async function listBankRecodes(sb: SupabaseClient, bankAccountId: string | null): Promise<BankRecodeRow[]> {
  return readAllPages<BankRecodeRow>(
    (from, to) =>
      sb
        .rpc("acc_bank_recodes", { p_bank_account_id: bankAccountId })
        .order("bank_transaction_id")
        .order("recode_entry_id")
        .range(from, to),
    (message) => new BankingError(message),
  );
}

/**
 * Move a line from Uncategorized to the account it belongs in. The line's own
 * entry stays as it is; a second entry, the same day, moves the amount — so a
 * month already reconciled is untouched.
 */
export async function recodeUncategorized(
  sb: SupabaseClient,
  transactionId: string,
  accountId: string,
): Promise<{ entry_number: string | null; account_code: string; account_name: string }> {
  const { data, error } = await sb.rpc("acc_recode_uncategorized", {
    p_bank_transaction_id: transactionId,
    p_account_id: accountId,
  });
  if (error) throw new BankingError(error.message);
  return (Array.isArray(data) ? data[0] : data) as { entry_number: string | null; account_code: string; account_name: string };
}

/** Take a recode back: its entry is voided, and the line is in Uncategorized again. */
export async function undoRecode(sb: SupabaseClient, transactionId: string): Promise<{ entry_number: string | null }> {
  const { data, error } = await sb.rpc("acc_undo_recode", { p_bank_transaction_id: transactionId });
  if (error) throw new BankingError(error.message);
  return (Array.isArray(data) ? data[0] : data) as { entry_number: string | null };
}

/** Null means every bank account, for the review queue that spans them all. */
export async function listBankTransactions(
  sb: SupabaseClient,
```

- [ ] **Step 2: The actions.** In `app/(app)/banking/actions.ts` apply these edits:

Edit 1 of 2 — find:

```ts
  uncategoriseBankTransaction,
  listBankTransactionPostings,
  type BankPostingRow,
  listBankStatementImports,
  undoBankStatementImport,
  deleteBankTransactionWithVoid,
```

replace with:

```ts
  uncategoriseBankTransaction,
  listBankTransactionPostings,
  type BankPostingRow,
  listBankRecodes,
  recodeUncategorized,
  undoRecode,
  type BankRecodeRow,
  listBankStatementImports,
  undoBankStatementImport,
  deleteBankTransactionWithVoid,
```

Edit 2 of 2 — find:

```ts
  }
}

/** Reads only: what each matched line on this account was posted to. */
export async function getBankPostingsAction(
  bankAccountId: string | null,
```

replace with:

```ts
  }
}

/**
 * Move a line from Uncategorized to the account it belongs in, by a second
 * entry the same day; the line's own entry, and any month reconciled with it,
 * stay as they are.
 */
export async function recodeUncategorizedAction(
  transactionId: string,
  accountId: string,
): Promise<ActionResult<{ entry_number: string | null; account_code: string; account_name: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const recoded = await recodeUncategorized(sb, transactionId, accountId);
    revalidatePath("/banking");
    revalidatePath("/reports");
    return { ok: true, data: recoded };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Take a recode back: its entry is voided and the line is in Uncategorized again. */
export async function undoRecodeAction(transactionId: string): Promise<ActionResult<{ entry_number: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const undone = await undoRecode(sb, transactionId);
    revalidatePath("/banking");
    revalidatePath("/reports");
    return { ok: true, data: undone };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Reads only: which coded lines were recoded out of Uncategorized, and to what. */
export async function getBankRecodesAction(bankAccountId: string | null): Promise<ActionResult<BankRecodeRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listBankRecodes(sb, bankAccountId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Reads only: what each matched line on this account was posted to. */
export async function getBankPostingsAction(
  bankAccountId: string | null,
```

- [ ] **Step 3: The Category cell.** In `app/(app)/banking/CategoriseCell.tsx` apply these edits (the account search becomes one `accountSelect` used for posting and for recoding):

Edit 1 of 9 — find:

```tsx
"use client";
import { useMemo, useState } from "react";
import { App, Button, Select, Space, Tooltip, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { ACCOUNT_TYPE_LABEL, normalBalanceOf, type AccountType } from "@/lib/domain/accounts";
import { searchAccounts } from "@/lib/domain/account-search";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import { formatMoney } from "@/lib/format";
import type { BankPostingRow } from "@/lib/services/banking";
import LoanSplitModal from "./LoanSplitModal";
import { categoriseBankTransactionAction, postLoanPaymentAction, uncategoriseBankTransactionAction } from "./actions";

export interface CategoriseCellProps {
  transactionId: string;
```

replace with:

```tsx
"use client";
import { useMemo, useState } from "react";
import { App, Button, Select, Space, Tag, Tooltip, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { ACCOUNT_TYPE_LABEL, normalBalanceOf, type AccountType } from "@/lib/domain/accounts";
import { searchAccounts } from "@/lib/domain/account-search";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import { isHoldingDetail } from "@/lib/domain/uncategorized";
import { formatMoney } from "@/lib/format";
import type { BankPostingRow, BankRecodeRow } from "@/lib/services/banking";
import LoanSplitModal from "./LoanSplitModal";
import {
  categoriseBankTransactionAction,
  postLoanPaymentAction,
  recodeUncategorizedAction,
  uncategoriseBankTransactionAction,
  undoRecodeAction,
} from "./actions";

export interface CategoriseCellProps {
  transactionId: string;
```

Edit 2 of 9 — find:

```tsx
  loan?: LoanSuggestionView | null;
  /** Opens the rule form, filled from this line. */
  onCreateRule?: () => void;
}

/**
```

replace with:

```tsx
  loan?: LoanSuggestionView | null;
  /** Opens the rule form, filled from this line. */
  onCreateRule?: () => void;
  /** The line is posted to an Uncategorized account (migration 0134). */
  holding?: boolean;
  /** Where a recode moved this line out of Uncategorized, when it has been. */
  recode?: BankRecodeRow | null;
}

/**
```

Edit 3 of 9 — find:

```tsx
  suggestion = null,
  loan = null,
  onCreateRule,
}: CategoriseCellProps) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [splitting, setSplitting] = useState(false);

  /**
   * Ranked here rather than by the dropdown, so the order is ours: an exact
```

replace with:

```tsx
  suggestion = null,
  loan = null,
  onCreateRule,
  holding = false,
  recode = null,
}: CategoriseCellProps) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [splitting, setSplitting] = useState(false);
  const [recoding, setRecoding] = useState(false);

  /**
   * Ranked here rather than by the dropdown, so the order is ours: an exact
```

Edit 4 of 9 — find:

```tsx
      })),
    [accounts, query],
  );

  async function post(accountId: string) {
    setBusy(true);
```

replace with:

```tsx
      })),
    [accounts, query],
  );
  // A recode moves money out of Uncategorized, so it never goes back into one,
  // and a bank account is not a category (acc_recode_uncategorized refuses both).
  const recodeOptions = useMemo(() => {
    const holdingIds = new Set(accounts.filter((a) => isHoldingDetail(a.detail_type)).map((a) => a.id));
    return options.filter((option) => !holdingIds.has(option.value) && option.type !== "bank");
  }, [accounts, options]);

  async function recodeTo(accountId: string) {
    setBusy(true);
    const res = await recodeUncategorizedAction(transactionId, accountId);
    setBusy(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Could not recode this line");
      return;
    }
    message.success(
      `Recoded to ${res.data.account_code} — ${res.data.account_name}` + (res.data.entry_number ? ` (${res.data.entry_number})` : ""),
    );
    setRecoding(false);
    onChanged();
  }

  async function takeRecodeBack() {
    setBusy(true);
    const res = await undoRecodeAction(transactionId);
    setBusy(false);
    if (!res.ok) {
      message.error(res.error ?? "Could not take the recode back");
      return;
    }
    message.success("Recode taken back. The line is in Uncategorized again.");
    onChanged();
  }

  async function post(accountId: string) {
    setBusy(true);
```

Edit 5 of 9 — find:

```tsx
  const linkStyle = { padding: 0, height: "auto", fontSize: 12 } as const;
  const small = { fontSize: 12 } as const;

  /**
   * What a rule or the company's own history says this line is. One thing per
   * line, because the column is 150px: the account first, cut to the column
```

replace with:

```tsx
  const linkStyle = { padding: 0, height: "auto", fontSize: 12 } as const;
  const small = { fontSize: 12 } as const;

  /** The account search, for posting a waiting line and for recoding one out of Uncategorized. */
  const accountSelect = (list: typeof options, placeholder: string, onPick: (accountId: string) => void) => (
    <Select
      showSearch
      // Fills its column rather than declaring a minimum wider than one. A
      // 240px minimum inside a 150px column does not widen the column — it
      // spills over the Match column beside it, which is the fault a reader
      // screenshotted on the triage screen in its other form.
      style={{ width: "100%" }}
      // The dropdown is free to be wider than the cell, and needs to be: an
      // account reads "5000 — Cost of Goods Sold".
      popupMatchSelectWidth={320}
      placeholder={placeholder}
      loading={busy}
      disabled={busy}
      // The list is already filtered and ranked; antd must not filter again.
      filterOption={false}
      searchValue={query}
      onSearch={setQuery}
      options={list}
      // Which report the money will land in, and which side of the books it
      // sits on — the reader asked for exactly this: "if it is debit, if it
      // is credit, anything".
      optionRender={(option) => (
        <Space direction="vertical" size={0}>
          <span>{option.data.label}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {ACCOUNT_TYPE_LABEL[option.data.type as AccountType]} ·{" "}
            {normalBalanceOf(option.data.type as AccountType) === "debit" ? "Debit" : "Credit"}
            {option.data.via ? ` · matched on “${option.data.via}”` : ""}
          </Typography.Text>
        </Space>
      )}
      onChange={onPick}
    />
  );

  /**
   * What a rule or the company's own history says this line is. One thing per
   * line, because the column is 150px: the account first, cut to the column
```

Edit 6 of 9 — find:

```tsx
  ) : null;

  if (posting) {
    const main = `${posting.account_code} — ${posting.account_name}`;
    const others = posting.others ?? [];
    const everyAccount = [main, ...others].join("; ");
    return (
      <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
        {/* Cut to the column, with the whole account name on hover: an account
```

replace with:

```tsx
  ) : null;

  if (posting) {
    // A recoded line shows where its money went; the entry that put it in
    // Uncategorized stays as it was, under the recode.
    const main = recode ? `${recode.account_code} — ${recode.account_name}` : `${posting.account_code} — ${posting.account_name}`;
    const others = recode ? [] : (posting.others ?? []);
    const everyAccount = [main, ...others].join("; ");
    const mayChange = canWrite && posting.own_entry;
    return (
      <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
        {/* Cut to the column, with the whole account name on hover: an account
```

Edit 7 of 9 — find:

```tsx
            </Typography.Text>
          </Tooltip>
        ) : null}
        <Space size={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {posting.entry_number ?? "posted"}
          </Typography.Text>
          {canWrite && posting.own_entry ? (
            <Button
              type="link"
              size="small"
```

replace with:

```tsx
            </Typography.Text>
          </Tooltip>
        ) : null}
        {recode ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            recoded from Uncategorized{recode.entry_number ? ` · ${recode.entry_number}` : ""}
          </Typography.Text>
        ) : holding ? (
          <div>
            <Tag color="gold">needs coding</Tag>
          </div>
        ) : null}
        <Space size={6} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {posting.entry_number ?? "posted"}
          </Typography.Text>
          {mayChange && holding && !recode ? (
            <Button type="link" size="small" style={linkStyle} disabled={busy} onClick={() => setRecoding((open) => !open)}>
              Recode
            </Button>
          ) : null}
          {mayChange && recode ? (
            <Button type="link" size="small" style={linkStyle} loading={busy} onClick={() => void takeRecodeBack()}>
              Undo recode
            </Button>
          ) : null}
          {mayChange ? (
            <Button
              type="link"
              size="small"
```

Edit 8 of 9 — find:

```tsx
            </Button>
          ) : null}
        </Space>
        {canWrite ? createRule : null}
      </Space>
    );
```

replace with:

```tsx
            </Button>
          ) : null}
        </Space>
        {recoding && !recode ? (
          <Tooltip title="Choosing an account posts a second entry that moves this line out of Uncategorized">
            {accountSelect(recodeOptions, "Recode to…", (accountId) => void recodeTo(accountId))}
          </Tooltip>
        ) : null}
        {canWrite ? createRule : null}
      </Space>
    );
```

Edit 9 of 9 — find:

```tsx
  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      <Tooltip title="Choosing an account posts this line to the ledger">
        <Select
          showSearch
          // Fills its column rather than declaring a minimum wider than one. A
          // 240px minimum inside a 150px column does not widen the column — it
          // spills over the Match column beside it, which is the fault a reader
          // screenshotted on the triage screen in its other form.
          style={{ width: "100%" }}
          // The dropdown is free to be wider than the cell, and needs to be: an
          // account reads "5000 — Cost of Goods Sold".
          popupMatchSelectWidth={320}
          placeholder="Search accounts…"
          loading={busy}
          disabled={busy}
          // The list is already filtered and ranked; antd must not filter again.
          filterOption={false}
          searchValue={query}
          onSearch={setQuery}
          options={options}
          // Which report the money will land in, and which side of the books it
          // sits on — the reader asked for exactly this: "if it is debit, if it
          // is credit, anything".
          optionRender={(option) => (
            <Space direction="vertical" size={0}>
              <span>{option.data.label}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {ACCOUNT_TYPE_LABEL[option.data.type as AccountType]} ·{" "}
                {normalBalanceOf(option.data.type as AccountType) === "debit" ? "Debit" : "Credit"}
                {option.data.via ? ` · matched on “${option.data.via}”` : ""}
              </Typography.Text>
            </Space>
          )}
          onChange={(accountId: string) => void post(accountId)}
        />
      </Tooltip>
      {suggested(true)}
      {loanSuggested(true)}
```

replace with:

```tsx
  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      <Tooltip title="Choosing an account posts this line to the ledger">
        {accountSelect(options, "Search accounts…", (accountId) => void post(accountId))}
      </Tooltip>
      {suggested(true)}
      {loanSuggested(true)}
```

- [ ] **Step 4: The table, the filters and the screen.** In `app/(app)/banking/BankTransactionsTable.tsx`:

Edit 1 of 4 — find:

```tsx
import MatchCell from "./MatchCell";
import DeleteRowAction from "./DeleteRowAction";
import type { AccountRow } from "@/lib/db/types";
import type { BankPostingRow } from "@/lib/services/banking";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { TOKENS } from "@/lib/design/tokens";
import { bankTransactionsPagination, BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE } from "./bank-transactions-pagination";
```

replace with:

```tsx
import MatchCell from "./MatchCell";
import DeleteRowAction from "./DeleteRowAction";
import type { AccountRow } from "@/lib/db/types";
import type { BankPostingRow, BankRecodeRow } from "@/lib/services/banking";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { TOKENS } from "@/lib/design/tokens";
import { bankTransactionsPagination, BANK_TRANSACTIONS_DEFAULT_PAGE_SIZE } from "./bank-transactions-pagination";
```

Edit 2 of 4 — find:

```tsx
  postableAccounts: AccountRow[];
  /** What each matched line was posted to, keyed by transaction; `others` names the rest of a split entry. */
  postings: Map<string, BankPostingRow & { others?: string[] }>;
  onCategorised: () => void;
  /** The coding suggestion for each waiting line, keyed by transaction. */
  codingSuggestions: Map<string, CodingSuggestionView>;
```

replace with:

```tsx
  postableAccounts: AccountRow[];
  /** What each matched line was posted to, keyed by transaction; `others` names the rest of a split entry. */
  postings: Map<string, BankPostingRow & { others?: string[] }>;
  /** The chart's Uncategorized accounts, for telling a line that needs coding. */
  holdingIds: ReadonlySet<string>;
  /** Where each recoded line's money went, keyed by transaction. */
  recodes: Map<string, BankRecodeRow>;
  onCategorised: () => void;
  /** The coding suggestion for each waiting line, keyed by transaction. */
  codingSuggestions: Map<string, CodingSuggestionView>;
```

Edit 3 of 4 — find:

```tsx
  formatRowMoney,
  postableAccounts,
  postings,
  onCategorised,
  codingSuggestions,
  loanSuggestions,
```

replace with:

```tsx
  formatRowMoney,
  postableAccounts,
  postings,
  holdingIds,
  recodes,
  onCategorised,
  codingSuggestions,
  loanSuggestions,
```

Edit 4 of 4 — find:

```tsx
            onChanged={onCategorised}
            suggestion={suggestion}
            loan={loanSuggestions.get(row.transaction.id) ?? null}
            onCreateRule={() => onCreateRule(row, posting?.account_id ?? suggestion?.accountId ?? null)}
          />
        );
      },
```

replace with:

```tsx
            onChanged={onCategorised}
            suggestion={suggestion}
            loan={loanSuggestions.get(row.transaction.id) ?? null}
            // A rule is filled with where the money belongs: the recode's account,
            // never Uncategorized, which a rule may not target.
            onCreateRule={() =>
              onCreateRule(
                row,
                recodes.get(row.transaction.id)?.account_id ??
                  (posting && !holdingIds.has(posting.account_id) ? posting.account_id : null) ??
                  suggestion?.accountId ??
                  null,
              )
            }
            holding={Boolean(posting && holdingIds.has(posting.account_id))}
            recode={recodes.get(row.transaction.id) ?? null}
          />
        );
      },
```

In `app/(app)/banking/BankTransactionsFilters.tsx`:

Edit 1 of 3 — find:

```tsx
  postedToFilter: string;
  onPostedTo: (value: string) => void;
  postings: Map<string, BankPostingRow>;

  keyword: string;
  onKeyword: (value: string) => void;
```

replace with:

```tsx
  postedToFilter: string;
  onPostedTo: (value: string) => void;
  postings: Map<string, BankPostingRow>;
  /** Lines in Uncategorized not recoded yet. */
  needsCodingCount: number;

  keyword: string;
  onKeyword: (value: string) => void;
```

Edit 2 of 3 — find:

```tsx
  postedToFilter,
  onPostedTo,
  postings,
  keyword,
  onKeyword,
  suggestionRows,
```

replace with:

```tsx
  postedToFilter,
  onPostedTo,
  postings,
  needsCodingCount,
  keyword,
  onKeyword,
  suggestionRows,
```

Edit 3 of 3 — find:

```tsx
        options={[
          { value: "all", label: "All accounts posted to" },
          { value: "none", label: "Not categorised yet" },
          // Only accounts these lines actually use: the whole chart here
          // would be a list of things that filter to nothing.
          ...[...new Map([...postings.values()].map((p) => [p.account_id, p])).values()]
```

replace with:

```tsx
        options={[
          { value: "all", label: "All accounts posted to" },
          { value: "none", label: "Not categorised yet" },
          // Lines added to Uncategorized and not recoded yet: the review queue for them.
          { value: "needs_coding", label: `Needs coding${needsCodingCount ? ` (${needsCodingCount})` : ""}` },
          // Only accounts these lines actually use: the whole chart here
          // would be a list of things that filter to nothing.
          ...[...new Map([...postings.values()].map((p) => [p.account_id, p])).values()]
```

In `app/(app)/banking/BankingClient.tsx`:

Edit 1 of 10 — find:

```tsx
  BankTxnStatus,
  CurrencyRow,
} from "@/lib/db/types";
import type { BankPostingRow } from "@/lib/services/banking";
import type {
  BankAccountWithGl,
  BankConnectionView,
```

replace with:

```tsx
  BankTxnStatus,
  CurrencyRow,
} from "@/lib/db/types";
import type { BankPostingRow, BankRecodeRow } from "@/lib/services/banking";
import type {
  BankAccountWithGl,
  BankConnectionView,
```

Edit 2 of 10 — find:

```tsx
});
import { buildBankReviewRows, type BankReviewRow } from "@/lib/domain/banking-import";
import { postingsByLine } from "@/lib/domain/bank-postings";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import {
  filterBankTransactions,
```

replace with:

```tsx
});
import { buildBankReviewRows, type BankReviewRow } from "@/lib/domain/banking-import";
import { postingsByLine } from "@/lib/domain/bank-postings";
import { holdingAccountIds, needsCoding } from "@/lib/domain/uncategorized";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import {
  filterBankTransactions,
```

Edit 3 of 10 — find:

```tsx
  generateSuggestionsAction,
  getSuggestionsAction,
  getBankPostingsAction,
  getCodingSuggestionsAction,
  getLoanSuggestionsAction,
  getTransactionsAction,
```

replace with:

```tsx
  generateSuggestionsAction,
  getSuggestionsAction,
  getBankPostingsAction,
  getBankRecodesAction,
  getCodingSuggestionsAction,
  getLoanSuggestionsAction,
  getTransactionsAction,
```

Edit 4 of 10 — find:

```tsx
  // it — fifteen lines read "Uncategorized" beside "Matched".
  const [postings, setPostings] = useState<Map<string, BankPostingRow & { others: string[] }>>(new Map());
  const [postedToFilter, setPostedToFilter] = useState<string>("all");
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
```

replace with:

```tsx
  // it — fifteen lines read "Uncategorized" beside "Matched".
  const [postings, setPostings] = useState<Map<string, BankPostingRow & { others: string[] }>>(new Map());
  const [postedToFilter, setPostedToFilter] = useState<string>("all");
  // Lines moved out of Uncategorized by a recode, and where their money went.
  const [recodes, setRecodes] = useState<Map<string, BankRecodeRow>>(new Map());
  const [suggestions, setSuggestions] = useState<SuggestionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
```

Edit 5 of 10 — find:

```tsx
      ),
    [accounts],
  );
  // A rule may code only to an account a suggestion could name.
  const ruleAccounts = useMemo(
    () => postableAccounts.filter((account) => codableAccount(codingAccountOf(account))),
```

replace with:

```tsx
      ),
    [accounts],
  );
  // The chart's Uncategorized accounts: a line posted to one needs coding.
  const holdingIds = useMemo(() => holdingAccountIds(accounts), [accounts]);
  // A rule may code only to an account a suggestion could name.
  const ruleAccounts = useMemo(
    () => postableAccounts.filter((account) => codableAccount(codingAccountOf(account))),
```

Edit 6 of 10 — find:

```tsx
    void getLoanSuggestionsAction(accountFilter).then((res) => {
      if (res.ok && res.data) setLoans(new Map(res.data.map((view) => [view.transactionId, view])));
    });
    const [transactions, matches, posted] = await Promise.all([
      getTransactionsAction(accountFilter),
      getSuggestionsAction(accountFilter),
      getBankPostingsAction(accountFilter),
    ]);
    setLoading(false);
    if (transactions.ok && transactions.data) setTxns(transactions.data);
```

replace with:

```tsx
    void getLoanSuggestionsAction(accountFilter).then((res) => {
      if (res.ok && res.data) setLoans(new Map(res.data.map((view) => [view.transactionId, view])));
    });
    const [transactions, matches, posted, recoded] = await Promise.all([
      getTransactionsAction(accountFilter),
      getSuggestionsAction(accountFilter),
      getBankPostingsAction(accountFilter),
      getBankRecodesAction(accountFilter),
    ]);
    setLoading(false);
    if (transactions.ok && transactions.data) setTxns(transactions.data);
```

Edit 7 of 10 — find:

```tsx
    if (posted.ok && posted.data) {
      setPostings(postingsByLine(posted.data));
    }
  }, [selectedId]);

  useEffect(() => {
    // Intentional synchronization after the selected account changes.
```

replace with:

```tsx
    if (posted.ok && posted.data) {
      setPostings(postingsByLine(posted.data));
    }
    if (recoded.ok && recoded.data) {
      setRecodes(new Map(recoded.data.map((row) => [row.bank_transaction_id, row])));
    } else {
      message.warning("Recodes could not be read, so recoded lines may show as needing coding. Reload the page.");
    }
  }, [selectedId, message]);

  useEffect(() => {
    // Intentional synchronization after the selected account changes.
```

Edit 8 of 10 — find:

```tsx
    // "Not categorised yet" means still awaiting review, not merely "no account
    // to show" — a line settled against an invoice is posted and has neither.
    if (postedToFilter === "none") return transaction.status === "unmatched";
    return postings.get(transaction.id)?.account_id === postedToFilter;
  });

  // RQ-02: keyword (Description, Reference) and amount, composed with the
  // account/status/posted-to filters above rather than replacing them — all
```

replace with:

```tsx
    // "Not categorised yet" means still awaiting review, not merely "no account
    // to show" — a line settled against an invoice is posted and has neither.
    if (postedToFilter === "none") return transaction.status === "unmatched";
    if (postedToFilter === "needs_coding") {
      return needsCoding(postings.get(transaction.id)?.account_id, holdingIds, recodes.has(transaction.id));
    }
    return postings.get(transaction.id)?.account_id === postedToFilter;
  });
  // Lines added to Uncategorized and not recoded yet — the review queue for them.
  const needsCodingCount = txns.filter((transaction) =>
    needsCoding(postings.get(transaction.id)?.account_id, holdingIds, recodes.has(transaction.id)),
  ).length;

  // RQ-02: keyword (Description, Reference) and amount, composed with the
  // account/status/posted-to filters above rather than replacing them — all
```

Edit 9 of 10 — find:

```tsx
        postedToFilter={postedToFilter}
        onPostedTo={setPostedToFilter}
        postings={postings}
        keyword={keyword}
        onKeyword={setKeyword}
        suggestionRows={categorized}
```

replace with:

```tsx
        postedToFilter={postedToFilter}
        onPostedTo={setPostedToFilter}
        postings={postings}
        needsCodingCount={needsCodingCount}
        keyword={keyword}
        onKeyword={setKeyword}
        suggestionRows={categorized}
```

Edit 10 of 10 — find:

```tsx
        formatRowMoney={rowMoney}
        postableAccounts={postableAccounts}
        postings={postings}
        onCategorised={reload}
        codingSuggestions={coding}
        loanSuggestions={loans}
```

replace with:

```tsx
        formatRowMoney={rowMoney}
        postableAccounts={postableAccounts}
        postings={postings}
        holdingIds={holdingIds}
        recodes={recodes}
        onCategorised={reload}
        codingSuggestions={coding}
        loanSuggestions={loans}
```

- [ ] **Step 5: Typecheck, lint, the tests near it.**

Run: `npm run typecheck` — Expected: no errors.
Run: `npx eslint lib/services/banking.ts "app/(app)/banking"` — Expected: prints nothing.
Run: `npx vitest run tests/unit/bank-categories-ui-contract.test.ts tests/unit/table-adoption.test.ts tests/unit/add-missing.test.ts` — Expected: all pass.

- [ ] **Step 6: Commit.**

```bash
git add lib/services/banking.ts "app/(app)/banking/actions.ts" "app/(app)/banking/CategoriseCell.tsx" "app/(app)/banking/BankTransactionsTable.tsx" "app/(app)/banking/BankTransactionsFilters.tsx" "app/(app)/banking/BankingClient.tsx"
printf 'feat(banking): recode a line out of Uncategorized, and find the lines that need it\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: Changelog 1.82, the guide, the whole suite

**Files:**
- Modify: `lib/domain/changelog.ts` (a new first entry of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (the reconciliation steps)

- [ ] **Step 1: The release.** In `lib/domain/changelog.ts` apply this edit:

Edit 1 of 1 — find:

```ts

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.81",
    date: "2026-10-05",
```

replace with:

```ts

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.82",
    date: "2026-10-06",
    headline: "What the bank shows and the books do not is added from the reconciliation, in one click.",
    changes: [
      {
        kind: "added",
        title: "Add all to the books",
        detail:
          "In a reconciliation, a box above the statement lines lists each line the bank shows and the books do not, with the account it would post to: the card, related company, rule or history that places it, or Uncategorized Income or Uncategorized Expense when nothing does. Add all posts every one, dated as the bank has it — or, if any one cannot be posted, none — then pairs and ticks them. A line dated in a month already reconciled is not added from here. Completing the reconciliation is still your click.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "Recode a line from Uncategorized",
        detail:
          "In Bank Transactions, Needs coding in the posted-to filter lists the lines still in Uncategorized. Recode moves a line to the account it belongs in with a second entry on the same day, so the line's own entry and any month it was reconciled in stay exactly as they were; Undo recode takes it back. Coding history learns from it: the next line like it is suggested to the account it was recoded to.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Uncategorized Income and Uncategorized Expense in every chart",
        detail:
          "Every company's chart of accounts has the two holding accounts: the ones it already had under those names, or new ones at 4999 and 6999 — or the nearest free code below.",
        route: "/accounts",
      },
      {
        kind: "changed",
        title: "Change refuses a line in a signed-off month",
        detail:
          "Taking back a coded line in Bank Transactions now refuses one ticked in a completed reconciliation, because voiding it would change a month somebody signed off without a word. Reopen that reconciliation first — or, for a line in Uncategorized, recode it.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.81",
    date: "2026-10-05",
```

- [ ] **Step 2: The guide.** In `lib/domain/system-guide.ts` apply this edit:

Edit 1 of 1 — find:

```ts
          "agree with the first statement's opening balance.",
      },
      {
        action: "Code what the statement has and the books do not",
        control: "Match again",
        route: "/banking/reconcile",
        note:
          "Lines marked Not in the books are coded in Bank Transactions like any bank line. Back in the " +
          "reconciliation, Match again pairs them and ticks them; no tick is ever removed.",
      },
      {
        action: "Reopen a completed reconciliation",
```

replace with:

```ts
          "agree with the first statement's opening balance.",
      },
      {
        action: "Add what the statement has and the books do not",
        control: "Add all to the books",
        route: "/banking/reconcile",
        note:
          "The box above the statement lines shows each line the books do not have and the account it would " +
          "post to — by card, related company, rule or history, or else Uncategorized Income or Expense. Add all " +
          "posts every one, dated as the bank has it, or none, then pairs and ticks them; Complete stays yours. " +
          "Or code them one by one in Bank Transactions and click Match again; no tick is ever removed.",
      },
      {
        action: "Recode a line from Uncategorized",
        control: "Recode",
        route: "/banking",
        note:
          "In Bank Transactions, Needs coding in the posted-to filter lists the lines still in Uncategorized. Recode posts a " +
          "second entry, the same day, that moves the amount to the account you choose; the line's own entry, and " +
          "any reconciliation it is in, stay as they were. Undo recode takes it back, in a signed-off month too. A line in a signed-off month " +
          "cannot be taken back with Change — recode it instead.",
      },
      {
        action: "Reopen a completed reconciliation",
```

- [ ] **Step 3: The whole suite and the build.**

Run: `npm run typecheck`, `npm run lint`, then `npm test`
Expected: no type errors; lint 0 errors (the 14 old warnings stay); every test file passes — the changelog and guide tests included (`APP_VERSION` is now 1.82). `tests/unit/quality-query-timing.test.ts` can fail when the machine is busy; if it alone fails, run it on its own and report both results.
Run: `npm run build` — Expected: `Compiled successfully`, exit code 0.
Run: `npm run quality:bundle`, then `npm run quality:budget` — Expected: every ceiling in `tests/quality/budgets.json` holds, exit code 0.

- [ ] **Step 4: Commit.**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
printf 'docs(changelog): 1.82 add the lines the books do not have; recode from Uncategorized\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Live (controller)

No new code. Every step that writes to the live database waits for the user.

- [ ] **Step 1:** Ask the user to approve applying 0134 to every company. Only then run `node --env-file=.env.local scripts/migrate.mjs`, run `scripts/verify-add-missing-lines.mjs` again (rolled back) and `npm run verify:company-provisioning`.
- [ ] **Step 2:** On the sample company PC-Test only: a new bank account never reconciled; posted entries for a month; an invented statement PDF of that month carrying a service fee and one unknown line the books do not have; a bank rule "SERVICE FEE → Bank Charges".
- [ ] **Step 3:** In a real browser (`next start` started detached with its working directory set): start the month from the statement → the box lists both lines, the fee to Bank Charges (Rule) and the unknown line to Uncategorized Expense (needs coding) → **Add all 2 to the books** → the message, the difference zero → Complete → Bank Transactions → Posted to › Needs coding (1) → Recode to an expense account → the reconciliation's figures unchanged → Change on that line refused, pointing to Undo recode → Undo recode → Recode again.
- [ ] **Step 4:** Screenshots of each, light and dark, scrolled to the top before each full-page shot; an approval page beside them. Nothing is pushed until the user approves.
- [ ] **Step 5:** Ask the user whether what the check recorded on PC-Test stays as the sample company's history.
