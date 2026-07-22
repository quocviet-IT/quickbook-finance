# Expenses & Bills (Accounts Payable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the buy-side (Accounts Payable) — Bills, Bill Payments, and Expenses — mirroring the existing Invoice→Payment module.

**Architecture:** New `acc_*` tables + atomic `SECURITY DEFINER` RPCs post balanced double-entry journal entries; a service layer wraps the RPCs; Ant Design pages under `app/(app)/*`. All balances/reports derive from the ledger, so no report code changes. US tax model: tax is included in line amounts — no separate purchase-tax posting.

**Tech Stack:** Next.js 16 (App Router) + TypeScript (strict) + Supabase (Postgres/RLS) + Ant Design v6 + Zod v4 + Vitest.

## Global Constraints

- Money is integer **minor units** (`_minor` columns/fields); never floats. Reuse `lib/domain/money.ts`.
- All financial writes go through the **service layer → atomic RPC**; no React component touches ledger tables. (Holy Grail Part 14: one business rule = one implementation.)
- Amounts are **recomputed server-side**, never trusted from the client. (Part 10)
- Every new table has **RLS**: `select` for any authenticated role, write via `acc_is_staff()`. (Part 12)
- Every financial write appends to `acc_audit_log` via `writeAudit`. (Part 12)
- UI in **English**, currency **USD** base, **Sales Tax not VAT**. Data tables scroll horizontally on narrow screens. (Bonus)
- Reuse existing pure helpers: `assertBalanced`, `isBalanced`, `reverse`, `JournalLineInput` from `lib/domain/posting.ts`.
- Verify before "done": `npm run build`, `npm test`, `npm run typecheck`, `npm run lint` — zero errors — and paste real output. (Part 10)
- Work on branch `feature/expenses-bills-payables` (already created). Commit at each task boundary. (Part 08/15)

---

### Task 1: Bring `CLAUDE.md` up to guidebook standard (Part 05)

Foundational: the guidebook self-enforces only if `CLAUDE.md` carries its 5 mandatory sections. Currently it only imports `AGENTS.md`.

**Files:**
- Modify: `ctyhp-accounting/CLAUDE.md`

- [ ] **Step 1: Replace `CLAUDE.md` content**

```markdown
# CTYHP Accounting — AI working rulebook

@AGENTS.md

Follow `../holy-grail-coding-guidebook-en.md`. This file is the project-specific
contract required by its Part 05.

## 1. Run commands (exact)
- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

## 2. How to verify (mandatory before claiming "done")
- Run build + test + typecheck + lint, zero errors, and paste the real output.
- Money logic: add/adjust a unit test with concrete input/output in `tests/unit/`; never verify by "looks right in the UI".
- Posting builders must assert `debit == credit` (`assertBalanced`).

## 3. Architecture & where logic lives
- Double-entry ledger is the single source of truth; all balances/reports derive from `acc_journal_line`.
- Pure accounting rules: `lib/domain/` (`posting.ts`, `money.ts`, `accounts.ts`, `reports.ts`, `reconciliation.ts`).
- Financial writes: `lib/services/*` → atomic Postgres RPC (`supabase/migrations/*`). No SQL in components.
- Input validation: Zod in `lib/domain/schemas.ts`. Server Actions in `app/(app)/*/actions.ts` guard by role.
- DO NOT re-implement a posting/money/tax rule anywhere else (Part 14).

## 4. Gotchas / past mistakes (append when a bug recurs)
- Postgres enums: you cannot `ALTER TYPE ... ADD VALUE` and then use the new value in the same transaction/migration. Add the value in one migration, use it in the next.
- Money is minor units end-to-end; only convert to decimal at the UI edge using the currency's `decimal_places`.
- US market: purchase-side tax is part of expense cost — no recoverable input tax, no separate tax line on bills/expenses.

## 5. Things NOT to do
- Never force-push to `main`.
- Never disable RLS "just to test".
- Never duplicate business logic in the frontend or in a "mock" path (Part 14).
- Never trust client-sent totals — recompute server-side.
- Never swallow an error (empty catch, ignoring `{ error }`).
```

- [ ] **Step 2: Verify build still parses config**

Run: `npm run typecheck`
Expected: PASS (no code changed; this confirms the working tree is clean before feature work).

- [ ] **Step 3: Commit**

```bash
git add ctyhp-accounting/CLAUDE.md
git commit -m "docs: bring CLAUDE.md up to Holy Grail Part 05 standard"
```

---

### Task 2: Posting builders + unit tests (TDD)

Pure functions that turn AP documents into balanced journal lines. This is the core business logic; it gets tests first.

**Files:**
- Modify: `ctyhp-accounting/lib/domain/posting.ts`
- Test: `ctyhp-accounting/tests/unit/payables-posting.test.ts` (create)

**Interfaces:**
- Consumes: `JournalLineInput`, `assertBalanced`, `reverse`, `Minor` (existing in `posting.ts` / `money.ts`).
- Produces:
  - `buildBillPosting(input: BillPostingInput): JournalLineInput[]`
  - `buildExpensePosting(input: ExpensePostingInput): JournalLineInput[]`
  - `buildBillPaymentPosting(input: BillPaymentPostingInput): JournalLineInput[]`
  - Types: `ExpenseAllocationLine { expenseAccountId: string; amountMinor: Minor }`, `BillPostingInput { apAccountId: string; lines: ExpenseAllocationLine[] }`, `ExpensePostingInput { paymentAccountId: string; lines: ExpenseAllocationLine[] }`, `BillPaymentPostingInput { apAccountId: string; paymentAccountId: string; amountMinor: Minor }`.

- [ ] **Step 1: Write the failing tests**

Create `ctyhp-accounting/tests/unit/payables-posting.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildBillPosting,
  buildExpensePosting,
  buildBillPaymentPosting,
  isBalanced,
  totalDebit,
  totalCredit,
  reverse,
} from "@/lib/domain/posting";

describe("buildBillPosting", () => {
  it("debits each expense account and credits AP for the total", () => {
    const lines = buildBillPosting({
      apAccountId: "ap",
      lines: [
        { expenseAccountId: "rent", amountMinor: 100_00 },
        { expenseAccountId: "utils", amountMinor: 40_00 },
      ],
    });
    expect(isBalanced(lines)).toBe(true);
    expect(totalDebit(lines)).toBe(140_00);
    const ap = lines.find((l) => l.accountId === "ap")!;
    expect(ap.creditMinor).toBe(140_00);
    expect(ap.debitMinor).toBe(0);
  });

  it("groups multiple lines that share one expense account", () => {
    const lines = buildBillPosting({
      apAccountId: "ap",
      lines: [
        { expenseAccountId: "rent", amountMinor: 100_00 },
        { expenseAccountId: "rent", amountMinor: 50_00 },
      ],
    });
    const rent = lines.filter((l) => l.accountId === "rent");
    expect(rent).toHaveLength(1);
    expect(rent[0].debitMinor).toBe(150_00);
  });

  it("throws when there are no positive lines", () => {
    expect(() => buildBillPosting({ apAccountId: "ap", lines: [] })).toThrow();
  });
});

describe("buildExpensePosting", () => {
  it("debits expense accounts and credits the payment account", () => {
    const lines = buildExpensePosting({
      paymentAccountId: "bank",
      lines: [{ expenseAccountId: "meals", amountMinor: 25_00 }],
    });
    expect(isBalanced(lines)).toBe(true);
    const bank = lines.find((l) => l.accountId === "bank")!;
    expect(bank.creditMinor).toBe(25_00);
  });
});

describe("buildBillPaymentPosting", () => {
  it("debits AP and credits the payment account", () => {
    const lines = buildBillPaymentPosting({
      apAccountId: "ap",
      paymentAccountId: "bank",
      amountMinor: 140_00,
    });
    expect(isBalanced(lines)).toBe(true);
    const ap = lines.find((l) => l.accountId === "ap")!;
    expect(ap.debitMinor).toBe(140_00);
    const bank = lines.find((l) => l.accountId === "bank")!;
    expect(bank.creditMinor).toBe(140_00);
  });
});

describe("reverse of AP postings stays balanced", () => {
  it("reverses a bill posting", () => {
    const lines = buildBillPosting({
      apAccountId: "ap",
      lines: [{ expenseAccountId: "rent", amountMinor: 100_00 }],
    });
    const rev = reverse(lines);
    expect(isBalanced(rev)).toBe(true);
    expect(totalDebit(rev)).toBe(totalCredit(lines));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- payables-posting`
Expected: FAIL — `buildBillPosting is not a function` (not yet exported).

- [ ] **Step 3: Implement the builders**

Append to `ctyhp-accounting/lib/domain/posting.ts`:

