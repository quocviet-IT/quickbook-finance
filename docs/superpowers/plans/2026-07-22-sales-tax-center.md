# Sales Tax Center (US) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sales Tax Center — a period Sales Tax Liability report, tax-payment (remittance) recording, and tax-rate CRUD — for a single US tax jurisdiction, without changing how invoices post tax.

**Architecture:** A read RPC aggregates tax collected per rate from invoice lines; a second read RPC returns the Sales Tax Payable balance; an atomic RPC posts remittances (DR Sales Tax Payable / CR Bank) into a new `acc_tax_payment` table. A pure helper rolls up the liability totals. UI is an Ant Design page with liability, payments, and tax-rate sections.

**Tech Stack:** Next.js 16 (App Router) + TypeScript strict + Supabase (Postgres/RLS) + Ant Design v6 + Zod v4 + Vitest.

## Global Constraints

- Money is integer **minor units** (`_minor` bigint); never floats.
- No change to invoice tax posting. Liability is DERIVED from `acc_invoice_line` + the Sales Tax Payable account. (Holy Grail Part 14.)
- Remittance amounts recomputed/validated server-side in the RPC; never trusted from the client. (Part 10)
- Void = mark the journal entry `status='void'` only (reports filter `status='posted'`); do NOT post a reversal. (Matches the corrected void semantics used across the app.)
- `acc_tax_payment` has **RLS**: read any authenticated role, write `acc_is_staff()`. (Part 12)
- Every write appends to `acc_audit_log` via `writeAudit`. (Part 12)
- Postgres enum rule: add a new `acc_journal_source` value in one migration, use it only in a later migration. (Project gotcha.)
- UI in **English**; tables scroll horizontally; `canWrite` gates mutations. (Bonus/Part 12)
- Verify before "done": `npm run build`, `npm test`, `npm run typecheck`, `npm run lint` — zero errors — paste real output. (Part 10)
- Work on branch `feature/sales-tax-center` (already created). Commit at each task boundary; no Claude attribution in commit messages. Migrations are applied by the controller (via `scripts/migrate.mjs` or the Supabase SQL Editor) — implementers only create + commit migration files.

---

### Task 1: Migration `0015_sales_tax.sql` — schema, sequence, RLS

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0015_sales_tax.sql`

**Interfaces:**
- Produces enum value `tax_payment` on `acc_journal_source`; enum `acc_tax_payment_status`; table `acc_tax_payment`; sequence key `tax_payment`.
- Consumes existing `acc_account`, `acc_currency`, `acc_journal_entry`, `acc_current_role()`, `acc_is_staff()`, `acc_sequence`.

- [ ] **Step 1: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0015_sales_tax.sql`:

```sql
-- ============================================================================
-- Sales Tax Center: remittance (tax payment) documents that reduce the Sales
-- Tax Payable liability. The enum value added here is used only in 0016 (a new
-- enum value cannot be used in the same transaction that adds it).
-- ============================================================================

alter type acc_journal_source add value if not exists 'tax_payment';

create type acc_tax_payment_status as enum ('posted', 'void');

create table acc_tax_payment (
  id                uuid primary key default gen_random_uuid(),
  payment_number    text unique,
  tax_account_id    uuid not null references acc_account (id),
  bank_account_id   uuid not null references acc_account (id),
  payment_date      date not null default current_date,
  currency_code     text not null references acc_currency (code),
  amount_minor      bigint not null check (amount_minor > 0),
  period_start      date,
  period_end        date,
  status            acc_tax_payment_status not null default 'posted',
  journal_entry_id  uuid references acc_journal_entry (id),
  memo              text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index acc_tax_payment_date_idx on acc_tax_payment (payment_date);

insert into acc_sequence (key, prefix, next_value) values ('tax_payment', 'TAXPMT-', 1);

alter table acc_tax_payment enable row level security;
create policy acc_tax_payment_read  on acc_tax_payment for select using (acc_current_role() is not null);
create policy acc_tax_payment_write on acc_tax_payment for all using (acc_is_staff()) with check (acc_is_staff());
```

- [ ] **Step 2: Do NOT apply (controller applies).** Only create and commit the file.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0015_sales_tax.sql
git commit -m "feat: acc_tax_payment table + tax_payment source + RLS"
```

---

### Task 2: Pure liability roll-up helper + unit tests (TDD)

**Files:**
- Create: `ctyhp-accounting/lib/domain/salestax.ts`
- Test: `ctyhp-accounting/tests/unit/salestax.test.ts`

**Interfaces:**
- Produces:
  - `interface TaxCollectedLine { taxCodeId: string; code: string; name: string; ratePercent: number; taxableMinor: number; taxMinor: number }`
  - `interface SalesTaxLiability { lines: TaxCollectedLine[]; totalTaxCollectedMinor: number; paymentsMinor: number; netOwedMinor: number }`
  - `summarizeSalesTaxLiability(input: { collected: TaxCollectedLine[]; paymentsMinor: number; netBalanceMinor: number }): SalesTaxLiability`

- [ ] **Step 1: Write the failing tests**

Create `ctyhp-accounting/tests/unit/salestax.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { summarizeSalesTaxLiability } from "@/lib/domain/salestax";

const collected = [
  { taxCodeId: "a", code: "TAX", name: "Sales Tax", ratePercent: 8.25, taxableMinor: 100_00, taxMinor: 8_25 },
  { taxCodeId: "b", code: "TAX2", name: "City Tax", ratePercent: 2, taxableMinor: 50_00, taxMinor: 1_00 },
];

