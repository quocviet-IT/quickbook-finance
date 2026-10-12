# Statement Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release 1.98, the mockup's two statement checks.
- **A balance posted as payments** (`ghostGroups`): a run of entries for one payee that lands on the account's own balance, date after date.
- **A bank account below zero since its last agreed statement** (`negativeWatch`).

They show on the Reconcile start screen for the chosen account, as two new Reports › Exceptions checks, and as a note on the Balance Sheet. A flagged group can be removed in one safe, all-or-nothing step.

**Architecture:**
- **Database:** migration 0140 adds two functions and no tables.
  - `acc_balance_entry_blockers` lists what cannot be removed.
  - `acc_remove_balance_entries` removes a group in one transaction: it reverses manual and opening-balance entries, and voids bank entries and deletes their bank line.
- **Pure logic:**
  - `lib/domain/statement-alerts.ts`: the two detectors, the copy builders, and leaving reversed pairs out.
  - `lib/domain/reconcile-alerts-screen.ts`: the screen's helpers.
  - `lib/domain/exceptions.ts`: goes from 8 to 10 checks.
- **Service and actions:**
  - `lib/services/statement-alerts.ts` reads every line of an account, paged, and calls the two functions.
  - `statementAlertsAction` and `removeBalanceGroupAction` serve Reconcile.
  - `balanceSheetNoteAction` serves the Balance Sheet.
  - The Exceptions service reads all accounts once.
- **Screens:**
  - Reconcile gets cards above its list and keeps the account in `?account=`.
  - Exceptions gets two sections.
  - The Balance Sheet gets an amber note.

**Tech Stack:**
- Next.js 16 App Router, React 19, Ant Design 6, Zod 4
- Supabase/PostgREST, one schema per company; plpgsql
- vitest

**Source of truth:**
- **Spec:** `docs/superpowers/specs/2026-10-10-statement-alerts-design.md`, including its "Amendments from pre-building".
- **Code:** every file in this plan was first built and run on a local pre-build branch. There it passed:
  - typecheck, lint, unit tests (322 files), build and bundle budget;
  - the rolled-back verification script against the live functions (80 of 80);
  - the read-only live check on all six companies;
  - a two-round smoke on the sample company PC-Test, light, dark and phone.
- **How the code is given here:**
  - New files are given whole.
  - Edits to existing files are find/replace pairs that reproduce the pre-build exactly when applied in order.
  - A file rewritten by more than half is given whole.

**Do not "improve" the given code while transcribing it.** It has been verified against the real database and in a browser. If something looks wrong, stop and report it instead of changing it.

## Global Constraints

- **Copy:**
  - US English, with names and sentences exactly as the spec gives them.
  - Keep typographic quotes, apostrophes and dashes (’ “ ” —) exactly as given. Never turn ’ into ' or — into -.
- **Money:** base-currency minor units. Comparisons are exact in minor units.
- **Thresholds:**
  - `GHOST_MIN = 3` and `GHOST_SHARE = 0.6`.
  - Six outstanding payments are shown.
  - An offset counts as good at three lines, or at any count when it is zero.
- **Dates:** in the company's time zone. Never use `new Date().toISOString()` for "today".
- **Reads:** every list read pages past PostgREST's silent 1,000-row cap, in a total order ending in a unique column (`readAllPages`). `getGeneralLedger` is not used.
- **Tables:**
  - Every list goes through `DataTable` or `ReportTable`. Never import antd's `Table` in a new screen.
  - No `scroll={{ x }}`. Columns fit the 1280 box.
  - No literal `pageSize` pinning.
- **JSX:** never put an HTML entity (`&apos;`, `&quot;`) right after an element.
- **Server Components:** `page.tsx` never reads Ant Design sub-components.
- **Migration 0140:**
  - Unqualified names, with `set search_path = public;` at the top.
  - SECURITY DEFINER with a pinned `search_path`.
  - Executable by `authenticated` and `service_role`, and revoked from `public` and `anon`.
  - It is already live on all six companies, applied by the controller with the user's approval. Never run `scripts/migrate.mjs`, `provision-company` or `verify:balance-entries` from an implementer task.
- **Database:** implementer tasks touch no database. The verification script and the live check are run by the controller alone, one at a time.
- **Test data:** the repository is public, so tests use invented data only.
- **Commits:**
  - Stage files by name, never `git add -A` / `git add .`.
  - Never stage `.claude/settings.json`.
  - Use exactly `git commit -m "<message>"`, with NO Co-Authored-By trailer and no mention of Claude or AI.
- **Gates:**
  - Run them from `ctyhp-accounting/`.
  - If tsc complains about stale `.next/types`, delete `.next/types` and rerun.
  - Read the pass/fail lines in full; never pipe them through `tail` or `head`.

---

### Task 1: Migration 0140 — remove a flagged group safely

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/balance-entries-migration.test.ts`
- Create: `ctyhp-accounting/supabase/migrations/0140_remove_balance_entries.sql`
- Create: `ctyhp-accounting/scripts/verify-balance-entries.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes (existing): `acc_post_entry`, `acc_journal_reversal_link`, `acc_audit_log`, `acc_reconciliation`, `acc_reconciliation_line`, `acc_statement_reconciliation`, `acc_bank_transaction`, the period-close check and `acc_is_staff()` / `acc_has_permission()` (all from earlier migrations).
- Produces:
  - `acc_balance_entry_blockers(p_entry_ids uuid[])` → table `(entry_id uuid, entry_number text, reason text)`: one row per entry that cannot be removed, empty when all can go.
  - `acc_remove_balance_entries(p_bank_account_id uuid, p_entry_ids uuid[], p_reason text)` → jsonb `{removed, reversed, voided, total_minor}`; refuses the whole request, naming every blocked entry, when any cannot go.
  - `npm run verify:balance-entries` (rolled-back checks; the controller runs it).

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/balance-entries-migration.test.ts`** with exactly this content:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(file: string): string {
  return readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8").replace(/\r/g, "");
}

/** Block and line comments removed, \r already gone. */
function strip(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** The text of one `create or replace function <name>(` statement, up to its closing `$$;`. */
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function ${name}\\(`, "i"));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end + 3);
}

const raw = read("0140_remove_balance_entries.sql");
const sql = strip(raw);
const blockers = functionText(sql, "acc_balance_entry_blockers");
const remove = functionText(sql, "acc_remove_balance_entries");

