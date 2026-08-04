# Void Customer Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an audit-safe Void action for posted customer payments, restore invoice balances atomically, and let users create a reviewed replacement payment.

**Architecture:** A company-scoped PostgreSQL RPC owns every accounting mutation and guard. The service and Server Action are thin validated adapters, while route-local Receive and Void modals keep `PaymentsClient.tsx` below the 400-line project ceiling. A replacement is a pre-filled new payment through the existing posting action, never an unvoid.

**Tech Stack:** Next.js 16 App Router and Server Actions, React 19, TypeScript, Ant Design, Zod, Supabase/PostgreSQL PL/pgSQL, Vitest, Node `pg` rollback verification.

## Global Constraints

- Do not physically delete a numbered customer payment, its allocations, journal, or attachments.
- Do not reactivate a void payment or journal entry; replacement always creates a new payment.
- Require a trimmed void reason of 1-500 characters.
- Preserve existing permissions in both the Server Action (`canWrite`) and RPC (`acc_is_staff`).
- Preserve schema isolation: the migration must be company-scoped and retarget cleanly from `public` to every registered company schema.
- Preserve the existing Receive payment and Refund behavior and copy except where replacement mode requires an explicit title/success message.
- Do not duplicate posting, allocation, currency, or accounting-period rules in TypeScript.
- Do not mutate production data during verification; database behavioral verification must run inside one transaction and end with `ROLLBACK`.
- Keep `PaymentsClient.tsx` and every newly created TS/TSX file below 400 lines.
- Read the checked-in Next.js 16 Server Actions and `revalidatePath` documentation before implementation.

---

## File Map

- Create `ctyhp-accounting/supabase/migrations/0095_void_customer_payments.sql`: attribution columns, backfill, constraints, atomic void RPC, grants.
- Create `ctyhp-accounting/lib/domain/payment-void.ts`: pure conversion from a voided `PaymentRow` to replacement-form defaults.
- Modify `ctyhp-accounting/lib/domain/schemas.ts`: `paymentVoidSchema` and `PaymentVoidInput`.
- Modify `ctyhp-accounting/lib/db/types.ts`: payment void attribution fields.
- Modify `ctyhp-accounting/lib/services/invoicing.ts`: select attribution fields and expose `voidPayment`.
- Modify `ctyhp-accounting/app/(app)/payments/actions.ts`: validated, authorized void action and targeted revalidation.
- Modify `ctyhp-accounting/app/(app)/payments/page.tsx`: load actor directory.
- Create `ctyhp-accounting/app/(app)/payments/ReceivePaymentModal.tsx`: existing receipt form plus replacement prefill.
- Create `ctyhp-accounting/app/(app)/payments/VoidPaymentModal.tsx`: reason and consequences confirmation.
- Modify `ctyhp-accounting/app/(app)/payments/PaymentsClient.tsx`: table actions, attribution, and modal composition.
- Create `ctyhp-accounting/tests/unit/payment-void-schema.test.ts`: Zod and replacement-draft behavior.
- Create `ctyhp-accounting/tests/unit/payment-void-migration.test.ts`: SQL safety and multi-company contract.
- Create `ctyhp-accounting/tests/unit/payment-void-service.test.ts`: Supabase RPC adapter behavior.
- Create `ctyhp-accounting/tests/unit/payment-void-action.test.ts`: authorization, validation, service, and revalidation contract.
- Create `ctyhp-accounting/tests/unit/payment-void-ui-contract.test.ts`: route/component wiring and 400-line ceiling.
- Create `ctyhp-accounting/scripts/verify-void-payment.mjs`: rollback-only database behavioral verification.
- Modify `ctyhp-accounting/package.json`: `verify:void-payment` script.

---

### Task 1: Validation and replacement defaults