describe("summarizeSalesTaxLiability", () => {
  it("sums tax collected across codes and passes through payments and net", () => {
    const r = summarizeSalesTaxLiability({ collected, paymentsMinor: 3_00, netBalanceMinor: 6_25 });
    expect(r.totalTaxCollectedMinor).toBe(9_25);
    expect(r.paymentsMinor).toBe(3_00);
    expect(r.netOwedMinor).toBe(6_25);
    expect(r.lines).toHaveLength(2);
  });

  it("handles an empty period", () => {
    const r = summarizeSalesTaxLiability({ collected: [], paymentsMinor: 0, netBalanceMinor: 0 });
    expect(r.totalTaxCollectedMinor).toBe(0);
    expect(r.netOwedMinor).toBe(0);
    expect(r.lines).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- salestax`
Expected: FAIL — module `@/lib/domain/salestax` not found.

- [ ] **Step 3: Implement the helper**

Create `ctyhp-accounting/lib/domain/salestax.ts`:

```typescript
/**
 * Pure roll-up of the sales-tax liability. `collected` is per-tax-code tax
 * accrued from issued invoices in the period; `netBalanceMinor` is the current
 * Sales Tax Payable balance (credit - debit) owed. This is the single place the
 * liability totals are computed.
 */
export interface TaxCollectedLine {
  taxCodeId: string;
  code: string;
  name: string;
  ratePercent: number;
  taxableMinor: number;
  taxMinor: number;
}

export interface SalesTaxLiability {
  lines: TaxCollectedLine[];
  totalTaxCollectedMinor: number;
  paymentsMinor: number;
  netOwedMinor: number;
}

export function summarizeSalesTaxLiability(input: {
  collected: TaxCollectedLine[];
  paymentsMinor: number;
  netBalanceMinor: number;
}): SalesTaxLiability {
  const totalTaxCollectedMinor = input.collected.reduce((s, l) => s + l.taxMinor, 0);
  return {
    lines: input.collected,
    totalTaxCollectedMinor,
    paymentsMinor: input.paymentsMinor,
    netOwedMinor: input.netBalanceMinor,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- salestax`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/salestax.ts tests/unit/salestax.test.ts
git commit -m "feat: sales-tax liability roll-up helper with tests"
```

---

### Task 3: Row type + Zod schemas (+ schema test)

**Files:**
- Modify: `ctyhp-accounting/lib/db/types.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Test: `ctyhp-accounting/tests/unit/tax-code-schema.test.ts`

**Interfaces:**
- Produces type `TaxPaymentStatus`, `TaxPaymentRow`; schemas `taxCodeCreateSchema`/`TaxCodeCreateInput`, `taxCodeUpdateSchema`/`TaxCodeUpdateInput`, `taxPaymentCreateSchema`/`TaxPaymentCreateInput`.

- [ ] **Step 1: Add row types**

Append to `ctyhp-accounting/lib/db/types.ts`:

```typescript
// --- Sales Tax ---
export type TaxPaymentStatus = "posted" | "void";

export interface TaxPaymentRow {
  id: string;
  payment_number: string | null;
  tax_account_id: string;
  bank_account_id: string;
  payment_date: string;
  currency_code: string;
  amount_minor: number;
  period_start: string | null;
  period_end: string | null;
  status: TaxPaymentStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Write the failing schema test**

Create `ctyhp-accounting/tests/unit/tax-code-schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { taxCodeCreateSchema } from "@/lib/domain/schemas";

const ok = { code: "TAX", name: "Sales Tax", rate_percent: 8.25, direction: "sales" as const };

describe("taxCodeCreateSchema", () => {
  it("accepts a valid sales tax code", () => {
    expect(taxCodeCreateSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects a negative rate", () => {
    expect(taxCodeCreateSchema.safeParse({ ...ok, rate_percent: -1 }).success).toBe(false);
  });
  it("rejects a missing code", () => {
    expect(taxCodeCreateSchema.safeParse({ ...ok, code: "" }).success).toBe(false);
  });
  it("rejects an invalid direction", () => {
    expect(taxCodeCreateSchema.safeParse({ ...ok, direction: "vat" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tax-code-schema`
Expected: FAIL — `taxCodeCreateSchema` not exported.

- [ ] **Step 4: Add Zod schemas**

Append to `ctyhp-accounting/lib/domain/schemas.ts`:

```typescript
// --- Sales Tax ---
export const TAX_DIRECTIONS = ["sales", "purchase", "none"] as const;

export const taxCodeCreateSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(20),
  name: z.string().trim().min(1, "Name is required").max(120),
  rate_percent: z.number().min(0, "Rate must be >= 0").max(100, "Rate must be <= 100"),
  direction: z.enum(TAX_DIRECTIONS),
  tax_account_id: z.uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type TaxCodeCreateInput = z.infer<typeof taxCodeCreateSchema>;

export const taxCodeUpdateSchema = taxCodeCreateSchema;
export type TaxCodeUpdateInput = z.infer<typeof taxCodeUpdateSchema>;

export const taxPaymentCreateSchema = z.object({
  tax_account_id: z.uuid("Select the Sales Tax Payable account"),
  bank_account_id: z.uuid("Select a bank account"),
  payment_date: z.string().optional(),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
  amount_minor: z.number().int().positive("Amount must be greater than 0"),
  period_start: z.string().optional().nullable(),
  period_end: z.string().optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
});
export type TaxPaymentCreateInput = z.infer<typeof taxPaymentCreateSchema>;
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- tax-code-schema && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/db/types.ts lib/domain/schemas.ts tests/unit/tax-code-schema.test.ts
git commit -m "feat: tax payment row type + tax-code/tax-payment Zod schemas"
```

---

### Task 4: Migration `0016_sales_tax_functions.sql` — read + posting RPCs

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0016_sales_tax_functions.sql`

**Interfaces:**
- Consumes `acc_to_base_minor`, `acc_next_number`, `acc_post_entry`, `acc_is_staff`.
- Produces: `acc_sales_tax_collected(p_from date, p_to date)`, `acc_sales_tax_payable_balance(p_to date)`, `acc_record_tax_payment(...)`, `acc_void_tax_payment(uuid)`.

- [ ] **Step 1: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0016_sales_tax_functions.sql`:

```sql
-- ============================================================================
-- Sales Tax Center functions: read the liability (collected per rate + payable
-- balance) and post/void remittances. Posting is atomic and staff-gated.
-- Void marks the entry 'void' (reports exclude void) — no reversal posting.
-- ============================================================================

-- Tax collected per sales tax code from issued (non-void) invoices in [from,to].
create or replace function acc_sales_tax_collected(p_from date, p_to date)
returns table (tax_code_id uuid, code text, name text, rate_percent numeric,
               taxable_minor bigint, tax_minor bigint)
language sql stable as $$
  select tc.id, tc.code, tc.name, tc.rate_percent,
         coalesce(sum(il.line_subtotal_minor), 0)::bigint,
         coalesce(sum(il.line_tax_minor), 0)::bigint
    from acc_invoice_line il
    join acc_invoice inv on inv.id = il.invoice_id
    join acc_tax_code tc  on tc.id = il.tax_code_id
   where inv.status <> 'void'
     and inv.issue_date between p_from and p_to
   group by tc.id, tc.code, tc.name, tc.rate_percent
   having coalesce(sum(il.line_tax_minor), 0) <> 0
   order by tc.code;
$$;

-- Net Sales Tax Payable balance (credit - debit, base currency) up to p_to,
-- across accounts used as the tax account by sales-direction tax codes.
create or replace function acc_sales_tax_payable_balance(p_to date)
returns bigint language sql stable as $$
  select coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where e.status = 'posted'
     and e.entry_date <= p_to
     and l.account_id in (
       select distinct tax_account_id from acc_tax_code
        where direction = 'sales' and tax_account_id is not null
     );
$$;

-- Record a remittance: DR Sales Tax Payable / CR bank.
create or replace function acc_record_tax_payment(
  p_tax_account_id  uuid,
  p_bank_account_id uuid,
  p_payment_date    date,
  p_currency        text,
  p_amount_minor    bigint,
  p_period_start    date,
  p_period_end      date,
  p_memo            text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_number text;
  v_entry  uuid;
  v_base   bigint;
  v_id     uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record tax payments'; end if;
  if p_amount_minor <= 0 then raise exception 'Tax payment amount must be positive'; end if;

  v_base := acc_to_base_minor(p_amount_minor, p_currency, p_payment_date);
  v_number := acc_next_number('tax_payment');
  v_entry := acc_post_entry(
    p_payment_date, 'Sales tax payment ' || v_number, 'tax_payment', null, p_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', p_tax_account_id, 'debit_minor', p_amount_minor,
        'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Sales tax remittance'),
      jsonb_build_object('account_id', p_bank_account_id, 'debit_minor', 0,
        'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Bank payment')
    ));

  insert into acc_tax_payment(payment_number, tax_account_id, bank_account_id, payment_date,
      currency_code, amount_minor, period_start, period_end, status, journal_entry_id, memo, created_by)
    values (v_number, p_tax_account_id, p_bank_account_id, p_payment_date, p_currency,
      p_amount_minor, p_period_start, p_period_end, 'posted', v_entry, p_memo, auth.uid())
    returning id into v_id;

  return v_id;
end;
$$;

-- Void a remittance: mark the entry void (reports exclude void); no reversal.
create or replace function acc_void_tax_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay acc_tax_payment;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void tax payments'; end if;

  select * into v_pay from acc_tax_payment where id = p_payment_id for update;
  if not found then raise exception 'Tax payment not found'; end if;
  if v_pay.status = 'void' then raise exception 'Tax payment is already void'; end if;

  if v_pay.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_pay.journal_entry_id;
  end if;

  update acc_tax_payment set status = 'void', updated_at = now() where id = p_payment_id;
end;
$$;
```

- [ ] **Step 2: Do NOT apply (controller applies).** Only create and commit.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0016_sales_tax_functions.sql
git commit -m "feat: sales-tax read RPCs + record/void tax payment RPCs"
```

---

### Task 5: Service `salestax.ts`

**Files:**
- Create: `ctyhp-accounting/lib/services/salestax.ts`

**Interfaces:**
- Consumes RPCs from Task 4; `summarizeSalesTaxLiability`/`TaxCollectedLine`/`SalesTaxLiability` (Task 2); `TaxPaymentRow`, `TaxCodeRow` (types); `TaxCodeCreateInput`/`TaxCodeUpdateInput`/`TaxPaymentCreateInput` (Task 3); `writeAudit`.
- Produces: `getSalesTaxLiability(sb, from, to)`, `listTaxPayments(sb)`, `recordTaxPayment(sb, input)`, `voidTaxPayment(sb, id)`, `createTaxCode(sb, input)`, `updateTaxCode(sb, id, input)`, `setTaxCodeActive(sb, id, active)`; class `SalesTaxError`.

- [ ] **Step 1: Write the service module**

Create `ctyhp-accounting/lib/services/salestax.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaxPaymentRow, TaxCodeRow } from "@/lib/db/types";
import type { TaxCodeCreateInput, TaxCodeUpdateInput, TaxPaymentCreateInput } from "@/lib/domain/schemas";
import { summarizeSalesTaxLiability, type SalesTaxLiability, type TaxCollectedLine } from "@/lib/domain/salestax";
import { writeAudit } from "./audit";

export class SalesTaxError extends Error {}

export async function getSalesTaxLiability(
  sb: SupabaseClient,
  from: string,
  to: string,
): Promise<SalesTaxLiability> {
  const [collectedRes, balRes, payRes] = await Promise.all([
    sb.rpc("acc_sales_tax_collected", { p_from: from, p_to: to }),
    sb.rpc("acc_sales_tax_payable_balance", { p_to: to }),
    sb.from("acc_tax_payment").select("amount_minor,payment_date,status"),
  ]);
  if (collectedRes.error) throw new SalesTaxError(collectedRes.error.message);
  if (balRes.error) throw new SalesTaxError(balRes.error.message);
  if (payRes.error) throw new SalesTaxError(payRes.error.message);

  const collected: TaxCollectedLine[] = (collectedRes.data ?? []).map((r: Record<string, unknown>) => ({
    taxCodeId: r.tax_code_id as string,
    code: r.code as string,
    name: r.name as string,
    ratePercent: Number(r.rate_percent),
    taxableMinor: Number(r.taxable_minor),
    taxMinor: Number(r.tax_minor),
  }));
  const paymentsMinor = (payRes.data ?? [])
    .filter((p: Record<string, unknown>) => p.status !== "void" && (p.payment_date as string) >= from && (p.payment_date as string) <= to)
    .reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount_minor), 0);

  return summarizeSalesTaxLiability({ collected, paymentsMinor, netBalanceMinor: Number(balRes.data ?? 0) });
}

const TP_COLS =
  "id,payment_number,tax_account_id,bank_account_id,payment_date,currency_code,amount_minor," +
  "period_start,period_end,status,journal_entry_id,memo,created_at,updated_at";

export async function listTaxPayments(sb: SupabaseClient): Promise<TaxPaymentRow[]> {
  const { data, error } = await sb.from("acc_tax_payment").select(TP_COLS).order("created_at", { ascending: false });
  if (error) throw new SalesTaxError(error.message);
  return (data ?? []) as unknown as TaxPaymentRow[];
}

export async function recordTaxPayment(sb: SupabaseClient, input: TaxPaymentCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_tax_payment", {
    p_tax_account_id: input.tax_account_id,
    p_bank_account_id: input.bank_account_id,
    p_payment_date: input.payment_date || undefined,
    p_currency: input.currency_code,
    p_amount_minor: input.amount_minor,
    p_period_start: input.period_start || null,
    p_period_end: input.period_end || null,
    p_memo: input.memo || null,
  });
  if (error) throw new SalesTaxError(error.message);
  await writeAudit(sb, { table_name: "acc_tax_payment", record_id: (data as string) ?? null, action: "post" });
  return data as string;
}

export async function voidTaxPayment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_tax_payment", { p_payment_id: id });
  if (error) throw new SalesTaxError(error.message);
  await writeAudit(sb, { table_name: "acc_tax_payment", record_id: id, action: "void" });
}

const TC_COLS = "id,code,name,rate_percent,direction,tax_account_id,is_active";

function taxCodeRow(input: TaxCodeCreateInput | TaxCodeUpdateInput) {
  return {
    code: input.code,
    name: input.name,
    rate_percent: input.rate_percent,
    direction: input.direction,
    tax_account_id: input.tax_account_id || null,
    is_active: input.is_active,
  };
}

export async function createTaxCode(sb: SupabaseClient, input: TaxCodeCreateInput): Promise<TaxCodeRow> {
  const { data, error } = await sb.from("acc_tax_code").insert(taxCodeRow(input)).select(TC_COLS).single();
  if (error) throw new SalesTaxError(error.message);
  const row = data as unknown as TaxCodeRow;
  await writeAudit(sb, { table_name: "acc_tax_code", record_id: row.id, action: "insert", after: row });
  return row;
}

export async function updateTaxCode(sb: SupabaseClient, id: string, input: TaxCodeUpdateInput): Promise<TaxCodeRow> {
  const { data, error } = await sb.from("acc_tax_code").update(taxCodeRow(input)).eq("id", id).select(TC_COLS).single();
  if (error) throw new SalesTaxError(error.message);
  const row = data as unknown as TaxCodeRow;
  await writeAudit(sb, { table_name: "acc_tax_code", record_id: id, action: "update", after: row });
  return row;
}

export async function setTaxCodeActive(sb: SupabaseClient, id: string, active: boolean): Promise<void> {
  const { error } = await sb.from("acc_tax_code").update({ is_active: active }).eq("id", id);
  if (error) throw new SalesTaxError(error.message);
  await writeAudit(sb, { table_name: "acc_tax_code", record_id: id, action: "update", after: { is_active: active } });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/services/salestax.ts
git commit -m "feat: sales-tax service (liability, payments, tax-code CRUD)"
```

---

### Task 6: Sales Tax page (UI) + navigation

**Files:**
- Create: `ctyhp-accounting/app/(app)/sales-tax/actions.ts`
- Create: `ctyhp-accounting/app/(app)/sales-tax/page.tsx`
- Create: `ctyhp-accounting/app/(app)/sales-tax/SalesTaxClient.tsx`
- Modify: `ctyhp-accounting/components/AppShell.tsx` (nav entry)

**Interfaces:**
- Consumes service functions from Task 5; `listTaxCodes` (reference); `listAccounts` (accounts); `listCurrencies` (reference); `getUserRole`/`canWrite`; `formatMoney`/`toMinorUnits` from `@/lib/format`; schemas `taxCodeCreateSchema`/`taxPaymentCreateSchema`.

- [ ] **Step 1: Write the server actions**

Create `ctyhp-accounting/app/(app)/sales-tax/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import {
  getSalesTaxLiability,
  recordTaxPayment,
  voidTaxPayment,
  createTaxCode,
  updateTaxCode,
  setTaxCodeActive,
  SalesTaxError,
} from "@/lib/services/salestax";
import type { SalesTaxLiability } from "@/lib/domain/salestax";
import { taxCodeCreateSchema, taxCodeUpdateSchema, taxPaymentCreateSchema } from "@/lib/domain/schemas";

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
  if (err instanceof SalesTaxError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function liabilityAction(from: string, to: string): Promise<ActionResult<SalesTaxLiability>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getSalesTaxLiability(sb, from, to) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function recordTaxPaymentAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = taxPaymentCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await recordTaxPayment(sb, parsed.data);
    revalidatePath("/sales-tax");
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidTaxPaymentAction(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await voidTaxPayment(sb, id);
    revalidatePath("/sales-tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function createTaxCodeAction(raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = taxCodeCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await createTaxCode(sb, parsed.data);
    revalidatePath("/sales-tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function updateTaxCodeAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = taxCodeUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await updateTaxCode(sb, id, parsed.data);
    revalidatePath("/sales-tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function setTaxCodeActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await setTaxCodeActive(sb, id, active);
    revalidatePath("/sales-tax");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 2: Write the page (server component)**

Create `ctyhp-accounting/app/(app)/sales-tax/page.tsx`:

```typescript
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalesTaxLiability, listTaxPayments } from "@/lib/services/salestax";
import { listTaxCodes, listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import SalesTaxClient from "./SalesTaxClient";

export const dynamic = "force-dynamic";

function monthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function SalesTaxPage() {
  const sb = await createSupabaseServerClient();
  // Note: default range is computed on the server request; the client can change it.
  const now = new Date();
  const from = monthStart(now);
  const to = today(now);

  const [liability, payments, taxCodes, accounts, currencies, role] = await Promise.all([
    getSalesTaxLiability(sb, from, to),
    listTaxPayments(sb),
    listTaxCodes(sb),
    listAccounts(sb),
    listCurrencies(sb),
    getUserRole(),
  ]);

  const taxPayableAccounts = accounts.filter(
    (a) => (a.account_type === "current_liability" || a.account_type === "accounts_payable") && a.is_posting_account && a.status === "active",
  );
  const bankAccounts = accounts.filter(
    (a) => (a.account_type === "bank" || a.account_type === "credit_card") && a.is_posting_account && a.status === "active",
  );
  const postingAccounts = accounts.filter((a) => a.is_posting_account && a.status === "active");

  return (
    <div>
      <PageHeader title="Sales Tax" description="Review sales tax owed, record payments, and manage rates." />
      <SalesTaxClient
        initialFrom={from}
        initialTo={to}
        initialLiability={liability}
        payments={payments}
        taxCodes={taxCodes}
        taxPayableAccounts={taxPayableAccounts}
        bankAccounts={bankAccounts}
        postingAccounts={postingAccounts}
        currencies={currencies}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the client component**

Create `ctyhp-accounting/app/(app)/sales-tax/SalesTaxClient.tsx`:

```typescript
"use client";
import { useState } from "react";
import {
  App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography,
} from "antd";
import dayjs from "dayjs";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, CurrencyRow, TaxCodeRow, TaxPaymentRow } from "@/lib/db/types";
import type { SalesTaxLiability } from "@/lib/domain/salestax";
import { formatMoney, toMinorUnits } from "@/lib/format";
import {
  liabilityAction, recordTaxPaymentAction, voidTaxPaymentAction,
  createTaxCodeAction, updateTaxCodeAction, setTaxCodeActiveAction,
} from "./actions";

interface Props {
  initialFrom: string;
  initialTo: string;
  initialLiability: SalesTaxLiability;
  payments: TaxPaymentRow[];
  taxCodes: TaxCodeRow[];
  taxPayableAccounts: AccountRow[];
  bankAccounts: AccountRow[];
  postingAccounts: AccountRow[];
  currencies: CurrencyRow[];
  canWrite: boolean;
}

export default function SalesTaxClient(props: Props) {
  const { message, modal } = App.useApp();
  const baseCurrency = props.currencies.find((c) => c.is_base)?.code ?? "USD";
  const decimalsOf = (code: string) => props.currencies.find((c) => c.code === code)?.decimal_places ?? 2;
  const money = (minor: number) => formatMoney(minor, baseCurrency, decimalsOf(baseCurrency));

  // --- Liability ---
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs(props.initialFrom), dayjs(props.initialTo)]);
  const [liability, setLiability] = useState<SalesTaxLiability>(props.initialLiability);
  const [loading, setLoading] = useState(false);

  async function reloadLiability(r: [dayjs.Dayjs, dayjs.Dayjs]) {
    setLoading(true);
    const res = await liabilityAction(r[0].format("YYYY-MM-DD"), r[1].format("YYYY-MM-DD"));
    setLoading(false);
    if (res.ok && res.data) setLiability(res.data);
    else message.error(res.error ?? "Failed to load liability");
  }

  // --- Record payment ---
  const [payOpen, setPayOpen] = useState(false);
  const [paySaving, setPaySaving] = useState(false);
  const [payForm] = Form.useForm();

  async function submitPayment() {
    const v = await payForm.validateFields();
    setPaySaving(true);
    const res = await recordTaxPaymentAction({
      tax_account_id: v.tax_account_id,
      bank_account_id: v.bank_account_id,
      currency_code: baseCurrency,
      amount_minor: toMinorUnits(Number(v.amount ?? 0), decimalsOf(baseCurrency)),
      payment_date: v.payment_date ? v.payment_date.format("YYYY-MM-DD") : undefined,
      period_start: v.period ? v.period[0].format("YYYY-MM-DD") : null,
      period_end: v.period ? v.period[1].format("YYYY-MM-DD") : null,
      memo: v.memo ?? null,
    });
    setPaySaving(false);
    if (res.ok) {
      message.success("Tax payment recorded");
      setPayOpen(false);
      payForm.resetFields();
      reloadLiability(range);
    } else {
      message.error(res.error ?? "Failed to record payment");
    }
  }

  function confirmVoidPayment(id: string) {
    modal.confirm({
      title: "Void this tax payment?",
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await voidTaxPaymentAction(id);
        if (res.ok) { message.success("Tax payment voided"); reloadLiability(range); }
        else message.error(res.error ?? "Failed to void payment");
      },
    });
  }

  // --- Tax code edit ---
  const [tcOpen, setTcOpen] = useState(false);
  const [tcSaving, setTcSaving] = useState(false);
  const [tcEditing, setTcEditing] = useState<TaxCodeRow | null>(null);
  const [tcForm] = Form.useForm();

  function openTaxCode(tc: TaxCodeRow | null) {
    setTcEditing(tc);
    tcForm.resetFields();
    if (tc) tcForm.setFieldsValue({
      code: tc.code, name: tc.name, rate_percent: Number(tc.rate_percent),
      direction: tc.direction, tax_account_id: tc.tax_account_id ?? undefined, is_active: tc.is_active,
    });
    else tcForm.setFieldsValue({ direction: "sales", rate_percent: 0, is_active: true });
    setTcOpen(true);
  }

  async function submitTaxCode() {
    const v = await tcForm.validateFields();
    const payload = {
      code: v.code, name: v.name, rate_percent: Number(v.rate_percent),
      direction: v.direction, tax_account_id: v.tax_account_id ?? null, is_active: v.is_active ?? true,
    };
    setTcSaving(true);
    const res = tcEditing ? await updateTaxCodeAction(tcEditing.id, payload) : await createTaxCodeAction(payload);
    setTcSaving(false);
    if (res.ok) { message.success(tcEditing ? "Rate updated" : "Rate created"); setTcOpen(false); }
    else message.error(res.error ?? "Failed to save rate");
  }

  return (
    <Tabs
      defaultActiveKey="liability"
      items={[
        {
          key: "liability",
          label: "Liability",
          children: (
            <>
              <Space style={{ marginBottom: 16 }} wrap>
                <DatePicker.RangePicker
                  value={range}
                  onChange={(r) => { if (r && r[0] && r[1]) { const rr: [dayjs.Dayjs, dayjs.Dayjs] = [r[0], r[1]]; setRange(rr); reloadLiability(rr); } }}
                />
                {props.canWrite && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setPayOpen(true)}>Record payment</Button>
                )}
              </Space>
              <Table<SalesTaxLiability["lines"][number]>
                rowKey="taxCodeId"
                loading={loading}
                dataSource={liability.lines}
                pagination={false}
                scroll={{ x: "max-content" }}
                columns={[
                  { title: "Code", dataIndex: "code" },
                  { title: "Name", dataIndex: "name" },
                  { title: "Rate", dataIndex: "ratePercent", align: "right", render: (v: number) => `${v}%` },
                  { title: "Taxable", dataIndex: "taxableMinor", align: "right", render: (v: number) => money(v) },
                  { title: "Tax collected", dataIndex: "taxMinor", align: "right", render: (v: number) => money(v) },
                ]}
              />
              <div style={{ textAlign: "right", marginTop: 12 }}>
                <div>Tax collected (period): <b>{money(liability.totalTaxCollectedMinor)}</b></div>
                <div>Payments (period): {money(liability.paymentsMinor)}</div>
                <Typography.Text strong>Net owed now: {money(liability.netOwedMinor)}</Typography.Text>
              </div>
            </>
          ),
        },
        {
          key: "payments",
          label: "Payments",
          children: (
            <Table<TaxPaymentRow>
              rowKey="id"
              dataSource={props.payments}
              scroll={{ x: "max-content" }}
              pagination={{ pageSize: 20 }}
              columns={[
                { title: "Number", dataIndex: "payment_number", render: (v) => v ?? "—" },
                { title: "Date", dataIndex: "payment_date" },
                { title: "Period", key: "period", render: (_, r) => (r.period_start && r.period_end ? `${r.period_start} → ${r.period_end}` : "—") },
                { title: "Amount", dataIndex: "amount_minor", align: "right", render: (v: number) => money(v) },
                { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "void" ? "red" : "green"}>{s}</Tag> },
                {
                  title: "Actions", key: "actions",
                  render: (_, r) => props.canWrite && r.status !== "void"
                    ? <Button size="small" type="link" danger onClick={() => confirmVoidPayment(r.id)}>Void</Button>
                    : null,
                },
              ]}
            />
          ),
        },
        {
          key: "rates",
          label: "Tax rates",
          children: (
            <>
              <Space style={{ marginBottom: 16 }}>
                {props.canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => openTaxCode(null)}>New rate</Button>}
              </Space>
              <Table<TaxCodeRow>
                rowKey="id"
                dataSource={props.taxCodes}
                scroll={{ x: "max-content" }}
                pagination={false}
                columns={[
                  { title: "Code", dataIndex: "code" },
                  { title: "Name", dataIndex: "name" },
                  { title: "Rate", dataIndex: "rate_percent", align: "right", render: (v: number) => `${v}%` },
                  { title: "Direction", dataIndex: "direction" },
                  { title: "Status", dataIndex: "is_active", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag> },
                  {
                    title: "Actions", key: "actions",
                    render: (_, r) => props.canWrite ? (
                      <Space>
                        <Button size="small" type="link" onClick={() => openTaxCode(r)}>Edit</Button>
                        <Button size="small" type="link" onClick={async () => {
                          const res = await setTaxCodeActiveAction(r.id, !r.is_active);
                          if (res.ok) message.success("Updated"); else message.error(res.error ?? "Failed");
                        }}>{r.is_active ? "Deactivate" : "Activate"}</Button>
                      </Space>
                    ) : null,
                  },
                ]}
              />
            </>
          ),
        },
      ]}
      tabBarExtraContent={
        <>
          {/* Record payment modal */}
          <Modal title="Record tax payment" open={payOpen} onOk={submitPayment} onCancel={() => setPayOpen(false)} confirmLoading={paySaving} okText="Record">
            <Form form={payForm} layout="vertical">
              <Form.Item name="tax_account_id" label="Sales Tax Payable account" rules={[{ required: true, message: "Select the tax account" }]}>
                <Select showSearch optionFilterProp="label" options={props.taxPayableAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
              </Form.Item>
              <Form.Item name="bank_account_id" label="Pay from" rules={[{ required: true, message: "Select a bank account" }]}>
                <Select showSearch optionFilterProp="label" options={props.bankAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
              </Form.Item>
              <Form.Item name="amount" label="Amount" rules={[{ required: true, message: "Enter an amount" }]}>
                <InputNumber min={0} precision={decimalsOf(baseCurrency)} prefix="$" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="payment_date" label="Payment date"><DatePicker /></Form.Item>
              <Form.Item name="period" label="Period covered"><DatePicker.RangePicker /></Form.Item>
              <Form.Item name="memo" label="Memo"><Input.TextArea rows={2} /></Form.Item>
            </Form>
          </Modal>

          {/* Tax code modal */}
          <Modal title={tcEditing ? "Edit rate" : "New rate"} open={tcOpen} onOk={submitTaxCode} onCancel={() => setTcOpen(false)} confirmLoading={tcSaving} okText={tcEditing ? "Save" : "Create"}>
            <Form form={tcForm} layout="vertical">
              <Form.Item name="code" label="Code" rules={[{ required: true, message: "Code is required" }]}><Input /></Form.Item>
              <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required" }]}><Input /></Form.Item>
              <Form.Item name="rate_percent" label="Rate (%)" rules={[{ required: true, message: "Rate is required" }]}>
                <InputNumber min={0} max={100} precision={4} style={{ width: 160 }} />
              </Form.Item>
              <Form.Item name="direction" label="Direction" rules={[{ required: true }]}>
                <Select options={[{ value: "sales", label: "Sales" }, { value: "purchase", label: "Purchase" }, { value: "none", label: "None" }]} />
              </Form.Item>
              <Form.Item name="tax_account_id" label="Tax account">
                <Select allowClear showSearch optionFilterProp="label" options={props.postingAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))} />
              </Form.Item>
              <Form.Item name="is_active" label="Active" valuePropName="checked" initialValue={true}>
                <input type="checkbox" />
              </Form.Item>
            </Form>
          </Modal>
        </>
      }
    />
  );
}
```

- [ ] **Step 4: Add navigation entry**

In `ctyhp-accounting/components/AppShell.tsx`, add `PercentageOutlined` to the icon import from `@ant-design/icons`, and add this NAV entry immediately after the `/reports` entry:

```typescript
  { key: "/sales-tax", icon: <PercentageOutlined />, label: "Sales Tax" },
