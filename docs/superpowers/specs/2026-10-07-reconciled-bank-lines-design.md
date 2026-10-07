# 1.85 — Bank lines reconciled from a statement are matched; a tidier recoded line; four small fixes

**Status:** design approved by the user, 2026-10-07.
**Builds on:** 1.79 (statement kept with a reconciliation and paired with the books), 1.81 (From statement files signs a run of months), 1.82 (Add all, Recode from Uncategorized), 1.83 (statement files kept as evidence).

## 1. The problems

1. **Reconciled bank lines still say "For review".** Importing a statement into a reconciliation (or From statement files) does three things: it imports the statement's lines into Bank Transactions as `unmatched`, `generateSuggestions` proposes a match from each bank line to a book line (`acc_reconciliation` rows with status `suggested`), and `pairAndTick` pairs each statement line with a book line and ticks that book line in the reconciliation (`acc_reconciliation_line`). Nothing approves the bank-line match. After the month is signed off, every bank line whose book entry was posted before the statement was imported still shows "For review" with Approve / Reject. Lines added by Add all, categorised, settled or recoded are not affected (those paths match the bank line themselves).
   Today only the sample company PC-Test has reconciliations kept with statement lines (19 reconciliations, 45 bank lines waiting); the four real companies have none.
2. **The Category cell of a recoded line is crowded.** It stacks the new account, "recoded from Uncategorized · JE-…", the original entry number again, and the links Undo recode and Change side by side. Change voids the original entry and sits next to Undo recode, where it is easy to press by mistake.
3. **Four small faults left by 1.83** that a person can see:
   - linking a kept statement file to an import batch or to a brought-forward reconciliation can fail with only a server log line;
   - the Attach message for a different number of lines names the comparison window in a way that reads as the file's own dates;
   - "Attach the statement" can be pressed before the reconciliation's figures have loaded, and then does nothing;
   - the Attach and Import dialogs keep spinning if the server action itself fails.

## 2. Decisions taken by the user

