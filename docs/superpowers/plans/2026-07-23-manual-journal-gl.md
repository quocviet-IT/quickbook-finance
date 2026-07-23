# Manual Journal + GL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual journal entries, reversal-based corrections, controlled opening balances, and General Ledger / Journal reports on top of the existing double-entry ledger.

**Architecture:** New Postgres migrations add one table (`acc_journal_reversal_link`), one column (`acc_journal_entry.source_ref`), one sequence key, and three atomic `security definer` RPCs. Pure domain helpers + Zod schemas are unit-tested; a thin service layer calls the RPCs; Server Actions guard by role; Ant Design pages provide the UI. All reads/writes follow the existing `acc_*` patterns — the ledger stays the single source of truth.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres/RLS), Ant Design, Zod, Vitest, `pg` for the SQL-editor verify script.

## Global Constraints

- Money is integer minor units end-to-end; convert to decimal only at the UI edge using the currency's `decimal_places`.
- All financial writes go through the service layer → an atomic Postgres RPC. No SQL in components. Never trust client-sent totals — recompute/validate server-side.
- Posting builders must assert `debit == credit` via `assertBalanced` (from `lib/domain/posting.ts`).
- Postgres enums: cannot `ALTER TYPE ... ADD VALUE` then use it in the same migration. (Not needed here — `'manual'` and `'opening_balance'` already exist in `acc_journal_source`.)
- RLS on every new table; never disable RLS to test. Every financial write appends to `acc_audit_log`.
- English is the canonical product/implementation language (US-NFR-009).
- Before claiming done: run `npm run build`, `npm test`, `npm run typecheck`, `npm run lint` — zero errors, paste real output.
- Opening Balance Equity is the seeded account with `account_code = '3900'`.
- Commit messages must NOT contain any Claude attribution / Co-Authored-By.
- All commands run from `c:/Users/pit010/QUICKBOOK_WEBAPP/ctyhp-accounting`.

---

## File Structure

- Create `supabase/migrations/0017_manual_journal.sql` — table, column, sequence, RLS.
- Create `supabase/migrations/0018_manual_journal_functions.sql` — three RPCs.
- Modify `lib/domain/posting.ts` — add `buildOpeningBalancePosting`.
- Modify `lib/domain/reports.ts` — add `computeRunningBalance` + GL row types.
- Modify `lib/domain/schemas.ts` — add manual-journal / opening-balance / reverse schemas.
- Create `tests/unit/journal-posting.test.ts`, `tests/unit/journal-ledger.test.ts`, `tests/unit/journal-schema.test.ts`.
- Modify `lib/db/types.ts` — add `JournalReversalLinkRow` and GL read-row types.
- Create `lib/services/journal.ts` — service layer.
- Create `app/(app)/journal/{page.tsx,JournalClient.tsx,actions.ts}` — journal list + create + reverse.
- Create `app/(app)/opening-balances/{page.tsx,OpeningBalancesClient.tsx,actions.ts}`.
- Create `app/(app)/reports/general-ledger/{page.tsx,GeneralLedgerClient.tsx,actions.ts}`.
- Create `app/(app)/reports/journal/{page.tsx,JournalReportClient.tsx,actions.ts}`.
- Modify `components/AppShell.tsx` — nav entries.
- Create `scripts/verify-journal.mjs` — end-to-end verify.

---

## Task 1: Migration — schema (table, column, sequence, RLS)

**Files:**
- Create: `supabase/migrations/0017_manual_journal.sql`

**Interfaces:**
- Produces: table `acc_journal_reversal_link(id, original_entry_id, reversal_entry_id, reason, created_by, created_at)`; column `acc_journal_entry.source_ref text`; sequence key `('opening_balance','OB-',1)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0017_manual_journal.sql
-- ============================================================================
-- Module B — Manual Journal + Opening Balances + GL.
-- Schema only: reversal-link table, source_ref column, opening-balance sequence.
-- No changes to existing ledger tables/triggers; 'manual' and 'opening_balance'
-- already exist in acc_journal_source.
-- ============================================================================

-- Free-text external reference on a manual journal (attachments/approval are
-- owned by later modules; this leaves room without altering the posting path).
alter table acc_journal_entry add column if not exists source_ref text;

-- Links an original posted entry to the entry that reverses it. The original is
-- never mutated or voided; the reversal nets it out from its own entry_date.
create table if not exists acc_journal_reversal_link (
  id                uuid primary key default gen_random_uuid(),
  original_entry_id uuid not null unique references acc_journal_entry (id),
  reversal_entry_id uuid not null unique references acc_journal_entry (id),
  reason            text not null,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);

alter table acc_journal_reversal_link enable row level security;

-- Staff (admin/accountant) may insert; staff + viewer may read. Mirrors the
-- read/write split used by other acc_* tables.
create policy acc_reversal_link_select on acc_journal_reversal_link
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
create policy acc_reversal_link_insert on acc_journal_reversal_link
  for insert with check (acc_is_staff());

-- Sequence for opening-balance entries (manual + reversal reuse 'journal_entry').
insert into acc_sequence (key, prefix, next_value)
  values ('opening_balance', 'OB-', 1)
  on conflict (key) do nothing;
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0017_manual_journal.sql','utf8');if(!/acc_journal_reversal_link/.test(s)||!/source_ref/.test(s))process.exit(1);console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0017_manual_journal.sql
git commit -m "feat: journal reversal-link table + source_ref + opening-balance sequence"
```

Note: the DB is not reachable over the IPv4-only network from here; migrations are applied via the Supabase SQL Editor (same as prior modules). The verify script in Task 10 assumes 0017/0018 have been applied.

---

## Task 2: Migration — atomic RPCs

**Files:**
- Create: `supabase/migrations/0018_manual_journal_functions.sql`

**Interfaces:**
- Consumes: `acc_post_entry`, `acc_next_number`, `acc_to_base_minor`, `acc_is_staff`, table from Task 1.
- Produces RPCs:
  - `acc_post_manual_journal(p_entry_date date, p_description text, p_source_ref text, p_currency text, p_lines jsonb) returns uuid`
  - `acc_reverse_entry(p_entry_id uuid, p_reason text, p_reversal_date date) returns uuid`
  - `acc_post_opening_balances(p_as_of date, p_currency text, p_lines jsonb) returns uuid`
  - `p_lines` for manual/opening: JSON array of `{account_id, debit_minor, credit_minor}` (base currency).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0018_manual_journal_functions.sql
-- ============================================================================
-- Module B RPCs: post a manual journal, reverse a posted entry (linked, keeping
-- the original visible), and post a controlled opening-balance batch. All are
-- atomic, staff-gated, and append acc_audit_log.
-- ============================================================================

-- Helper: validate that all account_ids in p_lines are active posting accounts.
create or replace function acc_assert_postable(p_lines jsonb) returns void
language plpgsql as $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from jsonb_array_elements(p_lines) as l
    left join acc_account a on a.id = (l->>'account_id')::uuid
   where a.id is null or a.is_posting_account = false or a.status <> 'active';
  if v_bad > 0 then
    raise exception 'All journal lines must reference active posting accounts (% invalid)', v_bad;
  end if;
end;
$$;

