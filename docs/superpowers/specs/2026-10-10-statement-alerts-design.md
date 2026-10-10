# Statement alerts: a balance posted as payments, and a bank account below zero (release 1.98)

## Why

The client's mockup has two detectors that OneBook lacks. The area-by-area comparison of 2 October lists both as "not built".

1. **A balance posted as payments** (`ghostGroups`, mockup p45).
   - When a statement's *Balance* column is read as amounts, a run of entries for one payee lands exactly on what the account itself comes to on each date.
   - Real payments do not track the balance of the account they are paid from, so this pattern is safe to flag.
   - It happened for real in the mockup: 33 payroll debits, and a misread daily-balance grid.
2. **A bank account below zero since its last agreed statement** (`negativeWatch`, mockup p45).
   - Once a statement is agreed, the balance was right on that day.
   - Anything that drags the account under afterwards is far more likely to be an entry that is not a payment than a real overdraft, which the bank would have printed.

In the mockup both appear:
- on the Reconcile tab's start screen, for the selected account;
- on the Today page;
- as a note on the Balance Sheet.

The mockup removes flagged entries by deleting them. OneBook never deletes posted entries.

## Decisions (user, 10/10)

1. **Remove in bulk, safely.**
   - One action removes a flagged group, after two clicks and a reason.
   - Each entry is removed the OneBook way, according to where it came from. The full rules are under "Removing a flagged group".
   - Either the whole group is removed or nothing is.
2. **Where the alerts show:**
   - the Reconcile start screen, for the chosen account;
   - Reports › Exceptions, as two new checks across all bank accounts;
   - a note on the Balance Sheet when a bank account is below zero.

   The Today page waits for the Today work.
3. **Wording and thresholds follow the mockup.**

## Detection

Both detectors are pure functions over one bank account's posted lines.

**Scope**
- They apply to bank and cash accounts only: the accounts on the Reconcile screen, `acc_bank_account`. Credit cards and loans are excluded.

**Inputs**
- Every posted journal line on the bank account's ledger account, for all dates, with:
  - entry id, line id, entry number and entry date;
  - signed amount in base currency (debit minus credit);
  - the entry's payee (`entryDisplayName`: party, else description, else entry number);
  - the other accounts on the entry ("coded to");
  - the entry's source type.
- The account's completed reconciliations: statement ending date and ending balance.
- Which lines are ticked in a completed reconciliation.

All reads page past PostgREST's 1,000-row cap.

### A balance posted as payments (mockup `ghostGroups`)

1. **Groups.**
   - Group the account's lines by payee: trimmed, lower-case, empty as "(no name)".
   - Skip the account if it has fewer than 4 lines.
   - Consider only groups of at least 3 lines (`GHOST_MIN = 3`).
2. **The rest.**
   - For each group, the rest is every other line on the account.
   - Skip the group if the rest is empty.
3. **The balance without the group.**
   - Walk the rest in date order (then entry number, then line id), cumulating the signed amount.
   - `balOn(d)` is the balance after the last rest line dated on or before `d`, that is, the end of day with the group excluded. It is 0 before the first rest line.
4. **Offsets.**
   - For each group line, the offset is `|amount| − balOn(date)`, rounded to the cent.
   - Count lines per offset.
5. **Good offsets.**
   - An offset seen on at least 3 lines is good.
   - Offset 0 is good if seen at all, because landing exactly on the balance needs no corroboration.
   - The test is per offset, not one offset for the whole group: a file read wrongly twice leaves two runs, each a fixed distance from the balance.
6. **Agreeing lines.**
   - Agreeing lines are the group lines whose offset is good.
   - Flag the group only when all of these hold:
     - at least 3 lines agree;
     - agreeing ÷ group ≥ 0.6 (`GHOST_SHARE`);
     - the agreeing lines show at least 3 distinct `balOn` values and at least 3 distinct amounts;
     - the rest has at least 3 lines.

     The last three conditions stop an account that is all one payee from proving itself.
