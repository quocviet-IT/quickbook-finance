# Reconcile a statement from its file (1.79) — design

**Date:** 2026-10-03
**Branch:** `feat/reconcile-from-statement` (from `main` at 73dba41, after 1.78)
**Follows:** `docs/superpowers/specs/2026-10-03-pdf-statements-design.md` (1.78 read a PDF statement on Import statement;
its section 7 left reconciliation to its own spec).

## 1. What is asked

After 1.78 a PDF statement can be imported for coding. The client's prototype (*Accounting System 2.28*) uses a statement
file for the other half of the month too: proving the books against it. Decided with the user on 2026-10-03:

- **Two releases.** 1.79 reconciles **one** statement from its file. 1.80 (its own spec) reconciles a run of statements
  in one pass, built on 1.79.
- **The first reconciliation of an account is brought forward, as the prototype does**, and a person signs it.
- **Statement lines are paired with the books by the prototype's rule**, with its 5-day window.
- **Approach A:** a reconciliation can be started from a PDF statement — its date and ending balance come from the
  file, never retyped — and the Import button inside a reconciliation takes the same files.
- Lines on the statement but not in the books are coded through Review import, as every bank line is; then **Match
  again** ticks them. Nothing posts and nothing completes without a person's click.

## 2. The reference: the prototype

| What | Prototype | Lines |
|---|---|---|
| Pairing | three passes, strongest evidence first: (1) same date and amount; (2) same amount and the statement's cheque number equals the book entry's reference; (3) same amount, dates at most 5 days apart. Each statement line and each book line is used once; within a pass, statement lines in file order, each taking the first free book line in book order | `p24.html:68-93` |
| Which way money points | pair as read, and with every amount negated; keep whichever pairs more lines (ties keep as read) | `p24.html:103-109` |
| Scope | statement lines dated after the statement date are ignored and counted; book lines are those of the account up to the statement date not cleared on an earlier statement | `p24.html:99-101`, `p23.html:105-126` |
| Ticking | every pair's book line is ticked; no tick is removed | `p24.html:115-116` |
| Closing from the file | the last dated line's running balance is offered as the closing balance | `p24.html:118-122` |
| The three lists | paired; on the statement, not in the books ("missing"); in the books, not on the statement ("unseen", outstanding) | `p24.html:91-92` |
| Brought forward | with nothing reconciled yet, if the book balance on the day before the first statement's period equals that statement's printed opening balance, every earlier open line is signed off as one reconciliation, "brought forward, proved by the opening balance on the … statement"; if not, the earlier entries stay open and the difference is said | `p44b.html:121-146` |

## 3. Where OneBook keeps its own way

| Prototype | OneBook in 1.79 | Why |
|---|---|---|
| Amounts in float dollars, `near()` within half a cent | integer cents, equal means equal | OneBook's rule for money |
| "Missing" lines are posted from the reconciliation screen with a guessed account | they are bank lines like any other: Review import proposes an account (rules, history, cards, related companies); a person posts; **Match again** pairs them | nothing posts without a click, and one place codes bank lines |
| A run signs off by itself | 1.79 never completes a reconciliation by itself; bringing forward is a click | the user's decision |
| The working sheet lives in browser memory | the statement's lines are kept with the reconciliation, so Match again, the report and 1.80 can read them later | a server-side record |

## 4. Design

### 4.1 Data — migration `0132_reconcile_from_statement.sql` (goes live only with the user's approval)

- `acc_statement_reconciliation` keeps the statement's file name in its existing, unused `statement_ref` column (now
  ≤ 255) and gains `statement_opening_minor bigint` and `statement_closing_minor bigint` (the balances the statement
  prints, when it prints them), `note text` (≤ 500; "Brought forward …") and `brought_forward boolean` (the list and
  the report read it).
- New table `acc_reconciliation_statement_line`: `id`, `reconciliation_id` (cascade with its reconciliation),
  `line_no int`, `txn_date date`, `description text`, `reference text` (the cheque number), `amount_minor bigint`
  (≠ 0, positive is money in), `balance_minor bigint` (null when not printed); unique (`reconciliation_id`, `line_no`).
  RLS as `acc_reconciliation_line`: read for staff and viewers, written only through the functions below.
- `acc_reconciliation_lines` returns one more column, `reference`: the entry's `source_ref`, else the reference of the
  customer payment or bill payment the entry came from. (The function is dropped and recreated, because its result
  columns change; it and the preview are granted to signed-in users only, as 0080 asks of every new function.)
- New functions, each staff-only, on an in-progress reconciliation unless said, audited like the 0026 functions:
  - `acc_create_reconciliation_from_statement(p_bank_account_id, p_ending_date, p_ending_minor, p_file_name,
    p_opening_minor, p_lines jsonb) returns uuid` — `acc_create_reconciliation` plus the statement, in one transaction.
  - `acc_set_reconciliation_statement(p_reconciliation_id, p_file_name, p_opening_minor, p_closing_minor,
    p_lines jsonb) returns int` —
    replaces the statement held by a reconciliation (the Import button inside one).
  - `acc_set_statement_ending(p_reconciliation_id, p_ending_minor) returns void` — takes the closing balance from the
    file when it differs from the one typed.
  - `acc_set_cleared_many(p_reconciliation_id, p_journal_line_ids uuid[], p_cleared boolean) returns int` — the checks
    of `acc_set_cleared`, for many lines in one call.
  - `acc_brought_forward_preview(p_bank_account_id, p_through date)` returns `(has_reconciliations boolean,
    book_balance_minor bigint, open_lines int)` — read only.
  - `acc_bring_forward_reconciliation(p_bank_account_id, p_through, p_opening_minor, p_note) returns uuid` — refused if
    the account has any reconciliation, completed or in progress; refused unless the book balance through `p_through`
    equals `p_opening_minor` ("The books hold $X on Aug 31, and the statement opens at $Y."); otherwise records one
    completed reconciliation through `p_through` (beginning 0, ending `p_opening_minor`) with every posted line up to
    that date cleared, and the note.

