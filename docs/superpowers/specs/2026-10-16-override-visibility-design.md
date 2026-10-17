# A statement imported out of balance stays in sight until a reconciliation settles it (release 2.11)

## Why

This answers the reviewer's OB-2 follow-up of 15/10. Two requests:

1. **"Confirm that statements without an opening balance use the previous statement's closing balance."**
   - Today, PDF and OFX statements take the last completed reconciliation's closing automatically, but only when they start the day after it. Otherwise the person presses "Use $X" or types the opening.
   - A CSV with no balance column never takes it automatically.
   - The server does not check that an opening marked as the previous closing really is that figure.
2. **"Ensure every administrator override permanently records the user, date and time, reason, and shortfall, and remains visible on the import record, relevant reconciliation, and Exceptions until resolved."**
   - The record already exists and cannot be changed. 0143 holds it in the following places:
     - `acc_bank_import_batch.overridden_by` (who);
     - `imported_at` (when; the override is made in the same statement as the import);
     - `override_reason` (why);
     - `out_by_minor` (the shortfall);
     - an `override` audit row.
   - None of it is shown on the import list, on a reconciliation, or in Exceptions.
   - On 16/10 only the sample company has an override (one). No real company has any.

**Decided with the user (16/10):** an override is *settled* once a completed reconciliation of the same bank account reaches the date of the override's last line. Until then it is *open*.

## Part 1: the opening of a statement that prints none

- **Import dialog, CSV:** a CSV with no running balance takes the last completed reconciliation's closing as its opening, automatically, when every counted line is dated after that reconciliation's end date.
  - Its basis is `prior`.
  - Its closing must still be typed, and the typed closing is what proves it.
  - The note says where the opening came from, in the words the PDF case already uses.
  - A line dated on or before the reconciliation's end refuses the prior, as it does today.
- **PDF and OFX:** unchanged. Prior is automatic when the statement starts the day after the last reconciliation, and offered otherwise.
- **From statement files:** unchanged. A CSV that prints no balances has no closing to prove against, so it still stops the run, with the existing note.
- **Database (0149):** `acc_import_bank_statement_proved` refuses an opening whose basis is `prior` unless it equals the closing of the account's newest completed reconciliation. The message is "The opening must be the closing of the last reconciliation, {amount}." The rest of the function is unchanged.

## Part 2: an override stays in sight

**Database (0149).** New function `acc_statement_overrides()`. It returns every import batch with an override that has not been undone (`status = 'active'`), with these fields:

| Field | What it holds |
|---|---|
| batch id, bank account, file name, imported at | Which import, and when |
| who | `overridden_by` |
| reason, out by | `override_reason`, `out_by_minor` |
| opening and closing | As stated |
| first and last line date | The dates the import covers |
| settled by | The id and end date of the earliest completed reconciliation of that account whose end date is on or after the last line date; null while open |

- It is readable by staff and viewers.
- It is revoked from public and anon, and granted to authenticated and service_role.
- A voided import is not returned.

**App.** Times are printed in the company's time zone (2.09's lesson), and "who" is the person's name from the actor directory.

1. **Import record.** Bank Transactions › import history marks an overridden import "Imported out of balance". Its detail reads:

   > Out by {amount}. Imported by {name} on {date} at {time}: “{reason}”. {Open until a reconciliation through {last line date} is completed. | Settled by the reconciliation to {date}.}

2. **The relevant reconciliation** is the reconciliation of that account whose period holds the override's last line date.
   - **In progress:** the workspace shows a notice above the lines:

     > A statement in this period was imported out of balance: out by {amount}, by {name} on {date}, “{reason}”. Completing this reconciliation settles it.

   - **Completed:** the report of the reconciliation that settled it says:

     > Settles a statement imported out of balance: out by {amount}, by {name} on {date}, “{reason}”.

3. **Exceptions.** A twelfth check, "Statements imported out of balance", lists each open override: account, file, imported (date and time), by, out by, reason, and "Open since {date}".
   - The sentence and the export carry the same facts.
   - The report's count of checks run becomes 12.

## Tests

- **Domain:**
  - an override's status, open or settled, from its last line date and the account's completed reconciliations, including the edge where the end date equals the last line date;
  - the Exceptions check lists open ones only, with the sentence's facts;
  - the CSV prior rule: automatic when every line is after the prior end; refused when a line is on or before it; not applied when the CSV has running balances.
- **Migration test:**
  - the new function's grants, security definer, search path and role check;
  - the prior assertion inside the import function;
  - the rest of the import function is unchanged from 0143, compared line by line outside the new block.
- **Rolled-back verification on the sample company only:**
  - an out-of-balance import made as admin with a reason is listed as open, and as settled once a completed reconciliation reaches its last line;
  - a voided one is not listed;
  - a viewer may read it and an outsider may not;
  - a `prior` opening that differs from the last closing is refused, and one that equals it is accepted.

  Other schemas: structure only.
- **Smoke on PC-Test** (its existing override, plus an invented one, made and then undone), with screenshots of:
  - the import history tag and detail;
  - the reconciliation notice;
  - the Exceptions check.

## Not in this release

- OB-3b (a reconciliation that no longer agrees after a reversal, a void or a back-dated entry) is 2.12.
- OB-4 is 2.13.
- An override "acknowledged" by hand; the user chose settlement by reconciliation.
