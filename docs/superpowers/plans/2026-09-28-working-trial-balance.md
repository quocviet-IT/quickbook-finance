# Working Trial Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the prototype's working-paper trial balance — unadjusted, adjustments, adjusted — with a way to mark any posted entry as adjusting (with a reason), depreciation marked automatically, and no figure in the books changed by any of it.

**Architecture:** A side table `acc_adjusting_entry` (migration 0124) holds the marks, written only by two `security definer` RPCs and one insert trigger for depreciation. A pure domain module turns `acc_ledger_balances` (before and during the range) plus the marked entries into the three column pairs; a service reads them; a report page lays them out with the 1.64 report components. The checkbox lives in the Journal screen's expanded row.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Ant Design 6, Supabase (Postgres + PostgREST), Vitest, `pg` for the rollback verification script, Playwright for screenshots.

**Spec:** `docs/superpowers/specs/2026-09-26-working-trial-balance-design.md` (revised 2026-09-28).

## Global Constraints

- Everything a user reads is US English; base currency USD; "Accrual basis".
- Money is integer minor units until display (`formatMoney` / `fromMinor`).
- No hex colour in any source file, comments included (`tests/unit/no-hardcoded-color.test.ts`); use `var(--ob-…)` tokens.
- A new list is `DataTable`/`ReportTable`; no new file may contain `<Table` — that includes `<Table.Summary.Row>` (`tests/unit/table-adoption.test.ts`). `JournalClient.tsx` is already on the allowlist and may keep its tables.
- A `page.tsx` (Server Component) never reads an Ant Design sub-component (`tests/unit/rsc-antd.test.ts`).
- Never write a real customer's name or figure into tests, docs or code (`tests/unit/customer-data.test.ts`).
- Every read of a table or set-returning RPC is paged past PostgREST's 1,000-row cap.
- Write any file containing a backslash with the Write/Edit tool, never a shell heredoc.
- Commits: stage files by name (never `git add -A` / `git add .`), a one-line subject in the repo's style, **no Co-Authored-By trailer**. Write the message to a file and `git commit -F`.
- Migration 0124 must be applied to the database **before** this branch reaches `main`: Vercel deploys `main`, and the Journal screen's list embeds `acc_adjusting_entry`.
- Run commands from `ctyhp-accounting/` unless a step says otherwise.

---

### Task 1: Migration 0124 and its static gate

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0124_adjusting_entries.sql`
- Test: `ctyhp-accounting/tests/unit/adjusting-entries-migration.test.ts`

**Interfaces:**
- Produces (database): table `acc_adjusting_entry(journal_entry_id uuid pk, note text null, marked_by uuid null, marked_at timestamptz)`; `acc_mark_adjusting(p_entry_id uuid, p_note text, p_confirm_closed boolean default false) returns void`; `acc_unmark_adjusting(p_entry_id uuid, p_confirm_closed boolean default false) returns void`; closed-period refusal message exactly `closed_period:YYYY-MM-DD:YYYY-MM-DD` (entry date, end of its closed period); `acc_closed_period_end(p_date date) returns date`; trigger `acc_journal_entry_depreciation_adjusting`.

- [ ] **Step 1: Write the failing static test**

`ctyhp-accounting/tests/unit/adjusting-entries-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Migration 0124, read as text. The promise it makes — marking an entry moves
 * it between two columns of one report and changes no figure — is checked here
 * against the SQL itself, and on the real database by
 * scripts/verify-adjusting-entries.mjs.
 */
const RAW = readFileSync("supabase/migrations/0124_adjusting_entries.sql", "utf8");

/** The SQL without comments, lower-cased, so a word in a comment can neither pass nor fail a check. */
const SQL = RAW.replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .toLowerCase();

