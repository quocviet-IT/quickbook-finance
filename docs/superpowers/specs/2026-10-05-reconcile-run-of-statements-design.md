# Reconcile a run of statements in one pass (1.80) — design

**Date:** 2026-10-05
**Branch:** `feat/reconcile-run` (from `main` at d747af1, after 1.79)
**Follows:** `docs/superpowers/specs/2026-10-03-reconcile-from-statement-design.md` (1.79 reconciles one statement from
its file; its section 1 left "a run of statements in one pass" to 1.80).

## 1. What is asked

The client's prototype (*Accounting System 2.28*, `src/p44b.html`) reconciles a whole run of statements — "a year at a
time" — in one pass: read every file, pair each month against the books, sign off every month that agrees, stop at the
first that does not. Decided with the user on 2026-10-05:

- **Preview first, then one click signs.** Nothing is written until the person has seen every month's outcome; one
  click, "Sign off N months", then signs the months that agree, oldest first, up to the first that does not.
- **A month that agrees only on its balance stops the run.** When the lines do not pair off but everything the books
  hold to the statement date happens to equal the bank's closing balance, the prototype ticks every line and signs.
  OneBook stops there for a person: no line is marked cleared without the statement line it paired with.
- **Approach A:** files are read and checked in the browser; the preview is computed on the server, read only; each
  month is signed on the server in its own call.
- **One way in.** 1.79's "From a PDF statement" dialog is replaced by a page, **From statement files**, that takes one
  file or many. A single statement is a run of one month.

## 2. The reference: the prototype