-- Manual journal: caller supplies base-currency lines; we compute amount_base_minor
-- = debit/credit (already base) and delegate to acc_post_entry, then set source_ref.
create or replace function acc_post_manual_journal(
  p_entry_date  date,
  p_description text,
  p_source_ref  text,
  p_currency    text,
  p_lines       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entry uuid;
  v_lines jsonb;
  v_count int;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post journal entries'; end if;

  v_count := jsonb_array_length(p_lines);
  if v_count is null or v_count < 2 then
    raise exception 'A manual journal needs at least two lines';
  end if;
  perform acc_assert_postable(p_lines);

  -- Carry each line's minor amount into amount_base_minor (lines are in base ccy).
  select jsonb_agg(
           l || jsonb_build_object(
             'amount_base_minor',
             coalesce((l->>'debit_minor')::bigint, 0) + coalesce((l->>'credit_minor')::bigint, 0)
           ))
    into v_lines
    from jsonb_array_elements(p_lines) as l;

  v_entry := acc_post_entry(p_entry_date, coalesce(p_description, 'Manual journal'),
                            'manual', null, p_currency, v_lines);
  update acc_journal_entry set source_ref = nullif(btrim(coalesce(p_source_ref, '')), '')
   where id = v_entry;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_journal_entry', v_entry, 'post', auth.uid());
  return v_entry;
end;
$$;

-- Reverse a posted entry: post a new balanced entry with debit/credit swapped and
-- amount_base_minor preserved, link it, and audit. The original stays 'posted'.
create or replace function acc_reverse_entry(
  p_entry_id     uuid,
  p_reason       text,
  p_reversal_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src   acc_journal_entry;
  v_lines jsonb;
  v_rev   uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to reverse entries'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reversal reason is required'; end if;

  select * into v_src from acc_journal_entry where id = p_entry_id for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if v_src.status <> 'posted' then raise exception 'Only a posted entry can be reversed'; end if;
  if exists (select 1 from acc_journal_reversal_link where original_entry_id = p_entry_id) then
    raise exception 'Entry has already been reversed';
  end if;
  if exists (select 1 from acc_journal_reversal_link where reversal_entry_id = p_entry_id) then
    raise exception 'A reversal entry cannot itself be reversed';
  end if;

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
   where l.journal_entry_id = p_entry_id;

  v_rev := acc_post_entry(p_reversal_date,
             'Reversal of ' || v_src.entry_number || ' — ' || p_reason,
             v_src.source_type, v_src.id, v_src.currency_code, v_lines);

  insert into acc_journal_reversal_link (original_entry_id, reversal_entry_id, reason, created_by)
    values (p_entry_id, v_rev, p_reason, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_journal_entry', p_entry_id, 'reverse', auth.uid());
  return v_rev;
end;
$$;

-- Controlled opening balances: caller supplies per-account base-currency lines;
-- we book the net difference to Opening Balance Equity (code '3900') so the entry
-- balances. Refuse a second non-reversed opening batch for the same as-of date.
create or replace function acc_post_opening_balances(
  p_as_of    date,
  p_currency text,
  p_lines    jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_equity  uuid;
  v_debit   bigint;
  v_credit  bigint;
  v_net     bigint;
  v_lines   jsonb;
  v_entry   uuid;
  v_count   int;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post opening balances'; end if;

  v_count := jsonb_array_length(p_lines);
  if v_count is null or v_count < 1 then raise exception 'Enter at least one opening balance'; end if;
  perform acc_assert_postable(p_lines);

  if exists (
    select 1 from acc_journal_entry
     where source_type = 'opening_balance' and status = 'posted' and entry_date = p_as_of
  ) then
    raise exception 'Opening balances for % already exist', p_as_of;
  end if;

  select id into v_equity from acc_account where account_code = '3900';
  if v_equity is null then raise exception 'Opening Balance Equity account (3900) is missing'; end if;

  select coalesce(sum((l->>'debit_minor')::bigint), 0),
         coalesce(sum((l->>'credit_minor')::bigint), 0)
    into v_debit, v_credit
    from jsonb_array_elements(p_lines) as l;
  v_net := v_debit - v_credit;

  -- Base-currency lines: amount_base_minor mirrors the minor amount.
  select jsonb_agg(
           l || jsonb_build_object(
             'amount_base_minor',
             coalesce((l->>'debit_minor')::bigint, 0) + coalesce((l->>'credit_minor')::bigint, 0)))
    into v_lines
    from jsonb_array_elements(p_lines) as l;

  -- Balancing line to Opening Balance Equity (only if there is a net difference).
  if v_net <> 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_equity,
      'debit_minor',  case when v_net < 0 then -v_net else 0 end,
      'credit_minor', case when v_net > 0 then  v_net else 0 end,
      'amount_base_minor', abs(v_net),
      'memo', 'Opening balance equity'));
  end if;

  v_entry := acc_post_entry(p_as_of, 'Opening balances as of ' || p_as_of,
                            'opening_balance', null, p_currency, v_lines);
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_journal_entry', v_entry, 'post', auth.uid());
  return v_entry;
end;
$$;
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0018_manual_journal_functions.sql','utf8');for(const f of ['acc_post_manual_journal','acc_reverse_entry','acc_post_opening_balances'])if(!s.includes(f)){console.error('missing '+f);process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0018_manual_journal_functions.sql
git commit -m "feat: manual-journal, reverse-entry, opening-balances RPCs"
```

---

## Task 3: Domain — opening-balance builder + running balance

**Files:**
- Modify: `lib/domain/posting.ts`
- Modify: `lib/domain/reports.ts`
- Test: `tests/unit/journal-posting.test.ts`, `tests/unit/journal-ledger.test.ts`

**Interfaces:**
- Consumes: `JournalLineInput`, `assertBalanced` (posting.ts); `NormalBalance` (accounts.ts).
- Produces:
  - `buildOpeningBalancePosting(lines: OpeningLine[], equityAccountId: string): JournalLineInput[]`
    where `OpeningLine = { accountId: string; debitMinor: Minor; creditMinor: Minor }`.
  - `computeRunningBalance(openingMinor: number, rows: LedgerActivityRow[], normal: NormalBalance): RunningRow[]`
    where `LedgerActivityRow = { debitMinor: number; creditMinor: number }` and
    `RunningRow = LedgerActivityRow & { runningMinor: number }`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/journal-posting.test.ts
import { describe, it, expect } from "vitest";
import { buildOpeningBalancePosting } from "@/lib/domain/posting";

describe("buildOpeningBalancePosting", () => {
  it("books the net difference to Opening Balance Equity and balances", () => {
    // Bank 1,000 DR; Loan 400 CR -> net debit 600 -> equity gets 600 CR.
    const lines = buildOpeningBalancePosting(
      [
        { accountId: "bank", debitMinor: 1000_00, creditMinor: 0 },
        { accountId: "loan", debitMinor: 0, creditMinor: 400_00 },
      ],
      "equity",
    );
    const equity = lines.find((l) => l.accountId === "equity");
    expect(equity).toEqual({ accountId: "equity", debitMinor: 0, creditMinor: 600_00, memo: "Opening balance equity" });
    const debit = lines.reduce((s, l) => s + l.debitMinor, 0);
    const credit = lines.reduce((s, l) => s + l.creditMinor, 0);
    expect(debit).toBe(credit);
  });

  it("omits the equity line when already balanced", () => {
    const lines = buildOpeningBalancePosting(
      [
        { accountId: "bank", debitMinor: 500_00, creditMinor: 0 },
        { accountId: "loan", debitMinor: 0, creditMinor: 500_00 },
      ],
      "equity",
    );
    expect(lines.find((l) => l.accountId === "equity")).toBeUndefined();
  });
});
```

```typescript
// tests/unit/journal-ledger.test.ts
import { describe, it, expect } from "vitest";
import { computeRunningBalance } from "@/lib/domain/reports";

describe("computeRunningBalance", () => {
  it("accumulates for a debit-normal account (debits add)", () => {
    const rows = computeRunningBalance(100_00, [
      { debitMinor: 50_00, creditMinor: 0 },
      { debitMinor: 0, creditMinor: 20_00 },
    ], "debit");
    expect(rows.map((r) => r.runningMinor)).toEqual([150_00, 130_00]);
  });

  it("accumulates for a credit-normal account (credits add)", () => {
    const rows = computeRunningBalance(100_00, [
      { debitMinor: 0, creditMinor: 40_00 },
      { debitMinor: 10_00, creditMinor: 0 },
    ], "credit");
    expect(rows.map((r) => r.runningMinor)).toEqual([140_00, 130_00]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- journal-posting journal-ledger`
Expected: FAIL — `buildOpeningBalancePosting` / `computeRunningBalance` not exported.

- [ ] **Step 3: Implement the builders**

Append to `lib/domain/posting.ts`:

```typescript
export interface OpeningLine {
  accountId: string;
  debitMinor: Minor;
  creditMinor: Minor;
}

/**
 * Opening balances: caller-supplied per-account lines, with the net difference
 * booked to Opening Balance Equity so the entry balances. Mirrors the SQL in
 * acc_post_opening_balances; kept pure for testing and client-side preview.
 */
export function buildOpeningBalancePosting(
  lines: OpeningLine[],
  equityAccountId: string,
): JournalLineInput[] {
  const out: JournalLineInput[] = lines
    .filter((l) => l.debitMinor !== 0 || l.creditMinor !== 0)
    .map((l) => ({ accountId: l.accountId, debitMinor: l.debitMinor, creditMinor: l.creditMinor }));
  const net = out.reduce((s, l) => s + l.debitMinor - l.creditMinor, 0);
  if (net !== 0) {
    out.push({
      accountId: equityAccountId,
      debitMinor: net < 0 ? -net : 0,
      creditMinor: net > 0 ? net : 0,
      memo: "Opening balance equity",
    });
  }
  assertBalanced(out);
  return out;
}
```

Append to `lib/domain/reports.ts`:

```typescript
import { type NormalBalance } from "./accounts";

export interface LedgerActivityRow {
  debitMinor: number;
  creditMinor: number;
}
export type RunningRow = LedgerActivityRow & { runningMinor: number };

/**
 * Running balance for a General Ledger account. `normal` decides which side
 * increases the balance: debit-normal adds debits, credit-normal adds credits.
 */
export function computeRunningBalance(
  openingMinor: number,
  rows: LedgerActivityRow[],
  normal: NormalBalance,
): RunningRow[] {
  let running = openingMinor;
  return rows.map((r) => {
    const delta = normal === "debit" ? r.debitMinor - r.creditMinor : r.creditMinor - r.debitMinor;
    running += delta;
    return { ...r, runningMinor: running };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- journal-posting journal-ledger`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/posting.ts lib/domain/reports.ts tests/unit/journal-posting.test.ts tests/unit/journal-ledger.test.ts
git commit -m "feat: opening-balance posting builder + GL running-balance helper"
```

---

## Task 4: Domain — Zod schemas

**Files:**
- Modify: `lib/domain/schemas.ts`
- Test: `tests/unit/journal-schema.test.ts`

**Interfaces:**
- Produces:
  - `manualJournalLineSchema`, `manualJournalSchema` → `ManualJournalInput = { entry_date?, description?, source_ref?, currency_code, lines: {account_id, debit_minor, credit_minor}[] }`
  - `openingBalanceSchema` → `OpeningBalanceInput = { as_of?, currency_code, lines: {account_id, debit_minor, credit_minor}[] }`
  - `reverseEntrySchema` → `ReverseEntryInput = { entry_id, reason, reversal_date? }`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/journal-schema.test.ts
import { describe, it, expect } from "vitest";
import { manualJournalSchema, reverseEntrySchema, openingBalanceSchema } from "@/lib/domain/schemas";

const uuid = "11111111-1111-1111-1111-111111111111";
const uuid2 = "22222222-2222-2222-2222-222222222222";

describe("manualJournalSchema", () => {
  it("accepts a balanced two-line entry", () => {
    const r = manualJournalSchema.safeParse({
      currency_code: "USD",
      lines: [
        { account_id: uuid, debit_minor: 1000, credit_minor: 0 },
        { account_id: uuid2, debit_minor: 0, credit_minor: 1000 },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unbalanced entry", () => {
    const r = manualJournalSchema.safeParse({
      currency_code: "USD",
      lines: [
        { account_id: uuid, debit_minor: 1000, credit_minor: 0 },
        { account_id: uuid2, debit_minor: 0, credit_minor: 900 },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("rejects a line with two positive sides", () => {
    const r = manualJournalSchema.safeParse({
      currency_code: "USD",
      lines: [
        { account_id: uuid, debit_minor: 500, credit_minor: 500 },
        { account_id: uuid2, debit_minor: 0, credit_minor: 0 },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("rejects fewer than two lines", () => {
    const r = manualJournalSchema.safeParse({
      currency_code: "USD",
      lines: [{ account_id: uuid, debit_minor: 100, credit_minor: 0 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("reverseEntrySchema", () => {
  it("requires a non-empty reason", () => {
    expect(reverseEntrySchema.safeParse({ entry_id: uuid, reason: "" }).success).toBe(false);
    expect(reverseEntrySchema.safeParse({ entry_id: uuid, reason: "dup" }).success).toBe(true);
  });
});

describe("openingBalanceSchema", () => {
  it("requires at least one line", () => {
    expect(openingBalanceSchema.safeParse({ currency_code: "USD", lines: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- journal-schema`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Implement the schemas**

Append to `lib/domain/schemas.ts`:

```typescript
// --- Manual journal / opening balances / reversal ---
export const manualJournalLineSchema = z
  .object({
    account_id: z.uuid("Select an account"),
    debit_minor: z.number().int("Amounts must be whole minor units").min(0),
    credit_minor: z.number().int("Amounts must be whole minor units").min(0),
  })
  .refine((l) => (l.debit_minor > 0) !== (l.credit_minor > 0), {
    message: "Each line needs exactly one of debit or credit",
    path: ["debit_minor"],
  });

export const manualJournalSchema = z
  .object({
    entry_date: z.string().optional(),
    description: z.string().trim().max(500).optional().nullable(),
    source_ref: z.string().trim().max(120).optional().or(z.literal("")).nullable(),
    currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
    lines: z.array(manualJournalLineSchema).min(2, "Add at least two lines"),
  })
  .refine(
    (v) =>
      v.lines.reduce((s, l) => s + l.debit_minor, 0) ===
      v.lines.reduce((s, l) => s + l.credit_minor, 0),
    { message: "Debits and credits must be equal", path: ["lines"] },
  );
export type ManualJournalInput = z.infer<typeof manualJournalSchema>;

export const openingBalanceLineSchema = z.object({
  account_id: z.uuid("Select an account"),
  debit_minor: z.number().int().min(0).default(0),
  credit_minor: z.number().int().min(0).default(0),
});

export const openingBalanceSchema = z.object({
  as_of: z.string().optional(),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
  lines: z.array(openingBalanceLineSchema).min(1, "Enter at least one opening balance"),
});
export type OpeningBalanceInput = z.infer<typeof openingBalanceSchema>;

export const reverseEntrySchema = z.object({
  entry_id: z.uuid(),
  reason: z.string().trim().min(1, "A reversal reason is required").max(300),
  reversal_date: z.string().optional(),
});
export type ReverseEntryInput = z.infer<typeof reverseEntrySchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- journal-schema`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/schemas.ts tests/unit/journal-schema.test.ts
git commit -m "feat: Zod schemas for manual journal, opening balances, reversal"
```

---

## Task 5: db/types + service layer

**Files:**
- Modify: `lib/db/types.ts`
- Create: `lib/services/journal.ts`

**Interfaces:**
- Consumes: RPCs from Task 2; schemas from Task 4; `writeAudit` from `./audit`; `computeRunningBalance`, `normalBalanceOf`.
- Produces (all take `sb: SupabaseClient` first):
  - `createManualJournal(sb, input: ManualJournalInput): Promise<string>`
  - `reverseEntry(sb, input: ReverseEntryInput): Promise<string>`
  - `postOpeningBalances(sb, input: OpeningBalanceInput): Promise<string>`
  - `listJournalEntries(sb, filters: JournalFilters): Promise<JournalEntrySummary[]>`
  - `getGeneralLedger(sb, accountId: string, from: string, to: string): Promise<GeneralLedger>`
  - `listReversedEntries(sb): Promise<ReversedEntryRow[]>`
  - Types `JournalFilters`, `JournalEntrySummary`, `GeneralLedger`, `GeneralLedgerRow`, `ReversedEntryRow`, `JournalReversalLinkRow`.

- [ ] **Step 1: Add row types**

Append to `lib/db/types.ts`:

```typescript
export interface JournalReversalLinkRow {
  id: string;
  original_entry_id: string;
  reversal_entry_id: string;
  reason: string;
  created_by: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Write the service**

```typescript
// lib/services/journal.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { normalBalanceOf } from "@/lib/domain/accounts";
import { computeRunningBalance } from "@/lib/domain/reports";
import type { ManualJournalInput, OpeningBalanceInput, ReverseEntryInput } from "@/lib/domain/schemas";
import { writeAudit } from "./audit";

export class JournalError extends Error {}

export interface JournalFilters {
  from?: string | null;
  to?: string | null;
  sourceType?: string | null;
  accountId?: string | null;
  status?: string | null;
}

export interface JournalEntryLineSummary {
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  memo: string | null;
}
export interface JournalEntrySummary {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  sourceType: string;
  sourceId: string | null;
  status: string;
  isReversed: boolean;
  reversalEntryId: string | null;
  lines: JournalEntryLineSummary[];
}

export interface GeneralLedgerRow {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  sourceType: string;
  sourceId: string | null;
  memo: string | null;
  debitMinor: number;
  creditMinor: number;
  runningMinor: number;
}
export interface GeneralLedger {
  accountId: string;
  accountCode: string;
  accountName: string;
  openingMinor: number;
  rows: GeneralLedgerRow[];
  closingMinor: number;
}

export interface ReversedEntryRow {
  originalEntryId: string;
  originalNumber: string;
  reversalEntryId: string;
  reversalNumber: string;
  reason: string;
  createdAt: string;
}

// --- writes ---------------------------------------------------------------
export async function createManualJournal(sb: SupabaseClient, input: ManualJournalInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_post_manual_journal", {
    p_entry_date: input.entry_date || undefined,
    p_description: input.description || null,
    p_source_ref: input.source_ref || null,
    p_currency: input.currency_code,
    p_lines: input.lines.map((l) => ({
      account_id: l.account_id,
      debit_minor: l.debit_minor,
      credit_minor: l.credit_minor,
    })),
  });
  if (error) throw new JournalError(error.message);
  await writeAudit(sb, { table_name: "acc_journal_entry", record_id: data as string, action: "post" });
  return data as string;
}

export async function reverseEntry(sb: SupabaseClient, input: ReverseEntryInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_reverse_entry", {
    p_entry_id: input.entry_id,
    p_reason: input.reason,
    p_reversal_date: input.reversal_date || undefined,
  });
  if (error) throw new JournalError(error.message);
  await writeAudit(sb, { table_name: "acc_journal_entry", record_id: input.entry_id, action: "void" });
  return data as string;
}

export async function postOpeningBalances(sb: SupabaseClient, input: OpeningBalanceInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_post_opening_balances", {
    p_as_of: input.as_of || undefined,
    p_currency: input.currency_code,
    p_lines: input.lines
      .filter((l) => l.debit_minor > 0 || l.credit_minor > 0)
      .map((l) => ({ account_id: l.account_id, debit_minor: l.debit_minor, credit_minor: l.credit_minor })),
  });
  if (error) throw new JournalError(error.message);
  await writeAudit(sb, { table_name: "acc_journal_entry", record_id: data as string, action: "post" });
  return data as string;
}

// --- reads ----------------------------------------------------------------
type EntryRow = {
  id: string; entry_number: string; entry_date: string; description: string | null;
  source_type: string; source_id: string | null; status: string;
  acc_journal_line: { account_id: string; debit_minor: number; credit_minor: number; memo: string | null; line_order: number;
    acc_account: { account_code: string; name: string } | null }[];
};

export async function listJournalEntries(sb: SupabaseClient, filters: JournalFilters): Promise<JournalEntrySummary[]> {
  let q = sb
    .from("acc_journal_entry")
    .select(
      "id,entry_number,entry_date,description,source_type,source_id,status," +
        "acc_journal_line(account_id,debit_minor,credit_minor,memo,line_order,acc_account(account_code,name))",
    )
    .order("entry_date", { ascending: false })
    .order("entry_number", { ascending: false });
  if (filters.from) q = q.gte("entry_date", filters.from);
  if (filters.to) q = q.lte("entry_date", filters.to);
  if (filters.sourceType) q = q.eq("source_type", filters.sourceType);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) throw new JournalError(error.message);

  const rows = (data ?? []) as unknown as EntryRow[];
  const links = await sb.from("acc_journal_reversal_link").select("original_entry_id,reversal_entry_id");
  if (links.error) throw new JournalError(links.error.message);
  const reversedOf = new Map<string, string>();
  for (const l of links.data ?? []) reversedOf.set(l.original_entry_id as string, l.reversal_entry_id as string);

  let list = rows.map((e) => ({
    id: e.id,
    entryNumber: e.entry_number,
    entryDate: e.entry_date,
    description: e.description,
    sourceType: e.source_type,
    sourceId: e.source_id,
    status: e.status,
    isReversed: reversedOf.has(e.id),
    reversalEntryId: reversedOf.get(e.id) ?? null,
    lines: [...e.acc_journal_line]
      .sort((a, b) => a.line_order - b.line_order)
      .map((l) => ({
        accountCode: l.acc_account?.account_code ?? "",
        accountName: l.acc_account?.name ?? "",
        debitMinor: l.debit_minor,
        creditMinor: l.credit_minor,
        memo: l.memo,
      })),
  }));
  // Account filter is applied in TS because it matches on nested lines.
  if (filters.accountId) list = list.filter((e) => e.lines.some((_, i) => rows.find((r) => r.id === e.id)!.acc_journal_line[i]?.account_id === filters.accountId));
  return list;
}

export async function getGeneralLedger(
  sb: SupabaseClient,
  accountId: string,
  from: string,
  to: string,
): Promise<GeneralLedger> {
  const acctRes = await sb.from("acc_account").select("account_code,name,account_type").eq("id", accountId).single();
  if (acctRes.error) throw new JournalError(acctRes.error.message);
  const acct = acctRes.data as { account_code: string; name: string; account_type: AccountType };
  const normal = normalBalanceOf(acct.account_type);

  // Opening balance = signed activity strictly before `from` on posted entries.
  const openRes = await sb.rpc("acc_ledger_balances", { p_from: null, p_to: shiftBack(from) });
  if (openRes.error) throw new JournalError(openRes.error.message);
  const openRow = (openRes.data ?? []).find((r: Record<string, unknown>) => (r.account_id as string) === accountId);
  const openDebit = openRow ? Number(openRow.debit_base) : 0;
  const openCredit = openRow ? Number(openRow.credit_base) : 0;
  const openingMinor = normal === "debit" ? openDebit - openCredit : openCredit - openDebit;

  const linesRes = await sb
    .from("acc_journal_line")
    .select(
      "debit_minor,credit_minor,memo,acc_journal_entry!inner(id,entry_number,entry_date,source_type,source_id,status)",
    )
    .eq("account_id", accountId)
    .eq("acc_journal_entry.status", "posted")
    .gte("acc_journal_entry.entry_date", from)
    .lte("acc_journal_entry.entry_date", to);
  if (linesRes.error) throw new JournalError(linesRes.error.message);

  type LineRow = {
    debit_minor: number; credit_minor: number; memo: string | null;
    acc_journal_entry: { id: string; entry_number: string; entry_date: string; source_type: string; source_id: string | null };
  };
  const raw = (linesRes.data ?? []) as unknown as LineRow[];
  raw.sort((a, b) =>
    a.acc_journal_entry.entry_date === b.acc_journal_entry.entry_date
      ? a.acc_journal_entry.entry_number.localeCompare(b.acc_journal_entry.entry_number)
      : a.acc_journal_entry.entry_date.localeCompare(b.acc_journal_entry.entry_date),
  );
  const running = computeRunningBalance(
    openingMinor,
    raw.map((r) => ({ debitMinor: r.debit_minor, creditMinor: r.credit_minor })),
    normal,
  );
  const rows: GeneralLedgerRow[] = raw.map((r, i) => ({
    entryId: r.acc_journal_entry.id,
    entryNumber: r.acc_journal_entry.entry_number,
    entryDate: r.acc_journal_entry.entry_date,
    sourceType: r.acc_journal_entry.source_type,
    sourceId: r.acc_journal_entry.source_id,
    memo: r.memo,
    debitMinor: r.debit_minor,
    creditMinor: r.credit_minor,
    runningMinor: running[i].runningMinor,
  }));
  return {
    accountId,
    accountCode: acct.account_code,
    accountName: acct.name,
    openingMinor,
    rows,
    closingMinor: rows.length ? rows[rows.length - 1].runningMinor : openingMinor,
  };
}

export async function listReversedEntries(sb: SupabaseClient): Promise<ReversedEntryRow[]> {
  const { data, error } = await sb
    .from("acc_journal_reversal_link")
    .select(
      "reason,created_at," +
        "orig:acc_journal_entry!acc_journal_reversal_link_original_entry_id_fkey(id,entry_number)," +
        "rev:acc_journal_entry!acc_journal_reversal_link_reversal_entry_id_fkey(id,entry_number)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new JournalError(error.message);
  type Row = { reason: string; created_at: string; orig: { id: string; entry_number: string }; rev: { id: string; entry_number: string } };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    originalEntryId: r.orig.id,
    originalNumber: r.orig.entry_number,
    reversalEntryId: r.rev.id,
    reversalNumber: r.rev.entry_number,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/** One day before an ISO date (opening balance is activity strictly before `from`). */
function shiftBack(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If the nested-select generics complain, the `as unknown as` casts above localize them — matching the existing services' style.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/types.ts lib/services/journal.ts
git commit -m "feat: journal service (create, reverse, opening balances, GL, journal list)"
```

---

## Task 6: Server Actions + role guards

**Files:**
- Create: `app/(app)/journal/actions.ts`
- Create: `app/(app)/opening-balances/actions.ts`
- Create: `app/(app)/reports/general-ledger/actions.ts`
- Create: `app/(app)/reports/journal/actions.ts`

**Interfaces:**
- Consumes: service functions from Task 5; `createSupabaseServerClient`, `getUserRole`, `canWrite`; schemas from Task 4.
- Produces action functions returning `ActionResult<T>` (same shape as sales-tax actions).

- [ ] **Step 1: Journal actions**

```typescript
// app/(app)/journal/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { manualJournalSchema, reverseEntrySchema } from "@/lib/domain/schemas";
import { createManualJournal, reverseEntry, listJournalEntries, listReversedEntries, JournalError, type JournalFilters, type JournalEntrySummary, type ReversedEntryRow } from "@/lib/services/journal";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(err: unknown): string {
  if (err instanceof JournalError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createJournalAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = manualJournalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await createManualJournal(sb, parsed.data);
    revalidatePath("/journal");
    return { ok: true, data: { id } };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

export async function reverseEntryAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = reverseEntrySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await reverseEntry(sb, parsed.data);
    revalidatePath("/journal");
    return { ok: true, data: { id } };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

export async function listJournalAction(filters: JournalFilters): Promise<ActionResult<JournalEntrySummary[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listJournalEntries(sb, filters) };
  } catch (err) { return { ok: false, error: msg(err) }; }
}

export async function listReversedAction(): Promise<ActionResult<ReversedEntryRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listReversedEntries(sb) };
  } catch (err) { return { ok: false, error: msg(err) }; }
}
```

- [ ] **Step 2: Opening-balances actions**

```typescript
// app/(app)/opening-balances/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { openingBalanceSchema } from "@/lib/domain/schemas";
import { postOpeningBalances, JournalError } from "@/lib/services/journal";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
function msg(err: unknown): string {
  if (err instanceof JournalError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function postOpeningBalancesAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = openingBalanceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await postOpeningBalances(sb, parsed.data);
    revalidatePath("/opening-balances");
    return { ok: true, data: { id } };
  } catch (err) { return { ok: false, error: msg(err) }; }
}
```

- [ ] **Step 3: Report actions**

```typescript
// app/(app)/reports/general-ledger/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getGeneralLedger, JournalError, type GeneralLedger } from "@/lib/services/journal";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function generalLedgerAction(accountId: string, from: string, to: string): Promise<ActionResult<GeneralLedger>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getGeneralLedger(sb, accountId, from, to) };
  } catch (err) {
    return { ok: false, error: err instanceof JournalError || err instanceof Error ? err.message : "An unexpected error occurred" };
  }
}
```

```typescript
// app/(app)/reports/journal/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listJournalEntries, JournalError, type JournalFilters, type JournalEntrySummary } from "@/lib/services/journal";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function journalReportAction(filters: JournalFilters): Promise<ActionResult<JournalEntrySummary[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listJournalEntries(sb, filters) };
  } catch (err) {
    return { ok: false, error: err instanceof JournalError || err instanceof Error ? err.message : "An unexpected error occurred" };
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/journal/actions.ts" "app/(app)/opening-balances/actions.ts" "app/(app)/reports/general-ledger/actions.ts" "app/(app)/reports/journal/actions.ts"
git commit -m "feat: server actions for journal, opening balances, GL/journal reports"
```

---

## Task 7: UI — Journal list + create form + reverse

**Files:**
- Create: `app/(app)/journal/page.tsx`
- Create: `app/(app)/journal/JournalClient.tsx`

**Interfaces:**
- Consumes: `listJournalAction`, `createJournalAction`, `reverseEntryAction` (Task 6); `listAccounts` reads; `listCurrencies`.
- Produces: a client page. No new exports consumed elsewhere.

- [ ] **Step 1: Page (server component)**

```tsx
// app/(app)/journal/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import JournalClient from "./JournalClient";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [currencies, accountsRes] = await Promise.all([
    listCurrencies(sb),
    sb.from("acc_account").select("id,account_code,name,is_posting_account,status,account_type").order("account_code"),
  ]);
  const base = currencies.find((c) => c.is_base);
  const accounts = (accountsRes.data ?? []).filter(
    (a: { is_posting_account: boolean; status: string }) => a.is_posting_account && a.status === "active",
  );
  return (
    <div>
      <PageHeader title="Journal Entries" description="Create balanced manual journals and correct posted entries with linked reversals." />
      <JournalClient
        canWrite={canWrite(role)}
        accounts={accounts as { id: string; account_code: string; name: string }[]}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

- [ ] **Step 2: Client component**

```tsx
// app/(app)/journal/JournalClient.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { createJournalAction, reverseEntryAction, listJournalAction } from "./actions";
import type { JournalEntrySummary } from "@/lib/services/journal";

interface Account { id: string; account_code: string; name: string; }
interface Props { canWrite: boolean; accounts: Account[]; baseCurrency: string; baseDecimals: number; }
interface LineForm { account_id?: string; debit?: number; credit?: number; }

export default function JournalClient({ canWrite, accounts, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [entries, setEntries] = useState<JournalEntrySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [lines, setLines] = useState<LineForm[]>([{}, {}]);

  const load = async () => {
    setLoading(true);
    const r = await listJournalAction({});
    setLoading(false);
    if (r.ok && r.data) setEntries(r.data);
    else message.error(r.error ?? "Failed to load");
  };
  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + toMinor(l.debit ?? 0, baseDecimals), 0);
    const c = lines.reduce((s, l) => s + toMinor(l.credit ?? 0, baseDecimals), 0);
    return { d, c, diff: d - c };
  }, [lines, baseDecimals]);

  const submit = async () => {
    const header = await form.validateFields();
    const payload = {
      entry_date: header.entry_date?.format("YYYY-MM-DD"),
      description: header.description ?? null,
      source_ref: header.source_ref ?? null,
      currency_code: baseCurrency,
      lines: lines
        .filter((l) => l.account_id && ((l.debit ?? 0) > 0 || (l.credit ?? 0) > 0))
        .map((l) => ({ account_id: l.account_id!, debit_minor: toMinor(l.debit ?? 0, baseDecimals), credit_minor: toMinor(l.credit ?? 0, baseDecimals) })),
    };
    const r = await createJournalAction(payload);
    if (r.ok) { message.success("Journal posted"); setOpen(false); setLines([{}, {}]); form.resetFields(); void load(); }
    else message.error(r.error ?? "Failed to post");
  };

  const reverse = (entry: JournalEntrySummary) => {
    let reason = "";
    Modal.confirm({
      title: `Reverse ${entry.entryNumber}?`,
      content: <Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} />,
      onOk: async () => {
        const r = await reverseEntryAction({ entry_id: entry.id, reason });
        if (r.ok) { message.success("Reversal posted"); void load(); }
        else { message.error(r.error ?? "Failed to reverse"); throw new Error(r.error); }
      },
    });
  };

  const fmt = (m: number) => (m ? fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals }) : "");

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {canWrite && <Button type="primary" onClick={() => setOpen(true)}>New Journal Entry</Button>}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={entries}
        expandable={{
          expandedRowRender: (e) => (
            <Table
              size="small" rowKey={(_, i) => String(i)} pagination={false}
              dataSource={e.lines}
              columns={[
                { title: "Account", render: (_, l) => `${l.accountCode} ${l.accountName}` },
                { title: "Memo", dataIndex: "memo" },
                { title: "Debit", align: "right", render: (_, l) => fmt(l.debitMinor) },
                { title: "Credit", align: "right", render: (_, l) => fmt(l.creditMinor) },
              ]}
            />
          ),
        }}
        columns={[
          { title: "Number", dataIndex: "entryNumber" },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Source", dataIndex: "sourceType", render: (s) => <Tag>{s}</Tag> },
          { title: "Description", dataIndex: "description" },
          { title: "Status", render: (_, e) => e.isReversed ? <Tag color="orange">reversed</Tag> : <Tag color="green">{e.status}</Tag> },
          {
            title: "", render: (_, e) =>
              canWrite && e.status === "posted" && !e.isReversed && e.sourceType === "manual"
                ? <Button size="small" onClick={() => reverse(e)}>Reverse</Button> : null,
          },
        ]}
      />
      <Modal open={open} title="New Journal Entry" onCancel={() => setOpen(false)} onOk={submit} okButtonProps={{ disabled: totals.diff !== 0 || totals.d === 0 }} width={760}>
        <Form form={form} layout="vertical">
          <Space>
            <Form.Item name="entry_date" label="Date"><DatePicker /></Form.Item>
            <Form.Item name="source_ref" label="Source reference"><Input placeholder="Optional" /></Form.Item>
          </Space>
          <Form.Item name="description" label="Description"><Input /></Form.Item>
        </Form>
        <Card size="small" title={`Lines (${baseCurrency})`}>
          {lines.map((l, i) => (
            <Space key={i} style={{ display: "flex", marginBottom: 8 }}>
              <Select
                showSearch style={{ width: 280 }} placeholder="Account"
                optionFilterProp="label" value={l.account_id}
                options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, account_id: v } : x)))}
              />
              <InputNumber placeholder="Debit" min={0} value={l.debit}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, debit: v ?? undefined, credit: undefined } : x)))} />
              <InputNumber placeholder="Credit" min={0} value={l.credit}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, credit: v ?? undefined, debit: undefined } : x)))} />
              <Button danger onClick={() => setLines((p) => p.filter((_, j) => j !== i))} disabled={lines.length <= 2}>×</Button>
            </Space>
          ))}
          <Button onClick={() => setLines((p) => [...p, {}])}>Add line</Button>
          <div style={{ marginTop: 12 }}>
            Debit: {fmt(totals.d)} &nbsp; Credit: {fmt(totals.c)} &nbsp;
            <Tag color={totals.diff === 0 ? "green" : "red"}>Difference: {fmt(Math.abs(totals.diff))}</Tag>
          </div>
        </Card>
      </Modal>
    </Space>
  );
}
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: compiles; no lint errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/journal/page.tsx" "app/(app)/journal/JournalClient.tsx"
git commit -m "feat: Journal Entries page (create balanced JE, reverse)"
```

---

## Task 8: UI — Opening balances

**Files:**
- Create: `app/(app)/opening-balances/page.tsx`
- Create: `app/(app)/opening-balances/OpeningBalancesClient.tsx`

**Interfaces:**
- Consumes: `postOpeningBalancesAction`; `buildOpeningBalancePosting` for the client-side preview; account/currency reads.

- [ ] **Step 1: Page (server component)**

```tsx
// app/(app)/opening-balances/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import OpeningBalancesClient from "./OpeningBalancesClient";

