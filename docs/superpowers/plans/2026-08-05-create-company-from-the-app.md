# Creating a Company From the App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform administrator create a company from One Book — schema, 96 migrations, grants, register entry and PostgREST exposure — without a developer running a CLI.

**Architecture:** A request row in `onebook` is the queue and the audit trail. One provisioning core in TypeScript is shared by the CLI, the Server Action (through Next 16's `after`) and a cron-authenticated route; it replays `planCompanySchema()`'s statements in batches over a direct Postgres connection and verifies the result against `public` before reporting success.

**Tech Stack:** Next.js 16 App Router and Server Actions, React 19, TypeScript, Ant Design 5, Zod, Supabase/PostgreSQL PL/pgSQL, node-postgres (`pg`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-05-create-company-from-the-app-design.md`

## Global Constraints

- Product name in user-visible copy is **One Book**. All UI copy is US English; currency is USD; "Sales Tax", never "VAT".
- No SQL in components. Financial writes go through `lib/services/*` into a Postgres RPC.
- Never set `created_by` / `created_at` / `updated_by` / `updated_at` from application code — `acc_stamp_actor()` owns them.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, …). Keep markup in `"use client"` components.
- Everything this plan adds to the register lives in the `onebook` schema, so `scopeOf()` holds it back from company schemas. A company must never contain the register.
- The schema a request provisions is `co_<slug>`; the slug matches `^[a-z][a-z0-9_]{1,40}$` — the same check `onebook.company` already enforces.
- Never disable RLS. `onebook.is_platform_admin()` is the only gate on creating a company.
- Provisioning is one transaction. A failure leaves no schema, no register row and no membership.
- Keep every touched TS/TSX file under 400 lines.
- Read the checked-in Next.js 16 docs in `node_modules/next/dist/docs/` before writing route, `after()` or config code.
- Verification gates, all with real pasted output: `npm test`, `npm run typecheck`, `npm run lint`, `npm run security:check-source`, `npm run build`, plus `scripts/smoke-pages.mjs`.
- `SUPABASE_DB_URL` is required at runtime for provisioning only. Its absence must produce a sentence a human can act on, never a stack trace.

## File Map

| File | Responsibility |
|---|---|
| `ctyhp-accounting/supabase/migrations/0097_company_provisioning_requests.sql` | Create. `platform_admin`, `company_request`, five RPCs, RLS, grants. |
| `ctyhp-accounting/lib/domain/company-slug.ts` | Create. `companySlugFromName`, pure. |
| `ctyhp-accounting/lib/domain/schemas.ts` | Modify. `companyCreateSchema`. |
| `ctyhp-accounting/lib/services/company-provisioning.ts` | Create. The provisioning core plus batching. No `server-only`: the CLI imports it. |
| `ctyhp-accounting/lib/db/migration-sources.ts` | Create. Read the migration files from disk. |
| `ctyhp-accounting/lib/db/provisioning-client.ts` | Create. `pg` client from `SUPABASE_DB_URL`, with a readable failure. |
| `ctyhp-accounting/lib/services/company-queue.ts` | Create. Claim a request, provision it, mark it ready or failed. |
| `ctyhp-accounting/scripts/provision-company.ts` | Modify. Call the shared core instead of its own copy. |
| `ctyhp-accounting/lib/db/company.ts` | Modify. `isPlatformAdmin()`. |
| `ctyhp-accounting/app/(app)/settings/companies/actions.ts` | Create. Request, poll and retry actions. |
| `ctyhp-accounting/app/(app)/settings/companies/page.tsx` | Create. Server wrapper, `maxDuration = 300`. |
| `ctyhp-accounting/app/(app)/settings/companies/CompaniesClient.tsx` | Create. Register list, request status, polling. |
| `ctyhp-accounting/app/(app)/settings/companies/NewCompanyModal.tsx` | Create. The form. |
| `ctyhp-accounting/app/api/companies/provision/route.ts` | Create. Cron-authenticated runner and retry path. |
| `ctyhp-accounting/next.config.ts` | Modify. `outputFileTracingIncludes` for the migrations. |
| `ctyhp-accounting/components/CompanySwitcher.tsx` | Modify. `+ New company` in the popup footer. |
| `ctyhp-accounting/components/AppShell.tsx` | Modify. Pass `canCreateCompany` through. |
| `ctyhp-accounting/app/(app)/layout.tsx` | Modify. Resolve `isPlatformAdmin()`. |
| `ctyhp-accounting/lib/domain/navigation.ts` | Modify. Companies card in `SETTINGS_HUB`. |
| `ctyhp-accounting/tests/unit/company-provisioning-schema.test.ts` | Create. Slug and Zod contracts. |
| `ctyhp-accounting/tests/unit/company-provisioning-migration.test.ts` | Create. SQL contract and global scope. |
| `ctyhp-accounting/tests/unit/company-provisioning-core.test.ts` | Create. Order of operations, batching, failure isolation. |
| `ctyhp-accounting/tests/unit/company-queue.test.ts` | Create. Claim → provision → ready/failed. |
| `ctyhp-accounting/tests/unit/company-provisioning-action.test.ts` | Create. Authorization, validation, `after` scheduling. |
| `ctyhp-accounting/tests/unit/company-provisioning-ui-contract.test.ts` | Create. Route wiring and the 400-line ceiling. |
| `ctyhp-accounting/scripts/verify-company-provisioning.mjs` | Create. Rollback-only real provisioning. |
| `ctyhp-accounting/package.json` | Modify. `verify:company-provisioning`. |

---

### Task 1: The register learns to queue a company

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0097_company_provisioning_requests.sql`
- Test: `ctyhp-accounting/tests/unit/company-provisioning-migration.test.ts`

**Interfaces:**
- Consumes: `onebook.company`, `onebook.company_member`, `public.acc_app_user`, `auth.users`.
- Produces: `onebook.platform_admin`, `onebook.company_request`, and the functions `onebook.is_platform_admin()`, `onebook.request_company(text, text, boolean, int) returns uuid`, `onebook.claim_company_request()`, `onebook.complete_company_request(uuid, uuid)`, `onebook.fail_company_request(uuid, text)`, `onebook.retry_company_request(uuid)`.

- [ ] **Step 1: Write the failing migration contract test**

Create `ctyhp-accounting/tests/unit/company-provisioning-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0097_company_provisioning_requests.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("company provisioning request migration", () => {
  it("adds the platform admin list and seeds it from today's administrators", () => {
    expect(sql).toMatch(/create table if not exists onebook\.platform_admin/i);
    expect(sql).toMatch(/create or replace function onebook\.is_platform_admin\(\)/i);
    expect(sql).toMatch(/from public\.acc_app_user/i);
    expect(sql).toMatch(/role = 'admin'/);
  });

  it("adds a request queue with a closed state machine", () => {
    expect(sql).toMatch(/create table if not exists onebook\.company_request/i);
    expect(sql).toMatch(/status\s+text not null default 'pending'/i);
    expect(sql).toMatch(/check \(status in \('pending', 'running', 'ready', 'failed'\)\)/i);
    for (const column of ["slug", "legal_name", "is_sample", "display_order", "requested_by", "attempts", "error", "company_id"]) {
      expect(sql, column).toContain(column);
    }
  });

  it("claims one request at a time and cannot double-provision", () => {
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/create or replace function onebook\.claim_company_request\(\)/i);
    expect(sql).toMatch(/create or replace function onebook\.complete_company_request\(/i);
    expect(sql).toMatch(/create or replace function onebook\.fail_company_request\(/i);
    expect(sql).toMatch(/create or replace function onebook\.retry_company_request\(/i);
  });

  it("refuses a slug already taken by a company or by an unfinished request", () => {
    const fn = sql.slice(sql.indexOf("function onebook.request_company"));
    expect(fn).toMatch(/is_platform_admin\(\)/);
    expect(fn).toMatch(/from onebook\.company\s+where slug = /i);
    expect(fn).toMatch(/status in \('pending', 'running'\)/i);
    expect(fn).toMatch(/\^\[a-z\]\[a-z0-9_\]\{1,40\}\$/);
  });

  it("keeps the register out of every company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    // Every statement names `onebook.`, so a company gets none of it.
    expect(plan.statements).toEqual([]);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/company-provisioning-migration.test.ts`

Expected: FAIL with `ENOENT` because migration 0097 does not exist.

- [ ] **Step 3: Write migration 0097**

Create `ctyhp-accounting/supabase/migrations/0097_company_provisioning_requests.sql`:

```sql
-- ============================================================================
-- 0097  Asking for a company, and who may ask
--
-- Creating a company is not an accounting entry: it is a new Postgres schema
-- holding a hundred tables, four hundred functions and its own row-level
-- security. That is the system owner's act, not an accountant's, and it takes
-- long enough that the browser must not be the thing holding it open.
--
-- So the register gains two things: a list of people who may ask, and a queue
-- of asks with their outcome. The work itself happens outside the database,
-- because rewriting `set search_path = public` per company lives in tested
-- TypeScript and a second copy in PL/pgSQL would be a silent cross-company
-- leak waiting to happen.
--
-- Everything here names `onebook.`, so scopeOf() holds the whole file back from
-- company schemas. The register exists once.
-- ============================================================================

set search_path = public;

-- --- Who may create a company ------------------------------------------------
create table if not exists onebook.platform_admin (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id)
);

-- Seeded from the administrators of the first company's books. If that finds
-- nobody the table stays empty and nobody sees the button — which is correct,
-- not broken. To grant the first one by hand, with the service role:
--   insert into onebook.platform_admin (user_id)
--   select id from auth.users where lower(email) = lower('someone@example.com')
--   on conflict do nothing;
insert into onebook.platform_admin (user_id)
select u.id
  from public.acc_app_user u
 where u.role = 'admin' and u.status = 'active'
on conflict do nothing;

create or replace function onebook.is_platform_admin() returns boolean
language sql stable security definer set search_path = onebook, public as $$
  select exists (select 1 from onebook.platform_admin where user_id = auth.uid());
$$;

revoke all on function onebook.is_platform_admin() from public, anon;
grant execute on function onebook.is_platform_admin() to authenticated, service_role;

-- --- The queue ---------------------------------------------------------------
create table if not exists onebook.company_request (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null check (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  legal_name    text not null check (length(btrim(legal_name)) > 0),
  is_sample     boolean not null default false,
  display_order int not null default 100,
  requested_by  uuid references auth.users (id),
  status        text not null default 'pending'
                check (status in ('pending', 'running', 'ready', 'failed')),
  attempts      int not null default 0,
  error         text,
  company_id    uuid references onebook.company (id) on delete set null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index if not exists onebook_company_request_status_idx
  on onebook.company_request (status, created_at);

alter table onebook.company_request enable row level security;
alter table onebook.platform_admin  enable row level security;

-- A platform administrator sees the queue; nobody else sees that it exists.
drop policy if exists onebook_company_request_sel on onebook.company_request;
create policy onebook_company_request_sel on onebook.company_request
  for select using (onebook.is_platform_admin());

drop policy if exists onebook_platform_admin_sel on onebook.platform_admin;
create policy onebook_platform_admin_sel on onebook.platform_admin
  for select using (onebook.is_platform_admin());

revoke all on onebook.company_request, onebook.platform_admin from public, anon;
grant select on onebook.company_request, onebook.platform_admin to authenticated;
grant all    on onebook.company_request, onebook.platform_admin to service_role;

-- --- Asking ------------------------------------------------------------------
create or replace function onebook.request_company(
  p_slug text,
  p_legal_name text,
  p_is_sample boolean default false,
  p_display_order int default 100
) returns uuid
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_name text := btrim(coalesce(p_legal_name, ''));
  v_id   uuid;
begin
  if not onebook.is_platform_admin() then
    raise exception 'Not authorized to create a company';
  end if;
  if v_slug !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'A company key is lower case letters, digits and underscores';
  end if;
  if length(v_name) = 0 then raise exception 'A legal name is required'; end if;
  if exists (select 1 from onebook.company where slug = v_slug) then
    raise exception 'A company already uses the key %', v_slug;
  end if;
  -- A second click while the first is still building must not queue a twin.
  if exists (
    select 1 from onebook.company_request
     where slug = v_slug and status in ('pending', 'running')
  ) then
    raise exception 'A company with the key % is already being created', v_slug;
  end if;

  insert into onebook.company_request (slug, legal_name, is_sample, display_order, requested_by)
  values (v_slug, v_name, coalesce(p_is_sample, false), coalesce(p_display_order, 100), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function onebook.request_company(text, text, boolean, int) from public, anon;
grant execute on function onebook.request_company(text, text, boolean, int)
  to authenticated, service_role;

-- --- Working the queue -------------------------------------------------------
-- `skip locked` is the whole point: the Server Action and the cron route can
-- both be running, and neither may take a request the other already holds.
create or replace function onebook.claim_company_request()
returns onebook.company_request
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_row onebook.company_request;
begin
  select * into v_row
    from onebook.company_request
   where status = 'pending'
   order by created_at
   for update skip locked
   limit 1;
  if not found then return null; end if;

  update onebook.company_request
     set status = 'running', started_at = now(), attempts = attempts + 1, error = null
   where id = v_row.id
   returning * into v_row;
  return v_row;
end;
$$;

create or replace function onebook.complete_company_request(p_id uuid, p_company_id uuid)
returns void
language sql security definer set search_path = onebook, public as $$
  update onebook.company_request
     set status = 'ready', company_id = p_company_id, finished_at = now(), error = null
   where id = p_id;
$$;

create or replace function onebook.fail_company_request(p_id uuid, p_error text)
returns void
language sql security definer set search_path = onebook, public as $$
  update onebook.company_request
     set status = 'failed', finished_at = now(), error = left(coalesce(p_error, 'Unknown error'), 2000)
   where id = p_id;
$$;

create or replace function onebook.retry_company_request(p_id uuid) returns void
language plpgsql security definer set search_path = onebook, public as $$
begin
  if not onebook.is_platform_admin() then
    raise exception 'Not authorized to create a company';
  end if;
  update onebook.company_request
     set status = 'pending', error = null, started_at = null, finished_at = null
   where id = p_id and status = 'failed';
  if not found then raise exception 'Only a failed request can be retried'; end if;
end;
$$;

revoke all on function onebook.claim_company_request() from public, anon, authenticated;
revoke all on function onebook.complete_company_request(uuid, uuid) from public, anon, authenticated;
revoke all on function onebook.fail_company_request(uuid, text) from public, anon, authenticated;
grant execute on function onebook.claim_company_request() to service_role;
grant execute on function onebook.complete_company_request(uuid, uuid) to service_role;
grant execute on function onebook.fail_company_request(uuid, text) to service_role;

revoke all on function onebook.retry_company_request(uuid) from public, anon;
grant execute on function onebook.retry_company_request(uuid) to authenticated, service_role;
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm test -- tests/unit/company-provisioning-migration.test.ts tests/unit/schema-template.test.ts`

Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add ctyhp-accounting/supabase/migrations/0097_company_provisioning_requests.sql ctyhp-accounting/tests/unit/company-provisioning-migration.test.ts
git commit -m "Let the register hold a queue of companies waiting to be built"
```

---

### Task 2: Naming a company

**Files:**
- Create: `ctyhp-accounting/lib/domain/company-slug.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Test: `ctyhp-accounting/tests/unit/company-provisioning-schema.test.ts`

**Interfaces:**
- Produces: `companySlugFromName(name: string): string`, `companyCreateSchema`, `CompanyCreateInput`.

- [ ] **Step 1: Write the failing tests**

Create `ctyhp-accounting/tests/unit/company-provisioning-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { companySlugFromName } from "@/lib/domain/company-slug";
import { companyCreateSchema } from "@/lib/domain/schemas";

describe("companySlugFromName", () => {
  it("turns a legal name into a key the register accepts", () => {
    expect(companySlugFromName("North Star Bridal LLC")).toBe("north_star_bridal_llc");
    expect(companySlugFromName("Harbor Gems Trading Co.")).toBe("harbor_gems_trading_co");
    expect(companySlugFromName("  Aurora   Fine Jewelry  ")).toBe("aurora_fine_jewelry");
  });

  it("keeps the result inside the register's own pattern", () => {
    const pattern = /^[a-z][a-z0-9_]{1,40}$/;
    expect(companySlugFromName("3M Metals")).toMatch(pattern); // may not start with a digit
    expect(companySlugFromName("Übergem & Co")).toMatch(pattern);
    expect(companySlugFromName("A".repeat(80))).toMatch(pattern);
  });

  it("gives nothing back for a name with no usable letters", () => {
    expect(companySlugFromName("!!!")).toBe("");
    expect(companySlugFromName("")).toBe("");
  });
});

describe("companyCreateSchema", () => {
  const base = { legal_name: "North Star Bridal LLC", slug: "north_star" };

  it("accepts a trimmed name and key with sensible defaults", () => {
    expect(companyCreateSchema.parse({ legal_name: "  North Star  ", slug: "north_star" })).toEqual({
      legal_name: "North Star",
      slug: "north_star",
      is_sample: false,
      display_order: 100,
    });
  });

  it("rejects a key the register would refuse", () => {
    for (const slug of ["North_Star", "1north", "n", "no-dashes", "x".repeat(42), ""]) {
      expect(companyCreateSchema.safeParse({ ...base, slug }).success, slug).toBe(false);
    }
  });

  it("rejects an empty legal name and an absurd display order", () => {
    expect(companyCreateSchema.safeParse({ ...base, legal_name: "   " }).success).toBe(false);
    expect(companyCreateSchema.safeParse({ ...base, display_order: -1 }).success).toBe(false);
    expect(companyCreateSchema.safeParse({ ...base, display_order: 10_000 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/company-provisioning-schema.test.ts`

Expected: FAIL because `@/lib/domain/company-slug` does not exist.

- [ ] **Step 3: Write the pure helper**

Create `ctyhp-accounting/lib/domain/company-slug.ts`:

```ts
/**
 * A company's key, derived from its legal name.
 *
 * The key becomes a Postgres schema name (`co_<slug>`), so it has to satisfy
 * `^[a-z][a-z0-9_]{1,40}$` — the same check `onebook.company` enforces. The
 * derivation is a suggestion the user can overwrite; what it must never do is
 * suggest something the register will reject.
 */
export function companySlugFromName(name: string): string {
  const ascii = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const base = ascii
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    // A key may not start with a digit, and dropping the digits would turn
    // "3M Metals" into "m_metals" — a leading letter keeps the name readable.
    .replace(/^(?=\d)/, "c");
  const trimmed = base.slice(0, 41).replace(/_+$/, "");
  return trimmed.length >= 2 ? trimmed : "";
}
```

- [ ] **Step 4: Add the Zod contract**

In `ctyhp-accounting/lib/domain/schemas.ts`, at the end of the file:

```ts
// --- Companies (the register, not a company's own settings) ---
export const companyCreateSchema = z.object({
  legal_name: z.string().trim().min(1, "A legal name is required").max(160),
  slug: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9_]{1,40}$/,
      "A company key is lower case letters, digits and underscores, starting with a letter",
    ),
  is_sample: z.boolean().default(false),
  display_order: z.number().int().min(0).max(1000).default(100),
});
export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;
```

- [ ] **Step 5: Run the tests and verify GREEN**

Run: `npm test -- tests/unit/company-provisioning-schema.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/domain/company-slug.ts ctyhp-accounting/lib/domain/schemas.ts ctyhp-accounting/tests/unit/company-provisioning-schema.test.ts
git commit -m "Suggest a company key the register will actually accept"
```

---

### Task 3: The provisioning core, shared with the CLI

**Files:**
- Create: `ctyhp-accounting/lib/services/company-provisioning.ts`
- Create: `ctyhp-accounting/lib/db/migration-sources.ts`
- Modify: `ctyhp-accounting/scripts/provision-company.ts`
- Test: `ctyhp-accounting/tests/unit/company-provisioning-core.test.ts`

**Interfaces:**
- Consumes: `planCompanySchema` from `@/lib/domain/schema-template`.
- Produces: `MigrationSource`, `ProvisionCompanyInput`, `ProvisionCompanyResult`, `PROVISION_BATCH_SIZE`, `provisionCompany(client, input, sources)`, `refreshExposedSchemas(client)`, `companyInventory(client, schema)`, and `loadMigrationSources()` / `REGISTER_MIGRATION`.
- The module has **no** `server-only` import: `scripts/provision-company.ts` imports it under plain Node, where that package does not resolve.

- [ ] **Step 1: Write the failing core tests**

Create `ctyhp-accounting/tests/unit/company-provisioning-core.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  PROVISION_BATCH_SIZE,
  provisionCompany,
  type MigrationSource,
} from "@/lib/services/company-provisioning";