```typescript
export interface ExpenseAllocationLine {
  expenseAccountId: string;
  amountMinor: Minor;
}

function groupExpenseLines(lines: ExpenseAllocationLine[]): Map<string, Minor> {
  const byAccount = new Map<string, Minor>();
  for (const l of lines) {
    byAccount.set(l.expenseAccountId, (byAccount.get(l.expenseAccountId) ?? 0) + l.amountMinor);
  }
  return byAccount;
}

export interface BillPostingInput {
  apAccountId: string;
  lines: ExpenseAllocationLine[];
}

/**
 * Bill posted (open):
 *   DR Expense (grouped per account) = each line amount (tax-inclusive, US model)
 *   CR Accounts Payable             = total
 */
export function buildBillPosting(input: BillPostingInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  let total: Minor = 0;
  for (const [accountId, amount] of groupExpenseLines(input.lines)) {
    if (amount !== 0) {
      lines.push({ accountId, debitMinor: amount, creditMinor: 0, memo: "Expense" });
      total += amount;
    }
  }
  lines.push({ accountId: input.apAccountId, debitMinor: 0, creditMinor: total, memo: "Accounts payable" });
  assertBalanced(lines);
  return lines;
}

export interface ExpensePostingInput {
  paymentAccountId: string;
  lines: ExpenseAllocationLine[];
}

/**
 * Expense (paid immediately):
 *   DR Expense (grouped per account)
 *   CR Bank / Credit Card = total
 */
export function buildExpensePosting(input: ExpensePostingInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  let total: Minor = 0;
  for (const [accountId, amount] of groupExpenseLines(input.lines)) {
    if (amount !== 0) {
      lines.push({ accountId, debitMinor: amount, creditMinor: 0, memo: "Expense" });
      total += amount;
    }
  }
  lines.push({ accountId: input.paymentAccountId, debitMinor: 0, creditMinor: total, memo: "Payment" });
  assertBalanced(lines);
  return lines;
}

export interface BillPaymentPostingInput {
  apAccountId: string;
  paymentAccountId: string;
  amountMinor: Minor;
}

/**
 * Bill payment:
 *   DR Accounts Payable   = amount
 *   CR Bank / Credit Card = amount
 */
export function buildBillPaymentPosting(input: BillPaymentPostingInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountId: input.apAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Pay accounts payable" },
    { accountId: input.paymentAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Bank/credit payment" },
  ];
  assertBalanced(lines);
  return lines;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- payables-posting`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/posting.ts tests/unit/payables-posting.test.ts
git commit -m "feat: AP posting builders (bill, expense, bill payment) with tests"
```

---

### Task 3: Migration `0011_payables.sql` — schema, sequences, RLS

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0011_payables.sql`

**Interfaces:**
- Produces tables `acc_vendor`, `acc_bill`, `acc_bill_line`, `acc_expense`, `acc_expense_line`, `acc_bill_payment`, `acc_bill_payment_allocation`; enum values `bill`, `expense`, `bill_payment` on `acc_journal_source`; sequence keys `bill`, `expense`, `bill_payment`.
- Consumes existing helpers `acc_current_role()`, `acc_is_staff()`, and enums from migration 0001.

- [ ] **Step 1: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0011_payables.sql`:

```sql
-- ============================================================================
-- Module 3b — Payables: vendors, bills (+lines), expenses (+lines),
-- bill payments (+allocations). Buy-side mirror of Module 2 (invoicing).
-- US tax model: line amounts are tax-inclusive; no separate purchase-tax line.
-- Enum values added here; the posting functions in 0012 use them (a new enum
-- value cannot be used in the same transaction that adds it).
-- ============================================================================

alter type acc_journal_source add value if not exists 'bill';
alter type acc_journal_source add value if not exists 'expense';
alter type acc_journal_source add value if not exists 'bill_payment';

create type acc_bill_status         as enum ('draft', 'open', 'partial', 'paid', 'void');
create type acc_expense_status      as enum ('posted', 'void');
create type acc_bill_payment_status as enum ('unapplied', 'partial', 'applied', 'void');

