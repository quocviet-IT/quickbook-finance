# Large Module Feature-Slice Refactor Design

**Date:** 2026-08-04  
**Status:** Approved in conversation  
**Scope:** Structural refactor only; no user-visible or accounting behavior changes

## Problem

Four modules have grown beyond the project's 400-line context ceiling and mix
several responsibilities:

| Module | Current size | Main responsibilities mixed together |
| --- | ---: | --- |
| `lib/services/work-area-overviews.ts` | 1,567 lines | Queries, aggregation, presentation mapping for five work areas |
| `app/(app)/fixed-assets/FixedAssetsClient.tsx` | 1,478 lines | Filtering, registration, depreciation, import, disposal, attachments, rendering |
| `app/(app)/banking/BankingClient.tsx` | 994 lines | Account selection, feed sync, Plaid, statement import, review, settlement, rendering |
| `app/(app)/invoices/InvoicesClient.tsx` | 948 lines | Invoice creation, customer creation, issue/void, credit override, details, audit, rendering |

The size and mixed responsibilities increase regression risk because a change to
one use case requires editing a file that also owns unrelated state and behavior.

## Goals

- Reduce each of the three Client façade files below 400 lines.
- Keep every newly extracted TypeScript/TSX file in the four target feature
  areas below 400 lines.
- Separate use-case state and effects, forms/modals, tables, pure transforms,
  and overview query adapters.
- Preserve existing routes, page props, exports, Server Actions, permissions,
  RPC calls, accounting rules, copy, and visible interaction behavior.
- Add characterization and boundary tests that make structural regressions and
  accidental behavior changes easier to detect.
- Deliver four independently reviewable phases and commits.

## Non-goals

- No visual redesign or copy rewrite.
- No changes to database schema, migrations, RLS, permissions, RPCs, posting,
  tax, credit, depreciation, reconciliation, or document numbering rules.
- No generic form/table framework shared across unrelated business areas.
- No changes to existing public import paths unless a compatibility façade
  continues to expose the same API.
- No refactor of other large files such as `RecurringClient.tsx` or
  `ReportsClient.tsx` in this program.

## Chosen Approach

Use feature slices rather than a global abstraction layer. Each business area
owns focused components, hooks, types, and pure helpers close to its route.
Existing Client filenames remain as stable façades. The overview service keeps
its current public module path and re-exports focused area implementations.

This favors explicit dependencies and local reasoning over maximizing reuse.
Shared code is extracted only when two consumers already need the same behavior.

## Phase 1: Fixed Assets

Create route-local modules under `app/(app)/fixed-assets/`:

- `fixed-assets.types.ts`: Client props and form/view types.
- `fixed-assets.constants.ts`: categories and status presentation metadata.
- `fixed-assets.utils.ts`: account options, ISO-date validation, import template,
  and pure display/conversion helpers.
- `use-asset-registration.ts`: registration form lifecycle and bill prefill.
- `use-depreciation.ts`: schedule loading, single posting, batch selection/posting.
- `use-fixed-asset-import.ts`: CSV parsing, validation state, template download,
  and import submission.
- `use-asset-disposal.ts`: disposal form, schedule loading, preview, submission.
- Focused components for the asset table, summary/filter area, registration
  form, depreciation schedule/posting, import, and disposal.

`FixedAssetsClient.tsx` will retain only cross-use-case coordination, attachment
drawer state, and composition of the extracted components.

## Phase 2: Banking

Create route-local modules under `app/(app)/banking/`:

- `banking.types.ts`: Plaid, imported-row, and Client prop contracts.
- `banking.constants.ts` and `banking.utils.ts`: status metadata, sentinel values,
  currency/sync formatting, and pure mapping helpers.
- `use-bank-review.ts`: selected account, queue loading/filtering, suggestion
  generation, approve/reject, and settlement target state.
- `use-plaid-link.ts`: token creation, OAuth resume, account mapping, connection,
  and feed synchronization.
- `use-statement-import.ts`: file parsing, preview state, and import submission.
- Focused components for account navigation, review table, Plaid mapping,
  statement import, and ledger-account creation.

`BankingClient.tsx` will compose these slices and own only state that connects
them, such as the selected account and attachment drawer target.

## Phase 3: Invoices

Create route-local modules under `app/(app)/invoices/`:

- `invoices.types.ts`: Client props, form line, and modal/view state contracts.
- `invoices.constants.ts` and `invoices.utils.ts`: status presentation and pure
  directory/tax/filter/preview helpers.
