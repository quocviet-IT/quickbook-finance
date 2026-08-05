# Multi-company Cron Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run all three background automation jobs for every active company with per-company quotas, concurrency two, stable ordered results, and company-level failure isolation.

**Architecture:** A pure domain runner controls bounded cross-company concurrency and preserves registry order. The database adapter discovers active companies and constructs service-role Supabase clients bound to explicit schemas. A service module owns the three job workers and aggregate result contracts; Next.js Route Handlers retain authorization and HTTP response responsibilities.

**Tech Stack:** TypeScript 5, Next.js 16 Route Handlers, Supabase JS 2, Vitest 4.

## Global Constraints

- Process only rows whose `onebook.company.status` is `active`.
- Apply limits separately per company: 20 bank connections, 50 recurring templates, 100 recurring occurrences, and 20 document attachments.
- Run at most two company workers concurrently; keep work sequential inside each company.
- A company failure must not prevent other company workers from finishing.
- Registry discovery failure must reject the job and produce the route's existing HTTP 500 behavior.
- No migration, schedule, provider integration, or interactive action changes.

---

### Task 1: Schema-bound clients and the bounded company runner

**Files:**
- Create: `ctyhp-accounting/lib/domain/company-automation.ts`
- Modify: `ctyhp-accounting/lib/db/automation.ts`
- Create: `ctyhp-accounting/tests/unit/company-automation.test.ts`

**Interfaces:**
- Produces: `AutomationCompany`, `CompanyRunSuccess<T>`, `CompanyRunFailure`, and `runForAutomationCompanies<T>(companies, worker, concurrency?)`.
- Produces: `createSupabaseAutomationClient(schema?: string)` and `listActiveAutomationCompanies()`.

- [x] **Step 1: Write failing domain tests**

Add tests that call the real runner with asynchronous callbacks and assert:

```ts
expect(maxRunning).toBe(2);
expect(results.map((row) => row.company.slug)).toEqual(["one", "two", "three"]);
expect(results[1]).toMatchObject({ ok: false, error: "two failed" });
expect(await runForAutomationCompanies([], worker)).toEqual([]);
```

The fixtures must deliberately finish out of order so ordered output is proven rather than assumed.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/unit/company-automation.test.ts`

Expected: FAIL because `@/lib/domain/company-automation` does not exist.

- [x] **Step 3: Implement the minimal pure runner**

Implement a fixed-size worker pool without starting more callbacks than `concurrency`. Store each settled result at its input index. Convert thrown values with:

```ts
const error = reason instanceof Error ? reason.message : "Company automation failed";
```

Reject `concurrency < 1` with a clear error. Default concurrency to `2`.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/unit/company-automation.test.ts`

Expected: all new runner tests pass.

- [x] **Step 5: Add failing client-binding and registry tests**

Mock only the external `createClient` boundary. Assert the call contains:

```ts
expect(createClient).toHaveBeenCalledWith(url, key, {
  db: { schema: "co_north_star" },
  auth: { persistSession: false, autoRefreshToken: false },
});
```

Also provide a fake Supabase query chain to `listActiveAutomationCompanies` and verify the query filters `status = active`, orders by `display_order` then `legal_name`, maps all identity fields, and throws on a query error.

- [x] **Step 6: Run focused tests and verify RED**

Run: `npm test -- tests/unit/company-automation.test.ts`

Expected: FAIL because the client has no schema option and registry discovery does not exist.

- [x] **Step 7: Implement schema binding and registry discovery**

Change the factory signature to:

```ts
export function createSupabaseAutomationClient(schema = "public"): SupabaseClient
```

Add `db: { schema }`. Implement `listActiveAutomationCompanies()` with a service-role client bound to `onebook`, select `id,slug,schema_name,legal_name`, filter active, and map `schema_name` to `schemaName`.

- [x] **Step 8: Run focused tests and verify GREEN**

Run: `npm test -- tests/unit/company-automation.test.ts`

Expected: all Task 1 tests pass.

### Task 2: Per-company job workers and quota reset

**Files:**
- Create: `ctyhp-accounting/lib/services/automation-jobs.ts`
- Create: `ctyhp-accounting/tests/unit/automation-jobs.test.ts`

**Interfaces:**
- Consumes: `AutomationCompany`, `runForAutomationCompanies`, `createSupabaseAutomationClient`, and `listActiveAutomationCompanies`.
- Produces: `runBankFeedAutomationJob`, `runRecurringAutomationJob`, and `runDocumentScanAutomationJob` plus their result types.