-- ----------------------------------------------------------------------------
-- Vendors (mirror of acc_customer)
-- ----------------------------------------------------------------------------
create table acc_vendor (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  email                      text,
  phone                      text,
  currency_code              text references acc_currency (code),
  ap_account_id              uuid references acc_account (id),
  default_expense_account_id uuid references acc_account (id),
  payment_terms              text,
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Bills
-- ----------------------------------------------------------------------------
create table acc_bill (
  id                uuid primary key default gen_random_uuid(),
  bill_number       text unique,                 -- assigned on post
  vendor_ref        text,                        -- vendor's own invoice number
  vendor_id         uuid not null references acc_vendor (id),
  bill_date         date not null default current_date,
  due_date          date,
  currency_code     text not null references acc_currency (code),
  total_minor       bigint not null default 0,
  balance_due_minor bigint not null default 0,
  status            acc_bill_status not null default 'draft',
  journal_entry_id  uuid references acc_journal_entry (id),
  memo              text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index acc_bill_vendor_idx on acc_bill (vendor_id);
create index acc_bill_status_idx on acc_bill (status);

create table acc_bill_line (
  id                 uuid primary key default gen_random_uuid(),
  bill_id            uuid not null references acc_bill (id) on delete cascade,
  line_order         int not null default 0,
  description        text not null default '',
  expense_account_id uuid not null references acc_account (id),
  amount_minor       bigint not null default 0
);
create index acc_bill_line_bill_idx on acc_bill_line (bill_id);

-- ----------------------------------------------------------------------------
-- Expenses (paid immediately)
-- ----------------------------------------------------------------------------
create table acc_expense (
  id                 uuid primary key default gen_random_uuid(),
  expense_number     text unique,
  vendor_id          uuid references acc_vendor (id),
  payment_account_id uuid not null references acc_account (id),
  expense_date       date not null default current_date,
  currency_code      text not null references acc_currency (code),
  total_minor        bigint not null default 0,
  status             acc_expense_status not null default 'posted',
  journal_entry_id   uuid references acc_journal_entry (id),
  memo               text,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index acc_expense_vendor_idx on acc_expense (vendor_id);

create table acc_expense_line (
  id                 uuid primary key default gen_random_uuid(),
  expense_id         uuid not null references acc_expense (id) on delete cascade,
  line_order         int not null default 0,
  description        text not null default '',
  expense_account_id uuid not null references acc_account (id),
  amount_minor       bigint not null default 0
);
create index acc_expense_line_expense_idx on acc_expense_line (expense_id);

-- ----------------------------------------------------------------------------
-- Bill payments and allocations
-- ----------------------------------------------------------------------------
create table acc_bill_payment (
  id                 uuid primary key default gen_random_uuid(),
  payment_number     text unique,
  vendor_id          uuid not null references acc_vendor (id),
  payment_date       date not null default current_date,
  currency_code      text not null references acc_currency (code),
  amount_minor       bigint not null check (amount_minor > 0),
  unapplied_minor    bigint not null default 0,
  payment_account_id uuid not null references acc_account (id),
  method             text,
  status             acc_bill_payment_status not null default 'unapplied',
  journal_entry_id   uuid references acc_journal_entry (id),
  memo               text,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index acc_bill_payment_vendor_idx on acc_bill_payment (vendor_id);

create table acc_bill_payment_allocation (
  id              uuid primary key default gen_random_uuid(),
  bill_payment_id uuid not null references acc_bill_payment (id) on delete cascade,
  bill_id         uuid not null references acc_bill (id),
  amount_minor    bigint not null check (amount_minor > 0),
  created_at      timestamptz not null default now(),
  unique (bill_payment_id, bill_id)
);
create index acc_bill_payment_alloc_bill_idx on acc_bill_payment_allocation (bill_id);

-- ----------------------------------------------------------------------------
-- Sequences
-- ----------------------------------------------------------------------------
insert into acc_sequence (key, prefix, next_value) values
  ('bill',         'BILL-', 1),
  ('expense',      'EXP-',  1),
  ('bill_payment', 'BP-',   1);

-- ----------------------------------------------------------------------------
-- RLS: read for any role, writes for staff (mutations go through SECURITY
-- DEFINER posting functions in 0012).
-- ----------------------------------------------------------------------------
alter table acc_vendor                  enable row level security;
alter table acc_bill                    enable row level security;
alter table acc_bill_line               enable row level security;
alter table acc_expense                 enable row level security;
alter table acc_expense_line            enable row level security;
alter table acc_bill_payment            enable row level security;
alter table acc_bill_payment_allocation enable row level security;

create policy acc_vendor_read  on acc_vendor  for select using (acc_current_role() is not null);
create policy acc_vendor_write on acc_vendor  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_bill_read  on acc_bill  for select using (acc_current_role() is not null);
create policy acc_bill_write on acc_bill  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_bill_line_read  on acc_bill_line  for select using (acc_current_role() is not null);
create policy acc_bill_line_write on acc_bill_line  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_expense_read  on acc_expense  for select using (acc_current_role() is not null);
create policy acc_expense_write on acc_expense  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_expense_line_read  on acc_expense_line  for select using (acc_current_role() is not null);
create policy acc_expense_line_write on acc_expense_line  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_bill_payment_read  on acc_bill_payment  for select using (acc_current_role() is not null);
create policy acc_bill_payment_write on acc_bill_payment  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_bp_alloc_read  on acc_bill_payment_allocation for select using (acc_current_role() is not null);
create policy acc_bp_alloc_write on acc_bill_payment_allocation for all using (acc_is_staff()) with check (acc_is_staff());
```

- [ ] **Step 2: Apply the migration to the dev database**

Run: `npx supabase db push` (or the project's migration apply command; if using a local DB, `npx supabase migration up`).
Expected: migration `0011_payables` applies with no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_payables.sql
git commit -m "feat: payables schema (vendors, bills, expenses, bill payments) + RLS"
```

---

### Task 4: Migration `0012_payables_functions.sql` — atomic RPCs

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0012_payables_functions.sql`

**Interfaces:**
- Consumes: `acc_to_base_minor`, `acc_next_number`, `acc_post_entry`, `acc_is_staff` (existing).
- Produces RPCs: `acc_active_ap_account()`, `acc_post_bill(uuid)`, `acc_void_bill(uuid)`, `acc_record_expense(...)`, `acc_void_expense(uuid)`, `acc_pay_bills(...)`, `acc_void_bill_payment(uuid)`.

- [ ] **Step 1: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0012_payables_functions.sql`:

```sql
-- ============================================================================
-- Module 3b posting functions (atomic: document state + ledger commit together).
--   acc_post_bill        — draft -> open, posts DR expense / CR AP
--   acc_record_expense   — posts DR expense / CR bank|credit card
--   acc_pay_bills        — posts DR AP / CR bank|credit card, allocates to bills
--   acc_void_*           — reverse the entry (only if safe)
-- All SECURITY DEFINER and gated by acc_is_staff(). Amounts recomputed server-side.
-- ============================================================================

create or replace function acc_active_ap_account() returns uuid
language sql stable as $$
  select id from acc_account
   where account_type = 'accounts_payable' and is_posting_account and status = 'active'
   order by account_code limit 1;
$$;

-- ----------------------------------------------------------------------------
-- Post a bill: DR expense (grouped) / CR Accounts Payable (total).
-- ----------------------------------------------------------------------------
create or replace function acc_post_bill(p_bill_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_bill   acc_bill;
  v_ap     uuid;
  v_total  bigint;
  v_number text;
  v_lines  jsonb := '[]'::jsonb;
  v_entry  uuid;
  rec      record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post bills'; end if;

  select * into v_bill from acc_bill where id = p_bill_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if v_bill.status <> 'draft' then raise exception 'Only draft bills can be posted'; end if;

  -- Recompute the total from lines; never trust a stored/client value.
  select coalesce(sum(amount_minor), 0) into v_total from acc_bill_line where bill_id = p_bill_id;
  if v_total <= 0 then raise exception 'Bill total must be positive'; end if;

  v_ap := coalesce((select ap_account_id from acc_vendor where id = v_bill.vendor_id), acc_active_ap_account());
  if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;

  for rec in
    select expense_account_id as acc, sum(amount_minor) as amt
      from acc_bill_line where bill_id = p_bill_id
      group by expense_account_id having sum(amount_minor) <> 0
  loop
    v_lines := v_lines || jsonb_build_object(
      'account_id', rec.acc, 'debit_minor', rec.amt, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(rec.amt, v_bill.currency_code, v_bill.bill_date),
      'memo', 'Expense');
  end loop;

  v_lines := v_lines || jsonb_build_object(
    'account_id', v_ap, 'debit_minor', 0, 'credit_minor', v_total,
    'amount_base_minor', acc_to_base_minor(v_total, v_bill.currency_code, v_bill.bill_date),
    'memo', 'Accounts payable');

  v_number := acc_next_number('bill');
  v_entry := acc_post_entry(v_bill.bill_date, 'Bill ' || v_number, 'bill',
                            p_bill_id, v_bill.currency_code, v_lines);

  update acc_bill
     set bill_number = v_number, status = 'open', total_minor = v_total,
         balance_due_minor = v_total, journal_entry_id = v_entry, updated_at = now()
   where id = p_bill_id;

  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
-- Void a bill (only if unpaid). Draft bills are simply marked void.
-- ----------------------------------------------------------------------------
create or replace function acc_void_bill(p_bill_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bill  acc_bill;
  v_lines jsonb := '[]'::jsonb;
  rec     record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void bills'; end if;

  select * into v_bill from acc_bill where id = p_bill_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if v_bill.status = 'void' then raise exception 'Bill is already void'; end if;
  if v_bill.status = 'draft' then
    update acc_bill set status = 'void', updated_at = now() where id = p_bill_id;
    return;
  end if;
  if v_bill.balance_due_minor <> v_bill.total_minor then
    raise exception 'Cannot void a bill with payments applied; remove payments first';
  end if;

  if v_bill.journal_entry_id is not null then
    for rec in
      select account_id, debit_minor, credit_minor, amount_base_minor
        from acc_journal_line where journal_entry_id = v_bill.journal_entry_id
    loop
      v_lines := v_lines || jsonb_build_object(
        'account_id', rec.account_id, 'debit_minor', rec.credit_minor,
        'credit_minor', rec.debit_minor, 'amount_base_minor', rec.amount_base_minor,
        'memo', 'Void bill ' || coalesce(v_bill.bill_number, ''));
    end loop;
    perform acc_post_entry(current_date, 'Void bill ' || coalesce(v_bill.bill_number, ''),
                           'bill', p_bill_id, v_bill.currency_code, v_lines);
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_bill.journal_entry_id;
  end if;

  update acc_bill set status = 'void', balance_due_minor = 0, updated_at = now()
   where id = p_bill_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Record an immediate expense: DR expense (grouped) / CR payment account.
-- p_lines: [{ "expense_account_id": uuid, "amount_minor": bigint, "description": text }]
-- ----------------------------------------------------------------------------
create or replace function acc_record_expense(
  p_vendor_id          uuid,
  p_payment_account_id uuid,
  p_expense_date       date,
  p_currency           text,
  p_memo               text,
  p_lines              jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_total  bigint := 0;
  v_number text;
  v_entry  uuid;
  v_exp    uuid;
  v_jlines jsonb := '[]'::jsonb;
  rec      record;
  v_order  int := 0;
  v_line   jsonb;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record expenses'; end if;

  select coalesce(sum((l->>'amount_minor')::bigint), 0) into v_total
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;
  if v_total <= 0 then raise exception 'Expense total must be positive'; end if;

  for rec in
    select (l->>'expense_account_id')::uuid as acc, sum((l->>'amount_minor')::bigint) as amt
      from jsonb_array_elements(p_lines) l
      group by (l->>'expense_account_id')::uuid having sum((l->>'amount_minor')::bigint) <> 0
  loop
    v_jlines := v_jlines || jsonb_build_object(
      'account_id', rec.acc, 'debit_minor', rec.amt, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(rec.amt, p_currency, p_expense_date), 'memo', 'Expense');
  end loop;
  v_jlines := v_jlines || jsonb_build_object(
    'account_id', p_payment_account_id, 'debit_minor', 0, 'credit_minor', v_total,
    'amount_base_minor', acc_to_base_minor(v_total, p_currency, p_expense_date), 'memo', 'Payment');

  v_number := acc_next_number('expense');
  v_entry := acc_post_entry(p_expense_date, 'Expense ' || v_number, 'expense', null, p_currency, v_jlines);

  insert into acc_expense(expense_number, vendor_id, payment_account_id, expense_date,
      currency_code, total_minor, status, journal_entry_id, memo, created_by)
    values (v_number, p_vendor_id, p_payment_account_id, p_expense_date, p_currency,
      v_total, 'posted', v_entry, p_memo, auth.uid())
    returning id into v_exp;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into acc_expense_line(expense_id, line_order, description, expense_account_id, amount_minor)
      values (v_exp, v_order, coalesce(v_line->>'description', ''),
              (v_line->>'expense_account_id')::uuid, (v_line->>'amount_minor')::bigint);
    v_order := v_order + 1;
  end loop;

  return v_exp;
end;
$$;

-- ----------------------------------------------------------------------------
-- Void an expense: reverse its entry.
-- ----------------------------------------------------------------------------
create or replace function acc_void_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_exp   acc_expense;
  v_lines jsonb := '[]'::jsonb;
  rec     record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void expenses'; end if;

  select * into v_exp from acc_expense where id = p_expense_id for update;
  if not found then raise exception 'Expense not found'; end if;
  if v_exp.status = 'void' then raise exception 'Expense is already void'; end if;

  if v_exp.journal_entry_id is not null then
    for rec in
      select account_id, debit_minor, credit_minor, amount_base_minor
        from acc_journal_line where journal_entry_id = v_exp.journal_entry_id
    loop
      v_lines := v_lines || jsonb_build_object(
        'account_id', rec.account_id, 'debit_minor', rec.credit_minor,
        'credit_minor', rec.debit_minor, 'amount_base_minor', rec.amount_base_minor,
        'memo', 'Void expense ' || coalesce(v_exp.expense_number, ''));
    end loop;
    perform acc_post_entry(current_date, 'Void expense ' || coalesce(v_exp.expense_number, ''),
                           'expense', p_expense_id, v_exp.currency_code, v_lines);
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_exp.journal_entry_id;
  end if;

  update acc_expense set status = 'void', updated_at = now() where id = p_expense_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Pay bills: DR Accounts Payable / CR payment account; allocate to bills.
-- p_allocations: [{ "bill_id": uuid, "amount_minor": bigint }]
-- ----------------------------------------------------------------------------
create or replace function acc_pay_bills(
  p_vendor_id          uuid,
  p_payment_date       date,
  p_currency           text,
  p_amount_minor       bigint,
  p_payment_account_id uuid,
  p_method             text,
  p_memo               text,
  p_allocations        jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ap          uuid;
  v_number      text;
  v_entry       uuid;
  v_payment     uuid;
  v_alloc_total bigint := 0;
  v_base        bigint;
  rec           record;
  v_bill        acc_bill;
begin
  if not acc_is_staff() then raise exception 'Not authorized to pay bills'; end if;
  if p_amount_minor <= 0 then raise exception 'Payment amount must be positive'; end if;

  select coalesce(sum((a->>'amount_minor')::bigint), 0) into v_alloc_total
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a;
  if v_alloc_total > p_amount_minor then
    raise exception 'Allocations (%) exceed payment amount (%)', v_alloc_total, p_amount_minor;
  end if;

  v_ap := coalesce((select ap_account_id from acc_vendor where id = p_vendor_id), acc_active_ap_account());
  if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;

  v_base := acc_to_base_minor(p_amount_minor, p_currency, p_payment_date);
  v_number := acc_next_number('bill_payment');
  v_entry := acc_post_entry(
    p_payment_date, 'Bill payment ' || v_number, 'bill_payment', null, p_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ap, 'debit_minor', p_amount_minor, 'credit_minor', 0,
        'amount_base_minor', v_base, 'memo', 'Pay accounts payable'),
      jsonb_build_object('account_id', p_payment_account_id, 'debit_minor', 0, 'credit_minor', p_amount_minor,
        'amount_base_minor', v_base, 'memo', 'Bank/credit payment')
    ));

  insert into acc_bill_payment(payment_number, vendor_id, payment_date, currency_code, amount_minor,
      unapplied_minor, payment_account_id, method, status, journal_entry_id, memo, created_by)
    values (v_number, p_vendor_id, p_payment_date, p_currency, p_amount_minor,
      p_amount_minor - v_alloc_total, p_payment_account_id, p_method,
      case when v_alloc_total = 0 then 'unapplied'
           when v_alloc_total = p_amount_minor then 'applied'
           else 'partial' end,
      v_entry, p_memo, auth.uid())
    returning id into v_payment;

  for rec in
    select (a->>'bill_id')::uuid as bill_id, (a->>'amount_minor')::bigint as amt
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
  loop
    if rec.amt is null or rec.amt <= 0 then continue; end if;
    select * into v_bill from acc_bill where id = rec.bill_id for update;
    if not found then raise exception 'Bill not found: %', rec.bill_id; end if;
    if rec.amt > v_bill.balance_due_minor then
      raise exception 'Allocation % exceeds bill balance %', rec.amt, v_bill.balance_due_minor;
    end if;
    insert into acc_bill_payment_allocation(bill_payment_id, bill_id, amount_minor)
      values (v_payment, rec.bill_id, rec.amt);
    update acc_bill
       set balance_due_minor = balance_due_minor - rec.amt,
           status = case when balance_due_minor - rec.amt = 0 then 'paid' else 'partial' end,
           updated_at = now()
     where id = rec.bill_id;
  end loop;

  return v_payment;
end;
$$;

-- ----------------------------------------------------------------------------
-- Void a bill payment: reverse the entry and restore bill balances.
-- ----------------------------------------------------------------------------
create or replace function acc_void_bill_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay   acc_bill_payment;
  v_lines jsonb := '[]'::jsonb;
  rec     record;
  arec    record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void bill payments'; end if;

  select * into v_pay from acc_bill_payment where id = p_payment_id for update;
  if not found then raise exception 'Bill payment not found'; end if;
  if v_pay.status = 'void' then raise exception 'Bill payment is already void'; end if;

  -- Restore each allocated bill's balance/status.
  for arec in select bill_id, amount_minor from acc_bill_payment_allocation where bill_payment_id = p_payment_id
  loop
    update acc_bill
       set balance_due_minor = balance_due_minor + arec.amount_minor,
           status = case when balance_due_minor + arec.amount_minor >= total_minor then 'open' else 'partial' end,
           updated_at = now()
     where id = arec.bill_id and status <> 'void';
  end loop;

  if v_pay.journal_entry_id is not null then
    for rec in
      select account_id, debit_minor, credit_minor, amount_base_minor
        from acc_journal_line where journal_entry_id = v_pay.journal_entry_id
    loop
      v_lines := v_lines || jsonb_build_object(
        'account_id', rec.account_id, 'debit_minor', rec.credit_minor,
        'credit_minor', rec.debit_minor, 'amount_base_minor', rec.amount_base_minor,
        'memo', 'Void bill payment ' || coalesce(v_pay.payment_number, ''));
    end loop;
    perform acc_post_entry(current_date, 'Void bill payment ' || coalesce(v_pay.payment_number, ''),
                           'bill_payment', p_payment_id, v_pay.currency_code, v_lines);
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_pay.journal_entry_id;
  end if;

  update acc_bill_payment set status = 'void', unapplied_minor = 0, updated_at = now()
   where id = p_payment_id;
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or the project's apply command).
Expected: migration `0012_payables_functions` applies with no error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0012_payables_functions.sql
git commit -m "feat: atomic RPCs for posting bills, expenses, and bill payments"
```

---

### Task 5: Row types + Zod schemas

**Files:**
- Modify: `ctyhp-accounting/lib/db/types.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`

**Interfaces:**
- Produces types: `VendorRow`, `BillStatus`, `BillRow`, `BillLineRow`, `ExpenseStatus`, `ExpenseRow`, `ExpenseLineRow`, `BillPaymentStatus`, `BillPaymentRow`.
- Produces schemas: `vendorCreateSchema`/`VendorCreateInput`, `billLineInputSchema`, `billCreateSchema`/`BillCreateInput`, `expenseLineInputSchema`, `expenseCreateSchema`/`ExpenseCreateInput`, `billPaymentAllocationSchema`, `billPaymentCreateSchema`/`BillPaymentCreateInput`.

- [ ] **Step 1: Add row types**

Append to `ctyhp-accounting/lib/db/types.ts`:

```typescript
// --- Payables (Module 3b) ---
export interface VendorRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  currency_code: string | null;
  ap_account_id: string | null;
  default_expense_account_id: string | null;
  payment_terms: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type BillStatus = "draft" | "open" | "partial" | "paid" | "void";

export interface BillRow {
  id: string;
  bill_number: string | null;
  vendor_ref: string | null;
  vendor_id: string;
  bill_date: string;
  due_date: string | null;
  currency_code: string;
  total_minor: number;
  balance_due_minor: number;
  status: BillStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillLineRow {
  id: string;
  bill_id: string;
  line_order: number;
  description: string;
  expense_account_id: string;
  amount_minor: number;
}

export type ExpenseStatus = "posted" | "void";

export interface ExpenseRow {
  id: string;
  expense_number: string | null;
  vendor_id: string | null;
  payment_account_id: string;
  expense_date: string;
  currency_code: string;
  total_minor: number;
  status: ExpenseStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseLineRow {
  id: string;
  expense_id: string;
  line_order: number;
  description: string;
  expense_account_id: string;
  amount_minor: number;
}

export type BillPaymentStatus = "unapplied" | "partial" | "applied" | "void";

export interface BillPaymentRow {
  id: string;
  payment_number: string | null;
  vendor_id: string;
  payment_date: string;
  currency_code: string;
  amount_minor: number;
  unapplied_minor: number;
  payment_account_id: string;
  method: string | null;
  status: BillPaymentStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Add Zod schemas**

Append to `ctyhp-accounting/lib/domain/schemas.ts`:

```typescript
// --- Vendors ---
export const vendorCreateSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(160),
  email: z.email("Enter a valid email").optional().or(z.literal("")).nullable(),
  phone: z.string().trim().max(40).optional().or(z.literal("")).nullable(),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code").optional().nullable(),
  ap_account_id: z.uuid().optional().nullable(),
  default_expense_account_id: z.uuid().optional().nullable(),
  payment_terms: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
});
export type VendorCreateInput = z.infer<typeof vendorCreateSchema>;

// --- Bills ---
export const billLineInputSchema = z.object({
  description: z.string().trim().max(300).default(""),
  expense_account_id: z.uuid("Select an expense account"),
  amount_minor: z.number().int("Amount must be a whole minor-unit amount").positive("Amount must be greater than 0"),
});
export type BillLineInputT = z.infer<typeof billLineInputSchema>;

export const billCreateSchema = z.object({
  vendor_id: z.uuid("Select a vendor"),
  vendor_ref: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
  bill_date: z.string().optional(),
  due_date: z.string().optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(billLineInputSchema).min(1, "Add at least one line item"),
});
export type BillCreateInput = z.infer<typeof billCreateSchema>;

// --- Expenses ---
export const expenseLineInputSchema = z.object({
  description: z.string().trim().max(300).default(""),
  expense_account_id: z.uuid("Select an expense account"),
  amount_minor: z.number().int("Amount must be a whole minor-unit amount").positive("Amount must be greater than 0"),
});
export type ExpenseLineInputT = z.infer<typeof expenseLineInputSchema>;

export const expenseCreateSchema = z.object({
  vendor_id: z.uuid().optional().nullable(),
  payment_account_id: z.uuid("Select a payment account"),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
  expense_date: z.string().optional(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(expenseLineInputSchema).min(1, "Add at least one line item"),
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

// --- Bill payments ---
export const billPaymentAllocationSchema = z.object({
  bill_id: z.uuid(),
  amount_minor: z.number().int().positive(),
});

export const billPaymentCreateSchema = z.object({
  vendor_id: z.uuid("Select a vendor"),
  payment_date: z.string().optional(),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  amount_minor: z.number().int().positive("Amount must be greater than 0"),
  payment_account_id: z.uuid("Select a payment account"),
  method: z.string().trim().max(60).optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(billPaymentAllocationSchema).default([]),
});
export type BillPaymentCreateInput = z.infer<typeof billPaymentCreateSchema>;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/db/types.ts lib/domain/schemas.ts
git commit -m "feat: payables row types and Zod input schemas"
```

---

### Task 6: Service layer `payables.ts`

**Files:**
- Create: `ctyhp-accounting/lib/services/payables.ts`

**Interfaces:**
- Consumes: schemas + types from Task 5; `writeAudit`; the RPCs from Task 4; `computeInvoiceLine` is NOT needed (amounts are already minor units on lines).
- Produces functions used by the actions in Tasks 7–10:
  - Vendors: `listVendors(sb)`, `createVendor(sb, input)`
  - Bills: `listBills(sb)` → `BillWithVendor[]`, `getBillLines(sb, id)`, `createDraftBill(sb, input)`, `postBill(sb, id)`, `voidBill(sb, id)`
  - Expenses: `listExpenses(sb)` → `ExpenseWithVendor[]`, `getExpenseLines(sb, id)`, `recordExpense(sb, input)`, `voidExpense(sb, id)`
  - Bill payments: `listBillPayments(sb)` → `(BillPaymentRow & { vendor_name })[]`, `listOpenBillsForVendor(sb, vendorId)`, `payBills(sb, input)`, `voidBillPayment(sb, id)`

- [ ] **Step 1: Write the service module**

Create `ctyhp-accounting/lib/services/payables.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  VendorRow,
  BillRow,
  BillLineRow,
  ExpenseRow,
  ExpenseLineRow,
  BillPaymentRow,
} from "@/lib/db/types";
import type {
  VendorCreateInput,
  BillCreateInput,
  ExpenseCreateInput,
  BillPaymentCreateInput,
} from "@/lib/domain/schemas";
import { writeAudit } from "./audit";

export class PayablesError extends Error {}

// --- Vendors ---
export async function listVendors(sb: SupabaseClient): Promise<VendorRow[]> {
  const { data, error } = await sb
    .from("acc_vendor")
    .select(
      "id,name,email,phone,currency_code,ap_account_id,default_expense_account_id," +
        "payment_terms,is_active,created_at,updated_at",
    )
    .order("name");
  if (error) throw new PayablesError(error.message);
  return (data ?? []) as unknown as VendorRow[];
}

export async function createVendor(sb: SupabaseClient, input: VendorCreateInput): Promise<VendorRow> {
  const { data, error } = await sb
    .from("acc_vendor")
    .insert({
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      currency_code: input.currency_code || null,
      ap_account_id: input.ap_account_id || null,
      default_expense_account_id: input.default_expense_account_id || null,
      payment_terms: input.payment_terms || null,
    })
    .select(
      "id,name,email,phone,currency_code,ap_account_id,default_expense_account_id," +
        "payment_terms,is_active,created_at,updated_at",
    )
    .single();
  if (error) throw new PayablesError(error.message);
  const row = data as unknown as VendorRow;
  await writeAudit(sb, { table_name: "acc_vendor", record_id: row.id, action: "insert", after: row });
  return row;
}

// --- Bills ---
export interface BillWithVendor extends BillRow {
  vendor_name: string;
}

export async function listBills(sb: SupabaseClient): Promise<BillWithVendor[]> {
  const { data, error } = await sb
    .from("acc_bill")
    .select(
      "id,bill_number,vendor_ref,vendor_id,bill_date,due_date,currency_code,total_minor," +
        "balance_due_minor,status,journal_entry_id,memo,created_at,updated_at,acc_vendor(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new PayablesError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as BillRow),
    vendor_name: (r.acc_vendor as { name?: string } | null)?.name ?? "—",
  }));
}

export async function getBillLines(sb: SupabaseClient, billId: string): Promise<BillLineRow[]> {
  const { data, error } = await sb
    .from("acc_bill_line")
    .select("*")
    .eq("bill_id", billId)
    .order("line_order");
  if (error) throw new PayablesError(error.message);
  return (data ?? []) as unknown as BillLineRow[];
}

/** Create a draft bill. Line amounts are already minor units and tax-inclusive. */
export async function createDraftBill(sb: SupabaseClient, input: BillCreateInput): Promise<BillRow> {
  const total = input.lines.reduce((s, l) => s + l.amount_minor, 0);

  const { data: bill, error: e1 } = await sb
    .from("acc_bill")
    .insert({
      vendor_id: input.vendor_id,
      vendor_ref: input.vendor_ref || null,
      currency_code: input.currency_code,
      bill_date: input.bill_date || undefined,
      due_date: input.due_date || null,
      memo: input.memo || null,
      total_minor: total,
      balance_due_minor: total,
    })
    .select("*")
    .single();
  if (e1) throw new PayablesError(e1.message);
  const row = bill as unknown as BillRow;

  const { error: e2 } = await sb.from("acc_bill_line").insert(
    input.lines.map((l, i) => ({
      bill_id: row.id,
      line_order: i,
      description: l.description,
      expense_account_id: l.expense_account_id,
      amount_minor: l.amount_minor,
    })),
  );
  if (e2) {
    await sb.from("acc_bill").delete().eq("id", row.id);
    throw new PayablesError(e2.message);
  }

  await writeAudit(sb, { table_name: "acc_bill", record_id: row.id, action: "insert", after: row });
  return row;
}

export async function postBill(sb: SupabaseClient, billId: string): Promise<void> {
  const { error } = await sb.rpc("acc_post_bill", { p_bill_id: billId });
  if (error) throw new PayablesError(error.message);
  await writeAudit(sb, { table_name: "acc_bill", record_id: billId, action: "post" });
}

export async function voidBill(sb: SupabaseClient, billId: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_bill", { p_bill_id: billId });
  if (error) throw new PayablesError(error.message);
  await writeAudit(sb, { table_name: "acc_bill", record_id: billId, action: "void" });
}

// --- Expenses ---
export interface ExpenseWithVendor extends ExpenseRow {
  vendor_name: string;
}

export async function listExpenses(sb: SupabaseClient): Promise<ExpenseWithVendor[]> {
  const { data, error } = await sb
    .from("acc_expense")
    .select(
      "id,expense_number,vendor_id,payment_account_id,expense_date,currency_code,total_minor," +
        "status,journal_entry_id,memo,created_at,updated_at,acc_vendor(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new PayablesError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as ExpenseRow),
    vendor_name: (r.acc_vendor as { name?: string } | null)?.name ?? "—",
  }));
}

