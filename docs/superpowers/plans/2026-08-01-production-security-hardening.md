# OneBook Production Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove anonymous access to protected accounting RPCs and migration state, and make destructive verification scripts fail closed unless they receive an explicitly isolated E2E environment.

**Architecture:** A database-only permission migration fixes the live Supabase boundary without changing accounting calculations. A shared Node environment guard separates destructive verification from ordinary application configuration, while a read-only deployment verifier proves the live grants and anonymous behavior before and after rollout.

**Tech Stack:** PostgreSQL/Supabase migrations, Node.js ESM, TypeScript, Vitest, GitHub Actions, Next.js 16.

## Global Constraints

- Do not change accounting calculations, document states, journal behavior, or UI behavior.
- Do not run destructive verification scripts against the current `SUPABASE_DB_URL`.
- Do not print or commit credentials.
- Preserve all unrelated dirty-worktree changes.
- Apply only the new security migration to the live database, then use read-only verification.
- Live administrator password rotation remains a manual owner action.

---

### Task 1: Fail-closed destructive-test environment

**Files:**
- Create: `ctyhp-accounting/scripts/e2e-environment.mjs`
- Create: `ctyhp-accounting/tests/unit/e2e-environment.test.ts`

**Interfaces:**
- Consumes: a plain environment object, defaulting to `process.env`.
- Produces: `requireDestructiveE2eEnvironment(env)` returning `{ databaseUrl, supabaseUrl, anonKey, email, password, secondaryEmail, secondaryPassword }`.

- [ ] **Step 1: Write the failing guard tests**

  Cover these observable behaviors with literal fixtures:
  - missing `ALLOW_DESTRUCTIVE_E2E=ONEBOOK_TEST_DATABASE_ONLY` throws;
  - missing any required `E2E_*` value throws and names only the variable, never a supplied secret;
  - `E2E_DATABASE_URL === SUPABASE_DB_URL` throws;
  - `E2E_SUPABASE_URL === NEXT_PUBLIC_SUPABASE_URL` throws;
  - an isolated configuration returns the seven normalized values.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `npm test -- tests/unit/e2e-environment.test.ts`

  Expected: FAIL because `scripts/e2e-environment.mjs` does not exist.

