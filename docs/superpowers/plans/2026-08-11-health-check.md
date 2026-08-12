# E1 Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give One Book a public endpoint an uptime monitor can poll and a page a person can open, both answering "is the application actually usable" rather than "did the server respond".

**Architecture:** Three checks — database, authentication, configuration. The verdict rules are pure and live in `lib/domain/health.ts`; the probes live in `lib/services/health.ts` and take their `fetch` and clock as injected dependencies so they are unit-testable without a network. The database probe calls a new `onebook.health()` function granted to `anon`, which is the narrowest thing that proves Postgres executed a statement without putting the service role on a public request path.

**Tech Stack:** TypeScript 5, Vitest 4 (`environment: "node"`), Next.js 16 Route Handlers, Supabase PostgREST and GoTrue.

## Global Constraints

- The working directory is `ctyhp-accounting/`. Every path below is relative to it, except `proxy.ts` which sits at that same root.
- User-facing prose is US English. Code, identifiers, comments and documentation are English.
- Comments explain **why**, in the prose style the codebase already uses.
- Never swallow an error. Detail belongs in the server log; only the verdict crosses the wire.
- Four mandatory gates before declaring done: `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- No Claude/AI attribution in commit messages.
- No force-push.
- A Server Component must never read an Ant Design sub-component (`Typography.Title`, `Form.Item`, …). The status page is a Client Component, so this does not constrain it — but do not remove its `"use client"` directive.

## Facts verified against the live project before this plan was written

Do not re-derive these; they were measured, and two of them overturned the obvious design.

| Probe with the anon key | Result |
|---|---|
| `GET /auth/v1/health` | 200 |
| `GET /rest/v1/` (root) | 401 — "Only secret API keys can be used for this endpoint" |
| `POST /rest/v1/rpc/my_companies` with `Content-Profile: onebook` | 401, Postgres code `42501`, "permission denied for schema onebook" |
| Unreachable host | HTTP 000, a connection failure distinct from any HTTP reply |

Two consequences:

1. **`onebook` is exposed by PostgREST.** The failure above is a *permission* error, not a schema error, so the design works.
2. **`anon` has no USAGE on the schema.** Migration 0081 granted usage to `authenticated, service_role` only. Granting execute on the function alone would still fail before reaching it.

## File Structure

| File | Responsibility |
|---|---|
| `lib/domain/health.ts` (create) | Pure: the check names, the overall verdict, the HTTP status, the payload shape, and the placeholder rule |
| `lib/domain/public-routes.ts` (create) | Pure: which paths skip the session. Separate from `proxy.ts` so a test can import it without loading `next/server` |
| `lib/services/health.ts` (create) | Runs the two network probes with timeouts, and the cache |
| `supabase/migrations/0112_health_probe.sql` (create) | `onebook.health()` and its grants |
| `app/api/health/route.ts` (create) | The public JSON endpoint |
| `app/status/page.tsx` (create) | The page a person opens |
| `proxy.ts` (modify) | Calls `skipsSession` instead of testing `/api/` inline |
| `tests/unit/health.test.ts` (create) | Verdict rules, placeholder rule, payload shape |
| `tests/unit/health-probe.test.ts` (create) | The probes, with an injected fetch |
| `tests/unit/health-migration.test.ts` (create) | The migration's grants and its global scope |
| `tests/unit/public-routes.test.ts` (create) | Which paths skip the session, and the `/login` trap |

`skipsSession` lives in `lib/domain/public-routes.ts` rather than in `proxy.ts` for a practical reason: `proxy.ts` imports `next/server` and `@supabase/ssr` at module load, and a unit test that imports it would drag both into a `node` environment for the sake of one pure predicate.

**Two deliberate deviations from the spec's file list (§10).** The spec put
`skipsSession` in `proxy.ts` and named its test `proxy-public-routes.test.ts`.
This plan extracts the predicate into `lib/domain/public-routes.ts` for the
reason above, and names the test after the module it tests. The spec also listed
one health test file; this plan splits it in two — `health.test.ts` for the pure
rules and `health-probe.test.ts` for the probes — because they need different
setups and merging them would hide which one failed. No behaviour differs from
the spec; the boundaries are drawn one level finer.

---

### Task 1: The verdict rules

**Files:**
- Create: `lib/domain/health.ts`
- Test: `tests/unit/health.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `HEALTH_CHECKS: readonly ["database", "authentication", "configuration"]`
  - `type HealthCheckName`, `type CheckStatus = "ok" | "fail"`, `type OverallStatus = "ok" | "down"`
  - `interface CheckResult { name: HealthCheckName; status: CheckStatus }`
  - `interface HealthPayload { status: OverallStatus; checkedAt: string; checks: CheckResult[] }`
  - `overallStatus(results: readonly CheckResult[]): OverallStatus`
  - `httpStatusFor(status: OverallStatus): 200 | 503`
  - `buildPayload(results: readonly CheckResult[], checkedAt: string): HealthPayload`
  - `isPlaceholder(value: string | undefined): boolean`
  - `checkConfiguration(env: { url?: string; anonKey?: string }): CheckResult`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  HEALTH_CHECKS,
  buildPayload,
  checkConfiguration,
  httpStatusFor,
  isPlaceholder,
  overallStatus,
  type CheckResult,
} from "@/lib/domain/health";

