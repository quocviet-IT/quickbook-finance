# E1 — Health check

Date: 2026-08-11
Status: design approved, awaiting implementation plan

## 1. Purpose

Nothing in One Book reports whether the application is working. When it breaks,
the first anyone knows is a member of staff picking up the phone.

This adds two things: a machine-readable endpoint for an external uptime monitor
to poll, and a page a person can open to see whether the problem is the
application or their own connection.

## 2. What "alive" has to mean here

On Vercel the process does not meaningfully die — each request spins up a
function. What actually breaks is Supabase becoming unreachable, an expired or
missing environment variable, or a migration left half-applied.

So a check that only answers "did the server respond" would return 200 while the
application is unusable. That is worse than no check: it manufactures confidence.
The check therefore has to reach the database and the configuration.

## 3. Verified before designing, not assumed

The obvious probe — call the PostgREST root with the anon key — does not work.
Measured against the live project:

| Surface | Anon key result |
|---|---|
| `GET /auth/v1/health` | **200** |
| `GET /rest/v1/` (root) | **401** — "Only secret API keys can be used for this endpoint" |
| `GET /rest/v1/<table>` | **401** with Postgres error `42501` |
| Unreachable host | **HTTP 000** (connection failure, distinct from any HTTP reply) |

The anon role is revoked systematically — 28 migrations do it — so it can read no
table. A design written from the obvious assumption would have reported the
database as down permanently.

`/auth/v1/health` also returns the GoTrue version in its body. This endpoint
reads the status code and discards the body; it does not forward it.

## 4. The three checks

| Name | Probe | Passes when |
|---|---|---|
| `database` | Call `onebook.health()` through PostgREST with the anon key | HTTP 200 and the body is `ok` |
| `authentication` | `GET {url}/auth/v1/health` | HTTP 200 |
| `configuration` | `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are present and are not placeholders | both hold |

"Placeholder" is not left to judgement. A value fails if it is empty, if it still
carries the wording shipped in `.env.local.example` (`YOUR-PROJECT-REF`,
`your-anon-key`), or if it begins with `REPLACE` — the same test
`isAdminClientConfigured()` in `lib/db/admin.ts` already applies to the service
key. The URL must additionally parse as a URL, because a malformed one fails
every probe with an error that looks like an outage.

These three and no more, because they are the conditions for anyone to do
anything at all. Plaid, the AI assistant and the document scanner can each fail
without stopping the books. Including them would turn the check red while
bookkeeping carries on normally, and an alarm that cries wolf a few times is an
alarm nobody reads.

## 5. Migration 0112

```sql
-- Migration 0081 granted schema usage to authenticated and service_role only,
-- so execute on the function alone is not enough: without usage on the schema
-- the call fails with "permission denied for schema onebook" before it ever
-- reaches the function. Verified against the live project.
grant usage on schema onebook to anon;

