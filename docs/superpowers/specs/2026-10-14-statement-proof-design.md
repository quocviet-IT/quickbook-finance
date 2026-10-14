# Statement proof and repeated lines (release 2.04)

## Why

An external engineering review of one client's books (13/10) found nine issues. It ranked these three first:

- **OB-2:** a statement import is not proved against the balances the bank printed on it.
- **OB-1:** import de-duplication drops genuine repeated lines.
- **OB-3:** nothing shows how much bank activity is unreconciled.

The user chose this order of releases:

| Release | Contents |
|---|---|
| 2.04 | OB-2 and OB-1 |
| 2.05 | OB-3 and OB-7 |
| 2.06 | OB-4, OB-5 and OB-6 |
| 2.07 | OB-8 and OB-9 |

This spec is 2.04.

### What OneBook does today

**OB-1: repeated lines are kept by OneBook's own code.**

- **Statement import** counts identical lines (`statementLineHashes`, `lib/domain/banking-import.ts`): an occurrence counter since 03/10. Run on invented data, a file of three identical lines with one already present imports two, and importing the file again imports nothing.
- **Transaction import** has counted repeats since 07/08.
- **The review's missing lines** came from the client's prototype, whose old importer asked "seen before?". They were carried in when the books were loaded, and have since been added back.

What is missing:

1. The summary only says "N duplicate(s) skipped". It never says "3 identical lines, 1 already present, 2 imported".
2. Two lines with the same FITID in one OFX file collapse to one.
3. Lines brought in by different paths do not recognise each other. A statement file imported into an account whose bank lines came from the books, a bank feed or another file arrives as new lines beside their twins.

**OB-2: only a PDF is checked, and only as advice.**

- **PDF:** `statementProof` gives "Out by …", but the button still reads "Import N lines anyway" (`ImportStatementModal.tsx`).
- **CSV:** a running balance is stored, and checked only in the statement-files run.
- **OFX:** `LEDGERBAL`, `DTSTART` and `DTEND` are never read.
- **QIF:** carries no balances, and an "Opening Balance" record would be imported as a line.
- **Statement-files run:** marks an out-by statement "does not prove itself" and still runs it.
- **Server:** nothing on the server checks opening + lines = closing.

### What the mockup does

The mockup (Accounting System v4, 2.33) proves a statement only through the reconciliation against the books. It has no check at import.

It does state the principle this release follows: a closing balance is only ever read from the statement. A figure worked out from the books would agree with the books whatever the truth was.

## Decisions (user, 14/10)

1. **A statement that does not add up is blocked.** The person can fix it in the dialog by marking a misread line Not a transaction, or by typing a missing balance. Only an administrator may import anyway, and must give a reason, which is recorded. The database checks again; the screen alone is not enough.
2. **When the file prints no balance**, OneBook takes one itself only when it is sure:
   - the opening from the prior statement's closing, when the new statement starts the next day;
   - the closing from an OFX `LEDGERBAL`, or from a CSV balance column.

   Otherwise the person types the figure printed on the statement. Nothing is ever taken from the books.
3. **OB-1:**
   - a clear count of repeated lines;
   - regression tests on invented data;
   - the FITID fix;
   - a warning, in the dialog, for lines already in Bank Transactions from another source. Those lines are skipped by default and can be chosen back. Stored hashes do not change.

## Part 1: the rule and the data

### The proof (`lib/domain/statement-proof.ts`, pure)

A statement proves itself when opening + the sum of its lines = closing, to the cent.

**Lines that count.** Lines marked Not a transaction in the dialog take no part: they are neither counted nor imported. Lines skipped as already present still count, because the proof is about the statement, not about what is new.

**The closing, in order of trust:**

1. the closing balance printed on a PDF;
2. the balance on the last line of a CSV with a balance column, after putting a newest-first file in order;
3. an OFX `LEDGERBAL`, only when its as-of date is on or after the file's end date (`DTEND`, else the last line's date);
4. typed by the person.

**The opening, in order of trust:**

