# Payment Detail and Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user inspect a customer payment, fix its description without touching the ledger, and correct its money in one action that either replaces the receipt or leaves everything exactly as it was.

**Architecture:** Two company-scoped RPCs own every mutation — one whitelists three description columns, the other calls the existing `acc_void_payment` and `acc_record_payment` inside a single function so a correction is one transaction. The service and Server Actions are thin validated adapters; the payments route gains two focused components so `PaymentsClient.tsx` stays a façade.

**Tech Stack:** Next.js 16 App Router and Server Actions, React 19, TypeScript, Ant Design 5, Zod, Supabase/PostgreSQL PL/pgSQL, Vitest, Node `pg` rollback verification.

**Spec:** `docs/superpowers/specs/2026-08-05-payment-detail-and-correction-design.md`

## Global Constraints

- Product name in user-visible copy is **One Book**. All UI copy is US English; currency is USD; "Sales Tax", never "VAT".
- Money is minor units end-to-end; convert only at the UI edge using the currency's `decimal_places`.
- No SQL in components. Financial writes go through `lib/services/*` into a Postgres RPC.
- Never set `created_by` / `created_at` / `updated_by` / `updated_at` from application code — `acc_stamp_actor()` owns them.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, …). Keep markup in `"use client"` components.
- Every migration must reach every company schema; nothing may be pinned to `public` beyond the patterns `retargetToSchema()` already rewrites.
- Never disable RLS. Never duplicate a posting rule in TypeScript.
- No hard delete of a numbered document, and no path that revives a void payment.
- Keep every touched TS/TSX file under 400 lines.
- Read the checked-in Next.js 16 docs in `node_modules/next/dist/docs/` before writing route or Server Action code.
- Verification gates, all with real pasted output: `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:check-source`, `npm run build`, plus `scripts/smoke-pages.mjs` for the UI change.

## File Map

| File | Responsibility |
|---|---|
| `ctyhp-accounting/lib/domain/schemas.ts` | Modify. `paymentDetailsSchema`, `paymentCorrectionSchema`. |
| `ctyhp-accounting/supabase/migrations/0096_payment_details_and_correction.sql` | Create. `acc_update_payment_details`, `acc_correct_payment`, grants. |
| `ctyhp-accounting/lib/db/types.ts` | Modify. `PaymentAllocationView`, `PaymentJournalLine`, `PaymentDetail`. |
| `ctyhp-accounting/lib/services/invoicing.ts` | Modify. `getPaymentDetail`, `updatePaymentDetails`, `correctPayment`. |
| `ctyhp-accounting/app/(app)/payments/actions.ts` | Modify. Four new actions plus shared revalidation. |
| `ctyhp-accounting/app/(app)/payments/page.tsx` | Modify. Resolve `audit.read`. |
| `ctyhp-accounting/app/(app)/payments/PaymentDetailDrawer.tsx` | Create. Read-only detail view. |
| `ctyhp-accounting/app/(app)/payments/EditPaymentDetailsModal.tsx` | Create. Three-field description edit. |
| `ctyhp-accounting/app/(app)/payments/ReceivePaymentModal.tsx` | Modify. `correction` mode. |
| `ctyhp-accounting/app/(app)/payments/PaymentsClient.tsx` | Modify. `···` action menu and composition. |
| `ctyhp-accounting/tests/unit/payment-correction-schema.test.ts` | Create. Zod contracts. |
| `ctyhp-accounting/tests/unit/payment-correction-migration.test.ts` | Create. SQL safety and multi-company contract. |
| `ctyhp-accounting/tests/unit/payment-correction-service.test.ts` | Create. Supabase adapter behaviour. |
| `ctyhp-accounting/tests/unit/payment-correction-action.test.ts` | Create. Authorization, validation, revalidation. |
| `ctyhp-accounting/tests/unit/payment-void-ui-contract.test.ts` | Modify. New components and the 400-line ceiling. |
| `ctyhp-accounting/scripts/verify-payment-correction.mjs` | Create. Rollback-only behavioural verification. |
| `ctyhp-accounting/scripts/smoke-payments-void.mjs` | Modify. Assert the new controls ship. |
| `ctyhp-accounting/package.json` | Modify. `verify:payment-correction` script. |

---

### Task 1: Validation contracts

**Files:**
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Test: `ctyhp-accounting/tests/unit/payment-correction-schema.test.ts`

**Interfaces:**
- Consumes: `paymentCreateSchema`, `PaymentCreateInput` (existing).
- Produces: `paymentDetailsSchema`, `PaymentDetailsInput`, `paymentCorrectionSchema`, `PaymentCorrectionInput`.

- [ ] **Step 1: Write the failing schema tests**

Create `ctyhp-accounting/tests/unit/payment-correction-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { paymentCorrectionSchema, paymentDetailsSchema } from "@/lib/domain/schemas";

const id = "11111111-1111-4111-8111-111111111111";
const customer = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";

describe("paymentDetailsSchema", () => {
  it("trims the three description fields and keeps empty ones null", () => {
    expect(
      paymentDetailsSchema.parse({
        payment_id: id,
        method: "  check  ",
        reference: "",
        memo: "  Deposited Monday  ",
      }),
    ).toEqual({ payment_id: id, method: "check", reference: null, memo: "Deposited Monday" });
  });

  it("accepts an explicit null and rejects over-long values", () => {
    expect(
      paymentDetailsSchema.parse({ payment_id: id, method: null, reference: null, memo: null }),
    ).toEqual({ payment_id: id, method: null, reference: null, memo: null });
    expect(
      paymentDetailsSchema.safeParse({ payment_id: id, method: "x".repeat(61) }).success,
    ).toBe(false);
    expect(
      paymentDetailsSchema.safeParse({ payment_id: id, reference: "x".repeat(81) }).success,
    ).toBe(false);
    expect(paymentDetailsSchema.safeParse({ payment_id: id, memo: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(paymentDetailsSchema.safeParse({ payment_id: "bad" }).success).toBe(false);
  });
});

describe("paymentCorrectionSchema", () => {
  const base = {
    payment_id: id,
    reason: "  Wrong customer  ",
    customer_id: customer,
    currency_code: "USD",
    amount_minor: 12550,
    deposit_account_id: account,
    allocations: [],
  };

  it("carries every receipt field plus the payment being corrected", () => {
    const parsed = paymentCorrectionSchema.parse(base);
    expect(parsed.payment_id).toBe(id);
    expect(parsed.reason).toBe("Wrong customer");
    expect(parsed.amount_minor).toBe(12550);
    expect(parsed.allocations).toEqual([]);
  });

  it("requires a reason the same way voiding does", () => {
    expect(paymentCorrectionSchema.safeParse({ ...base, reason: "   " }).success).toBe(false);
    expect(paymentCorrectionSchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(paymentCorrectionSchema.safeParse({ ...base, amount_minor: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/payment-correction-schema.test.ts`

Expected: FAIL because `paymentDetailsSchema` and `paymentCorrectionSchema` do not exist.

- [ ] **Step 3: Add both schemas**

In `ctyhp-accounting/lib/domain/schemas.ts`, immediately after `paymentVoidSchema` / `PaymentVoidInput`:

```ts
/** An empty description field means "cleared", not "unchanged". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null));

/**
 * The only fields of a posted receipt that may be rewritten in place: they
 * describe the payment, they do not post. Anything that moves money goes
 * through a correction so the original stays readable.
 */
export const paymentDetailsSchema = z.object({
  payment_id: z.uuid("Select a payment"),
  method: optionalText(60),
  reference: optionalText(80),
  memo: optionalText(500),
});
export type PaymentDetailsInput = z.infer<typeof paymentDetailsSchema>;

/** A replacement receipt plus the payment it replaces, validated as one thing. */
export const paymentCorrectionSchema = paymentCreateSchema.extend({
  payment_id: z.uuid("Select a payment"),
  reason: z.string().trim().min(1, "Explain what was wrong with this payment").max(500),
});
export type PaymentCorrectionInput = z.infer<typeof paymentCorrectionSchema>;
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- tests/unit/payment-correction-schema.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/schemas.ts ctyhp-accounting/tests/unit/payment-correction-schema.test.ts
git commit -m "Say which parts of a receipt may be rewritten and which must be corrected"
```