/** A Postgres client that records what it was asked and answers plausibly. */
function fakeClient(overrides: { failOn?: RegExp } = {}) {
  const sql: string[] = [];
  const client = {
    sql,
    async query(text: string, params?: unknown[]) {
      sql.push(text);
      if (overrides.failOn?.test(text)) throw new Error("syntax error at or near");
      if (/information_schema\.tables/.test(text)) {
        return { rows: [{ table_name: "acc_invoice" }, { table_name: "acc_payment" }] };
      }
      if (/pg_proc/.test(text)) return { rows: [{ proname: "acc_post_entry" }] };
      if (/pg_policies/.test(text)) return { rows: [{ n: 42 }] };
      if (/insert into onebook\.company\b/.test(text)) return { rows: [{ id: "company-1" }] };
      if (/string_agg/.test(text)) return { rows: [{ schemas: "co_probe, onebook, public" }] };
      void params;
      return { rows: [] };
    },
  };
  return client;
}

const sources: MigrationSource[] = [
  { file: "0001_init.sql", sql: "create table acc_invoice (id uuid primary key);" },
  { file: "0002_more.sql", sql: "create table acc_payment (id uuid primary key);" },
];

const input = {
  slug: "north_star",
  legalName: "North Star Bridal LLC",
  isSample: false,
  displayOrder: 100,
  adminUserIds: [] as string[],
};

