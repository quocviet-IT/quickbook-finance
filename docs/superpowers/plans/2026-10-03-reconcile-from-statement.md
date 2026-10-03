# Reconcile a statement from its file (1.79) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bank reconciliation can be started from a PDF statement — its date and ending balance from the file — and the statement's lines, kept with the reconciliation, are paired with the books by the client's prototype's rule and the pairs ticked; the first reconciliation of an account can be brought forward on the statement's opening balance.

**Architecture:** Migration 0132 keeps a statement with its reconciliation (file name, printed opening and closing balances, lines) and adds the functions that start one from a statement, replace its statement, take its closing balance, tick many lines at once, and bring an account's first reconciliation forward. A pure port of the prototype's `recPair`/`recMatch` (`src/p24.html`) pairs statement lines with book lines in cents; the service pairs and ticks; the screens read the PDF with 1.78's reader. Nothing posts and nothing completes without a person's click.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, Ant Design 6, TypeScript, Zod 4, Supabase/Postgres (one schema per company), Vitest, Playwright (parity test), `pg` (verify script).

**Spec:** `docs/superpowers/specs/2026-10-03-reconcile-from-statement-design.md`

## Global Constraints

- US English UI. Money in integer minor units. Nothing posts and nothing completes without a person's click.
- No real statement, bank name, account number or figure in the repository: fixtures are invented. The prototype stays outside the repository.
- Migration 0132 is **not applied to the live database by any task**. The verify script applies it inside a transaction that is always rolled back. It goes live only after the user approves, in Task 8, by the controller.
- The pairing is the prototype's: three passes in this order — same date and amount; same amount and the statement's cheque number (kept to letters, digits and hyphens) equal to the book line's reference; same amount within 5 days — each statement line and each book line used once; read as written and with signs turned round, the reading that pairs more kept (as written on a tie); statement lines after the statement date left out and counted; a pair is only ever ticked, never unticked.
- Run everything from `ctyhp-accounting/`. Never pipe test output through `head`/`tail`; read the pass/fail lines.
- Write any file holding a backslash (regular expressions) with the Write or Edit tool — never a bash heredoc or `python -c`, which eat backslashes.
- A `"use server"` file exports only async functions and types.
- The reconciliation screens read the columns 0132 adds, so 0132 goes live before this code is deployed (Task 8 applies it, with the user's approval, before anything is pushed).
- Stage files by name; never `git add -A`. Write commit messages with `printf` in Git Bash to `../.superpowers/sdd/commit-msg.txt` (never PowerShell — it writes a BOM), check with `od -c ../.superpowers/sdd/commit-msg.txt | head -1` that the first bytes are not `357 273 277`, then `git commit -F ../.superpowers/sdd/commit-msg.txt`. No Co-Authored-By trailer.

Every file below was run before this plan was written, at each task's boundary: the migration through the verify script on all six companies (210 passed, 0 failed, rolled back); the pairing against the prototype's own `recMatch` (5,000 random statements identical in Node, 400 in the prototype's page); `tsc --noEmit` and `eslint` after Task 5 and after Task 7; the whole unit suite (275 files, 2,931 tests) and `next build` after Task 7.

---

### Task 1: Migration 0132 and its proof

**Files:**
- Create: `scripts/verify-reconcile-from-statement.mjs`
- Create: `supabase/migrations/0132_reconcile_from_statement.sql`

**Interfaces:**
- Consumes: `acc_create_reconciliation`, `acc_set_cleared`, `acc_reconciliation_detail`, `acc_is_staff()`, `acc_current_role()`, `acc_audit_log` (0026 and earlier); `planCompanySchema` from `lib/domain/schema-template.ts`; `acc_post_manual_journal(date, text, text, text, jsonb)`.
- Produces (database, every company schema):
  - columns on `acc_statement_reconciliation`: `statement_opening_minor bigint`, `statement_closing_minor bigint`, `note text` (≤ 500), `brought_forward boolean not null default false`; the existing `statement_ref` holds the statement's file name (≤ 255).
  - table `acc_reconciliation_statement_line (id, reconciliation_id, line_no, txn_date, description, reference, amount_minor, balance_minor)`.
  - `acc_create_reconciliation_from_statement(p_bank_account_id uuid, p_ending_date date, p_ending_minor bigint, p_file_name text, p_opening_minor bigint, p_lines jsonb) returns uuid`
  - `acc_set_reconciliation_statement(p_reconciliation_id uuid, p_file_name text, p_opening_minor bigint, p_closing_minor bigint, p_lines jsonb) returns integer`
  - `acc_set_statement_ending(p_reconciliation_id uuid, p_ending_minor bigint) returns void`
  - `acc_set_cleared_many(p_reconciliation_id uuid, p_journal_line_ids uuid[], p_cleared boolean) returns integer`
  - `acc_brought_forward_preview(p_bank_account_id uuid, p_through date) returns table (has_reconciliations boolean, book_balance_minor bigint, open_lines integer)`
  - `acc_bring_forward_reconciliation(p_bank_account_id uuid, p_through date, p_opening_minor bigint, p_note text) returns uuid`
  - `acc_reconciliation_lines(uuid)` returns one more column, `reference text`.
  - Each line in `p_lines` is `{ txn_date, description, reference, amount_minor, balance_minor }`.

- [ ] **Step 1: Write the proof first.** Create `scripts/verify-reconcile-from-statement.mjs`:

```js
/**
 * Behavioural verification of migration 0132 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0132 has not been applied it is applied first, inside that transaction,
 * and every account, bank account and entry the checks need is made there too —
 * so nothing is left behind. A viewer is checked by turning the administrator
 * into one inside the same transaction.
 *
 * Run: node --env-file=.env.local scripts/verify-reconcile-from-statement.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0132_reconcile_from_statement.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 6 * 60 * 1000);
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
async function refused(sql, params) {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    await client.query("release savepoint probe");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint probe");
    return error.message;
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);

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
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
        console.log("  (0132 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- the books: a bank account with two August entries and two September ones
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-RB", "Verify reconcile bank", "bank");
      const other = await account("ZZ-VERIFY-RX", "Verify reconcile other", "expense");
      const bank = (await one(
        `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`,
        [gl, base.code],
      )).id;

      await client.query("set local role authenticated");
      await as(admin.id);
      const post = async (date, minor, ref) => {
        const lines =
          minor > 0
            ? [{ account_id: gl, debit_minor: minor, credit_minor: 0 }, { account_id: other, debit_minor: 0, credit_minor: minor }]
            : [{ account_id: other, debit_minor: -minor, credit_minor: 0 }, { account_id: gl, debit_minor: 0, credit_minor: -minor }];
        return (await one(`select acc_post_manual_journal($1, 'Verify reconcile', $2, $3, $4::jsonb) as id`, [
          date, ref, base.code, JSON.stringify(lines),
        ])).id;
      };
      await post("2026-08-15", 100000, null);
      await post("2026-08-20", -25000, null);
      await post("2026-09-05", 50000, null);
      await post("2026-09-12", -12000, "1201");

      // ---- bringing the account forward
      const preview = await one(`select * from acc_brought_forward_preview($1, '2026-08-31')`, [bank]);
      check("preview: no reconciliation yet", preview.has_reconciliations === false);
      check("preview: the book balance through Aug 31 is 750.00", Number(preview.book_balance_minor) === 75000, String(preview.book_balance_minor));
      check("preview: two lines would be signed off", preview.open_lines === 2, String(preview.open_lines));

      const bringForward = `select acc_bring_forward_reconciliation($1, '2026-08-31', $2, 'Brought forward, proved by the opening balance on the statement for Sep 1 – Sep 30, 2026') as id`;
      const wrong = await refused(bringForward, [bank, 80000]);
      check("bringing forward on a different opening balance is refused", /The books hold 750\.00 on 2026-08-31, and the statement opens at 800\.00/.test(wrong ?? ""), wrong ?? "accepted");
      const forward = (await one(bringForward, [bank, 75000])).id;
      const forwarded = await one(`select * from acc_statement_reconciliation where id = $1`, [forward]);
      check("brought forward: completed through Aug 31 at 750.00", forwarded.status === "completed" && Number(forwarded.statement_ending_balance_minor) === 75000 && String(forwarded.statement_ending_date).length > 0);
      check("brought forward: the note is kept and it is marked brought forward", /^Brought forward/.test(forwarded.note ?? "") && forwarded.brought_forward === true);
      const forwardLines = await one(`select count(*)::int as n from acc_reconciliation_line where reconciliation_id = $1`, [forward]);
      check("brought forward: the two August lines are cleared", forwardLines.n === 2, String(forwardLines.n));
      const again = await refused(bringForward, [bank, 75000]);
      check("bringing forward twice is refused", /already has a reconciliation/.test(again ?? ""), again ?? "accepted");
      check("preview now sees a reconciliation", (await one(`select * from acc_brought_forward_preview($1, '2026-08-31')`, [bank])).has_reconciliations === true);

      // ---- a reconciliation started from a statement
      const lines = [
        { txn_date: "2026-09-05", description: "DEPOSIT", reference: null, amount_minor: 50000, balance_minor: 125000 },
        { txn_date: "2026-09-12", description: "Check 1201", reference: "1201", amount_minor: -12000, balance_minor: 113000 },
        { txn_date: "2026-09-25", description: "SERVICE FEE", reference: null, amount_minor: -500, balance_minor: 112500 },
      ];
      const start = `select acc_create_reconciliation_from_statement($1, '2026-09-30', $2, $3, $4, $5::jsonb) as id`;
      const rec = (await one(start, [bank, 112500, "sample-statement.pdf", 75000, JSON.stringify(lines)])).id;
      const session = await one(`select * from acc_statement_reconciliation where id = $1`, [rec]);
      check("from a statement: begins where the brought-forward one ended", Number(session.beginning_balance_minor) === 75000, String(session.beginning_balance_minor));
      check("from a statement: the file, opening and closing are kept, and it is not brought forward",
        session.statement_ref === "sample-statement.pdf" && Number(session.statement_opening_minor) === 75000 && Number(session.statement_closing_minor) === 112500 && session.brought_forward === false);
      const stored = (await client.query(`select * from acc_reconciliation_statement_line where reconciliation_id = $1 order by line_no`, [rec])).rows;
      check("from a statement: its three lines are stored in order", stored.length === 3 && stored.map((l) => l.line_no).join(",") === "0,1,2");
      check("from a statement: a line keeps its cheque number and balance", stored[1].reference === "1201" && Number(stored[1].balance_minor) === 113000);

      const book = (await client.query(`select * from acc_reconciliation_lines($1)`, [rec])).rows;
      check("the reconciliation offers the two September lines", book.length === 2, String(book.length));
      check("a book line carries its reference", book.find((l) => Number(l.signed_minor) === -12000)?.reference === "1201");

      const many = `select acc_set_cleared_many($1, $2::uuid[], true) as n`;
      const ticked = (await one(many, [rec, book.map((l) => l.journal_line_id)])).n;
      check("both lines ticked in one call", ticked === 2, String(ticked));
      const detail = await one(`select * from acc_reconciliation_detail($1)`, [rec]);
      check("out by the fee the books do not have (5.00)", Number(detail.difference_minor) === -500, String(detail.difference_minor));
      const augustLine = (await one(`select journal_line_id from acc_reconciliation_line where reconciliation_id = $1 limit 1`, [forward])).journal_line_id;
      const twice = await refused(many, [rec, [book[0].journal_line_id, augustLine]]);
      check("a line already reconciled is refused, and nothing changes", /already reconciled|after the statement ending date|does not belong/.test(twice ?? ""), twice ?? "accepted");
      const otherLine = (await one(`select l.id from acc_journal_line l where l.account_id = $1 limit 1`, [other])).id;
      const foreign = await refused(many, [rec, [otherLine]]);
      check("a line of another account is refused", /does not belong to this bank account/.test(foreign ?? ""), foreign ?? "accepted");
      const tooMany = await refused(many, [rec, Array.from({ length: 5001 }, () => book[0].journal_line_id)]);
      check("more than 5,000 lines at once is refused", /At most 5,000/.test(tooMany ?? ""), tooMany ?? "accepted");

      const replace = `select acc_set_reconciliation_statement($1, $2, $3, $4, $5::jsonb) as n`;
      const replaced = (await one(replace, [rec, "other.pdf", 75000, 113000, JSON.stringify(lines.slice(0, 2))])).n;
      const afterReplace = await one(`select statement_ref, statement_closing_minor, (select count(*)::int from acc_reconciliation_statement_line where reconciliation_id = $1) as n from acc_statement_reconciliation where id = $1`, [rec]);
      check("replacing the statement keeps only its lines", replaced === 2 && afterReplace.n === 2 && afterReplace.statement_ref === "other.pdf" && Number(afterReplace.statement_closing_minor) === 113000);
      const zero = await refused(replace, [rec, "x.pdf", 0, 0, JSON.stringify([{ txn_date: "2026-09-01", description: "x", amount_minor: 0 }])]);
      check("a line of no amount is refused", /amount_minor/.test(zero ?? ""), zero ?? "accepted");
      const notList = await refused(replace, [rec, "x.pdf", 0, 0, JSON.stringify({ txn_date: "2026-09-01" })]);
      check("lines that are not a list are refused", /must be a list/.test(notList ?? ""), notList ?? "accepted");
      await one(`select acc_set_statement_ending($1, 113000)`, [rec]);
      check("the ending balance can be taken from the statement", Number((await one(`select * from acc_reconciliation_detail($1)`, [rec])).difference_minor) === 0);
      const completedReplace = await refused(replace, [forward, "x.pdf", 0, 0, "[]"]);
      check("a completed reconciliation's statement cannot be replaced", /not in progress/.test(completedReplace ?? ""), completedReplace ?? "accepted");
      const direct = await refused(`insert into acc_reconciliation_statement_line (reconciliation_id, line_no, txn_date, amount_minor) values ($1, 9, '2026-09-01', 1)`, [rec]);
      check("statement lines cannot be written directly", direct !== null, direct ?? "accepted");
      const internal = await refused(`select acc_recon_write_statement($1, '[]'::jsonb)`, [rec]);
      check("the internal writer cannot be called directly", /permission denied/.test(internal ?? ""), internal ?? "accepted");

      for (const fn of ["acc_reconciliation_lines(uuid)", "acc_brought_forward_preview(uuid, date)"]) {
        const grants = await one(
          `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as signed_in`,
          [fn],
        );
        check(`${fn.split("(")[0]} is closed to anon and open to signed-in users`, grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
      }

      // ---- a viewer reads but cannot write; an outsider can do nothing
      await client.query("reset role");
      await client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]);
      await client.query("set local role authenticated");
      await as(admin.id);
      const seen = (await client.query(`select count(*)::int as n from acc_reconciliation_statement_line where reconciliation_id = $1`, [rec])).rows[0].n;
      check("a viewer reads the statement lines", seen === 2, String(seen));
      for (const [label, sql, params] of [
        ["a viewer cannot replace the statement", replace, [rec, "v.pdf", 0, 0, "[]"]],
        ["a viewer cannot tick lines", many, [rec, [book[0].journal_line_id]]],
        ["a viewer cannot take the ending balance", `select acc_set_statement_ending($1, 1)`, [rec]],
      ]) {
        const message = await refused(sql, params);
        check(label, /Not authorized/.test(message ?? ""), message ?? "accepted");
      }
      await client.query("reset role");
      await client.query(`update acc_app_user set role = 'admin' where id = $1`, [admin.id]);
      await client.query("set local role authenticated");
      await as(OUTSIDER);
      const outsider = await refused(start, [bank, 1, "x.pdf", 0, "[]"]);
      check("someone outside the company cannot start one", /Not authorized|not authorized/.test(outsider ?? ""), outsider ?? "accepted");
      const outsiderForward = await refused(bringForward, [bank, 0]);
      check("someone outside the company cannot bring an account forward", /Not authorized/.test(outsiderForward ?? ""), outsiderForward ?? "accepted");
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

- [ ] **Step 2: Run it and watch it fail.**

Run (Git Bash): `node --env-file=.env.local scripts/verify-reconcile-from-statement.mjs`
Expected: it stops at once with `ENOENT: no such file or directory` naming `0132_reconcile_from_statement.sql`.

- [ ] **Step 3: Write the migration.** Create `supabase/migrations/0132_reconcile_from_statement.sql`:

```sql
-- ============================================================================
-- 0132 — Reconcile a statement from its file (1.79).
--
-- A reconciliation can now hold the statement it is reconciled against: the
-- file's name, the opening and closing balances it prints, and its lines. The
-- lines are paired with the books in the application (the client's prototype's
-- rule) and the pairs are ticked through acc_set_cleared_many, which makes the
-- same checks as acc_set_cleared for many lines in one call.
--
-- The first reconciliation of a bank account can be brought forward: when the
-- book balance on the day before the first statement's period equals the
-- opening balance that statement prints, every earlier posted line is signed off
-- as one completed reconciliation. A person asks for it; nothing here runs by
-- itself, and nothing here posts to the ledger.
--
-- acc_reconciliation_lines gains the book line's reference (the cheque number a
-- statement pairs on): the entry's own reference, else the reference of the
-- payment or bill payment it came from.
-- ============================================================================

set search_path = public;

alter table acc_statement_reconciliation
  add column if not exists statement_opening_minor bigint,
  add column if not exists statement_closing_minor bigint,
  add column if not exists note text,
  add column if not exists brought_forward boolean not null default false;
alter table acc_statement_reconciliation drop constraint if exists acc_stmt_recon_note_ck;
alter table acc_statement_reconciliation
  add constraint acc_stmt_recon_note_ck check (note is null or length(note) <= 500);
alter table acc_statement_reconciliation drop constraint if exists acc_stmt_recon_ref_ck;
alter table acc_statement_reconciliation
  add constraint acc_stmt_recon_ref_ck check (statement_ref is null or length(statement_ref) <= 255);

create table if not exists acc_reconciliation_statement_line (
  id                uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references acc_statement_reconciliation (id) on delete cascade,
  line_no           integer not null check (line_no >= 0),
  txn_date          date not null,
  description       text not null default '' check (length(description) <= 500),
  reference         text check (reference is null or length(reference) <= 80),
  amount_minor      bigint not null check (amount_minor <> 0),
  balance_minor     bigint,
  unique (reconciliation_id, line_no)
);

alter table acc_reconciliation_statement_line enable row level security;
drop policy if exists acc_recon_stmt_line_sel on acc_reconciliation_statement_line;
create policy acc_recon_stmt_line_sel on acc_reconciliation_statement_line
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
revoke all on acc_reconciliation_statement_line from public, anon;
grant select on acc_reconciliation_statement_line to authenticated;
grant all on acc_reconciliation_statement_line to service_role;

-- Replaces the statement lines a reconciliation holds. Internal: callers check
-- who may write and that the reconciliation is in progress.
create or replace function acc_recon_write_statement(p_reconciliation_id uuid, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_lines jsonb := coalesce(p_lines, '[]'::jsonb); v_count integer;
begin
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'The statement lines must be a list'; end if;
  if jsonb_array_length(v_lines) > 5000 then raise exception 'A statement can hold at most 5,000 lines'; end if;
  delete from acc_reconciliation_statement_line where reconciliation_id = p_reconciliation_id;
  insert into acc_reconciliation_statement_line
    (reconciliation_id, line_no, txn_date, description, reference, amount_minor, balance_minor)
  select p_reconciliation_id, (x.ord - 1)::integer, (x.e ->> 'txn_date')::date,
         left(coalesce(x.e ->> 'description', ''), 500),
         nullif(left(btrim(coalesce(x.e ->> 'reference', '')), 80), ''),
         (x.e ->> 'amount_minor')::bigint, (x.e ->> 'balance_minor')::bigint
    from jsonb_array_elements(v_lines) with ordinality as x (e, ord);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function acc_recon_write_statement(uuid, jsonb) from public, anon, authenticated;

-- A reconciliation started from a statement: acc_create_reconciliation plus the
-- statement it is reconciled against, in one transaction.
create or replace function acc_create_reconciliation_from_statement(
  p_bank_account_id uuid, p_ending_date date, p_ending_minor bigint,
  p_file_name text, p_opening_minor bigint, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := acc_create_reconciliation(p_bank_account_id, p_ending_date, p_ending_minor);
  update acc_statement_reconciliation
     set statement_ref = nullif(left(btrim(coalesce(p_file_name, '')), 255), ''),
         statement_opening_minor = p_opening_minor,
         statement_closing_minor = p_ending_minor,
         updated_at = now()
   where id = v_id;
  perform acc_recon_write_statement(v_id, p_lines);
  return v_id;
end;
$$;
revoke all on function acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb) from public, anon;
grant execute on function acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb)
  to authenticated, service_role;

-- The statement a reconciliation in progress is reconciled against, replaced.
create or replace function acc_set_reconciliation_statement(
  p_reconciliation_id uuid, p_file_name text, p_opening_minor bigint, p_closing_minor bigint, p_lines jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  update acc_statement_reconciliation
     set statement_ref = nullif(left(btrim(coalesce(p_file_name, '')), 255), ''),
         statement_opening_minor = p_opening_minor,
         statement_closing_minor = p_closing_minor,
         updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid());
  return acc_recon_write_statement(p_reconciliation_id, p_lines);
end;
$$;
revoke all on function acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb) from public, anon;
grant execute on function acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb) to authenticated, service_role;