const allOk: CheckResult[] = HEALTH_CHECKS.map((name) => ({ name, status: "ok" as const }));

describe("overall status", () => {
  it("is ok only when every check passes", () => {
    expect(overallStatus(allOk)).toBe("ok");
  });

  it("is down when any one check fails, wherever it sits", () => {
    // Looped rather than written once: a verdict that only notices the first
    // failure passes a single-case test and reports an outage as healthy.
    for (const failing of HEALTH_CHECKS) {
      const results = allOk.map((r) => (r.name === failing ? { ...r, status: "fail" as const } : r));
      expect(overallStatus(results), failing).toBe("down");
    }
  });

  it("is down when there are no results at all", () => {
    // An empty list means the probes never ran. "Everything passed" is the one
    // reading that must not be available here.
    expect(overallStatus([])).toBe("down");
  });
});

describe("http status", () => {
  it("answers 200 when up and 503 when down", () => {
    expect(httpStatusFor("ok")).toBe(200);
    expect(httpStatusFor("down")).toBe(503);
  });
});

describe("the payload", () => {
  it("carries exactly the permitted keys and nothing else", () => {
    // This is the guard that keeps "minimal detail" true. Someone adding
    // `error: e.message` later would leak internals to an unauthenticated
    // caller, and this fails before that reaches production.
    const payload = buildPayload(allOk, "2026-08-11T15:00:00.000Z");
    expect(Object.keys(payload).sort()).toEqual(["checkedAt", "checks", "status"]);
    for (const check of payload.checks) {
      expect(Object.keys(check).sort()).toEqual(["name", "status"]);
    }
  });

  it("reports the time it was checked", () => {
    expect(buildPayload(allOk, "2026-08-11T15:00:00.000Z").checkedAt).toBe(
      "2026-08-11T15:00:00.000Z",
    );
  });
});

describe("the placeholder rule", () => {
  it("rejects an empty value, the shipped example wording, and REPLACE", () => {
    for (const value of [
      undefined,
      "",
      "   ",
      "https://YOUR-PROJECT-REF.supabase.co",
      "your-anon-key",
      "REPLACE-with-a-real-key",
    ]) {
      expect(isPlaceholder(value), String(value)).toBe(true);
    }
  });

  it("accepts a value that looks configured", () => {
    expect(isPlaceholder("https://abcdefg.supabase.co")).toBe(false);
  });
});