- [ ] **Step 3: Implement the minimal guard**

  Implement exact opt-in comparison, non-empty string validation, URL normalization that removes a trailing slash, database URL comparison using `new URL(...)`, and safe error messages that never interpolate credential values.

  ```js
  const OPT_IN = "ONEBOOK_TEST_DATABASE_ONLY";

  function required(env, name) {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required for destructive E2E tests`);
    return value;
  }

  function normalizedHttpUrl(value) {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  }

  function normalizedDatabaseTarget(value) {
    const url = new URL(value);
    return `${url.protocol}//${url.username}@${url.host}${url.pathname}`;
  }

  export function requireDestructiveE2eEnvironment(env = process.env) {
    if (env.ALLOW_DESTRUCTIVE_E2E !== OPT_IN) {
      throw new Error(`Set ALLOW_DESTRUCTIVE_E2E=${OPT_IN} only for an isolated test project`);
    }
    const result = {
      databaseUrl: required(env, "E2E_DATABASE_URL"),
      supabaseUrl: required(env, "E2E_SUPABASE_URL"),
      anonKey: required(env, "E2E_SUPABASE_ANON_KEY"),
      email: required(env, "E2E_EMAIL"),
      password: required(env, "E2E_PASSWORD"),
      secondaryEmail: required(env, "E2E_SECONDARY_EMAIL"),
      secondaryPassword: required(env, "E2E_SECONDARY_PASSWORD"),
    };
    if (env.SUPABASE_DB_URL && normalizedDatabaseTarget(result.databaseUrl) === normalizedDatabaseTarget(env.SUPABASE_DB_URL)) {
      throw new Error("E2E_DATABASE_URL must not target SUPABASE_DB_URL");
    }
    if (env.NEXT_PUBLIC_SUPABASE_URL && normalizedHttpUrl(result.supabaseUrl) === normalizedHttpUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
      throw new Error("E2E_SUPABASE_URL must not target NEXT_PUBLIC_SUPABASE_URL");
    }
    return result;
  }
  ```

- [ ] **Step 4: Run the focused test and verify GREEN**

  Run: `npm test -- tests/unit/e2e-environment.test.ts`

  Expected: all guard tests pass.

---

### Task 2: Route destructive scripts through the isolated environment

**Files:**
- Modify: `ctyhp-accounting/scripts/cleanup-test-ledger.mjs`
- Modify: `ctyhp-accounting/scripts/smoke-pages.mjs`
- Modify: `ctyhp-accounting/scripts/verify-access.mjs`
- Modify: `ctyhp-accounting/scripts/verify-ar-ap.mjs`
- Modify: `ctyhp-accounting/scripts/verify-bankrec.mjs`
- Modify: `ctyhp-accounting/scripts/verify-cashflow.mjs`
- Modify: `ctyhp-accounting/scripts/verify-dashboard.mjs`
- Modify: `ctyhp-accounting/scripts/verify-inventory.mjs`
- Modify: `ctyhp-accounting/scripts/verify-invoicing.mjs`
- Modify: `ctyhp-accounting/scripts/verify-items.mjs`
- Modify: `ctyhp-accounting/scripts/verify-journal.mjs`
- Modify: `ctyhp-accounting/scripts/verify-payables.mjs`
- Modify: `ctyhp-accounting/scripts/verify-periods.mjs`
- Modify: `ctyhp-accounting/scripts/verify-purchasing.mjs`
- Modify: `ctyhp-accounting/scripts/verify-reports.mjs`
- Modify: `ctyhp-accounting/scripts/verify-salestax.mjs`
- Modify: `ctyhp-accounting/scripts/verify-search.mjs`
- Modify: `ctyhp-accounting/scripts/verify-vendor-tax.mjs`
- Modify: `ctyhp-accounting/tests/e2e/support/session.ts`
- Modify: `ctyhp-accounting/.env.local.example`

**Interfaces:**
- Consumes: `requireDestructiveE2eEnvironment()` from Task 1.
- Produces: destructive scripts that cannot obtain a client or sign in from ordinary production variables.

- [ ] **Step 1: Add a subprocess behavior test**

  Extend `tests/unit/e2e-environment.test.ts` to launch `scripts/cleanup-test-ledger.mjs` with an environment lacking the opt-in and assert a non-zero exit plus a safe refusal message. The guard must fire before `pg.Client.connect()`.

- [ ] **Step 2: Run the subprocess test and verify RED**

  Run: `npm test -- tests/unit/e2e-environment.test.ts`

  Expected: FAIL because the cleanup script still reads `SUPABASE_DB_URL` directly.

- [ ] **Step 3: Update every destructive script**

  At module startup, import the shared guard and destructure test-only values. Replace:
  - `SUPABASE_DB_URL` with `databaseUrl`;
  - `NEXT_PUBLIC_SUPABASE_URL` with `supabaseUrl`;
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` with `anonKey`;
  - embedded administrator credentials with `email` and `password`;
  - embedded secondary-user credentials with `secondaryEmail` and `secondaryPassword`.

  Do not modify the accounting assertions or cleanup SQL in this task; isolation is the minimal P0 control.

  Use this exact module-start pattern before any client is constructed:

  ```js
  import { requireDestructiveE2eEnvironment } from "./e2e-environment.mjs";

  const {
    databaseUrl,
    supabaseUrl,
    anonKey,
    email,
    password,
    secondaryEmail,
    secondaryPassword,
  } = requireDestructiveE2eEnvironment();
  ```

  Scripts that need only PostgreSQL still call the same guard and use only `databaseUrl`; unused destructured values are omitted.

- [ ] **Step 4: Remove fallback credentials from E2E support**

  Make `tests/e2e/support/session.ts` require `E2E_EMAIL` and `E2E_PASSWORD` with no demo defaults. Update `.env.local.example` with empty `E2E_*` placeholders and explicit warnings that destructive suites require a separate project plus the exact opt-in value.

- [ ] **Step 5: Verify fail-closed behavior**

  Run: `node --env-file=.env.local scripts/cleanup-test-ledger.mjs`

  Expected: non-zero exit before network access, explaining that the isolated E2E opt-in/configuration is missing.

- [ ] **Step 6: Run focused tests**

  Run: `npm test -- tests/unit/e2e-environment.test.ts`

  Expected: all tests pass.

---

### Task 3: Add source credential safety gate