-- Take the statement's closing balance as the reconciliation's ending balance.
create or replace function acc_set_statement_ending(p_reconciliation_id uuid, p_ending_minor bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  update acc_statement_reconciliation
     set statement_ending_balance_minor = p_ending_minor, updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid());
end;
$$;
revoke all on function acc_set_statement_ending(uuid, bigint) from public, anon;
grant execute on function acc_set_statement_ending(uuid, bigint) to authenticated, service_role;

-- acc_set_cleared for many lines in one call: every line passes its checks or
-- none is changed.
create or replace function acc_set_cleared_many(
  p_reconciliation_id uuid, p_journal_line_ids uuid[], p_cleared boolean
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_line uuid; v_count integer := 0;
begin
  if coalesce(array_length(p_journal_line_ids, 1), 0) > 5000 then
    raise exception 'At most 5,000 lines can be ticked at once';
  end if;
  foreach v_line in array coalesce(p_journal_line_ids, '{}'::uuid[]) loop
    perform acc_set_cleared(p_reconciliation_id, v_line, p_cleared);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function acc_set_cleared_many(uuid, uuid[], boolean) from public, anon;
grant execute on function acc_set_cleared_many(uuid, uuid[], boolean) to authenticated, service_role;

-- What bringing an account forward through a date would sign off. Read only.
create or replace function acc_brought_forward_preview(p_bank_account_id uuid, p_through date)
returns table (has_reconciliations boolean, book_balance_minor bigint, open_lines integer)
language sql stable as $$
  select exists (select 1 from acc_statement_reconciliation where bank_account_id = p_bank_account_id),
         coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint,
         count(l.id)::integer
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = (select account_id from acc_bank_account where id = p_bank_account_id)
     and e.status = 'posted'
     and e.entry_date <= p_through;
$$;
revoke all on function acc_brought_forward_preview(uuid, date) from public, anon;
grant execute on function acc_brought_forward_preview(uuid, date) to authenticated, service_role;

-- The first reconciliation of a bank account, brought forward: every posted
-- line up to p_through signed off as one completed reconciliation, proved by
-- the opening balance the first statement prints.
create or replace function acc_bring_forward_reconciliation(
  p_bank_account_id uuid, p_through date, p_opening_minor bigint, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_gl uuid; v_balance bigint; v_id uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to bring a bank account forward'; end if;
  select account_id into v_gl from acc_bank_account where id = p_bank_account_id for update;
  if v_gl is null then raise exception 'Bank account not found'; end if;
  if exists (select 1 from acc_statement_reconciliation where bank_account_id = p_bank_account_id) then
    raise exception 'This bank account already has a reconciliation; only the first one can be brought forward';
  end if;
  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    into v_balance
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through;
  if v_balance <> p_opening_minor then
    raise exception 'The books hold % on %, and the statement opens at %',
      to_char(v_balance / 100.0, 'FM999,999,999,990.00'), p_through,
      to_char(p_opening_minor / 100.0, 'FM999,999,999,990.00');
  end if;

  insert into acc_statement_reconciliation
    (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor,
     status, prepared_by, completed_by, completed_at, note, brought_forward)
  values (p_bank_account_id, p_through, 0, p_opening_minor,
          'completed', auth.uid(), auth.uid(), now(), nullif(left(btrim(coalesce(p_note, '')), 500), ''), true)
  returning id into v_id;
  insert into acc_reconciliation_line (reconciliation_id, journal_line_id)
  select v_id, l.id
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', v_id, 'insert', auth.uid()),
           ('acc_statement_reconciliation', v_id, 'post', auth.uid());
  return v_id;
end;
$$;
revoke all on function acc_bring_forward_reconciliation(uuid, date, bigint, text) from public, anon;
grant execute on function acc_bring_forward_reconciliation(uuid, date, bigint, text) to authenticated, service_role;

-- The lines a reconciliation offers, now with the reference a statement pairs
-- on. Its result columns change, so it is dropped and created again.
drop function if exists acc_reconciliation_lines(uuid);
create function acc_reconciliation_lines(p_reconciliation_id uuid)
returns table (journal_line_id uuid, entry_id uuid, entry_number text, entry_date date,
               source_type acc_journal_source, memo text, signed_minor bigint, cleared boolean,
               reference text)
language sql stable as $$
  with rec as (select * from acc_statement_reconciliation where id = p_reconciliation_id),
       gl as (select account_id from acc_bank_account where id = (select bank_account_id from rec))
  select l.id, e.id, e.entry_number, e.entry_date, e.source_type, l.memo,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint,
         exists (select 1 from acc_reconciliation_line rl
                  where rl.reconciliation_id = p_reconciliation_id and rl.journal_line_id = l.id),
         coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference)
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
    left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id
    left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id
   where l.account_id = (select account_id from gl)
     and e.status = 'posted'
     and e.entry_date <= (select statement_ending_date from rec)
     and not exists (
       select 1 from acc_reconciliation_line rl2
       join acc_statement_reconciliation r2 on r2.id = rl2.reconciliation_id
       where rl2.journal_line_id = l.id and r2.status = 'completed' and r2.id <> p_reconciliation_id)
   order by e.entry_date, e.entry_number;
$$;
revoke all on function acc_reconciliation_lines(uuid) from public, anon;
grant execute on function acc_reconciliation_lines(uuid) to authenticated, service_role;
```

- [ ] **Step 4: Run the proof.**

Run (Git Bash): `node --env-file=.env.local scripts/verify-reconcile-from-statement.mjs`
Expected: every company prints its checks with `ok`, none `FAIL`, and the last line is `210 passed, 0 failed` (35 checks for each of the six active companies). Everything it does is rolled back. If the database cannot be reached (`ECONNREFUSED`, `ETIMEDOUT`, `HARD TIMEOUT`), stop and report BLOCKED — do not apply the migration any other way.

- [ ] **Step 5: The unit suite still passes.**

Run: `npm test`
Expected: every test file passes. `tests/unit/quality-query-timing.test.ts` measures time and can fail when the machine is busy with the whole suite; if it alone fails, run it on its own (`npx vitest run tests/unit/quality-query-timing.test.ts`) and report both results.

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/0132_reconcile_from_statement.sql scripts/verify-reconcile-from-statement.mjs
printf 'feat(db): 0132 keeps a statement with its reconciliation\n\nThe statement file name, printed opening and closing balances and lines;\nstarting from a statement, ticking many lines at once, and bringing the\nfirst reconciliation of an account forward on its opening balance.\nVerified on every company in a rolled-back transaction; not applied live.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: Pairing statement lines with the books

**Files:**
- Create: `tests/unit/statement-pairing.test.ts`
- Create: `lib/domain/statement-pairing.ts`
- Create: `tests/parity/statement-pairing.parity.ts`

**Interfaces:**
- Consumes: `openPrototype(browser, htmlPath)` from `tests/parity/prototype.ts` (existing). Inside the prototype page: its globals `recMatch`, `recMath`, `UI`, `tickKey`.
- Produces: `PairStatementLine { lineNo; date; amountMinor; reference }`, `PairBookLine { id; date; amountMinor; reference }`, `StatementPair { line; book; how }`, `Pairing { pairs; missing; unseen }`, `StatementMatch extends Pairing { flipped; ignored }`, `PAIRING_WINDOW_DAYS = 5`, `cleanReference(reference): string`, `pairStatement(lines, book, windowDays?): Pairing`, `matchStatement(lines, book, statementDate): StatementMatch`. `how` is one of `"date and amount"`, `"cheque number"`, `"amount, within 5 days"`.

- [ ] **Step 1: Write the failing test.** Create `tests/unit/statement-pairing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  cleanReference,
  matchStatement,
  pairStatement,
  type PairBookLine,
  type PairStatementLine,
} from "@/lib/domain/statement-pairing";

const line = (lineNo: number, date: string, amountMinor: number, reference: string | null = null): PairStatementLine => ({
  lineNo,
  date,
  amountMinor,
  reference,
});
const entry = (id: string, date: string, amountMinor: number, reference: string | null = null): PairBookLine => ({
  id,
  date,
  amountMinor,
  reference,
});
const summary = (result: ReturnType<typeof pairStatement>) => ({
  pairs: result.pairs.map((p) => [p.line.lineNo, p.book.id, p.how]),
  missing: result.missing.map((l) => l.lineNo),
  unseen: result.unseen.map((e) => e.id),
});

describe("pairStatement", () => {
  it("pairs the same date and amount before anything looser", () => {
    const result = pairStatement(
      [line(0, "2026-09-07", -1200)],
      [entry("near", "2026-09-05", -1200), entry("exact", "2026-09-07", -1200)],
    );
    expect(summary(result).pairs).toEqual([[0, "exact", "date and amount"]]);
  });

  it("pairs a cheque by its number when the dates are far apart", () => {
    const result = pairStatement([line(0, "2026-09-28", -60000, "1201")], [entry("chq", "2026-09-02", -60000, "1201")]);
    expect(summary(result).pairs).toEqual([[0, "chq", "cheque number"]]);
  });

  it("pairs the same amount within five days, and not at six", () => {
    expect(summary(pairStatement([line(0, "2026-09-10", 500)], [entry("a", "2026-09-05", 500)])).pairs).toEqual([
      [0, "a", "amount, within 5 days"],
    ]);
    expect(summary(pairStatement([line(0, "2026-09-11", 500)], [entry("a", "2026-09-05", 500)]))).toEqual({
      pairs: [],
      missing: [0],
      unseen: ["a"],
    });
  });

  it("uses each line once: a second identical statement line is missing", () => {
    const result = pairStatement([line(0, "2026-09-05", -500), line(1, "2026-09-05", -500)], [entry("fee", "2026-09-05", -500)]);
    expect(summary(result)).toEqual({ pairs: [[0, "fee", "date and amount"]], missing: [1], unseen: [] });
  });

  it("takes statement lines in file order, each the first free book line in book order", () => {
    const result = pairStatement(
      [line(0, "2026-09-08", 900), line(1, "2026-09-08", 900)],
      [entry("first", "2026-09-06", 900), entry("second", "2026-09-07", 900)],
    );
    expect(summary(result).pairs).toEqual([
      [0, "first", "amount, within 5 days"],
      [1, "second", "amount, within 5 days"],
    ]);
  });

  it("never pairs on an empty cheque number", () => {
    const result = pairStatement([line(0, "2026-09-28", -700, " ")], [entry("blank", "2026-09-01", -700, "")]);
    expect(summary(result).pairs).toEqual([]);
  });
});

describe("matchStatement", () => {
  it("reads a statement whose signs run the other way, and says so", () => {
    const result = matchStatement(
      [line(0, "2026-09-05", 1200), line(1, "2026-09-09", -5000)],
      [entry("out", "2026-09-05", -1200), entry("in", "2026-09-09", 5000)],
      "2026-09-30",
    );
    expect(result.flipped).toBe(true);
    expect(result.pairs.map((p) => p.book.id)).toEqual(["out", "in"]);
  });

  it("keeps the statement as written on a tie", () => {
    const result = matchStatement([line(0, "2026-09-05", 1200)], [entry("a", "2026-09-05", 1200), entry("b", "2026-09-05", -1200)], "2026-09-30");
    expect(result.flipped).toBe(false);
    expect(result.pairs.map((p) => p.book.id)).toEqual(["a"]);
  });

  it("leaves out and counts statement lines dated after the statement date", () => {
    const result = matchStatement([line(0, "2026-09-30", 100), line(1, "2026-10-01", 200)], [entry("a", "2026-09-30", 100)], "2026-09-30");
    expect(result.ignored).toBe(1);
    expect(result.missing).toEqual([]);
    expect(result.pairs).toHaveLength(1);
  });
});

