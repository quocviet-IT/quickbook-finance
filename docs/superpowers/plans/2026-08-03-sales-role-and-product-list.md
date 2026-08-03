# Sales Role & the Product List on the Sales Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sales staff maintain the product catalog without granting them the ledger, and make that catalog reachable and self-explanatory from where invoices are raised.

**Architecture:** A fourth `acc_app_role` value, `sales`, plus an `items.manage` permission that becomes the single gate on `acc_item` writes in both RLS and the Server Action. Every existing write gate is an allow-list, so the new role denies by default everywhere and only the catalog door is opened. Products & Services moves into the Sales navigation group, and item pickers explain themselves when the catalog is empty.

**Tech Stack:** Next.js (see `AGENTS.md` — read `node_modules/next/dist/docs/` before writing route code), TypeScript, Ant Design 5, Supabase Postgres with RLS, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-sales-role-and-product-list-design.md`

## Global Constraints

- Product name in user-visible copy is **One Book**. Do not rename the repo folder, package, or Vercel project.
- All UI copy is US English. Currency is USD. "Sales Tax", never "VAT".
- Money is minor units end-to-end; convert only at the UI edge.
- No SQL in components. Financial writes go through `lib/services/*` into Postgres RPC.
- Never disable RLS. Never duplicate business logic in the frontend.
- Never set `created_by` / `created_at` / `updated_by` / `updated_at` from application code — `acc_stamp_actor()` owns them.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, …). Keep markup in `"use client"` components.
- Postgres will not let a value added by `ALTER TYPE ... ADD VALUE` be used in the same transaction. The enum change gets its own migration.
- Every migration must reach every company schema. `scripts/migrate.mjs` loops the register.
- Verification gates, all must pass with real pasted output: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- `scripts/smoke-pages.mjs` and the HTTPS end-to-end suites need `ALLOW_DESTRUCTIVE_E2E=ONEBOOK_TEST_DATABASE_ONLY` and an isolated test project. The developer machine's `.env.local` points at production, where they refuse to run **by design**. Task 8 states this explicitly rather than skipping it silently.

## File Structure

| File | Responsibility |
|---|---|
| `ctyhp-accounting/supabase/migrations/0087_sales_role.sql` | **Create.** Adds the `sales` enum value, alone. |
| `ctyhp-accounting/supabase/migrations/0088_items_manage_permission.sql` | **Create.** Adds `items.manage`, backfills the grant matrix, repoints the `acc_item` write policy. |
| `ctyhp-accounting/lib/db/types.ts` | Modify. `AppRole` union. |
| `ctyhp-accounting/lib/domain/schemas.ts` | Modify. `APP_ROLES` tuple — the single ordered list of roles. |
| `ctyhp-accounting/app/(app)/settings/users/UsersClient.tsx` | Modify. Role dropdown, privileged-access copy. |
| `ctyhp-accounting/app/(app)/settings/permissions/PermissionMatrixClient.tsx` | Modify. Derive columns and empty grants from `APP_ROLES` so a future role cannot leave an undefined cell. |
| `ctyhp-accounting/app/(app)/items/actions.ts` | Modify. Guard on `items.manage` instead of `canWrite`. |
| `ctyhp-accounting/app/(app)/items/page.tsx` | Modify. Resolve two separate flags. |
| `ctyhp-accounting/app/(app)/items/ItemsClient.tsx` | Modify. Split `canWrite` into `canManageItems` and `canAdjustInventory`. |
| `ctyhp-accounting/lib/domain/navigation.ts` | Modify. Move the `/items` leaf into the Sales group. |
| `ctyhp-accounting/app/(app)/invoices/page.tsx` | Modify. Pass `canManageItems`. |
| `ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx` | Modify. Empty-catalog hint on the item picker. |
| `ctyhp-accounting/app/(app)/bills/page.tsx` | Modify. Pass `canManageItems`. |
| `ctyhp-accounting/app/(app)/bills/BillsClient.tsx` | Modify. Empty-catalog hint on the item picker. |
| `ctyhp-accounting/tests/unit/access.test.ts` | Modify. Role list and `canWrite` denial. |
| `ctyhp-accounting/tests/unit/navigation.test.ts` | Modify. New group membership. |
| `ctyhp-accounting/CLAUDE.md` | Modify. Record the role boundary in §3. |

Out of scope, stated so nobody adds it: recurring templates get no empty-catalog hint, because their line form has no item picker (`item_id` is hardcoded `null`). Giving them one is a separate feature.

---

### Task 1: The `sales` enum value

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0087_sales_role.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the enum value `'sales'` of type `acc_app_role`, usable from migration 0088 onward.

- [ ] **Step 1: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0087_sales_role.sql`:

```sql
-- A fourth application role: sales staff who maintain the product catalog but
-- never touch the ledger.
--
-- The value lands alone in this migration on purpose. Postgres refuses to use a
-- value added by ALTER TYPE ... ADD VALUE later in the same transaction, so
-- everything that references 'sales' waits for 0088.
--
-- Nothing else changes here, and nothing needs to. Every write gate in the
-- system is an allow-list -- canWrite() and acc_is_staff() name their roles,
-- acc_is_admin() compares to one, and acc_has_permission() coalesces a missing
-- grant to false. A role nobody has listed can read what any signed-in user
-- reads and write nothing at all.
alter type acc_app_role add value if not exists 'sales';
```

- [ ] **Step 2: Confirm the file is picked up in order**

Run: `ls ctyhp-accounting/supabase/migrations | tail -3`
Expected: `0086_feedback_improvement_direction.sql`, `0087_sales_role.sql`, and nothing numbered above.

- [ ] **Step 3: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0087_sales_role.sql
git commit -m "Add a sales role to the application role enum"
```

---

### Task 2: The `items.manage` permission and the catalog write policy

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0088_items_manage_permission.sql`

**Interfaces:**
- Consumes: `'sales'` from Task 1.
- Produces: permission key `items.manage`; `acc_item` writes gated by `acc_has_permission('items.manage')`.

- [ ] **Step 1: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0088_items_manage_permission.sql`:

```sql
-- Who may maintain the product catalog becomes a permission rather than a role
-- test, so the permission matrix screen is the only place that answers it.
insert into acc_permission (key, label, category, description, is_enforced) values
  ('items.manage', 'Manage products and services', 'Sales',
   'Create and edit products and services, and activate or deactivate them', true)
on conflict (key) do nothing;

-- Earlier migrations seeded acc_role_permission by naming the three roles
-- literally, so 'sales' has no rows at all -- and neither does any role for a
-- permission added after it was seeded. acc_has_permission is fail-closed and
-- would already deny, but the matrix screen renders one cell per stored row:
-- without these an admin sees a blank they cannot toggle.
insert into acc_role_permission (role, permission_key, allowed)
select r.role, p.key, false
  from (select unnest(enum_range(null::acc_app_role)) as role) r
 cross join acc_permission p
 where not exists (
   select 1
     from acc_role_permission rp
    where rp.role = r.role
      and rp.permission_key = p.key
 );

update acc_role_permission
   set allowed = true
 where permission_key = 'items.manage'
   and role in ('admin', 'accountant', 'sales');

-- The catalog was gated by "are you staff". One rule, one place: the grant
-- matrix. An admin who revokes items.manage from accountants now actually
-- revokes it, instead of being overruled by a role test hidden in RLS.
drop policy if exists acc_item_write on acc_item;
create policy acc_item_write on acc_item for all
  using (acc_has_permission('items.manage'))
  with check (acc_has_permission('items.manage'));
```

- [ ] **Step 2: Check the file for the two traps this migration could fall into**

Read the file back and confirm both:
1. It never writes `updated_by` or `updated_at` on `acc_role_permission` — `acc_stamp_actor()` and the column default own those.
2. It qualifies nothing with `public.` — `retargetToSchema()` rewrites such references per company, and there is nothing here that should be pinned.

- [ ] **Step 3: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0088_items_manage_permission.sql
git commit -m "Gate the product catalog on items.manage rather than on being staff"
```

---

### Task 3: Role plumbing in TypeScript

**Files:**
- Modify: `ctyhp-accounting/lib/db/types.ts:27`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts:604`
- Modify: `ctyhp-accounting/app/(app)/settings/users/UsersClient.tsx:25-29,107`
- Modify: `ctyhp-accounting/app/(app)/settings/permissions/PermissionMatrixClient.tsx:8,30`
- Test: `ctyhp-accounting/tests/unit/access.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (the TypeScript side does not need the migration applied).
- Produces: `AppRole` includes `"sales"`; `APP_ROLES` is the ordered tuple `["admin", "accountant", "sales", "viewer"]` and is the only place the role list is written down.

- [ ] **Step 1: Write the failing tests**

Append to `ctyhp-accounting/tests/unit/access.test.ts`:

```ts
describe("application roles", () => {
  it("carries a sales role between accountant and viewer", () => {
    expect(APP_ROLES).toEqual(["admin", "accountant", "sales", "viewer"]);
  });

  it("keeps sales out of every ledger write", () => {
    // canWrite is the allow-list 44 call sites rely on. If someone ever widens
    // it, sales silently gains invoice, payment and journal posting -- so this
    // assertion is the one that matters most in this file.
    expect(canWrite("sales")).toBe(false);
    expect(canWrite("admin")).toBe(true);
    expect(canWrite("accountant")).toBe(true);
    expect(canWrite("viewer")).toBe(false);
  });

  it("gives the permission matrix a cell for every role", () => {
    // A missing key renders an undefined cell rather than an off switch.
    const grants = emptyGrants();
    for (const role of APP_ROLES) expect(grants[role]).toBe(false);
    expect(Object.keys(grants).sort()).toEqual([...APP_ROLES].sort());
  });
});
```

Extend the existing import from `@/lib/domain/schemas` in that file to include `APP_ROLES`, extend the existing import from `@/lib/domain/access` to include `emptyGrants`, and add:

```ts
import { canWrite } from "@/lib/domain/roles";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ctyhp-accounting && npx vitest run tests/unit/access.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/roles'` and `emptyGrants is not a function`.

- [ ] **Step 3: Extract `canWrite` so a test can import it**

`lib/auth.ts` starts with `import "server-only"`, so a Vitest unit test cannot import it. Move the two pure role predicates into `lib/domain/`, where the project keeps rules worth testing, and re-export them from `lib/auth.ts` so every existing import path keeps working.

Do **not** create `lib/auth/roles.ts`: a `lib/auth/` directory beside `lib/auth.ts` makes `@/lib/auth` resolve on a rule nobody should have to remember.

Create `ctyhp-accounting/lib/domain/roles.ts`:

```ts
/**
 * Pure role predicates, kept out of `lib/auth.ts` because that module is
 * server-only and these are the part worth unit-testing.
 *
 * Both are allow-lists on purpose. A role that is not named here cannot write,
 * which is what lets a new role be added without auditing every call site.
 */