describe("0140 remove balance entries: shape", () => {
  it("creates exactly the two functions", () => {
    const created = [...sql.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(["acc_balance_entry_blockers", "acc_remove_balance_entries"]);
  });

  it.each([
    ["acc_balance_entry_blockers", blockers],
    ["acc_remove_balance_entries", remove],
  ])("%s is security definer with a fixed search_path", (_name, text) => {
    const header = text.slice(0, text.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("is idempotent: functions are created or replaced, nothing else is created", () => {
    expect(sql).not.toMatch(/create (table|type|index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\bcreate function\b/i);
  });

  it("returns the documented shapes", () => {
    expect(blockers).toMatch(/returns table \(entry_id uuid, entry_number text, reason text\)/i);
    expect(remove).toMatch(/returns jsonb/i);
    expect(remove).toMatch(
      /jsonb_build_object\('removed', v_count, 'reversed', v_reversed,\s*'voided', v_voided, 'total_minor', v_total\)/i,
    );
  });

  it("the blockers function is read-only", () => {
    expect(blockers.slice(0, blockers.indexOf("$$"))).toMatch(/\bstable\b/i);
    expect(blockers).not.toMatch(/\b(insert into|update\s+\w+\s+set|delete from)\b/i);
  });
});

describe("0140 grants", () => {
  it.each([
    "acc_balance_entry_blockers\\(uuid\\[\\]\\)",
    "acc_remove_balance_entries\\(uuid, uuid\\[\\], text\\)",
  ])("%s: revoked from public and anon, executable by signed-in users and the service role", (sig) => {
    expect(sql).toMatch(new RegExp(`revoke all on function ${sig} from public, anon`, "i"));
    expect(sql).toMatch(new RegExp(`grant execute on function ${sig} to authenticated, service_role`, "i"));
  });
});

describe("0140 who may call", () => {
  it("both functions require staff", () => {
    for (const text of [blockers, remove]) expect(text).toMatch(/if not acc_is_staff\(\) then\s+raise exception/i);
  });

  it("removing needs the journal-posting permission, checked after staff", () => {
    expect(remove).toMatch(/if not acc_has_permission\('journal\.post'\) then\s+raise exception/i);
    expect(remove.indexOf("acc_has_permission('journal.post')")).toBeGreaterThan(remove.indexOf("acc_is_staff()"));
  });

  it("the permission is checked before anything is read or written", () => {
    expect(remove.indexOf("acc_has_permission('journal.post')")).toBeLessThan(remove.indexOf("for update"));
  });
});

describe("0140 refusals of the request itself", () => {
  it("requires a reason, a non-empty list, distinct ids and a real bank account", () => {
    expect(remove).toMatch(/v_reason\s+text := btrim\(coalesce\(p_reason, ''\)\)/i);
    expect(remove).toMatch(/if v_reason = '' then\s+raise exception/i);
    expect(remove).toMatch(/cardinality\(p_entry_ids\) = 0/i);
    expect(remove).toMatch(/names the same entry more than once/i);
    expect(remove).toMatch(/Bank account not found/i);
  });

  it("an entry with no line on the bank account's ledger account is refused", () => {
    expect(remove).toMatch(/from acc_bank_account b join acc_account a on a\.id = b\.account_id/i);
    expect(remove).toMatch(/not exists \(select 1 from acc_journal_line l\s+where l\.journal_entry_id = e\.id and l\.account_id = v_ledger\)/i);
    expect(remove).toMatch(/have no line on %/i);
  });

  it("locks the entries in id order before deciding anything", () => {
    expect(remove).toMatch(/where id = any \(p_entry_ids\) order by id for update/i);
    expect(remove.indexOf("for update")).toBeLessThan(remove.indexOf("acc_balance_entry_blockers(p_entry_ids)"));
  });

  it("one exception lists every blocked entry, and it comes before any change", () => {
    expect(remove).toMatch(/acc_balance_entry_blockers\(p_entry_ids\)/i);
    expect(remove).toMatch(/raise exception '% of these entries cannot be removed: %', v_blocked, v_list/i);
    const refusal = remove.indexOf("cannot be removed: %");
    for (const change of ["acc_post_entry(", "update acc_journal_entry set", "delete from acc_bank_transaction", "insert into acc_audit_log"]) {
      expect(remove.indexOf(change), change).toBeGreaterThan(refusal);
    }
  });
});

describe("0140 every blocker reason", () => {
  it("an unknown id", () => {
    expect(blockers).toMatch(/found_id is null then\s+'is not in the books'/i);
    expect(blockers).toMatch(/left join acc_journal_entry e on e\.id = i\.id/i);
  });

  it("not posted, already reversed, itself a reversal", () => {
    expect(blockers).toMatch(/f\.status <> 'posted' then\s+'is not posted/i);
    expect(blockers).toMatch(/original_entry_id = e\.id\) as is_reversed/i);
    expect(blockers).toMatch(/f\.is_reversed then\s+'has already been reversed'/i);
    expect(blockers).toMatch(/reversal_entry_id = e\.id\) as is_reversal/i);
    expect(blockers).toMatch(/itself a reversal/i);
  });

  it("a line ticked in a COMPLETED reconciliation names the statement date", () => {
    expect(blockers).toMatch(/sr\.status = 'completed'/i);
    expect(blockers).toMatch(/join acc_reconciliation_line rl|from acc_reconciliation_line rl/i);
    expect(blockers).toMatch(/is ticked in the reconciliation for the statement dated/i);
    expect(blockers).toMatch(/to_char\(f\.signed_on, 'Mon FMDD, YYYY'\)/i);
  });

  it("a closed period", () => {
    expect(blockers).toMatch(/acc_is_period_closed\(e\.entry_date\) as is_closed/i);
    expect(blockers).toMatch(/in a closed period/i);
  });

  it("a document-owned entry names the kind, the number when cheap, and what to void", () => {
    expect(blockers).toMatch(/f\.source_type not in \('manual', 'opening_balance', 'bank'\)/i);
    expect(blockers).toMatch(/'belongs to '/i);
    expect(blockers).toMatch(/coalesce\(' ' \|\| f\.doc_number, ''\)/i);
    expect(blockers).toMatch(/'; void the '/i);
    expect(blockers).toMatch(/' instead'/i);
    for (const table of ["acc_invoice", "acc_bill", "acc_payment", "acc_expense"]) {
      expect(blockers).toMatch(new RegExp(`left join ${table} \\w+ on`, "i"));
    }
    for (const kind of ["bill payment", "tax payment", "goods receipt", "inventory adjustment", "asset disposal", "stock count"]) {
      expect(blockers).toContain(`'${kind}'`);
    }
  });

  it("a bank entry settled against an invoice or bill", () => {
    expect(blockers).toMatch(/s\.status = 'approved' and s\.journal_line_id is null/i);
    expect(blockers).toMatch(/f\.source_type = 'bank' and f\.is_settled then\s+'is a bank line settled against an invoice or bill/i);
  });

  it("the other bank cases that cannot be removed safely", () => {
    expect(blockers).toMatch(/f\.source_type = 'bank' and f\.source_id is not null then\s+'is a recode/i);
    expect(blockers).toMatch(/f\.bank_lines = 0 then\s+'has no bank line attached/i);
    expect(blockers).toMatch(/f\.bank_lines > 1 then\s+'answers for more than one bank line/i);
  });

  it("applies the reasons in the documented order", () => {
    const at = (needle: string) => blockers.indexOf(needle);
    const order = [
      "is not in the books",
      "is not posted",
      "has already been reversed",
      "is ticked in the reconciliation",
      "in a closed period",
      "'belongs to '",
      "is a recode",
      "settled against an invoice or bill",
    ].map(at);
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe("0140 how entries are removed", () => {
  it("a manual or opening-balance entry is reversed on its own date through acc_post_entry", () => {
    expect(remove).toMatch(/source_type::text in \('manual', 'opening_balance'\)/i);
    expect(remove).toMatch(/v_rev := acc_post_entry\(v_entry\.entry_date,/i);
    expect(remove).toMatch(/'Reversal of ' \|\| v_entry\.entry_number \|\| ' — ' \|\| v_reason/i);
  });

  it("swaps debit and credit and carries the rest of the line as acc_reverse_entry does", () => {
    expect(remove).toMatch(/'debit_minor', l\.credit_minor/i);
    expect(remove).toMatch(/'credit_minor', l\.debit_minor/i);
    expect(remove).toMatch(/'amount_base_minor', l\.amount_base_minor/i);
    expect(remove).toMatch(/'tax_code_id', l\.tax_code_id/i);
    expect(remove).toMatch(/'memo', 'Reversal: ' \|\| coalesce\(l\.memo, ''\)/i);
  });

  it("marks the reversal exactly as acc_reverse_entry does", () => {
    const original = functionText(strip(read("0018_manual_journal_functions.sql")), "acc_reverse_entry");
    const mark = /insert into acc_journal_reversal_link \(original_entry_id, reversal_entry_id, reason, created_by\)\s+values \((?:p_entry_id|v_entry\.id), v_rev, (?:p_reason|v_reason), auth\.uid\(\)\)/i;
    expect(original).toMatch(mark);
    expect(remove).toMatch(mark);
    const audit = /insert into acc_audit_log \(table_name, record_id, action, actor_id\)\s+values \('acc_journal_entry', (?:p_entry_id|v_entry\.id), 'reverse', auth\.uid\(\)\)/i;
    expect(original).toMatch(audit);
    expect(remove).toMatch(audit);
    expect(remove).toMatch(/v_entry\.source_type, v_entry\.id, v_entry\.currency_code, v_lines/i);
  });

  it("a bank entry is voided with its recode, its match released and its line deleted", () => {
    expect(remove).toMatch(/update acc_journal_entry set status = 'void', voided_at = now\(\)/i);
    expect(remove).toMatch(/\(id = v_entry\.id or \(source_type = 'bank' and source_id = v_entry\.id\)\)/i);
    expect(remove).toMatch(/delete from acc_reconciliation where bank_transaction_id = v_txn/i);
    expect(remove).toMatch(/delete from acc_bank_transaction where id = v_txn/i);
  });

  it("deletes only the one line, never the rest of its import batch", () => {
    expect(remove).not.toMatch(/transaction_batch_id|acc_import_batch|acc_bank_import_batch/i);
    expect(remove).not.toMatch(/delete from acc_bank_transaction where (?!id = v_txn)/i);
  });

  it("never hard-deletes a journal entry or a journal line", () => {
    expect(sql).not.toMatch(/delete\s+from\s+acc_journal_entry\b/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_journal_line\b/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it("lets go of ticks in a session still in progress, never a completed one", () => {
    expect(remove).toMatch(/delete from acc_reconciliation_line rl[\s\S]*?sr\.status <> 'completed'/i);
  });
});

describe("0140 the change-log row", () => {
  it("names the account, the payee, the count and the total, once", () => {
    expect(remove.match(/insert into acc_audit_log \(table_name, record_id, action, actor_id, before_json\)/gi)).toHaveLength(1);
    expect(remove).toMatch(/'acc_bank_account', p_bank_account_id, 'remove_balance_entries'/i);
    for (const key of ["account", "payee", "count", "total_minor", "reason"]) {
      expect(remove).toContain(`'${key}'`);
    }
  });

  it("the audit row comes after every change", () => {
    const row = remove.indexOf("'remove_balance_entries'");
    expect(row).toBeGreaterThan(remove.indexOf("delete from acc_bank_transaction"));
    expect(row).toBeGreaterThan(remove.indexOf("insert into acc_journal_reversal_link"));
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/balance-entries-migration.test.ts
```

Expected: FAIL — `supabase/migrations/0140_remove_balance_entries.sql` does not exist yet.

- [ ] **Step 3: Create `ctyhp-accounting/supabase/migrations/0140_remove_balance_entries.sql`** with exactly this content:

```sql
-- ============================================================================
-- 0140  Removing a group of bank entries that are a balance, not payments
--
-- Statement alerts (1.98) flag a run of entries on a bank account that track
-- the account's own balance: a Balance column read as amounts. Removing them is
-- the hard part, because the entries have different origins and OneBook already
-- has a careful way to take each kind back:
--
--   * manual / opening_balance  reversed, never deleted (acc_reverse_entry, 0018)
--   * bank (categorised line)   void the entry, delete the line (0114)
--   * anything else             belongs to a document; the document is voided
--
-- Two functions, in this order of use:
--
--   acc_balance_entry_blockers  read-only: which of these entries cannot be
--                               removed, and what to do instead.
--   acc_remove_balance_entries  all or nothing, in one transaction. It refuses
--                               the whole request when the first function finds
--                               anything, listing every blocked entry at once.
--
-- Nothing here deletes a journal entry or a journal line. A manual entry is
-- reversed on its own date so every report for that date comes out right; a
-- bank entry is voided (status = 'void'), as Delete line does today.
--
-- A line that came in with a transactions-import batch is voided and deleted
-- directly, for that line only. acc_uncategorise_bank_transaction refuses such
-- a line ("undo that import instead") because it would leave the batch's own
-- bookkeeping half-undone; here the rest of the batch is left alone by design.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Which of these entries cannot be removed, and why. One row each, with the
--    first reason that applies, in the order a person would fix them.
-- ----------------------------------------------------------------------------
create or replace function acc_balance_entry_blockers(p_entry_ids uuid[])
returns table (entry_id uuid, entry_number text, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to check entries for removal';
  end if;

  return query
  with ids as (
    select distinct u.id from unnest(coalesce(p_entry_ids, '{}'::uuid[])) as u(id)
  ),
  facts as (
    select i.id as entry_id,
           e.id as found_id,
           e.entry_number,
           e.status::text as status,
           e.source_type::text as source_type,
           e.source_id,
           e.entry_date,
           exists (select 1 from acc_journal_reversal_link k where k.original_entry_id = e.id) as is_reversed,
           exists (select 1 from acc_journal_reversal_link k where k.reversal_entry_id = e.id) as is_reversal,
           (select min(sr.statement_ending_date)
              from acc_reconciliation_line rl
              join acc_statement_reconciliation sr
                on sr.id = rl.reconciliation_id and sr.status = 'completed'
              join acc_journal_line l on l.id = rl.journal_line_id
             where l.journal_entry_id = e.id) as signed_on,
           acc_is_period_closed(e.entry_date) as is_closed,
           coalesce(inv.invoice_number, bl.bill_number, pay.payment_number, ex.expense_number) as doc_number,
           -- The bank lines this entry answers for: approved matches on its own lines.
           (select count(distinct r.bank_transaction_id)
              from acc_reconciliation r
              join acc_journal_line l on l.id = r.journal_line_id
             where l.journal_entry_id = e.id and r.status = 'approved') as bank_lines,
           exists (
             select 1
               from acc_reconciliation r
               join acc_journal_line l on l.id = r.journal_line_id
               join acc_reconciliation s on s.bank_transaction_id = r.bank_transaction_id
              where l.journal_entry_id = e.id and r.status = 'approved'
                and s.status = 'approved' and s.journal_line_id is null
           ) as is_settled
      from ids i
      left join acc_journal_entry e on e.id = i.id
      left join acc_invoice inv on inv.id = e.source_id and e.source_type::text = 'invoice'
      left join acc_bill bl on bl.id = e.source_id and e.source_type::text = 'bill'
      left join acc_payment pay on pay.id = e.source_id and e.source_type::text = 'payment'
      left join acc_expense ex on ex.id = e.source_id and e.source_type::text = 'expense'
  ),
  judged as (
    select f.entry_id,
           f.entry_number,
           case
             when f.found_id is null then
               'is not in the books'
             when f.status <> 'posted' then
               'is not posted, so there is nothing to remove'
             when f.is_reversed then
               'has already been reversed'
             when f.is_reversal then
               'is itself a reversal of another entry, so it cannot be reversed again'
             when f.signed_on is not null then
               'is ticked in the reconciliation for the statement dated '
               || to_char(f.signed_on, 'Mon FMDD, YYYY')
               || '; reopen that reconciliation first'
             when f.is_closed then
               'is dated ' || to_char(f.entry_date, 'Mon FMDD, YYYY')
               || ', in a closed period; reopen the period first'
             when f.source_type not in ('manual', 'opening_balance', 'bank') then
               'belongs to '
               || case f.source_type
                    when 'bill_payment' then 'bill payment'
                    when 'tax_payment' then 'tax payment'
                    when 'goods_receipt' then 'goods receipt'
                    when 'inventory_adjustment' then 'inventory adjustment'
                    when 'asset_disposal' then 'asset disposal'
                    when 'stock_count' then 'stock count'
                    when 'reconciliation' then 'reconciliation adjustment'
                    else f.source_type
                  end
               || coalesce(' ' || f.doc_number, '')
               || '; void the '
               || case f.source_type
                    when 'bill_payment' then 'bill payment'
                    when 'tax_payment' then 'tax payment'
                    when 'goods_receipt' then 'goods receipt'
                    when 'inventory_adjustment' then 'inventory adjustment'
                    when 'asset_disposal' then 'asset disposal'
                    when 'stock_count' then 'stock count'
                    when 'reconciliation' then 'reconciliation adjustment'
                    else f.source_type
                  end
               || ' instead'
             when f.source_type = 'bank' and f.source_id is not null then
               'is a recode of another bank entry; remove that bank line instead'
             when f.source_type = 'bank' and f.is_settled then
               'is a bank line settled against an invoice or bill; remove that payment first'
             when f.source_type = 'bank' and f.bank_lines = 0 then
               'has no bank line attached, so it cannot be removed here'
             when f.source_type = 'bank' and f.bank_lines > 1 then
               'answers for more than one bank line (a transfer); delete the lines from Banking instead'
             else null
           end as why
      from facts f
  )
  select j.entry_id, j.entry_number, j.why
    from judged j
   where j.why is not null
   order by j.entry_number nulls last, j.entry_id;
end;
$$;

revoke all on function acc_balance_entry_blockers(uuid[]) from public, anon;
grant execute on function acc_balance_entry_blockers(uuid[]) to authenticated, service_role;

comment on function acc_balance_entry_blockers(uuid[]) is
  'Read-only. One row per entry that cannot be removed as a posted balance, '
  'with the reason and what to do instead. Unknown ids are reported too.';

-- ----------------------------------------------------------------------------
-- 2. Remove them, all or nothing.
-- ----------------------------------------------------------------------------
create or replace function acc_remove_balance_entries(
  p_bank_account_id uuid,
  p_entry_ids       uuid[],
  p_reason          text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ledger    uuid;
  v_ledger_nm text;
  v_reason    text := btrim(coalesce(p_reason, ''));
  v_count     int;
  v_off       int;
  v_blocked   int;
  v_list      text;
  v_entry     acc_journal_entry;
  v_lines     jsonb;
  v_rev       uuid;
  v_txn       uuid;
  v_total     bigint;
  v_reversed  int := 0;
  v_voided    int := 0;
  v_payee     text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to remove entries';
  end if;
  if not acc_has_permission('journal.post') then
    raise exception 'You do not have permission to post journal entries';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to remove these entries';
  end if;
  if p_entry_ids is null or cardinality(p_entry_ids) = 0 then
    raise exception 'Choose at least one entry to remove';
  end if;
  if exists (select 1 from unnest(p_entry_ids) as u(id) where u.id is null) then
    raise exception 'The list of entries holds an empty id';
  end if;
  select count(distinct u.id) into v_count from unnest(p_entry_ids) as u(id);
  if v_count <> cardinality(p_entry_ids) then
    raise exception 'The list of entries names the same entry more than once';
  end if;

  select b.account_id, a.name into v_ledger, v_ledger_nm
    from acc_bank_account b join acc_account a on a.id = b.account_id
   where b.id = p_bank_account_id;
  if v_ledger is null then
    raise exception 'Bank account not found';
  end if;

  -- Held to the end of the transaction, in id order so two removals that
  -- overlap wait for each other instead of deadlocking. Whoever comes second
  -- then finds the entries reversed or void and is refused by name.
  perform 1 from acc_journal_entry where id = any (p_entry_ids) order by id for update;

  -- Every entry that exists must sit on this bank account. An id that does not
  -- exist at all is reported by the blockers below, with the others.
  select count(*) into v_off
    from acc_journal_entry e
   where e.id = any (p_entry_ids)
     and not exists (select 1 from acc_journal_line l
                      where l.journal_entry_id = e.id and l.account_id = v_ledger);
  if v_off > 0 then
    raise exception '% of these entries have no line on %, so they are not part of this account',
      v_off, v_ledger_nm;
  end if;

  select count(*), string_agg(coalesce(b.entry_number, 'an unknown entry') || ' (' || b.reason || ')',
                              '; ' order by b.entry_number nulls last, b.entry_id)
    into v_blocked, v_list
    from acc_balance_entry_blockers(p_entry_ids) b;
  if v_blocked > 0 then
    raise exception '% of these entries cannot be removed: %', v_blocked, v_list;
  end if;

  -- What is being taken off the account, and what the entries were called.
  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)
    into v_total
    from acc_journal_line l
   where l.journal_entry_id = any (p_entry_ids) and l.account_id = v_ledger;

  select case when count(*) = count(nullif(btrim(e.description), ''))
               and count(distinct lower(btrim(e.description))) = 1
              then min(btrim(e.description)) end
    into v_payee
    from acc_journal_entry e
   where e.id = any (p_entry_ids);

  for v_entry in
    select * from acc_journal_entry where id = any (p_entry_ids) order by entry_date, entry_number
  loop
    -- A line ticked in a session still in progress is let go, so the session
    -- does not carry a tick for an entry that is no longer standing.
    delete from acc_reconciliation_line rl
     using acc_journal_line l, acc_statement_reconciliation sr
     where rl.journal_line_id = l.id and l.journal_entry_id = v_entry.id
       and sr.id = rl.reconciliation_id and sr.status <> 'completed';

    if v_entry.source_type::text in ('manual', 'opening_balance') then
      -- Marked exactly as acc_reverse_entry marks one: same source type, source
      -- id pointing at the original, a link row, an audit row.
      select jsonb_agg(jsonb_build_object(
               'account_id', l.account_id,
               'debit_minor', l.credit_minor,          -- swap
               'credit_minor', l.debit_minor,          -- swap
               'amount_base_minor', l.amount_base_minor,
               'tax_code_id', l.tax_code_id,
               'memo', 'Reversal: ' || coalesce(l.memo, '')
             ) order by l.line_order)
        into v_lines
        from acc_journal_line l
       where l.journal_entry_id = v_entry.id;

      v_rev := acc_post_entry(v_entry.entry_date,
                 'Reversal of ' || v_entry.entry_number || ' — ' || v_reason,
                 v_entry.source_type, v_entry.id, v_entry.currency_code, v_lines);

      insert into acc_journal_reversal_link (original_entry_id, reversal_entry_id, reason, created_by)
        values (v_entry.id, v_rev, v_reason, auth.uid());
      insert into acc_audit_log (table_name, record_id, action, actor_id)
        values ('acc_journal_entry', v_entry.id, 'reverse', auth.uid());
      v_reversed := v_reversed + 1;
    else
      -- A categorised bank line: void its entry (and any recode of it) and take
      -- the line out, the way Delete line does. The blockers guaranteed exactly
      -- one bank line, not settled against a document.
      select r.bank_transaction_id into v_txn
        from acc_reconciliation r
        join acc_journal_line l on l.id = r.journal_line_id
       where l.journal_entry_id = v_entry.id and r.status = 'approved'
       limit 1;
      perform 1 from acc_bank_transaction where id = v_txn for update;

      update acc_journal_entry set status = 'void', voided_at = now()
       where (id = v_entry.id or (source_type = 'bank' and source_id = v_entry.id))
         and status = 'posted';
      delete from acc_reconciliation where bank_transaction_id = v_txn;
      delete from acc_bank_transaction where id = v_txn;
      v_voided := v_voided + 1;
    end if;
  end loop;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_account', p_bank_account_id, 'remove_balance_entries', auth.uid(),
          jsonb_build_object('account', v_ledger_nm,
                             'payee', v_payee,
                             'count', v_count,
                             'reversed', v_reversed,
                             'voided', v_voided,
                             'total_minor', v_total,
                             'reason', v_reason));

  return jsonb_build_object('removed', v_count, 'reversed', v_reversed,
                            'voided', v_voided, 'total_minor', v_total);
end;
$$;

revoke all on function acc_remove_balance_entries(uuid, uuid[], text) from public, anon;
grant execute on function acc_remove_balance_entries(uuid, uuid[], text) to authenticated, service_role;

comment on function acc_remove_balance_entries(uuid, uuid[], text) is
  'Take a flagged group of entries off a bank account in one transaction: '
  'manual and opening-balance entries are reversed on their own date, bank '
  'lines are voided and deleted. Refuses the whole request when any entry is blocked.';
```

- [ ] **Step 4: Create `ctyhp-accounting/scripts/verify-balance-entries.mjs`** with exactly this content:

```js
/**
 * Behavioural verification of migration 0140 (removing a balance posted as
 * payments) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0140 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing has to be live and
 * nothing is left behind.
 *
 *  - In every schema: structure only. Both functions exist, are security
 *    definer with a fixed search_path, and are closed to anon.
 *  - In co_pc (the sample company) only: the behaviour. A small balance series
 *    is posted on a bank account and removed, then every refusal is exercised.
 *    All dates are in 2099 so no real period or entry is touched.
 *
 * Prints counts and pass/fail lines only.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-balance-entries.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0140_remove_balance_entries.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const REASON = "Verify: a balance column read as payments";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();

const totals = [];
let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
/** Runs `sql`, expecting a refusal holding `expect`; the savepoint puts the books back as they were. */
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    check(label, expect instanceof RegExp ? expect.test(error.message) : error.message.includes(expect), error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
/** Runs `body` as the database owner, then goes back to being `userId`. */
async function asOwner(userId, body) {
  await client.query("reset role");
  try {
    return await body();
  } finally {
    await client.query("set local role authenticated");
    await as(userId);
  }
}

// ---------------------------------------------------------------------------
// Structure, in every schema
// ---------------------------------------------------------------------------
async function structure() {
  for (const fn of ["acc_balance_entry_blockers(uuid[])", "acc_remove_balance_entries(uuid,uuid[],text)"]) {
    const f = await one(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('service_role', p.oid, 'execute') as svc_exec
         from pg_proc p where p.oid = to_regprocedure($1)`,
      [fn],
    );
    check(`${fn} exists, is security definer with search_path`,
      Boolean(f) && f.definer && (f.config ?? []).some((c) => c.startsWith("search_path=")), JSON.stringify(f));
    check(`${fn} is closed to anon, open to signed-in users and the service role`,
      Boolean(f) && !f.anon_exec && f.auth_exec && f.svc_exec, JSON.stringify(f));
    const pub = await one(
      `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where p.oid = to_regprocedure($1) and a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub`,
      [fn],
    );
    check(`${fn} is not executable by public`, pub.pub === false);
  }
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  const bank = await one(`select id, account_id from acc_bank_account order by created_at limit 1`);
  if (!admin || !base || !bank) {
    console.log("  (no active administrator, base currency or bank account; behaviour checks skipped)");
    return;
  }
  const others = await all(
    `select id from acc_account where status = 'active' and is_posting_account and id <> $1 order by account_code limit 2`,
    [bank.account_id],
  );
  if (others.length < 2) {
    console.log("  (fewer than two other posting accounts; behaviour checks skipped)");
    return;
  }
  const [other, other2] = [others[0].id, others[1].id];
  await client.query("set local role authenticated");
  await as(admin.id);

  const ledger = async () =>
    Number((await one(
      `select coalesce(sum(b.debit_base - b.credit_base), 0)::bigint as v
         from acc_ledger_balances(null, '2099-12-31') b where b.account_id = $1`,
      [bank.account_id],
    )).v);
  const post = (date, source, from, to, amount, description = "Verify balance entry") =>
    one(
      `select acc_post_entry($1, $2, $3::acc_journal_source, null, $4,
                             jsonb_build_array(
                               jsonb_build_object('account_id', $5::uuid, 'debit_minor', $7::bigint, 'credit_minor', 0, 'amount_base_minor', $7::bigint),
                               jsonb_build_object('account_id', $6::uuid, 'debit_minor', 0, 'credit_minor', $7::bigint, 'amount_base_minor', $7::bigint))) as id`,
      [date, description, source, base.code, from, to, amount],
    ).then((r) => r.id);
  /** A bank line that categorising turns into a `bank` entry; returns { txn, entry }. */
  let seq = 0;
  const bankLine = async (date, amount, batchId = null) => {
    seq += 1;
    const txn = await asOwner(admin.id, async () =>
      (await one(
        `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, transaction_batch_id)
         values ($1, $2, 'Verify balance entry', $3, $4, $5) returning id`,
        [bank.id, date, amount, `verify-balance-${seq}-${Date.now()}`, batchId],
      )).id);
    await one(`select acc_categorise_bank_transaction($1, $2)`, [txn, other]);
    const entry = (await one(
      `select l.journal_entry_id as id from acc_reconciliation r join acc_journal_line l on l.id = r.journal_line_id
        where r.bank_transaction_id = $1`,
      [txn],
    )).id;
    return { txn, entry };
  };
  const blockersOf = (ids) => all(`select * from acc_balance_entry_blockers($1::uuid[])`, [ids]);
  const REMOVE = `select acc_remove_balance_entries($1, $2::uuid[], $3) as r`;
  const remove = (ids, reason = REASON) => one(REMOVE, [bank.id, ids, reason]).then((x) => x.r);
  const status = async (id) => (await one(`select status::text as s from acc_journal_entry where id = $1`, [id])).s;

  const startBalance = await ledger();

  // ---- the series: three manual entries, two bank lines (one from an import batch)
  const manual = [
    await post("2099-03-10", "manual", bank.account_id, other, 10000),
    await post("2099-03-17", "manual", bank.account_id, other, 20000),
    await post("2099-03-24", "opening_balance", bank.account_id, other, 30000),
  ];
  const batch = await asOwner(admin.id, async () =>
    (await one(
      `insert into acc_import_batch (source, mode, file_name, sha256, entry_count, line_count, total_minor)
       values ('wave_ledger', 'balances', 'verify.csv', repeat('a', 64), 0, 0, 0) returning id`,
    )).id);
  const b1 = await bankLine("2099-03-31", 5000);
  const b2 = await bankLine("2099-03-31", 7000, batch);
  const untouched = await asOwner(admin.id, async () =>
    (await one(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, transaction_batch_id)
       values ($1, '2099-03-31', 'Verify untouched', 9000, $2, $3) returning id`,
      [bank.id, `verify-untouched-${Date.now()}`, batch],
    )).id);
  const series = [...manual, b1.entry, b2.entry];
  check("the series moves the account by its total", (await ledger()) === startBalance + 72000, `${(await ledger()) - startBalance}`);

  // ---- nothing blocks it, and a mixed request is refused whole
  check("no blocker comes back for a clean series", (await blockersOf(series)).length === 0);
  const absent = "00000000-0000-0000-0000-0000000000aa";
  const withUnknown = await blockersOf([...series, absent]);
  check("an unknown id is reported, and only that one",
    withUnknown.length === 1 && withUnknown[0].entry_id === absent && withUnknown[0].entry_number === null, JSON.stringify(withUnknown));

  // ---- removing the series
  const result = await remove(series);
  check("the answer counts what was removed, reversed and voided",
    result.removed === 5 && result.reversed === 3 && result.voided === 2 && Number(result.total_minor) === 72000, JSON.stringify(result));
  const links = await all(
    `select k.original_entry_id, k.reason, o.entry_date::text as od, r.entry_date::text as rd, r.status::text as rs,
            r.source_type::text as rsrc, r.source_id, o.source_type::text as osrc, o.status::text as os
       from acc_journal_reversal_link k
       join acc_journal_entry o on o.id = k.original_entry_id
       join acc_journal_entry r on r.id = k.reversal_entry_id
      where k.original_entry_id = any($1::uuid[])`,
    [manual],
  );
  check("each manual entry has a posted reversal on its own date, marked as acc_reverse_entry marks it",
    links.length === 3 && links.every((l) => l.od === l.rd && l.rs === "posted" && l.rsrc === l.osrc && l.os === "posted" && l.reason === REASON),
    JSON.stringify(links.map((l) => [l.od, l.rd, l.rs])));
  const swapped = await one(
    `select count(*)::int as n
       from acc_journal_reversal_link k
       join acc_journal_line ol on ol.journal_entry_id = k.original_entry_id
       join acc_journal_line rl on rl.journal_entry_id = k.reversal_entry_id and rl.account_id = ol.account_id
      where k.original_entry_id = any($1::uuid[]) and rl.debit_minor = ol.credit_minor and rl.credit_minor = ol.debit_minor`,
    [manual],
  );
  check("every reversal line is the original with debit and credit swapped", swapped.n === 6, `${swapped.n}`);
  check("the bank entries are void", (await status(b1.entry)) === "void" && (await status(b2.entry)) === "void");
  const gone = await one(`select count(*)::int as n from acc_bank_transaction where id = any($1::uuid[])`, [[b1.txn, b2.txn]]);
  check("their bank lines are gone", gone.n === 0);
  check("the rest of the import batch is untouched",
    (await one(`select count(*)::int as n from acc_bank_transaction where id = $1 and transaction_batch_id = $2`, [untouched, batch])).n === 1);
  check("the originals of the manual entries are still in the books",
    (await one(`select count(*)::int as n from acc_journal_entry where id = any($1::uuid[])`, [series])).n === 5);
  check("the account's ledger balance is back to where it started", (await ledger()) === startBalance, `${(await ledger()) - startBalance}`);
  const logs = await all(
    `select before_json from acc_audit_log where action = 'remove_balance_entries' and record_id = $1`,
    [bank.id],
  );
  check("one log row is written, with the count and the total",
    logs.length === 1 && logs[0].before_json.count === 5 && Number(logs[0].before_json.total_minor) === 72000 &&
      logs[0].before_json.payee === "Verify balance entry", JSON.stringify(logs[0]?.before_json ? Object.keys(logs[0].before_json) : logs));
  check("removing the same series again lists every entry as blocked", (await blockersOf(series)).length === 5);

  // ---- refusals
  console.log("  refusals");
  const manualOn = (date) => post(date, "manual", bank.account_id, other, 1000);

  {
    const e = await manualOn("2099-04-02");
    const line = (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [e, bank.account_id])).id;
    await asOwner(admin.id, async () => {
      const s = (await one(
        `insert into acc_statement_reconciliation (bank_account_id, statement_ending_date, statement_ending_balance_minor, status, completed_at)
         values ($1, '2099-04-30', 0, 'completed', now()) returning id`, [bank.id])).id;
      await client.query(`insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values ($1, $2)`, [s, line]);
    });
    const b = await blockersOf([e]);
    check("a line ticked in a completed reconciliation names the statement date", /statement dated Apr 30, 2099/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it is refused", REMOVE, [bank.id, [e], REASON], /1 of these entries cannot be removed: .*Apr 30, 2099/);
  }
  {
    const e = await manualOn("2099-05-10");
    await asOwner(admin.id, () =>
      client.query(
        `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
         values (2099, 5, '2099-05-01', '2099-05-31', 'Verify May 2099', 'closed')`,
      ));
    const b = await blockersOf([e]);
    check("an entry in a closed period is blocked", /closed period/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it is refused", REMOVE, [bank.id, [e], REASON], /closed period/);
  }
  {
    const e = await post("2099-06-10", "payment", bank.account_id, other, 1000);
    const b = await blockersOf([e]);
    check("a document-owned entry says which document to void", /belongs to payment.*void the payment instead/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it is refused", REMOVE, [bank.id, [e], REASON], /belongs to payment/);
  }
  {
    const e = await manualOn("2099-06-12");
    await remove([e]);
    const b = await blockersOf([e]);
    check("an entry already reversed is blocked", /already been reversed/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it again is refused", REMOVE, [bank.id, [e], REASON], /already been reversed/);
    const rev = (await one(`select reversal_entry_id as id from acc_journal_reversal_link where original_entry_id = $1`, [e])).id;
    await refused("a reversal cannot be removed either", REMOVE, [bank.id, [rev], REASON], /itself a reversal/);
  }
  {
    const { txn, entry } = await bankLine("2099-06-14", 3000);
    await asOwner(admin.id, () =>
      client.query(`insert into acc_reconciliation (bank_transaction_id, status, confidence) values ($1, 'approved', 1)`, [txn]));
    const b = await blockersOf([entry]);
    check("a bank line settled against a document is blocked", /settled against an invoice or bill/.test(b[0]?.reason ?? ""), b[0]?.reason);
    await refused("…and removing it is refused", REMOVE, [bank.id, [entry], REASON], /settled against an invoice or bill/);
  }
  {
    const e = await manualOn("2099-06-16");
    const blockedDoc = await post("2099-06-17", "payment", bank.account_id, other, 1000);
    const before = await ledger();
    await refused("one blocked entry stops the whole request", REMOVE, [bank.id, [e, blockedDoc], REASON], /1 of these entries cannot be removed/);
    check("…and the good entry is untouched", (await ledger()) === before && (await status(e)) === "posted");
    await refused("two blocked entries are both listed in one message",
      REMOVE, [bank.id, [blockedDoc, absent], REASON], /2 of these entries cannot be removed: .*belongs to payment.*is not in the books/);
  }
  {
    const e = await manualOn("2099-06-18");
    await refused("an empty reason is refused", REMOVE, [bank.id, [e], "   "], "A reason is required");
    await refused("an empty list is refused", REMOVE, [bank.id, [], REASON], "Choose at least one entry");
    await refused("a repeated id is refused", REMOVE, [bank.id, [e, e], REASON], "more than once");
    await refused("an unknown bank account is refused", REMOVE, [OUTSIDER, [e], REASON], "Bank account not found");
    const elsewhere = await post("2099-06-19", "manual", other, other2, 1000);
    await refused("an entry that is not on that account is refused", REMOVE, [bank.id, [e, elsewhere], REASON], /have no line on/);
    check("…and nothing was reversed", (await status(e)) === "posted" && (await status(elsewhere)) === "posted");
    // A viewer and a staff role without the posting permission, made out of the administrator inside
    // this rolled-back transaction when the company has no such user.
    await client.query("savepoint as_viewer");
    await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]));
    await refused("a viewer cannot remove", REMOVE, [bank.id, [e], REASON], "Not authorized");
    await refused("a viewer cannot ask what blocks", `select * from acc_balance_entry_blockers($1::uuid[])`, [[e]], "Not authorized");
    await client.query("rollback to savepoint as_viewer");
    await client.query("savepoint no_post");
    await asOwner(admin.id, () =>
      client.query(
        `update acc_role_permission set allowed = false
          where permission_key = 'journal.post' and role = (select role from acc_app_user where id = $1)`,
        [admin.id],
      ));
    await refused("staff without the journal-posting permission cannot remove", REMOVE, [bank.id, [e], REASON], "do not have permission");
    await client.query("rollback to savepoint no_post");
    await as(OUTSIDER);
    await refused("an outsider cannot remove", REMOVE, [bank.id, [e], REASON], "Not authorized");
    await refused("an outsider cannot ask what blocks", `select * from acc_balance_entry_blockers($1::uuid[])`, [[e]], "Not authorized");
    await as(admin.id);
  }
}

// ---------------------------------------------------------------------------
const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    const before = { passed, failed };
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '60s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      for (const statement of statements) await client.query(statement);
      console.log("  (0140 applied inside the transaction, never committed)");
      for (const statement of statements) await client.query(statement);
      check("applying 0140 a second time is harmless", true);

      await structure();
      if (schema === SAMPLE) await behaviour();
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${schema} stopped: ${error.message}`);
    } finally {
      await client.query("rollback");
    }
    totals.push({ schema, passed: passed - before.passed, failed: failed - before.failed });
  }
} finally {
  clearTimeout(killer);
  await client.end();
}
console.log("");
for (const t of totals) console.log(`${t.schema}: ${t.passed} passed, ${t.failed} failed`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 5: Edit `ctyhp-accounting/package.json`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```json
    "verify:entitlement": "node --env-file=.env.local scripts/verify-entitlement.mjs",
    "verify:stock-count": "node --env-file=.env.local scripts/verify-stock-count.mjs"
  },
```

replace with:

```json
    "verify:entitlement": "node --env-file=.env.local scripts/verify-entitlement.mjs",
    "verify:stock-count": "node --env-file=.env.local scripts/verify-stock-count.mjs",
    "verify:balance-entries": "node --env-file=.env.local scripts/verify-balance-entries.mjs"
  },
```

- [ ] **Step 6: Do not touch the database**

Migration 0140 is already live on all six companies (the controller applied it with the user's approval). Do not run `scripts/migrate.mjs`, `provision-company`, `npm run verify:balance-entries` or anything else that connects to the database. The controller runs the verification script alone in Task 6.

- [ ] **Step 7: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/balance-entries-migration.test.ts"
npx vitest run tests/unit/balance-entries-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/schema-template.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; balance-entries-migration: 33 tests passing; migration-grants (37 tests) and schema-template (27 tests) pass.

- [ ] **Step 8: Commit**

```bash
git add "ctyhp-accounting/tests/unit/balance-entries-migration.test.ts" "ctyhp-accounting/supabase/migrations/0140_remove_balance_entries.sql" "ctyhp-accounting/scripts/verify-balance-entries.mjs" "ctyhp-accounting/package.json"
git commit -m "feat(statement-alerts): remove a balance posted as payments, safely (migration 0140)"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 2: The two detectors, their words, the service and the Reconcile actions

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/statement-alerts.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/statement-alerts-service.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/statement-alerts-actions.test.ts`
- Create: `ctyhp-accounting/lib/domain/statement-alerts.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Create: `ctyhp-accounting/lib/services/statement-alerts.ts`
- Modify: `ctyhp-accounting/app/(app)/banking/reconcile/actions.ts`
- Test (create): `ctyhp-accounting/tests/live/statement-alerts.live.ts`

**Interfaces:**
- Consumes: Task 1's two database functions; existing `readAllPages` (`lib/services/paging.ts`), `getTransactionList` and `getLedgerBalances` (`lib/services/reports.ts`), `entryDisplayName` (`lib/domain/entry-detail.ts`), `shortDate` (`lib/domain/report-presets`), `listBankAccounts` (live check only), the actions' `guard`, `canWrite`, `hasPermission`.
- Produces:
  - `lib/domain/statement-alerts.ts` (pure): `BankLine`, `LastStatement`, `ReversalPair`, `withoutReversedPairs`, `ghostGroups` → `GhostGroup[]`, `negativeWatch` → `NegativeWatch | null`, `statementAlerts`, `payeeKeyOf`, `GHOST_MIN`, `GHOST_SHARE`, `GHOST_GONE`; the copy builders `ghostCard`, `negativeCard`, `balanceSheetNote` (sentences as `Segment[]` of `{ text, bold?, italic? }`, money through a `CopyFormat`), `segmentsText`, `reconcileHref(id)` = `/banking/reconcile?account=<id>`; the Exceptions rows `statementBalanceRows`, `belowZeroRows` and their sheet text; `BankAccountAlerts`, `BelowZeroAccount`.
  - `lib/services/statement-alerts.ts`: `getBankAccountLines`, `getStatementAlerts`, `getAllStatementAlerts`, `getBalanceEntryBlockers`, `removeBalanceEntries`, `getBelowZeroBankAccounts`, `StatementAlertsError`.
  - `balanceGroupRemoveSchema` in `lib/domain/schemas.ts`.
  - In `app/(app)/banking/reconcile/actions.ts`: `statementAlertsAction(bankAccountId)` → `ActionResult<StatementAlertsView>` (`{ ghosts: (GhostGroup & { blockers })[], negative }`), `removeBalanceGroupAction({ bankAccountId, payee, reason })` → `ActionResult<RemovedBalanceEntries>`.
  - `tests/live/statement-alerts.live.ts` (read-only, every company; run by the controller).

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/statement-alerts.test.ts`** with exactly this content:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GHOST_GONE,
  balanceSheetNote,
  belowZeroRows,
  belowZeroSheetText,
  ghostCard,
  ghostGroups,
  negativeCard,
  negativeWatch,
  reconcileHref,
  segmentsText,
  statementAlerts,
  statementBalanceRows,
  statementBalanceSheetText,
  withoutReversedPairs,
  type BankAccountAlerts,
  type BankLine,
  type GhostGroup,
  type NegativeWatch,
  type ReversalPair,
} from "@/lib/domain/statement-alerts";

const usd = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;
const fmt = { money: usd };

let seq = 0;
function line(date: string, amountMinor: number, payee: string, over: Partial<BankLine> = {}): BankLine {
  seq += 1;
  return {
    lineId: `l${String(seq).padStart(4, "0")}`,
    entryId: `e${String(seq).padStart(4, "0")}`,
    entryNumber: `JE-${String(seq).padStart(6, "0")}`,
    date,
    amountMinor,
    payee,
    narration: "",
    codedTo: ["6000 Wages"],
    sourceType: "manual",
    cleared: false,
    ...over,
  };
}

/** Seven days of ordinary activity, each under its own name so none forms a group. */
function ordinaryDays(): BankLine[] {
  const amounts = [1000, 2000, -500, 3000, 700, 1300, -400];
  return amounts.map((a, i) => line(`2026-01-0${i + 1}`, a, `Counterparty ${i + 1}`));
}
// Running balance after each of those days.
const BALANCES = [1000, 3000, 2500, 5500, 6200, 7500, 7100];

/** A payee's lines posted as magnitude balance[i] + offset on day i+1, money out. */
function postedAsBalance(payee: string, days: number[], offset: number): BankLine[] {
  return days.map((d) => line(`2026-01-0${d}`, -(BALANCES[d - 1] + offset), payee));
}

describe("ghostGroups", () => {
  it("flags a balance series read once, landing exactly on the rest of the account", () => {
    const lines = [...ordinaryDays(), ...postedAsBalance("Payroll", [2, 4, 5, 7], 0)];
    const groups = ghostGroups(lines);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.payee).toBe("Payroll");
    expect(g.agree).toBe(4);
    expect(g.of).toBe(4);
    expect(g.offsetMinor).toBe(0);
    expect(g.runs).toBe(1);
    expect(g.totalMinor).toBe(-(3000 + 5500 + 6200 + 7100));
    expect(g.rows.map((r) => [r.date, r.balanceMinor, r.differenceMinor])).toEqual([
      ["2026-01-02", 3000, 0],
      ["2026-01-04", 5500, 0],
      ["2026-01-05", 6200, 0],
      ["2026-01-07", 7100, 0],
    ]);
    expect(g.entryIds).toHaveLength(4);
  });

  it("works out each row's balance without the group, not with it", () => {
    // If the group's own debits were left in, the balance on day 4 would be
    // lower than 5500 and no row would land on it.
    const lines = [...ordinaryDays(), ...postedAsBalance("Payroll", [2, 3, 4], 0)];
    const [g] = ghostGroups(lines);
    expect(g.rows.map((r) => r.balanceMinor)).toEqual([3000, 2500, 5500]);
  });

  it("finds two runs in a balance read twice, each a fixed distance from the clean balance", () => {
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [1, 2, 3], 100),
      ...postedAsBalance("Daily Balance", [5, 6, 7], 500),
    ];
    const [g] = ghostGroups(lines);
    expect(g.runs).toBe(2);
    expect(g.agree).toBe(6);
    expect(g.of).toBe(6);
    expect(g.rows.map((r) => r.differenceMinor)).toEqual([100, 100, 100, 500, 500, 500]);
    // A tie between the two runs goes to the one nearer zero.
    expect(g.offsetMinor).toBe(100);
  });

  it("takes the most frequent offset as the group's offset", () => {
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [1, 2, 3, 4], 250),
      ...postedAsBalance("Daily Balance", [5, 6, 7], 900),
    ];
    const [g] = ghostGroups(lines);
    expect(g.offsetMinor).toBe(250);
    expect(g.runs).toBe(2);
  });

  it("counts an exact hit with no corroboration as agreeing", () => {
    // Offsets: one exact, three at +100, two scattered. Without the rule that an
    // exact landing needs no company, 3 of 6 agree (50%) and nothing is flagged.
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [1], 0),
      ...postedAsBalance("Daily Balance", [2, 3, 4], 100),
      line("2026-01-05", -(6200 + 11), "Daily Balance"),
      line("2026-01-06", -(7500 + 37), "Daily Balance"),
    ];
    const [g] = ghostGroups(lines);
    expect(g.agree).toBe(4);
    expect(g.of).toBe(6);
    expect(g.runs).toBe(2);
    expect(g.offsetMinor).toBe(100);
    // The two scattered lines are not in the group that would be removed.
    expect(g.rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  });

  it("does not flag an account that is all one payee", () => {
    const lines = [
      line("2026-01-01", -1000, "Payroll"),
      line("2026-01-02", -1000, "Payroll"),
      line("2026-01-03", -2000, "Payroll"),
      line("2026-01-04", -3000, "Payroll"),
      line("2026-01-05", -3000, "Payroll"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("does not flag a payee against a rest of fewer than three lines", () => {
    const lines = [
      line("2026-01-01", 5000, "Counterparty 1"),
      line("2026-01-02", 1000, "Counterparty 2"),
      line("2026-01-03", -5000, "Payroll"),
      line("2026-01-04", -6000, "Payroll"),
      line("2026-01-05", -6000, "Payroll"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("does not flag when under 60% of a payee's lines agree", () => {
    // Three of six agree (50%).
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [2, 4, 5], 0),
      line("2026-01-01", -123, "Daily Balance"),
      line("2026-01-03", -4567, "Daily Balance"),
      line("2026-01-06", -89, "Daily Balance"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("flags at exactly 60%", () => {
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Daily Balance", [2, 4, 5], 0),
      line("2026-01-01", -123, "Daily Balance"),
      line("2026-01-03", -4567, "Daily Balance"),
    ];
    const [g] = ghostGroups(lines);
    expect(g.agree).toBe(3);
    expect(g.of).toBe(5);
  });

  it("does not flag a payee with fewer than three lines", () => {
    const lines = [...ordinaryDays(), ...postedAsBalance("Payroll", [2, 4], 0)];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("looks at nothing on an account with fewer than four lines", () => {
    const lines = [
      line("2026-01-01", 1000, "Counterparty 1"),
      line("2026-01-02", -1000, "Payroll"),
      line("2026-01-03", -1000, "Payroll"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("needs three different balances: three lines on one date prove nothing", () => {
    const lines = [
      ...ordinaryDays(),
      line("2026-01-04", -5500, "Payroll"),
      line("2026-01-04", -5500, "Payroll"),
      line("2026-01-04", -5500, "Payroll"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("needs the balance to move: three dates at one flat balance prove nothing", () => {
    const flat = [
      line("2026-01-01", 5000, "Counterparty 1"),
      line("2026-01-02", 0, "Counterparty 2"),
      line("2026-01-03", 0, "Counterparty 3"),
      line("2026-01-04", 0, "Counterparty 4"),
      line("2026-01-02", -5000, "Payroll"),
      line("2026-01-03", -5000, "Payroll"),
      line("2026-01-04", -5000, "Payroll"),
    ];
    expect(ghostGroups(flat)).toEqual([]);
  });

  it("groups by name ignoring case and spaces, and calls an empty name (no name)", () => {
    const lines = [
      ...ordinaryDays(),
      line("2026-01-02", -3000, "  payroll "),
      line("2026-01-04", -5500, "PAYROLL"),
      line("2026-01-05", -6200, "Payroll"),
    ];
    expect(ghostGroups(lines)[0].agree).toBe(3);

    const blank = [
      ...ordinaryDays(),
      line("2026-01-02", -3000, ""),
      line("2026-01-04", -5500, "  "),
      line("2026-01-05", -6200, ""),
    ];
    expect(ghostGroups(blank)[0].payee).toBe("(no name)");
  });

  it("treats a payee's lines as payments when they do not track the balance", () => {
    const lines = [
      ...ordinaryDays(),
      line("2026-01-02", -1200, "Landlord"),
      line("2026-01-04", -1200, "Landlord"),
      line("2026-01-06", -1200, "Landlord"),
    ];
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("is exact to the cent, not close", () => {
    const lines = [
      ...ordinaryDays(),
      line("2026-01-02", -3001, "Payroll"),
      line("2026-01-04", -5499, "Payroll"),
      line("2026-01-05", -6203, "Payroll"),
    ];
    // Three different offsets of one, one and three cents: none is repeated, none is zero.
    expect(ghostGroups(lines)).toEqual([]);
  });

  it("gives the largest group first", () => {
    const lines = [
      ...ordinaryDays(),
      ...postedAsBalance("Small", [2, 4, 5], 0),
      ...postedAsBalance("Big", [1, 3, 5, 6, 7], 0),
    ];
    // The "Big" lines add to the same balances; each group is judged without the other
    // in its rest, so only the one whose rest still matches is flagged.
    const groups = ghostGroups(lines);
    expect(groups.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < groups.length; i += 1) expect(groups[i - 1].agree).toBeGreaterThanOrEqual(groups[i].agree);
  });

  it("does not change the lines it is given", () => {
    const lines = [...postedAsBalance("Payroll", [2, 4, 5, 7], 0), ...ordinaryDays()];
    const before = lines.map((l) => l.lineId);
    ghostGroups(lines);
    expect(lines.map((l) => l.lineId)).toEqual(before);
  });
});

describe("negativeWatch", () => {
  const last = { date: "2026-01-05", endingMinor: 30_000 };

  it("flags an account that is negative now, with the worst day and the largest unpaid payments", () => {
    const lines = [
      line("2026-01-01", 50_000, "Deposit"),
      line("2026-01-05", -20_000, "Rent", { cleared: true }),
      line("2026-01-10", -40_000, "Supplier A"),
      line("2026-01-12", -2_000, "Supplier B"),
    ];
    const w = negativeWatch(lines, last) as NegativeWatch;
    expect(w.nowMinor).toBe(-12_000);
    expect(w.last).toEqual(last);
    expect(w.worst).toEqual({ date: "2026-01-12", balanceMinor: -12_000 });
    expect(w.outstandingCount).toBe(2);
    expect(w.outstanding.map((o) => [o.name, o.amountMinor])).toEqual([
      ["Supplier A", -40_000],
      ["Supplier B", -2_000],
    ]);
  });

  it("flags a dip since the last statement even when the balance has recovered", () => {
    const lines = [
      line("2026-01-01", 50_000, "Deposit"),
      line("2026-01-05", -20_000, "Rent", { cleared: true }),
      line("2026-01-10", -40_000, "Supplier A"),
      line("2026-01-15", 30_000, "Customer"),
    ];
    const w = negativeWatch(lines, last) as NegativeWatch;
    expect(w.nowMinor).toBe(20_000);
    expect(w.worst).toEqual({ date: "2026-01-10", balanceMinor: -10_000 });
  });

  it("flags an account nobody has reconciled only while it is negative now", () => {
    const negativeNow = [line("2026-01-01", 1_000, "Deposit"), line("2026-01-03", -5_000, "Supplier A")];
    const w = negativeWatch(negativeNow, null) as NegativeWatch;
    expect(w.last).toBeNull();
    expect(w.worst).toBeNull();
    expect(w.nowMinor).toBe(-4_000);
    expect(w.outstandingCount).toBe(1);

    const recovered = [...negativeNow, line("2026-01-09", 9_000, "Customer")];
    expect(negativeWatch(recovered, null)).toBeNull();
  });

  it("is quiet when the balance never went below zero after the last statement", () => {
    const lines = [
      line("2026-01-01", 50_000, "Deposit"),
      line("2026-01-05", -20_000, "Rent", { cleared: true }),
      line("2026-01-10", -10_000, "Supplier A"),
    ];
    expect(negativeWatch(lines, last)).toBeNull();
  });

  it("is quiet for an account at exactly zero, and for no lines at all", () => {
    expect(negativeWatch([line("2026-01-01", 500, "Deposit"), line("2026-01-02", -500, "Rent")], null)).toBeNull();
    expect(negativeWatch([], last)).toBeNull();
  });

  it("flags one cent below zero", () => {
    const w = negativeWatch([line("2026-01-01", 500, "Deposit"), line("2026-01-02", -501, "Rent")], null);
    expect(w?.nowMinor).toBe(-1);
  });

  it("looks at the end of each day, not at the middle of one", () => {
    const lines = [
      line("2026-01-01", 50_000, "Deposit"),
      line("2026-01-05", -20_000, "Rent", { cleared: true }),
      line("2026-01-10", -40_000, "Supplier A"),
      line("2026-01-10", 40_000, "Customer"),
    ];
    expect(negativeWatch(lines, last)).toBeNull();
  });

  it("ignores a dip on or before the statement date", () => {
    const lines = [
      line("2026-01-01", 1_000, "Deposit"),
      line("2026-01-05", -5_000, "Supplier A", { cleared: true }),
      line("2026-01-07", 9_000, "Customer"),
    ];
    expect(negativeWatch(lines, { date: "2026-01-05", endingMinor: -4_000 })).toBeNull();
  });

  it("lists payments after the last statement that no statement holds, never a ticked one or one before it", () => {
    const lines = [
      line("2026-01-01", 90_000, "Deposit"),
      line("2026-01-03", -1_000, "Before the statement"),
      line("2026-01-08", -1_500, "Ticked", { cleared: true }),
      line("2026-01-09", -80_000, "Open A"),
      line("2026-01-10", -20_000, "Open B"),
    ];
    const w = negativeWatch(lines, { date: "2026-01-05", endingMinor: 89_000 }) as NegativeWatch;
    expect(w.outstanding.map((o) => o.name)).toEqual(["Open A", "Open B"]);
    expect(w.outstandingCount).toBe(2);
  });

  it("keeps the six largest, largest first, and counts them all", () => {
    const amounts = [-100, -900, -300, -700, -500, -800, -200, -600];
    const lines = [
      line("2026-01-01", 1_000, "Deposit"),
      ...amounts.map((a, i) => line(`2026-01-0${i + 2}`, a, `Payment ${-a}`)),
    ];
    const w = negativeWatch(lines, null) as NegativeWatch;
    expect(w.outstanding.map((o) => o.amountMinor)).toEqual([-900, -800, -700, -600, -500, -300]);
    expect(w.outstandingCount).toBe(8);
  });

  it("does not count money coming in as outstanding", () => {
    const lines = [line("2026-01-01", -1_000, "Payment"), line("2026-01-02", 500, "Refund")];
    expect((negativeWatch(lines, null) as NegativeWatch).outstandingCount).toBe(1);
  });
});

describe("statementAlerts", () => {
  it("runs both detectors over the same lines", () => {
    const lines = [...ordinaryDays(), ...postedAsBalance("Payroll", [2, 4, 5, 7], 0)];
    const result = statementAlerts(lines, null);
    expect(result.ghosts).toHaveLength(1);
    expect(result.negative).not.toBeNull();
  });
});

describe("the copy", () => {
  const group = (over: Partial<GhostGroup> = {}): GhostGroup => ({
    payee: "Payroll",
    rows: [],
    agree: 31,
    of: 33,
    offsetMinor: 0,
    runs: 1,
    totalMinor: -123_456,
    entryIds: Array.from({ length: 31 }, (_, i) => `e${i}`),
    ...over,
  });

  it("writes the balance card for an exact landing", () => {
    const card = ghostCard(group(), fmt);
    expect(card.title).toBe("31 entries here look like the statement's balance, not payments");
    expect(segmentsText(card.body)).toBe(
      "Every one of them is named Payroll, and 31 of the 33 land exactly on what this account comes to on their own date once the group itself is taken out. A payment does not track the balance of the account it is paid from. These are almost certainly a Balance column read as amounts, and together they move -$1234.56.",
    );
    expect(card.body.filter((s) => s.bold).map((s) => s.text)).toEqual(["Payroll"]);
    expect(card.body.filter((s) => s.italic).map((s) => s.text)).toEqual(["Balance"]);
  });

  it("says each run is a fixed distance away when there is more than one", () => {
    const text = segmentsText(ghostCard(group({ runs: 2, offsetMinor: 500 }), fmt).body);
    expect(text).toContain("taken out, each run of them a fixed distance from it. A payment");
    expect(text).not.toContain("give or take");
  });

  it("says give or take when one run sits a constant distance away", () => {
    const text = segmentsText(ghostCard(group({ offsetMinor: -2_500 }), fmt).body);
    expect(text).toContain("taken out, give or take $25.00 that is outstanding for other reasons. A payment");
    expect(text).not.toContain("fixed distance");
  });

  it("names the buttons, the workings and the messages", () => {
    const card = ghostCard(group(), fmt);
    expect(card.showWorkings).toBe("Show me the workings");
    expect(card.hideWorkings).toBe("Hide the workings");
    expect(card.removeLabel).toBe("Remove these 31 entries");
    expect(card.confirmLabel).toBe("Confirm — remove all 31");
    expect(card.workingsColumns).toEqual(["Date", "Posted as", "This account on that date", "Difference", "Coded to"]);
    expect(card.workingsFootnote).toBe(
      "The middle column is worked out with these entries removed, so it is not an argument with itself.",
    );
    expect(card.removedMessage(31)).toBe("31 entries removed. They were balances, not payments.");
    expect(card.goneMessage).toBe("Those entries are no longer here.");
    expect(GHOST_GONE).toBe(card.goneMessage);
    expect(card.difference(0)).toBe("—");
    expect(card.difference(2_500)).toBe("$25.00");
  });

  it("counts the entries, not the lines, in the title and the button", () => {
    const card = ghostCard(group({ agree: 3, of: 3, entryIds: ["a", "b"] }), fmt);
    expect(card.title).toBe("2 entries here look like the statement's balance, not payments");
    expect(card.removeLabel).toBe("Remove these 2 entries");
    expect(ghostCard(group({ entryIds: ["a"] }), fmt).removeLabel).toBe("Remove these 1 entry");
  });

  const watch = (over: Partial<NegativeWatch> = {}): NegativeWatch => ({
    nowMinor: -12_000,
    last: { date: "2026-01-05", endingMinor: 30_000 },
    worst: { date: "2026-01-12", balanceMinor: -15_000 },
    outstanding: [
      { lineId: "l1", entryId: "e1", entryNumber: "JE-1", date: "2026-01-10", name: "Supplier A", amountMinor: -40_000, codedTo: [] },
    ],
    outstandingCount: 9,
    ...over,
  });

  it("writes the below-zero card when it is still below zero today", () => {
    const card = negativeCard("Operating Checking", watch(), fmt);
    expect(card.title).toBe("Operating Checking reads below zero, and still does today");
    expect(segmentsText(card.body)).toBe(
      "The last statement you agreed on this account closed at $300.00 on Jan 5, 2026, so the balance was right on the day it was proved. Since then it drops to -$150.00 on Jan 12, 2026. It reads -$120.00 today. A bank would have charged you for an overdraft and shown it on the statement; where it has not, what is dragging it under is usually an entry that is not a payment — a balance posted as one, or the same thing entered twice.",
    );
    expect(card.body.filter((s) => s.bold).map((s) => s.text)).toEqual(["$300.00", "-$150.00"]);
    expect(card.listHeading).toBe("The largest 1 of the 9 payments not yet on a statement:");
    expect(card.listColumns).toEqual(["Date", "Name", "Amount", "Coded to"]);
    expect(card.footer).toBe(
      "Reconcile the next statement and whatever the bank has never seen is left standing on its own.",
    );
  });

  it("says at some point since the last statement when it has recovered", () => {
    const card = negativeCard("Operating Checking", watch({ nowMinor: 2_000 }), fmt);
    expect(card.title).toBe("Operating Checking reads below zero at some point since the last statement");
  });

  it("says nothing has been reconciled, and leaves out the worst day, when there is neither", () => {
    const card = negativeCard("Petty Cash", watch({ last: null, worst: null }), fmt);
    const text = segmentsText(card.body);
    expect(text.startsWith("Nothing has been reconciled on this account yet, so there is no agreed figure to measure from. It reads -$120.00 today.")).toBe(true);
    expect(text).not.toContain("Since then");
  });

  it("has no list heading when nothing is outstanding", () => {
    expect(negativeCard("Petty Cash", watch({ outstanding: [], outstandingCount: 0 }), fmt).listHeading).toBeNull();
  });

  it("uses the date formatter it is given", () => {
    const card = negativeCard("Petty Cash", watch(), { money: usd, date: (d) => `<${d}>` });
    expect(segmentsText(card.body)).toContain("on <2026-01-05>, so");
  });
});

describe("balanceSheetNote", () => {
  it("says nothing when no bank account is below zero", () => {
    expect(balanceSheetNote([])).toBeNull();
  });

  it("names one account and points to Reconcile", () => {
    const note = balanceSheetNote([{ bankAccountId: "b 1", accountName: "Operating Checking", ghostEntries: 0 }]);
    expect(note?.headline).toBe("Operating Checking is below zero.");
    expect(note?.detail).toBe("Reconcile shows what has gone in since the last statement you agreed.");
    expect(note?.links).toEqual([
      { bankAccountId: "b 1", accountName: "Operating Checking", href: "/banking/reconcile?account=b%201", label: "Open Reconcile" },
    ]);
  });

  it("uses the balance sentence when the account has flagged entries", () => {
    const note = balanceSheetNote([{ bankAccountId: "b1", accountName: "Operating Checking", ghostEntries: 31 }]);
    expect(note?.detail).toBe(
      "31 entries on it look like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.",
    );
  });

  it("joins several accounts and adds their flagged entries together", () => {
    const note = balanceSheetNote([
      { bankAccountId: "b1", accountName: "Checking", ghostEntries: 4 },
      { bankAccountId: "b2", accountName: "Savings", ghostEntries: 0 },
      { bankAccountId: "b3", accountName: "Petty Cash", ghostEntries: 3 },
    ]);
    expect(note?.headline).toBe("Checking, Savings and Petty Cash are below zero.");
    expect(note?.detail).toBe(
      "7 entries on those accounts look like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.",
    );
    expect(note?.links.map((l) => l.label)).toEqual([
      "Open Reconcile for Checking",
      "Open Reconcile for Savings",
      "Open Reconcile for Petty Cash",
    ]);
    expect(balanceSheetNote([
      { bankAccountId: "b1", accountName: "Checking", ghostEntries: 1 },
    ])?.detail).toContain("1 entry on it looks like");
    expect(
      balanceSheetNote([
        { bankAccountId: "b1", accountName: "Checking", ghostEntries: 0 },
        { bankAccountId: "b2", accountName: "Savings", ghostEntries: 0 },
      ])?.headline,
    ).toBe("Checking and Savings are below zero.");
  });

  it("builds the Reconcile address from the bank account", () => {
    expect(reconcileHref("abc")).toBe("/banking/reconcile?account=abc");
  });
});

describe("the Exceptions rows", () => {
  const ghost = (payee: string, total: number, n: number): GhostGroup => ({
    payee,
    rows: [],
    agree: n,
    of: n,
    offsetMinor: 0,
    runs: 1,
    totalMinor: total,
    entryIds: Array.from({ length: n }, (_, i) => `${payee}${i}`),
  });
  const negative = (over: Partial<NegativeWatch> = {}): NegativeWatch => ({
    nowMinor: -1_000,
    last: { date: "2026-01-05", endingMinor: 30_000 },
    worst: { date: "2026-01-12", balanceMinor: -5_000 },
    outstanding: [],
    outstandingCount: 3,
    ...over,
  });
  const accounts: BankAccountAlerts[] = [
    { bankAccountId: "b1", accountName: "Checking", ghosts: [ghost("Payroll", -100_000, 4)], negative: negative() },
    { bankAccountId: "b2", accountName: "Savings", ghosts: [ghost("Daily", -900_000, 5), ghost("Interest", -50_000, 3)], negative: null },
    { bankAccountId: "b3", accountName: "Petty Cash", ghosts: [], negative: negative({ worst: null, last: null, nowMinor: -9_000, outstandingCount: 1 }) },
  ];

  it("lists one row per flagged group, the largest total first", () => {
    const rows = statementBalanceRows(accounts);
    expect(rows.map((r) => [r.accountName, r.payee, r.entryCount, r.totalMinor])).toEqual([
      ["Savings", "Daily", 5, -900_000],
      ["Checking", "Payroll", 4, -100_000],
      ["Savings", "Interest", 3, -50_000],
    ]);
    expect(rows[0].bankAccountId).toBe("b2");
  });

  it("lists one row per account below zero, the lowest first", () => {
    const rows = belowZeroRows(accounts);
    expect(rows.map((r) => r.accountName)).toEqual(["Petty Cash", "Checking"]);
    expect(rows[1]).toEqual({
      bankAccountId: "b1",
      accountName: "Checking",
      nowMinor: -1_000,
      worstMinor: -5_000,
      worstDate: "2026-01-12",
      lastStatementDate: "2026-01-05",
      outstandingCount: 3,
    });
    expect(rows[0].worstMinor).toBeNull();
    expect(rows[0].lastStatementDate).toBeNull();
  });

  it("finds nothing in accounts with nothing flagged", () => {
    const quiet: BankAccountAlerts[] = [{ bankAccountId: "b1", accountName: "Checking", ghosts: [], negative: null }];
    expect(statementBalanceRows(quiet)).toEqual([]);
    expect(belowZeroRows(quiet)).toEqual([]);
  });

  it("words the sheet rows", () => {
    expect(statementBalanceSheetText(statementBalanceRows(accounts)[0])).toEqual({ type: "5 entries", name: "Daily" });
    const [petty, checking] = belowZeroRows(accounts);
    expect(belowZeroSheetText(petty, usd)).toEqual({
      type: "Last reconciled never",
      name: "1 payment not yet on a statement",
    });
    expect(belowZeroSheetText(checking, usd)).toEqual({
      type: "Last reconciled 2026-01-05",
      name: "Lowest -$50.00 · 3 payments not yet on a statement",
    });
  });
});

describe("withoutReversedPairs", () => {
  /** The entry that reverses `original`: its lines swapped, on its date, under a name of its own. */
  function reversalOf(original: BankLine): { line: BankLine; pair: ReversalPair } {
    const reversal = line(original.date, -original.amountMinor, `Reversal of ${original.entryNumber} — balances, not payments`);
    return { line: reversal, pair: { originalEntryId: original.entryId, reversalEntryId: reversal.entryId } };
  }

  it("leaves out an entry that was reversed together with its reversal", () => {
    const kept = line("2026-01-01", 10_000, "Deposit");
    const wrong = line("2026-01-02", -4_000, "Supplier");
    const { line: undo, pair } = reversalOf(wrong);
    expect(withoutReversedPairs([kept, wrong, undo], [pair])).toEqual([kept]);
  });

  it("keeps an original whose reversal is not among the lines", () => {
    const wrong = line("2026-01-02", -4_000, "Supplier");
    const pair = { originalEntryId: wrong.entryId, reversalEntryId: "voided-since" };
    expect(withoutReversedPairs([wrong], [pair])).toEqual([wrong]);
  });

  it("changes nothing when nothing was reversed", () => {
    const lines = ordinaryDays();
    expect(withoutReversedPairs(lines, [])).toEqual(lines);
  });

  it("still flags a series that was removed once and then imported again", () => {
    const removed = postedAsBalance("Payroll", [2, 4, 5, 7], 0);
    const reversals = removed.map(reversalOf);
    const again = postedAsBalance("Payroll", [2, 4, 5, 7], 0);
    const lines = [...ordinaryDays(), ...removed, ...reversals.map((r) => r.line), ...again];

    // Counted, the removed four dilute the new four: no offset agrees.
    expect(ghostGroups(lines)).toEqual([]);

    const groups = ghostGroups(withoutReversedPairs(lines, reversals.map((r) => r.pair)));
    expect(groups).toHaveLength(1);
    expect([groups[0].agree, groups[0].of]).toEqual([4, 4]);
    expect(groups[0].entryIds).toEqual(again.map((l) => l.entryId));
  });

  it("does not list a reversed payment as one no statement has shown", () => {
    const last = { date: "2026-01-05", endingMinor: 50_000 };
    const real = line("2026-01-10", -60_000, "Supplier A");
    const wrong = line("2026-01-11", -90_000, "Supplier B");
    const { line: undo, pair } = reversalOf(wrong);
    const lines = [line("2026-01-01", 50_000, "Deposit", { cleared: true }), real, wrong, undo];
    const w = negativeWatch(withoutReversedPairs(lines, [pair]), last) as NegativeWatch;
    expect(w.nowMinor).toBe(-10_000);
    expect(w.outstanding.map((o) => o.name)).toEqual(["Supplier A"]);
    expect(w.outstandingCount).toBe(1);
  });
});

describe("the module", () => {
  it("imports nothing that reads or writes", () => {
    const source = readFileSync("lib/domain/statement-alerts.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
```

- [ ] **Step 2: Create `ctyhp-accounting/tests/unit/statement-alerts-service.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  StatementAlertsError,
  getAllStatementAlerts,
  getBalanceEntryBlockers,
  getBankAccountLines,
  getBelowZeroBankAccounts,
  getStatementAlerts,
  removeBalanceEntries,
} from "@/lib/services/statement-alerts";

/**
 * A stub client that answers each table this service reads, the way PostgREST
 * does: `.range(from, to)` is inclusive at both ends, and a read that never
 * asks for a range gets everything. Filters the service sets with `.eq` are
 * recorded and used to pick the right rows.
 */
type Row = Record<string, unknown>;

interface World {
  banks: Row[];
  chart: Row[];
  /** Journal lines by ledger account id. */
  lines: Record<string, Row[]>;
  /** Ticked journal line ids by bank account id (completed sessions only). */
  ticked: Record<string, string[]>;
  sessions: Row[];
  transactions: Row[];
  ledger?: Row[];
  /** acc_journal_reversal_link rows. */
  reversals?: Row[];
  fail?: string;
}

interface Calls {
  ranges: Record<string, [number, number][]>;
  rpc: { name: string; args: Record<string, unknown> }[];
}

function fakeClient(world: World, calls: Calls = { ranges: {}, rpc: [] }): SupabaseClient {
  const rowsFor = (table: string, eqs: Record<string, unknown>): Row[] => {
    switch (table) {
      case "acc_bank_account":
        return eqs.id === undefined ? world.banks : world.banks.filter((b) => b.id === eqs.id);
      case "acc_account":
        return world.chart;
      case "acc_journal_line":
        return world.lines[eqs.account_id as string] ?? [];
      case "acc_reconciliation_line":
        return (world.ticked[eqs["acc_statement_reconciliation.bank_account_id"] as string] ?? []).map((id, i) => ({
          id: `rl${i}`,
          journal_line_id: id,
        }));
      case "acc_statement_reconciliation":
        return eqs.bank_account_id === undefined
          ? world.sessions
          : world.sessions.filter((s) => s.bank_account_id === eqs.bank_account_id);
      case "acc_journal_reversal_link":
        return world.reversals ?? [];
      default:
        throw new Error(`fakeClient: unhandled table "${table}"`);
    }
  };

  return {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          eqs[column] = value;
          return builder;
        },
        order: () => builder,
        range: async (from: number, to: number) => {
          (calls.ranges[table] ??= []).push([from, to]);
          if (world.fail === table) return { data: null, error: { message: `${table} unreachable` } };
          return { data: rowsFor(table, eqs).slice(from, to + 1), error: null };
        },
        maybeSingle: async () => {
          if (world.fail === table) return { data: null, error: { message: `${table} unreachable` } };
          return { data: rowsFor(table, eqs)[0] ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve(
            world.fail === table
              ? { data: null, error: { message: `${table} unreachable` } }
              : { data: rowsFor(table, eqs), error: null },
          ),
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      if (name === "acc_transaction_list") {
        return {
          range: async (from: number, to: number) => {
            (calls.ranges.acc_transaction_list ??= []).push([from, to]);
            return { data: world.transactions.slice(from, to + 1), error: null };
          },
        };
      }
      if (name === "acc_ledger_balances") {
        return {
          range: async (from: number, to: number) => ({ data: (world.ledger ?? []).slice(from, to + 1), error: null }),
        };
      }
      return Promise.resolve(rpcAnswers[name]?.(args) ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
}

const rpcAnswers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }> = {};

function emptyWorld(): World {
  return { banks: [], chart: [], lines: {}, ticked: {}, sessions: [], transactions: [] };
}

const BANK = { id: "bank-1", account_id: "gl-1", bank_name: "First Test Bank", acc_account: { name: "Operating Checking" } };

/** Day `i` of an invented calendar, one date per index. */
function day(i: number): string {
  return new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
}

let seq = 0;
function journalLine(date: string, signed: number, over: { id?: string; entry?: string } = {}): { line: Row; entry: Row } {
  seq += 1;
  const id = over.id ?? `line-${String(seq).padStart(5, "0")}`;
  const entryId = over.entry ?? `entry-${String(seq).padStart(5, "0")}`;
  return {
    line: {
      id,
      debit_minor: signed > 0 ? signed : 0,
      credit_minor: signed < 0 ? -signed : 0,
      amount_base_minor: Math.abs(signed),
      acc_journal_entry: { id: entryId, entry_number: `JE-${String(seq).padStart(6, "0")}`, entry_date: date, source_type: "manual" },
    },
    entry: {
      entry_id: entryId,
      entry_number: `JE-${String(seq).padStart(6, "0")}`,
      entry_date: date,
      description: "",
      source_type: "manual",
      party_name: null,
      category_label: null,
      money_label: null,
      amount_minor: Math.abs(signed),
      currency_code: "USD",
      reconciled: false,
      account_ids: ["gl-1", "gl-expense"],
    },
  };
}

describe("getStatementAlerts", () => {
  it("reads past 1,000 lines and finds a balance posted as payments that sits on a later page", async () => {
    // 1,100 ordinary days of +$1.00 each under its own name, then the balance
    // read as payments on four of those days: the 1,101st to 1,104th rows,
    // which only a second page contains.
    const world = emptyWorld();
    world.banks = [BANK];
    world.chart = [{ id: "gl-expense", account_code: "6000", name: "Wages" }];
    const rows: { line: Row; entry: Row }[] = [];
    for (let i = 0; i < 1100; i += 1) rows.push(journalLine(day(i), 100));
    for (const i of [900, 1000, 1050, 1090]) {
      const made = journalLine(day(i), -(100 * (i + 1)));
      made.entry.description = "PAYROLL";
      rows.push(made);
    }
    // The name comes from the transaction list; give every ordinary entry its own.
    rows.forEach((r, i) => {
      if (r.entry.description === "") r.entry.description = `Counterparty ${i}`;
    });
    world.lines["gl-1"] = rows.map((r) => r.line);
    world.transactions = rows.map((r) => r.entry);
    const calls: Calls = { ranges: {}, rpc: [] };

    const alerts = await getStatementAlerts(fakeClient(world, calls), "bank-1");

    expect(calls.ranges.acc_journal_line).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(calls.ranges.acc_transaction_list).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(alerts.ghosts).toHaveLength(1);
    expect(alerts.ghosts[0].payee).toBe("PAYROLL");
    expect(alerts.ghosts[0].agree).toBe(4);
    expect(alerts.ghosts[0].rows[0].codedTo).toEqual(["6000 Wages"]);
    // Four such payments take the account below zero, which the second detector sees on the same read.
    expect(alerts.negative?.outstandingCount).toBe(4);
  });

  it("reads the last agreed statement and which lines are ticked, and leaves those out of the unpaid list", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    const deposit = journalLine("2026-01-01", 50_000);
    const rent = journalLine("2026-01-05", -20_000);
    const supplier = journalLine("2026-01-10", -40_000);
    const other = journalLine("2026-01-12", -2_000);
    world.lines["gl-1"] = [deposit, rent, supplier, other].map((r) => r.line);
    supplier.entry.party_name = "Supplier A";
    other.entry.party_name = "Supplier B";
    world.transactions = [deposit, rent, supplier, other].map((r) => r.entry);
    world.ticked["bank-1"] = [rent.line.id as string, supplier.line.id as string];
    world.sessions = [
      { id: "s-old", bank_account_id: "bank-1", statement_ending_date: "2025-12-31", statement_ending_balance_minor: 0, completed_at: "2026-01-01T00:00:00Z" },
      { id: "s-new", bank_account_id: "bank-1", statement_ending_date: "2026-01-05", statement_ending_balance_minor: "30000", completed_at: "2026-01-06T00:00:00Z" },
    ];

    const { negative } = await getStatementAlerts(fakeClient(world), "bank-1");

    expect(negative?.last).toEqual({ date: "2026-01-05", endingMinor: 30_000 });
    expect(negative?.nowMinor).toBe(-12_000);
    expect(negative?.worst).toEqual({ date: "2026-01-12", balanceMinor: -12_000 });
    // The supplier payment is ticked, so only the last one is outstanding.
    expect(negative?.outstanding.map((o) => [o.name, o.amountMinor])).toEqual([["Supplier B", -2_000]]);
    expect(negative?.outstandingCount).toBe(1);
  });

  it("asks only for ticks and sessions that are completed, and for this bank account", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    const seen: Record<string, unknown>[] = [];
    const client = fakeClient(world);
    const original = client.from.bind(client);
    (client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const b = original(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const eq = b.eq;
      b.eq = (column: unknown, value: unknown) => {
        seen.push({ table, column, value });
        return eq(column, value);
      };
      return b;
    };
    await getStatementAlerts(client, "bank-1");
    expect(seen).toContainEqual({ table: "acc_reconciliation_line", column: "acc_statement_reconciliation.status", value: "completed" });
    expect(seen).toContainEqual({ table: "acc_reconciliation_line", column: "acc_statement_reconciliation.bank_account_id", value: "bank-1" });
    expect(seen).toContainEqual({ table: "acc_statement_reconciliation", column: "status", value: "completed" });
    expect(seen).toContainEqual({ table: "acc_journal_line", column: "acc_journal_entry.status", value: "posted" });
    expect(seen).toContainEqual({ table: "acc_journal_line", column: "account_id", value: "gl-1" });
  });

  it("names an entry by its number when the transaction list has no row for it", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    const a = journalLine("2026-01-01", 1_000);
    const b = journalLine("2026-01-02", -5_000);
    world.lines["gl-1"] = [a.line, b.line];
    world.transactions = [a.entry];
    const { negative } = await getStatementAlerts(fakeClient(world), "bank-1");
    expect(negative?.outstanding[0].name).toBe(b.entry.entry_number);
  });

  it("leaves out an entry that was reversed, and its reversal, before either detector looks", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    const deposit = journalLine("2026-01-01", 10_000);
    const wrong = journalLine("2026-01-02", -40_000);
    const undo = journalLine("2026-01-02", 40_000);
    world.lines["gl-1"] = [deposit, wrong, undo].map((r) => r.line);
    world.transactions = [deposit, wrong, undo].map((r) => r.entry);
    world.reversals = [{ id: "link-1", original_entry_id: wrong.entry.entry_id, reversal_entry_id: undo.entry.entry_id }];
    const calls: Calls = { ranges: {}, rpc: [] };

    const { lines } = await getBankAccountLines(fakeClient(world, calls), "bank-1");

    expect(lines.map((l) => l.entryId)).toEqual([deposit.entry.entry_id]);
    expect(calls.ranges.acc_journal_reversal_link).toEqual([[0, 999]]);
  });

  it("finds nothing on an account with no lines", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    expect(await getStatementAlerts(fakeClient(world), "bank-1")).toEqual({ ghosts: [], negative: null });
  });

  it("fails, rather than answering from half a ledger, when a read fails", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    world.fail = "acc_journal_line";
    await expect(getStatementAlerts(fakeClient(world), "bank-1")).rejects.toBeInstanceOf(StatementAlertsError);
    await expect(getStatementAlerts(fakeClient(world), "bank-1")).rejects.toThrow(/entries failed: acc_journal_line unreachable/);
    world.fail = "acc_reconciliation_line";
    await expect(getStatementAlerts(fakeClient(world), "bank-1")).rejects.toThrow(/ticked lines failed/);
    world.fail = "acc_journal_reversal_link";
    await expect(getStatementAlerts(fakeClient(world), "bank-1")).rejects.toThrow(/the reversals failed/);
  });

  it("says so when the bank account is not there", async () => {
    await expect(getStatementAlerts(fakeClient(emptyWorld()), "nope")).rejects.toThrow("Bank account not found");
  });
});

describe("getAllStatementAlerts", () => {
  it("runs both detectors for every bank account and reads the transaction list once", async () => {
    const world = emptyWorld();
    world.banks = [
      BANK,
      { id: "bank-2", account_id: "gl-2", bank_name: "Second Test Bank", acc_account: null },
    ];
    const overdrawn = [journalLine("2026-01-01", 1_000), journalLine("2026-01-03", -5_000)];
    const fine = [journalLine("2026-01-01", 9_000)];
    world.lines["gl-1"] = overdrawn.map((r) => r.line);
    world.lines["gl-2"] = fine.map((r) => r.line);
    world.transactions = [...overdrawn, ...fine].map((r) => r.entry);
    const calls: Calls = { ranges: {}, rpc: [] };

    const all = await getAllStatementAlerts(fakeClient(world, calls));

    expect(all.map((a) => [a.bankAccountId, a.accountName, a.negative !== null, a.ghosts.length])).toEqual([
      ["bank-1", "Operating Checking", true, 0],
      ["bank-2", "Second Test Bank", false, 0],
    ]);
    expect(calls.rpc.filter((c) => c.name === "acc_transaction_list")).toHaveLength(1);
  });

  it("returns nothing when there are no bank accounts", async () => {
    const calls: Calls = { ranges: {}, rpc: [] };
    expect(await getAllStatementAlerts(fakeClient(emptyWorld(), calls))).toEqual([]);
    expect(calls.rpc).toEqual([]);
  });
});

describe("getBalanceEntryBlockers", () => {
  it("maps the database's rows", async () => {
    rpcAnswers.acc_balance_entry_blockers = () => ({
      data: [{ entry_id: "e1", entry_number: "JE-000007", reason: "Ticked in a completed reconciliation" }],
      error: null,
    });
    const calls: Calls = { ranges: {}, rpc: [] };
    const blockers = await getBalanceEntryBlockers(fakeClient(emptyWorld(), calls), ["e1", "e2"]);
    expect(blockers).toEqual([{ entryId: "e1", entryNumber: "JE-000007", reason: "Ticked in a completed reconciliation" }]);
    expect(calls.rpc).toEqual([{ name: "acc_balance_entry_blockers", args: { p_entry_ids: ["e1", "e2"] } }]);
  });

  it("does not ask when there is nothing to ask about", async () => {
    const calls: Calls = { ranges: {}, rpc: [] };
    expect(await getBalanceEntryBlockers(fakeClient(emptyWorld(), calls), [])).toEqual([]);
    expect(calls.rpc).toEqual([]);
  });

  it("throws the database's message", async () => {
    rpcAnswers.acc_balance_entry_blockers = () => ({ data: null, error: { message: "Not authorized to check entries for removal" } });
    await expect(getBalanceEntryBlockers(fakeClient(emptyWorld()), ["e1"])).rejects.toThrow("Not authorized to check entries for removal");
  });
});

describe("removeBalanceEntries", () => {
  it("sends the account, the entries and the reason, and returns the counts", async () => {
    rpcAnswers.acc_remove_balance_entries = () => ({
      data: { removed: 3, reversed: 2, voided: 1, total_minor: -123_400 },
      error: null,
    });
    const calls: Calls = { ranges: {}, rpc: [] };
    const result = await removeBalanceEntries(fakeClient(emptyWorld(), calls), "bank-1", ["e1", "e2", "e3"], "Balance column");
    expect(result).toEqual({ removed: 3, reversed: 2, voided: 1, total_minor: -123_400 });
    expect(calls.rpc).toEqual([
      { name: "acc_remove_balance_entries", args: { p_bank_account_id: "bank-1", p_entry_ids: ["e1", "e2", "e3"], p_reason: "Balance column" } },
    ]);
  });

  it("passes a refusal through as it is", async () => {
    const message = "2 of these entries cannot be removed: JE-000007 (closed period); JE-000009 (invoice INV-0001, void it there)";
    rpcAnswers.acc_remove_balance_entries = () => ({ data: null, error: { message } });
    await expect(removeBalanceEntries(fakeClient(emptyWorld()), "bank-1", ["e1"], "x")).rejects.toThrow(message);
    await expect(removeBalanceEntries(fakeClient(emptyWorld()), "bank-1", ["e1"], "x")).rejects.toBeInstanceOf(StatementAlertsError);
  });
});


describe("getBelowZeroBankAccounts", () => {
  const ledger = (accountId: string, debit: number, credit: number): Row => ({
    account_id: accountId,
    account_code: "1000",
    name: "x",
    account_type: "bank",
    debit_base: debit,
    credit_base: credit,
  });

  it("looks only at the accounts that read below zero on that date, and counts their flagged entries", async () => {
    const world = emptyWorld();
    world.banks = [BANK, { id: "bank-2", account_id: "gl-2", bank_name: "Second Test Bank", acc_account: { name: "Savings" } }];
    world.ledger = [ledger("gl-1", 1_000, 5_000), ledger("gl-2", 9_000, 0)];
    const overdrawn = [journalLine("2026-01-01", 1_000), journalLine("2026-01-03", -5_000)];
    world.lines["gl-1"] = overdrawn.map((r) => r.line);
    world.transactions = overdrawn.map((r) => r.entry);
    const calls: Calls = { ranges: {}, rpc: [] };

    const found = await getBelowZeroBankAccounts(fakeClient(world, calls), "2026-02-01");

    expect(found).toEqual([{ bankAccountId: "bank-1", accountName: "Operating Checking", ghostEntries: 0 }]);
    // Only the overdrawn account's lines were read.
    expect(calls.ranges.acc_journal_line).toHaveLength(1);
  });

  it("finds nothing when every bank account is at or above zero", async () => {
    const world = emptyWorld();
    world.banks = [BANK];
    world.ledger = [ledger("gl-1", 5_000, 5_000)];
    expect(await getBelowZeroBankAccounts(fakeClient(world), "2026-02-01")).toEqual([]);
  });
});
```

- [ ] **Step 3: Create `ctyhp-accounting/tests/unit/statement-alerts-actions.test.ts`** with exactly this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  hasPermission: vi.fn(),
  getStatementAlerts: vi.fn(),
  getBalanceEntryBlockers: vi.fn(),
  removeBalanceEntries: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getUserRole: mocks.getUserRole, canWrite: mocks.canWrite, isAdmin: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/access")>()),
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/lib/services/statement-alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/statement-alerts")>()),
  getStatementAlerts: mocks.getStatementAlerts,
  getBalanceEntryBlockers: mocks.getBalanceEntryBlockers,
  removeBalanceEntries: mocks.removeBalanceEntries,
}));

import { removeBalanceGroupAction, statementAlertsAction } from "@/app/(app)/banking/reconcile/actions";
import type { GhostGroup, NegativeWatch } from "@/lib/domain/statement-alerts";

const bank = "11111111-1111-4111-8111-111111111111";
const client = { marker: "company-bound" };

const group = (payee: string, entryIds: string[]): GhostGroup => ({
  payee,
  rows: [],
  agree: entryIds.length,
  of: entryIds.length,
  offsetMinor: 0,
  runs: 1,
  totalMinor: -50_000,
  entryIds,
});

const negative: NegativeWatch = { nowMinor: -100, last: null, worst: null, outstanding: [], outstandingCount: 0 };

const REVALIDATED = ["/banking/reconcile", "/banking", "/journal", "/reports", "/reports/exceptions", "/dashboard"];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserRole.mockResolvedValue("admin");
  mocks.canWrite.mockReturnValue(true);
  mocks.createClient.mockResolvedValue(client);
  mocks.hasPermission.mockResolvedValue(true);
  mocks.getStatementAlerts.mockResolvedValue({ ghosts: [group("Payroll", ["e1", "e2", "e3"])], negative });
  mocks.getBalanceEntryBlockers.mockResolvedValue([]);
  mocks.removeBalanceEntries.mockResolvedValue({ removed: 3, reversed: 2, voided: 1, total_minor: -50_000 });
});

describe("statementAlertsAction", () => {
  it("returns the alerts with each group's blockers", async () => {
    mocks.getBalanceEntryBlockers.mockResolvedValue([{ entryId: "e2", entryNumber: "JE-000002", reason: "In a closed period" }]);
    const result = await statementAlertsAction(bank);
    expect(result.ok).toBe(true);
    expect(result.data?.negative).toEqual(negative);
    expect(result.data?.ghosts).toHaveLength(1);
    expect(result.data?.ghosts[0].payee).toBe("Payroll");
    expect(result.data?.ghosts[0].blockers).toEqual([{ entryId: "e2", entryNumber: "JE-000002", reason: "In a closed period" }]);
    expect(mocks.getStatementAlerts).toHaveBeenCalledWith(client, bank);
    expect(mocks.getBalanceEntryBlockers).toHaveBeenCalledWith(client, ["e1", "e2", "e3"]);
  });

  it("is open to a viewer, who is given no blockers and none are asked for", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    mocks.canWrite.mockReturnValue(false);
    const result = await statementAlertsAction(bank);
    expect(result.ok).toBe(true);
    expect(result.data?.ghosts[0].blockers).toEqual([]);
    expect(mocks.getBalanceEntryBlockers).not.toHaveBeenCalled();
  });

  it("refuses someone who is not signed in", async () => {
    mocks.getUserRole.mockResolvedValue(null);
    await expect(statementAlertsAction(bank)).resolves.toEqual({ ok: false, error: "Not authorized" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not ask for blockers when nothing is flagged", async () => {
    mocks.getStatementAlerts.mockResolvedValue({ ghosts: [], negative: null });
    const result = await statementAlertsAction(bank);
    expect(result).toEqual({ ok: true, data: { ghosts: [], negative: null } });
    expect(mocks.getBalanceEntryBlockers).not.toHaveBeenCalled();
  });

  it("says what went wrong when a read fails", async () => {
    mocks.getStatementAlerts.mockRejectedValue(new Error("Reading the bank account's entries failed: down"));
    await expect(statementAlertsAction(bank)).resolves.toEqual({
      ok: false,
      error: "Reading the bank account's entries failed: down",
    });
  });
});

describe("removeBalanceGroupAction", () => {
  const input = { bankAccountId: bank, payee: "Payroll", reason: "  Balance column read as amounts  " };

  it("refuses someone who cannot write, before creating a client", async () => {
    mocks.canWrite.mockReturnValue(false);
    await expect(removeBalanceGroupAction(input)).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses someone without the journal-posting permission", async () => {
    mocks.hasPermission.mockResolvedValue(false);
    const result = await removeBalanceGroupAction(input);
    expect(result).toEqual({ ok: false, error: "Removing entries needs the Post manual journals permission." });
    expect(mocks.hasPermission).toHaveBeenCalledWith(client, "journal.post");
    expect(mocks.removeBalanceEntries).not.toHaveBeenCalled();
  });

  it("rejects input without a reason, a payee or a real account", async () => {
    for (const bad of [
      { ...input, reason: "   " },
      { ...input, payee: "" },
      { ...input, bankAccountId: "not-an-id" },
      null,
    ]) {
      const result = await removeBalanceGroupAction(bad);
      expect(result.ok).toBe(false);
    }
    expect(mocks.removeBalanceEntries).not.toHaveBeenCalled();
  });

  it("finds the group again and removes its entries, then refreshes every screen that shows them", async () => {
    const result = await removeBalanceGroupAction(input);
    expect(result).toEqual({ ok: true, data: { removed: 3, reversed: 2, voided: 1, total_minor: -50_000 } });
    expect(mocks.getStatementAlerts).toHaveBeenCalledWith(client, bank);
    expect(mocks.removeBalanceEntries).toHaveBeenCalledWith(client, bank, ["e1", "e2", "e3"], "Balance column read as amounts");
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(REVALIDATED);
  });

  it("matches the payee without regard to case or spaces", async () => {
    const result = await removeBalanceGroupAction({ ...input, payee: "  payroll " });
    expect(result.ok).toBe(true);
  });

  it("removes only the entries of the group that was asked for", async () => {
    mocks.getStatementAlerts.mockResolvedValue({
      ghosts: [group("Interest", ["i1", "i2", "i3"]), group("Payroll", ["e1", "e2", "e3"])],
      negative: null,
    });
    await removeBalanceGroupAction(input);
    expect(mocks.removeBalanceEntries.mock.calls[0][2]).toEqual(["e1", "e2", "e3"]);
  });

  it("says the entries are gone when the payee is no longer flagged, and removes nothing", async () => {
    mocks.getStatementAlerts.mockResolvedValue({ ghosts: [group("Interest", ["i1", "i2", "i3"])], negative: null });
    await expect(removeBalanceGroupAction(input)).resolves.toEqual({ ok: false, error: "Those entries are no longer here." });
    expect(mocks.removeBalanceEntries).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes a refusal through as it is, and refreshes nothing", async () => {
    const message = "1 of these entries cannot be removed: JE-000007 (invoice INV-0003, void it there)";
    mocks.removeBalanceEntries.mockRejectedValue(new Error(message));
    await expect(removeBalanceGroupAction(input)).resolves.toEqual({ ok: false, error: message });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

```bash
npx vitest run tests/unit/statement-alerts.test.ts tests/unit/statement-alerts-service.test.ts tests/unit/statement-alerts-actions.test.ts
```

Expected: FAIL — `lib/domain/statement-alerts.ts` and `lib/services/statement-alerts.ts` do not exist yet.

- [ ] **Step 5: Create `ctyhp-accounting/lib/domain/statement-alerts.ts`** with exactly this content:

```ts
/**
 * Two warnings about a bank account, from the client's prototype (`ghostGroups`
 * and `negativeWatch`, p45):
 *
 *  1. A run of entries that look like a statement's *Balance* column read as
 *     amounts. Real payments do not track the balance of the account they are
 *     paid from, so a run that lands on it, date after date, is not payments.
 *  2. A bank account that reads below zero since the last statement somebody
 *     agreed. Once a statement is agreed the balance was right on that day; what
 *     drags it under afterwards is far more often an entry that is not a payment
 *     than a real overdraft, which the bank would have printed.
 *
 * Both are pure functions over one bank account's posted lines. This module
 * reads nothing and writes nothing; it imports no service and no database
 * type, and the Exceptions report (`lib/domain/exceptions.ts`) builds on it.
 *
 * Money is integer minor units in the base currency. Every comparison below is
 * exact: an offset is "the same" only when it is the same number of minor
 * units, which is what the prototype's round-to-the-cent comes to.
 */

import { shortDate } from "@/lib/domain/report-presets";

/** The fewest lines a payee needs before it can be a balance (prototype `GHOST_MIN`). */
export const GHOST_MIN = 3;
/** The share of a payee's lines that must agree (prototype `GHOST_SHARE`). */
export const GHOST_SHARE = 0.6;
/** The most outstanding payments the below-zero warning lists. */
export const OUTSTANDING_SHOWN = 6;
/** What a payee with no name is called, as in the prototype. */
export const NO_NAME = "(no name)";

/* ---------------------------------------------------------------- inputs */

/** One posted line on a bank account's ledger account. */
export interface BankLine {
  lineId: string;
  entryId: string;
  entryNumber: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Debit minus credit, base currency minor units: money in is positive. */
  amountMinor: number;
  /** The entry's name: party, else description, else entry number. */
  payee: string;
  narration: string;
  /** The entry's other accounts, as labels ("1200 Accounts Receivable"). */
  codedTo: string[];
  sourceType: string;
  /** Ticked in a completed reconciliation. */
  cleared: boolean;
}

/** The latest completed reconciliation of the account, by statement ending date. */
export interface LastStatement {
  date: string;
  endingMinor: number;
}

/** An entry and the entry that reversed it (`acc_journal_reversal_link`). */
export interface ReversalPair {
  originalEntryId: string;
  reversalEntryId: string;
}

/**
 * The lines the detectors look at: the account's posted lines, less every
 * entry that has been reversed together with its reversal.
 *
 * OneBook removes an entry by reversing it, where the prototype deleted it, so
 * a group removed from the Reconcile screen stays in the ledger as pairs that
 * cancel. Counted, the originals would read as payments no statement has
 * shown, and they would dilute the next group of the same name: a series
 * removed once and imported again would agree on 5 lines of 10, under
 * GHOST_SHARE, and go unflagged.
 *
 * A pair is dropped only when both halves are among these lines. A reversal
 * swaps every line of its original, so the two cancel on this account and
 * today's balance is the same without them. An original whose reversal is not
 * here (voided since, say) still stands, and so does its line.
 */
export function withoutReversedPairs(lines: readonly BankLine[], pairs: readonly ReversalPair[]): BankLine[] {
  const present = new Set(lines.map((l) => l.entryId));
  const dropped = new Set<string>();
  for (const p of pairs) {
    if (present.has(p.originalEntryId) && present.has(p.reversalEntryId)) {
      dropped.add(p.originalEntryId);
      dropped.add(p.reversalEntryId);
    }
  }
  return lines.filter((l) => !dropped.has(l.entryId));
}

/* --------------------------------------------------------------- ordering */

const byPosting = (a: BankLine, b: BankLine): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryNumber < b.entryNumber ? -1 : a.entryNumber > b.entryNumber ? 1 : a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0;

/** The end-of-day balances of lines already in posting order. */
function dayEnds(sorted: readonly BankLine[]): { date: string; balanceMinor: number }[] {
  const days: { date: string; balanceMinor: number }[] = [];
  let running = 0;
  for (const line of sorted) {
    running += line.amountMinor;
    const last = days[days.length - 1];
    if (last && last.date === line.date) last.balanceMinor = running;
    else days.push({ date: line.date, balanceMinor: running });
  }
  return days;
}

/** The balance after the last day-end dated on or before `date`; zero before the first. */
function balanceOn(days: readonly { date: string; balanceMinor: number }[], date: string): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].date <= date) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 0 : days[lo - 1].balanceMinor;
}

/* ------------------------------------------------- a balance read as payments */

export interface GhostRow {
  lineId: string;
  entryId: string;
  entryNumber: string;
  date: string;
  /** The line as posted, signed. */
  amountMinor: number;
  /** What the account comes to at the end of that date with the whole group taken out. */
  balanceMinor: number;
  /** |amount| minus that balance. Zero means it lands exactly on the balance. */
  differenceMinor: number;
  codedTo: string[];
  sourceType: string;
}

export interface GhostGroup {
  /** The name as written on the first line of the group, trimmed. */
  payee: string;
  /** The agreeing lines only, in posting order. */
  rows: GhostRow[];
  /** How many lines agree, and how many lines the payee has on the account. */
  agree: number;
  of: number;
  /** The most frequent good offset, minor units (zero: lands exactly). */
  offsetMinor: number;
  /** How many different good offsets there are: a file read wrongly twice leaves two. */
  runs: number;
  /** The agreeing lines' signed total. */
  totalMinor: number;
  /** The distinct entries behind the agreeing lines, in posting order. */
  entryIds: string[];
}

/** The key payees are grouped by: trimmed, lower-case, an empty name as "(no name)". */
export function payeeKeyOf(name: string): string {
  const key = name.trim().toLowerCase();
  return key === "" ? NO_NAME : key;
}

const payeeKey = (line: BankLine): string => payeeKeyOf(line.payee);

/**
 * Groups of entries for one payee that land on what the account comes to.
 *
 * For each payee with at least `GHOST_MIN` lines the rest of the account is
 * walked on its own, and each line of the payee is compared with the rest's
 * balance at the end of its date — "once the group itself is taken out", so
 * the test is not an argument with itself.
 *
 * The test is per offset, not one offset for the whole group: a file read
 * wrongly twice leaves two runs, each a fixed distance from the clean balance.
 * An offset seen on three or more lines is good; so is an offset of zero seen
 * at all, because a line that lands exactly on the balance needs no
 * corroboration.
 *
 * An account whose every entry is one payee proves nothing: with the rest
 * empty (or barely there) the "balance" is zero or a few figures, and it is the
 * group that is moving it. The rest must hold at least three lines, and the
 * agreeing lines must show three different balances and three different
 * amounts, because a running balance moves and so do the figures that track it.
 *
 * Largest group first.
 */
export function ghostGroups(lines: readonly BankLine[]): GhostGroup[] {
  if (lines.length < 4) return [];
  const all = [...lines].sort(byPosting);

  const byPayee = new Map<string, BankLine[]>();
  for (const line of all) {
    const key = payeeKey(line);
    const bucket = byPayee.get(key);
    if (bucket) bucket.push(line);
    else byPayee.set(key, [line]);
  }

  const flagged: GhostGroup[] = [];
  for (const group of byPayee.values()) {
    if (group.length < GHOST_MIN) continue;
    const inGroup = new Set(group.map((l) => l.lineId));
    const rest = all.filter((l) => !inGroup.has(l.lineId));
    if (rest.length < GHOST_MIN) continue;
    const days = dayEnds(rest);

    const measured = group.map((line) => {
      const balanceMinor = balanceOn(days, line.date);
      return { line, balanceMinor, differenceMinor: Math.abs(line.amountMinor) - balanceMinor };
    });

    const seen = new Map<number, number>();
    for (const m of measured) seen.set(m.differenceMinor, (seen.get(m.differenceMinor) ?? 0) + 1);
    const good = new Map<number, number>();
    for (const [offset, count] of seen) if (count >= 3 || offset === 0) good.set(offset, count);

    const agreeing = measured.filter((m) => good.has(m.differenceMinor));
    if (agreeing.length < GHOST_MIN || agreeing.length / group.length < GHOST_SHARE) continue;
    if (new Set(agreeing.map((m) => m.balanceMinor)).size < 3) continue;
    if (new Set(agreeing.map((m) => Math.abs(m.line.amountMinor))).size < 3) continue;

    // The most frequent good offset; a tie goes to the one nearer zero, then the smaller.
    const best = [...good.entries()].sort(
      (x, y) => y[1] - x[1] || Math.abs(x[0]) - Math.abs(y[0]) || x[0] - y[0],
    )[0][0];

    flagged.push({
      payee: group[0].payee.trim() === "" ? NO_NAME : group[0].payee.trim(),
      rows: agreeing.map((m) => ({
        lineId: m.line.lineId,
        entryId: m.line.entryId,
        entryNumber: m.line.entryNumber,
        date: m.line.date,
        amountMinor: m.line.amountMinor,
        balanceMinor: m.balanceMinor,
        differenceMinor: m.differenceMinor,
        codedTo: m.line.codedTo,
        sourceType: m.line.sourceType,
      })),
      agree: agreeing.length,
      of: group.length,
      offsetMinor: best,
      runs: good.size,
      totalMinor: agreeing.reduce((sum, m) => sum + m.line.amountMinor, 0),
      entryIds: [...new Set(agreeing.map((m) => m.line.entryId))],
    });
  }
  return flagged.sort((x, y) => y.agree - x.agree || x.payee.localeCompare(y.payee));
}

/* ------------------------------------------------ below zero since a statement */

export interface OutstandingPayment {
  lineId: string;
  entryId: string;
  entryNumber: string;
  date: string;
  name: string;
  /** Negative: money out. */
  amountMinor: number;
  codedTo: string[];
}

export interface NegativeWatch {
  /** The balance at the end of the last day with a posting. */
  nowMinor: number;
  /** The latest agreed statement, or null when nothing has been reconciled. */
  last: LastStatement | null;
  /** The lowest day-end balance after the last statement; null when only today is negative. */
  worst: { date: string; balanceMinor: number } | null;
  /** The largest payments after the last statement that no statement holds, largest first. */
  outstanding: OutstandingPayment[];
  /** How many such payments there are in all, not only those listed. */
  outstandingCount: number;
}

/**
 * Whether the account reads below zero, now or since its last agreed statement.
 *
 * The prototype tests `< -0.004` in dollars. In whole minor units that is any
 * balance below zero: the smallest negative balance, one cent, is already past
 * −0.4 cents, and zero is not. So the test here is simply `< 0`.
 *
 * A dip counts only after an agreed statement. An account nobody has
 * reconciled has no proved balance to measure from, so a dip in its past is
 * history; it is flagged only while it is negative now.
 */
export function negativeWatch(
  lines: readonly BankLine[],
  lastCompleted: LastStatement | null,
): NegativeWatch | null {
  if (lines.length === 0) return null;
  const sorted = [...lines].sort(byPosting);
  const days = dayEnds(sorted);
  const nowMinor = days[days.length - 1].balanceMinor;

  const from = lastCompleted?.date ?? "";
  const under = lastCompleted ? days.filter((d) => d.balanceMinor < 0 && d.date > from) : [];
  if (nowMinor >= 0 && under.length === 0) return null;

  let worst: NegativeWatch["worst"] = null;
  for (const d of under) if (worst === null || d.balanceMinor < worst.balanceMinor) worst = { ...d };

  const open = sorted
    .filter((l) => l.date > from && !l.cleared && l.amountMinor < 0)
    .sort((x, y) => x.amountMinor - y.amountMinor || byPosting(x, y));

  return {
    nowMinor,
    last: lastCompleted,
    worst,
    outstanding: open.slice(0, OUTSTANDING_SHOWN).map((l) => ({
      lineId: l.lineId,
      entryId: l.entryId,
      entryNumber: l.entryNumber,
      date: l.date,
      name: l.payee,
      amountMinor: l.amountMinor,
      codedTo: l.codedTo,
    })),
    outstandingCount: open.length,
  };
}

/** Both detectors over one account. */
export interface StatementAlerts {
  ghosts: GhostGroup[];
  negative: NegativeWatch | null;
}

export function statementAlerts(lines: readonly BankLine[], lastCompleted: LastStatement | null): StatementAlerts {
  return { ghosts: ghostGroups(lines), negative: negativeWatch(lines, lastCompleted) };
}

/* ------------------------------------------------------------------- copy */

/** A run of words in a sentence, so a screen can set the payee and figures in bold without parsing text. */
export interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

/** How money and dates are written: the screen passes its own formatter, this module has no currency. */
export interface CopyFormat {
  money: (minor: number) => string;
  /** Defaults to `Sep 26, 2026`. */
  date?: (iso: string) => string;
}

const dateOf = (fmt: CopyFormat) => fmt.date ?? shortDate;

/** The plain text of a sentence. */
export function segmentsText(segments: readonly Segment[]): string {
  return segments.map((s) => s.text).join("");
}

const plain = (text: string): Segment => ({ text });
const bold = (text: string): Segment => ({ text, bold: true });

export interface GhostCard {
  title: string;
  body: Segment[];
  showWorkings: string;
  hideWorkings: string;
  /** "Remove these N entries". */
  removeLabel: string;
  /** What the button says after the first click. */
  confirmLabel: string;
  workingsColumns: readonly ["Date", "Posted as", "This account on that date", "Difference", "Coded to"];
  workingsFootnote: string;
  /** The toast after a removal. */
  removedMessage: (n: number) => string;
  /** What the action says when the payee is no longer flagged. */
  goneMessage: string;
  /** "—" under half a cent; otherwise the money. */
  difference: (minor: number) => string;
}

export const GHOST_GONE = "Those entries are no longer here.";

/** The number of entries a flagged group would remove. */
export const ghostEntryCount = (group: Pick<GhostGroup, "entryIds">): number => group.entryIds.length;

export function ghostCard(group: GhostGroup, fmt: CopyFormat): GhostCard {
  const n = ghostEntryCount(group);
  const ending =
    group.runs > 1
      ? ", each run of them a fixed distance from it"
      : group.offsetMinor !== 0
        ? `, give or take ${fmt.money(Math.abs(group.offsetMinor))} that is outstanding for other reasons`
        : "";
  return {
    title: `${n} ${n === 1 ? "entry here looks" : "entries here look"} like the statement's balance, not payments`,
    body: [
      plain("Every one of them is named "),
      bold(group.payee),
      plain(
        `, and ${group.agree} of the ${group.of} land exactly on what this account comes to on their own date once the group itself is taken out${ending}. A payment does not track the balance of the account it is paid from. These are almost certainly a `,
      ),
      { text: "Balance", italic: true },
      plain(` column read as amounts, and together they move ${fmt.money(group.totalMinor)}.`),
    ],
    showWorkings: "Show me the workings",
    hideWorkings: "Hide the workings",
    removeLabel: `Remove these ${n} ${n === 1 ? "entry" : "entries"}`,
    confirmLabel: `Confirm — remove all ${n}`,
    workingsColumns: ["Date", "Posted as", "This account on that date", "Difference", "Coded to"],
    workingsFootnote: "The middle column is worked out with these entries removed, so it is not an argument with itself.",
    removedMessage: (count) => `${count} ${count === 1 ? "entry" : "entries"} removed. They were balances, not payments.`,
    goneMessage: GHOST_GONE,
    difference: (minor) => (minor === 0 ? "—" : fmt.money(minor)),
  };
}

export interface NegativeCard {
  title: string;
  body: Segment[];
  /** Null when nothing is outstanding. */
  listHeading: string | null;
  listColumns: readonly ["Date", "Name", "Amount", "Coded to"];
  footer: string;
}

export function negativeCard(accountName: string, watch: NegativeWatch, fmt: CopyFormat): NegativeCard {
  const date = dateOf(fmt);
  const body: Segment[] = [];
  if (watch.last) {
    body.push(
      plain("The last statement you agreed on this account closed at "),
      bold(fmt.money(watch.last.endingMinor)),
      plain(` on ${date(watch.last.date)}, so the balance was right on the day it was proved. `),
    );
  } else {
    body.push(plain("Nothing has been reconciled on this account yet, so there is no agreed figure to measure from. "));
  }
  if (watch.worst) {
    body.push(
      plain("Since then it drops to "),
      bold(fmt.money(watch.worst.balanceMinor)),
      plain(` on ${date(watch.worst.date)}. `),
    );
  }
  body.push(
    plain(
      `It reads ${fmt.money(watch.nowMinor)} today. A bank would have charged you for an overdraft and shown it on the statement; where it has not, what is dragging it under is usually an entry that is not a payment — a balance posted as one, or the same thing entered twice.`,
    ),
  );
  return {
    title: `${accountName} reads below zero${watch.nowMinor < 0 ? ", and still does today" : " at some point since the last statement"}`,
    body,
    listHeading:
      watch.outstanding.length > 0
        ? `The largest ${watch.outstanding.length} of the ${watch.outstandingCount} payments not yet on a statement:`
        : null,
    listColumns: ["Date", "Name", "Amount", "Coded to"],
    footer: "Reconcile the next statement and whatever the bank has never seen is left standing on its own.",
  };
}

/* ------------------------------------------------------------ balance sheet */

/** A bank account the Balance Sheet found below zero at its end date. */
export interface BelowZeroAccount {
  bankAccountId: string;
  accountName: string;
  /** Entries in this account's flagged groups; zero when none is flagged. */
  ghostEntries: number;
}

export interface BalanceSheetNote {
  /** "{A} and {B} are below zero." */
  headline: string;
  /** The second sentence. */
  detail: string;
  /** One link to Reconcile per account. */
  links: { bankAccountId: string; accountName: string; href: string; label: string }[];
}

/** "A", "A and B", "A, B and C". */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The address of the Reconcile start screen for one bank account. */
export function reconcileHref(bankAccountId: string): string {
  return `/banking/reconcile?account=${encodeURIComponent(bankAccountId)}`;
}

/** The note under a Balance Sheet; null when no bank account is below zero. */
export function balanceSheetNote(accounts: readonly BelowZeroAccount[]): BalanceSheetNote | null {
  if (accounts.length === 0) return null;
  const ghostEntries = accounts.reduce((sum, a) => sum + a.ghostEntries, 0);
  const one = accounts.length === 1;
  return {
    headline: `${nameList(accounts.map((a) => a.accountName))} ${one ? "is" : "are"} below zero.`,
    detail:
      ghostEntries > 0
        ? `${ghostEntries} ${ghostEntries === 1 ? "entry" : "entries"} on ${one ? "it" : "those accounts"} look${ghostEntries === 1 ? "s" : ""} like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.`
        : "Reconcile shows what has gone in since the last statement you agreed.",
    links: accounts.map((a) => ({
      bankAccountId: a.bankAccountId,
      accountName: a.accountName,
      href: reconcileHref(a.bankAccountId),
      label: one ? "Open Reconcile" : `Open Reconcile for ${a.accountName}`,
    })),
  };
}

/* -------------------------------------------------------------- exceptions */

/** One bank account's findings, as the Exceptions report reads them. */
export interface BankAccountAlerts {
  bankAccountId: string;
  accountName: string;
  ghosts: GhostGroup[];
  negative: NegativeWatch | null;
}

export interface StatementBalanceRow {
  bankAccountId: string;
  accountName: string;
  payee: string;
  entryCount: number;
  totalMinor: number;
}

export interface BelowZeroRow {
  bankAccountId: string;
  accountName: string;
  nowMinor: number;
  worstMinor: number | null;
  worstDate: string | null;
  /** The last agreed statement's date; null for never. */
  lastStatementDate: string | null;
  outstandingCount: number;
}

/** One row per flagged group, largest total first. */
export function statementBalanceRows(accounts: readonly BankAccountAlerts[]): StatementBalanceRow[] {
  return accounts
    .flatMap((a) =>
      a.ghosts.map((g) => ({
        bankAccountId: a.bankAccountId,
        accountName: a.accountName,
        payee: g.payee,
        entryCount: g.entryIds.length,
        totalMinor: g.totalMinor,
      })),
    )
    .sort(
      (x, y) =>
        Math.abs(y.totalMinor) - Math.abs(x.totalMinor) ||
        x.accountName.localeCompare(y.accountName) ||
        x.payee.localeCompare(y.payee),
    );
}

/** One row per flagged account, lowest balance first. */
export function belowZeroRows(accounts: readonly BankAccountAlerts[]): BelowZeroRow[] {
  const rows: BelowZeroRow[] = [];
  for (const a of accounts) {
    if (!a.negative) continue;
    rows.push({
      bankAccountId: a.bankAccountId,
      accountName: a.accountName,
      nowMinor: a.negative.nowMinor,
      worstMinor: a.negative.worst?.balanceMinor ?? null,
      worstDate: a.negative.worst?.date ?? null,
      lastStatementDate: a.negative.last?.date ?? null,
      outstandingCount: a.negative.outstandingCount,
    });
  }
  return rows.sort(
    (x, y) => Math.min(x.nowMinor, x.worstMinor ?? 0) - Math.min(y.nowMinor, y.worstMinor ?? 0) || x.accountName.localeCompare(y.accountName),
  );
}

/** The words of a Statement-balance row in the Exceptions sheet. */
export const statementBalanceSheetText = (row: StatementBalanceRow) => ({
  type: `${row.entryCount} ${row.entryCount === 1 ? "entry" : "entries"}`,
  name: row.payee,
});

/** The words of a below-zero row in the Exceptions sheet; `money` writes a plain number. */
export function belowZeroSheetText(row: BelowZeroRow, money: (minor: number) => string) {
  const lowest = row.worstMinor !== null ? `Lowest ${money(row.worstMinor)} · ` : "";
  return {
    type: `Last reconciled ${row.lastStatementDate ?? "never"}`,
    name: `${lowest}${row.outstandingCount} ${row.outstandingCount === 1 ? "payment" : "payments"} not yet on a statement`,
  };
}
```

- [ ] **Step 6: Edit `ctyhp-accounting/lib/domain/schemas.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
export type ReconciliationReopenInput = z.infer<typeof reconciliationReopenSchema>;

```

replace with:

```ts
export type ReconciliationReopenInput = z.infer<typeof reconciliationReopenSchema>;

/** Removing a flagged group of entries (statement alerts): the account and the payee, never a list of entries. */
export const balanceGroupRemoveSchema = z.object({
  bankAccountId: z.uuid("Choose a bank account"),
  payee: z.string().trim().min(1, "The payee is required").max(300),
  reason: z.string().trim().min(1, "A reason is required").max(300),
});
export type BalanceGroupRemoveInput = z.infer<typeof balanceGroupRemoveSchema>;

```

- [ ] **Step 7: Create `ctyhp-accounting/lib/services/statement-alerts.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { entryDisplayName } from "@/lib/domain/entry-detail";
import {
  statementAlerts,
  withoutReversedPairs,
  type BankAccountAlerts,
  type BankLine,
  type BelowZeroAccount,
  type LastStatement,
  type ReversalPair,
  type StatementAlerts,
} from "@/lib/domain/statement-alerts";
import { readAllPages, type PageResult } from "@/lib/services/paging";
import { getLedgerBalances, getTransactionList } from "@/lib/services/reports";

/**
 * Reading what the two statement alerts need, and removing a flagged group.
 *
 * The reads here only select. The one write is `removeBalanceEntries`, which
 * calls the database function that does the whole job in one transaction; this
 * file posts and deletes nothing itself.
 *
 * A failed read throws. A card built from half a ledger would be a wrong
 * balance presented as a finding, so there is no partial answer.
 */
export class StatementAlertsError extends Error {}

function readAll<T>(label: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  return readAllPages<T>(page, (message) => new StatementAlertsError(`Reading ${label} failed: ${message}`));
}

/** A bank account, with the ledger account its entries post to. */
export interface AlertBankAccount {
  id: string;
  accountId: string;
  name: string;
}

type BankRow = {
  id: string;
  account_id: string;
  bank_name: string;
  acc_account: { name?: string } | null;
};

const BANK_COLUMNS = "id,account_id,bank_name,acc_account(name)";

function bankFromRow(r: BankRow): AlertBankAccount {
  return { id: r.id, accountId: r.account_id, name: r.acc_account?.name || r.bank_name };
}

async function readBankAccount(sb: SupabaseClient, bankAccountId: string): Promise<AlertBankAccount> {
  const { data, error } = await sb.from("acc_bank_account").select(BANK_COLUMNS).eq("id", bankAccountId).maybeSingle();
  if (error) throw new StatementAlertsError(`Reading the bank account failed: ${error.message}`);
  if (!data) throw new StatementAlertsError("Bank account not found");
  return bankFromRow(data as unknown as BankRow);
}

async function readBankAccounts(sb: SupabaseClient): Promise<AlertBankAccount[]> {
  const { data, error } = await sb.from("acc_bank_account").select(BANK_COLUMNS).order("created_at").order("id");
  if (error) throw new StatementAlertsError(`Reading the bank accounts failed: ${error.message}`);
  return ((data ?? []) as unknown as BankRow[]).map(bankFromRow);
}

type LineRow = {
  id: string;
  debit_minor: number;
  credit_minor: number;
  amount_base_minor: number;
  acc_journal_entry: { id: string; entry_number: string; entry_date: string; source_type: string };
};

/** Every posted line on the ledger account, all dates. Ordered by the line id, which is unique. */
function readLines(sb: SupabaseClient, accountId: string): Promise<LineRow[]> {
  return readAll<LineRow>("the bank account's entries", (f, t) =>
    sb
      .from("acc_journal_line")
      .select("id,debit_minor,credit_minor,amount_base_minor,acc_journal_entry!inner(id,entry_number,entry_date,source_type)")
      .eq("account_id", accountId)
      .eq("acc_journal_entry.status", "posted")
      .order("id")
      .range(f, t),
  );
}

/** Debit minus credit in the base currency, read the way `acc_ledger_balances` reads it. */
function signedBase(l: LineRow): number {
  if (Number(l.debit_minor) > 0) return Number(l.amount_base_minor);
  if (Number(l.credit_minor) > 0) return -Number(l.amount_base_minor);
  return 0;
}

/** The lines ticked in a completed reconciliation of this bank account. */
async function readClearedLineIds(sb: SupabaseClient, bankAccountId: string): Promise<Set<string>> {
  const rows = await readAll<{ id: string; journal_line_id: string }>("the ticked lines", (f, t) =>
    sb
      .from("acc_reconciliation_line")
      .select("id,journal_line_id,acc_statement_reconciliation!inner(bank_account_id,status)")
      .eq("acc_statement_reconciliation.bank_account_id", bankAccountId)
      .eq("acc_statement_reconciliation.status", "completed")
      .order("id")
      .range(f, t),
  );
  return new Set(rows.map((r) => r.journal_line_id));
}

type ReconRow = {
  id: string;
  bank_account_id: string;
  statement_ending_date: string;
  statement_ending_balance_minor: number | string;
  completed_at: string | null;
};

/** The latest completed reconciliation of each bank account: its date and ending balance. */
async function readLastStatements(sb: SupabaseClient, bankAccountId: string | null): Promise<Map<string, LastStatement>> {
  const rows = await readAll<ReconRow>("the reconciliations", (f, t) => {
    let q = sb
      .from("acc_statement_reconciliation")
      .select("id,bank_account_id,statement_ending_date,statement_ending_balance_minor,completed_at")
      .eq("status", "completed");
    if (bankAccountId) q = q.eq("bank_account_id", bankAccountId);
    return q.order("id").range(f, t);
  });
  const latest = new Map<string, ReconRow>();
  for (const r of rows) {
    const date = String(r.statement_ending_date).slice(0, 10);
    const seen = latest.get(r.bank_account_id);
    // Two sessions for one statement date: the one completed last is the one that stands.
    if (
      !seen ||
      date > String(seen.statement_ending_date).slice(0, 10) ||
      (date === String(seen.statement_ending_date).slice(0, 10) && (r.completed_at ?? "") > (seen.completed_at ?? ""))
    ) {
      latest.set(r.bank_account_id, r);
    }
  }
  return new Map(
    [...latest].map(([bank, r]) => [
      bank,
      { date: String(r.statement_ending_date).slice(0, 10), endingMinor: Number(r.statement_ending_balance_minor) },
    ]),
  );
}

type LinkRow = { id: string; original_entry_id: string; reversal_entry_id: string };

/** Which entry reversed which, so the detectors can leave both out. */
async function readReversalPairs(sb: SupabaseClient): Promise<ReversalPair[]> {
  const rows = await readAll<LinkRow>("the reversals", (f, t) =>
    sb.from("acc_journal_reversal_link").select("id,original_entry_id,reversal_entry_id").order("id").range(f, t),
  );
  return rows.map((r) => ({ originalEntryId: r.original_entry_id, reversalEntryId: r.reversal_entry_id }));
}

type ChartRow = { id: string; account_code: string; name: string };

/** Account id → "code name", for the "coded to" column. */
async function readLabels(sb: SupabaseClient): Promise<Map<string, string>> {
  const chart = await readAll<ChartRow>("the chart of accounts", (f, t) =>
    sb.from("acc_account").select("id,account_code,name").order("account_code").order("id").range(f, t),
  );
  return new Map(chart.map((a) => [a.id, `${a.account_code} ${a.name}`]));
}

/** What the transaction list knows about each entry: its name and the accounts on it. */
async function readEntryNames(sb: SupabaseClient, dates: readonly string[]) {
  if (dates.length === 0) return { names: new Map<string, { payee: string; narration: string }>(), accountIds: new Map<string, string[]>() };
  const first = dates.reduce((min, d) => (d < min ? d : min));
  const last = dates.reduce((max, d) => (d > max ? d : max));
  const listed = await getTransactionList(sb, first, last);
  return {
    names: new Map(listed.map((r) => [r.entryId, { payee: entryDisplayName(r), narration: r.description }])),
    accountIds: new Map(listed.map((r) => [r.entryId, r.accountIds])),
  };
}

type Names = Awaited<ReturnType<typeof readEntryNames>>;

function toBankLines(
  rows: readonly LineRow[],
  glAccountId: string,
  cleared: ReadonlySet<string>,
  names: Names,
  labels: ReadonlyMap<string, string>,
): BankLine[] {
  return rows.map((l) => {
    const entry = l.acc_journal_entry;
    const named = names.names.get(entry.id);
    return {
      lineId: l.id,
      entryId: entry.id,
      entryNumber: entry.entry_number,
      date: String(entry.entry_date).slice(0, 10),
      amountMinor: signedBase(l),
      payee: named?.payee ?? entry.entry_number,
      narration: named?.narration ?? "",
      codedTo: (names.accountIds.get(entry.id) ?? [])
        .filter((id) => id !== glAccountId)
        .map((id) => labels.get(id) ?? "")
        .filter((label) => label !== ""),
      sourceType: entry.source_type,
      cleared: cleared.has(l.id),
    };
  });
}

/** The posted lines of one bank account, ready for the detectors. */
async function readBankLines(
  sb: SupabaseClient,
  bank: AlertBankAccount,
  names: Names | null,
  labels: ReadonlyMap<string, string>,
): Promise<{ lines: BankLine[]; rows: LineRow[] }> {
  const [rows, cleared] = await Promise.all([readLines(sb, bank.accountId), readClearedLineIds(sb, bank.id)]);
  const resolved = names ?? (await readEntryNames(sb, rows.map((r) => String(r.acc_journal_entry.entry_date).slice(0, 10))));
  return { lines: toBankLines(rows, bank.accountId, cleared, resolved, labels), rows };
}

/**
 * One bank account's posted lines and its last agreed statement, as the
 * detectors take them: without the entries that were reversed, and their
 * reversals (see `withoutReversedPairs`).
 */
export async function getBankAccountLines(
  sb: SupabaseClient,
  bankAccountId: string,
): Promise<{ lines: BankLine[]; last: LastStatement | null }> {
  const bank = await readBankAccount(sb, bankAccountId);
  const [labels, last, pairs] = await Promise.all([readLabels(sb), readLastStatements(sb, bank.id), readReversalPairs(sb)]);
  const { lines } = await readBankLines(sb, bank, null, labels);
  return { lines: withoutReversedPairs(lines, pairs), last: last.get(bank.id) ?? null };
}

/** Both alerts for one bank account. Throws if any read fails. */
export async function getStatementAlerts(sb: SupabaseClient, bankAccountId: string): Promise<StatementAlerts> {
  const { lines, last } = await getBankAccountLines(sb, bankAccountId);
  return statementAlerts(lines, last);
}

/**
 * Both alerts for every bank account.
 *
 * The transaction list, which names the entries, is read once over the dates
 * all the accounts span, not once per account.
 */
export async function getAllStatementAlerts(sb: SupabaseClient): Promise<BankAccountAlerts[]> {
  const banks = await readBankAccounts(sb);
  if (banks.length === 0) return [];
  const [labels, last, pairs, allRows] = await Promise.all([
    readLabels(sb),
    readLastStatements(sb, null),
    readReversalPairs(sb),
    Promise.all(banks.map((b) => readLines(sb, b.accountId))),
  ]);
  const names = await readEntryNames(
    sb,
    allRows.flatMap((rows) => rows.map((r) => String(r.acc_journal_entry.entry_date).slice(0, 10))),
  );
  const out: BankAccountAlerts[] = [];
  for (const [i, bank] of banks.entries()) {
    const cleared = await readClearedLineIds(sb, bank.id);
    const lines = withoutReversedPairs(toBankLines(allRows[i], bank.accountId, cleared, names, labels), pairs);
    const found = statementAlerts(lines, last.get(bank.id) ?? null);
    out.push({ bankAccountId: bank.id, accountName: bank.name, ghosts: found.ghosts, negative: found.negative });
  }
  return out;
}

/* ----------------------------------------------------------------- removal */

/** An entry that cannot be removed, and the reason in a plain sentence. */
export interface BalanceEntryBlocker {
  entryId: string;
  entryNumber: string;
  reason: string;
}

/** The entries among `entryIds` that `acc_remove_balance_entries` would refuse. Empty when all can go. */
export async function getBalanceEntryBlockers(sb: SupabaseClient, entryIds: readonly string[]): Promise<BalanceEntryBlocker[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await sb.rpc("acc_balance_entry_blockers", { p_entry_ids: [...entryIds] });
  if (error) throw new StatementAlertsError(error.message);
  return ((data ?? []) as { entry_id: string; entry_number: string | null; reason: string }[]).map((r) => ({
    entryId: r.entry_id,
    entryNumber: r.entry_number ?? "",
    reason: r.reason,
  }));
}

export interface RemovedBalanceEntries {
  removed: number;
  reversed: number;
  voided: number;
  /** The signed net movement taken out of the bank account, base currency minor units. */
  total_minor: number;
}

/**
 * Remove a flagged group, all or nothing. The database function refuses the
 * whole request when any entry cannot go; its message names each one, and is
 * thrown as it is.
 */
export async function removeBalanceEntries(
  sb: SupabaseClient,
  bankAccountId: string,
  entryIds: readonly string[],
  reason: string,
): Promise<RemovedBalanceEntries> {
  const { data, error } = await sb.rpc("acc_remove_balance_entries", {
    p_bank_account_id: bankAccountId,
    p_entry_ids: [...entryIds],
    p_reason: reason,
  });
  if (error) throw new StatementAlertsError(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    removed: Number(r.removed ?? 0),
    reversed: Number(r.reversed ?? 0),
    voided: Number(r.voided ?? 0),
    total_minor: Number(r.total_minor ?? 0),
  };
}

/* ------------------------------------------------------------ balance sheet */

/**
 * The bank accounts that read below zero at `asOf`, for the Balance Sheet note.
 *
 * One read of the ledger balances finds them. The detector, which reads every
 * line of an account, runs only for those, so a Balance Sheet over healthy
 * books costs one extra call.
 */
export async function getBelowZeroBankAccounts(sb: SupabaseClient, asOf: string): Promise<BelowZeroAccount[]> {
  const [banks, balances] = await Promise.all([readBankAccounts(sb), getLedgerBalances(sb, null, asOf)]);
  const byAccount = new Map(balances.map((b) => [b.accountId, b.debitBase - b.creditBase]));
  const negative = banks.filter((b) => (byAccount.get(b.accountId) ?? 0) < 0);
  return Promise.all(
    negative.map(async (bank) => {
      const found = await getStatementAlerts(sb, bank.id);
      return {
        bankAccountId: bank.id,
        accountName: bank.name,
        ghostEntries: found.ghosts.reduce((sum, g) => sum + g.entryIds.length, 0),
      };
    }),
  );
}
```

- [ ] **Step 8: Edit `ctyhp-accounting/app/(app)/banking/reconcile/actions.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema } from "@/lib/domain/schemas";
import {
```

replace with:

```ts
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import {
  balanceGroupRemoveSchema, reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema,
} from "@/lib/domain/schemas";
import { GHOST_GONE, payeeKeyOf, type GhostGroup, type NegativeWatch } from "@/lib/domain/statement-alerts";
import { hasPermission } from "@/lib/services/access";
import {
  getBalanceEntryBlockers, getStatementAlerts, removeBalanceEntries,
  type BalanceEntryBlocker, type RemovedBalanceEntries,
} from "@/lib/services/statement-alerts";
import {
```

Edit 2 of 2 — find:

```ts
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getDiscrepancies(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

replace with:

```ts
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getDiscrepancies(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/** A flagged group with the entries that stand in the way of removing it (none, when it can go). */
export type GhostGroupView = GhostGroup & { blockers: BalanceEntryBlocker[] };

export interface StatementAlertsView {
  ghosts: GhostGroupView[];
  negative: NegativeWatch | null;
}

/**
 * Both statement alerts for one bank account, for any signed-in role.
 *
 * Who may remove is the database's call, so the blockers (which only staff may
 * ask for) are read for people who can write, and left empty for a viewer, who
 * is not offered the button anyway.
 */
export async function statementAlertsAction(bankAccountId: string): Promise<ActionResult<StatementAlertsView>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    const sb = await createSupabaseServerClient();
    const found = await getStatementAlerts(sb, bankAccountId);
    const ghosts: GhostGroupView[] = [];
    for (const group of found.ghosts) {
      const blockers = canWrite(role) ? await getBalanceEntryBlockers(sb, group.entryIds) : [];
      ghosts.push({ ...group, blockers });
    }
    return { ok: true, data: { ghosts, negative: found.negative } };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}

/**
 * Remove one flagged group: every entry in it, or none.
 *
 * The screen sends the account and the payee, not a list of entries. The group
 * is found again here, from the books as they are now, so a stale card cannot
 * remove entries that have since changed. The database function refuses the
 * whole request if any entry cannot go, and says which; that message is passed
 * on as it is.
 */
export async function removeBalanceGroupAction(raw: unknown): Promise<ActionResult<RemovedBalanceEntries>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = balanceGroupRemoveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    if (!(await hasPermission(sb, "journal.post"))) {
      return { ok: false, error: "Removing entries needs the Post manual journals permission." };
    }
    const { bankAccountId, payee, reason } = parsed.data;
    const found = await getStatementAlerts(sb, bankAccountId);
    const group = found.ghosts.find((g) => payeeKeyOf(g.payee) === payeeKeyOf(payee));
    if (!group) return { ok: false, error: GHOST_GONE };
    const result = await removeBalanceEntries(sb, bankAccountId, group.entryIds, reason);
    for (const path of ["/banking/reconcile", "/banking", "/journal", "/reports", "/reports/exceptions", "/dashboard"]) {
      revalidatePath(path);
    }
    return { ok: true, data: result };
  }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 9: Create `ctyhp-accounting/tests/live/statement-alerts.live.ts`** with exactly this content:

```ts
/**
 * The statement alerts, checked against every company's books — read-only.
 *
 * For every company the smoke user belongs to and every bank account in it, both
 * detectors run over the account's real lines, and their output is checked for
 * internal consistency:
 *  (a) the account's lines add up to its ledger balance, and when the account
 *      is flagged below zero, "now" is that balance;
 *  (b) every row of a flagged group lands on the account's balance without the
 *      group, worked out again here by a plain sum, plus its offset;
 *  (c) every outstanding payment is an unticked, negative line dated after the
 *      last agreed statement.
 * Counts are logged: how many accounts each detector flags. Names and amounts
 * never are, and nothing is written — every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/statement-alerts.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { payeeKeyOf, statementAlerts } from "@/lib/domain/statement-alerts";
import { listBankAccounts } from "@/lib/services/banking";
import { getLedgerBalances } from "@/lib/services/reports";
import { getBankAccountLines } from "@/lib/services/statement-alerts";

interface Company {
  name: string;
  sb: SupabaseClient;
}

const companies: Company[] = [];

beforeAll(async () => {
  const s = await smokeSession();
  if (!s.session) throw new Error("The smoke sign-in returned no session.");
  const auth = { persistSession: false };
  const headers = { Authorization: `Bearer ${s.session.access_token}` };
  const control = createClient(s.supabaseUrl, s.anonKey, { db: { schema: "onebook" }, auth, global: { headers } });
  const { data, error } = await control.rpc("my_companies");
  if (error) throw new Error(`my_companies: ${error.message}`);
  for (const row of (data ?? []) as { legal_name: string; schema_name: string }[]) {
    companies.push({
      name: row.schema_name,
      sb: createClient(s.supabaseUrl, s.anonKey, {
        db: { schema: row.schema_name },
        auth,
        global: { headers },
      }) as unknown as SupabaseClient,
    });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

describe("statement alerts on every company's bank accounts", () => {
  it("both detectors agree with the ledger and with themselves", async () => {
    for (const c of companies) {
      const [banks, balances] = await Promise.all([listBankAccounts(c.sb), getLedgerBalances(c.sb, null, "9999-12-31")]);
      const ledger = new Map(balances.map((b) => [b.accountId, b.debitBase - b.creditBase]));
      let ghostAccounts = 0;
      let ghostGroupCount = 0;
      let negativeAccounts = 0;
      let nowNegative = 0;
      let outstandingChecked = 0;
      let problems = 0;

      for (const bank of banks) {
        const { lines, last } = await getBankAccountLines(c.sb, bank.id);
        const found = statementAlerts(lines, last);
        const byId = new Map(lines.map((l) => [l.lineId, l]));
        const total = lines.reduce((sum, l) => sum + l.amountMinor, 0);

        // (a) The lines are the ledger, and "now" is the ledger balance.
        if (total !== (ledger.get(bank.account_id) ?? 0)) problems += 1;
        if (found.negative && found.negative.nowMinor !== total) problems += 1;

        // (b) Each flagged row lands on the balance without its group, plus its offset.
        for (const group of found.ghosts) {
          const inGroup = new Set(
            lines.filter((l) => payeeKeyOf(l.payee) === payeeKeyOf(group.payee)).map((l) => l.lineId),
          );
          const offsets = new Map<number, number>();
          for (const row of group.rows) offsets.set(row.differenceMinor, (offsets.get(row.differenceMinor) ?? 0) + 1);
          for (const row of group.rows) {
            const without = lines
              .filter((l) => !inGroup.has(l.lineId) && l.date <= row.date)
              .reduce((sum, l) => sum + l.amountMinor, 0);
            if (row.balanceMinor !== without) problems += 1;
            if (Math.abs(row.amountMinor) !== row.balanceMinor + row.differenceMinor) problems += 1;
            if (row.differenceMinor !== 0 && (offsets.get(row.differenceMinor) ?? 0) < 3) problems += 1;
          }
          if (group.agree < 3 || group.agree / group.of < 0.6) problems += 1;
          ghostGroupCount += 1;
        }
        if (found.ghosts.length > 0) ghostAccounts += 1;

        // (c) Outstanding payments are unticked, negative and after the last statement.
        if (found.negative) {
          negativeAccounts += 1;
          if (found.negative.nowMinor < 0) nowNegative += 1;
          for (const o of found.negative.outstanding) {
            const line = byId.get(o.lineId);
            outstandingChecked += 1;
            if (!line || line.cleared || line.amountMinor >= 0 || (last !== null && line.date <= last.date)) problems += 1;
          }
          if (found.negative.last?.date !== last?.date) problems += 1;
          // A never-reconciled account is flagged only while negative now.
          if (last === null && found.negative.nowMinor >= 0) problems += 1;
        }
      }

      console.log(
        `${c.name}: ${banks.length} bank accounts, ${ghostAccounts} with a balance posted as payments (${ghostGroupCount} groups), ` +
          `${negativeAccounts} below zero since the last statement (${nowNegative} still today), ` +
          `${outstandingChecked} outstanding payments checked, ${problems === 0 ? "all consistent" : `${problems} INCONSISTENT`}`,
      );
      expect(problems, c.name).toBe(0);
    }
  });
});
```

- [ ] **Step 10: Do not run the live check**

`tests/live/statement-alerts.live.ts` reads every company's real books. The controller runs it alone in Task 6. Do not run it here, and run nothing else that connects to the database.

- [ ] **Step 11: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/statement-alerts.test.ts" "tests/unit/statement-alerts-service.test.ts" "tests/unit/statement-alerts-actions.test.ts" "lib/domain/statement-alerts.ts" "lib/domain/schemas.ts" "lib/services/statement-alerts.ts" "app/(app)/banking/reconcile/actions.ts" "tests/live/statement-alerts.live.ts"
npx vitest run tests/unit/statement-alerts.test.ts tests/unit/statement-alerts-service.test.ts tests/unit/statement-alerts-actions.test.ts tests/unit/bankrec.test.ts tests/unit/reconciliation.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; statement-alerts (55), statement-alerts-service (17) and statement-alerts-actions (13): 85 tests passing; bankrec (5) and reconciliation (10) pass unchanged.

- [ ] **Step 12: Commit**

```bash
git add "ctyhp-accounting/tests/unit/statement-alerts.test.ts" "ctyhp-accounting/tests/unit/statement-alerts-service.test.ts" "ctyhp-accounting/tests/unit/statement-alerts-actions.test.ts" "ctyhp-accounting/lib/domain/statement-alerts.ts" "ctyhp-accounting/lib/domain/schemas.ts" "ctyhp-accounting/lib/services/statement-alerts.ts" "ctyhp-accounting/app/(app)/banking/reconcile/actions.ts" "ctyhp-accounting/tests/live/statement-alerts.live.ts"
git commit -m "feat(statement-alerts): detect a balance posted as payments and a bank account below zero"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 3: Ten Exceptions checks and the Balance Sheet note

**Files:**
- Test (modify): `ctyhp-accounting/tests/unit/exceptions.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/exceptions-service.test.ts`
- Modify: `ctyhp-accounting/lib/domain/exceptions.ts`
- Modify: `ctyhp-accounting/lib/services/exceptions.ts`
- Modify: `ctyhp-accounting/lib/domain/report-catalog.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/exceptions/ExceptionsClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/actions.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/ReportsClient.tsx`

**Interfaces:**
- Consumes: Task 2's `statementBalanceRows`, `belowZeroRows`, their sheet text, `balanceSheetNote`, `reconcileHref`, `getAllStatementAlerts`, `getBelowZeroBankAccounts`; the existing Exceptions report (`buildExceptionReport`, `readOr`, `ExceptionsClient` sections) and `ReportsClient`.
- Produces: `checksRun: 10` with the keys `statementBalance` and `belowZero` (labels "Entries that look like a statement balance" and "Bank accounts below zero since their last statement"), their rows in the sheet export and two sections linking to Reconcile; `balanceSheetNoteAction(to)` and the amber note under the Balance Sheet.

- [ ] **Step 1: Edit `ctyhp-accounting/tests/unit/exceptions.test.ts`** — apply these 7 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 7 — find:

```ts
import { csvFromExportSheet } from "@/lib/domain/report-export";
import {
```

replace with:

```ts
import { csvFromExportSheet } from "@/lib/domain/report-export";
import type { BankAccountAlerts } from "@/lib/domain/statement-alerts";
import {
```

Edit 2 of 7 — find:

```ts
import {
  buildExceptionReport,
```

replace with:

```ts
import {
  CHECK_LABEL,
  buildExceptionReport,
```

Edit 3 of 7 — find:

```ts
describe("buildExceptionReport", () => {
  it("runs eight checks and raises nothing on an empty book", () => {
    const report = buildExceptionReport(emptyInput());
```

replace with:

```ts
describe("buildExceptionReport", () => {
  it("runs ten checks and raises nothing on an empty book", () => {
    const report = buildExceptionReport(emptyInput());
```

Edit 4 of 7 — find:

```ts
    const report = buildExceptionReport(emptyInput());
    expect(report.checksRun).toBe(8);
    expect(report.questionsRaised).toBe(0);
```

replace with:

```ts
    const report = buildExceptionReport(emptyInput());
    expect(report.checksRun).toBe(10);
    expect(report.questionsRaised).toBe(0);
```

Edit 5 of 7 — find:

```ts
    expect(report.unavailable).toEqual(["incomeNoCost"]);
    // The other seven still ran.
    expect(report.holding).toHaveLength(1);
```

replace with:

```ts
    expect(report.unavailable).toEqual(["incomeNoCost"]);
    // The other nine still ran.
    expect(report.holding).toHaveLength(1);
```

Edit 6 of 7 — find:

```ts

describe("exceptionReportSheet", () => {
```

replace with:

```ts

describe("the two statement checks", () => {
  const alerts: BankAccountAlerts[] = [
    {
      bankAccountId: "b1",
      accountName: "Business Checking",
      ghosts: [
        { payee: "Payroll", rows: [], agree: 4, of: 4, offsetMinor: 0, runs: 1, totalMinor: -90_000, entryIds: ["a", "b", "c", "d"] },
      ],
      negative: {
        nowMinor: -2_500,
        last: { date: "2026-03-31", endingMinor: 40_000 },
        worst: { date: "2026-05-04", balanceMinor: -7_500 },
        outstanding: [],
        outstandingCount: 6,
      },
    },
    { bankAccountId: "b2", accountName: "Savings", ghosts: [], negative: null },
  ];
  const meta = { companyName: "Riverbend Trading LLC", currencyCode: "USD", decimals: 2, from: "2026-01-01", to: "2026-09-26" };

  it("names both checks", () => {
    expect(CHECK_LABEL.statementBalance).toBe("Entries that look like a statement balance");
    expect(CHECK_LABEL.belowZero).toBe("Bank accounts below zero since their last statement");
  });

  it("raises one question per flagged group and per flagged account", () => {
    const report = buildExceptionReport(emptyInput({ statementAlerts: alerts }));
    expect(report.statementBalance).toHaveLength(1);
    expect(report.statementBalance[0]).toMatchObject({ bankAccountId: "b1", payee: "Payroll", entryCount: 4, totalMinor: -90_000 });
    expect(report.belowZero).toHaveLength(1);
    expect(report.belowZero[0]).toMatchObject({ bankAccountId: "b1", nowMinor: -2_500, worstMinor: -7_500, outstandingCount: 6 });
    expect(report.questionsRaised).toBe(2);
  });

  it("finds nothing when no alerts were supplied", () => {
    const report = buildExceptionReport(emptyInput());
    expect(report.statementBalance).toEqual([]);
    expect(report.belowZero).toEqual([]);
  });

  it("says Could not run for a statement check whose data could not be read, and Nothing found when it ran", () => {
    const report = buildExceptionReport(emptyInput({ unavailable: ["belowZero"] }));
    const byCheck = new Map(exceptionReportSheet(report, meta).rows.map((r) => [r.check, r.name]));
    expect(byCheck.get(CHECK_LABEL.belowZero)).toBe("Could not run");
    expect(byCheck.get(CHECK_LABEL.statementBalance)).toBe("Nothing found");
  });

  it("writes their rows into the sheet", () => {
    const sheet = exceptionReportSheet(buildExceptionReport(emptyInput({ statementAlerts: alerts })), meta);
    expect(sheet.rows.filter((r) => r.check === CHECK_LABEL.statementBalance)).toEqual([
      { check: CHECK_LABEL.statementBalance, date: "", type: "4 entries", name: "Payroll", account: "Business Checking", amount: -900 },
    ]);
    expect(sheet.rows.filter((r) => r.check === CHECK_LABEL.belowZero)).toEqual([
      {
        check: CHECK_LABEL.belowZero,
        date: "2026-05-04",
        type: "Last reconciled 2026-03-31",
        name: "Lowest -75.00 · 6 payments not yet on a statement",
        account: "Business Checking",
        amount: -25,
      },
    ]);
  });
});

describe("exceptionReportSheet", () => {
```

Edit 7 of 7 — find:

```ts
    const sheet = exceptionReportSheet(report, meta);
    expect(sheet.rows).toHaveLength(8);
    const byCheck = new Map(sheet.rows.map((r) => [r.check, r.name]));
```

replace with:

```ts
    const sheet = exceptionReportSheet(report, meta);
    expect(sheet.rows).toHaveLength(10);
    const byCheck = new Map(sheet.rows.map((r) => [r.check, r.name]));
```

- [ ] **Step 2: Edit `ctyhp-accounting/tests/unit/exceptions-service.test.ts`** — apply these 8 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 8 — find:

```ts
 *
 * `getExceptionReport` reads eight checks' worth of data behind `readOr`,
 * which is supposed to tag exactly the checks a failed read affects — no
```

replace with:

```ts
 *
 * `getExceptionReport` reads ten checks' worth of data behind `readOr`,
 * which is supposed to tag exactly the checks a failed read affects — no
```

Edit 2 of 8 — find:

```ts
  monthlyBalances: Source;
}
```

replace with:

```ts
  monthlyBalances: Source;
  reconciliationLines: Source;
}
```

Edit 3 of 8 — find:

```ts
    monthlyBalances: [],
  };
```

replace with:

```ts
    monthlyBalances: [],
    reconciliationLines: [],
  };
```

Edit 4 of 8 — find:

```ts
  range: (from: number, to: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
}
```

replace with:

```ts
  range: (from: number, to: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
  /** A read that never asks for a range, as `listBankAccounts` does: `await` gets everything. */
  then: (resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown) => unknown;
}
```

Edit 5 of 8 — find:

```ts
    range: async (from: number, to: number) => pageOf(source, from, to),
  };
```

replace with:

```ts
    range: async (from: number, to: number) => pageOf(source, from, to),
    then: (resolve) => resolve(resultOf(source)),
  };
```

Edit 6 of 8 — find:

```ts
          return chainFor(c.undepositedLines);
        default:
```

replace with:

```ts
          return chainFor(c.undepositedLines);
        case "acc_reconciliation_line":
          return chainFor(c.reconciliationLines);
        case "acc_journal_reversal_link":
          return chainFor([]);
        default:
```

Edit 7 of 8 — find:

```ts
    expect(report.unavailable).toEqual([]);
    expect(report.checksRun).toBe(8);
  });
```

replace with:

```ts
    expect(report.unavailable).toEqual([]);
    expect(report.checksRun).toBe(10);
  });

  it("tags both statement checks, and only them, when the bank-account lines cannot be read", async () => {
    // The statement checks share one read of every bank account's lines, so
    // neither can claim "nothing found" when it fails, and no other check is
    // taken down with it.
    const sb = fakeClient({
      bankAccounts: [BANK],
      undepositedLines: new Error("acc_journal_line unreachable"),
      ledgerBalances: [
        {
          account_id: "h1",
          account_code: "9000",
          name: "Uncategorized Expense",
          account_type: "expense",
          debit_base: 250_000,
          credit_base: 0,
        },
      ],
    });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual(["statementBalance", "belowZero"]);
    expect(report.holding).toHaveLength(1);
    expect(report.statementBalance).toEqual([]);
    expect(report.belowZero).toEqual([]);
  });

  it("finds a bank account below zero from its own lines", async () => {
    const sb = fakeClient({
      bankAccounts: [BANK],
      undepositedLines: [
        journalLine("l1", "e1", "2026-01-01", 1_000, 0),
        journalLine("l2", "e2", "2026-01-03", 0, 5_000),
      ],
    });
    const report = await getExceptionReport(sb, FROM, TO, TODAY);
    expect(report.unavailable).toEqual([]);
    expect(report.belowZero).toEqual([
      {
        bankAccountId: "bank-1",
        accountName: "Operating Checking",
        nowMinor: -4_000,
        worstMinor: null,
        worstDate: null,
        lastStatementDate: null,
        outstandingCount: 1,
      },
    ]);
    expect(report.statementBalance).toEqual([]);
    expect(report.questionsRaised).toBeGreaterThanOrEqual(1);
  });
```

Edit 8 of 8 — find:

```ts
  });
});
```

replace with:

```ts
  });
});

const BANK = {
  id: "bank-1",
  account_id: "gl-1",
  bank_name: "First Test Bank",
  created_at: "2026-01-01T00:00:00Z",
  acc_account: { name: "Operating Checking" },
};

function journalLine(id: string, entryId: string, date: string, debit: number, credit: number): Row {
  return {
    id,
    debit_minor: debit,
    credit_minor: credit,
    amount_base_minor: debit || credit,
    acc_journal_entry: { id: entryId, entry_number: `JE-${id}`, entry_date: date, source_type: "manual" },
  };
}
```

- [ ] **Step 3: Run the tests to see them fail**

```bash
npx vitest run tests/unit/exceptions.test.ts tests/unit/exceptions-service.test.ts
```

Expected: FAIL — the Exceptions report still runs 8 checks.

- [ ] **Step 4: Edit `ctyhp-accounting/lib/domain/exceptions.ts`** — apply these 12 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 12 — find:

```ts
/**
 * The eight checks a reviewer runs by hand.
 *
```

replace with:

```ts
/**
 * The ten checks a reviewer runs by hand.
 *
```

Edit 2 of 12 — find:

```ts
import type { LedgerBalance } from "@/lib/domain/reports";
import type { TransactionListRow } from "@/lib/domain/transaction-list";
```

replace with:

```ts
import type { LedgerBalance } from "@/lib/domain/reports";
import {
  belowZeroRows,
  belowZeroSheetText,
  statementBalanceRows,
  statementBalanceSheetText,
  type BankAccountAlerts,
  type BelowZeroRow,
  type StatementBalanceRow,
} from "@/lib/domain/statement-alerts";
import type { TransactionListRow } from "@/lib/domain/transaction-list";
```

Edit 3 of 12 — find:

```ts
/**
 * The eight, named once.
 *
```

replace with:

```ts
/**
 * The ten, named once.
 *
```

Edit 4 of 12 — find:

```ts
  holding: "Still sitting in a holding account",
} as const;
```

replace with:

```ts
  holding: "Still sitting in a holding account",
  statementBalance: "Entries that look like a statement balance",
  belowZero: "Bank accounts below zero since their last statement",
} as const;
```

Edit 5 of 12 — find:

```ts
  /**
   * Checks whose data could not be read. They are reported as unavailable
```

replace with:

```ts
  /**
   * Each bank account's two statement alerts, found by the detectors in
   * `statement-alerts.ts`. Left out, the two statement checks find nothing.
   */
  statementAlerts?: readonly BankAccountAlerts[];
  /**
   * Checks whose data could not be read. They are reported as unavailable
```

Edit 6 of 12 — find:

```ts
  questionsRaised: number;
  checksRun: 8;
  unavailable: CheckKey[];
```

replace with:

```ts
  questionsRaised: number;
  checksRun: 10;
  unavailable: CheckKey[];
```

Edit 7 of 12 — find:

```ts
  holding: HoldingRow[];
}
```

replace with:

```ts
  holding: HoldingRow[];
  statementBalance: StatementBalanceRow[];
  belowZero: BelowZeroRow[];
}
```

Edit 8 of 12 — find:

```ts

/** Run all eight. Nothing here reads a clock, a database or a file. */
export function buildExceptionReport(input: ExceptionReportInput): ExceptionReport {
```

replace with:

```ts

/** Run all ten. Nothing here reads a clock, a database or a file. */
export function buildExceptionReport(input: ExceptionReportInput): ExceptionReport {
```

Edit 9 of 12 — find:

```ts
  const holding = holdingAccounts(input.accounts);

```

replace with:

```ts
  const holding = holdingAccounts(input.accounts);
  const statementBalance = statementBalanceRows(input.statementAlerts ?? []);
  const belowZero = belowZeroRows(input.statementAlerts ?? []);

```

Edit 10 of 12 — find:

```ts
      futureDated.length +
      holding.length,
    checksRun: 8,
    unavailable: [...input.unavailable],
```

replace with:

```ts
      futureDated.length +
      holding.length +
      statementBalance.length +
      belowZero.length,
    checksRun: 10,
    unavailable: [...input.unavailable],
```

Edit 11 of 12 — find:

```ts
    holding,
  };
```

replace with:

```ts
    holding,
    statementBalance,
    belowZero,
  };
```

Edit 12 of 12 — find:

```ts
    })),
  );

  return {
```

replace with:

```ts
    })),
  );
  add(
    "statementBalance",
    report.statementBalance.map((r) => ({
      check: CHECK_LABEL.statementBalance,
      date: "",
      ...statementBalanceSheetText(r),
      account: r.accountName,
      amount: money(r.totalMinor),
    })),
  );
  add(
    "belowZero",
    report.belowZero.map((r) => ({
      check: CHECK_LABEL.belowZero,
      date: r.worstDate ?? "",
      ...belowZeroSheetText(r, (minor) => money(minor).toFixed(meta.decimals)),
      account: r.accountName,
      amount: money(r.nowMinor),
    })),
  );

  return {
```

- [ ] **Step 5: Edit `ctyhp-accounting/lib/services/exceptions.ts`** — apply these 4 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 4 — find:

```ts
import { listBankAccounts, type BankAccountWithGl } from "@/lib/services/banking";
import {
```

replace with:

```ts
import { listBankAccounts, type BankAccountWithGl } from "@/lib/services/banking";
import { getAllStatementAlerts } from "@/lib/services/statement-alerts";
import type { BankAccountAlerts } from "@/lib/domain/statement-alerts";
import {
```

Edit 2 of 4 — find:

```ts

  const [refs, details, byMonth] = await Promise.all([
    readOr(unavailable, ["checkNumber", "duplicates"], [] as ExceptionPaymentRef[], () => paymentReferences(sb)),
```

replace with:

```ts

  const [refs, details, byMonth, statementAlerts] = await Promise.all([
    readOr(unavailable, ["checkNumber", "duplicates"], [] as ExceptionPaymentRef[], () => paymentReferences(sb)),
```

Edit 3 of 4 — find:

```ts
        : getMonthlyLedgerBalances(sb, to, monthSpan(earliest, to)),
    ),
```

replace with:

```ts
        : getMonthlyLedgerBalances(sb, to, monthSpan(earliest, to)),
    ),
    // Both statement checks stand on the same read of every bank account's
    // lines, so when it fails neither can say "nothing found".
    readOr(unavailable, ["statementBalance", "belowZero"], [] as BankAccountAlerts[], () =>
      getAllStatementAlerts(sb),
    ),
```

Edit 4 of 4 — find:

```ts
    paymentReferences: refs,
    unavailable,
```

replace with:

```ts
    paymentReferences: refs,
    statementAlerts,
    unavailable,
```

- [ ] **Step 6: Edit `ctyhp-accounting/lib/domain/report-catalog.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
    description:
      "Eight checks a reviewer runs by hand: entries posted twice, a check number reused, a balance pointing the wrong way, anything still uncoded.",
    href: "/reports/exceptions",
```

replace with:

```ts
    description:
      "Ten checks a reviewer runs by hand: entries posted twice, a check number reused, a balance pointing the wrong way, anything still uncoded, a bank account below zero.",
    href: "/reports/exceptions",
```

- [ ] **Step 7: Edit `ctyhp-accounting/app/(app)/reports/exceptions/ExceptionsClient.tsx`** — apply these 6 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 6 — find:

```tsx
} from "@/lib/domain/exceptions";
import { exceptionReportAction } from "./actions";
```

replace with:

```tsx
} from "@/lib/domain/exceptions";
import { reconcileHref, type BelowZeroRow, type StatementBalanceRow } from "@/lib/domain/statement-alerts";
import { exceptionReportAction } from "./actions";
```

Edit 2 of 6 — find:

```tsx
 * (`reportExceptions` in Accounting-System-v3.html): a period picker, the
 * report on paper under its heading, three figures, then the eight checks —
 * each with its question, why it matters, and what it found. Every section is
```

replace with:

```tsx
 * (`reportExceptions` in Accounting-System-v3.html): a period picker, the
 * report on paper under its heading, three figures, then the ten checks —
 * each with its question, why it matters, and what it found. Every section is
```

Edit 3 of 6 — find:

```tsx
        </ReportSection>
      </>
```

replace with:

```tsx
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.statementBalance}
          note={plural(r.statementBalance.length, "group", "groups")}
          state={state("statementBalance", r.statementBalance.length)}
          why="When a statement’s Balance column is read as amounts, a run of entries for one payee lands exactly on what the account comes to on each date. A payment does not track the balance of the account it is paid from. Open Reconcile to see the workings and remove them."
        >
          <DataTable<StatementBalanceRow>
            rowKey={(row) => `${row.bankAccountId}:${row.payee}`}
            pagination={false}
            dataSource={r.statementBalance}
            columns={[
              flexColumn<StatementBalanceRow>({ title: "Bank account", key: "account", render: (_, row) => row.accountName }),
              flexColumn<StatementBalanceRow>({
                title: "Payee",
                key: "payee",
                render: (_, row) => <span title={row.payee}>{row.payee}</span>,
              }),
              { title: "Entries", key: "entries", width: COLUMN.QTY, align: "right", render: (_, row) => row.entryCount },
              { title: "Total", key: "total", width: COLUMN.MONEY_WIDE, align: "right", render: (_, row) => money(row.totalMinor) },
              {
                title: "",
                key: "open",
                width: 130,
                render: (_, row) => <Link href={reconcileHref(row.bankAccountId)}>Open Reconcile</Link>,
              },
            ]}
          />
        </ReportSection>

        <ReportSection
          title={CHECK_LABEL.belowZero}
          note={plural(r.belowZero.length, "account", "accounts")}
          state={state("belowZero", r.belowZero.length)}
          why="Once a statement is agreed, the balance was right on that day. What drags the account under afterwards is far more often an entry that is not a payment than a real overdraft, which the bank would have printed."
        >
          <DataTable<BelowZeroRow>
            rowKey="bankAccountId"
            pagination={false}
            dataSource={r.belowZero}
            columns={[
              flexColumn<BelowZeroRow>({ title: "Bank account", key: "account", render: (_, row) => row.accountName }),
              {
                title: "Reads now",
                key: "now",
                width: COLUMN.MONEY_WIDE,
                align: "right",
                render: (_, row) => <span className={row.nowMinor < 0 ? styles.negative : undefined}>{money(row.nowMinor)}</span>,
              },
              {
                title: "Lowest",
                key: "worst",
                width: 190,
                align: "right",
                render: (_, row) =>
                  row.worstMinor === null || row.worstDate === null ? (
                    "—"
                  ) : (
                    <span>
                      <span className={styles.negative}>{money(row.worstMinor)}</span>{" "}
                      <span className={styles.muted}>{shortDate(row.worstDate)}</span>
                    </span>
                  ),
              },
              {
                title: "Last statement",
                key: "last",
                width: 140,
                render: (_, row) =>
                  row.lastStatementDate ? shortDate(row.lastStatementDate) : <Tag color="orange">never</Tag>,
              },
              { title: "Not on a statement", key: "outstanding", width: 150, align: "right", render: (_, row) => row.outstandingCount },
              {
                title: "",
                key: "open",
                width: 130,
                render: (_, row) => <Link href={reconcileHref(row.bankAccountId)}>Open Reconcile</Link>,
              },
            ]}
          />
        </ReportSection>
      </>
```

Edit 4 of 6 — find:

```tsx
                label: "Checks run",
                value: report.unavailable.length > 0 ? `${8 - report.unavailable.length} of 8` : 8,
              },
```

replace with:

```tsx
                label: "Checks run",
                value: report.unavailable.length > 0 ? `${10 - report.unavailable.length} of 10` : 10,
              },