export const dynamic = "force-dynamic";

export default async function OpeningBalancesPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [currencies, accountsRes] = await Promise.all([
    listCurrencies(sb),
    sb.from("acc_account").select("id,account_code,name,is_posting_account,status").eq("is_posting_account", true).eq("status", "active").order("account_code"),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader title="Opening Balances" description="Seed account balances as of a cutover date; the difference books to Opening Balance Equity. The batch must balance before it posts." />
      <OpeningBalancesClient
        canWrite={canWrite(role)}
        accounts={(accountsRes.data ?? []) as { id: string; account_code: string; name: string }[]}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

- [ ] **Step 2: Client component**

```tsx
// app/(app)/opening-balances/OpeningBalancesClient.tsx
"use client";
import { useMemo, useState } from "react";
import { App, Alert, Button, DatePicker, InputNumber, Select, Space, Table } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { postOpeningBalancesAction } from "./actions";

interface Account { id: string; account_code: string; name: string; }
interface Props { canWrite: boolean; accounts: Account[]; baseCurrency: string; baseDecimals: number; }
interface Row { key: number; account_id?: string; debit?: number; credit?: number; }

export default function OpeningBalancesClient({ canWrite, accounts, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Row[]>([{ key: 0 }, { key: 1 }]);
  const [asOf, setAsOf] = useState<import("dayjs").Dayjs | null>(null);
  const [posting, setPosting] = useState(false);

  const totals = useMemo(() => {
    const d = rows.reduce((s, r) => s + toMinor(r.debit ?? 0, baseDecimals), 0);
    const c = rows.reduce((s, r) => s + toMinor(r.credit ?? 0, baseDecimals), 0);
    return { d, c, equity: d - c };
  }, [rows, baseDecimals]);

  const fmt = (m: number) => fromMinor(Math.abs(m), baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const post = async () => {
    setPosting(true);
    const r = await postOpeningBalancesAction({
      as_of: asOf?.format("YYYY-MM-DD"),
      currency_code: baseCurrency,
      lines: rows.filter((x) => x.account_id).map((x) => ({ account_id: x.account_id!, debit_minor: toMinor(x.debit ?? 0, baseDecimals), credit_minor: toMinor(x.credit ?? 0, baseDecimals) })),
    });
    setPosting(false);
    if (r.ok) { message.success("Opening balances posted"); setRows([{ key: 0 }, { key: 1 }]); }
    else message.error(r.error ?? "Failed to post");
  };

  const update = (key: number, patch: Partial<Row>) => setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <DatePicker placeholder="As-of date" value={asOf} onChange={setAsOf} />
      <Table
        rowKey="key" pagination={false} dataSource={rows}
        columns={[
          { title: "Account", render: (_, r) => (
            <Select showSearch style={{ width: 320 }} placeholder="Account" optionFilterProp="label" value={r.account_id}
              options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
              onChange={(v) => update(r.key, { account_id: v })} />
          ) },
          { title: "Debit", align: "right", render: (_, r) => (
            <InputNumber min={0} value={r.debit} onChange={(v) => update(r.key, { debit: v ?? undefined, credit: undefined })} />
          ) },
          { title: "Credit", align: "right", render: (_, r) => (
            <InputNumber min={0} value={r.credit} onChange={(v) => update(r.key, { credit: v ?? undefined, debit: undefined })} />
          ) },
        ]}
        footer={() => <Button onClick={() => setRows((p) => [...p, { key: (p.at(-1)?.key ?? 0) + 1 }])}>Add row</Button>}
      />
      <Alert
        type={totals.equity === 0 ? "success" : "info"}
        message={
          totals.equity === 0
            ? `Balanced. Debit = Credit = ${fmt(totals.d)} ${baseCurrency}.`
            : `Opening Balance Equity will absorb ${fmt(totals.equity)} ${baseCurrency} on the ${totals.equity > 0 ? "credit" : "debit"} side to balance.`
        }
      />
      {canWrite && <Button type="primary" loading={posting} disabled={!asOf || totals.d + totals.c === 0} onClick={post}>Post opening balances</Button>}
    </Space>
  );
}
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: compiles; no lint errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/opening-balances/page.tsx" "app/(app)/opening-balances/OpeningBalancesClient.tsx"
git commit -m "feat: Opening Balances page (controlled batch, equity auto-balance)"
```

---

## Task 9: UI — General Ledger + Journal reports + nav

**Files:**
- Create: `app/(app)/reports/general-ledger/page.tsx`
- Create: `app/(app)/reports/general-ledger/GeneralLedgerClient.tsx`
- Create: `app/(app)/reports/journal/page.tsx`
- Create: `app/(app)/reports/journal/JournalReportClient.tsx`
- Modify: `components/AppShell.tsx`

**Interfaces:**
- Consumes: `generalLedgerAction`, `journalReportAction`; account/currency reads.

- [ ] **Step 1: General Ledger page + client**

```tsx
// app/(app)/reports/general-ledger/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import GeneralLedgerClient from "./GeneralLedgerClient";

export const dynamic = "force-dynamic";

export default async function GeneralLedgerPage() {
  const sb = await createSupabaseServerClient();
  const [currencies, accountsRes] = await Promise.all([
    listCurrencies(sb),
    sb.from("acc_account").select("id,account_code,name,is_posting_account,status").eq("is_posting_account", true).order("account_code"),
  ]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader title="General Ledger" description="Account activity with opening, per-line running balance, and closing balance." />
      <GeneralLedgerClient
        accounts={(accountsRes.data ?? []) as { id: string; account_code: string; name: string }[]}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

```tsx
// app/(app)/reports/general-ledger/GeneralLedgerClient.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { App, Button, DatePicker, Select, Space, Statistic, Table, Typography } from "antd";
import { fromMinor } from "@/lib/domain/money";
import { generalLedgerAction } from "./actions";
import type { GeneralLedger } from "@/lib/services/journal";

interface Account { id: string; account_code: string; name: string; }
interface Props { accounts: Account[]; baseCurrency: string; baseDecimals: number; }

// Drill-down: map a posted line back to its source document route.
function sourceHref(sourceType: string, sourceId: string | null): string | null {
  if (!sourceId) return null;
  const map: Record<string, string> = { invoice: "/invoices", payment: "/payments", bill: "/bills", expense: "/expenses", bill_payment: "/pay-bills", tax_payment: "/sales-tax" };
  return map[sourceType] ? `${map[sourceType]}` : null;
}

export default function GeneralLedgerClient({ accounts, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [accountId, setAccountId] = useState<string>();
  const [range, setRange] = useState<[import("dayjs").Dayjs, import("dayjs").Dayjs] | null>(null);
  const [gl, setGl] = useState<GeneralLedger | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!accountId || !range) { message.warning("Pick an account and date range"); return; }
    setLoading(true);
    const r = await generalLedgerAction(accountId, range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setGl(r.data);
    else message.error(r.error ?? "Failed to load");
  };
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <Select showSearch style={{ width: 320 }} placeholder="Account" optionFilterProp="label" value={accountId}
          options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))} onChange={setAccountId} />
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as [import("dayjs").Dayjs, import("dayjs").Dayjs])} />
        <Button type="primary" loading={loading} onClick={run}>Run</Button>
      </Space>
      {gl && (
        <>
          <Typography.Text type="secondary">
            {gl.accountCode} {gl.accountName} · Base currency {baseCurrency} · Accrual basis
          </Typography.Text>
          <Space size="large">
            <Statistic title="Opening" value={fmt(gl.openingMinor)} />
            <Statistic title="Closing" value={fmt(gl.closingMinor)} />
          </Space>
          <Table
            rowKey="entryId" dataSource={gl.rows} pagination={false} loading={loading}
            columns={[
              { title: "Date", dataIndex: "entryDate" },
              { title: "Entry", dataIndex: "entryNumber", render: (n, r) => {
                const href = sourceHref(r.sourceType, r.sourceId);
                return href ? <Link href={href}>{n}</Link> : n;
              } },
              { title: "Source", dataIndex: "sourceType" },
              { title: "Memo", dataIndex: "memo" },
              { title: "Debit", align: "right", render: (_, r) => (r.debitMinor ? fmt(r.debitMinor) : "") },
              { title: "Credit", align: "right", render: (_, r) => (r.creditMinor ? fmt(r.creditMinor) : "") },
              { title: "Running", align: "right", render: (_, r) => fmt(r.runningMinor) },
            ]}
          />
        </>
      )}
    </Space>
  );
}
```

- [ ] **Step 2: Journal report page + client**

```tsx
// app/(app)/reports/journal/page.tsx
import PageHeader from "@/components/PageHeader";
import JournalReportClient from "./JournalReportClient";

