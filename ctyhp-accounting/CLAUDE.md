# One Book — AI working rulebook

The product is called **One Book** in everything a user sees. `ctyhp-accounting`
survives as the repository folder, package name and Vercel project — renaming
those would change the deployment URL, so it was deliberately left alone. CTYHP
also remains the *company* whose books these are; do not rewrite company or
customer names.

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
- UI change: also run `scripts/smoke-pages.mjs`. The four gates above all pass on a page that throws at render time. Run it **against the built server, never `npm run dev`**:
  ```
  npm run build          # ~47s
  npm start              # serves the build
  node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000   # 48 pages, ~16s
  ```
  A dev server compiles each route on its first request (30–100s *per page*), which turns this into half an hour. While iterating, check one screen with `--only=invoices,sales-tax` (leading slash optional — Git Bash rewrites `/invoices` into a Windows path); run the full sweep before committing. Against a dev server add `--concurrency=1`.
- Ledger integrity: `node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts tests/e2e/gl-posting.e2e.ts` is read-only and asserts that no live document is missing its journal entry and that all six control accounts tie to their subledger. Run it after anything that changes how a document posts.
- Posting logic: `npm run test:e2e:document-ledger-report` runs over HTTPS as a signed-in administrator, so it works from networks where the Postgres port is blocked. It writes to the real database and asserts every reported figure returns to its opening value; a failure naming a moved figure means the run left residue — clear it with `scripts/cleanup-test-ledger.mjs`.
- Money logic: add/adjust a unit test with concrete input/output in `tests/unit/`; never verify by "looks right in the UI".
- Posting builders must assert `debit == credit` (`assertBalanced`).

## 3. Architecture & where logic lives
- Double-entry ledger is the single source of truth; all balances/reports derive from `acc_journal_line`.
- Pure accounting rules: `lib/domain/` (`posting.ts`, `money.ts`, `accounts.ts`, `reports.ts`, `reconciliation.ts`).
- Financial writes: `lib/services/*` → atomic Postgres RPC (`supabase/migrations/*`). No SQL in components.
- Input validation: Zod in `lib/domain/schemas.ts`. Server Actions in `app/(app)/*/actions.ts` guard by role.
- `created_by`/`created_at`/`updated_by`/`updated_at` on a transaction table are written by the `acc_stamp_actor()` trigger (migration 0064). Never set them from application code, and never assume an update can change the creation stamps — the trigger puts them back.
- Document numbers come from `acc_sequence` inside the issuing RPC. Since migration 0066 they are write-once and a numbered document cannot be deleted from an application session (`acc_guard_document_number()`); test or maintenance cleanup must use the service role, and a number it frees belongs in `acc_number_gap_note`. Register a new numbered document type in `acc_number_source` so it appears in the sequence report.
- Every subledger is reconciled to its control account by `acc_control_reconciliation` (migration 0073), and `acc_close_period` refuses to close a period over a variance it reports. **Adding a new subledger means adding a row to that function** — otherwise the new balances are outside the only check that runs at month end, and the close gate will pass a period it has not actually verified.
- `acc_close_period` takes **three** arguments since migration 0074 (`p_period_id, p_reason, p_variance_note`); the two-argument form was dropped on purpose so an out-of-date caller fails loudly instead of closing without the gate.
- A bill snapshots its vendor's payment terms when it posts (`acc_apply_vendor_terms`, migration 0075): due date, discount date, discount amount. Never re-read the vendor's current terms to judge an existing bill — terms change, and the bill keeps the ones it was raised under. The same rule governs customer credit terms.
- An early payment discount posts a third leg to `7010 Purchase Discounts Taken`; every rule about when it may be taken is in `acc_pay_bills`, not in the screen. A discount claimed after its window is money the vendor will still ask for.
- DO NOT re-implement a posting/money/tax rule anywhere else (Part 14).

## 4. Gotchas / past mistakes (append when a bug recurs)
- Postgres enums: you cannot `ALTER TYPE ... ADD VALUE` and then use the new value in the same transaction/migration. Add the value in one migration, use it in the next.
- Money is minor units end-to-end; only convert to decimal at the UI edge using the currency's `decimal_places`.
- US market: purchase-side tax is part of expense cost — no recoverable input tax, no separate tax line on bills/expenses.
- Running `npm run build` and then `npm run dev` over the same `.next` makes every *nested* route (`/reports/*`, `/settings/*`, `/banking/overview`) return 404 in dev while single-segment routes still work. It looks exactly like a routing regression and is not one. Delete `.next` before starting a dev server after a build. (`npm start` reads the build it belongs to and is unaffected — that is the smoke path.)
- Killing a dev server mid-write leaves a truncated `.next/dev/types/*.ts`, and the next `npm run typecheck` fails inside those generated files. Delete `.next` and re-run; nothing is wrong with the source.
- Voiding does not post a counter-entry: `acc_void_invoice` flips the entry to `status = 'void'` and reports read `posted` entries only. So a voided document leaves its lines in `acc_journal_line` forever — never assert that a test run returns the journal *row count* to its opening value, only the reported figures.
- The end-to-end test consumes invoice numbers. Numbers are never reused after posting or voiding, so each run leaves a gap in the sequence. That is correct behaviour, not a defect.
- `Invariant: The client reference manifest for route "…" does not exist` from `npm start`, on routes you did not touch, means the build was made over a stale `.next` (often one a running server still held). Stop the server, delete `.next`, rebuild. It is not a bug in the page.
- Do not run `scripts/smoke-pages.mjs` and the HTTPS end-to-end suite at the same time. Both sign in as the same account, and the sign-ins invalidate the session cookie the smoke script captured once at start: every page after that returns 307 to `/login` and reads as a wall of failures that are nothing to do with the pages.
- A trigger that has to tell an application session from an RPC must be `security invoker`. Inside a `security definer` function `current_user` is the function's owner, so a check like `current_user = 'authenticated'` never matches and the guard silently passes everything (migration 0066, fixed by 0067).
- A Server Component must not read an Ant Design *sub*-component (`Typography.Title`, `Form.Item`, `Input.TextArea`, …). antd ships `"use client"`, so the server gets client-reference proxies and reading a static property off one throws at render time. Plain components (`Button`, `Card`, `Alert`, `Row`) are fine. Put the markup in a `"use client"` component and keep `page.tsx` a thin server wrapper. Guarded by `tests/unit/rsc-antd.test.ts`.

## 5. Things NOT to do
- Never force-push to `main`.
- Never disable RLS "just to test".
- Never duplicate business logic in the frontend or in a "mock" path (Part 14).
- Never trust client-sent totals — recompute server-side.
- Never swallow an error (empty catch, ignoring `{ error }`).
