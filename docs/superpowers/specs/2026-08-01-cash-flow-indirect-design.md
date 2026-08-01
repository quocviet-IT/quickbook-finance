# Indirect Cash Flow Statement and Close Reconciliation

- **Date:** 2026-08-01
- **Status:** Approved for implementation
- **Issue:** #8 — Cash Flow Bridge Missing

## Goal

Replace the report's three-total direct-method presentation with an indirect
Statement of Cash Flows that explains the movement from beginning cash to
ending cash and refuses to present an apparently clean result when cash-flow
classification is incomplete.

The posted general ledger remains the single source of truth for every amount.
All values stay in base-currency minor units until the UI formats them.

## Accounting model

The statement uses this signed equation:

`Beginning cash + CFO + CFI + CFF = Ending cash`

Operating cash flow starts with net income and presents these adjustments:

- depreciation and amortization;
- gain or loss on fixed-asset disposal;
- changes in accounts receivable;
- changes in inventory;
- changes in accounts payable;
- changes in other explicitly classified operating assets and liabilities.

Investing and financing sections remain cash-transaction based. Fixed-asset
cash purchases and sale proceeds are investing. Borrowings, principal
repayments, owner contributions, and owner distributions are financing.
Bank-to-bank transfers are excluded. Noncash investing and financing entries
are disclosed through classification/reconciliation status rather than added
to cash movement.

## Classification model

`acc_account.cash_flow_role` is the durable chart-of-accounts policy used by
the report. Supported roles distinguish scoped cash, indirect working-capital
drivers, investing, financing, operating P&L accounts, excluded accounts, and
unclassified accounts.

Existing accounts are backfilled conservatively:

- `bank` -> cash;
- A/R -> operating receivable;
- inventory accounts referenced by inventory items -> operating inventory;
- A/P -> operating payable;
- fixed asset -> investing;
- equity and credit card -> financing;
- P&L accounts -> operating;
- other current assets/liabilities -> unclassified until an accountant chooses
  operating asset, operating liability, investing, financing, or exclude.

The Accounts screen exposes the role. A new account receives a deterministic
default from its account type; ambiguous current assets and liabilities default
to unclassified. The report never silently guesses those accounts.

Transaction context overrides the account fallback where the account alone is
not sufficient. Asset disposals use the full cash proceeds as investing and
reverse the disposal gain/loss from operating cash. Bill payments are traced
back to their bill-line classifications; a mixed or unapplied amount that
cannot be allocated exactly is reported as unclassified rather than forced
into Operating.

## Data and service boundaries

Migration `0081_cash_flow_indirect.sql` adds the account policy, a detailed
read-only ledger RPC, a summary RPC, and a period-close snapshot table. The
detailed RPC is the only SQL implementation of classification. The summary RPC
groups that detail and adds beginning/ending scoped cash.

`lib/domain/cashflow.ts` owns statement assembly, signed totals, and the exact
reconciliation test. `lib/services/cashflow.ts` maps the RPC result into the
domain model. Components only format and render returned values.

The existing `acc_cash_flow` direct-method RPC remains available for backward
compatibility, but the user-facing Cash Flow Statement uses the indirect RPC.

## UI

The report shows ordered Operating, Investing, and Financing sections followed
by net change, ending cash per statement, Balance Sheet cash, and difference.
Each component line shows its journal count and can expand to its journal-entry
details. A success state requires both a zero-cent difference and zero
unclassified cash-flow entries. Otherwise the page shows a high-visibility
warning with the amount/count that requires review.

The dashboard keeps its current cash-flow bridge and consumes the new section
totals. The Accounts screen adds the cash-flow role selector and status column.

## Month-close control

`acc_period_close_blockers` adds a cash-flow blocker when the period statement
does not reconcile or contains unclassified entries. The existing written
override remains available. On close, One Book stores the generated cash-flow
snapshot, classification version, closing user, and reconciliation status for
the audit trail.

## Error handling and security

The report RPCs remain read-only and run with the caller's RLS context. The
snapshot table has read RLS and no direct client write policy; only the period
close RPC writes it. Account-role changes use the existing authenticated,
authorized account write path. Database and action errors are surfaced and are
never converted into fake zero balances.

## Definition of done

- The indirect statement includes all required operating drivers and signed
  CFI/CFF totals.
- Ending cash per statement equals scoped Balance Sheet cash to the cent for a
  completely classified fixture.
- Asset disposal shows full proceeds in Investing and reverses gain/loss in
  Operating.
- Loan principal, owner flows, bank transfers, depreciation, A/R, inventory,
  A/P, ambiguous accounts, and mismatch behavior have concrete tests.
- A period with a difference or unclassified cash flow is blocked unless the
  existing written override is supplied, and closing stores a snapshot.
- Build, unit tests, typecheck, lint, built-server smoke pages, and the ledger
  integrity suite pass before completion.

## Scope limits

This change does not add foreign-exchange cash-flow presentation, a standalone
cash-flow approval workflow, or a claim that accounting review has certified
ASC 230 compliance. It provides the mechanics and audit evidence needed for
that review.