describe("cleanReference", () => {
  it("keeps letters, digits and hyphens, as the prototype does", () => {
    expect(cleanReference(" 1201 ")).toBe("1201");
    expect(cleanReference("#1201")).toBe("1201");
    expect(cleanReference("CHK-77.")).toBe("CHK-77");
    expect(cleanReference(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run it.**

Run: `npx vitest run tests/unit/statement-pairing.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/statement-pairing"`.

- [ ] **Step 3: Write the pairing.** Create `lib/domain/statement-pairing.ts` (with the Write tool — it holds a regular expression):

```ts
/**
 * Pairing a bank statement's lines with the books — a port of the client's
 * prototype (Accounting System 2.28, src/p24.html: recPair and recMatch), in
 * integer cents.
 *
 * Three passes, strongest evidence first, so an exact date-and-amount pair is
 * never taken by a looser match tried sooner: the same date and amount; the same
 * amount and the statement's cheque number equal to the book line's reference;
 * the same amount within a few days. Each statement line and each book line is
 * used once. A statement that writes money the other way round is read both
 * ways, and the reading that pairs more lines is kept.
 *
 * Pure: the reconciliation reads its statement lines and book lines, and ticks
 * the pairs (lib/services/bankrec.ts). Nothing here ticks or posts.
 */

export interface PairStatementLine {
  lineNo: number;
  /** ISO date. */
  date: string;
  /** Positive is money in. */
  amountMinor: number;
  /** The cheque number the statement prints, when it prints one. */
  reference: string | null;
}

export interface PairBookLine {
  /** The journal line. */
  id: string;
  date: string;
  /** Positive is money into the bank. */
  amountMinor: number;
  reference: string | null;
}

export interface StatementPair {
  line: PairStatementLine;
  book: PairBookLine;
  how: string;
}

export interface Pairing {
  pairs: StatementPair[];
  /** On the statement, not in the books. */
  missing: PairStatementLine[];
  /** In the books, not on the statement: outstanding. */
  unseen: PairBookLine[];
}

export interface StatementMatch extends Pairing {
  /** The statement's signs were read the other way round. */
  flipped: boolean;
  /** Statement lines dated after the statement date, left out. */
  ignored: number;
}

/** The prototype's window, in days, for the third pass. */
export const PAIRING_WINDOW_DAYS = 5;

const DAY_MS = 86_400_000;

function daysApart(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS));
}

/** A cheque number as the prototype keeps it: letters, digits and hyphens only. */
export function cleanReference(reference: string | null): string {
  return (reference ?? "").replace(/[^0-9A-Za-z-]/g, "");
}

export function pairStatement(
  lines: readonly PairStatementLine[],
  book: readonly PairBookLine[],
  windowDays = PAIRING_WINDOW_DAYS,
): Pairing {
  const usedLines = new Set<number>();
  const usedBook = new Set<string>();
  const pairs: StatementPair[] = [];
  const passes: { how: string; fits: (line: PairStatementLine, entry: PairBookLine) => boolean }[] = [
    { how: "date and amount", fits: (line, entry) => line.date === entry.date && line.amountMinor === entry.amountMinor },
    {
      how: "cheque number",
      fits: (line, entry) => {
        const check = cleanReference(line.reference);
        return line.amountMinor === entry.amountMinor && check !== "" && (entry.reference ?? "") === check;
      },
    },
    {
      how: `amount, within ${windowDays} days`,
      fits: (line, entry) => line.amountMinor === entry.amountMinor && daysApart(line.date, entry.date) <= windowDays,
    },
  ];
  for (const pass of passes) {
    for (const line of lines) {
      if (usedLines.has(line.lineNo)) continue;
      const entry = book.find((candidate) => !usedBook.has(candidate.id) && pass.fits(line, candidate));
      if (!entry) continue;
      usedLines.add(line.lineNo);
      usedBook.add(entry.id);
      pairs.push({ line, book: entry, how: pass.how });
    }
  }
  return {
    pairs,
    missing: lines.filter((line) => !usedLines.has(line.lineNo)),
    unseen: book.filter((entry) => !usedBook.has(entry.id)),
  };
}

/**
 * A statement against the books up to the statement date: lines dated after it
 * are left out and counted; the statement is read as written and with its signs
 * turned round, and whichever pairs more lines is kept (as written on a tie).
 */
export function matchStatement(
  lines: readonly PairStatementLine[],
  book: readonly PairBookLine[],
  statementDate: string,
): StatementMatch {
  const within = lines.filter((line) => line.date <= statementDate);
  const asWritten = pairStatement(within, book);
  const turned = pairStatement(
    within.map((line) => ({ ...line, amountMinor: -line.amountMinor })),
    book,
  );
  const flipped = turned.pairs.length > asWritten.pairs.length;
  return { ...(flipped ? turned : asWritten), flipped, ignored: lines.length - within.length };
}
```

- [ ] **Step 4: Run it.**

Run: `npx vitest run tests/unit/statement-pairing.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Prove it against the prototype.** Create `tests/parity/statement-pairing.parity.ts` (with the Write tool):

```ts
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { matchStatement, type PairBookLine, type PairStatementLine } from "@/lib/domain/statement-pairing";
import { openPrototype } from "./prototype";

/**
 * Pairing statement lines with the books against the prototype's own recMatch
 * (src/p24.html), in its own page: the same statement lines and book lines go
 * through both, and the pairs, their order, how each was made, what is missing
 * and unseen, the sign flip and the ignored count must all be the same.
 *
 * The cases are generated from a fixed seed, so every run sees the same ones.
 * recMatch reads its book lines from recMath; the page lends it these instead
 * for the call, and puts recMath and UI.rec back afterwards.
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *
 * Run: npm run parity
 */
const CASES = 400;

function cases(count: number) {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(values: readonly T[]) => values[Math.floor(rand() * values.length)];
  const day = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;
  const amounts = [500, 1200, 5000, 12000, 50000, -500, -1200, -5000, -12000, -50000];
  return Array.from({ length: count }, () => {
    const lines: PairStatementLine[] = Array.from({ length: 1 + Math.floor(rand() * 7) }, (_, i) => ({
      lineNo: i,
      date: day(1 + Math.floor(rand() * 30)),
      amountMinor: pick(amounts),
      reference: pick(["", "1201", "1202", "x-9", "1201 "]) || null,
    }));
    const book: PairBookLine[] = Array.from({ length: Math.floor(rand() * 8) }, (_, k) => ({
      id: `T${k}|0`,
      date: day(1 + Math.floor(rand() * 30)),
      amountMinor: pick(amounts),
      reference: pick(["", "1201", "1202", "x-9"]) || null,
    }));
    return { lines, book, statementDate: day(20 + Math.floor(rand() * 11)) };
  });
}

const RUN = `(function (lines, open, statementDate) {
  var savedMath = recMath, savedRec = UI.rec;
  try {
    recMath = function () { return { lines: open }; };
    UI.rec = { statementDate: statementDate, ticks: {}, imp: { lines: lines } };
    recMatch();
    var imp = UI.rec.imp;
    return {
      pairs: imp.pairs.map(function (p) { return [p.line.i, tickKey(p.book), p.how]; }),
      missing: imp.missing.map(function (l) { return l.i; }),
      unseen: imp.unseen.map(function (r) { return tickKey(r); }),
      flipped: imp.flipped,
      ignored: imp.ignored
    };
  } finally {
    recMath = savedMath;
    UI.rec = savedRec;
  }
})`;

describe("statement pairing against the prototype", () => {
  it(`pairs ${CASES} generated statements exactly as the prototype's recMatch does`, async () => {
    const htmlPath = process.env.PARITY_PROTOTYPE_HTML?.trim();
    if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
    const browser = await chromium.launch();
    try {
      const page = await openPrototype(browser, htmlPath);
      let pairs = 0;
      for (const [n, c] of cases(CASES).entries()) {
        const protoLines = c.lines.map((l) => ({
          i: l.lineNo,
          date: l.date,
          amount: l.amountMinor / 100,
          check: (l.reference ?? "").replace(/[^0-9A-Za-z-]/g, ""),
        }));
        const protoBook = c.book.map((b) => ({
          t: { id: b.id.split("|")[0], ref: b.reference ?? "" },
          i: 0,
          date: b.date,
          amount: b.amountMinor / 100,
        }));
        const prototype = await page.evaluate(
          `${RUN}(${JSON.stringify(protoLines)}, ${JSON.stringify(protoBook)}, ${JSON.stringify(c.statementDate)})`,
        );
        const ours = matchStatement(c.lines, c.book, c.statementDate);
        pairs += ours.pairs.length;
        expect(
          {
            pairs: ours.pairs.map((p) => [p.line.lineNo, p.book.id, p.how]),
            missing: ours.missing.map((l) => l.lineNo),
            unseen: ours.unseen.map((b) => b.id),
            flipped: ours.flipped,
            ignored: ours.ignored,
          },
          `case ${n}`,
        ).toEqual(prototype);
      }
      console.log(`parity: statement pairing: ${CASES} statements, ${pairs} pairs, all as the prototype pairs them`);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
```

Run (Git Bash): `PARITY_PROTOTYPE_HTML="C:/Users/pit010/Accounting System 2.28 - source/accounting-system.html" node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.parity.config.ts tests/parity/statement-pairing.parity.ts --reporter=verbose`
Expected: `parity: statement pairing: 400 statements, 289 pairs, all as the prototype pairs them`, and 1 passed. If the prototype file is not there, report it — do not skip the step.

- [ ] **Step 6: Lint and commit.**

Run: `npx eslint lib/domain/statement-pairing.ts tests/unit/statement-pairing.test.ts tests/parity/statement-pairing.parity.ts` — Expected: prints nothing.

```bash
git add lib/domain/statement-pairing.ts tests/unit/statement-pairing.test.ts tests/parity/statement-pairing.parity.ts
printf 'feat(reconcile): pair statement lines with the books as the prototype does\n\nA port of recPair and recMatch in cents: date and amount, cheque number,\namount within 5 days; each line used once; signs read both ways. The parity\ntest runs 400 statements through the prototype page and agrees on all.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: What a reconciliation says about its statement

**Files:**
- Modify: `lib/domain/pdf-statement-view.ts` (export `shortDate`)
- Create: `tests/unit/reconcile-statement.test.ts`
- Create: `lib/domain/reconcile-statement.ts`

**Interfaces:**
- Consumes: `periodLabel` from `lib/domain/pdf-statement-view.ts`; `matchStatement`, `PairBookLine`, `PairStatementLine` (Task 2).
- Produces: `shortDate(iso, withYear): string` (now exported); `BroughtForwardPreview { hasReconciliations; bookBalanceMinor; openLines }`; `BringForwardAdvice { canBringForward; through; text }`; `dayBefore(iso)`; `bringForwardAdvice(preview, { from, openingMinor }, money): BringForwardAdvice | null`; `broughtForwardNote(from, to): string`; `closingAdvice(closingMinor, endingMinor, money): string | null`; `openingAdvice(openingMinor, beginningMinor, money): string | null`; `StandingBookLine`; `Standing` = `{ kind: "paired"; how; bookId; entryNumber; ticked } | { kind: "missing" } | { kind: "after" }`; `StatementStandings { standings; paired; missing; after; flipped; outstanding }`; `statementStandings(lines, book, statementDate)`; `reconciliationStandings(statement: { endingDate; lines: { lineNo; txnDate; amountMinor; reference }[] }, book: { journalLineId; entryDate; signedMinor; reference; entryNumber; cleared }[])`; `PairingOutcome { lines; paired; ticked; missing; after; flipped }`; `pairingMessage(outcome): string`.

- [ ] **Step 1: Export the short date.** In `lib/domain/pdf-statement-view.ts` replace

```ts
function shortDate(iso: string, withYear: boolean): string {
```

with

```ts
/** "Aug 31" or "Aug 31, 2026". */
export function shortDate(iso: string, withYear: boolean): string {
```

- [ ] **Step 2: Write the failing test.** Create `tests/unit/reconcile-statement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  bringForwardAdvice,
  broughtForwardNote,
  closingAdvice,
  dayBefore,
  openingAdvice,
  pairingMessage,
  reconciliationStandings,
  statementStandings,
  type StandingBookLine,
} from "@/lib/domain/reconcile-statement";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

describe("dayBefore", () => {
  it("steps back across a month and a year", () => {
    expect(dayBefore("2026-09-01")).toBe("2026-08-31");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2028-03-01")).toBe("2028-02-29");
  });
});

describe("bringForwardAdvice", () => {
  const statement = { from: "2026-09-01", openingMinor: 500000 };

  it("offers to bring the earlier lines forward when the books agree with the opening balance", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 500000, openLines: 214 }, statement, money)).toEqual({
      canBringForward: true,
      through: "2026-08-31",
      text: "The books hold $5000.00 on Aug 31, 2026 — the statement opens at $5000.00. The 214 earlier lines can be brought forward as reconciled.",
    });
  });

  it("says one line in the singular", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 500000, openLines: 1 }, statement, money)?.text).toContain(
      "The 1 earlier line can be brought forward",
    );
  });

  it("says by how much they differ, and that the earlier lines stay open", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 490000, openLines: 3 }, statement, money)).toEqual({
      canBringForward: false,
      through: "2026-08-31",
      text: "The books hold $4900.00 on Aug 31, 2026, and the statement opens at $5000.00: $100.00 apart. The earlier lines stay open and are reconciled with this statement.",
    });
  });

  it("says nothing once the account has a reconciliation, or the statement prints no start or opening", () => {
    const preview = { hasReconciliations: false, bookBalanceMinor: 500000, openLines: 2 };
    expect(bringForwardAdvice({ ...preview, hasReconciliations: true }, statement, money)).toBeNull();
    expect(bringForwardAdvice(preview, { from: null, openingMinor: 500000 }, money)).toBeNull();
    expect(bringForwardAdvice(preview, { from: "2026-09-01", openingMinor: null }, money)).toBeNull();
  });

  it("says nothing when the books hold nothing earlier and the statement opens at zero", () => {
    expect(bringForwardAdvice({ hasReconciliations: false, bookBalanceMinor: 0, openLines: 0 }, { from: "2026-09-01", openingMinor: 0 }, money)).toBeNull();
  });
});

describe("the sentences on a reconciliation", () => {
  it("names the statement's period in the brought-forward note", () => {
    expect(broughtForwardNote("2026-09-01", "2026-09-30")).toBe(
      "Brought forward, proved by the opening balance on the statement for Sep 1 – Sep 30, 2026",
    );
  });

  it("says when the statement closes on another figure, and nothing when it agrees", () => {
    expect(closingAdvice(555825, 560000, money)).toBe("The statement closes at $5558.25; this reconciliation says $5600.00.");
    expect(closingAdvice(560000, 560000, money)).toBeNull();
    expect(closingAdvice(null, 560000, money)).toBeNull();
  });

  it("says when the statement opens where the reconciliation does not begin", () => {
    expect(openingAdvice(500000, 450000, money)).toBe(
      "The statement opens at $5000.00; this reconciliation begins at $4500.00. A statement may be missing, or the last reconciliation closed on a different figure.",
    );
    expect(openingAdvice(500000, 500000, money)).toBeNull();
  });
});

describe("statementStandings", () => {
  const book: StandingBookLine[] = [
    { id: "a", date: "2026-09-05", amountMinor: -1200, reference: null, entryNumber: "JE-1", cleared: true },
    { id: "b", date: "2026-09-02", amountMinor: -60000, reference: "1201", entryNumber: "BP-7", cleared: false },
    { id: "c", date: "2026-09-20", amountMinor: 9900, reference: null, entryNumber: "PMT-3", cleared: false },
  ];
  const lines = [
    { lineNo: 0, date: "2026-09-05", amountMinor: -1200, reference: null },
    { lineNo: 1, date: "2026-09-28", amountMinor: -60000, reference: "1201" },
    { lineNo: 2, date: "2026-09-29", amountMinor: -500, reference: null },
    { lineNo: 3, date: "2026-10-02", amountMinor: 700, reference: null },
  ];

  it("says how each line paired, whether its book line is ticked, and what is not in the books", () => {
    const result = statementStandings(lines, book, "2026-09-30");
    expect(result.standings).toEqual([
      { kind: "paired", how: "date and amount", bookId: "a", entryNumber: "JE-1", ticked: true },
      { kind: "paired", how: "cheque number", bookId: "b", entryNumber: "BP-7", ticked: false },
      { kind: "missing" },
      { kind: "after" },
    ]);
    expect(result).toMatchObject({ paired: 2, missing: 1, after: 1, flipped: false, outstanding: ["c"] });
  });

  it("reads a reconciliation's kept statement and book lines the same way", () => {
    const result = reconciliationStandings(
      { endingDate: "2026-09-30", lines: lines.map((l) => ({ ...l, txnDate: l.date })) },
      book.map((b) => ({ ...b, journalLineId: b.id, entryDate: b.date, signedMinor: b.amountMinor })),
    );
    expect(result).toEqual(statementStandings(lines, book, "2026-09-30"));
  });
});

describe("pairingMessage", () => {
  it("counts what paired and was ticked, and sends what is missing to Bank Transactions", () => {
    expect(pairingMessage({ lines: 12, paired: 10, ticked: 3, missing: 2, after: 0, flipped: false })).toBe(
      "10 of 12 statement lines paired with the books; 3 newly ticked. 2 not in the books — code them in Bank Transactions, then Match again.",
    );
    expect(pairingMessage({ lines: 1, paired: 0, ticked: 0, missing: 1, after: 0, flipped: true })).toBe(
      "0 of 1 statement line paired with the books; 0 newly ticked. 1 not in the books — code it in Bank Transactions, then Match again. The statement's amounts were read the other way round to pair them.",
    );
  });
});
```

- [ ] **Step 3: Run it.**

Run: `npx vitest run tests/unit/reconcile-statement.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/reconcile-statement"`.

- [ ] **Step 4: Write the module.** Create `lib/domain/reconcile-statement.ts`:

```ts
/**
 * What a reconciliation says about the statement it is reconciled against:
 * how each statement line stands with the books, and the sentences the start
 * dialog and the reconciliation show. Pure, so the wording is tested where it
 * is written.
 */
import { periodLabel, shortDate } from "./pdf-statement-view";
import { matchStatement, type PairBookLine, type PairStatementLine } from "./statement-pairing";

/** What bringing an account forward through a day would sign off. */
export interface BroughtForwardPreview {
  hasReconciliations: boolean;
  bookBalanceMinor: number;
  /** Posted lines up to that day. */
  openLines: number;
}

export interface BringForwardAdvice {
  canBringForward: boolean;
  /** The day before the statement's period: the last day brought forward. */
  through: string;
  text: string;
}

/** The ISO day before `iso`. */
export function dayBefore(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Whether the first reconciliation of an account can bring the earlier lines
 * forward, as the prototype does: the book balance on the day before the
 * statement's period must equal the opening balance the statement prints.
 * Null when there is nothing to say — the account has been reconciled before,
 * the statement prints no period start or no opening balance, or the books
 * hold nothing earlier.
 */
export function bringForwardAdvice(
  preview: BroughtForwardPreview,
  statement: { from: string | null; openingMinor: number | null },
  money: (minor: number) => string,
): BringForwardAdvice | null {
  if (preview.hasReconciliations || !statement.from || statement.openingMinor === null) return null;
  const through = dayBefore(statement.from);
  const books = `The books hold ${money(preview.bookBalanceMinor)} on ${shortDate(through, true)}`;
  const opens = `the statement opens at ${money(statement.openingMinor)}`;
  if (preview.bookBalanceMinor === statement.openingMinor) {
    if (preview.openLines === 0) return null;
    const lines = preview.openLines === 1 ? "The 1 earlier line" : `The ${preview.openLines} earlier lines`;
    return { canBringForward: true, through, text: `${books} — ${opens}. ${lines} can be brought forward as reconciled.` };
  }
  const apart = money(Math.abs(preview.bookBalanceMinor - statement.openingMinor));
  return {
    canBringForward: false,
    through,
    text: `${books}, and ${opens}: ${apart} apart. The earlier lines stay open and are reconciled with this statement.`,
  };
}

/** The note a brought-forward reconciliation keeps. */
export function broughtForwardNote(from: string | null, to: string | null): string {
  return `Brought forward, proved by the opening balance on the statement for ${periodLabel(from, to)}`;
}

/** Said when the statement's closing balance is not the reconciliation's ending balance. */
export function closingAdvice(closingMinor: number | null, endingMinor: number, money: (minor: number) => string): string | null {
  if (closingMinor === null || closingMinor === endingMinor) return null;
  return `The statement closes at ${money(closingMinor)}; this reconciliation says ${money(endingMinor)}.`;
}

/** Said when the statement's opening balance is not where the reconciliation begins. */
export function openingAdvice(openingMinor: number | null, beginningMinor: number, money: (minor: number) => string): string | null {
  if (openingMinor === null || openingMinor === beginningMinor) return null;
  return (
    `The statement opens at ${money(openingMinor)}; this reconciliation begins at ${money(beginningMinor)}. ` +
    "A statement may be missing, or the last reconciliation closed on a different figure."
  );
}

export interface StandingBookLine extends PairBookLine {
  entryNumber: string | null;
  cleared: boolean;
}

export type Standing =
  | { kind: "paired"; how: string; bookId: string; entryNumber: string | null; ticked: boolean }
  | { kind: "missing" }
  | { kind: "after" };

export interface StatementStandings {
  /** One per statement line, in the order given. */
  standings: Standing[];
  paired: number;
  missing: number;
  after: number;
  flipped: boolean;
  /** Book lines not on the statement. */
  outstanding: string[];
}

/** How each statement line stands with the books as they are now. */
export function statementStandings(
  lines: readonly PairStatementLine[],
  book: readonly StandingBookLine[],
  statementDate: string,
): StatementStandings {
  const match = matchStatement(lines, book, statementDate);
  const byLine = new Map(match.pairs.map((pair) => [pair.line.lineNo, pair]));
  const byId = new Map(book.map((entry) => [entry.id, entry]));
  const standings = lines.map((line): Standing => {
    if (line.date > statementDate) return { kind: "after" };
    const pair = byLine.get(line.lineNo);
    if (!pair) return { kind: "missing" };
    const entry = byId.get(pair.book.id);
    return {
      kind: "paired",
      how: pair.how,
      bookId: pair.book.id,
      entryNumber: entry?.entryNumber ?? null,
      ticked: entry?.cleared ?? false,
    };
  });
  return {
    standings,
    paired: match.pairs.length,
    missing: match.missing.length,
    after: match.ignored,
    flipped: match.flipped,
    outstanding: match.unseen.map((entry) => entry.id),
  };
}

/** A reconciliation's kept statement and its book lines, in the shapes the screens and services hold them. */
export function reconciliationStandings(
  statement: {
    endingDate: string;
    lines: readonly { lineNo: number; txnDate: string; amountMinor: number; reference: string | null }[];
  },
  book: readonly {
    journalLineId: string;
    entryDate: string;
    signedMinor: number;
    reference: string | null;
    entryNumber: string | null;
    cleared: boolean;
  }[],
): StatementStandings {
  return statementStandings(
    statement.lines.map((l) => ({ lineNo: l.lineNo, date: l.txnDate, amountMinor: l.amountMinor, reference: l.reference })),
    book.map((b) => ({
      id: b.journalLineId,
      date: b.entryDate,
      amountMinor: b.signedMinor,
      reference: b.reference,
      entryNumber: b.entryNumber,
      cleared: b.cleared,
    })),
    statement.endingDate,
  );
}

export interface PairingOutcome {
  /** Statement lines kept with the reconciliation. */
  lines: number;
  paired: number;
  /** Book lines ticked by this pairing; pairs already ticked are not counted. */
  ticked: number;
  missing: number;
  after: number;
  flipped: boolean;
}

/** What importing or matching again says when it is done. */
export function pairingMessage(outcome: PairingOutcome): string {
  let text = `${outcome.paired} of ${plural(outcome.lines, "statement line")} paired with the books; ${outcome.ticked} newly ticked.`;
  if (outcome.missing > 0) {
    text += ` ${outcome.missing} not in the books — code ${outcome.missing === 1 ? "it" : "them"} in Bank Transactions, then Match again.`;
  }
  if (outcome.flipped) text += " The statement's amounts were read the other way round to pair them.";
  return text;
}
```

- [ ] **Step 5: Run it, and the PDF view tests beside it.**

Run: `npx vitest run tests/unit/reconcile-statement.test.ts tests/unit/pdf-statement-view.test.ts`
Expected: both files pass (reconcile-statement: 12 passed).

- [ ] **Step 6: Lint and commit.**

Run: `npx eslint lib/domain/reconcile-statement.ts lib/domain/pdf-statement-view.ts tests/unit/reconcile-statement.test.ts` — Expected: prints nothing.

```bash
git add lib/domain/reconcile-statement.ts lib/domain/pdf-statement-view.ts tests/unit/reconcile-statement.test.ts
printf 'feat(reconcile): the sentences and standings of a statement reconciliation\n\nWhether the first reconciliation can be brought forward, the closing and\nopening checks, how each statement line stands with the books, and what\nimporting or matching again says.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: Reading and writing a reconciliation's statement

**Files:**
- Modify: `lib/db/types.ts` (`StatementReconciliationRow`, around line 553)
- Modify: `lib/domain/schemas.ts` (after `ReconciliationReopenInput`, around line 519)
- Create: `tests/unit/reconcile-statement-service.test.ts`
- Modify: `lib/services/bankrec.ts` (whole file below)

**Interfaces:**
- Consumes: the database functions of Task 1; `reconciliationStandings`, `BroughtForwardPreview`, `PairingOutcome` (Task 3); `StatementLine` from `lib/domain/statement-import.ts`; `readAllPages` from `lib/services/paging.ts`.
- Produces:
  - `StatementReconciliationRow` gains `statement_opening_minor: number | null`, `statement_closing_minor: number | null`, `note: string | null`, `brought_forward: boolean`.
  - `reconciliationStatementSchema` → `{ file_name, opening_minor, closing_minor, lines }` and `ReconciliationStatementInput`; `reconciliationFromStatementSchema` → that plus `{ bank_account_id, period_from, statement_date, closing_minor (required), bring_forward }` and `ReconciliationFromStatementInput`.
  - In `lib/services/bankrec.ts`: `ReconLineView.reference: string | null`; `ReconStatementLine { lineNo; txnDate; description; reference; amountMinor; balanceMinor }`; `ReconStatementHeader { bankAccountId; endingDate; status; fileName; openingMinor; closingMinor; note; broughtForward }`; `ReconStatement extends ReconStatementHeader { lines }`; `StatementFileInput { fileName; openingMinor; closingMinor; lines: StatementLine[] }`; `createReconciliationFromStatement(sb, bankAccountId, endingDate, endingMinor, file): Promise<string>`; `setReconciliationStatement(sb, id, file): Promise<number>`; `setStatementEnding(sb, id, endingMinor): Promise<void>`; `setClearedMany(sb, id, journalLineIds, cleared): Promise<number>`; `getBroughtForwardPreview(sb, bankAccountId, through): Promise<BroughtForwardPreview>`; `bringForward(sb, bankAccountId, through, openingMinor, note): Promise<string>`; `getReconciliationHeader(sb, id): Promise<ReconStatementHeader>`; `getReconciliationStatement(sb, id): Promise<ReconStatement>`; `pairAndTick(sb, id): Promise<PairingOutcome>`.

- [ ] **Step 1: The row type.** In `lib/db/types.ts`, inside `export interface StatementReconciliationRow`, replace

```ts
  statement_ref: string | null;
  completed_at: string | null;
  created_at: string;
}
```

with

```ts
  /** The statement file's name, when the reconciliation was given one. */
  statement_ref: string | null;
  /** The opening and closing balances the statement prints. */
  statement_opening_minor: number | null;
  statement_closing_minor: number | null;
  note: string | null;
  /** The first reconciliation of an account, signed off on the opening balance of its first statement. */
  brought_forward: boolean;
  completed_at: string | null;
  created_at: string;
}
```

- [ ] **Step 2: The schemas.** In `lib/domain/schemas.ts`, directly after the line `export type ReconciliationReopenInput = z.infer<typeof reconciliationReopenSchema>;`, insert (with the Edit tool — it holds a regular expression):

```ts
const statementDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A statement date is required");

/** A statement file as a reconciliation takes it: its name, the balances it prints, and its lines. */
export const reconciliationStatementSchema = z.object({
  file_name: z.string().trim().min(1, "The statement file has no name").max(255),
  opening_minor: z.number().int().nullable(),
  closing_minor: z.number().int().nullable(),
  lines: z
    .array(
      z.object({
        txn_date: statementDay,
        description: z.string(),
        reference: z.string().nullable(),
        amount_minor: z.number().int(),
        running_balance_minor: z.number().int().nullable(),
        raw_line: z.string(),
        external_id: z.string().nullable().optional(),
      }),
    )
    .min(1, "The statement has no lines")
    .max(5000, "A statement can hold at most 5,000 lines"),
});
export type ReconciliationStatementInput = z.infer<typeof reconciliationStatementSchema>;

/** A reconciliation started from a PDF statement: its date and closing balance are the statement's. */
export const reconciliationFromStatementSchema = reconciliationStatementSchema
  .extend({
    bank_account_id: z.uuid("Select a bank account"),
    period_from: statementDay.nullable(),
    statement_date: statementDay,
    closing_minor: z.number().int("The statement prints no closing balance"),
    bring_forward: z.boolean(),
  })
  .refine((v) => !v.bring_forward || (v.period_from !== null && v.opening_minor !== null), {
    message: "Bringing forward needs the statement's period and opening balance",
  });
export type ReconciliationFromStatementInput = z.infer<typeof reconciliationFromStatementSchema>;
```

- [ ] **Step 3: Write the failing test.** Create `tests/unit/reconcile-statement-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBroughtForwardPreview,
  getReconciliationStatement,
  pairAndTick,
  setReconciliationStatement,
} from "@/lib/services/bankrec";

/**
 * A stand-in for PostgREST: tables and table-returning RPCs page at a row cap
 * as PostgREST does; an RPC given as a function returns a single value and
 * records what it was called with.
 */
type Rows = Record<string, unknown>[];
type Scalar = (args: Record<string, unknown>) => unknown;

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows | Scalar>, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const orders: Record<string, string[]> = {};
  function builder(target: string, rows: Rows) {
    orders[target] = [];
    const page = (from: number, to: number) => ({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null });
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq"]) chain[name] = () => chain;
    chain.order = (column: string) => {
      orders[target].push(column);
      return chain;
    };
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve(page(0, cap - 1));
    return chain;
  }
  const sb = {
    from: (table: string) => builder(table, tables[table] ?? []),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = rpcs[fn];
      if (typeof answer === "function") return Promise.resolve({ data: answer(args), error: null });
      return builder(`rpc:${fn}`, answer ?? []);
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders };
}

const session = {
  bank_account_id: "bank-1",
  statement_ending_date: "2026-09-30",
  status: "in_progress",
  statement_ref: "september.pdf",
  statement_opening_minor: 75000,
  statement_closing_minor: null,
  note: null,
  brought_forward: false,
};
const bookLine = (id: string, date: string, signed: number, cleared: boolean, reference: string | null = null) => ({
  journal_line_id: id,
  entry_id: `e-${id}`,
  entry_number: `JE-${id}`,
  entry_date: date,
  source_type: "manual",
  memo: null,
  signed_minor: signed,
  cleared,
  reference,
});

describe("a reconciliation's kept statement", () => {
  it("reads every line past the row cap, in line order, with its balances as printed", async () => {
    const lines = Array.from({ length: 2400 }, (_, i) => ({
      line_no: i,
      txn_date: "2026-09-01",
      description: `Line ${i}`,
      reference: null,
      amount_minor: 100 + i,
      balance_minor: null,
    }));
    const { sb, orders } = fakeClient({ acc_statement_reconciliation: [session], acc_reconciliation_statement_line: lines }, {});
    const statement = await getReconciliationStatement(sb, "rec-1");
    expect(statement.lines).toHaveLength(2400);
    expect(orders.acc_reconciliation_statement_line).toEqual(["line_no"]);
    expect(statement).toMatchObject({
      bankAccountId: "bank-1",
      endingDate: "2026-09-30",
      fileName: "september.pdf",
      openingMinor: 75000,
      closingMinor: null,
      broughtForward: false,
    });
    expect(statement.lines[5]).toEqual({
      lineNo: 5, txnDate: "2026-09-01", description: "Line 5", reference: null, amountMinor: 105, balanceMinor: null,
    });
  });

  it("sends the lines as the database keeps them, leaving out a line of no amount", async () => {
    const { sb, calls } = fakeClient({}, { acc_set_reconciliation_statement: () => 1 });
    await setReconciliationStatement(sb, "rec-1", {
      fileName: "september.csv",
      openingMinor: null,
      closingMinor: null,
      lines: [
        { txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, running_balance_minor: 74500, raw_line: "x" },
        { txn_date: "2026-09-06", description: "NOTHING", reference: null, amount_minor: 0, running_balance_minor: 74500, raw_line: "y" },
      ],
    });
    expect(calls[0].args.p_lines).toEqual([
      { txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, balance_minor: 74500 },
    ]);
  });

  it("reads what bringing an account forward would sign off", async () => {
    const { sb } = fakeClient({}, {
      acc_brought_forward_preview: [{ has_reconciliations: false, book_balance_minor: "75000", open_lines: 2 }],
    });
    expect(await getBroughtForwardPreview(sb, "bank-1", "2026-08-31")).toEqual({
      hasReconciliations: false,
      bookBalanceMinor: 75000,
      openLines: 2,
    });
  });
});

describe("pairAndTick", () => {
  const statementLines = [
    { line_no: 0, txn_date: "2026-09-05", description: "DEPOSIT", reference: null, amount_minor: 50000, balance_minor: null },
    { line_no: 1, txn_date: "2026-09-28", description: "Check 1201", reference: "1201", amount_minor: -12000, balance_minor: null },
    { line_no: 2, txn_date: "2026-09-25", description: "SERVICE FEE", reference: null, amount_minor: -500, balance_minor: null },
  ];

  it("ticks, in one call, every pair not ticked yet — and counts what is missing", async () => {
    const { sb, calls } = fakeClient(
      { acc_statement_reconciliation: [session], acc_reconciliation_statement_line: statementLines },
      {
        acc_reconciliation_lines: [
          bookLine("a", "2026-09-05", 50000, true),
          bookLine("b", "2026-09-12", -12000, false, "1201"),
          bookLine("c", "2026-09-20", 9900, false),
        ],
        acc_set_cleared_many: (args) => (args.p_journal_line_ids as string[]).length,
      },
    );
    const outcome = await pairAndTick(sb, "rec-1");
    const ticking = calls.filter((c) => c.fn === "acc_set_cleared_many");
    expect(ticking).toHaveLength(1);
    expect(ticking[0].args).toEqual({ p_reconciliation_id: "rec-1", p_journal_line_ids: ["b"], p_cleared: true });
    expect(outcome).toEqual({ lines: 3, paired: 2, ticked: 1, missing: 1, after: 0, flipped: false });
  });

  it("makes no call when every pair is ticked already", async () => {
    const { sb, calls } = fakeClient(
      { acc_statement_reconciliation: [session], acc_reconciliation_statement_line: statementLines.slice(0, 1) },
      { acc_reconciliation_lines: [bookLine("a", "2026-09-05", 50000, true)], acc_set_cleared_many: () => 0 },
    );
    expect((await pairAndTick(sb, "rec-1")).ticked).toBe(0);
    expect(calls.some((c) => c.fn === "acc_set_cleared_many")).toBe(false);
  });
});
```

- [ ] **Step 4: Run it.**

Run: `npx vitest run tests/unit/reconcile-statement-service.test.ts`
Expected: FAIL — `getReconciliationStatement` (and the others) are not exported.

- [ ] **Step 5: The service.** Replace the whole of `lib/services/bankrec.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatementReconciliationRow } from "@/lib/db/types";
import { readAllPages } from "@/lib/services/paging";
import type { ReconciliationCreateInput, ReconciliationAdjustmentInput, ReconciliationReopenInput } from "@/lib/domain/schemas";
import type { StatementLine } from "@/lib/domain/statement-import";
import { reconciliationStandings, type BroughtForwardPreview, type PairingOutcome } from "@/lib/domain/reconcile-statement";

export class BankRecError extends Error {}

export interface ReconLineView {
  journalLineId: string; entryId: string; entryNumber: string | null; entryDate: string;
  sourceType: string; memo: string | null; signedMinor: number; cleared: boolean;
  /** The cheque number a statement pairs on: the entry's reference, else its payment's. */
  reference: string | null;
}

/** A statement line as a reconciliation keeps it. */
export interface ReconStatementLine {
  lineNo: number; txnDate: string; description: string; reference: string | null;
  amountMinor: number; balanceMinor: number | null;
}

/** A reconciliation's account and date, and the statement it is reconciled against. */
export interface ReconStatementHeader {
  bankAccountId: string; endingDate: string; status: string;
  fileName: string | null; openingMinor: number | null; closingMinor: number | null;
  note: string | null; broughtForward: boolean;
}

/** The statement a reconciliation is reconciled against, with its lines. */
export interface ReconStatement extends ReconStatementHeader {
  lines: ReconStatementLine[];
}

/** A statement file's figures and lines, as a reconciliation takes them. */
export interface StatementFileInput {
  fileName: string;
  openingMinor: number | null;
  closingMinor: number | null;
  lines: StatementLine[];
}
export interface ReconDetail {
  beginningMinor: number; statementEndingMinor: number; clearedTotalMinor: number;
  reconciledBalanceMinor: number; differenceMinor: number; status: string;
}
export interface DiscrepancyRow {
  reconciliationId: string; journalLineId: string; entryNumber: string | null; entryDate: string; signedMinor: number;
}

export async function createReconciliation(sb: SupabaseClient, input: ReconciliationCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_reconciliation", {
    p_bank_account_id: input.bank_account_id,
    p_ending_date: input.statement_ending_date,
    p_ending_balance_minor: input.statement_ending_balance_minor,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

export async function setCleared(sb: SupabaseClient, reconciliationId: string, journalLineId: string, cleared: boolean): Promise<void> {
  const { error } = await sb.rpc("acc_set_cleared", {
    p_reconciliation_id: reconciliationId, p_journal_line_id: journalLineId, p_cleared: cleared,
  });
  if (error) throw new BankRecError(error.message);
}

export async function recordAdjustment(sb: SupabaseClient, reconciliationId: string, input: ReconciliationAdjustmentInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_reconciliation_adjustment", {
    p_reconciliation_id: reconciliationId, p_offset_account_id: input.offset_account_id, p_reason: input.reason,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

export async function completeReconciliation(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_complete_reconciliation", { p_reconciliation_id: id });
  if (error) throw new BankRecError(error.message);
}

export async function reopenReconciliation(sb: SupabaseClient, id: string, input: ReconciliationReopenInput): Promise<void> {
  const { error } = await sb.rpc("acc_reopen_reconciliation", { p_reconciliation_id: id, p_reason: input.reason });
  if (error) throw new BankRecError(error.message);
}

export async function listReconciliations(sb: SupabaseClient, bankAccountId: string): Promise<StatementReconciliationRow[]> {
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("id,bank_account_id,statement_ending_date,beginning_balance_minor,statement_ending_balance_minor,status,adjustment_entry_id,adjustment_reason,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward,completed_at,created_at")
    .eq("bank_account_id", bankAccountId)
    .order("statement_ending_date", { ascending: false });
  if (error) throw new BankRecError(error.message);
  return (data ?? []) as unknown as StatementReconciliationRow[];
}

export async function getReconciliationLines(sb: SupabaseClient, id: string): Promise<ReconLineView[]> {
  // Paged past PostgREST's cap: an account with a thousand lines to the
  // statement date would otherwise show the first thousand and let the session
  // be ticked against a list that is not all there. The line id settles two
  // lines of one entry on the same account.
  const data = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_reconciliation_lines", { p_reconciliation_id: id })
        .order("entry_date")
        .order("entry_number")
        .order("journal_line_id")
        .range(from, to),
    (message) => new BankRecError(message),
  );
  return data.map((r: Record<string, unknown>) => ({
    journalLineId: r.journal_line_id as string, entryId: r.entry_id as string,
    entryNumber: (r.entry_number as string) ?? null, entryDate: r.entry_date as string,
    sourceType: r.source_type as string, memo: (r.memo as string) ?? null,
    signedMinor: Number(r.signed_minor), cleared: Boolean(r.cleared),
    reference: (r.reference as string) ?? null,
  }));
}

export async function getReconciliationDetail(sb: SupabaseClient, id: string): Promise<ReconDetail> {
  const { data, error } = await sb.rpc("acc_reconciliation_detail", { p_reconciliation_id: id });
  if (error) throw new BankRecError(error.message);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) throw new BankRecError("Reconciliation not found");
  return {
    beginningMinor: Number(r.beginning_minor), statementEndingMinor: Number(r.statement_ending_minor),
    clearedTotalMinor: Number(r.cleared_total_minor), reconciledBalanceMinor: Number(r.reconciled_balance_minor),
    differenceMinor: Number(r.difference_minor), status: r.status as string,
  };
}

export async function getDiscrepancies(sb: SupabaseClient, bankAccountId: string): Promise<DiscrepancyRow[]> {
  const { data, error } = await sb.rpc("acc_reconciliation_discrepancies", { p_bank_account_id: bankAccountId });
  if (error) throw new BankRecError(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    reconciliationId: r.reconciliation_id as string, journalLineId: r.journal_line_id as string,
    entryNumber: (r.entry_number as string) ?? null, entryDate: r.entry_date as string, signedMinor: Number(r.signed_minor),
  }));
}

// --- A reconciliation reconciled against its statement file -----------------

/** The lines as a reconciliation keeps them. A line of no amount moves no money and is not kept. */
function statementPayload(lines: readonly StatementLine[]) {
  return lines
    .filter((l) => l.amount_minor !== 0)
    .map((l) => ({
      txn_date: l.txn_date, description: l.description, reference: l.reference,
      amount_minor: l.amount_minor, balance_minor: l.running_balance_minor,
    }));
}

/** A reconciliation started from a statement: its date and ending balance are the statement's. */
export async function createReconciliationFromStatement(
  sb: SupabaseClient, bankAccountId: string, endingDate: string, endingMinor: number, file: StatementFileInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_reconciliation_from_statement", {
    p_bank_account_id: bankAccountId, p_ending_date: endingDate, p_ending_minor: endingMinor,
    p_file_name: file.fileName, p_opening_minor: file.openingMinor, p_lines: statementPayload(file.lines),
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

/** Replaces the statement a reconciliation in progress is reconciled against. */
export async function setReconciliationStatement(sb: SupabaseClient, id: string, file: StatementFileInput): Promise<number> {
  const { data, error } = await sb.rpc("acc_set_reconciliation_statement", {
    p_reconciliation_id: id, p_file_name: file.fileName, p_opening_minor: file.openingMinor,
    p_closing_minor: file.closingMinor, p_lines: statementPayload(file.lines),
  });
  if (error) throw new BankRecError(error.message);
  return Number(data);
}

export async function setStatementEnding(sb: SupabaseClient, id: string, endingMinor: number): Promise<void> {
  const { error } = await sb.rpc("acc_set_statement_ending", { p_reconciliation_id: id, p_ending_minor: endingMinor });
  if (error) throw new BankRecError(error.message);
}

/** Ticks or unticks many lines at once: every line passes acc_set_cleared's checks, or none changes. */
export async function setClearedMany(sb: SupabaseClient, id: string, journalLineIds: string[], cleared: boolean): Promise<number> {
  if (!journalLineIds.length) return 0;
  const { data, error } = await sb.rpc("acc_set_cleared_many", {
    p_reconciliation_id: id, p_journal_line_ids: journalLineIds, p_cleared: cleared,
  });
  if (error) throw new BankRecError(error.message);
  return Number(data);
}

export async function getBroughtForwardPreview(sb: SupabaseClient, bankAccountId: string, through: string): Promise<BroughtForwardPreview> {
  const { data, error } = await sb.rpc("acc_brought_forward_preview", { p_bank_account_id: bankAccountId, p_through: through });
  if (error) throw new BankRecError(error.message);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) throw new BankRecError("Bank account not found");
  return {
    hasReconciliations: Boolean(r.has_reconciliations),
    bookBalanceMinor: Number(r.book_balance_minor),
    openLines: Number(r.open_lines),
  };
}

/** The first reconciliation of an account, brought forward through `through` and signed by whoever asks. */
export async function bringForward(
  sb: SupabaseClient, bankAccountId: string, through: string, openingMinor: number, note: string,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_bring_forward_reconciliation", {
    p_bank_account_id: bankAccountId, p_through: through, p_opening_minor: openingMinor, p_note: note,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

const optionalMinor = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getReconciliationHeader(sb: SupabaseClient, id: string): Promise<ReconStatementHeader> {
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date,status,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward")
    .eq("id", id)
    .single();
  if (error) throw new BankRecError(error.message);
  const r = data as Record<string, unknown>;
  return {
    bankAccountId: r.bank_account_id as string,
    endingDate: r.statement_ending_date as string,
    status: r.status as string,
    fileName: (r.statement_ref as string) ?? null,
    openingMinor: optionalMinor(r.statement_opening_minor),
    closingMinor: optionalMinor(r.statement_closing_minor),
    note: (r.note as string) ?? null,
    broughtForward: Boolean(r.brought_forward),
  };
}

export async function getReconciliationStatement(sb: SupabaseClient, id: string): Promise<ReconStatement> {
  const [header, lines] = await Promise.all([
    getReconciliationHeader(sb, id),
    // Paged: a statement holds up to 5,000 lines, and line_no is unique within
    // a reconciliation, so the order is total.
    readAllPages<Record<string, unknown>>(
      (from, to) =>
        sb.from("acc_reconciliation_statement_line")
          .select("line_no,txn_date,description,reference,amount_minor,balance_minor")
          .eq("reconciliation_id", id)
          .order("line_no")
          .range(from, to),
      (message) => new BankRecError(message),
    ),
  ]);
  return {
    ...header,
    lines: lines.map((l) => ({
      lineNo: Number(l.line_no), txnDate: l.txn_date as string, description: (l.description as string) ?? "",
      reference: (l.reference as string) ?? null, amountMinor: Number(l.amount_minor), balanceMinor: optionalMinor(l.balance_minor),
    })),
  };
}

/**
 * Pairs the statement a reconciliation holds with the books as they are now,
 * and ticks every pair not ticked yet. No tick is removed, as in the prototype.
 */
export async function pairAndTick(sb: SupabaseClient, id: string): Promise<PairingOutcome> {
  const [statement, book] = await Promise.all([getReconciliationStatement(sb, id), getReconciliationLines(sb, id)]);
  const result = reconciliationStandings(statement, book);
  const toTick = result.standings.flatMap((s) => (s.kind === "paired" && !s.ticked ? [s.bookId] : []));
  const ticked = await setClearedMany(sb, id, toTick, true);
  return {
    lines: statement.lines.length, paired: result.paired, ticked,
    missing: result.missing, after: result.after, flipped: result.flipped,
  };
}
```

- [ ] **Step 6: Run the tests.**

Run: `npx vitest run tests/unit/reconcile-statement-service.test.ts tests/unit/banking-paged-reads.test.ts`
Expected: both files pass (reconcile-statement-service: 5 passed).

- [ ] **Step 7: Typecheck, lint, commit.**

Run: `npm run typecheck` — Expected: no errors.
Run: `npx eslint lib/services/bankrec.ts lib/domain/schemas.ts lib/db/types.ts tests/unit/reconcile-statement-service.test.ts` — Expected: prints nothing.

```bash
git add lib/db/types.ts lib/domain/schemas.ts lib/services/bankrec.ts tests/unit/reconcile-statement-service.test.ts
printf 'feat(reconcile): read and write the statement a reconciliation holds\n\nStart from a statement, replace it, take its closing balance, bring the\nfirst reconciliation forward, and pair and tick in one call. The kept\nlines are read past the row cap.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: Starting a reconciliation from a PDF statement

**Files:**
- Modify: `lib/client/pdf-text.ts` (whole file below)
- Create: `app/(app)/banking/PdfStatementPreview.tsx`
- Modify: `app/(app)/banking/ImportStatementModal.tsx` (whole file below)
- Create: `app/(app)/banking/reconcile/statement-actions.ts` (this task's version; Task 6 replaces it)
- Create: `app/(app)/banking/reconcile/StartFromStatementModal.tsx`
- Modify: `app/(app)/banking/reconcile/ReconcileListClient.tsx` (whole file below)
- Modify: `app/(app)/banking/reconcile/page.tsx` (whole file below)

**Interfaces:**
- Consumes: Task 3's `bringForwardAdvice`, `broughtForwardNote`, `dayBefore`, `pairingMessage`, `BringForwardAdvice`, `BroughtForwardPreview`, `PairingOutcome`; Task 4's services and schemas; 1.78's `readPdfStatements`, `toStatementLines`, `PdfStatement`, `PDF_MESSAGES`, `pickStatement`, `summarizeStatement`, `periodLabel`, `statementLabel`, `skippedNote`; `accountNumberDiffers` from `lib/domain/statement-files.ts`; `importStatement`, `generateSuggestions` from `lib/services/banking.ts`; `ActionResult` from `app/(app)/banking/reconcile/actions.ts`.
- Produces:
  - `readPdfStatementFile(file: File, decimals: number): Promise<{ statements: PdfStatement[] } | { message: string }>` in `lib/client/pdf-text.ts`.
  - `PdfStatementPreview` (default) with props `{ fileName, statements, picked, onPick, pickPrompt, money, children? }`, and `WrongAccountAlert({ description })`.
  - `ImportStatementModalProps.onConfirm(fileName, rows, statement: PdfStatement | null)` and an optional `intro` prop. Banking's own call is unchanged.
  - In `statement-actions.ts`: `StatementImportSummary { inserted; duplicates; outcome }`, `StartFromStatementSummary { id; broughtForward } & StatementImportSummary`, `startReconciliationFromStatementAction(raw): Promise<ActionResult<StartFromStatementSummary>>`, `broughtForwardPreviewAction(bankAccountId, through): Promise<ActionResult<BroughtForwardPreview>>`.
  - The list page passes each bank as `{ id, label, maskedNumber, currencyCode }`.

- [ ] **Step 1: Reading a PDF statement file, once.** Replace the whole of `lib/client/pdf-text.ts` with:

```ts
/**
 * A PDF's text, read in the browser, for Import statement.
 *
 * pdf.js comes from OneBook's own bundle the first time a PDF is chosen — not
 * from a CDN at run time, as the prototype fetched version 3.11.174. Its worker
 * is pdf.js's own self-contained module, which the build copies next to the app
 * and pdf.js starts itself. Version 6 compiles no script out of a PDF: the font
 * path behind CVE-2024-4367, which 3.11.174 carries, is gone. The file never
 * leaves the browser; only the lines read are sent.
 */
import { readPdfStatements, type PdfGlyph, type PdfStatement } from "@/lib/domain/pdf-statement";
import { glyphsFromDocument, pdfFailure, type PdfReadFailure } from "@/lib/domain/pdf-glyphs";
import { PDF_MESSAGES } from "@/lib/domain/pdf-statement-view";

export async function readPdfGlyphs(data: ArrayBuffer): Promise<{ glyphs: PdfGlyph[] } | { failure: PdfReadFailure }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  try {
    return { glyphs: await glyphsFromDocument(await task.promise) };
  } catch (error) {
    return { failure: pdfFailure(error) };
  } finally {
    await task.destroy();
  }
}

/**
 * A PDF file read into the statements it holds that have lines, or the
 * sentence that says why it cannot be. `decimals` is the account currency's:
 * a PDF is read in cents.
 */
export async function readPdfStatementFile(
  file: File,
  decimals: number,
): Promise<{ statements: PdfStatement[] } | { message: string }> {
  if (decimals !== 2) return { message: PDF_MESSAGES.cents };
  const result = await readPdfGlyphs(await file.arrayBuffer());
  if ("failure" in result) return { message: PDF_MESSAGES[result.failure] };
  if (!result.glyphs.length) return { message: PDF_MESSAGES.scanned };
  const statements = readPdfStatements(result.glyphs).filter((s) => s.lines.length > 0);
  return statements.length ? { statements } : { message: PDF_MESSAGES.noLines };
}
```

- [ ] **Step 2: The statement preview, shared.** Create `app/(app)/banking/PdfStatementPreview.tsx`:

```tsx
"use client";
import type { ReactNode } from "react";
import { Alert, Select, Typography } from "antd";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import { periodLabel, skippedNote, statementLabel, summarizeStatement } from "@/lib/domain/pdf-statement-view";

/**
 * A PDF statement as read, before it is used: which statement (a PDF can hold
 * several), its period, its opening and closing balances, money in and out, and
 * whether the opening balance plus the lines comes to the closing balance.
 * Import statement and starting a reconciliation from a PDF both show it.
 */
export interface PdfStatementPreviewProps {
  fileName: string;
  statements: PdfStatement[];
  picked: number;
  onPick: (index: number) => void;
  /** Said above the list when the PDF holds several statements. */
  pickPrompt: string;
  money: (minor: number) => string;
  /** Shown between the list and the figures: a warning about the chosen statement. */
  children?: ReactNode;
}

/** The warning when a file names an account other than the one it is used for. */
export function WrongAccountAlert({ description }: { description: string }) {
  return (
    <Alert style={{ marginTop: 12 }} type="warning" showIcon title="This file names a different account" description={description} />
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
        {label}
      </Typography.Text>
      <Typography.Text strong>{value}</Typography.Text>
    </div>
  );
}

export default function PdfStatementPreview({
  fileName,
  statements,
  picked,
  onPick,
  pickPrompt,
  money,
  children,
}: PdfStatementPreviewProps) {
  const statement = statements[picked] ?? statements[0];
  const summary = summarizeStatement(statement, money);
  return (
    <>
      {statements.length > 1 ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            This PDF holds {statements.length} statements. {pickPrompt}
          </Typography.Text>
          <Select
            aria-label="Statement"
            style={{ width: "100%" }}
            value={picked}
            onChange={(value: number) => onPick(value)}
            options={statements.map((s, i) => ({ value: i, label: statementLabel(s) }))}
          />
        </div>
      ) : null}

      {children}

      <div style={{ marginTop: 12 }}>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <strong>{fileName}</strong> (PDF): {periodLabel(statement.from, statement.to)}
        </Typography.Paragraph>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          <Figure label="Opening balance" value={statement.openingMinor === null ? "—" : money(statement.openingMinor)} />
          <Figure label={`Money in · ${summary.moneyIn.count}`} value={money(summary.moneyIn.minor)} />
          <Figure label={`Money out · ${summary.moneyOut.count}`} value={money(summary.moneyOut.minor)} />
          <Figure label="Closing balance" value={statement.closingMinor === null ? "—" : money(statement.closingMinor)} />
        </div>
        <Alert style={{ marginTop: 8 }} type={summary.proves ? "success" : "warning"} showIcon title={summary.proof} />
        {statement.skipped > 0 ? (
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
            {skippedNote(statement.skipped)}
          </Typography.Text>
        ) : null}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Import statement uses both.** Replace the whole of `app/(app)/banking/ImportStatementModal.tsx` with:

```tsx
"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Checkbox, Modal, Select, Space, Spin, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { parseCsv } from "@/lib/csv";
import {
  describeStatementParse,
  detectDateOrder,
  detectStatementColumns,
  parseStatementRows,
  statementColumnsComplete,
  type DateOrder,
  type StatementColumnMap,
  type StatementLine,
  type StatementParseResult,
} from "@/lib/domain/statement-import";
import {
  accountNumberDiffers,
  detectStatementFormat,
  parseOfx,
  parseQif,
  type StatementFileResult,
} from "@/lib/domain/statement-files";
import { toStatementLines, type PdfStatement } from "@/lib/domain/pdf-statement";
import { pickStatement, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";
import PdfStatementPreview, { WrongAccountAlert } from "./PdfStatementPreview";

/**
 * The statement import dialog, in its own file so it is fetched when somebody
 * opens it rather than when they open /banking.
 *
 * It reads the file in the browser — a PDF statement, CSV, OFX, QFX, QBO or QIF
 * — and, for a CSV whose headings it does not know, asks which column is which.
 * A PDF is read by its layout, so it needs no columns; before importing, the
 * dialog shows whether its opening balance plus the lines read comes to its
 * closing balance. The import itself is a server action of the screen that
 * opened the dialog: Banking opens Review import after it, and a
 * reconciliation pairs the lines with the books.
 */
export interface ImportStatementModalProps {
  open: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  importing: boolean;
  /** `statement` is the PDF statement imported, with its period and balances; null for any other file. */
  onConfirm: (fileName: string, rows: StatementLine[], statement: PdfStatement | null) => void;
  onCancel: () => void;
  /** What happens to the lines, said above the file picker. */
  intro?: ReactNode;
}

const BANKING_INTRO =
  "Choose the file your bank gives you: a PDF statement, a CSV, or a Quicken or QuickBooks download (.ofx, .qfx, " +
  ".qbo, .qif). After the import, Review import proposes an account, a match or a document for every line, and " +
  "nothing is posted until you click Post.";

interface CsvState {
  kind: "csv";
  headers: string[];
  records: Record<string, string>[];
}
type FileState =
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "unsupported"; message: string }
  | CsvState
  | { kind: "file"; format: "OFX" | "QIF"; result: StatementFileResult }
  | { kind: "pdf"; statements: PdfStatement[] };

interface CsvChoice {
  columns: StatementColumnMap;
  dateOrder: DateOrder;
  flipSigns: boolean;
}

const storageKey = (bankAccountId: string) => `onebook.statement-columns.${bankAccountId}`;
const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

function rememberedChoice(bankAccountId: string, headers: string[]): CsvChoice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(bankAccountId)) ?? "null") as CsvChoice | null;
    if (!saved) return null;
    const used = Object.values(saved.columns).filter((c): c is string => Boolean(c));
    return used.every((c) => headers.includes(c)) ? saved : null;
  } catch {
    return null;
  }
}

const COLUMN_FIELDS: { key: keyof StatementColumnMap; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description" },
  { key: "amount", label: "Amount (one signed column)" },
  { key: "moneyOut", label: "Money out" },
  { key: "moneyIn", label: "Money in" },
  { key: "reference", label: "Reference" },
  { key: "balance", label: "Balance" },
];

export default function ImportStatementModal({
  open,
  bankAccount,
  importing,
  onConfirm,
  onCancel,
  intro = BANKING_INTRO,
}: ImportStatementModalProps) {
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [choice, setChoice] = useState<CsvChoice | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [picked, setPicked] = useState(0);
  // A PDF is read asynchronously; choosing another file meanwhile makes the first answer stale.
  const reading = useRef(0);

  async function readPdf(chosen: File, token: number) {
    setFile({ kind: "reading" });
    const { readPdfStatementFile } = await import("@/lib/client/pdf-text");
    const result = await readPdfStatementFile(chosen, bankAccount.decimals);
    if (token !== reading.current) return;
    if ("message" in result) {
      setFile({ kind: "unsupported", message: result.message });
      return;
    }
    setPicked(pickStatement(result.statements, bankAccount.maskedNumber));
    setFile({ kind: "pdf", statements: result.statements });
  }

  function read(chosen: File) {
    const token = ++reading.current;
    setFileName(chosen.name);
    setShowColumns(false);
    setChoice(null);
    if (isPdfFile(chosen)) {
      void readPdf(chosen, token);
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (token !== reading.current) return;
      const text = String(reader.result ?? "");
      const verdict = detectStatementFormat(chosen.name, text);
      if ("unsupported" in verdict) {
        setFile({ kind: "unsupported", message: verdict.unsupported });
        return;
      }
      if (verdict.format === "pdf") {
        void readPdf(chosen, token);
        return;
      }
      if (verdict.format === "ofx") {
        setFile({ kind: "file", format: "OFX", result: parseOfx(text, bankAccount.decimals) });
        return;
      }
      if (verdict.format === "qif") {
        setFile({ kind: "file", format: "QIF", result: parseQif(text, { decimals: bankAccount.decimals }) });
        return;
      }
      const records = parseCsv(text);
      const headers = records.length ? Object.keys(records[0]) : [];
      const detected = detectStatementColumns(headers);
      const remembered = rememberedChoice(bankAccount.id, headers);
      const next: CsvChoice = remembered ?? {
        columns: detected.columns,
        dateOrder: detectDateOrder(records.map((r) => (detected.columns.date ? r[detected.columns.date] ?? "" : ""))),
        flipSigns: false,
      };
      setFile({ kind: "csv", headers, records });
      setChoice(next);
      setShowColumns(!statementColumnsComplete(next.columns));
    };
    reader.readAsText(chosen);
    return false;
  }

  const parsed: (StatementParseResult & { accountId?: string | null }) | null = useMemo(() => {
    if (file.kind === "file") return file.result;
    if (file.kind === "csv" && choice && statementColumnsComplete(choice.columns)) {
      return parseStatementRows(file.records, {
        decimals: bankAccount.decimals,
        columns: choice.columns,
        dateOrder: choice.dateOrder,
        flipSigns: choice.flipSigns,
      });
    }
    return null;
  }, [file, choice, bankAccount.decimals]);

  const statement = file.kind === "pdf" ? (file.statements[picked] ?? file.statements[0]) : null;
  const rows: StatementLine[] = useMemo(
    () => (statement ? toStatementLines(statement) : (parsed?.rows ?? [])),
    [statement, parsed],
  );
  const money = (minor: number) => formatMoney(minor, bankAccount.currencyCode, bankAccount.decimals);
  const summary = statement ? summarizeStatement(statement, money) : null;
  const fileAccount = file.kind === "file" ? file.result.accountId : (statement?.accountNumber ?? null);
  const wrongAccount = accountNumberDiffers(fileAccount, bankAccount.maskedNumber);
  const wrongAccountText = `The file is for an account ending ${(fileAccount ?? "").slice(-4)}, and you are importing into ${bankAccount.label}. Check before importing.`;

  const okText = !rows.length
    ? "Import"
    : summary
      ? `Import ${rows.length} line${rows.length === 1 ? "" : "s"}${summary.proves ? "" : " anyway"}`
      : `Import ${rows.length} rows`;

  function confirm() {
    if (!rows.length) return;
    if (file.kind === "csv" && choice) {
      try {
        localStorage.setItem(storageKey(bankAccount.id), JSON.stringify(choice));
      } catch {
        // Remembering the columns is a convenience; the import does not need it.
      }
    }
    onConfirm(fileName, rows, statement);
  }

  // Choosing the date column reads that column again for which way round its
  // dates are written; the reader can still override it.
  const setColumn = (key: keyof StatementColumnMap, value: string | null) =>
    setChoice((current) => {
      if (!current) return current;
      const dateOrder =
        key === "date" && value && file.kind === "csv"
          ? detectDateOrder(file.records.map((record) => record[value] ?? ""))
          : current.dateOrder;
      return { ...current, columns: { ...current.columns, [key]: value }, dateOrder };
    });

  return (
    <Modal
      title={`Import a statement into ${bankAccount.label}`}
      open={open}
      onOk={confirm}
      onCancel={onCancel}
      okText={okText}
      okButtonProps={{ disabled: !rows.length, loading: importing }}
      cancelText="Cancel"
      width={720}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{intro}</Typography.Paragraph>
      <Upload.Dragger
        accept=".pdf,.csv,.txt,.ofx,.qfx,.qbo,.qif,application/pdf"
        beforeUpload={read}
        maxCount={1}
        showUploadList={{ showRemoveIcon: false }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag a statement file here</p>
      </Upload.Dragger>

      {file.kind === "reading" ? (
        <Space style={{ marginTop: 12 }}>
          <Spin size="small" />
          <Typography.Text type="secondary">Reading the PDF…</Typography.Text>
        </Space>
      ) : null}

      {file.kind === "unsupported" ? (
        <Alert style={{ marginTop: 12 }} type="error" showIcon title="This file cannot be read" description={file.message} />
      ) : null}

      {file.kind === "csv" && choice ? (
        <div style={{ marginTop: 12 }}>
          {showColumns ? (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Typography.Text strong>Choose columns</Typography.Text>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                {/* A div, not a label: a label forwards the click to the select
                    inside it, which opens the list and closes it again. */}
                {COLUMN_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {field.label}
                    </Typography.Text>
                    <Select
                      aria-label={field.label}
                      style={{ width: "100%" }}
                      allowClear={!field.required}
                      placeholder="None"
                      value={choice.columns[field.key] ?? undefined}
                      onChange={(value: string | undefined) => setColumn(field.key, value ?? null)}
                      options={file.headers.map((h) => ({ value: h, label: h }))}
                    />
                  </div>
                ))}
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Dates
                  </Typography.Text>
                  <Select
                    aria-label="Dates"
                    style={{ width: "100%" }}
                    value={choice.dateOrder}
                    onChange={(value: DateOrder) => setChoice({ ...choice, dateOrder: value })}
                    options={[
                      { value: "mdy", label: "Month/Day/Year" },
                      { value: "dmy", label: "Day/Month/Year" },
                    ]}
                  />
                </div>
              </div>
              <Checkbox checked={choice.flipSigns} onChange={(e) => setChoice({ ...choice, flipSigns: e.target.checked })}>
                Flip signs: my file shows payments as positive
              </Checkbox>
              {!statementColumnsComplete(choice.columns) ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  Choose the date column, and an amount column or money out and money in.
                </Typography.Text>
              ) : null}
            </Space>
          ) : (
            <Button type="link" style={{ padding: 0 }} onClick={() => setShowColumns(true)}>
              Choose columns
            </Button>
          )}
        </div>
      ) : null}

      {wrongAccount && file.kind !== "pdf" ? <WrongAccountAlert description={wrongAccountText} /> : null}

      {file.kind === "pdf" ? (
        <PdfStatementPreview
          fileName={fileName}
          statements={file.statements}
          picked={picked}
          onPick={setPicked}
          pickPrompt="Import the one for:"
          money={money}
        >
          {wrongAccount ? <WrongAccountAlert description={wrongAccountText} /> : null}
        </PdfStatementPreview>
      ) : null}

      {parsed && !statement ? (
        <div style={{ marginTop: 12 }}>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>{fileName}</strong>
            {file.kind === "file" ? ` (${file.format})` : " (CSV)"}: {describeStatementParse(parsed)}
          </Typography.Paragraph>
        </div>
      ) : null}

      {rows.length ? (
        <div style={{ marginTop: 4 }}>
          {rows.slice(0, 3).map((row, i) => (
            <Typography.Text key={i} type="secondary" style={{ display: "block", fontSize: 12 }}>
              {row.txn_date} · {row.description} · {(row.amount_minor / 10 ** bankAccount.decimals).toFixed(bankAccount.decimals)}
            </Typography.Text>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 4: The server actions for starting from a statement.** Create `app/(app)/banking/reconcile/statement-actions.ts`:

```ts
"use server";
/**
 * A reconciliation reconciled against its statement file: starting one from a
 * PDF statement, bringing an account's first reconciliation forward, keeping
 * the statement with the reconciliation and pairing its lines with the books.
 * The session itself — ticking, completing, reopening — is in actions.ts.
 */
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  reconciliationFromStatementSchema, type ReconciliationStatementInput,
} from "@/lib/domain/schemas";
import {
  createReconciliationFromStatement, getBroughtForwardPreview, bringForward, pairAndTick,
  BankRecError, type StatementFileInput,
} from "@/lib/services/bankrec";
import { generateSuggestions, importStatement } from "@/lib/services/banking";
import {
  broughtForwardNote, dayBefore, type BroughtForwardPreview, type PairingOutcome,
} from "@/lib/domain/reconcile-statement";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export interface StatementImportSummary {
  /** New lines in Bank Transactions; a line already there is a duplicate. */
  inserted: number;
  duplicates: number;
  outcome: PairingOutcome;
}

function statementFile(input: ReconciliationStatementInput): StatementFileInput {
  return {
    fileName: input.file_name,
    openingMinor: input.opening_minor,
    closingMinor: input.closing_minor,
    lines: input.lines,
  };
}

/**
 * The statement's lines go into Bank Transactions as Import statement puts
 * them there — the same path and the same duplicate rule — and its matches are
 * looked for, so Review import can code what the books do not have. A failure
 * finding matches costs the proposals, not the import.
 */
async function importIntoBankTransactions(
  sb: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  bankAccountId: string,
  file: StatementFileInput,
) {
  const imported = await importStatement(sb, bankAccountId, file.fileName, file.lines);
  if (imported.inserted > 0) {
    await generateSuggestions(sb, bankAccountId).catch((err) =>
      console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
    );
  }
  return imported;
}

export interface StartFromStatementSummary extends StatementImportSummary {
  id: string;
  broughtForward: boolean;
}

/**
 * A reconciliation started from a PDF statement: the statement's last day is
 * its date and its closing balance the ending balance. On the account's first
 * reconciliation, when the person asks, the earlier lines are brought forward
 * first — refused by the database unless the books agree with the statement's
 * opening balance.
 */
export async function startReconciliationFromStatementAction(
  raw: unknown,
): Promise<ActionResult<StartFromStatementSummary>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = reconciliationFromStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const input = parsed.data;
  const file = statementFile(input);
  let broughtForward = false;
  try {
    const sb = await createSupabaseServerClient();
    if (input.bring_forward && input.period_from && input.opening_minor !== null) {
      await bringForward(
        sb,
        input.bank_account_id,
        dayBefore(input.period_from),
        input.opening_minor,
        broughtForwardNote(input.period_from, input.statement_date),
      );
      broughtForward = true;
    }
    const id = await createReconciliationFromStatement(
      sb, input.bank_account_id, input.statement_date, input.closing_minor, file,
    );
    const imported = await importIntoBankTransactions(sb, input.bank_account_id, file);
    const outcome = await pairAndTick(sb, id);
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return { ok: true, data: { id, broughtForward, inserted: imported.inserted, duplicates: imported.skipped, outcome } };
  } catch (e) {
    revalidatePath("/banking/reconcile");
    // Bringing forward is its own step: when what follows fails, the account
    // stays brought forward and the dialog offers Start.
    return {
      ok: false,
      error: broughtForward ? `The earlier lines were brought forward, but the reconciliation was not started: ${msg(e)}` : msg(e),
    };
  }
}

/** What bringing an account forward through a day would sign off. Read only. */
export async function broughtForwardPreviewAction(
  bankAccountId: string,
  through: string,
): Promise<ActionResult<BroughtForwardPreview>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getBroughtForwardPreview(sb, bankAccountId, through) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 5: The dialog.** Create `app/(app)/banking/reconcile/StartFromStatementModal.tsx`:

```tsx
"use client";
import { useRef, useState } from "react";
import { Alert, App, Modal, Space, Spin, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { toStatementLines, type PdfStatement } from "@/lib/domain/pdf-statement";
import { pickStatement, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { bringForwardAdvice, dayBefore, type BringForwardAdvice } from "@/lib/domain/reconcile-statement";
import { accountNumberDiffers } from "@/lib/domain/statement-files";
import { formatMoney } from "@/lib/format";
import PdfStatementPreview, { WrongAccountAlert } from "../PdfStatementPreview";
import {
  broughtForwardPreviewAction,
  startReconciliationFromStatementAction,
  type StartFromStatementSummary,
} from "./statement-actions";

/**
 * Starting a reconciliation from a PDF statement, in its own file so pdf.js and
 * the dialog are fetched when somebody opens it.
 *
 * The statement's last day is the reconciliation's date and its closing balance
 * the ending balance — nothing retyped. On an account never reconciled, the
 * books on the day before the statement's period are set beside the opening
 * balance the statement prints; when they agree, the earlier lines can be
 * brought forward as reconciled, as the prototype does, and the button says so.
 */
export interface StartFromStatementModalProps {
  open: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  onStarted: (summary: StartFromStatementSummary) => void;
  onCancel: () => void;
}

type FileState =
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "unsupported"; message: string }
  | { kind: "pdf"; statements: PdfStatement[] };

const NO_FIGURES =
  "This statement prints no statement date or no closing balance, so a reconciliation cannot be started from it. " +
  "Start one with New reconciliation and import the file inside it.";

export default function StartFromStatementModal({ open, bankAccount, onStarted, onCancel }: StartFromStatementModalProps) {
  const { message } = App.useApp();
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [picked, setPicked] = useState(0);
  const [advice, setAdvice] = useState<BringForwardAdvice | null>(null);
  const [starting, setStarting] = useState(false);
  // Reading and asking the books are asynchronous; a later choice makes an earlier answer stale.
  const reading = useRef(0);
  const asking = useRef(0);
  const money = (minor: number) => formatMoney(minor, bankAccount.currencyCode, bankAccount.decimals);

  async function advise(statement: PdfStatement) {
    const token = ++asking.current;
    setAdvice(null);
    if (!statement.from || statement.openingMinor === null) return;
    const res = await broughtForwardPreviewAction(bankAccount.id, dayBefore(statement.from));
    if (token !== asking.current) return;
    if (res.ok && res.data) setAdvice(bringForwardAdvice(res.data, statement, money));
    else message.error(res.error ?? "The books could not be read for the statement's opening balance");
  }

  async function readFile(chosen: File) {
    const token = ++reading.current;
    setFileName(chosen.name);
    setFile({ kind: "reading" });
    setAdvice(null);
    const { readPdfStatementFile } = await import("@/lib/client/pdf-text");
    const result = await readPdfStatementFile(chosen, bankAccount.decimals);
    if (token !== reading.current) return;
    if ("message" in result) {
      setFile({ kind: "unsupported", message: result.message });
      return;
    }
    const index = pickStatement(result.statements, bankAccount.maskedNumber);
    setPicked(index);
    setFile({ kind: "pdf", statements: result.statements });
    void advise(result.statements[index]);
  }

  function pick(index: number) {
    setPicked(index);
    if (file.kind === "pdf") void advise(file.statements[index]);
  }

  const statement = file.kind === "pdf" ? (file.statements[picked] ?? file.statements[0]) : null;
  const usable = Boolean(statement && statement.to && statement.closingMinor !== null);
  const proves = statement ? summarizeStatement(statement, money).proves : false;
  const wrongAccount = accountNumberDiffers(statement?.accountNumber ?? null, bankAccount.maskedNumber);
  const okText = `${advice?.canBringForward ? "Bring forward and start" : "Start"}${statement && !proves ? " anyway" : ""}`;

  async function start() {
    if (!statement || !statement.to || statement.closingMinor === null) return;
    setStarting(true);
    const res = await startReconciliationFromStatementAction({
      bank_account_id: bankAccount.id,
      file_name: fileName,
      period_from: statement.from,
      statement_date: statement.to,
      opening_minor: statement.openingMinor,
      closing_minor: statement.closingMinor,
      bring_forward: advice?.canBringForward ?? false,
      lines: toStatementLines(statement),
    });
    setStarting(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "The reconciliation could not be started");
      return;
    }
    onStarted(res.data);
  }

  return (
    <Modal
      title={`Reconcile ${bankAccount.label} from a PDF statement`}
      open={open}
      onOk={() => void start()}
      onCancel={onCancel}
      okText={okText}
      okButtonProps={{ disabled: !usable, loading: starting }}
      cancelText="Cancel"
      width={720}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Choose the statement&apos;s PDF. The reconciliation takes the statement&apos;s last day as its date and its closing
        balance as its ending balance. The lines are imported into Bank Transactions, kept with the reconciliation and
        paired with the books, and every pair is ticked. Nothing is posted, and nothing is completed until you click
        Complete.
      </Typography.Paragraph>
      <Upload.Dragger
        accept=".pdf,application/pdf"
        beforeUpload={(chosen) => {
          void readFile(chosen);
          return false;
        }}
        maxCount={1}
        showUploadList={{ showRemoveIcon: false }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag a PDF statement here</p>
      </Upload.Dragger>

      {file.kind === "reading" ? (
        <Space style={{ marginTop: 12 }}>
          <Spin size="small" />
          <Typography.Text type="secondary">Reading the PDF…</Typography.Text>
        </Space>
      ) : null}

      {file.kind === "unsupported" ? (
        <Alert style={{ marginTop: 12 }} type="error" showIcon title="This file cannot be read" description={file.message} />
      ) : null}

      {file.kind === "pdf" ? (
        <PdfStatementPreview
          fileName={fileName}
          statements={file.statements}
          picked={picked}
          onPick={pick}
          pickPrompt="Reconcile the one for:"
          money={money}
        >
          {wrongAccount ? (
            <WrongAccountAlert
              description={`The file is for an account ending ${(statement?.accountNumber ?? "").slice(-4)}, and you are reconciling ${bankAccount.label}. Check before starting.`}
            />
          ) : null}
        </PdfStatementPreview>
      ) : null}

      {statement && !usable ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={NO_FIGURES} /> : null}

      {usable && advice ? (
        <Alert
          style={{ marginTop: 12 }}
          type={advice.canBringForward ? "info" : "warning"}
          showIcon
          title={advice.canBringForward ? "The first reconciliation of this account" : "The earlier lines stay open"}
          description={advice.text}
        />
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 6: The list.** Replace the whole of `app/(app)/banking/reconcile/ReconcileListClient.tsx` with:

```tsx
"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { pairingMessage } from "@/lib/domain/reconcile-statement";
import { createReconciliationAction, listReconciliationsAction } from "./actions";
import type { StartFromStatementSummary } from "./statement-actions";
import type { StatementReconciliationRow } from "@/lib/db/types";

/** Fetched, with pdf.js, when somebody starts from a PDF rather than when they open the list. */
const StartFromStatementModal = dynamic(() => import("./StartFromStatementModal"), { ssr: false });

interface Bank {
  id: string;
  label: string;
  maskedNumber: string | null;
  currencyCode: string;
}
interface Props {
  canWrite: boolean;
  banks: Bank[];
  baseDecimals: number;
}

export default function ReconcileListClient({ canWrite, banks, baseDecimals }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const [bankId, setBankId] = useState<string | undefined>(banks[0]?.id);
  const [rows, setRows] = useState<StatementReconciliationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [fromPdfOpen, setFromPdfOpen] = useState(false);
  const bank = banks.find((b) => b.id === bankId);
  const [form] = Form.useForm();

  const load = async (id: string | undefined) => {
    if (!id) return;
    setLoading(true);
    const r = await listReconciliationsAction(id);
    setLoading(false);
    if (r.ok && r.data) setRows(r.data);
    else message.error(r.error ?? "Failed to load");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(bankId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const submit = async () => {
    const v = await form.validateFields();
    const r = await createReconciliationAction({
      bank_account_id: bankId,
      statement_ending_date: v.ending_date.format("YYYY-MM-DD"),
      statement_ending_balance_minor: toMinor(v.ending_balance ?? 0, baseDecimals),
    });
    if (r.ok) {
      message.success("Reconciliation started");
      setOpen(false);
      form.resetFields();
      void load(bankId);
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  const started = (summary: StartFromStatementSummary) => {
    setFromPdfOpen(false);
    message.success(
      `${summary.broughtForward ? "The earlier lines were brought forward and the reconciliation started" : "Reconciliation started"}. ` +
        pairingMessage(summary.outcome),
      8,
    );
    router.push(`/banking/reconcile/${summary.id}`);
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <Select
          style={{ width: 320 }}
          value={bankId}
          onChange={setBankId}
          options={banks.map((b) => ({ value: b.id, label: b.label }))}
        />
        {canWrite && (
          <Button type="primary" onClick={() => setOpen(true)} disabled={!bankId}>
            New reconciliation
          </Button>
        )}
        {canWrite && (
          <Button onClick={() => setFromPdfOpen(true)} disabled={!bankId}>
            From a PDF statement
          </Button>
        )}
      </Space>
      <Table<StatementReconciliationRow>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: "Ending date", dataIndex: "statement_ending_date" },
          { title: "Beginning", align: "right", render: (_, r) => fmt(r.beginning_balance_minor) },
          { title: "Statement ending", align: "right", render: (_, r) => fmt(r.statement_ending_balance_minor) },
          { title: "Statement", render: (_, r) => r.statement_ref ?? "—" },
          {
            title: "Status",
            render: (_, r) => (
              <Space size={4} wrap>
                <Tag color={r.status === "completed" ? "green" : "blue"}>{r.status}</Tag>
                {r.brought_forward ? (
                  <Tag color="purple" title={r.note ?? undefined}>
                    Brought forward
                  </Tag>
                ) : null}
              </Space>
            ),
          },
          { title: "", render: (_, r) => <Link href={`/banking/reconcile/${r.id}`}>Open</Link> },
        ]}
      />
      <Modal open={open} title="New reconciliation" onCancel={() => setOpen(false)} onOk={submit} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="ending_date" label="Statement ending date" rules={[{ required: true }]}>
            <DatePicker />
          </Form.Item>
          <Form.Item name="ending_balance" label="Statement ending balance" rules={[{ required: true }]}>
            <InputNumber style={{ width: 200 }} precision={baseDecimals} />
          </Form.Item>
        </Form>
      </Modal>
      {fromPdfOpen && bank ? (
        <StartFromStatementModal
          open={fromPdfOpen}
          bankAccount={{
            id: bank.id,
            label: bank.label,
            maskedNumber: bank.maskedNumber,
            decimals: baseDecimals,
            currencyCode: bank.currencyCode,
          }}
          onStarted={started}
          onCancel={() => setFromPdfOpen(false)}
        />
      ) : null}
    </Space>
  );
}
```

Replace the whole of `app/(app)/banking/reconcile/page.tsx` with:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listBankAccounts } from "@/lib/services/banking";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReconcileListClient from "./ReconcileListClient";

export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [banks, currencies] = await Promise.all([listBankAccounts(sb), listCurrencies(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader title="Bank Reconciliation" description="Reconcile a bank account to its statement ending balance." />
      <ReconcileListClient
        canWrite={canWrite(role)}
        banks={banks.map((b) => ({
          id: b.id,
          label: `${b.bank_name} · ${b.account_number_masked ?? ""}`.trim(),
          maskedNumber: b.account_number_masked,
          currencyCode: b.currency_code,
        }))}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

- [ ] **Step 7: Typecheck, lint, the tests near it.**

Run: `npm run typecheck` — Expected: no errors.
Run: `npx eslint "app/(app)/banking" lib/client/pdf-text.ts` — Expected: prints nothing.
Run: `npx vitest run tests/unit/pdf-statement-view.test.ts tests/unit/pdf-statement.test.ts tests/unit/statement-line-state.test.ts` — Expected: all pass.

- [ ] **Step 8: Commit.**

```bash
git add lib/client/pdf-text.ts "app/(app)/banking/PdfStatementPreview.tsx" "app/(app)/banking/ImportStatementModal.tsx" "app/(app)/banking/reconcile/statement-actions.ts" "app/(app)/banking/reconcile/StartFromStatementModal.tsx" "app/(app)/banking/reconcile/ReconcileListClient.tsx" "app/(app)/banking/reconcile/page.tsx"
printf 'feat(reconcile): start a reconciliation from a PDF statement\n\nThe statement date and closing balance come from the file. On an account\nnever reconciled, the books on the day before the period are set beside\nthe opening balance, and when they agree the earlier lines can be brought\nforward. The lines are imported, kept, paired and ticked.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Inside a reconciliation

**Files:**
- Modify: `app/(app)/banking/reconcile/actions.ts` (whole file below: the statement import moves to `statement-actions.ts`)
- Modify: `app/(app)/banking/reconcile/statement-actions.ts` (whole file below)
- Modify: `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` (whole file below)
- Modify: `app/(app)/banking/reconcile/[id]/page.tsx` (whole file below)
- Modify: `app/(app)/banking/reconcile/[id]/report/page.tsx` (whole file below)
- Modify: `lib/domain/bankrec.ts` (remove the statement-line review state)
- Delete: `tests/unit/statement-line-state.test.ts`

**Interfaces:**
- Consumes: everything of Tasks 3–5.
- Produces: in `statement-actions.ts`, `importStatementIntoReconciliationAction(reconciliationId, raw): Promise<ActionResult<StatementImportSummary>>` (raw is a `ReconciliationStatementInput`), `setStatementEndingAction(reconciliationId, endingMinor)`, `matchAgainAction(reconciliationId): Promise<ActionResult<PairingOutcome>>`, `reconciliationStatementAction(reconciliationId): Promise<ActionResult<ReconStatement>>`. `actions.ts` no longer has `importStatementIntoReconciliationAction`, `reconciliationStatementLinesAction`, `StatementLineView` or the old `StatementImportSummary`. `ReconcileWorkspaceClient` takes a `bankAccount` prop.

- [ ] **Step 1: The session actions.** Replace the whole of `app/(app)/banking/reconcile/actions.ts` with:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema } from "@/lib/domain/schemas";
import {
  createReconciliation, setCleared, recordAdjustment, completeReconciliation, reopenReconciliation,
  listReconciliations, getReconciliationLines, getReconciliationDetail, getDiscrepancies,
  BankRecError, type ReconLineView, type ReconDetail, type DiscrepancyRow,
} from "@/lib/services/bankrec";
import type { StatementReconciliationRow } from "@/lib/db/types";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
  type ControlledActionResponse,
} from "@/lib/services/approval-flow";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createReconciliationAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await createReconciliation(sb, parsed.data); revalidatePath("/banking/reconcile"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function setClearedAction(reconciliationId: string, journalLineId: string, cleared: boolean): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await setCleared(sb, reconciliationId, journalLineId, cleared); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function recordAdjustmentAction(reconciliationId: string, raw: unknown): Promise<ActionResult<{ entryId: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const entryId = await recordAdjustment(sb, reconciliationId, parsed.data); return { ok: true, data: { entryId } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function completeReconciliationAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await completeReconciliation(sb, id); revalidatePath("/banking/reconcile"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function reopenReconciliationAction(
  id: string,
  raw: unknown,
): Promise<ActionResult<ControlledActionResponse>> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can reopen a reconciliation" };
  const parsed = reconciliationReopenSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "reconciliation_reopen",
      title: "Bank reconciliation reopen",
      amountMinor: 0,
      reason: parsed.data.reason,
      payload: { reconciliation_id: id },
      execute: async () => {
        await reopenReconciliation(sb, id, parsed.data);
        return id;
      },
    });
    revalidatePath("/banking/reconcile");
    revalidatePath(`/banking/reconcile/${id}`);
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
    return { ok: true, data: toControlledActionResponse(outcome, String) };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function listReconciliationsAction(bankAccountId: string): Promise<ActionResult<StatementReconciliationRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listReconciliations(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reconciliationLinesAction(id: string): Promise<ActionResult<ReconLineView[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationLines(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reconciliationDetailAction(id: string): Promise<ActionResult<ReconDetail>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationDetail(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function discrepanciesAction(bankAccountId: string): Promise<ActionResult<DiscrepancyRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getDiscrepancies(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 2: The statement actions, complete.** Replace the whole of `app/(app)/banking/reconcile/statement-actions.ts` with:

```ts
"use server";
/**
 * A reconciliation reconciled against its statement file: starting one from a
 * PDF statement, bringing an account's first reconciliation forward, keeping
 * the statement with the reconciliation and pairing its lines with the books.
 * The session itself — ticking, completing, reopening — is in actions.ts.
 */
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  reconciliationStatementSchema, reconciliationFromStatementSchema, type ReconciliationStatementInput,
} from "@/lib/domain/schemas";
import {
  createReconciliationFromStatement, setReconciliationStatement, setStatementEnding, getBroughtForwardPreview,
  bringForward, getReconciliationHeader, getReconciliationStatement, pairAndTick,
  BankRecError, type ReconStatement, type StatementFileInput,
} from "@/lib/services/bankrec";
import { generateSuggestions, importStatement } from "@/lib/services/banking";
import {
  broughtForwardNote, dayBefore, type BroughtForwardPreview, type PairingOutcome,
} from "@/lib/domain/reconcile-statement";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export interface StatementImportSummary {
  /** New lines in Bank Transactions; a line already there is a duplicate. */
  inserted: number;
  duplicates: number;
  outcome: PairingOutcome;
}

function statementFile(input: ReconciliationStatementInput): StatementFileInput {
  return {
    fileName: input.file_name,
    openingMinor: input.opening_minor,
    closingMinor: input.closing_minor,
    lines: input.lines,
  };
}

/**
 * The statement's lines go into Bank Transactions as Import statement puts
 * them there — the same path and the same duplicate rule — and its matches are
 * looked for, so Review import can code what the books do not have. A failure
 * finding matches costs the proposals, not the import.
 */
async function importIntoBankTransactions(
  sb: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  bankAccountId: string,
  file: StatementFileInput,
) {
  const imported = await importStatement(sb, bankAccountId, file.fileName, file.lines);
  if (imported.inserted > 0) {
    await generateSuggestions(sb, bankAccountId).catch((err) =>
      console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
    );
  }
  return imported;
}

/**
 * The statement a reconciliation in progress is reconciled against: kept with
 * it (replacing any kept before), imported into Bank Transactions, and paired
 * with the books — every pair is ticked. Nothing is posted.
 */
export async function importStatementIntoReconciliationAction(
  reconciliationId: string,
  raw: unknown,
): Promise<ActionResult<StatementImportSummary>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = reconciliationStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const file = statementFile(parsed.data);
    // Kept first: a completed reconciliation refuses it before anything is imported.
    await setReconciliationStatement(sb, reconciliationId, file);
    const { bankAccountId } = await getReconciliationHeader(sb, reconciliationId);
    const imported = await importIntoBankTransactions(sb, bankAccountId, file);
    const outcome = await pairAndTick(sb, reconciliationId);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    revalidatePath("/banking");
    return { ok: true, data: { inserted: imported.inserted, duplicates: imported.skipped, outcome } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export interface StartFromStatementSummary extends StatementImportSummary {
  id: string;
  broughtForward: boolean;
}

/**
 * A reconciliation started from a PDF statement: the statement's last day is
 * its date and its closing balance the ending balance. On the account's first
 * reconciliation, when the person asks, the earlier lines are brought forward
 * first — refused by the database unless the books agree with the statement's
 * opening balance.
 */
export async function startReconciliationFromStatementAction(
  raw: unknown,
): Promise<ActionResult<StartFromStatementSummary>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = reconciliationFromStatementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const input = parsed.data;
  const file = statementFile(input);
  let broughtForward = false;
  try {
    const sb = await createSupabaseServerClient();
    if (input.bring_forward && input.period_from && input.opening_minor !== null) {
      await bringForward(
        sb,
        input.bank_account_id,
        dayBefore(input.period_from),
        input.opening_minor,
        broughtForwardNote(input.period_from, input.statement_date),
      );
      broughtForward = true;
    }
    const id = await createReconciliationFromStatement(
      sb, input.bank_account_id, input.statement_date, input.closing_minor, file,
    );
    const imported = await importIntoBankTransactions(sb, input.bank_account_id, file);
    const outcome = await pairAndTick(sb, id);
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return { ok: true, data: { id, broughtForward, inserted: imported.inserted, duplicates: imported.skipped, outcome } };
  } catch (e) {
    revalidatePath("/banking/reconcile");
    // Bringing forward is its own step: when what follows fails, the account
    // stays brought forward and the dialog offers Start.
    return {
      ok: false,
      error: broughtForward ? `The earlier lines were brought forward, but the reconciliation was not started: ${msg(e)}` : msg(e),
    };
  }
}

/** What bringing an account forward through a day would sign off. Read only. */
export async function broughtForwardPreviewAction(
  bankAccountId: string,
  through: string,
): Promise<ActionResult<BroughtForwardPreview>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getBroughtForwardPreview(sb, bankAccountId, through) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** Takes the statement's closing balance as the reconciliation's ending balance. */
export async function setStatementEndingAction(reconciliationId: string, endingMinor: number): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  if (!Number.isSafeInteger(endingMinor)) return { ok: false, error: "Ending balance must be a whole minor-unit amount" };
  try { const sb = await createSupabaseServerClient(); await setStatementEnding(sb, reconciliationId, endingMinor); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** Pairs the kept statement with the books as they are now and ticks any new pairs. */
export async function matchAgainAction(reconciliationId: string): Promise<ActionResult<PairingOutcome>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await pairAndTick(sb, reconciliationId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function reconciliationStatementAction(reconciliationId: string): Promise<ActionResult<ReconStatement>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationStatement(sb, reconciliationId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 3: The reconciliation screen.** Replace the whole of `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` with:

```tsx
"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  App,
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { fromMinor } from "@/lib/domain/money";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  closingAdvice,
  openingAdvice,
  pairingMessage,
  reconciliationStandings,
  type Standing,
} from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import {
  reconciliationLinesAction,
  reconciliationDetailAction,
  setClearedAction,
  recordAdjustmentAction,
  completeReconciliationAction,
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

/** The statement dialog Banking uses, fetched when somebody opens it. */
const ImportStatementModal = dynamic(() => import("../../ImportStatementModal"), { ssr: false });

// See table-pagination.ts for why this has to live in state rather than as a
// literal on `pagination`.
const STATEMENT_LINES_DEFAULT_PAGE_SIZE = 10;

const IMPORT_INTRO =
  "Choose the statement for this reconciliation: a PDF, a CSV, or a Quicken or QuickBooks download (.ofx, .qfx, " +
  ".qbo, .qif). Its lines are kept with the reconciliation, imported into Bank Transactions and paired with the " +
  "books, and every pair is ticked. Nothing is posted.";

interface Offset {
  id: string;
  label: string;
}
interface Props {
  reconciliationId: string;
  canWrite: boolean;
  canReopen: boolean;
  offsetAccounts: Offset[];
  baseCurrency: string;
  baseDecimals: number;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
}

function StandingTag({ standing }: { standing: Standing }) {
  if (standing.kind === "after") return <Tag>After the statement date</Tag>;
  if (standing.kind === "missing") return <Tag color="orange">Not in the books</Tag>;
  return (
    <Space size={4} direction="vertical">
      <Tag color={standing.ticked ? "green" : "gold"}>
        Paired · {standing.how}
        {standing.ticked ? "" : " · not ticked"}
      </Tag>
      {standing.entryNumber ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          with {standing.entryNumber}
        </Typography.Text>
      ) : null}
    </Space>
  );
}

export default function ReconcileWorkspaceClient({
  reconciliationId,
  canWrite,
  canReopen,
  offsetAccounts,
  baseCurrency,
  baseDecimals,
  bankAccount,
}: Props) {
  const { message, modal } = App.useApp();
  const [lines, setLines] = useState<ReconLineView[]>([]);
  const [detail, setDetail] = useState<ReconDetail | null>(null);
  const [statement, setStatement] = useState<ReconStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form] = Form.useForm();
  const [statementLinesPageSize, setStatementLinesPageSize] = useState<number>(
    STATEMENT_LINES_DEFAULT_PAGE_SIZE,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [l, d, s] = await Promise.all([
      reconciliationLinesAction(reconciliationId),
      reconciliationDetailAction(reconciliationId),
      reconciliationStatementAction(reconciliationId),
    ]);
    setLoading(false);
    if (l.ok && l.data) setLines(l.data);
    else message.error(l.error ?? "Failed");
    if (d.ok && d.data) setDetail(d.data);
    else message.error(d.error ?? "Failed");
    if (s.ok && s.data) setStatement(s.data);
    else message.error(s.error ?? "Failed");
  }, [reconciliationId, message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // How each statement line stands with the books as they are now. Derived,
  // never stored: the same pairing Match again ticks by.
  const standings = useMemo(
    () => (statement && statement.lines.length ? reconciliationStandings(statement, lines) : null),
    [statement, lines],
  );
  const outstanding = useMemo(() => new Set(standings?.outstanding ?? []), [standings]);
  const standingOf = useMemo(
    () => new Map((statement?.lines ?? []).map((line, i) => [line.lineNo, standings?.standings[i]])),
    [statement, standings],
  );

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });
  const money = (m: number) => formatMoney(m, baseCurrency, baseDecimals);
  const completed = detail?.status === "completed";
  const working = canWrite && !completed;
  const statementClosing = statement?.closingMinor ?? null;
  const closing = detail ? closingAdvice(statementClosing, detail.statementEndingMinor, money) : null;
  const opening = statement && detail ? openingAdvice(statement.openingMinor, detail.beginningMinor, money) : null;

  const toggle = async (line: ReconLineView, cleared: boolean) => {
    const r = await setClearedAction(reconciliationId, line.journalLineId, cleared);
    if (r.ok) void load();
    else message.error(r.error ?? "Failed");
  };

  const submitAdjust = async () => {
    const v = await form.validateFields();
    const r = await recordAdjustmentAction(reconciliationId, { offset_account_id: v.offset_account_id, reason: v.reason });
    if (r.ok) {
      message.success("Adjustment recorded");
      setAdjOpen(false);
      form.resetFields();
      void load();
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  const complete = async () => {
    const r = await completeReconciliationAction(reconciliationId);
    if (r.ok) {
      message.success("Reconciliation completed");
      void load();
    } else {
      message.error(r.error ?? "Failed");
    }
  };

  const reopen = () => {
    let reason = "";
    modal.confirm({
      title: "Reopen reconciliation?",
      content: (
        <Input
          placeholder="Reason"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      onOk: async () => {
        const r = await reopenReconciliationAction(reconciliationId, { reason });
        if (r.ok) {
          message.success(
            r.data?.submittedForApproval
              ? "Reconciliation reopen submitted for approval"
              : "Reopened",
          );
          if (!r.data?.submittedForApproval) void load();
        } else {
          message.error(r.error ?? "Failed");
          throw new Error(r.error);
        }
      },
    });
  };

  /**
   * The statement is kept with this reconciliation, imported into Bank
   * Transactions and paired with the books — without leaving the page the
   * statement is being worked from.
   */
  async function importStatement(fileName: string, rows: StatementLine[], pdf: PdfStatement | null) {
    setImporting(true);
    const res = await importStatementIntoReconciliationAction(reconciliationId, {
      file_name: fileName,
      opening_minor: pdf?.openingMinor ?? null,
      closing_minor: pdf?.closingMinor ?? null,
      lines: rows,
    });
    setImporting(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to import the statement");
      return;
    }
    setImportOpen(false);
    message.success(
      `${res.data.inserted} new in Bank Transactions, ${res.data.duplicates} already there. ${pairingMessage(res.data.outcome)}`,
      8,
    );
    void load();
  }

  async function matchAgain() {
    setMatching(true);
    const res = await matchAgainAction(reconciliationId);
    setMatching(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to pair the statement");
      return;
    }
    message.success(pairingMessage(res.data), 8);
    void load();
  }

  async function takeClosing(closingMinor: number) {
    const res = await setStatementEndingAction(reconciliationId, closingMinor);
    if (res.ok) void load();
    else message.error(res.error ?? "Failed");
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {detail && (
        <Space size="large" wrap>
          <Statistic title="Beginning" value={fmt(detail.beginningMinor)} />
          <Statistic title="Cleared" value={fmt(detail.clearedTotalMinor)} />
          <Statistic title="Reconciled balance" value={fmt(detail.reconciledBalanceMinor)} />
          <Statistic title="Statement ending" value={fmt(detail.statementEndingMinor)} />
          <Statistic title="Difference" value={fmt(detail.differenceMinor)} />
          <Tag color={completed ? "green" : "blue"}>{detail.status}</Tag>
          {statement?.broughtForward ? <Tag color="purple">Brought forward</Tag> : null}
        </Space>
      )}
      <p><Link href={`/banking/reconcile/${reconciliationId}/report`}>View report</Link></p>
      {statement?.broughtForward && statement.note ? <Alert type="info" showIcon title={statement.note} /> : null}
      {detail && !completed && (
        <Alert
          type={detail.differenceMinor === 0 ? "success" : "warning"}
          message={
            detail.differenceMinor === 0
              ? "Difference is zero — ready to complete."
              : `Unexplained difference: ${fmt(detail.differenceMinor)} ${baseCurrency}.`
          }
        />
      )}
      {closing && !completed && statementClosing !== null ? (
        <Alert
          type="warning"
          showIcon
          title={closing}
          action={
            canWrite ? (
              <Button size="small" onClick={() => void takeClosing(statementClosing)}>
                Use {money(statementClosing)}
              </Button>
            ) : null
          }
        />
      ) : null}
      {opening && !completed ? <Alert type="warning" showIcon title={opening} /> : null}
      {working && (
        <Space wrap>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            Import statement
          </Button>
          {statement && statement.lines.length > 0 ? (
            <Button loading={matching} onClick={() => void matchAgain()}>
              Match again
            </Button>
          ) : null}
          <Button type="primary" disabled={!detail || detail.differenceMinor !== 0} onClick={complete}>
            Complete
          </Button>
          <Button disabled={!detail || detail.differenceMinor === 0} onClick={() => setAdjOpen(true)}>
            Record adjustment
          </Button>
        </Space>
      )}
      {completed && canReopen && (
        <Button danger onClick={reopen}>
          Reopen
        </Button>
      )}
      <div>
        <Space size="small" style={{ marginBottom: 8 }} wrap>
          <Typography.Text strong>Statement lines</Typography.Text>
          <Typography.Text type="secondary">
            {!statement || statement.lines.length === 0
              ? "No statement is kept with this reconciliation yet — import it above."
              : `${statement.lines.length} line(s) from ${statement.fileName ?? "the statement"}`}
          </Typography.Text>
          {standings ? (
            <Space size={4} wrap>
              <Tag color="green">{standings.paired} paired</Tag>
              {standings.missing > 0 ? <Tag color="orange">{standings.missing} not in the books</Tag> : null}
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
            This statement writes money the other way round; its amounts were turned round to pair them.
          </Typography.Paragraph>
        ) : null}
        <Table<ReconStatementLine>
          rowKey="lineNo"
          size="small"
          pagination={
            (statement?.lines.length ?? 0) > 10
              ? clientTablePagination(
                  statementLinesPageSize,
                  setStatementLinesPageSize,
                  pageSizeOptionsFor(STATEMENT_LINES_DEFAULT_PAGE_SIZE),
                )
              : false
          }
          dataSource={statement?.lines ?? []}
          locale={{ emptyText: "No statement kept with this reconciliation" }}
          columns={[
            { title: "Date", dataIndex: "txnDate", width: 110 },
            { title: "Description", dataIndex: "description" },
            {
              title: "Reference",
              dataIndex: "reference",
              width: 130,
              render: (value: string | null) => value ?? "—",
            },
            {
              title: "Amount",
              dataIndex: "amountMinor",
              width: 130,
              align: "right",
              render: (value: number) => fmt(value),
            },
            {
              title: "With the books",
              key: "standing",
              width: 280,
              render: (_: unknown, line) => {
                const standing = standingOf.get(line.lineNo);
                return standing ? <StandingTag standing={standing} /> : null;
              },
            },
          ]}
        />
      </div>

      <Typography.Text strong>Ledger lines in this reconciliation</Typography.Text>
      <Table
        rowKey="journalLineId"
        loading={loading}
        dataSource={lines}
        columns={[
          {
            title: "Cleared",
            render: (_, l) => (
              <input
                type="checkbox"
                checked={l.cleared}
                disabled={!canWrite || completed}
                onChange={(e) => void toggle(l, e.target.checked)}
              />
            ),
          },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Entry", dataIndex: "entryNumber" },
          { title: "Source", dataIndex: "sourceType", render: (s) => <Tag>{s}</Tag> },
          { title: "Reference", dataIndex: "reference", render: (value: string | null) => value ?? "—" },
          { title: "Memo", dataIndex: "memo" },
          { title: "Amount", align: "right", render: (_, l) => fmt(l.signedMinor) },
          {
            title: "",
            key: "outstanding",
            render: (_, l) =>
              !l.cleared && outstanding.has(l.journalLineId) ? <Tag color="orange">Outstanding</Tag> : null,
          },
        ]}
      />
      <Modal open={adjOpen} title="Record adjustment" onCancel={() => setAdjOpen(false)} onOk={submitAdjust}>
        <p>
          An adjusting entry for the outstanding difference{" "}
          {detail ? `(${fmt(detail.differenceMinor)} ${baseCurrency})` : ""} will post to the selected account.
        </p>
        <Form form={form} layout="vertical">
          <Form.Item name="offset_account_id" label="Offset account (bank charges / interest)" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={offsetAccounts.map((a) => ({ value: a.id, label: a.label }))} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      {importOpen ? (
        <ImportStatementModal
          open={importOpen}
          bankAccount={bankAccount}
          importing={importing}
          intro={IMPORT_INTRO}
          onConfirm={(fileName, rows, pdf) => void importStatement(fileName, rows, pdf)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
    </Space>
  );
}
```

- [ ] **Step 4: Its page.** Replace the whole of `app/(app)/banking/reconcile/[id]/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { listBankAccounts } from "@/lib/services/banking";
import { getReconciliationHeader } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReconcileWorkspaceClient from "./ReconcileWorkspaceClient";

export const dynamic = "force-dynamic";

export default async function ReconcileWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const header = await getReconciliationHeader(sb, id).catch(() => null);
  if (!header) notFound();
  const [accounts, currencies, banks] = await Promise.all([listAccounts(sb), listCurrencies(sb), listBankAccounts(sb)]);
  const base = currencies.find((c) => c.is_base);
  const bank = banks.find((b) => b.id === header.bankAccountId);
  const offsets = accounts.filter(
    (a) =>
      ["income", "other_income", "expense", "cost_of_goods_sold", "other_expense"].includes(a.account_type) &&
      a.is_posting_account &&
      a.status === "active",
  );
  return (
    <div>
      <PageHeader title="Reconciliation" description="Clear items until the difference is zero, then complete." />
      <ReconcileWorkspaceClient
        reconciliationId={id}
        canWrite={canWrite(role)}
        canReopen={isAdmin(role)}
        offsetAccounts={offsets.map((a) => ({ id: a.id, label: `${a.account_code} ${a.name}` }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        bankAccount={{
          id: header.bankAccountId,
          label: bank ? `${bank.bank_name || bank.account_name} · ${bank.account_code}` : "this bank account",
          maskedNumber: bank?.account_number_masked ?? null,
          decimals: base?.decimal_places ?? 2,
          currencyCode: bank?.currency_code ?? base?.code ?? "USD",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: The report says Brought forward and names the statement.** Replace the whole of `app/(app)/banking/reconcile/[id]/report/page.tsx` with:

```tsx
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getReconciliationDetail, getReconciliationHeader, getReconciliationLines } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import { fromMinor } from "@/lib/domain/money";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ReconciliationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const [detail, header, lines, currencies] = await Promise.all([
    getReconciliationDetail(sb, id), getReconciliationHeader(sb, id), getReconciliationLines(sb, id), listCurrencies(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  const dec = base?.decimal_places ?? 2;
  const fmt = (m: number) => fromMinor(m, dec).toLocaleString(undefined, { minimumFractionDigits: dec });
  const cleared = lines.filter((l) => l.cleared);
  return (
    <div>
      <PageHeader title="Reconciliation report" description={`Base currency ${base?.code ?? "USD"} · Status ${detail.status}`} />
      <p><Link href={`/banking/reconcile/${id}`}>← Back to session</Link></p>
      {header.broughtForward ? <p><strong>Brought forward.</strong> {header.note}</p> : null}
      {header.fileName ? (
        <p>
          Statement: {header.fileName}
          {header.openingMinor !== null ? ` · opens at ${fmt(header.openingMinor)}` : ""}
          {header.closingMinor !== null ? ` · closes at ${fmt(header.closingMinor)}` : ""}
        </p>
      ) : null}
      <table>
        <tbody>
          <tr><td>Beginning balance</td><td style={{ textAlign: "right" }}>{fmt(detail.beginningMinor)}</td></tr>
          <tr><td>Cleared total</td><td style={{ textAlign: "right" }}>{fmt(detail.clearedTotalMinor)}</td></tr>
          <tr><td>Reconciled balance</td><td style={{ textAlign: "right" }}>{fmt(detail.reconciledBalanceMinor)}</td></tr>
          <tr><td>Statement ending</td><td style={{ textAlign: "right" }}>{fmt(detail.statementEndingMinor)}</td></tr>
          <tr><td>Difference</td><td style={{ textAlign: "right" }}>{fmt(detail.differenceMinor)}</td></tr>
        </tbody>
      </table>
      <h3>Cleared items ({cleared.length})</h3>
      <ul>
        {cleared.map((l) => (
          <li key={l.journalLineId}>{l.entryDate} · {l.entryNumber} · {l.sourceType} · {fmt(l.signedMinor)}</li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Remove what the old statement list used.** In `lib/domain/bankrec.ts`, delete everything from the line `// --- Statement line review state ---------------------------------------------` to the end of the file (`StatementLineState`, `STATEMENT_LINE_STATES`, `statementLineState`, `StatementLineSummary`, `summariseStatementLines`), leaving the file ending with `buildAdjustmentPosting`'s closing `}` and one newline. Then delete `tests/unit/statement-line-state.test.ts`:

```bash
git rm tests/unit/statement-line-state.test.ts
```

Check nothing else used them: `git grep -n "statementLineState\|summariseStatementLines\|STATEMENT_LINE_STATES\|reconciliationStatementLinesAction\|StatementLineView" -- . ':!*.md'` — Expected: prints nothing.

- [ ] **Step 7: Typecheck, lint, tests.**

Run: `npm run typecheck` — Expected: no errors.
Run: `npx eslint "app/(app)/banking/reconcile" lib/domain/bankrec.ts` — Expected: prints nothing.
Run: `npx vitest run tests/unit/reconcile-statement.test.ts tests/unit/reconcile-statement-service.test.ts tests/unit/statement-pairing.test.ts` — Expected: all pass.

- [ ] **Step 8: Commit.**

```bash
git add "app/(app)/banking/reconcile/actions.ts" "app/(app)/banking/reconcile/statement-actions.ts" "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx" "app/(app)/banking/reconcile/[id]/page.tsx" "app/(app)/banking/reconcile/[id]/report/page.tsx" lib/domain/bankrec.ts
printf 'feat(reconcile): the statement inside a reconciliation\n\nImport statement takes every statement file; its lines are kept, imported,\npaired and ticked. Each line says how it paired or Not in the books, Match\nagain pairs what has been coded since, book lines the statement does not\nshow are Outstanding, and a PDF closing on another figure offers Use.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 7: Changelog 1.79, the guide, the whole suite

**Files:**
- Modify: `lib/domain/changelog.ts` (a new first entry of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (after the "Reconcile to a statement balance" step, around line 356)

- [ ] **Step 1: The release.** In `lib/domain/changelog.ts`, directly after `export const RELEASES: Release[] = [`, insert:

```ts
  {
    version: "1.79",
    date: "2026-10-03",
    headline: "A reconciliation can start from the statement's PDF, and the statement's lines pair with the books.",
    changes: [
      {
        kind: "added",
        title: "Start a reconciliation from a PDF statement",
        detail:
          "On Bank Reconciliation, From a PDF statement reads the statement's period, opening and closing balances and lines, and starts a reconciliation dated the statement's last day at its closing balance — nothing retyped. The lines are imported into Bank Transactions, kept with the reconciliation and paired with the books, and every pair is ticked. Nothing is posted, and nothing completes until you click Complete.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "The first reconciliation of an account can be brought forward",
        detail:
          "When an account has never been reconciled and the books on the day before the statement's period hold exactly the opening balance the statement prints, Bring forward and start signs off every earlier line as one reconciliation, marked Brought forward with the statement that proved it. When they differ, the dialog says by how much and the earlier lines stay open.",
        route: "/banking/reconcile",
      },
      {
        kind: "changed",
        title: "Import statement inside a reconciliation takes every statement file",
        detail:
          "A PDF, CSV, OFX, QFX, QBO or QIF file, where it took only CSV. Each statement line says how it paired — by date and amount, by cheque number, or by amount within 5 days — or Not in the books, with a link to code those lines in Bank Transactions; Match again pairs them once they are posted. Book lines the statement does not show are marked Outstanding, and a PDF that closes on another figure than the reconciliation offers Use with the statement's.",
        route: "/banking/reconcile",
      },
    ],
  },
```

- [ ] **Step 2: The guide.** In `lib/domain/system-guide.ts` replace

```ts
      {
        action: "Reconcile to a statement balance",
        control: "New reconciliation",
        route: "/banking/reconcile",
        note:
          "Completing a session requires either zero unexplained difference or an " +
          "adjustment somebody signs for.",
      },
```

with

```ts
      {
        action: "Reconcile to a statement balance",
        control: "New reconciliation",
        route: "/banking/reconcile",
        note:
          "Completing a session requires either zero unexplained difference or an " +
          "adjustment somebody signs for.",
      },
      {
        action: "Start a reconciliation from the statement's PDF",
        control: "From a PDF statement",
        route: "/banking/reconcile",
        note:
          "The statement's last day and closing balance start it. Its lines are imported, kept with the " +
          "reconciliation and paired with the books — by date and amount, by cheque number, or by amount within " +
          "5 days — and the pairs are ticked. On an account never reconciled, when the books agree with the " +
          "statement's opening balance, Bring forward and start signs off the earlier lines first.",
      },
      {
        action: "Code what the statement has and the books do not",
        control: "Match again",
        route: "/banking/reconcile",
        note:
          "Lines marked Not in the books are coded in Bank Transactions like any bank line. Back in the " +
          "reconciliation, Match again pairs them and ticks them; no tick is ever removed.",
      },
```

- [ ] **Step 3: The whole suite and the build.**

Run: `npm run typecheck`, `npm run lint`, then `npm test`
Expected: no type errors; lint 0 errors (warnings that were there before stay); every test file passes — the changelog and guide tests included (`APP_VERSION` is now 1.79). `tests/unit/quality-query-timing.test.ts` can fail when the machine is busy; if it alone fails, run it on its own and report both results.
Run: `npm run build` — Expected: `Compiled successfully` and the route list, exit code 0.

- [ ] **Step 4: Commit.**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
printf 'docs(changelog): 1.79 reconcile a statement from its file; guide steps\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 8: Live (controller)

No new code. Every step that writes to the live database waits for the user.

- [ ] **Step 1:** Ask the user to approve applying 0132 to every company. Only then run `node --env-file=.env.local scripts/migrate.mjs` and confirm 0132 in `acc_schema_migrations` of all six schemas.
- [ ] **Step 2:** On the sample company PC-Test only: a bank account never reconciled (create one with its own ledger account if every PC-Test account has a reconciliation), a few posted entries before and inside one month — one of them a cheque with a reference — and two invented PDF statements printed with the `pdfOf` helper of `tests/unit/pdf-glyphs.test.ts` into the scratchpad, never the repository: the month whose opening balance equals the books on the day before it, with one bank fee the books do not have; and a copy of it that closes on a different figure.
- [ ] **Step 3:** In a real browser: From a PDF statement → the preview, the bring-forward sentence and **Bring forward and start**; the list shows Brought forward; the reconciliation shows each line paired (date and amount, cheque number, within 5 days) and the fee **Not in the books**; code the fee in Bank Transactions; **Match again** ticks it; the difference is zero; **Complete**. Then New reconciliation typed at a wrong ending balance, Import statement with the second PDF → **Use $X**; and a CSV import inside a reconciliation.
- [ ] **Step 4:** Screenshots of each, light and dark, cropped; an approval page beside them. Nothing is pushed until the user approves.
- [ ] **Step 5:** Ask the user whether what the check recorded on PC-Test stays as the sample company's history or is undone (reopen and void through the screens). Do what they choose.