- [x] **Step 1: Write failing tests for bank and document quotas**

Use injected dependencies backed by in-memory arrays. Provide more than 20 eligible rows for two companies and assert each company processes exactly 20, results stay grouped by company, and the client factory receives both schema names.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/unit/automation-jobs.test.ts`

Expected: FAIL because the automation job module does not exist.

- [x] **Step 3: Implement bank and document jobs minimally**

Each job must discover companies once and call `runForAutomationCompanies` with concurrency two. Create one schema-bound client inside each company callback. Preserve the existing sequential item loops and item error wording.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/unit/automation-jobs.test.ts`

Expected: bank and document tests pass.

- [x] **Step 5: Write failing recurring quota-reset tests**

Provide two companies with a due template that can claim more than 100 occurrences. Assert each company reaches 100 independently, proving the counter is local to the company worker. Also assert a failing company produces `ok: false` while the other company completes.

- [x] **Step 6: Run focused tests and verify RED**

Run: `npm test -- tests/unit/automation-jobs.test.ts`

Expected: FAIL because recurring multi-company processing is absent.

- [x] **Step 7: Implement recurring processing minimally**

Move `occurrenceCount` inside the company callback. Preserve the existing per-template cap of 12, overall company cap of 100, date advancement with `nextRecurringDate`, and stop-on-template-error behavior.

- [x] **Step 8: Run focused tests and verify GREEN**

Run: `npm test -- tests/unit/automation-jobs.test.ts`

Expected: all Task 2 tests pass.

### Task 3: Route integration and response contracts

**Files:**
- Modify: `ctyhp-accounting/app/api/bank-feeds/sync/route.ts`
- Modify: `ctyhp-accounting/app/api/recurring/run/route.ts`
- Modify: `ctyhp-accounting/app/api/documents/scan/route.ts`
- Modify: `ctyhp-accounting/tests/unit/automation-jobs.test.ts`

**Interfaces:**
- Consumes: the three job functions from Task 2.
- Produces: authenticated JSON responses containing `companyCount`, aggregate counts, and ordered `companies` results.

- [x] **Step 1: Add failing aggregate-contract tests**

Assert each job result exposes the sum of company counts and retains company identities and item results. Assert registry discovery rejection propagates rather than returning an empty or public-only run.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/unit/automation-jobs.test.ts`

Expected: FAIL because aggregate counts or propagation are missing.

- [x] **Step 3: Complete job aggregate results**

Return:

```ts
{
  companyCount: companies.length,
  connectionCount | scheduleCount | attachmentCount: summedCount,
  companies: companyResults,
}
```

Do not turn company failures into top-level rejection.

- [x] **Step 4: Replace route-local single-company loops**

Keep `authorized`, `dynamic`, `maxDuration`, scanner configuration handling, timestamps, and current top-level error wording. Call the relevant service job and spread its aggregate result into `Response.json`.

- [x] **Step 5: Run focused and full unit tests**

Run: `npm test -- tests/unit/company-automation.test.ts tests/unit/automation-jobs.test.ts`

Expected: focused tests pass.

Run: `npm test`

Expected: every unit test passes.

### Task 4: Full verification and handoff

**Files:**
- Review all files changed by Tasks 1–3.

**Interfaces:**
- Produces: verified source ready for deployment; no database write or migration.

- [x] **Step 1: Run static gates**

Run sequentially:

```text
npm run security:check-source
npm run typecheck
npm run lint
```

Expected: credential and type checks pass; lint has zero errors and only previously known warnings.

- [x] **Step 2: Run production build**

Run: `npm run build`

Expected: exit 0 with all three API routes present.

- [x] **Step 3: Run read-only page smoke test**

Start the built server with `npm start`, then run:

```text
node --env-file=.env.local scripts/smoke-pages.mjs http://127.0.0.1:3000
```

Expected: all registered UI routes render HTTP 200.

- [x] **Step 4: Review diff and repository state**

Run:

```text
git diff --check
git diff --stat HEAD~1
git status --short
```

Confirm the pre-existing `.claude/settings.json` change is untouched, no secret is present, and no migration was added.

- [x] **Step 5: Commit implementation**

Stage only the cron implementation, tests, spec, and plan. Commit with:

```text
feat: run automation for every company
```
