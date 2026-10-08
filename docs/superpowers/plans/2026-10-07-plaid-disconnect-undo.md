# Disconnect a bank feed; undo a bank-feed sync (1.86) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Plaid bank connection can be disconnected (removed at Plaid first, its account free to connect again), and one bank-feed sync at a time can be undone (the lines it added removed, the lines it retired restored), with both offered on Banking.

**Architecture:** Migration 0137 records what each sync does in a new table `acc_bank_feed_sync_change` (written by `acc_apply_bank_feed_page`, which now takes the run id), and adds `acc_undo_bank_feed_sync`, `acc_bank_feed_syncs` (the list, with whether each sync can be undone) and `acc_disconnect_bank_connection`; a sync that ends after a disconnect leaves the connection disconnected. A server service removes the connection at Plaid (`/item/remove`) before disconnecting, and refuses when Plaid does not confirm unless the person chose "Disconnect in OneBook only". Banking gets a Disconnect button on the connection card and a Bank feed syncs list with Undo.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Ant Design 6, Supabase Postgres (one schema per company), Plaid API, Vitest.

Spec: `docs/superpowers/specs/2026-10-07-plaid-disconnect-undo-design.md`.

## Global Constraints

- US English UI. Version **1.86** (1.85 is on main); migration **0137**.
- **Undo removes for good.** The sync cursor is not rewound: the next sync does not bring undone lines back. To fetch them again, disconnect and connect again.
- **Only a person's decision locks an undo:** a sync cannot be undone while a line it added (and still active) is not `unmatched` or has an approved match. Unapproved suggestions are removed with their lines. The statement-import undo (0109) is unchanged.
- **Syncs are undone newest first:** only a connection's newest sync that changed something, is not undone, and is not followed by a running sync can be undone. A sync that changed nothing has nothing to undo.
- **Disconnect removes the connection at Plaid first.** Plaid answering `ITEM_NOT_FOUND` or `INVALID_ACCESS_TOKEN` counts as removed. When Plaid cannot be reached, answers another error, OneBook has no Plaid keys, or the token cannot be read, nothing changes and the screen says "Plaid did not confirm the removal: <reason>. Try again, or tick Disconnect in OneBook only." — unless the person ticked **Disconnect in OneBook only**; then the connection is disconnected with the note "Disconnected in OneBook only: Plaid did not confirm the removal (<reason>)".
- Disconnecting deletes the encrypted token, sets the connection's feed accounts inactive and keeps every bank line. The bank account can be connected again (one active mapping per bank account). A sync that ends after the disconnect leaves the connection disconnected and its note kept.
- Both Disconnect and Undo need `bank_feed.manage` and a reason; both write an audit line.
- No real bank, account number or figure in the repository: fixtures are invented. Plaid is never called by a test.
- Migration 0137 is **not applied to the live database by any task**. The verify script applies it inside a transaction that is always rolled back. It goes live only after the user approves, in Task 6, by the controller — and before this code is deployed (the code calls the new functions, and the sync passes the run id to the page function 0137 replaces).
- Documents & Attachments stays paused and untouched.
- Run everything from `ctyhp-accounting/`. Never pipe test output through `head`/`tail`; read the pass/fail lines.
- Write every file with the Write or Edit tool — never a bash heredoc, `echo` or `python -c`, which eat backslashes and quotes. Write paths exactly as given — never with backslash escapes such as `\(` (on Windows they create stray directories such as `app/(app`).
- A `"use server"` file exports only async functions and types.
- New tables use `components/ui/DataTable` (enforced by `tests/unit/table-adoption.test.ts`).
- Stage files by name; never `git add -A`. Write commit messages with `printf` in Git Bash to `../.superpowers/sdd/commit-msg.txt` (never PowerShell — it writes a BOM), check with `od -c ../.superpowers/sdd/commit-msg.txt | head -1` that the first bytes are not `357 273 277`, then `git commit -F ../.superpowers/sdd/commit-msg.txt`. No Co-Authored-By trailer. After each task, `git status --short --untracked-files=all` (from the repository root) shows no file the task did not name, and `ls -b app` shows no stray directory.

Every file below was run before this plan was written: the migration through its verify script on all six companies (260 passed, 0 failed, rolled back); the unit tests; `tsc --noEmit`, `eslint`, the whole unit suite (292 files, 3,131 tests), `next build` and the bundle budget (11 within budget) with every task's files in place.

Clarification of spec §4 taken while building: the list `acc_bank_feed_syncs` leaves out a sync that succeeded and changed nothing, so the daily sync does not bury the ones that matter; a failed or running sync is always listed. Syncs begin at `clock_timestamp()` (0137 redefines `acc_begin_bank_feed_sync`), so two syncs started in one transaction still have an order.

Where a step says "apply these edits", each edit is a find/replace: find the exact text (it occurs once), replace it with the text given. The edits were worked out from the checked files and proved by applying them to the file as it is on the branch.

---

### Task 1: Migration 0137, its verification, and the export of the new table

**Files:**
- Create: `supabase/migrations/0137_bank_feed_disconnect_undo.sql`
- Create: `scripts/verify-bank-feed-undo.mjs`
- Create: `tests/unit/bank-feed-undo-migration.test.ts`
- Modify: `lib/domain/company-export.ts` (the new table joins `EXPORT_TABLES`)

**Interfaces:**
- Produces (SQL, every company schema):
  - table `acc_bank_feed_sync_change (id, run_id, bank_transaction_id, kind 'added'|'retired', prior_status acc_bank_txn_status, created_at)`; signed-in users read it, only the functions write it;
  - `acc_bank_feed_sync_run.status` also `undone`, with `undone_by`, `undone_at`, `undo_reason`;
  - `acc_apply_bank_feed_page(p_connection_id uuid, p_run_id uuid, p_added jsonb, p_modified jsonb, p_removed jsonb) returns jsonb` — replaces the four-argument version; refuses a run not running for that connection, or a disconnected connection;
  - `acc_begin_bank_feed_sync(uuid)` begins at `clock_timestamp()`; `acc_finish_bank_feed_sync(...)` leaves a disconnected connection disconnected;
  - `acc_bank_feed_syncs(p_bank_account_id uuid)` → `run_id, connection_id, institution_name, connection_status, status, started_at, completed_at, added_count, modified_count, removed_count, error_message, undone_at, undo_reason, changes, is_newest, locked_lines`;
  - `acc_undo_bank_feed_sync(p_run_id uuid, p_reason text) returns jsonb` → `{removed, restored}`;
  - `acc_disconnect_bank_connection(p_connection_id uuid, p_reason text, p_note text) returns void`.

- [ ] **Step 1: The verify script and the static test first.** Create `scripts/verify-bank-feed-undo.mjs`:

