# Reconciliation history and flow fixes (release 2.03)

## Why

A user's feedback from the Reconcile screen (13/10) asked for two things:
- "the bank reconciled to its statement";
- "the previous transactions automatically reconciled".

The account was reconciling for the first time, and its books had been loaded from another program. The investigation found two causes behind its "Unexplained difference".

**A. The history was never reconciled.**
- The books through the day before the statement held exactly the statement's opening balance.
- The reconciliation still began at 0.00, for three reasons:
  - Bring forward is offered only on the From statement files page.
  - It is offered only while the account has no reconciliation of any status, and the user had created the session first.
  - An in-progress session cannot be discarded, so the user could not start again.

**B. A PDF misread.**
- The PDF reader read a check-image row as a payment.
- "Add missing lines" then posted that payment to the books, as a duplicate of a check already there.
- The duplicate entry has since been removed, with approval.

The real statement lines all paired correctly. Across that company, a few thousand posted lines on several bank accounts have never been reconciled.

### What the mockup does (Accounting System 2.28)

- **The first reconciliation** opens at 0.
  - "Brought forward" exists only in the batch run of statements (p44b:121-146).
  - It fires when the books before the first statement equal that statement's printed opening, and signs off every older line.
  - Otherwise it says "Those earlier entries stay open".
- **An in-progress sheet** can be left without saving (p7:545).
- **The difference** is one number: "Out by N. Find the missing line, or record the difference as an adjustment." (p23b:186). Beside it are two lists: "Bank has, books do not" and "Books have, bank has not".
- **PDF reading** skips check-image sections by their heading (p44:164). A re-printed section is dropped when 80% of its lines repeat earlier ones (p44:389-415).
- **"Add all N to the books"** deliberately has no duplicate guard (p24:144-147), because identical same-day lines can both be real.

### What OneBook has

- **Bring forward** is `acc_bring_forward_reconciliation` (0132).
  - It creates one completed session marked `brought_forward`, ticks every earlier posted line, and posts nothing.
  - It requires an exact match, and an account with no reconciliation row at all.
  - The only way in is the From statement files page.
  - `acc_brought_forward_preview` (0132) already returns the book balance and the line count through a date.
- **An in-progress session** cannot be discarded or deleted, and an account can have only one.
- **"Unexplained difference"** is `ending − (beginning + cleared)`. The opening message comes from `openingAdvice`. Nothing splits the difference into parts.
- **The PDF reader** (`lib/domain/pdf-statement.ts`) skips check images by one pattern, and a later "Checks…" row cancels the skip.
  - Its proof says "Out by X… A line may not have been read". That covers a missing line, never an extra one.
  - A single misread line cannot be set aside.
- **"Add missing lines"** (`acc_add_statement_lines_to_books`, 0134) has no guard against an amount already in the books.

## Decisions (13/10)

1. **History is brought forward only when the books match the statement exactly.** The book balance through a date must equal the statement's balance on that date, as in the mockup. A mismatch is refused, with the amount it is out by. No adjustment is posted.
2. **Three ways in:**
   - a button inside a reconciliation;
   - a way to discard an in-progress reconciliation;
   - a Reconcile history page covering every bank account.
3. **Scope.** This release covers history and the flow, with no AI. Matching improvements are release 2.04:
   - fuzzy descriptions;
   - split and combined deposits;
   - rules learned from history.

## Part 1: data and rules (migration 0142, additive only)

All new functions:
- are SECURITY DEFINER with `search_path` pinned;
- are executable by `authenticated` and `service_role`, and revoked from `public` and `anon`;
- check the caller's role inside: staff for writes, staff or viewer for reads.

### `acc_discard_reconciliation(p_reconciliation_id uuid, p_reason text)`

**Refuses:**
- anything not in progress. A completed session is reopened, as today.
- an empty reason.
- a session that has posted a reconciliation adjustment: "This reconciliation posted an adjustment ({entry}). Void it first." Otherwise the adjustment would point at a session that no longer exists.

**Deletes** the session. Its ticks and its statement lines go with it, by cascade.

**Keeps:**
- the statement file;
- the bank lines imported from it;
- any entries "Add missing lines" posted from it, which stay in the books.