describe("provisionCompany", () => {
  it("builds the schema before anything is allowed to use it", async () => {
    const client = fakeClient();

    await provisionCompany(client, input, sources);

    const order = client.sql.join("\n@@\n");
    const at = (needle: string) => order.indexOf(needle);
    expect(at("create schema co_north_star")).toBeGreaterThan(-1);
    expect(at("create schema co_north_star")).toBeLessThan(at("acc_schema_migrations"));
    expect(at("acc_schema_migrations")).toBeLessThan(at("set local search_path = co_north_star"));
    expect(at("set local search_path = co_north_star")).toBeLessThan(at("grant usage on schema"));
    expect(at("grant usage on schema")).toBeLessThan(at("insert into onebook.company"));
    expect(at("revoke all on schema co_north_star from anon")).toBeGreaterThan(-1);
  });

  it("tells PostgREST about the new schema, and reloads both caches", async () => {
    const client = fakeClient();

    await provisionCompany(client, input, sources);

    const order = client.sql.join("\n@@\n");
    expect(order).toContain("alter role authenticator set pgrst.db_schemas");
    expect(order).toContain("reload config");
    expect(order).toContain("reload schema");
  });

  it("sends statements in batches rather than one round trip each", async () => {
    const many: MigrationSource[] = [
      {
        file: "0003_many.sql",
        sql: Array.from({ length: PROVISION_BATCH_SIZE * 2 }, (_, i) => `create table t${i} (id int);`).join("\n"),
      },
    ];
    const client = fakeClient();

    await provisionCompany(client, input, many);

    const batches = client.sql.filter((text) => text.startsWith("create table t"));
    expect(batches.length).toBe(2);
    expect(batches[0].split(";").length).toBeGreaterThan(2);
  });

  it("replays a failing batch one statement at a time so the error names it", async () => {
    const many: MigrationSource[] = [
      {
        file: "0003_many.sql",
        sql: ["create table good_a (id int);", "create tabel typo (id int);", "create table good_b (id int);"].join("\n"),
      },
    ];
    const client = fakeClient({ failOn: /create tabel typo/ });

    await expect(provisionCompany(client, input, many)).rejects.toThrow(/create tabel typo/);
  });

  it("refuses to report success when the new schema is missing something public has", async () => {
    const client = {
      async query(text: string) {
        if (/information_schema\.tables/.test(text)) {
          // public answers second and has a table the company never got.
          return /'co_north_star'|\$1/.test(text) && !client.publicAsked
            ? ((client.publicAsked = true), { rows: [{ table_name: "acc_invoice" }] })
            : { rows: [{ table_name: "acc_invoice" }, { table_name: "acc_journal_entry" }] };
        }
        if (/pg_proc/.test(text)) return { rows: [] };
        if (/pg_policies/.test(text)) return { rows: [{ n: 0 }] };
        if (/insert into onebook\.company\b/.test(text)) return { rows: [{ id: "company-1" }] };
        if (/string_agg/.test(text)) return { rows: [{ schemas: "public" }] };
        return { rows: [] };
      },
      publicAsked: false,
    } as { query: (t: string) => Promise<{ rows: unknown[] }>; publicAsked: boolean };

    await expect(provisionCompany(client, input, sources)).rejects.toThrow(/acc_journal_entry/);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/company-provisioning-core.test.ts`

Expected: FAIL because `@/lib/services/company-provisioning` does not exist.

- [ ] **Step 3: Write the migration source loader**

Create `ctyhp-accounting/lib/db/migration-sources.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface MigrationSource {
  file: string;
  sql: string;
}

/**
 * The migration that builds the register itself; a company never contains it.
 * Matched by full name — two branches can land on the same number.
 */
export const REGISTER_MIGRATION = "0081_company_register.sql";

/**
 * Every migration a new company must be given, in order.
 *
 * Read from disk at call time rather than bundled as a string, so a migration
 * added tomorrow needs no code change. On Vercel the files reach the function
 * through `outputFileTracingIncludes` in next.config.ts; if that is ever
 * dropped this throws here rather than building three quarters of a ledger.
 */
export function loadMigrationSources(root = process.cwd()): MigrationSource[] {
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql") && file !== REGISTER_MIGRATION)
    .sort();
  if (files.length === 0) {
    throw new Error(`No migration files found in ${dir}; a company cannot be built without them`);
  }
  return files.map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
}
```

- [ ] **Step 4: Write the provisioning core**

Create `ctyhp-accounting/lib/services/company-provisioning.ts`:

```ts
import { planCompanySchema } from "@/lib/domain/schema-template";
import type { MigrationSource } from "@/lib/db/migration-sources";

export type { MigrationSource };

/**
 * Building a company's books.
 *
 * This is the code `scripts/provision-company.ts` used to hold on its own. It
 * lives here so the CLI, the Server Action and the rollback-only verification
 * script all run the *same* provisioning — three copies of "replay the
 * migrations" is three chances for one of them to build a subtly different
 * company.
 *
 * It takes a client rather than opening one, which is what lets the verifier
 * hand it a transaction it intends to roll back.
 *
 * No `server-only` marker: the CLI imports this under plain Node.
 */
export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ProvisionCompanyInput {
  slug: string;
  legalName: string;
  isSample: boolean;
  displayOrder: number;
  /** Given membership in the register and administrator rights inside the books. */
  adminUserIds: readonly string[];
}

export interface ProvisionCompanyResult {
  companyId: string;
  schema: string;
  statementCount: number;
  tableCount: number;
  functionCount: number;
  policyCount: number;
}

/**
 * How many statements go in one round trip.
 *
 * 1053 separate queries is a minute of latency and nothing else; fifty at a
 * time is twenty-one. The size is a balance: too large and a failure report
 * covers too much ground, which is why a failed batch is replayed singly below.
 */
export const PROVISION_BATCH_SIZE = 50;

export async function companyInventory(client: PgLike, schema: string) {
  const tables = await client.query(
    `select table_name from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE' order by 1`,
    [schema],
  );
  const routines = await client.query(
    `select distinct p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $1 order by 1`,
    [schema],
  );
  const policies = await client.query(
    `select count(*)::int as n from pg_policies where schemaname = $1`,
    [schema],
  );
  return {
    tables: tables.rows.map((r) => r.table_name as string),
    routines: routines.rows.map((r) => r.proname as string),
    policyCount: Number(policies.rows[0]?.n ?? 0),
  };
}

/**
 * Tell PostgREST which schemas it may serve.
 *
 * Without this the application can authenticate perfectly and still get
 * "schema must be one of the following" on every request to a new company.
 * Two reloads, and both are needed: the first makes PostgREST re-read which
 * schemas it may serve, the second what is *in* them.
 */
export async function refreshExposedSchemas(client: PgLike): Promise<string> {
  const { rows } = await client.query(
    `select string_agg(schema_name, ', ' order by schema_name) as schemas
       from (select 'public' as schema_name
             union select 'onebook'
             union select schema_name from onebook.company) s`,
  );
  const schemas = rows[0].schemas as string;
  await client.query(`alter role authenticator set pgrst.db_schemas = '${schemas}'`);
  await client.query(`notify pgrst, 'reload config'`);
  await client.query(`notify pgrst, 'reload schema'`);
  return schemas;
}

/** Run a batch, and if it fails, find out which statement did it. */
async function runBatch(client: PgLike, batch: string[], from: number, total: number) {
  try {
    await client.query(batch.join(";\n"));
  } catch {
    for (let i = 0; i < batch.length; i += 1) {
      try {
        await client.query(batch[i]);
      } catch (error) {
        throw new Error(
          `statement ${from + i + 1}/${total} failed: ${(error as Error).message}\n` +
            `--- SQL ---\n${batch[i].slice(0, 600)}`,
        );
      }
    }
    throw new Error(`a batch of ${batch.length} statements failed but every statement passed alone`);
  }
}

async function grantAccess(
  client: PgLike,
  schema: string,
  slug: string,
  userIds: readonly string[],
): Promise<void> {
  for (const userId of userIds) {
    await client.query(
      `insert into onebook.company_member (company_id, user_id)
       select c.id, $2 from onebook.company c where c.slug = $1
       on conflict do nothing`,
      [slug, userId],
    );
    await client.query(
      `insert into ${schema}.acc_app_user (id, full_name, role, status)
       select $1, coalesce(u.email, 'Administrator'), 'admin', 'active'
         from auth.users u where u.id = $1
       on conflict (id) do update set role = 'admin', status = 'active'`,
      [userId],
    );
  }
}

/**
 * Build one company. The caller owns the transaction: everything below either
 * commits together or leaves no trace.
 */
export async function provisionCompany(
  client: PgLike,
  input: ProvisionCompanyInput,
  sources: readonly MigrationSource[],
): Promise<ProvisionCompanyResult> {
  const schema = `co_${input.slug}`;
  const plan = planCompanySchema(sources, schema);

  await client.query(`create schema ${schema}`);
  // The runner creates this table, not any migration file, so a fresh schema
  // has to be given one before the migrations that reference it arrive.
  await client.query(`create table ${schema}.acc_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`);
  // Deliberately narrow: the company's own schema and the extensions it needs.
  // If a statement cannot resolve a name it fails here and loudly, rather than
  // silently finding the object in public.
  await client.query(`set local search_path = ${schema}, extensions`);

  for (let i = 0; i < plan.statements.length; i += PROVISION_BATCH_SIZE) {
    const batch = plan.statements.slice(i, i + PROVISION_BATCH_SIZE);
    await runBatch(client, batch, i, plan.statements.length);
  }

  // The application connects as `authenticated`; row-level security decides
  // what it may see once it is in.
  await client.query(`grant usage on schema ${schema} to authenticated, service_role`);
  await client.query(
    `grant select, insert, update, delete on all tables in schema ${schema} to authenticated`,
  );
  await client.query(`grant all on all tables in schema ${schema} to service_role`);
  await client.query(
    `grant usage, select on all sequences in schema ${schema} to authenticated, service_role`,
  );
  await client.query(`revoke all on schema ${schema} from anon`);

  for (const source of sources) {
    await client.query(
      `insert into ${schema}.acc_schema_migrations (filename) values ($1) on conflict do nothing`,
      [source.file],
    );
  }

  const registered = await client.query(
    `insert into onebook.company (slug, schema_name, legal_name, is_sample, display_order)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.slug, schema, input.legalName, input.isSample, input.displayOrder],
  );
  const companyId = registered.rows[0].id as string;

  await grantAccess(client, schema, input.slug, input.adminUserIds);
  await refreshExposedSchemas(client);

  // --- Check the work -------------------------------------------------------
  const built = await companyInventory(client, schema);
  const reference = await companyInventory(client, "public");
  const missingTables = reference.tables.filter((t) => !built.tables.includes(t));
  const missingRoutines = reference.routines.filter((r) => !built.routines.includes(r));
  if (missingTables.length || missingRoutines.length) {
    throw new Error(
      `${schema} is not complete — missing tables: ${missingTables.join(", ") || "none"}; ` +
        `missing functions: ${missingRoutines.join(", ") || "none"}`,
    );
  }

  return {
    companyId,
    schema,
    statementCount: plan.statements.length,
    tableCount: built.tables.length,
    functionCount: built.routines.length,
    policyCount: built.policyCount,
  };
}
```

- [ ] **Step 5: Run the tests and verify GREEN**

Run: `npm test -- tests/unit/company-provisioning-core.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 6: Point the CLI at the shared core**

In `ctyhp-accounting/scripts/provision-company.ts`, delete its private `migrationSources`, `inventory`, `grantAccess` and `refreshExposedSchemas`, and the inline build in `main()`. Keep argument parsing, the `--drop` path, the console reporting and the "already registered" guard. The build becomes:

```ts
import { loadMigrationSources } from "../lib/db/migration-sources.ts";
import { provisionCompany, refreshExposedSchemas } from "../lib/services/company-provisioning.ts";

// …inside main(), replacing everything between `begin` and `commit`:
const adminIds: string[] = [];
for (const email of args.admins) {
  const { rows } = await client.query(
    "select id from auth.users where lower(email) = lower($1)",
    [email],
  );
  if (rows.length === 0) {
    console.log(`  ! no account for ${email}; skipped`);
    continue;
  }
  adminIds.push(rows[0].id as string);
}

await client.query("begin");
const result = await provisionCompany(
  client,
  {
    slug: args.slug,
    legalName: args.name,
    isSample: args.sample,
    displayOrder: args.order,
    adminUserIds: adminIds,
  },
  loadMigrationSources(join(here, "..")),
);
await client.query("commit");

console.log(`\n${result.schema} built:`);
console.log(`  statements ${result.statementCount}`);
console.log(`  tables     ${result.tableCount}`);
console.log(`  functions  ${result.functionCount}`);
console.log(`  policies   ${result.policyCount}`);
console.log(`\nRegistered ${args.name} as ${args.slug}${args.sample ? " (sample)" : ""}.`);
```

The `--drop` path keeps calling `refreshExposedSchemas(client)` after removing the schema.

- [ ] **Step 7: Prove the CLI still parses and typechecks**

Run: `npm run typecheck`

Expected: clean.

Run: `node --experimental-strip-types scripts/provision-company.ts --slug=probe 2>&1 | head -3`

Expected: it fails on the missing `--name` or on `SUPABASE_DB_URL`, not on an import or syntax error. Do **not** run it with a real slug.

- [ ] **Step 8: Commit**

```bash
git add ctyhp-accounting/lib/services/company-provisioning.ts ctyhp-accounting/lib/db/migration-sources.ts ctyhp-accounting/scripts/provision-company.ts ctyhp-accounting/tests/unit/company-provisioning-core.test.ts
git commit -m "Give the CLI and the app one way to build a company, not two"
```

---

### Task 4: Working the queue

**Files:**
- Create: `ctyhp-accounting/lib/db/provisioning-client.ts`
- Create: `ctyhp-accounting/lib/services/company-queue.ts`
- Test: `ctyhp-accounting/tests/unit/company-queue.test.ts`

**Interfaces:**
- Consumes: `provisionCompany`, `loadMigrationSources`, and the Task 1 RPCs.
- Produces: `createProvisioningClient(): Promise<pg.Client>`, `runPendingCompanyProvisioning(deps?): Promise<CompanyQueueRun>`, `CompanyQueueRun = { processed: number; migrationFileCount: number; results: Array<{ requestId: string; slug: string; ok: boolean; error?: string }> }`.

- [ ] **Step 1: Write the failing queue tests**

Create `ctyhp-accounting/tests/unit/company-queue.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runPendingCompanyProvisioning } from "@/lib/services/company-queue";

const request = {
  id: "req-1",
  slug: "north_star",
  legal_name: "North Star Bridal LLC",
  is_sample: false,
  display_order: 100,
  requested_by: "user-1",
};

function fakeClient(claims: (Record<string, unknown> | null)[]) {
  const calls: string[] = [];
  let claimIndex = 0;
  return {
    calls,
    ended: false,
    async query(text: string) {
      calls.push(text);
      if (/claim_company_request/.test(text)) {
        const row = claims[claimIndex] ?? null;
        claimIndex += 1;
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
    async end() {
      this.ended = true;
    },
  };
}

describe("runPendingCompanyProvisioning", () => {
  it("does nothing, expensively, when the queue is empty", async () => {
    const client = fakeClient([null]);
    const provision = vi.fn();

    const run = await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => [{ file: "0001.sql", sql: "select 1;" }],
    });

    expect(run.processed).toBe(0);
    expect(provision).not.toHaveBeenCalled();
    expect(client.ended).toBe(true);
  });

  it("provisions a claimed request inside its own transaction and marks it ready", async () => {
    const client = fakeClient([request, null]);
    const provision = vi.fn().mockResolvedValue({
      companyId: "company-1",
      schema: "co_north_star",
      statementCount: 1053,
      tableCount: 100,
      functionCount: 400,
      policyCount: 300,
    });

    const run = await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => [{ file: "0001.sql", sql: "select 1;" }],
    });

    expect(run.processed).toBe(1);
    expect(run.results[0]).toMatchObject({ requestId: "req-1", slug: "north_star", ok: true });
    expect(provision).toHaveBeenCalledWith(
      client,
      {
        slug: "north_star",
        legalName: "North Star Bridal LLC",
        isSample: false,
        displayOrder: 100,
        adminUserIds: ["user-1"],
      },
      [{ file: "0001.sql", sql: "select 1;" }],
    );
    const order = client.calls.join("\n@@\n");
    expect(order.indexOf("begin")).toBeLessThan(order.indexOf("commit"));
    expect(order).toContain("complete_company_request");
  });

  it("rolls back and records the message when provisioning refuses", async () => {
    const client = fakeClient([request, null]);
    const provision = vi.fn().mockRejectedValue(new Error("co_north_star is not complete"));

    const run = await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => [{ file: "0001.sql", sql: "select 1;" }],
    });

    expect(run.results[0]).toMatchObject({ ok: false, error: "co_north_star is not complete" });
    const order = client.calls.join("\n@@\n");
    expect(order).toContain("rollback");
    expect(order).toContain("fail_company_request");
    expect(order).not.toContain("complete_company_request");
    expect(client.ended).toBe(true);
  });

  it("stops after the batch limit even if more are waiting", async () => {
    const client = fakeClient([request, request, request]);
    const provision = vi.fn().mockResolvedValue({
      companyId: "company-1",
      schema: "co_north_star",
      statementCount: 1,
      tableCount: 1,
      functionCount: 1,
      policyCount: 1,
    });

    const run = await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => [{ file: "0001.sql", sql: "select 1;" }],
      maxRequests: 2,
    });

    expect(run.processed).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/company-queue.test.ts`

Expected: FAIL because `@/lib/services/company-queue` does not exist.

- [ ] **Step 3: Write the connection factory**

Create `ctyhp-accounting/lib/db/provisioning-client.ts`:

```ts
import "server-only";
import pg from "pg";

/**
 * A direct Postgres connection, for the one job PostgREST cannot do.
 *
 * Creating a company needs `create schema`, role settings and `notify pgrst` —
 * DDL and server configuration, not row access. This is the only place in the
 * running application that holds the connection string, and nothing but
 * provisioning may import it.
 */
export async function createProvisioningClient(): Promise<pg.Client> {
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "This deployment has no database connection string, so it cannot create a company. " +
        "Set SUPABASE_DB_URL in the project's environment.",
    );
  }
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });
  await client.connect();
  return client;
}
```

- [ ] **Step 4: Write the queue runner**

Create `ctyhp-accounting/lib/services/company-queue.ts`:

```ts
import "server-only";
import { createProvisioningClient } from "@/lib/db/provisioning-client";
import { loadMigrationSources, type MigrationSource } from "@/lib/db/migration-sources";
import {
  provisionCompany,
  type PgLike,
  type ProvisionCompanyInput,
  type ProvisionCompanyResult,
} from "@/lib/services/company-provisioning";

