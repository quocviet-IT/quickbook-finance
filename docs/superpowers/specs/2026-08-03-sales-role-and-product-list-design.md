# Sales Role & the Product List on the Sales Tab

- **Date:** 2026-08-03
- **Status:** Approved for planning
- **Owner:** AI Team — CTYHP
- **Source:** System test user feedback, Finding 2 ("Unit Price does not auto-populate and
  no Product Lists feature exists")
- **Related:** `docs/superpowers/specs/2026-07-25-users-permissions-approval-design.md`,
  `docs/superpowers/specs/2026-07-22-products-services-design.md`,
  `docs/superpowers/specs/2026-07-25-navigation-ux-redesign-design.md`

## 1. What the feedback got right, and what it got wrong

Finding 2 makes three claims. Two rest on false premises; the third is a real gap. The
design addresses the real defect behind each.

**"Unit price must be entered manually even after selecting an item."** The prefill exists
and is unit-tested. `itemToInvoiceLineDefaults` (`lib/domain/items.ts`) maps an item to
description, unit price, income account and tax code, and the invoice line's Item select
calls it on change (`app/(app)/invoices/InvoicesClient.tsx`). It did not fire because the
company under test had **no items at all**:

```
[public]             11 items, 11 sellable
[co_harbor_gems]      0 items,  0 sellable
[co_cascade_metals]   0 items,  0 sellable
[co_north_star]       0 items,  0 sellable   <- the company in the screenshot
```

The real defect is that an empty catalog produces an empty dropdown and says nothing. A
user cannot distinguish "no data yet" from "feature does not exist" — and did not.

**"There is no centralized product list."** `/items` — Products & Services — is exactly
that, and is the source the prefill reads. The real defect is discoverability: it sits
under **Inventory & Assets**, so nobody working in Sales finds it.

**"The sales department has no way to manage line items."** True. Roles are
`admin | accountant | viewer`; writes to `acc_item` are gated by `acc_is_staff()`
(admin or accountant) in both RLS and the Server Action. Today a salesperson must be made
an accountant — which also grants journal posting, invoice issuing and payment entry.

## 2. Goal & Scope

Let sales staff maintain the product catalog without granting them the ledger, and make
the catalog reachable and self-explanatory from where invoices are raised.

### In scope
- A fourth application role, `sales`.
- A new `items.manage` permission, and `acc_item` writes driven by it.
- Products & Services moves into the Sales navigation group.
- Empty-catalog guidance on every item picker that exists: invoice and bill.
- Splitting the Items screen's single write flag, which currently conflates catalog
  editing with posting an inventory adjustment.

### Out of scope
- Per-user permissions. The registry grants by role, and that does not change here.
- Letting `sales` draft or issue invoices. Deliberately excluded; see §4.
- Changing what `viewer` may do.
- Enforcing MFA in code. It is reported, not enforced, today, and that is unchanged.

## 3. Why a new role rather than a new permission on `viewer`

The permission registry grants by role, not by person. Granting `items.manage` to `viewer`
would hand catalog write access to every present and future read-only account, including
an external auditor. A distinct role keeps the two populations separable.

The cost is normally the reason to avoid a new role: 44 `canWrite(...)` call sites across
64 files, 11 SQL files naming roles, and every RLS policy. Here it is not, because **every
existing gate is an allow-list**:

| Gate | Form | Effect on a new role |
|---|---|---|
| `canWrite(role)` | `role === "admin" \|\| role === "accountant"` | denies |
| `acc_is_staff()` | `acc_current_role() in ('admin','accountant')` | denies |
| `acc_is_admin()` | `acc_current_role() = 'admin'` | denies |
| `acc_has_permission(key)` | `coalesce((select allowed ...), false)` | denies |

A search for negative role tests (`acc_current_role() <> …`, `not in ('viewer')`) returns
nothing. So `sales` starts with no write access anywhere and we open exactly one door.
Read policies are `acc_current_role() is not null`, so `sales` reads what any signed-in
user reads — same as `viewer` today.

The one place a new role inherits the *stricter* default is the Users screen MFA column,
which treats only `viewer` as "not required". `sales` therefore shows as MFA-required with
no code change, which is the intended policy. Do not "tidy" that check into an allow-list.

## 4. What `sales` may and may not do

| Action | Allowed | Gate |
|---|---|---|
| Read every screen a viewer reads | yes | existing read policies |
| Create, edit, activate/deactivate a product or service | yes | `items.manage` |
| Post an inventory adjustment | no | `canWrite` — unchanged |
| Draft or issue an invoice, take a payment, post a journal | no | `canWrite` — unchanged |
| Anything under Settings | no | `acc_is_admin()` / governance permissions |

Inventory adjustment is excluded because it writes to the ledger: it moves inventory value
against an offset account. Catalog maintenance does not post anything.

## 5. Design

### 5.1 Migrations

Two files. The enum value must land in its own migration — Postgres will not let a value
added by `ALTER TYPE ... ADD VALUE` be used in the same transaction, and the project has
been bitten by this before (`CLAUDE.md` §4).

**Migration A** — `alter type acc_app_role add value if not exists 'sales';`

**Migration B**
1. Insert permission `items.manage` — label "Manage products and services", category
   `Sales`, `is_enforced = true`.
2. Backfill `acc_role_permission` for every (role × permission) pair that has no row,
   defaulting to `false`. Earlier migrations seeded rows by listing the three roles
   literally, so `sales` has none; `acc_has_permission` is fail-closed and would deny, but
   the permission matrix screen needs rows to render a togglable cell.
3. Set `items.manage = true` for `admin`, `accountant`, `sales`.
4. Replace the `acc_item_write` policy: `acc_is_staff()` becomes
   `acc_has_permission('items.manage')`, so the matrix screen is the single authority over
   who edits the catalog rather than a second rule hidden in RLS.

Both must reach every company schema — `scripts/migrate.mjs` loops the register. Neither
touches a global object, so `scopeOf()` does not hold them back.

### 5.2 TypeScript

- `AppRole` (`lib/db/types.ts`) and `APP_ROLES` (`lib/domain/schemas.ts`) gain `"sales"`.
- `ROLE_OPTIONS` in `UsersClient.tsx` gains `{ value: "sales", label: "Sales" }`.
- `PermissionMatrixClient.tsx`: `ROLES` gains `"sales"`, and the per-permission record
  initialiser gains a `sales: false` key. A missing key here renders an undefined cell.
- The privileged-access Alert text in `UsersClient.tsx` names sales alongside admins and
  accountants.
- `canWrite` is **not** changed. That is what keeps the other 44 call sites denying sales.
- `app/(app)/items/actions.ts`: the `guard()` helper checks
  `hasPermission(sb, "items.manage")` instead of `canWrite(role)`.
- `app/(app)/items/inventory-actions.ts` is left alone — `canWrite` is correct there.

### 5.3 The Items screen's two write flags

`ItemsClient` takes one `canWrite` prop and uses it for both the New/Edit item controls and
the Adjust inventory button. Under the new role that becomes wrong in a user-visible way:
a sales user would be shown an Adjust button the server then refuses. Split it.

- `page.tsx` passes `canManageItems={await hasPermission(sb, "items.manage")}` and
  `canAdjustInventory={canWrite(role)}`.
- `ItemsClient` uses the first for New item / Edit / activate-deactivate, and the second
  for the Adjust inventory action alone.

This is a pre-existing latent bug — today both flags always agree, so nothing shows it.

### 5.4 Navigation

Move the `/items` leaf out of `inventory-assets` and into `sales`, after Customers.
Inventory & Assets keeps Overview and Fixed Assets.

Move rather than list twice: `findActiveGroup` returns the first group containing the
route, so a duplicated leaf makes sidebar highlighting depend on declaration order — a
silent trap. `navLeaves` would also return the route twice, which feeds global search
result grouping.

Nothing else is coupled to the route's group: `GUIDE_FLOWS` and the assistant's
screen-context do not reference `/items`. `tests/unit/navigation.test.ts` asserts the old
placement and is updated with the move.

### 5.5 Empty-catalog guidance

Every item picker gets the same treatment when its list is empty: `notFoundContent` on the
Select, plus a hint line naming where the catalog lives. The hint is a link to `/items` for
a reader holding `items.manage`, and the same sentence as plain text for anyone else —
pointing a viewer at a screen they cannot act on is worse than telling them who can. Each
page already resolves permissions server-side, so it passes the flag down as a prop.

| Screen | Picker | Hint |
|---|---|---|
| Invoice line | sellable items | "No products or services yet — add one in Products & Services" |
| Bill line | purchased items | "No purchasable products yet — add one in Products & Services" |

The wording differs on Bills because that picker is filtered to `is_purchased`, so a
catalog full of sales-only items is still empty there and "no products yet" would be a lie.

**Recurring templates are excluded, because they have no item picker to annotate.** A
recurring invoice template line starts at Description and hardcodes `item_id: null`; the
catalog is never consulted. Giving those lines an item picker is a separate feature with
its own question to answer — whether a generated invoice should re-read the catalog price
at generation time or keep the price the template was written with — and it is not part of
this change.

## 6. Testing

Unit:
- Navigation: `/items` resolves to the `sales` group; `inventory-assets` no longer lists it.
- Roles: `APP_ROLES` contains `sales`; `canWrite("sales")` is `false` — the regression that
  would matter most if someone later "simplified" `canWrite`.
- The permission-matrix record initialiser covers every role in `APP_ROLES`, so adding a
  role again cannot leave an undefined cell.

Migration and integration:
- `scripts/migrate.mjs` applies both migrations across every company schema.
- Verify against the database that `acc_item_write` is driven by `items.manage`, and that
  a `sales` principal can write `acc_item` and cannot write `acc_journal_entry`.

The HTTPS end-to-end suites and `scripts/smoke-pages.mjs` require
`ALLOW_DESTRUCTIVE_E2E=ONEBOOK_TEST_DATABASE_ONLY` and an isolated test project. The
current `.env.local` points at production, so those gates must be run wherever the test
project is configured before this ships. The plan states this rather than silently
skipping it.

## 7. Risks

**Changing `acc_item_write` to a permission check.** If the backfill misses a role, that
role loses catalog access. Mitigated by backfilling every (role × permission) pair rather
than only the new ones, and by verifying the resulting matrix after migration.

**The enum split across two migrations.** Applying only Migration A leaves an unusable
role. `scripts/migrate.mjs` applies in order and stops on failure, so a partial apply
leaves the system on the old behaviour rather than a broken one.

**Sales staff seeing financial reports.** `sales` reads whatever a signed-in user reads,
which includes the Report Center. That matches `viewer` today and is not a regression, but
it is a deliberate acceptance rather than an oversight: if the company wants sales walled
off from the P&L, that is a separate change to the read policies affecting `viewer` too.