```

Edit 5 of 6 — find:

```tsx
              style={{ marginBottom: 20 }}
              title={`${report.unavailable.length} of 8 checks could not be run`}
              description={`${report.unavailable.map((c) => CHECK_LABEL[c]).join("; ")}. The rest of the report is complete. A check that could not run is not saying the books are clear — run the report again.`}
```

replace with:

```tsx
              style={{ marginBottom: 20 }}
              title={`${report.unavailable.length} of 10 checks could not be run`}
              description={`${report.unavailable.map((c) => CHECK_LABEL[c]).join("; ")}. The rest of the report is complete. A check that could not run is not saying the books are clear — run the report again.`}
```

Edit 6 of 6 — find:

```tsx
              <Spin size="large" />
              <span className={styles.muted}>Running eight checks over the books…</span>
            </Space>
```

replace with:

```tsx
              <Spin size="large" />
              <span className={styles.muted}>Running ten checks over the books…</span>
            </Space>
```

- [ ] **Step 8: Edit `ctyhp-accounting/app/(app)/reports/actions.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
import { getZoom } from "@/lib/services/zoom";

```

replace with:

```ts
import { getZoom } from "@/lib/services/zoom";
import { balanceSheetNote, type BalanceSheetNote } from "@/lib/domain/statement-alerts";
import { getBelowZeroBankAccounts } from "@/lib/services/statement-alerts";