export interface CompanyQueueResult {
  requestId: string;
  slug: string;
  ok: boolean;
  error?: string;
}

export interface CompanyQueueRun {
  processed: number;
  migrationFileCount: number;
  results: CompanyQueueResult[];
}

interface QueueDependencies {
  createClient?: () => Promise<PgLike & { end(): Promise<void> }>;
  provision?: (
    client: PgLike,
    input: ProvisionCompanyInput,
    sources: readonly MigrationSource[],
  ) => Promise<ProvisionCompanyResult>;
  loadSources?: () => MigrationSource[];
  maxRequests?: number;
}

/**
 * Build whatever companies are waiting.
 *
 * One transaction per request: a company either exists completely or was never
 * started, and either way the request row says which. The failure message is
 * kept because the person who asked is not watching a terminal.
 */
export async function runPendingCompanyProvisioning(
  deps: QueueDependencies = {},
): Promise<CompanyQueueRun> {
  const createClient = deps.createClient ?? createProvisioningClient;
  const provision = deps.provision ?? provisionCompany;
  const loadSources = deps.loadSources ?? loadMigrationSources;
  const maxRequests = deps.maxRequests ?? 3;

  const sources = loadSources();
  const client = await createClient();
  const results: CompanyQueueResult[] = [];

  try {
    for (let i = 0; i < maxRequests; i += 1) {
      const claimed = await client.query(`select * from onebook.claim_company_request()`);
      const row = claimed.rows[0];
      if (!row || !row.id) break;

      const requestId = row.id as string;
      const slug = row.slug as string;
      try {
        await client.query("begin");
        const result = await provision(
          client,
          {
            slug,
            legalName: row.legal_name as string,
            isSample: Boolean(row.is_sample),
            displayOrder: Number(row.display_order ?? 100),
            adminUserIds: row.requested_by ? [row.requested_by as string] : [],
          },
          sources,
        );
        await client.query(`select onebook.complete_company_request($1, $2)`, [
          requestId,
          result.companyId,
        ]);
        await client.query("commit");
        results.push({ requestId, slug, ok: true });
      } catch (error) {
        await client.query("rollback");
        const message = error instanceof Error ? error.message : "Provisioning failed";
        // Outside the rolled-back transaction, so the reason survives.
        await client.query(`select onebook.fail_company_request($1, $2)`, [requestId, message]);
        results.push({ requestId, slug, ok: false, error: message });
      }
    }
  } finally {
    await client.end();
  }

  return { processed: results.length, migrationFileCount: sources.length, results };
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -- tests/unit/company-queue.test.ts`

Expected: PASS, 4 tests.

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/db/provisioning-client.ts ctyhp-accounting/lib/services/company-queue.ts ctyhp-accounting/tests/unit/company-queue.test.ts
git commit -m "Work the company queue one transaction at a time"
```

---

### Task 5: Asking from the app

**Files:**
- Modify: `ctyhp-accounting/lib/db/company.ts`
- Create: `ctyhp-accounting/app/(app)/settings/companies/actions.ts`
- Test: `ctyhp-accounting/tests/unit/company-provisioning-action.test.ts`

**Interfaces:**
- Consumes: `companyCreateSchema`, `runPendingCompanyProvisioning`, `after` from `next/server`.
- Produces: `isPlatformAdmin(): Promise<boolean>`, `requestCompanyAction(raw): Promise<ActionResult<{ requestId: string }>>`, `getCompanyRequestAction(id)`, `retryCompanyRequestAction(id)`, `listCompanyRequestsAction()`.

- [ ] **Step 1: Write the failing action tests**

Create `ctyhp-accounting/tests/unit/company-provisioning-action.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClientForSchema: vi.fn(),
  runPending: vi.fn(),
  after: vi.fn((callback: () => unknown) => callback()),
  revalidatePath: vi.fn(),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClientForSchema: mocks.createClientForSchema,
}));
vi.mock("@/lib/services/company-queue", () => ({
  runPendingCompanyProvisioning: mocks.runPending,
}));

import {
  getCompanyRequestAction,
  requestCompanyAction,
  retryCompanyRequestAction,
} from "@/app/(app)/settings/companies/actions";

function registerClient(overrides: { rpc?: unknown; row?: unknown; error?: { message: string } } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: overrides.rpc ?? "req-1", error: overrides.error ?? null });
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: overrides.row ?? null, error: null }),
    order: () => chain,
    limit: () => chain,
  };
  return { rpc, from: () => chain };
}

const valid = { legal_name: "North Star Bridal LLC", slug: "north_star" };

describe("requestCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runPending.mockResolvedValue({ processed: 1, migrationFileCount: 96, results: [] });
  });

  it("rejects a name and key the register would refuse, before touching the database", async () => {
    const client = registerClient();
    mocks.createClientForSchema.mockResolvedValue(client);

    const result = await requestCompanyAction({ legal_name: "", slug: "Bad Slug" });

    expect(result.ok).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("queues the request against the register schema and starts the work after the response", async () => {
    const client = registerClient();
    mocks.createClientForSchema.mockResolvedValue(client);

    const result = await requestCompanyAction(valid);

    expect(result).toEqual({ ok: true, data: { requestId: "req-1" } });
    expect(mocks.createClientForSchema).toHaveBeenCalledWith("onebook");
    expect(client.rpc).toHaveBeenCalledWith("request_company", {
      p_slug: "north_star",
      p_legal_name: "North Star Bridal LLC",
      p_is_sample: false,
      p_display_order: 100,
    });
    // Scheduled through `after`, so the browser is not holding the connection.
    expect(mocks.after).toHaveBeenCalled();
    expect(mocks.runPending).toHaveBeenCalled();
  });

  it("passes the database's refusal through unchanged", async () => {
    mocks.createClientForSchema.mockResolvedValue(
      registerClient({ error: { message: "Not authorized to create a company" } }),
    );

    await expect(requestCompanyAction(valid)).resolves.toEqual({
      ok: false,
      error: "Not authorized to create a company",
    });
    expect(mocks.runPending).not.toHaveBeenCalled();
  });

  it("reports a deployment with no connection string in words", async () => {
    mocks.createClientForSchema.mockResolvedValue(registerClient());
    mocks.runPending.mockRejectedValue(new Error("This deployment has no database connection string"));

    // The request is still queued; the failure belongs to the worker, not the ask.
    await expect(requestCompanyAction(valid)).resolves.toEqual({
      ok: true,
      data: { requestId: "req-1" },
    });
  });
});

describe("getCompanyRequestAction", () => {
  it("returns the row the register holds for this request", async () => {
    mocks.createClientForSchema.mockResolvedValue(
      registerClient({ row: { id: "req-1", status: "running", slug: "north_star", error: null } }),
    );

    await expect(getCompanyRequestAction("req-1")).resolves.toEqual({
      ok: true,
      data: { id: "req-1", status: "running", slug: "north_star", error: null },
    });
  });
});

describe("retryCompanyRequestAction", () => {
  it("asks the register to reopen the request and works the queue again", async () => {
    const client = registerClient({ rpc: null });
    mocks.createClientForSchema.mockResolvedValue(client);
    mocks.runPending.mockResolvedValue({ processed: 1, migrationFileCount: 96, results: [] });

    await expect(retryCompanyRequestAction("req-1")).resolves.toEqual({ ok: true });
    expect(client.rpc).toHaveBeenCalledWith("retry_company_request", { p_id: "req-1" });
    expect(mocks.runPending).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/company-provisioning-action.test.ts`

Expected: FAIL because the actions module does not exist.

- [ ] **Step 3: Resolve platform administrators**

In `ctyhp-accounting/lib/db/company.ts`, at the end of the file:

```ts
/**
 * May this session create a company?
 *
 * Kept apart from `resolveActiveCompany` because it answers a different
 * question: not "whose books may I open" but "may I make new ones". A refusal
 * here only hides a button; `onebook.request_company` refuses again regardless.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const control = await createSupabaseServerClientForSchema("onebook");
  const { data, error } = await control.rpc("is_platform_admin");
  if (error) return false;
  return Boolean(data);
}
```

- [ ] **Step 4: Write the actions**

Create `ctyhp-accounting/app/(app)/settings/companies/actions.ts`:

```ts
"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClientForSchema } from "@/lib/db/server";
import { companyCreateSchema } from "@/lib/domain/schemas";
import { runPendingCompanyProvisioning } from "@/lib/services/company-queue";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface CompanyRequestView {
  id: string;
  slug: string;
  legal_name: string;
  status: "pending" | "running" | "ready" | "failed";
  attempts: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "An unexpected error occurred";
}

const REQUEST_COLUMNS =
  "id,slug,legal_name,status,attempts,error,created_at,finished_at";

/**
 * Work the queue once the response has gone out.
 *
 * `after` keeps the invocation alive past the response, so the browser is not
 * holding a connection open for the minute it takes to build a hundred tables.
 * A failure here is recorded on the request row by the worker itself — it must
 * never turn a successfully queued ask into an error the user sees.
 */
function startProvisioning(): void {
  after(async () => {
    try {
      await runPendingCompanyProvisioning();
    } catch {
      // The worker records its own failures; nothing to add here.
    }
  });
}

export async function requestCompanyAction(
  raw: unknown,
): Promise<ActionResult<{ requestId: string }>> {
  const parsed = companyCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };

  try {
    // Authorization is the register's: `request_company` refuses anyone who is
    // not a platform administrator, whatever the screen decided to show.
    const control = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await control.rpc("request_company", {
      p_slug: parsed.data.slug,
      p_legal_name: parsed.data.legal_name,
      p_is_sample: parsed.data.is_sample,
      p_display_order: parsed.data.display_order,
    });
    if (error) return { ok: false, error: error.message };

    startProvisioning();
    revalidatePath("/settings/companies");
    return { ok: true, data: { requestId: data as string } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function getCompanyRequestAction(
  id: string,
): Promise<ActionResult<CompanyRequestView | null>> {
  try {
    const control = await createSupabaseServerClientForSchema("onebook");
    const { data, error } = await control
      .from("company_request")
      .select(REQUEST_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data as CompanyRequestView | null) ?? null };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function retryCompanyRequestAction(id: string): Promise<ActionResult> {
  try {
    const control = await createSupabaseServerClientForSchema("onebook");
    const { error } = await control.rpc("retry_company_request", { p_id: id });
    if (error) return { ok: false, error: error.message };
    startProvisioning();
    revalidatePath("/settings/companies");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -- tests/unit/company-provisioning-action.test.ts`

Expected: PASS, 6 tests.

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add ctyhp-accounting/lib/db/company.ts 'ctyhp-accounting/app/(app)/settings/companies/actions.ts' ctyhp-accounting/tests/unit/company-provisioning-action.test.ts
git commit -m "Let a platform administrator ask for a company"
```

---

### Task 6: The route, and getting the migrations into the deployment

**Files:**
- Create: `ctyhp-accounting/app/api/companies/provision/route.ts`
- Modify: `ctyhp-accounting/next.config.ts`
- Modify: `ctyhp-accounting/vercel.json`
- Test: `ctyhp-accounting/tests/unit/company-provisioning-ui-contract.test.ts`

**Interfaces:**
- Consumes: `runPendingCompanyProvisioning`.
- Produces: `POST /api/companies/provision` returning `{ processedAt, processed, migrationFileCount, results }`.

- [ ] **Step 1: Write the failing route contract test**

Create `ctyhp-accounting/tests/unit/company-provisioning-ui-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("company provisioning route", () => {
  const route = read("app", "api", "companies", "provision", "route.ts");

  it("is gated by the same secret as the other background work", () => {
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).toContain("export const maxDuration = 300");
  });

  it("delegates to the queue rather than provisioning itself", () => {
    expect(route).toContain("runPendingCompanyProvisioning");
    expect(route).not.toContain("create schema");
  });
});