**Files:**
- Create: `ctyhp-accounting/lib/domain/payment-void.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Test: `ctyhp-accounting/tests/unit/payment-void-schema.test.ts`

**Interfaces:**
- Produces: `paymentVoidSchema`, `PaymentVoidInput`.
- Produces: `paymentReplacementDraft(payment, decimalPlaces): PaymentReplacementDraft`.
- Consumes: `PaymentRow` and integer currency precision.

- [ ] **Step 1: Write the failing schema and pure-helper tests**

```ts
import { describe, expect, it } from "vitest";
import { paymentVoidSchema } from "@/lib/domain/schemas";
import { paymentReplacementDraft } from "@/lib/domain/payment-void";

const id = "11111111-1111-4111-8111-111111111111";

describe("paymentVoidSchema", () => {
  it("trims and accepts an attributable void reason", () => {
    expect(paymentVoidSchema.parse({ payment_id: id, reason: "  Demo entered twice  " }))
      .toEqual({ payment_id: id, reason: "Demo entered twice" });
  });

  it("rejects an invalid id, a blank reason, and more than 500 characters", () => {
    expect(paymentVoidSchema.safeParse({ payment_id: "bad", reason: "duplicate" }).success).toBe(false);
    expect(paymentVoidSchema.safeParse({ payment_id: id, reason: "   " }).success).toBe(false);
    expect(paymentVoidSchema.safeParse({ payment_id: id, reason: "x".repeat(501) }).success).toBe(false);
  });
});

