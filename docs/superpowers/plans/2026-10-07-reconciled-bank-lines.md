# Bank lines reconciled from a statement are matched; a tidier recoded line; four small fixes (1.85) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a reconciliation is completed — by Complete, or by From statement files signing a month — every bank line its statement paired with a ticked book line is matched in Bank Transactions, and the months signed before 1.85 are matched once the same way; a recoded line's Category cell offers only Undo recode; four faults left by 1.83 are fixed.

**Architecture:** Migration 0136 adds `acc_match_reconciled_bank_lines(p_reconciliation_id, p_pairs)`: for a completed reconciliation it matches each `{bank_transaction_id, journal_line_id}` pair in one transaction, rejecting the bank line's other suggestions, and leaves alone (and counts) a bank line already matched, ignored, matched to another entry, or of the opposite sign. The pairs are worked out in TypeScript: the reconciliation's standings (as the workspace shows them) give each statement line paired with a ticked book line, and a new domain module finds the bank line each statement line was imported as — the rule Add all already used, moved out of `add-missing.ts`. The server actions call it right after completing, and a failure is said beside the completion, never undoing it. A once-off vitest file under `tests/live` matches the months already signed.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Ant Design 6, Zod 4, Supabase Postgres (one schema per company), Vitest.

Spec: `docs/superpowers/specs/2026-10-07-reconciled-bank-lines-design.md`.

## Global Constraints

- US English UI. Version **1.85** (1.84 is on main); migration **0136**.
- Bank lines are matched **when a reconciliation is completed** — Complete in the workspace, and each month From statement files signs. Ticking or unticking before that changes nothing in Bank Transactions.
- **The reconciliation wins over a suggestion; an approved match is never changed.** A bank line already matched (to that book line: counted `already`; to another entry: `elsewhere`), ignored (`ignored`), whose book line is matched to another bank line (`elsewhere`), or whose amount has the opposite sign to the book line (`differs`) is left as it is. Matching again matches only what is still unmatched.
- A statement line and a bank line of the reconciliation's account are the same line when date, amount, description (first 500 characters) and reference (trimmed, first 80 characters) agree; identical lines pair in import order (`txn_date`, `id`), a bank line already matched to one of the group's book lines keeping it. A statement line with no bank line gives no pair, silently.
- `acc_match_reconciled_bank_lines` refuses unless `acc_is_staff()`, the reconciliation exists and is completed, `p_pairs` is a list of at most 5,000 pairs each with both ids and none listed twice; it refuses a book line not ticked in this reconciliation, a bank line of another bank account, and a book line whose entry is not posted. It returns `{matched, already, elsewhere, ignored, differs}`. Revoked from public and anon; granted to authenticated and service_role. One audit line per match (`acc_reconciliation`, action `match_from_reconciliation`).
- A matching failure never undoes the completion. Messages, exactly:
  - "Reconciliation completed. 12 bank lines matched in Bank Transactions." (no second sentence when nothing was matched now, no first when nothing was matched now and nothing was left);
  - left lines: "2 are matched to another entry — check them in Bank Transactions."; several kinds: "1 is matched to another entry, 2 are ignored and 1 has the opposite sign to the books — check them in Bank Transactions."; when nothing was matched now: "Of the bank lines, 1 is ignored — check it in Bank Transactions.";
  - failure: "Reconciliation completed. Its bank lines could not be matched in Bank Transactions (<reason>); approve them there." — in a run of months: "The bank lines to Jul 31, 2026 could not be matched in Bank Transactions (<reason>); approve them there."
- The months signed before 1.85 are matched **once**, by `tests/live/match-signed-months.live.ts`, dry run first, real run only after the user approves. Only PC-Test has such months today.
- A recoded line's Category cell shows, on four lines: the account (`6000 — Operating Expenses`), `Recoded from Uncategorized`, `JE-000076 → JE-000077` (the line's own entry, then the recode entry), and `Undo recode · Create rule`. Change is never offered on a recoded line. A line in Uncategorized and not recoded is unchanged.
- A kept file that cannot be tied to its import or reconciliation is said: "The statement file was kept but could not be tied to this import: <reason>. It is in Reports › Saved." / "The statement file was kept but could not be tied to this reconciliation: <reason>. Attach it on the reconciliation."
- Attach's count message: "This reconciliation kept N lines from <first day> to <statement date>; this file has M lines in those days." Attach the statement is disabled until the reconciliation's figures have loaded. The Import and Attach dialogs always leave their busy state and say why when the server cannot be reached.
- No real statement, bank name, account number or figure in the repository: fixtures are invented.
- Migration 0136 is **not applied to the live database by any task**. The verify script and the once-off dry run apply it inside a transaction that is always rolled back. It goes live only after the user approves, in Task 8, by the controller — and before this code is deployed. Nothing is written to live data except by the controller, after approval, on the sample company PC-Test.
- Documents & Attachments stays paused and untouched.
- Run everything from `ctyhp-accounting/`. Never pipe test output through `head`/`tail`; read the pass/fail lines.
- Write every file with the Write or Edit tool — never a bash heredoc, `echo` or `python -c`, which eat backslashes and quotes. Write paths exactly as given — never with backslash escapes such as `\(` or `\]` (on Windows they create stray directories such as `app/(app`).
- A `"use server"` file exports only async functions and types.
- Banking components stay under the 400-line ceiling (`tests/unit/bank-categories-ui-contract.test.ts`).
- Stage files by name; never `git add -A`. Write commit messages with `printf` in Git Bash to `../.superpowers/sdd/commit-msg.txt` (never PowerShell — it writes a BOM), check with `od -c ../.superpowers/sdd/commit-msg.txt | head -1` that the first bytes are not `357 273 277`, then `git commit -F ../.superpowers/sdd/commit-msg.txt`. No Co-Authored-By trailer. After each task, `git status --short --untracked-files=all` (from the repository root) shows no file the task did not name, and `ls -b app` shows no stray directory.

