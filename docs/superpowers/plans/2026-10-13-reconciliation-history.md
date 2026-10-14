# Reconciliation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release 2.03, "Reconciliation history and flow fixes". The release does four things:
- A bank account whose books came from another program can bring its history forward as reconciled, but only when the books equal the statement exactly.
- A reconciliation in progress can be discarded.
- The difference is explained in parts.
- Misread or duplicated statement lines are held back before they reach the books.

**Architecture:**
- **Database:** migration 0142 is additive. It adds `acc_reconciliation_statement_line.set_aside` and five SECURITY DEFINER functions:
  - `acc_bring_history_forward`, the one rule, which also rebases a session in progress. 0132's `acc_bring_forward_reconciliation` now calls it.
  - `acc_discard_reconciliation`;
  - `acc_reconciliation_history`;
  - `acc_set_statement_line_aside`;
  - `acc_statement_line_duplicates`.
- **Pure logic:**
  - The PDF reader keeps a check image's caption from ending the skip.
  - `reconcile-statement.ts` gains the `aside` standing, the workspace's bring-forward and discard wording.
  - `reconcile-difference.ts` explains the difference in parts.
  - `reconcile-history.ts` holds the history page's rows and advice.
  - `add-missing.ts` holds back extra and likely duplicate lines.
- **Services and actions:**
  - `lib/services/reconcile-history.ts` and `app/(app)/banking/reconcile/history-actions.ts`;
  - Add missing takes an `anyway` list;
  - the statement reads carry `set_aside` and the kept file's period.
- **Screens:**
  - the reconciliation workspace (bring forward, discard, the difference in parts, Not a transaction / Restore, the Extra tag, held-back lines with Add anyway);
  - the new `/banking/reconcile/history`;
  - a reading note in the import dialog.

**Tech Stack:**
- Next.js 16 App Router, React 19, Ant Design 6, Zod 4
- Supabase/PostgREST, one schema per company; plpgsql
- vitest

**Source of truth:**
- **Spec:** `docs/superpowers/specs/2026-10-13-reconciliation-history-design.md`, including its "Amendments from pre-building".
- **Code:** every file in this plan was first built and run on a local pre-build branch. There it passed:
  - typecheck, lint, unit tests (336 files), build and bundle budget;
  - the rolled-back verification script against the live functions (207 of 207);
  - two smokes on the sample company PC-Test against the live database, in light, dark and phone.
- **How the code is given here:**
  - New files are given whole.
  - Edits to existing files are find/replace pairs that reproduce the pre-build exactly when applied in order.
  - A file rewritten by more than half is given whole.

**Do not "improve" the given code while transcribing it.** It has been verified against the real database and in a browser. If something looks wrong, stop and report it instead of changing it.

## Global Constraints

- **Copy:**
  - US English, with names and sentences exactly as the spec gives them.
  - Keep typographic characters (’ “ ” — ✓) exactly as given. Never turn ’ into ' or — into -.
- **Money:** base-currency minor units.
- **Bringing history forward:**
  - only when the book balance through the date equals the statement's balance to the cent;
  - only for an account with no completed reconciliation;
  - it never posts an entry.
- **Dates:** in the company's time zone. Never use `new Date().toISOString()` for "today".
- **Reads:** every list read pages past PostgREST's silent 1,000-row cap, in a total order ending in a unique column.
- **Tables:**
  - New lists go through `DataTable`.
  - No `scroll={{ x }}`; columns fit the 1280 box.
  - On a phone, a wide table scrolls inside its own box, through the CSS module rule given, and the page itself never scrolls sideways.
  - No literal `pageSize` pinning.
- **JSX:** never put an HTML entity (`&apos;`, `&quot;`) right after an element.
- **Server Components:** `page.tsx` never reads Ant Design sub-components.
- **Colors:** use tokens only; no hard-coded colors (a test enforces this).
- **Migration 0142:**
  - Unqualified names, with `set search_path = public;` at the top.
  - SECURITY DEFINER with a pinned `search_path`.
  - Executable by `authenticated` and `service_role`, and revoked from `public` and `anon`.
  - Already live on all six companies, applied by the controller with the user's approval. Never run `scripts/migrate.mjs`, `provision-company`, `verify:reconciliation-history` or `verify:reconcile-from-statement` from an implementer task.
- **Database:** implementer tasks touch no database.
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

### Task 1: Migration 0142 — bring history forward, discard a session, set a statement line aside, find likely duplicates

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/reconciliation-history-migration.test.ts`
- Create: `ctyhp-accounting/supabase/migrations/0142_reconciliation_history.sql`
- Create: `ctyhp-accounting/scripts/verify-reconciliation-history.mjs`
- Modify: `ctyhp-accounting/scripts/verify-reconcile-from-statement.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes (existing): `acc_statement_reconciliation`, `acc_reconciliation_line`, `acc_reconciliation_statement_line` (0132), `acc_bank_account`, `acc_journal_line` / `acc_journal_entry`, `acc_payment` / `acc_bill_payment` references, `acc_audit_log`, `acc_company_setting_version.time_zone`, `acc_is_staff()`, `acc_current_role()`.
- Produces:
  - Column `acc_reconciliation_statement_line.set_aside boolean not null default false`.
  - `acc_bring_history_forward(p_bank_account_id uuid, p_through date, p_balance_minor bigint, p_note text) returns jsonb` — `{reconciliation_id, lines, moved, rebased_reconciliation_id}`; `acc_bring_forward_reconciliation` (0132) now calls it.
  - `acc_discard_reconciliation(p_reconciliation_id uuid, p_reason text) returns integer` (ticks removed).
  - `acc_reconciliation_history()` — one row per bank account: `bank_account_id, open_lines, first_open_date, last_open_date, last_reconciled_date, in_progress_id, in_progress_ending_date`.
  - `acc_set_statement_line_aside(p_reconciliation_id uuid, p_line_no integer, p_aside boolean) returns void`.
  - `acc_statement_line_duplicates(p_reconciliation_id uuid, p_line_nos integer[])` — `line_no, journal_line_id, entry_id, entry_number, entry_date`.
  - `npm run verify:reconciliation-history` (rolled-back checks; the controller runs it).

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/reconciliation-history-migration.test.ts`** with exactly this content:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";
import { PAIRING_WINDOW_DAYS } from "@/lib/domain/statement-pairing";

const FILE = "0142_reconciliation_history.sql";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

/** Block and line comments removed, so naming a thing in prose never reads as doing it. */
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

const raw = read(`supabase/migrations/${FILE}`);
const sql = strip(raw);
const history = functionText(sql, "acc_bring_history_forward");
const wrapper = functionText(sql, "acc_bring_forward_reconciliation");
const discard = functionText(sql, "acc_discard_reconciliation");
const listing = functionText(sql, "acc_reconciliation_history");
const aside = functionText(sql, "acc_set_statement_line_aside");
const duplicates = functionText(sql, "acc_statement_line_duplicates");
const original = functionText(strip(read("supabase/migrations/0132_reconcile_from_statement.sql")), "acc_bring_forward_reconciliation");
const reconciliationLines = (() => {
  const text = strip(read("supabase/migrations/0132_reconcile_from_statement.sql"));
  const start = text.search(/create function acc_reconciliation_lines\(/i);
  return text.slice(start, text.indexOf("$$;", text.indexOf("$$", start) + 2) + 3);
})();

const FUNCTIONS: [string, string, string][] = [
  ["acc_bring_history_forward", "uuid, date, bigint, text", history],
  ["acc_bring_forward_reconciliation", "uuid, date, bigint, text", wrapper],
  ["acc_discard_reconciliation", "uuid, text", discard],
  ["acc_reconciliation_history", "", listing],
  ["acc_set_statement_line_aside", "uuid, integer, boolean", aside],
  ["acc_statement_line_duplicates", "uuid, integer\\[\\]", duplicates],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("0142 reconciliation history: shape", () => {
  it("defines exactly the five new functions and 0132's bring-forward", () => {
    const created = [...sql.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(FUNCTIONS.map(([name]) => name).sort());
  });

  it.each(FUNCTIONS)("%s is security definer with a fixed search_path", (_name, _args, text) => {
    const header = text.slice(0, text.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("is additive and idempotent: one column if not there, functions created or replaced", () => {
    expect(sql).not.toMatch(/create (table|type|index|unique index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\bcreate function\b/i);
    expect(sql).not.toMatch(/\bdrop (table|column|function|policy|index|trigger)\b/i);
    expect(sql).not.toMatch(/alter table \w+ drop\b/i);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
  });
});

describe("0142 the new column", () => {
  it("acc_reconciliation_statement_line gains set_aside, not null and false by default", () => {
    expect(sql).toMatch(
      /alter table acc_reconciliation_statement_line\s+add column if not exists set_aside boolean not null default false;/i,
    );
  });

  it("only acc_set_statement_line_aside writes it", () => {
    const writers = [...sql.matchAll(/update acc_reconciliation_statement_line set set_aside/gi)];
    expect(writers).toHaveLength(1);
    expect(aside).toMatch(/update acc_reconciliation_statement_line set set_aside = p_aside where id = v_line\.id/i);
  });
});

describe("0142 grants", () => {
  it.each(FUNCTIONS)("%s: revoked from public and anon, executable by signed-in users and the service role", (name, args) => {
    const sig = `${name}\\(${args}\\)`;
    expect(sql).toMatch(new RegExp(`revoke all on function ${sig} from public, anon;`, "i"));
    expect(sql).toMatch(new RegExp(`grant execute on function ${sig} to authenticated, service_role;`, "i"));
  });
});

describe("0142 who may call", () => {
  it.each([
    ["acc_bring_history_forward", history],
    ["acc_bring_forward_reconciliation", wrapper],
    ["acc_discard_reconciliation", discard],
    ["acc_set_statement_line_aside", aside],
  ])("%s writes, so it requires staff before anything else", (_name, text) => {
    const body = text.slice(text.indexOf("$$"));
    expect(body).toMatch(/if not acc_is_staff\(\) then\s+raise exception 'Not authorized/i);
    expect(body.indexOf("acc_is_staff()")).toBeLessThan(body.search(/\bfrom acc_/i));
  });

  it.each([
    ["acc_reconciliation_history", listing],
    ["acc_statement_line_duplicates", duplicates],
  ])("%s reads, for staff or a viewer, and refuses anyone else (a missing role is not let through)", (_name, text) => {
    expect(text).toMatch(
      /if not \(acc_is_staff\(\) or coalesce\(acc_current_role\(\) = 'viewer', false\)\) then\s+raise exception 'Not authorized/i,
    );
    expect(text.slice(0, text.indexOf("$$"))).toMatch(/\bstable\b/i);
    expect(text).not.toMatch(/\b(insert into|update\s+\w+\s+set|delete from)\b/i);
  });
});

describe("0142 nothing posts", () => {
  it("never calls a posting function and never writes the ledger", () => {
    expect(sql).not.toMatch(/acc_post_entry/i);
    expect(sql).not.toMatch(/acc_post_manual_journal|acc_record_reconciliation_adjustment|acc_reverse_entry/i);
    expect(sql).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)\b/i);
    expect(sql).not.toMatch(/update\s+acc_journal_(entry|line)\b/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_journal_(entry|line)\b/i);
  });

  it("never touches bank lines, statement files or matches", () => {
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\s+acc_(bank_transaction|saved_report|reconciliation)\b(?!_)/i);
  });
});

describe("0142 acc_bring_history_forward", () => {
  it("returns the new session, its lines, the ticks moved and the session it rebased", () => {
    expect(history).toMatch(/returns jsonb/i);
    expect(history).toMatch(
      /jsonb_build_object\('reconciliation_id', v_id,\s*'lines', v_moved \+ v_added,\s*'moved', v_moved,\s*'rebased_reconciliation_id', v_open\.id\)/i,
    );
  });

  it("refuses a missing date or balance, and a date past the company's today", () => {
    expect(history).toMatch(/if p_through is null then\s+raise exception/i);
    expect(history).toMatch(/if p_balance_minor is null then\s+raise exception/i);
    expect(history).toMatch(/now\(\) at time zone s\.time_zone/i);
    expect(history).toMatch(/if p_through > v_today then\s+raise exception 'A bank account cannot be brought forward past today'/i);
  });

  it("locks the bank account row before reading any reconciliation", () => {
    expect(history).toMatch(/where b\.id = p_bank_account_id\s+for update of b;/i);
    expect(history.indexOf("for update of b")).toBeLessThan(history.indexOf("from acc_statement_reconciliation"));
  });

  it("refuses an account that already has a completed reconciliation", () => {
    expect(history).toMatch(
      /bank_account_id = p_bank_account_id and status = 'completed'\) then\s+raise exception 'This account already has a completed reconciliation\.'/i,
    );
  });

  it("locks the session in progress, and refuses one that ends on or before the date", () => {
    expect(history).toMatch(/status = 'in_progress'\s+for update;/i);
    expect(history).toMatch(
      /v_open\.statement_ending_date <= p_through then\s+raise exception 'Finish or discard the reconciliation in progress first\.'/i,
    );
  });

  it("refuses a mismatch with both figures, the date and the absolute amount it is out by, money formatted as 0132 formats it", () => {
    expect(history).toMatch(/if v_balance <> p_balance_minor then/i);
    expect(history).toMatch(/raise exception 'The books hold % on %; the statement shows %\. Out by %\.'/i);
    expect(history).toMatch(/to_char\(v_balance \/ 100\.0, 'FM999,999,999,990\.00'\)/i);
    expect(history).toMatch(/to_char\(p_balance_minor \/ 100\.0, 'FM999,999,999,990\.00'\)/i);
    expect(history).toMatch(/to_char\(abs\(v_balance - p_balance_minor\) \/ 100\.0, 'FM999,999,999,990\.00'\)/i);
    expect(original).toMatch(/to_char\(v_balance \/ 100\.0, 'FM999,999,999,990\.00'\)/i);
  });

  it("measures the books exactly as 0132 did: posted lines on the ledger account, signed, in the base currency", () => {
    const balance =
      /coalesce\(sum\(case when l\.debit_minor > 0 then l\.amount_base_minor else -l\.amount_base_minor end\), 0\)::bigint[\s\S]*?where l\.account_id = v_gl and e\.status = 'posted' and e\.entry_date <= p_through/i;
    expect(history).toMatch(balance);
    expect(original).toMatch(balance);
  });

  it("makes every refusal before anything is written", () => {
    const firstWrite = history.search(/insert into acc_statement_reconciliation/i);
    expect(firstWrite).toBeGreaterThan(0);
    for (const refusal of [
      "past today",
      "Bank account not found",
      "already has a completed reconciliation",
      "Finish or discard",
      "The books hold",
    ]) {
      expect(history.indexOf(refusal), refusal).toBeGreaterThan(0);
      expect(history.indexOf(refusal), refusal).toBeLessThan(firstWrite);
    }
  });

  it("creates one completed, brought-forward session that begins at 0 and ends at the statement balance", () => {
    expect(history).toMatch(
      /values \(p_bank_account_id, p_through, 0, p_balance_minor,\s*'completed', auth\.uid\(\), auth\.uid\(\), now\(\), v_note, true\)/i,
    );
  });

  it("moves the session's ticks on posted lines through the date, keeping when each was ticked", () => {
    expect(history).toMatch(/delete from acc_reconciliation_line rl[\s\S]*?rl\.reconciliation_id = v_open\.id[\s\S]*?e\.entry_date <= p_through[\s\S]*?returning rl\.journal_line_id, rl\.cleared_at/i);
    expect(history).toMatch(/insert into acc_reconciliation_line \(reconciliation_id, journal_line_id, cleared_at\)\s+select v_id, m\.journal_line_id, m\.cleared_at from moved m/i);
  });

  it("then ticks every other posted line through the date", () => {
    expect(history).toMatch(
      /insert into acc_reconciliation_line \(reconciliation_id, journal_line_id\)\s+select v_id, l\.id[\s\S]*?e\.status = 'posted' and e\.entry_date <= p_through[\s\S]*?not exists \(select 1 from acc_reconciliation_line x\s+where x\.reconciliation_id = v_id and x\.journal_line_id = l\.id\)/i,
    );
  });

  it("rebases the session in progress on the statement balance", () => {
    expect(history).toMatch(/set beginning_balance_minor = p_balance_minor, updated_at = now\(\)\s+where id = v_open\.id/i);
  });

  it("writes audit rows for the new session and the one it changed, with the account, the date, the balance and the lines", () => {
    expect(history).toMatch(/\('acc_statement_reconciliation', v_id, 'insert', auth\.uid\(\),/i);
    expect(history).toMatch(/\('acc_statement_reconciliation', v_id, 'post', auth\.uid\(\), null\)/i);
    expect(history).toMatch(/\('acc_statement_reconciliation', v_open\.id, 'update', auth\.uid\(\),/i);
    for (const key of ["bank_account_id", "account", "through", "balance_minor", "beginning_balance_minor", "lines", "moved"]) {
      expect(history).toContain(`'${key}'`);
    }
  });
});

describe("0142 acc_bring_forward_reconciliation (0132) on the shared rule", () => {
  it("keeps 0132's signature and return type", () => {
    expect(wrapper).toMatch(
      /create or replace function acc_bring_forward_reconciliation\(\s*p_bank_account_id uuid, p_through date, p_opening_minor bigint, p_note text\s*\) returns uuid/i,
    );
  });

  it("keeps its own refusal of an account with any reconciliation, word for word, after locking the account", () => {
    const message = "This bank account already has a reconciliation; only the first one can be brought forward";
    expect(original).toContain(message);
    expect(wrapper).toContain(message);
    expect(wrapper).toMatch(/from acc_statement_reconciliation where bank_account_id = p_bank_account_id\) then/i);
    expect(wrapper.indexOf("for update")).toBeLessThan(wrapper.indexOf(message));
  });

  it("then calls acc_bring_history_forward and returns the new id, measuring nothing itself", () => {
    expect(wrapper).toMatch(
      /return \(acc_bring_history_forward\(p_bank_account_id, p_through, p_opening_minor, p_note\)\s*->> 'reconciliation_id'\)::uuid;/i,
    );
    expect(wrapper.indexOf("already has a reconciliation")).toBeLessThan(wrapper.indexOf("acc_bring_history_forward("));
    expect(wrapper).not.toMatch(/sum\(|insert into/i);
  });
});

describe("0142 acc_discard_reconciliation", () => {
  it("returns the number of ticks removed", () => {
    expect(discard).toMatch(/returns integer/i);
    expect(discard).toMatch(/select count\(\*\)::integer into v_ticks\s+from acc_reconciliation_line where reconciliation_id = p_reconciliation_id/i);
    expect(discard).toMatch(/return v_ticks;/i);
  });

  it("refuses a blank reason, an unknown session, and anything not in progress", () => {
    expect(discard).toMatch(/v_reason\s+text := btrim\(coalesce\(p_reason, ''\)\)/i);
    expect(discard).toMatch(/if v_reason = '' then\s+raise exception 'A reason is required to discard a reconciliation'/i);
    expect(discard).toMatch(/where id = p_reconciliation_id for update;/i);
    expect(discard).toMatch(/raise exception 'Reconciliation not found'/i);
    expect(discard).toMatch(/if v_rec\.status <> 'in_progress' then\s+raise exception 'Only a reconciliation in progress can be discarded'/i);
  });

  it("refuses while its adjustment entry is not void, naming the entry", () => {
    expect(discard).toMatch(/select \* into v_adj from acc_journal_entry where id = v_rec\.adjustment_entry_id/i);
    expect(discard).toMatch(/if found and v_adj\.status <> 'void' then/i);
    expect(discard).toMatch(/raise exception 'This reconciliation posted an adjustment \(%\), so it cannot be discarded\.', v_adj\.entry_number/i);
  });

  it("deletes the session only, letting its ticks and statement lines go by cascade", () => {
    expect(discard).toMatch(/delete from acc_statement_reconciliation where id = p_reconciliation_id;/i);
    expect(discard.match(/delete from/gi)).toHaveLength(1);
    for (const table of ["0025_bank_reconciliation.sql", "0132_reconcile_from_statement.sql"]) {
      expect(read(`supabase/migrations/${table}`)).toMatch(
        /reconciliation_id uuid not null references acc_statement_reconciliation \(id\) on delete cascade/i,
      );
    }
  });

  it("makes every refusal before the delete", () => {
    const deleted = discard.indexOf("delete from acc_statement_reconciliation");
    for (const refusal of ["A reason is required", "Reconciliation not found", "Only a reconciliation in progress", "so it cannot be discarded"]) {
      expect(discard.indexOf(refusal), refusal).toBeLessThan(deleted);
    }
  });

  it("writes one audit row with the reason, the account, the statement ending date and the ticks, after the delete", () => {
    expect(discard.match(/insert into acc_audit_log/gi)).toHaveLength(1);
    expect(discard).toMatch(/insert into acc_audit_log \(table_name, record_id, action, actor_id, before_json\)/i);
    expect(discard).toMatch(/'acc_statement_reconciliation', p_reconciliation_id, 'delete'/i);
    for (const key of ["bank_account_id", "account", "statement_ending_date", "ticks", "reason"]) {
      expect(discard).toContain(`'${key}'`);
    }
    expect(discard.indexOf("insert into acc_audit_log")).toBeGreaterThan(discard.indexOf("delete from acc_statement_reconciliation"));
  });
});

describe("0142 acc_reconciliation_history", () => {
  it("returns the documented columns", () => {
    expect(listing).toMatch(
      /returns table \(bank_account_id uuid, open_lines integer, first_open_date date, last_open_date date,\s*last_reconciled_date date, in_progress_id uuid, in_progress_ending_date date\)/i,
    );
  });

  it("gives one row per bank account", () => {
    expect(listing).toMatch(/from acc_bank_account b\s+left join unheld u[\s\S]*?left join last_done d[\s\S]*?left join acc_statement_reconciliation ip/i);
    expect(listing).toMatch(/coalesce\(u\.n, 0\)/i);
  });

  it("counts open lines as 0133 does: posted lines that no COMPLETED reconciliation holds", () => {
    expect(listing).toMatch(/where r\.status = 'completed'/i);
    expect(listing).toMatch(/where e\.status = 'posted'/i);
    expect(listing).toMatch(/not exists \(select 1 from held h where h\.line_id = l\.id\)/i);
    expect(read("supabase/migrations/0133_bank_open_lines.sql")).toMatch(/r\.status = 'completed'/i);
  });

  it("reads the in-progress session and the last completed ending date", () => {
    expect(listing).toMatch(/max\(r\.statement_ending_date\)/i);
    expect(listing).toMatch(/ip\.bank_account_id = b\.id and ip\.status = 'in_progress'/i);
  });
});

describe("0142 acc_set_statement_line_aside", () => {
  it("is for a line that exists, in a session in progress", () => {
    expect(aside).toMatch(/returns void/i);
    expect(aside).toMatch(/if v_rec\.status <> 'in_progress' then\s+raise exception 'Reconciliation is not in progress'/i);
    expect(aside).toMatch(/where reconciliation_id = p_reconciliation_id and line_no = p_line_no/i);
    expect(aside).toMatch(/raise exception 'Statement line not found'/i);
  });

  it("leaves the paired check to the reconcile service, and says so in the header", () => {
    expect(raw).toMatch(/\(statementStandings\) and is not stored, so[\s\S]{0,120}refusal of a paired line lives in the[\s\S]{0,80}reconcile service, not here\./i);
  });

  it("writes an audit row when the mark changes, and nothing when it does not", () => {
    expect(aside).toMatch(/if v_line\.set_aside = p_aside then\s+return;/i);
    expect(aside).toMatch(/'acc_statement_reconciliation', p_reconciliation_id, 'update'/i);
    expect(aside.indexOf("insert into acc_audit_log")).toBeGreaterThan(aside.indexOf("update acc_reconciliation_statement_line"));
  });
});

describe("0142 acc_statement_line_duplicates", () => {
  it("returns the documented columns, at most 500 lines at a time", () => {
    expect(duplicates).toMatch(
      /returns table \(line_no integer, journal_line_id uuid, entry_id uuid, entry_number text, entry_date date\)/i,
    );
    expect(duplicates).toMatch(/if coalesce\(cardinality\(p_line_nos\), 0\) > 500 then\s+raise exception 'At most 500 statement lines can be checked at once'/i);
  });

  it("looks only at posted lines on the session's bank ledger account", () => {
    expect(duplicates).toMatch(/from acc_statement_reconciliation r join acc_bank_account b on b\.id = r\.bank_account_id/i);
    expect(duplicates).toMatch(/where l\.account_id = v_gl\s+and e\.status = 'posted'/i);
  });

  it("signs a book line as the pairing does, and compares it with the statement amount as written", () => {
    const signed = "(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint";
    expect(duplicates).toContain(signed);
    expect(reconciliationLines).toContain(signed);
    expect(duplicates).toMatch(/join book k on k\.b_minor = a\.ask_minor/i);
    expect(duplicates).not.toMatch(/-\s*a\.ask_minor|abs\(k\.b_minor\)|abs\(a\.ask_minor\)/i);
  });

  it("takes the book line's reference exactly as acc_reconciliation_lines does", () => {
    const reference = "coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference";
    expect(reconciliationLines).toContain(reference);
    expect(duplicates).toContain(reference);
    for (const join of [
      "left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id",
      "left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id",
    ]) {
      expect(reconciliationLines).toContain(join);
      expect(duplicates).toContain(join);
    }
  });

  it("cleans a cheque number with the pairing's own rule, and an empty one never matches", () => {
    const pairing = read("lib/domain/statement-pairing.ts");
    const rule = /export function cleanReference[\s\S]*?\.replace\(\/(\[[^\]]+\])\/g, ""\)/.exec(pairing);
    expect(rule, "cleanReference keeps its one replace").not.toBeNull();
    const cleaned = new RegExp(`regexp_replace\\([^;]*?'${escape(rule![1])}', '', 'g'\\)`, "gi");
    expect(duplicates.match(cleaned)).toHaveLength(2);
    expect(duplicates).toMatch(/\(a\.ask_ref <> '' and k\.b_ref = a\.ask_ref\)/i);
  });

  it("matches by reference or within the pairing window of days", () => {
    expect(PAIRING_WINDOW_DAYS).toBe(5);
    expect(duplicates).toMatch(new RegExp(`or abs\\(k\\.e_on - a\\.ask_on\\) <= ${PAIRING_WINDOW_DAYS}`, "i"));
  });

  it("orders by statement line, then entry date, then entry number", () => {
    expect(duplicates).toMatch(/order by a\.ask_no, k\.e_on, k\.e_number, k\.line_id;/i);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/reconciliation-history-migration.test.ts
```

Expected: FAIL — `supabase/migrations/0142_reconciliation_history.sql` does not exist yet.

- [ ] **Step 3: Create `ctyhp-accounting/supabase/migrations/0142_reconciliation_history.sql`** with exactly this content:

```sql
-- ============================================================================
-- 0142  Reconciliation history: bring it forward, discard a session, set a
--       statement line aside, and find a line the books may already hold (2.03)
--
-- A bank account whose books were loaded from another program starts its first
-- reconciliation at 0.00, with years of posted lines that no reconciliation
-- holds. Bringing the history forward signs those lines off as one completed
-- reconciliation, and only when the books prove it: the book balance through
-- the chosen date must equal, to the cent, the balance the bank's statement
-- shows on that date. Nothing is posted to make the figures agree; a mismatch
-- is refused with the amount it is out by.
--
--   acc_bring_history_forward        the rule itself. It also works while a
--                                    reconciliation is in progress, provided
--                                    that session ends after the date: its ticks
--                                    on the earlier lines move into the history,
--                                    and it then begins at the statement balance.
--   acc_bring_forward_reconciliation (0132) now calls it, so From statement
--                                    files follows the same rule. It keeps its
--                                    own extra condition: the account has no
--                                    reconciliation at all.
--   acc_discard_reconciliation       a session in progress, deleted with its
--                                    ticks and statement lines. The statement
--                                    file, the bank lines imported from it and
--                                    any entries added to the books from it all
--                                    stay. Refused while it holds an adjustment
--                                    entry that is not void, which would
--                                    otherwise point at a session that is gone.
--   acc_reconciliation_history       one row per bank account: its lines no
--                                    completed reconciliation holds, the last
--                                    completed ending date, the session in
--                                    progress. One row per account, so the API's
--                                    1,000-row cap never reaches it.
--   acc_set_statement_line_aside     marks a statement line as not a
--                                    transaction (a misread PDF row), or brings
--                                    it back. Whether a line is paired with the
--                                    books is worked out in the application
--                                    (statementStandings) and is not stored, so
--                                    the refusal of a paired line lives in the
--                                    reconcile service, not here.
--   acc_statement_line_duplicates    for statement lines about to be added to
--                                    the books, the posted lines on the account
--                                    with the same signed amount and either the
--                                    same cheque number or a date within 5 days.
--                                    A warning for the person, never a block:
--                                    two identical lines on one day can both be
--                                    real.
--
-- "Open" means what it means in acc_bank_open_lines (0133): a posted line on
-- the account's ledger account that no COMPLETED reconciliation holds. Amounts
-- are signed as the pairing signs them: a debit to the bank is money in.
--
-- Every function is security definer with its search path pinned, checks the
-- caller's role itself (staff to write, staff or viewer to read), and is
-- executable by signed-in users and the service role only. Nothing here posts
-- an entry. Additive: one column and five new functions; 0132's function is
-- replaced with the same signature and grants.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. A statement line set aside as not a transaction. Replacing a session's
--    statement (acc_recon_write_statement) writes new lines, so the marks on
--    the old ones go with them.
-- ----------------------------------------------------------------------------
alter table acc_reconciliation_statement_line
  add column if not exists set_aside boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. Bring the history forward through a date, proved by the statement's
--    balance on that date. Returns the new session, the lines it holds, how
--    many of them were moved out of the session in progress, and that
--    session's id when there is one.
-- ----------------------------------------------------------------------------
create or replace function acc_bring_history_forward(
  p_bank_account_id uuid, p_through date, p_balance_minor bigint, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_gl      uuid;
  v_account text;
  v_today   date;
  v_open    acc_statement_reconciliation;
  v_balance bigint;
  v_id      uuid;
  v_moved   integer := 0;
  v_added   integer := 0;
  v_note    text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to bring a bank account forward';
  end if;
  if p_through is null then
    raise exception 'Choose the date the history is brought forward through';
  end if;
  if p_balance_minor is null then
    raise exception 'Enter the statement balance on that date';
  end if;
  -- Today in the company's own time zone, as the screens count it.
  v_today := coalesce(
    (select (now() at time zone s.time_zone)::date
       from acc_company_setting_version s order by s.version desc limit 1),
    current_date);
  if p_through > v_today then
    raise exception 'A bank account cannot be brought forward past today';
  end if;

  -- The row lock serialises this with any reconciliation being created for the
  -- account, as in 0132: an insert into acc_statement_reconciliation holds FOR
  -- KEY SHARE on this row through its foreign key until it commits, which FOR
  -- UPDATE waits for; the checks below then see that reconciliation.
  select b.account_id, a.name into v_gl, v_account
    from acc_bank_account b join acc_account a on a.id = b.account_id
   where b.id = p_bank_account_id
     for update of b;
  if v_gl is null then
    raise exception 'Bank account not found';
  end if;
  if exists (select 1 from acc_statement_reconciliation
              where bank_account_id = p_bank_account_id and status = 'completed') then
    raise exception 'This account already has a completed reconciliation.';
  end if;

  -- The session in progress, if any, locked so no tick lands in it meanwhile.
  select * into v_open from acc_statement_reconciliation
   where bank_account_id = p_bank_account_id and status = 'in_progress'
     for update;
  if v_open.id is not null and v_open.statement_ending_date <= p_through then
    raise exception 'Finish or discard the reconciliation in progress first.';
  end if;

  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    into v_balance
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through;
  if v_balance <> p_balance_minor then
    raise exception 'The books hold % on %; the statement shows %. Out by %.',
      to_char(v_balance / 100.0, 'FM999,999,999,990.00'),
      to_char(p_through, 'Mon FMDD, YYYY'),
      to_char(p_balance_minor / 100.0, 'FM999,999,999,990.00'),
      to_char(abs(v_balance - p_balance_minor) / 100.0, 'FM999,999,999,990.00');
  end if;

  insert into acc_statement_reconciliation
    (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor,
     status, prepared_by, completed_by, completed_at, note, brought_forward)
  values (p_bank_account_id, p_through, 0, p_balance_minor,
          'completed', auth.uid(), auth.uid(), now(), v_note, true)
  returning id into v_id;

  -- The session in progress gives up its ticks on the earlier lines, keeping
  -- when each was ticked. A tick on an entry voided since is left where it is:
  -- it counts for nothing there, and in a completed session it would read as
  -- a discrepancy.
  if v_open.id is not null then
    with moved as (
      delete from acc_reconciliation_line rl
       using acc_journal_line l, acc_journal_entry e
       where rl.reconciliation_id = v_open.id
         and l.id = rl.journal_line_id
         and e.id = l.journal_entry_id
         and e.status = 'posted'
         and e.entry_date <= p_through
      returning rl.journal_line_id, rl.cleared_at
    )
    insert into acc_reconciliation_line (reconciliation_id, journal_line_id, cleared_at)
    select v_id, m.journal_line_id, m.cleared_at from moved m;
    get diagnostics v_moved = row_count;
  end if;

  -- Every other posted line through the date. No completed reconciliation
  -- exists for the account, so none of them is held elsewhere.
  insert into acc_reconciliation_line (reconciliation_id, journal_line_id)
  select v_id, l.id
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through
     and not exists (select 1 from acc_reconciliation_line x
                      where x.reconciliation_id = v_id and x.journal_line_id = l.id);
  get diagnostics v_added = row_count;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_statement_reconciliation', v_id, 'insert', auth.uid(),
          jsonb_build_object('bank_account_id', p_bank_account_id,
                             'account', v_account,
                             'brought_forward', true,
                             'through', p_through,
                             'balance_minor', p_balance_minor,
                             'lines', v_moved + v_added,
                             'moved', v_moved)),
         ('acc_statement_reconciliation', v_id, 'post', auth.uid(), null);

  if v_open.id is not null then
    update acc_statement_reconciliation
       set beginning_balance_minor = p_balance_minor, updated_at = now()
     where id = v_open.id;
    insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_statement_reconciliation', v_open.id, 'update', auth.uid(),
            jsonb_build_object('beginning_balance_minor', v_open.beginning_balance_minor),
            jsonb_build_object('bank_account_id', p_bank_account_id,
                               'account', v_account,
                               'through', p_through,
                               'beginning_balance_minor', p_balance_minor,
                               'lines', v_moved,
                               'brought_forward_id', v_id));
  end if;

  return jsonb_build_object('reconciliation_id', v_id,
                            'lines', v_moved + v_added,
                            'moved', v_moved,
                            'rebased_reconciliation_id', v_open.id);
end;
$$;
revoke all on function acc_bring_history_forward(uuid, date, bigint, text) from public, anon;
grant execute on function acc_bring_history_forward(uuid, date, bigint, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. 0132's bring-forward, on the shared rule. Same signature and grants; it
--    keeps its own condition that the account has no reconciliation at all.
-- ----------------------------------------------------------------------------
create or replace function acc_bring_forward_reconciliation(
  p_bank_account_id uuid, p_through date, p_opening_minor bigint, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to bring a bank account forward';
  end if;
  perform 1 from acc_bank_account where id = p_bank_account_id for update;
  if not found then
    raise exception 'Bank account not found';
  end if;
  if exists (select 1 from acc_statement_reconciliation where bank_account_id = p_bank_account_id) then
    raise exception 'This bank account already has a reconciliation; only the first one can be brought forward';
  end if;
  return (acc_bring_history_forward(p_bank_account_id, p_through, p_opening_minor, p_note)
            ->> 'reconciliation_id')::uuid;
end;
$$;
revoke all on function acc_bring_forward_reconciliation(uuid, date, bigint, text) from public, anon;
grant execute on function acc_bring_forward_reconciliation(uuid, date, bigint, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Discard a reconciliation in progress. Returns the number of ticks removed.
-- ----------------------------------------------------------------------------
create or replace function acc_discard_reconciliation(p_reconciliation_id uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_rec     acc_statement_reconciliation;
  v_adj     acc_journal_entry;
  v_account text;
  v_ticks   integer;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to discard a reconciliation';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to discard a reconciliation';
  end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then
    raise exception 'Reconciliation not found';
  end if;
  if v_rec.status <> 'in_progress' then
    raise exception 'Only a reconciliation in progress can be discarded';
  end if;
  if v_rec.adjustment_entry_id is not null then
    select * into v_adj from acc_journal_entry where id = v_rec.adjustment_entry_id;
    if found and v_adj.status <> 'void' then
      raise exception 'This reconciliation posted an adjustment (%), so it cannot be discarded.', v_adj.entry_number;
    end if;
  end if;

  select a.name into v_account
    from acc_bank_account b join acc_account a on a.id = b.account_id
   where b.id = v_rec.bank_account_id;
  select count(*)::integer into v_ticks
    from acc_reconciliation_line where reconciliation_id = p_reconciliation_id;

  -- Its ticks and its statement lines go with it (on delete cascade).
  delete from acc_statement_reconciliation where id = p_reconciliation_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_statement_reconciliation', p_reconciliation_id, 'delete', auth.uid(),
          jsonb_build_object('bank_account_id', v_rec.bank_account_id,
                             'account', v_account,
                             'statement_ending_date', v_rec.statement_ending_date,
                             'ticks', v_ticks,
                             'reason', v_reason));
  return v_ticks;
end;
$$;
revoke all on function acc_discard_reconciliation(uuid, text) from public, anon;
grant execute on function acc_discard_reconciliation(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Every bank account's reconciliation history, one row each. Read only.
-- ----------------------------------------------------------------------------
create or replace function acc_reconciliation_history()
returns table (bank_account_id uuid, open_lines integer, first_open_date date, last_open_date date,
               last_reconciled_date date, in_progress_id uuid, in_progress_ending_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read reconciliation history';
  end if;
  return query
  with held as (
    select rl.journal_line_id as line_id
      from acc_reconciliation_line rl
      join acc_statement_reconciliation r on r.id = rl.reconciliation_id
     where r.status = 'completed'
  ),
  unheld as (
    select l.account_id as gl_id, count(*)::integer as n,
           min(e.entry_date) as first_on, max(e.entry_date) as last_on
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id
     where e.status = 'posted'
       and l.account_id in (select b.account_id from acc_bank_account b)
       and not exists (select 1 from held h where h.line_id = l.id)
     group by l.account_id
  ),
  last_done as (
    select r.bank_account_id as bank_id, max(r.statement_ending_date) as last_on
      from acc_statement_reconciliation r
     where r.status = 'completed'
     group by r.bank_account_id
  )
  select b.id, coalesce(u.n, 0), u.first_on, u.last_on, d.last_on, ip.id, ip.statement_ending_date
    from acc_bank_account b
    left join unheld u on u.gl_id = b.account_id
    left join last_done d on d.bank_id = b.id
    left join acc_statement_reconciliation ip on ip.bank_account_id = b.id and ip.status = 'in_progress'
   order by b.created_at, b.id;
end;
$$;
revoke all on function acc_reconciliation_history() from public, anon;
grant execute on function acc_reconciliation_history() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Set a statement line aside as not a transaction (p_aside true), or bring
--    it back (false). Setting it to what it already is changes nothing.
-- ----------------------------------------------------------------------------
create or replace function acc_set_statement_line_aside(
  p_reconciliation_id uuid, p_line_no integer, p_aside boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rec  acc_statement_reconciliation;
  v_line acc_reconciliation_statement_line;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to set a statement line aside';
  end if;
  if p_aside is null then
    raise exception 'Say whether the line is set aside or brought back';
  end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then
    raise exception 'Reconciliation not found';
  end if;
  if v_rec.status <> 'in_progress' then
    raise exception 'Reconciliation is not in progress';
  end if;
  select * into v_line from acc_reconciliation_statement_line
   where reconciliation_id = p_reconciliation_id and line_no = p_line_no
     for update;
  if not found then
    raise exception 'Statement line not found';
  end if;
  if v_line.set_aside = p_aside then
    return;
  end if;

  update acc_reconciliation_statement_line set set_aside = p_aside where id = v_line.id;
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid(),
          jsonb_build_object('line_no', v_line.line_no, 'set_aside', v_line.set_aside),
          jsonb_build_object('line_no', v_line.line_no, 'txn_date', v_line.txn_date,
                             'amount_minor', v_line.amount_minor, 'set_aside', p_aside));
end;
$$;
revoke all on function acc_set_statement_line_aside(uuid, integer, boolean) from public, anon;
grant execute on function acc_set_statement_line_aside(uuid, integer, boolean) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Lines the books may already hold. For each statement line asked about,
--    the posted lines on the session's bank ledger account with the same
--    signed amount and either an equal cheque number or a date within 5 days.
--    Cheque numbers are cleaned as the pairing cleans them (cleanReference in
--    lib/domain/statement-pairing.ts: letters, digits and hyphens only), on
--    both sides; an empty one never matches. The book line's reference is the
--    one acc_reconciliation_lines gives it. Read only.
-- ----------------------------------------------------------------------------
create or replace function acc_statement_line_duplicates(p_reconciliation_id uuid, p_line_nos integer[])
returns table (line_no integer, journal_line_id uuid, entry_id uuid, entry_number text, entry_date date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_gl uuid;
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to look for duplicate lines';
  end if;
  if coalesce(cardinality(p_line_nos), 0) > 500 then
    raise exception 'At most 500 statement lines can be checked at once';
  end if;
  select b.account_id into v_gl
    from acc_statement_reconciliation r join acc_bank_account b on b.id = r.bank_account_id
   where r.id = p_reconciliation_id;
  if v_gl is null then
    raise exception 'Reconciliation not found';
  end if;

  return query
  with asked as (
    select s.line_no as ask_no, s.txn_date as ask_on, s.amount_minor as ask_minor,
           regexp_replace(coalesce(s.reference, ''), '[^0-9A-Za-z-]', '', 'g') as ask_ref
      from acc_reconciliation_statement_line s
     where s.reconciliation_id = p_reconciliation_id
       and s.line_no = any (p_line_nos)
  ),
  book as (
    select l.id as line_id, e.id as e_id, e.entry_number as e_number, e.entry_date as e_on,
           (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint as b_minor,
           regexp_replace(coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference, ''),
                          '[^0-9A-Za-z-]', '', 'g') as b_ref
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id
      left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id
      left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id
     where l.account_id = v_gl
       and e.status = 'posted'
  )
  select a.ask_no, k.line_id, k.e_id, k.e_number, k.e_on
    from asked a
    join book k on k.b_minor = a.ask_minor
   where (a.ask_ref <> '' and k.b_ref = a.ask_ref)
      or abs(k.e_on - a.ask_on) <= 5
   order by a.ask_no, k.e_on, k.e_number, k.line_id;
end;
$$;
revoke all on function acc_statement_line_duplicates(uuid, integer[]) from public, anon;
grant execute on function acc_statement_line_duplicates(uuid, integer[]) to authenticated, service_role;
```

- [ ] **Step 4: Create `ctyhp-accounting/scripts/verify-reconciliation-history.mjs`** with exactly this content:

```js
/**
 * Behavioural verification of migration 0142 (Reconciliation history, 2.03) on
 * every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0142 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. The new column, and the six functions
 *    with their result types, security definer, pinned search path and grants,
 *    read in one query.
 *  - In co_pc (the sample company) only: the behaviour, acting as a staff user.
 *    Three bank accounts are made inside the transaction, each with its own
 *    ledger account and a few invented entries posted through
 *    acc_post_manual_journal, so no existing reconciliation can interfere:
 *      A  bring forward refused (out, past today, a session in progress that
 *         ends too early) and then done; the history row before and after
 *      B  a session in progress from an invented statement: the rebase, a
 *         statement line set aside and restored, the duplicate lookup, and
 *         discarding it (with every refusal, an adjustment among them)
 *      C  0132's bring-forward on the shared rule
 *    A viewer and an outsider are checked by turning the administrator into
 *    one inside the same transaction.
 *
 * 0142 adds a column to acc_reconciliation_statement_line, which takes that
 * table's strongest lock until the transaction ends. The migration is sent in
 * one round trip and the structure read in one more, so a real company's
 * statement lines are held for as little time as possible.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-reconciliation-history.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0142_reconciliation_history.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const FUNCTIONS = {
  "acc_bring_history_forward(uuid,date,bigint,text)": "jsonb",
  "acc_bring_forward_reconciliation(uuid,date,bigint,text)": "uuid",
  "acc_discard_reconciliation(uuid,text)": "integer",
  "acc_reconciliation_history()":
    "TABLE(bank_account_id uuid, open_lines integer, first_open_date date, last_open_date date, last_reconciled_date date, in_progress_id uuid, in_progress_ending_date date)",
  "acc_set_statement_line_aside(uuid,integer,boolean)": "void",
  "acc_statement_line_duplicates(uuid,integer[])":
    "TABLE(line_no integer, journal_line_id uuid, entry_id uuid, entry_number text, entry_date date)",
};

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
/** Runs `sql`, expecting a refusal holding `expect`; the savepoint puts everything back as it was. */
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    const ok = expect instanceof RegExp ? expect.test(error.message) : error.message.includes(expect);
    // The message is printed only when it is not the one expected; it can name an entry number, never an amount here.
    check(label, ok, ok ? "" : error.message);
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Structure, in every schema: one query.
// ---------------------------------------------------------------------------
const FACTS = `
select jsonb_build_object(
  'column', (
    select jsonb_build_object('type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
                              'default', pg_get_expr(d.adbin, d.adrelid),
                              'member_update', has_column_privilege('authenticated', a.attrelid, a.attnum, 'update'))
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = to_regclass($1::text || '.acc_reconciliation_statement_line')
       and a.attname = 'set_aside' and not a.attisdropped),
  'functions', (
    select jsonb_object_agg(f.sig, case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'result', pg_get_function_result(p.oid),
             'shared', p.prosrc like '%acc_bring_history_forward(%',
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE')) end)
      from unnest($2::text[]) as f(sig)
      left join pg_proc p on p.oid = to_regprocedure($1::text || '.' || f.sig))
) as facts`;

function structure(schema, facts) {
  const c = facts.column;
  check("acc_reconciliation_statement_line.set_aside is a boolean, not null, false by default",
    Boolean(c) && c.type === "boolean" && c.not_null === true && c.default === "false", JSON.stringify(c));
  check("signed-in users cannot write set_aside directly", Boolean(c) && c.member_update === false, JSON.stringify(c));
  for (const [sig, result] of Object.entries(FUNCTIONS)) {
    const f = facts.functions?.[sig];
    check(`${sig} exists, returns what parts 2 and 3 expect`, Boolean(f) && f.result === result, JSON.stringify(f?.result));
    check(`${sig} is security definer, search_path pinned to ${schema}`,
      Boolean(f) && f.definer && f.path === `search_path=${schema}`, JSON.stringify(f && { definer: f.definer, path: f.path }));
    check(`${sig} is closed to anon and public, open to signed-in users and the service role`,
      Boolean(f) && !f.anon && !f.public && f.member && f.service,
      JSON.stringify(f && { anon: f.anon, public: f.public, member: f.member, service: f.service }));
  }
  check("acc_bring_forward_reconciliation calls acc_bring_history_forward",
    facts.functions?.["acc_bring_forward_reconciliation(uuid,date,bigint,text)"]?.shared === true);
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** An ISO date as to_char(d, 'Mon FMDD, YYYY') writes it. */
const spoken = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  if (!admin || !base) {
    console.log("  (no active administrator or base currency; behaviour checks skipped)");
    return;
  }
  // The company's today, as 0142 counts it; every date below is that many days before it.
  const today = (await one(
    `select coalesce((select (now() at time zone time_zone)::date from acc_company_setting_version
                        order by version desc limit 1), current_date)::text as d`,
  )).d;
  const ago = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };

  // ---- invented books, made as the owner inside this rolled-back transaction
  const stamp = Date.now().toString(36).toUpperCase();
  if ((await one(`select acc_approval_required('manual_journal', 100000) as required`)).required) {
    await client.query(`update acc_approval_policy set enabled = false where action_key = 'manual_journal'`);
    console.log("  (manual-journal approval switched off inside this transaction)");
  }
  const offset = (await one(
    `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
     values ($1, 'Verify history offset', 'expense', $2, true) returning id`,
    [`ZZ-VRH-X-${stamp}`, base.code],
  )).id;
  const makeBank = async (letter) => {
    const gl = (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, 'bank', $3, true) returning id`,
      [`ZZ-VRH-${letter}-${stamp}`, `Verify history bank ${letter}`, base.code],
    )).id;
    const id = (await one(
      `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, $2, $3) returning id`,
      [gl, `Verify History Bank ${letter}`, base.code],
    )).id;
    return { id, gl };
  };
  const A = await makeBank("A");
  const B = await makeBank("B");
  const C = await makeBank("C");
  const bankCount = (await one(`select count(*)::int as n from acc_bank_account`)).n;

  await client.query("set local role authenticated");
  await as(admin.id);

  /** Posts one manual entry moving `minor` into (positive) or out of (negative) the bank; returns its bank line. */
  const post = async (bank, date, minor, ref = null) => {
    const lines =
      minor > 0
        ? [{ account_id: bank.gl, debit_minor: minor, credit_minor: 0 }, { account_id: offset, debit_minor: 0, credit_minor: minor }]
        : [{ account_id: offset, debit_minor: -minor, credit_minor: 0 }, { account_id: bank.gl, debit_minor: 0, credit_minor: -minor }];
    const entry = (await one(`select acc_post_manual_journal($1, 'Verify reconciliation history', $2, $3, $4::jsonb) as id`, [
      date, ref, base.code, JSON.stringify(lines),
    ])).id;
    const line = (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [entry, bank.gl])).id;
    const number = (await one(`select entry_number from acc_journal_entry where id = $1`, [entry])).entry_number;
    return { entry, line, number, date };
  };
  const entryCount = async () => (await one(`select count(*)::int as n from acc_journal_entry`)).n;
  const postedOn = async (bank) =>
    (await one(
      `select count(*)::int as n from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where l.account_id = $1 and e.status = 'posted'`,
      [bank.gl],
    )).n;
  const ticks = async (rec) => (await one(`select count(*)::int as n from acc_reconciliation_line where reconciliation_id = $1`, [rec])).n;
  const session = (rec) => one(`select * from acc_statement_reconciliation where id = $1`, [rec]);
  const historyOf = async (bank) => {
    const row = await one(
      `select open_lines, first_open_date::text as first, last_open_date::text as last,
              last_reconciled_date::text as reconciled, in_progress_id, in_progress_ending_date::text as in_progress_on
         from acc_reconciliation_history() where bank_account_id = $1`,
      [bank.id],
    );
    return row ?? null;
  };
  const audit = (rec, action) =>
    asOwner(admin.id, () =>
      all(`select before_json, after_json from acc_audit_log
            where table_name = 'acc_statement_reconciliation' and record_id = $1 and action = $2 order by created_at, id`,
        [rec, action]));

  const BRING = `select acc_bring_history_forward($1, $2::date, $3, $4) as r`;
  const WRAPPER = `select acc_bring_forward_reconciliation($1, $2::date, $3, $4) as id`;
  const DISCARD = `select acc_discard_reconciliation($1, $2) as n`;
  const ASIDE = `select acc_set_statement_line_aside($1, $2, $3)`;
  const DUPLICATES = `select line_no, journal_line_id, entry_id, entry_number, entry_date::text as entry_date
                        from acc_statement_line_duplicates($1, $2::int[])`;
  const NOTE = "Verify: brought forward, proved by an invented statement";

  // ======================================================================
  // A: bringing the history forward, and its refusals
  // ======================================================================
  console.log("  bringing the history forward (account A)");
  const a1 = await post(A, ago(50), 100000);
  await post(A, ago(45), -25000, "4411");
  await post(A, ago(40), 5000);
  const a4 = await post(A, ago(30), -12000, "4412");
  const a5 = await post(A, ago(20), 7000);
  const through = ago(35);

  let h = await historyOf(A);
  check("history, before: one row per bank account", (await one(`select count(*)::int as n from acc_reconciliation_history()`)).n === bankCount);
  check("history, before: five open lines from the first to the last entry, nothing reconciled, nothing in progress",
    Boolean(h) && h.open_lines === 5 && h.first === a1.date && h.last === a5.date && h.reconciled === null && h.in_progress_id === null,
    JSON.stringify(h && { n: h.open_lines, first: h.first === a1.date, last: h.last === a5.date }));

  await refused("out: refused with both figures, the date and the amount it is out by", BRING, [A.id, through, 90000, NOTE],
    `The books hold 800.00 on ${spoken(through)}; the statement shows 900.00. Out by 100.00.`);
  await refused("out the other way: the amount it is out by is never negative", BRING, [A.id, through, 70000, NOTE],
    `The books hold 800.00 on ${spoken(through)}; the statement shows 700.00. Out by 100.00.`);
  await refused("past today: refused", BRING, [A.id, ago(-2), 80000, NOTE], "A bank account cannot be brought forward past today");
  await refused("no date: refused", BRING, [A.id, null, 80000, NOTE], "Choose the date the history is brought forward through");
  await refused("no balance: refused", BRING, [A.id, through, null, NOTE], "Enter the statement balance on that date");
  await refused("an unknown bank account: refused", BRING, [OUTSIDER, through, 0, NOTE], "Bank account not found");

  await client.query("savepoint early_session");
  await one(`select acc_create_reconciliation($1, $2::date, 0) as id`, [A.id, through]);
  await refused("a session in progress that ends on the date: refused", BRING, [A.id, through, 80000, NOTE],
    "Finish or discard the reconciliation in progress first.");
  await refused("…and 0132's bring-forward still refuses an account with only a session in progress", WRAPPER, [A.id, through, 80000, NOTE],
    "This bank account already has a reconciliation; only the first one can be brought forward");
  await client.query("rollback to savepoint early_session");

  const entriesBefore = await entryCount();
  const ra = (await one(BRING, [A.id, through, 80000, `  ${NOTE}  `])).r;
  check("matching: the answer names the new session, three lines, none moved, nothing rebased",
    typeof ra.reconciliation_id === "string" && ra.lines === 3 && ra.moved === 0 && ra.rebased_reconciliation_id === null,
    JSON.stringify({ lines: ra.lines, moved: ra.moved, rebased: ra.rebased_reconciliation_id }));
  const fa = await session(ra.reconciliation_id);
  check("matching: one completed, brought-forward session through the date, from 0 to the statement balance",
    fa.status === "completed" && fa.brought_forward === true && Number(fa.beginning_balance_minor) === 0 &&
      Number(fa.statement_ending_balance_minor) === 80000 && fa.completed_by === admin.id && fa.prepared_by === admin.id);
  check("matching: the note is kept, trimmed", fa.note === NOTE);
  check("matching: it holds the three lines through the date", (await ticks(ra.reconciliation_id)) === 3);
  check("matching: nothing was posted", (await entryCount()) === entriesBefore);
  const insertRows = await audit(ra.reconciliation_id, "insert");
  check("matching: one audit row for the new session, with the account, the date, the balance and the lines",
    insertRows.length === 1 && insertRows[0].after_json.bank_account_id === A.id && insertRows[0].after_json.through === through &&
      Number(insertRows[0].after_json.balance_minor) === 80000 && insertRows[0].after_json.lines === 3 &&
      insertRows[0].after_json.moved === 0);
  check("matching: and its sign-off, as a completed session has", (await audit(ra.reconciliation_id, "post")).length === 1);

  h = await historyOf(A);
  check("history, after: two open lines left, after the date; reconciled up to the date",
    Boolean(h) && h.open_lines === 2 && h.first === a4.date && h.last === a5.date && h.reconciled === through && h.in_progress_id === null,
    JSON.stringify(h && { n: h.open_lines, reconciled: h.reconciled === through }));

  await refused("a second time: refused", BRING, [A.id, through, 80000, NOTE], "This account already has a completed reconciliation.");
  await refused("a second time, through a later date: refused", BRING, [A.id, ago(25), 68000, NOTE],
    "This account already has a completed reconciliation.");

  // ======================================================================
  // B: a session in progress, rebased; set aside; duplicates; discard
  // ======================================================================
  console.log("  a session in progress (account B)");
  const b1 = await post(B, ago(50), 20000);
  await post(B, ago(48), -5000);
  const b3 = await post(B, ago(30), -7500, "5531");
  const b4 = await post(B, ago(12), -3300);
  const b5 = await post(B, ago(12), 3300);
  const bThrough = ago(40);

  // An invented statement. Line 1 is a check image read twice: the same check
  // number ten days later. Lines 2 and 3 are fees 5 and 6 days from the books'
  // fee; line 4 is money in of the same size as that fee; line 6 carries no
  // check number, at the amount of an old payment.
  const statement = [
    { txn_date: ago(30), description: "CHECK", reference: "5531", amount_minor: -7500, balance_minor: 7500 },
    { txn_date: ago(20), description: "CHECK IMAGE", reference: "#5531", amount_minor: -7500, balance_minor: 0 },
    { txn_date: ago(17), description: "SERVICE FEE", reference: null, amount_minor: -3300, balance_minor: -3300 },
    { txn_date: ago(18), description: "SERVICE FEE", reference: null, amount_minor: -3300, balance_minor: -6600 },
    { txn_date: ago(8), description: "DEPOSIT", reference: null, amount_minor: 3300, balance_minor: -3300 },
    { txn_date: ago(9), description: "WIRE", reference: "ZZ-1", amount_minor: -999, balance_minor: -4299 },
    { txn_date: ago(25), description: "PAYMENT", reference: null, amount_minor: -5000, balance_minor: -9299 },
  ];
  const S = (await one(
    `select acc_create_reconciliation_from_statement($1, $2::date, $3, $4, $5, $6::jsonb) as id`,
    [B.id, ago(5), 7500, "verify-invented-statement.pdf", 15000, JSON.stringify(statement)],
  )).id;
  check("the session from the invented statement begins at 0 and holds its seven lines",
    Number((await session(S)).beginning_balance_minor) === 0 &&
      (await one(`select count(*)::int as n from acc_reconciliation_statement_line where reconciliation_id = $1`, [S])).n === 7);
  await one(`select acc_set_cleared_many($1, $2::uuid[], true) as n`, [S, [b1.line, b3.line]]);
  const tickedAt = (await one(`select cleared_at::text as t from acc_reconciliation_line where reconciliation_id = $1 and journal_line_id = $2`, [S, b1.line])).t;

  h = await historyOf(B);
  check("history: a tick in a session in progress still counts as open; the session and its ending date are named",
    Boolean(h) && h.open_lines === 5 && h.first === b1.date && h.last === b4.date && h.reconciled === null &&
      h.in_progress_id === S && h.in_progress_on === ago(5),
    JSON.stringify(h && { n: h.open_lines, inProgress: h.in_progress_id === S }));

  const rb = (await one(BRING, [B.id, bThrough, 15000, NOTE])).r;
  check("rebase: two lines brought forward, one of them moved out of the session in progress, which is named",
    rb.lines === 2 && rb.moved === 1 && rb.rebased_reconciliation_id === S,
    JSON.stringify({ lines: rb.lines, moved: rb.moved, rebased: rb.rebased_reconciliation_id === S }));
  const movedTick = await one(
    `select reconciliation_id, cleared_at::text as t from acc_reconciliation_line where journal_line_id = $1`, [b1.line]);
  check("rebase: the tick on the earlier line moved to the new session, keeping when it was ticked",
    movedTick.reconciliation_id === rb.reconciliation_id && movedTick.t === tickedAt);
  check("rebase: the new session holds both earlier lines", (await ticks(rb.reconciliation_id)) === 2);
  check("rebase: the session in progress keeps its later tick only", (await ticks(S)) === 1 &&
    (await one(`select count(*)::int as n from acc_reconciliation_line where reconciliation_id = $1 and journal_line_id = $2`, [S, b3.line])).n === 1);
  const sAfter = await session(S);
  check("rebase: the session in progress now begins at the statement balance, and is still in progress",
    Number(sAfter.beginning_balance_minor) === 15000 && sAfter.status === "in_progress");
  const offered = await all(`select journal_line_id from acc_reconciliation_lines($1)`, [S]);
  check("rebase: the session now offers only the lines after the date", offered.length === 3 &&
    !offered.some((l) => l.journal_line_id === b1.line), String(offered.length));
  const updateRows = await audit(S, "update");
  const rebaseRow = updateRows.find((r) => r.after_json?.brought_forward_id === rb.reconciliation_id);
  check("rebase: an audit row for the changed session, with the old and new beginning and the lines moved",
    Boolean(rebaseRow) && Number(rebaseRow.before_json.beginning_balance_minor) === 0 &&
      Number(rebaseRow.after_json.beginning_balance_minor) === 15000 && rebaseRow.after_json.lines === 1 &&
      rebaseRow.after_json.through === bThrough);
  const bInsert = await audit(rb.reconciliation_id, "insert");
  check("rebase: the new session's audit row counts the moved tick", bInsert.length === 1 && bInsert[0].after_json.moved === 1 &&
    bInsert[0].after_json.lines === 2);
  h = await historyOf(B);
  check("history, after the rebase: three open lines, reconciled up to the date, the session still named",
    Boolean(h) && h.open_lines === 3 && h.first === b3.date && h.last === b4.date && h.reconciled === bThrough && h.in_progress_id === S);

  // ---- set aside
  console.log("  setting a statement line aside");
  const asideOf = async (no) =>
    (await one(`select set_aside from acc_reconciliation_statement_line where reconciliation_id = $1 and line_no = $2`, [S, no])).set_aside;
  // Every row in one transaction shares one created_at, so rows are told apart by what they hold.
  const asideRows = async () => (await audit(S, "update")).filter((r) => r.after_json?.line_no === 1);
  await one(ASIDE, [S, 1, true]);
  check("a line is set aside", (await asideOf(1)) === true && (await asideOf(0)) === false);
  let rows = await asideRows();
  check("…with one audit row naming the line", rows.length === 1 && rows[0].after_json.set_aside === true &&
    rows[0].before_json.set_aside === false);
  await one(ASIDE, [S, 1, true]);
  check("setting it aside again changes nothing and writes nothing", (await asideRows()).length === 1);
  await one(ASIDE, [S, 1, false]);
  rows = await asideRows();
  check("…and Restore brings it back, with its own audit row", (await asideOf(1)) === false && rows.length === 2 &&
    rows.some((r) => r.after_json.set_aside === false && r.before_json.set_aside === true));
  await refused("an unknown line: refused", ASIDE, [S, 99, true], "Statement line not found");
  await refused("a completed session: refused", ASIDE, [ra.reconciliation_id, 0, true], "Reconciliation is not in progress");
  await refused("no answer either way: refused", ASIDE, [S, 1, null], "Say whether the line is set aside or brought back");

  // ---- duplicates
  console.log("  looking for duplicates");
  const found = await all(DUPLICATES, [S, [0, 1, 2, 3, 4, 5, 6, 77]]);
  const pairs = found.map((r) => [r.line_no, r.journal_line_id]);
  check("the right book lines come back, in statement-line order",
    same(pairs, [[0, b3.line], [1, b3.line], [2, b4.line], [4, b5.line]]), `${found.length} rows`);
  check("by check number: a check image ten days on is found by its cleaned number", pairs.some(([n, l]) => n === 1 && l === b3.line));
  check("by date: a fee 5 days from the books' fee is found", pairs.some(([n, l]) => n === 2 && l === b4.line));
  check("…but not one 6 days away", !pairs.some(([n]) => n === 3));
  check("the sign is respected: a fee never matches money in of the same size, nor the other way round",
    !pairs.some(([n, l]) => (n === 2 && l === b5.line) || (n === 4 && l === b4.line)));
  check("an amount the books do not hold finds nothing", !pairs.some(([n]) => n === 5));
  check("an empty check number never matches, so an old payment of the same amount is not found", !pairs.some(([n]) => n === 6));
  check("each match carries its entry, entry number and date",
    found.every((r) => typeof r.entry_id === "string" && /\S/.test(r.entry_number) && /^\d{4}-\d{2}-\d{2}$/.test(r.entry_date)) &&
      found.find((r) => r.line_no === 2)?.entry_number === b4.number && found.find((r) => r.line_no === 2)?.entry_date === b4.date);
  check("no line numbers asked, nothing found", (await all(DUPLICATES, [S, []])).length === 0);
  await refused("more than 500 line numbers: refused", DUPLICATES, [S, Array.from({ length: 501 }, (_, i) => i)],
    "At most 500 statement lines can be checked at once");
  await refused("an unknown session: refused", DUPLICATES, [OUTSIDER, [0]], "Reconciliation not found");

  // ---- who may
  console.log("  who may");
  await client.query("savepoint as_viewer");
  await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]));
  check("a viewer reads the history", (await one(`select count(*)::int as n from acc_reconciliation_history()`)).n === bankCount);
  check("a viewer reads the duplicates", (await all(DUPLICATES, [S, [1]])).length === 1);
  await refused("a viewer cannot bring the history forward", BRING, [C.id, ago(50), 0, NOTE], "Not authorized");
  await refused("a viewer cannot use 0132's bring-forward", WRAPPER, [C.id, ago(50), 0, NOTE], "Not authorized");
  await refused("a viewer cannot discard", DISCARD, [S, "Verify"], "Not authorized");
  await refused("a viewer cannot set a line aside", ASIDE, [S, 1, true], "Not authorized");
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  await refused("an outsider cannot read the history", `select * from acc_reconciliation_history()`, [], "Not authorized");
  await refused("an outsider cannot read the duplicates", DUPLICATES, [S, [1]], "Not authorized");
  await refused("an outsider cannot bring the history forward", BRING, [C.id, ago(50), 0, NOTE], "Not authorized");
  await refused("an outsider cannot discard", DISCARD, [S, "Verify"], "Not authorized");
  await as(admin.id);

  // ---- discard
  console.log("  discarding");
  await refused("a completed session: refused", DISCARD, [ra.reconciliation_id, "Verify"],
    "Only a reconciliation in progress can be discarded");
  await refused("a blank reason: refused", DISCARD, [S, "   "], "A reason is required to discard a reconciliation");
  await refused("an unknown session: refused", DISCARD, [OUTSIDER, "Verify"], "Reconciliation not found");

  await client.query("savepoint adjusted");
  await one(`select acc_set_cleared($1, $2, false)`, [S, b3.line]);
  const adjustment = (await one(`select acc_record_reconciliation_adjustment($1, $2, 'Verify adjustment') as id`, [S, offset])).id;
  const adjustmentNumber = (await one(`select entry_number from acc_journal_entry where id = $1`, [adjustment])).entry_number;
  await refused("a posted adjustment: refused, naming the entry", DISCARD, [S, "Verify"],
    `This reconciliation posted an adjustment (${adjustmentNumber}), so it cannot be discarded.`);
  await asOwner(admin.id, () => client.query(`update acc_journal_entry set status = 'void', voided_at = now() where id = $1`, [adjustment]));
  check("…and once that adjustment is void, the session can be discarded", (await one(DISCARD, [S, "Verify"])).n === 1);
  await client.query("rollback to savepoint adjusted");

  const postedBefore = await postedOn(B);
  const removed = (await one(DISCARD, [S, "  Verify: started on the wrong statement  "])).n;
  check("discard: the number of ticks removed comes back", removed === 1, String(removed));
  check("discard: the session is gone", (await one(`select count(*)::int as n from acc_statement_reconciliation where id = $1`, [S])).n === 0);
  check("discard: its ticks and statement lines went with it",
    (await ticks(S)) === 0 &&
      (await one(`select count(*)::int as n from acc_reconciliation_statement_line where reconciliation_id = $1`, [S])).n === 0);
  check("discard: every entry is still posted", (await postedOn(B)) === postedBefore && postedBefore === 5);
  check("discard: the brought-forward session stays", (await session(rb.reconciliation_id))?.status === "completed");
  const discardRows = await audit(S, "delete");
  check("discard: one audit row with the reason, the account, the statement ending date and the ticks",
    discardRows.length === 1 && discardRows[0].before_json.reason === "Verify: started on the wrong statement" &&
      discardRows[0].before_json.bank_account_id === B.id && discardRows[0].before_json.statement_ending_date === ago(5) &&
      discardRows[0].before_json.ticks === 1 && typeof discardRows[0].before_json.account === "string");
  h = await historyOf(B);
  check("history, after the discard: nothing in progress", Boolean(h) && h.in_progress_id === null && h.open_lines === 3);
  check("a new session can be started on the account", typeof (await one(`select acc_create_reconciliation($1, $2::date, 0) as id`, [B.id, ago(5)])).id === "string");

  // ======================================================================
  // C: 0132's bring-forward on the shared rule
  // ======================================================================
  console.log("  0132's bring-forward (account C)");
  await post(C, ago(60), 4000);
  await post(C, ago(55), -1000);
  await refused("out: 0132's bring-forward now refuses with the shared message", WRAPPER, [C.id, ago(50), 2500, NOTE],
    `The books hold 30.00 on ${spoken(ago(50))}; the statement shows 25.00. Out by 5.00.`);
  const rc = (await one(WRAPPER, [C.id, ago(50), 3000, NOTE])).id;
  const fc = await session(rc);
  check("on a fresh account it still brings the history forward and returns the session",
    typeof rc === "string" && fc.status === "completed" && fc.brought_forward === true && (await ticks(rc)) === 2);
  await refused("it still refuses an account with any reconciliation", WRAPPER, [A.id, through, 80000, NOTE],
    "This bank account already has a reconciliation; only the first one can be brought forward");
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
      // One round trip each. A newline before every semicolon, so a statement
      // ending in a line comment cannot swallow the next one.
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      console.log("  (0142 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0142 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema, Object.keys(FUNCTIONS)]);
      structure(schema, facts);
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

- [ ] **Step 5: Edit `ctyhp-accounting/scripts/verify-reconcile-from-statement.mjs`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```js
      const wrong = await refused(bringForward, [bank, 80000]);
      check("bringing forward on a different opening balance is refused", /The books hold 750\.00 on 2026-08-31, and the statement opens at 800\.00/.test(wrong ?? ""), wrong ?? "accepted");
      const future = await refused(`select acc_bring_forward_reconciliation($1, current_date + 1, 0, 'x')`, [bank]);
```

replace with:

```js
      const wrong = await refused(bringForward, [bank, 80000]);
      // Since 0142 the refusal comes from the shared rule, acc_bring_history_forward.
      check("bringing forward on a different opening balance is refused", /The books hold 750\.00 on Aug 31, 2026; the statement shows 800\.00\. Out by 50\.00\./.test(wrong ?? ""), wrong ?? "accepted");
      const future = await refused(`select acc_bring_forward_reconciliation($1, current_date + 1, 0, 'x')`, [bank]);
```

- [ ] **Step 6: Edit `ctyhp-accounting/package.json`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```json
    "verify:balance-entries": "node --env-file=.env.local scripts/verify-balance-entries.mjs",
    "verify:estimates": "node --env-file=.env.local scripts/verify-estimates.mjs"
  },
```

replace with:

```json
    "verify:balance-entries": "node --env-file=.env.local scripts/verify-balance-entries.mjs",
    "verify:estimates": "node --env-file=.env.local scripts/verify-estimates.mjs",
    "verify:reconciliation-history": "node --env-file=.env.local scripts/verify-reconciliation-history.mjs"
  },
```

- [ ] **Step 7: Do not touch the database**

Migration 0142 is already live on all six companies (the controller applied it with the user's approval). Do not run `scripts/migrate.mjs`, `provision-company`, `npm run verify:reconciliation-history`, `npm run verify:reconcile-from-statement` or anything else that connects to the database. The controller runs the verification script alone in Task 7.

- [ ] **Step 8: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/reconciliation-history-migration.test.ts"
npx vitest run tests/unit/reconciliation-history-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/schema-template.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; reconciliation-history-migration: 62 tests passing; migration-grants (39) and schema-template (27) pass.

- [ ] **Step 9: Commit**

```bash
git add "ctyhp-accounting/tests/unit/reconciliation-history-migration.test.ts" "ctyhp-accounting/supabase/migrations/0142_reconciliation_history.sql" "ctyhp-accounting/scripts/verify-reconciliation-history.mjs" "ctyhp-accounting/scripts/verify-reconcile-from-statement.mjs" "ctyhp-accounting/package.json"
git commit -m "feat(reconcile): bring history forward, discard a session, set a statement line aside, and find likely duplicates (migration 0142)"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 2: The PDF reader — a check image's caption no longer ends the skip, and the proof says a line may be extra

**Files:**
- Test (modify): `ctyhp-accounting/tests/fixtures/pdf-statements.ts`
- Test (modify): `ctyhp-accounting/tests/unit/pdf-statement.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/pdf-statement-view.test.ts`
- Modify: `ctyhp-accounting/lib/domain/pdf-statement.ts`
- Modify: `ctyhp-accounting/lib/domain/pdf-statement-view.ts`

**Interfaces:**
- Consumes (existing): `readStatementRows`, `headerShape`, `SKIP_HEADING`, `DEBIT_HEADING`, `statementProof`, `summarizeStatement`.
- Produces:
  - Inside a check-image skip, a short undated "Checks…" or "Fees…" caption, or the images' own Date / Check No. / Amount table, no longer reopens reading; a real activity table or a "transactions history|detail|activity" row still does.
  - The proof sentence ends: "A line may not have been read, or one may have been read that is not a transaction — check before importing."
  - `STATEMENT_READING_NOTE` (the import dialog's line, used in Task 5).
  - A 19th fixture scenario, a check-images page, which must read exactly its real lines and prove itself.

- [ ] **Step 1: Edit `ctyhp-accounting/tests/fixtures/pdf-statements.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
  },
];
```

replace with:

```ts
  },
  {
    // The images of the cheques paid follow the list of them. The images carry
    // a "Checks" caption and their own small table, whose row names two cheque
    // numbers and one amount: it restates a cheque already read, and is not a
    // transaction. The caption must not end the skip of the images.
    name: "checkImagesAfterChecksPaid",
    prototypeDiffers: "the prototype ends the skip of the check images at their \"Checks\" caption and reads the image row as a payment",
    pages: [
      [
        [760, [40, "Example Bank"]],
        [748, [40, "Statement period Jun 1 - Jun 30, 2027"]],
        [730, [40, "Beginning balance"], [500, "2,000.00"]],
        [718, [40, "Ending balance"], [500, "1,640.00"]],
        [700, [40, "Transaction history"]],
        [688, [40, "Date"], [90, "Description"], [330, "Withdrawals"], [410, "Deposits"], [500, "Balance"]],
        [676, [40, "06/03"], [90, "EXAMPLE CLIENT DEPOSIT"], [410, "250.00"], [500, "2,250.00"]],
        [664, [40, "06/08"], [90, "CHECK 4101"], [330, "360.00"], [500, "1,890.00"]],
        [652, [40, "06/15"], [90, "CHECK 4102"], [330, "250.00"], [500, "1,640.00"]],
        [634, [40, "Checks paid"]],
        [622, [40, "Date"], [90, "Check No."], [160, "Amount"], [260, "Date"], [310, "Check No."], [380, "Amount"]],
        [610, [40, "06/08"], [90, "4101"], [160, "360.00"], [260, "06/15"], [310, "4102"], [380, "250.00"]],
        [592, [40, "Check images"]],
        [580, [40, "Checks"]],
        [568, [40, "Date"], [90, "Check No."], [200, "Amount"]],
        [556, [40, "06/08"], [90, "4101"], [140, "4102"], [200, "360.00"]],
      ],
    ],
    expected: [
      {
        account: null, from: "2027-06-01", to: "2027-06-30", opening: 200000, closing: 164000, skipped: 0,
        lines: [
          ["2027-06-03",25000,"EXAMPLE CLIENT DEPOSIT",null,225000],
          ["2027-06-08",-36000,"CHECK 4101","4101",189000],
          ["2027-06-15",-25000,"CHECK 4102","4102",164000],
        ],
      },
    ],
  },
];
```

- [ ] **Step 2: Edit `ctyhp-accounting/tests/unit/pdf-statement.test.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
    expect(readPdfStatements([])).toEqual([]);
  });
```

replace with:

```ts
    expect(readPdfStatements([])).toEqual([]);
  });

  it("ends the skip of cheque images at a table of activity, signed by the title above it", () => {
    const images = PDF_SCENARIOS.find((s) => s.name === "checkImagesAfterChecksPaid")!;
    const [statement] = readPdfStatements(
      glyphsOf({
        ...images,
        pages: [
          [
            ...images.pages[0],
            [538, [40, "Deposits and other credits"]],
            [526, [40, "Date"], [90, "Description"], [420, "Amount"]],
            [514, [40, "06/20"], [90, "EXAMPLE LATE DEPOSIT"], [420, "40.00"]],
          ],
        ],
      }),
    );
    expect(statement.lines.map((l) => [l.date, l.amountMinor, l.description])).toEqual([
      ["2027-06-03", 25000, "EXAMPLE CLIENT DEPOSIT"],
      ["2027-06-08", -36000, "CHECK 4101"],
      ["2027-06-15", -25000, "CHECK 4102"],
      ["2027-06-20", 4000, "EXAMPLE LATE DEPOSIT"],
    ]);
  });
```

- [ ] **Step 3: Edit `ctyhp-accounting/tests/unit/pdf-statement-view.test.ts`** — apply these 3 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 3 — find:

```ts
import type { PdfStatement, PdfStatementLine } from "@/lib/domain/pdf-statement";
import { periodLabel, pickStatement, skippedNote, statementLabel, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";
```

replace with:

```ts
import type { PdfStatement, PdfStatementLine } from "@/lib/domain/pdf-statement";
import {
  STATEMENT_READING_NOTE,
  periodLabel,
  pickStatement,
  skippedNote,
  statementLabel,
  summarizeStatement,
} from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";
```

Edit 2 of 3 — find:

```ts

  it("says by how much a statement is out", () => {
    const summary = summarizeStatement(statement({ closingMinor: 120000 }), usd);
    expect(summary.proves).toBe(false);
    expect(summary.proof).toBe(
      "Out by $20.00: opening $1,000.00 + lines $180.00 comes to $1,180.00, and the statement closes at $1,200.00. " +
```

replace with:

```ts

  it("says by how much a statement is out, whether a line is missing or one is extra", () => {
    const short = summarizeStatement(statement({ closingMinor: 120000 }), usd);
    expect(short.proves).toBe(false);
    expect(short.proof).toBe(
      "Out by $20.00: opening $1,000.00 + lines $180.00 comes to $1,180.00, and the statement closes at $1,200.00. " +
```

Edit 3 of 3 — find:

```ts
      "Out by $20.00: opening $1,000.00 + lines $180.00 comes to $1,180.00, and the statement closes at $1,200.00. " +
        "A line may not have been read — check before importing.",
    );
```

replace with:

```ts
      "Out by $20.00: opening $1,000.00 + lines $180.00 comes to $1,180.00, and the statement closes at $1,200.00. " +
        "A line may not have been read, or one may have been read that is not a transaction — check before importing.",
    );
    // A line read that is not a transaction: the lines come to more than the statement closes at.
    const extra = summarizeStatement(statement({ lines: [line(-25000), line(-7000), line(50000), line(-36000)] }), usd);
    expect(extra.proof).toBe(
      "Out by $360.00: opening $1,000.00 − lines $180.00 comes to $820.00, and the statement closes at $1,180.00. " +
        "A line may not have been read, or one may have been read that is not a transaction — check before importing.",
    );
  });

  it("says in the import dialog which files are read exactly and which can be misread", () => {
    expect(STATEMENT_READING_NOTE).toBe(
      "A bank download (CSV, QFX or OFX) is read exactly. A PDF is read from its text, and a check image or a summary table can be misread.",
    );
```

- [ ] **Step 4: Run the tests to see them fail**

```bash
npx vitest run tests/unit/pdf-statement.test.ts tests/unit/pdf-statement-view.test.ts
```

Expected: FAIL — the new check-images scenario reads the thumbnail row as a line, and `STATEMENT_READING_NOTE` is not exported yet.

- [ ] **Step 5: Edit `ctyhp-accounting/lib/domain/pdf-statement.ts`** — apply these 11 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 11 — find:

```ts
 * this turns the glyphs into statements. It departs from the prototype in
 * four places, each marked "OneBook:" where it happens:
 *   1. a figure with two decimals is never a date (the prototype reads 75.00 as
```

replace with:

```ts
 * this turns the glyphs into statements. It departs from the prototype in
 * five places, each marked "OneBook:" where it happens:
 *   1. a figure with two decimals is never a date (the prototype reads 75.00 as
```

Edit 2 of 11 — find:

```ts
 *   4. a date pdf.js has joined to the words after it is read as the date and
 *      the words.
 */
```

replace with:

```ts
 *   4. a date pdf.js has joined to the words after it is read as the date and
 *      the words;
 *   5. inside the images of cheques, a "Checks" or "Fees" caption does not end
 *      the skip, nor does a table of cheque numbers that captions the images:
 *      only a table of activity or a transaction history does.
 */
```

Edit 3 of 11 — find:

```ts
const CREDIT_HEADING = /deposit|credit|additions?|payments? (in|received)/i;

```

replace with:

```ts
const CREDIT_HEADING = /deposit|credit|additions?|payments? (in|received)/i;
/** The heading of a page of cheque images. */
const IMAGES_HEADING = /check\s+images?/i;
/** A caption the images of cheques print over them: it names the images, it opens no section. */
const IMAGE_CAPTION = /^checks?\b|fees?\b/i;
/** A row that announces a table of activity. */
const ACTIVITY_TITLE = /^transactions?\s+(history|detail|activity)/i;

```

Edit 4 of 11 — find:

```ts
  let sawBal = false;
  let skipping = false;
  let prevRow: PdfRow | null = null;
```

replace with:

```ts
  let sawBal = false;
  // What is being skipped: a summary or a grid of balances, or the images of cheques.
  let skipping: "summary" | "images" | null = null;
  let prevRow: PdfRow | null = null;
```

Edit 5 of 11 — find:

```ts
      secNo++;
      // A grid of balances is not activity, and a table under a heading we were told to ignore stays ignored.
```

replace with:

```ts
      secNo++;
      // OneBook: among the images of cheques, a table of cheque numbers and
      // amounts captions the images; a table of activity (one with a debit,
      // credit or balance column, or with no cheque column) ends them.
      const captionsImages = h.check && h.debit === undefined && h.credit === undefined && h.balance === undefined;
      if (skipping === "images" && !captionsImages) skipping = null;
      // A grid of balances is not activity, and a table under a heading we were told to ignore stays ignored.
```

Edit 6 of 11 — find:

```ts
      // A grid of balances is not activity, and a table under a heading we were told to ignore stays ignored.
      sec = skipping || (h.balanceOnly && h.dates > 1) ? null : h;
      continue;
```

replace with:

```ts
      // A grid of balances is not activity, and a table under a heading we were told to ignore stays ignored.
      sec = skipping !== null || (h.balanceOnly && h.dates > 1) ? null : h;
      continue;
```

Edit 7 of 11 — find:

```ts
      if (SKIP_HEADING.test(t)) {
        skipping = true;
        sec = null;
```

replace with:

```ts
      if (SKIP_HEADING.test(t)) {
        skipping = IMAGES_HEADING.test(t) ? "images" : "summary";
        sec = null;
```

Edit 8 of 11 — find:

```ts
      if (t.length && t.length < 60 && !moneyIn(t).length) {
        if (DEBIT_HEADING.test(t)) {
          secSign = -1;
```

replace with:

```ts
      if (t.length && t.length < 60 && !moneyIn(t).length) {
        if (skipping === "images" && !ACTIVITY_TITLE.test(t)) {
          // OneBook: the prototype ends the skip at any "Checks…" or "Fees…"
          // row, and the images of cheques print exactly that over themselves,
          // so a restated cheque was read as a second payment. Here a caption
          // changes nothing, and any other section title only sets the sign of
          // the table it heads: that table ends the skip when it comes.
          if (!IMAGE_CAPTION.test(t)) {
            if (DEBIT_HEADING.test(t)) secSign = -1;
            else if (CREDIT_HEADING.test(t)) secSign = 1;
          }
        } else if (DEBIT_HEADING.test(t)) {
          secSign = -1;
```

Edit 9 of 11 — find:

```ts
          secSign = -1;
          skipping = false;
        } else if (CREDIT_HEADING.test(t)) {
```

replace with:

```ts
          secSign = -1;
          skipping = null;
        } else if (CREDIT_HEADING.test(t)) {
```

Edit 10 of 11 — find:

```ts
          secSign = 1;
          skipping = false;
        } else if (/^transactions?\s+(history|detail|activity)/i.test(t)) {
          // A summary we were told to ignore ends where the next table of activity announces itself.
```

replace with:

```ts
          secSign = 1;
          skipping = null;
        } else if (ACTIVITY_TITLE.test(t)) {
          // A summary we were told to ignore ends where the next table of activity announces itself.
```

Edit 11 of 11 — find:

```ts
          // A summary we were told to ignore ends where the next table of activity announces itself.
          skipping = false;
        }
```

replace with:

```ts
          // A summary we were told to ignore ends where the next table of activity announces itself.
          skipping = null;
        }
```

- [ ] **Step 6: Edit `ctyhp-accounting/lib/domain/pdf-statement-view.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
} as const;

```

replace with:

```ts
} as const;

/** Said in the statement import dialog: which files are read exactly, and which can be misread. */
export const STATEMENT_READING_NOTE =
  "A bank download (CSV, QFX or OFX) is read exactly. A PDF is read from its text, and a check image or a summary table can be misread.";

```

Edit 2 of 2 — find:

```ts
      `${money(s.openingMinor + linesMinor)}, and the statement closes at ${money(s.closingMinor)}. ` +
      "A line may not have been read — check before importing.";
  }
```

replace with:

```ts
      `${money(s.openingMinor + linesMinor)}, and the statement closes at ${money(s.closingMinor)}. ` +
      "A line may not have been read, or one may have been read that is not a transaction — check before importing.";
  }
```

- [ ] **Step 7: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/fixtures/pdf-statements.ts" "tests/unit/pdf-statement.test.ts" "tests/unit/pdf-statement-view.test.ts" "lib/domain/pdf-statement.ts" "lib/domain/pdf-statement-view.ts"
npx vitest run tests/unit/pdf-statement.test.ts tests/unit/pdf-statement-view.test.ts tests/unit/pdf-glyphs.test.ts tests/unit/statement-run.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; pdf-statement (44) and pdf-statement-view (11): 55 tests passing; pdf-glyphs (23) and statement-run (26) pass.

- [ ] **Step 8: Commit**

```bash
git add "ctyhp-accounting/tests/fixtures/pdf-statements.ts" "ctyhp-accounting/tests/unit/pdf-statement.test.ts" "ctyhp-accounting/tests/unit/pdf-statement-view.test.ts" "ctyhp-accounting/lib/domain/pdf-statement.ts" "ctyhp-accounting/lib/domain/pdf-statement-view.ts"
git commit -m "fix(reconcile): keep a check image's caption from ending the skip of the images, and say a PDF that does not prove itself may hold an extra line"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 3: The pure logic — the set-aside standing, the difference in parts, the history page's advice, held-back lines, and the wording

**Files:**
- Test (modify): `ctyhp-accounting/tests/unit/reconcile-statement.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/reconcile-difference.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/reconcile-history.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/add-missing.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/reconciliation-statement-schemas.test.ts`
- Modify: `ctyhp-accounting/lib/domain/reconcile-statement.ts`
- Create: `ctyhp-accounting/lib/domain/reconcile-difference.ts`
- Create: `ctyhp-accounting/lib/domain/reconcile-history.ts`
- Modify: `ctyhp-accounting/lib/domain/add-missing.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Modify: `ctyhp-accounting/app/(app)/banking/reconcile/StandingTag.tsx`

**Interfaces:**
- Consumes: Task 2's `shortDate` / `periodLabel` (existing in `pdf-statement-view.ts`); existing `matchStatement`, `statementStandings`, `reconciliationStandings`, `planAddMissing`.
- Produces:
  - `reconcile-statement.ts`: `Standing` gains `{ kind: "aside" }` (never paired, never missing); `StatementStandings.aside`; `NOT_A_TRANSACTION`, `RESTORE_LINE`, `PAIRED_LINE_REFUSAL`, `setAsideRefusal`, `asideActionFor`, `SET_ASIDE_MESSAGE`; `HistorySession`, `SESSION_HISTORY_REFUSAL`, `sessionHistoryRefusal`, `sessionHistoryStart`, `SessionHistoryFacts`, `sessionHistoryAdvice`, `ALREADY_RECONCILED`, `BRING_HISTORY_FORWARD`, `bringHistoryForwardConfirmation`, `entriesCount`; `DISCARD_RECONCILIATION`, `DISCARD_CONFIRMATION`, `discardedMessage`, `discardedReturnPath`.
  - `reconcile-difference.ts`: `DIFFERENCE_LABELS`, `explainDifference`, `DifferenceExplained`, `differenceHeading`, `linesCount` and the line-name helpers.
  - `reconcile-history.ts`: `ReconciliationHistoryRow`, `HistoryAccount`, `historyAccounts`, `HistoryPreview`, `historyAdvice`, the page's sentences and labels, `historyBroughtForwardNote`, `historyBroughtForwardMessage`, `RECONCILE_HISTORY`, `RECONCILE_HISTORY_PATH`.
  - `add-missing.ts`: `DuplicateMatch`, `HeldReason`, `HeldLine`, `AddMissingPlan.held`, `EXTRA_LINE_NOTE`, `EXTRA_LINE_TAG`, `duplicateNote`, `extraStatementLines`, `extraLineNos`, `linesToCheckForDuplicates`, `ChosenLine`, `chooseLinesToAdd`, `HELD_BACK_HEADING`, `ADD_ANYWAY`.
  - `schemas.ts`: `reconciliationDiscardSchema`, `historyBringForwardSchema`, `historyPreviewSchema`, `statementLineAsideSchema`.
  - `StandingTag` shows "Not a transaction" for `aside` and the Extra tag.

- [ ] **Step 1: Edit `ctyhp-accounting/tests/unit/reconcile-statement.test.ts`** — apply these 5 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 5 — find:

```ts
import {
  bringForwardAdvice,
```

replace with:

```ts
import {
  ALREADY_RECONCILED,
  BRING_HISTORY_FORWARD,
  DISCARD_CONFIRMATION,
  DISCARD_RECONCILIATION,
  NOT_A_TRANSACTION,
  PAIRED_LINE_REFUSAL,
  RESTORE_LINE,
  SESSION_HISTORY_REFUSAL,
  SET_ASIDE_MESSAGE,
  asideActionFor,
  bringForwardAdvice,
```

Edit 2 of 5 — find:

```ts
  bringForwardAdvice,
  broughtForwardNote,
```

replace with:

```ts
  bringForwardAdvice,
  bringHistoryForwardConfirmation,
  broughtForwardNote,
```

Edit 3 of 5 — find:

```ts
  dayBefore,
  openingAdvice,
```

replace with:

```ts
  dayBefore,
  discardedMessage,
  discardedReturnPath,
  entriesCount,
  openingAdvice,
```

Edit 4 of 5 — find:

```ts
  reconciliationStandings,
  statementStandings,
```

replace with:

```ts
  reconciliationStandings,
  sessionHistoryAdvice,
  sessionHistoryRefusal,
  sessionHistoryStart,
  setAsideRefusal,
  statementStandings,
```

Edit 5 of 5 — find:

```ts
    expect(result).toEqual(statementStandings(lines, book, "2026-09-30"));
  });
});

```

replace with:

```ts
    expect(result).toEqual(statementStandings(lines, book, "2026-09-30"));
  });

  it("leaves a line set aside out of the pairing: it takes no book line and is not missing", () => {
    // Line 0 would pair with "a" by date and amount; set aside, it is not a transaction.
    const aside = lines.map((l) => (l.lineNo === 0 || l.lineNo === 2 ? { ...l, setAside: true } : l));
    const result = statementStandings(aside, book, "2026-09-30");
    expect(result.standings).toEqual([
      { kind: "aside" },
      { kind: "paired", how: "cheque number", bookId: "b", entryNumber: "BP-7", ticked: false },
      { kind: "aside" },
      { kind: "after" },
    ]);
    expect(result).toMatchObject({ paired: 1, missing: 0, after: 1, aside: 2, flipped: false });
    // The book line the set-aside line would have taken is outstanding again.
    expect(result.outstanding.sort()).toEqual(["a", "c"]);
  });

  it("carries a kept statement line's mark through to its standing", () => {
    const result = reconciliationStandings(
      { endingDate: "2026-09-30", lines: [{ lineNo: 0, txnDate: "2026-09-05", amountMinor: -1200, reference: null, setAside: true }] },
      [{ journalLineId: "a", entryDate: "2026-09-05", signedMinor: -1200, reference: null, entryNumber: "JE-1", cleared: true }],
    );
    expect(result.standings).toEqual([{ kind: "aside" }]);
    expect(result.outstanding).toEqual(["a"]);
  });
});

describe("setting a statement line aside", () => {
  it("refuses a line paired with the books, and allows any other — and bringing any line back", () => {
    const paired = { kind: "paired", how: "date and amount", bookId: "a", entryNumber: "JE-1", ticked: true } as const;
    expect(setAsideRefusal(paired, true)).toBe(PAIRED_LINE_REFUSAL);
    expect(PAIRED_LINE_REFUSAL).toBe("This line is paired with the books, so it is a transaction.");
    expect(setAsideRefusal({ kind: "missing" }, true)).toBeNull();
    expect(setAsideRefusal({ kind: "after" }, true)).toBeNull();
    expect(setAsideRefusal({ kind: "aside" }, true)).toBeNull();
    expect(setAsideRefusal(paired, false)).toBeNull();
    expect(setAsideRefusal(undefined, true)).toBeNull();
  });

  it("names the mark and the way back as the spec does", () => {
    expect([NOT_A_TRANSACTION, RESTORE_LINE]).toEqual(["Not a transaction", "Restore"]);
  });

  it("says, once a line is set aside, that its bank line stays in Bank Transactions", () => {
    expect(SET_ASIDE_MESSAGE).toBe(
      "Set aside as not a transaction. Its line stays in Bank Transactions — exclude it there if it is not real.",
    );
  });

  it("offers Not a transaction on a line the books do not have, Restore on one set aside, and nothing else", () => {
    expect(asideActionFor({ kind: "missing" })).toEqual({ label: "Not a transaction", aside: true });
    expect(asideActionFor({ kind: "aside" })).toEqual({ label: "Restore", aside: false });
    const paired = { kind: "paired", how: "date and amount", bookId: "a", entryNumber: "JE-1", ticked: false } as const;
    expect(asideActionFor(paired)).toBeNull();
    expect(asideActionFor({ kind: "after" })).toBeNull();
    expect(asideActionFor(undefined)).toBeNull();
  });

  it("never offers to set aside a line the server would refuse", () => {
    const standings = [
      { kind: "missing" },
      { kind: "aside" },
      { kind: "after" },
      { kind: "paired", how: "check number", bookId: "b", entryNumber: null, ticked: true },
    ] as const;
    for (const standing of standings) {
      const action = asideActionFor(standing);
      if (action) expect(setAsideRefusal(standing, action.aside), standing.kind).toBeNull();
    }
  });
});

describe("bringing the history forward from inside a reconciliation", () => {
  const session = { status: "in_progress", periodStart: "2026-09-01", openingMinor: 512340, beginningMinor: 0 };

  it("brings it forward through the day before the statement's period, at the balance the statement opens with", () => {
    expect(sessionHistoryRefusal(session)).toBeNull();
    expect(sessionHistoryStart(session)).toEqual({ through: "2026-08-31", openingMinor: 512340 });
  });

  it("offers nothing, and says why, when the session is done, its file names no start or opening, or it begins there already", () => {
    const cases = [
      [{ ...session, status: "completed" }, SESSION_HISTORY_REFUSAL.notInProgress],
      [{ ...session, periodStart: null, fileUnreadable: true }, SESSION_HISTORY_REFUSAL.unreadFile],
      [{ ...session, periodStart: null }, SESSION_HISTORY_REFUSAL.noStart],
      [{ ...session, openingMinor: null }, SESSION_HISTORY_REFUSAL.noStart],
      [{ ...session, beginningMinor: 512340 }, SESSION_HISTORY_REFUSAL.begins],
    ] as const;
    for (const [s, why] of cases) {
      expect(sessionHistoryRefusal(s)).toBe(why);
      expect(sessionHistoryStart(s)).toBeNull();
    }
  });

  const facts = { through: "2026-08-31", openingMinor: 512340, bookBalanceMinor: 512340, entries: 214, reconciled: false };

  it("offers the button when the books through that day hold exactly the opening", () => {
    expect(sessionHistoryAdvice(facts, money)).toEqual({
      canBringForward: true,
      through: "2026-08-31",
      entries: 214,
      text: "Everything in the books up to Aug 31, 2026 adds up to $5123.40, the balance this statement opens with.",
    });
  });

  it("says by how much the books are out, in either direction", () => {
    expect(sessionHistoryAdvice({ ...facts, bookBalanceMinor: 498765 }, money)).toMatchObject({
      canBringForward: false,
      text: "The books on Aug 31, 2026 read $4987.65; the statement opens at $5123.40. Out by $135.75.",
    });
    expect(sessionHistoryAdvice({ ...facts, bookBalanceMinor: 700000 }, money)?.text).toBe(
      "The books on Aug 31, 2026 read $7000.00; the statement opens at $5123.40. Out by $1876.60.",
    );
  });

  it("says the account was reconciled before, whatever the figures", () => {
    expect(sessionHistoryAdvice({ ...facts, reconciled: true }, money)).toMatchObject({
      canBringForward: false,
      text: "This account already has a completed reconciliation.",
    });
    expect(ALREADY_RECONCILED).toBe("This account already has a completed reconciliation.");
  });

  it("says nothing when there is nothing to offer, and offers no button with nothing to bring", () => {
    expect(sessionHistoryAdvice(null, money)).toBeNull();
    expect(sessionHistoryAdvice({ ...facts, entries: 0 }, money)?.canBringForward).toBe(false);
  });

  it("asks before marking, counting the entries", () => {
    expect(BRING_HISTORY_FORWARD).toBe("Bring the history forward");
    expect(bringHistoryForwardConfirmation(214, "2026-08-31")).toBe(
      "214 entries up to Aug 31, 2026 will be marked reconciled. Nothing is posted to the books.",
    );
    expect(bringHistoryForwardConfirmation(1, "2026-08-31")).toBe(
      "1 entry up to Aug 31, 2026 will be marked reconciled. Nothing is posted to the books.",
    );
    expect([entriesCount(0), entriesCount(1), entriesCount(1204)]).toEqual(["0 entries", "1 entry", "1,204 entries"]);
  });
});

describe("discarding a reconciliation", () => {
  it("says what goes and what stays, and returns to Reconcile", () => {
    expect(DISCARD_RECONCILIATION).toBe("Discard this reconciliation");
    expect(DISCARD_CONFIRMATION).toBe(
      "Its ticks are removed. The statement file and its bank lines stay, and any entries added to the books from it stay in the books.",
    );
    expect(discardedReturnPath("bank-1")).toBe("/banking/reconcile?account=bank-1");
  });

  it("says it was discarded, counting the ticks that went with it", () => {
    expect(discardedMessage(0)).toBe("Reconciliation discarded.");
    expect(discardedMessage(1)).toBe("Reconciliation discarded, with its 1 tick.");
    expect(discardedMessage(1204)).toBe("Reconciliation discarded, with its 1,204 ticks.");
  });
});

```

- [ ] **Step 2: Create `ctyhp-accounting/tests/unit/reconcile-difference.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import {
  DIFFERENCE_LABELS,
  bookLineName,
  differenceHeading,
  differenceHint,
  explainDifference,
  linesCount,
  openingPartText,
  statementLineName,
  type DifferenceBookLine,
  type DifferenceStatementLine,
} from "@/lib/domain/reconcile-difference";
import { reconciliationStandings } from "@/lib/domain/reconcile-statement";

const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;

type Line = DifferenceStatementLine & { reference: string | null };
type Book = DifferenceBookLine & { reference: string | null };

const sline = (lineNo: number, txnDate: string, amountMinor: number, description: string, setAside = false): Line => ({
  lineNo,
  txnDate,
  amountMinor,
  description,
  reference: null,
  setAside,
});
const bline = (id: string, entryDate: string, signedMinor: number, cleared: boolean, entryNumber: string | null = `JE-${id}`): Book => ({
  journalLineId: id,
  entryNumber,
  entryDate,
  signedMinor,
  cleared,
  reference: null,
});

/** The workspace's detail, worked out the way acc_reconciliation_detail works it out. */
function detailOf(beginningMinor: number, statementEndingMinor: number, book: readonly Book[]) {
  const clearedTotalMinor = book.filter((b) => b.cleared).reduce((sum, b) => sum + b.signedMinor, 0);
  return { beginningMinor, clearedTotalMinor, statementEndingMinor, differenceMinor: statementEndingMinor - (beginningMinor + clearedTotalMinor) };
}

function explain(opening: number | null, beginning: number, ending: number, lines: readonly Line[], book: readonly Book[]) {
  const standings = lines.length ? reconciliationStandings({ endingDate: "2026-09-30", lines }, book).standings : null;
  return explainDifference(
    { detail: detailOf(beginning, ending, book), statement: { openingMinor: opening, lines }, standings, book },
    money,
  );
}

describe("the difference, explained", () => {
  // An invented first reconciliation that began at 0 against a statement opening at $1,000.00.
  const lines = [
    sline(0, "2026-09-05", 50000, "EXAMPLE DEPOSIT"), // paired, ticked
    sline(1, "2026-09-10", -2000, "SERVICE FEE"), // not in the books
    sline(2, "2026-09-12", 30000, "EXAMPLE CLIENT PAYMENT"), // paired, not ticked
    sline(3, "2026-09-14", -7700, "MISREAD ROW", true), // set aside
    sline(4, "2026-10-02", 700, "AFTER THE DATE"), // after the statement date
  ];
  const book = [
    bline("d1", "2026-09-05", 50000, true),
    bline("d2", "2026-09-12", 30000, false),
    bline("t1", "2026-09-20", -1200, true, "JE-0031"), // ticked, on no statement line
    bline("u1", "2026-09-25", -999, false), // outstanding, not ticked
  ];
  // The statement proves itself: $1,000.00 + 500.00 − 20.00 + 300.00 = $1,780.00.
  const closing = 100000 + 50000 - 2000 + 30000;

  it("splits the difference into the opening, the lines the books lack, the ticks the statement lacks, and what is left", () => {
    const result = explain(100000, 0, closing, lines, book);
    // 1,780.00 − (0 + 500.00 − 12.00) = 1,292.00
    expect(result).toEqual({
      differenceMinor: 129200,
      opening: {
        beginningMinor: 0,
        openingMinor: 100000,
        amountMinor: 100000,
        text: "This reconciliation begins at $0.00; the statement opens at $1000.00.",
      },
      onStatement: { count: 1, amountMinor: -2000, ids: [1] },
      tickedNotOnStatement: { count: 1, amountMinor: -1200, ids: ["t1"] },
      // 1,292.00 − 1,000.00 − (−20.00) + (−12.00) = 300.00: the paired line not ticked.
      leftMinor: 30000,
      hint: "It equals the statement line “EXAMPLE CLIENT PAYMENT” of Sep 12, 2026 ($300.00). Check that one first.",
    });
  });

  it("leaves nothing to explain once that line is ticked", () => {
    const ticked = book.map((b) => (b.journalLineId === "d2" ? { ...b, cleared: true } : b));
    const result = explain(100000, 0, closing, lines, ticked);
    expect(result).toMatchObject({ differenceMinor: 99200, leftMinor: 0, hint: null });
  });

  it("says nothing when there is no difference", () => {
    const all = book.map((b) => (b.journalLineId === "u1" ? b : { ...b, cleared: true }));
    // Begins at the opening, and the statement's lines are all ticked or explained.
    expect(explain(100000, 100000, 100000 + 50000 + 30000 - 1200, lines, all)).toBeNull();
  });

  it("names a ticked book line when it is the one line the size of what is left", () => {
    // A statement that kept no lines: only the opening part and what is left.
    const ticked = [bline("k1", "2026-09-03", 45000, true, "JE-0101"), bline("k2", "2026-09-04", 5000, true, "JE-0102")];
    const result = explain(100000, 0, 195000, [], ticked);
    expect(result).toMatchObject({
      differenceMinor: 145000,
      opening: { amountMinor: 100000 },
      onStatement: null,
      tickedNotOnStatement: null,
      leftMinor: 45000,
      hint: "It equals JE-0101 of Sep 3, 2026 ($450.00). Check that one first.",
    });
  });

  it("names nothing when two lines are that size, or none is", () => {
    const twins = [bline("k1", "2026-09-03", 45000, true), bline("k2", "2026-09-04", -45000, true), bline("k3", "2026-09-05", 1000, true)];
    expect(explain(100000, 0, 100000 + 1000 + 45000, [], twins)).toMatchObject({ leftMinor: 45000, hint: null });
    expect(explain(100000, 0, 100000 + 1000 + 77, [], [bline("k3", "2026-09-05", 1000, true)])).toMatchObject({ leftMinor: 77, hint: null });
  });

  it("never names a line set aside, or a book line that is not ticked", () => {
    // What is left (77.00) is the size of the set-aside line and of an unticked book line only.
    const left = [sline(0, "2026-09-05", 7700, "MISREAD ROW", true)];
    const unticked = [bline("u", "2026-09-06", 7700, false)];
    expect(explain(null, 0, 7700, left, unticked)).toMatchObject({ leftMinor: 7700, hint: null });
  });

  it("shows no opening part when the statement's opening is unknown or where the reconciliation begins", () => {
    expect(explain(null, 0, 5000, [], [])).toMatchObject({ opening: null, leftMinor: 5000 });
    expect(explain(5000, 5000, 9000, [], [])).toMatchObject({ opening: null, leftMinor: 4000 });
  });

  it("without any statement, what is left is the whole difference", () => {
    const result = explainDifference(
      { detail: detailOf(0, 2500, []), statement: null, standings: null, book: [] },
      money,
    );
    expect(result).toEqual({
      differenceMinor: 2500,
      opening: null,
      onStatement: null,
      tickedNotOnStatement: null,
      leftMinor: 2500,
      hint: null,
    });
  });

  it("counts a statement line set aside or dated after the statement as neither missing nor left", () => {
    const result = explain(100000, 0, closing, lines, book)!;
    expect(result.onStatement?.ids).toEqual([1]);
  });
});

describe("the identity, on invented reconciliations", () => {
  /** A small deterministic generator, so the figures are invented and the run repeatable. */
  function seeded(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  it("difference = opening + on the statement − ticked here + left, and left is what the paired, unticked lines hold", () => {
    for (let run = 1; run <= 40; run++) {
      const rand = seeded(run);
      const lines: Line[] = [];
      const book: Book[] = [];
      let lineNo = 0;
      let amount = 1000 + run; // every amount distinct, so pairing is unambiguous
      const expected = { onStatement: 0, ticked: 0, left: 0, sumOnStatement: 0 };
      let closingLines = 0;
      for (let i = 0; i < 25; i++) {
        amount += 137;
        const signed = rand() < 0.5 ? -amount : amount;
        const day = `2026-09-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`;
        const kind = Math.floor(rand() * 6);
        if (kind === 0) {
          lines.push(sline(lineNo++, day, signed, `PAID ${i}`));
          book.push(bline(`p${i}`, day, signed, true));
          closingLines += signed;
        } else if (kind === 1) {
          lines.push(sline(lineNo++, day, signed, `PAID LATE ${i}`));
          book.push(bline(`q${i}`, day, signed, false));
          closingLines += signed;
          expected.left += signed;
        } else if (kind === 2) {
          lines.push(sline(lineNo++, day, signed, `MISSING ${i}`));
          closingLines += signed;
          expected.onStatement += 1;
          expected.sumOnStatement += signed;
        } else if (kind === 3) {
          lines.push(sline(lineNo++, day, signed, `MISREAD ${i}`, true));
        } else if (kind === 4) {
          book.push(bline(`t${i}`, day, signed, true));
          expected.ticked += signed;
        } else {
          book.push(bline(`u${i}`, day, signed, false));
        }
      }
      const opening = Math.floor(rand() * 500000);
      const beginning = rand() < 0.5 ? 0 : opening;
      const result = explain(opening, beginning, opening + closingLines, lines, book);
      const detail = detailOf(beginning, opening + closingLines, book);
      if (detail.differenceMinor === 0) {
        expect(result).toBeNull();
        continue;
      }
      expect(result).not.toBeNull();
      const r = result!;
      expect(r.onStatement?.count ?? 0).toBe(expected.onStatement);
      expect(r.onStatement?.amountMinor ?? 0).toBe(expected.sumOnStatement);
      expect(r.tickedNotOnStatement?.amountMinor ?? 0).toBe(expected.ticked);
      expect(r.leftMinor).toBe(expected.left);
      expect((r.opening?.amountMinor ?? 0) + (r.onStatement?.amountMinor ?? 0) - (r.tickedNotOnStatement?.amountMinor ?? 0) + r.leftMinor).toBe(
        detail.differenceMinor,
      );
    }
  });
});

describe("the sentences", () => {
  it("labels each part as the spec does", () => {
    expect(DIFFERENCE_LABELS).toEqual({
      opening: "Opening",
      onStatement: "On the statement, not in the books",
      tickedNotOnStatement: "Ticked here, not on the statement",
      left: "Left to explain",
    });
  });

  it("says where the reconciliation begins and where the statement opens", () => {
    expect(openingPartText(0, 100000, money)).toBe("This reconciliation begins at $0.00; the statement opens at $1000.00.");
  });

  it("names a line short", () => {
    expect(statementLineName({ description: "  SERVICE FEE ", txnDate: "2026-09-05" })).toBe("the statement line “SERVICE FEE” of Sep 5, 2026");
    expect(statementLineName({ description: "", txnDate: "2026-09-05" })).toBe("the statement line of Sep 5, 2026");
    expect(bookLineName({ entryNumber: "JE-000123", entryDate: "2026-09-05" })).toBe("JE-000123 of Sep 5, 2026");
    expect(bookLineName({ entryNumber: null, entryDate: "2026-09-05" })).toBe("the entry of Sep 5, 2026");
    expect(differenceHint("JE-000123 of Sep 5, 2026", -1200, money)).toBe("It equals JE-000123 of Sep 5, 2026 (-$12.00). Check that one first.");
  });

  it("heads the parts with the difference, and counts each part's lines", () => {
    expect(differenceHeading(13575, money)).toBe("The difference of $135.75, explained");
    expect(differenceHeading(-4800, money)).toBe("The difference of -$48.00, explained");
    expect([linesCount(0), linesCount(1), linesCount(2), linesCount(1204)]).toEqual(["0 lines", "1 line", "2 lines", "1,204 lines"]);
  });
});
```

- [ ] **Step 3: Create `ctyhp-accounting/tests/unit/reconcile-history.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import {
  FINISH_IN_PROGRESS_FIRST,
  HISTORY_STATE_LABELS,
  OPEN_IN_PROGRESS,
  RECONCILE_HISTORY,
  RECONCILE_HISTORY_PATH,
  STATEMENT_BALANCE_ON,
  booksReadText,
  bringForwardEntriesLabel,
  defaultHistoryAccount,
  historyAccounts,
  historyAdvice,
  historyBroughtForwardMessage,
  historyBroughtForwardNote,
  historyOutByText,
  inProgressText,
  reconciledUpTo,
  type ReconciliationHistoryRow,
} from "@/lib/domain/reconcile-history";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

const bank = (id: string, bankName: string, code: string, masked: string | null = null, accountName = "") => ({
  id,
  bank_name: bankName,
  account_name: accountName,
  account_code: code,
  account_number_masked: masked,
});
const row = (bankAccountId: string, over: Partial<ReconciliationHistoryRow> = {}): ReconciliationHistoryRow => ({
  bankAccountId,
  openLines: 0,
  firstOpenDate: null,
  lastOpenDate: null,
  lastReconciledDate: null,
  inProgress: null,
  ...over,
});

describe("historyAccounts", () => {
  it("names each account as Banking does, in Banking's order, with its state", () => {
    const rows = [
      row("b2", { openLines: 12, firstOpenDate: "2025-01-04", lastOpenDate: "2026-09-28", lastReconciledDate: "2026-08-31" }),
      row("b1", { openLines: 340, firstOpenDate: "2024-03-01", lastOpenDate: "2026-09-29", inProgress: { id: "r1", endingDate: "2026-09-30" } }),
    ];
    const accounts = historyAccounts(rows, [
      bank("b1", "Example Bank", "1010", "****1111"),
      bank("b2", "", "1020", null, "Example Savings"),
    ]);
    expect(accounts).toEqual([
      {
        ...rows[1],
        label: "Example Bank · 1010",
        maskedNumber: "****1111",
        state: "never",
      },
      {
        ...rows[0],
        label: "Example Savings · 1020",
        maskedNumber: null,
        state: "reconciled",
      },
    ]);
  });

  it("gives an account the history does not name yet nothing open, and leaves out a row for an account not listed", () => {
    const accounts = historyAccounts([row("hidden", { openLines: 5 })], [bank("new", "Example Bank", "")]);
    expect(accounts).toEqual([{ ...row("new"), label: "Example Bank", maskedNumber: null, state: "never" }]);
  });
});

describe("historyAdvice", () => {
  const never = { lastReconciledDate: null, inProgress: null };

  it("offers to bring the entries forward when the books read the statement's balance", () => {
    expect(historyAdvice(never, "2026-08-31", 512340, { bookBalanceMinor: 512340, entries: 214 }, money)).toEqual({
      kind: "match",
      text: "Books on Aug 31, 2026 read $5123.40 ✓",
      action: "Bring forward 214 entries",
      entries: 214,
      outByMinor: 0,
      inProgressId: null,
    });
    expect(historyAdvice(never, "2026-08-31", 1500, { bookBalanceMinor: 1500, entries: 1 }, money).action).toBe("Bring forward 1 entry");
  });

  it("offers no button when the books hold nothing through the date", () => {
    expect(historyAdvice(never, "2023-12-31", 0, { bookBalanceMinor: 0, entries: 0 }, money)).toMatchObject({
      kind: "match",
      text: "Books on Dec 31, 2023 read $0.00 ✓",
      action: null,
    });
  });

  it("says by how much they are out, in either direction", () => {
    expect(historyAdvice(never, "2026-08-31", 512340, { bookBalanceMinor: 498765, entries: 214 }, money)).toEqual({
      kind: "out",
      text: "Out by $135.75. Find the entry that differs, or try another statement.",
      action: null,
      entries: 214,
      outByMinor: 13575,
      inProgressId: null,
    });
    expect(historyAdvice(never, "2026-08-31", 498765, { bookBalanceMinor: 512340, entries: 214 }, money).outByMinor).toBe(13575);
  });

  it("asks for the session in progress to be finished first when it ends on or before the date", () => {
    const busy = { lastReconciledDate: null, inProgress: { id: "r1", endingDate: "2026-08-31" } };
    expect(historyAdvice(busy, "2026-08-31", 512340, { bookBalanceMinor: 512340, entries: 214 }, money)).toMatchObject({
      kind: "inProgress",
      text: "Finish or discard the reconciliation in progress first.",
      action: null,
      inProgressId: "r1",
    });
    // One that ends after the date is moved on by bringing the history forward, not in the way.
    const later = { lastReconciledDate: null, inProgress: { id: "r1", endingDate: "2026-09-30" } };
    expect(historyAdvice(later, "2026-08-31", 512340, { bookBalanceMinor: 512340, entries: 214 }, money).kind).toBe("match");
  });

  it("offers nothing on an account already reconciled, before anything else", () => {
    const done = { lastReconciledDate: "2026-07-31", inProgress: { id: "r1", endingDate: "2026-08-31" } };
    expect(historyAdvice(done, "2026-08-31", 1, { bookBalanceMinor: 2, entries: 3 }, money)).toMatchObject({
      kind: "reconciled",
      text: "Reconciled up to Jul 31, 2026",
      action: null,
    });
  });
});

describe("the history page's sentences", () => {
  it("are the spec's, character for character", () => {
    expect(booksReadText("2026-08-31", 512340, money)).toBe("Books on Aug 31, 2026 read $5123.40 ✓");
    expect(bringForwardEntriesLabel(1)).toBe("Bring forward 1 entry");
    expect(bringForwardEntriesLabel(1204)).toBe("Bring forward 1,204 entries");
    expect(historyOutByText(13575, money)).toBe("Out by $135.75. Find the entry that differs, or try another statement.");
    expect(reconciledUpTo("2026-08-31")).toBe("Reconciled up to Aug 31, 2026");
    expect(FINISH_IN_PROGRESS_FIRST).toBe("Finish or discard the reconciliation in progress first.");
  });

  it("keeps the statement balance and its date as the note of a reconciliation brought forward from the history page", () => {
    expect(historyBroughtForwardNote(512340, "2026-08-31", money)).toBe(
      "Brought forward, proved by the statement balance of $5123.40 on Aug 31, 2026",
    );
  });

  it("names the page, each state, the session in progress and the form's words", () => {
    expect(RECONCILE_HISTORY).toBe("Reconcile history");
    expect(RECONCILE_HISTORY_PATH).toBe("/banking/reconcile/history");
    expect(HISTORY_STATE_LABELS).toEqual({ never: "Never reconciled", reconciled: "Reconciled" });
    expect(inProgressText("2026-09-30")).toBe("In progress, ending Sep 30, 2026");
    expect(OPEN_IN_PROGRESS).toBe("Open the reconciliation in progress");
    expect(STATEMENT_BALANCE_ON).toBe("Statement balance on");
  });

  it("says how many entries were brought forward, nothing posted, and where a session in progress now begins", () => {
    expect(historyBroughtForwardMessage(214, "2026-08-31", null, money)).toBe(
      "Brought forward: 214 entries up to Aug 31, 2026 marked reconciled. Nothing was posted to the books.",
    );
    expect(historyBroughtForwardMessage(1, "2026-08-31", 512340, money)).toBe(
      "Brought forward: 1 entry up to Aug 31, 2026 marked reconciled. Nothing was posted to the books. " +
        "The reconciliation in progress now begins at $5123.40.",
    );
  });
});

describe("defaultHistoryAccount", () => {
  const account = (bankAccountId: string, state: "never" | "reconciled", openLines: number) => ({ bankAccountId, state, openLines });

  it("opens on the first account never reconciled that has lines to bring forward", () => {
    expect(
      defaultHistoryAccount([account("b1", "reconciled", 40), account("b2", "never", 0), account("b3", "never", 12), account("b4", "never", 9)]),
    ).toBe("b3");
  });

  it("falls back to the first never reconciled, then the first account, then none", () => {
    expect(defaultHistoryAccount([account("b1", "reconciled", 4), account("b2", "never", 0)])).toBe("b2");
    expect(defaultHistoryAccount([account("b1", "reconciled", 4), account("b2", "reconciled", 0)])).toBe("b1");
    expect(defaultHistoryAccount([])).toBeNull();
  });
});
```

- [ ] **Step 4: Edit `ctyhp-accounting/tests/unit/add-missing.test.ts`** — apply these 6 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 6 — find:

```ts
import {
  ADD_BLOCKED,
```

replace with:

```ts
import {
  ADD_ANYWAY,
  ADD_BLOCKED,
```

Edit 2 of 6 — find:

```ts
  CANNOT_ADD_NOTE,
  UNCATEGORIZED_WHY,
```

replace with:

```ts
  CANNOT_ADD_NOTE,
  EXTRA_LINE_NOTE,
  EXTRA_LINE_TAG,
  HELD_BACK_HEADING,
  UNCATEGORIZED_WHY,
```

Edit 3 of 6 — find:

```ts
  addedNotPairedMessage,
  planAddMissing,
```

replace with:

```ts
  addedNotPairedMessage,
  chooseLinesToAdd,
  duplicateNote,
  extraLineNos,
  extraStatementLines,
  linesToCheckForDuplicates,
  planAddMissing,
```

Edit 4 of 6 — find:

```ts
  type AddSuggestion,
} from "@/lib/domain/add-missing";
```

replace with:

```ts
  type AddSuggestion,
  type DuplicateMatch,
} from "@/lib/domain/add-missing";
```

Edit 5 of 6 — find:

```ts
    });
    expect(plan).toEqual({ missing: 1, items: [], cannot: [], uncategorized: 0, blocked: ADD_BLOCKED.flipped });
  });
```

replace with:

```ts
    });
    expect(plan).toEqual({ missing: 1, items: [], held: [], cannot: [], uncategorized: 0, blocked: ADD_BLOCKED.flipped });
  });
```

Edit 6 of 6 — find:

```ts
      planAddMissing({ lines: [deposit], standings: [paired], flipped: false, transactions: [], suggestions: new Map(), holding }),
    ).toEqual({ missing: 0, items: [], cannot: [], uncategorized: 0, blocked: null });
  });
```

replace with:

```ts
      planAddMissing({ lines: [deposit], standings: [paired], flipped: false, transactions: [], suggestions: new Map(), holding }),
    ).toEqual({ missing: 0, items: [], held: [], cannot: [], uncategorized: 0, blocked: null });
  });
});

describe("lines held back from Add all", () => {
  // The deposit pairs with the books; the shop and the fee do not.
  const lines = [deposit, shop, fee];
  const standings: Standing[] = [paired, missing, missing];
  const transactions = [txn("t-dep", deposit, { status: "matched" }), txn("t-shop", shop), txn("t-fee", fee)];
  const base = { lines, standings, flipped: false, transactions, suggestions: new Map([["t-fee", rule]]), holding };
  const match = (entryId: string, entryNumber: string | null, journalLineId = `${entryId}-l`): DuplicateMatch => ({
    journalLineId,
    entryId,
    entryNumber,
    entryDate: "2026-07-27",
  });

  it("holds back every missing line when the statement already balances on the paired lines", () => {
    // Opening $1,000.00 + the deposit $500.00 = the closing $1,500.00: the shop and the fee are extra.
    const plan = planAddMissing({ ...base, openingMinor: 100000, closingMinor: 150000 });
    expect(plan.items).toEqual([]);
    expect(plan.uncategorized).toBe(0);
    expect(plan.held.map((h) => [h.lineNo, h.reason, h.note, h.transactionId, h.accountId, h.matches])).toEqual([
      [2, "extra", EXTRA_LINE_NOTE, "t-shop", "uncat-out", []],
      [3, "extra", EXTRA_LINE_NOTE, "t-fee", "charges", []],
    ]);
    expect(EXTRA_LINE_NOTE).toBe("Extra — likely not a transaction: the statement already balances without it.");
    // Nothing is left for Add all, so the books are asked about nothing.
    expect(linesToCheckForDuplicates(plan)).toEqual([]);
  });

  it("holds nothing back when the statement needs the missing lines, or does not print both balances", () => {
    const needs = planAddMissing({ ...base, openingMinor: 100000, closingMinor: 150000 - 4200 - 1500 });
    expect([needs.items.map((i) => i.lineNo), needs.held]).toEqual([[2, 3], []]);
    expect(linesToCheckForDuplicates(needs)).toEqual([2, 3]);
    expect(planAddMissing({ ...base, openingMinor: null, closingMinor: 150000 }).held).toEqual([]);
    expect(planAddMissing({ ...base, openingMinor: 100000, closingMinor: null }).held).toEqual([]);
    expect(planAddMissing(base).held).toEqual([]);
  });

  it("holds back a line the books seem to hold already, naming the entry, and counts only the rest in Add all", () => {
    const plan = planAddMissing({ ...base, duplicates: new Map([[2, [match("e-310", "JE-000310")]]]) });
    expect(plan.items.map((i) => i.lineNo)).toEqual([3]);
    expect(plan.uncategorized).toBe(0);
    expect(plan.held).toEqual([
      {
        lineNo: 2,
        txnDate: shop.txnDate,
        description: shop.description,
        amountMinor: shop.amountMinor,
        transactionId: "t-shop",
        accountId: "uncat-out",
        accountLabel: holding.expense.label,
        source: "uncategorized",
        short: "",
        why: UNCATEGORIZED_WHY,
        reason: "duplicate",
        note: "Looks like JE-000310 already in the books.",
        matches: [match("e-310", "JE-000310")],
      },
    ]);
  });

  it("names the first entry and counts the others", () => {
    expect(duplicateNote([match("e1", "JE-000101")])).toBe("Looks like JE-000101 already in the books.");
    // Two lines of one entry are one entry.
    expect(
      duplicateNote([match("e1", "JE-000101", "a"), match("e1", "JE-000101", "b"), match("e2", "JE-000102"), match("e3", "JE-000103")]),
    ).toBe("Looks like JE-000101 and 2 more already in the books.");
    expect(duplicateNote([match("e9", null)])).toBe("Looks like an entry already in the books.");
  });

  it(`stops at more than ${ADD_MISSING_LIMIT} lines held back and added together`, () => {
    const many = Array.from({ length: ADD_MISSING_LIMIT + 1 }, (_, i) => line(i, "2026-07-30", -(i + 1), `FEE ${i}`));
    const plan = planAddMissing({
      lines: many,
      standings: many.map(() => missing),
      flipped: false,
      transactions: many.map((l, i) => txn(`t-${i}`, l)),
      suggestions: new Map(),
      holding,
      duplicates: new Map([[0, [match("e1", "JE-000101")]]]),
    });
    expect([plan.items.length, plan.held.length, plan.blocked]).toEqual([0, 0, ADD_BLOCKED.tooMany]);
    expect(linesToCheckForDuplicates(plan)).toEqual([]);
  });

  it("marks only the lines held back as extra in the statement lines table, never a likely duplicate", () => {
    expect(extraLineNos(planAddMissing({ ...base, openingMinor: 100000, closingMinor: 150000 }))).toEqual(new Set([2, 3]));
    expect(extraLineNos(planAddMissing({ ...base, duplicates: new Map([[2, [match("e-310", "JE-000310")]]]) }))).toEqual(new Set());
    expect(extraLineNos(null)).toEqual(new Set());
  });

  it("words the box's held lines as the screen shows them", () => {
    expect([EXTRA_LINE_TAG, HELD_BACK_HEADING, ADD_ANYWAY]).toEqual(["Extra", "Held back from Add all:", "Add anyway"]);
  });
});

describe("extra lines: the lines a statement balances without", () => {
  // An invented statement opening at $2,500.00. The deposit and the check pair
  // with the books. The fee is real and the books do not have it yet; the hold
  // was read from the PDF but is not a transaction, so the closing leaves it out.
  const aside: Standing = { kind: "aside" };
  const dep = line(1, "2026-09-04", 80000, "DEPOSIT 7001");
  const check = line(2, "2026-09-11", -12500, "CHECK 8101", "8101");
  const hold = line(3, "2026-09-17", -6400, "TEMPORARY AUTHORIZATION HOLD");
  const svc = line(4, "2026-09-30", -1800, "MONTHLY SERVICE FEE");
  const opening = 250000;
  const closing = opening + dep.amountMinor + check.amountMinor + svc.amountMinor;
  const lines = [dep, check, hold, svc];
  const standings: Standing[] = [paired, paired, missing, missing];
  const base = {
    lines,
    standings,
    flipped: false,
    transactions: [txn("t-dep", dep, { status: "matched" }), txn("t-check", check, { status: "matched" }), txn("t-hold", hold), txn("t-svc", svc)],
    suggestions: new Map([["t-svc", rule]]),
    holding,
    openingMinor: opening,
    closingMinor: closing,
  };

  it("holds back only the misread line when a real line is missing beside it, and leaves the fee in Add all 1", () => {
    // Opening + every line - closing = -64.00, the hold's amount and no other line's.
    expect(opening + 80000 - 12500 - 6400 - 1800 - closing).toBe(hold.amountMinor);
    expect(extraStatementLines(base)).toEqual(new Set([3]));
    const plan = planAddMissing(base);
    expect(plan.items.map((i) => [i.lineNo, i.transactionId, i.accountId])).toEqual([[4, "t-svc", "charges"]]);
    expect(plan.held.map((h) => [h.lineNo, h.reason, h.note, h.transactionId])).toEqual([[3, "extra", EXTRA_LINE_NOTE, "t-hold"]]);
    // The box and the statement lines table say the same thing.
    expect(extraLineNos(plan)).toEqual(new Set([3]));
    // The books are asked about the fee alone.
    expect(linesToCheckForDuplicates(plan)).toEqual([4]);
  });

  it("marks neither of two missing lines of the amount the statement is out by: exactly one is the rule", () => {
    const twin = line(5, "2026-09-18", -6400, "TEMPORARY AUTHORIZATION HOLD");
    const input = {
      ...base,
      lines: [...lines, twin],
      standings: [...standings, missing],
      transactions: [...base.transactions, txn("t-twin", twin)],
      // The statement holds one hold of -64.00; two were read.
      closingMinor: closing - 6400,
    };
    expect(opening + 80000 - 12500 - 6400 - 1800 - 6400 - input.closingMinor).toBe(-6400);
    expect(extraStatementLines(input)).toEqual(new Set());
    const plan = planAddMissing(input);
    expect(plan.held).toEqual([]);
    expect(plan.items.map((i) => i.lineNo)).toEqual([3, 4, 5]);
  });

  it("marks nothing when the statement proves itself", () => {
    const proves = { ...base, closingMinor: opening + 80000 - 12500 - 6400 - 1800 };
    expect(extraStatementLines(proves)).toEqual(new Set());
    expect(planAddMissing(proves).held).toEqual([]);
  });

  it("still marks every missing line when the statement balances on the paired lines alone", () => {
    const balances = { ...base, closingMinor: opening + 80000 - 12500 };
    expect(extraStatementLines(balances)).toEqual(new Set([3, 4]));
    expect(planAddMissing(balances).held.map((h) => [h.lineNo, h.reason])).toEqual([
      [3, "extra"],
      [4, "extra"],
    ]);
  });

  it("counts a line set aside for nothing, and never marks a line dated after the statement", () => {
    // The hold set aside: without it the statement proves itself, so the fee stays to be added.
    expect(extraStatementLines({ ...base, standings: [paired, paired, aside, missing] })).toEqual(new Set());
    // The hold dated after the statement is counted, but is not a line to mark; no other line is -64.00.
    expect(extraStatementLines({ ...base, standings: [paired, paired, after, missing] })).toEqual(new Set());
  });

  it("marks nothing without both balances, or with nothing missing", () => {
    expect(extraStatementLines({ ...base, openingMinor: null })).toEqual(new Set());
    expect(extraStatementLines({ ...base, closingMinor: undefined })).toEqual(new Set());
    expect(extraStatementLines({ ...base, standings: [paired, paired, paired, paired] })).toEqual(new Set());
  });
});

describe("chooseLinesToAdd", () => {
  const lines = [deposit, wire, shop, fee];
  const plan = planAddMissing({
    lines,
    standings: [missing, missing, missing, missing],
    flipped: false,
    transactions: lines.map((l, i) => txn(`t-${i}`, l)),
    suggestions: new Map([["t-3", rule]]),
    holding,
    duplicates: new Map([[2, [{ journalLineId: "jl", entryId: "e", entryNumber: "JE-000200", entryDate: "2026-07-28" }]]]),
  });
  const shown = (lineNo: number) => {
    const item = [...plan.items, ...plan.held].find((i) => i.lineNo === lineNo)!;
    return { lineNo, accountId: item.accountId };
  };

  it("takes the lines of Add all as they were shown, in statement order", () => {
    expect(plan.items.map((i) => i.lineNo)).toEqual([0, 1, 3]);
    expect(chooseLinesToAdd(plan, [shown(3), shown(0), shown(1)], [])?.map((i) => i.lineNo)).toEqual([0, 1, 3]);
    // A line of Add all may be asked for alone: each one is checked, and nothing unseen is added.
    expect(chooseLinesToAdd(plan, [shown(1)], [])?.map((i) => i.transactionId)).toEqual(["t-1"]);
  });

  it("takes a held-back line only when it was chosen with Add anyway", () => {
    expect(chooseLinesToAdd(plan, [shown(2)], [])).toBeNull();
    expect(chooseLinesToAdd(plan, [shown(2)], [2])?.map((i) => [i.lineNo, i.transactionId, i.accountId])).toEqual([[2, "t-2", "uncat-out"]]);
    // Add anyway names only held-back lines; it never lets in a line the plan does not hold.
    expect(chooseLinesToAdd(plan, [{ lineNo: 9, accountId: "uncat-out" }], [9])).toBeNull();
  });

  it("refuses a line posting to another account than shown, or asked for twice", () => {
    expect(chooseLinesToAdd(plan, [{ lineNo: 3, accountId: "uncat-out" }], [])).toBeNull();
    expect(chooseLinesToAdd(plan, [shown(0), shown(0)], [])).toBeNull();
  });
```

- [ ] **Step 5: Edit `ctyhp-accounting/tests/unit/reconciliation-statement-schemas.test.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
import { describe, expect, it } from "vitest";
import { reconciliationStatementSchema, runMonthSchema, runPreviewSchema } from "@/lib/domain/schemas";

```

replace with:

```ts
import { describe, expect, it } from "vitest";
import {
  historyBringForwardSchema,
  historyPreviewSchema,
  reconciliationDiscardSchema,
  reconciliationStatementSchema,
  runMonthSchema,
  runPreviewSchema,
  statementLineAsideSchema,
} from "@/lib/domain/schemas";

```

Edit 2 of 2 — find:

```ts
    expect(runPreviewSchema.safeParse({ ...preview, statements: [{ ...preview.statements[0], closing_minor: null }] }).success).toBe(false);
  });
});
```

replace with:

```ts
    expect(runPreviewSchema.safeParse({ ...preview, statements: [{ ...preview.statements[0], closing_minor: null }] }).success).toBe(false);
  });
});

describe("reconciliationDiscardSchema", () => {
  it("takes a reason, trimmed, and refuses none", () => {
    expect(reconciliationDiscardSchema.parse({ reason: "  Started on the wrong statement " })).toEqual({ reason: "Started on the wrong statement" });
    expect(firstIssue(reconciliationDiscardSchema.safeParse({ reason: "   " }))).toBe("A reason is required to discard a reconciliation");
    expect(reconciliationDiscardSchema.safeParse({ reason: "x".repeat(301) }).success).toBe(false);
  });
});

describe("historyBringForwardSchema and historyPreviewSchema", () => {
  const bring = { bank_account_id: BANK, through: "2026-08-31", balance_minor: 512340 };

  it("take an account, a real day and, to bring forward, a balance in whole cents", () => {
    expect(historyBringForwardSchema.safeParse(bring).success).toBe(true);
    expect(historyBringForwardSchema.safeParse({ ...bring, balance_minor: -2500 }).success).toBe(true);
    expect(historyPreviewSchema.safeParse({ bank_account_id: BANK, through: "2026-08-31" }).success).toBe(true);
  });

  it("refuse a day that does not exist, a balance in part-cents, and no account", () => {
    expect(firstIssue(historyBringForwardSchema.safeParse({ ...bring, through: "2026-02-30" }))).toBe("A statement date must be a real day");
    expect(firstIssue(historyBringForwardSchema.safeParse({ ...bring, balance_minor: 1.5 }))).toBe(
      "The statement balance must be a whole minor-unit amount",
    );
    expect(firstIssue(historyPreviewSchema.safeParse({ bank_account_id: "bank", through: "2026-08-31" }))).toBe("Select a bank account");
  });
});

describe("statementLineAsideSchema", () => {
  it("takes a line number and whether it is set aside or brought back", () => {
    expect(statementLineAsideSchema.safeParse({ line_no: 0, aside: true }).success).toBe(true);
    expect(statementLineAsideSchema.safeParse({ line_no: 7, aside: false }).success).toBe(true);
    expect(firstIssue(statementLineAsideSchema.safeParse({ line_no: -1, aside: true }))).toBe("Choose a statement line");
    expect(statementLineAsideSchema.safeParse({ line_no: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 6: Run the tests to see them fail**

```bash
npx vitest run tests/unit/reconcile-statement.test.ts tests/unit/reconcile-difference.test.ts tests/unit/reconcile-history.test.ts tests/unit/add-missing.test.ts tests/unit/reconciliation-statement-schemas.test.ts
```

Expected: FAIL — `lib/domain/reconcile-difference.ts` and `lib/domain/reconcile-history.ts` do not exist yet.

- [ ] **Step 7: Edit `ctyhp-accounting/lib/domain/reconcile-statement.ts`** — apply these 11 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 11 — find:

```ts

/** Said when the statement's closing balance is not the reconciliation's ending balance. */
```

replace with:

```ts

/** "1 entry", "1,204 entries". */
export function entriesCount(n: number): string {
  return n === 1 ? "1 entry" : `${n.toLocaleString("en-US")} entries`;
}

// --- Bringing the history forward from inside a reconciliation (2.03) --------

/** Where a reconciliation in progress would bring its account's history forward to. */
export interface SessionHistoryStart {
  /** The day before the kept statement's period: the last day brought forward. */
  through: string;
  /** The balance the statement opens with: what the books must hold through `through`. */
  openingMinor: number;
}

/** A reconciliation as bringing its history forward reads it. */
export interface HistorySession {
  status: string;
  /** The kept statement file's period start; null when there is no file, or it names none. */
  periodStart: string | null;
  /** A statement file is kept with the reconciliation, but this person may not open it (saved files need documents.read). */
  fileUnreadable?: boolean;
  /** The balance the statement opens with; null when it prints none. */
  openingMinor: number | null;
  /** Where the reconciliation begins. */
  beginningMinor: number;
}

export const SESSION_HISTORY_REFUSAL = {
  notInProgress: "Only a reconciliation in progress can bring the history forward.",
  unreadFile:
    "You cannot open the statement file kept with this reconciliation, so the history cannot be brought forward from here.",
  noStart:
    "The statement file kept with this reconciliation names no period start or no opening balance, so the history cannot be brought forward from here.",
  begins: "This reconciliation already begins at the balance its statement opens with.",
} as const;

/** Why a reconciliation cannot bring its account's history forward, or null when it can ask. */
export function sessionHistoryRefusal(session: HistorySession): string | null {
  if (session.status !== "in_progress") return SESSION_HISTORY_REFUSAL.notInProgress;
  if (session.fileUnreadable) return SESSION_HISTORY_REFUSAL.unreadFile;
  if (!session.periodStart || session.openingMinor === null) return SESSION_HISTORY_REFUSAL.noStart;
  if (session.beginningMinor === session.openingMinor) return SESSION_HISTORY_REFUSAL.begins;
  return null;
}

/**
 * The day before the period of the statement file kept with a reconciliation in
 * progress, and the balance that statement opens with. Null when there is
 * nothing to offer: the session is not in progress, its statement file names no
 * period start or no opening balance, or the session already begins at that
 * opening (sessionHistoryRefusal says which).
 */
export function sessionHistoryStart(session: HistorySession): SessionHistoryStart | null {
  if (sessionHistoryRefusal(session) || !session.periodStart || session.openingMinor === null) return null;
  return { through: dayBefore(session.periodStart), openingMinor: session.openingMinor };
}

/** What the server reads for a reconciliation's offer to bring the history forward. */
export interface SessionHistoryFacts extends SessionHistoryStart {
  /** The posted lines on the account through `through`, as the books hold them. */
  bookBalanceMinor: number;
  /** How many posted lines through `through` bringing the history forward marks reconciled. */
  entries: number;
  /** The account already has a completed reconciliation: the history cannot be brought forward. */
  reconciled: boolean;
}

export interface SessionHistoryAdvice {
  /** Offer the button: the books agree with the statement's opening, and there is history to bring. */
  canBringForward: boolean;
  through: string;
  entries: number;
  text: string;
}

export const BRING_HISTORY_FORWARD = "Bring the history forward";
export const ALREADY_RECONCILED = "This account already has a completed reconciliation.";

/**
 * What a reconciliation says about bringing its account's history forward: the
 * books through the day before the statement must hold exactly the balance the
 * statement opens with, and the account must never have been reconciled. Null
 * when there is nothing to say (sessionHistoryStart). `money` is the screen's
 * own formatter.
 */
export function sessionHistoryAdvice(
  facts: SessionHistoryFacts | null,
  money: (minor: number) => string,
): SessionHistoryAdvice | null {
  if (!facts) return null;
  const { through, openingMinor, bookBalanceMinor, entries } = facts;
  const date = shortDate(through, true);
  if (facts.reconciled) return { canBringForward: false, through, entries, text: ALREADY_RECONCILED };
  if (bookBalanceMinor !== openingMinor) {
    return {
      canBringForward: false,
      through,
      entries,
      text:
        `The books on ${date} read ${money(bookBalanceMinor)}; the statement opens at ${money(openingMinor)}. ` +
        `Out by ${money(Math.abs(bookBalanceMinor - openingMinor))}.`,
    };
  }
  return {
    canBringForward: entries > 0,
    through,
    entries,
    text: `Everything in the books up to ${date} adds up to ${money(openingMinor)}, the balance this statement opens with.`,
  };
}

/** The question Bring the history forward asks before it marks anything. */
export function bringHistoryForwardConfirmation(entries: number, through: string): string {
  return `${entriesCount(entries)} up to ${shortDate(through, true)} will be marked reconciled. Nothing is posted to the books.`;
}

// --- Discarding a reconciliation in progress (2.03) --------------------------

export const DISCARD_RECONCILIATION = "Discard this reconciliation";
export const DISCARD_CONFIRMATION =
  "Its ticks are removed. The statement file and its bank lines stay, and any entries added to the books from it stay in the books.";
/** Where the person goes once the reconciliation is discarded: Reconcile, on the same account. */
export function discardedReturnPath(bankAccountId: string): string {
  return `/banking/reconcile?account=${encodeURIComponent(bankAccountId)}`;
}

/** Said once a reconciliation is discarded: "Reconciliation discarded, with its 12 ticks." */
export function discardedMessage(ticksRemoved: number): string {
  if (ticksRemoved <= 0) return "Reconciliation discarded.";
  const ticks = ticksRemoved === 1 ? "1 tick" : `${ticksRemoved.toLocaleString("en-US")} ticks`;
  return `Reconciliation discarded, with its ${ticks}.`;
}

/** Said when the statement's closing balance is not the reconciliation's ending balance. */
```

Edit 2 of 11 — find:

```ts

export type Standing =
```

replace with:

```ts

/** A statement line as the standings take it: set aside, it is not a transaction and takes no part in pairing. */
export interface StandingStatementLine extends PairStatementLine {
  setAside?: boolean;
}

export type Standing =
```

Edit 3 of 11 — find:

```ts
  | { kind: "missing" }
  | { kind: "after" };

```

replace with:

```ts
  | { kind: "missing" }
  | { kind: "after" }
  /** Set aside as not a transaction (a misread line): never paired, never missing, never added. */
  | { kind: "aside" };

// --- A statement line set aside as not a transaction (2.03) ------------------

export const NOT_A_TRANSACTION = "Not a transaction";
export const RESTORE_LINE = "Restore";
export const PAIRED_LINE_REFUSAL = "This line is paired with the books, so it is a transaction.";
/**
 * Said once a line is set aside. Setting it aside changes the reconciliation
 * only: the bank line it was imported as stays waiting in Bank Transactions,
 * and the person is told so, since only they can say it is not real.
 */
export const SET_ASIDE_MESSAGE =
  "Set aside as not a transaction. Its line stays in Bank Transactions — exclude it there if it is not real.";

/**
 * Why a statement line cannot be set aside, or null when it can. A line the
 * books pair with is a transaction. Whether a line pairs is worked out here,
 * not stored, so this is the check the database cannot make. Bringing a line
 * back is always allowed.
 */
export function setAsideRefusal(standing: Standing | undefined, aside: boolean): string | null {
  return aside && standing?.kind === "paired" ? PAIRED_LINE_REFUSAL : null;
}

/** The one action a statement line offers on a reconciliation in progress, and what it asks for. */
export interface AsideAction {
  label: string;
  aside: boolean;
}

/**
 * What a statement line offers someone who can write: a line the books do not
 * have can be set aside as not a transaction, and a line set aside can be
 * restored. A paired line, or one dated after the statement, offers nothing.
 */
export function asideActionFor(standing: Standing | undefined): AsideAction | null {
  if (standing?.kind === "missing") return { label: NOT_A_TRANSACTION, aside: true };
  if (standing?.kind === "aside") return { label: RESTORE_LINE, aside: false };
  return null;
}

```

Edit 4 of 11 — find:

```ts
  missing: number;
  after: number;
  flipped: boolean;
  /** Book lines not on the statement. */
```

replace with:

```ts
  missing: number;
  after: number;
  /** Lines set aside as not a transaction. */
  aside: number;
  flipped: boolean;
  /** Book lines not on the statement. */
```

Edit 5 of 11 — find:

```ts

/** How each statement line stands with the books as they are now. */
export function statementStandings(
```

replace with:

```ts

/**
 * How each statement line stands with the books as they are now. A line set
 * aside is left out of the pairing altogether, so it can neither take a book
 * line nor be counted as missing.
 */
export function statementStandings(
```

Edit 6 of 11 — find:

```ts
export function statementStandings(
  lines: readonly PairStatementLine[],
  book: readonly StandingBookLine[],
```

replace with:

```ts
export function statementStandings(
  lines: readonly StandingStatementLine[],
  book: readonly StandingBookLine[],
```

Edit 7 of 11 — find:

```ts
): StatementStandings {
  const match = matchStatement(lines, book, statementDate);
  const byLine = new Map(match.pairs.map((pair) => [pair.line.lineNo, pair]));
```

replace with:

```ts
): StatementStandings {
  const taking = lines
    .filter((line) => !line.setAside)
    .map((line) => ({ lineNo: line.lineNo, date: line.date, amountMinor: line.amountMinor, reference: line.reference }));
  const match = matchStatement(taking, book, statementDate);
  const byLine = new Map(match.pairs.map((pair) => [pair.line.lineNo, pair]));
```

Edit 8 of 11 — find:

```ts
  const standings = lines.map((line): Standing => {
    if (line.date > statementDate) return { kind: "after" };
```

replace with:

```ts
  const standings = lines.map((line): Standing => {
    if (line.setAside) return { kind: "aside" };
    if (line.date > statementDate) return { kind: "after" };
```

Edit 9 of 11 — find:

```ts
    after: match.ignored,
    flipped: match.flipped,
```

replace with:

```ts
    after: match.ignored,
    aside: lines.length - taking.length,
    flipped: match.flipped,
```

Edit 10 of 11 — find:

```ts
    endingDate: string;
    lines: readonly { lineNo: number; txnDate: string; amountMinor: number; reference: string | null }[];
  },
```

replace with:

```ts
    endingDate: string;
    lines: readonly { lineNo: number; txnDate: string; amountMinor: number; reference: string | null; setAside?: boolean }[];
  },
```

Edit 11 of 11 — find:

```ts
  return statementStandings(
    statement.lines.map((l) => ({ lineNo: l.lineNo, date: l.txnDate, amountMinor: l.amountMinor, reference: l.reference })),
    book.map((b) => ({
```

replace with:

```ts
  return statementStandings(
    statement.lines.map((l) => ({
      lineNo: l.lineNo,
      date: l.txnDate,
      amountMinor: l.amountMinor,
      reference: l.reference,
      setAside: l.setAside ?? false,
    })),
    book.map((b) => ({
```

- [ ] **Step 8: Create `ctyhp-accounting/lib/domain/reconcile-difference.ts`** with exactly this content:

```ts
/**
 * The difference a reconciliation is out by, split into the parts that explain
 * it (2.03). It replaces the one figure "Unexplained difference":
 *
 *   difference = statement ending − (beginning + cleared)
 *
 * and when the statement was read in full (its opening plus its lines is its
 * closing), every term can be named:
 *
 *   opening part            the statement's opening − where this reconciliation begins;
 *   on the statement,       the statement lines the books do not have (standing
 *   not in the books        "missing"; a line set aside or dated after the
 *                           statement is not one);
 *   ticked here, not        ticked book lines no statement line pairs with;
 *   on the statement
 *   left to explain         difference − opening part − on the statement
 *                           + ticked here, not on the statement.
 *
 * What is left is, by construction, the paired lines whose book line is not
 * ticked, plus whatever the statement itself does not account for. When exactly
 * one line is that size, it is named. Pure: the screen holds every figure.
 */
import { shortDate } from "./pdf-statement-view";
import type { Standing } from "./reconcile-statement";

export const DIFFERENCE_LABELS = {
  opening: "Opening",
  onStatement: "On the statement, not in the books",
  tickedNotOnStatement: "Ticked here, not on the statement",
  left: "Left to explain",
} as const;

export interface DifferenceDetail {
  beginningMinor: number;
  clearedTotalMinor: number;
  statementEndingMinor: number;
  differenceMinor: number;
}

export interface DifferenceStatementLine {
  lineNo: number;
  txnDate: string;
  description: string;
  /** Positive is money in. */
  amountMinor: number;
  setAside?: boolean;
}

export interface DifferenceBookLine {
  journalLineId: string;
  entryNumber: string | null;
  entryDate: string;
  /** Positive is money into the bank. */
  signedMinor: number;
  cleared: boolean;
}

export interface OpeningPart {
  beginningMinor: number;
  openingMinor: number;
  /** The statement's opening − where this reconciliation begins. */
  amountMinor: number;
  text: string;
}

export interface LinesPart<Id> {
  count: number;
  /** Signed: positive is money in. */
  amountMinor: number;
  ids: Id[];
}

export interface DifferenceExplained {
  differenceMinor: number;
  /** Null when the statement's opening is not known or is where this reconciliation begins. */
  opening: OpeningPart | null;
  /** Null without a statement that has lines. The count may be 0. */
  onStatement: LinesPart<number> | null;
  /** Null without a statement that has lines. The count may be 0. */
  tickedNotOnStatement: LinesPart<string> | null;
  leftMinor: number;
  /** "It equals … Check that one first." when exactly one line is the size of what is left. */
  hint: string | null;
}

/** The heading over the parts: "The difference of $135.75, explained". */
export function differenceHeading(differenceMinor: number, money: (minor: number) => string): string {
  return `The difference of ${money(differenceMinor)}, explained`;
}

/** How many lines a part holds: "1 line", "1,204 lines". */
export function linesCount(n: number): string {
  return n === 1 ? "1 line" : `${n.toLocaleString("en-US")} lines`;
}

/** "This reconciliation begins at {Y}; the statement opens at {X}." */
export function openingPartText(beginningMinor: number, openingMinor: number, money: (minor: number) => string): string {
  return `This reconciliation begins at ${money(beginningMinor)}; the statement opens at ${money(openingMinor)}.`;
}

/** A statement line, named short: the statement line “SERVICE FEE” of Sep 5, 2026. */
export function statementLineName(line: { description: string; txnDate: string }): string {
  const words = line.description.trim();
  const date = shortDate(line.txnDate, true);
  return words ? `the statement line “${words}” of ${date}` : `the statement line of ${date}`;
}

/** A book line, named short: JE-000123 of Sep 5, 2026. */
export function bookLineName(line: { entryNumber: string | null; entryDate: string }): string {
  return `${line.entryNumber ?? "the entry"} of ${shortDate(line.entryDate, true)}`;
}

/** "It equals {line} ({amount}). Check that one first." */
export function differenceHint(name: string, amountMinor: number, money: (minor: number) => string): string {
  return `It equals ${name} (${money(amountMinor)}). Check that one first.`;
}

/**
 * The difference split into its parts. Null when there is no difference.
 * `standings` is one per statement line, in the same order
 * (reconciliationStandings). Without statement lines, only the opening part
 * (when the statement's opening is known) and what is left.
 */
export function explainDifference(
  input: {
    detail: DifferenceDetail;
    statement: { openingMinor: number | null; lines: readonly DifferenceStatementLine[] } | null;
    standings: readonly Standing[] | null;
    book: readonly DifferenceBookLine[];
  },
  money: (minor: number) => string,
): DifferenceExplained | null {
  const { detail, statement, book } = input;
  if (detail.differenceMinor === 0) return null;

  const openingMinor = statement?.openingMinor ?? null;
  const opening: OpeningPart | null =
    openingMinor !== null && openingMinor !== detail.beginningMinor
      ? {
          beginningMinor: detail.beginningMinor,
          openingMinor,
          amountMinor: openingMinor - detail.beginningMinor,
          text: openingPartText(detail.beginningMinor, openingMinor, money),
        }
      : null;

  const lines = statement?.lines ?? [];
  const standings = input.standings ?? [];
  let onStatement: LinesPart<number> | null = null;
  let tickedNotOnStatement: LinesPart<string> | null = null;
  if (lines.length) {
    const missing = lines.filter((_, i) => standings[i]?.kind === "missing");
    onStatement = {
      count: missing.length,
      amountMinor: missing.reduce((sum, line) => sum + line.amountMinor, 0),
      ids: missing.map((line) => line.lineNo),
    };
    const pairedIds = new Set(standings.flatMap((s) => (s.kind === "paired" ? [s.bookId] : [])));
    const unpaired = book.filter((line) => line.cleared && !pairedIds.has(line.journalLineId));
    tickedNotOnStatement = {
      count: unpaired.length,
      amountMinor: unpaired.reduce((sum, line) => sum + line.signedMinor, 0),
      ids: unpaired.map((line) => line.journalLineId),
    };
  }

  const leftMinor =
    detail.differenceMinor -
    (opening?.amountMinor ?? 0) -
    (onStatement?.amountMinor ?? 0) +
    (tickedNotOnStatement?.amountMinor ?? 0);

  let hint: string | null = null;
  if (leftMinor !== 0) {
    const size = Math.abs(leftMinor);
    const candidates = [
      ...lines
        .filter((line) => !line.setAside && Math.abs(line.amountMinor) === size)
        .map((line) => ({ name: statementLineName(line), amountMinor: line.amountMinor })),
      ...book
        .filter((line) => line.cleared && Math.abs(line.signedMinor) === size)
        .map((line) => ({ name: bookLineName(line), amountMinor: line.signedMinor })),
    ];
    if (candidates.length === 1) hint = differenceHint(candidates[0].name, candidates[0].amountMinor, money);
  }

  return { differenceMinor: detail.differenceMinor, opening, onStatement, tickedNotOnStatement, leftMinor, hint };
}
```

- [ ] **Step 9: Create `ctyhp-accounting/lib/domain/reconcile-history.ts`** with exactly this content:

```ts
/**
 * Reconcile history (2.03): every bank account with the posted lines no
 * completed reconciliation holds, and, for an account never reconciled, what
 * bringing its history forward through a date would do. The rule is the
 * database's (acc_bring_history_forward): the books through the date must hold
 * exactly the statement's balance on that date, the account must never have
 * been reconciled, and a session in progress must end after the date.
 *
 * Pure: the service reads acc_reconciliation_history, the bank accounts and
 * acc_brought_forward_preview; this merges them and writes the page's
 * sentences.
 */
import { shortDate } from "./pdf-statement-view";
import { entriesCount } from "./reconcile-statement";

/** One row of acc_reconciliation_history. */
export interface ReconciliationHistoryRow {
  bankAccountId: string;
  /** Posted lines no completed reconciliation holds; a tick in a session in progress still counts. */
  openLines: number;
  /** The first and last of their dates; null when there are none. */
  firstOpenDate: string | null;
  lastOpenDate: string | null;
  /** The latest completed reconciliation's ending date; null when the account was never reconciled. */
  lastReconciledDate: string | null;
  /** The session in progress, when there is one. */
  inProgress: { id: string; endingDate: string } | null;
}

/** A bank account as Banking lists it (listBankAccounts). */
export interface HistoryBankAccount {
  id: string;
  bank_name: string;
  account_name: string;
  account_code: string;
  account_number_masked: string | null;
}

/** Never reconciled: the history can be brought forward. Reconciled: it cannot. */
export type HistoryState = "never" | "reconciled";

export interface HistoryAccount extends ReconciliationHistoryRow {
  /** "Example Bank · 1010", as Banking and the reconciliation name the account. */
  label: string;
  maskedNumber: string | null;
  state: HistoryState;
}

const noHistory = (bankAccountId: string): ReconciliationHistoryRow => ({
  bankAccountId,
  openLines: 0,
  firstOpenDate: null,
  lastOpenDate: null,
  lastReconciledDate: null,
  inProgress: null,
});

/**
 * One row per bank account, in the order Banking lists them. An account the
 * history does not name yet (added a moment ago) has nothing open; a history
 * row for an account this person cannot see is left out.
 */
export function historyAccounts(rows: readonly ReconciliationHistoryRow[], banks: readonly HistoryBankAccount[]): HistoryAccount[] {
  const byAccount = new Map(rows.map((row) => [row.bankAccountId, row]));
  return banks.map((bank) => {
    const row = byAccount.get(bank.id) ?? noHistory(bank.id);
    return {
      ...row,
      label: [bank.bank_name || bank.account_name, bank.account_code].filter(Boolean).join(" · "),
      maskedNumber: bank.account_number_masked,
      state: row.lastReconciledDate ? "reconciled" : "never",
    };
  });
}

/** The page, and the link to it from the Reconcile start screen. */
export const RECONCILE_HISTORY = "Reconcile history";
export const RECONCILE_HISTORY_PATH = "/banking/reconcile/history";

/** How each account's state reads in the history table. */
export const HISTORY_STATE_LABELS: Record<HistoryState, string> = {
  never: "Never reconciled",
  reconciled: "Reconciled",
};

/** The session in progress, under the state: "In progress, ending Sep 30, 2026". */
export function inProgressText(endingDate: string): string {
  return `In progress, ending ${shortDate(endingDate, true)}`;
}

/** The link beside "Finish or discard the reconciliation in progress first." */
export const OPEN_IN_PROGRESS = "Open the reconciliation in progress";

/** The words of the form "Statement balance on {date} = {amount}", around its two fields. */
export const STATEMENT_BALANCE_ON = "Statement balance on";

/**
 * The account the page opens on: the first never reconciled that has lines to
 * bring forward, else the first never reconciled, else the first. Null with no
 * accounts.
 */
export function defaultHistoryAccount(accounts: readonly Pick<HistoryAccount, "bankAccountId" | "state" | "openLines">[]): string | null {
  const never = accounts.filter((account) => account.state === "never");
  return (never.find((account) => account.openLines > 0) ?? never[0] ?? accounts[0])?.bankAccountId ?? null;
}

/**
 * Said once the history is brought forward, from the history page or from
 * inside a reconciliation. `rebasedBeginsMinor` is where a reconciliation in
 * progress now begins, when bringing forward moved it; null when none did.
 */
export function historyBroughtForwardMessage(
  lines: number,
  through: string,
  rebasedBeginsMinor: number | null,
  money: (minor: number) => string,
): string {
  const done = `Brought forward: ${entriesCount(lines)} up to ${shortDate(through, true)} marked reconciled. Nothing was posted to the books.`;
  return rebasedBeginsMinor === null ? done : `${done} The reconciliation in progress now begins at ${money(rebasedBeginsMinor)}.`;
}

export const FINISH_IN_PROGRESS_FIRST = "Finish or discard the reconciliation in progress first.";

/** "Reconciled up to Aug 31, 2026" */
export function reconciledUpTo(date: string): string {
  return `Reconciled up to ${shortDate(date, true)}`;
}

/** "Books on Aug 31, 2026 read $5,000.00 ✓" */
export function booksReadText(through: string, bookBalanceMinor: number, money: (minor: number) => string): string {
  return `Books on ${shortDate(through, true)} read ${money(bookBalanceMinor)} ✓`;
}

/** "Bring forward 214 entries", "Bring forward 1 entry" */
export function bringForwardEntriesLabel(entries: number): string {
  return `Bring forward ${entriesCount(entries)}`;
}

/** "Out by $100.00. Find the entry that differs, or try another statement." */
export function historyOutByText(outByMinor: number, money: (minor: number) => string): string {
  return `Out by ${money(outByMinor)}. Find the entry that differs, or try another statement.`;
}

/** The note a reconciliation brought forward from the history page keeps. */
export function historyBroughtForwardNote(balanceMinor: number, through: string, money: (minor: number) => string): string {
  return `Brought forward, proved by the statement balance of ${money(balanceMinor)} on ${shortDate(through, true)}`;
}

/** What the books hold through a date, as acc_brought_forward_preview reads them. */
export interface HistoryPreview {
  bookBalanceMinor: number;
  /** Posted lines through the date: what bringing the history forward marks reconciled. */
  entries: number;
}

export type HistoryAdviceKind = "reconciled" | "inProgress" | "match" | "out";

export interface HistoryAdvice {
  kind: HistoryAdviceKind;
  text: string;
  /** The button, when it may be pressed: "Bring forward 3 entries". Null otherwise. */
  action: string | null;
  entries: number;
  /** How far the books are from the statement's balance; 0 unless `kind` is "out". */
  outByMinor: number;
  /** The session in progress to finish or discard first, when it is in the way. */
  inProgressId: string | null;
}

/**
 * The live preview under "Statement balance on {date} = {amount}", checked in
 * the order the database refuses: an account already reconciled, then a session
 * in progress that ends on or before the date, then the figures. A match with
 * nothing to bring offers no button: an empty brought-forward reconciliation
 * would only close the account to bringing its history forward later.
 */
export function historyAdvice(
  account: Pick<ReconciliationHistoryRow, "lastReconciledDate" | "inProgress">,
  through: string,
  balanceMinor: number,
  preview: HistoryPreview,
  money: (minor: number) => string,
): HistoryAdvice {
  const none = { action: null, entries: preview.entries, outByMinor: 0, inProgressId: null };
  if (account.lastReconciledDate) return { ...none, kind: "reconciled", text: reconciledUpTo(account.lastReconciledDate) };
  if (account.inProgress && account.inProgress.endingDate <= through) {
    return { ...none, kind: "inProgress", text: FINISH_IN_PROGRESS_FIRST, inProgressId: account.inProgress.id };
  }
  if (preview.bookBalanceMinor !== balanceMinor) {
    const outByMinor = Math.abs(preview.bookBalanceMinor - balanceMinor);
    return { ...none, kind: "out", text: historyOutByText(outByMinor, money), outByMinor };
  }
  return {
    ...none,
    kind: "match",
    text: booksReadText(through, preview.bookBalanceMinor, money),
    action: preview.entries > 0 ? bringForwardEntriesLabel(preview.entries) : null,
  };
}
```

- [ ] **Step 10: Edit `ctyhp-accounting/lib/domain/add-missing.ts`** — apply these 16 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 16 — find:

```ts
 * Uncategorized Income or Expense by its direction, to be recoded later. A line
 * that cannot be added says why. Pure: the service reads, this decides.
 */
```

replace with:

```ts
 * Uncategorized Income or Expense by its direction, to be recoded later. A line
 * that cannot be added says why.
 *
 * Two kinds of line are held back from "Add all N" (2.03), each with its own
 * "Add anyway": a line the statement balances without, since a line the bank
 * never had is likely a misread (extraStatementLines); and a line the books
 * seem to hold already (acc_statement_line_duplicates). Both are warnings, not
 * blocks: two identical lines on one day can both be real.
 *
 * Pure: the service reads, this decides.
 */
```

Edit 2 of 16 — find:

```ts

export interface AddMissingPlan {
```

replace with:

```ts

/** A posted line the books hold that a statement line may be (acc_statement_line_duplicates). */
export interface DuplicateMatch {
  journalLineId: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
}

export type HeldReason = "extra" | "duplicate";

/** A line that could be added, held back from "Add all N": the screen offers "Add anyway" for it alone. */
export interface HeldLine extends AddItem {
  reason: HeldReason;
  note: string;
  /** What the books already hold that it looks like; empty for an extra line. */
  matches: DuplicateMatch[];
}

export interface AddMissingPlan {
```

Edit 3 of 16 — find:

```ts
export interface AddMissingPlan {
  /** Statement lines the books do not have, dated on or before the statement date. */
  missing: number;
```

replace with:

```ts
export interface AddMissingPlan {
  /** Statement lines the books do not have, dated on or before the statement date (none set aside). */
  missing: number;
```

Edit 4 of 16 — find:

```ts
  missing: number;
  items: AddItem[];
```

replace with:

```ts
  missing: number;
  /** What "Add all N" adds: N is their count. */
  items: AddItem[];
```

Edit 5 of 16 — find:

```ts
  items: AddItem[];
  cannot: CannotAdd[];
```

replace with:

```ts
  items: AddItem[];
  /** Lines that could be added but are held back, each with why. */
  held: HeldLine[];
  cannot: CannotAdd[];
```

Edit 6 of 16 — find:

```ts
  blocked: string | null;
}
```

replace with:

```ts
  blocked: string | null;
}

export const EXTRA_LINE_NOTE = "Extra — likely not a transaction: the statement already balances without it.";
/** The tag beside a held-back extra line in the statement lines table. */
export const EXTRA_LINE_TAG = "Extra";
/** Above the lines held back, in the Add missing box. */
export const HELD_BACK_HEADING = "Held back from Add all:";
/** The button that posts one held-back line alone. */
export const ADD_ANYWAY = "Add anyway";

/**
 * The statement lines the statement balances without: likely not
 * transactions. Only a line the books do not have (`missing`) can be one; a
 * line set aside counts for nothing, and a line dated after the statement is
 * never marked. Both rules need the opening and the closing the statement
 * prints.
 *
 * 1. The statement already balances on the lines the books pair with (its
 *    opening plus its paired lines is its closing): every missing line is
 *    extra.
 * 2. Otherwise, when the statement does not prove itself — its opening plus
 *    all its lines not set aside misses its closing by some amount — and
 *    exactly one missing line is that amount, that line alone is extra. Without
 *    it the statement balances. Two lines of that amount could be either, so
 *    neither is marked; a real line missing from the books (a fee) beside the
 *    misread one stays to be added.
 *
 * The one place this is decided: planAddMissing holds these lines back, and
 * the statement lines table marks the lines the plan holds back.
 */
export function extraStatementLines(input: {
  lines: readonly Pick<AddStatementLine, "lineNo" | "amountMinor">[];
  /** One per line, in the same order (reconciliationStandings). */
  standings: readonly Standing[];
  openingMinor?: number | null;
  closingMinor?: number | null;
}): Set<number> {
  const opening = input.openingMinor ?? null;
  const closing = input.closingMinor ?? null;
  if (opening === null || closing === null) return new Set();
  const kindOf = (i: number) => input.standings[i]?.kind;
  const missing = input.lines.filter((_, i) => kindOf(i) === "missing");
  if (!missing.length) return new Set();

  const pairedMinor = input.lines.reduce((sum, line, i) => (kindOf(i) === "paired" ? sum + line.amountMinor : sum), 0);
  if (opening + pairedMinor === closing) return new Set(missing.map((line) => line.lineNo));

  const linesMinor = input.lines.reduce((sum, line, i) => (kindOf(i) === "aside" ? sum : sum + line.amountMinor), 0);
  const outMinor = opening + linesMinor - closing;
  if (outMinor === 0) return new Set();
  const theOne = missing.filter((line) => line.amountMinor === outMinor);
  return theOne.length === 1 ? new Set([theOne[0].lineNo]) : new Set();
}

/** The statement lines the plan holds back as extra, by line number; none without a plan. */
export function extraLineNos(plan: Pick<AddMissingPlan, "held"> | null): Set<number> {
  return new Set((plan?.held ?? []).filter((line) => line.reason === "extra").map((line) => line.lineNo));
}

/** "Looks like JE-000123 already in the books.", "Looks like JE-000123 and 2 more already in the books." */
export function duplicateNote(matches: readonly DuplicateMatch[]): string {
  const entries = [...new Map(matches.map((m) => [m.entryId, m])).values()];
  const first = entries[0]?.entryNumber ?? "an entry";
  const more = entries.length > 1 ? ` and ${entries.length - 1} more` : "";
  return `Looks like ${first}${more} already in the books.`;
}
```

Edit 7 of 16 — find:

```ts
  signedThrough?: string | null;
}): AddMissingPlan {
```

replace with:

```ts
  signedThrough?: string | null;
  /** The balances the statement prints; null when it prints none. */
  openingMinor?: number | null;
  closingMinor?: number | null;
  /** What the books already hold that each line may be, by line number. */
  duplicates?: ReadonlyMap<number, readonly DuplicateMatch[]>;
}): AddMissingPlan {
```

Edit 8 of 16 — find:

```ts
    items: [],
    cannot: [],
```

replace with:

```ts
    items: [],
    held: [],
    cannot: [],
```

Edit 9 of 16 — find:

```ts
  if (input.flipped) return empty(ADD_BLOCKED.flipped);

```

replace with:

```ts
  if (input.flipped) return empty(ADD_BLOCKED.flipped);

  // The lines the statement balances without are likely not transactions.
  const extra = extraStatementLines(input);

```

Edit 10 of 16 — find:

```ts
  const items: AddItem[] = [];
  const cannot: CannotAdd[] = [];
```

replace with:

```ts
  const items: AddItem[] = [];
  const held: HeldLine[] = [];
  const cannot: CannotAdd[] = [];
```

Edit 11 of 16 — find:

```ts
  const cannot: CannotAdd[] = [];
  for (const line of missingLines) {
```

replace with:

```ts
  const cannot: CannotAdd[] = [];
  const place = (item: AddItem) => {
    const matches = input.duplicates?.get(item.lineNo) ?? [];
    if (extra.has(item.lineNo)) held.push({ ...item, reason: "extra", note: EXTRA_LINE_NOTE, matches: [] });
    else if (matches.length) held.push({ ...item, reason: "duplicate", note: duplicateNote(matches), matches: [...matches] });
    else items.push(item);
  };
  for (const line of missingLines) {
```

Edit 12 of 16 — find:

```ts
    if (suggestion) {
      items.push({
        ...said,
```

replace with:

```ts
    if (suggestion) {
      place({
        ...said,
```

Edit 13 of 16 — find:

```ts
    if (!holding) return { ...empty(ADD_BLOCKED.noHolding), cannot };
    items.push({
      ...said,
```

replace with:

```ts
    if (!holding) return { ...empty(ADD_BLOCKED.noHolding), cannot };
    place({
      ...said,
```

Edit 14 of 16 — find:

```ts

  const blocked = items.length > ADD_MISSING_LIMIT ? ADD_BLOCKED.tooMany : null;
  return {
```

replace with:

```ts

  // One click adds at most the limit, whether through "Add all" or "Add anyway".
  const blocked = items.length + held.length > ADD_MISSING_LIMIT ? ADD_BLOCKED.tooMany : null;
  return {
```

Edit 15 of 16 — find:

```ts
    items: blocked ? [] : items,
    cannot,
```

replace with:

```ts
    items: blocked ? [] : items,
    held: blocked ? [] : held,
    cannot,
```

Edit 16 of 16 — find:

```ts
  };
}
```

replace with:

```ts
  };
}

/** The line numbers worth asking acc_statement_line_duplicates about: the ones "Add all N" would add. */
export function linesToCheckForDuplicates(plan: AddMissingPlan): number[] {
  return plan.blocked ? [] : plan.items.map((item) => item.lineNo);
}

/** A line the person asked to add, as the screen showed it: the line and the account it would post to. */
export interface ChosenLine {
  lineNo: number;
  accountId: string;
}

/**
 * The lines to post, as the plan worked out again on the server has them: each
 * one asked for must be in "Add all N", or held back and chosen with "Add
 * anyway", and post to the account the person was shown. Null when the plan no
 * longer says what the person saw — nothing is posted unseen.
 */
export function chooseLinesToAdd(
  plan: AddMissingPlan,
  chosen: readonly ChosenLine[],
  anyway: readonly number[],
): AddItem[] | null {
  const addAnyway = new Set(anyway);
  const byLine = new Map<number, AddItem>(plan.items.map((item) => [item.lineNo, item]));
  for (const line of plan.held) if (addAnyway.has(line.lineNo)) byLine.set(line.lineNo, line);
  const asked = new Set<number>();
  for (const line of chosen) {
    const item = byLine.get(line.lineNo);
    if (!item || item.accountId !== line.accountId || asked.has(line.lineNo)) return null;
    asked.add(line.lineNo);
  }
  // In statement order.
  return [...byLine.values()].filter((item) => asked.has(item.lineNo)).sort((a, b) => a.lineNo - b.lineNo);
}
```

- [ ] **Step 11: Edit `ctyhp-accounting/lib/domain/schemas.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts

// --- Company settings + accounting periods ---
```

replace with:

```ts

/** Discarding a reconciliation in progress (2.03): the reason is kept in the audit log. */
export const reconciliationDiscardSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to discard a reconciliation").max(300),
});
export type ReconciliationDiscardInput = z.infer<typeof reconciliationDiscardSchema>;

/** Bringing an account's history forward from Reconcile history (2.03): the statement's balance on a day. */
export const historyBringForwardSchema = z.object({
  bank_account_id: z.uuid("Select a bank account"),
  through: statementDay,
  balance_minor: z.number().int("The statement balance must be a whole minor-unit amount"),
});
export type HistoryBringForwardInput = z.infer<typeof historyBringForwardSchema>;

/** What the books hold on an account through a day: Reconcile history's live preview (2.03). */
export const historyPreviewSchema = z.object({
  bank_account_id: z.uuid("Select a bank account"),
  through: statementDay,
});
export type HistoryPreviewInput = z.infer<typeof historyPreviewSchema>;

/** Setting a statement line aside as not a transaction, or bringing it back (2.03). */
export const statementLineAsideSchema = z.object({
  line_no: z.number().int("Choose a statement line").nonnegative("Choose a statement line"),
  aside: z.boolean(),
});
export type StatementLineAsideInput = z.infer<typeof statementLineAsideSchema>;

// --- Company settings + accounting periods ---
```

- [ ] **Step 12: Edit `ctyhp-accounting/app/(app)/banking/reconcile/StandingTag.tsx`** — apply these 3 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 3 — find:

```tsx
import { Space, Tag, Typography } from "antd";
import { pairedHowLabel, type Standing } from "@/lib/domain/reconcile-statement";

```

replace with:

```tsx
import { Space, Tag, Typography } from "antd";
import { EXTRA_LINE_NOTE, EXTRA_LINE_TAG } from "@/lib/domain/add-missing";
import { NOT_A_TRANSACTION, pairedHowLabel, type Standing } from "@/lib/domain/reconcile-statement";

```

Edit 2 of 3 — find:

```tsx

/** How one statement line stands with the books — on a reconciliation, and in a run's preview. */
export default function StandingTag({ standing }: { standing: Standing }) {
  if (standing.kind === "after") return <Tag>After the statement date</Tag>;
```

replace with:

```tsx

/**
 * How one statement line stands with the books — on a reconciliation, and in a
 * run's preview. `extra` marks a line the books do not have that Add missing
 * lines holds back, because the statement already balances without it.
 */
export default function StandingTag({ standing, extra = false }: { standing: Standing; extra?: boolean }) {
  if (standing.kind === "aside") return <Tag>{NOT_A_TRANSACTION}</Tag>;
  if (standing.kind === "after") return <Tag>After the statement date</Tag>;
```

Edit 3 of 3 — find:

```tsx
  if (standing.kind === "after") return <Tag>After the statement date</Tag>;
  if (standing.kind === "missing") return <Tag color="orange">Not in the books</Tag>;
  return (
```

replace with:

```tsx
  if (standing.kind === "after") return <Tag>After the statement date</Tag>;
  if (standing.kind === "missing") {
    return (
      <Space size={4} wrap>
        <Tag color="orange">Not in the books</Tag>
        {extra ? (
          <Tag color="volcano" title={EXTRA_LINE_NOTE}>
            {EXTRA_LINE_TAG}
          </Tag>
        ) : null}
      </Space>
    );
  }
  return (
```

- [ ] **Step 13: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/reconcile-statement.test.ts" "tests/unit/reconcile-difference.test.ts" "tests/unit/reconcile-history.test.ts" "tests/unit/add-missing.test.ts" "tests/unit/reconciliation-statement-schemas.test.ts" "lib/domain/reconcile-statement.ts" "lib/domain/reconcile-difference.ts" "lib/domain/reconcile-history.ts" "lib/domain/add-missing.ts" "lib/domain/schemas.ts" "app/(app)/banking/reconcile/StandingTag.tsx"
npx vitest run tests/unit/reconcile-statement.test.ts tests/unit/reconcile-difference.test.ts tests/unit/reconcile-history.test.ts tests/unit/add-missing.test.ts tests/unit/reconciliation-statement-schemas.test.ts tests/unit/statement-bank-lines.test.ts tests/unit/bankrec-schema.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; reconcile-statement (30), reconcile-difference (14), reconcile-history (13), add-missing (30) and reconciliation-statement-schemas (16): 103 tests passing; statement-bank-lines (19) and bankrec-schema (3) pass.

- [ ] **Step 14: Commit**

```bash
git add "ctyhp-accounting/tests/unit/reconcile-statement.test.ts" "ctyhp-accounting/tests/unit/reconcile-difference.test.ts" "ctyhp-accounting/tests/unit/reconcile-history.test.ts" "ctyhp-accounting/tests/unit/add-missing.test.ts" "ctyhp-accounting/tests/unit/reconciliation-statement-schemas.test.ts" "ctyhp-accounting/lib/domain/reconcile-statement.ts" "ctyhp-accounting/lib/domain/reconcile-difference.ts" "ctyhp-accounting/lib/domain/reconcile-history.ts" "ctyhp-accounting/lib/domain/add-missing.ts" "ctyhp-accounting/lib/domain/schemas.ts" "ctyhp-accounting/app/(app)/banking/reconcile/StandingTag.tsx"
git commit -m "feat(reconcile): explain the difference in parts, set a misread line aside, hold back extra and likely duplicate lines from Add all, and word bringing the history forward"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 4: Services and actions — bring history forward, discard, set aside, history reads, and Add anyway

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/reconcile-history-service.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/add-missing-service.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/reconcile-history-actions.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/reconcile-statement-service.test.ts`
- Modify: `ctyhp-accounting/lib/services/bankrec.ts`
- Create: `ctyhp-accounting/lib/services/reconcile-history.ts`
- Modify: `ctyhp-accounting/lib/services/add-missing.ts`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/history-actions.ts`
- Modify: `ctyhp-accounting/app/(app)/banking/reconcile/statement-actions.ts`

**Interfaces:**
- Consumes: Task 1's functions; Task 3's domain names (above); existing `readAllPages`, `listBankAccounts`, `getBroughtForwardPreview`, `getUserRole` / `canWrite`.
- Produces:
  - `bankrec.ts`: `ReconStatementLine.setAside`; `KeptStatementFileRef.periodStart` / `periodEnd`.
  - `lib/services/reconcile-history.ts`: `discardReconciliation`, `bringHistoryForward`, `bringHistoryForwardFromSession` (day and balance read on the server), `getReconciliationHistory`, `getHistoryPreview`, `getSessionHistoryAdvice`, `setStatementLineAside` (refuses a paired line), `statementLineDuplicates`.
  - `history-actions.ts`: `discardReconciliationAction`, `bringHistoryForwardFromSessionAction`, `bringHistoryForwardAction`, `setStatementLineAsideAction` (writers only); `reconciliationHistoryAction`, `historyPreviewAction`, `sessionHistoryAdviceAction` (a viewer may read).
  - `addMissingLinesAction(reconciliationId, shown, anyway = [])`; `addMissingPlanAction` returns the plan with `held`.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/reconcile-history-service.test.ts`** with exactly this content:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The kept statement file is tied through lib/services/statement-files, a server module.
vi.mock("server-only", () => ({}));

import { PAIRED_LINE_REFUSAL, SESSION_HISTORY_REFUSAL } from "@/lib/domain/reconcile-statement";
import { BankRecError } from "@/lib/services/bankrec";
import {
  bringHistoryForward,
  bringHistoryForwardFromSession,
  discardReconciliation,
  getHistoryPreview,
  getReconciliationHistory,
  getSessionHistoryAdvice,
  readReconciliationHistory,
  setStatementLineAside,
  statementLineDuplicates,
} from "@/lib/services/reconcile-history";

/**
 * A stand-in for PostgREST: tables and table-returning RPCs page at a row cap
 * as PostgREST does; an RPC given as a function answers once with what it
 * returns, and every call is recorded with its arguments.
 */
type Rows = Record<string, unknown>[];
type Scalar = (args: Record<string, unknown> | undefined) => { data: unknown; error: { message: string } | null };

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows | Scalar>, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const orders: Record<string, string[]> = {};
  const ranges: Record<string, number> = {};
  function builder(target: string, rows: Rows) {
    orders[target] = [];
    const page = (from: number, to: number) => {
      ranges[target] = (ranges[target] ?? 0) + 1;
      return { data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq"]) chain[name] = () => chain;
    chain.order = (column: string) => {
      if (!orders[target].includes(column)) orders[target].push(column);
      return chain;
    };
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve(page(0, cap - 1));
    return chain;
  }
  const sb = {
    from: (table: string) => builder(table, tables[table] ?? []),
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = rpcs[fn];
      if (typeof answer === "function") return Promise.resolve(answer(args));
      return builder(`rpc:${fn}`, answer ?? []);
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders, ranges };
}

const ok = (data: unknown) => () => ({ data, error: null });
const refused = (message: string) => () => ({ data: null, error: { message } });

const historyRow = (i: number, over: Record<string, unknown> = {}) => ({
  bank_account_id: `bank-${String(i).padStart(4, "0")}`,
  open_lines: i,
  first_open_date: "2025-01-02",
  last_open_date: "2026-09-28",
  last_reconciled_date: null,
  in_progress_id: null,
  in_progress_ending_date: null,
  ...over,
});

describe("reconciliation history", () => {
  it("reads every row past the row cap, in a total order", async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => historyRow(i));
    rows[1] = historyRow(1, { in_progress_id: "rec-9", in_progress_ending_date: "2026-09-30", last_reconciled_date: "2026-07-31" });
    const { sb, orders, ranges } = fakeClient({}, { acc_reconciliation_history: rows });
    const history = await readReconciliationHistory(sb);
    expect(history).toHaveLength(2300);
    expect(ranges["rpc:acc_reconciliation_history"]).toBe(3);
    expect(orders["rpc:acc_reconciliation_history"]).toEqual(["bank_account_id"]);
    expect(history[0]).toEqual({
      bankAccountId: "bank-0000",
      openLines: 0,
      firstOpenDate: "2025-01-02",
      lastOpenDate: "2026-09-28",
      lastReconciledDate: null,
      inProgress: null,
    });
    expect(history[1]).toMatchObject({ lastReconciledDate: "2026-07-31", inProgress: { id: "rec-9", endingDate: "2026-09-30" } });
  });

  it("names and orders the rows as Banking lists the bank accounts", async () => {
    const { sb } = fakeClient(
      {
        acc_bank_account: [
          { id: "bank-0002", account_id: "gl-2", bank_name: "Example Bank", account_number_masked: "****2222", currency_code: "USD", created_at: "2026-01-01", acc_account: { account_code: "1020", name: "Operating" } },
          { id: "bank-0001", account_id: "gl-1", bank_name: "", account_number_masked: null, currency_code: "USD", created_at: "2026-02-01", acc_account: { account_code: "1010", name: "Example Savings" } },
        ],
      },
      { acc_reconciliation_history: [historyRow(1, { last_reconciled_date: "2026-08-31" }), historyRow(2)] },
    );
    const accounts = await getReconciliationHistory(sb);
    expect(accounts.map((a) => [a.bankAccountId, a.label, a.maskedNumber, a.state, a.openLines])).toEqual([
      ["bank-0002", "Example Bank · 1020", "****2222", "never", 2],
      ["bank-0001", "Example Savings · 1010", null, "reconciled", 1],
    ]);
  });

  it("previews the books through a day", async () => {
    const { sb, calls } = fakeClient({}, { acc_brought_forward_preview: [{ has_reconciliations: false, book_balance_minor: "512340", open_lines: 214 }] });
    expect(await getHistoryPreview(sb, "bank-1", "2026-08-31")).toEqual({ bookBalanceMinor: 512340, entries: 214 });
    expect(calls[0].args).toEqual({ p_bank_account_id: "bank-1", p_through: "2026-08-31" });
  });
});

describe("bringing the history forward", () => {
  const answer = { reconciliation_id: "rec-bf", lines: 214, moved: 3, rebased_reconciliation_id: "rec-1" };

  it("sends the day, the balance and the note, and reads what was made", async () => {
    const { sb, calls } = fakeClient({}, { acc_bring_history_forward: ok(answer) });
    expect(await bringHistoryForward(sb, "bank-1", "2026-08-31", 512340, "A note")).toEqual({
      reconciliationId: "rec-bf",
      lines: 214,
      moved: 3,
      rebasedReconciliationId: "rec-1",
    });
    expect(calls[0]).toEqual({
      fn: "acc_bring_history_forward",
      args: { p_bank_account_id: "bank-1", p_through: "2026-08-31", p_balance_minor: 512340, p_note: "A note" },
    });
  });

  it("passes the database's refusal on as it is", async () => {
    const message = "The books hold 4,987.65 on Aug 31, 2026; the statement shows 5,123.40. Out by 135.75.";
    const { sb } = fakeClient({}, { acc_bring_history_forward: refused(message) });
    await expect(bringHistoryForward(sb, "bank-1", "2026-08-31", 512340, "A note")).rejects.toThrow(new BankRecError(message));
  });

  // A reconciliation in progress, begun at 0, against a kept statement for September that opens at $5,123.40.
  const session = (file: Record<string, unknown> | null, over: Record<string, unknown> = {}) => ({
    bank_account_id: "bank-1",
    statement_ending_date: "2026-09-30",
    status: "in_progress",
    statement_ref: "september.pdf",
    statement_opening_minor: 512340,
    statement_closing_minor: 530000,
    note: null,
    brought_forward: false,
    statement_file_id: file ? "file-1" : null,
    statement_file: file,
    ...over,
  });
  const keptFile = { id: "file-1", file_name: "september.pdf", uploaded_at: "2026-10-02T10:00:00Z", sha256: "ab", period_start: "2026-09-01", period_end: "2026-09-30" };
  const detail = (beginning: number) => [
    { beginning_minor: beginning, statement_ending_minor: 530000, cleared_total_minor: 0, reconciled_balance_minor: beginning, difference_minor: 530000 - beginning, status: "in_progress" },
  ];

  it("from a reconciliation, takes the day and the balance from the stored statement, never from the screen", async () => {
    const { sb, calls } = fakeClient(
      { acc_statement_reconciliation: [session(keptFile)] },
      {
        acc_reconciliation_detail: detail(0),
        acc_bring_history_forward: ok(answer),
        acc_link_reconciliation_statement_file: ok(null),
      },
    );
    const result = await bringHistoryForwardFromSession(sb, "rec-1");
    expect(result).toEqual({ reconciliationId: "rec-bf", lines: 214, moved: 3, rebasedReconciliationId: "rec-1", fileWarning: null });
    expect(calls.find((c) => c.fn === "acc_bring_history_forward")?.args).toEqual({
      p_bank_account_id: "bank-1",
      p_through: "2026-08-31",
      p_balance_minor: 512340,
      p_note: "Brought forward, proved by the opening balance on the statement for Sep 1 – Sep 30, 2026",
    });
    // The statement's file is the new reconciliation's evidence too.
    expect(calls.find((c) => c.fn === "acc_link_reconciliation_statement_file")?.args).toEqual({
      p_reconciliation_id: "rec-bf",
      p_file_id: "file-1",
    });
  });

  it("says, rather than undoes, a file that could not be tied", async () => {
    const { sb } = fakeClient(
      { acc_statement_reconciliation: [session(keptFile)] },
      {
        acc_reconciliation_detail: detail(0),
        acc_bring_history_forward: ok(answer),
        acc_link_reconciliation_statement_file: refused("connection lost"),
      },
    );
    const result = await bringHistoryForwardFromSession(sb, "rec-1");
    expect(result.reconciliationId).toBe("rec-bf");
    expect(result.fileWarning).toContain("connection lost");
  });

  it("refuses, and asks the database nothing, when the file names no period or the session already begins at the opening", async () => {
    const cases = [
      [session({ ...keptFile, period_start: null }), detail(0), SESSION_HISTORY_REFUSAL.noStart],
      [session(null), detail(0), SESSION_HISTORY_REFUSAL.noStart],
      // A file is kept, but this person may not read saved files, so the embed comes back empty.
      [session(null, { statement_file_id: "file-1" }), detail(0), SESSION_HISTORY_REFUSAL.unreadFile],
      [session(keptFile, { statement_opening_minor: null }), detail(0), SESSION_HISTORY_REFUSAL.noStart],
      [session(keptFile), detail(512340), SESSION_HISTORY_REFUSAL.begins],
      [session(keptFile, { status: "completed" }), detail(0), SESSION_HISTORY_REFUSAL.notInProgress],
    ] as const;
    for (const [row, d, why] of cases) {
      const { sb, calls } = fakeClient(
        { acc_statement_reconciliation: [row] },
        { acc_reconciliation_detail: [...d], acc_bring_history_forward: ok(answer) },
      );
      await expect(bringHistoryForwardFromSession(sb, "rec-1")).rejects.toThrow(why);
      expect(calls.map((c) => c.fn)).not.toContain("acc_bring_history_forward");
    }
  });

  it("tells the workspace what its offer rests on, read on the server", async () => {
    const { sb, calls } = fakeClient(
      { acc_statement_reconciliation: [session(keptFile)] },
      {
        acc_reconciliation_detail: detail(0),
        acc_reconciliation_history: [historyRow(1, { bank_account_id: "bank-1" }), historyRow(2, { last_reconciled_date: "2026-08-31" })],
        acc_brought_forward_preview: [{ has_reconciliations: true, book_balance_minor: 498765, open_lines: 214 }],
      },
    );
    expect(await getSessionHistoryAdvice(sb, "rec-1")).toEqual({
      through: "2026-08-31",
      openingMinor: 512340,
      bookBalanceMinor: 498765,
      entries: 214,
      reconciled: false,
    });
    expect(calls.find((c) => c.fn === "acc_brought_forward_preview")?.args).toEqual({ p_bank_account_id: "bank-1", p_through: "2026-08-31" });
  });

  it("says the account was reconciled before when the history has a completed reconciliation", async () => {
    const { sb } = fakeClient(
      { acc_statement_reconciliation: [session(keptFile)] },
      {
        acc_reconciliation_detail: detail(0),
        acc_reconciliation_history: [historyRow(1, { bank_account_id: "bank-1", last_reconciled_date: "2026-08-31" })],
        acc_brought_forward_preview: [{ has_reconciliations: true, book_balance_minor: 512340, open_lines: 0 }],
      },
    );
    expect((await getSessionHistoryAdvice(sb, "rec-1"))?.reconciled).toBe(true);
  });

  it("offers nothing, and reads nothing more, for a session with no kept statement file", async () => {
    const { sb, calls } = fakeClient({ acc_statement_reconciliation: [session(null)] }, { acc_reconciliation_detail: detail(0) });
    expect(await getSessionHistoryAdvice(sb, "rec-1")).toBeNull();
    expect(calls.map((c) => c.fn)).toEqual(["acc_reconciliation_detail"]);
  });
});

describe("discarding a reconciliation", () => {
  it("sends the reason and says how many ticks went with it", async () => {
    const { sb, calls } = fakeClient({}, { acc_discard_reconciliation: ok(7) });
    expect(await discardReconciliation(sb, "rec-1", "Started on the wrong statement")).toBe(7);
    expect(calls[0].args).toEqual({ p_reconciliation_id: "rec-1", p_reason: "Started on the wrong statement" });
  });

  it("passes the database's refusal on as it is", async () => {
    const message = "This reconciliation posted an adjustment (JE-000999), so it cannot be discarded.";
    const { sb } = fakeClient({}, { acc_discard_reconciliation: refused(message) });
    await expect(discardReconciliation(sb, "rec-1", "Wrong")).rejects.toThrow(message);
  });
});

describe("setting a statement line aside", () => {
  const session = {
    bank_account_id: "bank-1",
    statement_ending_date: "2026-09-30",
    status: "in_progress",
    statement_ref: "september.pdf",
    statement_opening_minor: 100000,
    statement_closing_minor: 150000,
    note: null,
    brought_forward: false,
    statement_file_id: null,
    statement_file: null,
  };
  const statementLines = [
    { line_no: 0, txn_date: "2026-09-05", description: "EXAMPLE DEPOSIT", reference: null, amount_minor: 50000, balance_minor: null, set_aside: false },
    { line_no: 1, txn_date: "2026-09-08", description: "4101 4102", reference: "4101", amount_minor: -36000, balance_minor: null, set_aside: false },
  ];
  const book = [
    { journal_line_id: "jl-dep", entry_id: "e-dep", entry_number: "JE-000101", entry_date: "2026-09-05", source_type: "manual", memo: null, signed_minor: 50000, cleared: true, reference: null },
  ];
  const tables = { acc_statement_reconciliation: [session], acc_reconciliation_statement_line: statementLines };

  it("refuses a line paired with the books, without asking the database to set it aside", async () => {
    const { sb, calls } = fakeClient(tables, { acc_reconciliation_lines: book, acc_set_statement_line_aside: ok(null) });
    await expect(setStatementLineAside(sb, "rec-1", 0, true)).rejects.toThrow(PAIRED_LINE_REFUSAL);
    expect(calls.map((c) => c.fn)).not.toContain("acc_set_statement_line_aside");
  });

  it("sets aside a line the books do not have", async () => {
    const { sb, calls } = fakeClient(tables, { acc_reconciliation_lines: book, acc_set_statement_line_aside: ok(null) });
    await setStatementLineAside(sb, "rec-1", 1, true);
    expect(calls.find((c) => c.fn === "acc_set_statement_line_aside")?.args).toEqual({
      p_reconciliation_id: "rec-1",
      p_line_no: 1,
      p_aside: true,
    });
  });

  it("always brings a line back, without working out the pairing", async () => {
    const { sb, calls } = fakeClient(tables, { acc_reconciliation_lines: book, acc_set_statement_line_aside: ok(null) });
    await setStatementLineAside(sb, "rec-1", 0, false);
    expect(calls.map((c) => c.fn)).toEqual(["acc_set_statement_line_aside"]);
  });

  it("passes the database's refusal on as it is", async () => {
    const { sb } = fakeClient(tables, { acc_reconciliation_lines: book, acc_set_statement_line_aside: refused("Statement line not found") });
    await expect(setStatementLineAside(sb, "rec-1", 9, true)).rejects.toThrow("Statement line not found");
  });
});

describe("statementLineDuplicates", () => {
  const dup = (lineNo: number, id: string, entry: string, number: string | null = `JE-${entry}`) => ({
    line_no: lineNo,
    journal_line_id: id,
    entry_id: entry,
    entry_number: number,
    entry_date: "2026-09-08",
  });

  it("asks nothing, and finds nothing, when no line is given", async () => {
    const { sb, calls } = fakeClient({}, { acc_statement_line_duplicates: [dup(1, "jl-1", "e1")] });
    expect((await statementLineDuplicates(sb, "rec-1", [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("groups what the books hold by statement line, reading every page in a total order", async () => {
    const many = Array.from({ length: 2300 }, (_, i) => dup(2, `jl-${String(i).padStart(4, "0")}`, `e${i}`));
    const { sb, calls, orders } = fakeClient({}, { acc_statement_line_duplicates: [dup(1, "jl-a", "e-a", null), ...many] });
    const found = await statementLineDuplicates(sb, "rec-1", [2, 1, 2]);
    expect(calls[0].args).toEqual({ p_reconciliation_id: "rec-1", p_line_nos: [2, 1] });
    expect(orders["rpc:acc_statement_line_duplicates"]).toEqual(["line_no", "entry_date", "entry_number", "journal_line_id"]);
    expect(found.get(1)).toEqual([{ journalLineId: "jl-a", entryId: "e-a", entryNumber: null, entryDate: "2026-09-08" }]);
    expect(found.get(2)).toHaveLength(2300);
  });
});
```

- [ ] **Step 2: Create `ctyhp-accounting/tests/unit/add-missing-service.test.ts`** with exactly this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  listSuggestions: vi.fn(),
  codingSuggestions: vi.fn(),
  listAccounts: vi.fn(),
  bankLinesBetween: vi.fn(),
}));
vi.mock("@/lib/services/banking", () => ({ listSuggestions: mocks.listSuggestions, listBankAccounts: vi.fn() }));
vi.mock("@/lib/services/coding", () => ({ codingSuggestions: mocks.codingSuggestions }));
vi.mock("@/lib/services/accounts", () => ({ listAccounts: mocks.listAccounts }));
vi.mock("@/lib/services/statement-bank-lines", () => ({ bankLinesBetween: mocks.bankLinesBetween }));

import { EXTRA_LINE_NOTE } from "@/lib/domain/add-missing";
import { AddMissingError, PLAN_CHANGED, addMissingLines, getAddMissingPlan } from "@/lib/services/add-missing";

/**
 * A stand-in for PostgREST: tables and table-returning RPCs page at a row cap;
 * an RPC given as a function answers with what it returns. Every RPC call is
 * recorded with its arguments.
 */
type Rows = Record<string, unknown>[];
type Scalar = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows | Scalar>, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  function builder(rows: Rows) {
    const page = (from: number, to: number) => ({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null });
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order"]) chain[name] = () => chain;
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve(page(0, cap - 1));
    return chain;
  }
  const sb = {
    from: (table: string) => builder(tables[table] ?? []),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = rpcs[fn];
      if (typeof answer === "function") return Promise.resolve(answer(args));
      return builder(answer ?? []);
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const CHARGES = "11111111-1111-4111-8111-111111111111";
const UNCAT_OUT = "22222222-2222-4222-8222-222222222222";
const UNCAT_IN = "33333333-3333-4333-8333-333333333333";

// An invented September statement: the deposit is in the books; a shop payment and a fee are not.
const session = (closing: number | null) => ({
  id: "rec-1",
  bank_account_id: "bank-1",
  statement_ending_date: "2026-09-30",
  status: "in_progress",
  statement_ref: "september.pdf",
  statement_opening_minor: 100000,
  statement_closing_minor: closing,
  note: null,
  brought_forward: false,
  statement_file_id: null,
  statement_file: null,
});
const statementLines = [
  { line_no: 1, txn_date: "2026-09-05", description: "EXAMPLE DEPOSIT", reference: null, amount_minor: 50000, balance_minor: null, set_aside: false },
  { line_no: 2, txn_date: "2026-09-12", description: "POS EXAMPLE SHOP", reference: null, amount_minor: -4200, balance_minor: null, set_aside: false },
  { line_no: 3, txn_date: "2026-09-25", description: "SERVICE FEE", reference: null, amount_minor: -1500, balance_minor: null, set_aside: false },
];
const book = [
  { journal_line_id: "jl-dep", entry_id: "e-dep", entry_number: "JE-000101", entry_date: "2026-09-05", source_type: "manual", memo: null, signed_minor: 50000, cleared: true, reference: null },
];
// The statement needs both lines: $1,000.00 + 500.00 − 42.00 − 15.00.
const PROVES = 100000 + 50000 - 4200 - 1500;
// The statement balances on the deposit alone: the shop and the fee are extra.
const BALANCES_WITHOUT = 100000 + 50000;

function client(closing: number | null, duplicates: Rows = [], lines = statementLines) {
  return fakeClient(
    { acc_statement_reconciliation: [session(closing)], acc_reconciliation_statement_line: lines },
    {
      acc_reconciliation_lines: book,
      acc_statement_line_duplicates: duplicates,
      acc_add_statement_lines_to_books: () => ({ data: null, error: null }),
      acc_set_cleared_many: (args) => ({ data: (args.p_journal_line_ids as string[]).length, error: null }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bankLinesBetween.mockResolvedValue([
    { id: "t-shop", txnDate: "2026-09-12", description: "POS EXAMPLE SHOP", reference: null, amountMinor: -4200, status: "unmatched", approvedLineId: null },
    { id: "t-fee", txnDate: "2026-09-25", description: "SERVICE FEE", reference: null, amountMinor: -1500, status: "unmatched", approvedLineId: null },
  ]);
  mocks.listSuggestions.mockResolvedValue([]);
  mocks.codingSuggestions.mockResolvedValue([
    { transactionId: "t-fee", accountId: CHARGES, accountLabel: "6400 — Bank Charges", source: "rule", short: "Rule 1", why: "Rule 1: SERVICE FEE" },
  ]);
  mocks.listAccounts.mockResolvedValue([
    { id: UNCAT_IN, account_code: "4999", name: "Uncategorized Income", detail_type: "uncategorized_income", status: "active" },
    { id: UNCAT_OUT, account_code: "6999", name: "Uncategorized Expense", detail_type: "uncategorized_expense", status: "active" },
  ]);
});

describe("the Add missing plan", () => {
  it("asks the books about the lines Add all would add, and holds back the one they seem to hold", async () => {
    const { sb, calls } = client(PROVES, [
      { line_no: 2, journal_line_id: "jl-old", entry_id: "e-old", entry_number: "JE-000310", entry_date: "2026-09-10" },
    ]);
    const plan = await getAddMissingPlan(sb, "rec-1");
    expect(calls.find((c) => c.fn === "acc_statement_line_duplicates")?.args).toEqual({ p_reconciliation_id: "rec-1", p_line_nos: [2, 3] });
    expect(plan.items.map((i) => [i.lineNo, i.accountId])).toEqual([[3, CHARGES]]);
    expect(plan.held.map((h) => [h.lineNo, h.reason, h.note, h.accountId])).toEqual([
      [2, "duplicate", "Looks like JE-000310 already in the books.", UNCAT_OUT],
    ]);
    expect(plan.uncategorized).toBe(0);
  });

  it("holds back every missing line when the statement balances without them, and asks the books nothing", async () => {
    const { sb, calls } = client(BALANCES_WITHOUT);
    const plan = await getAddMissingPlan(sb, "rec-1");
    expect(plan.items).toEqual([]);
    expect(plan.held.map((h) => [h.lineNo, h.reason, h.note])).toEqual([
      [2, "extra", EXTRA_LINE_NOTE],
      [3, "extra", EXTRA_LINE_NOTE],
    ]);
    expect(calls.map((c) => c.fn)).not.toContain("acc_statement_line_duplicates");
  });

  it("asks the books nothing when nothing is missing, or every missing line is set aside", async () => {
    const aside = statementLines.map((l) => (l.line_no === 1 ? l : { ...l, set_aside: true }));
    const { sb, calls } = client(PROVES, [], aside);
    const plan = await getAddMissingPlan(sb, "rec-1");
    expect([plan.missing, plan.items, plan.held]).toEqual([0, [], []]);
    expect(calls.map((c) => c.fn)).not.toContain("acc_statement_line_duplicates");
  });

  it("asks once and changes nothing when the books hold nothing alike", async () => {
    const { sb, calls } = client(PROVES);
    const plan = await getAddMissingPlan(sb, "rec-1");
    expect(calls.filter((c) => c.fn === "acc_statement_line_duplicates")).toHaveLength(1);
    expect(plan.items.map((i) => i.lineNo)).toEqual([2, 3]);
    expect(plan.held).toEqual([]);
    expect(plan.uncategorized).toBe(1);
  });
});

describe("adding the lines", () => {
  const posted = (calls: { fn: string; args: Record<string, unknown> }[]) =>
    calls.find((c) => c.fn === "acc_add_statement_lines_to_books")?.args.p_items;

  it("posts Add all's lines as shown, and counts those that went to Uncategorized", async () => {
    const { sb, calls } = client(PROVES);
    const added = await addMissingLines(sb, "rec-1", [
      { lineNo: 2, accountId: UNCAT_OUT },
      { lineNo: 3, accountId: CHARGES },
    ]);
    expect(posted(calls)).toEqual([
      { line_no: 2, bank_transaction_id: "t-shop", account_id: UNCAT_OUT },
      { line_no: 3, bank_transaction_id: "t-fee", account_id: CHARGES },
    ]);
    expect([added.added, added.uncategorized, added.pairingError]).toEqual([2, 1, null]);
  });

  it("posts a held-back line only when it was chosen with Add anyway", async () => {
    const duplicate = [{ line_no: 2, journal_line_id: "jl-old", entry_id: "e-old", entry_number: "JE-000310", entry_date: "2026-09-10" }];
    const refused = client(PROVES, duplicate);
    await expect(addMissingLines(refused.sb, "rec-1", [{ lineNo: 2, accountId: UNCAT_OUT }])).rejects.toThrow(PLAN_CHANGED);
    expect(posted(refused.calls)).toBeUndefined();

    const anyway = client(PROVES, duplicate);
    const added = await addMissingLines(anyway.sb, "rec-1", [{ lineNo: 2, accountId: UNCAT_OUT }], [2]);
    expect(posted(anyway.calls)).toEqual([{ line_no: 2, bank_transaction_id: "t-shop", account_id: UNCAT_OUT }]);
    expect([added.added, added.uncategorized]).toEqual([1, 1]);
  });

  it("posts an extra line with Add anyway", async () => {
    const { sb, calls } = client(BALANCES_WITHOUT);
    await addMissingLines(sb, "rec-1", [{ lineNo: 3, accountId: CHARGES }], [3]);
    expect(posted(calls)).toEqual([{ line_no: 3, bank_transaction_id: "t-fee", account_id: CHARGES }]);
  });

  it("refuses, posting nothing, a line to another account than shown or one the plan no longer holds", async () => {
    for (const shown of [[{ lineNo: 3, accountId: UNCAT_OUT }], [{ lineNo: 1, accountId: UNCAT_IN }]]) {
      const { sb, calls } = client(PROVES);
      const attempt = addMissingLines(sb, "rec-1", shown, [1]);
      await expect(attempt).rejects.toThrow(AddMissingError);
      await expect(addMissingLines(sb, "rec-1", shown, [1])).rejects.toThrow(PLAN_CHANGED);
      expect(posted(calls)).toBeUndefined();
    }
  });
});
```

- [ ] **Step 3: Create `ctyhp-accounting/tests/unit/reconcile-history-actions.test.ts`** with exactly this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  discardReconciliation: vi.fn(),
  bringHistoryForward: vi.fn(),
  bringHistoryForwardFromSession: vi.fn(),
  getHistoryPreview: vi.fn(),
  getReconciliationHistory: vi.fn(),
  getSessionHistoryAdvice: vi.fn(),
  setStatementLineAside: vi.fn(),
  addMissingLines: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getUserRole: mocks.getUserRole, canWrite: mocks.canWrite, isAdmin: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/reconcile-history", () => ({
  discardReconciliation: mocks.discardReconciliation,
  bringHistoryForward: mocks.bringHistoryForward,
  bringHistoryForwardFromSession: mocks.bringHistoryForwardFromSession,
  getHistoryPreview: mocks.getHistoryPreview,
  getReconciliationHistory: mocks.getReconciliationHistory,
  getSessionHistoryAdvice: mocks.getSessionHistoryAdvice,
  setStatementLineAside: mocks.setStatementLineAside,
  statementLineDuplicates: vi.fn(),
}));
vi.mock("@/lib/services/add-missing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/add-missing")>()),
  addMissingLines: mocks.addMissingLines,
}));

import {
  bringHistoryForwardAction,
  bringHistoryForwardFromSessionAction,
  discardReconciliationAction,
  historyPreviewAction,
  reconciliationHistoryAction,
  sessionHistoryAdviceAction,
  setStatementLineAsideAction,
} from "@/app/(app)/banking/reconcile/history-actions";
import { addMissingLinesAction } from "@/app/(app)/banking/reconcile/statement-actions";

const REC = "11111111-1111-4111-8111-111111111111";
const BANK = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const client = { marker: "company-bound" };
const DENIED = "You do not have permission to perform this action";

function asViewer() {
  mocks.getUserRole.mockResolvedValue("viewer");
  mocks.canWrite.mockReturnValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserRole.mockResolvedValue("accountant");
  mocks.canWrite.mockReturnValue(true);
  mocks.createClient.mockResolvedValue(client);
  mocks.discardReconciliation.mockResolvedValue(4);
  const made = { reconciliationId: "rec-bf", lines: 214, moved: 3, rebasedReconciliationId: REC };
  mocks.bringHistoryForward.mockResolvedValue(made);
  mocks.bringHistoryForwardFromSession.mockResolvedValue({ ...made, fileWarning: null });
  mocks.getHistoryPreview.mockResolvedValue({ bookBalanceMinor: 512340, entries: 214 });
  mocks.getReconciliationHistory.mockResolvedValue([]);
  mocks.getSessionHistoryAdvice.mockResolvedValue(null);
  mocks.setStatementLineAside.mockResolvedValue(undefined);
  mocks.addMissingLines.mockResolvedValue({ added: 1, uncategorized: 1, outcome: null, pairingError: null });
});

describe("who may", () => {
  it("refuses every write to a viewer, and calls nothing", async () => {
    asViewer();
    const results = await Promise.all([
      discardReconciliationAction(REC, { reason: "Wrong statement" }),
      bringHistoryForwardFromSessionAction(REC),
      bringHistoryForwardAction({ bank_account_id: BANK, through: "2026-08-31", balance_minor: 512340 }),
      setStatementLineAsideAction(REC, { line_no: 2, aside: true }),
      addMissingLinesAction(REC, [{ lineNo: 2, accountId: ACCOUNT }], [2]),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: DENIED });
    for (const fn of [
      mocks.discardReconciliation,
      mocks.bringHistoryForwardFromSession,
      mocks.bringHistoryForward,
      mocks.setStatementLineAside,
      mocks.addMissingLines,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("lets a viewer read, and nobody without a role", async () => {
    asViewer();
    expect((await reconciliationHistoryAction()).ok).toBe(true);
    expect((await historyPreviewAction({ bank_account_id: BANK, through: "2026-08-31" })).data).toEqual({ bookBalanceMinor: 512340, entries: 214 });
    expect(await sessionHistoryAdviceAction(REC)).toEqual({ ok: true, data: null });
    mocks.getUserRole.mockResolvedValue(null);
    expect(await reconciliationHistoryAction()).toEqual({ ok: false, error: "Not authorized" });
    expect(mocks.getReconciliationHistory).toHaveBeenCalledTimes(1);
  });
});

describe("discardReconciliationAction", () => {
  it("discards with the reason and counts the ticks removed", async () => {
    expect(await discardReconciliationAction(REC, { reason: "  Wrong statement  " })).toEqual({
      ok: true,
      data: { ticksRemoved: 4 },
    });
    expect(mocks.discardReconciliation).toHaveBeenCalledWith(client, REC, "Wrong statement");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking/reconcile");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking");
  });

  it("asks for a reason, and refuses an id that is not one", async () => {
    expect(await discardReconciliationAction(REC, { reason: " " })).toEqual({
      ok: false,
      error: "A reason is required to discard a reconciliation",
    });
    expect(await discardReconciliationAction("not-an-id", { reason: "Wrong" })).toEqual({ ok: false, error: "Reconciliation not found" });
    expect(mocks.discardReconciliation).not.toHaveBeenCalled();
  });

  it("says the database's refusal as it is", async () => {
    mocks.discardReconciliation.mockRejectedValue(new Error("Only a reconciliation in progress can be discarded"));
    expect(await discardReconciliationAction(REC, { reason: "Wrong" })).toEqual({
      ok: false,
      error: "Only a reconciliation in progress can be discarded",
    });
  });
});

describe("bringing the history forward", () => {
  it("from a reconciliation, sends the service nothing but which reconciliation", async () => {
    const result = await bringHistoryForwardFromSessionAction(REC);
    expect(result.ok).toBe(true);
    expect(mocks.bringHistoryForwardFromSession).toHaveBeenCalledWith(client, REC);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/banking/reconcile/${REC}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking/reconcile/rec-bf");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking/reconcile/history");
  });

  it("from the history page, keeps the statement balance and its date as the note", async () => {
    const result = await bringHistoryForwardAction({ bank_account_id: BANK, through: "2026-08-31", balance_minor: 512340 });
    expect(result).toEqual({ ok: true, data: { reconciliationId: "rec-bf", lines: 214, moved: 3, rebasedReconciliationId: REC } });
    expect(mocks.bringHistoryForward).toHaveBeenCalledWith(
      client,
      BANK,
      "2026-08-31",
      512340,
      "Brought forward, proved by the statement balance of $5,123.40 on Aug 31, 2026",
    );
  });

  it("refuses a day that does not exist, or a balance in part-cents", async () => {
    expect((await bringHistoryForwardAction({ bank_account_id: BANK, through: "2026-02-30", balance_minor: 1 })).error).toBe(
      "A statement date must be a real day",
    );
    expect((await bringHistoryForwardAction({ bank_account_id: BANK, through: "2026-08-31", balance_minor: 1.5 })).error).toBe(
      "The statement balance must be a whole minor-unit amount",
    );
    expect((await historyPreviewAction({ bank_account_id: BANK, through: "" })).ok).toBe(false);
    expect(mocks.bringHistoryForward).not.toHaveBeenCalled();
    expect(mocks.getHistoryPreview).not.toHaveBeenCalled();
  });
});

describe("setStatementLineAsideAction", () => {
  it("sets a line aside, or brings it back", async () => {
    expect(await setStatementLineAsideAction(REC, { line_no: 2, aside: true })).toEqual({ ok: true });
    expect(mocks.setStatementLineAside).toHaveBeenCalledWith(client, REC, 2, true);
    await setStatementLineAsideAction(REC, { line_no: 2, aside: false });
    expect(mocks.setStatementLineAside).toHaveBeenLastCalledWith(client, REC, 2, false);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/banking/reconcile/${REC}`);
  });

  it("says the paired-line refusal as the service gives it", async () => {
    mocks.setStatementLineAside.mockRejectedValue(new Error("This line is paired with the books, so it is a transaction."));
    expect(await setStatementLineAsideAction(REC, { line_no: 0, aside: true })).toEqual({
      ok: false,
      error: "This line is paired with the books, so it is a transaction.",
    });
  });
});

describe("addMissingLinesAction", () => {
  it("hands the lines chosen with Add anyway to the service", async () => {
    await addMissingLinesAction(REC, [{ lineNo: 2, accountId: ACCOUNT }], [2]);
    expect(mocks.addMissingLines).toHaveBeenCalledWith(client, REC, [{ lineNo: 2, accountId: ACCOUNT }], [2]);
  });

  it("adds none anyway when none are named, as Add all does", async () => {
    await addMissingLinesAction(REC, [{ lineNo: 2, accountId: ACCOUNT }]);
    expect(mocks.addMissingLines).toHaveBeenCalledWith(client, REC, [{ lineNo: 2, accountId: ACCOUNT }], []);
  });

  it("refuses add-anyway lines that are not line numbers", async () => {
    expect((await addMissingLinesAction(REC, [{ lineNo: 2, accountId: ACCOUNT }], ["2"])).ok).toBe(false);
    expect(mocks.addMissingLines).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Edit `ctyhp-accounting/tests/unit/reconcile-statement-service.test.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
    expect(statement.lines[5]).toEqual({
      lineNo: 5, txnDate: "2026-09-01", description: "Line 5", reference: null, amountMinor: 105, balanceMinor: null,
    });
```

replace with:

```ts
    expect(statement.lines[5]).toEqual({
      lineNo: 5, txnDate: "2026-09-01", description: "Line 5", reference: null, amountMinor: 105, balanceMinor: null, setAside: false,
    });
  });

  it("reads which lines are set aside, and the kept file's period", async () => {
    const { sb } = fakeClient(
      {
        acc_statement_reconciliation: [
          {
            ...session,
            statement_file_id: "file-1",
            statement_file: { id: "file-1", file_name: "september.pdf", uploaded_at: "2026-10-02T10:00:00Z", sha256: "ab", period_start: "2026-09-01", period_end: "2026-09-30" },
          },
        ],
        acc_reconciliation_statement_line: [
          { line_no: 0, txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, balance_minor: null, set_aside: false },
          { line_no: 1, txn_date: "2026-09-08", description: "4101 4102", reference: "4101", amount_minor: -36000, balance_minor: null, set_aside: true },
        ],
      },
      {},
    );
    const statement = await getReconciliationStatement(sb, "rec-1");
    expect(statement.lines.map((l) => l.setAside)).toEqual([false, true]);
    expect(statement.statementFile).toEqual({
      id: "file-1",
      fileName: "september.pdf",
      keptAt: "2026-10-02T10:00:00Z",
      sha256: "ab",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
```

Edit 2 of 2 — find:

```ts

  it("makes no call when every pair is ticked already", async () => {
```

replace with:

```ts

  it("never ticks the book line a set-aside statement line would pair with", async () => {
    const { sb, calls } = fakeClient(
      {
        acc_statement_reconciliation: [session],
        acc_reconciliation_statement_line: [{ ...statementLines[1], set_aside: true }],
      },
      {
        acc_reconciliation_lines: [bookLine("b", "2026-09-12", -12000, false, "1201")],
        acc_set_cleared_many: (args) => (args.p_journal_line_ids as string[]).length,
      },
    );
    expect(await pairAndTick(sb, "rec-1")).toEqual({ lines: 1, paired: 0, ticked: 0, missing: 0, after: 0, flipped: false });
    expect(calls.some((c) => c.fn === "acc_set_cleared_many")).toBe(false);
  });

  it("makes no call when every pair is ticked already", async () => {
```

- [ ] **Step 5: Run the tests to see them fail**

```bash
npx vitest run tests/unit/reconcile-history-service.test.ts tests/unit/add-missing-service.test.ts tests/unit/reconcile-history-actions.test.ts tests/unit/reconcile-statement-service.test.ts
```

Expected: FAIL — `lib/services/reconcile-history.ts` and `app/(app)/banking/reconcile/history-actions.ts` do not exist yet.

- [ ] **Step 6: Edit `ctyhp-accounting/lib/services/bankrec.ts`** — apply these 6 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 6 — find:

```ts
  amountMinor: number; balanceMinor: number | null;
}
```

replace with:

```ts
  amountMinor: number; balanceMinor: number | null;
  /** Set aside as not a transaction (2.03): left out of the pairing, of Add missing lines and of the difference's parts. */
  setAside: boolean;
}
```

Edit 2 of 6 — find:

```ts
  sha256: string;
}
```

replace with:

```ts
  sha256: string;
  /** The statement's period as kept with the file; null when it names none. */
  periodStart: string | null;
  periodEnd: string | null;
}
```

Edit 3 of 6 — find:

```ts
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date,status,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward,statement_file_id,statement_file:acc_saved_report(id,file_name,uploaded_at,sha256)")
    .eq("id", id)
```

replace with:

```ts
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date,status,statement_ref,statement_opening_minor,statement_closing_minor,note,brought_forward,statement_file_id,statement_file:acc_saved_report(id,file_name,uploaded_at,sha256,period_start,period_end)")
    .eq("id", id)
```

Edit 4 of 6 — find:

```ts
    sha256: row.sha256 as string,
  };
```

replace with:

```ts
    sha256: row.sha256 as string,
    periodStart: (row.period_start as string) ?? null,
    periodEnd: (row.period_end as string) ?? null,
  };
```

Edit 5 of 6 — find:

```ts
        sb.from("acc_reconciliation_statement_line")
          .select("line_no,txn_date,description,reference,amount_minor,balance_minor")
          .eq("reconciliation_id", id)
```

replace with:

```ts
        sb.from("acc_reconciliation_statement_line")
          .select("line_no,txn_date,description,reference,amount_minor,balance_minor,set_aside")
          .eq("reconciliation_id", id)
```

Edit 6 of 6 — find:

```ts
      reference: (l.reference as string) ?? null, amountMinor: Number(l.amount_minor), balanceMinor: optionalMinor(l.balance_minor),
    })),
```

replace with:

```ts
      reference: (l.reference as string) ?? null, amountMinor: Number(l.amount_minor), balanceMinor: optionalMinor(l.balance_minor),
      setAside: Boolean(l.set_aside),
    })),
```

- [ ] **Step 7: Create `ctyhp-accounting/lib/services/reconcile-history.ts`** with exactly this content:

```ts
/**
 * Reconciliation history and the flow around it (2.03, migration 0142):
 * bringing an account's history forward — from the history page, or from
 * inside the reconciliation whose statement proves it — discarding a
 * reconciliation in progress, setting a misread statement line aside, and
 * asking which statement lines the books may already hold.
 *
 * The rules are the database's; this reads, works out what the database cannot
 * (whether a line pairs with the books), and derives on the server every figure
 * a write depends on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DuplicateMatch } from "@/lib/domain/add-missing";
import {
  historyAccounts,
  type HistoryAccount,
  type HistoryPreview,
  type ReconciliationHistoryRow,
} from "@/lib/domain/reconcile-history";
import {
  broughtForwardNote,
  reconciliationStandings,
  sessionHistoryRefusal,
  sessionHistoryStart,
  setAsideRefusal,
  type HistorySession,
  type SessionHistoryFacts,
} from "@/lib/domain/reconcile-statement";
import { listBankAccounts } from "./banking";
import {
  BankRecError,
  getBroughtForwardPreview,
  getReconciliationDetail,
  getReconciliationHeader,
  getReconciliationLines,
  getReconciliationStatement,
  type ReconStatementHeader,
} from "./bankrec";
import { readAllPages } from "./paging";
import { tieKeptStatementFile } from "./statement-files";

/** What acc_bring_history_forward made. */
export interface BroughtForwardHistory {
  /** The new completed, brought-forward reconciliation. */
  reconciliationId: string;
  /** The lines it holds: moved from the session in progress, and newly ticked. */
  lines: number;
  /** Of those, the ticks taken from the session in progress. */
  moved: number;
  /** The session in progress that now begins at the statement balance, when there is one. */
  rebasedReconciliationId: string | null;
}

/** Discards a reconciliation in progress, with its ticks and statement lines. Returns the ticks removed. */
export async function discardReconciliation(sb: SupabaseClient, reconciliationId: string, reason: string): Promise<number> {
  const { data, error } = await sb.rpc("acc_discard_reconciliation", { p_reconciliation_id: reconciliationId, p_reason: reason });
  if (error) throw new BankRecError(error.message);
  return Number(data ?? 0);
}

/**
 * Brings an account's history forward through `through`, proved by the
 * statement's balance on that day. The database refuses unless the books hold
 * exactly that balance, the account was never reconciled, and any session in
 * progress ends after the day.
 */
export async function bringHistoryForward(
  sb: SupabaseClient,
  bankAccountId: string,
  through: string,
  balanceMinor: number,
  note: string,
): Promise<BroughtForwardHistory> {
  const { data, error } = await sb.rpc("acc_bring_history_forward", {
    p_bank_account_id: bankAccountId,
    p_through: through,
    p_balance_minor: balanceMinor,
    p_note: note,
  });
  if (error) throw new BankRecError(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  if (!r.reconciliation_id) throw new BankRecError("Bringing the history forward returned no reconciliation");
  return {
    reconciliationId: r.reconciliation_id as string,
    lines: Number(r.lines ?? 0),
    moved: Number(r.moved ?? 0),
    rebasedReconciliationId: (r.rebased_reconciliation_id as string) ?? null,
  };
}

/**
 * acc_reconciliation_history, one row per bank account. Paged all the same: an
 * account is one row, but nothing else keeps a list from PostgREST's cap, and
 * the bank account id orders it totally.
 */
export async function readReconciliationHistory(sb: SupabaseClient): Promise<ReconciliationHistoryRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.rpc("acc_reconciliation_history").order("bank_account_id").range(from, to),
    (message) => new BankRecError(message),
  );
  return rows.map((r) => ({
    bankAccountId: r.bank_account_id as string,
    openLines: Number(r.open_lines ?? 0),
    firstOpenDate: (r.first_open_date as string) ?? null,
    lastOpenDate: (r.last_open_date as string) ?? null,
    lastReconciledDate: (r.last_reconciled_date as string) ?? null,
    inProgress: r.in_progress_id
      ? { id: r.in_progress_id as string, endingDate: r.in_progress_ending_date as string }
      : null,
  }));
}

/** Every bank account's history, named and ordered as Banking lists the accounts. */
export async function getReconciliationHistory(sb: SupabaseClient): Promise<HistoryAccount[]> {
  const [rows, banks] = await Promise.all([readReconciliationHistory(sb), listBankAccounts(sb)]);
  return historyAccounts(rows, banks);
}

/** What the books hold on an account through a day, and how many lines bringing it forward would mark. */
export async function getHistoryPreview(sb: SupabaseClient, bankAccountId: string, through: string): Promise<HistoryPreview> {
  const preview = await getBroughtForwardPreview(sb, bankAccountId, through);
  return { bookBalanceMinor: preview.bookBalanceMinor, entries: preview.openLines };
}

/** A reconciliation as bringing its history forward reads it: its header and where it begins. */
async function readHistorySession(
  sb: SupabaseClient,
  reconciliationId: string,
): Promise<{ header: ReconStatementHeader; session: HistorySession }> {
  const [header, detail] = await Promise.all([
    getReconciliationHeader(sb, reconciliationId),
    getReconciliationDetail(sb, reconciliationId),
  ]);
  return {
    header,
    session: {
      status: header.status,
      periodStart: header.statementFile?.periodStart ?? null,
      // The file is read through acc_saved_report, which only someone who may read saved files sees.
      fileUnreadable: header.statementFileId !== null && header.statementFile === null,
      openingMinor: header.openingMinor,
      beginningMinor: detail.beginningMinor,
    },
  };
}

/**
 * What a reconciliation's offer to bring the history forward rests on, read on
 * the server: the day before its kept statement's period, the balance the
 * statement opens with, the books through that day and how many lines they
 * hold, and whether the account was ever reconciled. Null when the
 * reconciliation has nothing to offer (sessionHistoryStart). The screen turns
 * it into words with sessionHistoryAdvice.
 */
export async function getSessionHistoryAdvice(sb: SupabaseClient, reconciliationId: string): Promise<SessionHistoryFacts | null> {
  const { header, session } = await readHistorySession(sb, reconciliationId);
  const start = sessionHistoryStart(session);
  if (!start) return null;
  const [history, preview] = await Promise.all([
    readReconciliationHistory(sb),
    getBroughtForwardPreview(sb, header.bankAccountId, start.through),
  ]);
  const account = history.find((row) => row.bankAccountId === header.bankAccountId);
  return {
    ...start,
    bookBalanceMinor: preview.bookBalanceMinor,
    entries: preview.openLines,
    reconciled: Boolean(account?.lastReconciledDate),
  };
}

/**
 * Brings the history forward from inside a reconciliation in progress. The day
 * and the balance are the stored statement's — the day before its kept file's
 * period, and the balance it opens with — never figures sent by the screen.
 * The new reconciliation keeps the statement's file as its evidence too, as one
 * brought forward from statement files does; a file that cannot be tied is
 * said, not undone.
 */
export async function bringHistoryForwardFromSession(
  sb: SupabaseClient,
  reconciliationId: string,
): Promise<BroughtForwardHistory & { fileWarning: string | null }> {
  const { header, session } = await readHistorySession(sb, reconciliationId);
  const refusal = sessionHistoryRefusal(session);
  const start = sessionHistoryStart(session);
  if (refusal || !start) throw new BankRecError(refusal ?? "The history cannot be brought forward from this reconciliation.");
  const note = broughtForwardNote(session.periodStart, header.statementFile?.periodEnd ?? header.endingDate);
  const result = await bringHistoryForward(sb, header.bankAccountId, start.through, start.openingMinor, note);
  const fileWarning = header.statementFileId
    ? await tieKeptStatementFile(sb, "reconciliation", result.reconciliationId, header.statementFileId)
    : null;
  return { ...result, fileWarning };
}

/**
 * Sets a statement line aside as not a transaction, or brings it back. A line
 * the books pair with is a transaction and is refused: whether it pairs is
 * worked out here, from the books as they are now, because the database does
 * not store it. Bringing a line back is always allowed.
 */
export async function setStatementLineAside(
  sb: SupabaseClient,
  reconciliationId: string,
  lineNo: number,
  aside: boolean,
): Promise<void> {
  if (aside) {
    const [statement, book] = await Promise.all([
      getReconciliationStatement(sb, reconciliationId),
      getReconciliationLines(sb, reconciliationId),
    ]);
    const { standings } = reconciliationStandings(statement, book);
    const at = statement.lines.findIndex((line) => line.lineNo === lineNo);
    const refusal = setAsideRefusal(at >= 0 ? standings[at] : undefined, aside);
    if (refusal) throw new BankRecError(refusal);
  }
  const { error } = await sb.rpc("acc_set_statement_line_aside", {
    p_reconciliation_id: reconciliationId,
    p_line_no: lineNo,
    p_aside: aside,
  });
  if (error) throw new BankRecError(error.message);
}

/**
 * The posted lines the books already hold that each statement line may be, by
 * line number: the same amount, and the same cheque number or a date within 5
 * days. Asks nothing when no line is given. Paged: each line can find several,
 * and the journal line id settles the order within a line.
 */
export async function statementLineDuplicates(
  sb: SupabaseClient,
  reconciliationId: string,
  lineNos: readonly number[],
): Promise<Map<number, DuplicateMatch[]>> {
  const asked = [...new Set(lineNos)];
  const found = new Map<number, DuplicateMatch[]>();
  if (!asked.length) return found;
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_statement_line_duplicates", { p_reconciliation_id: reconciliationId, p_line_nos: asked })
        .order("line_no")
        .order("entry_date")
        .order("entry_number")
        .order("journal_line_id")
        .range(from, to),
    (message) => new BankRecError(message),
  );
  for (const r of rows) {
    const lineNo = Number(r.line_no);
    const match: DuplicateMatch = {
      journalLineId: r.journal_line_id as string,
      entryId: r.entry_id as string,
      entryNumber: (r.entry_number as string) ?? null,
      entryDate: r.entry_date as string,
    };
    found.set(lineNo, [...(found.get(lineNo) ?? []), match]);
  }
  return found;
}
```

- [ ] **Step 8: Edit `ctyhp-accounting/lib/services/add-missing.ts`** — apply these 15 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 15 — find:

```ts
 * the account's bank lines and their coding suggestions; and the click that
 * posts them all through acc_add_statement_lines_to_books, then pairs and ticks.
 */
```

replace with:

```ts
 * the account's bank lines and their coding suggestions; and the click that
 * posts them through acc_add_statement_lines_to_books, then pairs and ticks.
 *
 * 2.03: a line the statement balances without, or one the books seem to hold
 * already, is held back from "Add all N"; the screen offers "Add anyway" for
 * it alone.
 */
```

Edit 2 of 15 — find:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { planAddMissing, type AddBankLine, type AddMissingPlan, type AddSuggestion } from "@/lib/domain/add-missing";
import { reconciliationStandings, type PairingOutcome } from "@/lib/domain/reconcile-statement";
```

replace with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chooseLinesToAdd,
  linesToCheckForDuplicates,
  planAddMissing,
  type AddBankLine,
  type AddMissingPlan,
  type AddSuggestion,
  type ChosenLine,
} from "@/lib/domain/add-missing";
import { reconciliationStandings, type PairingOutcome } from "@/lib/domain/reconcile-statement";
```

Edit 3 of 15 — find:

```ts
import { codingSuggestions } from "./coding";
import { bankLinesBetween } from "./statement-bank-lines";
```

replace with:

```ts
import { codingSuggestions } from "./coding";
import { statementLineDuplicates } from "./reconcile-history";
import { bankLinesBetween } from "./statement-bank-lines";
```

Edit 4 of 15 — find:

```ts

/** What "Add all N to the books" would add to this reconciliation, and what it cannot. */
export async function getAddMissingPlan(sb: SupabaseClient, reconciliationId: string): Promise<AddMissingPlan> {
```

replace with:

```ts

/**
 * What "Add all N to the books" would add to this reconciliation, what is held
 * back from it, and what cannot be added. The books are asked about the lines
 * "Add all" would add, and only when there are some.
 */
export async function getAddMissingPlan(sb: SupabaseClient, reconciliationId: string): Promise<AddMissingPlan> {
```

Edit 5 of 15 — find:

```ts
  const standings = reconciliationStandings(statement, book);
  const missingDates = statement.lines.filter((_, i) => standings.standings[i]?.kind === "missing").map((l) => l.txnDate).sort();
```

replace with:

```ts
  const standings = reconciliationStandings(statement, book);
  const balances = { openingMinor: statement.openingMinor, closingMinor: statement.closingMinor };
  const missingDates = statement.lines.filter((_, i) => standings.standings[i]?.kind === "missing").map((l) => l.txnDate).sort();
```

Edit 6 of 15 — find:

```ts
      holding: { income: null, expense: null },
    });
```

replace with:

```ts
      holding: { income: null, expense: null },
      ...balances,
    });
```

Edit 7 of 15 — find:

```ts
  );
  return planAddMissing({
    lines: statement.lines,
```

replace with:

```ts
  );
  const base = {
    lines: statement.lines,
```

Edit 8 of 15 — find:

```ts
    signedThrough,
  });
}
```

replace with:

```ts
    signedThrough,
    ...balances,
  };
  const plan = planAddMissing(base);
  const asked = linesToCheckForDuplicates(plan);
  if (!asked.length) return plan;
  const duplicates = await statementLineDuplicates(sb, reconciliationId, asked);
  return duplicates.size ? planAddMissing({ ...base, duplicates }) : plan;
}
```

Edit 9 of 15 — find:

```ts
/** Shown to the person: a line and the account it would post to. */
export interface ShownItem {
  lineNo: number;
  accountId: string;
}

```

replace with:

```ts
/** Shown to the person: a line and the account it would post to. */
export type ShownItem = ChosenLine;

```

Edit 10 of 15 — find:

```ts

const sameItems = (a: readonly ShownItem[], b: readonly ShownItem[]) => {
  const key = (items: readonly ShownItem[]) => items.map((i) => `${i.lineNo}:${i.accountId}`).sort().join(",");
  return key(a) === key(b);
};

```

replace with:

```ts

export const PLAN_CHANGED = "The lines to add changed since this page was drawn, so nothing was posted. Look them over again.";

```

Edit 11 of 15 — find:

```ts
/**
 * Posts every line the plan adds, or none; then pairs and ticks. The plan is
 * worked out again here, and it must be the one the person was shown: a
 * suggestion or a bank line that changed since is not posted unseen.
 */
```

replace with:

```ts
/**
 * Posts the lines asked for, every one or none; then pairs and ticks. The plan
 * is worked out again here, and each line must still be in it as the person
 * was shown it: in "Add all N", or held back and chosen with "Add anyway" (the
 * line numbers in `anyway`), posting to the same account. A suggestion or a
 * bank line that changed since is not posted unseen.
 */
```

Edit 12 of 15 — find:

```ts
 */
export async function addMissingLines(sb: SupabaseClient, reconciliationId: string, shown: readonly ShownItem[]): Promise<AddedLines> {
  const plan = await getAddMissingPlan(sb, reconciliationId);
```

replace with:

```ts
 */
export async function addMissingLines(
  sb: SupabaseClient,
  reconciliationId: string,
  shown: readonly ShownItem[],
  anyway: readonly number[] = [],
): Promise<AddedLines> {
  const plan = await getAddMissingPlan(sb, reconciliationId);
```

Edit 13 of 15 — find:

```ts
  if (plan.blocked) throw new AddMissingError(plan.blocked);
  if (!plan.items.length) throw new AddMissingError("There is nothing to add");
  if (!sameItems(plan.items, shown)) {
    throw new AddMissingError("The lines to add changed since this page was drawn, so nothing was posted. Look them over again.");
  }
  const { error } = await sb.rpc("acc_add_statement_lines_to_books", {
```

replace with:

```ts
  if (plan.blocked) throw new AddMissingError(plan.blocked);
  if (!plan.items.length && !plan.held.length) throw new AddMissingError("There is nothing to add");
  const chosen = chooseLinesToAdd(plan, shown, anyway);
  if (!chosen?.length) throw new AddMissingError(PLAN_CHANGED);
  const { error } = await sb.rpc("acc_add_statement_lines_to_books", {
```

Edit 14 of 15 — find:

```ts
    p_reconciliation_id: reconciliationId,
    p_items: plan.items.map((item) => ({ line_no: item.lineNo, bank_transaction_id: item.transactionId, account_id: item.accountId })),
  });
```

replace with:

```ts
    p_reconciliation_id: reconciliationId,
    p_items: chosen.map((item) => ({ line_no: item.lineNo, bank_transaction_id: item.transactionId, account_id: item.accountId })),
  });
```

Edit 15 of 15 — find:

```ts
  // is said as such, never as lines that were not added.
  const added = { added: plan.items.length, uncategorized: plan.uncategorized };
  try {
```

replace with:

```ts
  // is said as such, never as lines that were not added.
  const added = { added: chosen.length, uncategorized: chosen.filter((item) => item.source === "uncategorized").length };
  try {
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/banking/reconcile/history-actions.ts`** with exactly this content:

```ts
"use server";
/**
 * Reconciliation history and the flow around it (2.03): bringing an account's
 * history forward from Reconcile history or from inside a reconciliation,
 * discarding a reconciliation in progress, and setting a misread statement line
 * aside. Writes need someone who can write; reads are open to a viewer.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import { historyBroughtForwardNote, type HistoryAccount, type HistoryPreview } from "@/lib/domain/reconcile-history";
import type { SessionHistoryFacts } from "@/lib/domain/reconcile-statement";
import {
  historyBringForwardSchema,
  historyPreviewSchema,
  reconciliationDiscardSchema,
  statementLineAsideSchema,
} from "@/lib/domain/schemas";
import { BankRecError } from "@/lib/services/bankrec";
import {
  bringHistoryForward,
  bringHistoryForwardFromSession,
  discardReconciliation,
  getHistoryPreview,
  getReconciliationHistory,
  getSessionHistoryAdvice,
  setStatementLineAside,
  type BroughtForwardHistory,
} from "@/lib/services/reconcile-history";
import type { ActionResult } from "./actions";

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
async function readGuard(): Promise<string | null> {
  return (await getUserRole()) ? null : "Not authorized";
}
function msg(e: unknown): string {
  return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred";
}
const isId = (id: string) => z.uuid().safeParse(id).success;
const NOT_FOUND = "Reconciliation not found";

function revalidateHistory(...reconciliationIds: (string | null)[]) {
  for (const path of ["/banking/reconcile", "/banking/reconcile/history", "/banking"]) revalidatePath(path);
  for (const id of reconciliationIds) if (id) revalidatePath(`/banking/reconcile/${id}`);
}

export interface DiscardedReconciliation {
  /** The ticks removed with the reconciliation. */
  ticksRemoved: number;
}

/**
 * Discards a reconciliation in progress: its ticks and statement lines go with
 * it; the statement file, its bank lines and any entries added from it stay.
 */
export async function discardReconciliationAction(
  reconciliationId: string,
  raw: unknown,
): Promise<ActionResult<DiscardedReconciliation>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isId(reconciliationId)) return { ok: false, error: NOT_FOUND };
  const parsed = reconciliationDiscardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const ticksRemoved = await discardReconciliation(sb, reconciliationId, parsed.data.reason);
    revalidateHistory(reconciliationId);
    return { ok: true, data: { ticksRemoved } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Brings the history forward from inside a reconciliation in progress. The day
 * and the balance are read from the stored reconciliation and its statement
 * file on the server; the screen sends only which reconciliation.
 */
export async function bringHistoryForwardFromSessionAction(
  reconciliationId: string,
): Promise<ActionResult<BroughtForwardHistory & { fileWarning: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isId(reconciliationId)) return { ok: false, error: NOT_FOUND };
  try {
    const sb = await createSupabaseServerClient();
    const result = await bringHistoryForwardFromSession(sb, reconciliationId);
    revalidateHistory(reconciliationId, result.reconciliationId);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * Brings an account's history forward from Reconcile history, proved by the
 * statement's balance on the day the person names. The database refuses unless
 * the books hold exactly that balance.
 */
export async function bringHistoryForwardAction(raw: unknown): Promise<ActionResult<BroughtForwardHistory>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = historyBringForwardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const { bank_account_id, through, balance_minor } = parsed.data;
  try {
    const sb = await createSupabaseServerClient();
    const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
    const result = await bringHistoryForward(
      sb,
      bank_account_id,
      through,
      balance_minor,
      historyBroughtForwardNote(balance_minor, through, money),
    );
    revalidateHistory(result.reconciliationId, result.rebasedReconciliationId);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Sets a statement line aside as not a transaction, or brings it back. A line paired with the books is refused. */
export async function setStatementLineAsideAction(reconciliationId: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (!isId(reconciliationId)) return { ok: false, error: NOT_FOUND };
  const parsed = statementLineAsideSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await setStatementLineAside(sb, reconciliationId, parsed.data.line_no, parsed.data.aside);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Every bank account's reconciliation history, as Banking lists the accounts. Reads only. */
export async function reconciliationHistoryAction(): Promise<ActionResult<HistoryAccount[]>> {
  const denied = await readGuard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getReconciliationHistory(sb) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** What the books hold on an account through a day: Reconcile history's live preview. Reads only. */
export async function historyPreviewAction(raw: unknown): Promise<ActionResult<HistoryPreview>> {
  const denied = await readGuard();
  if (denied) return { ok: false, error: denied };
  const parsed = historyPreviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getHistoryPreview(sb, parsed.data.bank_account_id, parsed.data.through) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/**
 * What a reconciliation's offer to bring the history forward rests on; null
 * when it has nothing to offer. The screen words it with sessionHistoryAdvice.
 * Reads only.
 */
export async function sessionHistoryAdviceAction(reconciliationId: string): Promise<ActionResult<SessionHistoryFacts | null>> {
  const denied = await readGuard();
  if (denied) return { ok: false, error: denied };
  if (!isId(reconciliationId)) return { ok: false, error: NOT_FOUND };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSessionHistoryAdvice(sb, reconciliationId) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
```

- [ ] **Step 10: Edit `ctyhp-accounting/app/(app)/banking/reconcile/statement-actions.ts`** — apply these 5 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 5 — find:

```ts
  .max(ADD_MISSING_LIMIT, `At most ${ADD_MISSING_LIMIT} lines can be added at a time`);

```

replace with:

```ts
  .max(ADD_MISSING_LIMIT, `At most ${ADD_MISSING_LIMIT} lines can be added at a time`);
const anywaySchema = z
  .array(z.number().int().nonnegative())
  .max(ADD_MISSING_LIMIT, `At most ${ADD_MISSING_LIMIT} lines can be added at a time`);

```

Edit 2 of 5 — find:

```ts
/**
 * Adds the statement lines the books do not have — every one or none — as the
 * person was shown them, then pairs and ticks. The reconciliation is not
 * completed: Complete stays the person's click.
 */
```

replace with:

```ts
/**
 * Adds the statement lines the books do not have — every one asked for, or
 * none — as the person was shown them, then pairs and ticks. "Add all N" sends
 * the plan's items; "Add anyway" sends one held-back line, with its line
 * number in `anyway`. The reconciliation is not completed: Complete stays the
 * person's click.
 */
```

Edit 3 of 5 — find:

```ts
 */
export async function addMissingLinesAction(reconciliationId: string, shown: unknown): Promise<ActionResult<AddedLines>> {
  const denied = await guard();
```

replace with:

```ts
 */
export async function addMissingLinesAction(
  reconciliationId: string,
  shown: unknown,
  anyway: unknown = [],
): Promise<ActionResult<AddedLines>> {
  const denied = await guard();
```

Edit 4 of 5 — find:

```ts
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
```

replace with:

```ts
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const held = anywaySchema.safeParse(anyway);
  if (!held.success) return { ok: false, error: held.error.issues[0]?.message ?? "Invalid data" };
  try {
```

Edit 5 of 5 — find:

```ts
    const sb = await createSupabaseServerClient();
    const added = await addMissingLines(sb, reconciliationId, parsed.data);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
```

replace with:

```ts
    const sb = await createSupabaseServerClient();
    const added = await addMissingLines(sb, reconciliationId, parsed.data, held.data);
    revalidatePath(`/banking/reconcile/${reconciliationId}`);
```

- [ ] **Step 11: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/reconcile-history-service.test.ts" "tests/unit/add-missing-service.test.ts" "tests/unit/reconcile-history-actions.test.ts" "tests/unit/reconcile-statement-service.test.ts" "lib/services/bankrec.ts" "lib/services/reconcile-history.ts" "lib/services/add-missing.ts" "app/(app)/banking/reconcile/history-actions.ts" "app/(app)/banking/reconcile/statement-actions.ts"
npx vitest run tests/unit/reconcile-history-service.test.ts tests/unit/add-missing-service.test.ts tests/unit/reconcile-history-actions.test.ts tests/unit/reconcile-statement-service.test.ts tests/unit/banking-paged-reads.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; reconcile-history-service (19), add-missing-service (8), reconcile-history-actions (13) and reconcile-statement-service (9): 49 tests passing; banking-paged-reads (6) passes.

- [ ] **Step 12: Commit**

```bash
git add "ctyhp-accounting/tests/unit/reconcile-history-service.test.ts" "ctyhp-accounting/tests/unit/add-missing-service.test.ts" "ctyhp-accounting/tests/unit/reconcile-history-actions.test.ts" "ctyhp-accounting/tests/unit/reconcile-statement-service.test.ts" "ctyhp-accounting/lib/services/bankrec.ts" "ctyhp-accounting/lib/services/reconcile-history.ts" "ctyhp-accounting/lib/services/add-missing.ts" "ctyhp-accounting/app/(app)/banking/reconcile/history-actions.ts" "ctyhp-accounting/app/(app)/banking/reconcile/statement-actions.ts"
git commit -m "feat(reconcile): bring history forward from a reconciliation or the history page, discard a reconciliation, set a statement line aside, and add a held-back line anyway"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 5: The screens — the workspace, Reconcile history, the import note, and the Guide

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/reconcile-history-screens.test.ts`
- Modify: `ctyhp-accounting/app/(app)/banking/ImportStatementModal.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/reconcile/ReconcileListClient.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/[id]/statement-line-columns.ts`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/[id]/workspace.module.css`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/[id]/difference.module.css`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/[id]/DifferenceAlert.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/reconcile/[id]/AddMissingBox.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/history/history-columns.ts`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/history/history.module.css`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/history/ReconcileHistoryClient.tsx`
- Create: `ctyhp-accounting/app/(app)/banking/reconcile/history/page.tsx`
- Modify: `ctyhp-accounting/lib/domain/system-guide.ts`

**Interfaces:**
- Consumes: everything Tasks 2–4 produce (names above); existing `DataTable`, `PageHeader`, `ImportStatementModal`, `formatMoney`, `shortDate`, the company clock.
- Produces:
  - The workspace: "Bring the history forward" (writers, in progress, when the books equal the opening), "Discard this reconciliation" with a required reason (returns to Reconcile on the same account), the difference in parts with its hint, Not a transaction / Restore per statement line, the Extra tag, and the held-back lines with Add anyway.
  - `/banking/reconcile/history`: every bank account, the statement-balance form with its live preview, Bring forward N entries; linked from Reconcile as "Reconcile history".
  - On a phone, the workspace's three tables and the history table scroll inside their box (min-widths in `statement-line-columns.ts` and `history-columns.ts`).
  - The import dialog shows `STATEMENT_READING_NOTE`.
  - The Guide's reconciliation steps for all of the above.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/reconcile-history-screens.test.ts`** with exactly this content:

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AddMissingBox from "@/app/(app)/banking/reconcile/[id]/AddMissingBox";
import DifferenceAlert from "@/app/(app)/banking/reconcile/[id]/DifferenceAlert";
import StandingTag from "@/app/(app)/banking/reconcile/StandingTag";
import {
  ADD_MISSING_ELASTIC_FLOOR,
  ADD_MISSING_MIN_WIDTH,
  ADD_MISSING_WIDTH,
  LEDGER_LINE_ELASTIC_FLOOR,
  LEDGER_LINE_WIDTH,
  LEDGER_LINES_MIN_WIDTH,
  STATEMENT_LINE_ELASTIC_FLOOR,
  STATEMENT_LINE_WIDTH,
  STATEMENT_LINES_MIN_WIDTH,
  STATEMENT_LINES_READ_MIN_WIDTH,
} from "@/app/(app)/banking/reconcile/[id]/statement-line-columns";
import {
  HISTORY_COLUMN_WIDTH,
  HISTORY_ELASTIC_FLOOR,
  HISTORY_MIN_WIDTH,
  HISTORY_SHORT_DATE,
  HISTORY_STATE_TONES,
} from "@/app/(app)/banking/reconcile/history/history-columns";
import { GUIDE_FLOWS } from "@/lib/domain/system-guide";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import { TONES } from "@/lib/design/tone";
import {
  ADD_ANYWAY,
  EXTRA_LINE_NOTE,
  EXTRA_LINE_TAG,
  HELD_BACK_HEADING,
  duplicateNote,
  type AddItem,
  type AddMissingPlan,
  type HeldLine,
} from "@/lib/domain/add-missing";
import { explainDifference, type DifferenceExplained } from "@/lib/domain/reconcile-difference";
import { HISTORY_STATE_LABELS, RECONCILE_HISTORY, RECONCILE_HISTORY_PATH } from "@/lib/domain/reconcile-history";
import { DISCARD_CONFIRMATION, SET_ASIDE_MESSAGE, reconciliationStandings } from "@/lib/domain/reconcile-statement";
import { STATEMENT_READING_NOTE } from "@/lib/domain/pdf-statement-view";

/**
 * The screens of 2.03, "Reconciliation history and flow fixes": the
 * reconciliation workspace (bring the history forward, discard, the difference
 * in parts, Not a transaction / Restore, Extra lines), Add missing lines'
 * held-back lines with Add anyway, the new Reconcile history page, and the
 * import dialog's note. The components that draw from data are rendered; the
 * wiring to the server actions is read from the source, as the other
 * statement-screen contracts do. Every figure is invented.
 */

const ROOT = process.cwd();
const RECONCILE = join(ROOT, "app", "(app)", "banking", "reconcile");
/** A source file, its line endings as the repository keeps them: a Windows checkout writes CRLF. */
const read = (...parts: string[]) => readFileSync(join(RECONCILE, ...parts), "utf8").replace(/\r\n/g, "\n");
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const money = (minor: number) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toFixed(2)}`;

/** The text of a rendered component, tags stripped, so a test reads what a person reads. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** A stylesheet's phone rules: everything from its `@media (max-width: 640px)`. */
function phoneRules(css: string): string {
  const at = css.indexOf("@media (max-width: 640px)");
  expect(at, "no phone rules").toBeGreaterThan(-1);
  return css.slice(at);
}

/** One rule's body, from its selector to its closing brace. */
function ruleOf(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

/** A function's body: from its declaration to the first line that closes it at the given indent. */
function body(source: string, start: string, close = "\n  };\n"): string {
  const at = source.indexOf(start);
  expect(at, start).toBeGreaterThan(-1);
  const end = source.indexOf(close, at);
  expect(end, `${start} has no end`).toBeGreaterThan(at);
  return source.slice(at, end);
}

// --- Add missing lines, with lines held back ---------------------------------

const item = (lineNo: number, description: string, amountMinor: number): AddItem => ({
  lineNo,
  txnDate: "2026-07-28",
  description,
  amountMinor,
  transactionId: `t-${lineNo}`,
  accountId: `acct-${lineNo}`,
  accountLabel: "6400 — Bank Charges",
  source: "rule",
  short: "Rule 1",
  why: "Rule 1: SERVICE FEE",
});
const held = (base: AddItem, reason: HeldLine["reason"], note: string): HeldLine => ({ ...base, reason, note, matches: [] });
const plan = (items: AddItem[], heldLines: HeldLine[]): AddMissingPlan => ({
  missing: items.length + heldLines.length,
  items,
  held: heldLines,
  cannot: [],
  uncategorized: 0,
  blocked: null,
});
const duplicate = duplicateNote([{ journalLineId: "jl-1", entryId: "e-1", entryNumber: "JE-000310", entryDate: "2026-07-27" }]);

function renderBox(p: AddMissingPlan, withAddAnyway = true): string {
  return renderToString(
    createElement(AddMissingBox, {
      plan: p,
      bankAccountId: "bank-1",
      money,
      adding: false,
      onAdd: () => {},
      ...(withAddAnyway ? { onAddAnyway: () => {}, addingLine: null } : {}),
    }),
  );
}

describe("Add missing lines: the lines held back", () => {
  const shop = item(2, "POS EXAMPLE SHOP", -4200);
  const fee = item(3, "SERVICE FEE", -1500);
  const wire = item(4, "INCOMING WIRE", 3000);

  it("lists each held line with its date, description, amount, note and its own Add anyway", () => {
    const out = text(renderBox(plan([wire], [held(shop, "duplicate", duplicate), held(fee, "extra", EXTRA_LINE_NOTE)])));
    expect(out).toContain(HELD_BACK_HEADING);
    expect(out).toContain("Jul 28, 2026 · POS EXAMPLE SHOP · -$42.00");
    expect(out).toContain("Looks like JE-000310 already in the books.");
    expect(out).toContain("Jul 28, 2026 · SERVICE FEE · -$15.00");
    expect(out).toContain(EXTRA_LINE_NOTE);
    expect(out.split(ADD_ANYWAY).length - 1).toBe(2);
  });

  it("keeps Add all N to what it adds: the lines that are not held back", () => {
    const out = text(renderBox(plan([wire], [held(shop, "duplicate", duplicate)])));
    expect(out).toContain("Add all 1 to the books");
    expect(out).toContain("The bank shows 2 things your books do not.");
  });

  it("still shows the box, with the held lines and no Add all, when every missing line is held back", () => {
    const out = text(renderBox(plan([], [held(shop, "extra", EXTRA_LINE_NOTE), held(fee, "extra", EXTRA_LINE_NOTE)])));
    expect(out).toContain("The bank shows 2 things your books do not.");
    expect(out).toContain("POS EXAMPLE SHOP");
    expect(out).not.toMatch(/Add all \d/);
    expect(out.split(ADD_ANYWAY).length - 1).toBe(2);
  });

  it("offers Add anyway only to someone who may add", () => {
    const out = text(renderBox(plan([], [held(shop, "extra", EXTRA_LINE_NOTE)]), false));
    expect(out).toContain("POS EXAMPLE SHOP");
    expect(out).not.toContain(ADD_ANYWAY);
  });

  it("is wired to post one held line alone, chosen with Add anyway, and Add all to post only its own lines", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    const anyway = body(workspace, "async function addAnyway(", "\n  }\n");
    expect(anyway).toContain(
      "addMissingLinesAction(reconciliationId, [{ lineNo: line.lineNo, accountId: line.accountId }], [line.lineNo])",
    );
    const all = body(workspace, "async function addAll(", "\n  }\n");
    expect(all).toContain("shownPlan.items.map((item) => ({ lineNo: item.lineNo, accountId: item.accountId }))");
    expect(all).not.toMatch(/held|anyway/i);
    expect(workspace).toContain("onAddAnyway={(line) => void addAnyway(line)}");
  });
});

// --- The workspace's statement lines ------------------------------------------

describe("the statement lines table", () => {
  it("fits the 984px box of a 1280px window with the line's action, Description at its floor", () => {
    expect(STATEMENT_LINE_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    const measured = sum(Object.values(STATEMENT_LINE_WIDTH));
    expect(fitsBox(measured, STATEMENT_LINE_ELASTIC_FLOOR)).toBe(true);
    expect(measured + STATEMENT_LINE_ELASTIC_FLOOR).toBeLessThanOrEqual(TABLE_BOX_AT_1280);
    expect(STATEMENT_LINE_WIDTH.date).toBe(COLUMN.DATE);
  });

  it("draws every measured width it adds up, with no sideways scroll", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    for (const key of Object.keys(STATEMENT_LINE_WIDTH)) expect(workspace, key).toContain(`width: SW.${key}`);
    expect(workspace).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
  });

  it("keeps every column of the workspace's tables reachable on a phone: measured widths plus floors", () => {
    expect(STATEMENT_LINES_MIN_WIDTH).toBe(sum(Object.values(STATEMENT_LINE_WIDTH)) + STATEMENT_LINE_ELASTIC_FLOOR);
    expect(STATEMENT_LINES_READ_MIN_WIDTH).toBe(STATEMENT_LINES_MIN_WIDTH - STATEMENT_LINE_WIDTH.aside);
    expect(LEDGER_LINES_MIN_WIDTH).toBe(sum(Object.values(LEDGER_LINE_WIDTH)) + LEDGER_LINE_ELASTIC_FLOOR);
    expect(ADD_MISSING_MIN_WIDTH).toBe(sum(Object.values(ADD_MISSING_WIDTH)) + ADD_MISSING_ELASTIC_FLOOR);
    for (const floor of [STATEMENT_LINE_ELASTIC_FLOOR, LEDGER_LINE_ELASTIC_FLOOR, ADD_MISSING_ELASTIC_FLOOR]) {
      expect(floor).toBe(COLUMN.TEXT_MIN);
    }
    // The figures the stylesheet draws with are these.
    const phone = phoneRules(read("[id]", "workspace.module.css"));
    const minWidth = (selector: string) => ruleOf(phone, `${selector} :global(.ant-table-content) > table`);
    expect(minWidth(".statementLines")).toContain(`min-width: ${STATEMENT_LINES_READ_MIN_WIDTH}px;`);
    expect(minWidth(".statementLines.withAction")).toContain(`min-width: ${STATEMENT_LINES_MIN_WIDTH}px;`);
    expect(minWidth(".ledgerLines")).toContain(`min-width: ${LEDGER_LINES_MIN_WIDTH}px;`);
    expect(minWidth(".addMissing")).toContain(`min-width: ${ADD_MISSING_MIN_WIDTH}px;`);
  });

  it("scrolls Ant Design's own tables inside their box on a phone, and changes nothing at 1280", () => {
    const css = read("[id]", "workspace.module.css");
    // A raw Table's content box scrolls sideways only with scroll.x, which these tables never set.
    expect(phoneRules(css)).toContain(
      ".statementLines :global(.ant-table-content),\n  .ledgerLines :global(.ant-table-content) {\n    overflow-x: auto;",
    );
    // Every rule is a phone rule: nothing outside the media query.
    expect(css.slice(0, css.indexOf("@media"))).not.toContain("{");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bcolor\s*:/);
  });

  it("puts each table under its phone rule, the statement lines' action column with its own", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    expect(workspace).toContain(
      "className={writing ? `${styles.statementLines} ${styles.withAction}` : styles.statementLines}",
    );
    // The action column is drawn on exactly the same condition.
    expect(workspace).toContain("...(writing\n");
    expect(workspace).toContain("className={styles.ledgerLines}");
    const box = read("[id]", "AddMissingBox.tsx");
    expect(box).toContain("className={styles.addMissing}");
    for (const key of Object.keys(ADD_MISSING_WIDTH)) expect(box, key).toContain(`width: AW.${key}`);
  });

  it("offers Not a transaction and Restore only to a writer while in progress, through the server's action", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    expect(workspace).toContain('const inProgress = detail?.status === "in_progress";');
    expect(workspace).toContain("const writing = canWrite && inProgress;");
    const column = workspace.slice(workspace.indexOf("...(writing"), workspace.indexOf(": []),"));
    expect(column).toContain("asideActionFor(standingOf.get(line.lineNo))");
    expect(column).toContain("setAside(line.lineNo, action.aside)");
    const setAside = body(workspace, "async function setAside(", "\n  }\n");
    expect(setAside).toContain("setStatementLineAsideAction(reconciliationId, { line_no: lineNo, aside })");
    expect(setAside).toContain("message.error(res.error");
  });

  it("says a line set aside stays in Bank Transactions, and keeps its button busy until the lines are read again", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    const setAside = body(workspace, "async function setAside(", "\n  }\n");
    const said = setAside.indexOf("if (aside) message.success(SET_ASIDE_MESSAGE, 8);");
    expect(said).toBeGreaterThan(setAside.indexOf("setStatementLineAsideAction("));
    const reread = setAside.indexOf("await load();");
    expect(reread).toBeGreaterThan(said);
    expect(setAside.indexOf("setAsideLine(null);")).toBeGreaterThan(reread);
    expect(SET_ASIDE_MESSAGE).toBe(
      "Set aside as not a transaction. Its line stays in Bank Transactions — exclude it there if it is not real.",
    );
  });

  it("marks a line held back as extra beside its standing, and reads a line set aside as Not a transaction", () => {
    expect(read("[id]", "ReconcileWorkspaceClient.tsx")).toContain("extra={extraLines.has(line.lineNo)}");
    const extra = text(renderToString(createElement(StandingTag, { standing: { kind: "missing" }, extra: true })));
    expect(extra).toBe(`Not in the books ${EXTRA_LINE_TAG}`);
    expect(renderToString(createElement(StandingTag, { standing: { kind: "missing" }, extra: true }))).toContain(
      `title="${EXTRA_LINE_NOTE}"`,
    );
    expect(text(renderToString(createElement(StandingTag, { standing: { kind: "missing" } })))).toBe("Not in the books");
    expect(text(renderToString(createElement(StandingTag, { standing: { kind: "aside" }, extra: true })))).toBe("Not a transaction");
  });
});

// --- The difference, explained ----------------------------------------------

describe("the difference, explained", () => {
  const renderParts = (explained: DifferenceExplained) => text(renderToString(createElement(DifferenceAlert, { explained, money })));

  it("lists the opening, each line part with its count, and what is left, with the hint below", () => {
    const out = renderParts({
      differenceMinor: 512340 - 4200 + 1500 - 10000,
      opening: {
        beginningMinor: 0,
        openingMinor: 512340,
        amountMinor: 512340,
        text: "This reconciliation begins at $0.00; the statement opens at $5123.40.",
      },
      onStatement: { count: 2, amountMinor: -4200 + 1500, ids: [2, 3] },
      tickedNotOnStatement: { count: 1, amountMinor: 10000, ids: ["jl-9"] },
      leftMinor: 0,
      hint: null,
    });
    expect(out).toContain("The difference of $4996.40, explained");
    expect(out).toContain("Opening $5123.40");
    expect(out).toContain("This reconciliation begins at $0.00; the statement opens at $5123.40.");
    expect(out).toContain("On the statement, not in the books · 2 lines -$27.00");
    expect(out).toContain("Ticked here, not on the statement · 1 line $100.00");
    expect(out).toContain("Left to explain $0.00");
  });

  it("hides a line part with nothing in it, always shows what is left, and names the line that equals it", () => {
    const out = renderParts({
      differenceMinor: 1500,
      opening: null,
      onStatement: { count: 0, amountMinor: 0, ids: [] },
      tickedNotOnStatement: { count: 0, amountMinor: 0, ids: [] },
      leftMinor: 1500,
      hint: "It equals JE-000123 of Sep 5, 2026 ($15.00). Check that one first.",
    });
    expect(out).not.toContain("Opening");
    expect(out).not.toContain("On the statement, not in the books");
    expect(out).not.toContain("Ticked here, not on the statement");
    expect(out).toContain("Left to explain $15.00");
    expect(out).toContain("It equals JE-000123 of Sep 5, 2026 ($15.00). Check that one first.");
  });

  it("draws what explainDifference works out from the workspace's own objects", () => {
    // Opening $1,000.00; the books begin at 0. The deposit pairs and is ticked; the fee is not in the books.
    const statement = {
      endingDate: "2026-07-31",
      openingMinor: 100000,
      lines: [
        { lineNo: 0, txnDate: "2026-07-05", description: "DEPOSIT", reference: null, amountMinor: 50000, setAside: false },
        { lineNo: 1, txnDate: "2026-07-30", description: "SERVICE FEE", reference: null, amountMinor: -1500, setAside: false },
      ],
    };
    const book = [
      { journalLineId: "jl-1", entryId: "e-1", entryNumber: "JE-000101", entryDate: "2026-07-05", signedMinor: 50000, cleared: true, reference: null },
    ];
    const standings = reconciliationStandings(statement, book).standings;
    const explained = explainDifference(
      {
        detail: { beginningMinor: 0, clearedTotalMinor: 50000, statementEndingMinor: 148500, differenceMinor: 98500 },
        statement,
        standings,
        book,
      },
      money,
    );
    expect(explained).not.toBeNull();
    const out = renderParts(explained!);
    expect(out).toContain("Opening $1000.00");
    expect(out).toContain("On the statement, not in the books · 1 line -$15.00");
    expect(out).not.toContain("Ticked here, not on the statement");
    expect(out).toContain("Left to explain $0.00");
  });

  it("replaces Unexplained difference and keeps the zero message exactly", () => {
    const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");
    expect(workspace).not.toContain("Unexplained difference");
    expect(workspace).toContain('<Alert type="success" message="Difference is zero — ready to complete." />');
    expect(workspace).toContain("<DifferenceAlert explained={explained} money={money} />");
    expect(workspace).toContain("explainDifference(");
  });

  it("uses no colour of its own, so the dark theme follows", () => {
    for (const file of ["DifferenceAlert.tsx", "difference.module.css"]) {
      const source = read("[id]", file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bcolor\s*:/);
    }
  });
});

// --- Bringing the history forward, and discarding -----------------------------

describe("the workspace's bring forward and discard", () => {
  const workspace = read("[id]", "ReconcileWorkspaceClient.tsx");

  it("reads the offer alongside the figures, and words it while in progress only", () => {
    expect(workspace).toMatch(/void load\(\);\s*void loadHistory\(\);\s*\}, \[load, loadHistory\]\);/);
    expect(workspace).toContain("sessionHistoryAdviceAction(reconciliationId)");
    expect(workspace).toContain("const historyAdvice = inProgress ? sessionHistoryAdvice(historyFacts, money) : null;");
  });

  it("shows the button only to a writer, only when the books agree with the opening", () => {
    expect(workspace).toContain('type={historyAdvice.canBringForward ? "info" : "warning"}');
    expect(workspace).toMatch(/historyAdvice\.canBringForward && writing \? \(\s*<Button[^>]*onClick=\{\(\) => bringHistoryForward\(/);
  });

  it("asks first, counting the entries, then says how many and any file warning", () => {
    const bring = body(workspace, "const bringHistoryForward = (");
    expect(bring).toContain("content: bringHistoryForwardConfirmation(entries, facts.through)");
    expect(bring).toContain("bringHistoryForwardFromSessionAction(reconciliationId)");
    expect(bring).toContain("historyBroughtForwardMessage(r.data.lines, facts.through, rebased, money)");
    expect(bring).toContain("if (r.data.fileWarning) message.warning(r.data.fileWarning, 10);");
  });

  it("hides the old opening warning while the offer speaks", () => {
    expect(workspace).toContain("{opening && !completed && !historyAdvice ? <Alert");
  });

  it("takes the offer away the moment the history is brought forward, and cannot send it twice", () => {
    const bring = body(workspace, "const bringHistoryForward = (");
    expect(bring).toContain("if (bringing) return;\n    setBringing(true);");
    expect(bring).toContain("afterClose: () => setBringing(false),");
    // The figures and the offer are read again before the dialog closes and the
    // toast shows, so the spent offer never shows beside the old figures, and
    // clearing the offer alone would bring back the opening warning drawn from them.
    const reread = bring.indexOf("await Promise.all([load(), loadHistory()]);");
    expect(reread).toBeGreaterThan(bring.indexOf("throw new Error(r.error);"));
    expect(reread).toBeLessThan(bring.indexOf("message.success(historyBroughtForwardMessage("));
    expect(bring).not.toContain("setHistoryFacts(null);");
    expect(workspace).toMatch(/loading=\{bringing\}\s*onClick=\{\(\) => bringHistoryForward\(/);
  });

  it("offers Discard only to a writer while in progress", () => {
    expect(workspace).toMatch(/\{writing \? \(\s*<Button danger loading=\{discarding\} onClick=\{discard\}>\s*\{DISCARD_RECONCILIATION\}/);
  });

  it("keeps Discard busy from its click, and once discarded, until the screen has left", () => {
    const discard = body(workspace, "const discard = () => {");
    expect(discard).toContain("if (discarding) return;");
    expect(discard).toContain("setDiscarding(true);");
    expect(discard).toContain("if (!discarded) setDiscarding(false);");
    const done = discard.indexOf("discarded = true;");
    expect(done).toBeGreaterThan(discard.indexOf("discardReconciliationAction(reconciliationId"));
    expect(done).toBeLessThan(discard.indexOf("router.push("));
  });

  it("keeps Complete, Record adjustment and Reopen busy until the figures are read again", () => {
    const complete = body(workspace, "const complete = async () => {");
    expect(complete).toContain("if (completing) return;\n    setCompleting(true);");
    expect(complete.indexOf("await load();")).toBeGreaterThan(complete.indexOf("completeReconciliationAction("));
    expect(complete).toContain("} finally {\n      setCompleting(false);");
    expect(workspace).toMatch(/loading=\{completing\}/);

    const adjust = body(workspace, "const submitAdjust = async () => {");
    expect(adjust).toContain("if (adjusting) return;");
    expect(adjust.indexOf("await load();")).toBeGreaterThan(adjust.indexOf("recordAdjustmentAction("));
    expect(adjust).toContain("} finally {\n      setAdjusting(false);");
    expect(workspace).toContain("confirmLoading={adjusting}");

    const reopen = body(workspace, "const reopen = () => {");
    expect(reopen).toContain("if (reopening) return;\n    setReopening(true);");
    expect(reopen).toContain("afterClose: () => setReopening(false),");
    expect(reopen).toContain("await load();");
    expect(workspace).toContain("<Button danger loading={reopening} onClick={reopen}>");
  });

  it("requires a reason: the button starts disabled, and nothing is sent without one", () => {
    const discard = body(workspace, "const discard = () => {");
    expect(discard).toContain("{DISCARD_CONFIRMATION}");
    expect(discard).toContain("okButtonProps: { danger: true, disabled: true }");
    expect(discard).toContain("dialog.update({ okButtonProps: { danger: true, disabled: reasonProblem(reason) !== null } })");
    const check = discard.indexOf("const problem = reasonProblem(reason);");
    const send = discard.indexOf("discardReconciliationAction(reconciliationId, { reason: reason.trim() })");
    expect(check).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(check);
    expect(discard.slice(check, send)).toContain("throw new Error(problem);");
    expect(DISCARD_CONFIRMATION).toBe(
      "Its ticks are removed. The statement file and its bank lines stay, and any entries added to the books from it stay in the books.",
    );
  });

  it("returns to Reconcile with the router once discarded", () => {
    expect(body(workspace, "const discard = () => {")).toContain("router.push(discardedReturnPath(bankAccount.id));");
  });
});

// --- Reconcile history -----------------------------------------------------------

describe("the Reconcile history page", () => {
  const page = read("history", "page.tsx");
  const client = read("history", "ReconcileHistoryClient.tsx");

  it("is a route, a thin server shell with no Ant Design, linked back to Reconcile", () => {
    expect(existsSync(join(RECONCILE, "history", "page.tsx"))).toBe(true);
    expect(RECONCILE_HISTORY_PATH).toBe("/banking/reconcile/history");
    expect(page).not.toMatch(/^\s*["']use client["']/);
    expect(page).not.toMatch(/from ["']antd["']/);
    expect(page).toContain("<PageHeader");
    expect(page).toContain("title={RECONCILE_HISTORY}");
    expect(page).toContain('<Link href="/banking/reconcile">← Bank Reconciliation</Link>');
    expect(page).toContain("today={asOf}");
  });

  it("is linked from the Reconcile start screen", () => {
    expect(read("ReconcileListClient.tsx")).toContain("<Link href={RECONCILE_HISTORY_PATH}>{RECONCILE_HISTORY}</Link>");
    expect(RECONCILE_HISTORY).toBe("Reconcile history");
  });

  it("draws one row per account through DataTable, from the history action", () => {
    expect(client).toContain('import DataTable from "@/components/ui/DataTable"');
    expect(client).toMatch(/<DataTable<HistoryAccount>/);
    expect(client).not.toMatch(/<Table(?!\w)/);
    expect(client).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
    expect(client).not.toMatch(/pageSize:\s*\d/);
    expect(client).toContain("reconciliationHistoryAction()");
    for (const title of ["Account", "Lines not reconciled", "From", "To", "Last reconciled", "State"]) {
      expect(client, title).toContain(`title: "${title}"`);
    }
  });

  it("fits the 984px box of a 1280px window, Account at its floor", () => {
    expect(HISTORY_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    expect(fitsBox(sum(Object.values(HISTORY_COLUMN_WIDTH)), HISTORY_ELASTIC_FLOOR)).toBe(true);
    expect(HISTORY_COLUMN_WIDTH.choose).toBe(COLUMN.SELECTION);
    expect(HISTORY_COLUMN_WIDTH.from).toBe(HISTORY_SHORT_DATE);
    expect(HISTORY_COLUMN_WIDTH.to).toBe(HISTORY_SHORT_DATE);
    // "Sep 30, 2026" is wider than the 2026-09-30 the date token measures, and fits Last reconciled too.
    expect(HISTORY_SHORT_DATE).toBeGreaterThan(COLUMN.DATE);
    expect(HISTORY_COLUMN_WIDTH.lastReconciled).toBeGreaterThanOrEqual(HISTORY_SHORT_DATE);
    expect(client).toContain("columnWidth: W.choose");
    for (const key of Object.keys(HISTORY_COLUMN_WIDTH).filter((k) => k !== "choose")) {
      expect(client, key).toContain(`width: W.${key}`);
    }
  });

  it("prints its dates as its card does, Sep 30, 2026", () => {
    for (const [title, field, width] of [
      ["From", "firstOpenDate", "W.from"],
      ["To", "lastOpenDate", "W.to"],
      ["Last reconciled", "lastReconciledDate", "W.lastReconciled"],
    ]) {
      expect(client, title).toContain(`{ title: "${title}", dataIndex: "${field}", width: ${width}, render: historyDateCell }`);
    }
    expect(client).toContain('(iso ? <time dateTime={iso}>{shortDate(iso, true)}</time> : "—")');
    expect(client).not.toContain("dateColumn");
  });

  it("keeps Account's name and number on a phone: measured widths plus its floor, scrolled inside the table's box", () => {
    expect(HISTORY_MIN_WIDTH).toBe(sum(Object.values(HISTORY_COLUMN_WIDTH)) + HISTORY_ELASTIC_FLOOR);
    const css = read("history", "history.module.css");
    expect(ruleOf(phoneRules(css), ".history :global(.ant-table-content) > table")).toContain(`min-width: ${HISTORY_MIN_WIDTH}px;`);
    // DataTable's content box already scrolls sideways (globals.css), so the page does not.
    expect(readFileSync(join(ROOT, "app", "globals.css"), "utf8")).toMatch(
      /\.accounting-table--fit \.ant-table-content,\s*\.accounting-table--fit \.ant-table-body \{\s*overflow-x: auto;/,
    );
    expect(client).toContain("<div className={styles.history}>");
  });

  it("marks the chosen account with a light wash rather than the heavy default fill, from the theme's tokens", () => {
    const css = read("history", "history.module.css");
    // Doubled, so it outranks Ant Design's own rule, as Review import does.
    expect(css).toContain(
      ".history.history :global(.ant-table-tbody > tr.ant-table-row-selected > td.ant-table-cell) {\n  background: var(--ob-accent-wash);",
    );
    expect(css).toContain(
      ".history.history :global(.ant-table-tbody > tr.ant-table-row-selected:hover > td.ant-table-cell) {\n  background: var(--ob-surface-subtle);",
    );
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\bcolor\s*:/);
  });

  it("cannot send Bring forward twice, and clears the form at once when it is done", () => {
    const bring = body(client, "function bringForward(", "\n  }\n");
    expect(bring).toContain("if (!shown.action || bringing) return;\n    setBringing(true);");
    expect(bring).toContain("afterClose: () => setBringing(false),");
    expect(bring.indexOf("setThrough(null);")).toBeGreaterThan(bring.indexOf("throw new Error(r.error);"));
    expect(bring.indexOf("setThrough(null);")).toBeLessThan(bring.indexOf("void load();"));
    expect(client).toMatch(/loading=\{bringing\}\s*onClick=\{\(\) => bringForward\(/);
  });

  it("reads each state in its own word, on the shared tones", () => {
    expect(HISTORY_STATE_TONES.never).toEqual({ tone: "warning", label: HISTORY_STATE_LABELS.never });
    expect(HISTORY_STATE_TONES.reconciled).toEqual({ tone: "positive", label: HISTORY_STATE_LABELS.reconciled });
    for (const state of Object.values(HISTORY_STATE_TONES)) expect(TONES).toContain(state.tone);
  });

  it("cannot choose a date after the company's today", () => {
    expect(client).toContain('disabledDate={(day) => day.format("YYYY-MM-DD") > today}');
  });

  it("reads the books once the date settles, for the account and date asked, and words it with historyAdvice", () => {
    expect(client).toContain("window.setTimeout(");
    expect(client).toContain("PREVIEW_DELAY_MS");
    expect(client).toContain("historyPreviewAction({ bank_account_id: chosenId, through: throughIso })");
    expect(client).toContain("preview.key === previewKey");
    expect(client).toContain("historyAdvice(chosen, throughIso, balanceMinor, shownPreview, money)");
  });

  it("offers Bring forward N entries only to a writer, on a match, after asking", () => {
    expect(client).toMatch(/advice\.action && canWrite && throughIso && balanceMinor !== null \? \(\s*<Button/);
    const bring = body(client, "function bringForward(", "\n  }\n");
    expect(bring).toContain("content: bringHistoryForwardConfirmation(shown.entries, date)");
    expect(bring).toContain("bringHistoryForwardAction({");
    expect(bring).toContain("historyBroughtForwardMessage(r.data.lines, date, rebased, money)");
  });

  it("sends a session in the way to that session, and says Reconciled up to on an account already reconciled", () => {
    expect(client).toContain('advice?.kind === "inProgress" && advice.inProgressId');
    expect(client).toContain("<Link href={`/banking/reconcile/${advice.inProgressId}`}>{OPEN_IN_PROGRESS}</Link>");
    expect(client).toContain("reconciledUpTo(chosen.lastReconciledDate)");
    expect(client).toContain('advice?.kind === "out"');
  });
});

// --- The Guide -------------------------------------------------------------------

describe("the Guide's reconcile steps", () => {
  const steps = GUIDE_FLOWS.flatMap((flow) => flow.steps);
  const note = (action: string) => {
    const step = steps.find((s) => s.action === action);
    expect(step, action).toBeDefined();
    return step?.note ?? "";
  };

  it("words Complete's rule as the screen does: the difference in its parts, zero or a recorded adjustment", () => {
    for (const step of steps) expect(step.note ?? "", step.action).not.toMatch(/unexplained difference/i);
    const reconcile = note("Reconcile to a statement balance");
    expect(reconcile).toContain("The difference is explained in its parts");
    expect(reconcile).toContain("Complete needs a difference of zero or a recorded adjustment somebody signs for.");
  });

  it("says a line set aside stays in Bank Transactions", () => {
    expect(note("Set aside a statement line that is not a transaction")).toContain(
      "its line stays in Bank Transactions, to exclude there if it is not real",
    );
  });

  it("says when a single line is Extra beside a line that is really missing", () => {
    expect(note("Add a line held back from Add all")).toContain(
      "When it does not add up and exactly one of them is the amount it is out by, that one alone is Extra.",
    );
  });
});

// --- The import dialog -----------------------------------------------------------

describe("the statement import dialog", () => {
  it("says which files are read exactly and which can be misread, wherever it is opened from", () => {
    const modal = readFileSync(join(ROOT, "app", "(app)", "banking", "ImportStatementModal.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(modal).toContain("{STATEMENT_READING_NOTE}");
    // Not tied to a prop: every caller's dialog says it.
    expect(modal).not.toMatch(/\w+ \? \(?\s*<Typography\.Text[^>]*>\s*\{STATEMENT_READING_NOTE\}/);
    expect(STATEMENT_READING_NOTE).toBe(
      "A bank download (CSV, QFX or OFX) is read exactly. A PDF is read from its text, and a check image or a summary table can be misread.",
    );
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/reconcile-history-screens.test.ts
```

Expected: FAIL — `tests/unit/reconcile-history-screens.test.ts` reads `app/(app)/banking/reconcile/history/ReconcileHistoryClient.tsx`, which does not exist yet.

- [ ] **Step 3: Edit `ctyhp-accounting/app/(app)/banking/ImportStatementModal.tsx`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```tsx
import { toStatementLines, type PdfStatement } from "@/lib/domain/pdf-statement";
import { pickStatement, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";
```

replace with:

```tsx
import { toStatementLines, type PdfStatement } from "@/lib/domain/pdf-statement";
import { STATEMENT_READING_NOTE, pickStatement, summarizeStatement } from "@/lib/domain/pdf-statement-view";
import { formatMoney } from "@/lib/format";
```

Edit 2 of 2 — find:

```tsx
      </Upload.Dragger>

```

replace with:

```tsx
      </Upload.Dragger>
      {/* Which files are read exactly and which can be misread, wherever the dialog is opened from (2.03). */}
      <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 8 }}>
        {STATEMENT_READING_NOTE}
      </Typography.Text>

```

- [ ] **Step 4: Edit `ctyhp-accounting/app/(app)/banking/reconcile/ReconcileListClient.tsx`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```tsx
import { chosenBankId } from "@/lib/domain/reconcile-alerts-screen";
import { createReconciliationAction, listReconciliationsAction } from "./actions";
```

replace with:

```tsx
import { chosenBankId } from "@/lib/domain/reconcile-alerts-screen";
import { RECONCILE_HISTORY, RECONCILE_HISTORY_PATH } from "@/lib/domain/reconcile-history";
import { createReconciliationAction, listReconciliationsAction } from "./actions";
```

Edit 2 of 2 — find:

```tsx
        )}
      </Space>
```

replace with:

```tsx
        )}
        {/* Every account's lines not yet reconciled, and bringing an account's history forward (2.03). */}
        <Link href={RECONCILE_HISTORY_PATH}>{RECONCILE_HISTORY}</Link>
      </Space>
```

- [ ] **Step 5: Create `ctyhp-accounting/app/(app)/banking/reconcile/[id]/statement-line-columns.ts`** with exactly this content:

```ts
import { COLUMN } from "@/lib/design/table-metrics";

/**
 * The reconciliation workspace's three tables, and how narrow each is drawn on
 * a phone.
 *
 * The figures here are the ones `workspace.module.css` draws with; change one
 * and change the other, and `tests/unit/reconcile-history-screens.test.ts`
 * adds them up. Under 640px each table is held to its widths plus its floors
 * and scrolls inside its own box, so the page never scrolls sideways and the
 * right-hand columns ("With the books", Not a transaction / Restore, "Would
 * post to") can still be reached. At 1280 nothing here changes how a table is
 * drawn.
 */

/**
 * The statement lines table: its measured columns, in the order they are
 * drawn, and the floor of its one elastic column (Description).
 *
 * 2.03 adds a column for the line's action — Not a transaction, or Restore —
 * shown to someone who can write while the reconciliation is in progress. Its
 * width comes out of Description, and Date takes the date token, since the
 * table prints the date as 2026-07-13, the very format the token measures.
 * Kept apart from the client component so a unit test can add the row up
 * against the 984px box of a 1280px window.
 */
export const STATEMENT_LINE_WIDTH = {
  date: COLUMN.DATE,
  reference: 130,
  amount: 130,
  /** "Paired · check number · not ticked", or "Not in the books" with "Extra" beside it. */
  standing: 280,
  /** One small link button, "Not a transaction" at its longest. */
  aside: 148,
} as const;

/** Description takes what the measured columns leave, down to this. */
export const STATEMENT_LINE_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

/** On a phone, with the line's action: every measured column, and Description at its floor. */
export const STATEMENT_LINES_MIN_WIDTH =
  STATEMENT_LINE_WIDTH.date +
  STATEMENT_LINE_WIDTH.reference +
  STATEMENT_LINE_WIDTH.amount +
  STATEMENT_LINE_WIDTH.standing +
  STATEMENT_LINE_WIDTH.aside +
  STATEMENT_LINE_ELASTIC_FLOOR;

/** On a phone, for someone who sees no action column (a viewer, or a reconciliation completed). */
export const STATEMENT_LINES_READ_MIN_WIDTH = STATEMENT_LINES_MIN_WIDTH - STATEMENT_LINE_WIDTH.aside;

/**
 * A cell of Ant Design's default size carries 16px of padding a side, where
 * the small tables the column tokens are measured in carry 8: 16px more a
 * column.
 */
const DEFAULT_SIZE_EXTRA = 16;

/**
 * The ledger lines table declares no widths: at 1280 it lays itself out, and
 * that is left as it is. These are what its columns need to keep their text
 * on one line — the tokens, plus the default size's padding — used only for
 * the narrowest it is drawn on a phone, where its dates and entry numbers
 * otherwise broke over two lines and Amount fell off the right-hand edge.
 */
export const LEDGER_LINE_WIDTH = {
  /** "Cleared" over one checkbox. */
  cleared: 72 + DEFAULT_SIZE_EXTRA,
  date: COLUMN.DATE + DEFAULT_SIZE_EXTRA,
  entry: COLUMN.CODE + DEFAULT_SIZE_EXTRA,
  /** One tag: manual, bank, invoice… */
  source: COLUMN.STATUS + DEFAULT_SIZE_EXTRA,
  reference: COLUMN.CODE + DEFAULT_SIZE_EXTRA,
  amount: COLUMN.MONEY + DEFAULT_SIZE_EXTRA,
  /** The "Outstanding" tag. */
  outstanding: COLUMN.STATUS + DEFAULT_SIZE_EXTRA,
} as const;

/** Memo, typed text, at its floor. */
export const LEDGER_LINE_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

export const LEDGER_LINES_MIN_WIDTH =
  LEDGER_LINE_WIDTH.cleared +
  LEDGER_LINE_WIDTH.date +
  LEDGER_LINE_WIDTH.entry +
  LEDGER_LINE_WIDTH.source +
  LEDGER_LINE_WIDTH.reference +
  LEDGER_LINE_WIDTH.amount +
  LEDGER_LINE_WIDTH.outstanding +
  LEDGER_LINE_ELASTIC_FLOOR;

/**
 * The Add missing box's "Would post to" table (a small DataTable). Description
 * carries no width and takes what is left; on a phone it had none left, and
 * ran over Amount.
 */
export const ADD_MISSING_WIDTH = {
  /** "Sep 30, 2026". */
  date: 120,
  amount: 130,
  /** The account, with "needs coding" or the rule beside it. */
  postTo: 300,
} as const;

export const ADD_MISSING_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

export const ADD_MISSING_MIN_WIDTH =
  ADD_MISSING_WIDTH.date + ADD_MISSING_WIDTH.amount + ADD_MISSING_WIDTH.postTo + ADD_MISSING_ELASTIC_FLOOR;
```

- [ ] **Step 6: Create `ctyhp-accounting/app/(app)/banking/reconcile/[id]/workspace.module.css`** with exactly this content:

```css
/*
 * The reconciliation workspace's tables on a phone. Layout only — no colour.
 *
 * Below 640px the statement lines, the ledger lines and the Add missing box's
 * "Would post to" table are each held to their measured widths plus their
 * floors, and scroll inside their own box while the page does not — the
 * precedent of the statement-alert cards (statement-alerts.module.css). The
 * widths are in statement-line-columns.ts; change one and change the other.
 *
 * The statement and ledger lines are Ant Design's own Table, whose content box
 * scrolls sideways only when `scroll.x` is set, so it is told to here. The
 * Add missing table is a DataTable, whose content box already scrolls
 * (`.accounting-table--fit .ant-table-content` in globals.css).
 *
 * At 1280 none of this applies, and every table is drawn as it was.
 */

@media (max-width: 640px) {
  .statementLines :global(.ant-table-content),
  .ledgerLines :global(.ant-table-content) {
    overflow-x: auto;
  }

  /* STATEMENT_LINES_READ_MIN_WIDTH, then STATEMENT_LINES_MIN_WIDTH with the line's action. */
  .statementLines :global(.ant-table-content) > table {
    min-width: 828px;
  }

  .statementLines.withAction :global(.ant-table-content) > table {
    min-width: 976px;
  }

  /* LEDGER_LINES_MIN_WIDTH. */
  .ledgerLines :global(.ant-table-content) > table {
    min-width: 1016px;
  }

  /* ADD_MISSING_MIN_WIDTH. */
  .addMissing :global(.ant-table-content) > table {
    min-width: 750px;
  }
}
```

- [ ] **Step 7: Create `ctyhp-accounting/app/(app)/banking/reconcile/[id]/difference.module.css`** with exactly this content:

```css
/*
 * The difference, explained (2.03): each part's name on the left, its amount
 * on the right, and the opening's sentence under its name. Layout only — the
 * colours are the Alert's and Typography's, so the dark theme follows.
 *
 * The modifiers are written `.parts .x` so they outrank `.parts dt` and
 * `.parts dd`; a bare `.x` would lose to them and change nothing.
 */

.parts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 16px;
  row-gap: 2px;
  margin: 0;
  max-width: 560px;
}

.parts dt {
  min-width: 0;
  font-weight: 400;
}

.parts dd {
  margin: 0;
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* The opening's sentence spans both columns, under its name, and wraps. */
.parts .note {
  grid-column: 1 / -1;
  margin-bottom: 4px;
  text-align: left;
  white-space: normal;
}

/* Left to explain closes the list, set apart by a little room. */
.parts .left {
  margin-top: 4px;
  font-weight: 600;
}

.hint {
  display: block;
  margin-top: 8px;
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/banking/reconcile/[id]/DifferenceAlert.tsx`** with exactly this content:

```tsx
"use client";
import { Alert, Typography } from "antd";
import { DIFFERENCE_LABELS, differenceHeading, linesCount, type DifferenceExplained } from "@/lib/domain/reconcile-difference";
import styles from "./difference.module.css";

/**
 * The difference a reconciliation is out by, in its parts (2.03): where the
 * statement opens against where this reconciliation begins, the statement
 * lines the books do not have, the ticks the statement does not have, and what
 * is left to explain. A line part with nothing in it is not shown; what is
 * left always is. The figures and sentences are explainDifference's.
 */
export default function DifferenceAlert({
  explained,
  money,
}: {
  explained: DifferenceExplained;
  money: (minor: number) => string;
}) {
  const { opening, onStatement, tickedNotOnStatement, leftMinor, hint } = explained;
  return (
    <Alert
      type="warning"
      showIcon
      title={differenceHeading(explained.differenceMinor, money)}
      description={
        <>
          <dl className={styles.parts}>
            {opening ? (
              <>
                <dt>{DIFFERENCE_LABELS.opening}</dt>
                <dd>{money(opening.amountMinor)}</dd>
                <dd className={styles.note}>
                  <Typography.Text type="secondary">{opening.text}</Typography.Text>
                </dd>
              </>
            ) : null}
            {onStatement && onStatement.count > 0 ? (
              <>
                <dt>
                  {DIFFERENCE_LABELS.onStatement} · {linesCount(onStatement.count)}
                </dt>
                <dd>{money(onStatement.amountMinor)}</dd>
              </>
            ) : null}
            {tickedNotOnStatement && tickedNotOnStatement.count > 0 ? (
              <>
                <dt>
                  {DIFFERENCE_LABELS.tickedNotOnStatement} · {linesCount(tickedNotOnStatement.count)}
                </dt>
                <dd>{money(tickedNotOnStatement.amountMinor)}</dd>
              </>
            ) : null}
            <dt className={styles.left}>{DIFFERENCE_LABELS.left}</dt>
            <dd className={styles.left}>{money(leftMinor)}</dd>
          </dl>
          {hint ? <Typography.Text className={styles.hint}>{hint}</Typography.Text> : null}
        </>
      }
    />
  );
}
```

- [ ] **Step 9: Edit `ctyhp-accounting/app/(app)/banking/reconcile/[id]/AddMissingBox.tsx`** — apply these 11 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 11 — find:

```tsx
import DataTable from "@/components/ui/DataTable";
import type { AddItem, AddMissingPlan } from "@/lib/domain/add-missing";
import { shortDate } from "@/lib/domain/pdf-statement-view";
```

replace with:

```tsx
import DataTable from "@/components/ui/DataTable";
import { ADD_ANYWAY, HELD_BACK_HEADING, type AddItem, type AddMissingPlan, type HeldLine } from "@/lib/domain/add-missing";
import { shortDate } from "@/lib/domain/pdf-statement-view";
```

Edit 2 of 11 — find:

```tsx
import { shortDate } from "@/lib/domain/pdf-statement-view";

```

replace with:

```tsx
import { shortDate } from "@/lib/domain/pdf-statement-view";
import { ADD_MISSING_WIDTH as AW } from "./statement-line-columns";
import styles from "./workspace.module.css";

```

Edit 3 of 11 — find:

```tsx
 * more.
 */
```

replace with:

```tsx
 * more.
 *
 * Lines the plan holds back (2.03) — a line the statement balances without,
 * and a line the books seem to hold already — are listed apart, each with why
 * and its own Add anyway. "Add all N" adds only the table's lines, so when
 * every line is held back there is no Add all.
 *
 * On a phone the table keeps its measured widths and scrolls inside the box
 * (workspace.module.css, ADD_MISSING_MIN_WIDTH).
 */
```

Edit 4 of 11 — find:

```tsx
  onAdd: () => void;
}
```

replace with:

```tsx
  onAdd: () => void;
  /** Posts one held-back line alone; without it, the held lines are listed with no button. */
  onAddAnyway?: (line: HeldLine) => void;
  /** The held-back line being added, while it is. */
  addingLine?: number | null;
}
```

Edit 5 of 11 — find:

```tsx

export default function AddMissingBox({ plan, bankAccountId, money, adding, onAdd }: Props) {
  const { missing, items, cannot, blocked } = plan;
  return (
```

replace with:

```tsx

export default function AddMissingBox({ plan, bankAccountId, money, adding, onAdd, onAddAnyway, addingLine = null }: Props) {
  const { missing, items, held, cannot, blocked } = plan;
  const busy = adding || addingLine !== null;
  return (
```

Edit 6 of 11 — find:

```tsx
            <DataTable<AddItem>
              rowKey="lineNo"
```

replace with:

```tsx
            <DataTable<AddItem>
              className={styles.addMissing}
              rowKey="lineNo"
```

Edit 7 of 11 — find:

```tsx
              columns={[
                { title: "Date", render: (_, item) => shortDate(item.txnDate, true), width: 120 },
                { title: "Description", dataIndex: "description" },
```

replace with:

```tsx
              columns={[
                { title: "Date", render: (_, item) => shortDate(item.txnDate, true), width: AW.date },
                { title: "Description", dataIndex: "description" },
```

Edit 8 of 11 — find:

```tsx
                { title: "Description", dataIndex: "description" },
                { title: "Amount", align: "right", render: (_, item) => money(item.amountMinor), width: 130 },
                {
```

replace with:

```tsx
                { title: "Description", dataIndex: "description" },
                { title: "Amount", align: "right", render: (_, item) => money(item.amountMinor), width: AW.amount },
                {
```

Edit 9 of 11 — find:

```tsx
                  title: "Would post to",
                  width: 300,
                  render: (_, item) => (
```

replace with:

```tsx
                  title: "Would post to",
                  width: AW.postTo,
                  render: (_, item) => (
```

Edit 10 of 11 — find:

```tsx
          ) : null}
          {cannot.length ? (
```

replace with:

```tsx
          ) : null}
          {held.length ? (
            <div>
              <Typography.Text type="secondary">{HELD_BACK_HEADING}</Typography.Text>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {held.map((line) => (
                  <li key={line.lineNo} style={{ marginBottom: 6 }}>
                    <Space size={[8, 2]} wrap align="center">
                      <span>
                        {shortDate(line.txnDate, true)} · {line.description || "(no description)"} · {money(line.amountMinor)} →{" "}
                        <Tooltip title={line.why}>
                          <span>{line.accountLabel}</span>
                        </Tooltip>
                      </span>
                      {onAddAnyway ? (
                        <Button
                          size="small"
                          loading={addingLine === line.lineNo}
                          disabled={busy && addingLine !== line.lineNo}
                          onClick={() => onAddAnyway(line)}
                        >
                          {ADD_ANYWAY}
                        </Button>
                      ) : null}
                    </Space>
                    <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                      {line.note}
                    </Typography.Text>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {cannot.length ? (
```

Edit 11 of 11 — find:

```tsx
            {items.length && !blocked ? (
              <Button type="primary" loading={adding} onClick={onAdd}>
                Add all {items.length} to the books
```

replace with:

```tsx
            {items.length && !blocked ? (
              <Button type="primary" loading={adding} disabled={addingLine !== null} onClick={onAdd}>
                Add all {items.length} to the books
```

- [ ] **Step 10: Replace the whole of `ctyhp-accounting/app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx`** (most of it changes) with exactly this content:

```tsx
"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { fromMinor } from "@/lib/domain/money";
import type { PdfStatement } from "@/lib/domain/pdf-statement";
import type { StatementLine } from "@/lib/domain/statement-import";
import {
  BRING_HISTORY_FORWARD,
  DISCARD_CONFIRMATION,
  DISCARD_RECONCILIATION,
  SET_ASIDE_MESSAGE,
  asideActionFor,
  bringHistoryForwardConfirmation,
  closingAdvice,
  discardedMessage,
  discardedReturnPath,
  openingAdvice,
  pairingMessage,
  reconciliationStandings,
  sessionHistoryAdvice,
  type SessionHistoryFacts,
} from "@/lib/domain/reconcile-statement";
import { explainDifference } from "@/lib/domain/reconcile-difference";
import { historyBroughtForwardMessage } from "@/lib/domain/reconcile-history";
import { REASON_MAX, reasonProblem } from "@/lib/domain/reconcile-alerts-screen";
import { formatMoney } from "@/lib/format";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import { keepFailureMessage, linesSpan, serverFailure, statementFileMismatch } from "@/lib/domain/statement-evidence";
import { downloadSavedFile } from "@/lib/client/saved-file-download";
import type { KeptStatementFile } from "@/lib/client/keep-statement-file";
import { attachStatementFileAction } from "../../statement-file-actions";
import {
  reconciliationLinesAction,
  reconciliationDetailAction,
  setClearedAction,
  recordAdjustmentAction,
  completeReconciliationAction,
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
import {
  bringHistoryForwardFromSessionAction,
  discardReconciliationAction,
  sessionHistoryAdviceAction,
  setStatementLineAsideAction,
} from "../history-actions";
import {
  addedMessage,
  addedNotPairedMessage,
  extraLineNos,
  type AddMissingPlan,
  type HeldLine,
} from "@/lib/domain/add-missing";
import { bankLinesToCheck, completedMessage } from "@/lib/domain/statement-bank-lines";
import AddMissingBox from "./AddMissingBox";
import DifferenceAlert from "./DifferenceAlert";
import { STATEMENT_LINE_WIDTH as SW } from "./statement-line-columns";
import styles from "./workspace.module.css";
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
  /** The account a kept statement file is named after: "Example Bank ****1183". */
  fileAccount: string;
}

export default function ReconcileWorkspaceClient({
  reconciliationId,
  canWrite,
  canReopen,
  offsetAccounts,
  baseCurrency,
  baseDecimals,
  bankAccount,
  fileAccount,
}: Props) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [lines, setLines] = useState<ReconLineView[]>([]);
  const [detail, setDetail] = useState<ReconDetail | null>(null);
  const [statement, setStatement] = useState<ReconStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [matching, setMatching] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form] = Form.useForm();
  const [statementLinesPageSize, setStatementLinesPageSize] = useState<number>(
    STATEMENT_LINES_DEFAULT_PAGE_SIZE,
  );
  // The plan, with the lines it was worked out for.
  const [addPlan, setAddPlan] = useState<{ key: string; plan: AddMissingPlan } | null>(null);
  const [adding, setAdding] = useState(false);
  // Asks for the plan again when an add was refused because it changed.
  const [planAsked, setPlanAsked] = useState(0);
  // The held-back line being added with Add anyway, and the statement line being set aside or restored.
  const [addingLine, setAddingLine] = useState<number | null>(null);
  const [asideLine, setAsideLine] = useState<number | null>(null);
  // What an offer to bring the account's history forward rests on (2.03); null when there is none.
  const [historyFacts, setHistoryFacts] = useState<SessionHistoryFacts | null>(null);
  // A button that writes is busy from its click until the screen has caught
  // up, so a second click cannot send it twice: bringing the history forward,
  // discarding and reopening while their dialog is open or their request runs,
  // Complete and Record adjustment until the figures are read again.
  const [bringing, setBringing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [reopening, setReopening] = useState(false);

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

  // Read apart from the figures, so ticking a line does not wait on it: only a
  // statement imported or attached, the history brought forward, or a reopen
  // changes what it says.
  const loadHistory = useCallback(async () => {
    const h = await sessionHistoryAdviceAction(reconciliationId);
    if (h.ok) setHistoryFacts(h.data ?? null);
    else message.error(h.error ?? "Failed");
  }, [reconciliationId, message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadHistory();
  }, [load, loadHistory]);

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
  // Once the figures say so: discarding, setting a line aside and bringing the
  // history forward are for a reconciliation in progress, and for a writer.
  const inProgress = detail?.status === "in_progress";
  const writing = canWrite && inProgress;

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
  // The lines the plan holds back as extra are marked in the statement lines table too.
  const extraLines = useMemo(() => extraLineNos(shownPlan), [shownPlan]);

  /** What adding lines said, and the screen brought up to date; a refusal asks for the plan again. */
  function afterAdding(res: Awaited<ReturnType<typeof addMissingLinesAction>>) {
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

  async function addAll() {
    if (!shownPlan) return;
    setAdding(true);
    try {
      afterAdding(
        await addMissingLinesAction(
          reconciliationId,
          shownPlan.items.map((item) => ({ lineNo: item.lineNo, accountId: item.accountId })),
        ),
      );
    } finally {
      setAdding(false);
    }
  }

  /** One held-back line alone, posted without the duplicate check: the person has looked at it. */
  async function addAnyway(line: HeldLine) {
    setAddingLine(line.lineNo);
    try {
      afterAdding(
        await addMissingLinesAction(reconciliationId, [{ lineNo: line.lineNo, accountId: line.accountId }], [line.lineNo]),
      );
    } finally {
      setAddingLine(null);
    }
  }

  /**
   * Sets a statement line aside as not a transaction, or restores it. A refusal
   * is said as the server words it. Setting aside says the bank line stays in
   * Bank Transactions. The line's button stays busy until the lines are read
   * again, so it never offers the action it has just taken.
   */
  async function setAside(lineNo: number, aside: boolean) {
    setAsideLine(lineNo);
    try {
      const res = await setStatementLineAsideAction(reconciliationId, { line_no: lineNo, aside });
      if (!res.ok) {
        message.error(res.error ?? "The statement line could not be changed");
        return;
      }
      if (aside) message.success(SET_ASIDE_MESSAGE, 8);
      await load();
    } finally {
      setAsideLine(null);
    }
  }

  const statementClosing = statement?.closingMinor ?? null;
  const closing = detail ? closingAdvice(statementClosing, detail.statementEndingMinor, money) : null;
  const opening = statement && detail ? openingAdvice(statement.openingMinor, detail.beginningMinor, money) : null;
  // Bringing the history forward, while in progress (2.03). When it speaks, it
  // says what the opening advice says, and more usefully, so that one is hidden.
  const historyAdvice = inProgress ? sessionHistoryAdvice(historyFacts, money) : null;
  // The difference in its parts; null when there is none.
  const explained =
    detail && !completed
      ? explainDifference(
          {
            detail,
            statement: statement ? { openingMinor: statement.openingMinor, lines: statement.lines } : null,
            standings: standings?.standings ?? null,
            book: lines,
          },
          money,
        )
      : null;

  const bringHistoryForward = (facts: SessionHistoryFacts, entries: number) => {
    if (bringing) return;
    setBringing(true);
    modal.confirm({
      title: `${BRING_HISTORY_FORWARD}?`,
      content: bringHistoryForwardConfirmation(entries, facts.through),
      okText: BRING_HISTORY_FORWARD,
      cancelText: "Cancel",
      afterClose: () => setBringing(false),
      onOk: async () => {
        const r = await bringHistoryForwardFromSessionAction(reconciliationId);
        if (!r.ok || !r.data) {
          message.error(r.error ?? "The history could not be brought forward");
          throw new Error(r.error);
        }
        // The figures and the offer are read again before the dialog closes, so
        // the screen changes once: no spent offer left behind, and no opening
        // warning drawn from the figures as they were before.
        await Promise.all([load(), loadHistory()]);
        const rebased = r.data.rebasedReconciliationId ? facts.openingMinor : null;
        message.success(historyBroughtForwardMessage(r.data.lines, facts.through, rebased, money), 8);
        if (r.data.fileWarning) message.warning(r.data.fileWarning, 10);
      },
    });
  };

  /**
   * Discards this reconciliation in progress, with a reason, and returns to
   * Reconcile. The dialog's button stays disabled until a reason is typed, and
   * the same rule is checked again before anything is sent.
   */
  const discard = () => {
    if (discarding) return;
    let reason = "";
    // Once discarded the screen is on its way back to Reconcile: the button stays busy.
    let discarded = false;
    setDiscarding(true);
    const dialog = modal.confirm({
      title: `${DISCARD_RECONCILIATION}?`,
      content: (
        <Space orientation="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Text>{DISCARD_CONFIRMATION}</Typography.Text>
          <Input.TextArea
            aria-label="Reason"
            placeholder="Reason (required)"
            maxLength={REASON_MAX}
            autoSize={{ minRows: 2, maxRows: 4 }}
            onChange={(e) => {
              reason = e.target.value;
              dialog.update({ okButtonProps: { danger: true, disabled: reasonProblem(reason) !== null } });
            }}
          />
        </Space>
      ),
      okText: "Discard",
      okButtonProps: { danger: true, disabled: true },
      cancelText: "Cancel",
      afterClose: () => {
        if (!discarded) setDiscarding(false);
      },
      onOk: async () => {
        const problem = reasonProblem(reason);
        if (problem) {
          message.error(problem);
          throw new Error(problem);
        }
        const r = await discardReconciliationAction(reconciliationId, { reason: reason.trim() });
        if (!r.ok || !r.data) {
          message.error(r.error ?? "The reconciliation could not be discarded");
          throw new Error(r.error);
        }
        discarded = true;
        message.success(discardedMessage(r.data.ticksRemoved));
        router.push(discardedReturnPath(bankAccount.id));
      },
    });
  };

  const toggle = async (line: ReconLineView, cleared: boolean) => {
    const r = await setClearedAction(reconciliationId, line.journalLineId, cleared);
    if (r.ok) void load();
    else message.error(r.error ?? "Failed");
  };

  const submitAdjust = async () => {
    if (adjusting) return;
    const v = await form.validateFields();
    setAdjusting(true);
    try {
      const r = await recordAdjustmentAction(reconciliationId, { offset_account_id: v.offset_account_id, reason: v.reason });
      if (r.ok) {
        message.success("Adjustment recorded");
        setAdjOpen(false);
        form.resetFields();
        await load();
      } else {
        message.error(r.error ?? "Failed");
      }
    } finally {
      setAdjusting(false);
    }
  };

  const complete = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      const r = await completeReconciliationAction(reconciliationId);
      if (r.ok) {
        const said = completedMessage(r.data?.matched ?? null, r.data?.matchError ?? null);
        if (r.data?.matchError || (r.data?.matched && bankLinesToCheck(r.data.matched) > 0)) message.warning(said, 10);
        else message.success(said, 8);
        await load();
      } else {
        message.error(r.error ?? "Failed");
      }
    } finally {
      setCompleting(false);
    }
  };

  const reopen = () => {
    if (reopening) return;
    setReopening(true);
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
      afterClose: () => setReopening(false),
      onOk: async () => {
        const r = await reopenReconciliationAction(reconciliationId, { reason });
        if (r.ok) {
          message.success(
            r.data?.submittedForApproval
              ? "Reconciliation reopen submitted for approval"
              : "Reopened",
          );
          // The dialog stays until the figures say the reconciliation is open again, and Reopen has gone.
          if (!r.data?.submittedForApproval) {
            void loadHistory();
            await load();
          }
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
      void loadHistory();
    } catch (error) {
      message.error(`Failed to import the statement: ${serverFailure(error)}`, 10);
    } finally {
      setImporting(false);
    }
  }

  /**
   * Attach the statement to a reconciliation that has no file: read here with
   * the same readers, attached only when it is this reconciliation's statement
   * — otherwise nothing is kept and the message says what differs.
   */
  async function attachStatement(rows: StatementLine[], pdf: PdfStatement | null, file: File) {
    if (!statement || !detail) return;
    const read = {
      to: pdf?.to ?? null,
      closingMinor: pdf?.closingMinor ?? null,
      lines: rows.map((r) => ({ txn_date: r.txn_date, amount_minor: r.amount_minor })),
    };
    const mismatch = statementFileMismatch(
      read,
      {
        endingDate: statement.endingDate,
        endingMinor: detail.statementEndingMinor,
        keptLines: statement.lines.map((l) => ({ txn_date: l.txnDate, amount_minor: l.amountMinor })),
      },
      money,
    );
    if (mismatch) {
      message.error(mismatch, 10);
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
      void loadHistory();
    } catch (error) {
      message.error(`Failed to attach the statement: ${serverFailure(error)}`, 10);
    } finally {
      setAttaching(false);
    }
  }

  async function download(id: string) {
    const problem = await downloadSavedFile(id);
    if (problem) message.error(problem);
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
      {historyAdvice && historyFacts ? (
        <Alert
          type={historyAdvice.canBringForward ? "info" : "warning"}
          showIcon
          title={historyAdvice.text}
          description={
            historyAdvice.canBringForward && writing ? (
              <Button
                type="primary"
                size="small"
                loading={bringing}
                onClick={() => bringHistoryForward(historyFacts, historyAdvice.entries)}
              >
                {BRING_HISTORY_FORWARD}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {detail && !completed ? (
        detail.differenceMinor === 0 ? (
          <Alert type="success" message="Difference is zero — ready to complete." />
        ) : explained ? (
          <DifferenceAlert explained={explained} money={money} />
        ) : null
      ) : null}
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
      {opening && !completed && !historyAdvice ? <Alert type="warning" showIcon title={opening} /> : null}
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
          <Button
            type="primary"
            loading={completing}
            disabled={!detail || detail.differenceMinor !== 0}
            onClick={() => void complete()}
          >
            Complete
          </Button>
          <Button disabled={!detail || detail.differenceMinor === 0 || adjusting} onClick={() => setAdjOpen(true)}>
            Record adjustment
          </Button>
          {writing ? (
            <Button danger loading={discarding} onClick={discard}>
              {DISCARD_RECONCILIATION}
            </Button>
          ) : null}
        </Space>
      )}
      {completed && canReopen && (
        <Button danger loading={reopening} onClick={reopen}>
          Reopen
        </Button>
      )}
      {statement ? (
        <Space size={4} wrap>
          <PaperClipOutlined />
          {statement.statementFile ? (
            <>
              <Typography.Text>Statement file: {statement.statementFile.fileName}</Typography.Text>
              <Link href={`/banking/statement-files/${statement.statementFile.id}`}>View</Link>
              <Button type="link" size="small" onClick={() => void download(statement.statementFile!.id)}>
                Download
              </Button>
            </>
          ) : statement.statementFileId ? (
            <Typography.Text type="secondary">A statement file is kept with this reconciliation.</Typography.Text>
          ) : (
            <>
              <Typography.Text type="secondary">No statement file</Typography.Text>
              {canWrite ? (
                <Button type="link" size="small" disabled={!detail} onClick={() => setAttachOpen(true)}>
                  Attach the statement
                </Button>
              ) : null}
            </>
          )}
        </Space>
      ) : null}
      {shownPlan ? (
        <AddMissingBox
          plan={shownPlan}
          bankAccountId={bankAccount.id}
          money={money}
          adding={adding}
          onAdd={() => void addAll()}
          onAddAnyway={(line) => void addAnyway(line)}
          addingLine={addingLine}
        />
      ) : null}
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
              {standings.aside > 0 ? <Tag>{standings.aside} set aside</Tag> : null}
              {standings.after > 0 ? <Tag>{standings.after} after the statement date</Tag> : null}
            </Space>
          ) : null}
        </Space>
        {standings?.flipped ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            This statement shows money in and out the other way around; its amounts were reversed to pair them.
          </Typography.Paragraph>
        ) : null}
        <Table<ReconStatementLine>
          className={writing ? `${styles.statementLines} ${styles.withAction}` : styles.statementLines}
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
            { title: "Date", dataIndex: "txnDate", width: SW.date },
            { title: "Description", dataIndex: "description" },
            {
              title: "Reference",
              dataIndex: "reference",
              width: SW.reference,
              render: (value: string | null) => value ?? "—",
            },
            {
              title: "Amount",
              dataIndex: "amountMinor",
              width: SW.amount,
              align: "right",
              render: (value: number) => fmt(value),
            },
            {
              title: "With the books",
              key: "standing",
              width: SW.standing,
              render: (_: unknown, line) => {
                const standing = standingOf.get(line.lineNo);
                return standing ? <StandingTag standing={standing} extra={extraLines.has(line.lineNo)} /> : null;
              },
            },
            // A misread line is set aside as not a transaction, and brought back with Restore (2.03).
            ...(writing
              ? [
                  {
                    title: "",
                    key: "aside",
                    width: SW.aside,
                    align: "right" as const,
                    render: (_: unknown, line: ReconStatementLine) => {
                      const action = asideActionFor(standingOf.get(line.lineNo));
                      return action ? (
                        <Button
                          type="link"
                          size="small"
                          loading={asideLine === line.lineNo}
                          disabled={asideLine !== null && asideLine !== line.lineNo}
                          onClick={() => void setAside(line.lineNo, action.aside)}
                        >
                          {action.label}
                        </Button>
                      ) : null;
                    },
                  },
                ]
              : []),
          ]}
        />
      </div>

      <Typography.Text strong>Ledger lines in this reconciliation</Typography.Text>
      <Table
        className={styles.ledgerLines}
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
      <Modal
        open={adjOpen}
        title="Record adjustment"
        confirmLoading={adjusting}
        onCancel={() => setAdjOpen(false)}
        onOk={submitAdjust}
      >
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
          onConfirm={(fileName, rows, pdf, file) => void importStatement(fileName, rows, pdf, file)}
          onCancel={() => setImportOpen(false)}
        />
      ) : null}
      {attachOpen && statement ? (
        <ImportStatementModal
          open={attachOpen}
          bankAccount={bankAccount}
          importing={attaching}
          title="Attach the statement"
          okLabel="Attach"
          intro={
            `Choose the bank's statement to ${shortDate(statement.endingDate, true)}. OneBook reads it here and attaches it ` +
            "only if it is this reconciliation's statement: the same closing balance and, when this reconciliation kept " +
            "the statement's lines, the same lines. Nothing in the reconciliation changes."
          }
          onConfirm={(_fileName, rows, pdf, file) => void attachStatement(rows, pdf, file)}
          onCancel={() => setAttachOpen(false)}
        />
      ) : null}
    </Space>
  );
}
```

- [ ] **Step 11: Create `ctyhp-accounting/app/(app)/banking/reconcile/history/history-columns.ts`** with exactly this content:

```ts
import { COLUMN } from "@/lib/design/table-metrics";
import type { Tone } from "@/lib/design/tone";
import { HISTORY_STATE_LABELS, type HistoryState } from "@/lib/domain/reconcile-history";

/**
 * How each account's state reads: never reconciled needs a look, reconciled
 * is the good outcome.
 */
export const HISTORY_STATE_TONES: Record<HistoryState, { tone: Tone; label: string }> = {
  never: { tone: "warning", label: HISTORY_STATE_LABELS.never },
  reconciled: { tone: "positive", label: HISTORY_STATE_LABELS.reconciled },
};

/**
 * A date as the page prints it, "Sep 30, 2026" — as the card under the table
 * and the in-progress link do — which is wider than the 2026-09-30 that
 * COLUMN.DATE measures (the statement-alert cards measure the same).
 */
export const HISTORY_SHORT_DATE = 112;

/**
 * The Reconcile history table's measured columns, in the order they are drawn
 * (the radio that chooses the account first), and the floor of its one elastic
 * column (Account). Kept apart from the client component so a unit test can add
 * them up against the 984px box of a 1280px window without rendering the table.
 */
export const HISTORY_COLUMN_WIDTH = {
  choose: COLUMN.SELECTION,
  /** A count, under a three-word heading that stays on one line. */
  openLines: 150,
  from: HISTORY_SHORT_DATE,
  to: HISTORY_SHORT_DATE,
  /** A date, under a two-word heading that stays on one line. */
  lastReconciled: 120,
  /** "Never reconciled", and under it "In progress, ending Sep 30, 2026". */
  state: 220,
} as const;

/** Account takes what the measured columns leave, down to this. */
export const HISTORY_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

/**
 * The narrowest the table is drawn on a phone (history.module.css).
 *
 * In a phone's box the measured columns alone are wider than the box, and the
 * elastic Account column was left 0px: no account's name showed. Under 640px
 * the table is held to its measured widths plus Account's floor, so the name
 * and masked number keep their room, and it scrolls inside its own box.
 */
export const HISTORY_MIN_WIDTH =
  HISTORY_COLUMN_WIDTH.choose +
  HISTORY_COLUMN_WIDTH.openLines +
  HISTORY_COLUMN_WIDTH.from +
  HISTORY_COLUMN_WIDTH.to +
  HISTORY_COLUMN_WIDTH.lastReconciled +
  HISTORY_COLUMN_WIDTH.state +
  HISTORY_ELASTIC_FLOOR;
```

- [ ] **Step 12: Create `ctyhp-accounting/app/(app)/banking/reconcile/history/history.module.css`** with exactly this content:

```css
/*
 * The Reconcile history table.
 *
 * The chosen account is one row of many, so the default selected-row fill —
 * a heavy grey-green in the light theme — painted it like a warning. A light
 * wash marks it instead, as Review import marks a ticked line
 * (review-import.module.css), and keeps the text readable in both themes.
 *
 * `.history.history` and `td.ant-table-cell` outrank Ant Design's own rule,
 * which is injected after this stylesheet and would otherwise win a tie.
 */
.history.history :global(.ant-table-tbody > tr.ant-table-row-selected > td.ant-table-cell) {
  background: var(--ob-accent-wash);
}

.history.history :global(.ant-table-tbody > tr.ant-table-row-selected:hover > td.ant-table-cell) {
  background: var(--ob-surface-subtle);
}

/*
 * On a phone the table keeps its measured widths and Account its floor, and
 * scrolls inside its own box (DataTable's content box already scrolls). The
 * figure is HISTORY_MIN_WIDTH in history-columns.ts; change one and change the
 * other. At 1280 this does not apply.
 */
@media (max-width: 640px) {
  .history :global(.ant-table-content) > table {
    min-width: 950px;
  }
}
```

- [ ] **Step 13: Create `ctyhp-accounting/app/(app)/banking/reconcile/history/ReconcileHistoryClient.tsx`** with exactly this content:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Dayjs } from "dayjs";
import { Alert, App, Button, Card, DatePicker, InputNumber, Space, Spin, Typography, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { ToneBadge } from "@/lib/design/tone";
import { toMinor } from "@/lib/domain/money";
import { shortDate } from "@/lib/domain/pdf-statement-view";
import {
  OPEN_IN_PROGRESS,
  STATEMENT_BALANCE_ON,
  defaultHistoryAccount,
  historyAdvice,
  historyBroughtForwardMessage,
  inProgressText,
  reconciledUpTo,
  type HistoryAccount,
  type HistoryAdvice,
  type HistoryPreview,
} from "@/lib/domain/reconcile-history";
import { bringHistoryForwardConfirmation } from "@/lib/domain/reconcile-statement";
import { formatMoney } from "@/lib/format";
import { bringHistoryForwardAction, historyPreviewAction, reconciliationHistoryAction } from "../history-actions";
import { HISTORY_COLUMN_WIDTH as W, HISTORY_ELASTIC_FLOOR, HISTORY_STATE_TONES } from "./history-columns";
import styles from "./history.module.css";

/** How long the preview waits after the date changes before it reads the books. */
const PREVIEW_DELAY_MS = 350;

/** A date in the table as the card under it prints one, "Sep 30, 2026"; a dash when there is none. */
const historyDateCell = (iso: string | null) => (iso ? <time dateTime={iso}>{shortDate(iso, true)}</time> : "—");

/**
 * Reconcile history (2.03): every bank account with the posted lines no
 * completed reconciliation holds, and, for the account chosen, bringing its
 * history forward. The form reads "Statement balance on {date} = {amount}";
 * the books through that date are read as the date is chosen, and the
 * sentences and the button come from historyAdvice. A viewer sees the table
 * and the preview but no button; the database refuses anything that does not
 * match exactly.
 */
interface Props {
  canWrite: boolean;
  /** The company's today, in its own time zone: no later date can be chosen. */
  today: string;
  baseCurrency: string;
  baseDecimals: number;
}

export default function ReconcileHistoryClient({ canWrite, today, baseCurrency, baseDecimals }: Props) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<HistoryAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [through, setThrough] = useState<Dayjs | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  // The books through a date, with the account and date they were read for.
  const [preview, setPreview] = useState<{ key: string; data: HistoryPreview } | null>(null);
  // Bringing forward: from the click until its dialog closes.
  const [bringing, setBringing] = useState(false);

  const money = (minor: number) => formatMoney(minor, baseCurrency, baseDecimals);

  const load = useCallback(async () => {
    const res = await reconciliationHistoryAction();
    setLoaded(true);
    if (res.ok && res.data) setRows(res.data);
    else message.error(res.error ?? "Failed to load the reconciliation history");
  }, [message]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // The account chosen, or the one the page opens on while none is.
  const chosenId = picked && rows.some((row) => row.bankAccountId === picked) ? picked : defaultHistoryAccount(rows);
  const chosen = rows.find((row) => row.bankAccountId === chosenId) ?? null;
  const throughIso = through ? through.format("YYYY-MM-DD") : null;
  const previewKey = chosenId && throughIso ? `${chosenId}|${throughIso}` : null;

  // The live preview: read once the date has settled, and only for the account
  // and date it was asked for.
  useEffect(() => {
    if (!chosenId || !throughIso) return;
    let live = true;
    const key = `${chosenId}|${throughIso}`;
    const timer = window.setTimeout(() => {
      void historyPreviewAction({ bank_account_id: chosenId, through: throughIso }).then((res) => {
        if (!live) return;
        if (res.ok && res.data) setPreview({ key, data: res.data });
        else message.error(res.error ?? "The books could not be read on that date");
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [chosenId, throughIso, message]);

  const shownPreview = preview && preview.key === previewKey ? preview.data : null;
  const balanceMinor = balance === null ? null : toMinor(balance, baseDecimals);
  const advice =
    chosen && chosen.state === "never" && throughIso && balanceMinor !== null && shownPreview
      ? historyAdvice(chosen, throughIso, balanceMinor, shownPreview, money)
      : null;
  const reading = Boolean(chosen && chosen.state === "never" && previewKey && balanceMinor !== null && !shownPreview);

  function choose(id: string) {
    if (id === chosenId) return;
    setPicked(id);
    setThrough(null);
    setBalance(null);
  }

  /**
   * Asks first, then brings the history forward. The button is busy from its
   * click until the dialog closes, so a second click cannot send it twice, and
   * a success clears the form at once: the offer goes with it.
   */
  function bringForward(account: HistoryAccount, date: string, statementMinor: number, shown: HistoryAdvice) {
    if (!shown.action || bringing) return;
    setBringing(true);
    modal.confirm({
      title: `${shown.action}?`,
      content: bringHistoryForwardConfirmation(shown.entries, date),
      okText: shown.action,
      cancelText: "Cancel",
      afterClose: () => setBringing(false),
      onOk: async () => {
        const r = await bringHistoryForwardAction({
          bank_account_id: account.bankAccountId,
          through: date,
          balance_minor: statementMinor,
        });
        if (!r.ok || !r.data) {
          message.error(r.error ?? "The history could not be brought forward");
          throw new Error(r.error);
        }
        const rebased = r.data.rebasedReconciliationId ? statementMinor : null;
        message.success(historyBroughtForwardMessage(r.data.lines, date, rebased, money), 8);
        setThrough(null);
        setBalance(null);
        void load();
      },
    });
  }

  const columns: TableColumnsType<HistoryAccount> = [
    flexColumn<HistoryAccount>({
      title: "Account",
      key: "account",
      floor: HISTORY_ELASTIC_FLOOR,
      render: (_: unknown, row: HistoryAccount) => (
        <>
          <span title={row.label}>{row.label}</span>
          {row.maskedNumber ? secondaryLine(row.maskedNumber) : null}
        </>
      ),
    }),
    {
      title: "Lines not reconciled",
      dataIndex: "openLines",
      width: W.openLines,
      align: "right",
      render: (n: number) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString("en-US")}</span>,
    },
    { title: "From", dataIndex: "firstOpenDate", width: W.from, render: historyDateCell },
    { title: "To", dataIndex: "lastOpenDate", width: W.to, render: historyDateCell },
    { title: "Last reconciled", dataIndex: "lastReconciledDate", width: W.lastReconciled, render: historyDateCell },
    {
      title: "State",
      key: "state",
      width: W.state,
      render: (_: unknown, row: HistoryAccount) => (
        <Space orientation="vertical" size={0}>
          <ToneBadge tone={HISTORY_STATE_TONES[row.state].tone}>{HISTORY_STATE_TONES[row.state].label}</ToneBadge>
          {row.inProgress ? (
            <Link href={`/banking/reconcile/${row.inProgress.id}`}>{inProgressText(row.inProgress.endingDate)}</Link>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <div className={styles.history}>
        <DataTable<HistoryAccount>
          rowKey="bankAccountId"
          columns={columns}
          dataSource={rows}
          loading={!loaded}
          emptyTitle="No bank accounts yet"
          rowSelection={{
            type: "radio",
            columnWidth: W.choose,
            selectedRowKeys: chosenId ? [chosenId] : [],
            onChange: (keys) => {
              if (keys[0]) choose(String(keys[0]));
            },
          }}
          onRow={(row) => ({ onClick: () => choose(row.bankAccountId) })}
        />
      </div>

      {chosen ? (
        <Card size="small" title={chosen.maskedNumber ? `${chosen.label} · ${chosen.maskedNumber}` : chosen.label}>
          {chosen.state === "reconciled" && chosen.lastReconciledDate ? (
            <Typography.Text>{reconciledUpTo(chosen.lastReconciledDate)}</Typography.Text>
          ) : (
            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
              <Space wrap align="center">
                <Typography.Text>{STATEMENT_BALANCE_ON}</Typography.Text>
                <DatePicker
                  aria-label="Statement date"
                  value={through}
                  onChange={(value) => setThrough(value)}
                  disabledDate={(day) => day.format("YYYY-MM-DD") > today}
                />
                <Typography.Text>=</Typography.Text>
                <InputNumber<number>
                  aria-label="Statement balance"
                  style={{ width: 180 }}
                  precision={baseDecimals}
                  value={balance}
                  onChange={(value) => setBalance(value ?? null)}
                />
              </Space>
              {reading ? <Spin size="small" /> : null}
              {advice?.kind === "match" ? (
                <Alert
                  type="success"
                  showIcon
                  title={advice.text}
                  description={
                    advice.action && canWrite && throughIso && balanceMinor !== null ? (
                      <Button
                        type="primary"
                        size="small"
                        loading={bringing}
                        onClick={() => bringForward(chosen, throughIso, balanceMinor, advice)}
                      >
                        {advice.action}
                      </Button>
                    ) : undefined
                  }
                />
              ) : null}
              {advice?.kind === "out" ? <Alert type="warning" showIcon title={advice.text} /> : null}
              {advice?.kind === "inProgress" && advice.inProgressId ? (
                <Alert
                  type="warning"
                  showIcon
                  title={advice.text}
                  description={<Link href={`/banking/reconcile/${advice.inProgressId}`}>{OPEN_IN_PROGRESS}</Link>}
                />
              ) : null}
              {advice?.kind === "reconciled" ? <Alert type="info" showIcon title={advice.text} /> : null}
            </Space>
          )}
        </Card>
      ) : null}
    </Space>
  );
}
```

- [ ] **Step 14: Create `ctyhp-accounting/app/(app)/banking/reconcile/history/page.tsx`** with exactly this content:

```tsx
import Link from "next/link";
import { getUserRole, canWrite } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getBankingContext } from "@/lib/services/banking-surface/facts";
import { listCurrencies } from "@/lib/services/reference";
import { RECONCILE_HISTORY } from "@/lib/domain/reconcile-history";
import PageHeader from "@/components/PageHeader";
import ReconcileHistoryClient from "./ReconcileHistoryClient";

export const dynamic = "force-dynamic";

/**
 * Reconcile history (2.03): a thin server shell. It reads who is looking, the
 * base currency and the company's today; the table and the form are the
 * client's, which reads the history through its own actions.
 */
export default async function ReconcileHistoryPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [currencies, { asOf }] = await Promise.all([listCurrencies(sb), getBankingContext(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader
        title={RECONCILE_HISTORY}
        description="Every bank account, with the posted lines no completed reconciliation holds. An account never reconciled can bring its history forward when the books hold exactly the statement’s balance on a date."
      />
      <p>
        <Link href="/banking/reconcile">← Bank Reconciliation</Link>
      </p>
      <ReconcileHistoryClient
        canWrite={canWrite(role)}
        today={asOf}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

- [ ] **Step 15: Edit `ctyhp-accounting/lib/domain/system-guide.ts`** — apply these 4 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 4 — find:

```ts
          "the opening balance plus the lines comes to the closing balance. If it does not, a line may not " +
          "have been read: check the statement, then Import anyway or use the bank's CSV. A scanned PDF has " +
          "no text to read.",
      },
```

replace with:

```ts
          "the opening balance plus the lines comes to the closing balance. If it does not, a line may not " +
          "have been read, or one may have been read that is not a transaction: check the statement, then " +
          "Import anyway or use the bank's CSV. A bank download (CSV, QFX or OFX) is read exactly; a PDF is " +
          "read from its text, and a check image or a summary table can be misread. A scanned PDF has no " +
          "text to read.",
      },
```

Edit 2 of 4 — find:

```ts
        note:
          "Completing a session requires either zero unexplained difference or an " +
          "adjustment somebody signs for. Complete then matches, in Bank Transactions, each bank line to the " +
```

replace with:

```ts
        note:
          "The difference is explained in its parts, and Complete needs a difference of zero or a recorded " +
          "adjustment somebody signs for. Complete then matches, in Bank Transactions, each bank line to the " +
```

Edit 3 of 4 — find:

```ts
      {
        action: "Add what the statement has and the books do not",
```

replace with:

```ts
      {
        action: "Bring an account's history forward from its first reconciliation",
        control: "Bring the history forward",
        route: "/banking/reconcile",
        note:
          "On an account never reconciled, a reconciliation that begins at a different figure from its statement's " +
          "opening checks the books up to the day before the statement. When they add up to exactly that opening, " +
          "the button appears; it asks first, saying how many entries will be marked reconciled, then signs them " +
          "off in one brought-forward reconciliation and starts this one at the statement's opening. Nothing is " +
          "posted. Otherwise it says how much the books are out by. It needs the statement file kept with the " +
          "reconciliation.",
      },
      {
        action: "See every account's lines not yet reconciled, and bring an account's history forward",
        control: "Reconcile history",
        route: "/banking/reconcile/history",
        note:
          "Linked from Reconcile. Each bank account shows its lines not reconciled, their first and last dates, " +
          "when it was last reconciled and its state. Choose an account never reconciled and fill in Statement " +
          "balance on [date] = [amount] from one of its statements; the books on that date are read as you go. " +
          "When they match, Bring forward N entries signs them off and posts nothing; when they do not, the page " +
          "says how much they are out by. A reconciliation in progress that ends on or before the date must be " +
          "finished or discarded first.",
      },
      {
        action: "Start a reconciliation again",
        control: "Discard this reconciliation",
        route: "/banking/reconcile",
        note:
          "For a reconciliation in progress. It asks for a reason, removes the reconciliation and its ticks, and " +
          "returns to Reconcile. The statement file and its bank lines stay, and any entries added to the books " +
          "from it stay in the books. A reconciliation that posted an adjustment cannot be discarded.",
      },
      {
        action: "Read the difference",
        control: "Left to explain",
        route: "/banking/reconcile",
        note:
          "The difference is shown in its parts: Opening, when the reconciliation begins at a different figure " +
          "from the statement's opening; On the statement, not in the books; Ticked here, not on the statement; " +
          "and Left to explain. When exactly one line is the size of what is left, it is named: check that one " +
          "first.",
      },
      {
        action: "Set aside a statement line that is not a transaction",
        control: "Not a transaction",
        route: "/banking/reconcile",
        note:
          "Beside a statement line the books do not have — a line the PDF was misread into. It leaves the line out " +
          "of Add missing lines and out of the difference; its line stays in Bank Transactions, to exclude there " +
          "if it is not real. Restore brings it back. A line paired with the books cannot be set aside.",
      },
      {
        action: "Add what the statement has and the books do not",
```

Edit 4 of 4 — find:

```ts
          "post to — by card, related company, rule or history, or else Uncategorized Income or Expense. Add all " +
          "posts every one, dated as the bank has it, or none, then pairs and ticks them; Complete stays yours. " +
          "Or code them one by one in Bank Transactions and click Match again; no tick is ever removed.",
      },
```

replace with:

```ts
          "post to — by card, related company, rule or history, or else Uncategorized Income or Expense. Add all " +
          "posts every one it lists, dated as the bank has it, or none, then pairs and ticks them; Complete stays " +
          "yours. Or code them one by one in Bank Transactions and click Match again; no tick is ever removed.",
      },
      {
        action: "Add a line held back from Add all",
        control: "Add anyway",
        route: "/banking/reconcile",
        note:
          "Two kinds of line are held back and listed apart, each with why. When the statement already balances " +
          "without the lines the books do not have, they are marked Extra: likely not transactions. When it does " +
          "not add up and exactly one of them is the amount it is out by, that one alone is Extra. A line whose " +
          "amount the books already hold, with the same check number or within 5 days, names the entry it looks " +
          "like. Add anyway posts that one line alone, because two identical lines on one day can both be real.",
      },
```

- [ ] **Step 16: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/reconcile-history-screens.test.ts" "app/(app)/banking/ImportStatementModal.tsx" "app/(app)/banking/reconcile/ReconcileListClient.tsx" "app/(app)/banking/reconcile/[id]/statement-line-columns.ts" "app/(app)/banking/reconcile/[id]/DifferenceAlert.tsx" "app/(app)/banking/reconcile/[id]/AddMissingBox.tsx" "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx" "app/(app)/banking/reconcile/history/history-columns.ts" "app/(app)/banking/reconcile/history/ReconcileHistoryClient.tsx" "app/(app)/banking/reconcile/history/page.tsx" "lib/domain/system-guide.ts"
npx vitest run tests/unit/reconcile-history-screens.test.ts tests/unit/statement-screens-ui-contract.test.ts tests/unit/rsc-antd.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/table-pagination-guard.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/design-tokens.test.ts tests/unit/open-after-hydration.test.ts tests/unit/data-table-contract.test.ts tests/unit/navigation.test.ts tests/unit/system-guide.test.ts tests/unit/screen-context.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; reconcile-history-screens: 45 tests passing; statement-screens-ui-contract (4), rsc-antd (2), table-adoption (6), table-fit-contract (3), table-pagination-guard (3), no-hardcoded-color (5), design-tokens (12), open-after-hydration (2), data-table-contract (5), navigation (46), system-guide (23) and screen-context (26) pass.

- [ ] **Step 17: Commit**

```bash
git add "ctyhp-accounting/tests/unit/reconcile-history-screens.test.ts" "ctyhp-accounting/app/(app)/banking/ImportStatementModal.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/ReconcileListClient.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/[id]/statement-line-columns.ts" "ctyhp-accounting/app/(app)/banking/reconcile/[id]/workspace.module.css" "ctyhp-accounting/app/(app)/banking/reconcile/[id]/difference.module.css" "ctyhp-accounting/app/(app)/banking/reconcile/[id]/DifferenceAlert.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/[id]/AddMissingBox.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/history/history-columns.ts" "ctyhp-accounting/app/(app)/banking/reconcile/history/history.module.css" "ctyhp-accounting/app/(app)/banking/reconcile/history/ReconcileHistoryClient.tsx" "ctyhp-accounting/app/(app)/banking/reconcile/history/page.tsx" "ctyhp-accounting/lib/domain/system-guide.ts"
git commit -m "feat(reconcile): bring the history forward and discard from inside a reconciliation, explain the difference in parts, set a statement line aside, add a held-back line anyway, add the Reconcile history page, and say in the import dialog what can be misread"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 6: Release 2.03

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`

**Interfaces:**
- Consumes: the screens from Task 5 (the notes describe them; every route they name must exist).
- Produces: release 2.03 above 2.02, dated 2026-10-13 (if main has moved past 2.02 by the time this merges, the controller renumbers it to the next free number).

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
    version: "2.03",
    date: "2026-10-13",
    headline:
      "Reconcile brings an account’s history forward when the books match the statement, explains the difference in parts, and holds back lines a PDF may have misread.",
    changes: [
      {
        kind: "added",
        title: "Bring the history forward from inside a reconciliation",
        detail:
          "On an account that has never been reconciled, a reconciliation that begins at a different figure from its statement’s opening balance now looks at the books up to the day before the statement. When they add up to exactly that opening, it says so and offers Bring the history forward. It asks first, saying how many entries will be marked reconciled, then signs them off in one brought-forward reconciliation and starts this one at the statement’s opening. Nothing is posted to the books. When the books do not match, it says what they read on that day, what the statement opens at, and how much they are out by; an account that already has a completed reconciliation is told so. The offer needs the statement file kept with the reconciliation, which names the statement’s period.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "Reconcile history",
        detail:
          "A new page, linked from Reconcile, lists every bank account with its lines not reconciled, the first and last of their dates, when it was last reconciled and its state, with any reconciliation in progress. Choose an account never reconciled and fill in Statement balance on [date] = [amount] from one of its statements: the page reads the books on that date as you go. When they match, it shows Books on [date] read [amount] ✓ and Bring forward N entries, which asks first and posts nothing. When they do not, it says how much they are out by. A date after today cannot be chosen. An account already reconciled reads Reconciled up to [date], and a reconciliation in progress that ends on or before the date must be finished or discarded first. Viewers see the page, but not the button.",
        route: "/banking/reconcile/history",
      },
      {
        kind: "added",
        title: "Discard a reconciliation in progress",
        detail:
          "Discard this reconciliation asks for a reason, removes the reconciliation and its ticks, and returns to Reconcile, so a reconciliation started on the wrong footing can be started again. The statement file and its bank lines stay, and any entries added to the books from it stay in the books. The reason is kept in the audit log. A reconciliation that posted an adjustment cannot be discarded.",
        route: "/banking/reconcile",
      },
      {
        kind: "changed",
        title: "The difference, explained in parts",
        detail:
          "“Unexplained difference” is replaced by the difference in its parts: Opening, when the reconciliation begins at a different figure from the statement’s opening; On the statement, not in the books; Ticked here, not on the statement; and Left to explain. A part with no lines in it is left out. When exactly one line is the size of what is left, the reconciliation names it and says to check that one first.",
        route: "/banking/reconcile",
      },
      {
        kind: "added",
        title: "Set a misread statement line aside as Not a transaction",
        detail:
          "On a reconciliation in progress, a statement line the books do not have can be marked Not a transaction — a line the PDF reader took for a payment when it was not one. It is left out of Add missing lines and out of the difference, and Restore brings it back. Its line stays in Bank Transactions, and the message says so: exclude it there if it is not real. A line paired with the books cannot be set aside.",
        route: "/banking/reconcile",
      },
      {
        kind: "changed",
        title: "Add missing lines holds back extra lines and likely duplicates",
        detail:
          "When the statement already balances without the lines the books do not have — its opening plus the paired lines comes to its closing balance — those lines are marked Extra and held back, since they are likely not transactions. When the statement does not add up and exactly one of those lines is the amount it is out by, that line alone is marked Extra, so a real fee missing from the books beside a misread line is still offered by Add all. A line whose amount the books already hold, with the same check number or within 5 days, is held back too, naming the entry it looks like. Add all adds only the rest. Each held-back line has Add anyway, which posts that line alone: two identical lines on one day can both be real.",
        route: "/banking/reconcile",
      },
      {
        kind: "fixed",
        title: "A check image is no longer read as a payment",
        detail:
          "On a PDF statement whose check images carry a small caption and a table of their own, a check already read could be read a second time as a payment, described by two check numbers. The images are now skipped to their end. A PDF whose opening balance plus its lines does not come to its closing balance now says a line may be missing, or one may have been read that is not a transaction.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "The import dialog says which files are read exactly",
        detail:
          "Import statement now says: “A bank download (CSV, QFX or OFX) is read exactly. A PDF is read from its text, and a check image or a summary table can be misread.” It says so wherever the dialog opens, in Bank Transactions and in a reconciliation.",
        route: "/banking",
      },
    ],
  },
  {
```

- [ ] **Step 2: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/changelog.ts"
npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; changelog (15) and system-guide (23) pass.

- [ ] **Step 3: Commit**

```bash
git add "ctyhp-accounting/lib/domain/changelog.ts"
git commit -m "docs(reconcile): release 2.03 in the changelog"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 7: Controller — whole-branch gates, verification, smoke, approval

**Files:** none changed by this task (scratch scripts live outside the repo).

**Interfaces:**
- Consumes: the whole branch.

- [ ] **Step 1: The branch equals the pre-build.** `git diff prebuild/reconcile-history HEAD -- ctyhp-accounting` is empty, unless a review fix was agreed. Every commit has no Co-Authored-By trailer and no mention of Claude or AI; typographic ’, — and ✓ are unchanged.
- [ ] **Step 2: Whole-suite gates.** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run quality:budget`. Expected: tsc 0; lint 0 errors; every test file passes (load-sensitive timeouts must pass when rerun alone); build compiles; 11/11 within budget.
- [ ] **Step 3: Verification, alone** (`npm run verify:reconciliation-history`): 207/207 — 97 on the sample company, 22 on each other company, all rolled back.
- [ ] **Step 4: Smoke and screenshots on PC-Test**, against `next start` on a free port: a first reconciliation at 0 brought forward from the workspace, a statement with a real fee and a misread line (the misread one held back as Extra, Add all adds the fee only), Not a transaction / Restore, a likely duplicate added anyway, discard with a reason, Reconcile history out by / match / brought forward, the import note, the Guide; light, dark and phone (each table scrolls inside its box); no console errors; staff emails blurred. The demo accounts stay on PC-Test as sample data.
- [ ] **Step 5: Approval page** of the screenshots for the user. Nothing is pushed before the user approves.
- [ ] **Step 6: After approval** — scan the whole diff for real client data and secrets (separate command, read before pushing), check main has not moved (renumber the release up if it has), push the branch; the user opens the PR; then CI and a read-only production check.