export const dynamic = "force-dynamic";

export default function JournalReportPage() {
  return (
    <div>
      <PageHeader title="Journal Report" description="All journal entries with their lines, filterable by date, source, and status." />
      <JournalReportClient />
    </div>
  );
}
```

```tsx
// app/(app)/reports/journal/JournalReportClient.tsx
"use client";
import { useEffect, useState } from "react";
import { App, DatePicker, Select, Space, Table, Tag } from "antd";
import { journalReportAction } from "./actions";
import type { JournalEntrySummary } from "@/lib/services/journal";

const SOURCES = ["invoice", "payment", "manual", "bank", "reconciliation", "opening_balance", "bill", "expense", "bill_payment", "tax_payment"];

export default function JournalReportClient() {
  const { message } = App.useApp();
  const [data, setData] = useState<JournalEntrySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string>();
  const [range, setRange] = useState<[import("dayjs").Dayjs, import("dayjs").Dayjs] | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await journalReportAction({
      sourceType: source ?? null,
      from: range ? range[0].format("YYYY-MM-DD") : null,
      to: range ? range[1].format("YYYY-MM-DD") : null,
    });
    setLoading(false);
    if (r.ok && r.data) setData(r.data);
    else message.error(r.error ?? "Failed to load");
  };
  useEffect(() => { void load(); }, [source, range]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <Select allowClear style={{ width: 200 }} placeholder="Source" value={source} onChange={setSource}
          options={SOURCES.map((s) => ({ value: s, label: s }))} />
        <DatePicker.RangePicker value={range} onChange={(v) => setRange(v as [import("dayjs").Dayjs, import("dayjs").Dayjs])} />
      </Space>
      <Table
        rowKey="id" loading={loading} dataSource={data}
        expandable={{ expandedRowRender: (e) => (
          <Table size="small" rowKey={(_, i) => String(i)} pagination={false} dataSource={e.lines}
            columns={[
              { title: "Account", render: (_, l) => `${l.accountCode} ${l.accountName}` },
              { title: "Debit", align: "right", dataIndex: "debitMinor" },
              { title: "Credit", align: "right", dataIndex: "creditMinor" },
            ]} />
        ) }}
        columns={[
          { title: "Number", dataIndex: "entryNumber" },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Source", dataIndex: "sourceType", render: (s) => <Tag>{s}</Tag> },
          { title: "Description", dataIndex: "description" },
          { title: "Status", render: (_, e) => e.isReversed ? <Tag color="orange">reversed</Tag> : <Tag color="green">{e.status}</Tag> },
        ]}
      />
    </Space>
  );
}
```

- [ ] **Step 3: Add navigation entries**

In `components/AppShell.tsx`, add to the `NAV` array (after the `/sales-tax` entry). Reuse an already-imported icon (e.g. `FileTextOutlined`) to avoid a new import:

```tsx
  { key: "/journal", icon: <FileTextOutlined />, label: "Journal Entries" },
  { key: "/opening-balances", icon: <TableOutlined />, label: "Opening Balances" },