```

Edit 2 of 2 — find:

```ts
    return { ok: false, error: err instanceof Error ? err.message : "The entries could not be read." };
  }
}
```

replace with:

```ts
    return { ok: false, error: err instanceof Error ? err.message : "The entries could not be read." };
  }
}

/**
 * The note under a Balance Sheet when a bank account reads below zero on its
 * end date; null when none does. Reads only. A note is a help, not part of the
 * statement, so the caller leaves it out when this fails.
 */
export async function balanceSheetNoteAction(asOf: string): Promise<ActionResult<BalanceSheetNote | null>> {
  const role = await getUserRole();
  if (!role) return { ok: false, error: "Not authorized" };
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return { ok: false, error: "The date is not valid" };
    const sb = await createSupabaseServerClient();
    return { ok: true, data: balanceSheetNote(await getBelowZeroBankAccounts(sb, asOf)) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The note could not be read." };
  }
}
```

- [ ] **Step 9: Edit `ctyhp-accounting/app/(app)/reports/ReportsClient.tsx`** — apply these 5 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 5 — find:

```tsx
import { fiscalYearStartOf, pointColumns, rangeColumns, type CompareMode } from "@/lib/domain/statement-columns";
import { getBudgetVsActualAction, getLedgerBalancesAction, getStatementOfEquityAction } from "./actions";