1. Release scope: items 1–3 above. Reading the closing balance from OFX files and accepting Excel statements wait for a later release; trying the PDF reader on the client's real statements waits for the files.
2. **Bank lines are matched when a reconciliation is completed** — by Complete in the workspace, and by From statement files as it signs each month. Ticking or unticking before signing changes nothing in Bank Transactions.
3. **The months already signed are matched once**, with the same rule, after the user approves.
4. **The reconciliation wins over a suggestion; an approved match is never changed.** A pair the person signed outranks a suggestion guessed from amount and date; a bank line already approved against another entry is left as it is and counted, so the message can tell the person to look at it.
5. **Recoded line: only Undo recode.** Change is not offered on a recoded line; to change it, Undo recode first (as 1.82's message already says).

## 3. Matching bank lines when a reconciliation is completed

**Which bank line a statement line came from.** The same rule 1.82 uses for Add all: a statement line and a bank transaction of the reconciliation's bank account are the same line when their date, amount, description (first 500 characters) and reference (trimmed, first 80 characters) are equal; identical lines pair in order, the first with the first. The rule moves out of `lib/domain/add-missing.ts` into its own small domain module, used by Add all and by this step; Add all's behaviour does not change.

**Which pairs.** After completion, the server reads the reconciliation's kept statement lines and its book lines, works out the standings (`reconciliationStandings`, as the workspace does), and takes every statement line that is `paired` with a ticked book line. Each gives one pair: the bank transaction that statement line came from, and the book line's journal line. A statement line with no bank transaction found is skipped silently (its statement may have been imported elsewhere or undone).

**Migration 0136 — `acc_match_reconciled_bank_lines(p_reconciliation_id uuid, p_pairs jsonb) returns jsonb`.** One call, one transaction, for all pairs of one reconciliation:
- refuses unless the caller may complete a reconciliation (`acc_is_staff()`, as `acc_complete_reconciliation`), the reconciliation exists and is **completed**, and `p_pairs` is a list of at most 5,000 `{bank_transaction_id, journal_line_id}`;
- refuses a pair whose journal line is not ticked in this reconciliation, or whose bank transaction belongs to another bank account;
- **skips** (counts as `skipped`) a pair when: the bank transaction is not `unmatched`; another bank transaction already has an approved match to this journal line; or the bank transaction's amount differs from the journal line's signed amount (a statement read with its signs reversed);
- otherwise **matches**: every other `suggested` match of that bank transaction becomes `rejected`; the `(bank transaction, journal line)` match is inserted or updated to `approved` with `approved_by` and confidence 1; the bank transaction becomes `matched`; one audit-log line per match;
- returns `{matched, skipped}`.
Granted to authenticated and service_role, revoked from public and anon. Verified, like every migration since 0132, by a script that applies it in always-rolled-back transactions on all six companies.

**Where it runs.** `completeReconciliationAction` (workspace Complete) and `reconcileRunMonthAction` (each month From statement files signs) call one service after a successful completion. A failure of the matching step does not undo the completion: the month stays signed and the message says the bank lines could not be matched and why. Running it again matches only what is still unmatched.

**What the person sees.** After Complete: "Reconciliation completed. N bank lines matched in Bank Transactions." When some were skipped: "… M are matched to another entry — check them in Bank Transactions." (no second sentence when M is 0). From statement files keeps its own run summary and adds the total matched.

## 4. The months already signed

A script run once, after the user approves, on the live database: for every completed reconciliation that keeps statement lines, the same service computes the pairs and calls the same function, signed in as an administrator of that company. A dry run first prints, per company, how many lines would be matched and skipped. Only PC-Test has such reconciliations today; the script refuses nothing by company but finds nothing elsewhere.

## 5. The recoded line's Category cell

```
6000 — Operating Expenses
Recoded from Uncategorized
JE-000076 → JE-000077
Undo recode · Create rule
```
The original entry (the bank line's own) then the recode entry. Change is not shown on a recoded line. A line in Uncategorized and not recoded is unchanged ("needs coding", Recode).

## 6. The four small fixes

1. `importStatementAction`, `importIntoBankTransactions` and the brought-forward branch of `reconcileRunMonthAction` report when the kept file could not be tied to the import or reconciliation; the screen shows: "The statement file was kept but could not be tied to this import: <reason>. It is in Reports › Saved." (for a reconciliation: "… tied to this reconciliation: <reason>. Attach it on the reconciliation.").
2. Attach's count message becomes: "This reconciliation kept N lines from <first day> to <statement date>; this file has M lines in those days."
3. "Attach the statement" is disabled until the reconciliation's figures have loaded.
4. The Attach and Import dialogs always leave their busy state and show the error when the server action fails.

## 7. Testing

- **Unit:** the statement-line-to-bank-line rule (equal fields, identical lines in order, no match); the pairs taken after completion (paired and ticked only; missing, after, unticked left out); the completion message with and without skipped lines; the Category cell contract for a recoded line (no Change); the new Attach count message; the busy state reset.
- **SQL verify script** on all six companies, rolled back: matches and rejects the other suggestions; leaves an approved match elsewhere and counts it; skips a bank line already matched and one whose amount sign differs; refuses a reconciliation in progress, a journal line not ticked, a bank transaction of another account; anon cannot call it.
- **Whole suite:** typecheck, lint, unit tests, build, bundle budget.
- **Live check on PC-Test:** a month signed from a statement leaves its bank lines matched, with the message; the run of months does the same; the once-off matching of the earlier months, dry run then real; a recoded line's cell; Attach disabled while loading. Screenshots light and dark, approved by the user before the push.
- **Release:** changelog 1.85 (the fix says that bank lines of earlier signed months were matched once, so Bank Transactions changes for them); guide step for completing a reconciliation mentions the matching.

## 8. Out of scope

- OFX closing balance; Excel statements (later release).
- Trying the PDF reader on the client's real statements (waits for the files).
- Unmatching bank lines when a reconciliation is reopened (a match stays true of the bank line and its entry).
- The remaining 1.83 minors triaged "can wait".
