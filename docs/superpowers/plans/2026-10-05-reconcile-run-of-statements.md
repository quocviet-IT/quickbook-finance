# Reconcile a run of statements in one pass (1.81) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A page, From statement files, takes one statement or a year of them (PDF statements, or a CSV with a running balance cut into months), previews every month against the books without writing anything, and signs off the months that agree in one click — stopping at the first month that needs a look, which it starts as a reconciliation in progress.

**Architecture:** The browser reads the files (1.78's PDF reader, the CSV reader cut into calendar months as the client's prototype does in `src/p44.html`) and checks the run (gaps, months already signed, a reconciliation in progress). A read-only server action walks the months against the account's open book lines — read by a new read-only database function — with 1.79's pairing. Signing is one server call per month, built on 1.79's functions: create from the statement, import into Bank Transactions, pair and tick, complete when it reaches zero.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, Ant Design 6, TypeScript, Zod 4, Supabase/Postgres (one schema per company), Vitest, Playwright (parity test), `pg` (verify script).

**Spec:** `docs/superpowers/specs/2026-10-05-reconcile-run-of-statements-design.md`

## Global Constraints

- US English UI. Money in integer minor units. Nothing posts and nothing completes without a person's click: the preview writes nothing; one click signs the agreeing months; each month is checked again on the server as it is signed.
- A month that agrees only on its balance stops the run for a person — never ticked wholesale (the user's decision; the prototype signs it).
- No real statement, bank name, account number or figure in the repository: fixtures are invented. The prototype stays outside the repository.
- Migration 0133 is read only and is **not applied to the live database by any task**. The verify script applies it inside a transaction that is always rolled back. It goes live only after the user approves, in Task 6, by the controller — and before this code is deployed (the preview calls it).
- Run everything from `ctyhp-accounting/`. Never pipe test output through `head`/`tail`; read the pass/fail lines.
- Write any file holding a backslash (regular expressions) with the Write or Edit tool — never a bash heredoc or `python -c`, which eat backslashes. Write paths exactly as given in tool calls — never with backslash escapes such as `\(` or `\]` (on Windows they create stray directories).
- A `"use server"` file exports only async functions and types.
- Stage files by name; never `git add -A`. Write commit messages with `printf` in Git Bash to `../.superpowers/sdd/commit-msg.txt` (never PowerShell — it writes a BOM), check with `od -c ../.superpowers/sdd/commit-msg.txt | head -1` that the first bytes are not `357 273 277`, then `git commit -F ../.superpowers/sdd/commit-msg.txt`. No Co-Authored-By trailer. After each task, `git status --short --untracked-files=all` shows no file the task did not name.

Every file below was run before this plan was written: the migration through its verify script on all six companies (54 passed, 0 failed, rolled back); the month cutting against the prototype's own `readStatementText` (8 months agree, 1 departs exactly where the prototype misreads a newest-first file); the run module's 19 unit tests; `tsc --noEmit`, `eslint`, the whole unit suite and `next build` with every task's files in place, and `tsc --noEmit` after Task 3.

---

### Task 1: Migration 0133 and its proof

**Files:**
- Create: `scripts/verify-bank-open-lines.mjs`
- Create: `supabase/migrations/0133_bank_open_lines.sql`

**Interfaces:**
- Consumes: `acc_post_manual_journal`, `acc_create_reconciliation`, `acc_set_cleared`, `acc_complete_reconciliation` (live); `planCompanySchema` from `lib/domain/schema-template.ts`.
- Produces: `acc_bank_open_lines(p_bank_account_id uuid, p_through date) returns table (journal_line_id uuid, entry_number text, entry_date date, signed_minor bigint, reference text)` — the account's posted lines to `p_through` in no completed reconciliation, ordered by entry date, entry number, line id; signed for the bank (money in positive); the reference as `acc_reconciliation_lines` gives it. Read only, security invoker, granted to `authenticated` and `service_role` only.

- [ ] **Step 1: Write the proof first.** Create `scripts/verify-bank-open-lines.mjs`:

```js
/**
 * Behavioural verification of migration 0133 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0133 has not been applied it is applied first, inside that transaction,
 * and every account, bank account, entry and reconciliation the checks need is
 * made there too — so nothing is left behind. A viewer is checked by turning
 * the administrator into one inside the same transaction.
 *
 * Run: node --env-file=.env.local scripts/verify-bank-open-lines.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0133_bank_open_lines.sql";
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
        console.log("  (0133 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- the books: a bank account with two July entries and one in August
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-OB", "Verify open lines bank", "bank");
      const other = await account("ZZ-VERIFY-OX", "Verify open lines other", "expense");
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
        await one(`select acc_post_manual_journal($1, 'Verify open lines', $2, $3, $4::jsonb) as id`, [
          date, ref, base.code, JSON.stringify(lines),
        ]);
      };
      await post("2026-07-05", 50000, null);
      await post("2026-07-20", -10000, "1201");
      await post("2026-08-03", 5000, null);

      const open = async (through) => (await client.query(`select * from acc_bank_open_lines($1, $2)`, [bank, through])).rows;
      const july = await open("2026-07-31");
      check("to July 31: the two July lines, oldest first", july.length === 2 && july[0].entry_date < july[1].entry_date, String(july.length));
      check("each line's amount is signed for the bank", Number(july[0].signed_minor) === 50000 && Number(july[1].signed_minor) === -10000);
      check("a line carries its reference", july[1].reference === "1201", String(july[1].reference));
      check("to August 31: all three", (await open("2026-08-31")).length === 3);

      // ---- a completed reconciliation takes its lines out; one in progress does not
      const rec = (await one(`select acc_create_reconciliation($1, '2026-07-31', 50000) as id`, [bank])).id;
      await one(`select acc_set_cleared($1, $2, true)`, [rec, july[0].journal_line_id]);
      check("a line ticked in a reconciliation in progress is still open", (await open("2026-08-31")).length === 3);
      await one(`select acc_complete_reconciliation($1)`, [rec]);
      const after = await open("2026-08-31");
      check(
        "a line in a completed reconciliation is no longer open",
        after.length === 2 && !after.some((l) => l.journal_line_id === july[0].journal_line_id),
        String(after.length),
      );

      // ---- who can read
      const grants = await one(
        `select has_function_privilege('anon', 'acc_bank_open_lines(uuid, date)', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_bank_open_lines(uuid, date)', 'execute') as signed_in`,
      );
      check("closed to anon, open to signed-in users", grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
      await client.query("reset role");
      await client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]);
      await client.query("set local role authenticated");
      await as(admin.id);
      check("a viewer reads the open lines", (await open("2026-08-31")).length === 2);
      await client.query("reset role");
      await client.query(`update acc_app_user set role = 'admin' where id = $1`, [admin.id]);
      await client.query("set local role authenticated");
      await as(OUTSIDER);
      check("someone outside the company reads nothing", (await open("2026-08-31")).length === 0);
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

Run (Git Bash): `node --env-file=.env.local scripts/verify-bank-open-lines.mjs`
Expected: it stops at once with `ENOENT: no such file or directory` naming `0133_bank_open_lines.sql`.

- [ ] **Step 3: Write the migration.** Create `supabase/migrations/0133_bank_open_lines.sql`:

```sql
-- ============================================================================
-- 0133 — A bank account's open lines (1.80).
--
-- Reconciling a run of statements walks the months against the books before
-- anything is written: it needs the bank account's posted lines that no
-- completed reconciliation holds yet, with the reference a statement's cheque
-- number pairs on — what acc_reconciliation_lines offers inside one
-- reconciliation, read for the account to a date instead.
--
-- Read only: no table changes, nothing written. Security invoker, so the
-- ledger's row-level security decides who sees which lines.
-- ============================================================================

set search_path = public;

create or replace function acc_bank_open_lines(p_bank_account_id uuid, p_through date)
returns table (journal_line_id uuid, entry_number text, entry_date date, signed_minor bigint, reference text)
language sql stable as $$
  select l.id, e.entry_number, e.entry_date,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint,
         coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference)
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
    left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id
    left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id
   where l.account_id = (select account_id from acc_bank_account where id = p_bank_account_id)
     and e.status = 'posted'
     and e.entry_date <= p_through
     and not exists (
       select 1 from acc_reconciliation_line rl
       join acc_statement_reconciliation r on r.id = rl.reconciliation_id
       where rl.journal_line_id = l.id and r.status = 'completed')
   order by e.entry_date, e.entry_number, l.id;
$$;
revoke all on function acc_bank_open_lines(uuid, date) from public, anon;
grant execute on function acc_bank_open_lines(uuid, date) to authenticated, service_role;
```

- [ ] **Step 4: Run the proof.**

Run (Git Bash): `node --env-file=.env.local scripts/verify-bank-open-lines.mjs`
Expected: every company prints its checks with `ok`, none `FAIL`, and the last line is `54 passed, 0 failed` (9 checks for each of the six active companies). Everything it does is rolled back. If the database cannot be reached, stop and report BLOCKED — never apply the migration any other way.

- [ ] **Step 5: Lint and commit.**

Run: `npx eslint scripts/verify-bank-open-lines.mjs` — Expected: prints nothing.

```bash
git add supabase/migrations/0133_bank_open_lines.sql scripts/verify-bank-open-lines.mjs
printf 'feat(db): 0133 reads a bank account'"'"'s open lines\n\nThe posted lines to a day that no completed reconciliation holds, with the\nreference a cheque pairs on. Read only. Verified on every company in a\nrolled-back transaction; not applied live.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: A run of statements, cut, checked and walked

**Files:**
- Create: `tests/unit/statement-run.test.ts`
- Create: `lib/domain/statement-run.ts`
- Create: `tests/parity/statement-run.parity.ts`

**Interfaces:**
- Consumes: 1.79's `bringForwardAdvice`, `statementStandings`, `BringForwardAdvice`, `BroughtForwardPreview`, `Standing` (`lib/domain/reconcile-statement.ts`); 1.78's `statementProof`, `toStatementLines`, `PdfStatement` (`lib/domain/pdf-statement.ts`) and `shortDate` (`lib/domain/pdf-statement-view.ts`); `StatementLine` (`lib/domain/statement-import.ts`). The parity test: `openPrototype` (`tests/parity/prototype.ts`), `parseCsv` (`lib/csv.ts`), `detectStatementColumns`, `detectDateOrder`, `parseStatementRows`; the prototype page's global `readStatementText`.
- Produces: `RunSource`, `RunStatement { key; fileName; source; from; to; openingMinor; closingMinor; lines; problem; outByMinor }`, `RUN_MESSAGES` (`noClosing`, `noDate`, `balancesDoNotFollow`, `notThisAccount`, `noBalanceFormat`, `noLines`), `monthsFromCsv(fileName, lines): RunStatement[]`, `statementsFromPdf(fileName, statements, maskedNumber): RunStatement[]`, `RunContext { lastCompleted; completedDates; inProgress }`, `RunState`, `CheckedStatement { statement; state; note }`, `RunCheck { statements; usable; stops }`, `checkRun(statements, context, money): RunCheck`, `OpenBookLine { id; date; amountMinor; reference; entryNumber }`, `MonthOutcome` (`agrees` | `balanceOnly` | `outBy` | `waiting`), `RunMonth { key; statementDate; beginningMinor; closingMinor; outcome; standings }`, `RunPreview { broughtForward; months; toSign }`, `RunStart { beginningMinor; broughtForward }`, `simulateRun(usable, openLines, start, money): RunPreview`, `monthSentence(outcome, money): string`.

- [ ] **Step 1: Write the failing test.** Create `tests/unit/statement-run.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  RUN_MESSAGES,
  checkRun,
  monthSentence,
  monthsFromCsv,
  simulateRun,
  statementsFromPdf,
  type OpenBookLine,
  type RunContext,
  type RunStatement,
} from "@/lib/domain/statement-run";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const csvLine = (date: string, amount: number, balance: number | null, description = "LINE"): StatementLine => ({
  txn_date: date,
  description,
  reference: null,
  amount_minor: amount,
  running_balance_minor: balance,
  raw_line: `${date},${description},${amount},${balance ?? ""}`,
});
const statement = (to: string, opening: number | null, closing: number | null, lines: StatementLine[] = [], extra: Partial<RunStatement> = {}): RunStatement => ({
  key: to,
  fileName: `${to}.pdf`,
  source: "PDF",
  from: `${to.slice(0, 7)}-01`,
  to,
  openingMinor: opening,
  closingMinor: closing,
  lines,
  problem: null,
  outByMinor: null,
  ...extra,
});
const noContext: RunContext = { lastCompleted: null, completedDates: [], inProgress: null };
const book = (id: string, date: string, amount: number, reference: string | null = null): OpenBookLine => ({
  id,
  date,
  amountMinor: amount,
  reference,
  entryNumber: `JE-${id}`,
});