import type { AppRole } from "@/lib/db/types";

export function canWrite(role: AppRole | null): boolean {
  return role === "admin" || role === "accountant";
}

/** Config that only admins may change (tax rates, currencies, COA approval). */
export function isAdmin(role: AppRole | null): boolean {
  return role === "admin";
}
```

In `ctyhp-accounting/lib/auth.ts`, delete the two function bodies at the end of the file and re-export instead:

```ts
export { canWrite, isAdmin } from "./domain/roles";
```

- [ ] **Step 4: Add the role to the union and the tuple**

`ctyhp-accounting/lib/db/types.ts:27` — replace:

```ts
export type AppRole = "admin" | "accountant" | "viewer";
```

with:

```ts
export type AppRole = "admin" | "accountant" | "sales" | "viewer";
```

`ctyhp-accounting/lib/domain/schemas.ts:604` — replace:

```ts
export const APP_ROLES = ["admin", "accountant", "viewer"] as const;
```

with:

```ts
export const APP_ROLES = ["admin", "accountant", "sales", "viewer"] as const;
```

- [ ] **Step 5: Add `emptyGrants` to the access domain**

Append to `ctyhp-accounting/lib/domain/access.ts`:

```ts
import { APP_ROLES } from "@/lib/domain/schemas";
import type { AppRole } from "@/lib/db/types";