Every file below was run before this plan was written: the migration through its verify script on all six companies (151 passed, 0 failed, rolled back); the once-off file as a dry run on the live database (rolled back: PC-Test's 19 signed months → 45 matched, 2 already; nothing elsewhere); the unit tests; `tsc --noEmit`, `eslint`, the whole unit suite (288 files), `next build` and the bundle budget (11 within budget) with every task's files in place.

Where a step says "apply these edits", each edit is a find/replace: find the exact text (it occurs once), replace it with the text given. The edits were worked out from the checked files and proved by applying them to the file as it is on the branch.

---

### Task 1: Migration 0136 and its verification

**Files:**
- Create: `supabase/migrations/0136_match_reconciled_bank_lines.sql`
- Create: `scripts/verify-reconciled-bank-lines.mjs`
- Create: `tests/unit/match-reconciled-bank-lines-migration.test.ts`

**Interfaces:**
- Produces (SQL, every company schema): `acc_match_reconciled_bank_lines(p_reconciliation_id uuid, p_pairs jsonb) returns jsonb` — `p_pairs` is `[{bank_transaction_id, journal_line_id}]`; the answer is `{matched, already, elsewhere, ignored, differs}` (integers).

- [ ] **Step 1: The verify script and the static test first.** Create `scripts/verify-reconciled-bank-lines.mjs`:

```js
/**
 * Behavioural verification of migration 0136 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0136 has not been applied it is applied first, inside that transaction,
 * and every account, entry, bank line, match and reconciliation the checks need
 * is made there too — so nothing is left behind. A refusal is tried inside a
 * savepoint, so the books it is tried on stay as they were.
 *
 * Run: node --env-file=.env.local scripts/verify-reconciled-bank-lines.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0136_match_reconciled_bank_lines.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

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
/** Runs `body` as the database owner, then goes back to being `userId`. */
async function asOwner(userId, body) {
  await client.query("reset role");
  try {
    await body();
  } finally {
    await client.query("set local role authenticated");
    await as(userId);
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
        console.log("  (0136 applied inside the transaction, never committed)");
      }
      for (const statement of statements) await client.query(statement);
      check("applying 0136 a second time is harmless", true);

      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- the books: a bank account with eight entries on it, and another bank account
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-RB-B", "Verify reconciled bank lines bank", "bank");
      const gl2 = await account("ZZ-VERIFY-RB-B2", "Verify reconciled bank lines other bank", "bank");
      const sales = await account("ZZ-VERIFY-RB-I", "Verify reconciled bank lines sales", "income");
      const bankAccount = async (ledger) =>
        (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [
          ledger, base.code,
        ])).id;
      const bank = await bankAccount(gl);
      const otherBank = await bankAccount(gl2);

      await client.query("set local role authenticated");
      await as(admin.id);
      /** Posts `minor` to the bank (positive in, negative out) on `day`; returns the bank's journal line. */
      const post = async (day, memo, minor) => {
        const entry = (await one(`select acc_post_manual_journal($1, $2, null, $3, $4::jsonb) as id`, [
          day, memo, base.code,
          JSON.stringify(minor > 0
            ? [{ account_id: gl, debit_minor: minor, credit_minor: 0 }, { account_id: sales, debit_minor: 0, credit_minor: minor }]
            : [{ account_id: gl, debit_minor: 0, credit_minor: -minor }, { account_id: sales, debit_minor: -minor, credit_minor: 0 }]),
        ])).id;
        return { entry, line: (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [entry, gl])).id };
      };
      const deposit = await post("2026-07-05", "Client deposit", 50000);
      const shop = await post("2026-07-10", "Card purchase", -4200);
      const wire = await post("2026-07-12", "Wire in", 3000);
      const wireTwin = await post("2026-07-12", "Wire in, the same again", 3000);
      const transfer = await post("2026-07-14", "Transfer in", 1500);
      const charge = await post("2026-07-16", "Charge refunded", 700);
      const reversed = await post("2026-07-18", "Refund", 900);
      const later = await post("2026-07-20", "Voided after the month was signed", 100);

      const LINES = [
        { txn_date: "2026-07-05", description: "DEPOSIT EXAMPLE", reference: null, amount_minor: 50000 },
        { txn_date: "2026-07-10", description: "POS EXAMPLE SHOP", reference: null, amount_minor: -4200 },
        { txn_date: "2026-07-12", description: "INCOMING WIRE EXAMPLE", reference: null, amount_minor: 3000 },
        { txn_date: "2026-07-14", description: "TRANSFER EXAMPLE", reference: null, amount_minor: 1500 },
        { txn_date: "2026-07-14", description: "TRANSFER OTHER EXAMPLE", reference: null, amount_minor: 1500 },
        { txn_date: "2026-07-16", description: "CHARGE EXAMPLE", reference: null, amount_minor: 700 },
        { txn_date: "2026-07-18", description: "REFUND EXAMPLE", reference: null, amount_minor: -900 },
        { txn_date: "2026-07-20", description: "LATER EXAMPLE", reference: null, amount_minor: 100 },
      ];
      const importLines = (bankId, lines) =>
        one(`select * from acc_import_bank_statement($1, 'verify.csv', $2::jsonb)`, [
          bankId,
          JSON.stringify(lines.map((l, i) => ({
            ...l,
            raw_line: l.description,
            raw_hash: createHash("sha256").update(`verify-rb-${bankId}-${i}`).digest("hex"),
            source: "file_upload",
          }))),
        ]);
      await importLines(bank, LINES);
      await importLines(otherBank, [LINES[0]]);
      const txnOf = async (bankId, description) =>
        (await one(`select id from acc_bank_transaction where bank_account_id = $1 and description = $2`, [bankId, description])).id;
      const t = {
        deposit: await txnOf(bank, "DEPOSIT EXAMPLE"),
        shop: await txnOf(bank, "POS EXAMPLE SHOP"),
        wire: await txnOf(bank, "INCOMING WIRE EXAMPLE"),
        transfer: await txnOf(bank, "TRANSFER EXAMPLE"),
        transferOther: await txnOf(bank, "TRANSFER OTHER EXAMPLE"),
        charge: await txnOf(bank, "CHARGE EXAMPLE"),
        reversed: await txnOf(bank, "REFUND EXAMPLE"),
        later: await txnOf(bank, "LATER EXAMPLE"),
        elsewhere: await txnOf(otherBank, "DEPOSIT EXAMPLE"),
      };

      // ---- Bank Transactions as a person left it: suggestions, decisions, an ignored line
      await asOwner(admin.id, async () => {
        const match = (txn, line, status, confidence) =>
          client.query(`insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence) values ($1, $2, $3, $4)`, [
            txn, line, status, confidence,
          ]);
        await match(t.deposit, deposit.line, "suggested", 0.9);
        await match(t.deposit, reversed.line, "suggested", 0.4);
        await match(t.shop, shop.line, "approved", 1);
        await match(t.wire, wireTwin.line, "approved", 1);
        await match(t.transferOther, transfer.line, "approved", 1);
        await client.query(`update acc_bank_transaction set status = 'matched' where id = any($1::uuid[])`, [[t.shop, t.wire, t.transferOther]]);
        await client.query(`update acc_bank_transaction set status = 'ignored' where id = $1`, [t.charge]);
      });

      // ---- a July reconciliation that ticks seven of the eight book lines
      const ticked = [deposit, shop, wire, transfer, charge, reversed, later];
      const ending = 50000 - 4200 + 3000 + 1500 + 700 + 900 + 100;
      const rec = (await one(
        `select acc_create_reconciliation_from_statement($1, '2026-07-31', $2, 'verify.csv', 0, $3::jsonb, null) as id`,
        [bank, ending, JSON.stringify(LINES.map((l) => ({ ...l, balance_minor: null })))],
      )).id;
      await one(`select acc_set_cleared_many($1, $2::uuid[], true) as n`, [rec, ticked.map((x) => x.line)]);

      const MATCH = `select acc_match_reconciled_bank_lines($1, $2::jsonb) as out`;
      const pair = (txn, line) => ({ bank_transaction_id: txn, journal_line_id: line });
      const PAIRS = [
        pair(t.deposit, deposit.line),
        pair(t.shop, shop.line),
        pair(t.wire, wire.line),
        pair(t.transfer, transfer.line),
        pair(t.charge, charge.line),
        pair(t.reversed, reversed.line),
      ];
      await refused("a reconciliation in progress is refused", MATCH, [rec, JSON.stringify(PAIRS)], "only once the reconciliation is completed");
      await one(`select acc_complete_reconciliation($1)`, [rec]);
      check("the reconciliation completes", (await one(`select status::text from acc_statement_reconciliation where id = $1`, [rec])).status === "completed");
      await asOwner(admin.id, () => client.query(`update acc_journal_entry set status = 'void', voided_at = now() where id = $1`, [later.entry]));

      // ---- what matching refuses: every refusal matches nothing
      await refused("an unknown reconciliation is refused", MATCH, [OUTSIDER, "[]"], "Reconciliation not found");
      await refused("a list that is not a list is refused", MATCH, [rec, "{}"], "must be a list");
      await refused("a pair missing a side is refused", MATCH, [rec, JSON.stringify([{ bank_transaction_id: t.deposit }])], "needs its bank_transaction_id and journal_line_id");
      await refused("a bank line listed twice is refused", MATCH,
        [rec, JSON.stringify([pair(t.deposit, deposit.line), pair(t.deposit, shop.line)])], "listed twice");
      await refused("a book line listed twice is refused", MATCH,
        [rec, JSON.stringify([pair(t.deposit, deposit.line), pair(t.shop, deposit.line)])], "listed twice");
      await refused("more than 5,000 pairs are refused", MATCH,
        [rec, JSON.stringify(Array.from({ length: 5001 }, (_, i) => pair(`${OUTSIDER.slice(0, -4)}${String(i).padStart(4, "0")}`, deposit.line)))],
        "At most 5,000");
      await refused("a book line not ticked in this reconciliation is refused", MATCH,
        [rec, JSON.stringify([pair(t.wire, wireTwin.line)])], "is not ticked in this reconciliation");
      await refused("another bank account's line is refused", MATCH,
        [rec, JSON.stringify([pair(t.elsewhere, deposit.line)])], "is not among this bank account's transactions");
      await refused("a book line whose entry was voided is refused", MATCH,
        [rec, JSON.stringify([pair(t.later, later.line)])], "is not part of a posted entry");
      if (viewer) {
        await as(viewer.id);
        await refused("a viewer cannot match", MATCH, [rec, JSON.stringify(PAIRS)], "Not authorized");
      }
      await as(OUTSIDER);
      await refused("someone outside the company cannot match", MATCH, [rec, JSON.stringify(PAIRS)], "Not authorized");
      await as(admin.id);

      // ---- matching
      const none = (await one(MATCH, [rec, "[]"])).out;
      check("nothing to match matches nothing",
        ["matched", "already", "elsewhere", "ignored", "differs"].every((k) => none[k] === 0) && Object.keys(none).length === 5,
        JSON.stringify(none));
      const first = (await one(MATCH, [rec, JSON.stringify(PAIRS)])).out;
      check("one matched, one already, two elsewhere, one ignored, one the other way around",
        first.matched === 1 && first.already === 1 && first.elsewhere === 2 && first.ignored === 1 && first.differs === 1,
        JSON.stringify(first));
      const matchesOf = (txn) =>
        all(`select journal_line_id, status::text, confidence::float as confidence, approved_by, rule_applied from acc_reconciliation
              where bank_transaction_id = $1 order by status`, [txn]);
      const depositMatches = await matchesOf(t.deposit);
      const approved = depositMatches.find((m) => m.status === "approved");
      check("the deposit is matched to its book line, by the person, with full confidence",
        approved?.journal_line_id === deposit.line && approved.approved_by === admin.id && approved.confidence === 1 &&
          approved.rule_applied === "statement_reconciliation",
        JSON.stringify(depositMatches));
      check("…its other suggestion is rejected",
        depositMatches.some((m) => m.journal_line_id === reversed.line && m.status === "rejected"), JSON.stringify(depositMatches));
      check("…and the bank line is matched", (await one(`select status::text from acc_bank_transaction where id = $1`, [t.deposit])).status === "matched");
      check("one audit line is written for the match", (await one(
        `select count(*)::int as n from acc_audit_log
          where table_name = 'acc_reconciliation' and action = 'match_from_reconciliation'
            and after_json->>'bank_transaction_id' = $1 and after_json->>'statement_reconciliation_id' = $2`,
        [t.deposit, rec],
      )).n === 1);
      const statuses = await all(`select id, status::text from acc_bank_transaction where id = any($1::uuid[])`,
        [[t.shop, t.wire, t.transfer, t.transferOther, t.charge, t.reversed]]);
      const statusOf = (id) => statuses.find((s) => s.id === id)?.status;
      check("the lines left as they were keep their status",
        statusOf(t.shop) === "matched" && statusOf(t.wire) === "matched" && statusOf(t.transfer) === "unmatched" &&
          statusOf(t.transferOther) === "matched" && statusOf(t.charge) === "ignored" && statusOf(t.reversed) === "unmatched",
        JSON.stringify(statuses));
      check("a match approved against another book line is not changed",
        JSON.stringify((await matchesOf(t.wire)).map((m) => [m.journal_line_id, m.status])) === JSON.stringify([[wireTwin.line, "approved"]]));
      check("a book line matched to another bank line stays with it",
        JSON.stringify((await matchesOf(t.transferOther)).map((m) => [m.journal_line_id, m.status])) === JSON.stringify([[transfer.line, "approved"]]) &&
          (await matchesOf(t.transfer)).length === 0);
      check("nothing is written for a line the other way around", (await matchesOf(t.reversed)).length === 0);

      const again = (await one(MATCH, [rec, JSON.stringify(PAIRS)])).out;
      check("matching again matches nothing new", again.matched === 0 && again.already === 2 && again.elsewhere === 2,
        JSON.stringify(again));

      // ---- who may call it
      await client.query("reset role");
      const grants = await one(
        `select has_function_privilege('anon', 'acc_match_reconciled_bank_lines(uuid, jsonb)', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_match_reconciled_bank_lines(uuid, jsonb)', 'execute') as signed_in`,
      );
      check("closed to anon, open to signed-in users", grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
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

Create `tests/unit/match-reconciled-bank-lines-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0136_match_reconciled_bank_lines.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8");
/** The migration without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0136_match_reconciled_bank_lines", () => {
  it("never posts: matching a bank line moves no balance", () => {
    expect(code).not.toMatch(/acc_post_entry/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)/i);
  });

  it("asks who may complete a reconciliation, and matches only a completed one", () => {
    expect(code).toMatch(/if not acc_is_staff\(\) then/);
    expect(code).toMatch(/v_rec\.status <> 'completed'/);
  });

  it("never changes an approved match: it only rejects suggestions", () => {
    expect(code).toMatch(/set status = 'rejected'[\s\S]{0,200}and status = 'suggested'/);
    expect(code).not.toMatch(/delete\s+from\s+acc_reconciliation\b/i);
  });

  it("is closed to anon and open to signed-in users", () => {
    expect(code).toMatch(/revoke all on function acc_match_reconciled_bank_lines\(uuid, jsonb\) from public, anon;/);
    expect(code).toMatch(/grant execute on function acc_match_reconciled_bank_lines\(uuid, jsonb\) to authenticated, service_role;/);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql }], "co_example");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toMatch(/set search_path = co_example/);
  });
});
```

- [ ] **Step 2: Run them — they fail.**

Run: `node --env-file=.env.local scripts/verify-reconciled-bank-lines.mjs`
Expected: it stops with `ENOENT` (the migration file does not exist yet).
Run: `npx vitest run tests/unit/match-reconciled-bank-lines-migration.test.ts`
Expected: FAIL — `ENOENT` for `0136_match_reconciled_bank_lines.sql`.

- [ ] **Step 3: The migration.** Create `supabase/migrations/0136_match_reconciled_bank_lines.sql`:

```sql
-- ============================================================================
-- 1.85 — a bank line reconciled from a statement is matched in Bank
-- Transactions.
--
-- Importing a statement into a reconciliation puts its lines in Bank
-- Transactions as "For review", suggests a book line for each, and ticks the
-- book line each statement line pairs with. Nothing approved the bank match, so
-- after the month was signed off its bank lines still waited for review.
--
-- Now, once a reconciliation is completed, the app works out which bank line
-- each paired statement line was imported as and hands the pairs here. A pair
-- the person signed off outranks a suggestion guessed from amount and date, so
-- the bank line's other suggestions are rejected. A match already approved is
-- never changed: a bank line matched or ignored, or a book line matched to
-- another bank line, is left as it is and counted, so the screen can say so.
-- Running it again matches only what is still unmatched.
-- ============================================================================

create or replace function acc_match_reconciled_bank_lines(p_reconciliation_id uuid, p_pairs jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rec       acc_statement_reconciliation;
  v_pair      jsonb;
  v_txn       acc_bank_transaction;
  v_line_id   uuid;
  v_signed    bigint;
  v_match_id  uuid;
  v_count     int;
  v_matched   int := 0;
  v_already   int := 0;
  v_elsewhere int := 0;
  v_ignored   int := 0;
  v_differs   int := 0;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to match bank lines';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'The pairs to match must be a list';
  end if;
  v_count := jsonb_array_length(p_pairs);
  if v_count > 5000 then
    raise exception 'At most 5,000 bank lines can be matched at a time';
  end if;

  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for share;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'completed' then
    raise exception 'Bank lines are matched only once the reconciliation is completed';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_pairs) x
     where x->>'bank_transaction_id' is null or x->>'journal_line_id' is null
  ) then
    raise exception 'Each pair needs its bank_transaction_id and journal_line_id';
  end if;
  if (select count(distinct x->>'bank_transaction_id') from jsonb_array_elements(p_pairs) x) <> v_count
     or (select count(distinct x->>'journal_line_id') from jsonb_array_elements(p_pairs) x) <> v_count then
    raise exception 'A bank line or a book line is listed twice';
  end if;

  for v_pair in select * from jsonb_array_elements(p_pairs) loop
    v_line_id := (v_pair->>'journal_line_id')::uuid;
    if not exists (
      select 1 from acc_reconciliation_line
       where reconciliation_id = p_reconciliation_id and journal_line_id = v_line_id
    ) then
      raise exception 'Book line % is not ticked in this reconciliation', v_line_id;
    end if;

    select * into v_txn from acc_bank_transaction where id = (v_pair->>'bank_transaction_id')::uuid for update;
    if not found or v_txn.bank_account_id <> v_rec.bank_account_id then
      raise exception 'Bank line % is not among this bank account''s transactions', v_pair->>'bank_transaction_id';
    end if;

    if exists (
      select 1 from acc_reconciliation
       where bank_transaction_id = v_txn.id and journal_line_id = v_line_id and status = 'approved'
    ) then
      v_already := v_already + 1;
      continue;
    end if;
    if v_txn.status = 'ignored' then
      v_ignored := v_ignored + 1;
      continue;
    end if;
    if v_txn.status <> 'unmatched' or exists (
      select 1 from acc_reconciliation
       where journal_line_id = v_line_id and status = 'approved' and bank_transaction_id <> v_txn.id
    ) then
      v_elsewhere := v_elsewhere + 1;
      continue;
    end if;
    select (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint
      into v_signed
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id
     where l.id = v_line_id and e.status = 'posted';
    if not found then
      raise exception 'Book line % is not part of a posted entry', v_line_id;
    end if;
    if v_signed <> v_txn.amount_minor then
      v_differs := v_differs + 1;
      continue;
    end if;

    update acc_reconciliation
       set status = 'rejected', updated_at = now()
     where bank_transaction_id = v_txn.id
       and status = 'suggested'
       and journal_line_id is distinct from v_line_id;
    insert into acc_reconciliation (bank_transaction_id, journal_line_id, rule_applied, confidence, status, approved_by)
    values (v_txn.id, v_line_id, 'statement_reconciliation', 1, 'approved', auth.uid())
    on conflict (bank_transaction_id, journal_line_id) where journal_line_id is not null
    do update set status = 'approved', approved_by = auth.uid(), confidence = 1,
                  rule_applied = 'statement_reconciliation', updated_at = now()
    returning id into v_match_id;
    update acc_bank_transaction set status = 'matched', updated_at = now() where id = v_txn.id;

    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_reconciliation', v_match_id, 'match_from_reconciliation', auth.uid(),
            jsonb_build_object('status', 'approved',
                               'bank_transaction_id', v_txn.id,
                               'journal_line_id', v_line_id,
                               'statement_reconciliation_id', p_reconciliation_id));
    v_matched := v_matched + 1;
  end loop;

  return jsonb_build_object('matched', v_matched, 'already', v_already,
                            'elsewhere', v_elsewhere, 'ignored', v_ignored, 'differs', v_differs);
end;
$$;

revoke all on function acc_match_reconciled_bank_lines(uuid, jsonb) from public, anon;
grant execute on function acc_match_reconciled_bank_lines(uuid, jsonb) to authenticated, service_role;
```

- [ ] **Step 4: Run them — they pass.**

Run: `node --env-file=.env.local scripts/verify-reconciled-bank-lines.mjs`
Expected: each of the six schemas prints `(0136 applied inside the transaction, never committed)` and only `ok` lines; the last line is `151 passed, 0 failed` (a company with an active viewer adds "a viewer cannot match"). Nothing is left behind: every company's transaction is rolled back.
Run: `npx vitest run tests/unit/match-reconciled-bank-lines-migration.test.ts tests/unit/migration-grants.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add supabase/migrations/0136_match_reconciled_bank_lines.sql scripts/verify-reconciled-bank-lines.mjs tests/unit/match-reconciled-bank-lines-migration.test.ts
printf 'feat(db): 0136 match a completed reconciliation'"'"'s bank lines\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: Which bank line a statement line was imported as, and what matching says

**Files:**
- Create: `lib/domain/statement-bank-lines.ts`
- Create: `tests/unit/statement-bank-lines.test.ts`
- Modify: `lib/domain/add-missing.ts` (its private `lineKey` gives way to `statementLineKey`)

**Interfaces:**
- Consumes: `Standing` from `lib/domain/reconcile-statement.ts` (`{ kind: "paired"; how; bookId; entryNumber; ticked } | { kind: "missing" } | { kind: "after" }`).
- Produces (`lib/domain/statement-bank-lines.ts`):
  - `interface StatementLineFields { txnDate: string; amountMinor: number; description: string | null; reference: string | null }`
  - `statementLineKey(line: StatementLineFields): string`
  - `interface StatementBankLine extends StatementLineFields { id: string; status: string; approvedLineId: string | null }`
  - `interface BankLinePair { bankTransactionId: string; journalLineId: string }`
  - `reconciledBankPairs(lines: readonly StatementLineFields[], standings: readonly Standing[], transactions: readonly StatementBankLine[]): BankLinePair[]`
  - `interface BankLineMatchCounts { matched; already; elsewhere; ignored; differs }` (numbers), `NO_BANK_LINE_MATCHES`, `addMatchCounts(a, b)`
  - `bankLinesMatchedSentence(counts): string`, `bankLinesNotMatchedSentence(problem: string, to?: string): string`, `completedMessage(counts: BankLineMatchCounts | null, matchError: string | null): string`

- [ ] **Step 1: The test first.** Create `tests/unit/statement-bank-lines.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Standing } from "@/lib/domain/reconcile-statement";
import {
  NO_BANK_LINE_MATCHES,
  addMatchCounts,
  bankLinesMatchedSentence,
  bankLinesNotMatchedSentence,
  completedMessage,
  reconciledBankPairs,
  statementLineKey,
  type StatementBankLine,
  type StatementLineFields,
} from "@/lib/domain/statement-bank-lines";

const line = (txnDate: string, amountMinor: number, description: string, reference: string | null = null): StatementLineFields => ({
  txnDate,
  amountMinor,
  description,
  reference,
});
const txn = (id: string, l: StatementLineFields, extra: Partial<StatementBankLine> = {}): StatementBankLine => ({
  id,
  ...l,
  status: "unmatched",
  approvedLineId: null,
  ...extra,
});
const paired = (bookId: string, ticked = true): Standing => ({ kind: "paired", how: "date and amount", bookId, entryNumber: null, ticked });
const missing: Standing = { kind: "missing" };
const after: Standing = { kind: "after" };

describe("statementLineKey", () => {
  it("reads a statement line and its bank line the same way", () => {
    const long = "X".repeat(600);
    expect(statementLineKey(line("2026-07-05", 5000, long, "  1042  "))).toBe(
      statementLineKey(line("2026-07-05", 5000, long.slice(0, 500), "1042")),
    );
  });

  it("tells lines apart by date, amount, description and reference", () => {
    const base = line("2026-07-05", 5000, "DEPOSIT", "1");
    const keys = new Set([
      base,
      { ...base, txnDate: "2026-07-06" },
      { ...base, amountMinor: -5000 },
      { ...base, description: "DEPOSIT 2" },
      { ...base, reference: "2" },
    ].map(statementLineKey));
    expect(keys.size).toBe(5);
  });

  it("takes no description or reference as empty", () => {
    expect(statementLineKey(line("2026-07-05", 5000, "", null))).toBe(
      statementLineKey({ txnDate: "2026-07-05", amountMinor: 5000, description: null, reference: "  " }),
    );
  });
});