**Writes** one audit row with the reason, the account, the statement ending date and the number of ticks removed.

### `acc_bring_history_forward(p_bank_account_id uuid, p_through date, p_balance_minor bigint, p_note text)`

**Refuses** when:
- `p_through` is after today;
- the account already has a completed reconciliation. This is for the first time only.
- the book balance through `p_through` is not exactly `p_balance_minor`. The book balance is posted lines on the account's ledger account, in the base currency.
  - The refusal states both figures and the amount it is out by: "The books hold {X} on {date}; the statement shows {Y}. Out by {Z}."
- an in-progress session ends on or before `p_through`.

It locks the bank account row first, as 0132 does.

**Creates** one completed reconciliation:
- `brought_forward` = true;
- statement ending date `p_through`, ending balance `p_balance_minor`, beginning 0, with the note;
- every posted line dated on or before `p_through` that is not yet ticked is ticked in it.

**When an in-progress session ends after `p_through`:**
- its ticks on lines dated on or before `p_through` move to the new session;
- its beginning balance becomes `p_balance_minor`.

**Never posts** an entry. It writes audit rows for the new session and, when there is one, for the session it changed. The rows hold the account, the date, the balance and the number of lines.

**`acc_bring_forward_reconciliation` (0132)** is redefined to call it, so From statement files follows the same rule. It keeps its own extra condition: it runs only when the account has no reconciliation at all.

### `acc_reconciliation_history()` (read)

One row per bank account:
- the account;
- the number of posted lines in no completed reconciliation;
- the first and last of their dates;
- the last completed reconciliation's ending date;
- the in-progress session, if any, with its ending date.

It returns one row per account, so the API's 1,000-row cap does not reach it.

The page's preview uses the existing `acc_brought_forward_preview` for the book balance and the line count through a date.

### Statement lines set aside

`acc_reconciliation_statement_line` gains:
- `set_aside boolean not null default false`;
- `acc_set_statement_line_aside(p_reconciliation_id uuid, p_line_no integer, p_aside boolean)`.

The function:
- is for staff, on an in-progress session only;
- refuses a line that is paired with the books;
- writes an audit row.

Replacing a session's statement (`acc_recon_write_statement`) writes new lines, so marks on the old ones go with them.

### `acc_statement_line_duplicates(p_reconciliation_id uuid, p_line_nos integer[])` (read)

For each statement line asked about, it returns posted lines on the session's bank account with the same amount that also have either:
- the same reference (check number); or
- a date within 5 days.

Each match comes with its entry number and date.

## Part 2: screens

### The reconciliation workspace (`/banking/reconcile/[id]`)

**Bring the history forward.**

This applies when the session has a statement file, and the session begins at a different figure from the statement's opening.

When the account has no completed reconciliation and the books through the day before the statement period equal that opening, the screen shows:
- "Everything in the books up to {date} adds up to {opening}, the balance this statement opens with."
- The button **Bring the history forward**. Its confirmation states how many entries will be marked reconciled.

Otherwise the screen explains why not, in one of these:
- "The books on {date} read {X}; the statement opens at {Y}. Out by {Z}."
- "This account already has a completed reconciliation."

A session with no statement file gets no button. The history page handles those.

**Discard this reconciliation.**
- In progress only, for staff.
- The confirmation asks for a reason and says: "Its ticks and the statement lines kept with it are removed, along with any line set aside as not a transaction. The statement file and its bank lines stay, and any entries added to the books from it stay in the books."
- Afterwards the user returns to Reconcile.

**The difference, explained.** This replaces "Unexplained difference" with these parts:

| Part | Shown |
|---|---|
| Opening | "This reconciliation begins at {Y}; the statement opens at {X}." Only when they differ and the opening is known. |
| On the statement, not in the books | The count and total of unpaired statement lines that are not set aside. |
| Ticked here, not on the statement | The count and total of ticked lines not paired to a statement line. Only with a statement file. |
| Left to explain | Whatever remains. |

When exactly one of those lines equals what is left, the screen adds: "It equals {line} ({amount}). Check that one first."

Without a statement file, only the opening part and what is left are shown.

### Reconcile history (`/banking/reconcile/history`)