describe("paymentReplacementDraft", () => {
  it("prefills source facts in major units without carrying allocations", () => {
    expect(paymentReplacementDraft({
      customer_id: "22222222-2222-4222-8222-222222222222",
      payment_date: "2026-08-04",
      currency_code: "USD",
      amount_minor: 12550,
      deposit_account_id: "33333333-3333-4333-8333-333333333333",
      method: "check",
      reference: "CHK-104",
      memo: "Replacement source",
    }, 2)).toEqual({
      customer_id: "22222222-2222-4222-8222-222222222222",
      payment_date: "2026-08-04",
      currency_code: "USD",
      amount: 125.5,
      deposit_account_id: "33333333-3333-4333-8333-333333333333",
      method: "check",
      reference: "CHK-104",
      memo: "Replacement source",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify the expected RED state**

Run: `npm test -- tests/unit/payment-void-schema.test.ts`

Expected: FAIL because `paymentVoidSchema` and `paymentReplacementDraft` do not exist.

- [ ] **Step 3: Add the validation and pure replacement mapper**

Add to `lib/domain/schemas.ts`:

```ts
export const paymentVoidSchema = z.object({
  payment_id: z.uuid("Select a payment"),
  reason: z.string().trim().min(1, "Explain why this payment is being voided").max(500),
});
export type PaymentVoidInput = z.infer<typeof paymentVoidSchema>;
```

Create `lib/domain/payment-void.ts`:

```ts
import type { PaymentRow } from "@/lib/db/types";

type ReplacementSource = Pick<
  PaymentRow,
  | "customer_id"
  | "payment_date"
  | "currency_code"
  | "amount_minor"
  | "deposit_account_id"
  | "method"
  | "reference"
  | "memo"
>;

export interface PaymentReplacementDraft {
  customer_id: string;
  payment_date: string;
  currency_code: string;
  amount: number;
  deposit_account_id: string;
  method: string | null;
  reference: string | null;
  memo: string | null;
}

export function paymentReplacementDraft(
  payment: ReplacementSource,
  decimalPlaces: number,
): PaymentReplacementDraft {
  return {
    customer_id: payment.customer_id,
    payment_date: payment.payment_date,
    currency_code: payment.currency_code,
    amount: payment.amount_minor / 10 ** decimalPlaces,
    deposit_account_id: payment.deposit_account_id,
    method: payment.method,
    reference: payment.reference,
    memo: payment.memo,
  };
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/unit/payment-void-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the pure contract**

```powershell
git add ctyhp-accounting/lib/domain/payment-void.ts ctyhp-accounting/lib/domain/schemas.ts ctyhp-accounting/tests/unit/payment-void-schema.test.ts
git commit -m "test: define customer payment void contract"
```

---

### Task 2: Company-scoped atomic void RPC

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0095_void_customer_payments.sql`
- Test: `ctyhp-accounting/tests/unit/payment-void-migration.test.ts`
- Test: `ctyhp-accounting/tests/unit/schema-template.test.ts`

**Interfaces:**
- Consumes: `acc_payment`, `acc_payment_allocation`, `acc_invoice`, `acc_journal_entry`, `acc_customer_refund`, `acc_reconciliation`, `acc_reconciliation_line`, and existing actor/audit/closed-period triggers.
- Produces: `acc_void_payment(p_payment_id uuid, p_reason text) returns void`.
- Produces: nullable `voided_at`, `voided_by`, `void_reason` on `acc_payment`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0095_void_customer_payments.sql";
const migrationPath = join(process.cwd(), "supabase", "migrations", file);

describe("customer payment void migration", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("attributes a void and exposes one atomic RPC", () => {
    expect(sql).toContain("add column if not exists voided_at timestamptz");
    expect(sql).toContain("add column if not exists voided_by uuid references auth.users (id)");
    expect(sql).toContain("add column if not exists void_reason text");
    expect(sql).toMatch(/create or replace function acc_void_payment\s*\(/i);
    expect(sql).toContain("p_reason text");
  });

  it("locks and guards every downstream dependency", () => {
    expect(sql).toMatch(/from acc_payment where id = p_payment_id for update/i);
    expect(sql).toContain("acc_customer_refund");
    expect(sql).toContain("acc_reconciliation");
    expect(sql).toContain("acc_reconciliation_line");
    expect(sql).toContain("acc_payment_allocation");
  });

  it("restores invoices and voids history without deleting it", () => {
    expect(sql).toMatch(/balance_due_minor\s*=\s*v_restored/i);
    expect(sql).toMatch(/update acc_journal_entry\s+set status = 'void'/i);
    expect(sql).toMatch(/update acc_payment\s+set status = 'void'/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_payment/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_payment_allocation/i);
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
```

- [ ] **Step 2: Run the migration tests and verify RED**

Run: `npm test -- tests/unit/payment-void-migration.test.ts tests/unit/schema-template.test.ts`

Expected: FAIL because migration 0095 does not exist.

- [ ] **Step 3: Create migration 0095 with backfill and metadata constraint**

Use this schema contract:

```sql
alter table acc_payment
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users (id),
  add column if not exists void_reason text;

update acc_payment
   set voided_at = coalesce(voided_at, updated_at, created_at),
       voided_by = coalesce(voided_by, updated_by, created_by),
       void_reason = coalesce(nullif(btrim(void_reason), ''), 'Voided before attribution was introduced')
 where status = 'void';

alter table acc_payment drop constraint if exists acc_payment_void_metadata_ck;
alter table acc_payment add constraint acc_payment_void_metadata_ck check (
  (status = 'void' and voided_at is not null
    and void_reason is not null and length(btrim(void_reason)) between 1 and 500)
  or
  (status <> 'void' and voided_at is null and voided_by is null and void_reason is null)
);
```

- [ ] **Step 4: Add the complete atomic RPC and grants**

```sql
create or replace function acc_void_payment(
  p_payment_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment acc_payment;
  v_invoice acc_invoice;
  v_allocation record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_restored bigint;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to void customer payments';
  end if;
  if length(v_reason) = 0 then
    raise exception 'A void reason is required';
  end if;
  if length(v_reason) > 500 then
    raise exception 'A void reason cannot exceed 500 characters';
  end if;

  select * into v_payment
    from acc_payment where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_payment.status = 'void' then raise exception 'Payment is already void'; end if;

  if exists (
    select 1 from acc_customer_refund
     where payment_id = p_payment_id and status <> 'void'
  ) then
    raise exception 'Void the customer refund before voiding this payment';
  end if;

  if exists (
    select 1 from acc_reconciliation
     where payment_id = p_payment_id and status in ('suggested', 'approved')
  ) then
    raise exception 'Reject or undo the bank match before voiding this payment';
  end if;

  if exists (
    select 1
      from acc_reconciliation_line line
      join acc_journal_line journal_line on journal_line.id = line.journal_line_id
     where journal_line.journal_entry_id = v_payment.journal_entry_id
  ) then
    raise exception 'Remove this payment from statement reconciliation before voiding it';
  end if;

  for v_allocation in
    select invoice_id, amount_minor
      from acc_payment_allocation
     where payment_id = p_payment_id
     order by id
  loop
    select * into v_invoice
      from acc_invoice where id = v_allocation.invoice_id for update;
    if v_invoice.status <> 'void' then
      v_restored := least(
        v_invoice.total_minor,
        v_invoice.balance_due_minor + v_allocation.amount_minor
      );
      update acc_invoice
         set balance_due_minor = v_restored,
             status = (case
               when v_restored = 0 then 'paid'
               when v_restored >= total_minor then 'issued'
               else 'partial'
             end)::acc_invoice_status,
             updated_at = now()
       where id = v_invoice.id;
    end if;
  end loop;

  if v_payment.journal_entry_id is not null then
    update acc_journal_entry
       set status = 'void', voided_at = now()
     where id = v_payment.journal_entry_id;
  end if;

  update acc_payment
     set status = 'void',
         unapplied_minor = 0,
         voided_at = now(),
         voided_by = auth.uid(),
         void_reason = v_reason,
         updated_at = now()
   where id = p_payment_id;
end;
$$;

revoke all on function acc_void_payment(uuid, text) from public;
grant execute on function acc_void_payment(uuid, text) to authenticated, service_role;
```

The journal update deliberately relies on `acc_journal_entry_closed_period_void`.
If it rejects the void, PostgreSQL rolls back the earlier invoice restorations.

- [ ] **Step 5: Run migration and schema-template tests**

Run: `npm test -- tests/unit/payment-void-migration.test.ts tests/unit/schema-template.test.ts`

Expected: PASS, including no statement pinned to `public` in a company plan.

- [ ] **Step 6: Commit the database boundary**

```powershell
git add ctyhp-accounting/supabase/migrations/0095_void_customer_payments.sql ctyhp-accounting/tests/unit/payment-void-migration.test.ts
git commit -m "feat: add atomic customer payment void"
```

---

### Task 3: Typed service adapter

**Files:**
- Modify: `ctyhp-accounting/lib/db/types.ts:219-235`
- Modify: `ctyhp-accounting/lib/services/invoicing.ts:235-280`
- Test: `ctyhp-accounting/tests/unit/payment-void-service.test.ts`

**Interfaces:**
- Consumes: `acc_void_payment(p_payment_id, p_reason)` from Task 2.
- Produces: `voidPayment(sb: SupabaseClient, paymentId: string, reason: string): Promise<void>`.
- Produces: `PaymentRow.voided_at`, `.voided_by`, `.void_reason`.

- [ ] **Step 1: Write the failing service tests**

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InvoicingError, voidPayment } from "@/lib/services/invoicing";

vi.mock("server-only", () => ({}));

describe("voidPayment", () => {
  it("delegates to the company-bound client's atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await voidPayment({ rpc } as unknown as SupabaseClient, "payment-1", "Demo entered twice");
    expect(rpc).toHaveBeenCalledWith("acc_void_payment", {
      p_payment_id: "payment-1",
      p_reason: "Demo entered twice",
    });
  });

  it("surfaces the database refusal as InvoicingError", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Reject or undo the bank match before voiding this payment" },
    });
    await expect(voidPayment(
      { rpc } as unknown as SupabaseClient,
      "payment-1",
      "Duplicate",
    )).rejects.toEqual(expect.any(InvoicingError));
  });
});
```

- [ ] **Step 2: Run the service test and verify RED**

Run: `npm test -- tests/unit/payment-void-service.test.ts`

Expected: FAIL because `voidPayment` is not exported.

- [ ] **Step 3: Extend the row type and list query**

Add to `PaymentRow`:

```ts
voided_at: string | null;
voided_by: string | null;
void_reason: string | null;
```

Add `voided_at,voided_by,void_reason` to the `listPayments` select string.

- [ ] **Step 4: Implement the thin service adapter**

```ts
export async function voidPayment(
  sb: SupabaseClient,
  paymentId: string,
  reason: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_void_payment", {
    p_payment_id: paymentId,
    p_reason: reason,
  });
  if (error) throw new InvoicingError(error.message);
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- tests/unit/payment-void-service.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the adapter**

```powershell
git add ctyhp-accounting/lib/db/types.ts ctyhp-accounting/lib/services/invoicing.ts ctyhp-accounting/tests/unit/payment-void-service.test.ts
git commit -m "feat: expose customer payment void service"
```

---

### Task 4: Authorized Server Action and cache invalidation

**Files:**
- Modify: `ctyhp-accounting/app/(app)/payments/actions.ts`
- Test: `ctyhp-accounting/tests/unit/payment-void-action.test.ts`

**Interfaces:**
- Consumes: `paymentVoidSchema` from Task 1 and `voidPayment` from Task 3.
- Produces: `voidPaymentAction(paymentId: string, reason: string): Promise<ActionResult>`.

- [ ] **Step 1: Write failing action tests with hoisted mocks**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  voidPayment: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getUserRole: mocks.getUserRole, canWrite: mocks.canWrite }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/invoicing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/invoicing")>()),
  voidPayment: mocks.voidPayment,
}));

import { voidPaymentAction } from "@/app/(app)/payments/actions";

const id = "11111111-1111-4111-8111-111111111111";
const paths = [
  "/payments", "/invoices", "/sales", "/dashboard",
  "/reports/ar-aging", "/reports/customer-statement",
  "/reports/cash-flow", "/reports/transactions",
];

describe("voidPaymentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRole.mockResolvedValue("admin");
    mocks.canWrite.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ marker: "company-bound" });
    mocks.voidPayment.mockResolvedValue(undefined);
  });

  it("rejects a non-writer before creating a database client", async () => {
    mocks.canWrite.mockReturnValue(false);
    await expect(voidPaymentAction(id, "Duplicate demo")).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects invalid input before calling the service", async () => {
    const result = await voidPaymentAction(id, "   ");
    expect(result).toMatchObject({ ok: false });
    expect(mocks.voidPayment).not.toHaveBeenCalled();
  });

  it("voids through the schema-bound client and revalidates every affected view", async () => {
    await expect(voidPaymentAction(id, "  Duplicate demo  ")).resolves.toEqual({ ok: true });
    expect(mocks.voidPayment).toHaveBeenCalledWith(
      { marker: "company-bound" }, id, "Duplicate demo",
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(paths);
  });

  it("returns the database guard message", async () => {
    mocks.voidPayment.mockRejectedValue(new Error("Accounting period is closed"));
    await expect(voidPaymentAction(id, "Duplicate demo")).resolves.toEqual({
      ok: false,
      error: "Accounting period is closed",
    });
  });
});
```

- [ ] **Step 2: Run the action test and verify RED**

Run: `npm test -- tests/unit/payment-void-action.test.ts`

Expected: FAIL because `voidPaymentAction` does not exist.

- [ ] **Step 3: Implement the authorized action**

```ts
export async function voidPaymentAction(
  paymentId: string,
  reason: string,
): Promise<ActionResult> {
  const role = await getUserRole();
  if (!canWrite(role)) {
    return { ok: false, error: "You do not have permission to perform this action" };
  }
  const parsed = paymentVoidSchema.safeParse({ payment_id: paymentId, reason });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await voidPayment(sb, parsed.data.payment_id, parsed.data.reason);
    for (const path of PAYMENT_VOID_REVALIDATION_PATHS) revalidatePath(path);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

Define `PAYMENT_VOID_REVALIDATION_PATHS` in the same file with the exact eight
literal paths used by the test.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/unit/payment-void-action.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the action**

```powershell
git add 'ctyhp-accounting/app/(app)/payments/actions.ts' ctyhp-accounting/tests/unit/payment-void-action.test.ts
git commit -m "feat: authorize customer payment voids"
```

---

### Task 5: Payments UI, attribution, and replacement form

**Files:**
- Modify: `ctyhp-accounting/app/(app)/payments/page.tsx`
- Create: `ctyhp-accounting/app/(app)/payments/ReceivePaymentModal.tsx`
- Create: `ctyhp-accounting/app/(app)/payments/VoidPaymentModal.tsx`
- Modify: `ctyhp-accounting/app/(app)/payments/PaymentsClient.tsx`
- Test: `ctyhp-accounting/tests/unit/payment-void-ui-contract.test.ts`

**Interfaces:**
- Consumes: `voidPaymentAction`, `recordPaymentAction`, `getOpenInvoicesAction`.
- Consumes: `paymentReplacementDraft`, `ActorRow[]`, extended `PaymentRow`.
- Produces: no new route; preserves `/payments` props and existing workflows.

- [ ] **Step 1: Write the failing UI structure contract**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = join(process.cwd(), "app", "(app)", "payments");
const read = (file: string) => readFileSync(join(route, file), "utf8");

describe("payment void UI contract", () => {
  it("keeps financial forms in focused components", () => {
    expect(read("page.tsx")).toContain("listActors");
    expect(read("PaymentsClient.tsx")).toContain("<ReceivePaymentModal");
    expect(read("PaymentsClient.tsx")).toContain("<VoidPaymentModal");
    expect(read("ReceivePaymentModal.tsx")).toContain("Create replacement payment");
    expect(read("VoidPaymentModal.tsx")).toContain("voidPaymentAction");
  });

  it("exposes the approved actions and attribution copy", () => {
    const client = read("PaymentsClient.tsx");
    expect(client).toContain("Void payment");
    expect(client).toContain("Create replacement");
    expect(client).toContain("void_reason");
    expect(client).toContain("voided_by");
  });

  it("keeps every touched payment UI file below the 400-line ceiling", () => {
    for (const file of ["PaymentsClient.tsx", "ReceivePaymentModal.tsx", "VoidPaymentModal.tsx"]) {
      expect(read(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(400);
    }
  });
});
```

- [ ] **Step 2: Run the UI contract and verify RED**

Run: `npm test -- tests/unit/payment-void-ui-contract.test.ts`

Expected: FAIL because the two modal components and approved actions do not exist.

- [ ] **Step 3: Load the actor directory on the server**

In `page.tsx`, add `listActors(sb)` to the existing `Promise.all`, then pass
`actors={actors}` to `PaymentsClient`. Keep the schema-bound `sb` and every
existing permission call unchanged.

- [ ] **Step 4: Extract the existing receive form into `ReceivePaymentModal`**

Use this public prop contract:

```ts
export interface ReceivePaymentModalProps {
  open: boolean;
  replacement: (PaymentRow & { customer_name: string }) | null;
  customers: CustomerRow[];
  depositAccounts: AccountRow[];
  currencies: CurrencyRow[];
  onClose: () => void;
  onDone: () => void;
}
```

Move the existing form, open-invoice loading, allocation calculation, Auto apply,
and `recordPaymentAction` call without changing their validation or copy. On
`open`/`replacement` change:

```ts
useEffect(() => {
  if (!open) return;
  form.resetFields();
  setOpenInvoices([]);
  setAlloc({});
  if (!replacement) {
    form.setFieldsValue({ currency_code: baseCurrency });
    return;
  }
  const draft = paymentReplacementDraft(
    replacement,
    decimalsOf(replacement.currency_code),
  );
  form.setFieldsValue({
    ...draft,
    payment_date: dayjs(draft.payment_date),
  });
  void loadOpenInvoices(draft.customer_id);
}, [open, replacement]);
```

The modal title is `replacement ? "Create replacement payment" : "Receive payment"`.
Use `try/finally` around submission so `saving` always resets. A successful
replacement says `Replacement payment recorded and posted to the ledger`; a
normal receipt retains `Payment recorded and posted to the ledger`.

- [ ] **Step 5: Create `VoidPaymentModal`**

Use this prop contract and action flow:

```ts
export interface VoidPaymentModalProps {
  payment: (PaymentRow & { customer_name: string }) | null;
  onClose: () => void;
  onDone: () => void;
}
```

The modal must display payment number, customer, and amount; explain that the
number/history remain and invoice balances return; require a 1-500 character
reason; and use a danger-styled `Void payment` confirmation. Submission:

```ts
setSaving(true);
try {
  const result = await voidPaymentAction(payment.id, reason);
  if (!result.ok) {
    message.error(result.error ?? "Failed to void payment");
    return;
  }
  message.success("Payment voided; invoice balances were restored");
  onDone();
} finally {
  setSaving(false);
}
```

- [ ] **Step 6: Recompose `PaymentsClient`**

Keep the table, Refund modal, and Attachment drawer in the façade. Add:

- `actors: ActorRow[]` prop and a memoized `Map<id,email>` directory;
- `receiveOpen`, `replacementFor`, and `voidFor` state;
- writer-only **Void** for non-void rows;
- writer-only **Create replacement** for void rows;
- a Tooltip on the Void status containing `Voided by <actor> on <timestamp>. <reason>`;
- `ReceivePaymentModal` and `VoidPaymentModal` composition;
- `router.refresh()` after either successful mutation.

Do not hide attachments on void rows. Keep Refund restricted to active payments
with `unapplied_minor > 0`.

- [ ] **Step 7: Run focused tests, typecheck, and targeted lint**

Run:

```powershell
npm test -- tests/unit/payment-void-schema.test.ts tests/unit/payment-void-action.test.ts tests/unit/payment-void-ui-contract.test.ts
npm run typecheck
npx eslint 'app/(app)/payments/*.tsx' 'app/(app)/payments/actions.ts' lib/domain/payment-void.ts
```

Expected: all pass with zero errors and no new warnings.

- [ ] **Step 8: Commit the UI**

```powershell
git add 'ctyhp-accounting/app/(app)/payments' ctyhp-accounting/tests/unit/payment-void-ui-contract.test.ts
git commit -m "feat: add payment void and replacement controls"
```

---

### Task 6: Rollback-only ledger verification

**Files:**
- Create: `ctyhp-accounting/scripts/verify-void-payment.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes: migration SQL and the live database shape through `SUPABASE_DB_URL`.
- Produces: `npm run verify:void-payment`, which applies migration 0095 and every
  scenario inside one transaction and always rolls it back.

- [ ] **Step 1: Add the package command**

```json
"verify:void-payment": "node --env-file=.env.local scripts/verify-void-payment.mjs"
```

- [ ] **Step 2: Implement a transaction-owned harness**

The script must:

```js
import { readFile } from "node:fs/promises";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    new URL("../supabase/migrations/0095_void_customer_payments.sql", import.meta.url),
    "utf8",
  );
  await client.query(migration);
  // Set request.jwt.claims to an active admin, run all assertions below.
} finally {
  await client.query("rollback");
  await client.end();
}
```

Use savepoints between cases. Never call `COMMIT`, and fail source review if the
file contains `commit` as an executable SQL statement.

- [ ] **Step 3: Verify successful void and preservation**

Inside the transaction:

1. Select an existing issued/partial invoice with positive balance and an active
   bank/deposit ledger account.
2. Record a small payment through `acc_record_payment` allocated to that invoice.
3. Capture invoice balance/status and journal posted-line totals.
4. Call `acc_void_payment(payment_id, 'Rollback verification')`.
5. Assert exact invoice balance restoration, payment status/attribution/reason,
   retained allocation row, retained payment number, void journal status, and no
   posted ledger contribution from that journal.
6. Call the RPC again and assert an `already void` refusal.

- [ ] **Step 4: Verify every blocker rolls back atomically**

Use a fresh payment per savepoint and assert unchanged payment, invoice, and
journal state after each refused call:

- insert a posted `acc_customer_refund` linked to the payment;
- insert an `acc_reconciliation` in `suggested` state linked to the payment;
- insert an in-progress `acc_statement_reconciliation` and
  `acc_reconciliation_line` linked to a journal line of the payment;
- close the accounting period covering the payment date after recording it, then
  assert the existing journal trigger refuses the void.

Print one `PASS` line per assertion and exit nonzero if any assertion fails.

- [ ] **Step 5: Run static safety checks before any database connection**

Run:

```powershell
rg -n 'commit|delete from acc_payment|delete from acc_payment_allocation' scripts/verify-void-payment.mjs
npm run security:check-source
```

Expected: no executable commit/delete statement and security check PASS. A
comment explaining that the script never commits is acceptable only if the
static check is scoped to executable query strings.

- [ ] **Step 6: Run rollback verification only against the configured database**

Run: `npm run verify:void-payment`

Expected: every scenario prints PASS, the final line confirms `ROLLBACK`, and no
fixture remains. Do not run if `SUPABASE_DB_URL` is missing. Do not run
`scripts/migrate.mjs` as part of this task.

- [ ] **Step 7: Commit the verification harness**

```powershell
git add ctyhp-accounting/scripts/verify-void-payment.mjs ctyhp-accounting/package.json
git commit -m "test: verify payment void ledger behavior"
```

---

### Task 7: Full regression and browser verification

**Files:**
- Modify only if a gate exposes a defect in files already in this plan.

**Interfaces:**
- Consumes: completed Tasks 1-6.
- Produces: a clean, reviewed feature branch with reproducible verification evidence.

- [ ] **Step 1: Run all focused tests together**

Run:

```powershell
npm test -- tests/unit/payment-void-schema.test.ts tests/unit/payment-void-migration.test.ts tests/unit/payment-void-service.test.ts tests/unit/payment-void-action.test.ts tests/unit/payment-void-ui-contract.test.ts tests/unit/schema-template.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run mandatory project gates**

Run, recording real output:

```powershell
npm test
npm run typecheck
npm run lint
npm run security:check-source
npm run build
```

Expected: zero failures/errors and no new warnings. Existing lint warnings must
be compared with the baseline rather than silently attributed to this change.

- [ ] **Step 3: Run the built-server smoke sweep**

Start `npm start` against the successful build using the existing `.env.local`,
then run:

```powershell
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```

Expected: every discovered page, including `/payments`, returns 200 with no error
boundary.

- [ ] **Step 4: Verify `/payments` visually without mutating production**

At approximately 1600×879, confirm:

- a non-void row exposes Void only for a writer;
- a void row exposes Create replacement and its attribution detail;
- the Void modal requires a reason and clearly states the accounting effect;
- replacement mode is pre-filled but does not submit automatically;
- attachments remain reachable and Refund behavior is unchanged.

Do not click the final Void or Record payment confirmation against production.
If the integrated browser is unavailable, verify the built local page through the
authenticated smoke session and record that fallback explicitly.

- [ ] **Step 5: Review the complete diff**

Run:

```powershell
git diff --check
git status --short
git log --oneline --decorate -8
```

Confirm only planned files changed, every migration and test is committed, and no
user-owned `.claude/settings.json` or unrelated plan file entered the branch.

- [ ] **Step 6: Request code review and address findings**

Review from the branch base through `HEAD`, specifically checking tenant schema
retargeting, rollback behavior, closed-period protection, reconciliation/refund
guards, authorization, accessibility, and replacement non-submission.

- [ ] **Step 7: Run final verification after the last review fix**

Repeat full tests, typecheck, lint, security check, build, and smoke after the
last code modification. The final completion report must cite these fresh results.
