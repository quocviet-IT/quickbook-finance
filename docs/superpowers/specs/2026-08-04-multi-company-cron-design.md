# Multi-company cron automation design

Date: 2026-08-04

## Goal

Run bank-feed synchronization, recurring transaction generation, and document
scanning for every active One Book company. Each company receives its own work
quota, one company's failure does not block another, and no job can query a
different company's accounting schema accidentally.

## Scope

This change covers the three authenticated Vercel cron routes:

- `/api/bank-feeds/sync`
- `/api/recurring/run`
- `/api/documents/scan`

It does not change schedules, accounting RPCs, provider integrations, database
schema, or interactive document and feedback actions.

## Architecture

`lib/db/automation.ts` remains the only module that constructs a service-role
Supabase client. It gains an optional schema argument and passes that value to
the Supabase client's `db.schema` option. Existing callers continue to default
to `public`; every multi-company cron caller passes its schema explicitly.

A focused automation-company module owns control-plane discovery and batch
orchestration:

- It reads active companies from `onebook.company` with a service-role client,
  ordered by `display_order` and legal name.
- It exposes a pure concurrency-limited runner. The runner accepts company
  descriptors and a callback, starts no more than two callbacks at once, keeps
  output in registry order, and turns a company exception into an error result
  instead of rejecting the whole batch.
- The runner never catches registry discovery failure. Without a trustworthy
  company list, the route fails with HTTP 500 rather than silently running only
  `public`.

Each route extracts its current single-company work into a worker that accepts
a company descriptor and a schema-bound Supabase client. The route discovers
companies, invokes the shared runner with concurrency two, and aggregates the
per-company results.

## Quotas and execution

Quotas apply independently to each company:

- Bank feeds: at most 20 non-disconnected connections. Connections remain
  sequential inside a company to avoid Plaid bursts.
- Recurring transactions: at most 50 due templates and 100 claimed occurrences.
  The occurrence counter resets for every company.
- Document scanning: at most 20 pending attachments. Attachments remain
  sequential inside a company to avoid scanner bursts.

At most two companies run concurrently. A company worker creates exactly one
schema-bound client and reuses it for every item in that company.

## Response and failure model

Authorization and missing scanner configuration retain their existing 401 and
503 behavior.

A successful orchestration response contains:

- the job timestamp and job-specific date where applicable;
- `companyCount`;
- job-specific aggregate counts across all companies;
- `companies`, in registry order, with the company identity, `ok`, job-specific
  counts, item results, and an optional company-level error.

An item failure remains inside its company's item result and does not stop the
rest of that company's eligible items unless the existing job already stops
there (recurring templates do). A company-level failure produces `ok: false`
for that company and the shared runner starts or finishes every other company.
Partial failure retains HTTP 200, matching the routes' current item-level
contract. Registry discovery or automation configuration failure returns HTTP
500 because no reliable multi-company run was possible.

## Security

- Only active companies from the service-role-readable register are processed.
- Schema names are data returned by the register, not request input.
- Every job client is constructed with an explicit schema.
- Cron secret verification remains unchanged and uses constant-time comparison.
- No service-role key or provider secret is returned or logged.

## Testing

Unit tests cover the pure runner with real asynchronous callbacks:

- no more than two companies run concurrently;
- output remains in registry order even when completion order differs;
- one company throwing produces an error result and the others finish;
- an empty registry produces an empty result.

Automation-client tests verify source-level configuration is replaced by
behavioral coverage where practical: the schema argument is passed through to
Supabase client construction and the default remains `public` for existing
callers.

Route worker tests prove quotas are per-company, especially that recurring's
100-occurrence counter is not shared. Full verification runs unit tests,
typecheck, lint, production build, and the read-only page smoke sweep.

## Non-goals

- Automatic retry or persistent job history.
- Changing the three Vercel schedules.
- Parallel item execution inside one company.
- Fixing the separate interactive service-role call sites.
- Adding new migrations or permissions.