create or replace function onebook.health() returns text
language sql stable as $$ select 'ok' $$;
revoke all on function onebook.health() from public;
grant execute on function onebook.health() to anon, authenticated, service_role;
```

Granting `anon` usage on the schema is wider than granting execute on one
function, so it is worth being precise about what it does and does not open.
Usage lets a role *reference* objects in a schema; every object still needs its
own grant. Migration 0081 revokes all on `onebook.company` and
`onebook.company_member` from `anon`, and sets default privileges in the schema
to revoke tables and functions from `anon`. So after this migration `anon` can
reach exactly one function that takes no argument and returns a constant, and
nothing else. The migration test asserts those revokes are still in place.

It lives in `onebook` for two reasons. This is a question about the system rather
than about any one company's books; and `scopeOf()` in
`lib/domain/schema-template.ts` classifies any statement naming `onebook.` as
global, so it is not replayed into each company schema.

Granting execute to `anon` is deliberate and is the narrowest thing that answers
the question. The function takes no argument, touches no table, and returns a
constant.

### Why not the alternatives

**Reading a table as anon and treating the Postgres permission error as proof of
life.** It needs no migration, but it means calling a 401 healthy, which is
confusing to explain and breaks the moment Supabase changes the shape of that
error.

**Using the service role in the request handler.** `lib/db/admin.ts` states that
the service role exists for one job — creating users through the Auth admin API —
and must never read or write accounting data. Putting it behind a public,
unauthenticated endpoint is exactly the erosion that rule prevents.

## 6. Public contract

```json
{
  "status": "ok",
  "checkedAt": "2026-08-11T15:00:00.000Z",
  "checks": [
    { "name": "database",       "status": "ok" },
    { "name": "authentication", "status": "ok" },
    { "name": "configuration",  "status": "ok" }
  ]
}
```

- **HTTP 200** when all three pass, **HTTP 503** when any fails. Uptime monitors
  key off the status code by default, not the body.
- Two overall states only, `ok` and `down`. Any one of these three failing makes
  the application unusable, so a middle state would be a distinction without a
  difference.
- No error messages, no host names, no versions, no timings. Detail goes to the
  server log; only the component name and its verdict cross the wire.

Both the endpoint and the page are readable without signing in. That is the
point: a status page behind the session check is unreachable in the one
situation it exists for.

## 7. Two protections on the endpoint itself

**A five-second timeout per probe, run in parallel.** Without one, a hung
Supabase hangs the endpoint, and the function burns its whole duration waiting
for an answer that never arrives.

**A ten-second cache.** This is a public endpoint that makes two outbound calls
per request — a small amplifier. The cache caps a flood at one probe per ten
seconds.

The cache holds a failure exactly as it holds a success. Caching only the good
answer would let a flood arriving during an outage bypass the cap entirely,
which is the worst moment to remove it. The cost is that recovery can take up to
ten seconds to show, which no monitor polling at thirty seconds or more will
notice.

Stated plainly: on serverless each instance holds its own cache, so this bounds
abuse rather than acting as a shared cache.

## 8. The proxy change

`proxy.ts` today builds a Supabase client and calls `getUser()` for every path
outside `/api/`. Routing `/status` through that would make the page depend on
authentication — failing exactly when authentication is the broken part.

So `/status` skips the session entirely, as `/api/` already does:

```ts
export function skipsSession(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname === "/status";
}
```

**A trap worth naming.** The obvious edit is to collect `/login` and `/status`
into one "public paths" set and use it in both branches. That breaks the page:
the second branch bounces *signed-in* users away from `/login` to `/dashboard`,
so sharing the set would bounce them off `/status` too — meaning every member of
staff actually at work could not open it. That branch must keep testing `/login`
alone.

## 9. Where the page lives

`app/status/page.tsx`, a single Client Component, following the precedent of
`app/(auth)/login/page.tsx`.

It sits outside the `(app)` route group on purpose, so it does not get AppShell —
which reads the company list from the database. The root layout carries only the
Ant Design registry and the theme and touches no data, so the page renders even
when the database is completely unreachable. That is a precondition, not a
detail.

The page calls `/api/health`, draws one row per check, and offers a manual
re-check. It does not poll on a timer: that would have the page hammer its own
endpoint for no benefit.

## 10. File layout

| File | Responsibility |
|---|---|
| `supabase/migrations/0112_health_probe.sql` (create) | The `onebook.health()` function and its grants |
| `lib/domain/health.ts` (create) | Pure: check names, the overall verdict, the HTTP status, the payload shape |
| `lib/services/health.ts` (create) | Runs the probes with their timeouts and the cache |
| `app/api/health/route.ts` (create) | The public JSON endpoint |
| `app/status/page.tsx` (create) | The page a person opens |
| `proxy.ts` (modify) | `skipsSession`, exported so it can be tested |
| `tests/unit/health.test.ts` (create) | The verdict rules and the payload shape |
| `tests/unit/health-migration.test.ts` (create) | The migration's grants and its global scope |
| `tests/unit/proxy-public-routes.test.ts` (create) | The first test `proxy.ts` has ever had |

## 11. Testing

**`tests/unit/health.test.ts`** — pure, no network:

| Assertion | What it catches |
|---|---|
| All three pass → `ok`, HTTP 200 | |
| Each position failing on its own → `down`, HTTP 503 | A check that only notices the first failure |
| The serialised body carries exactly the permitted keys | Someone later adding `error: e.message` and leaking detail into a public response |

The third is the one that earns its place: it turns "minimal detail" from a
promise into something a machine keeps.

**`tests/unit/health-migration.test.ts`** — follows the five existing
`*-migration.test.ts` files. Asserts the migration creates `onebook.health`,
revokes from `public` before granting to `anon`, and — running the real
`scopeOf()` — that it is classified global and so is never replayed per company.

**`tests/unit/proxy-public-routes.test.ts`** — `proxy.ts` has never had a test,
and this change touches the gate that decides who reaches what. Asserts `/status`
and `/api/…` skip the session while `/invoices` does not, and that the
redirect-to-dashboard branch still keys on `/login` alone.

**Real verification:** request `/status` and `/api/health` against the built
server **while signed out**. `scripts/smoke-pages.mjs` cannot stand in for this —
it signs in first, and what needs proving here is the opposite.

## 12. Not in scope

**Alerting.** An endpoint cannot page anyone. Something outside the deployment
has to poll it and raise the alarm, because a Vercel cron cannot detect its own
deployment being down — if the app is dead, so is the cron. Wiring an external
monitor (UptimeRobot, Better Stack, Vercel Monitoring) to this endpoint is a
manual step outside this repository.

**Per-company health.** This reports whether the system is up, not whether one
company's schema is intact. `acc_control_reconciliation` and
`acc_gl_posting_report` already answer that question, per company, for people who
are signed in.

**History.** No uptime record is kept. The page reports now. An external monitor
is what keeps history, and it keeps a better one than this could.

## 12b. One thing whoever operates this has to know

`NEXT_PUBLIC_SUPABASE_URL` is inlined into the bundle **at build time**, not read
at runtime. Measured during verification: changing the environment variable and
restarting the server left the check reporting `ok` against a host that does not
exist, with a fresh `checkedAt` — it really did probe again, just at the old
address. Only a rebuild changed the answer.

The consequence is narrow but sharp: **change the Supabase URL in Vercel without
redeploying, and this check will keep probing the old project and keep saying
everything is fine.** The check is honest about the deployment it was built for,
and silent about a configuration change made after it.

This is how `NEXT_PUBLIC_*` works in Next.js rather than a defect in the check,
and reading the value at runtime instead would mean not using a `NEXT_PUBLIC_`
variable for it. Recorded so nobody discovers it during an incident.

## 13. An incidental finding, recorded rather than fixed

Asking PostgREST for a schema that does not exist, using only the anon key,
returns this:

```
PGRST106  Invalid schema: <whatever was asked for>
hint: Only the following schemas are exposed:
      co_cascade_metals, co_harbor_gems, co_north_star, co_pc_49, onebook, public
```

That is every company's schema name handed to an unauthenticated caller — and a
schema name here is a customer name (`co_pc_49` is Pacific Four Nine). Reading
any table with the same key leaks one of them the same way, through
`permission denied for schema co_cascade_metals`.

The anon key ships in the browser bundle and this repository is public, so
reproducing it needs nothing but a terminal. No data is exposed — every table and
function stays revoked — but the customer list is.

This predates the health check and is outside its scope. It is recorded here
because it was found while verifying this design, and it deserves its own piece
of work: the fix is to narrow PostgREST's exposed-schema list, which is a
Supabase project setting rather than a migration, and to check what the
application actually needs exposed before narrowing it.