describe("monthsFromCsv", () => {
  const oldestFirst = [
    csvLine("2026-07-03", 50000, 150000),
    csvLine("2026-07-20", -2500, 147500),
    csvLine("2026-08-02", -7500, 140000),
    csvLine("2026-08-31", 1000, 141000),
  ];

  it("cuts a file into calendar months, each closing at its last balance", () => {
    const months = monthsFromCsv("bank-2026.csv", oldestFirst);
    expect(months.map((m) => [m.fileName, m.from, m.to, m.openingMinor, m.closingMinor, m.lines.length, m.problem])).toEqual([
      ["bank-2026.csv (2026-07)", "2026-07-01", "2026-07-31", 100000, 147500, 2, null],
      ["bank-2026.csv (2026-08)", "2026-08-01", "2026-08-31", 147500, 141000, 2, null],
    ]);
  });

  it("keeps the file's name for a file of one month", () => {
    expect(monthsFromCsv("july.csv", oldestFirst.slice(0, 2))[0].fileName).toBe("july.csv");
  });

  it("reads a file listed newest first oldest first, even with two lines on a month's last day", () => {
    const newestFirst = [
      csvLine("2026-07-31", -300, 99200, "SECOND"),
      csvLine("2026-07-31", -500, 99500, "FIRST"),
      csvLine("2026-07-02", 10000, 100000),
    ];
    const [july] = monthsFromCsv("newest.csv", newestFirst);
    expect([july.openingMinor, july.closingMinor, july.problem]).toEqual([90000, 99200, null]);
    expect(july.lines.map((l) => l.description)).toEqual(["LINE", "FIRST", "SECOND"]);
  });

  it("cannot prove a month without a running balance", () => {
    const [july] = monthsFromCsv("plain.csv", [csvLine("2026-07-03", 500, null)]);
    expect([july.closingMinor, july.problem]).toEqual([null, RUN_MESSAGES.noClosing]);
  });

  it("says so when the running balances do not follow the lines", () => {
    const [july] = monthsFromCsv("odd.csv", [csvLine("2026-07-03", 500, 1500), csvLine("2026-07-04", 500, 9999)]);
    expect(july.problem).toBe(RUN_MESSAGES.balancesDoNotFollow);
  });

  it("drops lines of no amount, as the prototype does", () => {
    const [july] = monthsFromCsv("zero.csv", [csvLine("2026-07-03", 500, 1500), csvLine("2026-07-04", 0, 1500)]);
    expect(july.lines).toHaveLength(1);
  });
});

describe("statementsFromPdf", () => {
  const pdf = (accountNumber: string | null, to: string | null, closing: number | null): PdfStatement => ({
    accountNumber,
    from: to ? `${to.slice(0, 7)}-01` : null,
    to,
    openingMinor: 1000,
    closingMinor: closing,
    lines: [{ date: "2026-07-05", description: "DEPOSIT", checkNumber: null, amountMinor: 500, balanceMinor: 1500, raw: "07/05 DEPOSIT 5.00" }],
    skipped: 0,
  });

  it("keeps this account's statements and marks another account's", () => {
    const read = statementsFromPdf("combined.pdf", [pdf("00007917", "2026-07-31", 1500), pdf("00004821", "2026-07-31", 1500)], "****7917");
    expect(read.map((s) => [s.fileName, s.problem])).toEqual([
      ["combined.pdf (2026-07)", null],
      ["combined.pdf (2026-07)", RUN_MESSAGES.notThisAccount],
    ]);
  });

  it("takes every statement when none names an account, and says what cannot prove a month", () => {
    const read = statementsFromPdf("plain.pdf", [pdf(null, "2026-07-31", null), pdf(null, null, 1500)], "****7917");
    expect(read.map((s) => s.problem)).toEqual([RUN_MESSAGES.noClosing, RUN_MESSAGES.noDate]);
  });

  it("records by how much a statement does not prove itself", () => {
    expect(statementsFromPdf("off.pdf", [pdf(null, "2026-07-31", 1600)], null)[0].outByMinor).toBe(100);
  });
});

describe("checkRun", () => {
  it("orders the statements and says which a run reconciles", () => {
    const result = checkRun(
      [
        statement("2026-09-30", 1300, 1400),
        statement("2026-07-31", 1000, 1100),
        statement("2026-08-31", 1100, 1300),
        statement("2026-08-31", 1100, 1300, [], { key: "copy", fileName: "copy.pdf" }),
        statement("2026-06-30", 900, 1000),
        statement("2026-05-31", 800, 900),
        statement("2026-10-31", null, null, [], { to: null, problem: RUN_MESSAGES.noDate }),
      ],
      { lastCompleted: { date: "2026-06-30", endingMinor: 1000 }, completedDates: ["2026-06-30"], inProgress: null },
      money,
    );
    expect(result.statements.map((c) => [c.statement.key, c.state])).toEqual([
      ["2026-05-31", "before"],
      ["2026-06-30", "already"],
      ["2026-07-31", "usable"],
      ["2026-08-31", "usable"],
      ["copy", "duplicate"],
      ["2026-09-30", "usable"],
      ["2026-10-31", "unreadable"],
    ]);
    expect(result.usable.map((s) => s.to)).toEqual(["2026-07-31", "2026-08-31", "2026-09-30"]);
    expect(result.stops).toEqual([]);
  });

  it("stops a run with a gap, with a first statement that does not open where the last reconciliation closed, and with one in progress", () => {
    const result = checkRun(
      [statement("2026-07-31", 1000, 1100), statement("2026-08-31", 1200, 1300)],
      { lastCompleted: { date: "2026-06-30", endingMinor: 900 }, completedDates: ["2026-06-30"], inProgress: { id: "r", date: "2026-07-31" } },
      money,
    );
    expect(result.stops).toEqual([
      "A reconciliation to Jul 31, 2026 is in progress on this account. Finish it before reconciling more statements.",
      "The statement closing Jul 31, 2026 opens at $10.00, and the last reconciliation, to Jun 30, 2026, closed at $9.00: a month is missing between them, or that reconciliation closed on another figure.",
      "There is a gap in the run. The statement closing Aug 31, 2026 does not open at the one before it, so a month is missing from what you have chosen. Reconciling across a gap would sign off items nobody has seen a statement for.",
    ]);
  });

  it("says nothing can be reconciled when no statement is usable", () => {
    expect(checkRun([statement("2026-07-31", 1000, null, [], { problem: RUN_MESSAGES.noClosing })], noContext, money).stops).toEqual([
      "Nothing here can be reconciled yet.",
    ]);
  });

  it("notes a statement that does not prove itself", () => {
    const [only] = checkRun([statement("2026-07-31", 1000, 1100, [csvLine("2026-07-05", 100, null)], { outByMinor: -2000 })], noContext, money).statements;
    expect(only.note).toBe("1 line — does not prove itself, out by $20.00");
  });
});

describe("simulateRun", () => {
  const july = statement("2026-07-31", 100000, 140000, [csvLine("2026-07-05", 50000, null), csvLine("2026-07-20", -10000, null)]);
  const august = statement("2026-08-31", 140000, 130000, [csvLine("2026-08-04", -10000, null)]);

  it("walks agreeing months, each beginning where the last closed, without offering a paired line twice", () => {
    const preview = simulateRun(
      [july, august],
      [book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000), book("c", "2026-08-01", -10000), book("d", "2026-08-25", -999)],
      { beginningMinor: 100000, broughtForward: null },
      money,
    );
    expect(preview.months.map((m) => [m.statementDate, m.beginningMinor, m.outcome])).toEqual([
      ["2026-07-31", 100000, { kind: "agrees", paired: 2, of: 2, outstanding: 0 }],
      ["2026-08-31", 140000, { kind: "agrees", paired: 1, of: 1, outstanding: 1 }],
    ]);
    expect(preview.months[1].standings).toEqual([{ kind: "paired", how: "amount, within 5 days", bookId: "c", entryNumber: "JE-c", ticked: false }]);
    expect(preview.toSign).toBe(2);
  });

  it("stops at a month out by what the books do not have, and leaves the rest waiting", () => {
    const fee = statement("2026-07-31", 100000, 139500, [...july.lines, csvLine("2026-07-30", -500, null)]);
    const preview = simulateRun([fee, august], [book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)], { beginningMinor: 100000, broughtForward: null }, money);
    expect(preview.months.map((m) => m.outcome)).toEqual([{ kind: "outBy", differenceMinor: -500, missing: 1 }, { kind: "waiting" }]);
    expect(preview.toSign).toBe(0);
  });

  it("stops at a month that agrees only on its balance", () => {
    const preview = simulateRun(
      [july],
      [book("a", "2026-07-05", 50000), book("b", "2026-07-09", -10000)],
      { beginningMinor: 100000, broughtForward: null },
      money,
    );
    expect(preview.months[0].outcome).toEqual({ kind: "balanceOnly", unpaired: 1, of: 2 });
    expect(preview.toSign).toBe(0);
  });

  it("brings the earlier lines forward when the books agree with the first statement's opening balance", () => {
    const preview = simulateRun(
      [july],
      [book("old", "2026-06-10", 100000), book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)],
      { beginningMinor: null, broughtForward: { hasReconciliations: false, bookBalanceMinor: 100000, openLines: 1 } },
      money,
    );
    expect(preview.broughtForward?.canBringForward).toBe(true);
    expect(preview.months[0]).toMatchObject({ beginningMinor: 100000, outcome: { kind: "agrees", paired: 2, of: 2, outstanding: 0 } });
  });

  it("pairs a month whose statement writes money the other way round", () => {
    const turned = statement("2026-07-31", 100000, 140000, [csvLine("2026-07-05", -50000, null), csvLine("2026-07-20", 10000, null)]);
    const preview = simulateRun([turned], [book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)], { beginningMinor: 100000, broughtForward: null }, money);
    expect(preview.months[0].outcome).toEqual({ kind: "agrees", paired: 2, of: 2, outstanding: 0 });
  });

  it("counts a month that reaches zero as agreeing even when lines not in the books net to nothing, as the prototype does", () => {
    const netNothing = statement("2026-07-31", 100000, 140000, [...july.lines, csvLine("2026-07-10", -500, null), csvLine("2026-07-11", 500, null)]);
    const preview = simulateRun([netNothing], [book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)], { beginningMinor: 100000, broughtForward: null }, money);
    expect(preview.months[0].outcome).toEqual({ kind: "agrees", paired: 2, of: 4, outstanding: 0 });
    expect(preview.toSign).toBe(1);
  });

  it("walks the first month of an account never reconciled from zero when its statement prints no opening balance", () => {
    const noOpening = statement("2026-07-31", null, 140000, july.lines);
    const preview = simulateRun(
      [noOpening],
      [book("old", "2026-06-10", 90000), book("a", "2026-07-05", 50000), book("b", "2026-07-20", -10000)],
      { beginningMinor: null, broughtForward: { hasReconciliations: false, bookBalanceMinor: 90000, openLines: 1 } },
      money,
    );
    expect(preview.broughtForward).toBeNull();
    expect(preview.months[0]).toMatchObject({ beginningMinor: 0, outcome: { kind: "outBy", differenceMinor: 100000, missing: 0 } });
  });
});

