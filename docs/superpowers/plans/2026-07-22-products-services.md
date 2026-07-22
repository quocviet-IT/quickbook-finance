# Products & Services (Item Catalog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Products & Services catalog whose items prefill invoice and bill lines (with a stored snapshot + `item_id` link), without changing any posting/ledger logic.

**Architecture:** New `acc_item` table + a nullable `item_id` column on `acc_invoice_line` and `acc_bill_line`. Pure mapping helpers turn an item into line defaults; the UI prefills (editable) and submits `item_id`. Lines keep their own account/amount snapshot, so history and reports are unaffected.

**Tech Stack:** Next.js 16 (App Router) + TypeScript strict + Supabase (Postgres/RLS) + Ant Design v6 + Zod v4 + Vitest.

## Global Constraints

- Money is integer **minor units** (`_minor`); never floats. Item prices are **base-currency (USD)** amounts.
- No posting/ledger change. Items only prefill lines; the server still computes line amounts as today. (Holy Grail Part 14: one rule, one implementation.)
- Amounts recomputed server-side; `item_id` is an extra nullable field, never a source of amounts. (Part 10)
- `acc_item` has **RLS**: read for any authenticated role, write via `acc_is_staff()`. (Part 12)
- Every write goes through the service layer and appends to `acc_audit_log` via `writeAudit`. (Part 12)
- UI in **English**; data tables scroll horizontally on narrow screens. (Bonus)
- Verify before "done": `npm run build`, `npm test`, `npm run typecheck`, `npm run lint` — zero errors — paste real output. (Part 10)
- Work on branch `feature/products-services` (already created). Commit at each task boundary; no Claude attribution in commit messages.

---

### Task 1: Migration `0014_products_services.sql`

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0014_products_services.sql`

**Interfaces:**
- Produces table `acc_item`; adds nullable `item_id` to `acc_invoice_line` and `acc_bill_line`.
- Consumes existing `acc_account`, `acc_tax_code`, `acc_current_role()`, `acc_is_staff()`.

- [ ] **Step 1: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0014_products_services.sql`:

```sql
-- ============================================================================
-- Products & Services: reusable item catalog that prefills invoice/bill lines.
-- Dual-purpose items (sales side and/or purchase side). No inventory tracking.
-- Prices are base-currency (USD) minor-unit amounts. Lines keep their own
-- snapshot; item_id is a nullable link only (no posting/ledger impact).
-- ============================================================================

create table acc_item (
  id                 uuid primary key default gen_random_uuid(),
  item_code          text unique,
  name               text not null,
  description        text not null default '',
  is_sold            boolean not null default true,
  sales_price_minor  bigint not null default 0,
  income_account_id  uuid references acc_account (id),
  sales_tax_code_id  uuid references acc_tax_code (id),
  is_purchased       boolean not null default false,
  purchase_cost_minor bigint not null default 0,
  expense_account_id uuid references acc_account (id),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index acc_item_active_idx on acc_item (is_active);

alter table acc_invoice_line add column item_id uuid references acc_item (id);
alter table acc_bill_line    add column item_id uuid references acc_item (id);

alter table acc_item enable row level security;
create policy acc_item_read  on acc_item for select using (acc_current_role() is not null);
create policy acc_item_write on acc_item for all using (acc_is_staff()) with check (acc_is_staff());
```

- [ ] **Step 2: Apply the migration (controller runs this; implementer should NOT push to DB)**

The migration is applied by the controller via the project's runner
(`node --env-file=.env.local scripts/migrate.mjs`). As the implementer, only create
and commit the file.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0014_products_services.sql
git commit -m "feat: acc_item table + item_id on invoice/bill lines + RLS"
```

---

### Task 2: Pure item→line mapping helpers + unit tests (TDD)

**Files:**
- Create: `ctyhp-accounting/lib/domain/items.ts`
- Test: `ctyhp-accounting/tests/unit/items.test.ts`

**Interfaces:**
- Produces:
  - `interface ItemLike { description: string; sales_price_minor: number; income_account_id: string | null; sales_tax_code_id: string | null; purchase_cost_minor: number; expense_account_id: string | null; }`
  - `itemToInvoiceLineDefaults(item: ItemLike): { description: string; unit_price_minor: number; income_account_id: string | null; tax_code_id: string | null }`
  - `itemToBillLineDefaults(item: ItemLike): { description: string; amount_minor: number; expense_account_id: string | null }`

- [ ] **Step 1: Write the failing tests**

Create `ctyhp-accounting/tests/unit/items.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { itemToInvoiceLineDefaults, itemToBillLineDefaults } from "@/lib/domain/items";