1. the opening balance printed on a PDF, or derived from its running balances as today;
2. the first balance of a CSV minus its first amount;
3. the prior statement's closing, which is the last completed reconciliation's statement ending balance for the account:
   - **taken automatically** only when the statement's start is known (a PDF period or OFX `DTSTART`) and is the day after that reconciliation's ending date;
   - **offered with a button** otherwise: "Use $X (the closing of the reconciliation to Feb 28, 2026)". It is not offered when lines fall on or before that date.
4. typed by the person.

**Never from the books.** Each figure carries its basis, so the screen can say where it came from:
- opening: `printed`, `running`, `prior` or `typed`;
- closing: `printed`, `running`, `ledger` or `typed`.

**CSV chain.** A CSV with a balance column also checks each balance against the one before plus the line. The first break is named, for example "the balance jumps after the line of Mar 14, 2026 (−412.30)", so the person knows where a line is missing.

**One line out.** When the statement is out by exactly the amount of one line, and only one, that line is named as possibly misread. This is the 2.03 Extra rule.

**The result** has:
- `openingMinor` and `closingMinor`, each possibly null;
- the two bases;
- `linesMinor` and `differenceMinor`;
- `proves`;
- `missing` (opening, closing, or both);
- the chain break, if any;
- the one-line hint, if any;
- the sentences.

### The database (migration 0143, additive only)

**`acc_import_bank_statement_proved(p_bank_account_id uuid, p_filename text, p_rows jsonb, p_proof jsonb)`**

- `p_rows` carries every line of the statement except those marked Not a transaction. A line skipped as already present from another source is sent with `"skip": true`: it counts in the proof but is not imported.
- `p_proof` carries:
  - the opening and closing, and their bases;
  - the number of lines marked Not a transaction;
  - an optional override `{ "reason": text }`.
- It recomputes opening + the sum of all `p_rows` − closing from what it is sent.
- **Refuses when:**
  - the opening or closing is missing;
  - the difference is not 0 and there is no override;
  - an override comes from someone who is not an administrator;
  - an override has an empty reason.
- **Otherwise** it imports the lines not marked `skip` exactly as `acc_import_bank_statement` does, in one transaction:
  - the same occurrence-counted hashes;
  - the same `skipped` count;
  - the same batch.
- **Stores the proof on the import batch.** New nullable columns on `acc_bank_import_batch`: `statement_opening_minor`, `statement_closing_minor`, `opening_basis`, `closing_basis`, `out_by_minor`, `override_reason`, `overridden_by`.
- **An override writes one audit row** with the reason and the amount out.
- Security definer, `search_path` pinned. Writes are for staff, overrides for administrators only. Executable by `authenticated` and `service_role`; revoked from `public` and `anon`.
- `acc_import_bank_statement` stays as it is in 2.04, so the running release keeps working until the new one is deployed. A later release revokes it.

**`acc_bank_lines_on(p_bank_account_id uuid, p_from date, p_to date)`** (read)

- Returns the account's bank lines in that range with date, amount, raw hash, the kind of source, and import batch.
- The kind of source is one of:
  - `books`: made from the ledger, with a `ledger:` hash;
  - `feed`: from a bank feed;
  - `import`: from a statement or transaction import;
  - `other`.
- The dialog uses it for the repeated-line counts and the other-source warning.
- It is paged past the 1,000-row cap.

### Where the rule applies