export async function getExpenseLines(sb: SupabaseClient, expenseId: string): Promise<ExpenseLineRow[]> {
  const { data, error } = await sb
    .from("acc_expense_line")
    .select("*")
    .eq("expense_id", expenseId)
    .order("line_order");
  if (error) throw new PayablesError(error.message);
  return (data ?? []) as unknown as ExpenseLineRow[];
}

export async function recordExpense(sb: SupabaseClient, input: ExpenseCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_expense", {
    p_vendor_id: input.vendor_id || null,
    p_payment_account_id: input.payment_account_id,
    p_expense_date: input.expense_date || undefined,
    p_currency: input.currency_code,
    p_memo: input.memo || null,
    p_lines: input.lines,
  });
  if (error) throw new PayablesError(error.message);
  await writeAudit(sb, { table_name: "acc_expense", record_id: (data as string) ?? null, action: "post" });
  return data as string;
}

export async function voidExpense(sb: SupabaseClient, expenseId: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_expense", { p_expense_id: expenseId });
  if (error) throw new PayablesError(error.message);
  await writeAudit(sb, { table_name: "acc_expense", record_id: expenseId, action: "void" });
}

// --- Bill payments ---
export async function listBillPayments(
  sb: SupabaseClient,
): Promise<(BillPaymentRow & { vendor_name: string })[]> {
  const { data, error } = await sb
    .from("acc_bill_payment")
    .select(
      "id,payment_number,vendor_id,payment_date,currency_code,amount_minor,unapplied_minor," +
        "payment_account_id,method,status,journal_entry_id,memo,created_at,updated_at,acc_vendor(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new PayablesError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as BillPaymentRow),
    vendor_name: (r.acc_vendor as { name?: string } | null)?.name ?? "—",
  }));
}