```js
/**
 * Behavioural verification of migration 0137 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0137 has not been applied it is applied first, inside that transaction,
 * and the simulated bank connection, its syncs and their lines are made there
 * too — through the same functions the app calls — so nothing is left behind
 * and Plaid is never called. A refusal is tried inside a savepoint, so the
 * books it is tried on stay as they were.
 *
 * Run: node --env-file=.env.local scripts/verify-bank-feed-undo.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0137_bank_feed_disconnect_undo.sql";
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

const line = (id, date, minor, description, account = "acc-verify-1") => ({
  external_transaction_id: id,
  provider_account_id: account,
  txn_date: date,
  description,
  reference: "",
  amount_minor: minor,
  running_balance_minor: "",
  raw_line: description,
  raw_hash: `verify-0137-${id}-${minor}`,
  pending: false,
});

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
        console.log("  (0137 applied inside the transaction, never committed)");
      }
      for (const statement of statements) await client.query(statement);
      check("applying 0137 a second time is harmless", true);

      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- a bank account, connected through a simulated Plaid item
      const gl = (await one(
        `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
         values ('ZZ-VERIFY-FEED', 'Verify bank feed', 'bank', $1, true) returning id`,
        [base.code],
      )).id;
      const bank = (await one(
        `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Feed Bank', $2) returning id`,
        [gl, base.code],
      )).id;

      await client.query("set local role authenticated");
      await as(admin.id);
      const mapping = (providerAccount) =>
        JSON.stringify([{ bank_account_id: bank, provider_account_id: providerAccount, account_name: "Verify checking", currency_code: base.code }]);
      const conn = (await one(`select acc_save_bank_connection('item-verify-1', 'ins_verify', 'Verify Institution', 'not-a-real-token', $1::jsonb) as id`, [
        mapping("acc-verify-1"),
      ])).id;

      const begin = async (connection = conn) => (await one(`select acc_begin_bank_feed_sync($1) as id`, [connection])).id;
      const APPLY = `select acc_apply_bank_feed_page($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) as out`;
      const apply = async (run, added = [], modified = [], removed = [], connection = conn) =>
        (await one(APPLY, [connection, run, JSON.stringify(added), JSON.stringify(modified), JSON.stringify(removed)])).out;
      const finish = (run, error = null) => client.query(`select acc_finish_bank_feed_sync($1, 'cursor-after', 0, 0, 0, 0, $2)`, [run, error]);
      const txn = async (ext) =>
        one(`select id, status::text, provider_removed_at from acc_bank_transaction where external_transaction_id = $1 and bank_account_id = $2 order by provider_revision desc limit 1`, [ext, bank]);
      const activeLines = async () =>
        Number((await one(`select count(*) as n from acc_bank_transaction where bank_account_id = $1 and provider_removed_at is null`, [bank])).n);

      // ---- run 1 adds three lines
      const run1 = await begin();
      await refused("a page for another connection's run is refused", APPLY,
        [OUTSIDER, run1, "[]", "[]", "[]"], "is not running for this bank connection");
      const out1 = await apply(run1, [line("e1", "2026-09-01", 1000, "DEPOSIT ONE"), line("e2", "2026-09-02", -200, "CARD TWO"), line("e3", "2026-09-03", -300, "CARD THREE")]);
      await finish(run1);
      check("run 1 adds three lines", out1.added === 3, JSON.stringify(out1));
      const changes1 = await all(`select kind, count(*)::int as n from acc_bank_feed_sync_change where run_id = $1 group by kind`, [run1]);
      check("…and records three added lines", JSON.stringify(changes1) === JSON.stringify([{ kind: "added", n: 3 }]), JSON.stringify(changes1));
      await refused("a page for a finished run is refused", APPLY, [conn, run1, "[]", "[]", "[]"], "is not running for this bank connection");

      // A person ignores e3 before run 2.
      const e3 = await txn("e3");
      await asOwner(admin.id, () => client.query(`update acc_bank_transaction set status = 'ignored' where id = $1`, [e3.id]));

      // ---- run 2 modifies e2, removes e3, adds e4
      const run2 = await begin();
      const out2 = await apply(run2, [line("e4", "2026-09-04", 450, "DEPOSIT FOUR")], [line("e2", "2026-09-02", -250, "CARD TWO CORRECTED")], ["e3"]);
      await finish(run2);
      check("run 2 adds one, modifies one, removes one", out2.added === 1 && out2.modified === 1 && out2.removed === 1, JSON.stringify(out2));
      const changes2 = await all(
        `select c.kind, t.external_transaction_id as ext, c.prior_status::text as prior
           from acc_bank_feed_sync_change c join acc_bank_transaction t on t.id = c.bank_transaction_id
          where c.run_id = $1 order by c.kind, t.external_transaction_id, t.provider_revision`,
        [run2],
      );
      check(
        "…and records two added and two retired, each retired with its status before",
        JSON.stringify(changes2) ===
          JSON.stringify([
            { kind: "added", ext: "e2", prior: null },
            { kind: "added", ext: "e4", prior: null },
            { kind: "retired", ext: "e2", prior: "unmatched" },
            { kind: "retired", ext: "e3", prior: "ignored" },
          ]),
        JSON.stringify(changes2),
      );

      // ---- run 3 changes nothing
      const run3 = await begin();
      await apply(run3);
      await finish(run3);

      // ---- the list the screen shows
      const SYNCS = `select run_id, status, changes, is_newest, locked_lines from acc_bank_feed_syncs($1)`;
      const listed = await all(SYNCS, [bank]);
      check("the list shows the two syncs that changed something, newest first", listed.length === 2 && listed[0].run_id === run2 && listed[1].run_id === run1,
        JSON.stringify(listed.map((r) => r.run_id === run2 ? "run2" : r.run_id === run1 ? "run1" : r.run_id)));
      check("…run 2 is the one to undo, run 1 waits for it", listed[0].is_newest === true && listed[1].is_newest === false, JSON.stringify(listed));
      // e3, which a person ignored, was retired by run 2: it holds run 1 only once run 2 is undone and it is back.
      check("…and a line a later sync retired does not count against run 1 yet", listed[1].locked_lines === 0, JSON.stringify(listed[1]));

      // ---- what undo refuses
      const UNDO = `select acc_undo_bank_feed_sync($1, $2) as out`;
      await refused("undo without a reason is refused", UNDO, [run2, " "], "Say why this sync is being undone");
      await refused("an older sync waits for the newer one", UNDO, [run1, "verify"], "Undo the newer syncs of this bank connection first");
      await refused("a sync that changed nothing has nothing to undo", UNDO, [run3, "verify"], "changed nothing");
      await refused("an unknown sync is refused", UNDO, [OUTSIDER, "verify"], "Bank-feed sync not found");
      const e4 = await txn("e4");
      await client.query("savepoint coded");
      await asOwner(admin.id, () => client.query(`update acc_bank_transaction set status = 'matched' where id = $1`, [e4.id]));
      await refused("a sync whose line was coded is refused, with the count", UNDO, [run2, "verify"], "1 line(s) of this sync have been matched, coded or ignored");
      await client.query("rollback to savepoint coded");
      if (viewer) {
        await as(viewer.id);
        await refused("a viewer cannot undo", UNDO, [run2, "verify"], "permission");
      }
      await as(OUTSIDER);
      await refused("someone outside the company cannot undo", UNDO, [run2, "verify"], "permission");
      await as(admin.id);

      // ---- undo run 2: its lines go, the lines it retired come back as they were
      await asOwner(admin.id, () =>
        client.query(`insert into acc_reconciliation (bank_transaction_id, status, confidence) values ($1, 'suggested', 0.5)`, [e4.id]),
      );
      const undo2 = (await one(UNDO, [run2, "Verify: the bank sent a correction we do not want"])).out;
      check("undoing run 2 removes its two lines and restores two", undo2.removed === 2 && undo2.restored === 2, JSON.stringify(undo2));
      const e2After = await all(`select provider_revision, status::text, provider_removed_at is null as active from acc_bank_transaction where external_transaction_id = 'e2' and bank_account_id = $1`, [bank]);
      check("…e2 is back as it was, its new revision gone", e2After.length === 1 && e2After[0].active && e2After[0].status === "unmatched", JSON.stringify(e2After));
      const e3After = await txn("e3");
      check("…e3 is back, still ignored as the person left it", e3After.provider_removed_at === null && e3After.status === "ignored", JSON.stringify(e3After));
      check("…e4 is gone, and its suggestion with it",
        !(await txn("e4")) && (await one(`select count(*)::int as n from acc_reconciliation where bank_transaction_id = $1`, [e4.id])).n === 0);
      check("…the sync is marked undone, by whom and why",
        (await one(`select status, undone_by, undo_reason from acc_bank_feed_sync_run where id = $1`, [run2])).undone_by === admin.id);
      check("…one audit line is written", (await one(
        `select count(*)::int as n from acc_audit_log where table_name = 'acc_bank_feed_sync_run' and record_id = $1 and action = 'undo'`, [run2])).n === 1);
      await refused("a sync undone once cannot be undone again", UNDO, [run2, "verify"], "already been undone");

      // ---- run 1 is next; the ignored line holds it until it is unmatched
      const run1Listed = (await all(SYNCS, [bank])).find((r) => r.run_id === run1);
      check("run 1 is now the one to undo, held by the line a person ignored", run1Listed?.is_newest === true && run1Listed?.locked_lines === 1,
        JSON.stringify(run1Listed));
      await refused("run 1 is held by the line a person ignored", UNDO, [run1, "verify"], "1 line(s) of this sync");
      await asOwner(admin.id, () => client.query(`update acc_bank_transaction set status = 'unmatched' where id = $1`, [e3.id]));
      const undo1 = (await one(UNDO, [run1, "Verify: these lines were imported from a CSV already"])).out;
      check("undoing run 1 removes its three lines", undo1.removed === 3 && undo1.restored === 0 && (await activeLines()) === 0, JSON.stringify(undo1));

      // ---- disconnect, with a sync running
      const run4 = await begin();
      await apply(run4, [line("e5", "2026-09-05", 700, "DEPOSIT FIVE")]);
      const DISCONNECT = `select acc_disconnect_bank_connection($1, $2, $3)`;
      await refused("disconnect without a reason is refused", DISCONNECT, [conn, "", null], "Say why this bank connection is being disconnected");
      if (viewer) {
        await as(viewer.id);
        await refused("a viewer cannot disconnect", DISCONNECT, [conn, "verify", null], "permission");
        await as(admin.id);
      }
      await client.query(DISCONNECT, [conn, "Verify: the bank closed this account", "Disconnected in OneBook only: Plaid did not confirm the removal (verify)"]);
      const after = await one(`select status, last_error from acc_bank_connection where id = $1`, [conn]);
      check("the connection is disconnected, with the note", after.status === "disconnected" && after.last_error.startsWith("Disconnected in OneBook only"), JSON.stringify(after));
      await asOwner(admin.id, async () => {
        check("…its token is deleted", (await one(`select count(*)::int as n from acc_bank_connection_secret where connection_id = $1`, [conn])).n === 0);
      });
      check("…its account mapping is no longer active", (await one(`select is_active from acc_bank_feed_account where connection_id = $1`, [conn])).is_active === false);
      check("…the line it brought in stays", Boolean(await txn("e5")));
      check("…one audit line is written", (await one(
        `select count(*)::int as n from acc_audit_log where table_name = 'acc_bank_connection' and record_id = $1 and action = 'disconnect'`, [conn])).n === 1);
      await refused("the running sync's next page is refused", APPLY, [conn, run4, "[]", "[]", "[]"], "was disconnected");
      await finish(run4, "This bank connection was disconnected");
      const stays = await one(`select status, last_error from acc_bank_connection where id = $1`, [conn]);
      check("a sync ending after the disconnect leaves it disconnected, its note kept", stays.status === "disconnected" && stays.last_error.startsWith("Disconnected in OneBook only"), JSON.stringify(stays));
      await refused("a disconnected connection cannot sync", `select acc_begin_bank_feed_sync($1)`, [conn], "Active bank connection was not found");
      await refused("it cannot be disconnected twice", DISCONNECT, [conn, "verify", null], "already disconnected");
      check("run 4 can still be undone after the disconnect",
        (await all(SYNCS, [bank])).find((r) => r.run_id === run4)?.is_newest === true);
      check("…and is", (await one(UNDO, [run4, "Verify: clean up after disconnecting"])).out.removed === 1);

      // ---- the bank account is free to connect again
      const conn2 = (await one(`select acc_save_bank_connection('item-verify-2', 'ins_verify', 'Verify Institution', 'not-a-real-token-2', $1::jsonb) as id`, [
        mapping("acc-verify-2"),
      ])).id;
      check("the same bank account can be connected again", Boolean(conn2) && conn2 !== conn);
      await refused("but not twice at once", `select acc_save_bank_connection('item-verify-3', 'ins_verify', 'Verify Institution', 'x', $1::jsonb)`,
        [mapping("acc-verify-3")], "duplicate key");
      check("the list keeps the old connection's syncs", (await all(SYNCS, [bank])).some((r) => r.run_id === run1));

      // ---- who may call what
      await client.query("reset role");
      const grants = await one(
        `select has_function_privilege('anon', 'acc_undo_bank_feed_sync(uuid, text)', 'execute')
             or has_function_privilege('anon', 'acc_disconnect_bank_connection(uuid, text, text)', 'execute')
             or has_function_privilege('anon', 'acc_bank_feed_syncs(uuid)', 'execute')
             or has_function_privilege('anon', 'acc_apply_bank_feed_page(uuid, uuid, jsonb, jsonb, jsonb)', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_undo_bank_feed_sync(uuid, text)', 'execute')
            and has_function_privilege('authenticated', 'acc_disconnect_bank_connection(uuid, text, text)', 'execute')
            and has_function_privilege('authenticated', 'acc_bank_feed_syncs(uuid)', 'execute') as signed_in,
                to_regprocedure('acc_apply_bank_feed_page(uuid, jsonb, jsonb, jsonb)') is null as old_apply_gone`,
      );
      check("closed to anon, open to signed-in users; the old page function is gone",
        grants.anon === false && grants.signed_in === true && grants.old_apply_gone === true, JSON.stringify(grants));
      await client.query("set local role authenticated");
      await as(OUTSIDER);
      check("someone outside the company lists no syncs", (await all(SYNCS, [bank])).length === 0);
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

Create `tests/unit/bank-feed-undo-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0137_bank_feed_disconnect_undo.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8");
/** The migration without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const body = (fn: string) => {
  const start = code.indexOf(`create or replace function ${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("$$;", start));
};