7. **Result for a flagged group:**
   - the payee;
   - the agreeing lines only;
   - the counts: agreeing and group size;
   - the most frequent good offset;
   - the number of good offsets ("runs");
   - the agreeing amounts' total.

### Below zero since the last agreed statement (mockup `negativeWatch`)

1. **Day-end balances.** Cumulate every line in date order and record the balance at the end of each date.
2. **Now.** "Now" is the last day-end balance.
3. **The starting line.** "Last" is the latest completed reconciliation, by statement ending date. "From" is its ending date, or none.
4. **Under.** These are the day-ends after "from" with a balance below −0.004. When the account has never been reconciled, "under" is empty: a dip on an account nobody has reconciled is history.
5. **Quiet.** Return nothing when "now" is at least −0.004 and "under" is empty. An unreconciled account is flagged only while it is negative now.
6. **Worst.** "Worst" is the lowest balance in "under", with its date.
7. **Outstanding.** These are lines dated after "from" that are not ticked in any completed reconciliation and whose amount is negative.
   - Sort them from the largest payment to the smallest.
   - Keep the top 6, and the total count.
8. **Result:** now, last (its date and ending balance), worst, the top 6, and the count.

## Where they show

### Reconcile start screen (`/banking/reconcile`)

The panels appear for the account chosen there, above the list of reconciliations. Both are amber cards.

**A balance posted as payments**
- **Title:** "N entries here look like the statement's balance, not payments".
- **Body:**
  - It opens: "Every one of them is named **{payee}**, and {agree} of the {of} land exactly on what this account comes to on their own date once the group itself is taken out".
  - It then adds one of these endings, or none:
    - ", each run of them a fixed distance from it", when there is more than one run;
    - ", give or take {offset} that is outstanding for other reasons", when the offset is not zero.
  - It closes: ". A payment does not track the balance of the account it is paid from. These are almost certainly a *Balance* column read as amounts, and together they move {total}."
- **Show me the workings / Hide the workings.** This opens a table with the columns:
  - Date;
  - Posted as;
  - This account on that date (worked out without the group);
  - Difference ("—" under half a cent);
  - Coded to.

  Each row links to its entry. The table's footnote reads: "The middle column is worked out with these entries removed, so it is not an argument with itself."
- **Remove these N entries.** The flow is under "Removing a flagged group". The button is shown only to people who can write.

**Below zero**
- **Title:** "{Account} reads below zero", followed by either ", and still does today" or " at some point since the last statement".
- **Body:**
  - It opens with one of:
    - "The last statement you agreed on this account closed at **{end}** on {date}, so the balance was right on the day it was proved.";
    - "Nothing has been reconciled on this account yet, so there is no agreed figure to measure from."
  - When there is a worst balance it adds: "Since then it drops to **{worst}** on {date}."
  - It always adds: "It reads {now} today. A bank would have charged you for an overdraft and shown it on the statement; where it has not, what is dragging it under is usually an entry that is not a payment — a balance posted as one, or the same thing entered twice."
- **List.**
  - The heading reads: "The largest {k} of the {n} payments not yet on a statement:".
  - The columns are Date, Name, Amount (in red) and Coded to.
  - Each row links to its entry.
  - It ends: "Reconcile the next statement and whatever the bank has never seen is left standing on its own."

The start screen keeps the chosen account in the address (`?account=<bank id>`), so the other places can link to it.

### Reports › Exceptions

The report gains two checks, from 8 to 10:
- **"Entries that look like a statement balance"**: one row per flagged group, showing the bank account, the payee, the entry count, the total, and a link to the Reconcile start screen for that account.
- **"Bank accounts below zero since their last statement"**: one row per flagged account, showing now, worst and its date, the last agreed statement date, the outstanding count, and a link to Reconcile.

Both follow the report's existing pattern:
- a pure detector;
- a read behind `readOr`, so a failed read marks the check unavailable;
- a section on the page;
- rows in the sheet export.

