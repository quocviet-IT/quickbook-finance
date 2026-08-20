# OneBook What-If Financial Analysis and Frozen Reports

- Date: 2026-08-20
- Status: Design accepted, ready to implement
- Scope: a new `/reports/analysis` screen, one migration, one pure-domain module
- Implementation plan: `docs/superpowers/plans/2026-08-20-what-if-analysis-frozen-reports.md`

## 1. Document purpose

This document records why the feature exists, the design decisions taken, and
the guarantees the implementation must keep. The step-by-step build order,
file list, and test code live in the implementation plan named above; this
document is the reference the plan answers to.

## 2. The request

Feedback relayed from the owner (2026-08, verbatim, lightly trimmed):

> "we can use data and do a financial analysis. meaning it will not be saved
> on the data which is used as data for the report … for example even
> [changing] p&l margins, we can see if the adjustment makes sense or works
> [through the] bottom [line] and sheets … actually we can save it as a
> report, as a frozen report, as a capture report but it does not save to the
> data because it's just an analysis data."

The same message carried two other asks, resolved separately:

1. **Year-over-year comparison reports** — already shipped: the `/reports`
   screen has P&L "Two periods" (a full-year range compares against the full
   prior year), By month / By quarter columns, and Balance Sheet
   single / comparison / months / last-3-years, with Current / Prior /
   $ Variance / % Variance columns.
2. **Custom report row layouts in Settings** — a separate feature, not in
   this document's scope. When taken up, its core rule is already agreed:
   every account appears in exactly one custom row, so a custom layout's
   totals always tie to the standard report.

This document covers ask #3 only: what-if analysis with frozen reports.

## 3. What the feature is

A workspace where a user:

1. picks a period and loads the real P&L and Balance Sheet;
2. adds **hypothetical adjustments** — each one a balanced set of account
   deltas (debits = credits), the same shape as a journal entry but never
   posted anywhere;
3. reads the result in three columns — **Actual | Adjustment | Adjusted** —
   for both statements, and sees that both sheets remain balanced;
4. optionally **freezes** the scenario: a write-once snapshot holding the
   assumptions and the report they produced, listed on the same screen and
   viewable later exactly as it was.

## 4. Why the ledger architecture makes this cheap

`buildBalanceSheet` derives its "Current earnings" equity line from the same
`LedgerBalance[]` rows it renders (`lib/domain/reports.ts`). Therefore a
balanced adjustment applied to those rows flows from the P&L into equity with
no additional bookkeeping, and the adjusted sheet balances by construction.
The what-if engine is a small pure function over data structures that already
exist; no report builder is duplicated (guidebook Part 14).

## 5. Design decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | v1 covers **P&L + Balance Sheet** only | The accounting equation ties them automatically. Cash flow needs activity classification that a bare adjustment does not carry; it can follow later without rework. |
| 2 | An adjustment is a **balanced set of signed account deltas** (positive = debit, negative = credit), at least two lines | The minimal unit that keeps the sheet balanced — the requester's own test ("works through the bottom line and sheets") falls out of the ledger's arithmetic instead of being re-implemented. |
| 3 | Frozen reports are **write-once**: no edit, archive only | A "capture report" that can be edited afterwards is not a capture. Iterating = load a frozen report's assumptions back into the workspace and freeze a new one. |
| 4 | **Permissions**: any signed-in member may run the workspace and read frozen reports (`acc_current_role() is not null`); freezing and archiving require staff (`acc_is_staff()` in the RPC, `canWrite()` in the action) | The gate names exactly what the server enforces, per the rulebook. |
| 5 | The frozen snapshot is **recomputed server-side** from (period, adjustments); the client's rendering is display-only | "Never trust client-sent totals" (CLAUDE.md §5). |
| 6 | Storage is one table, `acc_financial_analysis` (migration 0115), jsonb `adjustments` + jsonb `snapshot`, size-capped, **no insert/update/delete policy** — writes only via two security-definer RPCs | Same containment pattern as `acc_saved_report` (0101): an application session cannot smuggle a row in. |

## 6. Guarantees the implementation must keep

1. **Nothing in this feature writes to `acc_journal_*` or calls
   `acc_post_entry`.** This is the requester's central sentence ("it does not
   save to the data") and is proven by `scripts/verify-financial-analysis.mjs`,
   which freezes an analysis inside a rolled-back transaction and asserts the
   journal row count is unchanged — the migration comment claims it, the
   script proves it.
2. **An unbalanced adjustment cannot exist**: rejected in the UI
   (`validateAdjustment`), in the freeze schema (Zod refinement), and the
   adjusted Balance Sheet's `balanced` flag is displayed as a trust device.
3. **Every rendering carries the banner** "What-if analysis — not the books"
   so a frozen scenario can never be mistaken for a financial statement.
4. The migration reaches every company schema (`scripts/migrate.mjs` loops the
   register) and passes `verify:company-provisioning`.

## 7. Out of scope (v1)

- Cash flow what-if (needs activity classification on adjustments).
- Custom report row layouts (ask #2 — its own future spec).
- Percentage-style inputs ("gross margin = 40%") — v1 takes amount deltas;
  a percentage helper can compute a delta client-side later without touching
  the storage shape.
- Export of a frozen report to PDF/Excel — follow `report-export.ts` patterns
  later if asked.

## 8. Acceptance criteria

1. On `/reports/analysis`, loading a year and adding a balanced revenue
   adjustment of +1,000.00 moves Adjusted net income by exactly +1,000.00 and
   Adjusted total assets and total equity by the same amount; both sheets
   show balanced.
2. An unbalanced adjustment cannot be saved in the editor; the error names
   both sides' totals.
3. Freezing stores a row visible in the frozen list; reopening it shows the
   same figures after the underlying books change (it is a photograph).
4. A viewer-role user can read the workspace and frozen reports but gets no
   Freeze or Archive controls, and the RPCs refuse them server-side.
5. `verify:financial-analysis` passes: freeze succeeded, journal untouched,
   direct INSERT refused by RLS, archive is once-only.
6. Full gate: tests, typecheck, lint, build, smoke (58 pages), changelog
   release entry.