**Files:**
- Create: `ctyhp-accounting/scripts/check-source-credentials.mjs`
- Modify: `ctyhp-accounting/package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: tracked operational scripts beneath `ctyhp-accounting/scripts` plus `ctyhp-accounting/tests/e2e/support/session.ts`; ordinary unit-test password fixtures are out of scope.
- Produces: command `npm run security:check-source`, exit 0 when no literal password assignment/sign-in value exists and exit 1 with file paths only when a violation exists.

- [ ] **Step 1: Create the scanner with a deliberate fixture mode**

  Accept optional file paths as CLI arguments so behavior can be tested without scanning the whole repository. Detect literal values assigned to password-like fields while allowing environment lookups and empty example placeholders. Never echo matched secret text.

  ```js
  const literalObjectPassword = /\b(?:password|passwd|pwd)\s*:\s*["'`](?!["'`])[^\r\n"'`]+["'`]/i;
  const literalAssignedPassword = /\b(?:[A-Z0-9_]*PASSWORD|password)\s*=\s*["'`](?!["'`])[^\r\n"'`]+["'`]/i;
  const fallbackPassword = /\bpassword\s*=\s*[^;\r\n]*\?\?\s*["'`](?!["'`])[^\r\n"'`]+["'`]/i;
  const offenders = files.filter((file) => {
    const source = readFileSync(file, "utf8");
    return literalObjectPassword.test(source) ||
      literalAssignedPassword.test(source) ||
      fallbackPassword.test(source);
  });
  if (offenders.length) {
    console.error(`Literal password values found in:\n${offenders.join("\n")}`);
    process.exitCode = 1;
  }
  ```

  Reset the regular expression state or avoid the global flag so scanning multiple files is deterministic.

- [ ] **Step 2: Write and run a temporary negative fixture**

  Create a temporary file under the OS temp directory containing a literal password field, run the scanner against it, and verify exit 1 plus filename-only output. Remove the temporary file using the same PowerShell process and exact resolved path.

- [ ] **Step 3: Add package and CI gates**

  Add `"security:check-source": "node scripts/check-source-credentials.mjs"` to `package.json`. Add a `Source credential safety` step after `npm ci` in `.github/workflows/ci.yml` running `npm run security:check-source`.

- [ ] **Step 4: Run the real repository gate**

  Run: `npm run security:check-source`

  Expected: exit 0 and no credential values printed.

---

### Task 4: Write the database permission regression verifier

**Files:**
- Create: `ctyhp-accounting/scripts/verify-production-security-readonly.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes: `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Produces: command `npm run security:verify-deployment`, performing only `SELECT`, privilege inspection, and anonymous read-only RPC calls.

- [ ] **Step 1: Implement the read-only verifier**

  The verifier must start `BEGIN READ ONLY`, then assert:
  - `anon` cannot execute `acc_open_items(date)` or `acc_settlement_lag(date)`;
  - `anon` and `authenticated` cannot execute `acc_add_inventory_txn(...)`, `acc_reverse_inventory_for_entry(uuid,date,text)`, or `acc_recompute_po_status(uuid)`;
  - `anon` and `authenticated` have no `SELECT/INSERT/UPDATE/DELETE` privilege on `acc_schema_migrations`;
  - `authenticated` retains execute privilege on representative required RPCs: `acc_has_permission(text)`, `acc_ledger_balances(date,date)`, `acc_issue_invoice(uuid,text)`, and `acc_open_items(date)`;
  - an unauthenticated Supabase call to `acc_open_items` returns an error and no data.

  Always `ROLLBACK` and close clients. Print booleans/counts only, never rows or secrets.

  Use PostgreSQL privilege checks with full signatures:

  ```sql
  select
    has_function_privilege('anon', 'acc_open_items(date)', 'EXECUTE') as anon_open_items,
    has_function_privilege('anon', 'acc_settlement_lag(date)', 'EXECUTE') as anon_settlement_lag,
    has_function_privilege(
      'anon',
      'acc_add_inventory_txn(uuid,date,acc_inventory_source,uuid,numeric,bigint,uuid,uuid,text)',
      'EXECUTE'
    ) as anon_add_inventory,
    has_function_privilege('authenticated', 'acc_recompute_po_status(uuid)', 'EXECUTE') as user_recompute_po,
    has_table_privilege('anon', 'public.acc_schema_migrations', 'SELECT,INSERT,UPDATE,DELETE') as anon_migrations,
    has_table_privilege('authenticated', 'public.acc_schema_migrations', 'SELECT,INSERT,UPDATE,DELETE') as user_migrations;
  ```

  The script converts each forbidden privilege to a named failed assertion and exits non-zero if any assertion fails.

- [ ] **Step 2: Wire the package command**

  Add `"security:verify-deployment": "node --env-file=.env.local scripts/verify-production-security-readonly.mjs"`.

- [ ] **Step 3: Run against the current deployment and verify RED**

  Run: `npm run security:verify-deployment`

  Expected: non-zero exit showing the previously confirmed anonymous/grant failures.

---

### Task 5: Add the least-privilege migration

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0080_production_security_hardening.sql`

**Interfaces:**
- Consumes: PostgreSQL roles `anon`, `authenticated`, `service_role` and the existing `acc_*` function catalog.
- Produces: protected RPC and migration-table ACLs without changing function bodies.