---

### Task 2: The two RPCs

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0096_payment_details_and_correction.sql`
- Test: `ctyhp-accounting/tests/unit/payment-correction-migration.test.ts`

**Interfaces:**
- Consumes: `acc_is_staff()`, `acc_void_payment(uuid, text)` (migration 0095), `acc_record_payment(uuid, date, text, bigint, uuid, text, text, jsonb, text)` (migration 0071 — note `p_memo` comes before `p_allocations`, and `p_reference` is last).
- Produces: `acc_update_payment_details(uuid, text, text, text) returns void` and `acc_correct_payment(uuid, text, uuid, date, text, bigint, uuid, text, text, text, jsonb) returns uuid`.

- [ ] **Step 1: Write the failing migration contract test**

Create `ctyhp-accounting/tests/unit/payment-correction-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0096_payment_details_and_correction.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("payment details and correction migration", () => {
  it("exposes both functions with the agreed signatures", () => {
    expect(sql).toMatch(/create or replace function acc_update_payment_details\s*\(/i);
    expect(sql).toMatch(/create or replace function acc_correct_payment\s*\(/i);
    expect(sql).toMatch(
      /revoke all on function acc_update_payment_details\(uuid, text, text, text\) from public/i,
    );
    expect(sql).toMatch(
      /grant execute on function acc_update_payment_details\(uuid, text, text, text\) to authenticated, service_role/i,
    );
    expect(sql).toMatch(/revoke all on function acc_correct_payment\(/i);
    expect(sql).toMatch(/grant execute on function acc_correct_payment\([^)]*\) to authenticated, service_role/i);
  });

  it("lets a description edit touch nothing that posts", () => {
    const fn = sql.slice(
      sql.indexOf("function acc_update_payment_details"),
      sql.indexOf("function acc_correct_payment"),
    );
    expect(fn).toContain("acc_is_staff()");
    expect(fn).toMatch(/update acc_payment\s+set method =/i);
    for (const column of ["amount_minor", "payment_date", "customer_id", "deposit_account_id", "status"]) {
      expect(fn, column).not.toMatch(new RegExp(`${column}\\s*=`));
    }
    expect(fn).not.toMatch(/updated_at\s*=/);
    expect(fn).toMatch(/status = 'void'/); // refuses one, does not set one
    expect(fn).toMatch(/cannot be edited/i);
  });

  it("corrects by voiding and re-recording, in that order, in one function", () => {
    const fn = sql.slice(sql.indexOf("function acc_correct_payment"));
    expect(fn).toContain("acc_is_staff()");
    const voidAt = fn.indexOf("acc_void_payment");
    const recordAt = fn.indexOf("acc_record_payment");
    expect(voidAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(voidAt);
    expect(fn).not.toMatch(/delete\s+from\s+acc_payment/i);
    expect(fn).not.toMatch(/set status = 'applied'/i); // never revives the original
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/payment-correction-migration.test.ts`

Expected: FAIL with `ENOENT` because migration 0096 does not exist.

- [ ] **Step 3: Write migration 0096**

Create `ctyhp-accounting/supabase/migrations/0096_payment_details_and_correction.sql`:

```sql
-- ============================================================================
-- 0096  Edit a receipt's description, or correct the receipt itself
--
-- Voiding (0095) answers "this payment should not exist". It does not answer
-- the two smaller questions people actually ask more often: the check number
-- was typed wrong, or the whole receipt was right except the amount.
--
-- The first is not an accounting event at all, so it gets a function that can
-- only reach three columns. The second is two accounting events that must
-- never come apart, so it gets one function that does both.
-- ============================================================================

set search_path = public;

-- --- Description only --------------------------------------------------------
create or replace function acc_update_payment_details(
  p_payment_id uuid,
  p_method text,
  p_reference text,
  p_memo text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment acc_payment;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to edit customer payments';
  end if;

  select * into v_payment from acc_payment where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  -- A void receipt is a record of what happened, not a live document.
  if v_payment.status = 'void' then
    raise exception 'A void payment cannot be edited; record a replacement instead';
  end if;

  if length(btrim(coalesce(p_method, ''))) > 60 then
    raise exception 'Method cannot exceed 60 characters';
  end if;
  if length(btrim(coalesce(p_reference, ''))) > 80 then
    raise exception 'Reference cannot exceed 80 characters';
  end if;
  if length(btrim(coalesce(p_memo, ''))) > 500 then
    raise exception 'Memo cannot exceed 500 characters';
  end if;

  -- Three columns, named one by one: this function is the whitelist, so no
  -- caller reaches an amount or a date through it. acc_stamp_actor owns
  -- updated_at/updated_by, and acc_payment_atomic_audit records the change.
  update acc_payment
     set method = nullif(btrim(coalesce(p_method, '')), ''),
         reference = nullif(btrim(coalesce(p_reference, '')), ''),
         memo = nullif(btrim(coalesce(p_memo, '')), '')
   where id = p_payment_id;
end;
$$;

revoke all on function acc_update_payment_details(uuid, text, text, text) from public;
grant execute on function acc_update_payment_details(uuid, text, text, text)
  to authenticated, service_role;

-- --- Correction: one transaction, both halves --------------------------------
create or replace function acc_correct_payment(
  p_payment_id        uuid,
  p_reason            text,
  p_customer_id       uuid,
  p_payment_date      date,
  p_currency          text,
  p_amount_minor      bigint,
  p_deposit_account_id uuid,
  p_method            text,
  p_reference         text,
  p_memo              text,
  p_allocations       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to correct customer payments';
  end if;

  -- Every guard the void already owns applies here: an outstanding refund, a
  -- live bank match, a cleared statement line or a closed period refuses, and
  -- the new receipt below is rolled back with it. There is no state in which
  -- the customer's receipt is void and nothing has replaced it.
  perform acc_void_payment(p_payment_id, p_reason);

  v_new := acc_record_payment(
    p_customer_id,
    p_payment_date,
    p_currency,
    p_amount_minor,
    p_deposit_account_id,
    p_method,
    p_memo,
    p_allocations,
    p_reference
  );
  return v_new;
end;
$$;

revoke all on function acc_correct_payment(uuid, text, uuid, date, text, bigint, uuid, text, text, text, jsonb) from public;
grant execute on function acc_correct_payment(uuid, text, uuid, date, text, bigint, uuid, text, text, text, jsonb)
  to authenticated, service_role;
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- tests/unit/payment-correction-migration.test.ts tests/unit/schema-template.test.ts`

Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0096_payment_details_and_correction.sql ctyhp-accounting/tests/unit/payment-correction-migration.test.ts
git commit -m "Correct a receipt in one transaction, and let a typo stay a typo fix"
```

---

### Task 3: Service adapters

**Files:**
- Modify: `ctyhp-accounting/lib/db/types.ts`
- Modify: `ctyhp-accounting/lib/services/invoicing.ts`
- Test: `ctyhp-accounting/tests/unit/payment-correction-service.test.ts`

**Interfaces:**
- Consumes: the two RPCs from Task 2 and `PaymentDetailsInput` / `PaymentCorrectionInput` from Task 1.
- Produces: `getPaymentDetail(sb, payment): Promise<PaymentDetail>`, `updatePaymentDetails(sb, input): Promise<void>`, `correctPayment(sb, input): Promise<string>`, and the three view types.

- [ ] **Step 1: Write the failing service tests**

Create `ctyhp-accounting/tests/unit/payment-correction-service.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InvoicingError, correctPayment, getPaymentDetail, updatePaymentDetails } from "@/lib/services/invoicing";

const id = "11111111-1111-4111-8111-111111111111";

describe("updatePaymentDetails", () => {
  it("sends the three description fields to the whitelist RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await updatePaymentDetails({ rpc } as unknown as SupabaseClient, {
      payment_id: id,
      method: "check",
      reference: null,
      memo: "Deposited Monday",
    });

    expect(rpc).toHaveBeenCalledWith("acc_update_payment_details", {
      p_payment_id: id,
      p_method: "check",
      p_reference: null,
      p_memo: "Deposited Monday",
    });
  });

  it("surfaces the refusal as InvoicingError", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "A void payment cannot be edited; record a replacement instead" },
    });

    await expect(
      updatePaymentDetails({ rpc } as unknown as SupabaseClient, {
        payment_id: id,
        method: null,
        reference: null,
        memo: null,
      }),
    ).rejects.toEqual(expect.any(InvoicingError));
  });
});

describe("correctPayment", () => {
  it("passes the receipt in the order acc_record_payment expects and returns the new id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "new-payment", error: null });

    const created = await correctPayment({ rpc } as unknown as SupabaseClient, {
      payment_id: id,
      reason: "Wrong amount",
      customer_id: "customer-1",
      payment_date: "2026-08-04",
      currency_code: "USD",
      amount_minor: 12550,
      deposit_account_id: "account-1",
      method: "check",
      reference: "CHK-104",
      memo: null,
      allocations: [{ invoice_id: "invoice-1", amount_minor: 12550 }],
    });

    expect(created).toBe("new-payment");
    expect(rpc).toHaveBeenCalledWith("acc_correct_payment", {
      p_payment_id: id,
      p_reason: "Wrong amount",
      p_customer_id: "customer-1",
      p_payment_date: "2026-08-04",
      p_currency: "USD",
      p_amount_minor: 12550,
      p_deposit_account_id: "account-1",
      p_method: "check",
      p_reference: "CHK-104",
      p_memo: null,
      p_allocations: [{ invoice_id: "invoice-1", amount_minor: 12550 }],
    });
  });

  it("lets the database refusal through", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Cannot void an entry in a closed period (2026-01-31)" },
    });

    await expect(
      correctPayment({ rpc } as unknown as SupabaseClient, {
        payment_id: id,
        reason: "Wrong amount",
        customer_id: "customer-1",
        payment_date: "2026-01-15",
        currency_code: "USD",
        amount_minor: 100,
        deposit_account_id: "account-1",
        method: null,
        reference: null,
        memo: null,
        allocations: [],
      }),
    ).rejects.toThrow(/closed period/);
  });
});

describe("getPaymentDetail", () => {
  it("reads the allocations and the journal entry behind a receipt", async () => {
    const asked: Record<string, string> = {};
    const allocationChain = {
      select(columns: string) {
        asked.allocations = columns;
        return allocationChain;
      },
      eq() {
        return allocationChain;
      },
      order() {
        return Promise.resolve({
          data: [
            {
              id: "alloc-1",
              amount_minor: 5000,
              invoice_id: "invoice-1",
              acc_invoice: {
                invoice_number: "INV-0001",
                total_minor: 12000,
                balance_due_minor: 7000,
                status: "partial",
                currency_code: "USD",
              },
            },
          ],
          error: null,
        });
      },
    };
    const entryChain = {
      select(columns: string) {
        asked.entry = columns;
        return entryChain;
      },
      eq() {
        return entryChain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: {
            id: "entry-1",
            entry_number: "JE-0009",
            entry_date: "2026-08-04",
            status: "posted",
            acc_journal_line: [
              {
                line_order: 2,
                debit_minor: 0,
                credit_minor: 5000,
                memo: null,
                acc_account: { account_code: "1100", name: "Accounts Receivable" },
              },
              {
                line_order: 1,
                debit_minor: 5000,
                credit_minor: 0,
                memo: null,
                acc_account: { account_code: "1010", name: "Checking" },
              },
            ],
          },
          error: null,
        });
      },
    };
    const sb = {
      from: (table: string) => (table === "acc_payment_allocation" ? allocationChain : entryChain),
    } as unknown as SupabaseClient;

    const detail = await getPaymentDetail(sb, { id, journal_entry_id: "entry-1" });

    expect(asked.allocations).toContain("acc_invoice(invoice_number");
    expect(detail.allocations).toEqual([
      {
        invoiceId: "invoice-1",
        invoiceNumber: "INV-0001",
        amountMinor: 5000,
        invoiceTotalMinor: 12000,
        invoiceBalanceMinor: 7000,
        invoiceStatus: "partial",
        currencyCode: "USD",
      },
    ]);
    expect(detail.journal?.entryNumber).toBe("JE-0009");
    // Sorted by line_order, not by the order PostgREST happened to return.
    expect(detail.journal?.lines.map((line) => line.accountCode)).toEqual(["1010", "1100"]);
  });

  it("reports no journal entry rather than failing when the receipt has none", async () => {
    const allocationChain = {
      select: () => allocationChain,
      eq: () => allocationChain,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    const sb = { from: () => allocationChain } as unknown as SupabaseClient;

    const detail = await getPaymentDetail(sb, { id, journal_entry_id: null });

    expect(detail.allocations).toEqual([]);
    expect(detail.journal).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/payment-correction-service.test.ts`

Expected: FAIL because the three functions are not exported.

- [ ] **Step 3: Add the view types**

In `ctyhp-accounting/lib/db/types.ts`, after the `PaymentRow` interface:

```ts
/** One invoice a receipt settled, with that invoice's position afterwards. */
export interface PaymentAllocationView {
  invoiceId: string;
  invoiceNumber: string | null;
  amountMinor: number;
  invoiceTotalMinor: number;
  invoiceBalanceMinor: number;
  invoiceStatus: string;
  currencyCode: string;
}

export interface PaymentJournalLine {
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  memo: string | null;
}

export interface PaymentJournalView {
  entryId: string;
  entryNumber: string;
  entryDate: string;
  status: string;
  lines: PaymentJournalLine[];
}

export interface PaymentDetail {
  allocations: PaymentAllocationView[];
  /** Null for a receipt that never posted an entry. */
  journal: PaymentJournalView | null;
}
```

- [ ] **Step 4: Implement the three service functions**

In `ctyhp-accounting/lib/services/invoicing.ts`, directly below `voidPayment`:

```ts
/** Rewrite only what a receipt says about itself; the RPC is the whitelist. */
export async function updatePaymentDetails(
  sb: SupabaseClient,
  input: PaymentDetailsInput,
): Promise<void> {
  const { error } = await sb.rpc("acc_update_payment_details", {
    p_payment_id: input.payment_id,
    p_method: input.method,
    p_reference: input.reference,
    p_memo: input.memo,
  });
  if (error) throw new InvoicingError(error.message);
}

/**
 * Void a receipt and record its corrected self in one transaction. Returns the
 * new payment's id; the old one keeps its number and reads as void.
 */
export async function correctPayment(
  sb: SupabaseClient,
  input: PaymentCorrectionInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_correct_payment", {
    p_payment_id: input.payment_id,
    p_reason: input.reason,
    p_customer_id: input.customer_id,
    p_payment_date: input.payment_date || undefined,
    p_currency: input.currency_code,
    p_amount_minor: input.amount_minor,
    p_deposit_account_id: input.deposit_account_id,
    p_method: input.method || null,
    p_reference: input.reference || null,
    p_memo: input.memo || null,
    p_allocations: input.allocations,
  });
  if (error) throw new InvoicingError(error.message);
  return data as string;
}

/** What a receipt actually did: which invoices it settled, and how it posted. */
export async function getPaymentDetail(
  sb: SupabaseClient,
  payment: { id: string; journal_entry_id: string | null },
): Promise<PaymentDetail> {
  const { data: allocationData, error: allocationError } = await sb
    .from("acc_payment_allocation")
    .select(
      "id,amount_minor,invoice_id," +
        "acc_invoice(invoice_number,total_minor,balance_due_minor,status,currency_code)",
    )
    .eq("payment_id", payment.id)
    .order("id");
  if (allocationError) throw new InvoicingError(allocationError.message);

  const allocations: PaymentAllocationView[] = (
    (allocationData ?? []) as unknown as Record<string, unknown>[]
  ).map((row) => {
    const invoice = (row.acc_invoice ?? {}) as Record<string, unknown>;
    return {
      invoiceId: row.invoice_id as string,
      invoiceNumber: (invoice.invoice_number as string | null) ?? null,
      amountMinor: Number(row.amount_minor),
      invoiceTotalMinor: Number(invoice.total_minor ?? 0),
      invoiceBalanceMinor: Number(invoice.balance_due_minor ?? 0),
      invoiceStatus: (invoice.status as string) ?? "unknown",
      currencyCode: (invoice.currency_code as string) ?? "USD",
    };
  });

  if (!payment.journal_entry_id) return { allocations, journal: null };

  const { data: entryData, error: entryError } = await sb
    .from("acc_journal_entry")
    .select(
      "id,entry_number,entry_date,status," +
        "acc_journal_line(line_order,debit_minor,credit_minor,memo,acc_account(account_code,name))",
    )
    .eq("id", payment.journal_entry_id)
    .maybeSingle();
  if (entryError) throw new InvoicingError(entryError.message);
  if (!entryData) return { allocations, journal: null };

  const entry = entryData as unknown as Record<string, unknown>;
  const lines = ((entry.acc_journal_line ?? []) as Record<string, unknown>[])
    .slice()
    .sort((a, b) => Number(a.line_order) - Number(b.line_order))
    .map((line) => {
      const account = (line.acc_account ?? {}) as Record<string, unknown>;
      return {
        accountCode: (account.account_code as string) ?? "",
        accountName: (account.name as string) ?? "",
        debitMinor: Number(line.debit_minor),
        creditMinor: Number(line.credit_minor),
        memo: (line.memo as string | null) ?? null,
      };
    });

  return {
    allocations,
    journal: {
      entryId: entry.id as string,
      entryNumber: entry.entry_number as string,
      entryDate: entry.entry_date as string,
      status: entry.status as string,
      lines,
    },
  };
}
```

Extend the two type imports at the top of the file. The existing
`import type { … } from "@/lib/db/types"` gains `PaymentAllocationView` and
`PaymentDetail`; the existing `import type { … } from "@/lib/domain/schemas"`
gains the two input types:

```ts
import type { PaymentAllocationView, PaymentDetail } from "@/lib/db/types";
import type { PaymentCorrectionInput, PaymentDetailsInput } from "@/lib/domain/schemas";
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -- tests/unit/payment-correction-service.test.ts`

Expected: PASS, 5 tests.

Run: `npm run typecheck`

Expected: no output beyond the two npm banner lines.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/db/types.ts ctyhp-accounting/lib/services/invoicing.ts ctyhp-accounting/tests/unit/payment-correction-service.test.ts
git commit -m "Read what a receipt settled, and expose the two ways to change one"
```

---

### Task 4: Server Actions

**Files:**
- Modify: `ctyhp-accounting/app/(app)/payments/actions.ts`
- Test: `ctyhp-accounting/tests/unit/payment-correction-action.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas, Task 3 services, `searchAudit` from `@/lib/services/access`, `hasPermission` from `@/lib/services/access`.
- Produces: `getPaymentDetailAction(payment)`, `getPaymentAuditAction(paymentId)`, `updatePaymentDetailsAction(raw)`, `correctPaymentAction(raw)`.

- [ ] **Step 1: Write the failing action tests**

Create `ctyhp-accounting/tests/unit/payment-correction-action.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  updatePaymentDetails: vi.fn(),
  correctPayment: vi.fn(),
  getPaymentDetail: vi.fn(),
  searchAudit: vi.fn(),
  hasPermission: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getUserRole: mocks.getUserRole, canWrite: mocks.canWrite }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/access", () => ({
  searchAudit: mocks.searchAudit,
  hasPermission: mocks.hasPermission,
}));
vi.mock("@/lib/services/invoicing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/invoicing")>()),
  updatePaymentDetails: mocks.updatePaymentDetails,
  correctPayment: mocks.correctPayment,
  getPaymentDetail: mocks.getPaymentDetail,
}));

import {
  correctPaymentAction,
  getPaymentAuditAction,
  getPaymentDetailAction,
  updatePaymentDetailsAction,
} from "@/app/(app)/payments/actions";

const id = "11111111-1111-4111-8111-111111111111";
const customer = "22222222-2222-4222-8222-222222222222";
const account = "33333333-3333-4333-8333-333333333333";
const paths = [
  "/payments",
  "/invoices",
  "/sales",
  "/dashboard",
  "/reports/ar-aging",
  "/reports/customer-statement",
  "/reports/cash-flow",
  "/reports/transactions",
];

const correction = {
  payment_id: id,
  reason: "  Wrong amount  ",
  customer_id: customer,
  currency_code: "USD",
  amount_minor: 12550,
  deposit_account_id: account,
  allocations: [],
};

describe("payment detail and correction actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRole.mockResolvedValue("admin");
    mocks.canWrite.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ marker: "company-bound" });
    mocks.updatePaymentDetails.mockResolvedValue(undefined);
    mocks.correctPayment.mockResolvedValue("new-payment");
    mocks.getPaymentDetail.mockResolvedValue({ allocations: [], journal: null });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.searchAudit.mockResolvedValue([{ id: "audit-1" }]);
  });

  it("reads a detail through the company-bound client", async () => {
    await expect(
      getPaymentDetailAction({ id, journal_entry_id: "entry-1" }),
    ).resolves.toEqual({ ok: true, data: { allocations: [], journal: null } });
    expect(mocks.getPaymentDetail).toHaveBeenCalledWith(
      { marker: "company-bound" },
      { id, journal_entry_id: "entry-1" },
    );
  });

  it("refuses the audit trail without the audit.read permission", async () => {
    mocks.hasPermission.mockResolvedValue(false);

    await expect(getPaymentAuditAction(id)).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.searchAudit).not.toHaveBeenCalled();
  });

  it("asks the audit log for this payment's own record", async () => {
    await expect(getPaymentAuditAction(id)).resolves.toEqual({ ok: true, data: [{ id: "audit-1" }] });
    expect(mocks.searchAudit).toHaveBeenCalledWith(
      { marker: "company-bound" },
      expect.objectContaining({ table_name: "acc_payment", record_id: id, limit: 200 }),
    );
  });

  it("rejects a description edit from a non-writer before opening a client", async () => {
    mocks.canWrite.mockReturnValue(false);

    await expect(updatePaymentDetailsAction({ payment_id: id })).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("saves trimmed description fields and revalidates the payments list", async () => {
    await expect(
      updatePaymentDetailsAction({ payment_id: id, method: " check ", reference: "", memo: null }),
    ).resolves.toEqual({ ok: true });
    expect(mocks.updatePaymentDetails).toHaveBeenCalledWith({ marker: "company-bound" }, {
      payment_id: id,
      method: "check",
      reference: null,
      memo: null,
    });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/payments"]);
  });

  it("rejects a correction without a reason before calling the service", async () => {
    const result = await correctPaymentAction({ ...correction, reason: "   " });

    expect(result).toMatchObject({ ok: false });
    expect(mocks.correctPayment).not.toHaveBeenCalled();
  });

  it("corrects through the service and revalidates every affected view", async () => {
    await expect(correctPaymentAction(correction)).resolves.toEqual({
      ok: true,
      data: { id: "new-payment" },
    });
    expect(mocks.correctPayment).toHaveBeenCalledWith(
      { marker: "company-bound" },
      expect.objectContaining({ payment_id: id, reason: "Wrong amount" }),
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(paths);
  });

  it("returns the database guard message from a correction", async () => {
    mocks.correctPayment.mockRejectedValue(new Error("Reject or undo the bank match before voiding this payment"));

    await expect(correctPaymentAction(correction)).resolves.toEqual({
      ok: false,
      error: "Reject or undo the bank match before voiding this payment",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/payment-correction-action.test.ts`

Expected: FAIL because none of the four actions exist.

- [ ] **Step 3: Implement the four actions**

In `ctyhp-accounting/app/(app)/payments/actions.ts`, extend the imports:

```ts
import { hasPermission, searchAudit } from "@/lib/services/access";
import {
  recordPayment,
  listOpenInvoicesForCustomer,
  voidPayment,
  updatePaymentDetails,
  correctPayment,
  getPaymentDetail,
  InvoicingError,
} from "@/lib/services/invoicing";
import { paymentCreateSchema, paymentVoidSchema, paymentCorrectionSchema, paymentDetailsSchema } from "@/lib/domain/schemas";
import type { AuditEntryRow, InvoiceRow, PaymentDetail } from "@/lib/db/types";
```

Then append:

```ts
/** What a receipt settled and how it posted. Read-only, so no role gate beyond the session. */
export async function getPaymentDetailAction(payment: {
  id: string;
  journal_entry_id: string | null;
}): Promise<ActionResult<PaymentDetail>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await getPaymentDetail(sb, payment) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** The change history of one receipt, for whoever may read the audit log. */
export async function getPaymentAuditAction(paymentId: string): Promise<ActionResult<AuditEntryRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    if (!(await hasPermission(sb, "audit.read"))) {
      return { ok: false, error: "You do not have permission to perform this action" };
    }
    const entries = await searchAudit(sb, {
      table_name: "acc_payment",
      record_id: paymentId,
      actor_id: null,
      action: null,
      from: null,
      to: null,
      limit: 200,
    });
    return { ok: true, data: entries };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * Fix what a receipt says about itself. Only `/payments` is revalidated: none
 * of these fields reaches a balance, so no report can have changed.
 */
export async function updatePaymentDetailsAction(raw: unknown): Promise<ActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = paymentDetailsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await updatePaymentDetails(sb, parsed.data);
    revalidatePath("/payments");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Void a receipt and record its corrected self; one call, one transaction. */
export async function correctPaymentAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!canWrite(role)) return { ok: false, error: "You do not have permission to perform this action" };
  const parsed = paymentCorrectionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await correctPayment(sb, parsed.data);
    for (const path of PAYMENT_VOID_REVALIDATION_PATHS) revalidatePath(path);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npm test -- tests/unit/payment-correction-action.test.ts tests/unit/payment-void-action.test.ts`

Expected: PASS, both files.

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add 'ctyhp-accounting/app/(app)/payments/actions.ts' ctyhp-accounting/tests/unit/payment-correction-action.test.ts
git commit -m "Authorize reading a receipt's history and changing it two ways"
```

---

### Task 5: The payments screen

**Files:**
- Create: `ctyhp-accounting/app/(app)/payments/PaymentDetailDrawer.tsx`
- Create: `ctyhp-accounting/app/(app)/payments/EditPaymentDetailsModal.tsx`
- Modify: `ctyhp-accounting/app/(app)/payments/ReceivePaymentModal.tsx`
- Modify: `ctyhp-accounting/app/(app)/payments/PaymentsClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/payments/page.tsx`
- Test: `ctyhp-accounting/tests/unit/payment-void-ui-contract.test.ts`

**Interfaces:**
- Consumes: `getPaymentDetailAction`, `getPaymentAuditAction`, `updatePaymentDetailsAction`, `correctPaymentAction`, `voidPaymentAction`, `recordPaymentAction`, `paymentReplacementDraft`, `DocumentAuditTrail`.
- Produces: no new route; `/payments` keeps every existing prop and gains `canReadAudit: boolean`.

- [ ] **Step 1: Extend the UI contract test**

In `ctyhp-accounting/tests/unit/payment-void-ui-contract.test.ts`, add these cases inside the existing `describe`:

```ts
  it("keeps the detail view and the description edit in their own components", () => {
    expect(read("PaymentsClient.tsx")).toContain("<PaymentDetailDrawer");
    expect(read("PaymentsClient.tsx")).toContain("<EditPaymentDetailsModal");
    expect(read("PaymentDetailDrawer.tsx")).toContain("getPaymentDetailAction");
    expect(read("PaymentDetailDrawer.tsx")).toContain("DocumentAuditTrail");
    expect(read("EditPaymentDetailsModal.tsx")).toContain("updatePaymentDetailsAction");
    expect(read("ReceivePaymentModal.tsx")).toContain("correctPaymentAction");
  });

  it("offers every action from one menu", () => {
    const client = read("PaymentsClient.tsx");
    for (const label of ["View", "Edit details", "Correct payment", "Refund", "Void payment"]) {
      expect(client, label).toContain(label);
    }
    expect(read("page.tsx")).toContain('hasPermission(sb, "audit.read")');
  });

  it("never offers to edit or correct a void receipt", () => {
    const client = read("PaymentsClient.tsx");
    expect(client).toMatch(/status !== "void"/);
  });
```

And extend the ceiling loop to the two new files:

```ts
    for (const file of [
      "PaymentsClient.tsx",
      "ReceivePaymentModal.tsx",
      "VoidPaymentModal.tsx",
      "PaymentDetailDrawer.tsx",
      "EditPaymentDetailsModal.tsx",
    ]) {
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test -- tests/unit/payment-void-ui-contract.test.ts`

Expected: FAIL because the two components do not exist.

- [ ] **Step 3: Resolve `audit.read` on the server**

In `ctyhp-accounting/app/(app)/payments/page.tsx`, add `canReadAudit` to the destructured array, `hasPermission(sb, "audit.read")` to the `Promise.all` in the same position, and pass `canReadAudit={canReadAudit}` to `PaymentsClient`. Keep every existing call unchanged.

- [ ] **Step 4: Create `PaymentDetailDrawer.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Alert, Descriptions, Drawer, Spin, Table, Tag, Typography } from "antd";
import DocumentAuditTrail from "@/components/audit/DocumentAuditTrail";
import type { AuditEntryRow, PaymentDetail, PaymentRow } from "@/lib/db/types";
import { formatMoney } from "@/lib/format";
import { getPaymentAuditAction, getPaymentDetailAction } from "./actions";

export interface PaymentDetailDrawerProps {
  payment: (PaymentRow & { customer_name: string }) | null;
  directory: ReadonlyMap<string, string>;
  canReadAudit: boolean;
  decimalsOf: (currencyCode: string) => number;
  onClose: () => void;
}

/**
 * What a receipt did, in one place: the money, the invoices it settled, the
 * entry it posted, and every change since. An auditor should never have to
 * rebuild this from the journal by hand.
 */
export default function PaymentDetailDrawer({
  payment,
  directory,
  canReadAudit,
  decimalsOf,
  onClose,
}: PaymentDetailDrawerProps) {
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [audit, setAudit] = useState<AuditEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!payment) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [detailResult, auditResult] = await Promise.all([
        getPaymentDetailAction({ id: payment.id, journal_entry_id: payment.journal_entry_id }),
        canReadAudit ? getPaymentAuditAction(payment.id) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (detailResult.ok && detailResult.data) {
        setDetail(detailResult.data);
        setError(null);
      } else {
        setDetail(null);
        setError(detailResult.error ?? "Failed to load this payment");
      }
      setAudit(auditResult?.ok && auditResult.data ? auditResult.data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [payment, canReadAudit]);

  const decimals = payment ? decimalsOf(payment.currency_code) : 2;

  return (
    <Drawer
      title={`Payment ${payment?.payment_number ?? "(unnumbered)"}`}
      open={!!payment}
      onClose={onClose}
      width={720}
      destroyOnHidden
    >
      {payment ? (
        <>
          <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Customer">{payment.customer_name}</Descriptions.Item>
            <Descriptions.Item label="Date">{payment.payment_date}</Descriptions.Item>
            <Descriptions.Item label="Method">{payment.method ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Reference">{payment.reference ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Amount">
              {formatMoney(payment.amount_minor, payment.currency_code, decimals)}
            </Descriptions.Item>
            <Descriptions.Item label="Unapplied">
              {formatMoney(payment.unapplied_minor, payment.currency_code, decimals)}
            </Descriptions.Item>
            <Descriptions.Item label="Memo" span={2}>
              {payment.memo ?? "—"}
            </Descriptions.Item>
          </Descriptions>

          {payment.status === "void" ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message="This payment is void"
              description={payment.void_reason ?? "No reason was recorded."}
            />
          ) : null}

          {error ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} /> : null}

          <Typography.Text strong>Invoices settled</Typography.Text>
          <Table
            rowKey="invoiceId"
            size="small"
            pagination={false}
            style={{ margin: "8px 0 16px" }}
            loading={loading}
            dataSource={detail?.allocations ?? []}
            locale={{ emptyText: "This receipt was not applied to any invoice." }}
            columns={[
              { title: "Invoice", dataIndex: "invoiceNumber", render: (n: string | null) => n ?? "—" },
              {
                title: "Applied",
                dataIndex: "amountMinor",
                width: 140,
                align: "right",
                render: (v: number, r) => formatMoney(v, r.currencyCode, decimalsOf(r.currencyCode)),
              },
              {
                title: "Invoice balance now",
                dataIndex: "invoiceBalanceMinor",
                width: 170,
                align: "right",
                render: (v: number, r) => formatMoney(v, r.currencyCode, decimalsOf(r.currencyCode)),
              },
              { title: "Invoice status", dataIndex: "invoiceStatus", width: 130 },
            ]}
          />

          <Typography.Text strong>
            Journal entry{" "}
            {detail?.journal ? (
              <Tag color={detail.journal.status === "posted" ? "green" : "red"}>
                {detail.journal.entryNumber} · {detail.journal.status}
              </Tag>
            ) : null}
          </Typography.Text>
          {loading && !detail ? (
            <div style={{ padding: 16 }}>
              <Spin />
            </div>
          ) : (
            <Table
              rowKey={(row) => `${row.accountCode}-${row.debitMinor}-${row.creditMinor}`}
              size="small"
              pagination={false}
              style={{ margin: "8px 0 16px" }}
              dataSource={detail?.journal?.lines ?? []}
              locale={{ emptyText: "This receipt did not post a journal entry." }}
              columns={[
                {
                  title: "Account",
                  key: "account",
                  render: (_: unknown, r) => `${r.accountCode} — ${r.accountName}`,
                },
                {
                  title: "Debit",
                  dataIndex: "debitMinor",
                  width: 130,
                  align: "right",
                  render: (v: number) =>
                    v ? formatMoney(v, payment.currency_code, decimals) : "—",
                },
                {
                  title: "Credit",
                  dataIndex: "creditMinor",
                  width: 130,
                  align: "right",
                  render: (v: number) =>
                    v ? formatMoney(v, payment.currency_code, decimals) : "—",
                },
              ]}
            />
          )}

          <DocumentAuditTrail
            record={payment}
            directory={directory}
            entries={audit}
            loading={loading}
            canReadAudit={canReadAudit}
          />
        </>
      ) : null}
    </Drawer>
  );
}
```

- [ ] **Step 5: Create `EditPaymentDetailsModal.tsx`**

```tsx
"use client";
import { useState } from "react";
import { App, Form, Input, Modal, Select, Typography } from "antd";
import type { PaymentRow } from "@/lib/db/types";
import { updatePaymentDetailsAction } from "./actions";

export interface EditPaymentDetailsModalProps {
  payment: (PaymentRow & { customer_name: string }) | null;
  onClose: () => void;
  onDone: () => void;
}

/**
 * The description of a receipt, and nothing else. A wrong check number is a
 * typing mistake, not an accounting event — fixing it must not disturb a
 * balance, so the amount, date, customer and allocations are not on this form.
 */
export default function EditPaymentDetailsModal({
  payment,
  onClose,
  onDone,
}: EditPaymentDetailsModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ method?: string | null; reference?: string | null; memo?: string | null }>();
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!payment) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      const result = await updatePaymentDetailsAction({ payment_id: payment.id, ...values });
      if (!result.ok) {
        message.error(result.error ?? "Failed to save the payment details");
        return;
      }
      message.success("Payment details saved");
      onDone();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit details · ${payment?.payment_number ?? "payment"}`}
      open={!!payment}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Save details"
      cancelText="Cancel"
      width={520}
      destroyOnHidden
    >
      {payment ? (
        <>
          <Typography.Paragraph type="secondary">
            Only the description changes. To change the amount, date, customer or which invoices
            this receipt settled, use Correct payment.
          </Typography.Paragraph>
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{
              method: payment.method ?? undefined,
              reference: payment.reference ?? undefined,
              memo: payment.memo ?? undefined,
            }}
          >
            <Form.Item name="method" label="Method">
              <Select
                allowClear
                placeholder="Method"
                options={["cash", "bank_transfer", "card", "check"].map((m) => ({ value: m, label: m }))}
              />
            </Form.Item>
            <Form.Item
              name="reference"
              label="Reference"
              rules={[{ max: 80, message: "Reference cannot exceed 80 characters" }]}
              tooltip="Check number, wire reference or ACH trace — what the bank statement will show"
            >
              <Input placeholder="Check / wire ref" maxLength={80} />
            </Form.Item>
            <Form.Item
              name="memo"
              label="Memo"
              rules={[{ max: 500, message: "Memo cannot exceed 500 characters" }]}
            >
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
          </Form>
        </>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 6: Add correction mode to `ReceivePaymentModal.tsx`**

Replace the `replacement` prop with a discriminated basis, keeping every existing
behaviour for a plain receipt:

```tsx
export type ReceivePaymentBasis =
  | { mode: "replacement"; payment: PaymentRow & { customer_name: string } }
  | { mode: "correction"; payment: PaymentRow & { customer_name: string } };

export interface ReceivePaymentModalProps {
  open: boolean;
  /** Null for an ordinary receipt. */
  basis: ReceivePaymentBasis | null;
  customers: CustomerRow[];
  depositAccounts: AccountRow[];
  currencies: CurrencyRow[];
  onClose: () => void;
  onDone: () => void;
}
```

Inside the component, derive the source and prefill exactly as the replacement
mode already does, and require a reason in correction mode:

```tsx
const source = basis?.payment ?? null;
const draft = source ? paymentReplacementDraft(source, decimalsOf(source.currency_code)) : null;
const correcting = basis?.mode === "correction";
const title = correcting
  ? "Correct payment"
  : basis
    ? "Create replacement payment"
    : "Receive payment";
```

Add the reason field, rendered only when correcting, above the customer row:

```tsx
{correcting ? (
  <Form.Item
    name="reason"
    label="What was wrong?"
    rules={[
      { required: true, message: "Explain what was wrong with this payment" },
      { max: 500, message: "A reason cannot exceed 500 characters" },
    ]}
  >
    <Input.TextArea rows={2} maxLength={500} showCount placeholder="Amount was $319.19, not $3,191.90" />
  </Form.Item>
) : null}
```

And branch the submission, leaving the plain and replacement paths untouched:

```tsx
const res = correcting && source
  ? await correctPaymentAction({
      payment_id: source.id,
      reason: v.reason,
      customer_id: v.customer_id,
      payment_date: v.payment_date ? v.payment_date.format("YYYY-MM-DD") : undefined,
      currency_code: v.currency_code,
      amount_minor: toMinorUnits(Number(v.amount), dec),
      deposit_account_id: v.deposit_account_id,
      method: v.method ?? null,
      reference: v.reference ?? null,
      memo: v.memo ?? null,
      allocations,
    })
  : await recordPaymentAction({ /* unchanged existing object */ });
```

Success copy: `"Payment corrected; the original is void and a new receipt was posted"` when
correcting, the existing replacement and plain messages otherwise. The
`Alert` at the top of the modal explains correction mode:

```tsx
message={correcting
  ? `Correcting ${source?.payment_number ?? "this payment"}`
  : `Replacing ${source?.payment_number ?? "a void payment"}`}
description={correcting
  ? "The original keeps its number and will read as void, with your reason recorded against it. This posts a new receipt in one step — if anything refuses, nothing changes."
  : "The void payment and its number stay on record. This is a new receipt — check the amount and choose the invoices it settles."}
```

- [ ] **Step 7: Recompose `PaymentsClient.tsx`**

Replace the inline action buttons with a `···` menu, and add the two new pieces
of state. Keep the paperclip icon outside the menu — it is the one action people
use repeatedly.

```tsx
import { Button, Dropdown, Space, Table, Tag, Tooltip, type MenuProps, type TableColumnsType } from "antd";
import { MoreOutlined, PaperClipOutlined, PlusOutlined } from "@ant-design/icons";
import ReceivePaymentModal, { type ReceivePaymentBasis } from "./ReceivePaymentModal";
import PaymentDetailDrawer from "./PaymentDetailDrawer";
import EditPaymentDetailsModal from "./EditPaymentDetailsModal";
```

The component's props gain `canReadAudit: boolean` beside the existing document
permissions, and the `···` menu replaces `replacementFor` state with `basis`, so
delete `replacementFor` and its setter.

```tsx
  const [detailFor, setDetailFor] = useState<PaymentListRow | null>(null);
  const [editFor, setEditFor] = useState<PaymentListRow | null>(null);
  const [basis, setBasis] = useState<ReceivePaymentBasis | null>(null);
```

```tsx
  function actionsFor(row: PaymentListRow): MenuProps["items"] {
    const live = row.status !== "void";
    return [
      { key: "view", label: "View", onClick: () => setDetailFor(row) },
      ...(canWrite && live
        ? [
            { key: "edit", label: "Edit details", onClick: () => setEditFor(row) },
            {
              key: "correct",
              label: "Correct payment",
              onClick: () => openReceive({ mode: "correction", payment: row }),
            },
          ]
        : []),
      ...(canWrite && live && row.unapplied_minor > 0
        ? [{ key: "refund", label: "Refund", onClick: () => setRefundFor(row) }]
        : []),
      ...(canWrite && live
        ? [{ key: "void", label: "Void payment", danger: true, onClick: () => setVoidFor(row) }]
        : []),
      ...(canWrite && !live
        ? [
            {
              key: "replace",
              label: "Create replacement",
              onClick: () => openReceive({ mode: "replacement", payment: row }),
            },
          ]
        : []),
    ];
  }
```

The Actions column becomes:

```tsx
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_: unknown, r) => (
        <Space size={4}>
          {canReadDocuments ? (
            <IconActionButton
              label="View payment attachments"
              icon={<PaperClipOutlined />}
              onClick={() =>
                setAttachmentTarget({
                  entityType: "payment",
                  entityId: r.id,
                  label: `${r.payment_number ?? "Payment"} · ${r.customer_name}`,
                })
              }
            />
          ) : null}
          <Dropdown menu={{ items: actionsFor(r) }} trigger={["click"]}>
            <Button size="small" icon={<MoreOutlined />} aria-label={`Actions for ${r.payment_number ?? "payment"}`} />
          </Dropdown>
        </Space>
      ),
    },
```

`openReceive` takes the basis and bumps the session counter that already forces a
fresh mount:

```tsx
  function openReceive(next: ReceivePaymentBasis | null) {
    setBasis(next);
    setReceiveSession((n) => n + 1);
    setReceiveOpen(true);
  }
```

The existing `ReceivePaymentModal` composition passes the basis instead of the
replacement, and its close handler clears the basis:

```tsx
      {receiveOpen && (
        <ReceivePaymentModal
          key={`receive-${receiveSession}`}
          open={receiveOpen}
          basis={basis}
          customers={customers}
          depositAccounts={depositAccounts}
          currencies={currencies}
          onClose={() => {
            setReceiveOpen(false);
            setBasis(null);
          }}
          onDone={() => router.refresh()}
        />
      )}
```

The "Receive payment" button calls `openReceive(null)`.

Compose the two new components beside the existing ones, passing
`directory` and the new `canReadAudit` prop through:

```tsx
      <PaymentDetailDrawer
        payment={detailFor}
        directory={directory}
        canReadAudit={canReadAudit}
        decimalsOf={decimalsOf}
        onClose={() => setDetailFor(null)}
      />

      <EditPaymentDetailsModal
        payment={editFor}
        onClose={() => setEditFor(null)}
        onDone={() => router.refresh()}
      />
```

- [ ] **Step 8: Run focused tests, typecheck and targeted lint**

Run:

```bash
npm test -- tests/unit/payment-void-ui-contract.test.ts tests/unit/rsc-antd.test.ts
npm run typecheck
npx eslint 'app/(app)/payments/*.tsx' 'app/(app)/payments/actions.ts'
```

Expected: tests pass, typecheck clean, eslint reports nothing. If eslint reports
`react-hooks/set-state-in-effect`, move the `setState` call into the async
callback inside the effect — never add a disable comment for that rule.

- [ ] **Step 9: Commit**

```bash
git add 'ctyhp-accounting/app/(app)/payments' ctyhp-accounting/tests/unit/payment-void-ui-contract.test.ts
git commit -m "Open a receipt, fix its description, or correct it in one step"
```

---

### Task 6: Behavioural verification and the full gates

**Files:**
- Create: `ctyhp-accounting/scripts/verify-payment-correction.mjs`
- Modify: `ctyhp-accounting/scripts/smoke-payments-void.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes: migrations 0095 and 0096 and the live database shape through `SUPABASE_DB_URL`.
- Produces: `npm run verify:payment-correction`, which proves the correction inside one rolled-back transaction.

- [ ] **Step 1: Add the package script**

In `ctyhp-accounting/package.json`, beside `verify:void-payment`:

```json
"verify:payment-correction": "node --env-file=.env.local scripts/verify-payment-correction.mjs",
```

- [ ] **Step 2: Write the rollback-only harness**

Create `ctyhp-accounting/scripts/verify-payment-correction.mjs`. Copy the header
comment, `client`, `TODAY`, `check`, `one`, `all`, `scenario`, and
`recordPaymentOnOpenInvoice` from `scripts/verify-void-payment.mjs` verbatim —
they are already proven — then use this body. Never write an executable `commit`.

```js
/** Attempt an RPC and return the refusal message, or null when it succeeded. */
async function attempt(sql, params) {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

async function main() {
  await client.connect();
  const admin =
    process.env.ADMIN_USER_ID ??
    (
      await one(
        `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
      )
    )?.id;
  if (!admin) {
    console.error("No active admin to authenticate as; set ADMIN_USER_ID.");
    process.exit(1);
  }
  const asAdmin = () =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin, role: "authenticated" }),
    ]);

  await client.query("begin");
  try {
    const migration = await readFile(
      new URL("../supabase/migrations/0096_payment_details_and_correction.sql", import.meta.url),
      "utf8",
    );
    await client.query(migration);
    console.log("Applied 0096 inside the transaction (never committed).");
    await asAdmin();

    // --- 1. A correction replaces the receipt -------------------------------
    await scenario("correcting a receipt voids it and posts its replacement", async () => {
      const { payment, invoiceAfterPayment, amount } = await recordPaymentOnOpenInvoice();
      const corrected = Math.max(1, Math.floor(amount / 2));
      await client.query("savepoint before_call");
      const created = await one(
        `select acc_correct_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as id`,
        [
          payment.id,
          "Amount was entered ten times too high",
          payment.customer_id,
          TODAY,
          payment.currency_code,
          corrected,
          payment.deposit_account_id,
          "wire",
          "REF-CORRECTED",
          "Corrected receipt",
          JSON.stringify([{ invoice_id: invoiceAfterPayment.id, amount_minor: corrected }]),
        ],
      );
      check("a new payment id came back", Boolean(created?.id));

      const original = await one(`select * from acc_payment where id = $1`, [payment.id]);
      check("the original is void", original.status === "void");
      check("its number is unchanged", original.payment_number === payment.payment_number);
      check("the reason is recorded", /ten times too high/.test(original.void_reason ?? ""));

      const replacement = await one(`select * from acc_payment where id = $1`, [created.id]);
      check("the replacement holds the corrected amount", Number(replacement.amount_minor) === corrected);
      check("it has its own number", replacement.payment_number !== payment.payment_number);
      check("it is not void", replacement.status !== "void");

      const invoice = await one(`select balance_due_minor from acc_invoice where id = $1`, [
        invoiceAfterPayment.id,
      ]);
      check(
        "the invoice reflects the corrected amount only",
        Number(invoice.balance_due_minor) ===
          Number(invoiceAfterPayment.balance_due_minor) + amount - corrected,
        `${invoice.balance_due_minor}`,
      );

      const entries = await all(
        `select id, status from acc_journal_entry where id in ($1, $2)`,
        [payment.journal_entry_id, replacement.journal_entry_id],
      );
      const byId = new Map(entries.map((row) => [row.id, row.status]));
      check("the old entry is void", byId.get(payment.journal_entry_id) === "void");
      check("the new entry is posted", byId.get(replacement.journal_entry_id) === "posted");
    });

    // --- 2. A description edit touches nothing else -------------------------
    await scenario("editing the description leaves every posting field alone", async () => {
      const { payment } = await recordPaymentOnOpenInvoice();
      await client.query("savepoint before_call");
      const refusal = await attempt(`select acc_update_payment_details($1, $2, $3, $4)`, [
        payment.id,
        "wire",
        "REF-9",
        "Deposited Monday",
      ]);
      check("the edit succeeded", refusal === null, refusal ?? "");

      const after = await one(`select * from acc_payment where id = $1`, [payment.id]);
      check("method changed", after.method === "wire");
      check("reference changed", after.reference === "REF-9");
      check("memo changed", after.memo === "Deposited Monday");
      for (const column of ["amount_minor", "payment_date", "customer_id", "deposit_account_id", "status"]) {
        check(`${column} is untouched`, String(after[column]) === String(payment[column]));
      }
    });

    // --- 3. A void receipt refuses the edit ---------------------------------
    await scenario("a void receipt cannot be edited", async () => {
      const { payment } = await recordPaymentOnOpenInvoice();
      await client.query(`select acc_void_payment($1, $2)`, [payment.id, "Rollback verification"]);
      await client.query("savepoint before_call");
      const refusal = await attempt(`select acc_update_payment_details($1, $2, $3, $4)`, [
        payment.id,
        "wire",
        null,
        null,
      ]);
      check("the edit is refused", /cannot be edited/i.test(refusal ?? ""), refusal ?? "none");
    });

    // --- 4. A closed period refuses the correction atomically ---------------
    await scenario("a closed period refuses the correction and leaves no new receipt", async () => {
      const { payment, invoiceAfterPayment } = await recordPaymentOnOpenInvoice();
      const before = await one(`select count(*)::int as n from acc_payment`);
      const entry = await one(`select entry_date from acc_journal_entry where id = $1`, [
        payment.journal_entry_id,
      ]);
      const period = await one(
        `select id from acc_accounting_period where $1 between period_start and period_end`,
        [entry.entry_date],
      );
      if (period) {
        await client.query(
          `update acc_accounting_period set status = 'closed', closed_at = now() where id = $1`,
          [period.id],
        );
      } else {
        await client.query(
          `insert into acc_accounting_period
             (fiscal_year, period_month, period_start, period_end, label, status, closed_at)
           values (extract(year from $1::date)::int, extract(month from $1::date)::int,
                   date_trunc('month', $1::date)::date,
                   (date_trunc('month', $1::date) + interval '1 month - 1 day')::date,
                   to_char($1::date, 'Mon YYYY'), 'closed', now())`,
          [entry.entry_date],
        );
      }

      await client.query("savepoint before_call");
      const refusal = await attempt(
        `select acc_correct_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          payment.id,
          "Wrong amount",
          payment.customer_id,
          TODAY,
          payment.currency_code,
          100,
          payment.deposit_account_id,
          null,
          null,
          null,
          JSON.stringify([]),
        ],
      );
      check("the correction is refused", /closed period/i.test(refusal ?? ""), refusal ?? "none");
      const state = await one(
        `select p.status, i.balance_due_minor from acc_payment p
           join acc_invoice i on i.id = $2 where p.id = $1`,
        [payment.id, invoiceAfterPayment.id],
      );
      check("the original is still live", state.status !== "void");
      check(
        "the invoice is unchanged",
        Number(state.balance_due_minor) === Number(invoiceAfterPayment.balance_due_minor),
      );
      const after = await one(`select count(*)::int as n from acc_payment`);
      check("no replacement was created", after.n === before.n, `${before.n} -> ${after.n}`);
    });

    // --- 5. Authorization belongs to the database --------------------------
    await scenario("a viewer cannot edit or correct anything", async () => {
      const { payment } = await recordPaymentOnOpenInvoice();
      const viewer = await one(
        `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
      );
      if (!viewer) {
        console.log("  SKIP  no active viewer to authenticate as");
        return;
      }
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: viewer.id, role: "authenticated" }),
      ]);
      await client.query("savepoint before_call");
      const edit = await attempt(`select acc_update_payment_details($1, $2, $3, $4)`, [
        payment.id,
        "wire",
        null,
        null,
      ]);
      check("the edit is refused", /Not authorized/i.test(edit ?? ""), edit ?? "none");
      await client.query("savepoint before_call");
      const correct = await attempt(
        `select acc_correct_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          payment.id,
          "Wrong amount",
          payment.customer_id,
          TODAY,
          payment.currency_code,
          100,
          payment.deposit_account_id,
          null,
          null,
          null,
          JSON.stringify([]),
        ],
      );
      check("the correction is refused", /Not authorized/i.test(correct ?? ""), correct ?? "none");
      await asAdmin();
    });
  } finally {
    await client.query("rollback");
    console.log("\nROLLBACK — nothing above was kept.");
    await client.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

await main();
```

- [ ] **Step 3: Static safety check before connecting**

Run:

```bash
grep -niE "^[^/*]*\b(commit)\b|delete from acc_payment" scripts/verify-payment-correction.mjs
npm run security:check-source
```

Expected: the grep prints nothing, and the credential check passes.

- [ ] **Step 4: Run the harness**

Run: `npm run verify:payment-correction`

Expected: every scenario prints PASS, the final line confirms `ROLLBACK`, and the
summary reads `0 failed`. Do not run if `SUPABASE_DB_URL` is missing, and do not
run `scripts/migrate.mjs` as part of this task.

- [ ] **Step 5: Extend the built-page smoke check**

In `ctyhp-accounting/scripts/smoke-payments-void.mjs`, add these assertions
beside the existing ones:

```js
check("the detail view is offered", shipped.includes("Invoices settled"));
check("the description edit is offered", shipped.includes("Edit details"));
check("the one-step correction is offered", shipped.includes("Correct payment"));
```

- [ ] **Step 6: Run every project gate**

Run, recording real output:

```bash
npm test
npm run typecheck
npm run lint
npm run security:check-source
npm run build
```

Expected: all tests pass, typecheck and the credential check are clean, lint has
zero errors and only the eleven pre-existing `scripts/verify-*.mjs` warnings, and
the build exits 0 with `/payments` present.

- [ ] **Step 7: Run the smoke sweep against the built server**

Start the built server, then run:

```bash
node --env-file=.env.local scripts/smoke-pages.mjs http://127.0.0.1:3000
node --env-file=.env.local scripts/smoke-payments-void.mjs http://127.0.0.1:3000
```

Expected: every page returns 200, and every payments control assertion passes.
Stop the server afterwards; port 3000 must be free for the next run.

- [ ] **Step 8: Review the diff and commit**

Run:

```bash
git diff --check
git status --short
git log --oneline -8
```

Confirm only planned files changed and that the user-owned `.claude/settings.json`
is untouched, then:

```bash
git add ctyhp-accounting/scripts/verify-payment-correction.mjs ctyhp-accounting/scripts/smoke-payments-void.mjs ctyhp-accounting/package.json
git commit -m "Prove a correction is one transaction, against real books"
```

- [ ] **Step 9: Apply the migration and report**

Migration 0096 must reach every company before the screen can use it:

```bash
node --env-file=.env.local scripts/migrate.mjs
```

Expected: `0096_payment_details_and_correction.sql ... ok` for `public` and each
company schema. Confirm afterwards that `acc_correct_payment` and
`acc_update_payment_details` exist in all four schemas before reporting the
feature as usable.