describe("reconciledBankPairs", () => {
  const deposit = line("2026-07-05", 50000, "DEPOSIT EXAMPLE");
  const fee = line("2026-07-30", -500, "SERVICE FEE");
  const late = line("2026-08-02", -700, "AFTER THE STATEMENT");

  it("pairs each paired, ticked statement line with the bank line it was imported as", () => {
    expect(
      reconciledBankPairs([deposit, fee], [paired("jl-dep"), paired("jl-fee")], [txn("t-fee", fee), txn("t-dep", deposit)]),
    ).toEqual([
      { bankTransactionId: "t-dep", journalLineId: "jl-dep" },
      { bankTransactionId: "t-fee", journalLineId: "jl-fee" },
    ]);
  });

  it("leaves out lines that are missing, after the statement, or paired but not ticked", () => {
    expect(
      reconciledBankPairs(
        [deposit, fee, late],
        [paired("jl-dep", false), missing, after],
        [txn("t-dep", deposit), txn("t-fee", fee), txn("t-late", late)],
      ),
    ).toEqual([]);
  });

  it("gives no pair for a line with no bank line", () => {
    expect(reconciledBankPairs([deposit, fee], [paired("jl-dep"), paired("jl-fee")], [txn("t-fee", fee)])).toEqual([
      { bankTransactionId: "t-fee", journalLineId: "jl-fee" },
    ]);
  });

  it("pairs identical lines in order, the first with the first", () => {
    expect(
      reconciledBankPairs([fee, fee], [paired("jl-1"), paired("jl-2")], [txn("t-1", fee), txn("t-2", fee), txn("t-3", fee)]),
    ).toEqual([
      { bankTransactionId: "t-1", journalLineId: "jl-1" },
      { bankTransactionId: "t-2", journalLineId: "jl-2" },
    ]);
  });

  it("keeps an identical bank line with the book line it is already matched to", () => {
    expect(
      reconciledBankPairs(
        [fee, fee],
        [paired("jl-1"), paired("jl-2")],
        [txn("t-1", fee, { status: "matched", approvedLineId: "jl-2" }), txn("t-2", fee)],
      ),
    ).toEqual([
      { bankTransactionId: "t-1", journalLineId: "jl-2" },
      { bankTransactionId: "t-2", journalLineId: "jl-1" },
    ]);
  });

  it("still hands over a bank line matched elsewhere, for the database to count", () => {
    expect(
      reconciledBankPairs([deposit], [paired("jl-dep")], [txn("t-dep", deposit, { status: "matched", approvedLineId: "jl-other" })]),
    ).toEqual([{ bankTransactionId: "t-dep", journalLineId: "jl-dep" }]);
  });
});

describe("what matching says", () => {
  const counts = (extra: Partial<typeof NO_BANK_LINE_MATCHES>) => ({ ...NO_BANK_LINE_MATCHES, ...extra });

  it("adds two runs' counts", () => {
    expect(addMatchCounts(counts({ matched: 2, ignored: 1 }), counts({ matched: 3, already: 4, elsewhere: 1, differs: 2 }))).toEqual({
      matched: 5,
      already: 4,
      elsewhere: 1,
      ignored: 1,
      differs: 2,
    });
  });

  it("says how many bank lines are matched", () => {
    expect(completedMessage(counts({ matched: 12, already: 3 }), null)).toBe(
      "Reconciliation completed. 12 bank lines matched in Bank Transactions.",
    );
    expect(completedMessage(counts({ matched: 1 }), null)).toBe("Reconciliation completed. 1 bank line matched in Bank Transactions.");
  });

  it("says nothing more when nothing was matched or left", () => {
    expect(completedMessage(counts({ already: 4 }), null)).toBe("Reconciliation completed.");
    expect(completedMessage(null, null)).toBe("Reconciliation completed.");
  });

  it("names the lines left as they were, and where to look", () => {
    expect(completedMessage(counts({ matched: 12, elsewhere: 2 }), null)).toBe(
      "Reconciliation completed. 12 bank lines matched in Bank Transactions. 2 are matched to another entry — check them in Bank Transactions.",
    );
    expect(bankLinesMatchedSentence(counts({ matched: 3, elsewhere: 1, ignored: 2, differs: 1 }))).toBe(
      "3 bank lines matched in Bank Transactions. 1 is matched to another entry, 2 are ignored and 1 has the opposite sign to the books — check them in Bank Transactions.",
    );
    expect(bankLinesMatchedSentence(counts({ ignored: 1 }))).toBe("Of the bank lines, 1 is ignored — check it in Bank Transactions.");
  });

  it("says when the bank lines could not be matched, and that the month is signed", () => {
    expect(completedMessage(null, "connection lost")).toBe(
      "Reconciliation completed. Its bank lines could not be matched in Bank Transactions (connection lost); approve them there.",
    );
  });

  it("names the month when a run signed several", () => {
    expect(bankLinesNotMatchedSentence("connection lost", "Jul 31, 2026")).toBe(
      "The bank lines to Jul 31, 2026 could not be matched in Bank Transactions (connection lost); approve them there.",
    );
  });
});
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/statement-bank-lines.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/statement-bank-lines`.

- [ ] **Step 3: The domain module.** Create `lib/domain/statement-bank-lines.ts`:

```ts
/**
 * The bank line a statement line was imported as, and what matching a
 * completed reconciliation's bank lines says (1.85).
 *
 * A statement line and a bank line of the same account are the same line when
 * their date, amount, description and reference agree. When a reconciliation is
 * completed, every statement line paired with a ticked book line gives one
 * pair — that bank line and that book line — for acc_match_reconciled_bank_lines
 * to match in Bank Transactions. Pure: the service reads, this decides.
 */
import type { Standing } from "./reconcile-statement";

export interface StatementLineFields {
  txnDate: string;
  amountMinor: number;
  description: string | null;
  reference: string | null;
}

/**
 * The key a statement line and its bank line share. The statement keeps a
 * description cut to 500 characters and a reference trimmed to 80, where the
 * bank line keeps them as the file gave them — so both are read the same way.
 */
export function statementLineKey(line: StatementLineFields): string {
  const ref = (line.reference ?? "").trim().slice(0, 80);
  return JSON.stringify([line.txnDate, line.amountMinor, (line.description ?? "").slice(0, 500), ref]);
}

/** A bank line of the reconciliation's account, as the matching reads it. */
export interface StatementBankLine extends StatementLineFields {
  id: string;
  status: string;
  /** The book line its approved match is to, when it has one. */
  approvedLineId: string | null;
}

export interface BankLinePair {
  bankTransactionId: string;
  journalLineId: string;
}

/**
 * The pairs a completed reconciliation matches: each statement line paired
 * with a ticked book line, and the bank line it was imported as. Identical
 * lines are one group: a bank line already matched to one of the group's book
 * lines keeps it, and the rest pair in order, the first with the first. A
 * statement line with no bank line left gives no pair.
 */
export function reconciledBankPairs(
  lines: readonly StatementLineFields[],
  /** One per line, in the same order (reconciliationStandings). */
  standings: readonly Standing[],
  /** The account's bank lines; identical lines in the order they were imported. */
  transactions: readonly StatementBankLine[],
): BankLinePair[] {
  const bookLines = new Map<string, string[]>();
  lines.forEach((line, i) => {
    const standing = standings[i];
    if (standing?.kind !== "paired" || !standing.ticked) return;
    const key = statementLineKey(line);
    bookLines.set(key, [...(bookLines.get(key) ?? []), standing.bookId]);
  });
  const bankLines = new Map<string, StatementBankLine[]>();
  for (const txn of transactions) {
    const key = statementLineKey(txn);
    if (bookLines.has(key)) bankLines.set(key, [...(bankLines.get(key) ?? []), txn]);
  }

  const pairs: BankLinePair[] = [];
  for (const [key, books] of bookLines) {
    const free = [...(bankLines.get(key) ?? [])];
    const open: string[] = [];
    for (const journalLineId of books) {
      const kept = free.findIndex((txn) => txn.approvedLineId === journalLineId);
      if (kept < 0) {
        open.push(journalLineId);
        continue;
      }
      pairs.push({ bankTransactionId: free[kept].id, journalLineId });
      free.splice(kept, 1);
    }
    open.forEach((journalLineId, i) => {
      if (free[i]) pairs.push({ bankTransactionId: free[i].id, journalLineId });
    });
  }
  return pairs;
}

/** What acc_match_reconciled_bank_lines did with the pairs it was given. */
export interface BankLineMatchCounts {
  /** Matched now. */
  matched: number;
  /** Matched to that book line before (by Add all, Categorize, or an earlier run). */
  already: number;
  /** The bank line is matched to another entry, or the book line to another bank line. */
  elsewhere: number;
  ignored: number;
  /** The bank line's amount has the opposite sign to the book line's. */
  differs: number;
}

export const NO_BANK_LINE_MATCHES: BankLineMatchCounts = { matched: 0, already: 0, elsewhere: 0, ignored: 0, differs: 0 };