```

- [ ] **Step 5: Verify build + scoped lint**

Run: `npm run build && npx eslint "app/(app)/sales-tax" components/AppShell.tsx`
Expected: build PASS; eslint clean on those paths. Fix any AntD v6 API mismatch minimally if the build fails (e.g. a prop rename), without disabling typecheck.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/sales-tax" components/AppShell.tsx
git commit -m "feat: Sales Tax Center page (liability, payments, rates) + nav"
```

---

### Task 7: End-to-end verification

**Files:**
- Create: `ctyhp-accounting/scripts/verify-salestax.mjs`

**Interfaces:**
- Consumes the applied DB (migrations through 0016) and the admin-login + clear-error pattern from `scripts/verify-items.mjs`.

- [ ] **Step 1: Write the verify script**

Create `ctyhp-accounting/scripts/verify-salestax.mjs`:

```javascript
// End-to-end verify of the Sales Tax Center (as admin): issue a taxed invoice,
// check tax shows as collected, record a remittance, check the payable balance
// drops, then void it and confirm restore. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-salestax.mjs
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " " + d : ""}`); };

async function acctId(code) {
  return (await db.query("select id from acc_account where account_code=$1", [code])).rows[0].id;
}
async function payableBalance(to) {
  return Number((await db.query("select acc_sales_tax_payable_balance($1) b", [to])).rows[0].b);
}

