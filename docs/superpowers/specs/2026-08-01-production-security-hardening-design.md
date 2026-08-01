# OneBook Production Security Hardening Design

## Objective

Close the confirmed production authorization gaps without changing accounting behavior, prevent destructive verification scripts from reaching the production database by default, and add repeatable evidence that anonymous callers cannot read or mutate protected accounting data.

## Confirmed Root Causes

1. Supabase grants `anon` direct function privileges through its default privilege model. Several migrations revoke only from PostgreSQL `public`, which does not remove a direct grant to `anon`.
2. Read-oriented `SECURITY DEFINER` functions such as `acc_open_items` and `acc_settlement_lag` rely on grants rather than an internal authentication check. They therefore bypass RLS for anonymous callers when the grant remains.
3. Internal mutation helpers such as `acc_add_inventory_txn`, `acc_reverse_inventory_for_entry`, and `acc_recompute_po_status` are intended to be called only by higher-level transactional functions, but their execution privileges are not restricted to the function owner/service role.
4. `acc_schema_migrations` is created outside the migration sequence and never receives RLS or explicit privilege restrictions.
5. Legacy verification scripts combine live Supabase credentials with broad cleanup statements. They also embed an administrator password, so an accidental invocation can both expose a credential and delete unrelated accounting data.

## Chosen Approach

Use a least-privilege database migration plus a fail-closed test-script boundary.

### Database permissions

- Add `0073_production_security_hardening.sql`.
- Revoke function execution from `anon` and PostgreSQL `public` for every `acc_*` function currently exposed through direct/default grants.
- Preserve explicit `authenticated` access for application-facing RPCs and `service_role` access for background automation.
- Revoke `authenticated` access from internal mutation helpers that are called only from other database functions.
- Enable RLS on `acc_schema_migrations` and revoke all table privileges from `anon` and `authenticated`; migration ownership/direct database credentials remain able to manage it.
- Correct default privileges so newly created functions and tables are not automatically exposed to `anon`.
- Do not change function bodies or accounting calculations unless a regression test proves a grant-only boundary is insufficient.

### Verification-script isolation

- Add one shared script guard that requires explicit test-only environment variables.
- Destructive scripts must use `E2E_DATABASE_URL`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_EMAIL`, and `E2E_PASSWORD`; they must not fall back to production variables or embedded credentials.
- Require an additional opt-in flag for destructive database tests.
- Reject execution when required test values are absent, URLs match the normal application Supabase values, or the opt-in flag is not exact.
- Keep existing test logic initially, but make it unreachable against the ordinary `.env.local` production configuration.

### Automated regression coverage

- Add unit tests for the script guard: missing opt-in, missing test URL, matching production/test targets, and a valid isolated configuration.
- Add a repository safety test that fails if executable scripts contain literal passwords.
- Add a read-only deployment security test that verifies:
  - anonymous calls to protected reporting RPCs fail;
  - `anon` has no execution privilege on internal mutation helpers;
  - `anon` and `authenticated` have no CRUD privilege on `acc_schema_migrations`;
  - authenticated users retain the RPC privileges needed by the application.
- Keep deployment tests out of the ordinary unit-test command unless CI has an isolated Supabase test project. Add an explicit security verification script for controlled deployment validation.

## Deployment Flow

1. Run the new tests against the current deployment and record the expected failures.
2. Apply the migration using the direct database migration runner.
3. Re-run anonymous Supabase RPC probes and direct privilege queries in read-only mode.
4. Run unit tests, typecheck, lint, and production build.
5. Run a minimal authenticated read-only smoke test to confirm required RPC access remains available.

## Failure Handling and Rollback

- The migration is transactional. A privilege statement failure rolls back the complete migration.
- Before deployment, capture current ACLs for all affected functions and `acc_schema_migrations`.
- If an authenticated application RPC loses access, restore only that function's `EXECUTE` grant to `authenticated`; never restore blanket `anon` or `public` execution.
- Do not roll back the migration-table RLS restriction or re-enable application-role writes.
- Database deployment verification must remain read-only apart from applying the migration itself.

## Password Rotation Boundary

Removing embedded passwords from source is part of this change. Rotating the live administrator password is a separate operational action because automatically selecting a new password could lock out the owner. After deployment, the owner must rotate that credential in Supabase Auth and update only the isolated test secret store if the test account remains necessary.

## Non-Goals

- No accounting feature or UI redesign.
- No changes to journal, AR/AP, reconciliation, inventory, tax, or reporting calculations.
- No broad role-model redesign.
- No automatic production password rotation.
- No execution of destructive end-to-end suites against the live database.

## Acceptance Criteria

1. Anonymous callers receive authorization errors from every protected accounting RPC tested.
2. `anon` cannot execute internal mutation helpers.
3. Neither `anon` nor `authenticated` can read or modify `acc_schema_migrations` through PostgREST.
4. No tracked executable script contains a literal password.
5. Destructive verification scripts abort unless an isolated E2E configuration and explicit opt-in are present.
6. Authenticated application RPCs required by current services remain executable.
7. Unit tests, typecheck, lint, and production build complete successfully.
8. Live ledger invariants remain unchanged after the permission-only migration.