export function addMatchCounts(a: BankLineMatchCounts, b: BankLineMatchCounts): BankLineMatchCounts {
  return {
    matched: a.matched + b.matched,
    already: a.already + b.already,
    elsewhere: a.elsewhere + b.elsewhere,
    ignored: a.ignored + b.ignored,
    differs: a.differs + b.differs,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isAre = (n: number) => (n === 1 ? "is" : "are");

/**
 * What matching said, in sentences after "Reconciliation completed." or a
 * run's summary: how many bank lines are matched now, and the ones left as
 * they were and why. Empty when there is nothing to say.
 */
export function bankLinesMatchedSentence(counts: BankLineMatchCounts): string {
  const said: string[] = [];
  if (counts.matched > 0) said.push(`${plural(counts.matched, "bank line")} matched in Bank Transactions.`);
  const left = [
    counts.elsewhere > 0 ? `${counts.elsewhere} ${isAre(counts.elsewhere)} matched to another entry` : null,
    counts.ignored > 0 ? `${counts.ignored} ${isAre(counts.ignored)} ignored` : null,
    counts.differs > 0 ? `${counts.differs} ${counts.differs === 1 ? "has" : "have"} the opposite sign to the books` : null,
  ].filter((part): part is string => part !== null);
  if (left.length) {
    const total = counts.elsewhere + counts.ignored + counts.differs;
    const list = left.length === 1 ? left[0] : `${left.slice(0, -1).join(", ")} and ${left[left.length - 1]}`;
    const lead = counts.matched > 0 ? list : `Of the bank lines, ${list}`;
    said.push(`${lead} — check ${total === 1 ? "it" : "them"} in Bank Transactions.`);
  }
  return said.join(" ");
}

/**
 * Said when a reconciliation was completed but its bank lines could not be
 * matched; `to` names the month when a run signed several.
 */
export function bankLinesNotMatchedSentence(problem: string, to?: string): string {
  const which = to ? `The bank lines to ${to}` : "Its bank lines";
  return `${which} could not be matched in Bank Transactions (${problem}); approve them there.`;
}

/** What Complete says when it is done. */
export function completedMessage(counts: BankLineMatchCounts | null, matchError: string | null): string {
  const after = matchError ? bankLinesNotMatchedSentence(matchError) : counts ? bankLinesMatchedSentence(counts) : "";
  return after ? `Reconciliation completed. ${after}` : "Reconciliation completed.";
}
```

- [ ] **Step 4: Add all uses the same rule.** In `lib/domain/add-missing.ts` apply these edits:

Edit 1 of 4 — find:

```ts
 * that cannot be added says why. Pure: the service reads, this decides.
 */
import type { Standing } from "./reconcile-statement";
import type { HoldingAccounts } from "./uncategorized";

/** The most lines one click adds; matches acc_add_statement_lines_to_books. */
```

replace with:

```ts
 * that cannot be added says why. Pure: the service reads, this decides.
 */
import type { Standing } from "./reconcile-statement";
import { statementLineKey } from "./statement-bank-lines";
import type { HoldingAccounts } from "./uncategorized";

/** The most lines one click adds; matches acc_add_statement_lines_to_books. */
```

Edit 2 of 4 — find:

```ts

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
```

replace with:

```ts

export const UNCATEGORIZED_WHY = "Nothing places this line, so it goes to Uncategorized, to recode later.";

export function planAddMissing(input: {
  lines: readonly AddStatementLine[];
  /** One per line, in the same order (reconciliationStandings). */
```

Edit 3 of 4 — find:

```ts

  const groups = new Map<string, AddBankLine[]>();
  for (const txn of input.transactions) {
    const key = lineKey(txn.txnDate, txn.amountMinor, txn.description, txn.reference);
    groups.set(key, [...(groups.get(key) ?? []), txn]);
  }
  const taken = new Set<string>();
```

replace with:

```ts

  const groups = new Map<string, AddBankLine[]>();
  for (const txn of input.transactions) {
    const key = statementLineKey(txn);
    groups.set(key, [...(groups.get(key) ?? []), txn]);
  }
  const taken = new Set<string>();
```

Edit 4 of 4 — find:

```ts
  const items: AddItem[] = [];
  const cannot: CannotAdd[] = [];
  for (const line of missingLines) {
    const group = groups.get(lineKey(line.txnDate, line.amountMinor, line.description, line.reference)) ?? [];
    const free = group.find((txn) => !taken.has(txn.id) && txn.status === "unmatched" && !txn.suggested);
    const said = { lineNo: line.lineNo, txnDate: line.txnDate, description: line.description, amountMinor: line.amountMinor };
    if (line.amountMinor === 0 || (input.signedThrough && line.txnDate <= input.signedThrough)) {
```

replace with:

```ts
  const items: AddItem[] = [];
  const cannot: CannotAdd[] = [];
  for (const line of missingLines) {
    const group = groups.get(statementLineKey(line)) ?? [];
    const free = group.find((txn) => !taken.has(txn.id) && txn.status === "unmatched" && !txn.suggested);
    const said = { lineNo: line.lineNo, txnDate: line.txnDate, description: line.description, amountMinor: line.amountMinor };
    if (line.amountMinor === 0 || (input.signedThrough && line.txnDate <= input.signedThrough)) {
```

- [ ] **Step 5: Run them — they pass.**

Run: `npx vitest run tests/unit/statement-bank-lines.test.ts tests/unit/add-missing.test.ts`
Expected: PASS (Add all's own tests unchanged).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add lib/domain/statement-bank-lines.ts tests/unit/statement-bank-lines.test.ts lib/domain/add-missing.ts
printf 'feat(banking): which bank line a statement line was imported as, and what matching says\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: Matching a completed reconciliation's bank lines, on the server

**Files:**
- Create: `lib/services/statement-bank-lines.ts`
- Create: `tests/unit/statement-bank-lines-service.test.ts`
- Modify: `lib/services/add-missing.ts` (its private `bankLinesBetween` moves to the new service)

**Interfaces:**
- Consumes: Task 2's domain module; `getReconciliationStatement`, `getReconciliationLines` from `lib/services/bankrec.ts`; `reconciliationStandings` from `lib/domain/reconcile-statement.ts`; `readAllPages` from `lib/services/paging.ts`; Task 1's RPC.
- Produces (`lib/services/statement-bank-lines.ts`):
  - `class StatementBankLinesError extends Error`
  - `bankLinesBetween(sb, bankAccountId: string, from: string, to: string): Promise<StatementBankLine[]>` — paged, `txn_date` then `id`, with `approvedLineId` from the embedded `acc_reconciliation` rows
  - `reconciledPairsOf(sb, reconciliationId: string): Promise<BankLinePair[]>`
  - `matchCountsOf(data: unknown): BankLineMatchCounts`
  - `matchReconciledBankLines(sb, reconciliationId: string): Promise<BankLineMatchCounts>` — no RPC call when there are no pairs
  - `interface CompletionMatching { matched: BankLineMatchCounts | null; matchError: string | null }`
  - `matchAfterCompletion(sb, reconciliationId: string): Promise<CompletionMatching>` — never throws

- [ ] **Step 1: The test first.** Create `tests/unit/statement-bank-lines-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  StatementBankLinesError,
  bankLinesBetween,
  matchAfterCompletion,
  matchCountsOf,
  matchReconciledBankLines,
} from "@/lib/services/statement-bank-lines";

/**
 * A stand-in for PostgREST: tables and table-returning RPCs page at a row cap
 * as PostgREST does; an RPC given as a function returns a single value and
 * records what it was called with.
 */
type Rows = Record<string, unknown>[];
type Scalar = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows | Scalar>, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const orders: Record<string, string[]> = {};
  function builder(target: string, rows: Rows) {
    orders[target] = [];
    const page = (from: number, to: number) => ({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null });
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is", "gte", "lte"]) chain[name] = () => chain;
    chain.order = (column: string) => {
      orders[target].push(column);
      return chain;
    };
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    return chain;
  }
  const sb = {
    from: (table: string) => builder(table, tables[table] ?? []),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = rpcs[fn];
      if (typeof answer === "function") return Promise.resolve(answer(args));
      return builder(`rpc:${fn}`, answer ?? []);
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders };
}

const bankRow = (id: string, txnDate: string, amount: number, description: string, matches: Rows = [], status = "unmatched") => ({
  id,
  txn_date: txnDate,
  description,
  reference: null,
  amount_minor: amount,
  status,
  matches,
});

describe("a bank account's lines between two days", () => {
  it("reads every line past the row cap, oldest first, with the book line its approved match is to", async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => bankRow(`t-${i}`, "2026-09-01", 100 + i, `Line ${i}`));
    rows[0] = bankRow("t-0", "2026-09-01", 100, "Line 0", [
      { journal_line_id: "jl-rejected", status: "rejected" },
      { journal_line_id: "jl-approved", status: "approved" },
    ], "matched");
    rows[1] = bankRow("t-1", "2026-09-01", 101, "Line 1", [{ journal_line_id: "jl-suggested", status: "suggested" }]);
    const { sb, orders } = fakeClient({ acc_bank_transaction: rows }, {});
    const lines = await bankLinesBetween(sb, "bank-1", "2026-09-01", "2026-09-30");
    expect(lines).toHaveLength(2300);
    expect(orders.acc_bank_transaction).toEqual(["txn_date", "id"]);
    expect(lines[0]).toEqual({
      id: "t-0",
      txnDate: "2026-09-01",
      description: "Line 0",
      reference: null,
      amountMinor: 100,
      status: "matched",
      approvedLineId: "jl-approved",
    });
    expect(lines[1].approvedLineId).toBeNull();
  });
});

describe("matching a completed reconciliation's bank lines", () => {
  const session = {
    bank_account_id: "bank-1",
    statement_ending_date: "2026-09-30",
    status: "completed",
    statement_ref: "september.csv",
    statement_opening_minor: 0,
    statement_closing_minor: null,
    note: null,
    brought_forward: false,
    statement_file_id: null,
    statement_file: null,
  };
  const statementLine = (lineNo: number, date: string, amount: number, description: string) => ({
    line_no: lineNo,
    txn_date: date,
    description,
    reference: null,
    amount_minor: amount,
    balance_minor: null,
  });
  const bookLine = (id: string, date: string, signed: number, cleared: boolean) => ({
    journal_line_id: id,
    entry_id: `e-${id}`,
    entry_number: `JE-${id}`,
    entry_date: date,
    source_type: "manual",
    memo: null,
    signed_minor: signed,
    cleared,
    reference: null,
  });
  const tables = {
    acc_statement_reconciliation: [session],
    acc_reconciliation_statement_line: [
      statementLine(1, "2026-09-03", 50000, "DEPOSIT EXAMPLE"),
      statementLine(2, "2026-09-10", -500, "SERVICE FEE"),
      statementLine(3, "2026-09-12", -1200, "POS EXAMPLE SHOP"),
    ],
    acc_bank_transaction: [
      bankRow("t-dep", "2026-09-03", 50000, "DEPOSIT EXAMPLE"),
      bankRow("t-fee", "2026-09-10", -500, "SERVICE FEE"),
      bankRow("t-shop", "2026-09-12", -1200, "POS EXAMPLE SHOP"),
    ],
  };
  // The deposit is paired and ticked; the fee is paired but not ticked; the shop is not in the books.
  const book = [bookLine("jl-dep", "2026-09-03", 50000, true), bookLine("jl-fee", "2026-09-10", -500, false)];

  it("hands the paired, ticked lines to the database and says what it did", async () => {
    const { sb, calls } = fakeClient(tables, {
      acc_reconciliation_lines: book,
      acc_match_reconciled_bank_lines: () => ({ data: { matched: 1, already: 0, elsewhere: 0, ignored: 0, differs: 0 }, error: null }),
    });
    expect(await matchReconciledBankLines(sb, "rec-1")).toEqual({ matched: 1, already: 0, elsewhere: 0, ignored: 0, differs: 0 });
    expect(calls.find((c) => c.fn === "acc_match_reconciled_bank_lines")?.args).toEqual({
      p_reconciliation_id: "rec-1",
      p_pairs: [{ bank_transaction_id: "t-dep", journal_line_id: "jl-dep" }],
    });
  });

  it("asks nothing of the database when no line is paired and ticked", async () => {
    const { sb, calls } = fakeClient(tables, { acc_reconciliation_lines: [bookLine("jl-fee", "2026-09-10", -500, false)] });
    expect(await matchReconciledBankLines(sb, "rec-1")).toEqual({ matched: 0, already: 0, elsewhere: 0, ignored: 0, differs: 0 });
    expect(calls.map((c) => c.fn)).not.toContain("acc_match_reconciled_bank_lines");
  });

  it("says why when the database refuses", async () => {
    const { sb } = fakeClient(tables, {
      acc_reconciliation_lines: book,
      acc_match_reconciled_bank_lines: () => ({ data: null, error: { message: "Not authorized to match bank lines" } }),
    });
    await expect(matchReconciledBankLines(sb, "rec-1")).rejects.toThrow(StatementBankLinesError);
    await expect(matchReconciledBankLines(sb, "rec-1")).rejects.toThrow("Not authorized to match bank lines");
  });

  it("after completion, returns a failure to be said rather than throwing it", async () => {
    const { sb } = fakeClient(tables, {
      acc_reconciliation_lines: book,
      acc_match_reconciled_bank_lines: () => ({ data: null, error: { message: "connection lost" } }),
    });
    expect(await matchAfterCompletion(sb, "rec-1")).toEqual({ matched: null, matchError: "connection lost" });
    const ok = fakeClient(tables, {
      acc_reconciliation_lines: book,
      acc_match_reconciled_bank_lines: () => ({ data: { matched: 1, already: 0, elsewhere: 0, ignored: 0, differs: 0 }, error: null }),
    });
    expect(await matchAfterCompletion(ok.sb, "rec-1")).toEqual({
      matched: { matched: 1, already: 0, elsewhere: 0, ignored: 0, differs: 0 },
      matchError: null,
    });
  });

  it("reads the database's answer as counts", () => {
    expect(matchCountsOf({ matched: 2, already: "3", elsewhere: 1, ignored: 0, differs: 4 })).toEqual({
      matched: 2,
      already: 3,
      elsewhere: 1,
      ignored: 0,
      differs: 4,
    });
    expect(matchCountsOf(null)).toEqual({ matched: 0, already: 0, elsewhere: 0, ignored: 0, differs: 0 });
  });
});
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/statement-bank-lines-service.test.ts`
Expected: FAIL — cannot resolve `@/lib/services/statement-bank-lines`.

- [ ] **Step 3: The service.** Create `lib/services/statement-bank-lines.ts`:

```ts
/**
 * A bank account's lines as a statement reconciliation reads them, and the
 * matching of a completed reconciliation's bank lines in Bank Transactions
 * (1.85): the pairs are worked out here from the kept statement and the books,
 * and acc_match_reconciled_bank_lines matches them in one transaction.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconciliationStandings } from "@/lib/domain/reconcile-statement";
import {
  NO_BANK_LINE_MATCHES,
  reconciledBankPairs,
  type BankLineMatchCounts,
  type BankLinePair,
  type StatementBankLine,
} from "@/lib/domain/statement-bank-lines";
import { getReconciliationLines, getReconciliationStatement } from "./bankrec";
import { readAllPages } from "./paging";

export class StatementBankLinesError extends Error {}

/**
 * A bank account's lines from one day to another, with the book line each is
 * matched to. Paged, oldest first; the id settles lines of one day, so
 * identical lines keep one order however many pages the read takes.
 */
export async function bankLinesBetween(sb: SupabaseClient, bankAccountId: string, from: string, to: string): Promise<StatementBankLine[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (start, end) =>
      sb
        .from("acc_bank_transaction")
        .select("id,txn_date,description,reference,amount_minor,status,matches:acc_reconciliation(journal_line_id,status)")
        .eq("bank_account_id", bankAccountId)
        .is("provider_removed_at", null)
        .gte("txn_date", from)
        .lte("txn_date", to)
        .order("txn_date")
        .order("id")
        .range(start, end),
    (message) => new StatementBankLinesError(message),
  );
  return rows.map((row) => {
    const matches = (row.matches as { journal_line_id: string | null; status: string }[] | null) ?? [];
    return {
      id: row.id as string,
      txnDate: row.txn_date as string,
      description: (row.description as string | null) ?? null,
      reference: (row.reference as string | null) ?? null,
      amountMinor: Number(row.amount_minor),
      status: row.status as string,
      approvedLineId: matches.find((m) => m.status === "approved" && m.journal_line_id)?.journal_line_id ?? null,
    };
  });
}

/** The pairs a completed reconciliation matches: each ticked statement pair and the bank line it was imported as. */
export async function reconciledPairsOf(sb: SupabaseClient, reconciliationId: string): Promise<BankLinePair[]> {
  const [statement, book] = await Promise.all([
    getReconciliationStatement(sb, reconciliationId),
    getReconciliationLines(sb, reconciliationId),
  ]);
  const { standings } = reconciliationStandings(statement, book);
  const dates = statement.lines
    .filter((_, i) => {
      const standing = standings[i];
      return standing?.kind === "paired" && standing.ticked;
    })
    .map((line) => line.txnDate)
    .sort();
  if (!dates.length) return [];
  const transactions = await bankLinesBetween(sb, statement.bankAccountId, dates[0], dates[dates.length - 1]);
  return reconciledBankPairs(statement.lines, standings, transactions);
}

/** acc_match_reconciled_bank_lines's answer, read as counts. */
export function matchCountsOf(data: unknown): BankLineMatchCounts {
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    matched: Number(r.matched ?? 0),
    already: Number(r.already ?? 0),
    elsewhere: Number(r.elsewhere ?? 0),
    ignored: Number(r.ignored ?? 0),
    differs: Number(r.differs ?? 0),
  };
}

/**
 * Matches a completed reconciliation's bank lines in Bank Transactions. A bank
 * line matched before, ignored, or matched to another entry is left as it is
 * and counted; running it again matches only what is still unmatched.
 */
export async function matchReconciledBankLines(sb: SupabaseClient, reconciliationId: string): Promise<BankLineMatchCounts> {
  const pairs = await reconciledPairsOf(sb, reconciliationId);
  if (!pairs.length) return NO_BANK_LINE_MATCHES;
  const { data, error } = await sb.rpc("acc_match_reconciled_bank_lines", {
    p_reconciliation_id: reconciliationId,
    p_pairs: pairs.map((p) => ({ bank_transaction_id: p.bankTransactionId, journal_line_id: p.journalLineId })),
  });
  if (error) throw new StatementBankLinesError(error.message);
  return matchCountsOf(data);
}

/** What matching did once a reconciliation was completed: the counts, or why it failed. */
export interface CompletionMatching {
  matched: BankLineMatchCounts | null;
  /** Why the bank lines could not be matched; the reconciliation stays completed. */
  matchError: string | null;
}

/**
 * Matches a reconciliation's bank lines right after it was completed. A
 * failure does not undo the completion: it is returned, to be said beside it.
 */
export async function matchAfterCompletion(sb: SupabaseClient, reconciliationId: string): Promise<CompletionMatching> {
  try {
    return { matched: await matchReconciledBankLines(sb, reconciliationId), matchError: null };
  } catch (e) {
    return { matched: null, matchError: e instanceof Error ? e.message : "an unexpected error" };
  }
}
```

- [ ] **Step 4: Add all reads the bank lines from it.** In `lib/services/add-missing.ts` apply these edits:

Edit 1 of 2 — find:

```ts
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
```

replace with:

```ts
import { listSuggestions } from "./banking";
import { getReconciliationLines, getReconciliationStatement, listReconciliations, pairAndTick } from "./bankrec";
import { codingSuggestions } from "./coding";
import { bankLinesBetween } from "./statement-bank-lines";

export class AddMissingError extends Error {}

/** What "Add all N to the books" would add to this reconciliation, and what it cannot. */
export async function getAddMissingPlan(sb: SupabaseClient, reconciliationId: string): Promise<AddMissingPlan> {
  const [statement, book] = await Promise.all([
```

Edit 2 of 2 — find:

```ts
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
```

replace with:

```ts
      .at(-1) ?? null;
  const suggested = new Set(matches.map((m) => m.bank_transaction_id));
  const transactions: AddBankLine[] = rows.map((row) => ({
    id: row.id,
    txnDate: row.txnDate,
    description: row.description,
    reference: row.reference,
    amountMinor: row.amountMinor,
    status: row.status,
    suggested: suggested.has(row.id),
  }));
  const suggestions = new Map<string, AddSuggestion>(
    coding.map((s) => [s.transactionId, { accountId: s.accountId, accountLabel: s.accountLabel, source: s.source, short: s.short, why: s.why }]),
```

- [ ] **Step 5: Run them — they pass.**

Run: `npx vitest run tests/unit/statement-bank-lines-service.test.ts tests/unit/add-missing.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add lib/services/statement-bank-lines.ts tests/unit/statement-bank-lines-service.test.ts lib/services/add-missing.ts
printf 'feat(banking): match a completed reconciliation'"'"'s bank lines\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: The server actions match on completion and say what a kept file could not do

**Files:**
- Modify: `lib/domain/statement-evidence.ts` (Attach's count message; `unlinkedFileMessage`; `serverFailure`)
- Modify: `tests/unit/statement-evidence.test.ts`
- Modify: `lib/services/statement-files.ts` (`tieKeptStatementFile`)
- Modify: `tests/unit/statement-files-service.test.ts`
- Modify: `app/(app)/banking/reconcile/actions.ts` (`completeReconciliationAction`)
- Modify: `app/(app)/banking/reconcile/statement-actions.ts` (imports, `reconcileRunMonthAction`)
- Modify: `app/(app)/banking/actions.ts` (`importStatementAction`)

**Interfaces:**
- Consumes: `matchAfterCompletion`, `CompletionMatching` (Task 3); `BankLineMatchCounts` (Task 2).
- Produces:
  - `lib/domain/statement-evidence.ts`: `unlinkedFileMessage(reason: string, where: "reconciliation" | "import"): string`; `serverFailure(error: unknown): string`
  - `lib/services/statement-files.ts`: `tieKeptStatementFile(sb, where: "reconciliation" | "import", id: string, fileId: string): Promise<string | null>` — the warning to show, or null; never throws
  - `completeReconciliationAction(id): Promise<ActionResult<CompletionMatching>>`
  - `StatementImportSummary.fileWarning: string | null`
  - `RunMonthResult` gains `matched: BankLineMatchCounts | null`, `matchError: string | null`, `fileWarning: string | null`
  - `importStatementAction(...)` data gains `fileWarning: string | null`

- [ ] **Step 1: The tests first.** In `tests/unit/statement-evidence.test.ts` apply these edits:

Edit 1 of 4 — find:

```ts
import { describe, expect, it } from "vitest";
import {
  keepFailureMessage,
  linesSpan,
  shortSha,
  statementFileAccount,
```

replace with:

```ts
import { describe, expect, it } from "vitest";
import {
  keepFailureMessage,
  unlinkedFileMessage,
  linesSpan,
  shortSha,
  statementFileAccount,
```

Edit 2 of 4 — find:

```ts
  });
});

describe("statementFileMismatch", () => {
  const MAY: EvidenceTarget = {
    endingDate: "2026-05-31",
```

replace with:

```ts
  });
});

describe("unlinkedFileMessage", () => {
  it("says an import's file is kept, and where to find it", () => {
    expect(unlinkedFileMessage("permission denied.", "import")).toBe(
      "The statement file was kept but could not be tied to this import: permission denied. It is in Reports › Saved.",
    );
  });

  it("points a reconciliation to Attach the statement", () => {
    expect(unlinkedFileMessage("", "reconciliation")).toBe(
      "The statement file was kept but could not be tied to this reconciliation: an unexpected error occurred. Attach it on the reconciliation.",
    );
  });
});

describe("statementFileMismatch", () => {
  const MAY: EvidenceTarget = {
    endingDate: "2026-05-31",
```

Edit 3 of 4 — find:

```ts
  it("refuses a statement with a line more or less", () => {
    const read = { to: "2026-05-31", closingMinor: 616001, lines: MAY.keptLines.slice(0, 1) };
    expect(statementFileMismatch(read, MAY, money)).toBe(
      "This file has 1 line from May 4, 2026 to May 31, 2026; this reconciliation kept 2 lines from its statement.",
    );
  });
```

replace with:

```ts
  it("refuses a statement with a line more or less", () => {
    const read = { to: "2026-05-31", closingMinor: 616001, lines: MAY.keptLines.slice(0, 1) };
    expect(statementFileMismatch(read, MAY, money)).toBe(
      "This reconciliation kept 2 lines from May 4, 2026 to May 31, 2026; this file has 1 line in those days.",
    );
  });
```

Edit 4 of 4 — find:

```ts

  it("refuses a bank download whose lines are not the kept ones", () => {
    const lines = [{ txn_date: "2026-05-04", amount_minor: -1200 }];
    expect(statementFileMismatch({ to: null, closingMinor: null, lines }, MAY, money)).toMatch(/^This file has 1 line /);
  });

  it("needs a closing balance when the reconciliation kept no lines", () => {
```

replace with:

```ts

  it("refuses a bank download whose lines are not the kept ones", () => {
    const lines = [{ txn_date: "2026-05-04", amount_minor: -1200 }];
    expect(statementFileMismatch({ to: null, closingMinor: null, lines }, MAY, money)).toMatch(/; this file has 1 line in those days\.$/);
  });

  it("needs a closing balance when the reconciliation kept no lines", () => {
```

In `tests/unit/statement-files-service.test.ts` apply this edit:

Edit 1 of 2 — find:

```ts
  createSavedReportStorageClient: () => ({ storage: { from: () => storage } }),
}));

const { removeUnkeptUpload } = await import("@/lib/services/statement-files");

const folder = "co_example";
const good = `${folder}/6d0f1e2a-1111-4222-8333-444455556666.pdf`;
```

replace with:

```ts
  createSavedReportStorageClient: () => ({ storage: { from: () => storage } }),
}));

const { removeUnkeptUpload, tieKeptStatementFile } = await import("@/lib/services/statement-files");

const folder = "co_example";
const good = `${folder}/6d0f1e2a-1111-4222-8333-444455556666.pdf`;
```

Edit 2 of 2 — find:

```ts
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
```

replace with:

```ts
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe("tieKeptStatementFile", () => {
  /** A client whose link RPCs answer `error`, recording what they were called with. */
  function rpcClient(error: { message: string } | null) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const sb = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: null, error };
      },
    } as never;
    return { sb, calls };
  }

  it("ties a file to its import, and says nothing", async () => {
    const { sb, calls } = rpcClient(null);
    expect(await tieKeptStatementFile(sb, "import", "batch-1", "file-1")).toBeNull();
    expect(calls).toEqual([{ fn: "acc_link_import_batch_statement_file", args: { p_batch_id: "batch-1", p_file_id: "file-1" } }]);
  });

  it("ties a file to a reconciliation", async () => {
    const { sb, calls } = rpcClient(null);
    expect(await tieKeptStatementFile(sb, "reconciliation", "rec-1", "file-1")).toBeNull();
    expect(calls).toEqual([
      { fn: "acc_link_reconciliation_statement_file", args: { p_reconciliation_id: "rec-1", p_file_id: "file-1" } },
    ]);
  });

  it("returns what the screen says when the file cannot be tied, instead of failing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sb } = rpcClient({ message: "This import already has a statement file" });
    expect(await tieKeptStatementFile(sb, "import", "batch-1", "file-1")).toBe(
      "The statement file was kept but could not be tied to this import: This import already has a statement file. It is in Reports › Saved.",
    );
    expect(await tieKeptStatementFile(sb, "reconciliation", "rec-1", "file-1")).toBe(
      "The statement file was kept but could not be tied to this reconciliation: This import already has a statement file. Attach it on the reconciliation.",
    );
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run them — they fail.**

Run: `npx vitest run tests/unit/statement-evidence.test.ts tests/unit/statement-files-service.test.ts`
Expected: FAIL — `unlinkedFileMessage` and `tieKeptStatementFile` are not functions; the count message still reads "This file has 1 line from …".

- [ ] **Step 3: The messages.** In `lib/domain/statement-evidence.ts` apply these edits:

Edit 1 of 2 — find:

```ts
/** Where a file that could not be kept can be attached later, and what was done without it. */
export type KeepFailureWhere = "reconciliation" | "import";

export function keepFailureMessage(reason: string, where: KeepFailureWhere): string {
  const why = reason.trim().replace(/[.\s]+$/, "") || "an unexpected error occurred";
  return where === "reconciliation"
    ? `The statement file could not be kept: ${why}. Attach it on the reconciliation.`
    : `The statement file could not be kept: ${why}. Its lines were imported without it.`;
}

// --- Attach the statement: is this file the reconciliation's statement? -----

export interface EvidenceLine {
```

replace with:

```ts
/** Where a file that could not be kept can be attached later, and what was done without it. */
export type KeepFailureWhere = "reconciliation" | "import";

const reasonText = (reason: string) => reason.trim().replace(/[.\s]+$/, "") || "an unexpected error occurred";

export function keepFailureMessage(reason: string, where: KeepFailureWhere): string {
  const why = reasonText(reason);
  return where === "reconciliation"
    ? `The statement file could not be kept: ${why}. Attach it on the reconciliation.`
    : `The statement file could not be kept: ${why}. Its lines were imported without it.`;
}

/** Why a call to the server failed outright — its own words, or that it did not answer — for a dialog's message. */
export function serverFailure(error: unknown): string {
  return error instanceof Error && error.message.trim() ? reasonText(error.message) : "the server did not answer";
}

/** Said when a kept file could not be tied to the import or reconciliation it came with: the file is kept, only the link is missing. */
export function unlinkedFileMessage(reason: string, where: KeepFailureWhere): string {
  const why = reasonText(reason);
  return where === "reconciliation"
    ? `The statement file was kept but could not be tied to this reconciliation: ${why}. Attach it on the reconciliation.`
    : `The statement file was kept but could not be tied to this import: ${why}. It is in Reports › Saved.`;
}

// --- Attach the statement: is this file the reconciliation's statement? -----

export interface EvidenceLine {
```

Edit 2 of 2 — find:

```ts
  const plural = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
  if (month.length !== kept.length) {
    return (
      `This file has ${plural(month.length)} from ${date(firstKeptDay)} to ${date(target.endingDate)}; ` +
      `this reconciliation kept ${plural(kept.length)} from its statement.`
    );
  }
  const at = firstDifference(month);
```

replace with:

```ts
  const plural = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
  if (month.length !== kept.length) {
    return (
      `This reconciliation kept ${plural(kept.length)} from ${date(firstKeptDay)} to ${date(target.endingDate)}; ` +
      `this file has ${plural(month.length)} in those days.`
    );
  }
  const at = firstDifference(month);
```

- [ ] **Step 4: Tying a kept file.** In `lib/services/statement-files.ts` apply these edits:

Edit 1 of 2 — find:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";
import type { StatementFileKeepInput } from "@/lib/domain/statement-evidence";

/**
 * The statement file kept beside what was read from it (1.83), in the
```

replace with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSavedReportStorageClient } from "@/lib/db/storage-admin";
import { SAVED_REPORT_BUCKET } from "@/lib/domain/saved-reports";
import { unlinkedFileMessage, type KeepFailureWhere, type StatementFileKeepInput } from "@/lib/domain/statement-evidence";

/**
 * The statement file kept beside what was read from it (1.83), in the
```

Edit 2 of 2 — find:

```ts
  const { error } = await sb.rpc("acc_link_import_batch_statement_file", { p_batch_id: batchId, p_file_id: fileId });
  if (error) throw new StatementFileError(error.message);
}
```

replace with:

```ts
  const { error } = await sb.rpc("acc_link_import_batch_statement_file", { p_batch_id: batchId, p_file_id: fileId });
  if (error) throw new StatementFileError(error.message);
}

/**
 * Ties a file kept a moment ago to the import or the reconciliation it came
 * with. A failure costs nothing done with the file — it stays in Reports ›
 * Saved — so it is returned as the warning the screen shows, not thrown. Null
 * when the file is tied.
 */
export async function tieKeptStatementFile(
  sb: SupabaseClient,
  where: KeepFailureWhere,
  id: string,
  fileId: string,
): Promise<string | null> {
  try {
    if (where === "import") await linkImportBatchStatementFile(sb, id, fileId);
    else await linkReconciliationStatementFile(sb, id, fileId);
    return null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`linking the statement file to its ${where} failed:`, reason);
    return unlinkedFileMessage(reason, where);
  }
}
```

- [ ] **Step 5: Run them — they pass.**

Run: `npx vitest run tests/unit/statement-evidence.test.ts tests/unit/statement-files-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Complete matches the bank lines.** In `app/(app)/banking/reconcile/actions.ts` apply these edits:

Edit 1 of 2 — find:

```ts
  BankRecError, type ReconLineView, type ReconDetail, type DiscrepancyRow,
} from "@/lib/services/bankrec";
import type { StatementReconciliationRow } from "@/lib/db/types";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
```

replace with:

```ts
  BankRecError, type ReconLineView, type ReconDetail, type DiscrepancyRow,
} from "@/lib/services/bankrec";
import type { StatementReconciliationRow } from "@/lib/db/types";
import { matchAfterCompletion, type CompletionMatching } from "@/lib/services/statement-bank-lines";
import {
  executeOrSubmitForApproval,
  toControlledActionResponse,
```

Edit 2 of 2 — find:

```ts
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function completeReconciliationAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await completeReconciliation(sb, id); revalidatePath("/banking/reconcile"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

replace with:

```ts
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** Completes a reconciliation, then matches its bank lines in Bank Transactions (1.85); a matching failure is said, not undone. */
export async function completeReconciliationAction(id: string): Promise<ActionResult<CompletionMatching>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await completeReconciliation(sb, id);
    const matching = await matchAfterCompletion(sb, id);
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return { ok: true, data: matching };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 7: Each signed month matches its bank lines; a file not tied is said.** In `app/(app)/banking/reconcile/statement-actions.ts` apply these edits:

Edit 1 of 8 — find:

```ts
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import { linkImportBatchStatementFile, linkReconciliationStatementFile } from "@/lib/services/statement-files";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
```

replace with:

```ts
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { broughtForwardNote, dayBefore, type PairingOutcome } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import { tieKeptStatementFile } from "@/lib/services/statement-files";
import { matchAfterCompletion } from "@/lib/services/statement-bank-lines";
import type { BankLineMatchCounts } from "@/lib/domain/statement-bank-lines";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
```

Edit 2 of 8 — find:

```ts
  inserted: number;
  duplicates: number;
  outcome: PairingOutcome;
}

function statementFile(input: ReconciliationStatementInput): StatementFileInput {
```

replace with:

```ts
  inserted: number;
  duplicates: number;
  outcome: PairingOutcome;
  /** Said when the kept file could not be tied to the import; null when it was, or none was kept. */
  fileWarning: string | null;
}

function statementFile(input: ReconciliationStatementInput): StatementFileInput {
```

Edit 3 of 8 — find:

```ts
  };
}

/** A link the statement file could not make costs nothing done with it: the file stays in Reports › Saved. */
function warnUnlinked(err: unknown) {
  console.warn("linking the statement file failed:", err instanceof Error ? err.message : err);
}

/**
 * The statement's lines go into Bank Transactions as Import statement puts
 * them there — the same path and the same duplicate rule — and its matches are
```

replace with:

```ts
  };
}

/**
 * The statement's lines go into Bank Transactions as Import statement puts
 * them there — the same path and the same duplicate rule — and its matches are
```

Edit 4 of 8 — find:

```ts
  file: StatementFileInput,
) {
  const imported = await importStatement(sb, bankAccountId, file.fileName, file.lines);
  if (imported.batchId && file.statementFileId) {
    await linkImportBatchStatementFile(sb, imported.batchId, file.statementFileId).catch(warnUnlinked);
  }
  if (imported.inserted > 0) {
    await generateSuggestions(sb, bankAccountId).catch((err) =>
      console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
    );
  }
  return imported;
}

/**
```

replace with:

```ts
  file: StatementFileInput,
) {
  const imported = await importStatement(sb, bankAccountId, file.fileName, file.lines);
  const fileWarning =
    imported.batchId && file.statementFileId ? await tieKeptStatementFile(sb, "import", imported.batchId, file.statementFileId) : null;
  if (imported.inserted > 0) {
    await generateSuggestions(sb, bankAccountId).catch((err) =>
      console.warn("finding ledger matches after import failed:", err instanceof Error ? err.message : err),
    );
  }
  return { ...imported, fileWarning };
}

/**
```

Edit 5 of 8 — find:

```ts
    const outcome = await pairAndTick(sb, reconciliationId);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    revalidatePath("/banking");
    return { ok: true, data: { inserted: imported.inserted, duplicates: imported.skipped, outcome } };
  } catch (e) {
    if (!kept) return { ok: false, error: msg(e) };
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
```

replace with:

```ts
    const outcome = await pairAndTick(sb, reconciliationId);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    revalidatePath("/banking");
    return { ok: true, data: { inserted: imported.inserted, duplicates: imported.skipped, outcome, fileWarning: imported.fileWarning } };
  } catch (e) {
    if (!kept) return { ok: false, error: msg(e) };
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
```

Edit 6 of 8 — find:

```ts
  signed: boolean;
  /** What is left between the statement and the books; zero when signed. */
  differenceMinor: number;
}

/**
```

replace with:

```ts
  signed: boolean;
  /** What is left between the statement and the books; zero when signed. */
  differenceMinor: number;
  /** What matching the month's bank lines did once it was signed; null when it was not signed, or brought forward. */
  matched: BankLineMatchCounts | null;
  /** Why the signed month's bank lines could not be matched; the month stays signed. */
  matchError: string | null;
  /** Said when the kept file could not be tied to the import or reconciliation; null otherwise. */
  fileWarning: string | null;
}

/**
```

Edit 7 of 8 — find:

```ts
        broughtForwardNote(input.period_from, input.statement_date),
      );
      // Brought forward on the opening balance its statement prints: that file is its evidence too.
      if (input.statement_file_id) await linkReconciliationStatementFile(sb, id, input.statement_file_id).catch(warnUnlinked);
      revalidatePath("/banking/reconcile");
      return { ok: true, data: { id, signed: true, differenceMinor: 0 } };
    }
    const [{ asOf }, reconciliations] = await Promise.all([getBankingContext(sb), listReconciliations(sb, input.bank_account_id)]);
    // Newest first, as listReconciliations orders them.
```

replace with:

```ts
        broughtForwardNote(input.period_from, input.statement_date),
      );
      // Brought forward on the opening balance its statement prints: that file is its evidence too.
      const fileWarning = input.statement_file_id
        ? await tieKeptStatementFile(sb, "reconciliation", id, input.statement_file_id)
        : null;
      revalidatePath("/banking/reconcile");
      return { ok: true, data: { id, signed: true, differenceMinor: 0, matched: null, matchError: null, fileWarning } };
    }
    const [{ asOf }, reconciliations] = await Promise.all([getBankingContext(sb), listReconciliations(sb, input.bank_account_id)]);
    // Newest first, as listReconciliations orders them.
```

Edit 8 of 8 — find:

```ts
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
```

replace with:

```ts
    const file = statementFile(input);
    const id = await createReconciliationFromStatement(sb, input.bank_account_id, input.statement_date, input.closing_minor, file);
    startedId = id;
    const { fileWarning } = await importIntoBankTransactions(sb, input.bank_account_id, file);
    await pairAndTick(sb, id);
    const { differenceMinor } = await getReconciliationDetail(sb, id);
    const signed = input.sign && differenceMinor === 0;
    if (signed) await completeReconciliation(sb, id);
    const { matched, matchError } = signed ? await matchAfterCompletion(sb, id) : { matched: null, matchError: null };
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
    return { ok: true, data: { id, signed, differenceMinor, matched, matchError, fileWarning } };
  } catch (e) {
    revalidatePath("/banking/reconcile");
    revalidatePath("/banking");
```

- [ ] **Step 8: Banking › Import statement says a file not tied.** In `app/(app)/banking/actions.ts` apply these edits:

Edit 1 of 4 — find:

```ts
import { loanPaymentSchema } from "@/lib/domain/schemas";
import { codeFromSuggestions, codingSuggestions, type CodeItem, type CodeOutcome } from "@/lib/services/coding";
import { loanSuggestions, postLoanPayment } from "@/lib/services/loan-payments";
import { linkImportBatchStatementFile } from "@/lib/services/statement-files";

export interface ActionResult<T = undefined> {
  ok: boolean;
```

replace with:

```ts
import { loanPaymentSchema } from "@/lib/domain/schemas";
import { codeFromSuggestions, codingSuggestions, type CodeItem, type CodeOutcome } from "@/lib/services/coding";
import { loanSuggestions, postLoanPayment } from "@/lib/services/loan-payments";
import { tieKeptStatementFile } from "@/lib/services/statement-files";

export interface ActionResult<T = undefined> {
  ok: boolean;
```

Edit 2 of 4 — find:

```ts
  filename: string,
  rows: ImportRow[],
  statementFileId: string | null = null,
): Promise<ActionResult<{ inserted: number; skipped: number; batchId: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!rows.length) return { ok: false, error: "No rows to import" };
```

replace with:

```ts
  filename: string,
  rows: ImportRow[],
  statementFileId: string | null = null,
): Promise<ActionResult<{ inserted: number; skipped: number; batchId: string | null; fileWarning: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!rows.length) return { ok: false, error: "No rows to import" };
```

Edit 3 of 4 — find:

```ts
    const sb = await createSupabaseServerClient();
    const res = await importStatement(sb, bankAccountId, filename, rows);
    // The file the lines were read from, kept already (1.83). Linking it costs
    // nothing the import did if it fails: the file stays in Reports › Saved.
    if (res.batchId && statementFileId) {
      await linkImportBatchStatementFile(sb, res.batchId, statementFileId).catch((err) =>
        console.warn("linking the statement file to its import failed:", err instanceof Error ? err.message : err),
      );
    }
    // Review import opens next, and its first proposal is a match to what is
    // already in the books — so those are looked for now. A failure here costs
    // the match proposals, not the import.
```

replace with:

```ts
    const sb = await createSupabaseServerClient();
    const res = await importStatement(sb, bankAccountId, filename, rows);
    // The file the lines were read from, kept already (1.83). Linking it costs
    // nothing the import did if it fails: the file stays in Reports › Saved,
    // and the screen says so.
    const fileWarning = res.batchId && statementFileId ? await tieKeptStatementFile(sb, "import", res.batchId, statementFileId) : null;
    // Review import opens next, and its first proposal is a match to what is
    // already in the books — so those are looked for now. A failure here costs
    // the match proposals, not the import.
```

Edit 4 of 4 — find:

```ts
      );
    }
    revalidatePath("/banking");
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
```

replace with:

```ts
      );
    }
    revalidatePath("/banking");
    return { ok: true, data: { ...res, fileWarning } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
```

- [ ] **Step 9: Check.**

Run: `npm run typecheck`
Expected: no errors (the screens read only fields they read before; Task 5 reads the new ones).
Run: `npx eslint "app/(app)/banking/actions.ts" "app/(app)/banking/reconcile/actions.ts" "app/(app)/banking/reconcile/statement-actions.ts" lib/services/statement-files.ts lib/domain/statement-evidence.ts`
Expected: no output.
Run: `npx vitest run tests/unit/statement-evidence.test.ts tests/unit/statement-files-service.test.ts tests/unit/reconcile-statement-service.test.ts tests/unit/statement-run.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit.**

```bash
git add lib/domain/statement-evidence.ts tests/unit/statement-evidence.test.ts lib/services/statement-files.ts tests/unit/statement-files-service.test.ts "app/(app)/banking/reconcile/actions.ts" "app/(app)/banking/reconcile/statement-actions.ts" "app/(app)/banking/actions.ts"
printf 'feat(banking): completing a month matches its bank lines; a kept file not tied is said\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: The screens say what was matched, never keep spinning, and wait for the figures

**Files:**
- Create: `tests/unit/statement-screens-ui-contract.test.ts`
- Modify: `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx`
- Modify: `app/(app)/banking/BankingClient.tsx`
- Modify: `app/(app)/banking/reconcile/from-files/FromFilesClient.tsx`

**Interfaces:**
- Consumes: `completedMessage`, `bankLinesMatchedSentence`, `bankLinesNotMatchedSentence`, `addMatchCounts`, `NO_BANK_LINE_MATCHES`, `BankLineMatchCounts` (Task 2); `serverFailure` (Task 4); the action results of Task 4.

- [ ] **Step 1: The contract test first.** Create `tests/unit/statement-screens-ui-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...path: string[]) => readFileSync(join(process.cwd(), "app", "(app)", "banking", ...path), "utf8");
/** The body of `async function name(` up to the next function at the same depth. */
function handler(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = source.indexOf("\n  async function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

/**
 * What the statement screens say and do around the server (1.85): a dialog
 * never keeps spinning when the server cannot be reached, a kept file that
 * could not be tied is said, and completing a month says what was matched.
 */
describe("the statement screens", () => {
  const workspace = read("reconcile", "[id]", "ReconcileWorkspaceClient.tsx");
  const banking = read("BankingClient.tsx");
  const fromFiles = read("reconcile", "from-files", "FromFilesClient.tsx");

  it("leave the busy state of Import and Attach whatever the server does", () => {
    for (const [name, reset] of [
      ["importStatement", "setImporting(false)"],
      ["attachStatement", "setAttaching(false)"],
    ] as const) {
      const body = handler(workspace, name);
      expect(body, name).toMatch(new RegExp(`finally \\{\\s*${reset.replace(/[()]/g, "\\$&")};`));
      expect(body.split(reset).length - 1, name).toBe(1);
      expect(body, name).toContain("serverFailure(error)");
    }
    const importing = handler(banking, "confirmImport");
    expect(importing).toMatch(/finally \{\s*setBusy\(null\);/);
    expect(importing).toContain("serverFailure(error)");
  });

  it("say when a kept file could not be tied to its import or reconciliation", () => {
    expect(handler(workspace, "importStatement")).toContain("res.data.fileWarning");
    expect(handler(banking, "confirmImport")).toContain("result.data.fileWarning");
    expect(fromFiles.match(/res\.data\??\.fileWarning\) message\.warning/g)?.length).toBe(3);
  });

  it("offer Attach the statement only once the reconciliation's figures are loaded", () => {
    expect(workspace).toMatch(/disabled=\{!detail\} onClick=\{\(\) => setAttachOpen\(true\)\}/);
  });

  it("say what Complete and a run of months matched in Bank Transactions", () => {
    expect(workspace).toContain("completedMessage(r.data?.matched ?? null, r.data?.matchError ?? null)");
    expect(fromFiles).toContain("bankLinesMatchedSentence(done.matched)");
    expect(fromFiles).toContain("bankLinesNotMatchedSentence(res.data.matchError");
  });
});
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/statement-screens-ui-contract.test.ts`
Expected: FAIL — no `finally` in `importStatement`, no `disabled={!detail}`, no `completedMessage`.

- [ ] **Step 3: The reconciliation workspace.** In `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` apply these edits:

Edit 1 of 6 — find:

```tsx
} from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import { keepFailureMessage, linesSpan, statementFileMismatch } from "@/lib/domain/statement-evidence";
import { downloadSavedFile } from "@/lib/client/saved-file-download";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import { attachStatementFileAction } from "../../statement-file-actions";
```

replace with:

```tsx
} from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import { keepFailureMessage, linesSpan, serverFailure, statementFileMismatch } from "@/lib/domain/statement-evidence";
import { downloadSavedFile } from "@/lib/client/saved-file-download";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import { attachStatementFileAction } from "../../statement-file-actions";
```

Edit 2 of 6 — find:

```tsx
  setStatementEndingAction,
} from "../statement-actions";
import { addedMessage, addedNotPairedMessage, type AddMissingPlan } from "@/lib/domain/add-missing";
import AddMissingBox from "./AddMissingBox";
import type { ReconLineView, ReconDetail, ReconStatement, ReconStatementLine } from "@/lib/services/bankrec";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
```

replace with:

```tsx
  setStatementEndingAction,
} from "../statement-actions";
import { addedMessage, addedNotPairedMessage, type AddMissingPlan } from "@/lib/domain/add-missing";
import { completedMessage } from "@/lib/domain/statement-bank-lines";
import AddMissingBox from "./AddMissingBox";
import type { ReconLineView, ReconDetail, ReconStatement, ReconStatementLine } from "@/lib/services/bankrec";
import { clientTablePagination, pageSizeOptionsFor } from "@/components/ui/table-pagination";
```

Edit 3 of 6 — find:

```tsx
  const complete = async () => {
    const r = await completeReconciliationAction(reconciliationId);
    if (r.ok) {
      message.success("Reconciliation completed");
      void load();
    } else {
      message.error(r.error ?? "Failed");
```

replace with:

```tsx
  const complete = async () => {
    const r = await completeReconciliationAction(reconciliationId);
    if (r.ok) {
      const said = completedMessage(r.data?.matched ?? null, r.data?.matchError ?? null);
      if (r.data?.matchError) message.warning(said, 10);
      else message.success(said, 8);
      void load();
    } else {
      message.error(r.error ?? "Failed");
```

Edit 4 of 6 — find:

```tsx
   */
  async function importStatement(fileName: string, rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    setImporting(true);
    // Kept first, so the reconciliation takes its file with its lines (1.83);
    // a file that cannot be kept costs only the file.
    const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
      .then(({ keepStatementFile }) =>
        keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows)),
      )
      .catch((error: unknown): KeptStatementFile => ({
        ok: false,
        reason: error instanceof Error ? error.message : "the upload could not start",
      }));
    const res = await importStatementIntoReconciliationAction(reconciliationId, {
      file_name: fileName,
      opening_minor: pdf?.openingMinor ?? null,
      closing_minor: pdf?.closingMinor ?? null,
      lines: rows,
      statement_file_id: kept.ok ? kept.id : null,
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
    if (!kept.ok) message.warning(keepFailureMessage(kept.reason, "reconciliation"), 10);
    void load();
  }

  /**
```

replace with:

```tsx
   */
  async function importStatement(fileName: string, rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    setImporting(true);
    try {
      // Kept first, so the reconciliation takes its file with its lines (1.83);
      // a file that cannot be kept costs only the file.
      const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
        .then(({ keepStatementFile }) =>
          keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows)),
        )
        .catch((error: unknown): KeptStatementFile => ({
          ok: false,
          reason: error instanceof Error ? error.message : "the upload could not start",
        }));
      const res = await importStatementIntoReconciliationAction(reconciliationId, {
        file_name: fileName,
        opening_minor: pdf?.openingMinor ?? null,
        closing_minor: pdf?.closingMinor ?? null,
        lines: rows,
        statement_file_id: kept.ok ? kept.id : null,
      });
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Failed to import the statement");
        return;
      }
      setImportOpen(false);
      message.success(
        `${res.data.inserted} new in Bank Transactions, ${res.data.duplicates} already there. ${pairingMessage(res.data.outcome)}`,
        8,
      );
      if (!kept.ok) message.warning(keepFailureMessage(kept.reason, "reconciliation"), 10);
      if (res.data.fileWarning) message.warning(res.data.fileWarning, 10);
      void load();
    } catch (error) {
      message.error(`Failed to import the statement: ${serverFailure(error)}`, 10);
    } finally {
      setImporting(false);
    }
  }

  /**
```

Edit 5 of 6 — find:

```tsx
      return;
    }
    setAttaching(true);
    const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
      .then(({ keepStatementFile }) =>
        keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows)),
      )
      .catch((error: unknown): KeptStatementFile => ({
        ok: false,
        reason: error instanceof Error ? error.message : "the upload could not start",
      }));
    if (!kept.ok) {
      setAttaching(false);
      message.error(`The statement file could not be kept: ${kept.reason}.`, 10);
      return;
    }
    const res = await attachStatementFileAction({
      reconciliation_id: reconciliationId,
      file_id: kept.id,
      to: read.to,
      closing_minor: read.closingMinor,
      lines: read.lines,
    });
    setAttaching(false);
    if (!res.ok) {
      message.error(res.error ?? "Failed to attach the statement", 10);
      return;
    }
    setAttachOpen(false);
    message.success("The statement file is attached to this reconciliation.");
    void load();
  }

  async function download(id: string) {
```

replace with:

```tsx
      return;
    }
    setAttaching(true);
    try {
      const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
        .then(({ keepStatementFile }) =>
          keepStatementFile(file, fileAccount, pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows)),
        )
        .catch((error: unknown): KeptStatementFile => ({
          ok: false,
          reason: error instanceof Error ? error.message : "the upload could not start",
        }));
      if (!kept.ok) {
        message.error(`The statement file could not be kept: ${kept.reason}.`, 10);
        return;
      }
      const res = await attachStatementFileAction({
        reconciliation_id: reconciliationId,
        file_id: kept.id,
        to: read.to,
        closing_minor: read.closingMinor,
        lines: read.lines,
      });
      if (!res.ok) {
        message.error(res.error ?? "Failed to attach the statement", 10);
        return;
      }
      setAttachOpen(false);
      message.success("The statement file is attached to this reconciliation.");
      void load();
    } catch (error) {
      message.error(`Failed to attach the statement: ${serverFailure(error)}`, 10);
    } finally {
      setAttaching(false);
    }
  }

  async function download(id: string) {
```

Edit 6 of 6 — find:

```tsx
            <>
              <Typography.Text type="secondary">No statement file</Typography.Text>
              {canWrite ? (
                <Button type="link" size="small" onClick={() => setAttachOpen(true)}>
                  Attach the statement
                </Button>
              ) : null}
```

replace with:

```tsx
            <>
              <Typography.Text type="secondary">No statement file</Typography.Text>
              {canWrite ? (
                <Button type="link" size="small" disabled={!detail} onClick={() => setAttachOpen(true)}>
                  Attach the statement
                </Button>
              ) : null}
```

- [ ] **Step 4: Banking › Import statement.** In `app/(app)/banking/BankingClient.tsx` apply these edits:

Edit 1 of 2 — find:

```tsx
import SettleFromBankModal, { type SettleTarget } from "@/components/banking/SettleFromBankModal";
import type { StatementLine } from "@/lib/domain/statement-import";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import { keepFailureMessage, linesSpan, statementFileAccount } from "@/lib/domain/statement-evidence";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import { formatMoney } from "@/lib/format";
import { codableAccount, codingAccountOf, type CodingSuggestionView } from "@/lib/domain/coding";
```

replace with:

```tsx
import SettleFromBankModal, { type SettleTarget } from "@/components/banking/SettleFromBankModal";
import type { StatementLine } from "@/lib/domain/statement-import";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import { keepFailureMessage, linesSpan, serverFailure, statementFileAccount } from "@/lib/domain/statement-evidence";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import { formatMoney } from "@/lib/format";
import { codableAccount, codingAccountOf, type CodingSuggestionView } from "@/lib/domain/coding";
```

Edit 2 of 2 — find:

```tsx
  async function confirmImport(fileName: string, rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    if (!selectedId || !selected || !rows.length) return;
    setBusy("import");
    // The file is kept first, so the import can point at it (1.83). A file
    // that cannot be kept costs only the file: the lines are imported anyway.
    const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
      .then(({ keepStatementFile }) =>
        keepStatementFile(
          file,
          statementFileAccount(selected.bank_name || selected.account_name, selected.account_number_masked),
          pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows),
        ),
      )
      .catch((error: unknown): KeptStatementFile => ({
        ok: false,
        reason: error instanceof Error ? error.message : "the upload could not start",
      }));
    const result = await importStatementAction(selectedId, fileName, rows, kept.ok ? kept.id : null);
    setBusy(null);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Import failed");
      return;
    }
    message.success(
      `Imported ${result.data.inserted} line(s); ${result.data.skipped} duplicate(s) skipped`,
    );
    if (!kept.ok) message.warning(keepFailureMessage(kept.reason, "import"), 8);
    setImportOpen(false);
    setImportsKey((count) => count + 1);
    // Straight on to Review import, where every new line carries a proposal.
    if (result.data.batchId && result.data.inserted > 0) router.push(`/banking/imports/${result.data.batchId}`);
    else reload();
  }

  async function findMatches() {
```

replace with:

```tsx
  async function confirmImport(fileName: string, rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    if (!selectedId || !selected || !rows.length) return;
    setBusy("import");
    try {
      // The file is kept first, so the import can point at it (1.83). A file
      // that cannot be kept costs only the file: the lines are imported anyway.
      const kept: KeptStatementFile = await import("@/lib/client/keep-statement-file")
        .then(({ keepStatementFile }) =>
          keepStatementFile(
            file,
            statementFileAccount(selected.bank_name || selected.account_name, selected.account_number_masked),
            pdf ? { from: pdf.from, to: pdf.to } : linesSpan(rows),
          ),
        )
        .catch((error: unknown): KeptStatementFile => ({
          ok: false,
          reason: error instanceof Error ? error.message : "the upload could not start",
        }));
      const result = await importStatementAction(selectedId, fileName, rows, kept.ok ? kept.id : null);
      if (!result.ok || !result.data) {
        message.error(result.error ?? "Import failed");
        return;
      }
      message.success(
        `Imported ${result.data.inserted} line(s); ${result.data.skipped} duplicate(s) skipped`,
      );
      if (!kept.ok) message.warning(keepFailureMessage(kept.reason, "import"), 8);
      if (result.data.fileWarning) message.warning(result.data.fileWarning, 10);
      setImportOpen(false);
      setImportsKey((count) => count + 1);
      // Straight on to Review import, where every new line carries a proposal.
      if (result.data.batchId && result.data.inserted > 0) router.push(`/banking/imports/${result.data.batchId}`);
      else reload();
    } catch (error) {
      message.error(`Import failed: ${serverFailure(error)}`, 10);
    } finally {
      setBusy(null);
    }
  }

  async function findMatches() {
```

- [ ] **Step 5: From statement files.** In `app/(app)/banking/reconcile/from-files/FromFilesClient.tsx` apply these edits:

Edit 1 of 7 — find:

```tsx
} from "@/lib/domain/statement-run";
import { formatMoney } from "@/lib/format";
import { keepFailureMessage, statementFileSpan } from "@/lib/domain/statement-evidence";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import { previewRunAction, reconcileRunMonthAction } from "../statement-actions";
import StandingTag from "../StandingTag";
```

replace with:

```tsx
} from "@/lib/domain/statement-run";
import { formatMoney } from "@/lib/format";
import { keepFailureMessage, statementFileSpan } from "@/lib/domain/statement-evidence";
import {
  NO_BANK_LINE_MATCHES,
  addMatchCounts,
  bankLinesMatchedSentence,
  bankLinesNotMatchedSentence,
  type BankLineMatchCounts,
} from "@/lib/domain/statement-bank-lines";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import { previewRunAction, reconcileRunMonthAction } from "../statement-actions";
import StandingTag from "../StandingTag";
```

Edit 2 of 7 — find:

```tsx
  error: string | null;
  /** The account's earlier lines were brought forward before any month. */
  broughtForward: boolean;
}

/** What was done before a run stopped on an error, said after the error. */
```

replace with:

```tsx
  error: string | null;
  /** The account's earlier lines were brought forward before any month. */
  broughtForward: boolean;
  /** What matching the signed months' bank lines did (1.85). */
  matched: BankLineMatchCounts;
  /** A sentence for each signed month whose bank lines could not be matched. */
  unmatched: string[];
}

/** What matching the signed months' bank lines said, after the run's own summary. */
function matchedSaid(done: Done): string | null {
  return [bankLinesMatchedSentence(done.matched), ...done.unmatched].filter(Boolean).join(" ") || null;
}

/** What was done before a run stopped on an error, said after the error. */
```

Edit 3 of 7 — find:

```tsx
    let step = 0;
    let signed = 0;
    let broughtForward = false;
    const finish = (result: Done) => {
      setProgress(null);
      setDone(result);
      setPreview(null);
      if (result.error === null && result.open === null) {
        // Every month is signed: the table would only say "Already signed off".
```

replace with:

```tsx
    let step = 0;
    let signed = 0;
    let broughtForward = false;
    let matched: BankLineMatchCounts = NO_BANK_LINE_MATCHES;
    const unmatched: string[] = [];
    const finish = (result: Pick<Done, "open" | "error">) => {
      setProgress(null);
      setDone({ ...result, signed, broughtForward, matched, unmatched });
      setPreview(null);
      if (result.error === null && result.open === null) {
        // Every month is signed: the table would only say "Already signed off".
```

Edit 4 of 7 — find:

```tsx
        opening_minor: first.openingMinor,
        statement_file_id: fileIdOf.get(first.key) ?? null,
      });
      if (!res.ok) return finish({ signed, open: null, error: res.error ?? "The earlier lines could not be brought forward", broughtForward });
      broughtForward = true;
    }
    for (const month of toSign) {
      const statement = previewedByKey.get(month.key);
```

replace with:

```tsx
        opening_minor: first.openingMinor,
        statement_file_id: fileIdOf.get(first.key) ?? null,
      });
      if (!res.ok) return finish({ open: null, error: res.error ?? "The earlier lines could not be brought forward" });
      broughtForward = true;
      if (res.data?.fileWarning) message.warning(res.data.fileWarning, 10);
    }
    for (const month of toSign) {
      const statement = previewedByKey.get(month.key);
```

Edit 5 of 7 — find:

```tsx
        statement_file_id: fileIdOf.get(statement.key) ?? null,
        sign: true,
      });
      if (!res.ok || !res.data) return finish({ signed, open: null, error: res.error ?? "A month could not be signed off", broughtForward });
      if (!res.data.signed) {
        return finish({
          signed,
          open: {
            id: res.data.id,
            date: month.statementDate,
            sentence: `The books changed since the preview: this month is now out by ${money(Math.abs(res.data.differenceMinor))}.`,
          },
          error: null,
          broughtForward,
        });
      }
      signed += 1;
    }
    let open: Done["open"] = null;
    const statement = statementOfNeedsLook;
```

replace with:

```tsx
        statement_file_id: fileIdOf.get(statement.key) ?? null,
        sign: true,
      });
      if (!res.ok || !res.data) return finish({ open: null, error: res.error ?? "A month could not be signed off" });
      if (res.data.fileWarning) message.warning(res.data.fileWarning, 10);
      if (!res.data.signed) {
        return finish({
          open: {
            id: res.data.id,
            date: month.statementDate,
            sentence: `The books changed since the preview: this month is now out by ${money(Math.abs(res.data.differenceMinor))}.`,
          },
          error: null,
        });
      }
      signed += 1;
      if (res.data.matched) matched = addMatchCounts(matched, res.data.matched);
      if (res.data.matchError) unmatched.push(bankLinesNotMatchedSentence(res.data.matchError, shortDate(month.statementDate, true)));
    }
    let open: Done["open"] = null;
    const statement = statementOfNeedsLook;
```

Edit 6 of 7 — find:

```tsx
        sign: false,
      });
      if (!res.ok || !res.data) {
        return finish({ signed, open: null, error: res.error ?? "The month that needs a look could not be started", broughtForward });
      }
      open = { id: res.data.id, date: needsLook.statementDate, sentence: monthSentence(needsLook.outcome, money) };
    }
    finish({ signed, open, error: null, broughtForward });
  }

  return (
```

replace with:

```tsx
        sign: false,
      });
      if (!res.ok || !res.data) {
        return finish({ open: null, error: res.error ?? "The month that needs a look could not be started" });
      }
      if (res.data.fileWarning) message.warning(res.data.fileWarning, 10);
      open = { id: res.data.id, date: needsLook.statementDate, sentence: monthSentence(needsLook.outcome, money) };
    }
    finish({ open, error: null });
  }

  return (
```

Edit 7 of 7 — find:

```tsx
            done.open ? (
              <span>
                {done.broughtForward ? "The earlier lines were brought forward. " : ""}
                {done.open.sentence.replace(/\.?$/, ".")} The reconciliation to {shortDate(done.open.date, true)} is started, with its pairs ticked.{" "}
                <Link href={`/banking/reconcile/${done.open.id}`}>Open it</Link>
              </span>
            ) : done.error ? (
              before(done)
            ) : done.broughtForward ? (
              "The earlier lines were brought forward first."
            ) : null
          }
        />
      ) : null}
```

replace with:

```tsx
            done.open ? (
              <span>
                {done.broughtForward ? "The earlier lines were brought forward. " : ""}
                {matchedSaid(done) ? `${matchedSaid(done)} ` : ""}
                {done.open.sentence.replace(/\.?$/, ".")} The reconciliation to {shortDate(done.open.date, true)} is started, with its pairs ticked.{" "}
                <Link href={`/banking/reconcile/${done.open.id}`}>Open it</Link>
              </span>
            ) : done.error ? (
              [before(done), matchedSaid(done)].filter(Boolean).join(" ") || null
            ) : (
              [done.broughtForward ? "The earlier lines were brought forward first." : null, matchedSaid(done)].filter(Boolean).join(" ") || null
            )
          }
        />
      ) : null}
```

- [ ] **Step 6: Run and check.**

Run: `npx vitest run tests/unit/statement-screens-ui-contract.test.ts tests/unit/table-adoption.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx" "app/(app)/banking/BankingClient.tsx" "app/(app)/banking/reconcile/from-files/FromFilesClient.tsx"`
Expected: no output.

- [ ] **Step 7: Commit.**

```bash
git add tests/unit/statement-screens-ui-contract.test.ts "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx" "app/(app)/banking/BankingClient.tsx" "app/(app)/banking/reconcile/from-files/FromFilesClient.tsx"
printf 'feat(banking): say what completing matched; dialogs never keep spinning\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: A recoded line's Category cell offers only Undo recode

**Files:**
- Create: `app/(app)/banking/RecodedCategory.tsx`
- Modify: `app/(app)/banking/CategoriseCell.tsx`
- Modify: `tests/unit/bank-categories-ui-contract.test.ts`

**Interfaces:**
- Consumes: `BankRecodeRow` from `lib/services/banking.ts` (`account_code`, `account_name`, `entry_number` — the recode entry's number).
- Produces: `RecodedCategory({ recode: BankRecodeRow; entryNumber: string | null; onUndo: (() => void) | null; undoing: boolean; onCreateRule: (() => void) | null })` — default export.

- [ ] **Step 1: The contract test first.** In `tests/unit/bank-categories-ui-contract.test.ts` apply this edit:

Edit 1 of 1 — find:

```ts
 * not categorise a transaction. These assertions pin the replacement.
 */
describe("the banking category column", () => {
  it("puts the control in its own component, and posting is what it does", () => {
    const cell = read("CategoriseCell.tsx");
    expect(cell).toContain("categoriseBankTransactionAction");
```

replace with:

```ts
 * not categorise a transaction. These assertions pin the replacement.
 */
describe("the banking category column", () => {
  it("offers a recoded line Undo recode and Create rule, never Change", () => {
    // Change voids the entry under the recode, and sat beside Undo recode
    // where it was pressed by mistake. A recoded line is taken back first (1.85).
    const cell = read("CategoriseCell.tsx");
    const start = cell.indexOf("if (posting && recode) {");
    const end = cell.indexOf("if (posting) {", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(cell.slice(start, end)).toContain("<RecodedCategory");
    const recoded = read("RecodedCategory.tsx");
    expect(recoded).toContain("Recoded from Uncategorized");
    expect(recoded).toContain("` → ${recode.entry_number}`");
    expect(recoded).toContain("Undo recode");
    expect(recoded).toContain("Create rule");
    expect(recoded).not.toMatch(/^\s*Change\s*$/m);
    expect(recoded).not.toContain("uncategoriseBankTransactionAction");
  });

  it("puts the control in its own component, and posting is what it does", () => {
    const cell = read("CategoriseCell.tsx");
    expect(cell).toContain("categoriseBankTransactionAction");
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/bank-categories-ui-contract.test.ts`
Expected: FAIL — `if (posting && recode) {` is not in `CategoriseCell.tsx`.

- [ ] **Step 3: The recoded cell.** Create `app/(app)/banking/RecodedCategory.tsx`:

```tsx
"use client";
import { Button, Space, Typography } from "antd";
import type { BankRecodeRow } from "@/lib/services/banking";

const linkStyle = { padding: 0, height: "auto", fontSize: 12 } as const;
const small = { fontSize: 12 } as const;

/**
 * The Category cell of a line recoded out of Uncategorized (1.85): where its
 * money went, then the entry that put it in Uncategorized and the recode that
 * moved it out. Undo recode is the only way back. Voiding the first entry is
 * not offered under a recode: it sat beside Undo recode and was pressed by
 * mistake.
 */
export default function RecodedCategory({
  recode,
  entryNumber,
  onUndo,
  undoing,
  onCreateRule,
}: {
  recode: BankRecodeRow;
  /** The bank line's own entry, the one that put it in Uncategorized. */
  entryNumber: string | null;
  /** Null when this person may not take the recode back. */
  onUndo: (() => void) | null;
  undoing: boolean;
  /** Null when this person may not make a rule. */
  onCreateRule: (() => void) | null;
}) {
  const account = `${recode.account_code} — ${recode.account_name}`;
  return (
    <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
      <Typography.Text ellipsis={{ tooltip: account }}>{account}</Typography.Text>
      <Typography.Text type="secondary" style={small}>
        Recoded from Uncategorized
      </Typography.Text>
      <Typography.Text type="secondary" style={small}>
        {entryNumber ?? "posted"}
        {recode.entry_number ? ` → ${recode.entry_number}` : ""}
      </Typography.Text>
      {onUndo || onCreateRule ? (
        <Space size={4} wrap>
          {onUndo ? (
            <Button type="link" size="small" style={linkStyle} loading={undoing} onClick={onUndo}>
              Undo recode
            </Button>
          ) : null}
          {onUndo && onCreateRule ? (
            <Typography.Text type="secondary" style={small}>
              ·
            </Typography.Text>
          ) : null}
          {onCreateRule ? (
            <Button type="link" size="small" style={linkStyle} onClick={onCreateRule}>
              Create rule
            </Button>
          ) : null}
        </Space>
      ) : null}
    </Space>
  );
}
```

- [ ] **Step 4: Use it.** In `app/(app)/banking/CategoriseCell.tsx` apply these edits:

Edit 1 of 5 — find:

```tsx
import { isHoldingDetail } from "@/lib/domain/uncategorized";
import { formatMoney } from "@/lib/format";
import type { BankPostingRow, BankRecodeRow } from "@/lib/services/banking";
import LoanSplitModal from "./LoanSplitModal";
import {
  categoriseBankTransactionAction,
```

replace with:

```tsx
import { isHoldingDetail } from "@/lib/domain/uncategorized";
import { formatMoney } from "@/lib/format";
import type { BankPostingRow, BankRecodeRow } from "@/lib/services/banking";
import RecodedCategory from "./RecodedCategory";
import LoanSplitModal from "./LoanSplitModal";
import {
  categoriseBankTransactionAction,
```

Edit 2 of 5 — find:

```tsx
    </div>
  ) : null;

  if (posting) {
    // A recoded line shows where its money went; the entry that put it in
    // Uncategorized stays as it was, under the recode.
    const main = recode ? `${recode.account_code} — ${recode.account_name}` : `${posting.account_code} — ${posting.account_name}`;
    const others = recode ? [] : (posting.others ?? []);
    const everyAccount = [main, ...others].join("; ");
    const mayChange = canWrite && posting.own_entry;
    return (
```

replace with:

```tsx
    </div>
  ) : null;

  if (posting && recode) {
    return (
      <RecodedCategory
        recode={recode}
        entryNumber={posting.entry_number}
        onUndo={canWrite && posting.own_entry ? () => void takeRecodeBack() : null}
        undoing={busy}
        onCreateRule={canWrite && onCreateRule ? onCreateRule : null}
      />
    );
  }

  if (posting) {
    const main = `${posting.account_code} — ${posting.account_name}`;
    const others = posting.others ?? [];
    const everyAccount = [main, ...others].join("; ");
    const mayChange = canWrite && posting.own_entry;
    return (
```

Edit 3 of 5 — find:

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
```

replace with:

```tsx
            </Typography.Text>
          </Tooltip>
        ) : null}
        {holding ? (
          <div>
            <Tag color="gold">needs coding</Tag>
          </div>
```

Edit 4 of 5 — find:

```tsx
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
```

replace with:

```tsx
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {posting.entry_number ?? "posted"}
          </Typography.Text>
          {mayChange && holding ? (
            <Button type="link" size="small" style={linkStyle} disabled={busy} onClick={() => setRecoding((open) => !open)}>
              Recode
            </Button>
          ) : null}
          {mayChange ? (
            <Button
              type="link"
```

Edit 5 of 5 — find:

```tsx
            </Button>
          ) : null}
        </Space>
        {recoding && !recode ? (
          <Tooltip title="Choosing an account posts a second entry that moves this line out of Uncategorized">
            {accountSelect(recodeOptions, "Recode to…", (accountId) => void recodeTo(accountId))}
          </Tooltip>
```

replace with:

```tsx
            </Button>
          ) : null}
        </Space>
        {recoding ? (
          <Tooltip title="Choosing an account posts a second entry that moves this line out of Uncategorized">
            {accountSelect(recodeOptions, "Recode to…", (accountId) => void recodeTo(accountId))}
          </Tooltip>
```

- [ ] **Step 5: Run and check.**

Run: `npx vitest run tests/unit/bank-categories-ui-contract.test.ts`
Expected: PASS — including "keeps every banking component under the 400-line ceiling".
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add "app/(app)/banking/RecodedCategory.tsx" "app/(app)/banking/CategoriseCell.tsx" tests/unit/bank-categories-ui-contract.test.ts
printf 'feat(banking): a recoded line offers Undo recode, not Change\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 7: The once-off for the months already signed; changelog 1.85; the guide; the whole suite

**Files:**
- Create: `tests/live/match-signed-months.live.ts`
- Modify: `vitest.live.config.ts` (its comment)
- Modify: `lib/domain/changelog.ts` (a new first entry of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (three reconciliation steps)

**Interfaces:**
- Consumes: `reconciledPairsOf`, `matchCountsOf` (Task 3); `NO_BANK_LINE_MATCHES`, `addMatchCounts` (Task 2); `planCompanySchema` from `lib/domain/schema-template.ts`.

- [ ] **Step 1: The once-off.** Create `tests/live/match-signed-months.live.ts`:

```ts
/**
 * Once, for 1.85: the bank lines of the months signed off before 1.85 are
 * matched in Bank Transactions, as Complete matches them from 1.85 on.
 *
 * For every company, every completed reconciliation that keeps statement lines
 * is paired by the same service Complete uses (lib/services/statement-bank-lines),
 * read with the service role, and handed to acc_match_reconciled_bank_lines as
 * the company's first active administrator — one transaction per company.
 *
 *   ONEBOOK_MATCH_SIGNED_MONTHS=dry    every call is made, then rolled back; it
 *                                      prints what would be matched and left. When
 *                                      0136 is not live yet it is applied inside
 *                                      that transaction and rolled back with it.
 *   ONEBOOK_MATCH_SIGNED_MONTHS=apply  the same, committed. Refused unless 0136 is live.
 *
 * Without the variable the file does nothing, so a run of the live checks never writes.
 *
 * Run (--silent=false shows what it did, line by line):
 *   ONEBOOK_MATCH_SIGNED_MONTHS=dry node --env-file=.env.local ./node_modules/vitest/vitest.mjs run
 *     --config vitest.live.config.ts --silent=false --reporter=verbose tests/live/match-signed-months.live.ts
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { describe, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";
import { NO_BANK_LINE_MATCHES, addMatchCounts, type BankLineMatchCounts } from "@/lib/domain/statement-bank-lines";
import { matchCountsOf, reconciledPairsOf } from "@/lib/services/statement-bank-lines";

const MODE = process.env.ONEBOOK_MATCH_SIGNED_MONTHS;
const FILE = "0136_match_reconciled_bank_lines.sql";

describe.skipIf(MODE !== "dry" && MODE !== "apply")("matching the bank lines of the months already signed off", () => {
  it(`${MODE === "apply" ? "matches" : "counts, without keeping anything,"} every company's signed months`, async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { persistSession: false };
    const control = createClient(url, serviceKey, { auth });
    const { data: companies, error } = await control
      .schema("onebook")
      .from("company")
      .select("schema_name,is_sample")
      .eq("status", "active")
      .order("display_order")
      .order("schema_name");
    if (error) throw new Error(`companies: ${error.message}`);

    const migration = readFileSync(new URL(`../../supabase/migrations/${FILE}`, import.meta.url), "utf8");
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    let total: BankLineMatchCounts = NO_BANK_LINE_MATCHES;
    try {
      for (const { schema_name: schema, is_sample } of companies ?? []) {
        const sb = createClient(url, serviceKey, { auth, db: { schema } }) as unknown as SupabaseClient;
        await client.query("begin");
        try {
          await client.query("set local lock_timeout = '5s'");
          await client.query(`set local search_path = ${schema}, extensions`);
          const live = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount! > 0;
          if (!live) {
            if (MODE === "apply") throw new Error(`${schema}: 0136 is not live; apply the migration first`);
            const statements = schema === "public" ? [migration] : planCompanySchema([{ file: FILE, sql: migration }], schema).statements;
            for (const statement of statements) await client.query(statement);
          }
          const { rows: recs } = await client.query<{ id: string; ending: string; bank: string }>(
            `select r.id, r.statement_ending_date::text as ending, g.account_code || ' ' || a.bank_name as bank
               from acc_statement_reconciliation r
               join acc_bank_account a on a.id = r.bank_account_id
               join acc_account g on g.id = a.account_id
              where r.status = 'completed'
                and exists (select 1 from acc_reconciliation_statement_line l where l.reconciliation_id = r.id)
              order by g.account_code, r.statement_ending_date`,
          );
          const label = `${schema.padEnd(14)} ${is_sample ? "sample" : "REAL  "}`;
          if (!recs.length) {
            console.log(`${label} no signed month keeps a statement`);
            await client.query("rollback");
            continue;
          }
          const admin = (await client.query<{ id: string }>(
            `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
          )).rows[0];
          if (!admin) throw new Error(`${schema}: no active administrator to match as`);
          await client.query("set local role authenticated");
          await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);

          let company: BankLineMatchCounts = NO_BANK_LINE_MATCHES;
          for (const rec of recs) {
            const pairs = await reconciledPairsOf(sb, rec.id);
            const counts = pairs.length
              ? matchCountsOf((await client.query(`select acc_match_reconciled_bank_lines($1, $2::jsonb) as out`, [
                  rec.id,
                  JSON.stringify(pairs.map((p) => ({ bank_transaction_id: p.bankTransactionId, journal_line_id: p.journalLineId }))),
                ])).rows[0].out)
              : NO_BANK_LINE_MATCHES;
            console.log(`${label}   ${rec.bank} to ${rec.ending}: ${pairs.length} pairs → ${JSON.stringify(counts)}`);
            company = addMatchCounts(company, counts);
          }
          console.log(`${label} ${recs.length} signed months → ${JSON.stringify(company)}`);
          total = addMatchCounts(total, company);
          await client.query(MODE === "apply" ? "commit" : "rollback");
        } catch (e) {
          await client.query("rollback");
          throw e;
        }
      }
    } finally {
      await client.end();
    }
    console.log(`${MODE === "apply" ? "MATCHED" : "DRY RUN, nothing kept"}: ${JSON.stringify(total)}`);
  });
});
```

In `vitest.live.config.ts` apply this edit:

Edit 1 of 1 — find:

```ts

/**
 * Read-only checks against the live books (tests/live). Never part of `npm test`:
 * they need `.env.local`, sign in as the smoke user, and take minutes.
 */
export default defineConfig({
  resolve: {
```

replace with:

```ts

/**
 * Read-only checks against the live books (tests/live). Never part of `npm test`:
 * they need `.env.local`, sign in as the smoke user, and take minutes. The one
 * file that can write, match-signed-months, does nothing unless asked by name.
 */
export default defineConfig({
  resolve: {
```

- [ ] **Step 2: Run it as a dry run — nothing is kept.**

Run: `ONEBOOK_MATCH_SIGNED_MONTHS=dry node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts --silent=false --reporter=verbose tests/live/match-signed-months.live.ts`
Expected: 1 test passed; a line per company (`no signed month keeps a statement` for every company but `co_pc`); `co_pc` lists its signed months and ends `19 signed months → {"matched":45,"already":2,"elsewhere":0,"ignored":0,"differs":0}` (the numbers are today's — report what it prints); the last line starts `DRY RUN, nothing kept`. Never run it with `apply`: that is the controller's, after the user approves (Task 8).
Run: `node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/match-signed-months.live.ts`
Expected: the test is skipped (no variable, nothing runs).

- [ ] **Step 3: The release.** In `lib/domain/changelog.ts` apply this edit:

Edit 1 of 1 — find:

```ts

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.84",
    date: "2026-10-07",
```

replace with:

```ts

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.85",
    date: "2026-10-07",
    headline: "Bank lines reconciled from a statement are matched in Bank Transactions when the month is signed off.",
    changes: [
      {
        kind: "fixed",
        title: "Reconciled bank lines no longer wait for review",
        detail:
          "A statement imported into a reconciliation, or through From statement files, put its lines in Bank Transactions and ticked the book lines they paired with — but never matched the two, so every line of a signed-off month still showed For review with Approve and Reject. Now Complete, and each month From statement files signs, matches each bank line to the book line its statement line paired with, and says how many. A bank line already matched to another entry, ignored, or of the opposite sign to the books is left as it was, and the message says how many to check. The months signed off before this release were matched once in the same way, so their bank lines now show as matched in Bank Transactions instead of For review; no figure in the books changes.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "A recoded line's Category is easier to read",
        detail:
          "The Category cell of a line recoded out of Uncategorized now shows the account, then Recoded from Uncategorized, then the line's own entry and the recode entry (JE-… → JE-…), with Undo recode and Create rule. Change is no longer offered on a recoded line: it sat beside Undo recode and voided the line's own entry when pressed by mistake. To code a recoded line again, Undo recode first.",
        route: "/banking",
      },
      {
        kind: "fixed",
        title: "A statement file that cannot be tied to its import says so",
        detail:
          "When a kept statement file could not be tied to its import, or to a reconciliation brought forward from it, only the server's log knew. The screen now says so, and where the file is: in Reports › Saved, or to be attached on the reconciliation.",
        route: "/banking",
      },
      {
        kind: "fixed",
        title: "Attach the statement: a clearer message, and no stuck dialogs",
        detail:
          "When the file chosen has a different number of lines, the message now reads \"This reconciliation kept N lines from <first day> to <statement date>; this file has M lines in those days.\" Attach the statement waits until the reconciliation's figures have loaded, and the Attach and Import dialogs stop spinning and say why when the server cannot be reached.",
        route: "/banking/reconcile",
      },
    ],
  },
  {
    version: "1.84",
    date: "2026-10-07",
```

- [ ] **Step 4: The guide.** In `lib/domain/system-guide.ts` apply these edits:

Edit 1 of 3 — find:

```ts
        route: "/banking/reconcile",
        note:
          "Completing a session requires either zero unexplained difference or an " +
          "adjustment somebody signs for.",
      },
      {
        action: "Reconcile from the statement files, one month or a year",
```

replace with:

```ts
        route: "/banking/reconcile",
        note:
          "Completing a session requires either zero unexplained difference or an " +
          "adjustment somebody signs for. Complete then matches, in Bank Transactions, each bank line to the " +
          "book line its statement line paired with; a bank line already matched to another entry, ignored, or " +
          "of the opposite sign is left as it was, and the message says how many to check there.",
      },
      {
        action: "Reconcile from the statement files, one month or a year",
```

Edit 2 of 3 — find:

```ts
          "number, or by amount within 5 days — up to the first that does not agree, and writes nothing. Sign off " +
          "signs the months that agree; the first that does not is started, with its pairs ticked, for you to " +
          "finish. On an account never reconciled, the earlier lines are brought forward first when the books " +
          "agree with the first statement's opening balance.",
      },
      {
        action: "Add what the statement has and the books do not",
```

replace with:

```ts
          "number, or by amount within 5 days — up to the first that does not agree, and writes nothing. Sign off " +
          "signs the months that agree; the first that does not is started, with its pairs ticked, for you to " +
          "finish. On an account never reconciled, the earlier lines are brought forward first when the books " +
          "agree with the first statement's opening balance. Each month signed matches its bank lines in Bank " +
          "Transactions, as Complete does.",
      },
      {
        action: "Add what the statement has and the books do not",
```

Edit 3 of 3 — find:

```ts
          "In Bank Transactions, Needs coding in the posted-to filter lists the lines still in Uncategorized. Recode posts a " +
          "second entry, the same day, that moves the amount to the account you choose; the line's own entry, and " +
          "any reconciliation it is in, stay as they were. Undo recode takes it back, in a signed-off month too. A line in a signed-off month " +
          "cannot be taken back with Change — recode it instead.",
      },
      {
        action: "View the statement file",
```

replace with:

```ts
          "In Bank Transactions, Needs coding in the posted-to filter lists the lines still in Uncategorized. Recode posts a " +
          "second entry, the same day, that moves the amount to the account you choose; the line's own entry, and " +
          "any reconciliation it is in, stay as they were. Undo recode takes it back, in a signed-off month too. A line in a signed-off month " +
          "cannot be taken back with Change — recode it instead. A recoded line offers Undo recode, not Change: to code it " +
          "again, Undo recode first.",
      },
      {
        action: "View the statement file",
```

- [ ] **Step 5: The whole suite and the build.**

Run: `npm run typecheck`, `npm run lint`, then `npm test`
Expected: no type errors; lint 0 errors (old warnings stay); every test file passes — the changelog and guide tests included (`APP_VERSION` is now 1.85, every route the release names exists). `tests/unit/quality-query-timing.test.ts` can fail when the machine is busy; if it alone fails, run it on its own and report both results.
Run: `npm run build` — Expected: `Compiled successfully`, exit code 0.
Run: `npm run quality:bundle`, then `npm run quality:budget` — Expected: `11 within budget, 0 over`, exit code 0.

- [ ] **Step 6: Commit.**

```bash
git add tests/live/match-signed-months.live.ts vitest.live.config.ts lib/domain/changelog.ts lib/domain/system-guide.ts
printf 'docs(changelog): 1.85 match reconciled bank lines; a tidier recoded line; four small fixes\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 8: Live (controller)

No new code. Every step that writes to the live database waits for the user.

- [ ] **Step 1:** Ask the user to approve applying 0136 to every company. Only then run `node --env-file=.env.local scripts/migrate.mjs`, run `scripts/verify-reconciled-bank-lines.mjs` again (rolled back) and `npm run verify:company-provisioning`.
- [ ] **Step 2:** Run the once-off as a dry run again (Task 7, Step 2) and show the user what it would match. Only after the user approves, run it with `ONEBOOK_MATCH_SIGNED_MONTHS=apply`; then run the dry run once more — expected `"matched":0` everywhere.
- [ ] **Step 3:** On the sample company PC-Test only, with invented statements: a month imported into a reconciliation and completed → the message names the bank lines matched, and Bank Transactions shows them matched, not For review; a run of two months through From statement files → the summary adds the bank lines matched; a recoded line's Category cell (four lines, Undo recode · Create rule, no Change); Attach the statement disabled until the figures load.
- [ ] **Step 4:** Screenshots of each, light and dark, scrolled to the top before each full-page shot; an approval page beside them. Nothing is pushed until the user approves.
- [ ] **Step 5:** Ask the user whether what the check recorded on PC-Test stays as the sample company's history.