const base = {
  description: "Consulting",
  sales_price_minor: 15000,
  income_account_id: "inc",
  sales_tax_code_id: "tax",
  purchase_cost_minor: 9000,
  expense_account_id: "exp",
};

describe("itemToInvoiceLineDefaults", () => {
  it("maps the sales side of an item to invoice-line defaults", () => {
    expect(itemToInvoiceLineDefaults(base)).toEqual({
      description: "Consulting",
      unit_price_minor: 15000,
      income_account_id: "inc",
      tax_code_id: "tax",
    });
  });
});

describe("itemToBillLineDefaults", () => {
  it("maps the purchase side of an item to bill-line defaults", () => {
    expect(itemToBillLineDefaults(base)).toEqual({
      description: "Consulting",
      amount_minor: 9000,
      expense_account_id: "exp",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- items`
Expected: FAIL — module `@/lib/domain/items` not found.

- [ ] **Step 3: Implement the helpers**

Create `ctyhp-accounting/lib/domain/items.ts`:

```typescript
/**
 * Pure mapping from a catalog item to invoice/bill line default values.
 * These are the single definition of "what an item prefills"; the UI uses them
 * and the line still stores its own snapshot values plus item_id.
 */
export interface ItemLike {
  description: string;
  sales_price_minor: number;
  income_account_id: string | null;
  sales_tax_code_id: string | null;
  purchase_cost_minor: number;
  expense_account_id: string | null;
}

export function itemToInvoiceLineDefaults(item: ItemLike): {
  description: string;
  unit_price_minor: number;
  income_account_id: string | null;
  tax_code_id: string | null;
} {
  return {
    description: item.description,
    unit_price_minor: item.sales_price_minor,
    income_account_id: item.income_account_id,
    tax_code_id: item.sales_tax_code_id,
  };
}

export function itemToBillLineDefaults(item: ItemLike): {
  description: string;
  amount_minor: number;
  expense_account_id: string | null;
} {
  return {
    description: item.description,
    amount_minor: item.purchase_cost_minor,
    expense_account_id: item.expense_account_id,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- items`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/items.ts tests/unit/items.test.ts
git commit -m "feat: pure item->line default mapping helpers with tests"
```

---

### Task 3: Row types + Zod schemas (incl. cross-field validation)

**Files:**
- Modify: `ctyhp-accounting/lib/db/types.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Test: `ctyhp-accounting/tests/unit/item-schema.test.ts`

**Interfaces:**
- Produces type `ItemRow`; adds `item_id: string | null` to `InvoiceLineRow` and `BillLineRow`.
- Produces `itemCreateSchema`/`ItemCreateInput`, `itemUpdateSchema`/`ItemUpdateInput`; adds optional `item_id` to `invoiceLineInputSchema` and `billLineInputSchema`.

- [ ] **Step 1: Add row types**

Append to `ctyhp-accounting/lib/db/types.ts`:

```typescript
// --- Products & Services ---
export interface ItemRow {
  id: string;
  item_code: string | null;
  name: string;
  description: string;
  is_sold: boolean;
  sales_price_minor: number;
  income_account_id: string | null;
  sales_tax_code_id: string | null;
  is_purchased: boolean;
  purchase_cost_minor: number;
  expense_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

In the same file, add `item_id: string | null;` to `InvoiceLineRow` (after `tax_code_id`) and to `BillLineRow` (after `expense_account_id`).

- [ ] **Step 2: Write the failing schema test**

Create `ctyhp-accounting/tests/unit/item-schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { itemCreateSchema } from "@/lib/domain/schemas";

const ok = {
  name: "Consulting",
  is_sold: true,
  sales_price_minor: 15000,
  income_account_id: "11111111-1111-1111-1111-111111111111",
  is_purchased: false,
};

describe("itemCreateSchema", () => {
  it("accepts a valid sales-only item", () => {
    expect(itemCreateSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects an item with neither side enabled", () => {
    const r = itemCreateSchema.safeParse({ ...ok, is_sold: false, is_purchased: false });
    expect(r.success).toBe(false);
  });

  it("requires an income account when sold", () => {
    const r = itemCreateSchema.safeParse({ ...ok, income_account_id: undefined });
    expect(r.success).toBe(false);
  });

  it("requires an expense account when purchased", () => {
    const r = itemCreateSchema.safeParse({
      ...ok,
      is_purchased: true,
      purchase_cost_minor: 9000,
      expense_account_id: undefined,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- item-schema`
Expected: FAIL — `itemCreateSchema` not exported.

- [ ] **Step 4: Add Zod schemas**

Append to `ctyhp-accounting/lib/domain/schemas.ts`:

```typescript
// --- Products & Services ---
export const itemCreateSchema = z
  .object({
    item_code: z.string().trim().max(40).optional().or(z.literal("")).nullable(),
    name: z.string().trim().min(1, "Item name is required").max(160),
    description: z.string().trim().max(300).default(""),
    is_sold: z.boolean().default(true),
    sales_price_minor: z.number().int().min(0).default(0),
    income_account_id: z.uuid().optional().nullable(),
    sales_tax_code_id: z.uuid().optional().nullable(),
    is_purchased: z.boolean().default(false),
    purchase_cost_minor: z.number().int().min(0).default(0),
    expense_account_id: z.uuid().optional().nullable(),
  })
  .refine((v) => v.is_sold || v.is_purchased, {
    message: "Enable at least one of Sales or Purchase",
    path: ["is_sold"],
  })
  .refine((v) => !v.is_sold || !!v.income_account_id, {
    message: "Select an income account for a sold item",
    path: ["income_account_id"],
  })
  .refine((v) => !v.is_purchased || !!v.expense_account_id, {
    message: "Select an expense account for a purchased item",
    path: ["expense_account_id"],
  });
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;

export const itemUpdateSchema = itemCreateSchema;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
```

Then add an optional `item_id` to the existing line schemas. In `invoiceLineInputSchema` (add after `tax_code_id`):

```typescript
  item_id: z.uuid().optional().nullable(),
```

In `billLineInputSchema` (add after `amount_minor`):

```typescript
  item_id: z.uuid().optional().nullable(),
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- item-schema && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/db/types.ts lib/domain/schemas.ts tests/unit/item-schema.test.ts
git commit -m "feat: item row type + Zod schemas with cross-field validation"
```

---

### Task 4: Service `items.ts` + persist `item_id` on lines

**Files:**
- Create: `ctyhp-accounting/lib/services/items.ts`
- Modify: `ctyhp-accounting/lib/services/invoicing.ts` (line insert in `createDraftInvoice`)
- Modify: `ctyhp-accounting/lib/services/payables.ts` (line insert in `createDraftBill`)

**Interfaces:**
- Produces `listItems(sb)`, `createItem(sb, input)`, `updateItem(sb, id, input)`, `setItemActive(sb, id, active)`; class `ItemsError`.
- Consumes `ItemRow`, `ItemCreateInput`/`ItemUpdateInput`, `writeAudit`.

- [ ] **Step 1: Write the service module**

Create `ctyhp-accounting/lib/services/items.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemRow } from "@/lib/db/types";
import type { ItemCreateInput, ItemUpdateInput } from "@/lib/domain/schemas";
import { writeAudit } from "./audit";

export class ItemsError extends Error {}

const COLS =
  "id,item_code,name,description,is_sold,sales_price_minor,income_account_id,sales_tax_code_id," +
  "is_purchased,purchase_cost_minor,expense_account_id,is_active,created_at,updated_at";

export async function listItems(sb: SupabaseClient): Promise<ItemRow[]> {
  const { data, error } = await sb.from("acc_item").select(COLS).order("name");
  if (error) throw new ItemsError(error.message);
  return (data ?? []) as unknown as ItemRow[];
}

function toRow(input: ItemCreateInput | ItemUpdateInput) {
  return {
    item_code: input.item_code || null,
    name: input.name,
    description: input.description ?? "",
    is_sold: input.is_sold,
    sales_price_minor: input.sales_price_minor,
    income_account_id: input.income_account_id || null,
    sales_tax_code_id: input.sales_tax_code_id || null,
    is_purchased: input.is_purchased,
    purchase_cost_minor: input.purchase_cost_minor,
    expense_account_id: input.expense_account_id || null,
  };
}

export async function createItem(sb: SupabaseClient, input: ItemCreateInput): Promise<ItemRow> {
  const { data, error } = await sb.from("acc_item").insert(toRow(input)).select(COLS).single();
  if (error) throw new ItemsError(error.message);
  const row = data as unknown as ItemRow;
  await writeAudit(sb, { table_name: "acc_item", record_id: row.id, action: "insert", after: row });
  return row;
}

export async function updateItem(sb: SupabaseClient, id: string, input: ItemUpdateInput): Promise<ItemRow> {
  const { data, error } = await sb
    .from("acc_item")
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) throw new ItemsError(error.message);
  const row = data as unknown as ItemRow;
  await writeAudit(sb, { table_name: "acc_item", record_id: id, action: "update", after: row });
  return row;
}

export async function setItemActive(sb: SupabaseClient, id: string, active: boolean): Promise<void> {
  const { error } = await sb
    .from("acc_item")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new ItemsError(error.message);
  await writeAudit(sb, { table_name: "acc_item", record_id: id, action: "update", after: { is_active: active } });
}
```

- [ ] **Step 2: Persist `item_id` on invoice lines**

In `ctyhp-accounting/lib/services/invoicing.ts`, in `createDraftInvoice`, the
`acc_invoice_line` insert maps each computed line. Add `item_id` to that mapped object:

Find the insert `.map((c, i) => ({ ... tax_code_id: c.line.tax_code_id || null, ... }))` and add:

```typescript
      item_id: c.line.item_id || null,
```

(as another property in the same object literal, e.g. right after `tax_code_id`).

- [ ] **Step 3: Persist `item_id` on bill lines**

In `ctyhp-accounting/lib/services/payables.ts`, in `createDraftBill`, the
`acc_bill_line` insert maps `input.lines`. Add `item_id` to that mapped object:

```typescript
      item_id: l.item_id || null,
```

(right after `amount_minor`).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/items.ts lib/services/invoicing.ts lib/services/payables.ts
git commit -m "feat: items service; persist item_id on invoice and bill lines"
```

---

### Task 5: Items page (UI) + navigation

**Files:**
- Create: `ctyhp-accounting/app/(app)/items/actions.ts`
- Create: `ctyhp-accounting/app/(app)/items/page.tsx`
- Create: `ctyhp-accounting/app/(app)/items/ItemsClient.tsx`
- Modify: `ctyhp-accounting/components/AppShell.tsx` (nav entry)

**Interfaces:**
- Consumes `listItems`/`createItem`/`updateItem`/`setItemActive`/`ItemsError`; `listAccounts`; `listTaxCodes` from `@/lib/services/reference`; `itemCreateSchema`/`itemUpdateSchema`; `getUserRole`/`canWrite`.

- [ ] **Step 1: Write the server actions**

Create `ctyhp-accounting/app/(app)/items/actions.ts`:

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { createItem, updateItem, setItemActive, ItemsError } from "@/lib/services/items";
import { itemCreateSchema, itemUpdateSchema } from "@/lib/domain/schemas";

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
  if (err instanceof ItemsError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function createItemAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = itemCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const it = await createItem(sb, parsed.data);
    revalidatePath("/items");
    return { ok: true, data: { id: it.id } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function updateItemAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = itemUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    await updateItem(sb, id, parsed.data);
    revalidatePath("/items");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function setItemActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await setItemActive(sb, id, active);
    revalidatePath("/items");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 2: Write the page (server component)**

Create `ctyhp-accounting/app/(app)/items/page.tsx`:

```typescript
import { createSupabaseServerClient } from "@/lib/db/server";
import { listItems } from "@/lib/services/items";
import { listAccounts } from "@/lib/services/accounts";
import { listTaxCodes } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ItemsClient from "./ItemsClient";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const sb = await createSupabaseServerClient();
  const [items, accounts, taxCodes, role] = await Promise.all([
    listItems(sb),
    listAccounts(sb),
    listTaxCodes(sb),
    getUserRole(),
  ]);

  const incomeAccounts = accounts.filter(
    (a) => (a.account_type === "income" || a.account_type === "other_income") && a.is_posting_account && a.status === "active",
  );
  const expenseAccounts = accounts.filter(
    (a) =>
      (a.account_type === "expense" || a.account_type === "cost_of_goods_sold" || a.account_type === "other_expense") &&
      a.is_posting_account &&
      a.status === "active",
  );

  return (
    <div>
      <PageHeader title="Products & Services" description="Reusable items that prefill invoice and bill lines." />
      <ItemsClient
        items={items}
        incomeAccounts={incomeAccounts}
        expenseAccounts={expenseAccounts}
        taxCodes={taxCodes}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the client component**

Create `ctyhp-accounting/app/(app)/items/ItemsClient.tsx`:

```typescript
"use client";
import { useState } from "react";
import { App, Button, Divider, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { AccountRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { createItemAction, updateItemAction, setItemActiveAction } from "./actions";

interface Props {
  items: ItemRow[];
  incomeAccounts: AccountRow[];
  expenseAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  canWrite: boolean;
}

export default function ItemsClient({ items, incomeAccounts, expenseAccounts, taxCodes, canWrite }: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [form] = Form.useForm();
  const isSold = Form.useWatch("is_sold", form);
  const isPurchased = Form.useWatch("is_purchased", form);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_sold: true, is_purchased: false, sales_price: 0, purchase_cost: 0 });
    setOpen(true);
  }

  function openEdit(it: ItemRow) {
    setEditing(it);
    form.setFieldsValue({
      item_code: it.item_code ?? "",
      name: it.name,
      description: it.description,
      is_sold: it.is_sold,
      sales_price: it.sales_price_minor / 100,
      income_account_id: it.income_account_id ?? undefined,
      sales_tax_code_id: it.sales_tax_code_id ?? undefined,
      is_purchased: it.is_purchased,
      purchase_cost: it.purchase_cost_minor / 100,
      expense_account_id: it.expense_account_id ?? undefined,
    });
    setOpen(true);
  }

  async function submit() {
    const v = await form.validateFields();
    const payload = {
      item_code: v.item_code || null,
      name: v.name,
      description: v.description ?? "",
      is_sold: !!v.is_sold,
      sales_price_minor: Math.round((v.sales_price ?? 0) * 100),
      income_account_id: v.income_account_id ?? null,
      sales_tax_code_id: v.sales_tax_code_id ?? null,
      is_purchased: !!v.is_purchased,
      purchase_cost_minor: Math.round((v.purchase_cost ?? 0) * 100),
      expense_account_id: v.expense_account_id ?? null,
    };
    setSaving(true);
    const res = editing ? await updateItemAction(editing.id, payload) : await createItemAction(payload);
    setSaving(false);
    if (res.ok) {
      message.success(editing ? "Item updated" : "Item created");
      setOpen(false);
    } else {
      message.error(res.error ?? "Failed to save item");
    }
  }

  async function toggleActive(it: ItemRow) {
    const res = await setItemActiveAction(it.id, !it.is_active);
    if (res.ok) message.success(it.is_active ? "Item deactivated" : "Item activated");
    else message.error(res.error ?? "Failed to update item");
  }

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New item
          </Button>
        )}
      </Space>
      <Table<ItemRow>
        rowKey="id"
        dataSource={items}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          { title: "Code", dataIndex: "item_code", render: (v) => v ?? "—" },
          { title: "Name", dataIndex: "name" },
          {
            title: "Sales price",
            dataIndex: "sales_price_minor",
            align: "right",
            render: (v: number, r) => (r.is_sold ? `$${(v / 100).toFixed(2)}` : "—"),
          },
          {
            title: "Cost",
            dataIndex: "purchase_cost_minor",
            align: "right",
            render: (v: number, r) => (r.is_purchased ? `$${(v / 100).toFixed(2)}` : "—"),
          },
          {
            title: "Used for",
            key: "used",
            render: (_, r) => (
              <Space>
                {r.is_sold && <Tag color="blue">Sales</Tag>}
                {r.is_purchased && <Tag color="gold">Purchase</Tag>}
              </Space>
            ),
          },
          {
            title: "Status",
            dataIndex: "is_active",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag>,
          },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canWrite ? (
                <Space>
                  <Button size="small" type="link" onClick={() => openEdit(r)}>
                    Edit
                  </Button>
                  <Button size="small" type="link" onClick={() => toggleActive(r)}>
                    {r.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        title={editing ? "Edit item" : "New item"}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText={editing ? "Save" : "Create"}
        width={560}
      >
        <Form form={form} layout="vertical">
          <Space size="middle" style={{ display: "flex" }}>
            <Form.Item name="item_code" label="Code (optional)">
              <Input style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name is required" }]} style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Divider orientation="left">
            <Space>
              <Form.Item name="is_sold" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
              I sell this
            </Space>
          </Divider>
          {isSold && (
            <Space size="middle" style={{ display: "flex" }} align="start">
              <Form.Item name="sales_price" label="Sales price">
                <InputNumber min={0} precision={2} prefix="$" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="income_account_id" label="Income account" style={{ flex: 1, minWidth: 200 }}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={incomeAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                />
              </Form.Item>
              <Form.Item name="sales_tax_code_id" label="Sales tax">
                <Select
                  allowClear
                  style={{ width: 140 }}
                  options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} (${t.rate_percent}%)` }))}
                />
              </Form.Item>
            </Space>
          )}

          <Divider orientation="left">
            <Space>
              <Form.Item name="is_purchased" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
              I buy this
            </Space>
          </Divider>
          {isPurchased && (
            <Space size="middle" style={{ display: "flex" }} align="start">
              <Form.Item name="purchase_cost" label="Cost">
                <InputNumber min={0} precision={2} prefix="$" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="expense_account_id" label="Expense account" style={{ flex: 1, minWidth: 200 }}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                />
              </Form.Item>
            </Space>
          )}
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: Add navigation entry**

In `ctyhp-accounting/components/AppShell.tsx`, add `ShoppingOutlined` to the icon import from `@ant-design/icons`, and add this NAV entry immediately after the `/accounts` entry:

```typescript
  { key: "/items", icon: <ShoppingOutlined />, label: "Products & Services" },
```

- [ ] **Step 5: Verify build + scoped lint**

Run: `npm run build && npx eslint "app/(app)/items" components/AppShell.tsx`
Expected: build PASS; eslint clean on those paths.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/items" components/AppShell.tsx
git commit -m "feat: Products & Services page (catalog CRUD) + nav"
```

---

### Task 6: Item picker in Invoice and Bill line editors

**Files:**
- Modify: `ctyhp-accounting/app/(app)/invoices/page.tsx` (load + pass sales items)
- Modify: `ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx` (item picker per line)
- Modify: `ctyhp-accounting/app/(app)/bills/page.tsx` (load + pass purchase items)
- Modify: `ctyhp-accounting/app/(app)/bills/BillsClient.tsx` (item picker per line)

**Interfaces:**
- Consumes `listItems` (Task 4), `itemToInvoiceLineDefaults`/`itemToBillLineDefaults` (Task 2), `ItemRow`.

- [ ] **Step 1: Invoices — load and pass sales items**

In `ctyhp-accounting/app/(app)/invoices/page.tsx`:
- Add `listItems` to the imports from `@/lib/services/items`.
- Add `listItems(sb)` to the `Promise.all` and destructure `items`.
- Compute `const salesItems = items.filter((i) => i.is_sold && i.is_active);`
- Pass `items={salesItems}` to `<InvoicesClient ... />`.

- [ ] **Step 2: Invoices — add the item picker per line**

In `ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx`:

Add imports:

```typescript
import type { ItemRow } from "@/lib/db/types";
import { itemToInvoiceLineDefaults } from "@/lib/domain/items";
```

Add `items` to the component props type and destructure it:

```typescript
  items,
```
```typescript
  items: ItemRow[];
```

Add `item_id?: string | null;` to the `LineForm` interface.

Inside the `Form.List` render, add an item `Select` as the FIRST control in each line row's `<Space>` (before the description `Form.Item`):

```typescript
                    <Form.Item name={[field.name, "item_id"]} style={{ marginBottom: 0, width: 190 }}>
                      <Select
                        allowClear
                        showSearch
                        placeholder="Item (optional)"
                        optionFilterProp="label"
                        options={items.map((i) => ({ value: i.id, label: i.name }))}
                        onChange={(itemId) => {
                          const it = items.find((i) => i.id === itemId);
                          if (!it) return;
                          const d = itemToInvoiceLineDefaults(it);
                          const dec = decimalsOf(form.getFieldValue("currency_code") ?? baseCurrency);
                          form.setFields([
                            { name: ["lines", field.name, "description"], value: d.description },
                            { name: ["lines", field.name, "unit_price"], value: d.unit_price_minor / 10 ** dec },
                            { name: ["lines", field.name, "income_account_id"], value: d.income_account_id ?? undefined },
                            { name: ["lines", field.name, "tax_code_id"], value: d.tax_code_id ?? undefined },
                          ]);
                        }}
                      />
                    </Form.Item>
```

In `submitInvoice`, add `item_id` to the mapped line object:

```typescript
      item_id: l.item_id || null,
```

- [ ] **Step 3: Bills — load and pass purchase items**

In `ctyhp-accounting/app/(app)/bills/page.tsx`:
- Add `listItems` to the imports from `@/lib/services/items` (note: `listBills`/`listVendors` come from `@/lib/services/payables`; `listItems` is separate).
- Add `listItems(sb)` to `Promise.all`, destructure `items`.
- Compute `const purchaseItems = items.filter((i) => i.is_purchased && i.is_active);`
- Pass `items={purchaseItems}` to `<BillsClient ... />`.

- [ ] **Step 4: Bills — add the item picker per line**

In `ctyhp-accounting/app/(app)/bills/BillsClient.tsx`:

Add imports:

```typescript
import type { AccountRow, CurrencyRow, VendorRow, ItemRow } from "@/lib/db/types";
import { itemToBillLineDefaults } from "@/lib/domain/items";
```
(extend the existing `@/lib/db/types` import with `ItemRow` rather than duplicating it.)

Add `items: ItemRow[];` to the props type and destructure `items`.

Add `item_id?: string | null;` to the `LineForm` interface.

Inside the `Form.List` render, add an item `Select` as the FIRST control in each line row's `<Space>` (before the description field):

```typescript
                    <Form.Item name={[field.name, "item_id"]} style={{ marginBottom: 0 }}>
                      <Select
                        allowClear
                        showSearch
                        placeholder="Item (optional)"
                        style={{ width: 180 }}
                        optionFilterProp="label"
                        options={items.map((i) => ({ value: i.id, label: i.name }))}
                        onChange={(itemId) => {
                          const it = items.find((i) => i.id === itemId);
                          if (!it) return;
                          const d = itemToBillLineDefaults(it);
                          form.setFields([
                            { name: ["lines", field.name, "description"], value: d.description },
                            { name: ["lines", field.name, "expense_account_id"], value: d.expense_account_id ?? undefined },
                            { name: ["lines", field.name, "amount"], value: d.amount_minor / 10 ** decimals },
                          ]);
                        }}
                      />
                    </Form.Item>
```

In `submit`, add `item_id` to each mapped line object:

```typescript
      item_id: l.item_id ?? null,
```

- [ ] **Step 5: Verify build + scoped lint**

Run: `npm run build && npx eslint "app/(app)/invoices" "app/(app)/bills"`
Expected: build PASS; eslint clean on those paths.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/invoices" "app/(app)/bills"
git commit -m "feat: item picker prefills invoice and bill lines"
```

---

### Task 7: End-to-end verification

**Files:**
- Create: `ctyhp-accounting/scripts/verify-items.mjs`

**Interfaces:**
- Consumes the applied DB (migrations through 0014) and the admin login pattern from `scripts/verify-payables.mjs`.

- [ ] **Step 1: Write the verify script**

Create `ctyhp-accounting/scripts/verify-items.mjs` (mirrors `verify-payables.mjs`'s
admin-login + cleanup pattern):

```javascript
// End-to-end verify that items prefill/link into invoice lines (as admin).
// Creates an item, a draft invoice whose line references it, and asserts the
// line stored item_id and the snapshot values. Cleans up after itself.
// Run: node --env-file=.env.local scripts/verify-items.mjs
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

  const { data: item, error: e2 } = await authed.from("acc_item").insert({
    name: "E2E Item", description: "E2E item desc", is_sold: true,
    sales_price_minor: 12345, income_account_id: income,
  }).select("id").single();
  if (e2) throw new Error("item: " + e2.message);
  check("item created", !!item.id);

  const { data: cust } = await authed.from("acc_customer")
    .insert({ name: "E2E Item Customer", currency_code: "USD" }).select("id").single();

  const { data: inv, error: e3 } = await authed.from("acc_invoice").insert({
    customer_id: cust.id, currency_code: "USD",
    subtotal_minor: 12345, tax_total_minor: 0, total_minor: 12345, balance_due_minor: 12345,
  }).select("id").single();
  if (e3) throw new Error("invoice: " + e3.message);

  const { error: e4 } = await authed.from("acc_invoice_line").insert({
    invoice_id: inv.id, line_order: 0, description: "E2E item desc",
    quantity: 1, unit_price_minor: 12345, income_account_id: income,
    line_subtotal_minor: 12345, line_tax_minor: 0, line_total_minor: 12345,
    item_id: item.id,
  });
  if (e4) throw new Error("line: " + e4.message);

  const line = (await db.query(
    "select item_id, unit_price_minor, description from acc_invoice_line where invoice_id=$1", [inv.id])).rows[0];
  check("line stored item_id link", line.item_id === item.id);
  check("line kept snapshot unit price", Number(line.unit_price_minor) === 12345);

  // Cleanup
  await db.query("begin");
  await db.query("delete from acc_invoice_line where invoice_id=$1", [inv.id]);
  await db.query("delete from acc_invoice where id=$1", [inv.id]);
  await db.query("delete from acc_customer where id=$1", [cust.id]);
  await db.query("delete from acc_item where id=$1", [item.id]);
  await db.query("commit");
  console.log("  (cleanup done)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error("verify error:", e.message); process.exitCode = 1; }).finally(() => db.end());
```

- [ ] **Step 2: Run the full automated suite**

Run: `npm test && npm run typecheck && npm run build && npm run lint`
Expected: all PASS; lint zero errors. Paste real output.

- [ ] **Step 3: Run the live-DB verify (controller runs after applying migration 0014)**

Run: `node --env-file=.env.local scripts/verify-items.mjs`
Expected: `2 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-items.mjs
git commit -m "test: end-to-end verify for item prefill/link on invoice lines"
```

---

## Self-Review

**Spec coverage:**
- §3 data model (acc_item + item_id columns + RLS) → Task 1. ✓
- §4 pure helpers + Zod (+ item_id on line schemas) → Tasks 2, 3. ✓
- §5 service + wiring item_id into drafts → Task 4. ✓
- §6 UI (items page + nav; pickers in invoices/bills) → Tasks 5, 6. ✓
- §7 security (RLS, role-guarded actions) → Task 1 (RLS), Task 5 (actions). ✓
- §8 testing (unit + E2E) → Tasks 2, 3 (unit), Task 7 (E2E). ✓
- §9 reports impact (none) → no report task; unchanged by design. ✓

**Type consistency:** `ItemRow` fields match the `acc_item` columns in Task 1. `item_id` added to `InvoiceLineRow`/`BillLineRow` (Task 3), the line Zod schemas (Task 3), the service inserts (Task 4), and the UI submit maps (Task 6). Helper names `itemToInvoiceLineDefaults`/`itemToBillLineDefaults` consistent across Tasks 2, 6. Schema names `itemCreateSchema`/`itemUpdateSchema` consistent across Tasks 3, 5.

**Placeholder scan:** No TBD/TODO; each code step contains complete code or a precise, code-level edit instruction.