```

replace with:

```tsx
import { fiscalYearStartOf, pointColumns, rangeColumns, type CompareMode } from "@/lib/domain/statement-columns";
import type { BalanceSheetNote } from "@/lib/domain/statement-alerts";
import { balanceSheetNoteAction, getBudgetVsActualAction, getLedgerBalancesAction, getStatementOfEquityAction } from "./actions";

```

Edit 2 of 5 — find:

```tsx
  const [notice, setNotice] = useState<string | null>(null);
  const [ran, setRan] = useState(initialRange);
```

replace with:

```tsx
  const [notice, setNotice] = useState<string | null>(null);
  // The Balance Sheet's note about a bank account below zero on its end date.
  const [bankNote, setBankNote] = useState<BalanceSheetNote | null>(null);
  const [ran, setRan] = useState(initialRange);
```

Edit 3 of 5 — find:

```tsx
      setMonthly([]);
    };
```

replace with:

```tsx
      setMonthly([]);
      setBankNote(null);
    };
```

Edit 4 of 5 — find:

```tsx
      const sheets = balances.map(buildBalanceSheet);
      show(
```

replace with:

```tsx
      const sheets = balances.map(buildBalanceSheet);
      // A help beside the statement, not part of it: read apart from the figures, and left out if it fails.
      void balanceSheetNoteAction(to).then(
        (result) => {
          if (current()) setBankNote(result.ok ? (result.data ?? null) : null);
        },
        () => {
          if (current()) setBankNote(null);
        },
      );
      show(
```

Edit 5 of 5 — find:

```tsx
      ) : null}
      <ReportFoot>