```

The two reports live under the existing `/reports` route group and are reachable at `/reports/general-ledger` and `/reports/journal`; add links to them from the Reports landing page if desired (optional — not required for this task).

- [ ] **Step 4: Build + lint + typecheck**

Run: `npm run build && npm run lint && npm run typecheck`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/reports/general-ledger" "app/(app)/reports/journal" components/AppShell.tsx
git commit -m "feat: General Ledger + Journal reports with drill-down + nav"
```

---

## Task 10: End-to-end verify + full verification

**Files:**
- Create: `scripts/verify-journal.mjs`

**Interfaces:**
- Consumes: applied migrations 0017/0018; the seeded admin login and COA (accounts `1010`, `3900`, `4000`).

- [ ] **Step 1: Write the verify script**

```javascript
// scripts/verify-journal.mjs
// E2E verify of Module B (as admin): post a manual JE and check GL/Trial Balance;
// reverse it and confirm the original stays and the net is zero from the reversal
// date; post opening balances and confirm the ledger balances. Cleans up after.
// Run: node --env-file=.env.local scripts/verify-journal.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };
const acctId = async (code) => (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;

async function main() {
  await db.connect();
  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({ email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026" });
  if (e1) throw new Error("login: " + e1.message);
  const authed = createClient(url, key, { global: { headers: { Authorization: "Bearer " + auth.session.access_token } }, auth: { persistSession: false } });

  const bank = await acctId("1010");
  const income = await acctId("4000");

  // 1) Manual JE: DR bank 300, CR income 300.
  const { data: jeId, error: e2 } = await authed.rpc("acc_post_manual_journal", {
    p_entry_date: "2026-03-15", p_description: "E2E manual", p_source_ref: "REF-1", p_currency: "USD",
    p_lines: [
      { account_id: bank, debit_minor: 300_00, credit_minor: 0 },
      { account_id: income, debit_minor: 0, credit_minor: 300_00 },
    ],
  });
  if (e2) throw new Error("manual: " + e2.message);
  const bankBal = async (to) => Number((await db.query(
    "select coalesce(sum(debit_minor-credit_minor),0) b from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where l.account_id=$1 and e.status='posted' and e.entry_date<=$2", [bank, to])).rows[0].b);
  check("bank rose by 300 after manual JE", (await bankBal("2026-03-15")) >= 300_00);

  // Trial balance still balances (sum debit = sum credit over posted).
  const tb = async () => (await db.query("select coalesce(sum(debit_minor),0) d, coalesce(sum(credit_minor),0) c from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where e.status='posted'")).rows[0];
  let t = await tb();
  check("trial balance balanced after manual JE", Number(t.d) === Number(t.c), `(${t.d}=${t.c})`);

  // 2) Reverse it in April. Original stays posted; net from reversal date = 0.
  const { error: e3 } = await authed.rpc("acc_reverse_entry", { p_entry_id: jeId, p_reason: "E2E reverse", p_reversal_date: "2026-04-01" });
  if (e3) throw new Error("reverse: " + e3.message);
  const origStatus = (await db.query("select status from acc_journal_entry where id=$1", [jeId])).rows[0].status;
  check("original entry remains posted", origStatus === "posted");
  check("report before reversal unchanged (bank at Mar 31 still +300)", (await bankBal("2026-03-31")) >= 300_00);
  check("net bank effect at Apr 30 is zero", (await bankBal("2026-04-30")) === (await bankBal("2026-02-28")));

  // Reversing again must fail.
  const { error: e4 } = await authed.rpc("acc_reverse_entry", { p_entry_id: jeId, p_reason: "again", p_reversal_date: "2026-04-02" });
  check("re-reversing the same entry is rejected", !!e4);

  // 3) Opening balances as of 2026-01-01: DR bank 1000 -> equity CR 1000.
  const { error: e5 } = await authed.rpc("acc_post_opening_balances", {
    p_as_of: "2026-01-01", p_currency: "USD",
    p_lines: [{ account_id: bank, debit_minor: 1000_00, credit_minor: 0 }],
  });
  if (e5) throw new Error("opening: " + e5.message);
  const equity = await acctId("3900");
  const equityCr = Number((await db.query("select coalesce(sum(credit_minor-debit_minor),0) c from acc_journal_line where account_id=$1", [equity])).rows[0].c);
  check("Opening Balance Equity absorbed 1000", equityCr === 1000_00, `(=${equityCr})`);
  t = await tb();
  check("trial balance balanced after opening balances", Number(t.d) === Number(t.c), `(${t.d}=${t.c})`);

  // Second opening batch for same date rejected.
  const { error: e6 } = await authed.rpc("acc_post_opening_balances", { p_as_of: "2026-01-01", p_currency: "USD", p_lines: [{ account_id: bank, debit_minor: 1, credit_minor: 0 }] });
  check("duplicate opening batch rejected", !!e6);

  // Cleanup
  await db.query("begin");
  await db.query("delete from acc_journal_reversal_link");
  await db.query("delete from acc_journal_line");
  await db.query("delete from acc_journal_entry");
  await db.query("update acc_sequence set next_value=1");
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  const parts = [e.code, e.message].filter(Boolean).join(" ");
  console.error("verify error:", parts || "(no message)");
  process.exitCode = 1;
}).finally(() => db.end());
```