describe("the configuration check", () => {
  it("passes when both values are set and the URL parses", () => {
    expect(
      checkConfiguration({ url: "https://abcdefg.supabase.co", anonKey: "a-real-looking-key" }),
    ).toEqual({ name: "configuration", status: "ok" });
  });

  it("fails when either value is missing or still a placeholder", () => {
    expect(checkConfiguration({ url: "https://abcdefg.supabase.co" }).status).toBe("fail");
    expect(checkConfiguration({ anonKey: "a-real-looking-key" }).status).toBe("fail");
    expect(
      checkConfiguration({ url: "https://YOUR-PROJECT-REF.supabase.co", anonKey: "k" }).status,
    ).toBe("fail");
  });

  it("fails when the URL is set but malformed", () => {
    // A malformed URL breaks every probe with an error that reads exactly like
    // an outage. Naming it here turns a confusing hour into a glance.
    expect(checkConfiguration({ url: "not a url", anonKey: "a-real-looking-key" }).status).toBe(
      "fail",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/health.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/health'`

- [ ] **Step 3: Write the implementation**

Create `lib/domain/health.ts`:

```ts
/**
 * What "the application is up" means, and how the answer is shaped.
 *
 * Pure on purpose. Deciding a verdict from a set of results, and deciding what
 * an unauthenticated caller is allowed to be told, are rules — and rules belong
 * where a test can hold them to account rather than where a network sits in
 * the way.
 */

export const HEALTH_CHECKS = ["database", "authentication", "configuration"] as const;

export type HealthCheckName = (typeof HEALTH_CHECKS)[number];
export type CheckStatus = "ok" | "fail";
export type OverallStatus = "ok" | "down";

export interface CheckResult {
  name: HealthCheckName;
  status: CheckStatus;
}

export interface HealthPayload {
  status: OverallStatus;
  checkedAt: string;
  checks: CheckResult[];
}

/**
 * Up only when everything is up.
 *
 * There is no middle state, because there is no middle reality: the database,
 * the sign-in service and the configuration are each a condition for anyone to
 * do anything at all. An empty list reads as down — it means the probes never
 * ran, and "no news is good news" is the wrong default for a health check.
 */
export function overallStatus(results: readonly CheckResult[]): OverallStatus {
  if (results.length === 0) return "down";
  return results.every((result) => result.status === "ok") ? "ok" : "down";
}

/** Monitors key off the status code, not the body, so the code has to be right. */
export function httpStatusFor(status: OverallStatus): 200 | 503 {
  return status === "ok" ? 200 : 503;
}

/**
 * The whole of what an unauthenticated caller is told.
 *
 * Built here rather than assembled at the route so there is one place that
 * decides what crosses the wire — and one place for a test to prove that no
 * error message, host name or version ever joins it.
 */
export function buildPayload(results: readonly CheckResult[], checkedAt: string): HealthPayload {
  return {
    status: overallStatus(results),
    checkedAt,
    checks: results.map(({ name, status }) => ({ name, status })),
  };
}

/**
 * A value that was never actually configured.
 *
 * Catches the wording shipped in .env.local.example as well as the REPLACE
 * prefix that lib/db/admin.ts already tests for, because a deployment carrying
 * either behaves as if the whole service were down and the reason is invisible.
 */
export function isPlaceholder(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return true;
  if (/^REPLACE/i.test(trimmed)) return true;
  return /YOUR-PROJECT-REF|your-anon-key/i.test(trimmed);
}

export function checkConfiguration(env: { url?: string; anonKey?: string }): CheckResult {
  const configured = !isPlaceholder(env.url) && !isPlaceholder(env.anonKey) && parses(env.url);
  return { name: "configuration", status: configured ? "ok" : "fail" };
}

function parses(url: string | undefined): boolean {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    // Not swallowed: a malformed URL is precisely the failure this reports.
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/health.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. Vitest only transpiles; it does not check types.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/health.ts tests/unit/health.test.ts
git commit -m "feat(health): decide what up means, and what may be said about it"
```

---

### Task 2: The database probe function

**Files:**
- Create: `supabase/migrations/0112_health_probe.sql`
- Test: `tests/unit/health-migration.test.ts`

**Interfaces:**
- Consumes: `planCompanySchema` from `@/lib/domain/schema-template` (existing)
- Produces: the SQL function `onebook.health()` returning `text`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/health-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0112_health_probe.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("health probe migration", () => {
  it("creates a function that takes nothing and returns a constant", () => {
    expect(sql).toMatch(/create or replace function onebook\.health\(\)\s+returns text/i);
    expect(sql).toMatch(/select 'ok'/i);
    // No table, no argument, nothing to parameterise: that is what makes it
    // safe to expose to an unauthenticated caller.
    expect(sql).not.toMatch(/\bfrom\s+(acc_|onebook\.)/i);
  });

  it("grants the schema usage anon did not have", () => {
    // Migration 0081 gave usage to authenticated and service_role only, so
    // execute on the function alone fails before reaching it.
    expect(sql).toMatch(/grant usage on schema onebook to anon/i);
  });

  it("revokes from public before granting to anon", () => {
    const revoke = sql.search(/revoke all on function onebook\.health\(\) from public/i);
    const grant = sql.search(/grant execute on function onebook\.health\(\)[^;]*anon/i);
    expect(revoke, "the revoke is missing").toBeGreaterThan(-1);
    expect(grant, "the grant is missing").toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(grant);
  });

  it("opens nothing else in the schema", () => {
    // Usage on the schema is wider than one function, so this pins the blast
    // radius: no table and no other function may be granted to anon here.
    expect(sql).not.toMatch(/grant[^;]*on\s+table[^;]*anon/i);
    expect(sql).not.toMatch(/grant[^;]*on\s+all\s+(tables|functions)[^;]*anon/i);
    expect(sql).not.toMatch(/onebook\.company/i);
  });

  it("is held back from company schemas, because the register is not per company", () => {
    // scopeOf() classifies any statement naming onebook. as global. Running the
    // real planner proves it rather than assuming it: replaying this per company
    // would keep rewriting one shared function.
    const plan = planCompanySchema([{ file, sql }], "co_example");
    expect(plan.statements).toEqual([]);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/health-migration.test.ts`
Expected: FAIL — `ENOENT` on `0112_health_probe.sql`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0112_health_probe.sql`:

```sql
-- ============================================================================
-- 0112 — Something an outside monitor can ask, that only Postgres can answer.
--
-- Nothing in this application reported whether it was working. The first anyone
-- knew of an outage was a member of staff picking up the phone.
--
-- A check that only proves the web server answered would report 200 while the
-- database was unreachable and nobody could do a thing — worse than no check,
-- because it manufactures confidence. So the check has to reach Postgres, and
-- reaching Postgres from an unauthenticated request needs something anon may
-- call.
--
-- This is that something, and it is deliberately the least it can be: no
-- argument to parameterise, no table to read, a constant to return. It proves
-- one fact — Postgres executed a statement — and can prove nothing else.
--
-- It lives in onebook because it answers a question about the system rather
-- than about any one company's books, and because scopeOf() holds anything
-- naming onebook. back from being replayed into every company schema.
-- ============================================================================

-- Migration 0081 granted schema usage to authenticated and service_role only.
-- Without usage, a call fails with "permission denied for schema onebook"
-- before it ever reaches the function, however the function is granted.
grant usage on schema onebook to anon;

create or replace function onebook.health() returns text
language sql stable as $$ select 'ok' $$;

-- Postgres grants execute on a new function to public by default. Revoking
-- first and granting explicitly keeps the list of who may call it readable.
revoke all on function onebook.health() from public;
grant execute on function onebook.health() to anon, authenticated, service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/health-migration.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0112_health_probe.sql tests/unit/health-migration.test.ts
git commit -m "feat(health): add a probe only Postgres can answer"
```

Do **not** apply the migration yet. Task 7 applies it, once there is something to verify it against.

---

### Task 3: The probes

**Files:**
- Create: `lib/services/health.ts`
- Test: `tests/unit/health-probe.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `HealthPayload`, `buildPayload`, `checkConfiguration` from `@/lib/domain/health` (Task 1)
- Produces:
  - `interface HealthDeps { fetch: typeof globalThis.fetch; now: () => Date; url?: string; anonKey?: string }`
  - `probeHealth(deps: HealthDeps): Promise<HealthPayload>`
  - `cachedHealth(): Promise<HealthPayload>`
  - `PROBE_TIMEOUT_MS = 5000`, `CACHE_TTL_MS = 10000`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/health-probe.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { probeHealth, type HealthDeps } from "@/lib/services/health";

const CONFIGURED = {
  url: "https://abcdefg.supabase.co",
  anonKey: "a-real-looking-key",
};

function deps(fetchImpl: HealthDeps["fetch"]): HealthDeps {
  return { ...CONFIGURED, fetch: fetchImpl, now: () => new Date("2026-08-11T15:00:00.000Z") };
}

function respond(status: number, body = ""): Response {
  return new Response(body, { status });
}

function statusOf(payload: Awaited<ReturnType<typeof probeHealth>>, name: string) {
  return payload.checks.find((check) => check.name === name)?.status;
}

describe("probing health", () => {
  it("is ok when the rpc returns ok and auth answers", async () => {
    const payload = await probeHealth(
      deps(async (input) =>
        String(input).includes("/rpc/health") ? respond(200, '"ok"') : respond(200),
      ),
    );
    expect(payload.status).toBe("ok");
    expect(payload.checkedAt).toBe("2026-08-11T15:00:00.000Z");
  });

  it("calls the rpc through the onebook schema, with the key on both headers", async () => {
    // PostgREST rejects the anon key on `apikey` alone, and the function lives
    // in onebook rather than public — both were measured against the live
    // project, and getting either wrong reports a permanent outage.
    const seen: Request[] = [];
    await probeHealth(
      deps(async (input, init) => {
        seen.push(new Request(String(input), init));
        return String(input).includes("/rpc/health") ? respond(200, '"ok"') : respond(200);
      }),
    );
    const rpc = seen.find((request) => request.url.includes("/rpc/health"));
    expect(rpc, "the rpc was never called").toBeDefined();
    expect(rpc!.headers.get("apikey")).toBe(CONFIGURED.anonKey);
    expect(rpc!.headers.get("authorization")).toBe(`Bearer ${CONFIGURED.anonKey}`);
    expect(rpc!.headers.get("content-profile")).toBe("onebook");
  });

  it("fails the database check when the rpc answers with anything else", async () => {
    const payload = await probeHealth(
      deps(async (input) =>
        String(input).includes("/rpc/health") ? respond(401, "{}") : respond(200),
      ),
    );
    expect(statusOf(payload, "database")).toBe("fail");
    expect(statusOf(payload, "authentication")).toBe("ok");
    expect(payload.status).toBe("down");
  });

  it("fails a check when its probe throws rather than answering", async () => {
    // A dead host rejects the fetch outright. That is an outage, not a crash of
    // the health check itself.
    const payload = await probeHealth(
      deps(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    expect(statusOf(payload, "database")).toBe("fail");
    expect(statusOf(payload, "authentication")).toBe("fail");
    expect(payload.status).toBe("down");
  });

  it("reports configuration without reaching the network for it", async () => {
    const fetchImpl = vi.fn(async () => respond(200, '"ok"'));
    const payload = await probeHealth({
      url: "not a url",
      anonKey: "a-real-looking-key",
      fetch: fetchImpl,
      now: () => new Date("2026-08-11T15:00:00.000Z"),
    });
    expect(statusOf(payload, "configuration")).toBe("fail");
  });

  it("runs the two network probes at the same time", async () => {
    // Serialised probes double the worst case, and the worst case is what a
    // monitor's timeout is set against.
    let inFlight = 0;
    let peak = 0;
    await probeHealth(
      deps(async (input) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return String(input).includes("/rpc/health") ? respond(200, '"ok"') : respond(200);
      }),
    );
    expect(peak).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/health-probe.test.ts`
Expected: FAIL — `Cannot find module '@/lib/services/health'`

- [ ] **Step 3: Write the implementation**

Create `lib/services/health.ts`:

```ts
import {
  buildPayload,
  checkConfiguration,
  type CheckResult,
  type HealthPayload,
} from "@/lib/domain/health";

/**
 * Reaching the two Supabase surfaces this application cannot work without.
 *
 * `fetch` and the clock arrive as dependencies so the probes can be tested
 * without a network and without waiting for real time to pass. Nothing here
 * decides what "up" means — that is lib/domain/health.ts — and nothing here
 * shapes what is said about it.
 */
export interface HealthDeps {
  fetch: typeof globalThis.fetch;
  now: () => Date;
  url?: string;
  anonKey?: string;
}

/** A hung dependency must not hang the endpoint reporting on it. */
export const PROBE_TIMEOUT_MS = 5000;

/**
 * How long an answer is reused.
 *
 * This endpoint is public and makes two outbound calls per request, so it is a
 * small amplifier. A failure is cached exactly as a success is: caching only
 * the good answer would let a flood arriving during an outage bypass the cap
 * entirely, which is the worst moment to remove it. The cost is that recovery
 * can take this long to show, which no monitor polling at thirty seconds or
 * more will notice.
 */
export const CACHE_TTL_MS = 10_000;

async function probe(request: () => Promise<Response>): Promise<boolean> {
  try {
    const response = await request();
    return response.ok;
  } catch {
    // Not swallowed: an unreachable dependency is the outage this reports, and
    // the reason belongs in the server log rather than in a public response.
    return false;
  }
}

async function probeDatabase(deps: HealthDeps): Promise<CheckResult> {
  const ok = await probe(async () => {
    const response = await deps.fetch(`${deps.url}/rest/v1/rpc/health`, {
      method: "POST",
      headers: {
        // PostgREST refuses the anon key on `apikey` alone, and the function
        // lives in onebook rather than public. Both were measured.
        apikey: deps.anonKey ?? "",
        authorization: `Bearer ${deps.anonKey ?? ""}`,
        "content-profile": "onebook",
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return response;
    // A 200 carrying anything other than the constant means something answered
    // that is not the function this migration created.
    const body = (await response.text()).trim().replace(/^"|"$/g, "");
    return body === "ok" ? response : new Response(null, { status: 502 });
  });
  return { name: "database", status: ok ? "ok" : "fail" };
}

async function probeAuthentication(deps: HealthDeps): Promise<CheckResult> {
  const ok = await probe(() =>
    deps.fetch(`${deps.url}/auth/v1/health`, {
      headers: { apikey: deps.anonKey ?? "" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }),
  );
  // The body carries the GoTrue version. Only the status code is read; the
  // version is not forwarded to an unauthenticated caller.
  return { name: "authentication", status: ok ? "ok" : "fail" };
}

export async function probeHealth(deps: HealthDeps): Promise<HealthPayload> {
  const configuration = checkConfiguration({ url: deps.url, anonKey: deps.anonKey });
  // Run together: serialised probes double the worst case, and the worst case
  // is what a monitor's timeout is set against.
  const [database, authentication] = await Promise.all([
    probeDatabase(deps),
    probeAuthentication(deps),
  ]);
  return buildPayload(
    [database, authentication, configuration],
    deps.now().toISOString(),
  );
}

let cached: { at: number; payload: HealthPayload } | null = null;

/**
 * The probes as the route calls them, with real dependencies and the cache.
 *
 * Stated plainly: on serverless each instance holds its own cache, so this
 * bounds abuse rather than acting as a shared cache.
 */
export async function cachedHealth(): Promise<HealthPayload> {
  const elapsed = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;
  if (cached && elapsed < CACHE_TTL_MS) return cached.payload;

  const payload = await probeHealth({
    fetch: globalThis.fetch,
    now: () => new Date(),
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  cached = { at: Date.now(), payload };
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/health-probe.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add lib/services/health.ts tests/unit/health-probe.test.ts
git commit -m "feat(health): reach the database and the sign-in service, with a timeout each"
```

---

### Task 4: The public endpoint

**Files:**
- Create: `app/api/health/route.ts`

**Interfaces:**
- Consumes: `cachedHealth` from `@/lib/services/health` (Task 3), `httpStatusFor` from `@/lib/domain/health` (Task 1)
- Produces: `GET /api/health`

There is no unit test for this file. It is four lines of wiring over two modules that are both tested; a test here would assert that a route handler calls the function it calls. Task 7 verifies it for real, against a built server, signed out.

- [ ] **Step 1: Write the route**

Create `app/api/health/route.ts`:

```ts
import { httpStatusFor } from "@/lib/domain/health";
import { cachedHealth } from "@/lib/services/health";

// Never prerendered: an answer baked at build time would report the state of
// the build machine, which is nobody's question.
export const dynamic = "force-dynamic";

/**
 * Is the application usable?
 *
 * Public, because a health check behind a session is unreachable in the one
 * situation it exists for. It answers with the component names and a verdict —
 * no error text, no host names, no versions, no timings.
 */
export async function GET() {
  const payload = await cachedHealth();
  return Response.json(payload, { status: httpStatusFor(payload.status) });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add app/api/health/route.ts
git commit -m "feat(health): answer on /api/health with a status code a monitor can read"
```

---

### Task 5: Letting the status page through the gate

**Files:**
- Create: `lib/domain/public-routes.ts`
- Modify: `proxy.ts:10-16`
- Test: `tests/unit/public-routes.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `skipsSession(pathname: string): boolean`

`proxy.ts` decides who reaches what and has never had a test. This task gives it one.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/public-routes.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skipsSession } from "@/lib/domain/public-routes";

describe("paths that skip the session", () => {
  it("lets every route handler through", () => {
    for (const path of ["/api/health", "/api/recurring/run", "/api/bank-feeds/sync"]) {
      expect(skipsSession(path), path).toBe(true);
    }
  });

  it("lets the status page through", () => {
    expect(skipsSession("/status")).toBe(true);
  });

  it("holds everything else to the session", () => {
    for (const path of ["/invoices", "/dashboard", "/settings/users", "/login", "/"]) {
      expect(skipsSession(path), path).toBe(false);
    }
  });

  it("does not let a path merely starting with the same letters through", () => {
    // /status-report is not the status page, and /apiary is not a route handler.
    for (const path of ["/status-report", "/statusboard", "/apiary"]) {
      expect(skipsSession(path), path).toBe(false);
    }
  });
});

describe("the proxy still bounces a signed-in visitor off /login alone", () => {
  it("does not share the public-path set with the redirect branch", () => {
    // The obvious edit is to collect /login and /status into one set and use it
    // in both branches. That breaks the page: the second branch sends a
    // signed-in visitor from /login to /dashboard, so a shared set would send
    // them off /status too — meaning every member of staff actually at work
    // could not open it.
    const source = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    expect(source).toMatch(/isAuthRoute\s*=\s*path === "\/login"/);
    expect(source).not.toMatch(/isAuthRoute\s*=\s*skipsSession/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/public-routes.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/public-routes'`

- [ ] **Step 3: Write the predicate**

Create `lib/domain/public-routes.ts`:

```ts
/**
 * Paths that skip the session entirely.
 *
 * Route Handlers are independent security boundaries: the cron endpoints verify
 * CRON_SECRET themselves and have no browser session to refresh.
 *
 * `/status` reports whether the application is up, so it must not depend on the
 * very thing it reports on. Refreshing a session there would make the page fail
 * whenever authentication is the broken part — which is exactly when somebody
 * goes looking for it.
 *
 * Kept out of proxy.ts so a test can reach it without loading next/server and
 * @supabase/ssr for the sake of one pure predicate.
 */
export function skipsSession(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname === "/status";
}
```

- [ ] **Step 4: Change proxy.ts**

Replace lines 10-16 of `proxy.ts` — the opening of `proxy()` and its `/api/` check — with:

```ts
export async function proxy(request: NextRequest) {
  if (skipsSession(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
```

and add the import beside the existing ones at the top of the file:

```ts
import { skipsSession } from "@/lib/domain/public-routes";
```

The comment that stood above the old `/api/` check moves into
`lib/domain/public-routes.ts` with the predicate; do not leave a copy behind.

**Change nothing else.** In particular `const isAuthRoute = path === "/login";` and
both redirect branches stay exactly as they are — see the test above for why.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/public-routes.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add lib/domain/public-routes.ts proxy.ts tests/unit/public-routes.test.ts
git commit -m "feat(health): let the status page answer when the session cannot"
```

---

### Task 6: The page

**Files:**
- Create: `app/status/page.tsx`

**Interfaces:**
- Consumes: `GET /api/health` (Task 4), `HealthPayload` from `@/lib/domain/health` (Task 1)
- Produces: the route `/status`

It sits at `app/status/` rather than inside `(app)` on purpose: the `(app)` layout is AppShell, which reads the company list from the database. The root layout carries only the Ant Design registry and the theme, so this page renders even when the database is unreachable — which is a precondition, not a detail.

- [ ] **Step 1: Write the page**

Create `app/status/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, List, Space, Typography } from "antd";
import { CheckCircleFilled, CloseCircleFilled, ReloadOutlined } from "@ant-design/icons";
import { TOKENS } from "@/lib/design/tokens";
import type { HealthPayload } from "@/lib/domain/health";

const LABELS: Record<string, string> = {
  database: "Database",
  authentication: "Sign-in service",
  configuration: "Configuration",
};

/**
 * Whether the application is working, for a person rather than a monitor.
 *
 * A member of staff whose screen has gone wrong wants one answer: is it the
 * application or is it me. Before this page the only way to find out was to
 * telephone somebody.
 *
 * It asks once on load and then only when asked again. Polling on a timer would
 * have the page hammer its own endpoint to tell one reader something they can
 * see by pressing a button.
 */
export default function StatusPage() {
  const [payload, setPayload] = useState<HealthPayload | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      setPayload((await response.json()) as HealthPayload);
      setUnreachable(false);
    } catch {
      // The endpoint itself could not be reached. That is an answer, and the
      // worst one, so it is shown rather than left as a blank page.
      setPayload(null);
      setUnreachable(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const down = unreachable || payload?.status === "down";

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 24 }}>
      <Space direction="vertical" size="large" style={{ display: "flex" }}>
        <Typography.Title level={1} style={{ marginBottom: 0 }}>
          One Book status
        </Typography.Title>

        <Alert
          type={down ? "error" : "success"}
          showIcon
          message={down ? "Some of One Book is not working" : "One Book is working"}
          description={
            down
              ? "If a screen is not behaving, this is why. Nothing you did caused it."
              : "If a screen is not behaving, the problem is not with One Book itself."
          }
        />

        <Card>
          <List
            dataSource={payload?.checks ?? []}
            locale={{ emptyText: unreachable ? "Could not reach One Book at all." : "Checking…" }}
            renderItem={(check) => (
              <List.Item
                actions={[
                  check.status === "ok" ? (
                    <Typography.Text style={{ color: TOKENS.intent.success }}>
                      <CheckCircleFilled /> Working
                    </Typography.Text>
                  ) : (
                    <Typography.Text style={{ color: TOKENS.intent.danger }}>
                      <CloseCircleFilled /> Not working
                    </Typography.Text>
                  ),
                ]}
              >
                {LABELS[check.name] ?? check.name}
              </List.Item>
            )}
          />
        </Card>

        <Space>
          <Button icon={<ReloadOutlined />} loading={checking} onClick={() => void check()}>
            Check again
          </Button>
          {payload && (
            <Typography.Text type="secondary">
              Checked {new Date(payload.checkedAt).toLocaleTimeString()}
            </Typography.Text>
          )}
        </Space>
      </Space>
    </main>
  );
}
```

Note the status colours come from `TOKENS`, so the no-hard-coded-colour guard in
`tests/unit/no-hardcoded-color.test.ts` stays green without an allowlist entry.

- [ ] **Step 2: Run the colour guard and typecheck**

Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts && npm run typecheck`
Expected: both pass; typecheck exit 0

- [ ] **Step 3: Commit**

```bash
git add app/status/page.tsx
git commit -m "feat(health): a page that says whether it is the app or you"
```

---

### Task 7: Apply the migration and prove it from outside

**Files:** none changed. This task is verification.

- [ ] **Step 1: Run the four gates**

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: all four green. **Paste the output verbatim, never trimmed** — the pass/fail line is usually at the end.

- [ ] **Step 2: Apply migration 0112**

```bash
node --env-file=.env.local scripts/migrate.mjs
```

Expected: it reports 0112 applied. The script loops the company register, and
`scopeOf()` holds this migration back from company schemas — so the only thing
that should change is the `onebook` schema.

- [ ] **Step 3: Prove the function is reachable by anon, from outside the app**

```bash
URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-)
KEY=$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2-)
curl -s -X POST -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Profile: onebook" -H "Content-Type: application/json" \
  -d '{}' "$URL/rest/v1/rpc/health"
```

Expected: `"ok"`. Before the migration this returned
`permission denied for schema onebook`, so this is the step that proves the
grant, not just the function.

- [ ] **Step 4: Prove anon still cannot reach anything else in the schema**

```bash
curl -s -X POST -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Profile: onebook" -H "Content-Type: application/json" \
  -d '{}' "$URL/rest/v1/rpc/my_companies"
curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Accept-Profile: onebook" "$URL/rest/v1/company?select=slug&limit=1"
```

Expected: both refused. Schema usage is wider than one function, and this is the
step that shows the blast radius is still one function.

- [ ] **Step 5: Verify both routes while signed out, against the built server**

`scripts/smoke-pages.mjs` cannot stand in for this: it signs in first, and what
needs proving here is the opposite.

`npm start` launched from an agent's shell dies mid-run, so start it detached.
On Windows, from PowerShell:

```powershell
Set-Location C:\Users\pit010\QUICKBOOK_WEBAPP\ctyhp-accounting
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm start > .next\server-out.log 2>&1" -WindowStyle Hidden
Start-Sleep -Seconds 14
```

Then, with no session cookie:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/status
curl -s -w "\n%{http_code}\n" http://localhost:3000/api/health
```

Stop the server afterwards, or the next `npm run build` fails with an
"Invariant: The client reference manifest … does not exist" over a `.next` the
running server still holds.

Expected: `/status` returns 200 with no redirect to `/login`, and `/api/health`
returns 200 with the three checks all `ok`.

- [ ] **Step 6: Verify the endpoint reports an outage rather than hiding it**

Temporarily point `NEXT_PUBLIC_SUPABASE_URL` at a host that does not resolve,
rebuild, and request `/api/health` again.

Expected: HTTP 503, `status: "down"`, with `database` and `authentication` failed
and `configuration` still `ok` — the URL parses, it simply answers nothing.
Restore the real value and rebuild afterwards.

A health check nobody has seen fail is a health check nobody knows works.

- [ ] **Step 7: Commit any fixes and report**

```bash
git add -A
git commit -m "test(health): verify the probe against the live project"
```

---

## Acceptance criteria

- [ ] `/api/health` returns 200 and all three checks `ok` while signed out
- [ ] `/status` renders while signed out, without redirecting to `/login`
- [ ] `/api/health` returns 503 with `status: "down"` when Supabase is unreachable
- [ ] `onebook.health()` is callable by anon; `onebook.my_companies()` and `onebook.company` are not
- [ ] The payload carries only `status`, `checkedAt`, `checks` — and each check only `name`, `status`
- [ ] `proxy.ts` still bounces a signed-in visitor off `/login` alone
- [ ] All four gates green, output pasted verbatim
