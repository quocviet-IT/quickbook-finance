# Reproducing the prototype "Accounting System 2.28" in OneBook — inventory and roadmap

**Date:** 2026-10-02
**Branch:** `feat/parity-228` (from `main` at 1.77)
**Status:** roadmap; each sub-project gets its own spec, plan and release.

## 1. What is asked

The client's request, in their words, is to "copy and implement the exact accounting software currently built in the
Claude Artifact" — the single-file prototype *Accounting System 2.28* — into OneBook: its workflow, features,
calculations, interface, reports and transaction handling. The prototype is the tested working version; the goal is to
reproduce it, not reinterpret it. After implementation the two must be compared and tested so that the workflow,
calculations, reports and user experience are shown to match.

The user confirmed on 2026-10-02: proceed, and bring the interface and experience to a **similar** level as the
prototype (section 5 says what that means here).

## 2. How the gap was measured

Six read-only agents compared the prototype's source (62 parts, ~800 KB of code, 39 releases 1.0–2.28) with OneBook's
code, area by area, citing file and line on both sides. The full tables stay outside this repository because the
prototype ships with a real client's books and the notes name them; this document keeps only what is needed to plan.

| Group | Prototype parts | Areas | Same | Mostly | Partial | Missing | Different by design |
|---|---|---|---|---|---|---|---|
| A — ledger, reports, output, shell | p1–p6c, p11–p17, p22 | 26 | 11 | 8 | 0 | 2 | 5 |
| B1 — bank import, coding, pairs, cards, loans, intercompany | p8–p10, p19–p20d | 15 | 2 | 8 | 3 | 0 | 2 |
| B2 — reconciliation, reading statements, detectors | p23–p24b, p44–p45 | 9 | 0 | 2 | 2 | 4 | 1 |
| C — business modules | p14, p18, p25–p29, p32, p35, p36, p42 | 11 | 0 | 3 | 5 | 0 | 3 |
| D1 — analysis and group views | p30, p31, p33, p34, p37–p39 | 10 | 2 | 1 | 3 | 3 | 1 |
| D2 — close, deferrals, guide, actions | p40, p41, p43, p21, p7 | 8 | 0 | 1 | 2 | 1 | 4 |
| **Total** | | **79** | **15** | **23** | **15** | **10** | **16** |

The core statements (P&L, Balance Sheet, Trial Balance, ageing, QuickZoom, Compare, Beancount, coding that learns,
working trial balance) already match — the 1.66 redesign followed the prototype's report layout. The gaps concentrate in
modules OneBook never built, in a handful of screens built differently, and in the prototype's statement-reading tools.

## 3. Not reproduced, by design

These exist in the prototype only because it is a single file running in one browser with no server or users. A
literal copy would remove protections OneBook's users rely on:

- Data in browser `localStorage`, seeded books, "shared books" synced as one JSON document, "take the shipped copy
  again" — OneBook keeps one copy per company in Postgres.
- Deleting a posted entry into a bin — OneBook voids it and keeps the audit trail.
- "Unlock and edit the original entry" in a closed period — OneBook refuses this in the database; a correction is a
  reversal into an open period.
- Creating an account by typing an unknown name while posting — OneBook posts only to accounts that exist.
- One global event dispatcher, file saving through the clipboard, one-page navigation — framework details.
- Periodic inventory — OneBook keeps perpetual weighted-average cost, with the residual rule.
- Writing entries into another company's books — 1.77 records one side; the two-book mirror waits for the client's
  answer on the three named companies.

## 4. Calculations that can differ for the same input

Each becomes a parity test. The default resolution is listed; any the client wants otherwise is changed in the
sub-project that owns it.

| Difference | Prototype | OneBook | Default |
|---|---|---|---|
| Rounding a negative exact half-cent | toward +∞ (`Math.round`) | away from zero | Keep OneBook (symmetric); document the one-cent edge case |
| General Ledger running balance on credit accounts | raw sign, grows negative | flipped to its normal side | Follow the prototype on the GL report |
| Cash-basis reports | every report has "Cash movements only" | accrual only | Ask the client before building (large) |
| "This year / month / quarter" presets | run to period end | run to today | Keep OneBook; label it |
| Previous-year date on 29 February | lands on 1 March (bug) | correct | Keep OneBook |
| Budget for part of a month | prorated by days | whole month or nothing | Follow the prototype |
| 13-week cash | today's cash + AR − AP + recurring, as a balance | AR − AP flow with learned lag | Follow the prototype's balance; keep the lag as an option |
| 1099 paid | bank payments only, card warning | all payments | Follow the prototype (card excluded, warned) |
| Sales tax collected | any posting to income with a tax leg | invoice lines with a tax code | Follow the prototype, keep tax codes |
| Duplicate entries | per leg account + amount | entry amount + account set | Follow the prototype |
| Cheque number reused | any bank posting with a reference | payments only | Follow the prototype |
| Statement pairing window | 5 days | up to 30 days, scored | Ask with the reconciliation sub-project |
| Transfer window | 5 days (own setting) | 7 days, shared with funding | Separate the two settings |
| Year-end | posted closing entry to Retained Earnings | computed live | Ask (affects Retained Earnings detail) |
| Inventory value between counts | periodic | perpetual WAC | By design (section 3) |