| What | Prototype | Lines |
|---|---|---|
| Reading | several files at once; statements sorted by statement date; each PDF gives one statement per account it holds | `p44b.html:43-73`, `p44.html:492-531` |
| A CSV, OFX or QIF export | cut into calendar months; a month closes at the last running balance in it and opens at its first balance less that line's amount; a file with no balance column cannot prove a month | `p44.html:440-466` |
| Unusable | no statement date; no closing balance ("it cannot prove the month") | `p44b.html:55-60` |
| Gap check | a statement whose opening balance is not the previous one's closing means a month is missing; the run is disabled | `p44b.html:259-271` |
| Brought forward | as in 1.79 | `p44b.html:121-146` |
| Already signed | a month with a completed reconciliation on the same date is skipped and the run carries on from it | `p44b.html:152-160` |
| Each month | paired as written and with signs turned round, 5-day window (1.79's pairing); signed when the difference is zero | `p44b.html:86-101`, `161-172` |
| Balance only | when the lines do not reach zero, every open line to the date is ticked; signed if that reaches zero | `p44b.html:102-106` |
| Stop | at the first month that does not agree, which is opened half-ticked with its statement | `p44b.html:173-195` |

## 3. Where OneBook keeps its own way

| Prototype | OneBook in 1.80 | Why |
|---|---|---|
| Signs each agreeing month by itself | a preview first; one click by a person signs; each month is checked again on the server as it is signed, and the run stops if the books changed meanwhile | the user's decision: nothing completes without a person's click |
| Balance-only months are signed | the run stops there; the month is opened with its pairs ticked and says how many lines did not pair | the user's decision; a tick is evidence |
| Several reconciliations live in browser memory | one reconciliation in progress per account (OneBook's rule): months are signed in order, each in its own transaction; a run stopped half way leaves every signed month complete and valid | a server-side record |
| A CSV listed newest first is cut in file order: when the first or last day of a month has two lines or more, the month opens or closes on the wrong one | the file's direction is found from its dates and its lines are read oldest first; a month whose running balances do not follow its lines says so | the prototype's defect, shown by the parity test |
| An account with a reconciliation open is not a case | the run waits until the reconciliation in progress is finished, and links to it | OneBook's one-in-progress rule |

## 4. Design

### 4.1 The page — `/banking/reconcile/from-files?account=<bank account id>`

On Bank Reconciliation, the button beside **New reconciliation** reads **From statement files** and opens the page for
the bank account chosen there. The page:

1. **Choose the files** — one or many: PDF statements, or a CSV with a running-balance column. Read in the browser, as
   1.78 does; the files never leave it, only the lines read are sent.
2. **Statements** — a table: file, period, closes, opening, closing, lines, and what was read (a tag: "N lines",
   "Cannot prove a month — no closing balance", "Already signed off", "Before the last reconciliation", "Same month as
   another file", "Not this account"). Under it, what stops a run: a gap ("The statement closing Mar 31, 2026 does not
   open at the one before it, so a month is missing…"), or a reconciliation in progress on this account.
3. **Preview** — enabled when there is at least one usable statement and nothing stops the run. Shows, oldest first:
   the brought-forward row when it applies (1.79's rule), then each month with its outcome — **Agrees** ("12 of 12
   lines paired, 1 outstanding"), **Agrees on the balance only — needs a look** ("3 lines did not pair"), **Out by
   $X** ("the bank shows 2 things the books do not"), or **Waiting** for the months after the run stops. A month's row
   opens to show each statement line and how it paired (1.79's standings).
4. **Sign off N months** — N counts the agreeing statements; the brought-forward row, when there is one, is signed
   first. It signs them oldest first, up to the first month that does not agree, with
   a progress line ("Signing Jul 31, 2026 — 3 of 11"). Then the first month that needs a look, if any, is started as a
   reconciliation in progress with its statement kept and its pairs ticked, and the page offers **Open it**.

### 4.2 Reading and checking — `lib/domain/statement-run.ts` (pure)

- `RunStatement`: the file, its source (PDF or CSV), period start (or null), statement date, opening (or null),
  closing, and its lines (`StatementLine[]`, 1.78).
- **PDF:** each statement read by 1.78's reader; a PDF holding several accounts gives the statements whose account
  ends in the bank account's last four digits, or, when none names an account, all of them.
- **CSV:** the columns are those detected, or those remembered for this bank account by Import statement (its
  `onebook.statement-columns.<id>` choice). The file's direction is found from its dates; its lines are cut into
  calendar months, each closing at the last running balance and opening at the first balance less that line's
  amount. A month whose balances do not follow from one line to the next is marked "The running balances do not
  follow the lines". No balance column: every month "Cannot prove a month — no closing balance". OFX, QFX, QBO and QIF
  are refused the same way (they carry no running balance).
- `checkRun(statements, account)` orders them by statement date and marks each one: usable; same month as another file
  (the first file kept); already signed off (a completed reconciliation on that date); before the last reconciliation.
  It says what stops the run: a gap between consecutive usable statements; a first statement that does not open at
  the last completed reconciliation's ending balance (a month is missing between them, or that reconciliation closed
  on another figure); or a reconciliation in progress.

### 4.3 The preview — `simulateRun` (pure) and a read-only action

- The server reads the account's **open book lines** to the last statement date — posted, not in a completed
  reconciliation, each with its reference as 1.79 reads it — through a new read-only function (4.5), and the
  bring-forward preview (1.79's `acc_brought_forward_preview`).
- `simulateRun(statements, openLines, start)` walks the months oldest first: beginning balance = the previous
  month's closing (or the last completed reconciliation's ending, or the brought-forward opening); 1.79's
  `matchStatement` pairs the statement's lines with the open lines dated to its statement date; the difference is
  the closing less (beginning + the paired book lines). Zero: **Agrees**, and its paired lines are no longer open for
  later months. Not zero but beginning + every open line to the date equals the closing: **balance only**. Otherwise
  **out by** the difference. The first month that is not Agrees stops the walk; the months after it are Waiting.
- Nothing is written. The preview is computed again before signing if the person changes the files.

### 4.4 Signing — one server action per month

`reconcileRunMonthAction({ bank account, statement, sign })`, called by the page in order:

- the brought-forward row: 1.79's `bringForward` (refused by the database unless the books still agree);
- a month: 1.79's create-from-statement, import into Bank Transactions (duplicates skipped), pair and tick; then, when
  `sign` is set and the difference is now zero, complete it. When the difference is not zero (the books changed since
  the preview), the month is left in progress and the run stops there, saying so.
- after the agreeing months, the first month that needs a look is called with `sign` unset: started, its pairs
  ticked, left in progress.

Each call carries one month's lines, so a year's CSV never reaches the server-action body limit. Every signed month is
a complete reconciliation keeping its statement; a run that stops half way loses nothing.

### 4.5 Data — migration `0133_bank_open_lines.sql` (read only; goes live only with the user's approval)

- `acc_bank_open_lines(p_bank_account_id uuid, p_through date)` returns the account's posted lines to `p_through` that
  are in no completed reconciliation: `journal_line_id, entry_number, entry_date, signed_minor, reference` (the
  reference as `acc_reconciliation_lines` gives it). `language sql stable`, security invoker, granted to signed-in
  users only. No table changes.

### 4.6 What 1.79 gives up

The "From a PDF statement" dialog (`StartFromStatementModal`) and its start action are removed; the button opens the
page. Inside a reconciliation nothing changes: Import statement, Match again, Use $X, Outstanding stay as 1.79 made
them.

## 5. Proving it

- Unit tests: cutting a CSV into months (oldest first and newest first; several lines on the first and last day; a
  missing balance; balances that do not follow); picking a PDF's statements for the account; `checkRun` (gap,
  duplicate month, already signed, before the last reconciliation, in progress); `simulateRun` (a chain of agreeing
  months; lines paired in one month not offered to the next; balance only stops; out by; brought forward; a month
  read with its signs turned round).
- **Parity with the prototype:** a test under `npm run parity` hands the prototype's own `readStatementText` and
  OneBook's month cutting the same CSV files, in a headless page, and compares each month's dates, opening, closing
  and lines — identical for files listed oldest first, and different exactly where a newest-first file has several
  lines on a month's first or last day.
- A verify script runs `acc_bank_open_lines` on every company inside a transaction that is rolled back: open lines,
  lines in a completed reconciliation left out, references, a viewer reads, anon does not.
- **Live check on PC-Test** with a new bank account: a run of three PDF statements and a year's CSV — brought forward,
  months signed in one click, the run stopping at a month out by a fee, that month opened, the fee coded, Match again,
  Complete; screenshots approved before the push.

## 6. Release

1.80: changelog entry and guide steps (the control is now "From statement files"). One read-only migration, applied
to every company only after the user approves.

## 7. Out of scope

- An OFX file's ledger balance as a month's closing.
- Resuming a run after leaving the page (every signed month is already saved).
- Scanned PDFs (no text to read).

## 8. Constraints

- No real statement, bank name, account number or figure in the repository; fixtures invented.
- US English UI. Money in minor units. Nothing posts and nothing completes without a person's click.
- Migrations live only with the user's approval; writes to live data only on the sample company.
