# Settings Hub Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A settings card appears only for someone who may use the screen behind it, that screen refuses everyone else at the door, and the feedback queue is closed at the data layer so neither of those has to hold the line alone.

**Architecture:** One catalog entry in `lib/domain/navigation.ts` carries the gate; the hub filters with it and a new server guard reads the same entry, so a card and its door cannot disagree. Underneath, one migration revokes `feedback.read` from every role but `admin` — no RLS policy is edited, because all four read paths already say "the permission **or** your own report".

**Tech Stack:** Next.js App Router (see `AGENTS.md` — read `node_modules/next/dist/docs/` before writing route code), React Server Components, Ant Design 5, Supabase Postgres with RLS, Vitest, `pg` for verification harnesses.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-settings-hub-access-design.md`. Read it before Task 1.
- All user-facing copy is US English. The product is called **One Book**.
- A Server Component must never read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, `Alert.ErrorBoundary`, …). Put such markup in a `"use client"` component. Guarded by `tests/unit/rsc-antd.test.ts`.
- Never invent a permission key. Every key used in this plan exists in `acc_permission` today: `settings.manage`, `users.manage`, `permissions.manage`, `audit.read`, `period.close`, `feedback.read`, `feedback.triage`.
- The migration must not carry a file-level `set search_path`, and must not write `public.` before a per-company table. `scripts/migrate.mjs` loops the company register and `scopeOf()`/`retargetToSchema()` handle the rest. Getting this wrong applies the change to one company only.
- Verification gates before any "done" claim, from `ctyhp-accounting/`: `npm run build`, `npm test`, `npm run typecheck`, `npm run lint` — zero errors, real output pasted.
- Do not run `scripts/smoke-pages.mjs` at the same time as any HTTPS end-to-end suite; they sign in as the same account and invalidate each other's session.
- Commit messages: no Claude attribution, no "Generated with" trailer.

---

### Task 1: Put a gate on every settings card

**Files:**
- Modify: `ctyhp-accounting/lib/domain/navigation.ts:125-139` (export `canShowNavItem`), `:178-182` (`SettingsHubItem`), `:190-259` (`SETTINGS_HUB`), and append `settingsHubForAccess`
- Test: `ctyhp-accounting/tests/unit/navigation.test.ts` (append a `settingsHubForAccess` describe block)

**Interfaces:**
- Consumes: `NavigationAccess { role: AppRole | null; permissionKeys: readonly string[] | null }` and `canShowNavItem`, both already in this file.
- Produces:
  - `SettingsHubItem` gains `roles?: AppRole[]`, `anyPermissions?: string[]`, `fallback?: { title: string; description: string }`
  - `export function canShowNavItem(item, access): boolean` — now exported
  - `export function settingsHubForAccess(access: NavigationAccess, groups?: SettingsHubGroup[]): SettingsHubGroup[]`

- [ ] **Step 1: Write the failing tests**

Append to `ctyhp-accounting/tests/unit/navigation.test.ts`. Add `settingsHubForAccess` to the existing import block from `@/lib/domain/navigation`.

```ts
describe("settingsHubForAccess", () => {
  const titles = (access: Parameters<typeof settingsHubForAccess>[0]) =>
    settingsHubForAccess(access).flatMap((g) => g.items.map((i) => i.title));

  const ADMIN = {
    role: "admin" as const,
    permissionKeys: [
      "settings.manage",
      "users.manage",
      "permissions.manage",
      "audit.read",
      "period.close",
      "feedback.read",
    ],
  };

  it("shows an administrator every card", () => {
    const shown = settingsHubForAccess(ADMIN).flatMap((g) => g.items);
    expect(shown).toHaveLength(SETTINGS_HUB.flatMap((g) => g.items).length);
  });

  it("shows a viewer only the audit history and their own reports", () => {
    expect(titles({ role: "viewer", permissionKeys: ["audit.read"] }).sort()).toEqual([
      "Audit history",
      "My reports",
    ]);
  });

  it("shows a sales user only their own reports", () => {
    expect(titles({ role: "sales", permissionKeys: ["items.manage"] })).toEqual(["My reports"]);
  });

  it("shows an accountant the periods, the audit history and their own reports", () => {
    expect(
      titles({ role: "accountant", permissionKeys: ["period.close", "audit.read"] }).sort(),
    ).toEqual(["Accounting periods", "Audit history", "My reports"]);
  });

  it("swaps the title and description rather than dropping a card with a fallback", () => {
    const card = settingsHubForAccess({ role: "viewer", permissionKeys: [] })
      .flatMap((g) => g.items)
      .find((i) => i.href === "/settings/feedback");
    expect(card?.title).toBe("My reports");
    expect(card?.description).toContain("you filed");
  });

  it("keeps the triage wording for someone who may read the queue", () => {
    const card = settingsHubForAccess(ADMIN)
      .flatMap((g) => g.items)
      .find((i) => i.href === "/settings/feedback");
    expect(card?.title).toBe("Feedback triage");
  });

  it("drops a gated card that has no fallback", () => {
    const hrefs = settingsHubForAccess({ role: "viewer", permissionKeys: [] }).flatMap((g) =>
      g.items.map((i) => i.href),
    );
    expect(hrefs).not.toContain("/settings/users");
    expect(hrefs).not.toContain("/settings/companies");
  });

  it("drops a group once every card in it is hidden", () => {
    const ids = settingsHubForAccess({ role: "sales", permissionKeys: [] }).map((g) => g.id);
    expect(ids).not.toContain("purchasing");
    expect(ids).not.toContain("company");
  });

  it("hides nothing gated by permission when the lookup failed, but still honours role", () => {
    const shown = settingsHubForAccess({ role: "viewer", permissionKeys: null }).flatMap(
      (g) => g.items,
    );
    // Permission gates pass, so a permission-gated card such as Users or
    // Accounting periods shows. The admin-only Companies card is gated by
    // `roles` and is still gone — that is the half that must not fail open.
    expect(shown.some((i) => i.href === "/settings/companies")).toBe(false);
    expect(shown.some((i) => i.href === "/settings/users")).toBe(true);
    expect(shown.some((i) => i.href === "/settings/periods")).toBe(true);
  });

  it("gates every card on a permission key that exists, or on a role", () => {
    const KNOWN = new Set([
      "settings.manage",
      "users.manage",
      "permissions.manage",
      "audit.read",
      "period.close",
      "feedback.read",
    ]);
    for (const group of SETTINGS_HUB) {
      for (const item of group.items) {
        expect(
          Boolean(item.roles?.length) || Boolean(item.anyPermissions?.length),
          `${item.href} has no gate`,
        ).toBe(true);
        for (const key of item.anyPermissions ?? []) {
          expect(KNOWN.has(key), `${item.href} names unknown permission ${key}`).toBe(true);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd ctyhp-accounting
npx vitest run tests/unit/navigation.test.ts -t settingsHubForAccess
```

Expected: FAIL — `settingsHubForAccess is not a function` (an import error, so the whole file may fail to collect; that is the expected shape of this failure).

- [ ] **Step 3: Export `canShowNavItem`**

In `lib/domain/navigation.ts`, change line 125 from `function canShowNavItem(` to:

```ts
/**
 * One definition of "does this person pass a gate", shared by the sidebar, the
 * settings hub and the server guard behind each settings page. Three copies
 * would be three chances to disagree about who may see a screen.
 */
export function canShowNavItem(
```

- [ ] **Step 4: Widen `SettingsHubItem`**

Replace the interface at `lib/domain/navigation.ts:178-182`:

```ts
export interface SettingsHubItem {
  href: string;
  title: string;
  description: string;
  /** Optional gate. The server guard reads this same entry. */
  roles?: AppRole[];
  anyPermissions?: string[];
  /**
   * Shown instead when the viewer fails the gate but the route still holds
   * something for them. Absent means the card simply disappears.
   */
  fallback?: { title: string; description: string };
}
```

- [ ] **Step 5: Add the gates to the catalog**

In `SETTINGS_HUB`, add these properties to the existing items. Do not change any `href`, and change `title`/`description` only where shown.

```ts
// group "company"
{ href: "/settings/company",  …, anyPermissions: ["settings.manage"] },
{ href: "/settings/companies", …, roles: ["admin"] },
{ href: "/settings/periods",  …, anyPermissions: ["period.close"] },
{ href: "/settings/import",   …, anyPermissions: ["settings.manage"] },

// group "control"
{ href: "/settings/users",       …, anyPermissions: ["users.manage"] },
{ href: "/settings/permissions", …, anyPermissions: ["permissions.manage"] },
{ href: "/settings/approvals",   …, anyPermissions: ["settings.manage"] },
{ href: "/settings/audit",       …, anyPermissions: ["audit.read"] },
{
  href: "/settings/feedback",
  title: "Feedback triage",
  description: "Bug reports and suggestions filed by staff, with screenshots.",
  anyPermissions: ["feedback.read"],
  fallback: {
    title: "My reports",
    description: "The bug reports and suggestions you filed, and where each one stands.",
  },
},

// group "purchasing"
{ href: "/settings/purchasing", …, anyPermissions: ["settings.manage"] },
```

- [ ] **Step 6: Add `settingsHubForAccess`**

Append below `SETTINGS_HUB` in `lib/domain/navigation.ts`:

```ts
/**
 * The hub as one person sees it. A card that fails its gate is dropped unless
 * it carries a `fallback`, in which case it stays under the wording that is
 * true for them. A group with nothing left does not render as an empty heading.
 */
export function settingsHubForAccess(
  access: NavigationAccess,
  groups: SettingsHubGroup[] = SETTINGS_HUB,
): SettingsHubGroup[] {
  return groups.flatMap((group) => {
    const items = group.items.flatMap((item) => {
      if (canShowNavItem(item, access)) return [item];
      if (!item.fallback) return [];
      return [{ ...item, title: item.fallback.title, description: item.fallback.description }];
    });
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```
npx vitest run tests/unit/navigation.test.ts
```

Expected: PASS, including the pre-existing `SETTINGS_HUB` and `navigationForAccess` blocks.

- [ ] **Step 8: Run the four gates**

```
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all zero errors.

- [ ] **Step 9: Commit**

```bash
git add ctyhp-accounting/lib/domain/navigation.ts ctyhp-accounting/tests/unit/navigation.test.ts
git commit -m "Give every settings card the gate the sidebar already had"
```

---

### Task 2: End the feedback test period in the database

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0099_feedback_read_admin_only.sql`
- Create: `ctyhp-accounting/scripts/verify-feedback-access.mjs`
- Modify: `ctyhp-accounting/package.json` (add the `verify:feedback-access` script)

**Interfaces:**
- Consumes: nothing from Task 1. This task is independent and may be done first.
- Produces: `feedback.read` allowed only for `admin`, in every company schema. Later tasks assume a non-administrator's `acc_feedback_queue` returns zero rows.

- [ ] **Step 1: Write the verification harness**

Create `ctyhp-accounting/scripts/verify-feedback-access.mjs`. Every scenario runs inside a rolled-back transaction, so this is safe against the live books.

Note the two lines that make it a real test: `set_config('request.jwt.claims', …)` supplies `auth.uid()`, and `set local role authenticated` stops the superuser connection from bypassing RLS. Without the second, every policy check silently passes.

```js
/**
 * Behavioural verification of who may read the feedback queue.
 *
 * Every scenario runs inside its own transaction and is ROLLED BACK, so this
 * runs against a database holding real books. The connection is a superuser,
 * which bypasses row-level security -- `set local role authenticated` is what
 * makes the policies actually apply. Without it this file would pass while
 * proving nothing.
 *
 * Run: node --env-file=.env.local scripts/verify-feedback-access.mjs
 */
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const pick = async (role) =>
  (
    await client.query(
      `select id from acc_app_user where role = $1 and status = 'active' order by created_at limit 1`,
      [role],
    )
  ).rows[0]?.id ?? null;

const ADMIN = await pick("admin");
if (!ADMIN) {
  console.error("No active admin to authenticate as.");
  process.exit(1);
}

/** Body runs authenticated as `userId`, with RLS in force, then rolls back. */
async function scenario(name, userId, body) {
  console.log(`\n== ${name}`);
  await client.query("begin");
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    await body();
  } catch (error) {
    failed++;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback");
  }
}

const count = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].n);

// A report filed by the administrator, so a non-admin reading it would be a leak.
const seeded = (
  await client.query(
    `insert into acc_feedback_report (kind, description, page_route, reporter_id, impact, frequency)
     values ('broken', 'verify-feedback-access probe', '/dashboard', $1, 'blocking', 'daily')
     returning id`,
    [ADMIN],
  )
).rows[0].id;

await scenario("an administrator still sees the whole queue", ADMIN, async () => {
  check(
    "reads the seeded report",
    (await count(`select count(*)::int n from acc_feedback_report where id = $1`, [seeded])) === 1,
  );
  check(
    "acc_feedback_queue returns rows",
    (await count(`select count(*)::int n from acc_feedback_queue(null)`)) > 0,
  );
});

for (const role of ["accountant", "viewer", "sales"]) {
  const userId = await pick(role);
  if (!userId) {
    console.log(`\n== skipped ${role}: no active account`);
    continue;
  }
  await scenario(`a ${role} sees only their own`, userId, async () => {
    check(
      "cannot read someone else's report",
      (await count(`select count(*)::int n from acc_feedback_report where id = $1`, [seeded])) === 0,
    );
    check(
      "acc_feedback_queue returns nothing",
      (await count(`select count(*)::int n from acc_feedback_queue(null)`)) === 0,
    );
    check(
      "cannot read someone else's attachments",
      (await count(
        `select count(*)::int n from acc_feedback_attachment where report_id = $1`,
        [seeded],
      )) === 0,
    );

    // The clause that makes "My reports" work must still hold.
    const mine = (
      await client.query(
        `insert into acc_feedback_report (kind, description, page_route, reporter_id, impact, frequency)
         values ('suggestion', 'my own probe', '/dashboard', $1, 'nice_to_have', 'rarely')
         returning id`,
        [userId],
      )
    ).rows[0].id;
    check(
      "still reads their own report",
      (await count(`select count(*)::int n from acc_feedback_report where id = $1`, [mine])) === 1,
    );
  });
}

await client.query(`delete from acc_feedback_report where id = $1`, [seeded]);
await client.end();

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
```

- [ ] **Step 2: Register the script**

In `ctyhp-accounting/package.json`, add to `"scripts"`, after `"verify:bank-categories"`:

```json
"verify:feedback-access": "node --env-file=.env.local scripts/verify-feedback-access.mjs",
```

- [ ] **Step 3: Run it to verify it fails**

```
cd ctyhp-accounting
npm run verify:feedback-access
```

Expected: FAIL. An accountant and a viewer currently hold `feedback.read`, so "cannot read someone else's report" and "acc_feedback_queue returns nothing" both fail. That failure is the bug this task fixes — read the output and confirm it is those lines failing and not a connection error.

- [ ] **Step 4: Write the migration**

Create `ctyhp-accounting/supabase/migrations/0099_feedback_read_admin_only.sql`:

```sql
-- ============================================================================
-- 0099  The feedback test period ends
--
-- 0061 granted feedback.read to every role and said why:
--   "test period: everyone reads" -- so testers could see each other's reports.
--
-- That period is over, and the grant is now an exposure: an accountant or a
-- viewer could read every bug report anyone had filed, the screenshots attached
-- to it, and -- through acc_feedback_queue -- the reporter's email address.
--
-- No policy changes. Every read path already reads "holds feedback.read OR the
-- report is your own": acc_feedback_report, acc_feedback_attachment, and the
-- storage policies over both feedback buckets. Revoking the permission collapses
-- all four to "your own" in one statement, which is the evidence that 0061 built
-- them right and only the grant was provisional.
--
-- acc_feedback_queue is the one that behaves differently, on purpose: it is
-- security definer and filters on the permission alone, so it now returns no
-- rows to a non-administrator rather than their own. The screen stops calling
-- it for them; the function is left as it is.
--
-- Per-company: acc_role_permission lives in each company's schema, so this runs
-- once per set of books through scripts/migrate.mjs. Deliberately no
-- `set search_path` and no `public.` prefix.
-- ============================================================================

update acc_role_permission
   set allowed = false
 where permission_key = 'feedback.read'
   and role <> 'admin';

-- feedback.triage was already admin-only in 0061 and is left alone.
```

- [ ] **Step 5: Apply the migration to every company**

```
cd ctyhp-accounting
node --env-file=.env.local scripts/migrate.mjs
```

Expected: it reports applying `0099_feedback_read_admin_only.sql` and loops the register, so `public` plus every `co_*` schema is named in the output.

- [ ] **Step 6: Run the harness to verify it passes**

```
npm run verify:feedback-access
```

Expected: `0 failed`. Every role that has an active account is exercised; roles with no account print a `skipped` line rather than a false pass.

- [ ] **Step 7: Confirm the grant in every schema**

```
node --env-file=.env.local -e "
const pg=require('pg');
(async()=>{const c=new pg.Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const s=await c.query(\"select nspname from pg_namespace where nspname='public' or nspname like 'co\\\\_%' order by 1\");
for (const {nspname} of s.rows) {
  const r=await c.query('select role, allowed from '+nspname+\".acc_role_permission where permission_key='feedback.read' order by role\");
  console.log(nspname+': '+r.rows.map(x=>x.role+'='+x.allowed).join(', '));
}
await c.end();})();
"
```

Expected: every schema prints `admin=true` and `false` for `accountant`, `viewer` and `sales`.

- [ ] **Step 8: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0099_feedback_read_admin_only.sql \
        ctyhp-accounting/scripts/verify-feedback-access.mjs \
        ctyhp-accounting/package.json
git commit -m "Close the feedback queue to everyone but an administrator"
```

---

### Task 3: One resolver for access, and a guard that fails closed

**Files:**
- Create: `ctyhp-accounting/lib/db/settings-access.ts`
- Modify: `ctyhp-accounting/app/(app)/layout.tsx:22-35` (use the resolver instead of building access inline)
- Test: `ctyhp-accounting/tests/unit/settings-access.test.ts` (new)

**Interfaces:**
- Consumes: `canShowNavItem`, `SETTINGS_HUB`, `NavigationAccess` from Task 1.
- Produces:
  - `export const currentAccess: () => Promise<NavigationAccess>` — React `cache()`d, one query per request
  - `export async function requireSettingsAccess(href: string): Promise<void>`
  - `export function settingsGateFor(href: string): SettingsHubItem` — pure lookup, throws on an unknown href; exported so it can be unit-tested without a database

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/settings-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { settingsGateFor } from "@/lib/db/settings-access";

describe("settingsGateFor", () => {
  it("finds the catalog entry behind a settings route", () => {
    expect(settingsGateFor("/settings/users").anyPermissions).toEqual(["users.manage"]);
  });

  it("throws for a route with no catalog entry, rather than opening it", () => {
    expect(() => settingsGateFor("/settings/nowhere")).toThrow(/no settings catalog entry/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd ctyhp-accounting
npx vitest run tests/unit/settings-access.test.ts
```

Expected: FAIL — cannot resolve `@/lib/db/settings-access`.

- [ ] **Step 3: Write the module**

Create `ctyhp-accounting/lib/db/settings-access.ts`:

```ts
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  canShowNavItem,
  SETTINGS_HUB,
  type NavigationAccess,
  type SettingsHubItem,
} from "@/lib/domain/navigation";
import type { AppRole } from "@/lib/db/types";

/**
 * What the signed-in person may do, resolved once per request.
 *
 * The shell and the page it renders both need this, and two copies of "what may
 * this person do" would be the drift the catalog gate exists to prevent.
 * React's cache() collapses them into one pair of queries per request.
 */
export const currentAccess = cache(async (): Promise<NavigationAccess> => {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { role: null, permissionKeys: [] };

  const [profile, allowed] = await Promise.all([
    sb.from("acc_app_user").select("role").eq("id", user.id).maybeSingle(),
    sb.from("acc_role_permission").select("role,permission_key").eq("allowed", true),
  ]);
  const role = (profile.data?.role as AppRole | undefined) ?? null;
  // null means the lookup itself failed; navigation treats that as "show it",
  // and requireSettingsAccess below deliberately treats it as "deny".
  const permissionKeys = allowed.error
    ? null
    : (allowed.data ?? []).filter((row) => row.role === role).map((row) => row.permission_key);
  return { role, permissionKeys };
});

/** The catalog entry behind a settings route. Throws rather than guess. */
export function settingsGateFor(href: string): SettingsHubItem {
  const item = SETTINGS_HUB.flatMap((group) => group.items).find((i) => i.href === href);
  if (!item) {
    throw new Error(
      `No settings catalog entry for ${href}. Add it to SETTINGS_HUB so its card and its guard agree.`,
    );
  }
  return item;
}

/**
 * Refuse anyone who may not use this screen.
 *
 * Fails closed, unlike the hub: no role, or a permission lookup that failed,
 * both redirect. A guard that opens when it is confused is not a guard.
 */
export async function requireSettingsAccess(href: string): Promise<void> {
  const item = settingsGateFor(href);
  const access = await currentAccess();
  const strict: NavigationAccess = {
    role: access.role,
    permissionKeys: access.permissionKeys ?? [],
  };
  if (!access.role || !canShowNavItem(item, strict)) {
    redirect(`/settings?denied=${encodeURIComponent(href)}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run tests/unit/settings-access.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Point the layout at the resolver**

In `app/(app)/layout.tsx`, replace lines 22-35 with:

```ts
  const [pendingApprovals, access] = await Promise.all([
    countPendingApprovals(sb).catch(() => 0),
    currentAccess(),
  ]);
  const { role, permissionKeys } = access;
```

Add `import { currentAccess } from "@/lib/db/settings-access";` to the imports, and remove the now-unused `AppRole` type import if `tsc` reports it as unused. The `profile` query moves into `currentAccess`, so delete it here.

- [ ] **Step 6: Run the four gates**

```
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all zero errors. `typecheck` is the one that catches a leftover reference to the deleted `profile` binding.

- [ ] **Step 7: Commit**

```bash
git add ctyhp-accounting/lib/db/settings-access.ts \
        ctyhp-accounting/tests/unit/settings-access.test.ts \
        "ctyhp-accounting/app/(app)/layout.tsx"
git commit -m "Resolve what a person may do in one place, and guard on it"
```

---

### Task 4: The hub shows what the person may open

**Files:**
- Modify: `ctyhp-accounting/app/(app)/settings/page.tsx`
- Modify: `ctyhp-accounting/app/(app)/settings/SettingsHubClient.tsx`

**Interfaces:**
- Consumes: `settingsHubForAccess`, `SettingsHubGroup` (Task 1); `currentAccess`, `settingsGateFor` (Task 3).
- Produces: `SettingsHubClient` now takes `{ groups: SettingsHubGroup[]; deniedTitle: string | null }`.

- [ ] **Step 1: Make the hub client take its groups**

Replace `app/(app)/settings/SettingsHubClient.tsx` in full:

```tsx
"use client";
import Link from "next/link";
import { Alert, Card, Col, Row, Typography } from "antd";
import type { SettingsHubGroup } from "@/lib/domain/navigation";

/**
 * Client Component for the same reason PageHeader is one: Ant Design ships
 * "use client", so a Server Component that reaches for a compound sub-component
 * such as Typography.Title reads a static property off a client-reference proxy
 * and the render fails.
 *
 * The groups arrive already filtered. Deciding here what to show would be a
 * second copy of the rule, in the one place a reader cannot be trusted.
 */
export default function SettingsHubClient({
  groups,
  deniedTitle,
}: {
  groups: SettingsHubGroup[];
  deniedTitle: string | null;
}) {
  return (
    <>
      {deniedTitle ? (
        <Alert
          type="info"
          showIcon
          className="settings-hub__denied"
          message={`${deniedTitle} is not available to your role`}
          description="Ask an administrator if you need access to it."
        />
      ) : null}
      {groups.map((group) => (
        <section key={group.id} className="settings-hub__group">
          <Typography.Title level={4} className="settings-hub__group-title">
            {group.label}
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {group.items.map((item) => (
              <Col xs={24} sm={12} lg={8} key={item.href}>
                <Link href={item.href} className="settings-hub__card-link">
                  <Card hoverable size="small" className="settings-hub__card">
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Typography.Paragraph type="secondary" className="settings-hub__card-description">
                      {item.description}
                    </Typography.Paragraph>
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>
        </section>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Filter in the page**

Replace `app/(app)/settings/page.tsx` in full:

```tsx
import PageHeader from "@/components/PageHeader";
import SettingsHubClient from "./SettingsHubClient";
import { settingsHubForAccess } from "@/lib/domain/navigation";
import { currentAccess, settingsGateFor } from "@/lib/db/settings-access";

export const dynamic = "force-dynamic";

/**
 * One entry in the sidebar instead of a leaf per screen. The catalog lives in
 * lib/domain/navigation.ts and a unit test asserts every /settings/* route the
 * app serves appears there, so a new settings page cannot go unreachable.
 *
 * `denied` is set by requireSettingsAccess when it turns someone away. Sending
 * them back with no explanation invites them to conclude the app is broken.
 */
export default async function SettingsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const [{ denied }, access] = await Promise.all([searchParams, currentAccess()]);
  const groups = settingsHubForAccess(access);

  let deniedTitle: string | null = null;
  if (denied) {
    try {
      deniedTitle = settingsGateFor(denied).title;
    } catch {
      // A denied value that names no screen is a stale or hand-edited link;
      // show the hub without a banner rather than an error page.
      deniedTitle = null;
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Company profile, the accounting calendar, who has access, and the controls around it."
      />
      <SettingsHubClient groups={groups} deniedTitle={deniedTitle} />
    </div>
  );
}
```

- [ ] **Step 3: Style the banner**

Append to `ctyhp-accounting/app/globals.css`, next to the other `settings-hub__` rules:

```css
.settings-hub__denied {
  margin-bottom: 16px;
}
```

- [ ] **Step 4: Run the four gates**

```
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all zero errors, including `tests/unit/rsc-antd.test.ts` — `page.tsx` reads no antd sub-component, and `Typography.Title` stays inside the client file.

- [ ] **Step 5: Check the screen renders**

```
npm start
```

In a second terminal:

```
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000 --only=settings
```

Expected: `/settings` returns 200. Stop `npm start` afterwards.

- [ ] **Step 6: Commit**

```bash
git add "ctyhp-accounting/app/(app)/settings/page.tsx" \
        "ctyhp-accounting/app/(app)/settings/SettingsHubClient.tsx" \
        ctyhp-accounting/app/globals.css
git commit -m "Show a settings card only to someone who may open it"
```

---

### Task 5: Every settings page refuses the wrong person at the door

**Files:**
- Modify (one line each): `app/(app)/settings/company/page.tsx`, `companies/page.tsx`, `periods/page.tsx`, `import/page.tsx`, `users/page.tsx`, `permissions/page.tsx`, `approvals/page.tsx`, `audit/page.tsx`, `purchasing/page.tsx` — all under `ctyhp-accounting/`
- Test: `ctyhp-accounting/tests/unit/navigation.test.ts` (append a guard-coverage block)

**Interfaces:**
- Consumes: `requireSettingsAccess` from Task 3.
- Produces: nothing new. `/settings` and `/settings/feedback` remain unguarded, on purpose.

- [ ] **Step 1: Write the failing contract test**

Append to `ctyhp-accounting/tests/unit/navigation.test.ts`. It needs `readFileSync` — add it to the existing `node:fs` import at the top of the file.

```ts
describe("settings pages guard themselves", () => {
  /** Open to everyone, each for a stated reason. A third entry needs one too. */
  const UNGUARDED = new Set([
    "/settings", // the hub itself; it filters instead of refusing
    "/settings/feedback", // a reporter goes here to see their own reports
  ]);

  it("calls requireSettingsAccess with its own href on every gated page", () => {
    const missing: string[] = [];
    for (const route of ROUTES.filter((r) => r.startsWith("/settings"))) {
      if (UNGUARDED.has(route)) continue;
      const file = join(process.cwd(), "app", "(app)", route, "page.tsx");
      const source = readFileSync(file, "utf8");
      if (!source.includes(`requireSettingsAccess("${route}")`)) missing.push(route);
    }
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd ctyhp-accounting
npx vitest run tests/unit/navigation.test.ts -t "guard themselves"
```

Expected: FAIL listing all nine routes.

- [ ] **Step 3: Add the guard to each page**

In each of the nine `page.tsx` files, add the import and make the call the first statement of the exported component. Full example for `app/(app)/settings/users/page.tsx`:

```tsx
import { requireSettingsAccess } from "@/lib/db/settings-access";

export default async function UsersPage() {
  await requireSettingsAccess("/settings/users");
  // …the existing body, unchanged…
}
```

Repeat with the matching href for: `/settings/company`, `/settings/companies`, `/settings/periods`, `/settings/import`, `/settings/permissions`, `/settings/approvals`, `/settings/audit`, `/settings/purchasing`.

If a page's component takes `searchParams`, keep the parameter and put the guard above the first `await` of it — the guard must run before any data is read.

- [ ] **Step 4: Run the test to verify it passes**

```
npx vitest run tests/unit/navigation.test.ts
```

Expected: PASS, including the new block.

- [ ] **Step 5: Run the four gates**

```
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all zero errors.

- [ ] **Step 6: Prove the doors on a running build**

```
npm start
```

Second terminal:

```
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```

Expected: 48 pages, no failures. The smoke account is an administrator, so every settings page must still return 200 — a redirect here means a gate names a permission the administrator does not hold.

- [ ] **Step 7: Prove the guard actually turns someone away**

The sweep above only proves the door opens for an administrator. The spec also requires that it closes. With `npm start` still running, sign in as a non-administrator in a browser and request `http://localhost:3000/settings/users`.

Expected: redirected to `/settings?denied=%2Fsettings%2Fusers`, with the banner reading *"Users is not available to your role"*, and no Users card in the hub.

If there is no non-administrator account to sign in as, create one at `/settings/users` as the administrator (role `viewer`), run the check, then suspend it. If that is not possible in this environment, **say so in the completion report** — an unproven guard is not a passing guard, and claiming otherwise is the failure mode this step exists to prevent.

- [ ] **Step 8: Commit**

```bash
git add "ctyhp-accounting/app/(app)/settings" ctyhp-accounting/tests/unit/navigation.test.ts
git commit -m "Refuse a settings screen at the door, not just in the catalog"
```

---

### Task 6: The feedback screen gets a second, narrower face

**Files:**
- Create: `ctyhp-accounting/app/(app)/settings/feedback/MyReportsClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/settings/feedback/page.tsx`
- Test: `ctyhp-accounting/tests/unit/feedback-my-reports.test.ts` (new)

**Interfaces:**
- Consumes: `FeedbackReportView`, `FeedbackAttachmentView` from `@/lib/services/feedback`; `feedbackKindLabel`, `feedbackStatusLabel`, `sortNewestFirst`, `summarizePageContext` from `@/lib/domain/feedback`.
- Produces: `MyReportsClient({ reports, attachments })`. `FeedbackTriageClient` is untouched.

A separate component rather than a mode flag inside `FeedbackTriageClient`: that file is already 332 lines against a 400-line ceiling, and the two screens share no controls.

- [ ] **Step 1: Write the failing test**

Create `ctyhp-accounting/tests/unit/feedback-my-reports.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "app", "(app)", "settings", "feedback");
const page = readFileSync(join(dir, "page.tsx"), "utf8");
const mine = readFileSync(join(dir, "MyReportsClient.tsx"), "utf8");

describe("the feedback screen serves two audiences", () => {
  it("asks whether this person may read the queue", () => {
    expect(page).toContain('"feedback.read"');
  });

  it("does not call the queue RPC for someone who cannot read it", () => {
    // acc_feedback_queue filters on the permission alone and returns zero rows
    // to a non-administrator, so calling it for them would show an empty screen
    // where their own reports belong.
    expect(page).toMatch(/if\s*\(!canRead\)/);
    // and the queue call sits after that early return, not in the Promise.all
    expect(page.indexOf("listFeedbackImprovements(sb)")).toBeGreaterThan(
      page.indexOf("if (!canRead)"),
    );
  });

  it("renders the reporter's own view without triage controls", () => {
    expect(mine).not.toContain("setFeedbackStatusAction");
    expect(mine).not.toContain("nextStatuses");
  });

  it("keeps both screens under the file-size ceiling", () => {
    for (const [name, source] of [
      ["MyReportsClient.tsx", mine],
      ["FeedbackTriageClient.tsx", readFileSync(join(dir, "FeedbackTriageClient.tsx"), "utf8")],
    ] as const) {
      expect(source.split("\n").length, name).toBeLessThan(400);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd ctyhp-accounting
npx vitest run tests/unit/feedback-my-reports.test.ts
```

Expected: FAIL — `MyReportsClient.tsx` does not exist (`ENOENT`).

- [ ] **Step 3: Write the reporter's view**

Create `ctyhp-accounting/app/(app)/settings/feedback/MyReportsClient.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { Empty, Space, Tag, Typography, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import {
  feedbackKindLabel,
  feedbackStatusLabel,
  sortNewestFirst,
  summarizePageContext,
} from "@/lib/domain/feedback";
import type { FeedbackAttachmentView, FeedbackReportView } from "@/lib/services/feedback";

const KIND_COLOR: Record<string, string> = { broken: "red", suggestion: "blue" };
const STATUS_COLOR: Record<string, string> = {
  new: "blue",
  reviewing: "gold",
  resolved: "green",
  declined: "default",
};

/**
 * What the person who filed a report sees.
 *
 * The rows arrive already narrowed: RLS returns only reports whose reporter is
 * the caller. Filtering again here would be a second definition of the rule, in
 * the place least able to enforce it.
 *
 * No triage controls. A control that exists only to be refused is noise.
 */
export default function MyReportsClient({
  reports,
  attachments,
}: {
  reports: FeedbackReportView[];
  attachments: FeedbackAttachmentView[];
}) {
  const rows = useMemo(() => sortNewestFirst(reports), [reports]);
  const attachmentCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of attachments) counts.set(a.reportId, (counts.get(a.reportId) ?? 0) + 1);
    return counts;
  }, [attachments]);

  const columns: TableColumnsType<FeedbackReportView> = [
    {
      title: "What you reported",
      dataIndex: "description",
      render: (description: string, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{description}</Typography.Text>
          <Typography.Text type="secondary">{summarizePageContext(row)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "Kind",
      dataIndex: "kind",
      width: 130,
      render: (kind: string) => <Tag color={KIND_COLOR[kind]}>{feedbackKindLabel(kind)}</Tag>,
    },
    {
      title: "Where it stands",
      dataIndex: "status",
      width: 150,
      render: (status: string) => (
        <Tag color={STATUS_COLOR[status] ?? "default"}>{feedbackStatusLabel(status)}</Tag>
      ),
    },
    {
      title: "Files",
      dataIndex: "id",
      width: 90,
      render: (id: string) => attachmentCount.get(id) ?? 0,
    },
    {
      title: "Filed",
      dataIndex: "createdAt",
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
  ];

  if (rows.length === 0) {
    return (
      <Empty description="You have not filed a report yet. Use the Report button on any screen when something is broken or could be better." />
    );
  }

  return <DataTable rowKey="id" columns={columns} dataSource={rows} pagination={false} />;
}
```

Before writing it, open `app/(app)/settings/feedback/FeedbackTriageClient.tsx` and confirm the exact property names on `FeedbackReportView` (`description`, `kind`, `status`, `createdAt`) and on `FeedbackAttachmentView` (`reportId`), and the signature of `summarizePageContext`. Match them; do not guess.

- [ ] **Step 4: Branch in the page**

Replace `app/(app)/settings/feedback/page.tsx` in full:

```tsx
import PageHeader from "@/components/PageHeader";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  listFeedbackAttachments,
  listFeedbackImprovements,
  listFeedbackReports,
} from "@/lib/services/feedback";
import FeedbackTriageClient from "./FeedbackTriageClient";
import MyReportsClient from "./MyReportsClient";

export const dynamic = "force-dynamic";

/**
 * Two screens on one route, and no guard in front of them.
 *
 * An administrator triages the whole queue. Everyone else comes here to see the
 * reports they filed, which is why requireSettingsAccess is deliberately absent:
 * the narrowing is RLS's, and it is already exact.
 */
export default async function FeedbackPage() {
  const sb = await createSupabaseServerClient();
  const [reports, attachments, read, triage] = await Promise.all([
    listFeedbackReports(sb).catch(() => []),
    listFeedbackAttachments(sb).catch(() => []),
    sb.rpc("acc_has_permission", { p_key: "feedback.read" }),
    sb.rpc("acc_has_permission", { p_key: "feedback.triage" }),
  ]);
  const canRead = read.data === true;

  if (!canRead) {
    return (
      <div>
        <PageHeader
          title="My reports"
          description="The bug reports and suggestions you filed, and where each one stands."
        />
        <MyReportsClient reports={reports} attachments={attachments} />
      </div>
    );
  }

  // acc_feedback_queue filters on feedback.read alone, so it is only asked for
  // by someone who holds it.
  const improvements = await listFeedbackImprovements(sb).catch(() => []);

  return (
    <div>
      <PageHeader
        title="Feedback triage"
        description="What staff report as broken and what they ask for. Sort by urgency to see what is costing the most time."
      />
      <FeedbackTriageClient
        initialReports={reports}
        initialAttachments={attachments}
        initialImprovements={improvements}
        canTriage={triage.data === true}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```
npx vitest run tests/unit/feedback-my-reports.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the four gates**

```
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all zero errors. The existing `tests/unit/feedback*.test.ts` files must still pass untouched.

- [ ] **Step 7: See both faces**

```
npm start
```

Second terminal:

```
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000 --only=settings/feedback
```

Expected: 200. The smoke account is an administrator, so this proves the triage face. Then sign in as a non-administrator in a browser at `http://localhost:3000/settings/feedback` and confirm the header reads **My reports**, the table holds only reports that account filed, and no status control appears.

- [ ] **Step 8: Commit**

```bash
git add "ctyhp-accounting/app/(app)/settings/feedback" \
        ctyhp-accounting/tests/unit/feedback-my-reports.test.ts
git commit -m "Let a reporter follow their own report without opening the queue"
```

---

### Task 7: Prove the whole change, then record it

**Files:**
- Modify: `ctyhp-accounting/CLAUDE.md` (one bullet in §3)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

- [ ] **Step 1: Run the four gates from a clean build**

```
cd ctyhp-accounting
rm -rf .next
npm run build && npm test && npm run typecheck && npm run lint
```

Expected: zero errors from all four. Paste the real output; do not summarise it.

- [ ] **Step 2: Run the full page sweep against the build**

```
npm start
```

Second terminal:

```
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```

Expected: 48 pages, zero failures, roughly 16 seconds. Stop `npm start` afterwards — the next step signs in as other accounts and would otherwise invalidate this session.

- [ ] **Step 3: Re-run the access harness**

```
npm run verify:feedback-access
```

Expected: `0 failed`.

- [ ] **Step 4: Record the rule where the next change will read it**

Add to `ctyhp-accounting/CLAUDE.md` §3, after the feedback-priority bullet:

```markdown
- A settings screen's audience is declared once, on its `SETTINGS_HUB` entry in
  `lib/domain/navigation.ts`. The hub filters with `settingsHubForAccess` and
  each page calls `requireSettingsAccess("<its href>")`, which reads the same
  entry — so a new settings page needs a catalog entry with a gate or its guard
  throws. `/settings` and `/settings/feedback` are the two deliberate
  exceptions, named in `tests/unit/navigation.test.ts`. `feedback.read` is
  admin-only since 0099; `acc_feedback_queue` filters on that permission alone
  and returns nothing to anyone else, so a reporter's own view must read the
  table, never the queue.
```

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/CLAUDE.md
git commit -m "Write down where a settings screen's audience is declared"
```

- [ ] **Step 6: Report honestly**

State which gates ran and their real output. If anything was skipped — the non-administrator browser check in Task 6 Step 7 needs a second account, and there may not be one — say so plainly rather than implying it passed.