/**
 * A grant record with every role present and switched off.
 *
 * Derived from APP_ROLES rather than written out, because the permission matrix
 * renders one cell per key: a role missing here shows an undefined cell instead
 * of an off switch, and nobody notices until that role exists.
 */
export function emptyGrants(): Record<AppRole, boolean> {
  return Object.fromEntries(APP_ROLES.map((role) => [role, false])) as Record<AppRole, boolean>;
}
```

If `lib/domain/access.ts` already imports from `@/lib/db/types`, extend that import rather than adding a second one.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ctyhp-accounting && npx vitest run tests/unit/access.test.ts`
Expected: PASS, no failures.

- [ ] **Step 7: Put the role on the two Settings screens**

`ctyhp-accounting/app/(app)/settings/users/UsersClient.tsx:25-29` — replace:

```tsx
const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "accountant", label: "Accountant" },
  { value: "viewer", label: "Viewer" },
];
```

with:

```tsx
const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "accountant", label: "Accountant" },
  { value: "sales", label: "Sales" },
  { value: "viewer", label: "Viewer" },
];
```

In the same file at line 107, replace the Alert description string:

```tsx
        description="Admins and accountants are privileged users: they must enrol multi-factor authentication with the identity provider, and the MFA column below is how that policy is checked. Suspending or offboarding a user revokes read and write access immediately across the whole application. The last remaining active admin cannot be demoted or suspended."
```