describe("0124 adjusting entries migration", () => {
  it("writes to no table but the marks and the audit log", () => {
    const targets = [...SQL.matchAll(/\b(?:insert\s+into|delete\s+from|update)\s+([a-z_][a-z0-9_.]*)/g)].map(
      (m) => m[1],
    );
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets)).toEqual(new Set(["acc_adjusting_entry", "acc_audit_log"]));
  });

  it("changes no posting function and no ledger table", () => {
    expect(SQL).not.toMatch(/function\s+acc_post_/);
    expect(SQL).not.toMatch(/acc_post_entry\s*\(/);
    expect(SQL).not.toMatch(/alter\s+table\s+acc_journal_(entry|line)\b/);
  });

  it("gives the marks a read policy and no write policy", () => {
    expect(SQL).toMatch(/alter table acc_adjusting_entry enable row level security/);
    expect(SQL).toMatch(/create policy acc_adjusting_entry_read on acc_adjusting_entry\s+for select/);
    expect(SQL).not.toMatch(/\bfor\s+(insert|update|delete|all)\b/);
  });

  it("marks depreciation as it is inserted, and nothing else", () => {
    expect(SQL).toMatch(
      /after insert on acc_journal_entry\s+for each row\s+when \(new\.source_type = 'depreciation'\)/,
    );
  });

  it("asks before touching a closed period, in the form the screen reads", () => {
    expect(SQL.match(/raise exception 'closed_period:%:%'/g)).toHaveLength(2);
  });

  it("lets only a signed-in session call the two functions", () => {
    for (const fn of ["acc_mark_adjusting(uuid, text, boolean)", "acc_unmark_adjusting(uuid, boolean)"]) {
      expect(SQL).toContain(`revoke all on function ${fn} from public, anon;`);
      expect(SQL).toContain(`grant execute on function ${fn} to authenticated;`);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/adjusting-entries-migration.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'supabase/migrations/0124_adjusting_entries.sql'`.

- [ ] **Step 3: Write the migration**

`ctyhp-accounting/supabase/migrations/0124_adjusting_entries.sql`:

```sql
-- ============================================================================
-- 0124  Adjusting entries: the middle column of the working trial balance
--
-- From the client's prototype (Accounting-System-v3.html, "working-paper trial
-- balance"): "An entry counts as an adjustment because somebody marked it one -
-- not because of its date or its shape - so the middle column is a decision,
-- which is what makes it worth reviewing."
--
-- The mark lives in a table of its own. Marking or unmarking an entry touches
-- no journal entry and no journal line: it moves the entry between two columns
-- of one report and changes no balance anywhere. The table has a read policy
-- and no write policy; it is written only by the two functions below and by
-- the depreciation trigger.
--
-- Depreciation is an adjusting entry, as the prototype posts it. It is marked
-- by a trigger as the entry is inserted, rather than by redefining
-- acc_post_asset_depreciation, so no posting function changes here.
-- ============================================================================

set search_path = public;

-- on delete cascade: the books never delete an entry, but test cleanup run
-- with the service role does, and a mark must not stand in its way.
create table if not exists acc_adjusting_entry (
  journal_entry_id uuid primary key references acc_journal_entry (id) on delete cascade,
  note             text check (note is null or length(btrim(note)) between 1 and 500),
  marked_by        uuid references auth.users (id),
  marked_at        timestamptz not null default now()
);

alter table acc_adjusting_entry enable row level security;

drop policy if exists acc_adjusting_entry_read on acc_adjusting_entry;
create policy acc_adjusting_entry_read on acc_adjusting_entry
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy: an application session writes this
-- table only through the functions below.
revoke all on table acc_adjusting_entry from public, anon;
grant select on table acc_adjusting_entry to authenticated;
grant all    on table acc_adjusting_entry to service_role;

-- The last day of the closed period a date falls in, or null when it is open.
create or replace function acc_closed_period_end(p_date date) returns date
language sql stable set search_path = public as $$
  select period_end
    from acc_accounting_period
   where p_date between period_start and period_end
     and status = 'closed'
   limit 1;
$$;

revoke all on function acc_closed_period_end(date) from public, anon;
grant execute on function acc_closed_period_end(date) to authenticated;

-- Mark an entry adjusting, or change the note of one that already is.
--
-- The prototype's two handlers: ticking "adjusting entry" asks once before it
-- alters a closed period ("allowChange"); typing the note just saves it.
create or replace function acc_mark_adjusting(
  p_entry_id       uuid,
  p_note           text,
  p_confirm_closed boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry  acc_journal_entry%rowtype;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_before text;
  v_marked boolean;
  v_closed date;
begin
  if not acc_has_permission('journal.post') then
    raise exception 'permission denied: marking an adjusting entry needs journal.post';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'The note is longer than 500 characters';
  end if;

  select * into v_entry from acc_journal_entry where id = p_entry_id;
  if not found then
    raise exception 'That entry is not in the books';
  end if;
  if v_entry.status <> 'posted' then
    raise exception 'Only a posted entry can be marked adjusting; % is %', v_entry.entry_number, v_entry.status;
  end if;

  select true, a.note into v_marked, v_before
    from acc_adjusting_entry a
   where a.journal_entry_id = p_entry_id;
  v_closed := acc_closed_period_end(v_entry.entry_date);

  if coalesce(v_marked, false) then
    update acc_adjusting_entry set note = v_note where journal_entry_id = p_entry_id;
    insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_adjusting_entry', p_entry_id, 'edit_adjusting_note', auth.uid(),
            jsonb_build_object('entry_number', v_entry.entry_number, 'note', v_before),
            jsonb_build_object('entry_number', v_entry.entry_number, 'note', v_note,
                               'closed_period', v_closed is not null));
    return;
  end if;

  if v_closed is not null and not coalesce(p_confirm_closed, false) then
    raise exception 'closed_period:%:%',
      to_char(v_entry.entry_date, 'YYYY-MM-DD'), to_char(v_closed, 'YYYY-MM-DD');
  end if;

  insert into acc_adjusting_entry (journal_entry_id, note, marked_by)
  values (p_entry_id, v_note, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_adjusting_entry', p_entry_id, 'mark_adjusting', auth.uid(), null,
          jsonb_build_object('entry_number', v_entry.entry_number, 'note', v_note,
                             'closed_period', v_closed is not null));
end;
$$;

revoke all on function acc_mark_adjusting(uuid, text, boolean) from public, anon;
grant execute on function acc_mark_adjusting(uuid, text, boolean) to authenticated;

-- Take the mark off, and its note with it, as the prototype's toggle does.
create or replace function acc_unmark_adjusting(
  p_entry_id       uuid,
  p_confirm_closed boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry  acc_journal_entry%rowtype;
  v_before text;
  v_marked boolean;
  v_closed date;
begin
  if not acc_has_permission('journal.post') then
    raise exception 'permission denied: unmarking an adjusting entry needs journal.post';
  end if;

  select * into v_entry from acc_journal_entry where id = p_entry_id;
  if not found then
    raise exception 'That entry is not in the books';
  end if;

  select true, a.note into v_marked, v_before
    from acc_adjusting_entry a
   where a.journal_entry_id = p_entry_id;
  if not coalesce(v_marked, false) then
    return;
  end if;

  v_closed := acc_closed_period_end(v_entry.entry_date);
  if v_closed is not null and not coalesce(p_confirm_closed, false) then
    raise exception 'closed_period:%:%',
      to_char(v_entry.entry_date, 'YYYY-MM-DD'), to_char(v_closed, 'YYYY-MM-DD');
  end if;

  delete from acc_adjusting_entry where journal_entry_id = p_entry_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_adjusting_entry', p_entry_id, 'unmark_adjusting', auth.uid(),
          jsonb_build_object('entry_number', v_entry.entry_number, 'note', v_before,
                             'closed_period', v_closed is not null),
          null);
end;
$$;

revoke all on function acc_unmark_adjusting(uuid, boolean) from public, anon;
grant execute on function acc_unmark_adjusting(uuid, boolean) to authenticated;

-- Depreciation is marked as it posts, from whichever of its three paths - one
-- asset, the batch, the catch-up charge on disposal - and any added later. The
-- note is the entry's own description. Only the insert is watched, so a user
-- may still unmark one.
create or replace function acc_mark_depreciation_adjusting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into acc_adjusting_entry (journal_entry_id, note, marked_by)
  values (new.id, nullif(left(btrim(coalesce(new.description, '')), 500), ''), null)
  on conflict (journal_entry_id) do nothing;
  return new;
end;
$$;

revoke all on function acc_mark_depreciation_adjusting() from public, anon, authenticated;

drop trigger if exists acc_journal_entry_depreciation_adjusting on acc_journal_entry;
create trigger acc_journal_entry_depreciation_adjusting
  after insert on acc_journal_entry
  for each row when (new.source_type = 'depreciation')
  execute function acc_mark_depreciation_adjusting();

-- Depreciation already in the books was an adjusting entry under the
-- prototype's definition when it was posted.
insert into acc_adjusting_entry (journal_entry_id, note, marked_by)
select e.id, nullif(left(btrim(coalesce(e.description, '')), 500), ''), null
  from acc_journal_entry e
 where e.source_type = 'depreciation'
   and e.status = 'posted'
on conflict (journal_entry_id) do nothing;
```

- [ ] **Step 4: Run the static test and the migration gates**

Run: `npx vitest run tests/unit/adjusting-entries-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/schema-template.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -- supabase/migrations/0124_adjusting_entries.sql tests/unit/adjusting-entries-migration.test.ts
printf '%s\n' "feat(adjusting): a mark in its own table, written only by two functions and the depreciation trigger" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

(`$SCRATCH` is the session scratchpad directory.)

---

### Task 2: Prove the migration on the real database, and roll it back

**Files:**
- Create: `ctyhp-accounting/scripts/verify-adjusting-entries.mjs`

**Interfaces:**
- Consumes: migration 0124 from Task 1 (read from disk and applied inside each scenario's transaction when not yet applied); `acc_post_entry(p_entry_date, p_description, p_source_type, p_source_id, p_currency, p_lines jsonb)`.
- Produces: `node --env-file=.env.local scripts/verify-adjusting-entries.mjs`, exit 0 on success. Re-run in Task 10 after the migration is applied.

- [ ] **Step 1: Write the script**

`ctyhp-accounting/scripts/verify-adjusting-entries.mjs`:

```js
/**
 * Behavioural verification of adjusting entries (migration 0124).
 *
 * Every scenario runs inside its own transaction and is ROLLED BACK. When the
 * migration has not been applied yet, each scenario applies it first, inside
 * that same transaction — so this proves the migration against the real
 * database before it is applied for real, and leaves nothing behind either way.
 *
 * Run: node --env-file=.env.local scripts/verify-adjusting-entries.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/0124_adjusting_entries.sql", import.meta.url),
  "utf8",
);

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const ADMIN =
  process.env.ADMIN_USER_ID ??
  (
    await client.query(
      `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
    )
  ).rows[0]?.id;
if (!ADMIN) {
  console.error("No active admin to authenticate as; set ADMIN_USER_ID.");
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

async function as(userId) {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function scenario(name, body) {
  console.log(`\n== ${name}`);
  await client.query("begin");
  try {
    const applied = (await one(`select to_regclass('acc_adjusting_entry') is not null as ok`)).ok;
    if (!applied) await client.query(MIGRATION);
    await as(ADMIN);
    await body();
  } catch (error) {
    failed++;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback");
  }
}

/** Runs a statement expected to fail and returns its message, without aborting the transaction. */
async function refusal(sql, params = []) {
  await client.query("savepoint expect_refusal");
  try {
    await client.query(sql, params);
    await client.query("release savepoint expect_refusal");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint expect_refusal");
    return error.message;
  }
}

/** Every journal entry and line, reduced to two values that move if any row does. */
async function ledgerFingerprint() {
  return one(`
    select
      (select md5(coalesce(string_agg(e.id::text || '|' || e.status || '|' || e.entry_date || '|' ||
                                      coalesce(e.description, ''), ',' order by e.id), ''))
         from acc_journal_entry e) as entries,
      (select md5(coalesce(string_agg(l.id::text || '|' || l.account_id || '|' || l.debit_minor || '|' ||
                                      l.credit_minor || '|' || l.amount_base_minor, ',' order by l.id), ''))
         from acc_journal_line l) as lines`);
}

/** A small balanced entry: an expense accrued against a liability. */
async function postProbe({ sourceType = "manual", description = "Adjusting-entry probe" } = {}) {
  const a = await one(`
    select
      (select id from acc_account where account_type = 'expense' and is_posting_account
         and status = 'active' order by account_code limit 1) as expense,
      (select id from acc_account where account_type = 'current_liability' and is_posting_account
         and status = 'active' order by account_code limit 1) as liability,
      (select code from acc_currency where is_base limit 1) as currency`);
  const lines = [
    { account_id: a.expense, debit_minor: 12_345, credit_minor: 0, amount_base_minor: 12_345 },
    { account_id: a.liability, debit_minor: 0, credit_minor: 12_345, amount_base_minor: 12_345 },
  ];
  return (
    await one(
      `select acc_post_entry(current_date, $1, $2::acc_journal_source, null, $3, $4::jsonb) as id`,
      [description, sourceType, a.currency, JSON.stringify(lines)],
    )
  ).id;
}

const markOf = (id) => one(`select note, marked_by from acc_adjusting_entry where journal_entry_id = $1`, [id]);

await scenario("marking and unmarking an entry changes no ledger row", async () => {
  const id = await postProbe();
  const before = await ledgerFingerprint();

  await client.query(`select acc_mark_adjusting($1, $2)`, [id, "Accrued audit fee"]);
  const mark = await markOf(id);
  check("the entry is marked, with its note", mark?.note === "Accrued audit fee", JSON.stringify(mark));
  check("the mark names who made it", mark?.marked_by === ADMIN, JSON.stringify(mark));

  await client.query(`select acc_mark_adjusting($1, $2)`, [id, "Accrued audit fee, year end"]);
  const again = await one(
    `select count(*)::int as n, max(note) as note from acc_adjusting_entry where journal_entry_id = $1`,
    [id],
  );
  check("marking again replaces only the note", again.n === 1 && again.note === "Accrued audit fee, year end", JSON.stringify(again));

  await client.query(`select acc_unmark_adjusting($1)`, [id]);
  check("unmarking removes the mark and its note", !(await markOf(id)));

  const audit = (
    await client.query(
      `select action, before_json from acc_audit_log where table_name = 'acc_adjusting_entry' and record_id = $1`,
      [id],
    )
  ).rows;
  check(
    "each change wrote one audit row",
    JSON.stringify(audit.map((r) => r.action).sort()) ===
      JSON.stringify(["edit_adjusting_note", "mark_adjusting", "unmark_adjusting"]),
    JSON.stringify(audit.map((r) => r.action)),
  );
  const unmarked = audit.find((r) => r.action === "unmark_adjusting");
  check("the unmark audit keeps the note it removed", unmarked?.before_json?.note === "Accrued audit fee, year end");

  const after = await ledgerFingerprint();
  check("no journal entry or line changed", after.entries === before.entries && after.lines === before.lines);
});

await scenario("a blank note is kept as none, and a long one is refused", async () => {
  const id = await postProbe();
  await client.query(`select acc_mark_adjusting($1, $2)`, [id, "   "]);
  check("a blank note is stored as none", (await markOf(id))?.note === null);
  const long = await refusal(`select acc_mark_adjusting($1, $2)`, [id, "x".repeat(501)]);
  check("a note over 500 characters is refused", /500/.test(long ?? ""), long ?? "accepted");
});

await scenario("only someone who may post a journal may mark one", async () => {
  const id = await postProbe();
  await as("00000000-0000-4000-8000-000000000000");
  const marking = await refusal(`select acc_mark_adjusting($1, null)`, [id]);
  const unmarking = await refusal(`select acc_unmark_adjusting($1)`, [id]);
  await as(ADMIN);
  check("marking is refused", /permission/i.test(marking ?? ""), marking ?? "accepted");
  check("unmarking is refused", /permission/i.test(unmarking ?? ""), unmarking ?? "accepted");
});

await scenario("a voided entry cannot be marked", async () => {
  const id = await postProbe();
  await client.query(`update acc_journal_entry set status = 'void' where id = $1`, [id]);
  const text = await refusal(`select acc_mark_adjusting($1, null)`, [id]);
  check("refused, naming why", /posted/i.test(text ?? ""), text ?? "accepted");
});

await scenario("a closed period asks first, and allows once confirmed", async () => {
  const id = await postProbe();
  const month = await one(`
    select to_char(date_trunc('month', current_date), 'YYYY-MM-DD') as first_day,
           to_char(date_trunc('month', current_date) + interval '1 month' - interval '1 day', 'YYYY-MM-DD') as last_day`);
  await client.query(
    `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
     values (extract(year from $1::date)::int, extract(month from $1::date)::int, $1::date, $2::date,
             to_char($1::date, 'YYYY-MM'), 'closed')
     on conflict (period_start) do update set status = 'closed'`,
    [month.first_day, month.last_day],
  );

  const asked = await refusal(`select acc_mark_adjusting($1, $2)`, [id, "Year-end accrual"]);
  check(
    "marking asks first, naming the entry's date and the end of the closed period",
    new RegExp(`^closed_period:\\d{4}-\\d{2}-\\d{2}:${month.last_day}$`).test(asked ?? ""),
    asked ?? "accepted",
  );
  check("nothing is marked while it asks", !(await markOf(id)));

  await client.query(`select acc_mark_adjusting($1, $2, true)`, [id, "Year-end accrual"]);
  const audit = await one(
    `select after_json from acc_audit_log
      where table_name = 'acc_adjusting_entry' and record_id = $1 and action = 'mark_adjusting'`,
    [id],
  );
  check("confirmed, it marks, and the audit says the period was closed", audit?.after_json?.closed_period === true, JSON.stringify(audit));

  await client.query(`select acc_mark_adjusting($1, $2)`, [id, "Year-end accrual, revised"]);
  check("changing the note does not ask again", (await markOf(id))?.note === "Year-end accrual, revised");

  const unmarkAsked = await refusal(`select acc_unmark_adjusting($1)`, [id]);
  check("unmarking asks first", /^closed_period:/.test(unmarkAsked ?? ""), unmarkAsked ?? "accepted");
  await client.query(`select acc_unmark_adjusting($1, true)`, [id]);
  check("confirmed, it unmarks", !(await markOf(id)));
});

await scenario("depreciation is marked as it posts, and nothing else is", async () => {
  const dep = await postProbe({ sourceType: "depreciation", description: "Depreciation PROBE-1 - probe month" });
  const mark = await markOf(dep);
  check(
    "a depreciation entry is marked, with its description as the note, by nobody",
    mark?.note === "Depreciation PROBE-1 - probe month" && mark.marked_by === null,
    JSON.stringify(mark),
  );
  const manual = await postProbe();
  check("a manual entry is not marked", !(await markOf(manual)));
});

await scenario("every depreciation entry already in the books is marked", async () => {
  const missing = await one(`
    select count(*)::int as n from acc_journal_entry e
     where e.source_type = 'depreciation' and e.status = 'posted'
       and not exists (select 1 from acc_adjusting_entry a where a.journal_entry_id = e.id)`);
  check("no posted depreciation entry is left unmarked", missing.n === 0, `${missing.n} unmarked`);
});

await scenario("an application session can read the marks and cannot write them", async () => {
  const id = await postProbe();
  await client.query("set local role authenticated");
  const write = await refusal(`insert into acc_adjusting_entry (journal_entry_id, note) values ($1, 'direct')`, [id]);
  const read = await refusal(`select count(*) from acc_adjusting_entry`);
  await client.query("reset role");
  check("a direct insert is refused", /row-level security|permission denied/i.test(write ?? ""), write ?? "accepted");
  check("reading is allowed", read === null, read ?? "");
});

console.log(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it against the real database (everything is rolled back)**

Run: `node --env-file=.env.local scripts/verify-adjusting-entries.mjs`
Expected: every line `PASS`, last line `N passed, 0 failed`, exit 0. The migration is **not** applied by this run — confirm with `node --env-file=.env.local -e "const pg=require('pg');const c=new pg.Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"select to_regclass('acc_adjusting_entry') t\")).then(r=>{console.log(r.rows[0]);return c.end()})"` → `{ t: null }`.

If the Postgres port is unreachable from this network, say so plainly and continue; Task 10 runs the script again.

- [ ] **Step 3: Commit**

```bash
git add -- scripts/verify-adjusting-entries.mjs
printf '%s\n' "test(adjusting): prove 0124 on the real database inside a transaction that is rolled back" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 3: The three column pairs, as a pure function

**Files:**
- Create: `ctyhp-accounting/lib/domain/working-trial-balance.ts`
- Test: `ctyhp-accounting/tests/unit/working-trial-balance.test.ts`

**Interfaces:**
- Consumes: `LedgerBalance` (`@/lib/domain/reports`), `statementSectionOf` (`@/lib/domain/accounts`).
- Produces: `buildWorkingTrialBalance(input: WorkingTrialBalanceInput): WorkingTrialBalance` and the exported types `AdjustingLine`, `AdjustingEntry`, `WorkingTrialBalanceInput`, `WtbRow`, `WtbTotals`, `AjeRow`, `WorkingTrialBalance`; constants `RETAINED_EARNINGS_KEY`, `RETAINED_EARNINGS_LABEL`. Signed figures are debit-positive minor units.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/working-trial-balance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LedgerBalance } from "@/lib/domain/reports";
import {
  RETAINED_EARNINGS_KEY,
  RETAINED_EARNINGS_LABEL,
  buildWorkingTrialBalance,
  type AdjustingEntry,
  type WorkingTrialBalance,
  type WorkingTrialBalanceInput,
} from "@/lib/domain/working-trial-balance";

type Account = Pick<LedgerBalance, "accountId" | "accountCode" | "name" | "accountType">;
const acct = (accountId: string, accountCode: string, name: string, accountType: Account["accountType"]): Account => ({
  accountId,
  accountCode,
  name,
  accountType,
});
const CASH = acct("cash", "1000", "Cash", "bank");
const PAYABLE = acct("ap", "2000", "Accounts Payable", "accounts_payable");
const ACCRUED = acct("accrued", "2100", "Accrued Liabilities", "current_liability");
const EQUITY = acct("equity", "3000", "Owner's Equity", "equity");
const SALES = acct("sales", "4000", "Sales", "income");
const RENT = acct("rent", "6100", "Rent", "expense");

const bal = (a: Account, debitBase: number, creditBase: number): LedgerBalance => ({ ...a, debitBase, creditBase });

/** 2025: $10,000 put in, $5,000 sold, $2,000 rent paid. */
const BEFORE = [
  bal(CASH, 1_500_000, 200_000),
  bal(PAYABLE, 0, 0),
  bal(ACCRUED, 0, 0),
  bal(EQUITY, 0, 1_000_000),
  bal(SALES, 0, 500_000),
  bal(RENT, 200_000, 0),
];

/** Q1 2026: $4,000 sold, $1,000 rent paid, and $500 of March rent accrued at the quarter end. */
const MOVEMENTS = [
  bal(CASH, 400_000, 100_000),
  bal(PAYABLE, 0, 0),
  bal(ACCRUED, 0, 50_000),
  bal(EQUITY, 0, 0),
  bal(SALES, 0, 400_000),
  bal(RENT, 150_000, 0),
];

const ACCRUAL: AdjustingEntry = {
  entryId: "je-accrual",
  entryNumber: "JE-000120",
  entryDate: "2026-03-31",
  description: "Rent accrual",
  name: "Harbour Property Ltd",
  note: "March rent billed in April",
  lines: [
    { accountId: "rent", accountCode: "6100", accountName: "Rent", accountType: "expense", debitBase: 50_000, creditBase: 0 },
    {
      accountId: "accrued",
      accountCode: "2100",
      accountName: "Accrued Liabilities",
      accountType: "current_liability",
      debitBase: 0,
      creditBase: 50_000,
    },
  ],
};

const Q1 = { from: "2026-01-01", to: "2026-03-31" };
const build = (over: Partial<WorkingTrialBalanceInput> = {}) =>
  buildWorkingTrialBalance({ ...Q1, before: BEFORE, movements: MOVEMENTS, adjusting: [ACCRUAL], ...over });
const row = (r: WorkingTrialBalance, key: string) => r.rows.find((x) => x.key === key);

describe("buildWorkingTrialBalance", () => {
  it("carries a balance-sheet account forward and starts income afresh", () => {
    const r = build();
    expect(row(r, "cash")).toMatchObject({ unadjusted: 1_600_000, adjustment: 0, adjusted: 1_600_000 });
    expect(row(r, "sales")).toMatchObject({ unadjusted: -400_000, adjustment: 0, adjusted: -400_000 });
  });

  it("puts a marked entry in the middle column and only there", () => {
    const r = build();
    expect(row(r, "rent")).toMatchObject({ unadjusted: 100_000, adjustment: 50_000, adjusted: 150_000 });
    expect(row(r, "accrued")).toMatchObject({ unadjusted: 0, adjustment: -50_000, adjusted: -50_000 });
  });

  it("carries the result of earlier periods on one retained-earnings line", () => {
    expect(row(build(), RETAINED_EARNINGS_KEY)).toEqual({
      key: RETAINED_EARNINGS_KEY,
      accountId: null,
      accountCode: "",
      name: RETAINED_EARNINGS_LABEL,
      unadjusted: -300_000,
      adjustment: 0,
      adjusted: -300_000,
    });
  });

  it("balances all three column pairs, which the prototype checks", () => {
    const r = build();
    expect(r.totals).toEqual({
      unadjustedDebit: 1_700_000,
      unadjustedCredit: 1_700_000,
      adjustmentDebit: 50_000,
      adjustmentCredit: 50_000,
      adjustedDebit: 1_750_000,
      adjustedCredit: 1_750_000,
    });
    expect(r.balanced).toBe(true);
  });

  it("lists the balance sheet, then retained earnings, then profit and loss, and leaves out empty accounts", () => {
    expect(build().rows.map((x) => x.key)).toEqual(["cash", "accrued", "equity", RETAINED_EARNINGS_KEY, "sales", "rent"]);
  });

  it("ignores a marked entry dated outside the range", () => {
    const outside: AdjustingEntry = { ...ACCRUAL, entryId: "je-old", entryDate: "2025-12-31" };
    const r = build({ adjusting: [ACCRUAL, outside] });
    expect(row(r, "rent")?.adjustment).toBe(50_000);
    expect(r.adjustingEntryCount).toBe(1);
  });

  it("counts accounts, not the retained-earnings line", () => {
    expect(build().accountCount).toBe(5);
  });

  it("has no retained-earnings line when nothing came before", () => {
    const r = build({ before: [] });
    expect(row(r, RETAINED_EARNINGS_KEY)).toBeUndefined();
    expect(r.balanced).toBe(true);
  });

  it("says so when the columns do not agree", () => {
    const r = build({ movements: [bal(CASH, 100, 0)], before: [], adjusting: [] });
    expect(r.balanced).toBe(false);
  });

  it("is empty, and balanced, for an empty book", () => {
    const r = build({ before: [], movements: [], adjusting: [] });
    expect(r.rows).toEqual([]);
    expect(r.balanced).toBe(true);
    expect(r.adjustments).toEqual([]);
  });
});

describe("the adjustments list", () => {
  const EARLIER: AdjustingEntry = {
    ...ACCRUAL,
    entryId: "je-feb",
    entryNumber: "JE-000090",
    entryDate: "2026-02-28",
    name: "Coastline Insurance",
    note: null,
    description: "Prepaid insurance used in February",
  };

  it("numbers the entries AJE 1, AJE 2 in date order", () => {
    const r = build({ adjusting: [ACCRUAL, EARLIER] });
    expect(r.adjustments.filter((a) => a.first).map((a) => [a.number, a.date])).toEqual([
      ["AJE 1", "2026-02-28"],
      ["AJE 2", "2026-03-31"],
    ]);
  });

  it("puts number, date, name and why on each entry's first posting only", () => {
    const [first, second] = build().adjustments;
    expect(first).toMatchObject({
      entryId: "je-accrual",
      first: true,
      number: "AJE 1",
      date: "2026-03-31",
      name: "Harbour Property Ltd",
      account: "6100 Rent",
      debit: 50_000,
      credit: 0,
      why: "March rent billed in April",
    });
    expect(second).toMatchObject({
      entryId: "je-accrual",
      first: false,
      number: null,
      date: null,
      name: null,
      account: "2100 Accrued Liabilities",
      debit: 0,
      credit: 50_000,
      why: null,
    });
  });

  it("gives the entry's description as the reason when there is no note", () => {
    const r = build({ adjusting: [EARLIER] });
    expect(r.adjustments[0].why).toBe("Prepaid insurance used in February");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/working-trial-balance.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/working-trial-balance"`.

- [ ] **Step 3: Write the module**

`ctyhp-accounting/lib/domain/working-trial-balance.ts`:

```ts
/**
 * The working-paper trial balance of the client's prototype
 * (`reportWorkingPapers` in Accounting-System-v3.html): what the books said
 * before anyone adjusted them, what was adjusted, and what they say now.
 *
 * "An entry counts as an adjustment because somebody marked it one — not
 * because of its date or its shape." The marks come in as `adjusting`; nothing
 * here infers one.
 *
 * Pure: it receives balances already read and returns rows. It imports nothing
 * from `@/lib/db` or `@/lib/services`, and a test fails if that changes.
 * Figures are signed, debit positive, in base-currency minor units.
 */

import { statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import type { LedgerBalance } from "@/lib/domain/reports";

export const RETAINED_EARNINGS_KEY = "retained-earnings-before-period";
export const RETAINED_EARNINGS_LABEL = "Retained earnings — before this period";

/** One posting of an adjusting entry, in base currency as `acc_ledger_balances` reads it. */
export interface AdjustingLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitBase: number;
  creditBase: number;
}

/** A posted entry somebody marked adjusting. */
export interface AdjustingEntry {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  /** Who it was with: the customer or vendor, or else the description. */
  name: string;
  /** "Why it was adjusted". Null when nobody wrote one. */
  note: string | null;
  lines: AdjustingLine[];
}

export interface WorkingTrialBalanceInput {
  from: string;
  to: string;
  /** `acc_ledger_balances(null, from − 1 day)`. */
  before: readonly LedgerBalance[];
  /** `acc_ledger_balances(from, to)`: every posted movement in the range. */
  movements: readonly LedgerBalance[];
  /** Posted entries marked adjusting. Any dated outside the range are ignored. */
  adjusting: readonly AdjustingEntry[];
}

export interface WtbRow {
  /** The account id, or RETAINED_EARNINGS_KEY. */
  key: string;
  /** Null on the retained-earnings line, which is no single account. */
  accountId: string | null;
  accountCode: string;
  name: string;
  unadjusted: number;
  adjustment: number;
  adjusted: number;
}

export interface WtbTotals {
  unadjustedDebit: number;
  unadjustedCredit: number;
  adjustmentDebit: number;
  adjustmentCredit: number;
  adjustedDebit: number;
  adjustedCredit: number;
}

/** One posting in "The adjustments", the list under the table. */
export interface AjeRow {
  key: string;
  entryId: string;
  /** The entry's first posting, which carries its number, date, name and why. */
  first: boolean;
  number: string | null;
  date: string | null;
  name: string | null;
  account: string;
  debit: number;
  credit: number;
  why: string | null;
}

export interface WorkingTrialBalance {
  from: string;
  to: string;
  rows: WtbRow[];
  totals: WtbTotals;
  /** The prototype's check: debits equal credits in all three column pairs. */
  balanced: boolean;
  /** Rows that are accounts — the retained-earnings line is not one. */
  accountCount: number;
  adjustingEntryCount: number;
  adjustments: AjeRow[];
}

interface AccountMeta {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
}

const signed = (b: Pick<LedgerBalance, "debitBase" | "creditBase">) => b.debitBase - b.creditBase;

function addTo(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function totalsOf(rows: readonly WtbRow[]): WtbTotals {
  const debit = (v: number) => Math.max(v, 0);
  const credit = (v: number) => Math.max(-v, 0);
  return rows.reduce<WtbTotals>(
    (t, r) => ({
      unadjustedDebit: t.unadjustedDebit + debit(r.unadjusted),
      unadjustedCredit: t.unadjustedCredit + credit(r.unadjusted),
      adjustmentDebit: t.adjustmentDebit + debit(r.adjustment),
      adjustmentCredit: t.adjustmentCredit + credit(r.adjustment),
      adjustedDebit: t.adjustedDebit + debit(r.adjusted),
      adjustedCredit: t.adjustedCredit + credit(r.adjusted),
    }),
    { unadjustedDebit: 0, unadjustedCredit: 0, adjustmentDebit: 0, adjustmentCredit: 0, adjustedDebit: 0, adjustedCredit: 0 },
  );
}

/** "The adjustments": one row per posting, numbered AJE 1, AJE 2 … in date order. */
function adjustmentRows(entries: readonly AdjustingEntry[]): AjeRow[] {
  return entries.flatMap((e, i) =>
    e.lines.map((l, k) => ({
      key: `${e.entryId}:${k}`,
      entryId: e.entryId,
      first: k === 0,
      number: k === 0 ? `AJE ${i + 1}` : null,
      date: k === 0 ? e.entryDate : null,
      name: k === 0 ? e.name : null,
      account: `${l.accountCode} ${l.accountName}`.trim(),
      debit: l.debitBase,
      credit: l.creditBase,
      why: k === 0 ? e.note?.trim() || e.description?.trim() || "" : null,
    })),
  );
}

export function buildWorkingTrialBalance(input: WorkingTrialBalanceInput): WorkingTrialBalance {
  const adjusting = input.adjusting
    .filter((e) => e.entryDate >= input.from && e.entryDate <= input.to)
    .sort((x, y) => x.entryDate.localeCompare(y.entryDate) || x.entryNumber.localeCompare(y.entryNumber));

  const meta = new Map<string, AccountMeta>();
  const remember = (m: AccountMeta) => {
    if (!meta.has(m.accountId)) meta.set(m.accountId, m);
  };
  const carried = new Map<string, number>();
  const movement = new Map<string, number>();
  const adjustment = new Map<string, number>();
  let retained = 0;

  for (const b of input.before) {
    remember(b);
    // The prototype carries the balance sheet forward and starts income and
    // expense afresh. OneBook posts no closing entry, so what those accounts
    // earned before the range is carried on one line instead (see the spec, §7).
    if (statementSectionOf(b.accountType) === "balance_sheet") addTo(carried, b.accountId, signed(b));
    else retained += signed(b);
  }
  for (const b of input.movements) {
    remember(b);
    addTo(movement, b.accountId, signed(b));
  }
  for (const e of adjusting) {
    for (const l of e.lines) {
      remember({ accountId: l.accountId, accountCode: l.accountCode, name: l.accountName, accountType: l.accountType });
      addTo(adjustment, l.accountId, l.debitBase - l.creditBase);
    }
  }

  const rowOf = (m: AccountMeta): WtbRow => {
    const adj = adjustment.get(m.accountId) ?? 0;
    const unadjusted = (carried.get(m.accountId) ?? 0) + (movement.get(m.accountId) ?? 0) - adj;
    return {
      key: m.accountId,
      accountId: m.accountId,
      accountCode: m.accountCode,
      name: m.name,
      unadjusted,
      adjustment: adj,
      adjusted: unadjusted + adj,
    };
  };
  const shown = (r: WtbRow) => r.unadjusted !== 0 || r.adjustment !== 0 || r.adjusted !== 0;
  const inSection = (section: "balance_sheet" | "profit_and_loss") =>
    [...meta.values()]
      .filter((m) => statementSectionOf(m.accountType) === section)
      .sort((x, y) => x.accountCode.localeCompare(y.accountCode))
      .map(rowOf)
      .filter(shown);

  const balanceSheet = inSection("balance_sheet");
  const profitAndLoss = inSection("profit_and_loss");
  const retainedRow: WtbRow[] =
    retained === 0
      ? []
      : [
          {
            key: RETAINED_EARNINGS_KEY,
            accountId: null,
            accountCode: "",
            name: RETAINED_EARNINGS_LABEL,
            unadjusted: retained,
            adjustment: 0,
            adjusted: retained,
          },
        ];
  const rows = [...balanceSheet, ...retainedRow, ...profitAndLoss];
  const totals = totalsOf(rows);

  return {
    from: input.from,
    to: input.to,
    rows,
    totals,
    balanced:
      totals.unadjustedDebit === totals.unadjustedCredit &&
      totals.adjustmentDebit === totals.adjustmentCredit &&
      totals.adjustedDebit === totals.adjustedCredit,
    accountCount: balanceSheet.length + profitAndLoss.length,
    adjustingEntryCount: adjusting.length,
    adjustments: adjustmentRows(adjusting),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/working-trial-balance.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/working-trial-balance.ts tests/unit/working-trial-balance.test.ts
printf '%s\n' "feat(working-tb): unadjusted, adjustments, adjusted, and the retained earnings that make them balance" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 4: The report as a sheet for PDF, Excel and CSV; and a purity guard

**Files:**
- Modify: `ctyhp-accounting/lib/domain/working-trial-balance.ts` (append)
- Test: `ctyhp-accounting/tests/unit/working-trial-balance.test.ts` (append)

**Interfaces:**
- Consumes: `WorkingTrialBalance` (Task 3); `fromMinor` (`@/lib/domain/money`); `sanitizeExportFileName`, `ReportExportSheet` (`@/lib/domain/report-export`); `rangeText` (`@/lib/domain/report-presets`).
- Produces: `workingTrialBalanceSheet(report: WorkingTrialBalance, meta: { companyName: string; currencyCode: string; decimals: number }): ReportExportSheet`.

- [ ] **Step 1: Append the failing tests**

Add to the imports at the top of `tests/unit/working-trial-balance.test.ts`:

```ts
import { readFileSync } from "node:fs";
```

and add `workingTrialBalanceSheet` to the import from `@/lib/domain/working-trial-balance`. Then append:

```ts
describe("workingTrialBalanceSheet", () => {
  const sheet = workingTrialBalanceSheet(build(), { companyName: "Harbour Test Co", currencyCode: "USD", decimals: 2 });

  it("names the report, its dates and its basis", () => {
    expect(sheet.fileName).toBe("working-trial-balance-2026-01-01-to-2026-03-31");
    expect(sheet.title).toBe("Working Trial Balance");
    expect(sheet.subtitle).toBe("January 1, 2026 – March 31, 2026 · Accrual basis");
    expect(sheet.columns.map((c) => c.header)).toEqual([
      "Account",
      "Unadjusted debit",
      "Unadjusted credit",
      "Adjustments debit",
      "Adjustments credit",
      "Adjusted debit",
      "Adjusted credit",
      "Why",
    ]);
  });

  it("writes each figure on its own side, in the currency's units, and leaves the other side empty", () => {
    expect(sheet.rows[0]).toEqual({ account: "1000 Cash", ud: 16000, uc: null, ad: null, ac: null, nd: 16000, nc: null, why: null });
    expect(sheet.rows.find((r) => r.account === RETAINED_EARNINGS_LABEL)).toMatchObject({ ud: null, uc: 3000, nc: 3000 });
  });

  it("closes the table with its total, then lists the adjustments", () => {
    const total = sheet.rows.findIndex((r) => r.account === "Total");
    expect(sheet.rows[total]).toEqual({ account: "Total", ud: 17000, uc: 17000, ad: 500, ac: 500, nd: 17500, nc: 17500, why: null });
    expect(sheet.rows[total + 1]).toMatchObject({ account: "The adjustments" });
    expect(sheet.rows[total + 2]).toMatchObject({
      account: "AJE 1 · 2026-03-31 · Harbour Property Ltd — 6100 Rent",
      ad: 500,
      ac: null,
      why: "March rent billed in April",
    });
    expect(sheet.rows[total + 3]).toMatchObject({ account: "— 2100 Accrued Liabilities", ad: null, ac: 500, why: null });
  });

  it("has no adjustments heading when there were none", () => {
    const plain = workingTrialBalanceSheet(build({ adjusting: [] }), { companyName: "X", currencyCode: "USD", decimals: 2 });
    expect(plain.rows.some((r) => r.account === "The adjustments")).toBe(false);
  });
});

describe("working-trial-balance module", () => {
  it("imports nothing that could write to the books", () => {
    const source = readFileSync("lib/domain/working-trial-balance.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/working-trial-balance.test.ts`
Expected: FAIL — `workingTrialBalanceSheet is not a function` (or not exported).

- [ ] **Step 3: Append the implementation**

Add these imports to the top of `lib/domain/working-trial-balance.ts`, below the existing two:

```ts
import { fromMinor } from "@/lib/domain/money";
import { sanitizeExportFileName, type ReportExportSheet } from "@/lib/domain/report-export";
import { rangeText } from "@/lib/domain/report-presets";
```

and append at the end of the file:

```ts
/* ---------------------------------------------------------------- export */

export interface WtbSheetMeta {
  companyName: string;
  currencyCode: string;
  decimals: number;
}

type SheetRow = ReportExportSheet["rows"][number];

/**
 * The report as one table, for PDF, Excel and CSV: the six columns and their
 * total, then "The adjustments" with each posting's amount in the Adjustments
 * pair and its reason under Why.
 */
export function workingTrialBalanceSheet(report: WorkingTrialBalance, meta: WtbSheetMeta): ReportExportSheet {
  const amount = (minor: number) => (minor === 0 ? null : fromMinor(minor, meta.decimals));
  const debit = (v: number) => (v > 0 ? amount(v) : null);
  const credit = (v: number) => (v < 0 ? amount(-v) : null);
  const t = report.totals;

  const rows: SheetRow[] = report.rows.map((r) => ({
    account: r.accountId ? `${r.accountCode} ${r.name}` : r.name,
    ud: debit(r.unadjusted),
    uc: credit(r.unadjusted),
    ad: debit(r.adjustment),
    ac: credit(r.adjustment),
    nd: debit(r.adjusted),
    nc: credit(r.adjusted),
    why: null,
  }));
  rows.push({
    account: "Total",
    ud: fromMinor(t.unadjustedDebit, meta.decimals),
    uc: fromMinor(t.unadjustedCredit, meta.decimals),
    ad: fromMinor(t.adjustmentDebit, meta.decimals),
    ac: fromMinor(t.adjustmentCredit, meta.decimals),
    nd: fromMinor(t.adjustedDebit, meta.decimals),
    nc: fromMinor(t.adjustedCredit, meta.decimals),
    why: null,
  });

  if (report.adjustments.length > 0) {
    rows.push({ account: "The adjustments", ud: null, uc: null, ad: null, ac: null, nd: null, nc: null, why: null });
    for (const a of report.adjustments) {
      rows.push({
        account: a.first ? `${a.number} · ${a.date} · ${a.name} — ${a.account}` : `— ${a.account}`,
        ud: null,
        uc: null,
        ad: amount(a.debit),
        ac: amount(a.credit),
        nd: null,
        nc: null,
        why: a.why,
      });
    }
  }

  return {
    fileName: sanitizeExportFileName(`working-trial-balance-${report.from}-to-${report.to}`),
    companyName: meta.companyName,
    title: "Working Trial Balance",
    subtitle: `${rangeText(report.from, report.to)} · Accrual basis`,
    currencyCode: meta.currencyCode,
    columns: [
      { key: "account", header: "Account", width: 44 },
      { key: "ud", header: "Unadjusted debit", kind: "money", width: 16 },
      { key: "uc", header: "Unadjusted credit", kind: "money", width: 16 },
      { key: "ad", header: "Adjustments debit", kind: "money", width: 16 },
      { key: "ac", header: "Adjustments credit", kind: "money", width: 16 },
      { key: "nd", header: "Adjusted debit", kind: "money", width: 16 },
      { key: "nc", header: "Adjusted credit", kind: "money", width: 16 },
      { key: "why", header: "Why", width: 36 },
    ],
    rows,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/working-trial-balance.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/working-trial-balance.ts tests/unit/working-trial-balance.test.ts
printf '%s\n' "feat(working-tb): the report as one sheet for PDF, Excel and CSV" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 5: Reading the working trial balance

**Files:**
- Create: `ctyhp-accounting/lib/services/working-trial-balance.ts`
- Test: `ctyhp-accounting/tests/unit/working-trial-balance-service.test.ts`

**Interfaces:**
- Consumes: `getLedgerBalances(sb, from: string | null, to: string)`, `getTransactionList(sb, from, to)` (`@/lib/services/reports`); `entryDisplayName` (`@/lib/domain/entry-detail`); `buildWorkingTrialBalance` (Task 3).
- Produces: `getWorkingTrialBalance(sb: SupabaseClient, from: string, to: string): Promise<WorkingTrialBalance>`; `class WorkingTrialBalanceError extends Error`.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/working-trial-balance-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkingTrialBalanceError, getWorkingTrialBalance } from "@/lib/services/working-trial-balance";

type Row = Record<string, unknown>;
type Source = Row[] | Error;

const resultOf = (s: Source) =>
  s instanceof Error ? { data: null, error: { message: s.message } } : { data: s, error: null };
/** One page, the way `.range(from, to)` returns it: inclusive at both ends. */
const pageOf = (s: Source, from: number, to: number) => (s instanceof Error ? resultOf(s) : resultOf(s.slice(from, to + 1)));

interface Config {
  before: Source;
  movements: Source;
  marks: Source;
  listed: Source;
}

function fakeClient(c: Partial<Config>, rpcCalls: [string, Record<string, unknown>][] = []): SupabaseClient {
  const cfg: Config = { before: [], movements: [], marks: [], listed: [], ...c };
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    range: async (from: number, to: number) => pageOf(cfg.marks, from, to),
  };
  return {
    from(table: string) {
      if (table !== "acc_adjusting_entry") throw new Error(`fakeClient: unhandled table "${table}"`);
      return chain;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push([name, args]);
      const source =
        name === "acc_ledger_balances"
          ? args.p_from === null
            ? cfg.before
            : cfg.movements
          : name === "acc_transaction_list"
            ? cfg.listed
            : new Error(`fakeClient: unhandled rpc "${name}"`);
      return { range: async (from: number, to: number) => pageOf(source, from, to) };
    },
  } as unknown as SupabaseClient;
}

const ledgerRow = (id: string, code: string, type: string, debit: number, credit: number): Row => ({
  account_id: id,
  account_code: code,
  name: `Account ${code}`,
  account_type: type,
  debit_base: debit,
  credit_base: credit,
});

/** A marked entry as PostgREST returns it: the entry embedded, its lines embedded in that. */
const mark = (id: string, note: string | null, lines: Row[]): Row => ({
  journal_entry_id: id,
  note,
  acc_journal_entry: {
    id,
    entry_number: `JE-${id}`,
    entry_date: "2026-03-31",
    description: "Quarter-end accrual",
    status: "posted",
    acc_journal_line: lines,
  },
});

const line = (accountId: string, code: string, type: string, debit: number, credit: number, base: number, order: number): Row => ({
  account_id: accountId,
  debit_minor: debit,
  credit_minor: credit,
  amount_base_minor: base,
  line_order: order,
  acc_account: { account_code: code, name: `Account ${code}`, account_type: type },
});

describe("getWorkingTrialBalance", () => {
  it("reads the balances before the range up to the day before it starts", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await getWorkingTrialBalance(fakeClient({}, calls), "2026-03-01", "2026-03-31");
    expect(calls).toContainEqual(["acc_ledger_balances", { p_from: null, p_to: "2026-02-28" }]);
    expect(calls).toContainEqual(["acc_ledger_balances", { p_from: "2026-03-01", p_to: "2026-03-31" }]);
  });

  it("counts an adjusting line at its base amount, on the side it was posted", async () => {
    const r = await getWorkingTrialBalance(
      fakeClient({
        movements: [ledgerRow("rent", "6100", "expense", 11_000, 0), ledgerRow("accrued", "2100", "current_liability", 0, 11_000)],
        marks: [
          mark("a1", "Accrued in euros", [
            line("rent", "6100", "expense", 10_000, 0, 11_000, 0),
            line("accrued", "2100", "current_liability", 0, 10_000, 11_000, 1),
          ]),
        ],
      }),
      "2026-01-01",
      "2026-03-31",
    );
    expect(r.rows.find((x) => x.key === "rent")).toMatchObject({ unadjusted: 0, adjustment: 11_000, adjusted: 11_000 });
    expect(r.rows.find((x) => x.key === "accrued")).toMatchObject({ unadjusted: 0, adjustment: -11_000 });
  });

  it("names an adjusting entry as the transaction list does", async () => {
    const r = await getWorkingTrialBalance(
      fakeClient({
        marks: [mark("a1", null, [line("rent", "6100", "expense", 100, 0, 100, 0), line("accrued", "2100", "current_liability", 0, 100, 100, 1)])],
        listed: [{ entry_id: "a1", entry_number: "JE-a1", entry_date: "2026-03-31", description: "Quarter-end accrual", source_type: "manual", party_name: "Harbour Property Ltd", amount_minor: 100, currency_code: "USD" }],
      }),
      "2026-01-01",
      "2026-03-31",
    );
    expect(r.adjustments[0]).toMatchObject({ name: "Harbour Property Ltd", why: "Quarter-end accrual" });
  });

  it("reads every adjusting entry, past a thousand", async () => {
    const marks = Array.from({ length: 1_001 }, (_, i) =>
      mark(`m${i}`, null, [line("rent", "6100", "expense", 1, 0, 1, 0), line("accrued", "2100", "current_liability", 0, 1, 1, 1)]),
    );
    const r = await getWorkingTrialBalance(fakeClient({ marks }), "2026-01-01", "2026-03-31");
    expect(r.adjustingEntryCount).toBe(1_001);
  });

  it("fails the whole report when the marks cannot be read", async () => {
    await expect(
      getWorkingTrialBalance(fakeClient({ marks: new Error("connection reset") }), "2026-01-01", "2026-03-31"),
    ).rejects.toThrow(WorkingTrialBalanceError);
  });

  it("fails the whole report when a balance cannot be read", async () => {
    await expect(
      getWorkingTrialBalance(fakeClient({ before: new Error("timeout") }), "2026-01-01", "2026-03-31"),
    ).rejects.toThrow("timeout");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/working-trial-balance-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/services/working-trial-balance"`.

- [ ] **Step 3: Write the service**

`ctyhp-accounting/lib/services/working-trial-balance.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { entryDisplayName } from "@/lib/domain/entry-detail";
import {
  buildWorkingTrialBalance,
  type AdjustingEntry,
  type WorkingTrialBalance,
} from "@/lib/domain/working-trial-balance";
import { getLedgerBalances, getTransactionList } from "@/lib/services/reports";

/**
 * Reading the working trial balance. Every call here reads.
 *
 * Totals come from `acc_ledger_balances`, the aggregate the Trial Balance and
 * Balance Sheet use, so the three cannot disagree about a balance. Only the
 * adjusting part is read on its own. A trial balance missing any read is a
 * wrong trial balance, not a partial one, so any failed read fails the report.
 */
export class WorkingTrialBalanceError extends Error {}

const PAGE = 1000;

type MarkRow = {
  journal_entry_id: string;
  note: string | null;
  acc_journal_entry: {
    id: string;
    entry_number: string;
    entry_date: string;
    description: string | null;
    acc_journal_line:
      | {
          account_id: string;
          debit_minor: number;
          credit_minor: number;
          amount_base_minor: number;
          line_order: number;
          acc_account: { account_code: string; name: string; account_type: AccountType } | null;
        }[]
      | null;
  };
};

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Posted entries dated in the range and marked adjusting, with their lines. Paged. */
async function readAdjusting(sb: SupabaseClient, from: string, to: string): Promise<MarkRow[]> {
  const rows: MarkRow[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await sb
      .from("acc_adjusting_entry")
      .select(
        "journal_entry_id,note," +
          "acc_journal_entry!inner(id,entry_number,entry_date,description,status," +
          "acc_journal_line(account_id,debit_minor,credit_minor,amount_base_minor,line_order," +
          "acc_account(account_code,name,account_type)))",
      )
      .eq("acc_journal_entry.status", "posted")
      .gte("acc_journal_entry.entry_date", from)
      .lte("acc_journal_entry.entry_date", to)
      .order("journal_entry_id")
      .range(start, start + PAGE - 1);
    if (error) throw new WorkingTrialBalanceError(`Reading the adjusting entries failed: ${error.message}`);
    const page = (data ?? []) as unknown as MarkRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function getWorkingTrialBalance(
  sb: SupabaseClient,
  from: string,
  to: string,
): Promise<WorkingTrialBalance> {
  const [before, movements, marks, listed] = await Promise.all([
    getLedgerBalances(sb, null, dayBefore(from)),
    getLedgerBalances(sb, from, to),
    readAdjusting(sb, from, to),
    getTransactionList(sb, from, to),
  ]);

  const nameOf = new Map(listed.map((r) => [r.entryId, entryDisplayName(r)]));
  const adjusting: AdjustingEntry[] = marks.map((m) => {
    const e = m.acc_journal_entry;
    return {
      entryId: e.id,
      entryNumber: e.entry_number,
      entryDate: String(e.entry_date).slice(0, 10),
      description: e.description,
      name: nameOf.get(e.id) || e.description?.trim() || "",
      note: m.note,
      lines: [...(e.acc_journal_line ?? [])]
        .sort((x, y) => x.line_order - y.line_order)
        .map((l) => ({
          accountId: l.account_id,
          accountCode: l.acc_account?.account_code ?? "",
          accountName: l.acc_account?.name ?? "",
          accountType: l.acc_account?.account_type ?? "expense",
          // Base currency, read exactly as acc_ledger_balances reads it.
          debitBase: Number(l.debit_minor) > 0 ? Number(l.amount_base_minor) : 0,
          creditBase: Number(l.credit_minor) > 0 ? Number(l.amount_base_minor) : 0,
        })),
    };
  });

  return buildWorkingTrialBalance({ from, to, before, movements, adjusting });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/working-trial-balance-service.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/services/working-trial-balance.ts tests/unit/working-trial-balance-service.test.ts
printf '%s\n' "feat(working-tb): read the balances and the marked entries, paged, and fail whole" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 6: Marking from the application: schemas, service, actions, and the mark on each journal entry

**Files:**
- Create: `ctyhp-accounting/lib/domain/adjusting-entries.ts`
- Create: `ctyhp-accounting/lib/services/adjusting-entries.ts`
- Modify: `ctyhp-accounting/lib/services/journal.ts` (the `JournalEntrySummary` type, `EntryRow`, the select and map in `listJournalEntries`)
- Modify: `ctyhp-accounting/app/(app)/journal/actions.ts` (two new actions)
- Test: `ctyhp-accounting/tests/unit/adjusting-entries.test.ts`

**Interfaces:**
- Consumes: the RPCs of Task 1; `hasPermission(sb, key)` (`@/lib/services/access`).
- Produces:
  - domain: `ADJUSTING_NOTE_MAX = 500`; `markAdjustingSchema` (`{ entryId: uuid, note: string | null, confirmClosed: boolean }`); `unmarkAdjustingSchema` (`{ entryId: uuid, confirmClosed: boolean }`); `interface ClosedPeriodAsk { entryDate: string; closedThrough: string }`; `type AdjustingResult = { kind: "done" } | { kind: "closed_period"; ask: ClosedPeriodAsk }`; `parseClosedPeriod(message: string): ClosedPeriodAsk | null`.
  - service: `markAdjusting(sb, entryId: string, note: string | null, confirmClosed: boolean): Promise<AdjustingResult>`; `unmarkAdjusting(sb, entryId: string, confirmClosed: boolean): Promise<AdjustingResult>`; `class AdjustingEntryError extends Error`.
  - `JournalEntrySummary.adjusting: { note: string | null } | null`.
  - actions: `markAdjustingAction(raw: unknown): Promise<ActionResult<AdjustingResult>>`, `unmarkAdjustingAction(raw: unknown): Promise<ActionResult<AdjustingResult>>`.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/adjusting-entries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markAdjustingSchema, parseClosedPeriod, unmarkAdjustingSchema } from "@/lib/domain/adjusting-entries";
import { AdjustingEntryError, markAdjusting, unmarkAdjusting } from "@/lib/services/adjusting-entries";

const ENTRY = "3f2b8c1e-7a4d-4c2b-9e1f-0a1b2c3d4e5f";

describe("parseClosedPeriod", () => {
  it("reads the entry's date and the end of its closed period", () => {
    expect(parseClosedPeriod("closed_period:2026-03-04:2026-03-31")).toEqual({
      entryDate: "2026-03-04",
      closedThrough: "2026-03-31",
    });
  });

  it("finds nothing in any other refusal", () => {
    expect(parseClosedPeriod("permission denied: marking an adjusting entry needs journal.post")).toBeNull();
  });
});

describe("the mark's input", () => {
  it("accepts a note up to 500 characters, and none at all", () => {
    expect(markAdjustingSchema.safeParse({ entryId: ENTRY, note: "x".repeat(500), confirmClosed: false }).success).toBe(true);
    expect(markAdjustingSchema.safeParse({ entryId: ENTRY, note: null, confirmClosed: false }).success).toBe(true);
  });

  it("refuses a longer note, and an id that is not one", () => {
    expect(markAdjustingSchema.safeParse({ entryId: ENTRY, note: "x".repeat(501), confirmClosed: false }).success).toBe(false);
    expect(unmarkAdjustingSchema.safeParse({ entryId: "JE-000001", confirmClosed: false }).success).toBe(false);
  });
});

function rpcAnswering(error: string | null, calls: [string, Record<string, unknown>][] = []): SupabaseClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return { data: null, error: error ? { message: error } : null };
    },
  } as unknown as SupabaseClient;
}

describe("markAdjusting and unmarkAdjusting", () => {
  it("pass the entry, the note and the confirmation through", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    await markAdjusting(rpcAnswering(null, calls), ENTRY, "Year-end accrual", true);
    await unmarkAdjusting(rpcAnswering(null, calls), ENTRY, false);
    expect(calls).toEqual([
      ["acc_mark_adjusting", { p_entry_id: ENTRY, p_note: "Year-end accrual", p_confirm_closed: true }],
      ["acc_unmark_adjusting", { p_entry_id: ENTRY, p_confirm_closed: false }],
    ]);
  });

  it("report done when the database agrees", async () => {
    await expect(markAdjusting(rpcAnswering(null), ENTRY, null, false)).resolves.toEqual({ kind: "done" });
  });

  it("turn a closed period into a question for the screen", async () => {
    await expect(unmarkAdjusting(rpcAnswering("closed_period:2026-03-04:2026-03-31"), ENTRY, false)).resolves.toEqual({
      kind: "closed_period",
      ask: { entryDate: "2026-03-04", closedThrough: "2026-03-31" },
    });
  });

  it("throw any other refusal", async () => {
    await expect(markAdjusting(rpcAnswering("That entry is not in the books"), ENTRY, null, false)).rejects.toThrow(
      AdjustingEntryError,
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/adjusting-entries.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/adjusting-entries"`.

- [ ] **Step 3: Write the domain module**

`ctyhp-accounting/lib/domain/adjusting-entries.ts`:

```ts
import { z } from "zod";

/**
 * Marking a journal entry adjusting: the checkbox and note of the client's
 * prototype ("adj-toggle", "adj-note"). The mark is written by the database
 * (migration 0124); this is what the screen sends and what it gets back.
 */

export const ADJUSTING_NOTE_MAX = 500;

export const markAdjustingSchema = z.object({
  entryId: z.uuid(),
  note: z
    .string()
    .trim()
    .max(ADJUSTING_NOTE_MAX, `A note can be at most ${ADJUSTING_NOTE_MAX} characters`)
    .nullable(),
  confirmClosed: z.boolean(),
});

export const unmarkAdjustingSchema = z.object({
  entryId: z.uuid(),
  confirmClosed: z.boolean(),
});

/** An entry in a closed period, and where the closed period ends. */
export interface ClosedPeriodAsk {
  entryDate: string;
  closedThrough: string;
}

/** Done, or the prototype's question: this alters a closed period — go ahead? */
export type AdjustingResult = { kind: "done" } | { kind: "closed_period"; ask: ClosedPeriodAsk };

/** The database's closed-period refusal (`closed_period:<date>:<period end>`), or null for any other message. */
export function parseClosedPeriod(message: string): ClosedPeriodAsk | null {
  const m = /closed_period:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})/.exec(message);
  return m ? { entryDate: m[1], closedThrough: m[2] } : null;
}
```

- [ ] **Step 4: Write the service**

`ctyhp-accounting/lib/services/adjusting-entries.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseClosedPeriod, type AdjustingResult } from "@/lib/domain/adjusting-entries";

/**
 * The two writes to `acc_adjusting_entry`. Each is one RPC, which checks the
 * permission, refuses a voided entry, asks before a closed period and writes
 * its own audit row — nothing is repeated here. Neither touches a journal
 * entry or line.
 */
export class AdjustingEntryError extends Error {}

async function call(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<AdjustingResult> {
  const { error } = await sb.rpc(fn, args);
  if (!error) return { kind: "done" };
  const ask = parseClosedPeriod(error.message);
  if (ask) return { kind: "closed_period", ask };
  throw new AdjustingEntryError(error.message);
}

export function markAdjusting(
  sb: SupabaseClient,
  entryId: string,
  note: string | null,
  confirmClosed: boolean,
): Promise<AdjustingResult> {
  return call(sb, "acc_mark_adjusting", { p_entry_id: entryId, p_note: note, p_confirm_closed: confirmClosed });
}

export function unmarkAdjusting(sb: SupabaseClient, entryId: string, confirmClosed: boolean): Promise<AdjustingResult> {
  return call(sb, "acc_unmark_adjusting", { p_entry_id: entryId, p_confirm_closed: confirmClosed });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/adjusting-entries.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Read the mark with each journal entry**

In `ctyhp-accounting/lib/services/journal.ts`:

(a) In `interface JournalEntrySummary`, after `isReversal: boolean;` add:

```ts
  /** Marked adjusting, with its reason; null when it is not. */
  adjusting: { note: string | null } | null;
```

(b) In `type EntryRow`, add a field (keep the others):

```ts
  acc_adjusting_entry: { note: string | null } | { note: string | null }[] | null;
```

(c) In `listJournalEntries`, change the select string to:

```ts
      "id,entry_number,entry_date,description,source_type,source_id,status," +
        "acc_journal_line(account_id,debit_minor,credit_minor,memo,line_order,acc_account(account_code,name))," +
        "acc_adjusting_entry(note)",
```

(d) In the `.map((e) => ({ … }))` of `listJournalEntries`, after `isReversal: reversalIds.has(e.id),` add:

```ts
      adjusting: markOf(e.acc_adjusting_entry),
```

(e) Above `listJournalEntries`, add:

```ts
/**
 * An entry's adjusting mark. The mark's key is the entry's id, so PostgREST
 * embeds it as one object — or, in some versions, a one-element list.
 */
function markOf(v: EntryRow["acc_adjusting_entry"]): { note: string | null } | null {
  const m = Array.isArray(v) ? v[0] : v;
  return m ? { note: m.note ?? null } : null;
}
```

- [ ] **Step 7: Add the two actions**

In `ctyhp-accounting/app/(app)/journal/actions.ts`, add to the imports:

```ts
import { hasPermission } from "@/lib/services/access";
import {
  markAdjustingSchema,
  unmarkAdjustingSchema,
  type AdjustingResult,
} from "@/lib/domain/adjusting-entries";
import { markAdjusting, unmarkAdjusting } from "@/lib/services/adjusting-entries";
```

and append:

```ts
type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** The database checks this too; asking first gives a plain sentence instead of an error code. */
async function adjustingGuard(sb: Session): Promise<string | null> {
  return (await hasPermission(sb, "journal.post"))
    ? null
    : "Marking an adjusting entry needs the Post manual journals permission.";
}

function afterAdjusting(result: AdjustingResult) {
  if (result.kind === "done") {
    revalidatePath("/journal");
    revalidatePath("/reports/working-trial-balance");
  }
}

/** Mark an entry adjusting, or change its note. Moves the entry between two report columns; changes no figure. */
export async function markAdjustingAction(raw: unknown): Promise<ActionResult<AdjustingResult>> {
  const parsed = markAdjustingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const denied = await adjustingGuard(sb);
    if (denied) return { ok: false, error: denied };
    const result = await markAdjusting(sb, parsed.data.entryId, parsed.data.note || null, parsed.data.confirmClosed);
    afterAdjusting(result);
    return { ok: true, data: result };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

/** Take the adjusting mark off an entry, and its note with it. */
export async function unmarkAdjustingAction(raw: unknown): Promise<ActionResult<AdjustingResult>> {
  const parsed = unmarkAdjustingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const denied = await adjustingGuard(sb);
    if (denied) return { ok: false, error: denied };
    const result = await unmarkAdjusting(sb, parsed.data.entryId, parsed.data.confirmClosed);
    afterAdjusting(result);
    return { ok: true, data: result };
  } catch (err) { return { ok: false, error: msg(err) }; }
}
```

- [ ] **Step 8: Typecheck and run the tests**

Run: `npm run typecheck` then `npx vitest run tests/unit/adjusting-entries.test.ts`
Expected: typecheck exits 0; tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -- lib/domain/adjusting-entries.ts lib/services/adjusting-entries.ts lib/services/journal.ts "app/(app)/journal/actions.ts" tests/unit/adjusting-entries.test.ts
printf '%s\n' "feat(adjusting): mark and unmark from the application, and read the mark with every journal entry" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 7: The checkbox on the Journal screen

**Files:**
- Create: `ctyhp-accounting/app/(app)/journal/AdjustingEntryControl.tsx`
- Modify: `ctyhp-accounting/app/(app)/journal/page.tsx`
- Modify: `ctyhp-accounting/app/(app)/journal/JournalClient.tsx`

**Interfaces:**
- Consumes: `markAdjustingAction`, `unmarkAdjustingAction` (Task 6); `JournalEntrySummary.adjusting`; `ClosedPeriodAsk` (Task 6); `shortDate` (`@/lib/domain/report-presets`); `hasPermission`.
- Produces: `AdjustingEntryControl` default export with props `{ entry: JournalEntrySummary; canEdit: boolean; unlocked: boolean; onChange: (mark: JournalEntrySummary["adjusting"]) => void; onClosedPeriod: (ask: ClosedPeriodAsk, retryConfirmed: () => Promise<void>) => void }`; `JournalClient` prop `canMarkAdjusting: boolean`.

- [ ] **Step 1: Write the control**

`ctyhp-accounting/app/(app)/journal/AdjustingEntryControl.tsx`:

```tsx
"use client";
import { useState } from "react";
import { App, Checkbox, Input, Space } from "antd";
import { ADJUSTING_NOTE_MAX, type ClosedPeriodAsk } from "@/lib/domain/adjusting-entries";
import type { JournalEntrySummary } from "@/lib/services/journal";
import { markAdjustingAction, unmarkAdjustingAction } from "./actions";

/**
 * "Adjusting entry" and "Why it was adjusted", on an opened journal entry —
 * where the client's prototype puts them, on the entry card beside Edit.
 *
 * Ticking asks the database, which may answer that the entry is in a closed
 * period; the Journal screen then asks the user once, and retries confirmed.
 * The note saves when the field loses focus, as the prototype's does.
 */
export default function AdjustingEntryControl({
  entry,
  canEdit,
  unlocked,
  onChange,
  onClosedPeriod,
}: {
  entry: JournalEntrySummary;
  canEdit: boolean;
  unlocked: boolean;
  onChange: (mark: JournalEntrySummary["adjusting"]) => void;
  onClosedPeriod: (ask: ClosedPeriodAsk, retryConfirmed: () => Promise<void>) => void;
}) {
  const { message } = App.useApp();
  const [note, setNote] = useState(entry.adjusting?.note ?? "");
  const [busy, setBusy] = useState(false);
  const marked = entry.adjusting !== null;

  if (!canEdit) {
    return marked ? (
      <div style={{ marginTop: 10 }}>
        <strong>Adjusting entry</strong>
        {entry.adjusting?.note ? ` — ${entry.adjusting.note}` : ""}
      </div>
    ) : null;
  }

  const toggle = async (next: boolean, confirmClosed: boolean): Promise<void> => {
    setBusy(true);
    const r = next
      ? await markAdjustingAction({ entryId: entry.id, note: null, confirmClosed })
      : await unmarkAdjustingAction({ entryId: entry.id, confirmClosed });
    setBusy(false);
    if (!r.ok || !r.data) {
      message.error(r.error ?? "The entry could not be changed.");
      return;
    }
    if (r.data.kind === "closed_period") {
      onClosedPeriod(r.data.ask, () => toggle(next, true));
      return;
    }
    setNote("");
    onChange(next ? { note: null } : null);
  };

  const saveNote = async () => {
    const trimmed = note.trim();
    if (trimmed === (entry.adjusting?.note ?? "")) return;
    setBusy(true);
    const r = await markAdjustingAction({ entryId: entry.id, note: trimmed || null, confirmClosed: unlocked });
    setBusy(false);
    if (!r.ok || !r.data || r.data.kind !== "done") {
      message.error(r.error ?? "The note could not be saved.");
      return;
    }
    onChange({ note: trimmed || null });
  };

  return (
    <Space wrap size={10} style={{ marginTop: 10 }}>
      <Checkbox checked={marked} disabled={busy} onChange={(e) => void toggle(e.target.checked, unlocked)}>
        Adjusting entry
      </Checkbox>
      {marked ? (
        <Input
          size="small"
          style={{ width: 320, maxWidth: "100%" }}
          maxLength={ADJUSTING_NOTE_MAX}
          placeholder="Why it was adjusted"
          aria-label="Why it was adjusted"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => void saveNote()}
        />
      ) : null}
    </Space>
  );
}
```

- [ ] **Step 2: Pass the permission from the page**

In `ctyhp-accounting/app/(app)/journal/page.tsx`, replace the `Promise.all` block with:

```ts
  const [
    currencies,
    accounts,
    role,
    canReadDocuments,
    canManageDocuments,
    canGovernDocuments,
    canMarkAdjusting,
  ] = await Promise.all([
    listCurrencies(sb),
    listAccounts(sb),
    getUserRole(),
    hasPermission(sb, "documents.read"),
    hasPermission(sb, "documents.manage"),
    hasPermission(sb, "documents.govern"),
    hasPermission(sb, "journal.post"),
  ]);
```

and add the prop `canMarkAdjusting={canMarkAdjusting}` to `<JournalClient`, after `canGovernDocuments={canGovernDocuments}`.

- [ ] **Step 3: Wire the control, the tag and the banner into the Journal screen**

In `ctyhp-accounting/app/(app)/journal/JournalClient.tsx`:

(a) Imports — add:

```ts
import AdjustingEntryControl from "./AdjustingEntryControl";
import type { ClosedPeriodAsk } from "@/lib/domain/adjusting-entries";
import { shortDate } from "@/lib/domain/report-presets";
```

(b) `interface Props` — add:

```ts
  /** May tick "Adjusting entry": the `journal.post` permission. */
  canMarkAdjusting: boolean;
```

and add `canMarkAdjusting,` to the destructured props of `JournalClient`.

(c) State — after the `attachmentTarget` state add:

```ts
  /** The prototype's closed-period question, waiting for an answer. */
  const [closedAsk, setClosedAsk] = useState<{ ask: ClosedPeriodAsk; retry: () => Promise<void> } | null>(null);
  /** Asked once, then remembered for the rest of the visit. */
  const [unlocked, setUnlocked] = useState(false);
  const setAdjusting = (id: string, mark: JournalEntrySummary["adjusting"]) =>
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, adjusting: mark } : e)));
```

(d) Directly above `<Table<JournalEntrySummary>` add:

```tsx
      {closedAsk ? (
        <Alert
          type="warning"
          showIcon
          title={
            <span>
              <strong>{shortDate(closedAsk.ask.entryDate)} is in a closed period.</strong> The books are closed through{" "}
              {shortDate(closedAsk.ask.closedThrough)}. Changing that entry will alter a period somebody has already
              signed off.
            </span>
          }
          action={
            <Space wrap>
              <Button
                size="small"
                danger
                onClick={async () => {
                  const pending = closedAsk;
                  setUnlocked(true);
                  setClosedAsk(null);
                  await pending.retry();
                }}
              >
                Unlock and change it
              </Button>
              <Button size="small" onClick={() => setClosedAsk(null)}>
                Leave it alone
              </Button>
            </Space>
          }
        />
      ) : unlocked ? (
        <Alert
          type="info"
          showIcon
          title="Closed periods are unlocked for this visit"
          description="Adjusting marks on entries in a closed period can be changed until you leave this page. Each change is recorded in the audit log with the period marked closed."
        />
      ) : null}
```

(e) Replace the `expandedRowRender` value with:

```tsx
          expandedRowRender: (e) => (
            <div>
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                pagination={false}
                dataSource={e.lines}
                columns={[
                  { title: "Account", render: (_, l) => `${l.accountCode} ${l.accountName}` },
                  { title: "Memo", dataIndex: "memo" },
                  { title: "Debit", align: "right", render: (_, l) => fmt(l.debitMinor) },
                  { title: "Credit", align: "right", render: (_, l) => fmt(l.creditMinor) },
                ]}
              />
              <AdjustingEntryControl
                key={`${e.id}:${e.adjusting ? "on" : "off"}`}
                entry={e}
                canEdit={canMarkAdjusting && e.status === "posted"}
                unlocked={unlocked}
                onChange={(mark) => setAdjusting(e.id, mark)}
                onClosedPeriod={(ask, retry) => setClosedAsk({ ask, retry })}
              />
            </div>
          ),
```

(f) Replace the Status column with:

```tsx
          {
            title: "Status",
            width: 170,
            render: (_, e) => (
              <Space size={4} wrap>
                {e.isReversed ? <Tag color="orange">reversed</Tag> : <Tag color="green">{e.status}</Tag>}
                {e.adjusting ? <Tag color="purple">adjusting</Tag> : null}
              </Space>
            ),
          },
```

- [ ] **Step 4: Typecheck, lint and the table gates**

Run: `npm run typecheck`, then `npx eslint "app/(app)/journal"`, then `npx vitest run tests/unit/table-adoption.test.ts tests/unit/rsc-antd.test.ts tests/unit/no-hardcoded-color.test.ts`
Expected: all exit 0 / PASS.

- [ ] **Step 5: Commit**

```bash
git add -- "app/(app)/journal/AdjustingEntryControl.tsx" "app/(app)/journal/page.tsx" "app/(app)/journal/JournalClient.tsx"
printf '%s\n' "feat(journal): tick an entry adjusting, with why, and be asked once before a closed period" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 8: The Working Trial Balance report

**Files:**
- Create: `ctyhp-accounting/app/(app)/reports/working-trial-balance/page.tsx`
- Create: `ctyhp-accounting/app/(app)/reports/working-trial-balance/actions.ts`
- Create: `ctyhp-accounting/app/(app)/reports/working-trial-balance/WorkingTrialBalanceClient.tsx`
- Modify: `ctyhp-accounting/components/reports/report-paper.module.css` (append)
- Modify: `ctyhp-accounting/lib/domain/report-catalog.ts` (one entry)

**Interfaces:**
- Consumes: `getWorkingTrialBalance` (Task 5); `workingTrialBalanceSheet`, `WorkingTrialBalance`, `AjeRow` (Tasks 3–4); `postedEntryDateSpan` (`@/lib/services/exceptions`); `ReportPaper`, `StatRow`, `ReportFoot`, `reportPaperStyles` (`@/components/reports/ReportPaper`); `EntryDetailDrawer`; `PERIOD_PRESETS`, `presetRange`, `rangeText`, `shortDate`.
- Produces: route `/reports/working-trial-balance`; `workingTrialBalanceAction(from: string, to: string): Promise<ActionResult<WorkingTrialBalance>>`.

- [ ] **Step 1: The action**

`ctyhp-accounting/app/(app)/reports/working-trial-balance/actions.ts`:

```ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import type { WorkingTrialBalance } from "@/lib/domain/working-trial-balance";
import { getWorkingTrialBalance } from "@/lib/services/working-trial-balance";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The only verb this screen has. It reads; nothing here changes a figure. */
export async function workingTrialBalanceAction(from: string, to: string): Promise<ActionResult<WorkingTrialBalance>> {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return { ok: false, error: "Choose a start and an end date." };
  if (from > to) return { ok: false, error: "The start date is after the end date." };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getWorkingTrialBalance(sb, from, to) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The report could not be produced." };
  }
}
```

- [ ] **Step 2: The page**

`ctyhp-accounting/app/(app)/reports/working-trial-balance/page.tsx`:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
import { resolveActiveCompany } from "@/lib/db/company";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import PageHeader from "@/components/PageHeader";
import WorkingTrialBalanceClient from "./WorkingTrialBalanceClient";

export const dynamic = "force-dynamic";

export default async function WorkingTrialBalancePage() {
  const sb = await createSupabaseServerClient();
  const entity = await resolveActiveCompany();
  const [currencies, company, span] = await Promise.all([
    listCurrencies(sb),
    getCurrentCompanySettings(sb),
    // The first and last posted entry, for "All dates" and "Last 3 years".
    postedEntryDateSpan(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  const displayName = entity.active?.dbaName || entity.active?.legalName || company?.legal_name || "Company name not set";
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={displayName} isSample={entity.active?.isSample ?? false} />}
        title="Working Trial Balance"
        description="What the books said before adjustment, what was adjusted and why, and what they say now."
      />
      <WorkingTrialBalanceClient
        companyName={displayName}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
        fiscalStartMonth={company?.fiscal_year_start_month ?? 1}
        today={new Date().toISOString().slice(0, 10)}
        firstEntryDate={span.first}
        lastEntryDate={span.last}
      />
    </div>
  );
}
```

- [ ] **Step 3: The styles the prototype's table needs**

Append to `ctyhp-accounting/components/reports/report-paper.module.css`:

```css
/* ---------- a trial balance on paper ----------
 * The total is a row of the table, as the prototype's `det-total` is, rather
 * than a Table.Summary a screen would have to reach into Ant Design for. */
.det :global(.ant-table-wrapper .ant-table-tbody) > tr.totalRow > td {
  border-top: 1px solid var(--ob-border-muted);
  border-bottom: 3px double var(--ob-border-muted);
  font-weight: 700;
}

.det :global(.ant-table-wrapper .ant-table-thead > tr > th.ant-table-cell[colspan]) {
  text-align: center;
}

.empty {
  text-align: center;
  padding: 40px 0;
  color: var(--ob-text-secondary);
  line-height: 1.7;
}
```

- [ ] **Step 4: The client**

`ctyhp-accounting/app/(app)/reports/working-trial-balance/WorkingTrialBalanceClient.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Button, DatePicker, Select, Space, Spin, type TableColumnsType } from "antd";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { ReportFoot, ReportPaper, StatRow, reportPaperStyles as styles } from "@/components/reports/ReportPaper";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { downloadTextFile } from "@/lib/client/download";
import { csvFromExportSheet } from "@/lib/domain/report-export";
import { PERIOD_PRESETS, presetRange, rangeText, shortDate, type PeriodPreset } from "@/lib/domain/report-presets";
import { workingTrialBalanceSheet, type AjeRow, type WorkingTrialBalance } from "@/lib/domain/working-trial-balance";
import { workingTrialBalanceAction } from "./actions";

/** One line of the table: an account, the retained-earnings line, or the total. */
interface Line {
  key: string;
  accountId: string | null;
  label: string;
  total: boolean;
  /** Unadjusted, adjustments, adjusted — each a debit then a credit, in minor units. */
  cells: [number, number, number, number, number, number];
}

const pair = (v: number): [number, number] => [v > 0 ? v : 0, v < 0 ? -v : 0];

/**
 * The Working Trial Balance, laid out as the client's prototype lays it out
 * (`reportWorkingPapers` in Accounting-System-v3.html): a period, the report on
 * paper, three figures, the three column pairs with their total, the adjusting
 * entries listed with the reason for each, and whether the columns agree.
 *
 * Nothing on this screen writes. Marking an entry adjusting is done on the
 * Journal screen, which the footer links to.
 */
export default function WorkingTrialBalanceClient({
  companyName,
  baseCurrency,
  baseDecimals,
  fiscalStartMonth,
  today,
  firstEntryDate,
  lastEntryDate,
}: {
  companyName: string;
  baseCurrency: string;
  baseDecimals: number;
  fiscalStartMonth: number;
  today: string;
  firstEntryDate: string | null;
  lastEntryDate: string | null;
}) {
  const ctx = useMemo(
    () => ({ today, fiscalStartMonth, firstEntryDate, lastEntryDate }),
    [today, fiscalStartMonth, firstEntryDate, lastEntryDate],
  );
  const initial = useMemo(() => presetRange("year", ctx), [ctx]);

  const [preset, setPreset] = useState<PeriodPreset>("year");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [ran, setRan] = useState(initial);
  const [report, setReport] = useState<WorkingTrialBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  const money = useCallback((minor: number) => formatMoney(minor, baseCurrency, baseDecimals), [baseCurrency, baseDecimals]);

  const run = useCallback(async (f: string, t: string) => {
    if (f > t) {
      setError("The start date is after the end date.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await workingTrialBalanceAction(f, t);
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(result.error ?? "The report could not be produced.");
      return;
    }
    setReport(result.data);
    setRan({ from: f, to: t });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(initial.from, initial.to);
    // Run once on arrival; afterwards a period choice or the Run button runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePreset = (key: PeriodPreset) => {
    setPreset(key);
    if (key === "custom") return;
    const range = presetRange(key, ctx);
    setFrom(range.from);
    setTo(range.to);
    void run(range.from, range.to);
  };

  const sheet = useMemo(
    () => (report ? workingTrialBalanceSheet(report, { companyName, currencyCode: baseCurrency, decimals: baseDecimals }) : null),
    [report, companyName, baseCurrency, baseDecimals],
  );

  const lines = useMemo<Line[]>(() => {
    if (!report) return [];
    const t = report.totals;
    return [
      ...report.rows.map((r) => ({
        key: r.key,
        accountId: r.accountId,
        label: r.accountId ? `${r.accountCode} ${r.name}` : r.name,
        total: false,
        cells: [...pair(r.unadjusted), ...pair(r.adjustment), ...pair(r.adjusted)] as Line["cells"],
      })),
      {
        key: "total",
        accountId: null,
        label: "Total",
        total: true,
        cells: [t.unadjustedDebit, t.unadjustedCredit, t.adjustmentDebit, t.adjustmentCredit, t.adjustedDebit, t.adjustedCredit],
      },
    ];
  }, [report]);

  /* ---------------------------------------------------------- tables */

  const amountColumn = (i: number, look: "plain" | "adjustment" | "adjusted") => ({
    title: i % 2 === 0 ? "Debit" : "Credit",
    key: `c${i}`,
    width: COLUMN.MONEY,
    align: "right" as const,
    render: (_: unknown, r: Line) => {
      const v = r.cells[i];
      if (!r.total && v === 0) return "";
      const text = money(v);
      if (r.total) return text;
      if (look === "adjustment") return <span className={styles.negative}>{text}</span>;
      if (look === "adjusted") return <strong>{text}</strong>;
      return text;
    },
  });

  const columns: TableColumnsType<Line> = [
    flexColumn<Line>({
      title: "Account",
      key: "account",
      render: (_, r) =>
        r.accountId ? (
          <a
            className={styles.accountLink}
            href={`/reports/general-ledger?account=${r.accountId}&from=${ran.from}&to=${ran.to}`}
            target="_blank"
            rel="noopener"
            title="Open this account's ledger in a new tab"
          >
            {r.label}
          </a>
        ) : (
          r.label
        ),
    }),
    { title: "Unadjusted", key: "unadjusted", children: [amountColumn(0, "plain"), amountColumn(1, "plain")] },
    { title: "Adjustments", key: "adjustments", children: [amountColumn(2, "adjustment"), amountColumn(3, "adjustment")] },
    { title: "Adjusted", key: "adjusted", children: [amountColumn(4, "adjusted"), amountColumn(5, "adjusted")] },
  ];

  const ajeColumns: TableColumnsType<AjeRow> = [
    { title: "No.", key: "no", width: 80, render: (_, r) => r.number ?? "" },
    { title: "Date", key: "date", width: 108, render: (_, r) => (r.date ? shortDate(r.date) : "") },
    flexColumn<AjeRow>({ title: "Name", key: "name", floor: 140, render: (_, r) => r.name ?? "" }),
    flexColumn<AjeRow>({
      title: "Account",
      key: "account",
      floor: 140,
      render: (_, r) => <span className={styles.muted}>{r.account}</span>,
    }),
    { title: "Debit", key: "debit", width: COLUMN.MONEY, align: "right", render: (_, r) => (r.debit ? money(r.debit) : "") },
    { title: "Credit", key: "credit", width: COLUMN.MONEY, align: "right", render: (_, r) => (r.credit ? money(r.credit) : "") },
    flexColumn<AjeRow>({ title: "Why", key: "why", floor: 160, render: (_, r) => r.why ?? "" }),
  ];

  /* ---------------------------------------------------------- page */

  const body = (r: WorkingTrialBalance) =>
    r.rows.length === 0 ? (
      <div className={styles.empty}>
        No entries fall in this period.
        <br />
        Add entries on the <Link href="/journal">Journal screen</Link>, or widen the date range.
      </div>
    ) : (
      <>
        <StatRow
          items={[
            { label: "Accounts", value: r.accountCount.toLocaleString("en-US") },
            { label: "Adjusting entries", value: r.adjustingEntryCount, danger: r.adjustingEntryCount > 0 },
            { label: "Adjusted total", value: money(r.totals.adjustedDebit) },
          ]}
        />
        <div className={styles.det}>
          <DataTable<Line>
            rowKey="key"
            pagination={false}
            dataSource={lines}
            columns={columns}
            rowClassName={(line) => (line.total ? styles.totalRow : "")}
          />
        </div>

        {r.adjustments.length > 0 ? (
          <>
            <div className={styles.eyebrow}>The adjustments</div>
            <div className={styles.det}>
              <DataTable<AjeRow>
                rowKey="key"
                pagination={false}
                dataSource={r.adjustments}
                columns={ajeColumns}
                rowClassName={(a) => `${styles.clickable}${a.first && a.number !== "AJE 1" ? ` ${styles.groupStart}` : ""}`}
                onRow={(a) => ({ onClick: () => setOpenEntry(a.entryId), title: "Open this entry" })}
              />
            </div>
          </>
        ) : null}

        <ReportFoot>
          <strong>An entry is an adjustment because you said so.</strong> Open one on the{" "}
          <Link href="/journal">Journal screen</Link> and tick <em>Adjusting entry</em>, with a note saying why. Nothing
          is inferred from the date or the accounts, so the middle column is a list of decisions somebody made and can
          defend, which is the only version worth putting in front of a reviewer.{" "}
          {r.balanced ? (
            "Debits equal credits in all three column pairs."
          ) : (
            <>
              <strong>Note:</strong> the columns do not agree, which should not happen while every entry balances.
            </>
          )}
        </ReportFoot>
      </>
    );

  const paper = (
    <ReportPaper
      companyName={companyName}
      title="Working Trial Balance"
      range={rangeText(ran.from, ran.to)}
      currencyCode={baseCurrency}
    >
      {report ? (
        body(report)
      ) : (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          {loading ? (
            <Space orientation="vertical" size={12}>
              <Spin size="large" />
              <span className={styles.muted}>Reading the books…</span>
            </Space>
          ) : (
            <span className={styles.muted}>The report has not been run.</span>
          )}
        </div>
      )}
    </ReportPaper>
  );

  return (
    <div>
      <FilterBar
        ariaLabel="Report period and exports"
        actions={
          <Space wrap>
            {sheet ? <ReportExportButtons sheet={sheet} disabled={loading} /> : null}
            <Button
              disabled={!sheet || loading}
              onClick={() => sheet && downloadTextFile(`${sheet.fileName}.csv`, csvFromExportSheet(sheet))}
            >
              CSV
            </Button>
          </Space>
        }
      >
        <Select<PeriodPreset>
          aria-label="Period"
          value={preset}
          onChange={choosePreset}
          options={PERIOD_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
          style={{ width: 150 }}
        />
        <DatePicker
          aria-label="From"
          prefix={<span className={styles.muted}>From</span>}
          value={dayjs(from)}
          allowClear={false}
          onChange={(d) => {
            if (!d) return;
            setFrom(d.format("YYYY-MM-DD"));
            setPreset("custom");
          }}
        />
        <DatePicker
          aria-label="To"
          prefix={<span className={styles.muted}>To</span>}
          value={dayjs(to)}
          allowClear={false}
          onChange={(d) => {
            if (!d) return;
            setTo(d.format("YYYY-MM-DD"));
            setPreset("custom");
          }}
        />
        <Button type="primary" onClick={() => void run(from, to)} loading={loading}>
          Run
        </Button>
      </FilterBar>

      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}

      {report && loading ? (
        <Spin spinning description="Reading the books again…">
          {paper}
        </Spin>
      ) : (
        paper
      )}

      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </div>
  );
}
```

- [ ] **Step 5: List it in the Report Center**

In `ctyhp-accounting/lib/domain/report-catalog.ts`, insert directly before the `exception-report` entry:

```ts
  {
    id: "working-trial-balance",
    title: "Working Trial Balance",
    description:
      "The trial balance in three column pairs — unadjusted, adjustments, adjusted — with every adjusting entry and the reason for it.",
    href: "/reports/working-trial-balance",
    group: "accounting",
  },
```

- [ ] **Step 6: Typecheck, lint and the gates**

Run: `npm run typecheck`, `npx eslint "app/(app)/reports/working-trial-balance" components/reports lib/domain/report-catalog.ts`, then `npx vitest run tests/unit/report-catalog.test.ts tests/unit/table-adoption.test.ts tests/unit/rsc-antd.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/customer-data.test.ts`
Expected: all exit 0 / PASS.

- [ ] **Step 7: Commit**

```bash
git add -- "app/(app)/reports/working-trial-balance/page.tsx" "app/(app)/reports/working-trial-balance/actions.ts" "app/(app)/reports/working-trial-balance/WorkingTrialBalanceClient.tsx" components/reports/report-paper.module.css lib/domain/report-catalog.ts
printf '%s\n' "feat(working-tb): the report, laid out as the prototype lays it out" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 9: Changelog, and the four gates

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts` (a release at the top of `RELEASES`)

- [ ] **Step 1: Add release 1.65**

Insert as the first element of `RELEASES` in `lib/domain/changelog.ts` (the date is the day it ships):

```ts
  {
    version: "1.65",
    date: "2026-09-28",
    headline: "The Working Trial Balance: what the books said, what was adjusted and why, and what they say now.",
    changes: [
      {
        kind: "added",
        title: "Working Trial Balance",
        detail:
          "The trial balance in three column pairs — unadjusted, adjustments, adjusted — for any period, with every adjusting entry listed underneath with the reason for it. Earlier years' profit is carried on one retained-earnings line so all three pairs balance. Click an adjustment to see the whole entry. Save it as PDF, Excel or CSV.",
        route: "/reports/working-trial-balance",
      },
      {
        kind: "added",
        title: "Mark an entry as an adjusting entry",
        detail:
          "Open an entry on the Journal screen and tick Adjusting entry, with a note saying why. Nothing is inferred from the date or the accounts: an entry is an adjustment because somebody said so. An entry in a closed period asks once before it changes, and every mark is recorded in the audit log. Marking changes no balance.",
        route: "/journal",
      },
      {
        kind: "changed",
        title: "Depreciation counts as an adjusting entry",
        detail:
          "Every depreciation charge, including those already posted, is marked adjusting, so it appears in the middle column of the Working Trial Balance. The charge itself is unchanged.",
        route: "/fixed-assets",
      },
    ],
  },
```

- [ ] **Step 2: Run the four gates**

Run each, and read the whole output (do not trim it):

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: `npm test` all files pass (2,373 + the new tests); typecheck, lint and build exit 0.

- [ ] **Step 3: Commit**

```bash
git add -- lib/domain/changelog.ts
printf '%s\n' "chore(changelog): 1.65, the working trial balance" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 10: Apply the migration, prove it, look at the screens, hand over

This task changes the live database and needs the client's go-ahead first.

- [ ] **Step 1: Ask before applying**

Tell the client, in Vietnamese: migration 0124 adds one table, two functions and one trigger to every company; it writes no journal entry or line; the rollback run in Task 2 passed. Ask for approval. Do not continue without it.

- [ ] **Step 2: Apply to every company**

Run: `node --env-file=.env.local scripts/migrate.mjs`
Expected: 0124 applied to each company schema, no error.

- [ ] **Step 3: Prove it again, on the applied schema**

Run: `node --env-file=.env.local scripts/verify-adjusting-entries.mjs` then `npm run verify:company-provisioning`
Expected: `N passed, 0 failed`; provisioning self-check clean.

- [ ] **Step 4: Look at it**

Start the built server detached (PowerShell `Start-Process npm.cmd -ArgumentList start -WindowStyle Hidden -RedirectStandardOutput … -RedirectStandardError …`). Run `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000` (expect all pages rendered) and `node --env-file=.env.local scripts/verify-table-fit.mjs http://localhost:3000 --only=reports/working-trial-balance,journal` (expect PASS).

Write a temporary, read-only Playwright script in `ctyhp-accounting/` (sign-in with `smokeSession()` from `scripts/smoke-environment.mjs`, cookie `onebook-company`, hard 240 s timeout, never clicks a checkbox or Save) and screenshot to the scratchpad, light and dark (`colorScheme`), for a real company and the sample company:
- `/reports/working-trial-balance` full page, preset "This year" and "All dates";
- an adjustment row clicked → the Transaction detail sheet;
- `/journal?entry=<an adjusting entry id>` with its row expanded, showing the checkbox and note.

Review every picture against `reportWorkingPapers` in the prototype: the two-row header, coloured adjustments, bold adjusted figures, the double rule under Total, the AJE list, the footer sentence, the empty state. Fix what is wrong, rebuild, re-shoot. Delete the temporary script.

- [ ] **Step 5: Show the client, then push and open the PR**

Send the client the screenshots. After they approve: `git push -u origin feat/working-trial-balance`, then open a PR into `main` (or hand over the title and body if `gh` cannot authenticate). The migration is already live, so merging is safe.