async function main() {
  await db.connect();
  const { data: auth, error: e1 } = await sb.auth.signInWithPassword({
    email: "admin@ctyhp.vn", password: "Ctyhp@Ketoan2026",
  });
  if (e1) throw new Error("login: " + e1.message);
  const authed = createClient(url, key, {
    global: { headers: { Authorization: "Bearer " + auth.session.access_token } },
    auth: { persistSession: false },
  });

  const income = await acctId("4000");
  const bank = await acctId("1010");
  const taxPayable = await acctId("2100");
  const tax = (await db.query("select id, rate_percent from acc_tax_code where code='TAX'")).rows[0];
  const rate = Number(tax.rate_percent);
  const sub = 100_00;
  const taxMinor = Math.round((sub * rate) / 100);

  const balBefore = await payableBalance("2100-12-31");

  // Issue a taxed invoice
  const { data: cust } = await authed.from("acc_customer").insert({ name: "E2E Tax Cust", currency_code: "USD" }).select("id").single();
  const { data: inv, error: e2 } = await authed.from("acc_invoice").insert({
    customer_id: cust.id, currency_code: "USD",
    subtotal_minor: sub, tax_total_minor: taxMinor, total_minor: sub + taxMinor, balance_due_minor: sub + taxMinor,
  }).select("id,issue_date").single();
  if (e2) throw new Error("invoice: " + e2.message);
  const { error: e3 } = await authed.from("acc_invoice_line").insert({
    invoice_id: inv.id, line_order: 0, description: "E2E", quantity: 1, unit_price_minor: sub,
    income_account_id: income, tax_code_id: tax.id, line_subtotal_minor: sub, line_tax_minor: taxMinor, line_total_minor: sub + taxMinor,
  });
  if (e3) throw new Error("line: " + e3.message);
  const { error: e4 } = await authed.rpc("acc_issue_invoice", { p_invoice_id: inv.id });
  if (e4) throw new Error("issue: " + e4.message);

  // Collected shows in the period
  const { data: collected, error: e5 } = await authed.rpc("acc_sales_tax_collected", { p_from: inv.issue_date, p_to: inv.issue_date });
  if (e5) throw new Error("collected: " + e5.message);
  const taxRow = (collected ?? []).find((r) => r.code === "TAX");
  check("tax collected reported for TAX", !!taxRow && Number(taxRow.tax_minor) >= taxMinor, `(+${taxRow ? taxRow.tax_minor : 0})`);

  const balAfterIssue = await payableBalance("2100-12-31");
  check("payable balance rose by tax", balAfterIssue - balBefore === taxMinor, `(+${balAfterIssue - balBefore})`);

  // Record a remittance for the tax
  const { data: payId, error: e6 } = await authed.rpc("acc_record_tax_payment", {
    p_tax_account_id: taxPayable, p_bank_account_id: bank, p_payment_date: "2026-07-31",
    p_currency: "USD", p_amount_minor: taxMinor, p_period_start: null, p_period_end: null, p_memo: "E2E",
  });
  if (e6) throw new Error("record payment: " + e6.message);
  const balAfterPay = await payableBalance("2100-12-31");
  check("payable balance dropped after remittance", balAfterPay === balBefore, `(=${balAfterPay})`);

  // Void the remittance -> restored
  const { error: e7 } = await authed.rpc("acc_void_tax_payment", { p_payment_id: payId });
  if (e7) throw new Error("void: " + e7.message);
  const balAfterVoid = await payableBalance("2100-12-31");
  check("payable balance restored after void", balAfterVoid === balAfterIssue, `(=${balAfterVoid})`);

  // Cleanup
  await db.query("begin");
  await db.query("delete from acc_tax_payment");
  await db.query("delete from acc_invoice_line where invoice_id=$1", [inv.id]);
  await db.query("delete from acc_invoice where id=$1", [inv.id]);
  await db.query("delete from acc_customer where id=$1", [cust.id]);
  await db.query("update acc_journal_entry set status='void'");
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
  const inner = (e.errors || []).map((x) => `${x.code} ${x.address}:${x.port}`).join(", ");
  console.error("verify error:", parts || "(no message)", inner ? `| ${inner}` : "");
  process.exitCode = 1;
}).finally(() => db.end());
```

- [ ] **Step 2: Run the full automated suite**

Run: `npm test && npm run typecheck && npm run build && npm run lint`
Expected: all PASS; lint zero errors. Paste real output.

- [ ] **Step 3: Live-DB verify (controller runs after migrations applied)**

Run: `node --env-file=.env.local scripts/verify-salestax.mjs`
Expected: `4 passed, 0 failed`. (If the DB is unreachable over the Postgres port, run the equivalent checks via the Supabase SQL Editor.)

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-salestax.mjs
git commit -m "test: end-to-end verify for sales tax liability, remittance, void"
```