with:

```tsx
        description="Admins, accountants and sales users are privileged users: they must enrol multi-factor authentication with the identity provider, and the MFA column below is how that policy is checked. Sales users cannot post to the ledger, but the prices they maintain decide what a customer is billed. Suspending or offboarding a user revokes read and write access immediately across the whole application. The last remaining active admin cannot be demoted or suspended."
```

Leave the MFA column renderer alone. It treats only `viewer` as "not required", so `sales` already reports as MFA-required — the one place a new role inherits the stricter default. Do not "tidy" it into an allow-list.

`ctyhp-accounting/app/(app)/settings/permissions/PermissionMatrixClient.tsx:8` — replace:

```tsx
const ROLES: AppRole[] = ["admin", "accountant", "viewer"];
```

with:

```tsx
import { APP_ROLES } from "@/lib/domain/schemas";
import { emptyGrants } from "@/lib/domain/access";

const ROLES: AppRole[] = [...APP_ROLES];
```

(place the two imports with the other imports at the top of the file, not at line 8).

In the same file at line 30, replace:

```tsx
      byKey.set(p.key, { admin: false, accountant: false, viewer: false });
```

with:

```tsx
      byKey.set(p.key, emptyGrants());
```

- [ ] **Step 8: Run the gates**

Run: `cd ctyhp-accounting && npm run typecheck && npm test`
Expected: typecheck exits 0; every test file passes. A type error naming `Record<AppRole, boolean>` means a literal role record was missed somewhere — fix it the same way, with `emptyGrants()`.

- [ ] **Step 9: Commit**

```bash
git add ctyhp-accounting/lib/db/types.ts ctyhp-accounting/lib/domain/schemas.ts \
        ctyhp-accounting/lib/domain/access.ts ctyhp-accounting/lib/auth.ts \
        ctyhp-accounting/lib/domain/roles.ts \
        "ctyhp-accounting/app/(app)/settings/users/UsersClient.tsx" \
        "ctyhp-accounting/app/(app)/settings/permissions/PermissionMatrixClient.tsx" \
        ctyhp-accounting/tests/unit/access.test.ts
git commit -m "Carry the sales role through the role list and the Settings screens"
```

---

### Task 4: The Items screen's two write flags

**Files:**
- Modify: `ctyhp-accounting/app/(app)/items/actions.ts:14-17`
- Modify: `ctyhp-accounting/app/(app)/items/page.tsx:12-21,62`
- Modify: `ctyhp-accounting/app/(app)/items/ItemsClient.tsx:36-60,150,234`

**Interfaces:**
- Consumes: permission key `items.manage` from Task 2; `AppRole` from Task 3.
- Produces: `ItemsClient` props `canManageItems: boolean` and `canAdjustInventory: boolean`, replacing `canWrite: boolean`.

- [ ] **Step 1: Move the Server Action guard onto the permission**

In `ctyhp-accounting/app/(app)/items/actions.ts`, replace the import line and the `guard` helper:

```ts
import { getUserRole, canWrite } from "@/lib/auth";
```

becomes

```ts
import { createSupabaseServerClient } from "@/lib/db/server";
import { hasPermission } from "@/lib/services/access";
```

(the file already imports `createSupabaseServerClient`; do not add it twice, and drop the now-unused `getUserRole` / `canWrite` import entirely)

```ts
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
```

becomes