It is linked from the Reconcile start screen. Each row shows a bank account with:
- lines not reconciled;
- their from and to dates;
- last reconciled;
- state.

**An account never reconciled** gets a form, "Statement balance on {date} = {amount}", with a live preview.
- **They match:** "Books on {date} read {amount} ✓" and the button **Bring forward {n} entries**.
- **They don't:** "Out by {Z}. Find the entry that differs, or try another statement."

**An account already reconciled** reads "Reconciled up to {date}" and has no action.

**A session in progress that ends on or before the chosen date** gives "Finish or discard the reconciliation in progress first.", with a link to that session.

### The statement import dialog

It gains one line: "A bank download (CSV, QFX or OFX) is read exactly. A PDF is read from its text, and a check image or a summary table can be misread."

## Part 3: guards against misread and duplicate lines

### PDF reader

**Check images.** A row reading "Checks…" inside a check-image area no longer ends the skip of that area. A unit test uses an invented page with that layout. No real statement is used.

**Extra lines.**
- The test is whether the opening plus the paired statement lines already equals the statement's closing balance.
- When it does, every unpaired statement line is marked "Extra — likely not a transaction: the statement already balances without it."
- Those lines are left out of "Add missing lines" by default.
- The proof's wording covers both directions: a line may be missing, or one may be extra.

**Not a transaction.**
- An unpaired statement line can be marked "Not a transaction", which leaves it out of "Add missing lines" and out of the parts of the difference.
- "Restore" brings it back.
- The mark is stored with `acc_set_statement_line_aside`.

### Add missing lines

Before posting, the action asks `acc_statement_line_duplicates` about the lines chosen.

- A line with a match is not posted. The result names the match: "Looks like {entry} already in the books."
- The screen offers "Add anyway" for that line alone. That posts it without the check.
- This is a warning, not a block, because two identical lines on one day can both be real (mockup p24:144-147).

## Verification

**Unit tests**, all on invented data:
- the difference parts;
- bring-forward eligibility and its messages;
- the PDF check-image fixture;
- extra-line marking;
- the duplicate warning;
- the history page's rows and preview.

**Migration test:**
- grants;
- SECURITY DEFINER with `search_path`;
- each refusal;
- 0132's function redefined on the shared one;
- the new column.

**Verification script**, always rolled back. It writes on the sample company only:
- bring forward, both matching and out;
- the in-progress rebase, with moved ticks;
- discard, including the refusal when an adjustment exists;
- set aside and restore;
- the duplicate lookup;
- every refusal.

It also checks the structure on all six companies.

**Live check**, read-only on all six companies. It counts bank accounts with no completed reconciliation and the lines they have unreconciled. Counts only; nothing is written.

**Smoke on PC-Test**, in light, dark and phone layouts:
- a sample account with a first session at 0;
- bring the history forward from the workspace;
- the difference explained;
- discard a session;
- the history page;
- an invented PDF with an extra line, set aside and restored.

## Release

- **2.03.** The changelog says what the user sees. The Guide gains steps in the reconciliation flow.
- **Migration 0142** goes live only with approval.
- **After release, for the company that reported it:**
  - The account in the report is brought forward inside its in-progress reconciliation.
  - Each other account is brought forward on the history page. That needs the account's statement balance on its start date, from the accountant, and is done only with approval.

## Not in this release

- Matching improvements (fuzzy descriptions, split and combined deposits, rules learned from history): release 2.04.
- AI suggestions.
- Bringing history forward after an account already has completed reconciliations.
- Posting an adjustment for an opening that does not match.

## Amendments from pre-building (13/10)

The release was built and run on a local pre-build branch first.

**Results**
- **Migration 0142 is live** on all six companies, applied on 13/10 with the user's approval.
  - The rolled-back verification script passed 207 of 207 against the live functions: 97 behaviour and structure checks on the sample company, and 22 structure checks on each of the others.
  - The company provisioning self-check passed 17 of 17.
  - A read-only count found bank accounts never reconciled in two companies, with about 1,800 and 2,800 posted lines that no reconciliation holds.
- **First smoke on the sample company, against the live database:** 138 of 140.
  - Every flow worked at 1280 in light and dark.
  - The two failures were tables cut off on a phone; both are fixed (item 12).