describe("monthSentence", () => {
  it("says each outcome in a line", () => {
    expect(monthSentence({ kind: "agrees", paired: 12, of: 12, outstanding: 1 }, money)).toBe("Agrees — 12 of 12 lines paired, 1 outstanding");
    expect(monthSentence({ kind: "balanceOnly", unpaired: 3, of: 9 }, money)).toBe("Agrees on the balance only — needs a look: 3 lines did not pair");
    expect(monthSentence({ kind: "outBy", differenceMinor: -1500, missing: 1 }, money)).toBe("Out by $15.00 — the bank shows 1 thing the books do not");
    expect(monthSentence({ kind: "waiting" }, money)).toBe("Waiting");
  });
});
```

- [ ] **Step 2: Run it.**

Run: `npx vitest run tests/unit/statement-run.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/statement-run"`.

- [ ] **Step 3: Write the module** (with the Write tool — it holds regular expressions). Create `lib/domain/statement-run.ts`:

```ts
/**
 * Reconciling a run of statements in one pass — after the client's prototype
 * (Accounting System 2.28, src/p44b.html: batchRead, batchRun, batchTick, and
 * src/p44.html: readStatementText), in integer cents.
 *
 * Pure: the browser reads the files into statements, `checkRun` says which can
 * be reconciled and what stops a run, and `simulateRun` walks the months against
 * the books' open lines without writing anything. Signing is the server's, one
 * month at a time (statement-actions.ts).
 *
 * OneBook departs from the prototype in two places, each marked "OneBook:":
 *   1. a CSV listed newest first is read oldest first before it is cut into
 *      months, so a month never opens or closes on the wrong line of its first
 *      or last day;
 *   2. a month that agrees only on its balance stops the run for a person, where
 *      the prototype ticks every line and signs it.
 */
import { shortDate } from "./pdf-statement-view";
import { statementProof, toStatementLines, type PdfStatement } from "./pdf-statement";
import {
  bringForwardAdvice,
  statementStandings,
  type BringForwardAdvice,
  type BroughtForwardPreview,
  type Standing,
} from "./reconcile-statement";
import type { StatementLine } from "./statement-import";

export type RunSource = "PDF" | "CSV";

/** One statement of a run: a PDF statement, or one month of a CSV. */
export interface RunStatement {
  /** Unique within the run. */
  key: string;
  /** Kept with the reconciliation as its statement's name. */
  fileName: string;
  source: RunSource;
  from: string | null;
  /** The statement date; null when none could be read. */
  to: string | null;
  openingMinor: number | null;
  closingMinor: number | null;
  lines: StatementLine[];
  /** Why this statement cannot prove a month, when it cannot. */
  problem: string | null;
  /** A PDF's own proof: closing less (opening + lines); null when it prints no balances or is a CSV month. */
  outByMinor: number | null;
}

export const RUN_MESSAGES = {
  noClosing: "Cannot prove a month — no closing balance",
  noDate: "No statement date could be found",
  balancesDoNotFollow: "The running balances do not follow the lines",
  notThisAccount: "Not this account",
  noBalanceFormat: "OFX, QFX, QBO and QIF files carry no running balance, so they cannot prove a month",
  noLines: "No dated amounts could be read out of this file",
} as const;

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * A CSV export cut into calendar months, each closing at the last running
 * balance in it and opening at its first balance less that line's amount
 * (p44.html: readStatementText). Lines of no amount are dropped, as the
 * prototype drops them. Without a running balance a month cannot prove itself.
 */
export function monthsFromCsv(fileName: string, lines: readonly StatementLine[]): RunStatement[] {
  const kept = lines.filter((line) => line.amount_minor !== 0);
  if (!kept.length) return [];
  // OneBook: a file listed newest first is read oldest first. The prototype
  // keeps the file's order within a day, so a newest-first file closes a month
  // on that day's first line and opens it on the first day's last.
  const newestFirst = kept[0].txn_date > kept[kept.length - 1].txn_date;
  const ordered = (newestFirst ? [...kept].reverse() : kept)
    .map((line, order) => ({ line, order }))
    .sort((a, b) => (a.line.txn_date < b.line.txn_date ? -1 : a.line.txn_date > b.line.txn_date ? 1 : a.order - b.order))
    .map(({ line }) => line);

  const months = new Map<string, StatementLine[]>();
  for (const line of ordered) {
    const month = line.txn_date.slice(0, 7);
    const list = months.get(month);
    if (list) list.push(line);
    else months.set(month, [line]);
  }
  const many = months.size > 1;
  return [...months.entries()].map(([month, monthLines]) => {
    const withBalance = monthLines.filter((line) => line.running_balance_minor !== null);
    const last = withBalance[withBalance.length - 1];
    const first = withBalance[0];
    const closingMinor = last ? (last.running_balance_minor as number) : null;
    const openingMinor = first ? (first.running_balance_minor as number) - first.amount_minor : null;
    let problem: string | null = closingMinor === null ? RUN_MESSAGES.noClosing : null;
    if (!problem) {
      for (let i = 1; i < monthLines.length; i++) {
        const before = monthLines[i - 1].running_balance_minor;
        const after = monthLines[i].running_balance_minor;
        if (before !== null && after !== null && after !== before + monthLines[i].amount_minor) {
          problem = RUN_MESSAGES.balancesDoNotFollow;
          break;
        }
      }
    }
    const [year, mm] = month.split("-").map(Number);
    return {
      key: `${fileName}#${month}`,
      fileName: many ? `${fileName} (${month})` : fileName,
      source: "CSV" as const,
      from: `${month}-01`,
      to: `${month}-${String(lastDayOf(year, mm)).padStart(2, "0")}`,
      openingMinor,
      closingMinor,
      lines: monthLines,
      problem,
      outByMinor: null,
    };
  });
}

/**
 * The statements of a PDF that belong to this bank account: those naming an
 * account that ends in its last four digits, or every one when none names an
 * account. A statement naming another account is kept and marked, so the person
 * sees why it is left out.
 */
export function statementsFromPdf(
  fileName: string,
  statements: readonly PdfStatement[],
  maskedNumber: string | null,
): RunStatement[] {
  const last4 = (maskedNumber ?? "").replace(/\D/g, "").slice(-4);
  const named = statements.some((s) => s.accountNumber);
  const many = statements.length > 1;
  return statements.map((s, i) => {
    const ours = !named || last4.length < 4 || (s.accountNumber ?? "").slice(-4) === last4;
    const { differenceMinor } = statementProof(s);
    let problem: string | null = null;
    if (!ours) problem = RUN_MESSAGES.notThisAccount;
    else if (!s.to) problem = RUN_MESSAGES.noDate;
    else if (s.closingMinor === null) problem = RUN_MESSAGES.noClosing;
    const label = s.to ? s.to.slice(0, 7) : s.accountNumber ? s.accountNumber.slice(-4) : String(i + 1);
    return {
      key: `${fileName}#${i}`,
      fileName: many ? `${fileName} (${label})` : fileName,
      source: "PDF" as const,
      from: s.from,
      to: s.to,
      openingMinor: s.openingMinor,
      closingMinor: s.closingMinor,
      lines: toStatementLines(s),
      problem,
      outByMinor: differenceMinor === null || differenceMinor === 0 ? null : differenceMinor,
    };
  });
}

export interface RunContext {
  /** The newest completed reconciliation of the account. */
  lastCompleted: { date: string; endingMinor: number } | null;
  /** Statement dates of the account's completed reconciliations. */
  completedDates: readonly string[];
  inProgress: { id: string; date: string } | null;
}

export type RunState = "usable" | "unreadable" | "duplicate" | "already" | "before";

export interface CheckedStatement {
  statement: RunStatement;
  state: RunState;
  /** What the statements table says about it. */
  note: string;
}