- [ ] **Step 1: Capture current ACL evidence**

  Use a read-only direct query to save counts in the execution log: total `acc_*` `SECURITY DEFINER` functions, anonymous-executable functions, helper grants, and all `acc_schema_migrations` role privileges. Do not write an ACL dump containing secrets.

- [ ] **Step 2: Write the migration**

  In one transaction-compatible SQL file:
  - loop over `public.acc_*` functions and revoke `EXECUTE` from `anon` and PostgreSQL `public`;
  - grant `EXECUTE` to `service_role` for those functions;
  - preserve existing direct `authenticated` grants;
  - explicitly revoke `EXECUTE` from `authenticated` for `acc_add_inventory_txn`, `acc_reverse_inventory_for_entry`, and `acc_recompute_po_status` using their full signatures;
  - enable RLS on `public.acc_schema_migrations`;
  - revoke all table and sequence privileges on the migration table from `anon`, `authenticated`, and PostgreSQL `public`;
  - revoke default function execution and table privileges for `anon` and PostgreSQL `public` in schema `public` so future objects fail closed.

  Use an ACL loop that quotes each overload as a `regprocedure`:

  ```sql
  do $$
  declare
    v_function regprocedure;
  begin
    for v_function in
      select p.oid::regprocedure
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname like 'acc\_%' escape '\'
    loop
      execute format('revoke execute on function %s from public, anon', v_function);
      execute format('grant execute on function %s to service_role', v_function);
    end loop;
  end;
  $$;

  revoke execute on function acc_add_inventory_txn(
    uuid, date, acc_inventory_source, uuid, numeric, bigint, uuid, uuid, text
  ) from authenticated;
  revoke execute on function acc_reverse_inventory_for_entry(uuid, date, text)
    from authenticated;
  revoke execute on function acc_recompute_po_status(uuid) from authenticated;

  alter table public.acc_schema_migrations enable row level security;
  revoke all on table public.acc_schema_migrations from public, anon, authenticated;

  alter default privileges in schema public revoke execute on functions from public;
  alter default privileges in schema public revoke execute on functions from anon;
  alter default privileges in schema public revoke all on tables from public;
  alter default privileges in schema public revoke all on tables from anon;
  ```

- [ ] **Step 3: Validate SQL locally without applying it**

  Check the file with `git diff --check` and inspect every function signature against `pg_get_function_identity_arguments` on the live database.

---

### Task 6: Apply and verify the live migration

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: `scripts/migrate.mjs` and migration 0080.
- Produces: migrated Supabase deployment plus read-only verification evidence.

- [ ] **Step 1: Apply migration 0080**

  Run: `node --env-file=.env.local scripts/migrate.mjs`

  Expected: migrations 0001-0079 skipped and 0080 applied once. This is the only live database write in the rollout.

- [ ] **Step 2: Re-run deployment security verification**

  Run: `npm run security:verify-deployment`

  Expected: all privilege and anonymous-call checks pass.

- [ ] **Step 3: Re-run live ledger invariants read-only**

  Verify posted debits equal credits, zero unbalanced entries, AR aging equals account 1100, AP aging equals account 2000, completed reconciliations have zero difference, and no late postings exist in closed periods.

- [ ] **Step 4: Confirm migration tracking remains operable to the owner**

  Re-run `scripts/migrate.mjs`.

  Expected: every migration including 0080 is skipped; application roles remain unable to access `acc_schema_migrations`.

---

### Task 7: Full verification and handoff

**Files:**
- Review all files changed by Tasks 1-6.

**Interfaces:**
- Produces: final evidence and operational password-rotation handoff.

- [ ] **Step 1: Run repository verification**

  Run sequentially:
  - `npm run security:check-source`
  - `npm run typecheck`
  - `npm test`
  - `npm run lint`
  - `npm run build`

  Expected: credential gate, typecheck, tests, and build exit 0; lint has no errors and any pre-existing warnings are reported explicitly.

- [ ] **Step 2: Inspect final diff and status**

  Run `git diff --check`, `git diff --stat`, and `git status --short --branch`. Confirm unrelated user changes remain untouched.

- [ ] **Step 3: Security review checklist**

  Confirm no secret values appear in diffs or logs, the verifier never writes data, destructive scripts refuse the ordinary `.env.local`, and migration 0080 contains only privilege/RLS/default-privilege statements.

- [ ] **Step 4: Handoff**

  Report the migration result, before/after anonymous privilege counts, verification commands, remaining lint warnings, and the unresolved manual action: rotate the exposed administrator credential in Supabase Auth.
