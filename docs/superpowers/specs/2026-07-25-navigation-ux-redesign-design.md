# Navigation and UX Redesign

- **Date:** 2026-07-25
- **Status:** Approved for implementation
- **Owner:** AI Team — CTYHP
- **Related:** every module spec in `docs/superpowers/specs/` (this cycle reorganizes what they
  built), `US_ACCOUNTING_USER_MANUAL/`

## 1. Problem

The sidebar grew one leaf per page as modules landed: 8 groups and roughly 35 leaves, with 10
reports and 8 settings pages listed individually. Navigation now mirrors the *database* rather than
the *work*, so finding anything means scanning a long tree. Three specific faults:

- **Reports and Settings are exploded into the sidebar** instead of having an index page.
- **Exception lists are treated as destinations.** "Received Not Billed" is a control report, not a
  place you go to work.
- **Approvals occupies a top-level slot** while being a queue that is empty most of the time.

Two page-level faults observed with it: the Approvals page renders two empty tables without saying
why it is empty, and the Approval Policies page lets an admin enable segregation of duties when only
one user could ever approve — which silently deadlocks the guarded action.

## 2. Information architecture

Money-flow model (QuickBooks-like), eight top-level entries:

```
Dashboard
Sales        Invoices · Payments · Credit Memos · Customers
Purchases    Bills · Expenses · Purchase Orders · Pay Bills · Vendor Credits · Vendors
Products     Products & Services · Inventory Valuation
Banking      Bank Transactions · Reconcile
Accounting   Chart of Accounts · Journal Entries · Sales Tax · Opening Balances
Reports      -> Report Center
Settings     -> Settings hub
```

Contacts stay inside the group where they are used (customers under Sales, vendors under Purchases)
rather than in a separate Contacts area: you edit a customer while working on their invoice.

Products is its own group because inventory now exists (Module G2) and a jewelry catalog is daily
work, not accounting configuration.

Removed from the sidebar:
- **Approvals** → a counted badge in the top bar plus the existing dashboard card. Route unchanged.
- **Received Not Billed** → listed in the Report Center under Payables, and linked from the
  Purchase Orders page. Route unchanged.
- **The 10 report links and 8 settings links** → the two hub pages below.

## 3. Report Center (`/reports`) — already built, so this cycle only stops duplicating it

A check of the current code found the Report Center **already exists**: `/reports` renders
`components/reports/ReportsHub.tsx` from the pure catalog `lib/domain/report-catalog.ts` (14
reports in five groups — business overview, receivables, payables, accounting, inventory and tax),
and `?report=<id>` runs the statement engine (Trial Balance, P&L, Balance Sheet, Budget vs Actual,
Statement of Equity) with PDF/XLSX export. That landed in commit `3e042d5`.

So nothing is rebuilt here. The redesign's only job for reports is to **stop the sidebar from
duplicating the hub**: the ten individual report links come out of the sidebar and `Reports` becomes
one entry pointing at the hub. Splitting the statements into separate routes is dropped — the hub
already deep-links each one through `?report=`, so separate routes would add churn without adding
capability.

## 4. Settings hub (`/settings`)

A new index page with grouped cards:
- **Company** — Company profile, Accounting Periods, Opening Balances
- **People and control** — Users, Permissions, Approval Policies, Audit History
- **Purchasing** — Purchasing Tolerances

Opening Balances moves out of the sidebar into this hub (it is a one-time setup task).

## 5. Top bar

Page title · global search · **+ New** · Approvals badge · account menu.

- **Global search** — one RPC `acc_global_search(p_query, p_limit)` over document numbers
  (invoice, bill, purchase order, expense, customer payment, bill payment), customer and vendor
  names, and item name/code. Returns `kind, id, label, sublabel, href`.
  **Deliberately not `security definer`**, so RLS applies and a suspended user finds nothing —
  the search must not become a hole in the access control Module C built.
- **+ New** — Invoice, Payment, Bill, Expense, Purchase order, Journal entry. The create forms are
  modals on list pages today, so New navigates to the list route with `?new=1` and the page opens
  its own modal. No form is rewritten and no logic is duplicated.
- **Approvals badge** — pending count, from the count the dashboard already computes.

## 6. Page template and density

Accounting work means reading many rows at once, so the template is one compact block rather than
nested cards:

- `PageHeader` puts the title and the primary action on one row.
- `FilterBar` sticks to the top of the scroll area.
- `DataTable` defaults to `size="small"`; card padding tightens.
- The sidebar keeps its dark theme with tighter spacing and a clearer active state.

## 7. The two page-level fixes carried in this cycle

- **Approvals empty state** — when nothing is pending, say why: no policy enabled links to
  Settings → Approval Policies; policies enabled but nothing submitted says so instead of showing
  an empty grid.
- **Approval Policies guard rail** — enabling a policy with segregation of duties while fewer than
  two users could approve shows a warning that the action will be blocked for everyone, with the
  count. The server rule does not change; this is the missing explanation. (Observed live: four
  policies were enabled with a single active user, which would have deadlocked manual journals,
  inventory adjustments, period reopens, and write-offs.)

## 8. Out of scope
- Consolidating list pages into tabbed workspaces (fewer routes) — the sidebar reorganization
  removes the chaos without rewriting 20 pages.
- A Ctrl+K command palette; the visible search covers discovery.
- Saved/favourite reports (US-FR-104) and report scheduling.
- Any change to accounting logic, RPCs, or posting behaviour. **No migration touches an existing
  function**; the only new SQL is the read-only search.

## 9. Testing
- **Unit** (`tests/unit/navigation.test.ts`): the nav tree contains no duplicate route and every
  leaf route exists in the app's route list; `NAV` no longer carries any `/reports/*` leaf (the hub
  owns those); the settings hub lists every `/settings/*` route that exists, so a new settings page
  cannot go missing; `searchKindLabel` labels every kind the search returns and degrades on an unknown
  one instead of throwing (the RPC supplies each result's href, so there is no second copy of the
  routing to test); every New-menu item targets a route with `?new=1`.
- **E2E** (`scripts/verify-search.mjs`): seed a customer, an invoice and a vendor; assert
  `acc_global_search` finds each by number and by name, that the limit is honoured, and that a
  **suspended** user gets zero rows (RLS still applies). Self-cleaning.
- Full `npm run build && npm test && npm run typecheck && npm run lint` clean.

## 10. Build sequence
1. Migration `0042`: `acc_global_search` (read-only, invoker rights).
2. `lib/domain/navigation.ts` (nav tree, settings hub catalog, search-kind mapping, New menu) +
   unit tests, tests first.
3. Shell: new NAV tree, top bar with search / New / approvals badge; `layout.tsx` passes the
   pending count.
4. Settings hub index at `/settings`.
5. `?new=1` handling on the six list pages.
6. Density and template CSS.
7. Approvals empty state + Approval Policies warning.
8. `scripts/verify-search.mjs`; full gate.

## 11. Migration bookkeeping fixed on the way
`0041_reporting_upgrade.sql` was applied to the database outside `scripts/migrate.mjs`, so it had no
row in `acc_schema_migrations` and every later `migrate.mjs` run failed on "relation acc_budget
already exists". Every object it declares was verified present (both tables, the index, both
policies, both functions, the `budget.manage` permission) and the file is now recorded as applied.
The search migration was renumbered `0042` so no two migrations share a prefix.