### Balance Sheet

When a bank account in the report reads below zero at the report's end date, the report shows an amber note:
- "{Account} is below zero." For several accounts: "{A} and {B} are below zero."
- Then one of:
  - "{n} entries on it look like the account's own balance posted as payments. Reconcile shows the workings and offers to remove them.";
  - "Reconcile shows what has gone in since the last statement you agreed."
- It ends with a link to Reconcile for the account.

## Removing a flagged group

1. **The click.**
   - The first click turns the button into "Confirm — remove all N" and asks for a reason, which is required.
   - The second click sends the account and the payee, not a list of entries.
2. **The server action.**
   - It needs write access and the permission to post journals.
   - It re-reads the account and re-runs the detector.
   - If that payee is no longer flagged, it answers "Those entries are no longer here."
   - Otherwise it calls one database function with the flagged entry ids and the reason.
3. **The database function (new migration).** It does everything in one transaction, all or nothing.
   - **First, it refuses the whole request when any entry:**
     - is not posted, or has already been reversed;
     - has a line ticked in a completed reconciliation;
     - is dated in a closed period;
     - has a source type other than `manual`, `opening_balance` or `bank`. Such entries belong to a document (invoice, payment, bill, bill payment, expense, tax payment, reconciliation, inventory, depreciation, asset disposal, goods receipt, stock count), and the refusal names the document to void instead;
     - is a `bank` entry whose bank line was settled against an invoice or bill.
   - **The refusal lists every blocked entry by number and reason,** and the card shows that list with links.
   - **For `manual` and `opening_balance` entries,** including books loaded from another program, it posts a reversing entry on the entry's own date. The reversal's lines are the original's, debit and credit swapped. It is marked as the reversal of the original, the same way `acc_reverse_entry` marks a reversal. The original is never deleted.
   - **For `bank` entries,** it voids the entry and deletes its bank line, the way Delete line does today, including for a line that came in with an import batch. The rest of that batch is untouched.
   - **Every entry** removed this way carries the reason. The function writes one change-log row naming the account, the payee, the count and the total.
   - **Permissions and grants.** It requires a staff user with the permission to post journals. It is executable by `authenticated` and `service_role`, and revoked from `public` and `anon`.
4. **Success.**
   - The toast reads "N entries removed. They were balances, not payments."
   - The page reads again, and the card disappears.

## Not in this release

- The Today page. It comes with the Today work.
- Stopping a balance at import time. Imports already prove opening + lines = closing.
- Credit card and loan accounts.

## Verification

- **Unit tests,** with invented data:
  - a balance series read once;
  - a series read twice (two runs);
  - an exact hit with no corroboration;
  - the degenerate account that is all one payee (not flagged);
  - below 60% agreement (not flagged);
  - negative now, a dip since the last statement, never reconciled, and the top-6 ordering;
  - the copy builders;
  - the Exceptions checks, with 10 checks;
  - the Balance Sheet note.
- **Migration test.** It covers the function's refusals, grants, and SECURITY DEFINER with `search_path`.
- **Verification script,** in always-rolled-back transactions on the sample company:
  - post a balance series;
  - detect it;
  - remove it (reversals and bank-line voids);
  - each refusal: document-owned, ticked, closed period, already reversed.

  It also checks structure on all six companies.
- **Live check, read-only on all six companies.** It runs both detectors and reports counts only. If a real company is flagged, the user is told the account and the count, and nothing is removed.
- **Smoke on the sample company PC-Test.**
  - Post a small invented balance series.
  - See the card and its workings.
  - Remove the series through the screen.
  - See the Exceptions checks and the Balance Sheet note.
  - Take screenshots in light and dark.

  The reversals stay on the sample company as sample data.

## Release

1.98, or the next free number when merging.
- **Changelog:** says what the user sees.
- **Guide:** gains steps in the reconciliation flow.
- **Migration:** goes live only with the user's approval.