All four ways a statement comes in:
- Banking › Import statement;
- importing into a reconciliation;
- attaching a statement to a reconciliation (on top of the existing checks that it is that reconciliation's statement);
- Reconcile › From statement files.

The server actions recompute the proof from the payload and call the new function.

In a statement-files run, a statement that does not add up stops the run at that statement: "Out by … — import this statement on its own to correct it."

Import data › Transactions / Ledger and the bank feed are not statements and are unchanged.

## Part 2: the screens

### The statement import dialog

**Proof panel**, for every format:

- **Adds up:** "Opening $X (printed) + 42 lines −$Y = $Z, the closing balance the statement prints ✓".
  - The basis is said in words: printed / from the running balance / from the reconciliation to {date} / typed.
  - The button reads "Import 42 lines", one click as today.
- **Out:** "Out by $V. The opening $X and the 42 lines come to $W; the statement closes at $Z."
  - Then the chain break or the one-line hint, when there is one.
  - The button is disabled, and the panel says: "Import is blocked until the statement adds up."
- **A balance missing:** the fields "Opening balance printed on the statement" and "Closing balance printed on the statement", with the "Use $X (…)" button when a prior closing is on offer.

**Lines preview.** Each line has a "Not a transaction" tick. A ticked line is struck through, left out of the count and not imported.

**Administrators** see "Import anyway…", which asks for a reason (required) and imports with the override. Others read: "An administrator can import it anyway, with a reason."

### Repeated lines and other sources (OB-1)

**In the preview:**
- **Repeated lines:** "3 identical lines on Mar 31, 2026 (−412.30): 1 already in Bank Transactions, 2 will be imported."
- **Lines already here from another source:** "Already in Bank Transactions from another source (the books, a bank feed or another file)".
  - A line qualifies when its own hash is not already present, and the account has a bank line on the same date with the same amount that no line of this file accounts for. The description is not compared, because lines made from the books carry the entry's wording, not the bank's.
  - The count rule applies: two in the file and one already there marks one.
  - These lines are skipped by default, and each can be ticked back to import.

**After the import:** "Imported 40 lines. 2 were already here from this statement; 3 skipped as already in Bank Transactions from another source; 3 repeated lines on Mar 31 kept." Each part appears only when it is not zero.

### Reconciliation and statement-files run

- **A reconciliation** keeps the proved or typed opening and closing, so its opening and closing advice uses them.
- **The statement-files run table** shows each statement's proof, and stops at the first that does not add up.

## Part 3: readers, tests, release

### Readers

- **OFX / QFX / QBO:** read `LEDGERBAL` (`BALAMT`, `DTASOF`) and `DTSTART` / `DTEND`. Compare dates, not timestamps.
- **QIF:** an "Opening Balance" record becomes the opening, not a line.
- **FITID:** two lines with the same FITID in one file both stay, counted as repeats.

### Tests (invented data only; the repository is public)

- **OB-1 regression:**
  - payroll-shaped files of 2 + 3 identical lines on one day, in CSV, PDF (glyph fixture), OFX without FITID, OFX with a repeated FITID, and QIF;
  - with one line already present, three identical lines import two;
  - importing the file again imports nothing.
- **Other-source detection:** the count rule, and the sources.
- **Proof:**
  - a PDF with printed balances;
  - a PDF with running balances only;
  - a CSV chain with a break located;
  - a CSV without balances, typed;
  - an OFX `LEDGERBAL` on the end date, and a later one that is not used;
  - QIF;
  - the prior-closing fallback: automatic with a known start, offered without one, refused across a gap;
  - Not a transaction lines;
  - the one-line hint.
- **Migration 0143:** a text-level test, plus a rolled-back verification script that writes on the sample company only. It checks:
  - refused when out;
  - accepted when it adds up;
  - administrator override recorded with an audit row;
  - non-administrator override refused;
  - the proof stored on the batch;
  - the lines read back by `acc_bank_lines_on`.
- **Smoke with screenshots on PC-Test,** in light, dark and phone, covering:
  - an invented PDF with a misread line: blocked, the line ticked Not a transaction, then it adds up and imports;
  - a CSV missing a line: blocked, with the jump named;
  - an OFX with `LEDGERBAL`;
  - a QIF with a typed closing;
  - an administrator override with a reason;
  - an import into a reconciliation;
  - a statement-files run that stops at a statement that does not add up.

### Release

- **2.04:** the changelog says what the user sees. The Guide gains the import and proof steps.
- **Migration 0143** goes live only with the user's approval.

## Not in this release

- A shared identity key across import paths. It would change stored hashes and needs a migration of its own.
- Revoking the old `acc_import_bank_statement`. That comes in the release after 2.04 is live.
- OB-3 and the rest of the review: releases 2.05–2.07.
- The matcher improvements formerly planned as 2.04.