```ts
/**
 * Catalog writes are gated by the grant matrix, not by role, so an admin can
 * hand price maintenance to sales without handing over the ledger. RLS enforces
 * the same permission on acc_item; this check is the one that produces a
 * readable message instead of a policy violation.
 */
async function guard(): Promise<string | null> {
  const sb = await createSupabaseServerClient();
  return (await hasPermission(sb, "items.manage"))
    ? null
    : "You do not have permission to manage products and services";
}
```

Leave `ctyhp-accounting/app/(app)/items/inventory-actions.ts` untouched. Its `canWrite` check is correct: an inventory adjustment posts to the ledger.

- [ ] **Step 2: Resolve the two flags on the page**

In `ctyhp-accounting/app/(app)/items/page.tsx`, add `hasPermission` to the imports:

```ts
import { hasPermission } from "@/lib/services/access";
```

Extend the `Promise.all` to resolve the permission alongside the role, replacing:

```ts
  const [items, accounts, taxCodes, valuation, role] = await Promise.all([
    listItems(sb),
    listAccounts(sb),
    listTaxCodes(sb),
    getInventoryValuation(sb, today),
    getUserRole(),
  ]);
```

with:

```ts
  const [items, accounts, taxCodes, valuation, role, canManageItems] = await Promise.all([
    listItems(sb),
    listAccounts(sb),
    listTaxCodes(sb),
    getInventoryValuation(sb, today),
    getUserRole(),
    hasPermission(sb, "items.manage"),
  ]);
```

Replace the single prop at line 62:

```tsx
        canWrite={canWrite(role)}
```

with:

```tsx
        canManageItems={canManageItems}
        canAdjustInventory={canWrite(role)}
```

- [ ] **Step 3: Split the prop in the client**

In `ctyhp-accounting/app/(app)/items/ItemsClient.tsx`, in the `Props` interface replace:

```tsx
  canWrite: boolean;
```

with:

```tsx
  /** Maintain the catalog: create, edit, activate and deactivate. */
  canManageItems: boolean;
  /**
   * Post an inventory adjustment. Separate from canManageItems because an
   * adjustment writes to the ledger and the catalog does not -- a sales user
   * holds the first and not the second.
   */
  canAdjustInventory: boolean;
```

In the destructured parameter list replace `canWrite,` with:

```tsx
  canManageItems,
  canAdjustInventory,
```

At line 150, replace `{canWrite ? (` with `{canManageItems ? (`.

At line 234, replace `canWrite ? (` with `canManageItems ? (`.

Inside that Actions cell, wrap only the Adjust button in the second flag. Replace:

```tsx
                  {r.is_inventory && (
                    <>
                      <IconActionButton
                        label="Adjust inventory"
                        icon={<ToolOutlined />}
                        onClick={() => setAdjusting(r)}
                      />
                      <IconActionButton
                        label="View inventory movements"
                        icon={<HistoryOutlined />}
                        onClick={() => setViewing(r)}
                      />
                    </>
                  )}
```

with:

```tsx
                  {r.is_inventory && (
                    <>
                      {canAdjustInventory && (
                        <IconActionButton
                          label="Adjust inventory"
                          icon={<ToolOutlined />}
                          onClick={() => setAdjusting(r)}
                        />
                      )}
                      <IconActionButton
                        label="View inventory movements"
                        icon={<HistoryOutlined />}
                        onClick={() => setViewing(r)}
                      />
                    </>
                  )}
```

Movements stay visible to anyone who can read the screen; only the write is gated.

- [ ] **Step 4: Run the gates**

Run: `cd ctyhp-accounting && npm run typecheck && npm test`
Expected: typecheck exits 0. A `canWrite` error in `items/page.tsx` means the `canWrite` import was dropped when it is still needed for `canAdjustInventory` — keep it.

- [ ] **Step 5: Commit**

```bash
git add "ctyhp-accounting/app/(app)/items/actions.ts" \
        "ctyhp-accounting/app/(app)/items/page.tsx" \
        "ctyhp-accounting/app/(app)/items/ItemsClient.tsx"
git commit -m "Separate maintaining the catalog from adjusting inventory"
```

---

### Task 5: Products & Services moves to Sales

**Files:**
- Modify: `ctyhp-accounting/lib/domain/navigation.ts:41-83`
- Test: `ctyhp-accounting/tests/unit/navigation.test.ts:118-133`