- **Second smoke, after the fixes:** 23 of 24, with no console errors.
  - One check was blocked by the existing Bank Transactions matcher (see "Found along the way").
  - One display flicker after bringing the history forward was fixed (item 13).

**Settled along the way**

1. **Where the workspace finds the statement's period.**
   - A reconciliation does not store its statement's period start, so the workspace reads `period_start` from the kept statement file.
   - The day brought forward through is the day before that.
   - A session without a kept file, or whose file names no start or opening, gets no button; the Reconcile history page does it instead.
   - The kept file is readable with `documents.read`, which every role has by default.
2. **Pairing is worked out in the application, not stored.** So the refusal to set aside a paired line ("This line is paired with the books, so it is a transaction.") lives in the service, not in the database function.
3. **Discarding a session that holds an adjustment.**
   - Nothing in the app voids a reconciliation adjustment, so the refusal says so plainly: "This reconciliation posted an adjustment ({entry}), so it cannot be discarded."
   - A completed reconciliation that an administrator reopens is in progress again, so it can then be discarded.
4. **"Today"** for bringing history forward is the company's day, also for From statement files.
5. **Extra lines.** A missing line is held back as Extra under either of two rules:
   - the opening plus the paired lines already equals the closing, which makes every missing line extra;
   - the statement does not prove itself, and exactly one missing line is the amount it is out by.

   The second rule catches a misread line that stands beside a real line the books lack, such as a fee. The fee stays in Add all.
6. **Held-back lines.**
   - Extra lines and likely duplicates are listed under "Held back from Add all:", each with its note and Add anyway.
   - "Add all N" posts only the lines not held back.
   - Each posting is still all of what was asked or none.
   - Duplicates are looked up only for the lines Add all would add.
7. **A match with 0 entries offers no button.** An empty brought-forward reconciliation would close the account to bringing its real history forward later.
8. **Bringing forward from a reconciliation also ties the kept statement file to the brought-forward reconciliation**, as From statement files does.
   - Its note is the existing brought-forward note.
   - On the history page the note is "Brought forward, proved by the statement balance of {amount} on {date}".
   - The confirmation reads "{N entries} up to {date} will be marked reconciled. Nothing is posted to the books."
9. **A line set aside stays in Bank Transactions**, unmatched. The message says so: "Set aside as not a transaction. Its line stays in Bank Transactions — exclude it there if it is not real."
10. **Discard returns to Reconcile on the same bank account.**
11. **The history page** prints its dates as "Sep 30, 2026". The chosen account is marked with the light accent wash, and its date picker refuses a day after today.
12. **On a phone,** the workspace's statement lines, ledger lines and Add missing tables, and the history table, scroll inside their own box; the page itself never scrolls sideways. The widths are kept beside the columns and pinned by tests.
13. **Write buttons stay busy until the screen catches up.**
    - This covers bringing forward, discarding, Add anyway, Not a transaction / Restore, Complete, Record adjustment and Reopen.
    - After bringing the history forward, the figures are read again before the dialog closes, so the screen changes once.
    - If that reading fails, the bring-forward still reads as done and the dialog closes; a separate warning asks for a reload.
14. **The PDF reader.**
    - Inside a check-image area, a "Checks…" or "Fees…" caption, or the images' own Date / Check No. / Amount table, no longer reopens reading.
    - An invented fixture shows the old reader taking a thumbnail row as a payment.
15. **The discard confirmation** was made to name the statement lines kept with the reconciliation and any line set aside as not a transaction, which the cascade deletes too.

**Found along the way, for later releases**
- **Statement lines are not exported.** `acc_reconciliation_statement_line` has been missing from the company export, backup and restore since 0132, so a restored company loses its kept statement lines.
- **The Bank Transactions matcher scores ties the same.** It scores a book line 0 days away and one 2 days away alike. Between two identical bank lines it can suggest the later one, which then blocks Add anyway with "approve or reject that first". This belongs to the 2.04 matching work.
- **Info and success alerts in light mode** have a heavy grey-green fill across the app (theme, not this release).
- **`scripts/verify-reconcile-from-statement.mjs` writes in every company** inside its rolled-back transaction. Its mismatch message now follows 0142.
