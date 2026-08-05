# Bank Transaction Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user put their own label on a bank transaction from the `/banking` list, create a label on the spot, and filter the list by label — including the lines that have none.

**Architecture:** A small managed table of labels in each company schema, a nullable foreign key on `acc_bank_transaction`, and two narrow RPCs that are the only way to write either. The label never posts. The 1042-line `BankingClient.tsx` gives up its transactions table to a new component in a behaviour-free move *before* the column is added, so the move and the feature can be reviewed apart.

**Tech Stack:** Next.js 16 App Router and Server Actions, React 19, TypeScript, Ant Design 5, Supabase/PostgreSQL PL/pgSQL, Vitest, Node `pg` rollback verification.

**Spec:** `docs/superpowers/specs/2026-08-05-bank-transaction-categories-design.md`
**Feedback:** report `773843b7-8daf-493b-b7a6-da60ba0be639`, `/banking`, 2026-08-03.

## Global Constraints

- Product name in user-visible copy is **One Book**. All UI copy is US English; currency is USD; "Sales Tax", never "VAT".
- A label is metadata. It must never write to `acc_journal_entry`, `acc_journal_line`, or any document table.
- `acc_bank_transaction.category` belongs to the bank feed and must not be read or written by this feature. The user's label is `bank_category_id`.
- `acc_block_bank_txn_edit` (migration 0010) must not be modified. It rejects changes to `amount_minor`, `txn_date`, `description`, `reference`, `raw_hash`; the new column is none of those.
- Never set `created_by` / `created_at` / `updated_by` / `updated_at` from application code — `acc_stamp_actor()` owns them.
- No SQL in components. Writes go through `lib/services/banking.ts` into an RPC.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, …).
- Every migration must reach every company schema; nothing may be pinned to `public` beyond what `retargetToSchema()` rewrites.
- Never disable RLS. Reading a label follows the existing `acc_bank_transaction` read policy; writing requires `acc_is_staff()`.
- Keep every touched TS/TSX file under 400 lines. `BankingClient.tsx` is 1042 lines today; it must end this work **smaller**, not larger.
- Read the checked-in Next.js 16 docs in `node_modules/next/dist/docs/` before writing route or Server Action code.
- Verification gates, all with real pasted output: `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:check-source`, `npm run build`, plus `scripts/smoke-pages.mjs`.

## File Map

| File | Responsibility |
|---|---|
| `ctyhp-accounting/supabase/migrations/0098_bank_transaction_categories.sql` | Create. Label table, FK column, two RPCs, RLS, grants. |
| `ctyhp-accounting/lib/db/types.ts` | Modify. `BankCategoryRow`; `BankTransactionRow` gains the label id and name. |
| `ctyhp-accounting/lib/services/banking.ts` | Modify. `listBankCategories`, `createBankCategory`, `setBankTransactionCategory`; `listBankTransactions` reads the label. |
| `ctyhp-accounting/app/(app)/banking/actions.ts` | Modify. Two authorized actions. |
| `ctyhp-accounting/app/(app)/banking/page.tsx` | Modify. Load the labels once. |
| `ctyhp-accounting/app/(app)/banking/BankTransactionsTable.tsx` | Create. The table lifted out of `BankingClient.tsx`, then the new column. |
| `ctyhp-accounting/app/(app)/banking/BankCategoryCell.tsx` | Create. One row's label control. |
| `ctyhp-accounting/app/(app)/banking/BankingClient.tsx` | Modify. Loses the table, gains the category filter and the labels state. |
| `ctyhp-accounting/tests/unit/bank-categories-migration.test.ts` | Create. SQL contract and per-company scope. |
| `ctyhp-accounting/tests/unit/bank-categories-service.test.ts` | Create. Service adapters against a fake client. |
| `ctyhp-accounting/tests/unit/bank-categories-action.test.ts` | Create. Authorization and revalidation. |
| `ctyhp-accounting/tests/unit/bank-categories-ui-contract.test.ts` | Create. Column, filter, component split, 400-line ceiling. |
| `ctyhp-accounting/scripts/verify-bank-categories.mjs` | Create. Rollback-only behavioural verification. |
| `ctyhp-accounting/package.json` | Modify. `verify:bank-categories`. |

---