**Interfaces:**
- Consumes: nothing.
- Produces: `/items` resolves to the `sales` group via `findActiveGroup`.

- [ ] **Step 1: Update the failing test first**

In `ctyhp-accounting/tests/unit/navigation.test.ts`, replace the two `toEqual` blocks at lines 118-133:

```ts
    expect(isNavGroup(sales!) ? sales.children.map((item) => item.key) : []).toEqual([
      "/sales",
      "/customers",
      "/invoices",
      "/payments",
      "/credit-memos",
      "/sales-tax",
    ]);
    expect(isNavGroup(inventory!) ? inventory.children.map((item) => item.key) : []).toEqual([
      "/inventory",
      "/items",
      "/fixed-assets",
    ]);
```

with:

```ts
    expect(isNavGroup(sales!) ? sales.children.map((item) => item.key) : []).toEqual([
      "/sales",
      "/customers",
      "/items",
      "/invoices",
      "/payments",
      "/credit-memos",
      "/sales-tax",
    ]);
    expect(isNavGroup(inventory!) ? inventory.children.map((item) => item.key) : []).toEqual([
      "/inventory",
      "/fixed-assets",
    ]);
```

Add a test to the same `describe` block, guarding the duplicate-leaf trap:

```ts
  it("gives every route exactly one home in the sidebar", () => {
    // findActiveGroup returns the first group containing a route, so a leaf
    // listed twice makes sidebar highlighting depend on declaration order.
    const keys = navLeaves().map((page) => page.key);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it("files the product catalog under Sales", () => {
    expect(findActiveGroup("/items")).toBe("sales");
  });
```

Make sure `navLeaves` and `findActiveGroup` are in that file's import from `@/lib/domain/navigation`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ctyhp-accounting && npx vitest run tests/unit/navigation.test.ts`
Expected: FAIL — the group membership assertions do not match, and `findActiveGroup("/items")` returns `"inventory-assets"`.

- [ ] **Step 3: Move the leaf**

In `ctyhp-accounting/lib/domain/navigation.ts`, in the `sales` group add `/items` after `/customers`:

```ts
  {
    key: "sales",
    label: "Sales",
    children: [
      { key: "/sales", label: "Overview" },
      { key: "/customers", label: "Customers" },
      // The catalog belongs where prices are set on documents, not with the
      // stock it happens to also describe.
      { key: "/items", label: "Products & Services" },
      { key: "/invoices", label: "Invoices" },
      { key: "/payments", label: "Payments" },
      { key: "/credit-memos", label: "Credit Memos" },
      { key: "/sales-tax", label: "Sales Tax" },
    ],
  },
```

and remove it from `inventory-assets`:

```ts
  {
    key: "inventory-assets",
    label: "Inventory & Assets",
    children: [
      { key: "/inventory", label: "Overview" },
      { key: "/fixed-assets", label: "Fixed Assets" },
    ],
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ctyhp-accounting && npx vitest run tests/unit/navigation.test.ts`
Expected: PASS, no failures.

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/lib/domain/navigation.ts ctyhp-accounting/tests/unit/navigation.test.ts
git commit -m "File Products & Services under Sales"
```

---

### Task 6: Say so when the catalog is empty

**Files:**
- Modify: `ctyhp-accounting/app/(app)/invoices/page.tsx`
- Modify: `ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx:98-135,768-788`
- Modify: `ctyhp-accounting/app/(app)/bills/page.tsx`
- Modify: `ctyhp-accounting/app/(app)/bills/BillsClient.tsx:52-80,354-362`

**Interfaces:**
- Consumes: permission key `items.manage` from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Pass the permission into the invoice screen**

`ctyhp-accounting/app/(app)/invoices/page.tsx` already imports `hasPermission` from `@/lib/services/access`. Add `hasPermission(sb, "items.manage")` to the existing `Promise.all`, binding it to `canManageItems`, and pass it to the client:

```tsx
        canManageItems={canManageItems}
```

Do the same in `ctyhp-accounting/app/(app)/bills/page.tsx`, which also already imports `hasPermission`.

- [ ] **Step 2: Add the prop and the hint to the invoice line picker**

In `ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx`, add to both the destructured parameters and the inline props type:

```tsx
  canManageItems: boolean;