---

## Self-Review

**Spec coverage:**
- §3 data model (acc_tax_payment + enum + sequence + RLS) → Task 1. ✓
- §3 RPCs (collected, payable balance, record/void) → Task 4. ✓
- §4 pure helper + Zod → Tasks 2, 3. ✓
- §5 service (liability, payments, tax-code CRUD) → Task 5. ✓
- §6 UI (liability/payments/rates + nav) → Task 6. ✓
- §7 security (RLS, staff-gated RPCs, role-guarded actions) → Task 1, 4, 6. ✓
- §8 testing (unit + E2E) → Tasks 2, 3 (unit), Task 7 (E2E). ✓
- §9 reports impact (none) → no report change. ✓

**Type consistency:** `TaxPaymentRow` matches `acc_tax_payment` columns (Task 1 ↔ 3). RPC names/params match between Task 4 (SQL) and Task 5 (service `.rpc`): `acc_sales_tax_collected(p_from,p_to)`, `acc_sales_tax_payable_balance(p_to)`, `acc_record_tax_payment(p_tax_account_id,p_bank_account_id,p_payment_date,p_currency,p_amount_minor,p_period_start,p_period_end,p_memo)`, `acc_void_tax_payment(p_payment_id)`. `summarizeSalesTaxLiability`/`SalesTaxLiability`/`TaxCollectedLine` consistent across Tasks 2, 5, 6. Zod schema names consistent across Tasks 3, 6.

**Placeholder scan:** No TBD/TODO; every code step contains complete code or a precise, code-level edit instruction.

**Note on void RPC:** `acc_void_tax_payment` marks the journal entry `void` and does NOT post a reversal — consistent with the corrected void semantics (reports filter `status='posted'`), verified by the E2E "restored after void" check.
```