```

replace with:

```tsx
      ) : null}
      {type === "balance" && bankNote ? (
        <Alert
          type="warning"
          showIcon
          className={styles.outOfBalance}
          title={bankNote.headline}
          description={
            <>
              {bankNote.detail}{" "}
              {bankNote.links.map((link, i) => (
                <span key={link.bankAccountId}>
                  {i > 0 ? " · " : null}
                  <Link href={link.href}>{link.label}</Link>
                </span>
              ))}
            </>
          }
        />
      ) : null}
      <ReportFoot>
```

- [ ] **Step 10: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/exceptions.test.ts" "tests/unit/exceptions-service.test.ts" "lib/domain/exceptions.ts" "lib/services/exceptions.ts" "lib/domain/report-catalog.ts" "app/(app)/reports/exceptions/ExceptionsClient.tsx" "app/(app)/reports/actions.ts" "app/(app)/reports/ReportsClient.tsx"
npx vitest run tests/unit/exceptions.test.ts tests/unit/exceptions-service.test.ts tests/unit/statement-alerts.test.ts tests/unit/report-catalog.test.ts tests/unit/reports.test.ts tests/unit/report-frame-contract.test.ts tests/unit/rsc-antd.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; exceptions (66) and exceptions-service (7): 73 tests passing; statement-alerts (55), report-catalog (3), reports (29), report-frame-contract (5), rsc-antd (2), table-adoption (6) and table-fit-contract (3) pass.

- [ ] **Step 11: Commit**

```bash
git add "ctyhp-accounting/tests/unit/exceptions.test.ts" "ctyhp-accounting/tests/unit/exceptions-service.test.ts" "ctyhp-accounting/lib/domain/exceptions.ts" "ctyhp-accounting/lib/services/exceptions.ts" "ctyhp-accounting/lib/domain/report-catalog.ts" "ctyhp-accounting/app/(app)/reports/exceptions/ExceptionsClient.tsx" "ctyhp-accounting/app/(app)/reports/actions.ts" "ctyhp-accounting/app/(app)/reports/ReportsClient.tsx"
git commit -m "feat(statement-alerts): ten Exceptions checks and a Balance Sheet note"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 4: The Reconcile start screen — cards, workings and removal

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/reconcile-alerts-screen.test.ts`
- Create: `ctyhp-accounting/lib/domain/reconcile-alerts-screen.ts`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/alert-columns.ts`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/statement-alerts.module.css`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/alert-parts.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/BelowZeroCard.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/BalanceGroupCard.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/StatementAlertsPanel.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/reconcile/ReconcileListClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/reconcile/page.tsx`