```

Add this component near the top of the file, below the imports:

```tsx
/**
 * An empty item dropdown is indistinguishable from a missing feature -- the
 * first round of user testing read it as exactly that. Say which screen holds
 * the catalog, and link it only for someone who can act on it.
 */
function EmptyCatalogHint({ canManage, children }: { canManage: boolean; children: string }) {
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {children}{" "}
      {canManage ? (
        <Link href="/items">Products &amp; Services</Link>
      ) : (
        <span>Ask someone who maintains Products &amp; Services.</span>
      )}
    </Typography.Text>
  );
}
```

Add `import Link from "next/link";` if the file does not already import it.

Replace the item `Form.Item` at line 768 so the Select carries an empty message and the hint sits under the line list. The Select gains one prop:

```tsx
                        notFoundContent={items.length === 0 ? "No products or services yet" : undefined}
```

and immediately after the closing `</Form.List>` at line 826, before the memo field, add:

```tsx
          {items.length === 0 ? (
            <div style={{ marginTop: 8 }}>
              <EmptyCatalogHint canManage={canManageItems}>
                No products or services yet, so lines must be typed in full. Add them once in
              </EmptyCatalogHint>
            </div>
          ) : null}
```

- [ ] **Step 3: Do the same on the bill line picker**

In `ctyhp-accounting/app/(app)/bills/BillsClient.tsx`, add `canManageItems: boolean;` to the props interface and the destructured parameters, add the same `EmptyCatalogHint` component and `Link` import, add to the Select at line 354:

```tsx
                        notFoundContent={items.length === 0 ? "No purchasable products yet" : undefined}
```

and after the bill line `Form.List` closes, add:

```tsx
          {items.length === 0 ? (
            <div style={{ marginTop: 8 }}>
              <EmptyCatalogHint canManage={canManageItems}>
                No purchasable products yet, so lines must be typed in full. Add them once in
              </EmptyCatalogHint>
            </div>
          ) : null}