### 4.2 The pairing — `lib/domain/statement-pairing.ts` (pure)

A port of `recPair` and `recMatch` in cents:

```ts
export interface PairStatementLine { lineNo: number; date: string; amountMinor: number; reference: string | null }
export interface PairBookLine { id: string; date: string; amountMinor: number; reference: string | null }
export interface StatementPair { line: PairStatementLine; book: PairBookLine; how: string } // "date and amount" |
                                                     // "cheque number" | "amount, within 5 days"
export interface Pairing {
  pairs: StatementPair[];
  missing: PairStatementLine[];   // on the statement, not in the books
  unseen: PairBookLine[];         // in the books, not on the statement
}
export interface StatementMatch extends Pairing {
  flipped: boolean;               // the statement's signs were read the other way round
  ignored: number;                // statement lines dated after the statement date
}
export function pairStatement(lines, book, windowDays = 5): Pairing;
export function matchStatement(lines, book, statementDate: string): StatementMatch;
```

The sentences and standings the screens show — whether an account can be brought forward, the closing and opening
checks, how each statement line stands — are pure functions beside it, in `lib/domain/reconcile-statement.ts`.

The cheque test compares the statement line's reference, kept to letters, digits and hyphens as the prototype keeps it,
with the book line's reference; an empty statement reference never matches.

### 4.3 Starting from a PDF — the New reconciliation dialog

- A second way to start beside typing the figures: **From a PDF statement**. The file is read with 1.78's reader;
  a PDF with several statements offers each, as on Import statement. Only a PDF starts a reconciliation: it is the
  format that prints the statement's closing balance and period, the two figures a reconciliation is started with. A
  CSV, OFX or QIF file is used inside a reconciliation started by typing them (4.4); 1.80 can cut a long CSV into months.
- The dialog shows the statement's period, opening and closing balances and its self-proof sentence (1.78's wording).
  The reconciliation takes the statement's last day as its date and its closing balance as its ending balance. A
  statement that does not prove can still be used, after the person has seen by how much it is out.
- **First reconciliation of the account** (it has none at all) and the statement prints both a period start and an
  opening balance: the preview is run for the day before the period. When the book balance equals the opening balance,
  the dialog says "The books hold $5,000.00 on Aug 31 — the statement opens at $5,000.00. The 214 earlier lines can be
  brought forward as reconciled." and the start button reads **Bring forward and start**. When they differ it says by
  how much, says the earlier lines stay open, and the button reads **Start**.
- Starting imports the statement's lines into Bank Transactions as Import statement does (duplicates skipped), stores
  them with the reconciliation, pairs them and ticks the pairs, then opens the reconciliation.

### 4.4 Inside a reconciliation

- **Import statement** accepts a PDF, CSV, OFX, QFX, QBO or QIF file (today CSV only). The lines are stored with the
  reconciliation, imported into Bank Transactions, paired and ticked.
- For a PDF: when its closing balance differs from the reconciliation's ending balance, "The statement closes at
  $5,558.25; this reconciliation says $5,600.00" with **Use $5,558.25**; when its opening balance differs from the
  beginning balance, that is said too (a month is missing, or the last reconciliation closed on a different figure).
- The statement panel replaces today's read-only list: every statement line with how it paired ("Paired · date and
  amount", "Paired · cheque number", "Paired · amount, within 5 days" — marked "not ticked" when its book line was
  unticked by hand) or **Not in the books**; a link **Code the N
  lines the books do not have** to Bank Transactions; and **Match again**, which pairs the stored lines against the
  books as they are now and ticks any new pairs. The books panel tags unticked lines as **Outstanding**.
- Completing is unchanged: the difference must be zero (or an adjustment recorded), and a person clicks Complete.
- A brought-forward reconciliation reads "Brought forward" in the list and on its report, with its note.

## 5. Proving it

- Unit tests for the pairing (each pass, the order of passes, one-use, the sign flip, the ignored count, references
  cleaned like the prototype's), for the dialog's wording, and for the reading of the new reconciliation columns.
- **Parity with the prototype:** a test under `npm run parity` hands the prototype's own `recPair`, in a headless page,
  the same statement and book lines as OneBook's `pairStatement`, and compares the pairs, their order and how each was
  made, and what is missing and unseen.
- A verify script runs the migration's functions on every company inside a transaction that is rolled back: create
  from a statement, store and replace lines, bulk ticking and its refusals, the bring-forward refusals (a session
  exists; the balance differs) and its success.
- **Live check on PC-Test** in a real browser: the first reconciliation brought forward, a PDF statement started,
  paired and completed, a statement out by a missing line coded through Review import then Match again; screenshots
  approved before the push. What the check records is undone or left as the sample company's own history, as the user
  prefers.

## 6. Release

1.79: changelog entry and guide steps. One migration, applied to every company only after the user approves.

## 7. Out of scope

- A run of statements in one pass, and the gap check between statements — 1.80.
- The reconciliation report's outstanding items, "proves out" sentence and "changed since" alert — Phase 1 of the
  roadmap.
- Changing the pairing window per reconciliation.

## 8. Constraints

- No real statement, bank name, account number or figure in the repository; fixtures invented.
- US English UI. Money in minor units. Nothing posts and nothing completes without a person's click.
- Migrations live only with the user's approval; writes to live data only on the sample company.
