# CTYHP Accounting — AI working rulebook

@AGENTS.md

Follow `../holy-grail-coding-guidebook-en.md`. This file is the project-specific
contract required by its Part 05.

## 1. Run commands (exact)
- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`

## 2. How to verify (mandatory before claiming "done")
- Run build + test + typecheck + lint, zero errors, and paste the real output.
- UI change: also run `node --env-file=.env.local scripts/smoke-pages.mjs` against a running dev server. The four gates above all pass on a page that throws at render time.
- Posting logic: `npm run test:e2e:document-ledger-report` runs over HTTPS as a signed-in administrator, so it works from networks where the Postgres port is blocked. It writes to the real database and asserts every reported figure returns to its opening value; a failure naming a moved figure means the run left residue — clear it with `scripts/cleanup-test-ledger.mjs`.
- Money logic: add/adjust a unit test with concrete input/output in `tests/unit/`; never verify by "looks right in the UI".
- Posting builders must assert `debit == credit` (`assertBalanced`).

## 3. Architecture & where logic lives
- Double-entry ledger is the single source of truth; all balances/reports derive from `acc_journal_line`.
- Pure accounting rules: `lib/domain/` (`posting.ts`, `money.ts`, `accounts.ts`, `reports.ts`, `reconciliation.ts`).
- Financial writes: `lib/services/*` → atomic Postgres RPC (`supabase/migrations/*`). No SQL in components.
- Input validation: Zod in `lib/domain/schemas.ts`. Server Actions in `app/(app)/*/actions.ts` guard by role.
- DO NOT re-implement a posting/money/tax rule anywhere else (Part 14).

## 4. Gotchas / past mistakes (append when a bug recurs)
- Postgres enums: you cannot `ALTER TYPE ... ADD VALUE` and then use the new value in the same transaction/migration. Add the value in one migration, use it in the next.
- Money is minor units end-to-end; only convert to decimal at the UI edge using the currency's `decimal_places`.
- US market: purchase-side tax is part of expense cost — no recoverable input tax, no separate tax line on bills/expenses.
- Voiding does not post a counter-entry: `acc_void_invoice` flips the entry to `status = 'void'` and reports read `posted` entries only. So a voided document leaves its lines in `acc_journal_line` forever — never assert that a test run returns the journal *row count* to its opening value, only the reported figures.
- The end-to-end test consumes invoice numbers. Numbers are never reused after posting or voiding, so each run leaves a gap in the sequence. That is correct behaviour, not a defect.
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, `Input.TextArea`, …). antd ships `"use client"`, so the server gets client-reference proxies and reading a static property off one throws at render time. Plain components (`Button`, `Card`, `Alert`, `Row`) are fine. Put the markup in a `"use client"` component and keep `page.tsx` a thin server wrapper. Guarded by `tests/unit/rsc-antd.test.ts`.

## 5. Things NOT to do
- Never force-push to `main`.
- Never disable RLS "just to test".
- Never duplicate business logic in the frontend or in a "mock" path (Part 14).
- Never trust client-sent totals — recompute server-side.
- Never swallow an error (empty catch, ignoring `{ error }`).