```

The wording differs because this picker is filtered to `is_purchased`: a catalog full of sales-only items is still empty here, and "no products yet" would be false.

- [ ] **Step 4: Run the gates**

Run: `cd ctyhp-accounting && npm run typecheck && npm test && npm run lint`
Expected: typecheck exits 0; all tests pass; lint reports 0 errors (11 pre-existing warnings in `scripts/*.mjs` are unrelated and stay).

- [ ] **Step 5: Commit**

```bash
git add "ctyhp-accounting/app/(app)/invoices/page.tsx" \
        "ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx" \
        "ctyhp-accounting/app/(app)/bills/page.tsx" \
        "ctyhp-accounting/app/(app)/bills/BillsClient.tsx"
git commit -m "Tell the user where the catalog lives when it is empty"
```

---

### Task 7: Record the boundary in the rulebook

**Files:**
- Modify: `ctyhp-accounting/CLAUDE.md` §3

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Append the rule**

In `ctyhp-accounting/CLAUDE.md`, in section 3, after the bullet added for `isSalesRevenueAccount`, add:

```markdown
- `sales` is a role that maintains the product catalog and nothing else. It holds `items.manage`; every other write is refused because `canWrite()`, `acc_is_staff()` and `acc_is_admin()` are allow-lists and `acc_has_permission()` is fail-closed. **Never rewrite a role check as a deny-list** (`role <> 'viewer'`) — that is the one edit that would silently hand the ledger to sales. Catalog writes are gated by `items.manage` in both RLS and `app/(app)/items/actions.ts`; adjusting inventory stays on `canWrite`, because it posts.
```

- [ ] **Step 2: Commit**

```bash
git add ctyhp-accounting/CLAUDE.md
git commit -m "Record what the sales role may and may not do"
```

---

### Task 8: Apply the migrations and verify against the database

**Files:** none modified.

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: verified live behaviour.

- [ ] **Step 1: Apply the migrations to every company schema**

Run: `cd ctyhp-accounting && node --env-file=.env.local scripts/migrate.mjs`
Expected: `0087_sales_role` and `0088_items_manage_permission` reported applied, once per company schema in the register, with no errors. If it stops after 0087, do not retry 0088 by hand — read the error, fix the migration, and re-run.

- [ ] **Step 2: Verify the grant matrix and the policy**

Create `ctyhp-accounting/tmp-verify-sales-role.mjs` (it must sit inside the project so it can resolve `@supabase/supabase-js`), run it, then delete it:

```js
// Read-only. Confirms 0088 landed identically in every company schema.
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reg = createClient(url, key, { auth: { persistSession: false }, db: { schema: "onebook" } });
const { data: companies, error } = await reg.from("company").select("slug,schema_name");
if (error) throw new Error(error.message);

let bad = 0;
for (const c of companies) {
  const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: c.schema_name } });
  const { data: grants, error: ge } = await sb
    .from("acc_role_permission")
    .select("role,permission_key,allowed");
  if (ge) { console.log(`${c.schema_name}: ${ge.message}`); bad++; continue; }

  const itemsManage = Object.fromEntries(
    grants.filter((g) => g.permission_key === "items.manage").map((g) => [g.role, g.allowed]),
  );
  const expected = { admin: true, accountant: true, sales: true, viewer: false };
  const grantsOk = JSON.stringify(itemsManage) === JSON.stringify(expected);

  // No blanks: every role must have a row for every permission key.
  const roles = [...new Set(grants.map((g) => g.role))];
  const keys = [...new Set(grants.map((g) => g.permission_key))];
  const have = new Set(grants.map((g) => `${g.role}|${g.permission_key}`));
  const missing = roles.flatMap((r) => keys.filter((k) => !have.has(`${r}|${k}`)).map((k) => `${r}/${k}`));

  const ok = grantsOk && missing.length === 0 && roles.length === 4;
  if (!ok) bad++;
  console.log(
    `[${c.schema_name}] ${ok ? "OK" : "FAIL"} items.manage=${JSON.stringify(itemsManage)} ` +
      `roles=${roles.length} blanks=${missing.length}${missing.length ? ` (${missing.slice(0, 5).join(", ")})` : ""}`,
  );
}
console.log(bad === 0 ? "\nAll schemas verified." : `\n${bad} schema(s) failed.`);
process.exit(bad === 0 ? 0 : 1);
```

Run: `cd ctyhp-accounting && node --env-file=.env.local ./tmp-verify-sales-role.mjs; rm -f ./tmp-verify-sales-role.mjs`
Expected: one `OK` line per company schema and `All schemas verified.`

The `acc_item_write` policy expression is not readable over PostgREST. Confirm it separately in the Supabase SQL editor:

```sql
select schemaname, policyname, qual
  from pg_policies
 where tablename = 'acc_item' and policyname = 'acc_item_write';
```

Expected: `qual` reads `acc_has_permission('items.manage'::text)` for every schema, and never `acc_is_staff()`.

- [ ] **Step 3: Run the four gates and paste real output**

Run, from `ctyhp-accounting`:

```
npm run typecheck
npm test
npm run lint
npm run build
```

Expected: typecheck exits 0; all test files pass; lint 0 errors; build compiles. Paste the actual output — CLAUDE.md §2 requires it, and "should pass" is not evidence.

- [ ] **Step 4: State the gate that cannot run here**

`scripts/smoke-pages.mjs` needs `ALLOW_DESTRUCTIVE_E2E=ONEBOOK_TEST_DATABASE_ONLY` and an isolated test project; the developer `.env.local` points at production and the script refuses by design. This change moves a navigation leaf and edits four screens, so the smoke sweep is genuinely wanted. Do **not** set the flag against production. Report the gate as not run, and run it wherever the test project is configured:

```
npm run build
npm start
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000 --only=items,invoices,bills,settings/users,settings/permissions
```

- [ ] **Step 5: Commit any fixes the gates forced**

```bash
git add -A ctyhp-accounting
git commit -m "Fix what the verification gates caught"
```

Skip this step if the gates were clean; an empty commit records nothing useful.

---

## Notes for the implementer

**Do not widen `canWrite`.** It is the reason this change did not require auditing 44 call sites. If a sales user needs some new ability, add a permission and check it at that call site.

**Do not add `sales` to `acc_is_staff()`.** Same reason, on the SQL side.

**The MFA column is deliberately a deny-list.** `r.role === "viewer" ? "not required" : "not enrolled"` in `UsersClient.tsx` is the single place where a new role gets the stricter default, and that is wanted.

**Migration order matters and cannot be collapsed.** 0087 and 0088 must stay two files. Merging them fails at apply time with `unsafe use of new value "sales" of enum type acc_app_role`.