**Interfaces:**
- Consumes: Task 2's `statementAlertsAction`, `removeBalanceGroupAction`, `ghostCard`, `negativeCard`, `payeeKeyOf`, `GHOST_GONE`, `reconcileHref`; existing `DataTable`, `flexColumn`, `EntryDetailDrawer`, `formatMoney`, `COLUMN` / `TABLE_BOX_AT_1280` / `fitsBox` (`lib/design/table-metrics`).
- Produces: `/banking/reconcile` keeps the chosen account in `?account=` (written with `history.replaceState`), and shows above the list the below-zero card and a card per flagged group: Show me the workings, blockers, and the two-click removal with a required reason. `lib/domain/reconcile-alerts-screen.ts`: `chosenBankId`, `reasonProblem`, `removalStep`, `removalLabel`, `canOfferRemoval`, `withoutGroup`, `entryHref`, `codedToText` and the screen's words. `alert-columns.ts`: the card table widths and their phone minimums.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/reconcile-alerts-screen.test.ts`** with exactly this content:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import {
  ALERT_CARD,
  ALERT_TABLE_BOX,
  OUTSTANDING_ELASTIC_FLOOR,
  OUTSTANDING_MIN_WIDTH,
  OUTSTANDING_WIDTH,
  WORKINGS_ELASTIC_FLOOR,
  WORKINGS_MIN_WIDTH,
  WORKINGS_WIDTH,
} from "@/app/(app)/banking/reconcile/alert-columns";
import {
  BLOCKERS_HEADING,
  CHECKS_FAILED,
  REASON_MAX,
  REASON_REQUIRED,
  REASON_TOO_LONG,
  REMOVAL_IDLE,
  canOfferRemoval,
  chosenBankId,
  codedToText,
  entryHref,
  reasonProblem,
  removalLabel,
  removalStep,
  withoutGroup,
  type RemovalEvent,
  type RemovalState,
} from "@/lib/domain/reconcile-alerts-screen";
import { ghostCard, type GhostGroup } from "@/lib/domain/statement-alerts";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const fmt = { money: (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}` };

const group = (over: Partial<GhostGroup> = {}): GhostGroup => ({
  payee: "Sample Payroll Co",
  rows: [],
  agree: 3,
  of: 4,
  offsetMinor: 0,
  runs: 1,
  totalMinor: -90_000,
  entryIds: ["e1", "e2", "e3"],
  ...over,
});

/** Runs a list of events from idle. */
const run = (events: RemovalEvent[], from: RemovalState = REMOVAL_IDLE) => events.reduce(removalStep, from);

describe("the cards' tables fit", () => {
  it("measure their box from the page's box, less the card around them", () => {
    expect(ALERT_TABLE_BOX).toBe(
      TABLE_BOX_AT_1280 - ALERT_CARD.border - ALERT_CARD.accent - 2 * ALERT_CARD.paddingX - ALERT_CARD.gutter,
    );
    expect(ALERT_TABLE_BOX).toBeLessThan(TABLE_BOX_AT_1280);
  });

  it("fits the workings at a 1280px window, with Coded to at the text floor", () => {
    expect(WORKINGS_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    expect(fitsBox(sum(Object.values(WORKINGS_WIDTH)), WORKINGS_ELASTIC_FLOOR, ALERT_TABLE_BOX)).toBe(true);
  });

  it("fits the payments not yet on a statement, with Name and Coded to at the text floor", () => {
    expect(OUTSTANDING_ELASTIC_FLOOR).toBe(2 * COLUMN.TEXT_MIN);
    expect(fitsBox(sum(Object.values(OUTSTANDING_WIDTH)), OUTSTANDING_ELASTIC_FLOOR, ALERT_TABLE_BOX)).toBe(true);
  });

  it("is measured with the figures the stylesheet draws with", () => {
    // The sums above are only true if the card really is this wide around its
    // tables. Change the padding in one place and not the other, and this fails.
    const css = readFileSync(
      join(process.cwd(), "app", "(app)", "banking", "reconcile", "statement-alerts.module.css"),
      "utf8",
    );
    const card = css.slice(css.indexOf(".card {"), css.indexOf("}", css.indexOf(".card {")));
    expect(card).toContain(`padding: 18px ${ALERT_CARD.paddingX}px;`);
    expect(card).toContain(`border-left: ${ALERT_CARD.accent}px solid`);
    expect(card).toContain("grid-template-columns: 32px minmax(0, 1fr);");
    expect(card).toContain("column-gap: 16px;");
    expect(ALERT_CARD.gutter).toBe(32 + 16);
  });

  it("keeps every column readable on a phone: declared widths plus floors, scrolled inside the card", () => {
    expect(WORKINGS_MIN_WIDTH).toBe(sum(Object.values(WORKINGS_WIDTH)) + WORKINGS_ELASTIC_FLOOR);
    expect(OUTSTANDING_MIN_WIDTH).toBe(sum(Object.values(OUTSTANDING_WIDTH)) + OUTSTANDING_ELASTIC_FLOOR);
    const css = readFileSync(
      join(process.cwd(), "app", "(app)", "banking", "reconcile", "statement-alerts.module.css"),
      "utf8",
    );
    const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
    const minWidthOf = (selector: string) => {
      const at = phone.indexOf(selector);
      expect(at, selector).toBeGreaterThan(-1);
      return phone.slice(at, phone.indexOf("}", at));
    };
    expect(minWidthOf(".workings :global(.ant-table-content) > table")).toContain(`min-width: ${WORKINGS_MIN_WIDTH}px;`);
    expect(minWidthOf(".outstanding :global(.ant-table-content) > table")).toContain(`min-width: ${OUTSTANDING_MIN_WIDTH}px;`);
  });
});

describe("chosenBankId", () => {
  const banks = [{ id: "b1" }, { id: "b2" }];

  it("takes the account in the address when it is one of the company's", () => {
    expect(chosenBankId(banks, "b2")).toBe("b2");
  });

  it("falls back to the first account, quietly, for an unknown id or none", () => {
    expect(chosenBankId(banks, "not-ours")).toBe("b1");
    expect(chosenBankId(banks, null)).toBe("b1");
    expect(chosenBankId(banks, undefined)).toBe("b1");
    expect(chosenBankId(banks, "")).toBe("b1");
  });

  it("has nothing to choose without bank accounts", () => {
    expect(chosenBankId([], "b1")).toBeUndefined();
  });
});

describe("reasonProblem", () => {
  it("asks for a reason, with the server's words", () => {
    expect(reasonProblem("")).toBe(REASON_REQUIRED);
    expect(reasonProblem("   ")).toBe(REASON_REQUIRED);
    expect(REASON_REQUIRED).toBe("A reason is required");
  });

  it("takes up to the server's limit, counted after trimming", () => {
    expect(REASON_MAX).toBe(300);
    expect(reasonProblem("x".repeat(300))).toBeNull();
    expect(reasonProblem(`  ${"x".repeat(300)}  `)).toBeNull();
    expect(reasonProblem("x".repeat(301))).toBe(REASON_TOO_LONG);
  });

  it("accepts an ordinary reason", () => {
    expect(reasonProblem("Balance column read as amounts")).toBeNull();
  });
});

describe("removalStep", () => {
  it("turns the first click into a request for a reason", () => {
    expect(run([{ type: "ask" }])).toEqual({ step: "confirm", reason: "", problem: null, error: null });
  });

  it("will not send without a reason, and says why", () => {
    const s = run([{ type: "ask" }, { type: "type", reason: "  " }, { type: "confirm" }]);
    expect(s).toEqual({ step: "confirm", reason: "  ", problem: REASON_REQUIRED, error: null });
  });

  it("clears the complaint as soon as a reason is typed", () => {
    const s = run([{ type: "ask" }, { type: "confirm" }, { type: "type", reason: "B" }]);
    expect(s).toMatchObject({ step: "confirm", reason: "B", problem: null });
  });

  it("sends on the second click, with the reason trimmed", () => {
    const s = run([{ type: "ask" }, { type: "type", reason: "  Balance read as amounts " }, { type: "confirm" }]);
    expect(s).toEqual({ step: "removing", reason: "Balance read as amounts" });
  });

  it("ignores another click while the request is out, so nothing is sent twice", () => {
    const sending = run([{ type: "ask" }, { type: "type", reason: "r" }, { type: "confirm" }]);
    expect(removalStep(sending, { type: "confirm" })).toBe(sending);
    expect(removalStep(sending, { type: "ask" })).toBe(sending);
    expect(removalStep(sending, { type: "cancel" })).toBe(sending);
    expect(removalStep(sending, { type: "type", reason: "other" })).toBe(sending);
  });

  it("shows a refusal and keeps the reason, so trying again needs no retyping", () => {
    const s = run([
      { type: "ask" },
      { type: "type", reason: "r" },
      { type: "confirm" },
      { type: "failed", error: "1 of these entries cannot be removed: JE-1 (ticked)" },
    ]);
    expect(s).toEqual({
      step: "confirm",
      reason: "r",
      problem: null,
      error: "1 of these entries cannot be removed: JE-1 (ticked)",
    });
    // A second try drops the old refusal.
    expect(removalStep(s, { type: "confirm" })).toEqual({ step: "removing", reason: "r" });
  });

  it("goes back to the plain button when done, or on Cancel", () => {
    expect(run([{ type: "ask" }, { type: "type", reason: "r" }, { type: "confirm" }, { type: "done" }])).toEqual(
      REMOVAL_IDLE,
    );
    expect(run([{ type: "ask" }, { type: "type", reason: "r" }, { type: "cancel" }])).toEqual(REMOVAL_IDLE);
  });

  it("ignores events the state does not expect", () => {
    expect(removalStep(REMOVAL_IDLE, { type: "confirm" })).toBe(REMOVAL_IDLE);
    expect(removalStep(REMOVAL_IDLE, { type: "done" })).toBe(REMOVAL_IDLE);
    expect(removalStep(REMOVAL_IDLE, { type: "failed", error: "x" })).toBe(REMOVAL_IDLE);
    expect(removalStep(REMOVAL_IDLE, { type: "type", reason: "x" })).toBe(REMOVAL_IDLE);
    const asking = run([{ type: "ask" }]);
    expect(removalStep(asking, { type: "ask" })).toBe(asking);
    expect(removalStep(asking, { type: "done" })).toBe(asking);
  });
});

describe("the removal's words", () => {
  const card = ghostCard(group(), fmt);

  it("reads Remove, then Confirm, with the number of entries", () => {
    expect(removalLabel(REMOVAL_IDLE, card)).toBe("Remove these 3 entries");
    expect(removalLabel(run([{ type: "ask" }]), card)).toBe("Confirm — remove all 3");
    expect(removalLabel({ step: "removing", reason: "r" }, card)).toBe("Confirm — remove all 3");
  });

  it("toasts the number the server removed", () => {
    expect(card.removedMessage(3)).toBe("3 entries removed. They were balances, not payments.");
  });

  it("names the quiet line and the blockers heading as the screen shows them", () => {
    expect(CHECKS_FAILED).toBe("Checks could not be run");
    expect(BLOCKERS_HEADING).toBe("These cannot be removed here:");
  });
});

describe("canOfferRemoval", () => {
  it("offers the button only to people who can write, and only when nothing stands in the way", () => {
    expect(canOfferRemoval(true, [])).toBe(true);
    expect(canOfferRemoval(false, [])).toBe(false);
    expect(canOfferRemoval(true, [{ entryId: "e1", entryNumber: "JE-1", reason: "ticked" }])).toBe(false);
  });
});

describe("withoutGroup", () => {
  it("drops the removed payee as the server matches it, ignoring case and spaces", () => {
    const ghosts = [group({ payee: "Sample Payroll Co" }), group({ payee: "Other Payee" })];
    expect(withoutGroup(ghosts, "  sample payroll co ").map((g) => g.payee)).toEqual(["Other Payee"]);
  });

  it("matches a blank payee to (no name)", () => {
    expect(withoutGroup([group({ payee: "(no name)" })], "")).toEqual([]);
  });
});

describe("entry links and coded-to", () => {
  it("opens an entry in Journal", () => {
    expect(entryHref("abc-123")).toBe("/journal?entry=abc-123");
  });

  it("lists the other accounts, or a dash when there are none", () => {
    expect(codedToText(["6000 Payroll", "2100 Payroll Liabilities"])).toBe("6000 Payroll, 2100 Payroll Liabilities");
    expect(codedToText([])).toBe("—");
  });
});

describe("the screen's sources", () => {
  const dir = join(process.cwd(), "app", "(app)", "banking", "reconcile");
  const read = (file: string) => readFileSync(join(dir, file), "utf8");

  it("keeps the chosen account in the address without a server request", () => {
    const list = read("ReconcileListClient.tsx");
    expect(list).toContain('useSearchParams().get("account")');
    expect(list).toContain("window.history.replaceState(null, \"\", reconcileHref(id))");
  });

  it("wraps the outstanding payments in the frame the phone rule holds open", () => {
    expect(read("BelowZeroCard.tsx")).toContain("<div className={styles.outstanding}>");
    expect(read("BalanceGroupCard.tsx")).toContain("className={styles.workings}");
  });

  it("draws the cards' tables through DataTable, never Ant Design's Table", () => {
    for (const file of ["BalanceGroupCard.tsx", "BelowZeroCard.tsx", "StatementAlertsPanel.tsx"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/<Table(?!\w)/);
      expect(source, file).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/reconcile-alerts-screen.test.ts
```

Expected: FAIL — `lib/domain/reconcile-alerts-screen.ts` and `app/(app)/banking/reconcile/alert-columns.ts` do not exist yet.

- [ ] **Step 3: Create `ctyhp-accounting/lib/domain/reconcile-alerts-screen.ts`** with exactly this content:

```ts
/**
 * The Reconcile start screen's statement alerts: the parts that are not
 * drawing.
 *
 * Which bank account the screen shows, the two clicks and the reason that
 * remove a flagged group, and the small pieces of wording the cards share.
 * The detectors and the cards' sentences are in `statement-alerts.ts`; this
 * module only decides what the screen does with them. It reads nothing and
 * imports no service, so the screen's behaviour is tested without a browser.
 */

import { payeeKeyOf } from "@/lib/domain/statement-alerts";

/** The longest reason the server takes (`balanceGroupRemoveSchema`). */
export const REASON_MAX = 300;

/** The same words the server answers with, so the screen and the action never disagree. */
export const REASON_REQUIRED = "A reason is required";
export const REASON_TOO_LONG = `Keep the reason to ${REASON_MAX} characters or fewer`;

/** What the panel says, quietly, when the checks could not be read. */
export const CHECKS_FAILED = "Checks could not be run";

/** The heading over the entries that stop a flagged group being removed here. */
export const BLOCKERS_HEADING = "These cannot be removed here:";

/**
 * The bank account the screen shows: the one in the address when it is one of
 * this company's, otherwise the first. An id that is not one of them — a link
 * from another company, a typo, an account since removed — falls back without
 * saying anything, because the screen still works.
 */
export function chosenBankId(
  banks: readonly { id: string }[],
  requested: string | null | undefined,
): string | undefined {
  if (requested && banks.some((b) => b.id === requested)) return requested;
  return banks[0]?.id;
}

/** Where an entry opens in full. */
export function entryHref(entryId: string): string {
  return `/journal?entry=${encodeURIComponent(entryId)}`;
}

/** The other accounts on an entry, as one line; an em dash when it has none. */
export function codedToText(codedTo: readonly string[]): string {
  return codedTo.length > 0 ? codedTo.join(", ") : "—";
}

/** Why a reason cannot be sent, or null when it can. Trimmed, as the server trims it. */
export function reasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed === "") return REASON_REQUIRED;
  if (trimmed.length > REASON_MAX) return REASON_TOO_LONG;
  return null;
}

/** Whether a person is offered the button at all: they can write, and nothing in the group stands in the way. */
export function canOfferRemoval(canWrite: boolean, blockers: readonly unknown[]): boolean {
  return canWrite && blockers.length === 0;
}

/* ----------------------------------------------------- the two-click removal */

/**
 * Where a removal stands.
 *
 * `idle`: the button reads "Remove these N entries".
 * `confirm`: it reads "Confirm — remove all N", and a reason is asked for.
 *   `problem` is the reason's fault after a click that could not send;
 *   `error` is what the server said when it refused.
 * `removing`: the request is out. Nothing else is sent until it answers.
 */
export type RemovalState =
  | { step: "idle" }
  | { step: "confirm"; reason: string; problem: string | null; error: string | null }
  | { step: "removing"; reason: string };

export type RemovalEvent =
  /** The first click. */
  | { type: "ask" }
  | { type: "type"; reason: string }
  | { type: "cancel" }
  /** The second click. */
  | { type: "confirm" }
  /** The server refused; its words are shown in the card. */
  | { type: "failed"; error: string }
  | { type: "done" };

export const REMOVAL_IDLE: RemovalState = { step: "idle" };

/**
 * The next state of a removal.
 *
 * A second click while a request is out does nothing, which is what stops a
 * double submit; so does a click in any state that does not expect it. A
 * click with no reason stays where it is and says why. A refusal keeps the
 * reason typed, so trying again does not mean typing it again.
 */
export function removalStep(state: RemovalState, event: RemovalEvent): RemovalState {
  switch (event.type) {
    case "ask":
      return state.step === "idle" ? { step: "confirm", reason: "", problem: null, error: null } : state;
    case "type":
      return state.step === "confirm" ? { ...state, reason: event.reason, problem: null } : state;
    case "cancel":
      return state.step === "confirm" ? REMOVAL_IDLE : state;
    case "confirm": {
      if (state.step !== "confirm") return state;
      const problem = reasonProblem(state.reason);
      if (problem) return { ...state, problem };
      return { step: "removing", reason: state.reason.trim() };
    }
    case "failed":
      return state.step === "removing"
        ? { step: "confirm", reason: state.reason, problem: null, error: event.error }
        : state;
    case "done":
      return state.step === "removing" ? REMOVAL_IDLE : state;
  }
}

/** The removal button's words: "Remove these N entries" until the first click, then "Confirm — remove all N". */
export function removalLabel(state: RemovalState, labels: { removeLabel: string; confirmLabel: string }): string {
  return state.step === "idle" ? labels.removeLabel : labels.confirmLabel;
}

/** A view without one group, by payee as the server matches it: what the card shows the moment a removal succeeds. */
export function withoutGroup<G extends { payee: string }>(ghosts: readonly G[], payee: string): G[] {
  const key = payeeKeyOf(payee);
  return ghosts.filter((g) => payeeKeyOf(g.payee) !== key);
}
```

- [ ] **Step 4: Create `ctyhp-accounting/app/(app)/banking/reconcile/alert-columns.ts`** with exactly this content:

```ts
import { COLUMN, TABLE_BOX_AT_1280 } from "@/lib/design/table-metrics";

/**
 * How wide the statement-alert cards' tables are allowed to be.
 *
 * Both tables sit inside an amber card, beside its icon, inside an inset
 * panel, so their box is narrower than the page's. The figures here are the
 * ones `statement-alerts.module.css` draws with; change one and change the
 * other, and `tests/unit/reconcile-alerts-screen.test.ts` adds them up.
 */
export const ALERT_CARD = {
  /** The card's border on the right, and the inset panel's on both sides. */
  border: 1 + 2,
  /** The amber rule down the card's left edge. */
  accent: 4,
  /** Padding inside the card, each side. */
  paddingX: 20,
  /** The icon's column and the gap after it. */
  gutter: 32 + 16,
} as const;

/** The width a card's table has at the narrowest window the design supports. */
export const ALERT_TABLE_BOX =
  TABLE_BOX_AT_1280 - ALERT_CARD.border - ALERT_CARD.accent - 2 * ALERT_CARD.paddingX - ALERT_CARD.gutter;

/** A date written "Sep 26, 2026", which is wider than the 2026-09-26 that COLUMN.DATE measures. */
const SHORT_DATE = 112;

/** The workings of a balance posted as payments. Coded to carries no width and takes what is left. */
export const WORKINGS_WIDTH = {
  date: SHORT_DATE,
  postedAs: COLUMN.MONEY_WIDE,
  /** "This account on that date": a balance, under a heading that wraps to two lines. */
  balance: 176,
  difference: COLUMN.MONEY,
} as const;
export const WORKINGS_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

/** The largest payments not yet on a statement. Name and Coded to carry no width. */
export const OUTSTANDING_WIDTH = {
  date: SHORT_DATE,
  amount: COLUMN.MONEY_WIDE,
} as const;
export const OUTSTANDING_ELASTIC_FLOOR = 2 * COLUMN.TEXT_MIN;

/**
 * The narrowest each table is drawn on a phone.
 *
 * In a phone's box the declared widths can still fit and leave the elastic
 * columns nothing — Name and Coded to came out as "E…" and "6…". Under 640px
 * the stylesheet holds each table to its declared widths plus its floors, and
 * the table scrolls inside the card instead.
 */
export const WORKINGS_MIN_WIDTH =
  WORKINGS_WIDTH.date + WORKINGS_WIDTH.postedAs + WORKINGS_WIDTH.balance + WORKINGS_WIDTH.difference + WORKINGS_ELASTIC_FLOOR;
export const OUTSTANDING_MIN_WIDTH = OUTSTANDING_WIDTH.date + OUTSTANDING_WIDTH.amount + OUTSTANDING_ELASTIC_FLOOR;
```

- [ ] **Step 5: Create `ctyhp-accounting/app/(app)/banking/reconcile/statement-alerts.module.css`** with exactly this content:

```css
/*
 * The statement-alert cards on the Reconcile start screen: the prototype's
 * amber .gh-card (p45), in OneBook's tokens so the dark theme follows.
 *
 * The padding, the accent and the icon's column are measured in
 * alert-columns.ts, which is how the tables inside are proved to fit. Change
 * one here and change it there.
 */

.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  column-gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--ob-feedback-cautionBorder);
  border-left: 4px solid var(--ob-intent-warning);
  border-radius: 10px;
  background: var(--ob-feedback-cautionBg);
}

.icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--ob-feedback-cautionBorder);
  background: var(--ob-surface-card);
  color: var(--ob-intent-warning);
  font-size: 16px;
}

/* Everything beside the icon. min-width: 0 lets a table inside shrink to its box. */
.main {
  min-width: 0;
}

.title {
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 1.45;
  font-weight: 600;
  color: var(--ob-text-heading);
}

.body {
  margin: 6px 0 0;
  max-width: 82ch;
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--ob-text-body);
}

.body strong {
  font-weight: 650;
  color: var(--ob-text-heading);
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin-top: 14px;
}

/* The removal keeps to the right of the row, and wraps under it on a narrow screen. */
.removal {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

/* Named under .removal so it outranks Ant Design's own `.ant-input { width: 100% }`. */
.removal .reason {
  flex: 0 1 320px;
  width: 320px;
  max-width: 100%;
}

.problem {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--ob-intent-danger);
  text-align: right;
}

.refusal {
  margin-top: 12px;
}

.workings {
  margin-top: 14px;
}

.listHeading {
  margin: 14px 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ob-text-strong);
}

.footnote {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--ob-text-secondary);
}

.blockers {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px dashed var(--ob-feedback-cautionBorder);
  border-radius: 8px;
  background: var(--ob-surface-card);
}

.blockersHeading {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ob-text-heading);
}

.blockers ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ob-text-body);
}

.blockerReason {
  color: var(--ob-text-secondary);
}

/* A link that opens an entry beside the card rather than leaving the screen. */
.entryLink {
  appearance: none;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--ob-intent-primary);
  cursor: pointer;
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.entryLink:hover {
  text-decoration: underline;
}

.entryLink:focus-visible {
  outline: 2px solid var(--ob-accent-ring);
  outline-offset: 2px;
  border-radius: 2px;
}

.money {
  font-variant-numeric: tabular-nums;
}

.negative {
  color: var(--ob-money-negative);
  font-variant-numeric: tabular-nums;
}

.coded {
  font-size: 12.5px;
  color: var(--ob-text-strong);
}

.quiet {
  margin: 0;
  font-size: 12.5px;
  color: var(--ob-text-secondary);
}

.retry {
  appearance: none;
  margin-left: 6px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--ob-intent-primary);
  cursor: pointer;
}

.retry:hover {
  text-decoration: underline;
}

@media (max-width: 640px) {
  .card {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 10px;
    padding: 14px 16px;
  }

  .removal {
    justify-content: flex-start;
    margin-left: 0;
  }

  .problem {
    text-align: left;
  }

  /* WORKINGS_MIN_WIDTH and OUTSTANDING_MIN_WIDTH in alert-columns.ts. */
  .workings :global(.ant-table-content) > table {
    min-width: 728px;
  }

  .outstanding :global(.ant-table-content) > table {
    min-width: 636px;
  }
}
```

- [ ] **Step 6: Create `ctyhp-accounting/app/(app)/banking/reconcile/alert-parts.tsx`** with exactly this content:

```tsx
"use client";
import type { ReactNode } from "react";
import { WarningOutlined } from "@ant-design/icons";
import type { Segment } from "@/lib/domain/statement-alerts";
import styles from "./statement-alerts.module.css";

/**
 * A sentence from the copy builders, with its payee and figures set in bold
 * and the word Balance in italics. The builders hand over the runs already
 * cut, so nothing here parses text.
 */
export function Segments({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        let node: ReactNode = s.text;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong>{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

/**
 * Opens an entry in the side sheet, so the card and its workings stay where
 * they are. The sheet's own footer opens the entry in Journal.
 */
export function EntryLink({
  entryNumber,
  onOpen,
  children,
}: {
  entryNumber: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.entryLink}
      onClick={onOpen}
      title={entryNumber ? `Open entry ${entryNumber}` : "Open this entry"}
    >
      {children}
    </button>
  );
}

/** The warning mark in the card's left column. */
export function AlertIcon() {
  return (
    <span className={styles.icon} aria-hidden="true">
      <WarningOutlined />
    </span>
  );
}
```

- [ ] **Step 7: Create `ctyhp-accounting/app/(app)/banking/reconcile/BelowZeroCard.tsx`** with exactly this content:

```tsx
"use client";
import { useId } from "react";
import type { ColumnsType } from "antd/es/table";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { shortDate } from "@/lib/domain/report-presets";
import { negativeCard, type CopyFormat, type NegativeWatch, type OutstandingPayment } from "@/lib/domain/statement-alerts";
import { codedToText } from "@/lib/domain/reconcile-alerts-screen";
import { OUTSTANDING_WIDTH } from "./alert-columns";
import { AlertIcon, EntryLink, Segments } from "./alert-parts";
import styles from "./statement-alerts.module.css";

interface Props {
  accountName: string;
  watch: NegativeWatch;
  fmt: CopyFormat;
  onOpenEntry: (entryId: string) => void;
}

/**
 * "{Account} reads below zero" (the prototype's negative panel, p45): the last
 * figure somebody agreed, how far under it has gone since, and the largest
 * payments no statement has shown yet, which is where an entry that is not a
 * payment usually hides.
 */
export default function BelowZeroCard({ accountName, watch, fmt, onOpenEntry }: Props) {
  const card = negativeCard(accountName, watch, fmt);
  const titleId = useId();
  const [dateTitle, nameTitle, amountTitle, codedTitle] = card.listColumns;

  const columns: ColumnsType<OutstandingPayment> = [
    {
      title: dateTitle,
      key: "date",
      width: OUTSTANDING_WIDTH.date,
      render: (_, row) => (
        <EntryLink entryNumber={row.entryNumber} onOpen={() => onOpenEntry(row.entryId)}>
          {shortDate(row.date)}
        </EntryLink>
      ),
    },
    flexColumn<OutstandingPayment>({
      title: nameTitle,
      key: "name",
      render: (_, row) => <span title={row.name}>{row.name}</span>,
    }),
    {
      title: amountTitle,
      key: "amount",
      width: OUTSTANDING_WIDTH.amount,
      align: "right",
      render: (_, row) => <span className={styles.negative}>{fmt.money(row.amountMinor)}</span>,
    },
    flexColumn<OutstandingPayment>({
      title: codedTitle,
      key: "coded",
      render: (_, row) => {
        const text = codedToText(row.codedTo);
        return (
          <span className={styles.coded} title={text}>
            {text}
          </span>
        );
      },
    }),
  ];

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <AlertIcon />
      <div className={styles.main}>
        <h3 id={titleId} className={styles.title}>
          {card.title}
        </h3>
        <p className={styles.body}>
          <Segments segments={card.body} />
        </p>
        {card.listHeading ? (
          <>
            <p className={styles.listHeading}>{card.listHeading}</p>
            <div className={styles.outstanding}>
              <DataTable<OutstandingPayment>
                rowKey="lineId"
                rows={watch.outstanding}
                pagination={false}
                columns={columns}
              />
            </div>
          </>
        ) : null}
        <p className={styles.footnote}>{card.footer}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/banking/reconcile/BalanceGroupCard.tsx`** with exactly this content:

```tsx
"use client";
import { useId, useRef, useState } from "react";
import { Alert, App, Button, Input, type InputRef } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { shortDate } from "@/lib/domain/report-presets";
import { ghostCard, type CopyFormat, type GhostRow } from "@/lib/domain/statement-alerts";
import {
  BLOCKERS_HEADING,
  REASON_MAX,
  REMOVAL_IDLE,
  canOfferRemoval,
  codedToText,
  removalLabel,
  removalStep,
  type RemovalEvent,
  type RemovalState,
} from "@/lib/domain/reconcile-alerts-screen";
import { removeBalanceGroupAction, type GhostGroupView } from "./actions";
import { WORKINGS_ELASTIC_FLOOR, WORKINGS_WIDTH } from "./alert-columns";
import { AlertIcon, EntryLink, Segments } from "./alert-parts";
import styles from "./statement-alerts.module.css";

interface Props {
  group: GhostGroupView;
  bankAccountId: string;
  canWrite: boolean;
  fmt: CopyFormat;
  onOpenEntry: (entryId: string) => void;
  /** The group is gone from the books: the toast has been shown, the screen reads again. */
  onRemoved: (payee: string) => void;
  /** The server no longer finds the group; the screen reads again to catch up. */
  onGone: () => void;
}

const UNEXPECTED = "The entries could not be removed. Try again.";

/**
 * "N entries here look like the statement's balance, not payments" (the
 * prototype's ghost panel, p45): what the run is, the workings that prove it,
 * and the removal.
 *
 * The removal sends the account and the payee, never a list of entries: the
 * server finds the group again from the books as they are now, and either
 * removes every entry in it or none.
 */
export default function BalanceGroupCard({ group, bankAccountId, canWrite, fmt, onOpenEntry, onRemoved, onGone }: Props) {
  const { message } = App.useApp();
  const card = ghostCard(group, fmt);
  const titleId = useId();
  const workingsId = useId();
  const [open, setOpen] = useState(false);
  const [removal, setRemoval] = useState<RemovalState>(REMOVAL_IDLE);
  // Set the moment a request leaves and cleared when it answers: two clicks
  // inside one render would otherwise both see the confirm state.
  const sending = useRef(false);
  const reasonRef = useRef<InputRef>(null);

  const dispatch = (event: RemovalEvent) => setRemoval((s) => removalStep(s, event));
  const offer = canOfferRemoval(canWrite, group.blockers);

  async function confirm() {
    if (sending.current) return;
    const next = removalStep(removal, { type: "confirm" });
    setRemoval(next);
    if (next.step !== "removing") {
      reasonRef.current?.focus();
      return;
    }
    sending.current = true;
    try {
      const result = await removeBalanceGroupAction({ bankAccountId, payee: group.payee, reason: next.reason });
      if (result.ok && result.data) {
        setRemoval((s) => removalStep(s, { type: "done" }));
        message.success(card.removedMessage(result.data.removed));
        onRemoved(group.payee);
      } else {
        const error = result.error ?? UNEXPECTED;
        setRemoval((s) => removalStep(s, { type: "failed", error }));
        if (error === card.goneMessage) onGone();
      }
    } catch {
      setRemoval((s) => removalStep(s, { type: "failed", error: UNEXPECTED }));
    } finally {
      sending.current = false;
    }
  }

  const [dateTitle, postedTitle, balanceTitle, differenceTitle, codedTitle] = card.workingsColumns;
  const columns: ColumnsType<GhostRow> = [
    {
      title: dateTitle,
      key: "date",
      width: WORKINGS_WIDTH.date,
      render: (_, row) => (
        <EntryLink entryNumber={row.entryNumber} onOpen={() => onOpenEntry(row.entryId)}>
          {shortDate(row.date)}
        </EntryLink>
      ),
    },
    {
      title: postedTitle,
      key: "posted",
      width: WORKINGS_WIDTH.postedAs,
      align: "right",
      render: (_, row) => (
        <span className={row.amountMinor < 0 ? styles.negative : styles.money}>{fmt.money(row.amountMinor)}</span>
      ),
    },
    {
      title: balanceTitle,
      key: "balance",
      width: WORKINGS_WIDTH.balance,
      align: "right",
      render: (_, row) => <span className={styles.money}>{fmt.money(row.balanceMinor)}</span>,
    },
    {
      title: differenceTitle,
      key: "difference",
      width: WORKINGS_WIDTH.difference,
      align: "right",
      render: (_, row) => <span className={styles.money}>{card.difference(row.differenceMinor)}</span>,
    },
    flexColumn<GhostRow>({
      title: codedTitle,
      key: "coded",
      floor: WORKINGS_ELASTIC_FLOOR,
      render: (_, row) => {
        const text = codedToText(row.codedTo);
        return (
          <span className={styles.coded} title={text}>
            {text}
          </span>
        );
      },
    }),
  ];

  const asking = removal.step !== "idle";
  const problem = removal.step === "confirm" ? removal.problem : null;
  const refusal = removal.step === "confirm" ? removal.error : null;

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <AlertIcon />
      <div className={styles.main}>
        <h3 id={titleId} className={styles.title}>
          {card.title}
        </h3>
        <p className={styles.body}>
          <Segments segments={card.body} />
        </p>

        {canWrite && group.blockers.length > 0 ? (
          <div className={styles.blockers}>
            <p className={styles.blockersHeading}>{BLOCKERS_HEADING}</p>
            <ul>
              {group.blockers.map((b) => (
                <li key={b.entryId}>
                  <EntryLink entryNumber={b.entryNumber} onOpen={() => onOpenEntry(b.entryId)}>
                    {b.entryNumber || "Entry"}
                  </EntryLink>
                  {/* The reason is a predicate: "JE-0042 is dated Sep 30, 2026, in a closed period; …". */}
                  <span className={styles.blockerReason}> {b.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={styles.actions}>
          <Button
            icon={open ? <UpOutlined /> : <DownOutlined />}
            aria-expanded={open}
            aria-controls={workingsId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? card.hideWorkings : card.showWorkings}
          </Button>
          {offer ? (
            <div className={styles.removal}>
              {asking ? (
                <Input
                  ref={reasonRef}
                  className={styles.reason}
                  autoFocus
                  placeholder="Reason (required)"
                  aria-label="Reason for removing these entries"
                  aria-invalid={problem ? true : undefined}
                  maxLength={REASON_MAX}
                  value={removal.reason}
                  status={problem ? "error" : undefined}
                  disabled={removal.step === "removing"}
                  onChange={(e) => dispatch({ type: "type", reason: e.target.value })}
                  onPressEnter={() => void confirm()}
                />
              ) : null}
              <Button
                danger
                type={asking ? "primary" : "default"}
                icon={<DeleteOutlined />}
                loading={removal.step === "removing"}
                onClick={asking ? () => void confirm() : () => dispatch({ type: "ask" })}
              >
                {removalLabel(removal, card)}
              </Button>
              {asking ? (
                <Button onClick={() => dispatch({ type: "cancel" })} disabled={removal.step === "removing"}>
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {problem ? (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        ) : null}
        {refusal ? <Alert className={styles.refusal} type="error" showIcon title={refusal} /> : null}

        {open ? (
          <div id={workingsId} className={styles.workings}>
            <DataTable<GhostRow>
              rowKey="lineId"
              rows={group.rows}
              pagination={{ hideOnSinglePage: true }}
              columns={columns}
            />
            <p className={styles.footnote}>{card.workingsFootnote}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/banking/reconcile/StatementAlertsPanel.tsx`** with exactly this content:

```tsx
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EntryDetailDrawer from "@/components/reports/EntryDetailDrawer";
import { formatMoney } from "@/lib/format";
import { payeeKeyOf, type CopyFormat } from "@/lib/domain/statement-alerts";
import { CHECKS_FAILED, withoutGroup } from "@/lib/domain/reconcile-alerts-screen";
import { statementAlertsAction, type StatementAlertsView } from "./actions";
import BalanceGroupCard from "./BalanceGroupCard";
import BelowZeroCard from "./BelowZeroCard";
import styles from "./statement-alerts.module.css";

interface Props {
  bankAccountId: string;
  /** The ledger account's name, as the Exceptions report and the Balance Sheet call it. */
  accountName: string;
  canWrite: boolean;
  baseCurrency: string;
  baseDecimals: number;
  /** A group was removed: the reconciliations list reads again. */
  onRemoved: () => void;
}

/** One answer, for the account it was asked about. */
type Read = { bankAccountId: string; view: StatementAlertsView | null };

/**
 * The two statement alerts for the account chosen on the Reconcile start
 * screen, above its reconciliations.
 *
 * Read after the page has drawn, so a long ledger never holds the page up.
 * While the read is out the panel shows nothing: a check still running has
 * found nothing, which is not the same as finding the account clear, and a
 * card that flashed up and vanished would read as an alarm. A read that fails
 * says so in one quiet line.
 *
 * An answer is kept only for the account it was asked about, and only when it
 * is the latest asked: switch accounts quickly and an earlier, slower answer
 * is dropped rather than drawn under the wrong account's name.
 */
export default function StatementAlertsPanel({
  bankAccountId,
  accountName,
  canWrite,
  baseCurrency,
  baseDecimals,
  onRemoved,
}: Props) {
  const [read, setRead] = useState<Read | null>(null);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const latest = useRef(0);

  const ask = useCallback((id: string) => {
    const ticket = ++latest.current;
    void statementAlertsAction(id).then(
      (result) => {
        if (latest.current !== ticket) return;
        setRead({ bankAccountId: id, view: result.ok && result.data ? result.data : null });
      },
      () => {
        if (latest.current === ticket) setRead({ bankAccountId: id, view: null });
      },
    );
  }, []);

  useEffect(() => {
    ask(bankAccountId);
  }, [ask, bankAccountId]);

  const fmt = useMemo<CopyFormat>(
    () => ({ money: (minor) => formatMoney(minor, baseCurrency, baseDecimals) }),
    [baseCurrency, baseDecimals],
  );

  const current = read?.bankAccountId === bankAccountId ? read : null;
  if (!current) return null;

  if (!current.view) {
    return (
      <p className={styles.quiet}>
        {CHECKS_FAILED}.
        <button
          type="button"
          className={styles.retry}
          onClick={() => {
            setRead(null);
            ask(bankAccountId);
          }}
        >
          Try again
        </button>
      </p>
    );
  }

  const { ghosts, negative } = current.view;
  if (!negative && ghosts.length === 0) return null;

  const removed = (payee: string) => {
    // The card goes at once; the read that follows confirms it, and redraws
    // the below-zero card, whose figures the removal has changed.
    setRead((r) =>
      r?.bankAccountId === bankAccountId && r.view
        ? { ...r, view: { ...r.view, ghosts: withoutGroup(r.view.ghosts, payee) } }
        : r,
    );
    onRemoved();
    ask(bankAccountId);
  };

  return (
    <div className={styles.stack}>
      {negative ? (
        <BelowZeroCard accountName={accountName} watch={negative} fmt={fmt} onOpenEntry={setOpenEntry} />
      ) : null}
      {ghosts.map((group) => (
        <BalanceGroupCard
          key={`${bankAccountId}:${payeeKeyOf(group.payee)}`}
          group={group}
          bankAccountId={bankAccountId}
          canWrite={canWrite}
          fmt={fmt}
          onOpenEntry={setOpenEntry}
          onRemoved={removed}
          onGone={() => ask(bankAccountId)}
        />
      ))}
      <EntryDetailDrawer entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </div>
  );
}
```

- [ ] **Step 10: Replace the whole of `ctyhp-accounting/app/(app)/banking/reconcile/ReconcileListClient.tsx`** (most of it changes) with exactly this content:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { reconcileHref } from "@/lib/domain/statement-alerts";
import { chosenBankId } from "@/lib/domain/reconcile-alerts-screen";
import { createReconciliationAction, listReconciliationsAction } from "./actions";
import StatementAlertsPanel from "./StatementAlertsPanel";
import type { StatementReconciliationRow } from "@/lib/db/types";

interface Bank {
  id: string;
  label: string;
  /** The ledger account's name, which the statement alerts call the account by. */
  name: string;
}
interface Props {
  canWrite: boolean;
  banks: Bank[];
  baseCurrency: string;
  baseDecimals: number;
}

export default function ReconcileListClient({ canWrite, banks, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const router = useRouter();
  // The chosen account lives in the address (?account=<bank id>), so the
  // Exceptions report and the Balance Sheet can link straight to it. An id
  // that is not one of these accounts falls back to the first.
  const bankId = chosenBankId(banks, useSearchParams().get("account"));
  const bank = banks.find((b) => b.id === bankId);
  const [rows, setRows] = useState<StatementReconciliationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  // Only the latest read may draw: switch accounts quickly and a slower,
  // earlier answer would otherwise list another account's reconciliations.
  const latestLoad = useRef(0);

  const load = async (id: string | undefined) => {
    if (!id) return;
    const ticket = ++latestLoad.current;
    setLoading(true);
    const r = await listReconciliationsAction(id);
    if (latestLoad.current !== ticket) return;
    setLoading(false);
    if (r.ok && r.data) setRows(r.data);
    else message.error(r.error ?? "Failed to load");
  };

  const choose = (id: string) => {
    // history.replaceState, as Chart of Accounts does: Next.js carries it into
    // useSearchParams, where the account is read, without a server request.
    window.history.replaceState(null, "", reconcileHref(id));
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
          aria-label="Bank account"
          value={bankId}
          onChange={choose}
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
      {bank ? (
        <StatementAlertsPanel
          bankAccountId={bank.id}
          accountName={bank.name}
          canWrite={canWrite}
          baseCurrency={baseCurrency}
          baseDecimals={baseDecimals}
          onRemoved={() => void load(bank.id)}
        />
      ) : null}
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

- [ ] **Step 11: Edit `ctyhp-accounting/app/(app)/banking/reconcile/page.tsx`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```tsx
        canWrite={canWrite(role)}
        banks={banks.map((b) => ({ id: b.id, label: `${b.bank_name} · ${b.account_number_masked ?? ""}`.trim() }))}
        baseDecimals={base?.decimal_places ?? 2}
```

replace with:

```tsx
        canWrite={canWrite(role)}
        banks={banks.map((b) => ({
          id: b.id,
          label: `${b.bank_name} · ${b.account_number_masked ?? ""}`.trim(),
          name: b.account_name || b.bank_name,
        }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
```

- [ ] **Step 12: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/reconcile-alerts-screen.test.ts" "lib/domain/reconcile-alerts-screen.ts" "app/(app)/banking/reconcile/alert-columns.ts" "app/(app)/banking/reconcile/alert-parts.tsx" "app/(app)/banking/reconcile/BelowZeroCard.tsx" "app/(app)/banking/reconcile/BalanceGroupCard.tsx" "app/(app)/banking/reconcile/StatementAlertsPanel.tsx" "app/(app)/banking/reconcile/ReconcileListClient.tsx" "app/(app)/banking/reconcile/page.tsx"
npx vitest run tests/unit/reconcile-alerts-screen.test.ts tests/unit/rsc-antd.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/table-pagination-guard.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/design-tokens.test.ts tests/unit/navigation.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; reconcile-alerts-screen: 30 tests passing; rsc-antd (2), table-adoption (6), table-fit-contract (3), table-pagination-guard (3), no-hardcoded-color (5), design-tokens (12) and navigation (46) pass.

- [ ] **Step 13: Commit**

```bash
git add "ctyhp-accounting/tests/unit/reconcile-alerts-screen.test.ts" "ctyhp-accounting/lib/domain/reconcile-alerts-screen.ts" "ctyhp-accounting/app/(app)/banking/reconcile/alert-columns.ts" "ctyhp-accounting/app/(app)/banking/reconcile/statement-alerts.module.css" "ctyhp-accounting/app/(app)/banking/reconcile/alert-parts.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/BelowZeroCard.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/BalanceGroupCard.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/StatementAlertsPanel.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/ReconcileListClient.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/page.tsx"
git commit -m "feat(statement-alerts): Reconcile start screen cards, with safe removal"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 5: Release 1.98 and the Guide

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`
- Modify: `ctyhp-accounting/lib/domain/system-guide.ts`

**Interfaces:**
- Consumes: the screens from Tasks 3 and 4 (the notes describe them).
- Produces: release 1.98 above 1.97, dated 2026-10-10 (if main has moved past 1.97 by the time this merges, the controller renumbers it to the next free number); three Guide steps in the banking flow, before "Reconcile to a statement balance".

- [ ] **Step 1: Edit `ctyhp-accounting/lib/domain/changelog.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
export const RELEASES: Release[] = [
  {
```

replace with:

```ts
export const RELEASES: Release[] = [
  {
    version: "1.98",
    date: "2026-10-10",
    headline:
      "Reconcile spots a statement’s balance posted as payments and a bank account below zero, and removes such a run safely in one step.",
    changes: [
      {
        kind: "added",
        title: "Reconcile warns when a statement’s balance was posted as payments",
        detail:
          "Above the reconciliations, an amber card appears for the chosen account when a run of entries for one payee lands exactly on what the account itself comes to on each date — a statement’s Balance column read as amounts. Real payments do not track the balance of the account they are paid from. The card names the payee, says how many of its entries agree and what they move together, and Show me the workings lists each one beside what the account came to that day with the group taken out, and the difference. Click a date to see its entry.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "Remove these entries, all or none",
        detail:
          "Remove these N entries turns into Confirm — remove all N and asks for a reason. Each entry goes the OneBook way: one posted by hand or loaded from another program is reversed on its own date, and one coded from Bank Transactions is voided and its bank line deleted. Nothing is deleted from the ledger, every entry carries the reason, and either the whole group goes or none of it. An entry ticked on a completed reconciliation, dated in a closed period, already reversed, or belonging to a document such as an invoice, bill or payment cannot be removed here: the card lists each one with what to do instead, such as voiding the document. Needs the Post manual journals permission.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "Reconcile warns when a bank account reads below zero",
        detail:
          "A second amber card appears when the chosen account reads below zero today, or has dropped below zero since the last statement you agreed. It gives the figure that statement closed at, the lowest point since and the balance today, then the largest payments not yet on a statement, each opening its entry. An account nobody has reconciled is flagged only while it is below zero now.",
        route: "/banking/reconcile",
      },
      {
        kind: "changed",
        title: "Reconcile keeps the chosen account in the address",
        detail:
          "Choosing an account adds it to the address, so a reload, a bookmark or a link from the Exception Report or the Balance Sheet opens the same account.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "Two new checks in the Exception Report",
        detail:
          "Entries that look like a statement balance, and Bank accounts below zero since their last statement, across every bank and cash account. Each row opens Reconcile on that account. The report now runs ten checks.",
        route: "/reports/exceptions",
      },
      {
        kind: "added",
        title: "The Balance Sheet notes a bank account below zero",
        detail:
          "When a bank account reads below zero on the report’s date, an amber note under the Balance Sheet says so and links to Reconcile for that account. When some of its entries look like the account’s own balance posted as payments, the note says how many.",
        route: "/reports?report=balance",
      },
    ],
  },
  {
```

- [ ] **Step 2: Edit `ctyhp-accounting/lib/domain/system-guide.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
          "record its side there.",
      },
```

replace with:

```ts
          "record its side there.",
      },
      {
        action: "Check an account for a statement's balance posted as payments",
        control: "Show me the workings",
        route: "/banking/reconcile",
        note:
          "Choose the account at the top of Reconcile. When a run of entries for one payee lands exactly on what " +
          "the account itself comes to on each date, an amber card says they look like the statement's balance, " +
          "not payments: a statement's Balance column read as amounts, because a real payment does not track the " +
          "balance of the account it is paid from. Show me the workings lists each entry beside what the account " +
          "came to that day with the group taken out, and the difference; click a date to see the entry.",
      },
      {
        action: "Remove a balance posted as payments",
        control: "Remove these N entries",
        route: "/banking/reconcile",
        note:
          "Click it, give a reason, and click Confirm — remove all N. The whole group goes or none of it. An entry " +
          "posted by hand or loaded from another program is reversed on its own date; an entry coded from Bank " +
          "Transactions is voided and its bank line deleted. Nothing is deleted from the ledger, and every entry " +
          "carries the reason. Some entries cannot go from here, and the card lists them with what to do instead: " +
          "one ticked on a completed reconciliation (reopen it first), one dated in a closed period (reopen the " +
          "period), one already reversed, or one that belongs to a document such as an invoice, bill or payment " +
          "(void the document). Needs the Post manual journals permission.",
      },
      {
        action: "See what drags an account below zero",
        control: "Payments not yet on a statement",
        route: "/banking/reconcile",
        note:
          "When the chosen account reads below zero today, or has dropped below zero since the last statement you " +
          "agreed, an amber card gives the figure that statement closed at, the lowest point since and the balance " +
          "today. A bank would have charged for an overdraft and printed it, so what drags the account under is " +
          "usually an entry that is not a payment — a balance posted as one, or the same thing entered twice. The " +
          "card lists the largest payments not yet on a statement; reconcile the next statement and whatever the " +
          "bank has never seen is left standing on its own. An account nobody has reconciled is flagged only while " +
          "it is below zero now.",
      },
```

- [ ] **Step 3: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/changelog.ts" "lib/domain/system-guide.ts"
npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; changelog (15) and system-guide (23): 38 tests passing.

- [ ] **Step 4: Commit**

```bash
git add "ctyhp-accounting/lib/domain/changelog.ts" "ctyhp-accounting/lib/domain/system-guide.ts"
git commit -m "feat(statement-alerts): release 1.98 notes and Guide steps"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 6: Controller — whole-branch gates, verification, live check, smoke, approval

**Files:** none changed by this task (scratch scripts live outside the repo).

**Interfaces:**
- Consumes: the whole branch.

- [ ] **Step 1: The branch equals the pre-build.** `git diff prebuild/statement-alerts HEAD -- ctyhp-accounting` is empty, unless a review fix was agreed. Every commit has no Co-Authored-By trailer and no mention of Claude or AI; typographic ’ and — are unchanged.
- [ ] **Step 2: Whole-suite gates.** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run quality:budget`. Expected: tsc 0; lint 0 errors; every test file passes (load-sensitive timeouts must pass when rerun alone); build compiles; 11/11 within budget.
- [ ] **Step 3: Verification, alone** (`npm run verify:balance-entries`): 80/80 — 45 behaviour checks on the sample company, 7 structure checks on each other company, all rolled back.
- [ ] **Step 4: Live check, alone and read-only** (`tests/live/statement-alerts.live.ts`): 1/1 on six companies, every account consistent with its ledger. If a real company is flagged, tell the user the account and the count; remove nothing.
- [ ] **Step 5: Smoke and screenshots on PC-Test**, against `next start` on a free port: post an invented balance series on a sample account; see both cards, the workings, the entry side sheet, the refused empty reason and the confirm state; Exceptions' two sections and the Balance Sheet note; remove the series through the screen (one request, the toast, the cards gone); light, dark and phone width with no sideways page scroll; no console errors; staff emails blurred. Reverse the example lines afterwards so the account is back at its starting balance.
- [ ] **Step 6: Approval page** of the screenshots (light, dark, phone) for the user. Nothing is pushed before the user approves.
- [ ] **Step 7: After approval** — scan the whole diff for real client data and secrets (separate command, read before pushing), check main has not moved (renumber the release up if it has), push the branch; the user opens the PR; then CI and a read-only production check.
