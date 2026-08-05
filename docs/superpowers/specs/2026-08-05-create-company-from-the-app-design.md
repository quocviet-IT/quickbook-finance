# Creating a company from the app — design

Date: 2026-08-05

## Goal

Let a platform administrator add a company from One Book itself. Today the only
way is `node scripts/provision-company.ts` on a machine that holds the database
connection string, which means a customer cannot start a second set of books
without a developer.

## What creating a company actually costs

This is not a row in a table. Migration 0081 made a company *a Postgres schema*,
so creating one means:

1. `create schema co_<slug>` — DDL.
2. Replaying 96 migration files into it — **1053 statements** after
   `planCompanySchema()` rewrites every `set search_path = public` and holds back
   the 25 statements that belong to the database rather than to a company.
3. Grants for `authenticated` and `service_role`, and a revoke for `anon`.
4. Recording all 96 filenames in the new `acc_schema_migrations` so the next
   `scripts/migrate.mjs` run knows what this company already has.
5. Registering it in `onebook.company`, and granting the creator membership.
6. `alter role authenticator set pgrst.db_schemas = …` plus `notify pgrst,
   'reload config'` **and** `'reload schema'`. Skip this and the company exists,
   the user is a member, and every request answers "schema must be one of the
   following". It is the step that looks optional and is not.

Steps 1 and 6 are beyond what a PostgREST client can do at all. They need a
direct Postgres connection.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Who may create? | A new `onebook.platform_admin` list | Creating a tenant is the system owner's act, not an accountant's. A company admin should not be able to grow the database. |
| Where does DDL power live? | The web tier gets `SUPABASE_DB_URL` | The alternative — porting `schema-template.ts`'s search_path rewriting into PL/pgSQL — puts a silent cross-company data leak one regex mistake away. The rewriting stays in the tested TypeScript that already built three companies. |
| Synchronous or queued? | Queued, with visible status | 1053 statements take tens of seconds. A request row survives a closed tab and keeps the failure message where someone can read it. |
| Sample data? | No | A new company starts with what the migrations seed, the same as `public` did. Importing real books is what `/settings/import` is for. |
| Delete or archive a company? | Out of scope | Stated so nobody adds it to this slice. |

## Architecture

### The register gains a queue (migration 0097)

Everything lives in `onebook`, so `scopeOf()` holds the whole migration back
from company schemas — the register must exist once, not once per company.

- `onebook.platform_admin (user_id, added_at, added_by)`, seeded from
  `public.acc_app_user` where the role is `admin` and the status is `active`.
  If that finds nobody the table stays empty and the button never appears —
  correct, not broken. The recovery is one `insert` run with the service role,
  which the migration's comment spells out.
- `onebook.is_platform_admin()` — the single gate, used by RLS and by every RPC.
- `onebook.company_request` — `slug`, `legal_name`, `is_sample`,
  `display_order`, `requested_by`, `status` (`pending` → `running` → `ready` |
  `failed`), `attempts`, `error`, `company_id`, timestamps.
- RPCs: `request_company()` validates the slug and refuses one already taken by
  a company **or by a request that has not finished**; `claim_company_request()`
  takes the oldest pending row `for update skip locked`, so two clicks cannot
  provision twice; `complete_company_request()` and `fail_company_request()`
  close it; `retry_company_request()` puts a failed row back to pending.

### One provisioning core, two callers

`lib/services/company-provisioning.ts` holds the logic currently inlined in
`scripts/provision-company.ts`:

```ts
provisionCompany(client: pg.Client, input: ProvisionCompanyInput,
                 sources: readonly MigrationSource[]): Promise<ProvisionCompanyResult>
```

It takes the client rather than opening one. That is what lets the verification
script run a real provisioning inside a transaction it rolls back, and it keeps
the CLI working unchanged from the caller's point of view. The module carries no
`server-only` marker, because the CLI imports it under plain Node.

Two changes to the logic as it stands:

- **Batching.** Statements are sent in groups of 50 in a single round trip
  rather than 1053 separate ones. On a batch failure the batch is replayed one
  statement at a time so the error still names the exact statement. This is what
  keeps provisioning inside a serverless time limit.
- **Self-check preserved.** The comparison of tables, functions and policies
  against `public` stays, and a missing object still fails the whole run. A
  company with three quarters of a ledger and no error is the outcome this
  guards against.

`runPendingCompanyProvisioning()` sits above it: open a client, claim one
request, provision, mark it ready or failed with the message, close.

### When it runs

The Server Action inserts the request and then calls
`after(() => runPendingCompanyProvisioning())`. Next 16's `after` runs work once
the response is sent, in the same invocation — no self-fetch, no absolute URL,
no second secret. Both `/settings/companies` and `/api/companies/provision`
declare `maxDuration = 300`, because the work outlives the response it was
scheduled from. `/api/companies/provision` runs the same function behind
`CRON_SECRET` as the safety net for anything left pending and as the retry path.

### Interface

- The company switcher gains `+ New company` at the foot of its popup, for
  platform admins only. It navigates to `/settings/companies?new=1` rather than
  opening a form inside a dropdown — one place owns the form, the list and the
  failures.
- `/settings/companies` lists the register with each company's slug, schema and
  sample flag, shows any request that is pending, running or failed with its
  error and a Try again button, and holds the New company modal.
- The Settings hub gains a Companies card.
- After a request reaches `ready`, the page switches to the new company and
  reloads, so the creator lands inside the books they just made.

## Error handling

A failed provisioning rolls back in the database — the schema, the register row
and the membership are one transaction — and the request row keeps the message.
Nothing half-built survives, which is why retry is safe to offer as a button.

Two failures deserve their own words rather than a raw Postgres message: a slug
already registered, and a missing `SUPABASE_DB_URL` (the deployment was never
given the connection string). Everything else surfaces verbatim.

## Testing

- Unit: slug derivation and validation; the request state machine; the
  provisioning core against a fake client, asserting the order of operations and
  that a failing batch is replayed to name the statement; migration 0097's
  global-only scope; action authorization; UI contract and the 400-line ceiling.
- Behavioural, rollback-only: `scripts/verify-company-provisioning.mjs` opens a
  transaction, applies 0097, provisions a real company, compares its inventory
  with `public`, checks `pgrst.db_schemas` now names it, checks `my_companies`
  returns it for the requester, and rolls back.
- Route: the built server answers `/api/companies/provision` with the migration
  file count and `processed: 0` when nothing is pending, which proves the 96
  files were bundled into the serverless function without creating anything.

## Deployment steps this design cannot perform

- `SUPABASE_DB_URL` must be added to the Vercel project's environment. Until it
  is, the feature reports that the deployment has no database connection string
  rather than failing obscurely.
- `next.config.ts` gains `outputFileTracingIncludes` for
  `supabase/migrations/**` so the migration files exist in the deployed
  function; the route's file count is what proves it worked.