## 5. Interface and experience: what "similar" means

- **Same steps and words.** Each workflow follows the prototype's sequence and its labels, buttons, empty states and
  explanatory sentences, translated into OneBook's components.
- **Same report pages.** Reports keep the prototype's paper layout, sections, totals, proof lines and footers (as
  1.66 did for the statements), with QuickZoom on every figure, Compare, and Copy / CSV / PDF / Excel / Print.
- **Same places.** Every prototype tab has a destination: Today → Dashboard; Company → Settings; Chart of Accounts →
  Accounts; Transactions → Journal and the document screens; Bank Import and Reconcile → Banking; Reports → Reports;
  Beancount → Reports › Beancount. OneBook's sidebar, company switcher, approvals, roles and dark mode stay.
- **Proven by pictures.** Each sub-project's approval page shows the prototype's screen beside OneBook's at 1440 and
  1280, light and dark. Prototype screenshots are taken on a local copy and never enter the repository.

## 6. Proving parity

- **Numbers.** A parity harness opens the prototype in a headless browser, lets it compute its own figures from its own
  book, and compares them with OneBook's figures for the same company: trial balance at each month end, P&L per year,
  Balance Sheet at each year end, ageing totals, and each module's report once built. Differences are sorted into
  *data* (an entry one side has and the other lacks — the prototype's books kept changing after OneBook loaded them on
  29 September) and *calculation* (same entries, different figure), the latter matched against section 4.
- **Workflow.** Each sub-project runs its screens end to end on the sample company, as 1.75–1.77 did.
- **Where it runs.** The harness code is generic and committed; the prototype file, its books, the account map and
  every result stay on the local machine.

## 7. Roadmap

Sizes: S ≈ a day, M ≈ 2–4 days, L ≈ a week or more of focused work. Each line is one release (1.78 onward) unless
marked as part of a group. Order inside a phase may change with the client's answers.

**Phase 0 — measure** (M)
- Parity harness and a baseline report of every figure that differs today, plus prototype reference screenshots for
  every tab.

**Phase 1 — finish the screens that exist** (mostly S)
1. Reconciliation: outstanding items, the "proves out" sentence and "changed since" alert on the report; history tags;
   print and CSV; tick all / clear; a default discrepancy account; "below zero since the last statement" panel.
2. Bank import: "not the same thing, add it"; separate transfer and funding windows; on/off switches for automatic
   pairing; escrow on loan payments; sign direction detected from the file; running balance offered as the closing
   figure.
3. Reports: Sales by Customer; Customer and Vendor Balance Summary; Expenses by Vendor; CSV on every report; General
   Ledger running-balance sign; guide search across release notes.
4. Documents and lists: invoice terms, payment note and email text; bill and receipt documents; recurring from any
   posted entry; 1099 card warning; reducing-balance depreciation; merge two accounts.

**Phase 2 — the accounting modules OneBook lacks** (M–L)
5. Prepayments and deferred income, with its report, proof and close step (L).
6. Year-end close (after the client's answer).
7. Financial ratios (M).
8. Classes and P&L by Class (M).
9. Budget: twelve-month grid, spread a year total, seed from actuals, day proration, month-by-month table, over-budget
   signal (M).
10. 13-week cash as a balance, with recurring entries and the lowest point (M).
11. Sales tax period table with opening and closing owed and the ledger check (M).
12. Open-item customer and vendor statements with ageing, print and email (L).
13. Month-end close: depreciation, prepayments, duplicates and future-dated steps, manual items, snapshot at close (M).

**Phase 3 — larger modules** (L)
14. Estimates and quotes, converting to invoices (L).
15. Today: the "waiting on you" list and other companies at a glance (L).
16. Consolidation with eliminations, and an intercompany balances check (L, after the client's answer).
17. Stock count sheet and the purchases roll-forward report (M each).
18. Cash-basis reporting, if the client needs it (L).

**Phase 4 — reading statements** (L)
19. CSV column guessing by shape and title-block trimming (M).
20. Splitting a long file into monthly statements that prove themselves (M).
21. PDF statements (L).
22. Reconciling a run of statements in one pass (L).
23. Running balance read as payments — the detector (M).
24. General-ledger import from other software with document inference (L).

## 8. Questions for the client, asked when their sub-project starts

1. Cash-basis reporting — needed?
2. Year-end — a posted closing entry, or the live split?
3. Statements — open-item instead of, or beside, the activity statement?
4. Classes — on the whole entry, or per line?
5. PDF statements — needed, or are CSV/OFX exports from the bank enough?
6. Consolidation — which companies form a group; does the two-book mirror come back?
7. Recurring — keep generating drafts automatically, or wait on a person as the prototype does?
8. Data — should OneBook's copies of the prototype's books be brought up to 2.28 before the parity run, or should the
   parity run compare like with like only?

## 9. Constraints for every sub-project

- US English UI. Nothing posts without a person's click. Money in minor units. Paged reads.
- No real client names, account digits or figures in repository files; prototype screenshots stay local.
- Migrations go live only with the user's approval; writes to live data only on the sample company.
- Changelog entry and guide step with every release; screenshots approved before every push.