describe("0137_bank_feed_disconnect_undo", () => {
  it("never posts: disconnecting and undoing move no balance", () => {
    expect(code).not.toMatch(/acc_post_entry/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)/i);
  });

  it("closes every function it grants to anon", () => {
    const granted = [...code.matchAll(/grant execute on function (acc_\w+)\(/g)].map((m) => m[1]);
    expect(granted.length).toBeGreaterThanOrEqual(8);
    for (const fn of granted) {
      expect(code, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from public, anon`));
    }
  });

  it("lets signed-in users read what a sync did, and only the functions write it", () => {
    expect(code).toMatch(/grant select on acc_bank_feed_sync_change to authenticated;/);
    expect(code).not.toMatch(/grant (insert|update|delete|all)[^;]*on acc_bank_feed_sync_change to authenticated/);
  });

  it("asks who may manage bank feeds before undoing or disconnecting", () => {
    for (const fn of ["acc_undo_bank_feed_sync", "acc_disconnect_bank_connection", "acc_apply_bank_feed_page"]) {
      expect(body(fn), fn).toMatch(/if not acc_bank_feed_authorized\(\) then/);
    }
  });

  it("never rewinds the sync cursor when undoing: undone lines stay out", () => {
    expect(body("acc_undo_bank_feed_sync")).not.toMatch(/sync_cursor/);
  });

  it("deletes the token when disconnecting, and keeps the lines", () => {
    const disconnect = body("acc_disconnect_bank_connection");
    expect(disconnect).toMatch(/delete from acc_bank_connection_secret/);
    expect(disconnect).not.toMatch(/delete from acc_bank_transaction/);
  });

  it("replaces the page function rather than leaving the old one callable", () => {
    expect(code).toMatch(/drop function if exists acc_apply_bank_feed_page\(uuid, jsonb, jsonb, jsonb\);/);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql }], "co_example");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toMatch(/set search_path = co_example/);
  });
});
```

- [ ] **Step 2: Run them — they fail.**

Run: `node --env-file=.env.local scripts/verify-bank-feed-undo.mjs`
Expected: it stops with `ENOENT` (the migration file does not exist yet).
Run: `npx vitest run tests/unit/bank-feed-undo-migration.test.ts`
Expected: FAIL — `ENOENT` for `0137_bank_feed_disconnect_undo.sql`.

- [ ] **Step 3: The migration.** Create `supabase/migrations/0137_bank_feed_disconnect_undo.sql`:

```sql
-- ============================================================================
-- 1.86 — a bank feed can be disconnected, and a sync can be undone.
--
-- A connection whose sync failed stayed "attention required" for good: the
-- status `disconnected` existed, and a sync refused it, but nothing set it —
-- and its bank account could never be connected again, because a bank account
-- could be mapped once, active or not.
--
-- A statement import could be undone since 0109; lines a sync brought in could
-- only be deleted one at a time, because nothing recorded which lines a sync
-- added, or which it retired (a modified transaction retires its old revision
-- and inserts a new one; a removed one is retired). Every sync now writes down
-- what it did, and an undo plays that back: the lines it added go, the lines it
-- retired come back as they were. The sync cursor is not rewound — undone lines
-- do not come back with the next sync; connecting again fetches the history.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What each sync did.
-- ----------------------------------------------------------------------------
create table if not exists acc_bank_feed_sync_change (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references acc_bank_feed_sync_run (id) on delete cascade,
  bank_transaction_id uuid not null references acc_bank_transaction (id) on delete cascade,
  kind                text not null check (kind in ('added', 'retired')),
  -- For a retired line: its status before the sync retired it.
  prior_status        acc_bank_txn_status,
  created_at          timestamptz not null default now(),
  check ((kind = 'retired') = (prior_status is not null))
);
create index if not exists acc_bank_feed_sync_change_run_idx on acc_bank_feed_sync_change (run_id, kind);
create index if not exists acc_bank_feed_sync_change_txn_idx on acc_bank_feed_sync_change (bank_transaction_id);

alter table acc_bank_feed_sync_change enable row level security;
drop policy if exists acc_bank_feed_sync_change_read on acc_bank_feed_sync_change;
create policy acc_bank_feed_sync_change_read on acc_bank_feed_sync_change
  for select using (acc_current_role() is not null);
-- Read by signed-in users; written only by the sync and undo functions.
revoke all on acc_bank_feed_sync_change from public, anon;
grant select on acc_bank_feed_sync_change to authenticated;
grant all on acc_bank_feed_sync_change to service_role;

-- ----------------------------------------------------------------------------
-- 2. A sync can be undone; a bank account can be connected again.
-- ----------------------------------------------------------------------------
alter table acc_bank_feed_sync_run
  add column if not exists undone_by uuid references auth.users (id),
  add column if not exists undone_at timestamptz,
  add column if not exists undo_reason text;
alter table acc_bank_feed_sync_run drop constraint if exists acc_bank_feed_sync_run_status_check;
alter table acc_bank_feed_sync_run add constraint acc_bank_feed_sync_run_status_check
  check (status in ('running', 'succeeded', 'failed', 'undone'));

alter table acc_bank_feed_account drop constraint if exists acc_bank_feed_account_bank_account_id_key;
create unique index if not exists acc_bank_feed_account_active_bank_uq
  on acc_bank_feed_account (bank_account_id) where is_active;

-- ----------------------------------------------------------------------------
-- 3. A sync page records what it changes.
--
--    The run must be this connection's, still running, and the connection not
--    disconnected: a sync that was running when the connection was disconnected
--    stops at its next page instead of retiring lines of a connection nobody
--    syncs any more.
-- ----------------------------------------------------------------------------
drop function if exists acc_apply_bank_feed_page(uuid, jsonb, jsonb, jsonb);
create or replace function acc_apply_bank_feed_page(
  p_connection_id uuid,
  p_run_id        uuid,
  p_added         jsonb,
  p_modified      jsonb,
  p_removed       jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_provider_id text;
  v_bank_account_id uuid;
  v_revision int;
  v_new_id uuid;
  v_count int;
  v_added int := 0;
  v_modified int := 0;
  v_removed int := 0;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to synchronize bank feeds';
  end if;
  if not exists (
    select 1 from acc_bank_feed_sync_run
     where id = p_run_id and connection_id = p_connection_id and status = 'running'
  ) then
    raise exception 'This sync run is not running for this bank connection';
  end if;
  if exists (select 1 from acc_bank_connection where id = p_connection_id and status = 'disconnected') then
    raise exception 'This bank connection was disconnected';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_removed, '[]'::jsonb)) loop
    v_provider_id := case when jsonb_typeof(v_row) = 'string'
      then trim(both '"' from v_row::text) else v_row->>'external_transaction_id' end;
    with old as (
      select t.id, t.status
        from acc_bank_transaction t
       where t.external_transaction_id = v_provider_id
         and t.provider_removed_at is null
         and t.provider_account_id in (
           select provider_account_id from acc_bank_feed_account where connection_id = p_connection_id
         )
         for update
    ), retired as (
      update acc_bank_transaction t
         set provider_removed_at = now(), status = 'ignored', updated_at = now()
        from old
       where t.id = old.id
      returning t.id, old.status
    )
    insert into acc_bank_feed_sync_change (run_id, bank_transaction_id, kind, prior_status)
    select p_run_id, id, 'retired', status from retired;
    get diagnostics v_count = row_count;
    v_removed := v_removed + v_count;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_modified, '[]'::jsonb)) loop
    v_provider_id := v_row->>'external_transaction_id';
    select bank_account_id into v_bank_account_id
      from acc_bank_feed_account
     where connection_id = p_connection_id
       and provider_account_id = v_row->>'provider_account_id'
       and is_active;
    if v_bank_account_id is null then continue; end if;

    with old as (
      select t.id, t.status
        from acc_bank_transaction t
       where t.bank_account_id = v_bank_account_id
         and t.external_transaction_id = v_provider_id
         and t.provider_removed_at is null
         for update
    ), retired as (
      update acc_bank_transaction t
         set provider_removed_at = now(), status = 'ignored', updated_at = now()
        from old
       where t.id = old.id
      returning t.id, old.status
    )
    insert into acc_bank_feed_sync_change (run_id, bank_transaction_id, kind, prior_status)
    select p_run_id, id, 'retired', status from retired;

    select coalesce(max(provider_revision), 0) + 1 into v_revision
      from acc_bank_transaction
     where bank_account_id = v_bank_account_id and external_transaction_id = v_provider_id;

    insert into acc_bank_transaction
      (bank_account_id, txn_date, description, reference, amount_minor,
       running_balance_minor, raw_line, raw_hash, source, external_transaction_id,
       provider_account_id, provider_revision, pending, authorized_date,
       merchant_name, category)
    values
      (v_bank_account_id,
       (v_row->>'txn_date')::date,
       coalesce(v_row->>'description', ''),
       nullif(v_row->>'reference', ''),
       (v_row->>'amount_minor')::bigint,
       nullif(v_row->>'running_balance_minor', '')::bigint,
       v_row->>'raw_line',
       v_row->>'raw_hash',
       'bank_feed',
       v_provider_id,
       v_row->>'provider_account_id',
       v_revision,
       coalesce((v_row->>'pending')::boolean, false),
       nullif(v_row->>'authorized_date', '')::date,
       nullif(v_row->>'merchant_name', ''),
       nullif(v_row->>'category', ''))
    returning id into v_new_id;
    insert into acc_bank_feed_sync_change (run_id, bank_transaction_id, kind)
    values (p_run_id, v_new_id, 'added');
    v_modified := v_modified + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_added, '[]'::jsonb)) loop
    v_provider_id := v_row->>'external_transaction_id';
    select bank_account_id into v_bank_account_id
      from acc_bank_feed_account
     where connection_id = p_connection_id
       and provider_account_id = v_row->>'provider_account_id'
       and is_active;
    if v_bank_account_id is null then continue; end if;
    if exists (
      select 1 from acc_bank_transaction
       where bank_account_id = v_bank_account_id
         and external_transaction_id = v_provider_id
         and provider_removed_at is null
    ) then
      continue;
    end if;

    select coalesce(max(provider_revision), 0) + 1 into v_revision
      from acc_bank_transaction
     where bank_account_id = v_bank_account_id and external_transaction_id = v_provider_id;

    insert into acc_bank_transaction
      (bank_account_id, txn_date, description, reference, amount_minor,
       running_balance_minor, raw_line, raw_hash, source, external_transaction_id,
       provider_account_id, provider_revision, pending, authorized_date,
       merchant_name, category)
    values
      (v_bank_account_id,
       (v_row->>'txn_date')::date,
       coalesce(v_row->>'description', ''),
       nullif(v_row->>'reference', ''),
       (v_row->>'amount_minor')::bigint,
       nullif(v_row->>'running_balance_minor', '')::bigint,
       v_row->>'raw_line',
       v_row->>'raw_hash',
       'bank_feed',
       v_provider_id,
       v_row->>'provider_account_id',
       greatest(v_revision, 1),
       coalesce((v_row->>'pending')::boolean, false),
       nullif(v_row->>'authorized_date', '')::date,
       nullif(v_row->>'merchant_name', ''),
       nullif(v_row->>'category', ''))
    returning id into v_new_id;
    insert into acc_bank_feed_sync_change (run_id, bank_transaction_id, kind)
    values (p_run_id, v_new_id, 'added');
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('added', v_added, 'modified', v_modified, 'removed', v_removed);
end;
$$;

revoke all on function acc_apply_bank_feed_page(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function acc_apply_bank_feed_page(uuid, uuid, jsonb, jsonb, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Syncs are told apart by when they began, so they begin at the clock's
--    time, not the transaction's: two syncs started in one transaction would
--    otherwise share a moment, and "newest first" would be a coin toss.
-- ----------------------------------------------------------------------------
create or replace function acc_begin_bank_feed_sync(p_connection_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_run uuid;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to synchronize bank feeds';
  end if;
  if not exists (select 1 from acc_bank_connection where id = p_connection_id and status <> 'disconnected') then
    raise exception 'Active bank connection was not found';
  end if;
  insert into acc_bank_feed_sync_run (connection_id, started_by, started_at)
  values (p_connection_id, auth.uid(), clock_timestamp())
  returning id into v_run;
  return v_run;
end;
$$;

revoke all on function acc_begin_bank_feed_sync(uuid) from public, anon;
grant execute on function acc_begin_bank_feed_sync(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. A sync that ends after its connection was disconnected leaves it so.
-- ----------------------------------------------------------------------------
create or replace function acc_finish_bank_feed_sync(
  p_run_id          uuid,
  p_cursor          text,
  p_added_count     int,
  p_modified_count  int,
  p_removed_count   int,
  p_matched_count   int,
  p_error_message   text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_connection uuid;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to synchronize bank feeds';
  end if;
  select connection_id into v_connection from acc_bank_feed_sync_run where id = p_run_id for update;
  if v_connection is null then raise exception 'Bank-feed sync run was not found'; end if;

  update acc_bank_feed_sync_run
     set status = case when p_error_message is null then 'succeeded' else 'failed' end,
         added_count = coalesce(p_added_count, 0),
         modified_count = coalesce(p_modified_count, 0),
         removed_count = coalesce(p_removed_count, 0),
         matched_count = coalesce(p_matched_count, 0),
         error_message = p_error_message,
         completed_at = now()
   where id = p_run_id;

  update acc_bank_connection
     set sync_cursor = case when p_error_message is null and status <> 'disconnected' then p_cursor else sync_cursor end,
         last_sync_at = case when p_error_message is null and status <> 'disconnected' then now() else last_sync_at end,
         last_error = case when status = 'disconnected' then last_error else p_error_message end,
         status = case
           when status = 'disconnected' then 'disconnected'
           when p_error_message is null then 'active'
           else 'attention_required'
         end,
         updated_at = now()
   where id = v_connection;
end;
$$;

revoke all on function acc_finish_bank_feed_sync(uuid, text, int, int, int, int, text) from public, anon;
grant execute on function acc_finish_bank_feed_sync(uuid, text, int, int, int, int, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Which syncs can be undone, and why not.
--
--    One place decides, so the button and the undo cannot disagree. A sync is
--    taken back newest first: only a connection's newest sync that changed
--    something, is not undone, and is not followed by a running one.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_feed_sync_is_newest(p_run_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from acc_bank_feed_sync_run r
     where r.id = p_run_id
       and r.status in ('succeeded', 'failed')
       and exists (select 1 from acc_bank_feed_sync_change c where c.run_id = r.id)
       and not exists (
         select 1 from acc_bank_feed_sync_run n
          where n.connection_id = r.connection_id
            and n.id <> r.id
            and (n.status = 'running'
                 or (n.status <> 'undone'
                     and (n.started_at, n.id) > (r.started_at, r.id)
                     and exists (select 1 from acc_bank_feed_sync_change c2 where c2.run_id = n.id)))
       )
  );
$$;

create or replace function acc_bank_feed_sync_locked_lines(p_run_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
    from acc_bank_feed_sync_change c
    join acc_bank_transaction t on t.id = c.bank_transaction_id
   where c.run_id = p_run_id
     and c.kind = 'added'
     -- A line a later sync retired comes back only when that sync is undone.
     and t.provider_removed_at is null
     and (t.status <> 'unmatched'
          or exists (select 1 from acc_reconciliation m where m.bank_transaction_id = t.id and m.status = 'approved'));
$$;

revoke all on function acc_bank_feed_sync_is_newest(uuid) from public, anon;
grant execute on function acc_bank_feed_sync_is_newest(uuid) to authenticated, service_role;
revoke all on function acc_bank_feed_sync_locked_lines(uuid) from public, anon;
grant execute on function acc_bank_feed_sync_locked_lines(uuid) to authenticated, service_role;

-- The syncs of every connection that ever fed this bank account, newest first.
-- A sync that changed nothing and did not fail is left out: the daily sync
-- would otherwise bury the ones that matter.
create or replace function acc_bank_feed_syncs(p_bank_account_id uuid)
returns table (
  run_id uuid, connection_id uuid, institution_name text, connection_status text,
  status text, started_at timestamptz, completed_at timestamptz,
  added_count int, modified_count int, removed_count int, error_message text,
  undone_at timestamptz, undo_reason text,
  changes int, is_newest boolean, locked_lines int
)
language sql stable security definer set search_path = public as $$
  select r.id, r.connection_id, c.institution_name, c.status,
         r.status, r.started_at, r.completed_at,
         r.added_count, r.modified_count, r.removed_count, r.error_message,
         r.undone_at, r.undo_reason,
         (select count(*)::int from acc_bank_feed_sync_change x where x.run_id = r.id),
         acc_bank_feed_sync_is_newest(r.id),
         acc_bank_feed_sync_locked_lines(r.id)
    from acc_bank_feed_sync_run r
    join acc_bank_connection c on c.id = r.connection_id
   where acc_current_role() is not null
     and r.connection_id in (select f.connection_id from acc_bank_feed_account f where f.bank_account_id = p_bank_account_id)
     and (r.status <> 'succeeded' or exists (select 1 from acc_bank_feed_sync_change x where x.run_id = r.id))
   order by r.started_at desc, r.id desc;
$$;

revoke all on function acc_bank_feed_syncs(uuid) from public, anon;
grant execute on function acc_bank_feed_syncs(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Undo a sync.
-- ----------------------------------------------------------------------------
create or replace function acc_undo_bank_feed_sync(p_run_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run      acc_bank_feed_sync_run;
  v_locked   int;
  v_removed  int;
  v_restored int;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to manage bank feeds';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this sync is being undone';
  end if;

  select * into v_run from acc_bank_feed_sync_run where id = p_run_id for update;
  if not found then raise exception 'Bank-feed sync not found'; end if;
  -- One undo of a connection at a time.
  perform 1 from acc_bank_connection where id = v_run.connection_id for update;
  if v_run.status = 'undone' then raise exception 'This sync has already been undone'; end if;
  if v_run.status = 'running' then raise exception 'This sync is still running'; end if;
  if not exists (select 1 from acc_bank_feed_sync_change where run_id = p_run_id) then
    raise exception 'This sync changed nothing in Bank Transactions';
  end if;
  if not acc_bank_feed_sync_is_newest(p_run_id) then
    raise exception 'Undo the newer syncs of this bank connection first';
  end if;

  v_locked := acc_bank_feed_sync_locked_lines(p_run_id);
  if v_locked > 0 then
    raise exception
      '% line(s) of this sync have been matched, coded or ignored — unmatch them first. '
      'Removing a line the books point at would leave them short.', v_locked;
  end if;

  -- The lines it added go first, so a line it retired can take its place again.
  delete from acc_bank_transaction
   where id in (select bank_transaction_id from acc_bank_feed_sync_change where run_id = p_run_id and kind = 'added');
  get diagnostics v_removed = row_count;

  update acc_bank_transaction t
     set provider_removed_at = null, status = c.prior_status, updated_at = now()
    from acc_bank_feed_sync_change c
   where c.run_id = p_run_id and c.kind = 'retired' and c.bank_transaction_id = t.id;
  get diagnostics v_restored = row_count;

  update acc_bank_feed_sync_run
     set status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_reason = btrim(p_reason)
   where id = p_run_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_feed_sync_run', p_run_id, 'undo', auth.uid(),
          jsonb_build_object('connection_id', v_run.connection_id,
                             'lines_removed', v_removed,
                             'lines_restored', v_restored,
                             'reason', btrim(p_reason)));
  return jsonb_build_object('removed', v_removed, 'restored', v_restored);
end;
$$;

revoke all on function acc_undo_bank_feed_sync(uuid, text) from public, anon;
grant execute on function acc_undo_bank_feed_sync(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. Disconnect.
--
--    The app removes the connection at Plaid first; p_note says when Plaid did
--    not confirm and the person chose to disconnect in OneBook only. The lines
--    the connection brought in stay; its accounts are free to connect again.
-- ----------------------------------------------------------------------------
create or replace function acc_disconnect_bank_connection(p_connection_id uuid, p_reason text, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_conn     acc_bank_connection;
  v_accounts int;
begin
  if not acc_bank_feed_authorized() then
    raise exception 'You do not have permission to manage bank feeds';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this bank connection is being disconnected';
  end if;
  select * into v_conn from acc_bank_connection where id = p_connection_id for update;
  if not found then raise exception 'Bank connection not found'; end if;
  if v_conn.status = 'disconnected' then raise exception 'This bank connection is already disconnected'; end if;

  update acc_bank_connection
     set status = 'disconnected', last_error = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_connection_id;
  delete from acc_bank_connection_secret where connection_id = p_connection_id;
  update acc_bank_feed_account set is_active = false, updated_at = now()
   where connection_id = p_connection_id and is_active;
  get diagnostics v_accounts = row_count;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_bank_connection', p_connection_id, 'disconnect', auth.uid(),
          jsonb_build_object('institution_name', v_conn.institution_name,
                             'accounts', v_accounts,
                             'reason', btrim(p_reason),
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
end;
$$;

revoke all on function acc_disconnect_bank_connection(uuid, text, text) from public, anon;
grant execute on function acc_disconnect_bank_connection(uuid, text, text) to authenticated, service_role;
```

- [ ] **Step 4: The new table in the company export.** In `lib/domain/company-export.ts` apply this edit:

Edit 1 of 1 — find:

```ts
  // schema's own foreign keys at restore time, not from this list.
  "acc_import_batch",
  "acc_bank_transaction",
  "acc_reconciliation",
  "acc_reconciliation_line",
  "acc_statement_reconciliation",
```

replace with:

```ts
  // schema's own foreign keys at restore time, not from this list.
  "acc_import_batch",
  "acc_bank_transaction",
  // What each bank-feed sync added or retired (0137), so a sync can be undone.
  "acc_bank_feed_sync_change",
  "acc_reconciliation",
  "acc_reconciliation_line",
  "acc_statement_reconciliation",
```

- [ ] **Step 5: Run them — they pass.**

Run: `node --env-file=.env.local scripts/verify-bank-feed-undo.mjs`
Expected: each of the six schemas prints `(0137 applied inside the transaction, never committed)` and only `ok` lines; the last line is `260 passed, 0 failed` (a company with an active viewer adds the two viewer checks). Every company's transaction is rolled back; Plaid is never called.
Run: `npx vitest run tests/unit/bank-feed-undo-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/backup-restore.test.ts tests/unit/backup-rules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/0137_bank_feed_disconnect_undo.sql scripts/verify-bank-feed-undo.mjs tests/unit/bank-feed-undo-migration.test.ts lib/domain/company-export.ts
printf 'feat(db): 0137 record what a bank-feed sync did; undo it; disconnect a connection\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 2: What Plaid's answer means, what the screens say, whether a sync can be undone

**Files:**
- Create: `lib/domain/bank-feeds.ts`
- Create: `tests/unit/bank-feeds.test.ts`

**Interfaces:**
- Produces (`lib/domain/bank-feeds.ts`):
  - `PLAID_ITEM_GONE_CODES`, `plaidItemAlreadyGone(code: string | null | undefined): boolean`
  - `unconfirmedRemovalMessage(reason: string): string`, `disconnectNote(reason: string): string`, `disconnectedMessage(institution: string, confirmedByPlaid: boolean): string`
  - `type BankFeedSyncStatus = "running" | "succeeded" | "failed" | "undone"`, `SYNC_STATUS_LABEL`
  - `interface BankFeedSyncView { runId; connectionId; institutionName; connectionStatus; status; startedAt; completedAt; added; modified; removed; errorMessage; undoneAt; undoReason; changes; isNewest; lockedLines }`
  - `syncUndoState(sync: BankFeedSyncView): { canUndo: boolean; why: string | null }`, `undoSyncWarning(sync): string`, `undoneSyncMessage({ removed, restored }): string`

- [ ] **Step 1: The test first.** Create `tests/unit/bank-feeds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  disconnectNote,
  disconnectedMessage,
  plaidItemAlreadyGone,
  syncUndoState,
  undoSyncWarning,
  undoneSyncMessage,
  unconfirmedRemovalMessage,
  type BankFeedSyncView,
} from "@/lib/domain/bank-feeds";

const sync = (extra: Partial<BankFeedSyncView> = {}): BankFeedSyncView => ({
  runId: "run-1",
  connectionId: "conn-1",
  institutionName: "Example Bank",
  connectionStatus: "active",
  status: "succeeded",
  startedAt: "2026-10-07T11:00:00Z",
  completedAt: "2026-10-07T11:00:05Z",
  added: 3,
  modified: 0,
  removed: 0,
  errorMessage: null,
  undoneAt: null,
  undoReason: null,
  changes: 3,
  isNewest: true,
  lockedLines: 0,
  ...extra,
});

describe("Plaid's answer to a removal", () => {
  it("takes an item Plaid no longer has as removed", () => {
    expect(plaidItemAlreadyGone("ITEM_NOT_FOUND")).toBe(true);
    expect(plaidItemAlreadyGone("INVALID_ACCESS_TOKEN")).toBe(true);
  });

  it("takes anything else as not confirmed", () => {
    expect(plaidItemAlreadyGone("INTERNAL_SERVER_ERROR")).toBe(false);
    expect(plaidItemAlreadyGone("ITEM_LOGIN_REQUIRED")).toBe(false);
    expect(plaidItemAlreadyGone(null)).toBe(false);
  });
});

describe("what disconnecting says", () => {
  it("asks to try again or disconnect in OneBook only", () => {
    expect(unconfirmedRemovalMessage("Plaid request failed: fetch failed.")).toBe(
      "Plaid did not confirm the removal: Plaid request failed: fetch failed. Try again, or tick Disconnect in OneBook only.",
    );
  });

  it("keeps a note on a connection Plaid was not told about", () => {
    expect(disconnectNote("OneBook has no Plaid keys")).toBe(
      "Disconnected in OneBook only: Plaid did not confirm the removal (OneBook has no Plaid keys)",
    );
    expect(disconnectNote("  ")).toBe("Disconnected in OneBook only: Plaid did not confirm the removal (an unexpected error occurred)");
  });

  it("says the lines stay", () => {
    expect(disconnectedMessage("Example Bank", true)).toBe("Example Bank is disconnected. The lines already here stay.");
    expect(disconnectedMessage("Example Bank", false)).toBe("Example Bank is disconnected in OneBook only. The lines already here stay.");
  });
});

describe("whether a sync can be undone", () => {
  it("offers Undo on the newest sync with nothing locked", () => {
    expect(syncUndoState(sync())).toEqual({ canUndo: true, why: null });
  });

  it("says why not, in order", () => {
    expect(syncUndoState(sync({ status: "undone", undoReason: "Duplicates of the CSV" })).why).toBe("Undone: Duplicates of the CSV");
    expect(syncUndoState(sync({ status: "running" })).why).toBe("This sync is still running");
    expect(syncUndoState(sync({ changes: 0 })).why).toBe("This sync changed nothing in Bank Transactions");
    expect(syncUndoState(sync({ isNewest: false, lockedLines: 2 })).why).toBe("Undo the newer syncs of this bank connection first");
    expect(syncUndoState(sync({ lockedLines: 1 })).why).toBe("1 line of this sync has been matched, coded or ignored — unmatch it first");
    expect(syncUndoState(sync({ lockedLines: 2 })).why).toBe("2 lines of this sync have been matched, coded or ignored — unmatch them first");
  });

  it("offers Undo on a failed sync that changed something", () => {
    expect(syncUndoState(sync({ status: "failed" })).canUndo).toBe(true);
  });
});

describe("what undoing says", () => {
  it("warns the lines do not come back with the next sync", () => {
    expect(undoSyncWarning(sync())).toBe(
      "The lines this sync added are removed from Bank Transactions. The next sync does not bring them back; to fetch them again, disconnect the bank and connect it again.",
    );
    expect(undoSyncWarning(sync({ modified: 1, removed: 1 }))).toContain("The 2 lines it changed or removed come back as they were.");
  });

  it("says what was removed and restored", () => {
    expect(undoneSyncMessage({ removed: 3, restored: 0 })).toBe("Sync undone: 3 lines removed.");
    expect(undoneSyncMessage({ removed: 1, restored: 2 })).toBe("Sync undone: 1 line removed; 2 lines restored.");
  });
});
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/bank-feeds.test.ts`
Expected: FAIL — cannot resolve `@/lib/domain/bank-feeds`.

- [ ] **Step 3: The module.** Create `lib/domain/bank-feeds.ts`:

```ts
/**
 * Disconnecting a bank feed and undoing a bank-feed sync (1.86): what Plaid's
 * answer to a removal means, what each screen says, and whether a sync can be
 * undone now. Pure, so the wording is tested where it is written.
 */

/**
 * Plaid's answers that mean the connection is already gone at Plaid — removed
 * before, or its access revoked — so disconnecting has nothing left to remove.
 */
export const PLAID_ITEM_GONE_CODES: readonly string[] = ["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"];

export function plaidItemAlreadyGone(code: string | null | undefined): boolean {
  return code != null && PLAID_ITEM_GONE_CODES.includes(code);
}

const reasonText = (reason: string) => reason.trim().replace(/[.\s]+$/, "") || "an unexpected error occurred";

/** Said when Plaid did not confirm the removal, and the person has not chosen to disconnect in OneBook only. */
export function unconfirmedRemovalMessage(reason: string): string {
  return `Plaid did not confirm the removal: ${reasonText(reason)}. Try again, or tick Disconnect in OneBook only.`;
}

/** Kept on a connection disconnected in OneBook only, so whoever reads it later knows Plaid was not told. */
export function disconnectNote(reason: string): string {
  return `Disconnected in OneBook only: Plaid did not confirm the removal (${reasonText(reason)})`;
}

export function disconnectedMessage(institution: string, confirmedByPlaid: boolean): string {
  return confirmedByPlaid
    ? `${institution} is disconnected. The lines already here stay.`
    : `${institution} is disconnected in OneBook only. The lines already here stay.`;
}

export type BankFeedSyncStatus = "running" | "succeeded" | "failed" | "undone";

export const SYNC_STATUS_LABEL: Record<BankFeedSyncStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  undone: "Undone",
};

/** A sync as Bank feed syncs lists it (acc_bank_feed_syncs). */
export interface BankFeedSyncView {
  runId: string;
  connectionId: string;
  institutionName: string;
  connectionStatus: string;
  status: BankFeedSyncStatus;
  startedAt: string;
  completedAt: string | null;
  added: number;
  modified: number;
  removed: number;
  errorMessage: string | null;
  undoneAt: string | null;
  undoReason: string | null;
  /** Lines the sync added or retired; zero when it changed nothing. */
  changes: number;
  /** The connection's newest sync that changed something, not undone, with no sync running. */
  isNewest: boolean;
  /** Lines it added that a person has matched, coded or ignored since. */
  lockedLines: number;
}

const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

/** Whether Undo is offered on a sync, and when not, the tooltip that says why. */
export function syncUndoState(sync: BankFeedSyncView): { canUndo: boolean; why: string | null } {
  if (sync.status === "undone") return { canUndo: false, why: sync.undoReason ? `Undone: ${sync.undoReason}` : "Undone" };
  if (sync.status === "running") return { canUndo: false, why: "This sync is still running" };
  if (sync.changes === 0) return { canUndo: false, why: "This sync changed nothing in Bank Transactions" };
  if (!sync.isNewest) return { canUndo: false, why: "Undo the newer syncs of this bank connection first" };
  if (sync.lockedLines > 0) {
    return {
      canUndo: false,
      why: `${lines(sync.lockedLines)} of this sync ${sync.lockedLines === 1 ? "has" : "have"} been matched, coded or ignored — unmatch ${sync.lockedLines === 1 ? "it" : "them"} first`,
    };
  }
  return { canUndo: true, why: null };
}

/** What the Undo dialog says will happen. */
export function undoSyncWarning(sync: BankFeedSyncView): string {
  const changed = sync.modified + sync.removed;
  const back = changed > 0 ? ` The ${lines(changed)} it changed or removed come back as they were.` : "";
  return (
    `The lines this sync added are removed from Bank Transactions.${back} ` +
    "The next sync does not bring them back; to fetch them again, disconnect the bank and connect it again."
  );
}

export function undoneSyncMessage(result: { removed: number; restored: number }): string {
  const restored = result.restored > 0 ? `; ${lines(result.restored)} restored` : "";
  return `Sync undone: ${lines(result.removed)} removed${restored}.`;
}
```

- [ ] **Step 4: Run it — it passes.**

Run: `npx vitest run tests/unit/bank-feeds.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/domain/bank-feeds.ts tests/unit/bank-feeds.test.ts
printf 'feat(banking): what disconnecting and undoing a bank-feed sync say\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 3: Removing a connection at Plaid; the service; each sync page carries its run

**Files:**
- Modify: `lib/services/plaid.ts` (`removePlaidItem`)
- Create: `lib/services/bank-feeds.ts`
- Create: `tests/unit/bank-feeds-service.test.ts`
- Modify: `lib/services/banking.ts` (`syncBankConnection` passes `p_run_id` to each page)

**Interfaces:**
- Consumes: Task 2's module; Task 1's functions; `decryptBankToken` (`lib/services/bank-token-crypto.ts`); `PlaidError`, `plaidConfiguration` (`lib/services/plaid.ts`); `readAllPages` (`lib/services/paging.ts`).
- Produces:
  - `lib/services/plaid.ts`: `removePlaidItem(accessToken: string): Promise<void>` (Plaid `/item/remove`)
  - `lib/services/bank-feeds.ts`: `class BankFeedError extends Error`; `listBankFeedSyncs(sb, bankAccountId: string): Promise<BankFeedSyncView[]>` (paged); `undoBankFeedSync(sb, runId: string, reason: string): Promise<{ removed: number; restored: number }>`; `type DisconnectOutcome = { disconnected: true; confirmedByPlaid: boolean } | { disconnected: false; unconfirmed: string }`; `disconnectBankConnection(sb, connectionId: string, reason: string, onlyInOneBook: boolean): Promise<DisconnectOutcome>`

- [ ] **Step 1: The test first.** Create `tests/unit/bank-feeds-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

/** What the stand-in for Plaid does: configured or not, and what /item/remove answers. */
const plaid = { configured: true, remove: vi.fn<(token: string) => Promise<void>>() };
vi.mock("@/lib/services/plaid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/plaid")>();
  return {
    ...actual,
    plaidConfiguration: () => ({ configured: plaid.configured, environment: "sandbox", clientName: "One Book" }),
    removePlaidItem: (token: string) => plaid.remove(token),
  };
});
vi.mock("@/lib/services/bank-token-crypto", () => ({ decryptBankToken: (payload: string) => `plain:${payload}` }));

const { PlaidError } = await import("@/lib/services/plaid");
const { BankFeedError, disconnectBankConnection, listBankFeedSyncs, undoBankFeedSync } = await import("@/lib/services/bank-feeds");

type Answer = { data: unknown; error: { message: string } | null };

/** A stand-in for PostgREST's rpc: scalar answers by function name, table answers paged; records every call. */
function fakeClient(answers: Record<string, Answer | Record<string, unknown>[]>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const orders: string[] = [];
  const sb = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = answers[fn] ?? { data: null, error: null };
      if (!Array.isArray(answer)) return Promise.resolve(answer);
      const chain: Record<string, unknown> = {};
      chain.order = (column: string) => {
        orders.push(column);
        return chain;
      };
      chain.range = (from: number, to: number) => Promise.resolve({ data: answer.slice(from, to + 1), error: null });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders };
}

beforeEach(() => {
  plaid.configured = true;
  plaid.remove.mockReset();
  plaid.remove.mockResolvedValue(undefined);
});

describe("disconnecting a bank connection", () => {
  const token = { acc_get_bank_connection_token: { data: "sealed", error: null } };

  it("removes it at Plaid with the connection's own token, then disconnects it with no note", async () => {
    const { sb, calls } = fakeClient(token);
    expect(await disconnectBankConnection(sb, "conn-1", " The bank closed the account ", false)).toEqual({ disconnected: true, confirmedByPlaid: true });
    expect(plaid.remove).toHaveBeenCalledWith("plain:sealed");
    expect(calls.at(-1)).toEqual({
      fn: "acc_disconnect_bank_connection",
      args: { p_connection_id: "conn-1", p_reason: "The bank closed the account", p_note: null },
    });
  });

  it("takes a connection Plaid no longer has as removed", async () => {
    plaid.remove.mockRejectedValue(new PlaidError("The Item you requested cannot be found.", "ITEM_NOT_FOUND"));
    const { sb, calls } = fakeClient(token);
    expect(await disconnectBankConnection(sb, "conn-1", "Closed", false)).toEqual({ disconnected: true, confirmedByPlaid: true });
    expect(calls.at(-1)?.args.p_note).toBeNull();
  });

  it("changes nothing when Plaid does not confirm, and says how to go on", async () => {
    plaid.remove.mockRejectedValue(new PlaidError("Plaid request failed: fetch failed"));
    const { sb, calls } = fakeClient(token);
    expect(await disconnectBankConnection(sb, "conn-1", "Closed", false)).toEqual({
      disconnected: false,
      unconfirmed: "Plaid did not confirm the removal: Plaid request failed: fetch failed. Try again, or tick Disconnect in OneBook only.",
    });
    expect(calls.map((c) => c.fn)).not.toContain("acc_disconnect_bank_connection");
  });

  it("disconnects in OneBook only when asked, with a note that Plaid was not told", async () => {
    plaid.remove.mockRejectedValue(new PlaidError("Plaid request failed: fetch failed"));
    const { sb, calls } = fakeClient(token);
    expect(await disconnectBankConnection(sb, "conn-1", "Closed", true)).toEqual({ disconnected: true, confirmedByPlaid: false });
    expect(calls.at(-1)?.args.p_note).toBe("Disconnected in OneBook only: Plaid did not confirm the removal (Plaid request failed: fetch failed)");
  });

  it("does not reach for the token when OneBook has no Plaid keys", async () => {
    plaid.configured = false;
    const { sb, calls } = fakeClient(token);
    const outcome = await disconnectBankConnection(sb, "conn-1", "Closed", false);
    expect(outcome).toEqual({
      disconnected: false,
      unconfirmed: "Plaid did not confirm the removal: OneBook has no Plaid keys. Try again, or tick Disconnect in OneBook only.",
    });
    expect(calls).toEqual([]);
    expect(plaid.remove).not.toHaveBeenCalled();
  });

  it("takes a token it cannot read as not confirmed", async () => {
    const { sb } = fakeClient({ acc_get_bank_connection_token: { data: null, error: { message: "Bank connection token was not found" } } });
    const outcome = await disconnectBankConnection(sb, "conn-1", "Closed", false);
    expect(outcome).toMatchObject({ disconnected: false, unconfirmed: expect.stringContaining("Bank connection token was not found") });
  });

  it("asks why first", async () => {
    const { sb, calls } = fakeClient(token);
    await expect(disconnectBankConnection(sb, "conn-1", "  ", true)).rejects.toThrow("Say why this bank connection is being disconnected");
    expect(calls).toEqual([]);
  });

  it("says why the database refused", async () => {
    const { sb } = fakeClient({ ...token, acc_disconnect_bank_connection: { data: null, error: { message: "This bank connection is already disconnected" } } });
    await expect(disconnectBankConnection(sb, "conn-1", "Closed", false)).rejects.toThrow(BankFeedError);
  });
});

describe("the syncs of a bank account", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    run_id: id,
    connection_id: "conn-1",
    institution_name: "Example Bank",
    connection_status: "active",
    status: "succeeded",
    started_at: "2026-10-07T11:00:00Z",
    completed_at: "2026-10-07T11:00:05Z",
    added_count: 3,
    modified_count: 1,
    removed_count: 0,
    error_message: null,
    undone_at: null,
    undo_reason: null,
    changes: 5,
    is_newest: true,
    locked_lines: 0,
    ...extra,
  });

  it("reads every sync past the row cap, newest first", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row(`run-${i}`, { is_newest: i === 0 }));
    const { sb, orders } = fakeClient({ acc_bank_feed_syncs: rows });
    const syncs = await listBankFeedSyncs(sb, "bank-1");
    expect(syncs).toHaveLength(1200);
    expect(orders.slice(0, 2)).toEqual(["started_at", "run_id"]);
    expect(syncs[0]).toEqual({
      runId: "run-0",
      connectionId: "conn-1",
      institutionName: "Example Bank",
      connectionStatus: "active",
      status: "succeeded",
      startedAt: "2026-10-07T11:00:00Z",
      completedAt: "2026-10-07T11:00:05Z",
      added: 3,
      modified: 1,
      removed: 0,
      errorMessage: null,
      undoneAt: null,
      undoReason: null,
      changes: 5,
      isNewest: true,
      lockedLines: 0,
    });
  });
});

describe("undoing a sync", () => {
  it("says what it removed and restored", async () => {
    const { sb, calls } = fakeClient({ acc_undo_bank_feed_sync: { data: { removed: 2, restored: 1 }, error: null } });
    expect(await undoBankFeedSync(sb, "run-1", "Duplicates of the CSV")).toEqual({ removed: 2, restored: 1 });
    expect(calls).toEqual([{ fn: "acc_undo_bank_feed_sync", args: { p_run_id: "run-1", p_reason: "Duplicates of the CSV" } }]);
  });

  it("says why the database refused", async () => {
    const { sb } = fakeClient({ acc_undo_bank_feed_sync: { data: null, error: { message: "Undo the newer syncs of this bank connection first" } } });
    await expect(undoBankFeedSync(sb, "run-1", "x")).rejects.toThrow("Undo the newer syncs of this bank connection first");
  });
});
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/bank-feeds-service.test.ts`
Expected: FAIL — cannot resolve `@/lib/services/bank-feeds`.

- [ ] **Step 3: Removing a connection at Plaid.** In `lib/services/plaid.ts` apply this edit:

Edit 1 of 1 — find:

```ts
  if (cursor) body.cursor = cursor;
  return plaidRequest<PlaidSyncResponse>("/transactions/sync", body);
}
```

replace with:

```ts
  if (cursor) body.cursor = cursor;
  return plaidRequest<PlaidSyncResponse>("/transactions/sync", body);
}

/**
 * Removes the connection (Plaid's "item") at Plaid: its access token stops
 * working and, on a paid plan, Plaid stops billing for it.
 */
export async function removePlaidItem(accessToken: string): Promise<void> {
  await plaidRequest<{ request_id?: string }>("/item/remove", { access_token: accessToken });
}
```

- [ ] **Step 4: The service.** Create `lib/services/bank-feeds.ts`:

```ts
/**
 * Disconnecting a bank feed and undoing a bank-feed sync (1.86). The rules are
 * in the database (0137); this removes the connection at Plaid first, and says
 * so when Plaid does not confirm, so a connection is never dropped in OneBook
 * while Plaid keeps it — unless the person chose that.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  disconnectNote,
  plaidItemAlreadyGone,
  unconfirmedRemovalMessage,
  type BankFeedSyncStatus,
  type BankFeedSyncView,
} from "@/lib/domain/bank-feeds";
import { decryptBankToken } from "./bank-token-crypto";
import { readAllPages } from "./paging";
import { PlaidError, plaidConfiguration, removePlaidItem } from "./plaid";

export class BankFeedError extends Error {}

/** Every sync of every connection that ever fed this bank account, newest first; one that changed nothing and did not fail is left out. */
export async function listBankFeedSyncs(sb: SupabaseClient, bankAccountId: string): Promise<BankFeedSyncView[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_bank_feed_syncs", { p_bank_account_id: bankAccountId })
        .order("started_at", { ascending: false })
        .order("run_id", { ascending: false })
        .range(from, to),
    (message) => new BankFeedError(message),
  );
  return rows.map((r) => ({
    runId: r.run_id as string,
    connectionId: r.connection_id as string,
    institutionName: r.institution_name as string,
    connectionStatus: r.connection_status as string,
    status: r.status as BankFeedSyncStatus,
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
    added: Number(r.added_count ?? 0),
    modified: Number(r.modified_count ?? 0),
    removed: Number(r.removed_count ?? 0),
    errorMessage: (r.error_message as string | null) ?? null,
    undoneAt: (r.undone_at as string | null) ?? null,
    undoReason: (r.undo_reason as string | null) ?? null,
    changes: Number(r.changes ?? 0),
    isNewest: Boolean(r.is_newest),
    lockedLines: Number(r.locked_lines ?? 0),
  }));
}

/** Takes one sync back: the lines it added go, the lines it retired come back as they were. */
export async function undoBankFeedSync(sb: SupabaseClient, runId: string, reason: string): Promise<{ removed: number; restored: number }> {
  const { data, error } = await sb.rpc("acc_undo_bank_feed_sync", { p_run_id: runId, p_reason: reason });
  if (error) throw new BankFeedError(error.message);
  const out = (data ?? {}) as Record<string, unknown>;
  return { removed: Number(out.removed ?? 0), restored: Number(out.restored ?? 0) };
}

export type DisconnectOutcome =
  | { disconnected: true; confirmedByPlaid: boolean }
  /** Plaid did not confirm and the person has not chosen to disconnect in OneBook only: nothing changed. */
  | { disconnected: false; unconfirmed: string };

/**
 * Removes the connection at Plaid, then disconnects it in OneBook. Plaid
 * answering that the connection is already gone counts as removed. When Plaid
 * cannot be reached, answers otherwise, OneBook has no Plaid keys or the token
 * cannot be read, nothing changes — unless `onlyInOneBook`, and then the
 * connection keeps a note that Plaid was not told.
 */
export async function disconnectBankConnection(
  sb: SupabaseClient,
  connectionId: string,
  reason: string,
  onlyInOneBook: boolean,
): Promise<DisconnectOutcome> {
  const why = reason.trim();
  if (!why) throw new BankFeedError("Say why this bank connection is being disconnected");

  let problem: string | null = null;
  if (!plaidConfiguration().configured) {
    problem = "OneBook has no Plaid keys";
  } else {
    try {
      const { data: encrypted, error } = await sb.rpc("acc_get_bank_connection_token", { p_connection_id: connectionId });
      if (error) throw new BankFeedError(error.message);
      await removePlaidItem(decryptBankToken(encrypted as string));
    } catch (e) {
      if (!(e instanceof PlaidError && plaidItemAlreadyGone(e.code))) {
        problem = e instanceof Error ? e.message : "an unexpected error";
      }
    }
  }
  if (problem && !onlyInOneBook) return { disconnected: false, unconfirmed: unconfirmedRemovalMessage(problem) };

  const { error } = await sb.rpc("acc_disconnect_bank_connection", {
    p_connection_id: connectionId,
    p_reason: why,
    p_note: problem ? disconnectNote(problem) : null,
  });
  if (error) throw new BankFeedError(error.message);
  return { disconnected: true, confirmedByPlaid: problem === null };
}
```

- [ ] **Step 5: Each sync page carries its run.** In `lib/services/banking.ts` apply this edit:

Edit 1 of 1 — find:

```ts
    for (let index = 0; index < pageCount; index++) {
      const { data: applied, error: applyError } = await sb.rpc("acc_apply_bank_feed_page", {
        p_connection_id: connectionId,
        p_added: addedChunks[index] ?? [],
        p_modified: modifiedChunks[index] ?? [],
        p_removed: removedChunks[index] ?? [],
```

replace with:

```ts
    for (let index = 0; index < pageCount; index++) {
      const { data: applied, error: applyError } = await sb.rpc("acc_apply_bank_feed_page", {
        p_connection_id: connectionId,
        // Each page records what it changed under this run, so the sync can be undone (1.86).
        p_run_id: runId,
        p_added: addedChunks[index] ?? [],
        p_modified: modifiedChunks[index] ?? [],
        p_removed: removedChunks[index] ?? [],
```

- [ ] **Step 6: Run and check.**

Run: `npx vitest run tests/unit/bank-feeds-service.test.ts tests/unit/bank-feeds.test.ts`
Expected: PASS (11 + 10 tests).
Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint lib/services/plaid.ts lib/services/bank-feeds.ts lib/services/banking.ts tests/unit/bank-feeds-service.test.ts`
Expected: no output.

- [ ] **Step 7: Commit.**

```bash
git add lib/services/plaid.ts lib/services/bank-feeds.ts tests/unit/bank-feeds-service.test.ts lib/services/banking.ts
printf 'feat(banking): remove a connection at Plaid before disconnecting; undo a sync\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 4: Disconnect and Bank feed syncs on Banking

**Files:**
- Modify: `app/(app)/banking/actions.ts` (three actions)
- Create: `app/(app)/banking/DisconnectBankModal.tsx`
- Create: `app/(app)/banking/BankFeedSyncList.tsx`
- Modify: `app/(app)/banking/BankingClient.tsx`
- Create: `tests/unit/bank-feed-ui-contract.test.ts`

**Interfaces:**
- Consumes: Task 3's service; Task 2's module; `serverFailure` (`lib/domain/statement-evidence.ts`, 1.85); `DataTable` (`components/ui/DataTable.tsx`).
- Produces (`app/(app)/banking/actions.ts`): `disconnectBankConnectionAction(connectionId: string, reason: string, onlyInOneBook: boolean): Promise<ActionResult<DisconnectOutcome>>`; `bankFeedSyncsAction(bankAccountId: string): Promise<ActionResult<BankFeedSyncView[]>>`; `undoBankFeedSyncAction(runId: string, reason: string): Promise<ActionResult<{ removed: number; restored: number }>>`.

- [ ] **Step 1: The contract test first.** Create `tests/unit/bank-feed-ui-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), "app", "(app)", "banking", file), "utf8");

/**
 * Disconnect and Undo for bank feeds (1.86): what the screens must keep true.
 * A connection is never dropped in OneBook while Plaid keeps it unless the
 * person chose that, and Undo is offered only where the database will accept it.
 */
describe("bank feed screens", () => {
  const modal = read("DisconnectBankModal.tsx");
  const list = read("BankFeedSyncList.tsx");
  const banking = read("BankingClient.tsx");

  it("offers Disconnect in OneBook only after Plaid did not confirm, and only when ticked", () => {
    expect(modal).toMatch(/\{unconfirmed \? \(/);
    expect(modal).toContain("Disconnect in OneBook only");
    expect(modal).toContain("(unconfirmed !== null && !onlyInOneBook)");
    expect(modal).toContain("disconnectBankConnectionAction(connection.id, reason, onlyInOneBook)");
  });

  it("asks a reason before either", () => {
    expect(modal).toContain('reason.trim() === ""');
    expect(list).toContain('reason.trim() === ""');
  });

  it("never leaves a dialog spinning", () => {
    expect(modal).toMatch(/finally \{\s*setBusy\(false\);/);
    expect(list).toMatch(/finally \{\s*setBusy\(false\);/);
  });

  it("offers Undo only where the database will accept it, and says why not", () => {
    expect(list).toContain("syncUndoState(row)");
    expect(list).toContain("disabled={!state.canUndo}");
    expect(list).toContain("<Tooltip title={state.why ?? undefined}>");
    expect(list).toContain("<DataTable<BankFeedSyncView>");
  });

  it("puts Disconnect on the connection card for people who may write, and the syncs under one account", () => {
    expect(banking).toContain("{selectedConnection && canWrite ? (");
    expect(banking).toContain("setDisconnecting(selectedConnection)");
    expect(banking).toContain("{selectedId && !allAccounts ? (");
    expect(banking).toContain("<BankFeedSyncList bankAccountId={selectedId}");
  });
});
```

- [ ] **Step 2: Run it — it fails.**

Run: `npx vitest run tests/unit/bank-feed-ui-contract.test.ts`
Expected: FAIL — `ENOENT` for `DisconnectBankModal.tsx`.

- [ ] **Step 3: The actions.** In `app/(app)/banking/actions.ts` apply these edits:

Edit 1 of 2 — find:

```ts
import { codeFromSuggestions, codingSuggestions, type CodeItem, type CodeOutcome } from "@/lib/services/coding";
import { loanSuggestions, postLoanPayment } from "@/lib/services/loan-payments";
import { tieKeptStatementFile } from "@/lib/services/statement-files";

export interface ActionResult<T = undefined> {
  ok: boolean;
```

replace with:

```ts
import { codeFromSuggestions, codingSuggestions, type CodeItem, type CodeOutcome } from "@/lib/services/coding";
import { loanSuggestions, postLoanPayment } from "@/lib/services/loan-payments";
import { tieKeptStatementFile } from "@/lib/services/statement-files";
import { disconnectBankConnection, listBankFeedSyncs, undoBankFeedSync, type DisconnectOutcome } from "@/lib/services/bank-feeds";
import type { BankFeedSyncView } from "@/lib/domain/bank-feeds";

export interface ActionResult<T = undefined> {
  ok: boolean;
```

Edit 2 of 2 — find:

```ts
  }
}

export interface SettlementCandidatesView {
  direction: "receivable" | "payable";
  currencyCode: string;
```

replace with:

```ts
  }
}

/**
 * Removes a bank connection at Plaid, then disconnects it here (1.86). When
 * Plaid does not confirm, nothing changes and the answer says so, unless the
 * person ticked Disconnect in OneBook only. The lines it brought in stay.
 */
export async function disconnectBankConnectionAction(
  connectionId: string,
  reason: string,
  onlyInOneBook: boolean,
): Promise<ActionResult<DisconnectOutcome>> {
  const denied = await guardPermission("bank_feed.manage");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const outcome = await disconnectBankConnection(sb, connectionId, reason, onlyInOneBook);
    if (outcome.disconnected) revalidatePath("/banking");
    return { ok: true, data: outcome };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** The syncs of every connection that ever fed this bank account, newest first. Reads only. */
export async function bankFeedSyncsAction(bankAccountId: string): Promise<ActionResult<BankFeedSyncView[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listBankFeedSyncs(sb, bankAccountId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Takes one bank-feed sync back; the lines it added do not come back with the next sync. */
export async function undoBankFeedSyncAction(
  runId: string,
  reason: string,
): Promise<ActionResult<{ removed: number; restored: number }>> {
  const denied = await guardPermission("bank_feed.manage");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const result = await undoBankFeedSync(sb, runId, reason);
    revalidatePath("/banking");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export interface SettlementCandidatesView {
  direction: "receivable" | "payable";
  currencyCode: string;
```

- [ ] **Step 4: The Disconnect dialog.** Create `app/(app)/banking/DisconnectBankModal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Alert, App, Checkbox, Input, Modal, Typography } from "antd";
import { disconnectedMessage } from "@/lib/domain/bank-feeds";
import { serverFailure } from "@/lib/domain/statement-evidence";
import { disconnectBankConnectionAction } from "./actions";

export interface DisconnectBankModalProps {
  /** The connection to disconnect; null keeps the dialog closed. */
  connection: { id: string; institution_name: string } | null;
  onClose: () => void;
  onDisconnected: () => void;
}

/**
 * Disconnect a bank feed (1.86). The connection is removed at Plaid first;
 * when Plaid does not confirm, nothing changes and the dialog says why and
 * offers to disconnect in OneBook only — never silently, because a connection
 * Plaid still holds keeps running (and, on a paid plan, billing) unseen.
 */
export default function DisconnectBankModal({ connection, onClose, onDisconnected }: DisconnectBankModalProps) {
  const { message } = App.useApp();
  const [reason, setReason] = useState("");
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [onlyInOneBook, setOnlyInOneBook] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setReason("");
    setUnconfirmed(null);
    setOnlyInOneBook(false);
    onClose();
  };

  const confirm = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      const result = await disconnectBankConnectionAction(connection.id, reason, onlyInOneBook);
      if (!result.ok || !result.data) {
        message.error(result.error ?? "Could not disconnect this bank", 10);
        return;
      }
      if (!result.data.disconnected) {
        setUnconfirmed(result.data.unconfirmed);
        return;
      }
      message.success(disconnectedMessage(connection.institution_name, result.data.confirmedByPlaid), 8);
      close();
      onDisconnected();
    } catch (error) {
      message.error(`Could not disconnect this bank: ${serverFailure(error)}`, 10);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={connection !== null}
      title={`Disconnect ${connection?.institution_name ?? "this bank"}?`}
      okText={unconfirmed && onlyInOneBook ? "Disconnect in OneBook only" : "Disconnect"}
      okButtonProps={{ danger: true, loading: busy, disabled: reason.trim() === "" || (unconfirmed !== null && !onlyInOneBook) }}
      onOk={() => void confirm()}
      onCancel={close}
      destroyOnHidden
    >
      <Typography.Paragraph>
        Plaid stops sending this bank&apos;s transactions. The lines already here stay. You can connect the bank again.
      </Typography.Paragraph>
      <Input.TextArea
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="The bank closed this account"
      />
      {unconfirmed ? (
        <>
          <Alert type="warning" showIcon style={{ marginTop: 12 }} title={unconfirmed} />
          <Checkbox style={{ marginTop: 8 }} checked={onlyInOneBook} onChange={(event) => setOnlyInOneBook(event.target.checked)}>
            Disconnect in OneBook only
          </Checkbox>
        </>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 5: Bank feed syncs.** Create `app/(app)/banking/BankFeedSyncList.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Input, Modal, Space, Tag, Tooltip, Typography } from "antd";
import DataTable from "@/components/ui/DataTable";
import {
  SYNC_STATUS_LABEL,
  syncUndoState,
  undoSyncWarning,
  undoneSyncMessage,
  type BankFeedSyncStatus,
  type BankFeedSyncView,
} from "@/lib/domain/bank-feeds";
import { serverFailure } from "@/lib/domain/statement-evidence";
import { bankFeedSyncsAction, undoBankFeedSyncAction } from "./actions";

export interface BankFeedSyncListProps {
  bankAccountId: string;
  canWrite: boolean;
  /** Bumped by the screen after anything that can change the list. */
  reloadKey: number;
  onChanged: () => void;
}

const STATUS_COLOR: Record<BankFeedSyncStatus, string | undefined> = {
  running: "blue",
  succeeded: "green",
  failed: "orange",
  undone: undefined,
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Bank feed syncs, and the way back out of one (1.86). Shown only for an
 * account a bank feed has fed. Undo is offered on one sync at a time — the
 * connection's newest that changed something — and the button says why when
 * it is shut instead of failing when pressed.
 */
export default function BankFeedSyncList({ bankAccountId, canWrite, reloadKey, onChanged }: BankFeedSyncListProps) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<BankFeedSyncView[]>([]);
  const [undoing, setUndoing] = useState<BankFeedSyncView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void bankFeedSyncsAction(bankAccountId).then((result) => {
      if (result.ok && result.data) setRows(result.data);
    });
  }, [bankAccountId]);

  useEffect(refresh, [refresh, reloadKey]);

  const close = () => {
    setUndoing(null);
    setReason("");
  };

  const confirmUndo = async () => {
    if (!undoing) return;
    setBusy(true);
    try {
      const result = await undoBankFeedSyncAction(undoing.runId, reason);
      if (!result.ok || !result.data) {
        message.error(result.error ?? "Could not undo this sync", 10);
        return;
      }
      message.success(undoneSyncMessage(result.data), 8);
      close();
      refresh();
      onChanged();
    } catch (error) {
      message.error(`Could not undo this sync: ${serverFailure(error)}`, 10);
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return null;

  return (
    <Card size="small" title="Bank feed syncs" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
      <DataTable<BankFeedSyncView>
        rowKey="runId"
        dataSource={rows}
        columns={[
          { title: "Started", dataIndex: "startedAt", width: 190, render: (value: string) => when(value) },
          {
            title: "Bank",
            dataIndex: "institutionName",
            render: (name: string, row) => (
              <Space size={6}>
                <span>{name}</span>
                {row.connectionStatus === "disconnected" ? <Tag>disconnected</Tag> : null}
              </Space>
            ),
          },
          {
            title: "Status",
            dataIndex: "status",
            width: 120,
            render: (status: BankFeedSyncStatus, row) => {
              const tag = <Tag color={STATUS_COLOR[status]}>{SYNC_STATUS_LABEL[status]}</Tag>;
              const note = status === "failed" ? row.errorMessage : status === "undone" ? row.undoReason : null;
              return note ? <Tooltip title={note}>{tag}</Tooltip> : tag;
            },
          },
          { title: "Added", dataIndex: "added", width: 90, align: "right" },
          { title: "Changed", dataIndex: "modified", width: 90, align: "right" },
          { title: "Removed", dataIndex: "removed", width: 90, align: "right" },
          {
            title: "",
            key: "undo",
            width: 100,
            align: "right",
            render: (_, row) => {
              if (!canWrite || row.status === "undone") return null;
              const state = syncUndoState(row);
              return (
                <Tooltip title={state.why ?? undefined}>
                  <Button size="small" danger disabled={!state.canUndo} onClick={() => setUndoing(row)}>
                    Undo
                  </Button>
                </Tooltip>
              );
            },
          },
        ]}
      />
      <Modal
        open={undoing !== null}
        title={`Undo the sync of ${undoing ? when(undoing.startedAt) : ""}?`}
        okText="Undo the sync"
        okButtonProps={{ danger: true, loading: busy, disabled: reason.trim() === "" }}
        onOk={() => void confirmUndo()}
        onCancel={close}
        destroyOnHidden
      >
        <Typography.Paragraph>{undoing ? undoSyncWarning(undoing) : null}</Typography.Paragraph>
        <Input.TextArea
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="These lines were already imported from a statement"
        />
      </Modal>
    </Card>
  );
}
```

- [ ] **Step 6: On Banking.** In `app/(app)/banking/BankingClient.tsx` apply these edits:

Edit 1 of 4 — find:

```tsx
import { EmptyState } from "@/components/ui/PageStates";
import BankTransactionsTable from "./BankTransactionsTable";
import BankImportList from "./BankImportList";
import dynamic from "next/dynamic";
import DeleteBankLineModal, {
  type DeleteBankLineTarget,
```

replace with:

```tsx
import { EmptyState } from "@/components/ui/PageStates";
import BankTransactionsTable from "./BankTransactionsTable";
import BankImportList from "./BankImportList";
import BankFeedSyncList from "./BankFeedSyncList";
import DisconnectBankModal from "./DisconnectBankModal";
import dynamic from "next/dynamic";
import DeleteBankLineModal, {
  type DeleteBankLineTarget,
```

Edit 2 of 4 — find:

```tsx
  const [settleTarget, setSettleTarget] = useState<SettleTarget | null>(null);
  // Bumped after an import so the register below picks the new batch up.
  const [importsKey, setImportsKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DeleteBankLineTarget | null>(null);
  // RQ-03: the raw picks a reader has made. Never read directly — always
  // through the `selectedIds` projection below, which is what stays true to
```

replace with:

```tsx
  const [settleTarget, setSettleTarget] = useState<SettleTarget | null>(null);
  // Bumped after an import so the register below picks the new batch up.
  const [importsKey, setImportsKey] = useState(0);
  const [disconnecting, setDisconnecting] = useState<BankConnectionView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteBankLineTarget | null>(null);
  // RQ-03: the raw picks a reader has made. Never read directly — always
  // through the `selectedIds` projection below, which is what stays true to
```

Edit 3 of 4 — find:

```tsx
            </Tag>
          ) : null}
          {plaidEnvironment !== "production" ? <Tag color="blue">{plaidEnvironment}</Tag> : null}
        </Space>
        {selectedConnection?.last_error ? (
          <Alert type="warning" showIcon message="The last synchronization needs attention" description={selectedConnection.last_error} style={{ marginTop: 12 }} />
```

replace with:

```tsx
            </Tag>
          ) : null}
          {plaidEnvironment !== "production" ? <Tag color="blue">{plaidEnvironment}</Tag> : null}
          {selectedConnection && canWrite ? (
            <Button size="small" type="link" danger onClick={() => setDisconnecting(selectedConnection)}>
              Disconnect
            </Button>
          ) : null}
        </Space>
        {selectedConnection?.last_error ? (
          <Alert type="warning" showIcon message="The last synchronization needs attention" description={selectedConnection.last_error} style={{ marginTop: 12 }} />
```

Edit 4 of 4 — find:

```tsx
        />
      </Card>

      <CodeAllModal
        rows={codeAllRows}
        onClose={() => setCodeAllRows(null)}
```

replace with:

```tsx
        />
      </Card>

      {/* One account's feed at a time, as Sync now: a sync belongs to a connection, and a connection to accounts. */}
      {selectedId && !allAccounts ? (
        <BankFeedSyncList bankAccountId={selectedId} canWrite={canWrite} reloadKey={importsKey} onChanged={reload} />
      ) : null}

      <DisconnectBankModal
        connection={disconnecting}
        onClose={() => setDisconnecting(null)}
        onDisconnected={() => window.location.reload()}
      />

      <CodeAllModal
        rows={codeAllRows}
        onClose={() => setCodeAllRows(null)}
```

- [ ] **Step 7: Run and check.**

Run: `npx vitest run tests/unit/bank-feed-ui-contract.test.ts tests/unit/table-adoption.test.ts tests/unit/bank-categories-ui-contract.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: no errors.
Run: `npx eslint "app/(app)/banking/actions.ts" "app/(app)/banking/DisconnectBankModal.tsx" "app/(app)/banking/BankFeedSyncList.tsx" "app/(app)/banking/BankingClient.tsx" tests/unit/bank-feed-ui-contract.test.ts`
Expected: no output.

- [ ] **Step 8: Commit.**

```bash
git add "app/(app)/banking/actions.ts" "app/(app)/banking/DisconnectBankModal.tsx" "app/(app)/banking/BankFeedSyncList.tsx" "app/(app)/banking/BankingClient.tsx" tests/unit/bank-feed-ui-contract.test.ts
printf 'feat(banking): Disconnect on the bank connection; Bank feed syncs with Undo\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 5: Changelog 1.86, the guide, the whole suite

**Files:**
- Modify: `lib/domain/changelog.ts` (a new first entry of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (two banking steps)

- [ ] **Step 1: The release.** In `lib/domain/changelog.ts` apply this edit:

Edit 1 of 1 — find:

```ts

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.85",
    date: "2026-10-07",
```

replace with:

```ts

/** Newest first. That is the order they are read in, so it is the order stored. */
export const RELEASES: Release[] = [
  {
    version: "1.86",
    date: "2026-10-07",
    headline: "A bank feed can be disconnected, and a bank-feed sync can be undone.",
    changes: [
      {
        kind: "added",
        title: "Disconnect a bank feed",
        detail:
          "The bank connection on Banking has Disconnect. It removes the connection at Plaid, then in OneBook; the lines already in Bank Transactions stay, and the account can be connected again. A connection whose sync failed no longer stays \"attention required\" for good. If Plaid does not confirm the removal, nothing changes and the dialog says why, unless you tick Disconnect in OneBook only — the connection then keeps a note that Plaid was not told.",
        route: "/banking",
      },
      {
        kind: "added",
        title: "Undo a bank-feed sync",
        detail:
          "Bank feed syncs, below the bank connection, lists the syncs that changed something. Undo takes back the newest: the lines it added are removed, and the lines it changed or removed come back as they were. Syncs are taken back newest first, and a sync is held while a line it added has been matched, coded or ignored. Undone lines do not come back with the next sync; to fetch them again, disconnect the bank and connect it again.",
        route: "/banking",
      },
    ],
  },
  {
    version: "1.85",
    date: "2026-10-07",
```

- [ ] **Step 2: The guide.** In `lib/domain/system-guide.ts` apply this edit:

Edit 1 of 1 — find:

```ts
          "have been read: check the statement, then Import anyway or use the bank's CSV. A scanned PDF has " +
          "no text to read.",
      },
      {
        action: "Match lines to the ledger",
        control: "Suggest matches",
```

replace with:

```ts
          "have been read: check the statement, then Import anyway or use the bank's CSV. A scanned PDF has " +
          "no text to read.",
      },
      {
        action: "Take back a bank-feed sync",
        control: "Undo",
        route: "/banking",
        note:
          "Under Bank feed syncs, Undo takes back the newest sync that changed something: the lines it added go, " +
          "and the lines it changed or removed come back as they were. Syncs are taken back newest first, and a " +
          "sync is held while a line it added is matched, coded or ignored. The next sync does not bring the lines " +
          "back; to fetch them again, disconnect the bank and connect it again.",
      },
      {
        action: "Disconnect a bank feed",
        control: "Disconnect",
        route: "/banking",
        note:
          "Removes the connection at Plaid, then here. The lines already in Bank Transactions stay, and the account " +
          "can be connected again. If Plaid does not confirm the removal, nothing changes unless you tick " +
          "Disconnect in OneBook only.",
      },
      {
        action: "Match lines to the ledger",
        control: "Suggest matches",
```

- [ ] **Step 3: The whole suite and the build.**

Run: `npm run typecheck`, `npm run lint`, then `npm test`
Expected: no type errors; lint 0 errors (old warnings stay); every test file passes — the changelog and guide tests included (`APP_VERSION` is now 1.86, every route the release names exists). `tests/unit/quality-query-timing.test.ts` can fail when the machine is busy; if it alone fails, run it on its own and report both results.
Run: `npm run build` — Expected: `Compiled successfully`, exit code 0.
Run: `npm run quality:bundle`, then `npm run quality:budget` — Expected: `11 within budget, 0 over`, exit code 0.

- [ ] **Step 4: Commit.**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
printf 'docs(changelog): 1.86 disconnect a bank feed; undo a bank-feed sync\n' > ../.superpowers/sdd/commit-msg.txt
od -c ../.superpowers/sdd/commit-msg.txt | head -1
git commit -F ../.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Live (controller)

No new code. Every step that writes to the live database waits for the user.

- [ ] **Step 1:** Ask the user to approve applying 0137 to every company. Only then run `node --env-file=.env.local scripts/migrate.mjs`, run `scripts/verify-bank-feed-undo.mjs` again (rolled back) and `npm run verify:company-provisioning`.
- [ ] **Step 2:** On the sample company PC-Test only, a simulated connection (local has no Plaid keys): a demo bank account mapped through `acc_save_bank_connection` with an invented token, and two syncs written through `acc_begin_bank_feed_sync` / `acc_apply_bank_feed_page` / `acc_finish_bank_feed_sync` with invented lines, as PC-Test's administrator.
- [ ] **Step 3:** In a real browser (`next start` started detached with its working directory set): Bank feed syncs lists both; Undo on the older says to undo the newer first; Undo on the newer removes its lines and restores the ones it retired; then the older; Disconnect is refused for want of Plaid keys, the checkbox appears, Disconnect in OneBook only disconnects it; the card reads "No direct feed for this account" and offers Connect bank; the syncs stay listed.
- [ ] **Step 4:** Screenshots of each, light and dark, scrolled to the top before each full-page shot; an approval page beside them. Nothing is pushed until the user approves.
- [ ] **Step 5:** Ask the user whether what the check recorded on PC-Test stays as the sample company's history. After the merge, offer to try Disconnect against Plaid Sandbox on production.