- `use-invoice-editor.ts`: create form lifecycle, defaults, totals, customer
  credit preview, and submission.
- `use-invoice-lifecycle.ts`: issue, credit override, void, and PDF operations.
- `use-invoice-details.ts`: lines, audit trail, and settlement history loading.
- Focused components for the invoice table, editor, customer creation, credit
  override, details/audit, and existing write-off integration.

`InvoicesClient.tsx` will keep route-level filtering, modal coordination, and
composition. Existing monetary calculations continue to call domain utilities;
they are not reimplemented in hooks or components.

## Phase 4: Work-Area Overviews

Keep `lib/services/work-area-overviews.ts` as the compatibility façade exporting:

- `WorkAreaOverviewContext`
- `WorkAreaOverviewError`
- `getWorkAreaOverviewContext`
- `getSalesOverview`
- `getPurchasesOverview`
- `getBankingOverview`
- `getInventoryOverview`
- `getAccountingOverview`

Move implementation into `lib/services/work-area-overviews/`:

- `context.ts`: company date/currency/fiscal context.
- `shared.ts`: status labels, activity ordering, trend windows, breakdowns, and
  money labels.
- `sales.ts`, `purchases.ts`, `banking.ts`, `inventory.ts`, `accounting.ts`: one
  use case per work area.
- Query adapters local to each area load the required records through existing
  service functions. Mapping functions transform the query result and context
  into `WorkAreaOverviewData` without reading from the database.

The page modules retain their current imports from
`@/lib/services/work-area-overviews`, so this phase has no caller migration.

## Data Flow and Boundaries

### Client screens

1. `page.tsx` authenticates, resolves the company schema, loads data, and passes
   the same props as today.
2. The Client façade initializes use-case hooks and composes view components.
3. Hooks call the existing route-local Server Actions and own loading/error/form
   lifecycle for one use case.
4. View components receive typed data and callbacks. They do not query Supabase,
   invoke RPCs directly, or contain accounting rules.
5. Existing Server Actions remain the security and mutation boundary.

### Work-area overviews

1. The page resolves the schema-bound Supabase client and shared overview context.
2. The area function invokes its query adapter, which calls existing services.
3. A mapper builds the established `WorkAreaOverviewData` contract.
4. `WorkAreaOverview` renders the unchanged contract.

## Error Handling

- Preserve existing user-facing success and error messages.
- Preserve action result handling and navigation/refresh behavior.
- Hooks must reset busy/loading state in `finally` blocks.
- Errors from query adapters must retain the existing
  `WorkAreaOverviewError` semantics and page behavior.
- No empty catches or partial-success behavior may be introduced.
- Extraction must not weaken permission checks or move trusted calculations to
  the browser.

## Testing Strategy

Before each extraction, add characterization tests for the behavior being moved.
The phase then follows a move-and-green cycle: extract the smallest unit, update
imports, run focused tests, and continue only when green.

Coverage includes:

- Pure utility tests for filters, import parsing/validation, status mapping, and
  overview mappers with concrete inputs and outputs.
- Controller/adapter tests with mocked Server Actions or service dependencies for
  success, failure, and loading cleanup.
- Compatibility tests proving overview exports and returned data shapes remain
  unchanged.
- Architecture test enforcing the 400-line ceiling for the three Client façades
  and every newly extracted file in the four target feature areas.
- Existing domain tests remain authoritative for money and accounting rules.

After every phase, run its focused tests plus typecheck. Before final completion,
run the mandated full suite:

1. `npm test`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. Full built-server `scripts/smoke-pages.mjs` sweep because three UI routes are
   structurally changed.

## Delivery and Rollback

Implement in this order: Fixed Assets, Banking, Invoices, Work-Area Overviews.
Each phase is a separate commit and must leave the branch green. Because public
contracts remain stable, any phase can be reverted independently without
requiring a database rollback or reverting later unrelated phases.

## Acceptance Criteria

- All four phases are implemented in the agreed order.
- `FixedAssetsClient.tsx`, `BankingClient.tsx`, and `InvoicesClient.tsx` are each
  below 400 lines.
- Every newly extracted file in the four target feature areas is below 400 lines.
- Existing pages, interactions, action calls, permissions, and overview outputs
  remain behaviorally equivalent.
- No business/accounting rule is duplicated in UI code.
- Focused characterization tests and the architecture ceiling test pass.
- Full tests, typecheck, lint, build, and the built-server smoke sweep pass with
  no new errors or warnings.