export interface RunCheck {
  /** Every statement, by statement date; those without one last. */
  statements: CheckedStatement[];
  /** The statements a run reconciles, oldest first. */
  usable: RunStatement[];
  /** What stops a run; empty when it can go. */
  stops: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Which statements a run can reconcile, and what stops it: a gap between two
 * statements (p44b.html: the run is disabled), a first statement that does not
 * open where the last reconciliation closed, or a reconciliation in progress.
 */
export function checkRun(
  statements: readonly RunStatement[],
  context: RunContext,
  money: (minor: number) => string,
): RunCheck {
  const ordered = [...statements].sort((a, b) => (a.to ?? "9999") < (b.to ?? "9999") ? -1 : (a.to ?? "9999") > (b.to ?? "9999") ? 1 : 0);
  const completed = new Set(context.completedDates);
  const kept = new Set<string>();
  const checked: CheckedStatement[] = ordered.map((statement) => {
    if (statement.problem || !statement.to) return { statement, state: "unreadable", note: statement.problem ?? RUN_MESSAGES.noDate };
    if (completed.has(statement.to)) return { statement, state: "already", note: "Already signed off" };
    if (context.lastCompleted && statement.to < context.lastCompleted.date) {
      return { statement, state: "before", note: "Before the last reconciliation" };
    }
    if (kept.has(statement.to)) return { statement, state: "duplicate", note: "Same month as another file" };
    kept.add(statement.to);
    const lines = plural(statement.lines.length, "line");
    const note = statement.outByMinor === null ? lines : `${lines} — does not prove itself, out by ${money(Math.abs(statement.outByMinor))}`;
    return { statement, state: "usable", note };
  });
  const usable = checked.filter((c) => c.state === "usable").map((c) => c.statement);

  const stops: string[] = [];
  if (context.inProgress) {
    stops.push(
      `A reconciliation to ${shortDate(context.inProgress.date, true)} is in progress on this account. Finish it before reconciling more statements.`,
    );
  }
  if (!usable.length) stops.push("Nothing here can be reconciled yet.");
  const first = usable[0];
  if (first && context.lastCompleted && first.openingMinor !== null && first.openingMinor !== context.lastCompleted.endingMinor) {
    stops.push(
      `The statement closing ${shortDate(first.to as string, true)} opens at ${money(first.openingMinor)}, and the last reconciliation, ` +
        `to ${shortDate(context.lastCompleted.date, true)}, closed at ${money(context.lastCompleted.endingMinor)}: a month is missing ` +
        "between them, or that reconciliation closed on another figure.",
    );
  }
  const gaps = usable.filter((s, i) => i > 0 && s.openingMinor !== null && s.openingMinor !== usable[i - 1].closingMinor);
  if (gaps.length) {
    stops.push(
      `There is a gap in the run. The statement closing ${gaps.map((s) => shortDate(s.to as string, true)).join(", ")} ` +
        "does not open at the one before it, so a month is missing from what you have chosen. Reconciling across a gap " +
        "would sign off items nobody has seen a statement for.",
    );
  }
  return { statements: checked, usable, stops };
}

/** A book line not yet in a completed reconciliation, in book order (date, entry, line). */
export interface OpenBookLine {
  id: string;
  date: string;
  amountMinor: number;
  reference: string | null;
  entryNumber: string | null;
}

export type MonthOutcome =
  | { kind: "agrees"; paired: number; of: number; outstanding: number }
  | { kind: "balanceOnly"; unpaired: number; of: number }
  | { kind: "outBy"; differenceMinor: number; missing: number }
  | { kind: "waiting" };

export interface RunMonth {
  key: string;
  statementDate: string;
  beginningMinor: number;
  closingMinor: number;
  outcome: MonthOutcome;
  /** How each statement line stands with the books (1.79's standings); empty for a waiting month. */
  standings: Standing[];
}

export interface RunPreview {
  /** 1.79's bring-forward advice, when the account has no reconciliation. */
  broughtForward: BringForwardAdvice | null;
  months: RunMonth[];
  /** The agreeing months from the oldest, signed by one click. */
  toSign: number;
}

export interface RunStart {
  /** The newest completed reconciliation's ending balance; null when the account has none. */
  beginningMinor: number | null;
  /** 1.79's preview for the day before the first statement's period; null when the account has a reconciliation. */
  broughtForward: BroughtForwardPreview | null;
}

/**
 * The run walked month by month against the books, writing nothing
 * (p44b.html: batchRun, batchTick). Each month begins where the one before it
 * closed; its lines are paired with the book lines still open to its statement
 * date; the lines it pairs are not offered to a later month. The first month
 * that does not agree line for line stops the walk.
 */
export function simulateRun(
  usable: readonly RunStatement[],
  openLines: readonly OpenBookLine[],
  start: RunStart,
  money: (minor: number) => string,
): RunPreview {
  let open = [...openLines];
  let beginning = start.beginningMinor ?? 0;
  let broughtForward: BringForwardAdvice | null = null;
  const first = usable[0];
  if (start.broughtForward && first) {
    broughtForward = bringForwardAdvice(start.broughtForward, { from: first.from, openingMinor: first.openingMinor }, money);
    if (broughtForward?.canBringForward && first.openingMinor !== null) {
      const through = broughtForward.through;
      open = open.filter((line) => line.date > through);
      beginning = first.openingMinor;
    }
  }

  const months: RunMonth[] = [];
  let stopped = false;
  let toSign = 0;
  for (const statement of usable) {
    const to = statement.to as string;
    const closing = statement.closingMinor as number;
    if (stopped) {
      months.push({ key: statement.key, statementDate: to, beginningMinor: beginning, closingMinor: closing, outcome: { kind: "waiting" }, standings: [] });
      continue;
    }
    const monthBeginning = beginning;
    const available = open.filter((line) => line.date <= to);
    const result = statementStandings(
      statement.lines.map((line, lineNo) => ({ lineNo, date: line.txn_date, amountMinor: line.amount_minor, reference: line.reference })),
      available.map((line) => ({ ...line, cleared: false })),
      to,
    );
    const pairedIds = new Set(result.standings.flatMap((s) => (s.kind === "paired" ? [s.bookId] : [])));
    const pairedMinor = available.reduce((sum, line) => (pairedIds.has(line.id) ? sum + line.amountMinor : sum), 0);
    const differenceMinor = closing - (monthBeginning + pairedMinor);
    const of = statement.lines.length - result.after;
    let outcome: MonthOutcome;
    if (differenceMinor === 0) {
      outcome = { kind: "agrees", paired: result.paired, of, outstanding: result.outstanding.length };
      open = open.filter((line) => !pairedIds.has(line.id));
      beginning = closing;
      toSign += 1;
    } else if (monthBeginning + available.reduce((sum, line) => sum + line.amountMinor, 0) === closing) {
      // OneBook: the prototype ticks every open line here and signs the month.
      outcome = { kind: "balanceOnly", unpaired: result.missing, of };
      stopped = true;
    } else {
      outcome = { kind: "outBy", differenceMinor, missing: result.missing };
      stopped = true;
    }
    months.push({ key: statement.key, statementDate: to, beginningMinor: monthBeginning, closingMinor: closing, outcome, standings: result.standings });
  }
  return { broughtForward, months, toSign };
}

/** What a month's row says in the preview. */
export function monthSentence(outcome: MonthOutcome, money: (minor: number) => string): string {
  switch (outcome.kind) {
    case "agrees":
      return `Agrees — ${outcome.paired} of ${plural(outcome.of, "line")} paired${outcome.outstanding ? `, ${outcome.outstanding} outstanding` : ""}`;
    case "balanceOnly":
      return `Agrees on the balance only — needs a look: ${plural(outcome.unpaired, "line")} did not pair`;
    case "outBy":
      return `Out by ${money(Math.abs(outcome.differenceMinor))}${outcome.missing ? ` — the bank shows ${plural(outcome.missing, "thing")} the books do not` : ""}`;
    case "waiting":
      return "Waiting";
  }
}
```

- [ ] **Step 4: Run it.**

Run: `npx vitest run tests/unit/statement-run.test.ts`
Expected: 19 passed.

- [ ] **Step 5: Prove the month cutting against the prototype.** Create `tests/parity/statement-run.parity.ts` (with the Write tool):

```ts
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { detectDateOrder, detectStatementColumns, parseStatementRows } from "@/lib/domain/statement-import";
import { monthsFromCsv } from "@/lib/domain/statement-run";
import { openPrototype } from "./prototype";

/**
 * Cutting a CSV export into monthly statements, against the prototype's own
 * readStatementText (src/p44.html), in its own page: the same invented files go
 * through both, and each month's dates, opening and closing balances and lines
 * must be the same — except where a file listed newest first has two lines on
 * a month's first or last day. There the prototype opens or closes the month on
 * the wrong line (it keeps the file's order within a day), and OneBook must
 * differ; each such file says which month and why.
 *
 *   PARITY_PROTOTYPE_HTML  the built prototype, accounting-system.html (required)
 *
 * Run: npm run parity
 */
interface Month {
  from: string;
  to: string;
  opening: number | null;
  closing: number | null;
  lines: [string, number][];
}

interface Scenario {
  name: string;
  csv: string;
  /**
   * Months where OneBook departs on purpose: the opening and closing the
   * prototype reads, and the ones the file's balances truly give.
   */
  departs?: Record<string, { prototype: [number, number]; truly: [number, number] }>;
}

const SCENARIOS: Scenario[] = [
  {
    name: "oldestFirstSignedAmount",
    csv: [
      "Date,Description,Amount,Balance",
      "07/03/2026,DEPOSIT 0042,500.00,1500.00",
      "07/20/2026,CARD PURCHASE EXAMPLE STORE,-25.00,1475.00",
      "07/31/2026,SERVICE FEE,-5.00,1470.00",
      "08/02/2026,CHECK 1201,-75.00,1395.00",
      "08/31/2026,DEPOSIT 0043,10.00,1405.00",
    ].join("\n"),
  },
  {
    name: "withdrawalsAndDeposits",
    csv: [
      "Date,Description,Withdrawals,Deposits,Balance",
      "09/01/2026,OPENING DEPOSIT,,1000.00,1000.00",
      "09/15/2026,RENT,400.00,,600.00",
      "10/01/2026,PAYROLL,,250.00,850.00",
      "10/02/2026,UTILITY,50.00,,800.00",
    ].join("\n"),
  },
  {
    name: "newestFirstOneLineADay",
    csv: [
      "Date,Description,Amount,Balance",
      "08/20/2026,DEPOSIT,100.00,1300.00",
      "08/05/2026,FEE,-10.00,1200.00",
      "07/28/2026,DEPOSIT,200.00,1210.00",
      "07/02/2026,PAYMENT,-90.00,1010.00",
    ].join("\n"),
  },
  {
    name: "newestFirstTwoLinesOnAMonthsEdges",
    csv: [
      "Date,Description,Amount,Balance",
      "07/31/2026,SECOND OF THE DAY,-3.00,992.00",
      "07/31/2026,FIRST OF THE DAY,-5.00,995.00",
      "07/02/2026,LATER,-50.00,1000.00",
      "07/02/2026,EARLIER,50.00,1050.00",
    ].join("\n"),
    // In time order: +50.00 to 1,050.00, -50.00 to 1,000.00, -5.00 to 995.00,
    // -3.00 to 992.00. The month opens at 1,000.00 and closes at 992.00; the
    // prototype opens it on the LATER line and closes it on the FIRST.
    departs: { "2026-07-31": { prototype: [105000, 99500], truly: [100000, 99200] } },
  },
  {
    name: "noBalanceColumn",
    csv: ["Date,Description,Amount", "07/03/2026,DEPOSIT,500.00", "08/04/2026,FEE,-5.00"].join("\n"),
  },
];

function onebook(csv: string): Month[] {
  const records = parseCsv(csv);
  const headers = records.length ? Object.keys(records[0]) : [];
  const { columns } = detectStatementColumns(headers);
  const dateOrder = detectDateOrder(records.map((r) => (columns.date ? r[columns.date] ?? "" : "")));
  const { rows } = parseStatementRows(records, { columns, dateOrder });
  return monthsFromCsv("file.csv", rows).map((m) => ({
    from: m.from as string,
    to: m.to as string,
    opening: m.openingMinor,
    closing: m.closingMinor,
    lines: m.lines.map((l) => [l.txn_date, l.amount_minor] as [string, number]),
  }));
}

const RUN = `(function (csv) {
  var cents = function (x) { return x === undefined || x === null || isNaN(x) ? null : Math.round(x * 100); };
  var read = readStatementText(csv);
  return read.periods.map(function (p) {
    return {
      from: p.from, to: p.to, opening: cents(p.opening), closing: cents(p.closing),
      lines: p.lines.map(function (l) { return [l.date, cents(l.amount)]; })
    };
  });
})`;

describe("cutting a CSV into months against the prototype", () => {
  it("cuts every invented file as the prototype does, and departs only where it reads a newest-first file wrong", async () => {
    const htmlPath = process.env.PARITY_PROTOTYPE_HTML?.trim();
    if (!htmlPath) throw new Error("Set PARITY_PROTOTYPE_HTML to the prototype's accounting-system.html");
    const browser = await chromium.launch();
    try {
      const page = await openPrototype(browser, htmlPath);
      let agreed = 0;
      let departed = 0;
      for (const scenario of SCENARIOS) {
        const prototype = (await page.evaluate(`${RUN}(${JSON.stringify(scenario.csv)})`)) as Month[];
        const ours = onebook(scenario.csv);
        expect(ours.map((m) => m.to), scenario.name).toEqual(prototype.map((m) => m.to));
        for (const [i, month] of ours.entries()) {
          const label = `${scenario.name} ${month.to}`;
          const departure = scenario.departs?.[month.to];
          if (departure) {
            expect([prototype[i].opening, prototype[i].closing], `${label}: the prototype's reading`).toEqual(departure.prototype);
            expect([month.opening, month.closing], `${label}: OneBook's reading`).toEqual(departure.truly);
            expect(month.lines.slice().sort(), label).toEqual(prototype[i].lines.slice().sort());
            departed++;
          } else {
            expect(month, label).toEqual(prototype[i]);
            agreed++;
          }
        }
      }
      console.log(`parity: CSV months: ${agreed} agree with the prototype, ${departed} depart on purpose`);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
```

Run (Git Bash): `PARITY_PROTOTYPE_HTML="C:/Users/pit010/Accounting System 2.28 - source/accounting-system.html" node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.parity.config.ts tests/parity/statement-run.parity.ts --reporter=verbose`
Expected: `parity: CSV months: 8 agree with the prototype, 1 depart on purpose`, and 1 passed. If the prototype file is not there, report it — do not skip the step.

- [ ] **Step 6: Lint and commit.**

Run: `npx eslint lib/domain/statement-run.ts tests/unit/statement-run.test.ts tests/parity/statement-run.parity.ts` — Expected: prints nothing.

```bash
git add lib/domain/statement-run.ts tests/unit/statement-run.test.ts tests/parity/statement-run.parity.ts
printf 'feat(reconcile): a run of statements, cut into months, checked and walked\n\nA CSV is cut into calendar months as the prototype cuts it, but read oldest\nfirst; a run stops at a gap, at a month out of step with the last\nreconciliation, and at a reconciliation in progress; the walk pairs each month\nwith the open book lines and stops at the first that does not agree line for\nline.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: The pieces a run shares

**Files:**
- Create: `lib/client/statement-columns.ts`
- Modify: `app/(app)/banking/ImportStatementModal.tsx` (whole file below: its column memory moves to the helper)
- Create: `app/(app)/banking/reconcile/StandingTag.tsx`
- Modify: `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` (whole file below: it imports the tag)
- Create: `lib/client/run-files.ts`
- Test: `tests/unit/run-files.test.ts`
- Modify: `lib/services/bankrec.ts` (whole file below: `getBankOpenLines` at its end)

**Interfaces:**
- Consumes: Task 1's `acc_bank_open_lines`; Task 2's `monthsFromCsv`, `statementsFromPdf`, `RUN_MESSAGES`, `RunSource`, `RunStatement`, `OpenBookLine`; 1.78's `readPdfStatementFile` (`lib/client/pdf-text.ts`), `detectStatementFormat` (`lib/domain/statement-files.ts`); 1.79's `pairedHowLabel`, `Standing`.
- Produces: `CsvColumnChoice`, `rememberedColumns(bankAccountId, headers): CsvColumnChoice | null`, `rememberColumns(bankAccountId, choice): void` (same localStorage key as before, `onebook.statement-columns.<id>`); `StandingTag` (default export, prop `standing: Standing`); `RunBankAccount { id; maskedNumber; decimals }`, `readRunFile(file: File, bank: RunBankAccount): Promise<RunStatement[]>`; `getBankOpenLines(sb, bankAccountId, through): Promise<OpenBookLine[]>`.

- [ ] **Step 1: The column memory, shared.** Create `lib/client/statement-columns.ts`:

```ts
/**
 * Which column of a bank's CSV holds what, remembered per bank account in this
 * browser — chosen once on Import statement, used again there and when a run of
 * statements is reconciled from the same bank's files. A convenience: when the
 * browser keeps nothing, the columns are detected again.
 */
import type { DateOrder, StatementColumnMap } from "@/lib/domain/statement-import";

export interface CsvColumnChoice {
  columns: StatementColumnMap;
  dateOrder: DateOrder;
  flipSigns: boolean;
}

const storageKey = (bankAccountId: string) => `onebook.statement-columns.${bankAccountId}`;

/** The choice remembered for this bank account, when every column it names is in this file. */
export function rememberedColumns(bankAccountId: string, headers: readonly string[]): CsvColumnChoice | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(bankAccountId)) ?? "null") as CsvColumnChoice | null;
    if (!saved) return null;
    const used = Object.values(saved.columns).filter((c): c is string => Boolean(c));
    return used.every((c) => headers.includes(c)) ? saved : null;
  } catch {
    return null;
  }
}

export function rememberColumns(bankAccountId: string, choice: CsvColumnChoice): void {
  try {
    localStorage.setItem(storageKey(bankAccountId), JSON.stringify(choice));
  } catch {
    // Remembering the columns is a convenience; nothing needs it.
  }
}
```

Replace the whole of `app/(app)/banking/ImportStatementModal.tsx` with (write it with the Write tool — it holds a regular expression):

```tsx
"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Modal, Select, Space, Typography, Upload } from "antd";
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
import { rememberColumns, rememberedColumns, type CsvColumnChoice } from "@/lib/client/statement-columns";
import PdfStatementPreview, { ReadingPdf, UnreadableFile, WrongAccountAlert } from "./PdfStatementPreview";

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

type CsvChoice = CsvColumnChoice;

const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

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
      const remembered = rememberedColumns(bankAccount.id, headers);
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
    if (file.kind === "csv" && choice) rememberColumns(bankAccount.id, choice);
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

      {file.kind === "reading" ? <ReadingPdf /> : null}

      {file.kind === "unsupported" ? <UnreadableFile message={file.message} /> : null}

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

- [ ] **Step 2: The standing tag, shared.** Create `app/(app)/banking/reconcile/StandingTag.tsx`:

```tsx
"use client";
import { Space, Tag, Typography } from "antd";
import { pairedHowLabel, type Standing } from "@/lib/domain/reconcile-statement";

/** How one statement line stands with the books — on a reconciliation, and in a run's preview. */
export default function StandingTag({ standing }: { standing: Standing }) {
  if (standing.kind === "after") return <Tag>After the statement date</Tag>;
  if (standing.kind === "missing") return <Tag color="orange">Not in the books</Tag>;
  return (
    <Space size={4} direction="vertical">
      <Tag color={standing.ticked ? "green" : "gold"}>
        Paired · {pairedHowLabel(standing.how)}
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
```

Replace the whole of `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` with:

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
import StandingTag from "../StandingTag";

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
            This statement shows money in and out the other way around; its amounts were reversed to pair them.
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

- [ ] **Step 3: Reading a run's file.** First create `tests/unit/run-files.test.ts` — the last test pins that a file the browser cannot read stays in the run as a row that says so, never a file that silently drops out:

```ts
import { describe, expect, it } from "vitest";
import { readRunFile } from "@/lib/client/run-files";
import { RUN_MESSAGES } from "@/lib/domain/statement-run";

const bank = { id: "bank-1", maskedNumber: "****7917", decimals: 2 };

describe("readRunFile", () => {
  it("cuts a CSV with a running balance into months", async () => {
    const csv = new File(
      ["Date,Description,Amount,Balance\n07/03/2026,DEPOSIT,500.00,1500.00\n08/04/2026,FEE,-5.00,1495.00\n"],
      "bank.csv",
      { type: "text/csv" },
    );
    const read = await readRunFile(csv, bank);
    expect(read.map((s) => [s.fileName, s.to, s.openingMinor, s.closingMinor, s.problem])).toEqual([
      ["bank.csv (2026-07)", "2026-07-31", 100000, 150000, null],
      ["bank.csv (2026-08)", "2026-08-31", 150000, 149500, null],
    ]);
  });

  it("refuses an OFX file, which carries no running balance", async () => {
    const ofx = new File(["OFXHEADER:100\n<OFX></OFX>"], "bank.ofx");
    const [only] = await readRunFile(ofx, bank);
    expect([only.fileName, only.problem]).toEqual(["bank.ofx", RUN_MESSAGES.noBalanceFormat]);
  });

  it("says a CSV's columns were not recognized", async () => {
    const odd = new File(["When,What,How much\n07/03/2026,DEPOSIT,500.00\n"], "odd.csv");
    const [only] = await readRunFile(odd, bank);
    expect(only.problem).toBe("Its columns were not recognized — import it once on Banking to choose them");
  });

  it("keeps a file that cannot be read as a row that says so", async () => {
    const broken = { name: "broken.csv", type: "text/csv", text: () => Promise.reject(new Error("gone")) } as unknown as File;
    const [only] = await readRunFile(broken, bank);
    expect([only.fileName, only.source, only.problem]).toEqual(["broken.csv", "CSV", "This file could not be read"]);
  });
});
```

Run: `npx vitest run tests/unit/run-files.test.ts` — Expected: FAIL (`@/lib/client/run-files` does not exist yet).

Then create `lib/client/run-files.ts` (with the Write tool — it holds a regular expression):

```ts
/**
 * One statement file read in the browser into the statements of a run: a PDF
 * by 1.78's reader, a CSV cut into months. The file never leaves the browser;
 * only the lines read are sent. A file that cannot prove a month — or cannot be
 * read at all — comes back as one statement saying why, so the person sees
 * every file they chose.
 */
import { parseCsv } from "@/lib/csv";
import { rememberedColumns } from "@/lib/client/statement-columns";
import { detectStatementFormat } from "@/lib/domain/statement-files";
import {
  detectDateOrder,
  detectStatementColumns,
  parseStatementRows,
  statementColumnsComplete,
} from "@/lib/domain/statement-import";
import { RUN_MESSAGES, monthsFromCsv, statementsFromPdf, type RunSource, type RunStatement } from "@/lib/domain/statement-run";

export interface RunBankAccount {
  id: string;
  maskedNumber: string | null;
  decimals: number;
}

const COLUMNS_NOT_RECOGNIZED = "Its columns were not recognized — import it once on Banking to choose them";
const COULD_NOT_READ = "This file could not be read";

const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf";

function unreadable(fileName: string, source: RunSource, problem: string): RunStatement {
  return {
    key: `${fileName}#unreadable`,
    fileName,
    source,
    from: null,
    to: null,
    openingMinor: null,
    closingMinor: null,
    lines: [],
    problem,
    outByMinor: null,
  };
}

async function readPdf(file: File, bank: RunBankAccount): Promise<RunStatement[]> {
  const { readPdfStatementFile } = await import("@/lib/client/pdf-text");
  const result = await readPdfStatementFile(file, bank.decimals);
  if ("message" in result) return [unreadable(file.name, "PDF", result.message)];
  return statementsFromPdf(file.name, result.statements, bank.maskedNumber);
}

async function readFile(file: File, bank: RunBankAccount): Promise<RunStatement[]> {
  if (isPdfFile(file)) return readPdf(file, bank);
  const text = await file.text();
  const verdict = detectStatementFormat(file.name, text);
  if ("unsupported" in verdict) return [unreadable(file.name, "CSV", verdict.unsupported)];
  if (verdict.format === "pdf") return readPdf(file, bank);
  if (verdict.format !== "csv") return [unreadable(file.name, "CSV", RUN_MESSAGES.noBalanceFormat)];

  const records = parseCsv(text);
  const headers = records.length ? Object.keys(records[0]) : [];
  const remembered = rememberedColumns(bank.id, headers);
  const columns = remembered?.columns ?? detectStatementColumns(headers).columns;
  if (!statementColumnsComplete(columns)) return [unreadable(file.name, "CSV", COLUMNS_NOT_RECOGNIZED)];
  const dateOrder = remembered?.dateOrder ?? detectDateOrder(records.map((r) => (columns.date ? r[columns.date] ?? "" : "")));
  const { rows } = parseStatementRows(records, {
    decimals: bank.decimals,
    columns,
    dateOrder,
    flipSigns: remembered?.flipSigns ?? false,
  });
  const months = monthsFromCsv(file.name, rows);
  return months.length ? months : [unreadable(file.name, "CSV", RUN_MESSAGES.noLines)];
}

export async function readRunFile(file: File, bank: RunBankAccount): Promise<RunStatement[]> {
  try {
    return await readFile(file, bank);
  } catch {
    // A file the browser cannot open, or a reader that fails on it, is still a
    // row that says so — never a file that silently drops out of the run.
    return [unreadable(file.name, isPdfFile(file) ? "PDF" : "CSV", COULD_NOT_READ)];
  }
}
```

Run: `npx vitest run tests/unit/run-files.test.ts` — Expected: 4 passed.

- [ ] **Step 4: The open lines, read.** Replace the whole of `lib/services/bankrec.ts` with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatementReconciliationRow } from "@/lib/db/types";
import { readAllPages } from "@/lib/services/paging";
import type { ReconciliationCreateInput, ReconciliationAdjustmentInput, ReconciliationReopenInput } from "@/lib/domain/schemas";
import type { StatementLine } from "@/lib/domain/statement-import";
import { reconciliationStandings, type BroughtForwardPreview, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import type { OpenBookLine } from "@/lib/domain/statement-run";

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

/** A reconciliation's account, date and statement, or null when no reconciliation has this id. */
export async function findReconciliationHeader(sb: SupabaseClient, id: string): Promise<ReconStatementHeader | null> {
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date,status,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new BankRecError(error.message);
  if (!data) return null;
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

export async function getReconciliationHeader(sb: SupabaseClient, id: string): Promise<ReconStatementHeader> {
  const header = await findReconciliationHeader(sb, id);
  if (!header) throw new BankRecError("Reconciliation not found");
  return header;
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

/**
 * A bank account's posted lines to a day that no completed reconciliation holds,
 * in book order — what a run of statements is walked against before anything
 * is written. Paged: an account carries more than a thousand lines easily, and
 * the line id settles two lines of one entry.
 */
export async function getBankOpenLines(sb: SupabaseClient, bankAccountId: string, through: string): Promise<OpenBookLine[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_bank_open_lines", { p_bank_account_id: bankAccountId, p_through: through })
        .order("entry_date")
        .order("entry_number")
        .order("journal_line_id")
        .range(from, to),
    (message) => new BankRecError(message),
  );
  return rows.map((r) => ({
    id: r.journal_line_id as string,
    date: r.entry_date as string,
    amountMinor: Number(r.signed_minor),
    reference: (r.reference as string) ?? null,
    entryNumber: (r.entry_number as string) ?? null,
  }));
}
```

- [ ] **Step 5: Typecheck, lint, the tests near it.**

Run: `npm run typecheck` — Expected: no errors.
Run: `npx eslint "app/(app)/banking" lib/client lib/services/bankrec.ts` — Expected: prints nothing.
Run: `npx vitest run tests/unit/reconcile-statement-service.test.ts tests/unit/banking-paged-reads.test.ts tests/unit/statement-run.test.ts tests/unit/run-files.test.ts` — Expected: all pass.

- [ ] **Step 6: Commit.**

```bash
git add lib/client/statement-columns.ts "app/(app)/banking/ImportStatementModal.tsx" "app/(app)/banking/reconcile/StandingTag.tsx" "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx" lib/client/run-files.ts tests/unit/run-files.test.ts lib/services/bankrec.ts
printf 'refactor(reconcile): the column memory, the standing tag and the file reader a run shares\n\nAnd the account'"'"'s open lines read in book order, past the row cap.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: Reconcile from statement files

**Files:**
- Modify: `lib/domain/schemas.ts` (the start schema of 1.79 becomes the run's two schemas)
- Modify: `tests/unit/reconciliation-statement-schemas.test.ts` (whole file below)
- Modify: `app/(app)/banking/reconcile/statement-actions.ts` (whole file below)
- Create: `app/(app)/banking/reconcile/from-files/page.tsx`
- Create: `app/(app)/banking/reconcile/from-files/FromFilesClient.tsx`
- Modify: `app/(app)/banking/reconcile/ReconcileListClient.tsx` (whole file below)
- Modify: `app/(app)/banking/reconcile/page.tsx` (whole file below)
- Delete: `app/(app)/banking/reconcile/StartFromStatementModal.tsx`

**Interfaces:**
- Consumes: Task 2's `checkRun`, `simulateRun`, `monthSentence` and types; Task 3's `readRunFile`, `StandingTag`, `getBankOpenLines`; 1.79's services (`createReconciliationFromStatement`, `pairAndTick`, `bringForward`, `getBroughtForwardPreview`, `listReconciliations`, `getReconciliationDetail`, `completeReconciliation`), `broughtForwardNote`, `dayBefore`; `formatMoney` (`lib/format.ts`); `USD_CURRENCY_CODE` (`lib/domain/currency.ts`).
- Produces: `runPreviewSchema` / `RunPreviewInput`, `runMonthSchema` / `RunMonthInput` (in place of `reconciliationFromStatementSchema`); in `statement-actions.ts`, `previewRunAction(raw): Promise<ActionResult<RunPreview>>`, `RunMonthResult { id; signed; differenceMinor }`, `reconcileRunMonthAction(raw): Promise<ActionResult<RunMonthResult>>` — `startReconciliationFromStatementAction`, `StartFromStatementSummary` and `broughtForwardPreviewAction` are removed; the page `/banking/reconcile/from-files?account=<bank account id>`; the list's button **From statement files**.

- [ ] **Step 1: The schemas.** In `lib/domain/schemas.ts`, replace the whole block from the line `/** A reconciliation started from a PDF statement: its date and closing balance are the statement's. */` through the line `export type ReconciliationFromStatementInput = z.infer<typeof reconciliationFromStatementSchema>;` with (Edit tool):

```ts
/** A run of statements as its preview reads them: each statement's dates and balances, and its lines' dates, amounts and references. */
export const runPreviewSchema = z.object({
  bank_account_id: z.uuid("Select a bank account"),
  statements: z
    .array(
      z.object({
        key: z.string().min(1).max(400),
        from: statementDay.nullable(),
        to: statementDay,
        opening_minor: z.number().int().nullable(),
        closing_minor: z.number().int(),
        lines: z
          .array(z.object({ txn_date: statementDay, amount_minor: z.number().int(), reference: z.string().nullable() }))
          .max(5000, "A statement can hold at most 5,000 lines"),
      }),
    )
    .min(1, "Choose at least one statement")
    .max(60, "A run can hold at most 60 statements"),
});
export type RunPreviewInput = z.infer<typeof runPreviewSchema>;

/**
 * One step of a run, signed on the server: bringing the account's earlier lines
 * forward, or one month started from its statement — completed when `sign` is
 * set and it reaches zero, left in progress otherwise.
 */
export const runMonthSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bring_forward"),
    bank_account_id: z.uuid("Select a bank account"),
    period_from: statementDay,
    statement_date: statementDay,
    opening_minor: z.number().int(),
  }),
  reconciliationStatementSchema.extend({
    kind: z.literal("month"),
    bank_account_id: z.uuid("Select a bank account"),
    statement_date: statementDay,
    closing_minor: z.number().int("The statement prints no closing balance"),
    sign: z.boolean(),
  }),
]);
export type RunMonthInput = z.infer<typeof runMonthSchema>;
```

- [ ] **Step 2: Their tests.** Replace the whole of `tests/unit/reconciliation-statement-schemas.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { reconciliationStatementSchema, runMonthSchema, runPreviewSchema } from "@/lib/domain/schemas";

const line = {
  txn_date: "2026-09-05",
  description: "FEE",
  reference: null,
  amount_minor: -500,
  running_balance_minor: null,
  raw_line: "x",
};
const statement = { file_name: "september.pdf", opening_minor: 75000, closing_minor: 74500, lines: [line] };
const BANK = "6f1c1d4e-0a3b-4c2d-9e8f-1a2b3c4d5e6f";
const month = { ...statement, kind: "month", bank_account_id: BANK, statement_date: "2026-09-30", sign: true };
const bringForward = { kind: "bring_forward", bank_account_id: BANK, period_from: "2026-09-01", statement_date: "2026-09-30", opening_minor: 75000 };
const preview = {
  bank_account_id: BANK,
  statements: [
    {
      key: "september.pdf#0",
      from: "2026-09-01",
      to: "2026-09-30",
      opening_minor: 75000,
      closing_minor: 74500,
      lines: [{ txn_date: "2026-09-05", amount_minor: -500, reference: null }],
    },
  ],
};
const firstIssue = (result: { error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

describe("reconciliationStatementSchema", () => {
  it("takes a statement with its lines", () => {
    expect(reconciliationStatementSchema.safeParse(statement).success).toBe(true);
  });

  it("takes up to 5,000 lines, and refuses none or more", () => {
    expect(reconciliationStatementSchema.safeParse({ ...statement, lines: Array.from({ length: 5000 }, () => line) }).success).toBe(true);
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, lines: [] }))).toBe("The statement has no lines");
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, lines: Array.from({ length: 5001 }, () => line) }))).toBe(
      "A statement can hold at most 5,000 lines",
    );
  });

  it("refuses a day that does not exist, and a date that is not an ISO day", () => {
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, lines: [{ ...line, txn_date: "2026-02-31" }] }))).toBe(
      "A statement date must be a real day",
    );
    expect(firstIssue(reconciliationStatementSchema.safeParse({ ...statement, lines: [{ ...line, txn_date: "09/05/2026" }] }))).toBe(
      "A statement date is required",
    );
  });

  it("refuses an amount that is not whole cents", () => {
    expect(reconciliationStatementSchema.safeParse({ ...statement, lines: [{ ...line, amount_minor: 1.5 }] }).success).toBe(false);
  });
});