export async function listOpenBillsForVendor(sb: SupabaseClient, vendorId: string): Promise<BillRow[]> {
  const { data, error } = await sb
    .from("acc_bill")
    .select("*")
    .eq("vendor_id", vendorId)
    .in("status", ["open", "partial"])
    .gt("balance_due_minor", 0)
    .order("bill_date");
  if (error) throw new PayablesError(error.message);
  return (data ?? []) as unknown as BillRow[];
}

export async function payBills(sb: SupabaseClient, input: BillPaymentCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_pay_bills", {
    p_vendor_id: input.vendor_id,
    p_payment_date: input.payment_date || undefined,
    p_currency: input.currency_code,
    p_amount_minor: input.amount_minor,
    p_payment_account_id: input.payment_account_id,
    p_method: input.method || null,
    p_memo: input.memo || null,
    p_allocations: input.allocations,
  });
  if (error) throw new PayablesError(error.message);
  await writeAudit(sb, { table_name: "acc_bill_payment", record_id: (data as string) ?? null, action: "post" });
  return data as string;
}

export async function voidBillPayment(sb: SupabaseClient, paymentId: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_bill_payment", { p_payment_id: paymentId });
  if (error) throw new PayablesError(error.message);
  await writeAudit(sb, { table_name: "acc_bill_payment", record_id: paymentId, action: "void" });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/services/payables.ts
git commit -m "feat: payables service layer (vendors, bills, expenses, bill payments)"
```

---

### Task 7: Vendors page (UI)

Mirrors `app/(app)/customers`. Simplest UI first to establish the pattern.

**Files:**
- Create: `ctyhp-accounting/app/(app)/vendors/actions.ts`
- Create: `ctyhp-accounting/app/(app)/vendors/page.tsx`
- Create: `ctyhp-accounting/app/(app)/vendors/VendorsClient.tsx`

**Interfaces:**
- Consumes: `listVendors`, `createVendor`, `PayablesError` (Task 6); `listAccounts` (existing); `vendorCreateSchema` (Task 5); `getUserRole`, `canWrite` (existing).

- [ ] **Step 1: Write the server action**

Create `ctyhp-accounting/app/(app)/vendors/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { createVendor, PayablesError } from "@/lib/services/payables";
import { vendorCreateSchema } from "@/lib/domain/schemas";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  if (err instanceof PayablesError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createVendorAction(raw: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = vendorCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const v = await createVendor(sb, parsed.data);
    revalidatePath("/vendors");
    return { ok: true, data: { id: v.id, name: v.name } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 2: Write the page (server component)**

Create `ctyhp-accounting/app/(app)/vendors/page.tsx`:

```typescript
import { createSupabaseServerClient } from "@/lib/db/server";
import { listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import VendorsClient from "./VendorsClient";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const sb = await createSupabaseServerClient();
  const [vendors, accounts, role] = await Promise.all([listVendors(sb), listAccounts(sb), getUserRole()]);

  const apAccounts = accounts.filter(
    (a) => a.account_type === "accounts_payable" && a.is_posting_account && a.status === "active",
  );
  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Vendors" description="Manage the vendors you buy from and owe money to." />
      <VendorsClient
        vendors={vendors}
        apAccounts={apAccounts}
        expenseAccounts={expenseAccounts}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the client component**

Create `ctyhp-accounting/app/(app)/vendors/VendorsClient.tsx`:

```typescript
"use client";
import { useState } from "react";
import { App, Button, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, VendorRow } from "@/lib/db/types";
import { createVendorAction } from "./actions";

export default function VendorsClient({
  vendors,
  apAccounts,
  expenseAccounts,
  canWrite,
}: {
  vendors: VendorRow[];
  apAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await createVendorAction(values);
    setSaving(false);
    if (res.ok) {
      message.success("Vendor created");
      setOpen(false);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to create vendor");
    }
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New vendor
          </Button>
        )}
      </Space>
      <Table<VendorRow>
        rowKey="id"
        dataSource={vendors}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Email", dataIndex: "email", render: (v) => v ?? "—" },
          { title: "Phone", dataIndex: "phone", render: (v) => v ?? "—" },
          { title: "Terms", dataIndex: "payment_terms", render: (v) => v ?? "—" },
          {
            title: "Status",
            dataIndex: "is_active",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag>,
          },
        ]}
      />
      <Modal
        title="New vendor"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Create"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input />
          </Form.Item>
          <Form.Item name="payment_terms" label="Payment terms">
            <Input placeholder="e.g. Net 30" />
          </Form.Item>
          <Form.Item name="ap_account_id" label="A/P account (optional)">
            <Select allowClear options={apAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
          </Form.Item>
          <Form.Item name="default_expense_account_id" label="Default expense account (optional)">
            <Select allowClear options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS (route `/vendors` compiles).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/vendors"
git commit -m "feat: vendors page (list + create)"
```

---

### Task 8: Bills page (UI)

Mirrors `app/(app)/invoices`. Create draft with a line editor (expense account + amount), post to ledger, void.

**Files:**
- Create: `ctyhp-accounting/app/(app)/bills/actions.ts`
- Create: `ctyhp-accounting/app/(app)/bills/page.tsx`
- Create: `ctyhp-accounting/app/(app)/bills/BillsClient.tsx`

**Interfaces:**
- Consumes: `listBills`, `createDraftBill`, `postBill`, `voidBill`, `getBillLines`, `PayablesError` (Task 6); `listVendors`; `listAccounts`; `listCurrencies`; `billCreateSchema`; `getUserRole`/`canWrite`.
- The client converts decimal amount inputs to minor units before calling the action (mirror how `InvoicesClient` builds `unit_price_minor`). Assume 2-decimal USD; use the selected currency's `decimal_places` from the passed `currencies` list.

- [ ] **Step 1: Write the server actions**

Create `ctyhp-accounting/app/(app)/bills/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  createDraftBill,
  postBill,
  voidBill,
  getBillLines,
  PayablesError,
} from "@/lib/services/payables";
import type { BillLineRow } from "@/lib/db/types";
import { billCreateSchema } from "@/lib/domain/schemas";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  if (err instanceof PayablesError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createBillAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = billCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const bill = await createDraftBill(sb, parsed.data);
    revalidatePath("/bills");
    return { ok: true, data: { id: bill.id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function getBillLinesAction(id: string): Promise<ActionResult<BillLineRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getBillLines(sb, id) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function postBillAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await postBill(sb, id);
    revalidatePath("/bills");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidBillAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidBill(sb, id);
    revalidatePath("/bills");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 2: Write the page (server component)**

Create `ctyhp-accounting/app/(app)/bills/page.tsx`:

```typescript
import { createSupabaseServerClient } from "@/lib/db/server";
import { listBills, listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import BillsClient from "./BillsClient";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  const sb = await createSupabaseServerClient();
  const [bills, vendors, accounts, currencies, role] = await Promise.all([
    listBills(sb),
    listVendors(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Bills" description="Enter bills you owe, post them to Accounts Payable, and track balances." />
      <BillsClient
        bills={bills}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the client component**

Create `ctyhp-accounting/app/(app)/bills/BillsClient.tsx`:

```typescript
"use client";
import { useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, CurrencyRow, VendorRow } from "@/lib/db/types";
import type { BillWithVendor } from "@/lib/services/payables";
import { createBillAction, postBillAction, voidBillAction } from "./actions";

const STATUS_COLOR: Record<string, string> = {
  draft: "default",
  open: "blue",
  partial: "gold",
  paid: "green",
  void: "red",
};

interface LineForm {
  description?: string;
  expense_account_id?: string;
  amount?: number; // decimal, converted to minor on submit
}

export default function BillsClient({
  bills,
  vendors,
  expenseAccounts,
  currencies,
  canWrite,
}: {
  bills: BillWithVendor[];
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [currency, setCurrency] = useState<string>(currencies.find((c) => c.is_base)?.code ?? "USD");

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  function fmt(minor: number, code: string): string {
    const d = currencies.find((c) => c.code === code)?.decimal_places ?? 2;
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  async function submit() {
    const values = await form.validateFields();
    const lines = (values.lines as LineForm[]).map((l) => ({
      description: l.description ?? "",
      expense_account_id: l.expense_account_id,
      amount_minor: Math.round((l.amount ?? 0) * 10 ** decimals),
    }));
    setSaving(true);
    const res = await createBillAction({
      vendor_id: values.vendor_id,
      vendor_ref: values.vendor_ref ?? null,
      currency_code: currency,
      bill_date: values.bill_date ? values.bill_date.format("YYYY-MM-DD") : undefined,
      due_date: values.due_date ? values.due_date.format("YYYY-MM-DD") : null,
      memo: values.memo ?? null,
      lines,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Draft bill created");
      setOpen(false);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to create bill");
    }
  }

  async function post(id: string) {
    const res = await postBillAction(id);
    if (res.ok) message.success("Bill posted");
    else message.error(res.error ?? "Failed to post bill");
  }

  function confirmVoid(id: string) {
    modal.confirm({
      title: "Void this bill?",
      content: "This reverses its journal entry. Bills with payments applied cannot be voided.",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidBillAction(id);
        if (res.ok) message.success("Bill voided");
        else message.error(res.error ?? "Failed to void bill");
      },
    });
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New bill
          </Button>
        )}
      </Space>
      <Table<BillWithVendor>
        rowKey="id"
        dataSource={bills}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Bill #", dataIndex: "bill_number", render: (v) => v ?? <Tag>draft</Tag> },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Ref", dataIndex: "vendor_ref", render: (v) => v ?? "—" },
          { title: "Date", dataIndex: "bill_date" },
          { title: "Due", dataIndex: "due_date", render: (v) => v ?? "—" },
          {
            title: "Total",
            dataIndex: "total_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
          {
            title: "Balance",
            dataIndex: "balance_due_minor",
            align: "right",
            render: (v: number, r) => fmt(v, r.currency_code),
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>,
          },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canWrite ? (
                <Space>
                  {r.status === "draft" && (
                    <Button size="small" type="link" onClick={() => post(r.id)}>
                      Post
                    </Button>
                  )}
                  {r.status !== "void" && r.status !== "paid" && (
                    <Button size="small" type="link" danger onClick={() => confirmVoid(r.id)}>
                      Void
                    </Button>
                  )}
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        title="New bill"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Create draft"
        width={720}
      >
        <Form form={form} layout="vertical" initialValues={{ lines: [{}] }}>
          <Form.Item name="vendor_id" label="Vendor" rules={[{ required: true, message: "Select a vendor" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={vendors.map((v) => ({ value: v.id, label: v.name }))}
            />
          </Form.Item>
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="vendor_ref" label="Vendor ref #">
              <Input placeholder="Vendor's invoice #" />
            </Form.Item>
            <Form.Item label="Currency">
              <Select
                value={currency}
                style={{ width: 120 }}
                onChange={setCurrency}
                options={currencies.map((c) => ({ value: c.code, label: c.code }))}
              />
            </Form.Item>
            <Form.Item name="bill_date" label="Bill date">
              <DatePicker />
            </Form.Item>
            <Form.Item name="due_date" label="Due date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                    <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0 }}>
                      <Input placeholder="Description" style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "expense_account_id"]}
                      rules={[{ required: true, message: "Account" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        placeholder="Expense account"
                        style={{ width: 220 }}
                        showSearch
                        optionFilterProp="label"
                        options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "amount"]}
                      rules={[{ required: true, message: "Amount" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber min={0} precision={decimals} placeholder="Amount" style={{ width: 140 }} />
                    </Form.Item>
                    {fields.length > 1 && <Button type="link" danger onClick={() => remove(field.name)}>Remove</Button>}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                  Add line
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="memo" label="Memo" style={{ marginTop: 16 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS (route `/bills` compiles).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/bills"
git commit -m "feat: bills page (draft, post to A/P, void)"
```

---

### Task 9: Expenses page (UI)

Mirrors the bills page but posts immediately from a bank/credit-card account; no draft state.

**Files:**
- Create: `ctyhp-accounting/app/(app)/expenses/actions.ts`
- Create: `ctyhp-accounting/app/(app)/expenses/page.tsx`
- Create: `ctyhp-accounting/app/(app)/expenses/ExpensesClient.tsx`

**Interfaces:**
- Consumes: `listExpenses`, `recordExpense`, `voidExpense`, `PayablesError` (Task 6); `listVendors`; `listAccounts`; `listCurrencies`; `expenseCreateSchema`; `getUserRole`/`canWrite`.

- [ ] **Step 1: Write the server actions**

Create `ctyhp-accounting/app/(app)/expenses/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { recordExpense, voidExpense, PayablesError } from "@/lib/services/payables";
import { expenseCreateSchema } from "@/lib/domain/schemas";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  if (err instanceof PayablesError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function recordExpenseAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = expenseCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await recordExpense(sb, parsed.data);
    revalidatePath("/expenses");
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidExpenseAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidExpense(sb, id);
    revalidatePath("/expenses");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 2: Write the page (server component)**

Create `ctyhp-accounting/app/(app)/expenses/page.tsx`:

```typescript
import { createSupabaseServerClient } from "@/lib/db/server";
import { listExpenses, listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ExpensesClient from "./ExpensesClient";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const sb = await createSupabaseServerClient();
  const [expenses, vendors, accounts, currencies, role] = await Promise.all([
    listExpenses(sb),
    listVendors(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );
  const paymentAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_type === "credit_card") && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Expenses" description="Record money already spent by bank or credit card." />
      <ExpensesClient
        expenses={expenses}
        vendors={vendors}
        expenseAccounts={expenseAccounts}
        paymentAccounts={paymentAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the client component**

Create `ctyhp-accounting/app/(app)/expenses/ExpensesClient.tsx`:

```typescript
"use client";
import { useMemo, useState } from "react";
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, CurrencyRow, VendorRow } from "@/lib/db/types";
import type { ExpenseWithVendor } from "@/lib/services/payables";
import { recordExpenseAction, voidExpenseAction } from "./actions";

interface LineForm {
  description?: string;
  expense_account_id?: string;
  amount?: number;
}

export default function ExpensesClient({
  expenses,
  vendors,
  expenseAccounts,
  paymentAccounts,
  currencies,
  canWrite,
}: {
  expenses: ExpenseWithVendor[];
  vendors: VendorRow[];
  expenseAccounts: AccountRow[];
  paymentAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [currency, setCurrency] = useState<string>(currencies.find((c) => c.is_base)?.code ?? "USD");

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  function fmt(minor: number, code: string): string {
    const d = currencies.find((c) => c.code === code)?.decimal_places ?? 2;
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  async function submit() {
    const values = await form.validateFields();
    const lines = (values.lines as LineForm[]).map((l) => ({
      description: l.description ?? "",
      expense_account_id: l.expense_account_id,
      amount_minor: Math.round((l.amount ?? 0) * 10 ** decimals),
    }));
    setSaving(true);
    const res = await recordExpenseAction({
      vendor_id: values.vendor_id ?? null,
      payment_account_id: values.payment_account_id,
      currency_code: currency,
      expense_date: values.expense_date ? values.expense_date.format("YYYY-MM-DD") : undefined,
      memo: values.memo ?? null,
      lines,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Expense recorded");
      setOpen(false);
      form.resetFields();
    } else {
      message.error(res.error ?? "Failed to record expense");
    }
  }

  function confirmVoid(id: string) {
    modal.confirm({
      title: "Void this expense?",
      content: "This reverses its journal entry.",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidExpenseAction(id);
        if (res.ok) message.success("Expense voided");
        else message.error(res.error ?? "Failed to void expense");
      },
    });
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New expense
          </Button>
        )}
      </Space>
      <Table<ExpenseWithVendor>
        rowKey="id"
        dataSource={expenses}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Expense #", dataIndex: "expense_number", render: (v) => v ?? "—" },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Date", dataIndex: "expense_date" },
          { title: "Total", dataIndex: "total_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "void" ? "red" : "green"}>{s}</Tag> },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canWrite && r.status !== "void" ? (
                <Button size="small" type="link" danger onClick={() => confirmVoid(r.id)}>
                  Void
                </Button>
              ) : null,
          },
        ]}
      />
      <Modal
        title="New expense"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Record"
        width={720}
      >
        <Form form={form} layout="vertical" initialValues={{ lines: [{}] }}>
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="vendor_id" label="Vendor (optional)">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 220 }}
                options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
            <Form.Item
              name="payment_account_id"
              label="Paid from"
              rules={[{ required: true, message: "Select a payment account" }]}
            >
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                options={paymentAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
              />
            </Form.Item>
            <Form.Item label="Currency">
              <Select
                value={currency}
                style={{ width: 120 }}
                onChange={setCurrency}
                options={currencies.map((c) => ({ value: c.code, label: c.code }))}
              />
            </Form.Item>
            <Form.Item name="expense_date" label="Date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }}>
                    <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0 }}>
                      <Input placeholder="Description" style={{ width: 220 }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "expense_account_id"]}
                      rules={[{ required: true, message: "Account" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Select
                        placeholder="Expense account"
                        style={{ width: 220 }}
                        showSearch
                        optionFilterProp="label"
                        options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "amount"]}
                      rules={[{ required: true, message: "Amount" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber min={0} precision={decimals} placeholder="Amount" style={{ width: 140 }} />
                    </Form.Item>
                    {fields.length > 1 && <Button type="link" danger onClick={() => remove(field.name)}>Remove</Button>}
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                  Add line
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="memo" label="Memo" style={{ marginTop: 16 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/expenses"
git commit -m "feat: expenses page (immediate spend from bank/credit card)"
```

---

### Task 10: Pay Bills page (UI) + navigation

Mirrors `app/(app)/payments`. Pick a vendor → load their open bills → allocate a payment → record. Also add the four new nav entries.

**Files:**
- Create: `ctyhp-accounting/app/(app)/pay-bills/actions.ts`
- Create: `ctyhp-accounting/app/(app)/pay-bills/page.tsx`
- Create: `ctyhp-accounting/app/(app)/pay-bills/PayBillsClient.tsx`
- Modify: `ctyhp-accounting/components/AppShell.tsx`

**Interfaces:**
- Consumes: `listBillPayments`, `listOpenBillsForVendor`, `payBills`, `voidBillPayment`, `PayablesError` (Task 6); `listVendors`; `listAccounts`; `listCurrencies`; `billPaymentCreateSchema`; `getUserRole`/`canWrite`; `BillRow` type.

- [ ] **Step 1: Write the server actions**

Create `ctyhp-accounting/app/(app)/pay-bills/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listOpenBillsForVendor, payBills, voidBillPayment, PayablesError } from "@/lib/services/payables";
import type { BillRow } from "@/lib/db/types";
import { billPaymentCreateSchema } from "@/lib/domain/schemas";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  if (err instanceof PayablesError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function openBillsForVendorAction(vendorId: string): Promise<ActionResult<BillRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listOpenBillsForVendor(sb, vendorId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function payBillsAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = billPaymentCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await payBills(sb, parsed.data);
    revalidatePath("/pay-bills");
    revalidatePath("/bills");
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidBillPaymentAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidBillPayment(sb, id);
    revalidatePath("/pay-bills");
    revalidatePath("/bills");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 2: Write the page (server component)**

Create `ctyhp-accounting/app/(app)/pay-bills/page.tsx`:

```typescript
import { createSupabaseServerClient } from "@/lib/db/server";
import { listBillPayments, listVendors } from "@/lib/services/payables";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import PayBillsClient from "./PayBillsClient";

export const dynamic = "force-dynamic";

export default async function PayBillsPage() {
  const sb = await createSupabaseServerClient();
  const [payments, vendors, accounts, currencies, role] = await Promise.all([
    listBillPayments(sb),
    listVendors(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const paymentAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_type === "credit_card") && a.is_posting_account && a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Pay Bills" description="Pay one or more open bills and clear Accounts Payable." />
      <PayBillsClient
        payments={payments}
        vendors={vendors}
        paymentAccounts={paymentAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the client component**

Create `ctyhp-accounting/app/(app)/pay-bills/PayBillsClient.tsx`:

```typescript
"use client";
import { useMemo, useState } from "react";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, BillPaymentRow, BillRow, CurrencyRow, VendorRow } from "@/lib/db/types";
import { openBillsForVendorAction, payBillsAction, voidBillPaymentAction } from "./actions";

export default function PayBillsClient({
  payments,
  vendors,
  paymentAccounts,
  currencies,
  canWrite,
}: {
  payments: (BillPaymentRow & { vendor_name: string })[];
  vendors: VendorRow[];
  paymentAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [currency, setCurrency] = useState<string>(currencies.find((c) => c.is_base)?.code ?? "USD");
  const [openBills, setOpenBills] = useState<BillRow[]>([]);
  const [alloc, setAlloc] = useState<Record<string, number>>({}); // bill_id -> decimal amount

  const decimals = useMemo(
    () => currencies.find((c) => c.code === currency)?.decimal_places ?? 2,
    [currencies, currency],
  );

  function fmt(minor: number, code: string): string {
    const d = currencies.find((c) => c.code === code)?.decimal_places ?? 2;
    return `${(minor / 10 ** d).toFixed(d)} ${code}`;
  }

  async function onVendorChange(vendorId: string) {
    setAlloc({});
    const res = await openBillsForVendorAction(vendorId);
    if (res.ok) setOpenBills(res.data ?? []);
    else message.error(res.error ?? "Failed to load open bills");
  }

  const allocTotalMinor = useMemo(
    () => Object.values(alloc).reduce((s, v) => s + Math.round((v ?? 0) * 10 ** decimals), 0),
    [alloc, decimals],
  );

  async function submit() {
    const values = await form.validateFields();
    const allocations = openBills
      .map((b) => ({ bill_id: b.id, amount_minor: Math.round((alloc[b.id] ?? 0) * 10 ** decimals) }))
      .filter((a) => a.amount_minor > 0);
    setSaving(true);
    const res = await payBillsAction({
      vendor_id: values.vendor_id,
      payment_date: values.payment_date ? values.payment_date.format("YYYY-MM-DD") : undefined,
      currency_code: currency,
      amount_minor: Math.round((values.amount ?? 0) * 10 ** decimals),
      payment_account_id: values.payment_account_id,
      method: values.method ?? null,
      allocations,
    });
    setSaving(false);
    if (res.ok) {
      message.success("Payment recorded");
      setOpen(false);
      form.resetFields();
      setOpenBills([]);
      setAlloc({});
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

  function confirmVoid(id: string) {
    modal.confirm({
      title: "Void this bill payment?",
      content: "This reverses the journal entry and restores the bill balances.",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidBillPaymentAction(id);
        if (res.ok) message.success("Payment voided");
        else message.error(res.error ?? "Failed to void payment");
      },
    });
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Pay bills
          </Button>
        )}
      </Space>
      <Table<BillPaymentRow & { vendor_name: string }>
        rowKey="id"
        dataSource={payments}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Payment #", dataIndex: "payment_number", render: (v) => v ?? "—" },
          { title: "Vendor", dataIndex: "vendor_name" },
          { title: "Date", dataIndex: "payment_date" },
          { title: "Amount", dataIndex: "amount_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
          { title: "Unapplied", dataIndex: "unapplied_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "void" ? "red" : "blue"}>{s}</Tag> },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canWrite && r.status !== "void" ? (
                <Button size="small" type="link" danger onClick={() => confirmVoid(r.id)}>
                  Void
                </Button>
              ) : null,
          },
        ]}
      />
      <Modal
        title="Pay bills"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Record payment"
        width={720}
      >
        <Form form={form} layout="vertical">
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="vendor_id" label="Vendor" rules={[{ required: true, message: "Select a vendor" }]}>
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                onChange={onVendorChange}
                options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            </Form.Item>
            <Form.Item
              name="payment_account_id"
              label="Pay from"
              rules={[{ required: true, message: "Select a payment account" }]}
            >
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                options={paymentAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
              />
            </Form.Item>
            <Form.Item label="Currency">
              <Select
                value={currency}
                style={{ width: 120 }}
                onChange={setCurrency}
                options={currencies.map((c) => ({ value: c.code, label: c.code }))}
              />
            </Form.Item>
            <Form.Item name="payment_date" label="Date">
              <DatePicker />
            </Form.Item>
          </Space>
          <Form.Item name="amount" label="Payment amount" rules={[{ required: true, message: "Enter an amount" }]}>
            <InputNumber min={0} precision={decimals} style={{ width: 200 }} />
          </Form.Item>

          <Typography.Text strong>Open bills</Typography.Text>
          <Table<BillRow>
            rowKey="id"
            dataSource={openBills}
            size="small"
            pagination={false}
            scroll={{ x: "max-content" }}
            style={{ marginTop: 8 }}
            columns={[
              { title: "Bill #", dataIndex: "bill_number", render: (v) => v ?? "—" },
              { title: "Date", dataIndex: "bill_date" },
              { title: "Balance", dataIndex: "balance_due_minor", align: "right", render: (v: number, r) => fmt(v, r.currency_code) },
              {
                title: "Payment",
                key: "pay",
                render: (_, r) => (
                  <InputNumber
                    min={0}
                    max={r.balance_due_minor / 10 ** decimals}
                    precision={decimals}
                    value={alloc[r.id]}
                    onChange={(v) => setAlloc((prev) => ({ ...prev, [r.id]: Number(v ?? 0) }))}
                  />
                ),
              },
            ]}
          />
          <Typography.Paragraph style={{ marginTop: 8 }}>
            Allocated: {(allocTotalMinor / 10 ** decimals).toFixed(decimals)} {currency}
          </Typography.Paragraph>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: Add navigation entries**

In `ctyhp-accounting/components/AppShell.tsx`, add the icons to the existing import and four entries to the `NAV` array after `/payments`:

Update the icon import block to include `ShopOutlined` and `CreditCardOutlined`:

```typescript
import {
  BankOutlined,
  FileTextOutlined,
  DollarOutlined,
  BarChartOutlined,
  TableOutlined,
  LogoutOutlined,
  DashboardOutlined,
  TeamOutlined,
  ShopOutlined,
  CreditCardOutlined,
} from "@ant-design/icons";
```

Change the `NAV` array to:

```typescript
const NAV = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
  { key: "/accounts", icon: <TableOutlined />, label: "Chart of Accounts" },
  { key: "/customers", icon: <TeamOutlined />, label: "Customers" },
  { key: "/invoices", icon: <FileTextOutlined />, label: "Invoices" },
  { key: "/payments", icon: <DollarOutlined />, label: "Payments" },
  { key: "/vendors", icon: <ShopOutlined />, label: "Vendors" },
  { key: "/bills", icon: <FileTextOutlined />, label: "Bills" },
  { key: "/expenses", icon: <CreditCardOutlined />, label: "Expenses" },
  { key: "/pay-bills", icon: <DollarOutlined />, label: "Pay Bills" },
  { key: "/banking", icon: <BankOutlined />, label: "Banking" },
  { key: "/reports", icon: <BarChartOutlined />, label: "Reports" },
];
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS (routes `/pay-bills` and updated nav compile).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/pay-bills" components/AppShell.tsx
git commit -m "feat: pay-bills page + payables navigation entries"
```

---

### Task 11: End-to-end verification

Confirm the full cycle and that the ledger still ties out. (Holy Grail Part 10.)

**Files:**
- None (verification only). Optionally add findings to `CLAUDE.md` "Gotchas" if a bug surfaces.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test && npm run typecheck && npm run build && npm run lint`
Expected: all PASS, zero errors. Paste the real output.

- [ ] **Step 2: Manual smoke test (dev server)**

Run: `npm run dev`, then in the browser as an `accountant`/`admin` user:
1. Create a vendor.
2. Create a bill (2 lines) → Post. Confirm it appears with a `bill_number` and status `open`.
3. Open **Reports → Trial Balance**: confirm total debits == total credits (still balanced) and Accounts Payable increased by the bill total.
4. **Pay Bills**: select the vendor, load the open bill, allocate full amount, record. Confirm the bill status becomes `paid`, balance 0.
5. Open **Reports → Balance Sheet**: confirm Accounts Payable dropped and the bank/credit account decreased; Assets == Liabilities + Equity.
6. Record an **Expense** from a bank account; confirm **Reports → Profit & Loss** shows the expense and Trial Balance still balances.
7. Void a bill payment; confirm the bill returns to `open`/`partial` and balances restore.

Expected: every check holds. If any figure is off, STOP and debug (systematic-debugging) — do not claim done.

- [ ] **Step 3: Finish the branch**

Follow `superpowers:finishing-a-development-branch` to merge/PR `feature/expenses-bills-payables`.

---

## Self-Review

**Spec coverage:**
- §1 scope (Bill/Bill Payment/Expense) → Tasks 2–10. ✓
- §2 reuse (posting/money/audit) → Task 2 (builders reuse `assertBalanced`/`reverse`); Task 6 (`writeAudit`). ✓
- §3 data model (7 tables + sequences) → Task 3. ✓
- §4 posting rules → Task 2 (pure) + Task 4 (RPC). ✓
- §5 service/domain/RPCs → Tasks 2, 4, 5, 6. ✓
- §6 UI (vendors/bills/expenses/pay-bills + nav) → Tasks 7–10. ✓
- §7 security (RLS, audit, staff guard) → Task 3 (RLS), Task 4 (`acc_is_staff`), Task 6 (audit), actions (`guard`). ✓
- §8 testing → Task 2 (unit) + Task 11 (E2E). ✓
- §9 reports impact (none) → confirmed in Task 11 checks. ✓
- §10 CLAUDE.md prerequisite → Task 1. ✓

**Type consistency:** RPC parameter names (`p_bill_id`, `p_vendor_id`, `p_payment_account_id`, `p_lines`, `p_allocations`) match between Task 4 (SQL) and Task 6 (service `.rpc(...)` calls). Row/type names (`BillWithVendor`, `ExpenseWithVendor`, `VendorRow`, `BillRow`) are defined in Tasks 5–6 and consumed in Tasks 7–10. Zod schema names match actions. US tax model consistent (no tax fields anywhere).

**Placeholder scan:** No TBD/TODO; every code step includes complete code.