describe("deployment carries the migration files", () => {
  it("traces supabase/migrations into the provisioning function", () => {
    const config = read("next.config.ts");
    expect(config).toContain("outputFileTracingIncludes");
    expect(config).toContain("/api/companies/provision");
    expect(config).toContain("./supabase/migrations/**");
  });

  it("keeps a scheduled sweep for anything left pending", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons.some((cron) => cron.path === "/api/companies/provision")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/company-provisioning-ui-contract.test.ts`

Expected: FAIL with `ENOENT` for the route file.

- [ ] **Step 3: Write the route**

Create `ctyhp-accounting/app/api/companies/provision/route.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import { runPendingCompanyProvisioning } from "@/lib/services/company-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const configured = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 24 || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}

/**
 * The safety net behind the Create company button.
 *
 * The button schedules the same work with `after`, so this route exists for the
 * cases that leaves out: an invocation that died mid-build, and a retry. The
 * migration file count in the response is also how a deployment proves it
 * actually carries the 96 migration files.
 */
async function run() {
  const result = await runPendingCompanyProvisioning();
  return Response.json({ processedAt: new Date().toISOString(), ...result });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return await run();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Company provisioning failed" },
      { status: 500 },
    );
  }
}

/** Vercel cron issues GET; the behaviour is identical. */
export async function GET(request: Request) {
  return POST(request);
}
```

- [ ] **Step 4: Trace the migrations into the function and schedule the sweep**

In `ctyhp-accounting/next.config.ts`, add to `nextConfig`:

```ts
  // Provisioning reads the migration files at runtime. Nothing imports them, so
  // the tracer cannot see them and the deployed function would build a company
  // out of nothing. The route's response reports how many it found.
  outputFileTracingIncludes: {
    "/api/companies/provision": ["./supabase/migrations/**"],
  },
```

In `ctyhp-accounting/vercel.json`, add to `crons`:

```json
    {
      "path": "/api/companies/provision",
      "schedule": "45 11 * * *"
    }
```

- [ ] **Step 5: Run the tests and build**

Run: `npm test -- tests/unit/company-provisioning-ui-contract.test.ts`

Expected: PASS, 4 tests.

Run: `npm run build`

Expected: exit 0, and `/api/companies/provision` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add 'ctyhp-accounting/app/api/companies/provision/route.ts' ctyhp-accounting/next.config.ts ctyhp-accounting/vercel.json ctyhp-accounting/tests/unit/company-provisioning-ui-contract.test.ts
git commit -m "Give provisioning a way in that does not depend on a browser"
```

---

### Task 7: The screen

**Files:**
- Create: `ctyhp-accounting/app/(app)/settings/companies/page.tsx`
- Create: `ctyhp-accounting/app/(app)/settings/companies/CompaniesClient.tsx`
- Create: `ctyhp-accounting/app/(app)/settings/companies/NewCompanyModal.tsx`
- Modify: `ctyhp-accounting/lib/domain/navigation.ts`
- Modify: `ctyhp-accounting/components/CompanySwitcher.tsx`
- Modify: `ctyhp-accounting/components/AppShell.tsx`
- Modify: `ctyhp-accounting/app/(app)/layout.tsx`
- Test: `ctyhp-accounting/tests/unit/company-provisioning-ui-contract.test.ts`

**Interfaces:**
- Consumes: `requestCompanyAction`, `getCompanyRequestAction`, `retryCompanyRequestAction`, `companySlugFromName`, `isPlatformAdmin`, `switchCompanyAction`.
- Produces: the `/settings/companies` route; `CompanySwitcher` gains `canCreateCompany: boolean`; `AppShell` passes it through.

- [ ] **Step 1: Extend the UI contract test**

Add to `ctyhp-accounting/tests/unit/company-provisioning-ui-contract.test.ts`:

```ts
describe("the companies screen", () => {
  const route = ["app", "(app)", "settings", "companies"];

  it("keeps the form and the list in their own components", () => {
    const page = read(...route, "page.tsx");
    expect(page).toContain("isPlatformAdmin");
    expect(page).toContain("export const maxDuration = 300");
    const client = read(...route, "CompaniesClient.tsx");
    expect(client).toContain("<NewCompanyModal");
    expect(client).toContain("getCompanyRequestAction");
    expect(client).toContain("retryCompanyRequestAction");
    expect(read(...route, "NewCompanyModal.tsx")).toContain("requestCompanyAction");
    expect(read(...route, "NewCompanyModal.tsx")).toContain("companySlugFromName");
  });

  it("offers the button where a company is chosen, and only to those who may", () => {
    const switcher = read("components", "CompanySwitcher.tsx");
    expect(switcher).toContain("canCreateCompany");
    expect(switcher).toContain("New company");
    expect(switcher).toContain("/settings/companies?new=1");
    expect(read("components", "AppShell.tsx")).toContain("canCreateCompany");
    expect(read("app", "(app)", "layout.tsx")).toContain("isPlatformAdmin");
  });

  it("keeps every new file below the 400-line ceiling", () => {
    for (const file of ["page.tsx", "CompaniesClient.tsx", "NewCompanyModal.tsx"]) {
      expect(read(...route, file).split(/\r?\n/).length, file).toBeLessThanOrEqual(400);
    }
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/unit/company-provisioning-ui-contract.test.ts`

Expected: FAIL because the three files do not exist.

- [ ] **Step 3: Add the hub card**

In `ctyhp-accounting/lib/domain/navigation.ts`, inside the `company` group of `SETTINGS_HUB`, after the Company profile entry:

```ts
      {
        href: "/settings/companies",
        title: "Companies",
        description:
          "Every set of books this system holds, and how to start another one.",
      },
```

`tests/unit/navigation.test.ts` reads the routes from the filesystem and asserts
every `/settings/*` route has a card, so this keeps that test green once the page
in Step 4 exists.

- [ ] **Step 4: Write the server page**

Create `ctyhp-accounting/app/(app)/settings/companies/page.tsx`:

```tsx
import { createSupabaseServerClientForSchema } from "@/lib/db/server";
import { isPlatformAdmin } from "@/lib/db/company";
import PageHeader from "@/components/PageHeader";
import CompaniesClient, { type CompanyRow } from "./CompaniesClient";
import type { CompanyRequestView } from "./actions";

export const dynamic = "force-dynamic";
// `after` keeps provisioning running past the response this page's action
// returns, so the invocation needs room for it.
export const maxDuration = 300;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const initialCreateOpen = (await searchParams).new === "1";
  const control = await createSupabaseServerClientForSchema("onebook");
  const [canCreate, companies, requests] = await Promise.all([
    isPlatformAdmin(),
    control
      .from("company")
      .select("id,slug,schema_name,legal_name,is_sample,status,display_order")
      .order("display_order")
      .order("legal_name"),
    control
      .from("company_request")
      .select("id,slug,legal_name,status,attempts,error,created_at,finished_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Every set of books this system holds, and how to start another one."
      />
      <CompaniesClient
        initialCreateOpen={initialCreateOpen}
        canCreate={canCreate}
        companies={(companies.data ?? []) as CompanyRow[]}
        requests={(requests.data ?? []) as CompanyRequestView[]}
      />
    </div>
  );
}
```

- [ ] **Step 5: Write the client**

Create `ctyhp-accounting/app/(app)/settings/companies/CompaniesClient.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import NewCompanyModal from "./NewCompanyModal";
import {
  getCompanyRequestAction,
  retryCompanyRequestAction,
  type CompanyRequestView,
} from "./actions";

export interface CompanyRow {
  id: string;
  slug: string;
  schema_name: string;
  legal_name: string;
  is_sample: boolean;
  status: string;
  display_order: number;
}

const REQUEST_STATUS: Record<CompanyRequestView["status"], { text: string; color: string }> = {
  pending: { text: "Waiting", color: "default" },
  running: { text: "Building the books", color: "processing" },
  ready: { text: "Ready", color: "green" },
  failed: { text: "Failed", color: "red" },
};

/**
 * Creating a company takes about a minute — a hundred tables, four hundred
 * functions and its own security. So the request is shown as a row with a
 * state, not as a spinner: closing the tab does not lose it, and a failure
 * leaves its reason where somebody can read it.
 */
export default function CompaniesClient({
  initialCreateOpen,
  canCreate,
  companies,
  requests,
}: {
  initialCreateOpen: boolean;
  canCreate: boolean;
  companies: CompanyRow[];
  requests: CompanyRequestView[];
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [open, setOpen] = useState(initialCreateOpen && canCreate);
  const [watching, setWatching] = useState<string | null>(
    requests.find((r) => r.status === "pending" || r.status === "running")?.id ?? null,
  );
  const [retrying, setRetrying] = useState<string | null>(null);

  // Poll only while something is actually being built.
  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await getCompanyRequestAction(watching);
      if (cancelled || !res.ok || !res.data) return;
      if (res.data.status === "ready" || res.data.status === "failed") {
        setWatching(null);
        router.refresh();
        if (res.data.status === "ready") {
          message.success(`${res.data.legal_name} is ready — it is now in the company list`);
        }
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watching, router, message]);

  const onQueued = useCallback(
    (requestId: string) => {
      setWatching(requestId);
      router.refresh();
    },
    [router],
  );

  async function retry(id: string) {
    setRetrying(id);
    try {
      const res = await retryCompanyRequestAction(id);
      if (!res.ok) {
        message.error(res.error ?? "Could not retry");
        return;
      }
      setWatching(id);
      router.refresh();
    } finally {
      setRetrying(null);
    }
  }

  const open_requests = requests.filter((r) => r.status !== "ready");

  return (
    <div>
      {canCreate ? (
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New company
          </Button>
        </Space>
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Only a platform administrator can create a company."
        />
      )}

      {open_requests.length > 0 ? (
        <>
          <Typography.Text strong>In progress</Typography.Text>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            style={{ margin: "8px 0 24px" }}
            dataSource={open_requests}
            columns={[
              { title: "Company", dataIndex: "legal_name" },
              { title: "Key", dataIndex: "slug", width: 160 },
              {
                title: "Status",
                dataIndex: "status",
                width: 180,
                render: (s: CompanyRequestView["status"]) => (
                  <Tag color={REQUEST_STATUS[s].color}>{REQUEST_STATUS[s].text}</Tag>
                ),
              },
              {
                title: "Detail",
                dataIndex: "error",
                render: (error: string | null) => error ?? "—",
              },
              {
                title: "",
                key: "actions",
                width: 110,
                render: (_: unknown, r: CompanyRequestView) =>
                  r.status === "failed" && canCreate ? (
                    <Button size="small" loading={retrying === r.id} onClick={() => retry(r.id)}>
                      Try again
                    </Button>
                  ) : null,
              },
            ]}
          />
        </>
      ) : null}

      <Typography.Text strong>Companies</Typography.Text>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        style={{ marginTop: 8 }}
        dataSource={companies}
        columns={[
          {
            title: "Legal name",
            dataIndex: "legal_name",
            render: (name: string, r: CompanyRow) => (
              <Space size={6}>
                <span>{name}</span>
                {r.is_sample ? <Tag color="orange">sample</Tag> : null}
              </Space>
            ),
          },
          { title: "Key", dataIndex: "slug", width: 180 },
          { title: "Schema", dataIndex: "schema_name", width: 200 },
          {
            title: "Status",
            dataIndex: "status",
            width: 120,
            render: (s: string) => <Tag color={s === "active" ? "green" : "default"}>{s}</Tag>,
          },
        ]}
      />

      <NewCompanyModal
        open={open}
        existingSlugs={companies.map((c) => c.slug)}
        onClose={() => setOpen(false)}
        onQueued={onQueued}
      />
    </div>
  );
}
```

- [ ] **Step 6: Write the form**

Create `ctyhp-accounting/app/(app)/settings/companies/NewCompanyModal.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Alert, App, Form, Input, InputNumber, Modal, Switch, Typography } from "antd";
import { companySlugFromName } from "@/lib/domain/company-slug";
import { requestCompanyAction } from "./actions";

export interface NewCompanyModalProps {
  open: boolean;
  existingSlugs: string[];
  onClose: () => void;
  onQueued: (requestId: string) => void;
}

interface FormValues {
  legal_name: string;
  slug: string;
  is_sample: boolean;
  display_order: number;
}

/**
 * A company is a new set of books, not a record — so the form says what will
 * happen and how long it takes before anyone commits to it.
 */
export default function NewCompanyModal({
  open,
  existingSlugs,
  onClose,
  onQueued,
}: NewCompanyModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  /** The key is a suggestion until the user edits it, then it is theirs. */
  function onNameChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (form.isFieldTouched("slug")) return;
    form.setFieldsValue({ slug: companySlugFromName(event.target.value) });
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const res = await requestCompanyAction(values);
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Could not create the company");
        return;
      }
      message.success("Building the books — this takes about a minute");
      onQueued(res.data.requestId);
      form.resetFields();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="New company"
      open={open}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Create company"
      cancelText="Cancel"
      width={560}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="What this does"
        description="A company gets its own set of books — its own chart of accounts, documents and ledger, separate from every other company here. Building it takes about a minute; you can leave this page while it runs."
      />
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ is_sample: false, display_order: 100 }}
      >
        <Form.Item
          name="legal_name"
          label="Legal name"
          rules={[{ required: true, message: "A legal name is required" }, { max: 160 }]}
        >
          <Input placeholder="North Star Bridal LLC" onChange={onNameChange} maxLength={160} />
        </Form.Item>
        <Form.Item
          name="slug"
          label="Company key"
          tooltip="Used in the address bar and as the name of this company's database schema. It cannot be changed later."
          rules={[
            { required: true, message: "A company key is required" },
            {
              pattern: /^[a-z][a-z0-9_]{1,40}$/,
              message: "Lower case letters, digits and underscores, starting with a letter",
            },
            {
              validator: async (_rule, value: string) =>
                existingSlugs.includes(value)
                  ? Promise.reject(new Error("Another company already uses that key"))
                  : Promise.resolve(),
            },
          ]}
        >
          <Input placeholder="north_star" maxLength={41} />
        </Form.Item>
        <Form.Item name="display_order" label="Order in the company list">
          <InputNumber min={0} max={1000} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="is_sample" label="Mark as a sample company" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Typography.Text type="secondary">
          You will be its first administrator.
        </Typography.Text>
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 7: Offer the button from the switcher**

In `ctyhp-accounting/components/CompanySwitcher.tsx`:

- Add `canCreateCompany: boolean` to the props.
- Import `Link` from `next/link` and `PlusOutlined` from `@ant-design/icons`.
- In the single-company branch, render the link beside the label when
  `canCreateCompany` is true.
- Give the `Select` a popup footer:

```tsx
      popupRender={(menu) => (
        <>
          {menu}
          {canCreateCompany ? (
            <>
              <Divider style={{ margin: "4px 0" }} />
              <div style={{ padding: "4px 8px 8px" }}>
                <Link href="/settings/companies?new=1">
                  <PlusOutlined /> New company
                </Link>
              </div>
            </>
          ) : null}
        </>
      )}
```

Import `Divider` from `antd` alongside the existing imports.

- [ ] **Step 8: Pass the flag down**

In `ctyhp-accounting/components/AppShell.tsx`, add `canCreateCompany: boolean` to the
props and forward it:

```tsx
            <CompanySwitcher
              active={activeCompany}
              options={companyOptions}
              canCreateCompany={canCreateCompany}
            />
```

In `ctyhp-accounting/app/(app)/layout.tsx`, import `isPlatformAdmin` alongside
`resolveActiveCompany`, resolve it in the existing `Promise.all` (or as its own
`await` beside the others), and pass `canCreateCompany={canCreateCompany}` to
`AppShell`.

- [ ] **Step 9: Run the tests, typecheck and targeted lint**

Run:

```bash
npm test -- tests/unit/company-provisioning-ui-contract.test.ts tests/unit/navigation.test.ts tests/unit/rsc-antd.test.ts
npm run typecheck
npx eslint 'app/(app)/settings/companies/*.tsx' 'app/(app)/settings/companies/actions.ts' components/CompanySwitcher.tsx components/AppShell.tsx
```

Expected: all pass with zero errors. If eslint reports
`react-hooks/set-state-in-effect`, move the `setState` into the async callback
inside the effect rather than adding a disable comment.

- [ ] **Step 10: Commit**

```bash
git add 'ctyhp-accounting/app/(app)/settings/companies' ctyhp-accounting/lib/domain/navigation.ts ctyhp-accounting/components/CompanySwitcher.tsx ctyhp-accounting/components/AppShell.tsx 'ctyhp-accounting/app/(app)/layout.tsx' ctyhp-accounting/tests/unit/company-provisioning-ui-contract.test.ts
git commit -m "Put New company where a company is chosen, and show what it is doing"
```

---

### Task 8: Prove it against a real database, then ship

**Files:**
- Create: `ctyhp-accounting/scripts/verify-company-provisioning.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes: migration 0097 and the provisioning core.
- Produces: `npm run verify:company-provisioning`, which builds a real company inside a transaction and rolls it back.

- [ ] **Step 1: Add the package script**

In `ctyhp-accounting/package.json`, beside the other verifiers:

```json
"verify:company-provisioning": "node --env-file=.env.local scripts/verify-company-provisioning.mjs",
```

- [ ] **Step 2: Write the rollback-only harness**

Create `ctyhp-accounting/scripts/verify-company-provisioning.mjs`:

```js
/**
 * Behavioural verification of company provisioning.
 *
 * A real company is built — schema, 96 migrations, grants, register row, the
 * PostgREST exposure — inside ONE transaction that is always rolled back. That
 * is the only honest way to test this: a provisioning that "looks right" and
 * has never run is exactly the failure the self-check exists to catch.
 *
 * Run: node --env-file=.env.local scripts/verify-company-provisioning.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadMigrationSources } from "../lib/db/migration-sources.ts";
import { provisionCompany } from "../lib/services/company-provisioning.ts";

/** The project root, resolved the way that works on Windows too. */
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const SLUG = "verify_probe";
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    new URL("../supabase/migrations/0097_company_provisioning_requests.sql", import.meta.url),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0097 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  const sources = loadMigrationSources(projectRoot);
  console.log(`Replaying ${sources.length} migrations into co_${SLUG}…`);

  const started = Date.now();
  const result = await provisionCompany(
    client,
    {
      slug: SLUG,
      legalName: "Verify Probe Inc.",
      isSample: true,
      displayOrder: 999,
      adminUserIds: admin ? [admin.id] : [],
    },
    sources,
  );
  console.log(`Built in ${Math.round((Date.now() - started) / 1000)}s.`);

  const reference = await one(
    `select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  check("every table public has was built", result.tableCount >= reference.n, `${result.tableCount} vs ${reference.n}`);
  check("functions were built", result.functionCount > 300, String(result.functionCount));
  check("row-level security came with them", result.policyCount > 100, String(result.policyCount));

  const registered = await one(`select slug, schema_name, status from onebook.company where slug = $1`, [SLUG]);
  check("the company is in the register", registered?.schema_name === `co_${SLUG}`);
  check("it is active", registered?.status === "active");

  const migrations = await one(`select count(*)::int as n from co_${SLUG}.acc_schema_migrations`);
  check("its migration history is complete", migrations.n === sources.length, `${migrations.n}/${sources.length}`);

  const exposed = await one(
    `select setconfig::text as config from pg_db_role_setting s
       join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator'`,
  );
  check("PostgREST was told about it", /co_verify_probe/.test(exposed?.config ?? ""), exposed?.config ?? "none");

  if (admin) {
    const member = await one(
      `select 1 as ok from onebook.company_member m
         join onebook.company c on c.id = m.company_id
        where c.slug = $1 and m.user_id = $2`,
      [SLUG, admin.id],
    );
    check("the requester is a member", Boolean(member));
    const inside = await one(`select role, status from co_${SLUG}.acc_app_user where id = $1`, [admin.id]);
    check("and an administrator inside it", inside?.role === "admin" && inside?.status === "active");
  }

  const anonGrants = await one(
    `select count(*)::int as n from information_schema.role_table_grants
      where table_schema = $1 and grantee = 'anon'`,
    [`co_${SLUG}`],
  );
  check("anon was given nothing", anonGrants.n === 0, String(anonGrants.n));
} catch (error) {
  failed += 1;
  console.log(`  FAIL  provisioning threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — the probe company never existed.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 3: Static safety check, then run it**

Run:

```bash
grep -niE "^[^/*]*\bcommit\b" scripts/verify-company-provisioning.mjs
npm run security:check-source
npm run verify:company-provisioning
```

Expected: the grep prints nothing, the credential check passes, every assertion
prints PASS, the final line confirms `ROLLBACK`, and `0 failed`. If the script
cannot connect, stop and report it rather than skipping the verification.

- [ ] **Step 4: Run every project gate**

Run, recording real output:

```bash
npm test
npm run typecheck
npm run lint
npm run security:check-source
npm run build
```

Expected: all tests pass, typecheck and the credential check clean, lint zero
errors with only the pre-existing `scripts/verify-*.mjs` warnings, build exits 0
with `/settings/companies` and `/api/companies/provision` in the route list.

- [ ] **Step 5: Smoke the built server**

Start the built server, then run:

```bash
node --env-file=.env.local scripts/smoke-pages.mjs http://127.0.0.1:3000
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3000/api/companies/provision
curl -s -X POST -H "authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/companies/provision
```

Expected: every page 200 including `/settings/companies`; the unauthenticated
POST returns 401; the authorized POST returns `{"processed":0,"migrationFileCount":96,…}`
— which proves the route can read the migration files without creating anything.
Stop the server afterwards.

- [ ] **Step 6: Apply the migration to every company**

Run: `node --env-file=.env.local scripts/migrate.mjs`

Expected: `0097_company_provisioning_requests.sql ... ok` for `public`, and the
company schemas report it applied with no objects created in them (the whole file
is held back as global). Then confirm the register objects exist exactly once:

```bash
node --env-file=.env.local -e "
import('pg').then(async ({default: pg}) => {
  const c = new pg.Client({connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
  await c.connect();
  const r = await c.query(\"select (select count(*) from onebook.platform_admin) as admins, (select count(*) from onebook.company_request) as requests, (select count(*) from information_schema.tables where table_name in ('platform_admin','company_request')) as copies\");
  console.log(r.rows[0]);
  await c.end();
});"
```

Expected: `admins` is at least 1, `requests` is 0, and `copies` is exactly 2 —
the register objects exist once, not once per company schema.

- [ ] **Step 7: Review the diff and commit**

Run:

```bash
git diff --check
git status --short
git log --oneline -9
```

Confirm only planned files changed and `.claude/settings.json` is untouched, then:

```bash
git add ctyhp-accounting/scripts/verify-company-provisioning.mjs ctyhp-accounting/package.json
git commit -m "Build a real company, check it, and roll it back"
```

- [ ] **Step 8: Report what the deployment still needs**

The feature is not usable in production until `SUPABASE_DB_URL` exists in the
Vercel project's environment. State this explicitly in the completion report,
along with the fact that until it is set the screen reports "This deployment has
no database connection string, so it cannot create a company" on the request row
rather than failing silently.