describe("runMonthSchema", () => {
  it("takes a month to sign, and the bring-forward step", () => {
    expect(runMonthSchema.safeParse(month).success).toBe(true);
    expect(runMonthSchema.safeParse({ ...month, sign: false }).success).toBe(true);
    expect(runMonthSchema.safeParse(bringForward).success).toBe(true);
  });

  it("refuses a month with no closing balance, no statement date or no lines", () => {
    expect(runMonthSchema.safeParse({ ...month, closing_minor: null }).success).toBe(false);
    expect(runMonthSchema.safeParse({ ...month, statement_date: "2026-02-31" }).success).toBe(false);
    expect(runMonthSchema.safeParse({ ...month, lines: [] }).success).toBe(false);
  });

  it("refuses bringing forward without the period's start or the opening balance", () => {
    expect(runMonthSchema.safeParse({ ...bringForward, period_from: null }).success).toBe(false);
    expect(runMonthSchema.safeParse({ ...bringForward, opening_minor: null }).success).toBe(false);
  });

  it("refuses a step of no known kind", () => {
    expect(runMonthSchema.safeParse({ ...month, kind: "everything" }).success).toBe(false);
  });
});

describe("runPreviewSchema", () => {
  it("takes the statements of a run", () => {
    expect(runPreviewSchema.safeParse(preview).success).toBe(true);
  });

  it("refuses an empty run, and one of more than 60 statements", () => {
    expect(firstIssue(runPreviewSchema.safeParse({ ...preview, statements: [] }))).toBe("Choose at least one statement");
    expect(firstIssue(runPreviewSchema.safeParse({ ...preview, statements: Array.from({ length: 61 }, () => preview.statements[0]) }))).toBe(
      "A run can hold at most 60 statements",
    );
  });

  it("refuses a statement with no closing balance", () => {
    expect(runPreviewSchema.safeParse({ ...preview, statements: [{ ...preview.statements[0], closing_minor: null }] }).success).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/reconciliation-statement-schemas.test.ts` — Expected: 11 passed.

- [ ] **Step 3: The server actions.** Replace the whole of `app/(app)/banking/reconcile/statement-actions.ts` with:

```ts
"use server";
/**
 * Reconciling against statement files: a run of statements previewed and
 * signed one month at a time, an account's first reconciliation brought
 * forward, and the statement a reconciliation keeps, paired with the books.
 * The session itself — ticking, completing, reopening — is in actions.ts.
 */
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import {
  reconciliationStatementSchema, runMonthSchema, runPreviewSchema, type ReconciliationStatementInput,
} from "@/lib/domain/schemas";
import { simulateRun, type RunPreview, type RunStatement } from "@/lib/domain/statement-run";
import {
  createReconciliationFromStatement, setReconciliationStatement, setStatementEnding, getBroughtForwardPreview,
  bringForward, getReconciliationHeader, getReconciliationStatement, pairAndTick, getBankOpenLines,
  listReconciliations, getReconciliationDetail, completeReconciliation,
  BankRecError, type ReconStatement, type StatementFileInput,
} from "@/lib/services/bankrec";
import { generateSuggestions, importStatement } from "@/lib/services/banking";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
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
  let kept = false;
  try {
    const sb = await createSupabaseServerClient();
    const file = statementFile(parsed.data);
    // Kept first: a completed reconciliation refuses it before anything is imported.
    await setReconciliationStatement(sb, reconciliationId, file);
    kept = true;
    const { bankAccountId } = await getReconciliationHeader(sb, reconciliationId);
    const imported = await importIntoBankTransactions(sb, bankAccountId, file);
    const outcome = await pairAndTick(sb, reconciliationId);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    revalidatePath("/banking");
    return { ok: true, data: { inserted: imported.inserted, duplicates: imported.skipped, outcome } };
  } catch (e) {
    if (!kept) return { ok: false, error: msg(e) };
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    return {
      ok: false,
      error: `The statement was kept with this reconciliation, but importing or pairing its lines failed: ${msg(e)}. Import the statement again.`,
    };
  }
}

/**
 * A run of statements walked against the books, writing nothing: each month
 * begins where the one before it closed, its lines pair with the book lines
 * still open, and the first month that does not agree line for line stops the
 * walk. On an account never reconciled, the first statement's opening balance
 * is set beside the books, as 1.79 brings an account forward.
 */
export async function previewRunAction(raw: unknown): Promise<ActionResult<RunPreview>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = runPreviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const bankAccountId = parsed.data.bank_account_id;
  const statements: RunStatement[] = parsed.data.statements
    .map((s) => ({
      key: s.key,
      fileName: s.key,
      source: "PDF" as const,
      from: s.from,
      to: s.to,
      openingMinor: s.opening_minor,
      closingMinor: s.closing_minor,
      lines: s.lines.map((l) => ({
        txn_date: l.txn_date, description: "", reference: l.reference, amount_minor: l.amount_minor,
        running_balance_minor: null, raw_line: "",
      })),
      problem: null,
      outByMinor: null,
    }))
    .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  try {
    const sb = await createSupabaseServerClient();
    const first = statements[0];
    const through = statements[statements.length - 1].to as string;
    const [openLines, reconciliations] = await Promise.all([
      getBankOpenLines(sb, bankAccountId, through),
      listReconciliations(sb, bankAccountId),
    ]);
    const last = reconciliations.find((r) => r.status === "completed") ?? null;
    const broughtForward =
      reconciliations.length === 0 && first.from && first.openingMinor !== null
        ? await getBroughtForwardPreview(sb, bankAccountId, dayBefore(first.from))
        : null;
    const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
    return {
      ok: true,
      data: simulateRun(
        statements,
        openLines,
        { beginningMinor: last ? Number(last.statement_ending_balance_minor) : null, broughtForward },
        money,
      ),
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export interface RunMonthResult {
  /** The reconciliation this step made. */
  id: string;
  /** Completed by this step. */
  signed: boolean;
  /** What is left between the statement and the books; zero when signed. */
  differenceMinor: number;
}

/**
 * One step of a run, on the server: bringing the account's earlier lines
 * forward (refused by the database unless the books still agree), or one month
 * started from its statement — imported into Bank Transactions, paired and
 * ticked, then completed when `sign` is set and it reaches zero. A month that
 * no longer reaches zero (the books changed since the preview) is left in
 * progress and says by how much.
 */
export async function reconcileRunMonthAction(raw: unknown): Promise<ActionResult<RunMonthResult>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = runMonthSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const input = parsed.data;
  let startedId: string | null = null;
  try {
    const sb = await createSupabaseServerClient();
    if (input.kind === "bring_forward") {
      const id = await bringForward(
        sb,
        input.bank_account_id,
        dayBefore(input.period_from),
        input.opening_minor,
        broughtForwardNote(input.period_from, input.statement_date),
      );
      revalidatePath("/banking/reconcile");
      return { ok: true, data: { id, signed: true, differenceMinor: 0 } };
    }
    const file = statementFile(input);
    const id = await createReconciliationFromStatement(sb, input.bank_account_id, input.statement_date, input.closing_minor, file);
    startedId = id;
    await importIntoBankTransactions(sb, input.bank_account_id, file);
    await pairAndTick(sb, id);
    const { differenceMinor } = await getReconciliationDetail(sb, id);
    const signed = input.sign && differenceMinor === 0;
    if (signed) await completeReconciliation(sb, id);
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return { ok: true, data: { id, signed, differenceMinor } };
  } catch (e) {
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    if (startedId && input.kind === "month") {
      return {
        ok: false,
        error: `The reconciliation to ${shortDate(input.statement_date, true)} was started with its statement but not signed off: ${msg(e)}. Open it to finish it.`,
      };
    }
    return { ok: false, error: msg(e) };
  }
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

- [ ] **Step 4: The page.** Create `app/(app)/banking/reconcile/from-files/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getUserRole, canWrite } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listBankAccounts } from "@/lib/services/banking";
import { listReconciliations } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import type { RunContext } from "@/lib/domain/statement-run";
import PageHeader from "@/components/PageHeader";
import FromFilesClient from "./FromFilesClient";

export const dynamic = "force-dynamic";

export default async function FromFilesPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  if (!account || !z.uuid().safeParse(account).success) notFound();
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [banks, currencies, reconciliations] = await Promise.all([
    listBankAccounts(sb),
    listCurrencies(sb),
    listReconciliations(sb, account),
  ]);
  const bank = banks.find((b) => b.id === account);
  if (!bank) notFound();
  const base = currencies.find((c) => c.is_base);
  // Newest first, as listReconciliations orders them.
  const completed = reconciliations.filter((r) => r.status === "completed");
  const inProgress = reconciliations.find((r) => r.status === "in_progress");
  const context: RunContext = {
    lastCompleted: completed[0]
      ? { date: completed[0].statement_ending_date, endingMinor: Number(completed[0].statement_ending_balance_minor) }
      : null,
    completedDates: completed.map((r) => r.statement_ending_date),
    inProgress: inProgress ? { id: inProgress.id, date: inProgress.statement_ending_date } : null,
  };
  return (
    <div>
      <PageHeader
        title="Reconcile from statement files"
        description="Choose the statement files and every month they cover is checked against the books in one pass, oldest first."
      />
      <p>
        <Link href="/banking/reconcile">← Bank Reconciliation</Link>
      </p>
      <FromFilesClient
        canWrite={canWrite(role)}
        bankAccount={{
          id: bank.id,
          label: `${bank.bank_name} · ${bank.account_number_masked ?? ""}`.trim(),
          maskedNumber: bank.account_number_masked,
          decimals: base?.decimal_places ?? 2,
          currencyCode: bank.currency_code,
        }}
        context={context}
      />
    </div>
  );
}
```

Create `app/(app)/banking/reconcile/from-files/FromFilesClient.tsx`:

```tsx
"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Space, Spin, Tag, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import { readRunFile } from "@/lib/client/run-files";
import { periodLabel, shortDate } from "@/lib/domain/pdf-statement-view";
import {
  checkRun,
  monthSentence,
  type CheckedStatement,
  type MonthOutcome,
  type RunContext,
  type RunMonth,
  type RunPreview,
  type RunStatement,
} from "@/lib/domain/statement-run";
import { formatMoney } from "@/lib/format";
import { previewRunAction, reconcileRunMonthAction } from "../statement-actions";
import StandingTag from "../StandingTag";

/**
 * Reconciling a run of statements: choose the files, check what was read,
 * preview every month against the books, then sign off the months that agree
 * in one click. Nothing is written before that click; the first month that
 * needs a look is then started as a reconciliation in progress.
 */
interface Props {
  canWrite: boolean;
  bankAccount: { id: string; label: string; maskedNumber: string | null; decimals: number; currencyCode: string };
  context: RunContext;
}

interface Done {
  signed: number;
  /** The month left in progress for a person, when there is one. */
  open: { id: string; date: string; sentence: string } | null;
  error: string | null;
}

const STATE_COLOR: Record<CheckedStatement["state"], string | undefined> = {
  usable: "green",
  unreadable: "red",
  already: "blue",
  before: undefined,
  duplicate: undefined,
};

function outcomeTag(outcome: MonthOutcome) {
  switch (outcome.kind) {
    case "agrees":
      return <Tag color="green">Agrees</Tag>;
    case "balanceOnly":
      return <Tag color="gold">Needs a look</Tag>;
    case "outBy":
      return <Tag color="red">Does not agree</Tag>;
    case "waiting":
      return <Tag>Waiting</Tag>;
  }
}

export default function FromFilesClient({ canWrite, bankAccount, context }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  const [statements, setStatements] = useState<RunStatement[]>([]);
  const [reading, setReading] = useState(0);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  // The statements the preview was walked on. Signing uses these and nothing
  // else, so a file added after the preview can never be signed unseen.
  const [previewed, setPreviewed] = useState<RunStatement[]>([]);
  const [previewing, setPreviewing] = useState(false);
  // A preview is asked for, then answered; a file added or a fresh start in
  // between makes the answer stale, and it is dropped.
  const asked = useRef(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const { currencyCode, decimals } = bankAccount;
  const money = (minor: number) => formatMoney(minor, currencyCode, decimals);
  const check = useMemo(
    () => checkRun(statements, context, (minor) => formatMoney(minor, currencyCode, decimals)),
    [statements, context, currencyCode, decimals],
  );
  const previewedByKey = useMemo(() => new Map(previewed.map((s) => [s.key, s])), [previewed]);
  const busy = progress !== null;

  if (!canWrite) {
    return <Alert type="info" showIcon title="Reconciling statements needs permission to write in this company." />;
  }

  async function add(file: File) {
    asked.current += 1;
    setReading((n) => n + 1);
    setPreview(null);
    setDone(null);
    try {
      const read = await readRunFile(file, bankAccount);
      setStatements((current) => {
        const keys = new Set(current.map((s) => s.key));
        return [...current, ...read.filter((s) => !keys.has(s.key))];
      });
    } finally {
      setReading((n) => n - 1);
    }
  }

  function startAgain() {
    asked.current += 1;
    setStatements([]);
    setPreview(null);
    setDone(null);
  }

  async function runPreview() {
    const token = ++asked.current;
    const run = check.usable;
    setPreviewing(true);
    setPreview(null);
    setDone(null);
    const res = await previewRunAction({
      bank_account_id: bankAccount.id,
      statements: run.map((s) => ({
        key: s.key,
        from: s.from,
        to: s.to,
        opening_minor: s.openingMinor,
        closing_minor: s.closingMinor,
        lines: s.lines.map((l) => ({ txn_date: l.txn_date, amount_minor: l.amount_minor, reference: l.reference })),
      })),
    });
    setPreviewing(false);
    if (token !== asked.current) return;
    if (!res.ok || !res.data) {
      message.error(res.error ?? "The statements could not be previewed");
      return;
    }
    setPreviewed(run);
    setPreview(res.data);
  }

  const needsLook = preview?.months[preview.toSign]?.outcome.kind !== "waiting" ? preview?.months[preview.toSign] ?? null : null;
  const bringForward = preview?.broughtForward?.canBringForward ? preview.broughtForward : null;
  const signLabel = preview?.toSign
    ? `Sign off ${preview.toSign} month${preview.toSign === 1 ? "" : "s"}`
    : needsLook
      ? bringForward
        ? "Bring the earlier lines forward and start the month that needs a look"
        : "Start the month that needs a look"
      : null;

  async function signOff() {
    if (!preview || previewing || check.stops.length > 0) return;
    // A preview still on its way was walked before these months were signed.
    asked.current += 1;
    const toSign = preview.months.slice(0, preview.toSign);
    const total = toSign.length + (bringForward ? 1 : 0);
    let step = 0;
    let signed = 0;
    const finish = (result: Done) => {
      setProgress(null);
      setDone(result);
      setPreview(null);
      router.refresh();
    };
    const first = previewed[0];
    if (bringForward && first?.from && first.openingMinor !== null) {
      step += 1;
      setProgress(`Bringing the earlier lines forward — ${step} of ${total}`);
      const res = await reconcileRunMonthAction({
        kind: "bring_forward",
        bank_account_id: bankAccount.id,
        period_from: first.from,
        statement_date: first.to,
        opening_minor: first.openingMinor,
      });
      if (!res.ok) return finish({ signed, open: null, error: res.error ?? "The earlier lines could not be brought forward" });
    }
    for (const month of toSign) {
      const statement = previewedByKey.get(month.key);
      if (!statement) break;
      step += 1;
      setProgress(`Signing ${shortDate(month.statementDate, true)} — ${step} of ${total}`);
      const res = await reconcileRunMonthAction({
        kind: "month",
        bank_account_id: bankAccount.id,
        file_name: statement.fileName,
        opening_minor: statement.openingMinor,
        closing_minor: statement.closingMinor,
        statement_date: month.statementDate,
        lines: statement.lines,
        sign: true,
      });
      if (!res.ok || !res.data) return finish({ signed, open: null, error: res.error ?? "A month could not be signed off" });
      if (!res.data.signed) {
        return finish({
          signed,
          open: {
            id: res.data.id,
            date: month.statementDate,
            sentence: `The books changed since the preview: this month is now out by ${money(Math.abs(res.data.differenceMinor))}.`,
          },
          error: null,
        });
      }
      signed += 1;
    }
    let open: Done["open"] = null;
    const statement = needsLook ? previewedByKey.get(needsLook.key) : undefined;
    if (needsLook && statement) {
      setProgress(`Starting ${shortDate(needsLook.statementDate, true)}, which needs a look`);
      const res = await reconcileRunMonthAction({
        kind: "month",
        bank_account_id: bankAccount.id,
        file_name: statement.fileName,
        opening_minor: statement.openingMinor,
        closing_minor: statement.closingMinor,
        statement_date: needsLook.statementDate,
        lines: statement.lines,
        sign: false,
      });
      if (!res.ok || !res.data) return finish({ signed, open: null, error: res.error ?? "The month that needs a look could not be started" });
      open = { id: res.data.id, date: needsLook.statementDate, sentence: monthSentence(needsLook.outcome, money) };
    }
    finish({ signed, open, error: null });
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Bank account <strong>{bankAccount.label}</strong>. Choose PDF statements, or a CSV export with a running balance
        column — one file or many. Every closing balance is read out of the file itself, never taken from the books. The
        files stay in your browser, and nothing is written until you sign off.
      </Typography.Paragraph>
      <Upload.Dragger
        multiple
        accept=".pdf,.csv,.txt,.ofx,.qfx,.qbo,.qif,application/pdf"
        beforeUpload={(file) => {
          void add(file);
          return false;
        }}
        showUploadList={false}
        disabled={busy || previewing}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Click or drag statement files here</p>
      </Upload.Dragger>

      {reading > 0 ? (
        <Space>
          <Spin size="small" />
          <Typography.Text type="secondary">
            Reading {reading} file{reading === 1 ? "" : "s"}…
          </Typography.Text>
        </Space>
      ) : null}

      {statements.length ? (
        <div>
          <Typography.Text strong>Statements</Typography.Text>
          <DataTable<CheckedStatement>
            rowKey={(c) => c.statement.key}
            size="small"
            pagination={false}
            dataSource={check.statements}
            columns={[
              { title: "File", render: (_, c) => c.statement.fileName },
              { title: "Period", render: (_, c) => (c.statement.to ? periodLabel(c.statement.from, c.statement.to) : "—") },
              {
                title: "Opening",
                align: "right",
                render: (_, c) => (c.statement.openingMinor === null ? "—" : money(c.statement.openingMinor)),
              },
              {
                title: "Closing",
                align: "right",
                render: (_, c) => (c.statement.closingMinor === null ? "—" : money(c.statement.closingMinor)),
              },
              { title: "Read", render: (_, c) => <Tag color={STATE_COLOR[c.state]}>{c.note}</Tag> },
            ]}
          />
          {check.stops.map((stop) => (
            <Alert key={stop} style={{ marginTop: 12 }} type="error" showIcon title={stop} />
          ))}
          <Space style={{ marginTop: 12 }} wrap>
            <Button
              type="primary"
              loading={previewing}
              disabled={check.stops.length > 0 || reading > 0 || busy}
              onClick={() => void runPreview()}
            >
              Preview {check.usable.length} statement{check.usable.length === 1 ? "" : "s"}
            </Button>
            <Button onClick={startAgain} disabled={busy || previewing}>
              Start again
            </Button>
          </Space>
        </div>
      ) : null}

      {preview ? (
        <div>
          <Typography.Text strong>Preview — nothing is written yet</Typography.Text>
          {preview.broughtForward ? (
            <Alert
              style={{ margin: "8px 0" }}
              type={preview.broughtForward.canBringForward ? "info" : "warning"}
              showIcon
              title={preview.broughtForward.canBringForward ? "The first reconciliation of this account" : "The earlier lines stay open"}
              description={preview.broughtForward.text}
            />
          ) : null}
          <DataTable<RunMonth>
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={preview.months}
            expandable={{
              rowExpandable: (m) => m.standings.length > 0,
              expandedRowRender: (m) => {
                const statement = previewedByKey.get(m.key);
                return (
                  <DataTable
                    rowKey={(_, i) => String(i)}
                    size="small"
                    pagination={false}
                    dataSource={(statement?.lines ?? []).map((line, i) => ({ line, standing: m.standings[i] }))}
                    columns={[
                      { title: "Date", render: (_, r) => r.line.txn_date, width: 110 },
                      { title: "Description", render: (_, r) => r.line.description },
                      { title: "Amount", align: "right", render: (_, r) => money(r.line.amount_minor), width: 130 },
                      { title: "With the books", render: (_, r) => (r.standing ? <StandingTag standing={r.standing} /> : null), width: 280 },
                    ]}
                  />
                );
              },
            }}
            columns={[
              { title: "Statement", render: (_, m) => shortDate(m.statementDate, true), width: 130 },
              { title: "File", render: (_, m) => previewedByKey.get(m.key)?.fileName ?? "" },
              { title: "Beginning", align: "right", render: (_, m) => money(m.beginningMinor) },
              { title: "Closing", align: "right", render: (_, m) => money(m.closingMinor) },
              { title: "Outcome", render: (_, m) => outcomeTag(m.outcome) },
              { title: "What happened", render: (_, m) => monthSentence(m.outcome, money) },
            ]}
          />
          <Space style={{ marginTop: 12 }} wrap>
            {signLabel ? (
              <Button type="primary" loading={busy} disabled={previewing} onClick={() => void signOff()}>
                {signLabel}
              </Button>
            ) : null}
            {progress ? (
              <Typography.Text role="status" aria-live="polite">
                {progress}
              </Typography.Text>
            ) : null}
          </Space>
        </div>
      ) : null}

      {done ? (
        <Alert
          type={done.error ? "error" : done.open ? "warning" : "success"}
          showIcon
          title={
            done.error ??
            (done.signed
              ? `${done.signed} month${done.signed === 1 ? "" : "s"} signed off.`
              : `The reconciliation to ${shortDate((done.open as NonNullable<Done["open"]>).date, true)} needs a look.`)
          }
          description={
            done.open ? (
              <span>
                {done.open.sentence} The reconciliation to {shortDate(done.open.date, true)} is started, with its pairs ticked.{" "}
                <Link href={`/banking/reconcile/${done.open.id}`}>Open it</Link>
              </span>
            ) : done.error && done.signed ? (
              `${done.signed} month${done.signed === 1 ? "" : "s"} signed off before this.`
            ) : null
          }
        />
      ) : null}
    </Space>
  );
}
```

- [ ] **Step 5: The list opens it.** Replace the whole of `app/(app)/banking/reconcile/ReconcileListClient.tsx` with:

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { createReconciliationAction, listReconciliationsAction } from "./actions";
import type { StatementReconciliationRow } from "@/lib/db/types";

interface Bank {
  id: string;
  label: string;
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
          <Button onClick={() => router.push(`/banking/reconcile/from-files?account=${bankId}`)} disabled={!bankId}>
            From statement files
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
        banks={banks.map((b) => ({ id: b.id, label: `${b.bank_name} · ${b.account_number_masked ?? ""}`.trim() }))}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

Delete 1.79's dialog:

```bash
git rm "app/(app)/banking/reconcile/StartFromStatementModal.tsx"
```

Check nothing else used what was removed: `git grep -n "StartFromStatementModal\|startReconciliationFromStatementAction\|broughtForwardPreviewAction\|reconciliationFromStatementSchema\|StartFromStatementSummary" -- . ':!*.md'` — Expected: prints nothing.

- [ ] **Step 6: Typecheck, lint, tests.**

Run: `npm run typecheck` — Expected: no errors.
Run: `npx eslint "app/(app)/banking" lib/domain/schemas.ts tests/unit/reconciliation-statement-schemas.test.ts` — Expected: prints nothing.
Run: `npx vitest run tests/unit/reconciliation-statement-schemas.test.ts tests/unit/statement-run.test.ts tests/unit/reconcile-statement-service.test.ts` — Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add lib/domain/schemas.ts tests/unit/reconciliation-statement-schemas.test.ts "app/(app)/banking/reconcile/statement-actions.ts" "app/(app)/banking/reconcile/from-files/page.tsx" "app/(app)/banking/reconcile/from-files/FromFilesClient.tsx" "app/(app)/banking/reconcile/ReconcileListClient.tsx" "app/(app)/banking/reconcile/page.tsx"
printf 'feat(reconcile): reconcile from statement files, one month or a year\n\nChoose the files; the run is checked and previewed against the books without\nwriting anything; one click signs the months that agree, each checked again\non the server; the first month that needs a look is started for a person.\nThe 1.79 dialog gives way to this page.\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: Changelog 1.81, the guide, the whole suite

Main shipped its own 1.80 while this branch was built (PR #29, the shell loads the Supabase client on demand), so this release is 1.81. Merge `origin/main` into the branch first; the two touch no file in common.

**Files:**
- Modify: `lib/domain/changelog.ts` (a new first entry of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (the "Start a reconciliation from the statement's PDF" step)

- [ ] **Step 1: The release.** In `lib/domain/changelog.ts`, directly after `export const RELEASES: Release[] = [` (above main's 1.80), insert:

```ts
  {
    version: "1.81",
    date: "2026-10-05",
    headline: "A year of bank statements is reconciled in one pass, and a person signs it off.",
    changes: [
      {
        kind: "added",
        title: "Reconcile from statement files",
        detail:
          "On Bank Reconciliation, From statement files takes one statement or a year of them: PDF statements, or a CSV export with a running balance column, which is cut into calendar months. Each closing balance is read from the file. A month missing from the run, a month already signed off, and a file that prints no closing balance are each said before anything happens.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "Preview, then sign off the months that agree",
        detail:
          "Preview walks the months oldest first against the books and writes nothing: each month Agrees, Needs a look (it agrees only on its balance, with lines that did not pair), or Does not agree, and every statement line shows how it paired. Sign off signs the months that agree in one click, each checked again as it is signed. The first month that does not agree is started as a reconciliation in progress, with its pairs ticked, for you to finish.",
        route: "/banking/reconcile",
      },
      {
        kind: "changed",
        title: "From a PDF statement is now From statement files",
        detail:
          "The button opens a page that takes one file or many, in place of the dialog that took one PDF. A single statement works as before: the account's first reconciliation can still be brought forward, and a month that does not agree opens for you to finish.",
        route: "/banking/reconcile",
      },
    ],
  },
```

- [ ] **Step 2: The guide.** In `lib/domain/system-guide.ts` replace

```ts
      {
        action: "Start a reconciliation from the statement's PDF",
        control: "From a PDF statement",
        route: "/banking/reconcile",
        note:
          "The statement's last day and closing balance start it. Its lines are imported, kept with the " +
          "reconciliation and paired with the books — by date and amount, by check number, or by amount within " +
          "5 days — and the pairs are ticked. On an account never reconciled, when the books agree with the " +
          "statement's opening balance, Bring forward and start signs off the earlier lines first.",
      },
```

with

```ts
      {
        action: "Reconcile from the statement files, one month or a year",
        control: "From statement files",
        route: "/banking/reconcile",
        note:
          "Choose PDF statements, or a CSV export with a running balance column, which is cut into months. " +
          "Each closing balance comes from the file; a month missing from the run stops it. Preview pairs every " +
          "month with the books — by date and amount, by check number, or by amount within 5 days — and writes " +
          "nothing. Sign off signs the months that agree, oldest first; the first that does not is started, with " +
          "its pairs ticked, for you to finish. On an account never reconciled, the earlier lines are brought " +
          "forward first when the books agree with the first statement's opening balance.",
      },
```

- [ ] **Step 3: The whole suite and the build.**

Run: `npm run typecheck`, `npm run lint`, then `npm test`
Expected: no type errors; lint 0 errors (the 14 old warnings stay); every test file passes — the changelog and guide tests included (`APP_VERSION` is now 1.81). `tests/unit/quality-query-timing.test.ts` can fail when the machine is busy; if it alone fails, run it on its own and report both results.
Run: `npm run build` — Expected: `Compiled successfully`, the route list includes `/banking/reconcile/from-files`, exit code 0.
Run: `npm run quality:bundle`, then `npm run quality:budget` — Expected: every ceiling in `tests/quality/budgets.json` holds, exit code 0.

- [ ] **Step 4: Commit.**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
printf 'docs(changelog): 1.81 reconcile a run of statements; the guide step\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Live (controller)

No new code. Every step that writes to the live database waits for the user.

- [ ] **Step 1:** Ask the user to approve applying 0133 (read only) to every company. Only then run `node --env-file=.env.local scripts/migrate.mjs`, run `scripts/verify-bank-open-lines.mjs` again (rolled back) and `npm run verify:company-provisioning`.
- [ ] **Step 2:** On the sample company PC-Test only: a new bank account never reconciled, with posted entries over four months before and in the run, and invented statements printed into the scratchpad, never the repository — three monthly PDFs and one CSV of a later quarter with a running balance; one month carries a bank fee the books do not have.
- [ ] **Step 3:** In a real browser: From statement files → choose the files → the statements table (a gap shown and refused when one file is left out; restored); Preview → brought forward, months Agree, the fee month Does not agree, the rest Waiting; a month's lines expanded; **Sign off N months** → progress → the fee month started and **Open it**; the fee coded; Match again; Complete; the run again from the remaining files → signed.
- [ ] **Step 4:** Screenshots of each, light and dark, cropped; an approval page beside them. Nothing is pushed until the user approves.
- [ ] **Step 5:** Ask the user whether what the check recorded on PC-Test stays as the sample company's history or is undone.