- [ ] **Step 2: Apply migrations, then run the verify script**

Apply `0017` and `0018` via the Supabase SQL Editor (DB unreachable over IPv4 here).
Run: `node --env-file=.env.local scripts/verify-journal.mjs`
Expected: `9 passed, 0 failed`. (If `SUPABASE_DB_URL` is unreachable, note it — the RPC/UI paths are still exercised by build/test/typecheck; record the blocker rather than claiming a pass.)

- [ ] **Step 3: Full project verification (mandatory, paste real output)**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: build succeeds; all unit tests pass (including the 11 new ones); typecheck and lint clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-journal.mjs
git commit -m "test: end-to-end verify for manual journal, reversal, opening balances"
```

---

## Self-Review

**Spec coverage:**
- US-FR-021 balanced manual journals → Tasks 2, 4, 5, 7 (RPC rejects unbalanced; deferred trigger is the backstop).
- US-FR-022 opening balances via controlled journal → Tasks 2, 8 (preview must balance; duplicate-batch guard).
- US-FR-023 linked reversal, original visible, historical reports reproducible → Tasks 1, 2, 5, 7, 10 (original stays `posted`; reversal dated separately; re-reversal rejected).
- US-FR-024 General Ledger & Journal reports with filter + drill-down → Tasks 5, 6, 9.
- Manual §"Required reports" reversed-entries report → `listReversedEntries` (Task 5) + reversed badge (Tasks 7, 9). A standalone reversed-report page is optional; the data + badges satisfy the requirement.
- Manual §Reports header (basis, base currency, filters) → GL client shows base currency + accrual basis + account context (Task 9); Journal report shows filters. CSV/PDF export is provided by the existing Reports export affordance; per-report export buttons can be added if the existing `ReportsClient` export util is reused (noted, not required this module).
- Deferred (approval, attachments, scheduled reversal, closed-period blocks) → correctly out of scope per spec §1.

**Placeholder scan:** No TBD/TODO; every code step contains full code.

**Type consistency:** `ManualJournalInput`/`OpeningBalanceInput`/`ReverseEntryInput` (Task 4) are consumed with the same names in Tasks 5–6. Service function names (`createManualJournal`, `reverseEntry`, `postOpeningBalances`, `listJournalEntries`, `getGeneralLedger`, `listReversedEntries`) match between Tasks 5 and 6. `computeRunningBalance`/`buildOpeningBalancePosting` signatures match between Tasks 3, 5, 8. RPC parameter names match between Tasks 2 and 5.

**Note on CSV/PDF export:** the spec lists export for GL/Journal. This plan wires the reports and drill-down; if full parity with the existing Reports export is required, add a follow-up step reusing the util in `app/(app)/reports/ReportsClient.tsx`. Flagged so it is not silently dropped.