### Task 1: The label table and the two ways to write it

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0098_bank_transaction_categories.sql`
- Test: `ctyhp-accounting/tests/unit/bank-categories-migration.test.ts`

**Interfaces:**
- Consumes: `acc_bank_transaction`, `acc_is_staff()`, `acc_current_role()`, `acc_stamp_actor()`.
- Produces: table `acc_bank_category`; column `acc_bank_transaction.bank_category_id`; `acc_upsert_bank_category(text) returns uuid`; `acc_set_bank_transaction_category(uuid, uuid) returns void`.

- [x] **Step 1: Write the failing migration contract test**

Create `ctyhp-accounting/tests/unit/bank-categories-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0098_bank_transaction_categories.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("bank transaction category migration", () => {
  it("adds a label table that cannot hold the same name twice", () => {
    expect(sql).toMatch(/create table if not exists acc_bank_category/i);
    expect(sql).toMatch(/create unique index[\s\S]{0,80}lower\(btrim\(name\)\)/i);
    expect(sql).toMatch(/is_active\s+boolean not null default true/i);
    // Attribution is the database's job, not the application's.
    expect(sql).toContain("acc_stamp_actor()");
  });

  it("puts the user's label in its own column, beside the bank's own category", () => {
    expect(sql).toMatch(/alter table acc_bank_transaction[\s\S]{0,120}add column if not exists bank_category_id uuid/i);
    expect(sql).toMatch(/references acc_bank_category \(id\) on delete set null/i);
    // The feed's `category` column must not be touched by this migration.
    expect(sql).not.toMatch(/set category\s*=/i);
    expect(sql).not.toMatch(/drop column[\s\S]{0,40}category\b/i);
  });

  it("writes a label through a function that can reach nothing else", () => {
    const setter = sql.slice(sql.indexOf("function acc_set_bank_transaction_category"));
    expect(setter).toContain("acc_is_staff()");
    expect(setter).toMatch(/update acc_bank_transaction\s+set bank_category_id =/i);
    for (const column of ["amount_minor", "txn_date", "description", "reference", "raw_hash", "status"]) {
      expect(setter.slice(setter.indexOf("update acc_bank_transaction")), column).not.toMatch(
        new RegExp(`${column}\\s*=`),
      );
    }
  });

  it("returns the existing label when the same name arrives again", () => {
    const upsert = sql.slice(
      sql.indexOf("function acc_upsert_bank_category"),
      sql.indexOf("function acc_set_bank_transaction_category"),
    );
    expect(upsert).toContain("acc_is_staff()");
    expect(upsert).toMatch(/lower\(btrim\(name\)\) = lower\(v_name\)/i);
    expect(upsert).toMatch(/length\(v_name\) = 0/);
    expect(upsert).toMatch(/length\(v_name\) > 60/);
  });

  it("leaves the immutability trigger alone", () => {
    expect(sql).not.toContain("acc_block_bank_txn_edit");
    expect(sql).not.toContain("acc_bank_txn_immutable");
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/bank-categories-migration.test.ts`

Expected: FAIL with `ENOENT` because migration 0098 does not exist.

- [x] **Step 3: Write migration 0098**

Create `ctyhp-accounting/supabase/migrations/0098_bank_transaction_categories.sql`:

```sql
-- ============================================================================
-- 0098  A label of your own on a bank line
--
-- Asked for in feedback 773843b7 on /banking: "please add another column where
-- I can freely categorized a bank transaction". The screenshot showed their
-- vocabulary — Deposit, Inventory, Website Platform, Payroll — not ours.
--
-- Two things this deliberately is not:
--
--   * It is not `acc_bank_transaction.category`. That column holds what the
--     bank feed said, and the screen already shows it under the description.
--     Writing a person's label there would destroy imported data.
--   * It is not a posting. A bank line becomes an accounting fact by being
--     matched to a document or settled, and that path keeps its guards. A
--     dropdown that posted would be a second way into the ledger.
--
-- The immutability trigger from 0010 is untouched: it guards the amount, date,
-- description, reference and hash, and a label is none of those.
-- ============================================================================

set search_path = public;

create table if not exists acc_bank_category (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  is_active  boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

-- One label per name, whatever case it was typed in: "Inventory" and
-- "inventory" are the same category to everyone except a computer.
create unique index if not exists acc_bank_category_name_key
  on acc_bank_category (lower(btrim(name)));

drop trigger if exists acc_bank_category_actor_stamp on acc_bank_category;
create trigger acc_bank_category_actor_stamp
  before insert or update on acc_bank_category
  for each row execute function acc_stamp_actor();

alter table acc_bank_transaction
  add column if not exists bank_category_id uuid
    references acc_bank_category (id) on delete set null;
create index if not exists acc_bank_txn_category_idx
  on acc_bank_transaction (bank_category_id);

alter table acc_bank_category enable row level security;

drop policy if exists acc_bank_category_sel on acc_bank_category;
create policy acc_bank_category_sel on acc_bank_category
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_bank_category_ins on acc_bank_category;
create policy acc_bank_category_ins on acc_bank_category
  for insert with check (acc_is_staff());
drop policy if exists acc_bank_category_upd on acc_bank_category;
create policy acc_bank_category_upd on acc_bank_category
  for update using (acc_is_staff());

revoke all on acc_bank_category from public, anon;
grant select, insert, update on acc_bank_category to authenticated;
grant all on acc_bank_category to service_role;

-- --- Creating a label --------------------------------------------------------
create or replace function acc_upsert_bank_category(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to manage bank categories';
  end if;
  if length(v_name) = 0 then raise exception 'A category name is required'; end if;
  if length(v_name) > 60 then
    raise exception 'A category name cannot exceed 60 characters';
  end if;

  -- Typing the same name on two rows must produce one label, not two.
  select id into v_id from acc_bank_category
   where lower(btrim(name)) = lower(v_name);
  if v_id is not null then
    update acc_bank_category set is_active = true where id = v_id and not is_active;
    return v_id;
  end if;

  insert into acc_bank_category (name) values (v_name) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function acc_upsert_bank_category(text) from public, anon;
grant execute on function acc_upsert_bank_category(text) to authenticated, service_role;

-- --- Attaching one to a bank line -------------------------------------------
create or replace function acc_set_bank_transaction_category(
  p_txn_id uuid,
  p_category_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to categorize bank transactions';
  end if;
  if not exists (select 1 from acc_bank_transaction where id = p_txn_id) then
    raise exception 'Bank transaction not found';
  end if;
  if p_category_id is not null and not exists (
    select 1 from acc_bank_category where id = p_category_id and is_active
  ) then
    raise exception 'That category does not exist';
  end if;

  -- One column, named once: this function is the whitelist. Nothing here can
  -- reach an amount, and the 0010 immutability trigger still sees no change to
  -- the fields it guards.
  update acc_bank_transaction
     set bank_category_id = p_category_id
   where id = p_txn_id;
end;
$$;

revoke all on function acc_set_bank_transaction_category(uuid, uuid) from public, anon;
grant execute on function acc_set_bank_transaction_category(uuid, uuid)
  to authenticated, service_role;
```

- [x] **Step 4: Run the tests and verify GREEN**

Run: `npm test -- tests/unit/bank-categories-migration.test.ts tests/unit/schema-template.test.ts`

Expected: PASS, both files.

- [x] **Step 5: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0098_bank_transaction_categories.sql ctyhp-accounting/tests/unit/bank-categories-migration.test.ts
git commit -m "Let a bank line carry a label of the bookkeeper's own"
```

---

### Task 2: Reading and writing labels

**Files:**
- Modify: `ctyhp-accounting/lib/db/types.ts`
- Modify: `ctyhp-accounting/lib/services/banking.ts`
- Test: `ctyhp-accounting/tests/unit/bank-categories-service.test.ts`

**Interfaces:**
- Consumes: the two RPCs from Task 1.
- Produces: `BankCategoryRow { id: string; name: string; is_active: boolean }`; `BankTransactionRow` gains `bank_category_id: string | null` and `bank_category_name: string | null`; `listBankCategories(sb): Promise<BankCategoryRow[]>`; `createBankCategory(sb, name: string): Promise<string>`; `setBankTransactionCategory(sb, txnId: string, categoryId: string | null): Promise<void>`.

- [x] **Step 1: Write the failing service tests**

Create `ctyhp-accounting/tests/unit/bank-categories-service.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BankingError,
  createBankCategory,
  listBankCategories,
  listBankTransactions,
  setBankTransactionCategory,
} from "@/lib/services/banking";

describe("createBankCategory", () => {
  it("asks the database to reuse a name it already knows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "category-1", error: null });

    const id = await createBankCategory({ rpc } as unknown as SupabaseClient, "  Inventory  ");

    expect(id).toBe("category-1");
    expect(rpc).toHaveBeenCalledWith("acc_upsert_bank_category", { p_name: "  Inventory  " });
  });

  it("surfaces the refusal as BankingError", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "A category name cannot exceed 60 characters" },
    });

    await expect(
      createBankCategory({ rpc } as unknown as SupabaseClient, "x".repeat(61)),
    ).rejects.toEqual(expect.any(BankingError));
  });
});

describe("setBankTransactionCategory", () => {
  it("attaches a label", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await setBankTransactionCategory({ rpc } as unknown as SupabaseClient, "txn-1", "category-1");

    expect(rpc).toHaveBeenCalledWith("acc_set_bank_transaction_category", {
      p_txn_id: "txn-1",
      p_category_id: "category-1",
    });
  });

  it("clears one with null rather than an empty string", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await setBankTransactionCategory({ rpc } as unknown as SupabaseClient, "txn-1", null);

    expect(rpc).toHaveBeenCalledWith("acc_set_bank_transaction_category", {
      p_txn_id: "txn-1",
      p_category_id: null,
    });
  });
});

describe("listBankCategories", () => {
  it("reads the active labels in name order", async () => {
    const asked: Record<string, unknown> = {};
    const chain = {
      select(columns: string) {
        asked.columns = columns;
        return chain;
      },
      eq(column: string, value: unknown) {
        asked.eq = [column, value];
        return chain;
      },
      order(column: string) {
        asked.order = column;
        return Promise.resolve({
          data: [{ id: "category-1", name: "Inventory", is_active: true }],
          error: null,
        });
      },
    };
    const sb = { from: () => chain } as unknown as SupabaseClient;

    const rows = await listBankCategories(sb);

    expect(asked.eq).toEqual(["is_active", true]);
    expect(asked.order).toBe("name");
    expect(rows).toEqual([{ id: "category-1", name: "Inventory", is_active: true }]);
  });
});

describe("listBankTransactions", () => {
  it("brings each line's label name with it, in one query", async () => {
    let asked = "";
    const chain = {
      select(columns: string) {
        asked = columns;
        return chain;
      },
      is: () => chain,
      eq: () => chain,
      order: () =>
        Promise.resolve({
          data: [
            {
              id: "txn-1",
              bank_category_id: "category-1",
              acc_bank_category: { name: "Inventory" },
            },
            { id: "txn-2", bank_category_id: null, acc_bank_category: null },
          ],
          error: null,
        }),
    };
    const sb = { from: () => chain } as unknown as SupabaseClient;

    const rows = await listBankTransactions(sb, null);

    expect(asked).toContain("acc_bank_category(name)");
    expect(rows[0].bank_category_name).toBe("Inventory");
    expect(rows[1].bank_category_name).toBeNull();
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/bank-categories-service.test.ts`

Expected: FAIL because the three functions are not exported.

- [x] **Step 3: Extend the row types**

In `ctyhp-accounting/lib/db/types.ts`, inside `BankTransactionRow`, directly below
`category: string | null;`:

```ts
  /**
   * The bookkeeper's own label. Distinct from `category` above, which is what
   * the bank feed said — see migration 0098.
   */
  bank_category_id: string | null;
  /** Joined for the list; never written through this field. */
  bank_category_name: string | null;
```

And after the interface:

```ts
export interface BankCategoryRow {
  id: string;
  name: string;
  is_active: boolean;
}
```

- [x] **Step 4: Implement the service functions**

In `ctyhp-accounting/lib/services/banking.ts`, replace the body of
`listBankTransactions` so the label's name arrives with the row, and add the
three functions directly after it:

```ts
export async function listBankTransactions(
  sb: SupabaseClient,
  bankAccountId: string | null,
): Promise<BankTransactionRow[]> {
  let query = sb
    .from("acc_bank_transaction")
    // The label's name comes along, so the list does not ask once per row.
    .select("*,acc_bank_category(name)")
    .is("provider_removed_at", null);
  if (bankAccountId) query = query.eq("bank_account_id", bankAccountId);
  const { data, error } = await query.order("txn_date", { ascending: false });
  if (error) throw new BankingError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    ...(row as unknown as BankTransactionRow),
    bank_category_name: (row.acc_bank_category as { name?: string } | null)?.name ?? null,
  }));
}

/** The labels a bookkeeper may choose from, in the order they read them. */
export async function listBankCategories(sb: SupabaseClient): Promise<BankCategoryRow[]> {
  const { data, error } = await sb
    .from("acc_bank_category")
    .select("id,name,is_active")
    .eq("is_active", true)
    .order("name");
  if (error) throw new BankingError(error.message);
  return (data ?? []) as unknown as BankCategoryRow[];
}

/**
 * Create a label, or hand back the one that already carries this name. The
 * decision is the database's, so two people typing "Inventory" at once cannot
 * produce two labels.
 */
export async function createBankCategory(sb: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await sb.rpc("acc_upsert_bank_category", { p_name: name });
  if (error) throw new BankingError(error.message);
  return data as string;
}

/** Attach a label to a bank line, or pass null to take it off. */
export async function setBankTransactionCategory(
  sb: SupabaseClient,
  txnId: string,
  categoryId: string | null,
): Promise<void> {
  const { error } = await sb.rpc("acc_set_bank_transaction_category", {
    p_txn_id: txnId,
    p_category_id: categoryId,
  });
  if (error) throw new BankingError(error.message);
}
```

Add `BankCategoryRow` to the existing `import type { … } from "@/lib/db/types"` at
the top of the file.

- [x] **Step 5: Run the tests and typecheck**

Run: `npm test -- tests/unit/bank-categories-service.test.ts tests/unit/banking-import.test.ts`

Expected: PASS, both files.

Run: `npm run typecheck`

Expected: clean. If any test fixture builds a `BankTransactionRow` literal and
now fails to compile, add `bank_category_id: null, bank_category_name: null` to
that fixture rather than loosening the type.

- [x] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/db/types.ts ctyhp-accounting/lib/services/banking.ts ctyhp-accounting/tests/unit/bank-categories-service.test.ts
git commit -m "Read a bank line's label with the line, and write it through one door"
```

---

### Task 3: The two actions

**Files:**
- Modify: `ctyhp-accounting/app/(app)/banking/actions.ts`
- Test: `ctyhp-accounting/tests/unit/bank-categories-action.test.ts`

**Interfaces:**
- Consumes: `createBankCategory`, `setBankTransactionCategory`, `listBankCategories`, and the file's existing `guard()` helper.
- Produces: `createBankCategoryAction(name: string): Promise<ActionResult<{ id: string; name: string }>>` and `setBankTransactionCategoryAction(txnId: string, categoryId: string | null): Promise<ActionResult>`. Task 5 is what makes `/banking` load and pass the labels.

- [x] **Step 1: Write the failing action tests**

Create `ctyhp-accounting/tests/unit/bank-categories-action.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  getSessionUser: vi.fn(),
  createClient: vi.fn(),
  createBankCategory: vi.fn(),
  setBankTransactionCategory: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({
  getUserRole: mocks.getUserRole,
  canWrite: mocks.canWrite,
  getSessionUser: mocks.getSessionUser,
}));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/banking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/banking")>()),
  createBankCategory: mocks.createBankCategory,
  setBankTransactionCategory: mocks.setBankTransactionCategory,
}));

import {
  createBankCategoryAction,
  setBankTransactionCategoryAction,
} from "@/app/(app)/banking/actions";

describe("bank category actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRole.mockResolvedValue("accountant");
    mocks.canWrite.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ marker: "company-bound" });
    mocks.createBankCategory.mockResolvedValue("category-1");
    mocks.setBankTransactionCategory.mockResolvedValue(undefined);
  });

  it("refuses a reader before opening a database client", async () => {
    mocks.canWrite.mockReturnValue(false);

    await expect(createBankCategoryAction("Inventory")).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    await expect(setBankTransactionCategoryAction("txn-1", "category-1")).resolves.toEqual({
      ok: false,
      error: "You do not have permission to perform this action",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("refuses an empty name without asking the database", async () => {
    const result = await createBankCategoryAction("   ");

    expect(result.ok).toBe(false);
    expect(mocks.createBankCategory).not.toHaveBeenCalled();
  });

  it("returns the label the database settled on, trimmed", async () => {
    await expect(createBankCategoryAction("  Website Platform  ")).resolves.toEqual({
      ok: true,
      data: { id: "category-1", name: "Website Platform" },
    });
    expect(mocks.createBankCategory).toHaveBeenCalledWith(
      { marker: "company-bound" },
      "Website Platform",
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/banking"]);
  });

  it("attaches and clears a label, and revalidates the screen", async () => {
    await expect(setBankTransactionCategoryAction("txn-1", "category-1")).resolves.toEqual({
      ok: true,
    });
    expect(mocks.setBankTransactionCategory).toHaveBeenCalledWith(
      { marker: "company-bound" },
      "txn-1",
      "category-1",
    );

    await expect(setBankTransactionCategoryAction("txn-1", null)).resolves.toEqual({ ok: true });
    expect(mocks.setBankTransactionCategory).toHaveBeenLastCalledWith(
      { marker: "company-bound" },
      "txn-1",
      null,
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/banking", "/banking"]);
  });

  it("passes the database's refusal through unchanged", async () => {
    mocks.setBankTransactionCategory.mockRejectedValue(
      new Error("That category does not exist"),
    );

    await expect(setBankTransactionCategoryAction("txn-1", "gone")).resolves.toEqual({
      ok: false,
      error: "That category does not exist",
    });
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/bank-categories-action.test.ts`

Expected: FAIL because neither action exists.

- [x] **Step 3: Write the actions**

In `ctyhp-accounting/app/(app)/banking/actions.ts`, add `createBankCategory` and
`setBankTransactionCategory` to the existing import from
`@/lib/services/banking`, then append:

```ts
/**
 * Create a label, or reuse the one that already has this name.
 *
 * The name is trimmed here so the screen and the database agree on what was
 * typed; everything else about uniqueness belongs to `acc_upsert_bank_category`.
 */
export async function createBankCategoryAction(
  name: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "A category name is required" };
  if (trimmed.length > 60) {
    return { ok: false, error: "A category name cannot exceed 60 characters" };
  }
  try {
    const sb = await createSupabaseServerClient();
    const id = await createBankCategory(sb, trimmed);
    revalidatePath("/banking");
    return { ok: true, data: { id, name: trimmed } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the category" };
  }
}

/** Attach a label to a bank line, or pass null to take it off. */
export async function setBankTransactionCategoryAction(
  txnId: string,
  categoryId: string | null,
): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await setBankTransactionCategory(sb, txnId, categoryId);
    revalidatePath("/banking");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save the category" };
  }
}
```

- [x] **Step 4: Run the tests and typecheck**

Run: `npm test -- tests/unit/bank-categories-action.test.ts`

Expected: PASS, 5 tests.

Run: `npm run typecheck`

Expected: clean. `page.tsx` is deliberately left alone until Task 5 — loading the
labels before `BankingClient` accepts them would make this commit's typecheck
red, and no commit here may be red.

- [x] **Step 5: Commit**

```bash
git add 'ctyhp-accounting/app/(app)/banking/actions.ts' ctyhp-accounting/tests/unit/bank-categories-action.test.ts
git commit -m "Authorize labelling a bank line"
```

---

### Task 4: Move the table out, changing nothing

**Files:**
- Create: `ctyhp-accounting/app/(app)/banking/BankTransactionsTable.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/BankingClient.tsx`

**Interfaces:**
- Produces: `BankTransactionsTable` with props `{ rows, loading, initialFocusId, canWrite, canReadDocuments, currencyDecimals, onSettle, onApprove, onReject, onAttachments, busyId }` — the exact set the moved columns already use.
- No behaviour changes. This task exists so the reviewer of Task 5 can see one diff that adds a feature, not one that also moves 300 lines.

- [x] **Step 1: Record the starting line counts**

Run: `wc -l 'app/(app)/banking/BankingClient.tsx'`

Expected: `1042`. Write the number down; Step 5 compares against it.

- [x] **Step 2: Create the component with the moved code**

Create `ctyhp-accounting/app/(app)/banking/BankTransactionsTable.tsx` as a
`"use client"` component. Move into it, unchanged:

- the `transactionColumns` definition (currently `BankingClient.tsx:450`–`~590`),
- the `<DataTable …>` element that renders the transactions (currently `:774`–`:790`).

Everything the moved code reads becomes a prop. Declare them explicitly:

```tsx
"use client";
import { Button, Space, Tag, Typography, type TableColumnsType } from "antd";
import { PaperClipOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import type { BankReviewRow } from "@/lib/domain/banking-import";
import type { BankTransactionRow } from "@/lib/db/types";
import type { SuggestionView } from "@/lib/services/banking";

export type BankReviewTableRow = BankReviewRow<BankTransactionRow, SuggestionView>;

export interface BankTransactionsTableProps {
  rows: BankReviewTableRow[];
  loading: boolean;
  initialFocusId: string | null;
  canWrite: boolean;
  canReadDocuments: boolean;
  busyId: string | null;
  formatRowMoney: (row: BankReviewTableRow) => string;
  onSettle: (row: BankReviewTableRow) => void;
  onApprove: (row: BankReviewTableRow) => void;
  onReject: (row: BankReviewTableRow) => void;
  onAttachments: (row: BankReviewTableRow) => void;
}
```

Keep every string, colour, width and `Tag` exactly as it was. This step must not
improve anything.

- [x] **Step 3: Use it from `BankingClient`**

In `BankingClient.tsx`, delete the moved code and render:

```tsx
      <BankTransactionsTable
        rows={reviewRows}
        loading={loading}
        initialFocusId={initialFocusId}
        canWrite={canWrite}
        canReadDocuments={canReadDocuments}
        busyId={busyId}
        formatRowMoney={rowMoney}
        onSettle={openSettle}
        onApprove={(row) => void approve(row)}
        onReject={(row) => void reject(row)}
        onAttachments={(row) =>
          setAttachmentTarget({
            entityType: "bank_transaction",
            entityId: row.transaction.id,
            label: row.transaction.description,
          })
        }
      />
```

Use the existing handler names from the file; if a handler has a different name
or signature, adapt the prop at the call site rather than renaming the handler.
Import the component and drop any imports `BankingClient` no longer uses — lint
will name them.

- [x] **Step 4: Prove nothing changed**

Run:

```bash
npm run typecheck
npx eslint 'app/(app)/banking/*.tsx'
npm test
```

Expected: typecheck clean, eslint silent, every test passing.

Run:

```bash
npm run build
npm start &
node --env-file=.env.local scripts/smoke-pages.mjs http://127.0.0.1:3000 --only=banking
```

Expected: `/banking` returns 200. Stop the server afterwards.

- [x] **Step 5: Check the file shrank**

Run: `wc -l 'app/(app)/banking/BankingClient.tsx' 'app/(app)/banking/BankTransactionsTable.tsx'`

Expected: `BankingClient.tsx` is at least 250 lines shorter than the 1042 it
started at, and `BankTransactionsTable.tsx` is under 400.

- [x] **Step 6: Commit the move on its own**

```bash
git add 'ctyhp-accounting/app/(app)/banking/BankTransactionsTable.tsx' 'ctyhp-accounting/app/(app)/banking/BankingClient.tsx'
git commit -m "Move the bank transactions table into its own component"
```

---

### Task 5: The column, and the filter that makes it useful

**Files:**
- Create: `ctyhp-accounting/app/(app)/banking/BankCategoryCell.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/BankTransactionsTable.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/BankingClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/banking/page.tsx`
- Test: `ctyhp-accounting/tests/unit/bank-categories-ui-contract.test.ts`

**Interfaces:**
- Consumes: `createBankCategoryAction`, `setBankTransactionCategoryAction`, `BankCategoryRow`.
- Produces: `BankCategoryCell`; `BankTransactionsTable` gains `categories`, `onCategoryCreated`, `onCategoryAssigned`; `BankingClient` gains the `bankCategories` prop and a category filter.

- [x] **Step 1: Write the failing UI contract test**

Create `ctyhp-accounting/tests/unit/bank-categories-ui-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = ["app", "(app)", "banking"];
const read = (file: string) => readFileSync(join(process.cwd(), ...route, file), "utf8");

describe("the banking category column", () => {
  it("puts the label control in its own component", () => {
    const cell = read("BankCategoryCell.tsx");
    expect(cell).toContain("setBankTransactionCategoryAction");
    expect(cell).toContain("createBankCategoryAction");
    // Typing a name that does not exist has to be offered, or "freely" is a lie.
    expect(cell).toMatch(/Create\s/);
  });

  it("shows the column between the amount and the match", () => {
    const table = read("BankTransactionsTable.tsx");
    expect(table).toContain("<BankCategoryCell");
    const amountAt = table.indexOf('title: "Amount"');
    const categoryAt = table.indexOf('title: "Category"');
    const matchAt = table.indexOf('title: "Match"');
    expect(amountAt).toBeGreaterThan(-1);
    expect(categoryAt).toBeGreaterThan(amountAt);
    expect(matchAt).toBeGreaterThan(categoryAt);
  });

  it("lets the list be narrowed to a label, and to the lines with none", () => {
    const client = read("BankingClient.tsx");
    expect(client).toContain("bankCategories");
    expect(client).toContain("All categories");
    expect(client).toContain("Uncategorized");
    expect(read("page.tsx")).toContain("listBankCategories");
  });

  it("never touches the feed's own category through this column", () => {
    const cell = read("BankCategoryCell.tsx");
    expect(cell).not.toMatch(/transaction\.category\b/);
    expect(cell).toContain("bank_category_id");
  });

  it("keeps every banking component under the 400-line ceiling", () => {
    for (const file of ["BankTransactionsTable.tsx", "BankCategoryCell.tsx"]) {
      expect(read(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(400);
    }
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/bank-categories-ui-contract.test.ts`

Expected: FAIL with `ENOENT` for `BankCategoryCell.tsx`.

- [x] **Step 3: Write the cell**

Create `ctyhp-accounting/app/(app)/banking/BankCategoryCell.tsx`:

```tsx
"use client";
import { useState } from "react";
import { App, Button, Divider, Select, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { BankCategoryRow } from "@/lib/db/types";
import { createBankCategoryAction, setBankTransactionCategoryAction } from "./actions";

export interface BankCategoryCellProps {
  transactionId: string;
  /** The label currently on this line, from `bank_category_id`. */
  value: string | null;
  valueName: string | null;
  categories: BankCategoryRow[];
  canWrite: boolean;
  onCreated: (category: BankCategoryRow) => void;
  onAssigned: (transactionId: string, categoryId: string | null) => void;
}

/**
 * One bank line's label.
 *
 * Chosen straight in the row and saved at once — a label is not a document, so
 * there is nothing to submit. A name nobody has used yet can be created here
 * rather than on a settings screen, because the moment you need a new word for
 * a transaction is while you are looking at the transaction.
 */
export default function BankCategoryCell({
  transactionId,
  value,
  valueName,
  categories,
  canWrite,
  onCreated,
  onAssigned,
}: BankCategoryCellProps) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [typed, setTyped] = useState("");

  // A reader sees the fact, not a control they cannot use.
  if (!canWrite) {
    return valueName ? <span>{valueName}</span> : <Typography.Text type="secondary">—</Typography.Text>;
  }

  async function assign(categoryId: string | null) {
    setSaving(true);
    try {
      const res = await setBankTransactionCategoryAction(transactionId, categoryId);
      if (!res.ok) {
        message.error(res.error ?? "Could not save the category");
        return;
      }
      onAssigned(transactionId, categoryId);
    } finally {
      setSaving(false);
    }
  }

  async function createAndAssign() {
    const name = typed.trim();
    if (!name) return;
    setSaving(true);
    try {
      const created = await createBankCategoryAction(name);
      if (!created.ok || !created.data) {
        message.error(created.error ?? "Could not create the category");
        return;
      }
      onCreated({ id: created.data.id, name: created.data.name, is_active: true });
      const res = await setBankTransactionCategoryAction(transactionId, created.data.id);
      if (!res.ok) {
        message.error(res.error ?? "Could not save the category");
        return;
      }
      onAssigned(transactionId, created.data.id);
      setTyped("");
    } finally {
      setSaving(false);
    }
  }

  const knownName = categories.some(
    (category) => category.name.toLowerCase() === typed.trim().toLowerCase(),
  );

  return (
    <Select
      value={value ?? undefined}
      loading={saving}
      disabled={saving}
      allowClear
      showSearch
      placeholder="Uncategorized"
      style={{ minWidth: 170 }}
      aria-label="Category"
      optionFilterProp="label"
      onSearch={setTyped}
      onChange={(next) => void assign(next ?? null)}
      options={categories.map((category) => ({ value: category.id, label: category.name }))}
      notFoundContent={null}
      popupRender={(menu) => (
        <>
          {menu}
          {typed.trim() && !knownName ? (
            <>
              <Divider style={{ margin: "4px 0" }} />
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => void createAndAssign()}>
                Create “{typed.trim()}”
              </Button>
            </>
          ) : null}
        </>
      )}
    />
  );
}
```

- [x] **Step 4: Add the column**

In `BankTransactionsTable.tsx`, extend the props with

```tsx
  categories: BankCategoryRow[];
  onCategoryCreated: (category: BankCategoryRow) => void;
  onCategoryAssigned: (transactionId: string, categoryId: string | null) => void;
```

and insert this column immediately after the Amount column and before Match:

```tsx
    {
      title: "Category",
      key: "category",
      width: 190,
      render: (_value: unknown, row: BankReviewTableRow) => (
        <BankCategoryCell
          transactionId={row.transaction.id}
          value={row.transaction.bank_category_id}
          valueName={row.transaction.bank_category_name}
          categories={categories}
          canWrite={canWrite}
          onCreated={onCategoryCreated}
          onAssigned={onCategoryAssigned}
        />
      ),
    },
```

- [x] **Step 5: Load the labels on the server**

In `ctyhp-accounting/app/(app)/banking/page.tsx`: import `listBankCategories`
alongside `listBankAccounts`, add `bankCategories` to the destructured array and
`listBankCategories(sb)` at the same position in the `Promise.all`, then pass
`bankCategories={bankCategories}` to `BankingClient`.

- [x] **Step 6: Wire the filter and the state**

In `BankingClient.tsx`:

- add `bankCategories: BankCategoryRow[]` to the props and
  `const [categories, setCategories] = useState(bankCategories);`
- add `const [categoryFilter, setCategoryFilter] = useState<string>("all");`
- narrow the rows where `visibleTransactions` is already computed:

```tsx
  const categorized = visibleTransactions.filter((transaction) =>
    categoryFilter === "all"
      ? true
      : categoryFilter === "none"
        ? transaction.bank_category_id === null
        : transaction.bank_category_id === categoryFilter,
  );
```

  and build `reviewRows` from `categorized` instead of `visibleTransactions`.

- add the filter beside the status filter inside the existing `FilterBar`:

```tsx
          <Select
            aria-label="Filter bank transactions by category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            style={{ minWidth: 180 }}
            options={[
              { value: "all", label: "All categories" },
              { value: "none", label: "Uncategorized" },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
```

- pass the three new props to `BankTransactionsTable`, keeping the local list in
  step with what was just saved so the row does not wait for a refetch:

```tsx
        categories={categories}
        onCategoryCreated={(category) =>
          setCategories((current) =>
            current.some((existing) => existing.id === category.id)
              ? current
              : [...current, category].sort((a, b) => a.name.localeCompare(b.name)),
          )
        }
        onCategoryAssigned={(transactionId, categoryId) =>
          setTxns((current) =>
            current.map((transaction) =>
              transaction.id === transactionId
                ? {
                    ...transaction,
                    bank_category_id: categoryId,
                    bank_category_name:
                      categories.find((category) => category.id === categoryId)?.name ?? null,
                  }
                : transaction,
            ),
          )
        }
```

Use the existing state setter for the transactions list; it is `setTxns` if the
list is held in `txns`.

- [x] **Step 7: Run the tests, typecheck and lint**

Run:

```bash
npm test -- tests/unit/bank-categories-ui-contract.test.ts tests/unit/rsc-antd.test.ts
npm run typecheck
npx eslint 'app/(app)/banking/*.tsx' 'app/(app)/banking/actions.ts'
```

Expected: all pass with zero errors. If eslint reports
`react-hooks/set-state-in-effect`, move the `setState` into an async callback
rather than adding a disable comment.

- [x] **Step 8: Commit**

```bash
git add 'ctyhp-accounting/app/(app)/banking' ctyhp-accounting/tests/unit/bank-categories-ui-contract.test.ts
git commit -m "Let a bookkeeper label a bank line, and find the ones with no label"
```

---

### Task 6: Prove it against a real database, then ship

**Files:**
- Create: `ctyhp-accounting/scripts/verify-bank-categories.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes: migration 0098 and the live database through `SUPABASE_DB_URL`.
- Produces: `npm run verify:bank-categories`, rollback-only.

- [x] **Step 1: Add the package script**

In `ctyhp-accounting/package.json`, beside the other verifiers:

```json
"verify:bank-categories": "node --env-file=.env.local scripts/verify-bank-categories.mjs",
```

- [x] **Step 2: Write the rollback-only harness**

Create `ctyhp-accounting/scripts/verify-bank-categories.mjs`. Copy the header
comment style, `client`, `check`, `one`, `scenario` and `attempt` helpers from
`scripts/verify-payment-correction.mjs`, then use this body:

```js
await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0098_bank_transaction_categories.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0098 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  const asAdmin = () =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id, role: "authenticated" }),
    ]);
  await asAdmin();

  const txn = await one(`select id, amount_minor, description from acc_bank_transaction limit 1`);
  if (!txn) throw new Error("no bank transaction to label");

  await scenario("a label is created once, however it is typed", async () => {
    const first = await one(`select acc_upsert_bank_category($1) as id`, ["  Inventory  "]);
    const again = await one(`select acc_upsert_bank_category($1) as id`, ["inventory"]);
    check("the same label came back", first.id === again.id, `${first.id} vs ${again.id}`);
    const row = await one(`select name from acc_bank_category where id = $1`, [first.id]);
    check("the name was trimmed", row.name === "Inventory", row.name);

    await client.query("savepoint before_call");
    const blank = await attempt(`select acc_upsert_bank_category($1)`, ["   "]);
    check("an empty name is refused", /name is required/i.test(blank ?? ""), blank ?? "none");
    await client.query("savepoint before_call");
    const long = await attempt(`select acc_upsert_bank_category($1)`, ["x".repeat(61)]);
    check("an over-long name is refused", /60 characters/i.test(long ?? ""), long ?? "none");
  });

  await scenario("a label attaches to a bank line and comes off again", async () => {
    const category = await one(`select acc_upsert_bank_category($1) as id`, ["Website Platform"]);
    await client.query(`select acc_set_bank_transaction_category($1, $2)`, [txn.id, category.id]);
    const after = await one(
      `select bank_category_id, amount_minor, description from acc_bank_transaction where id = $1`,
      [txn.id],
    );
    check("the label is on the line", after.bank_category_id === category.id);
    check("the amount did not move", String(after.amount_minor) === String(txn.amount_minor));
    check("the description did not move", after.description === txn.description);

    await client.query(`select acc_set_bank_transaction_category($1, null)`, [txn.id]);
    const cleared = await one(`select bank_category_id from acc_bank_transaction where id = $1`, [
      txn.id,
    ]);
    check("it comes off again", cleared.bank_category_id === null);

    await client.query("savepoint before_call");
    const unknown = await attempt(`select acc_set_bank_transaction_category($1, $2)`, [
      txn.id,
      "11111111-1111-4111-8111-111111111111",
    ]);
    check("an unknown label is refused", /does not exist/i.test(unknown ?? ""), unknown ?? "none");
  });

  await scenario("the bank line is still immutable", async () => {
    await client.query("savepoint before_call");
    const refusal = await attempt(
      `update acc_bank_transaction set amount_minor = amount_minor + 1 where id = $1`,
      [txn.id],
    );
    check("changing the amount is still refused", /immutable/i.test(refusal ?? ""), refusal ?? "none");
  });

  await scenario("a viewer cannot label anything", async () => {
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
    const create = await attempt(`select acc_upsert_bank_category($1)`, ["Sneaky"]);
    check("creating is refused", /Not authorized/i.test(create ?? ""), create ?? "none");
    await client.query("savepoint before_call");
    const assign = await attempt(`select acc_set_bank_transaction_category($1, null)`, [txn.id]);
    check("assigning is refused", /Not authorized/i.test(assign ?? ""), assign ?? "none");
    await asAdmin();
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no label and no assignment was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [x] **Step 3: Static safety check, then run it**

Run:

```bash
grep -niE "^[^/*]*\bcommit\b" scripts/verify-bank-categories.mjs
npm run security:check-source
npm run verify:bank-categories
```

Expected: the grep prints nothing, the credential check passes, every assertion
prints PASS, the final line confirms `ROLLBACK`, and `0 failed`.

- [x] **Step 4: Run every project gate**

Run, recording real output:

```bash
npm test
npm run typecheck
npm run lint
npm run security:check-source
npm run build
```

Expected: all tests pass, typecheck and the credential check clean, lint zero
errors with only the pre-existing `scripts/verify-*.mjs` warnings, build exits 0.

- [x] **Step 5: Smoke the built server**

Start the built server, then run:

```bash
node --env-file=.env.local scripts/smoke-pages.mjs http://127.0.0.1:3000
```

Expected: every page 200, `/banking` among them. Stop the server afterwards.

- [x] **Step 6: Apply the migration to every company**

Run: `node --env-file=.env.local scripts/migrate.mjs`

Expected: `0098_bank_transaction_categories.sql ... ok` for `public` and each
company schema, with no statements held back — every object here belongs to a
company. Then confirm the column and both functions exist in all four schemas.

- [x] **Step 7: Review the diff and commit**

Run:

```bash
git diff --check
git status --short
git log --oneline -7
```

Confirm only planned files changed and `.claude/settings.json` is untouched, then:

```bash
git add ctyhp-accounting/scripts/verify-bank-categories.mjs ctyhp-accounting/package.json
git commit -m "Prove a bank label sticks, comes off, and changes nothing else"
```

- [x] **Step 8: Close the feedback loop**

The report that asked for this is `773843b7-8daf-493b-b7a6-da60ba0be639`, still
`reviewing`. Do **not** change its status from a script: move it to `resolved`
from `/settings/feedback` so the triage note records who decided it was done.
State in the completion report that this is the remaining manual step.
