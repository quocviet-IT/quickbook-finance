# 1.83 — Keep the statement file as evidence that can be opened later

**Status:** design approved by the user, 2026-10-06.
**Builds on:** 1.78 (PDF statements read in the browser), 1.79 / 1.81 / 1.82 (reconciling from statement files), Reports › Saved (migration 0101; the Wave ledger import already keeps its file there).

## 1. The problem

When OneBook reads a bank statement it keeps what it read — the lines, the opening and closing balances, the file's name — but not the file. The file stays in the browser. A reconciliation therefore cannot show the statement it was reconciled against, and an auditor asking "where is the bank's own document for May?" gets a list of lines, not the bank's PDF.

## 2. Decisions taken by the user

1. **Every place a statement is read keeps its file:** Banking › Import statement, Bank Reconciliation › From statement files, and Import statement inside a reconciliation.
2. **Always, automatically** — nothing to tick. The same file (same SHA-256) is kept once and pointed to by everything read from it.
3. **Viewed inside OneBook:** a PDF is drawn page by page in the app, CSV shows as a table, OFX/QFX/QBO/QIF as plain text; Download beside it.
4. **A reconciliation made before 1.83 can be given its file later**, but only a file that reads to the same statement (§3.4).
5. **Approach A:** the files live in the Reports › Saved store (source "Bank"), which works today without a virus scanner. The Documents & Attachments feature stays paused and untouched.
6. If keeping a file fails, the import or reconciliation still goes on, and the screen says so plainly with the way to attach it later.

## 3. The screens

### 3.1 Keeping the file

- **Banking › Import statement.** After the lines are imported, the file is kept and tied to the import batch. The "Statement imports" table gains a File column with **View**. When every line was already in Bank Transactions no batch is made; the file is still kept and can be found in Reports › Saved.
- **Bank Reconciliation › From statement files.** On Sign off (or on starting the month that needs a look), each chosen file is kept once, before the first month is signed; every reconciliation made from that file points to it — a CSV year cut into twelve months gives twelve reconciliations and one file. A PDF holding statements for several accounts is kept once too.
- **Import statement inside a reconciliation.** The file is kept and tied to the reconciliation. Importing another statement into the same reconciliation replaces its kept lines, and its file with them: the file always matches the lines kept.

When a file cannot be kept (network, over 10 MB), the import or the reconciliation goes on, and the message says: "The statement file could not be kept: <reason>. Attach it on the reconciliation." The reconciliation then shows "No statement file" with **Attach the statement** (§3.4).

### 3.2 On the reconciliation

Beside the statement's name in the workspace: **"Statement file: <name> · View · Download"**, or **"No statement file · Attach the statement"** when it has none. The reconciliation report names the file, when it was kept, and the first 12 characters of its SHA-256, so a printed report can be matched to the file.

### 3.3 Viewing

**View** opens a page inside OneBook:
- a PDF is drawn page by page as images by the PDF reader OneBook already uses — nothing inside the file is run;
- a CSV shows as a table (as Reports › Saved already does);
- OFX / QFX / QBO / QIF show as plain text.

**Download** is always there. Reports › Saved lists these files under source "Bank", and its viewer gains the same PDF and text views.

### 3.4 Attach the statement (a reconciliation without its file)

Offered on any reconciliation without a file — in progress or completed. The person chooses a file; OneBook reads it in the browser with the same readers and looks for the statement whose last day is the reconciliation's statement date. It is attached only if:
- its **closing balance** equals the reconciliation's statement ending balance; and
- when the reconciliation keeps statement lines, the file's lines are **the same lines** (same count, each with the same date and amount, in order).

Otherwise nothing is kept and the message says what differs, for example: "This file's statement closes Jun 30, 2026 at $6,595.01; this reconciliation is to May 31, 2026 at $6,160.01." Attaching never changes the reconciliation's figures.

### 3.5 Evidence is not archived away

Reports › Saved lets a file be archived. A file a reconciliation or an import batch points to cannot be archived: "This file is the statement of the reconciliation to May 31, 2026 — it stays."

## 4. Data and security — migration 0135

Applied to the live database only after the user approves, before the code deploys.

- `acc_statement_reconciliation.statement_file_id uuid null references acc_saved_report(id)`, and the same column on `acc_bank_import_batch`.
- The Reports › Saved store accepts OFX / QFX / QBO / QIF, kept as `text/plain` (bucket MIME list, table check, app checks).
- **`acc_keep_statement_file(...)` returns the id of the kept file.** It requires `documents.manage` (by default admin and accountant — the people who reconcile). It refuses a storage path outside this company's own folder. When an active file with the same SHA-256 is already kept it returns that one (two people keeping the same file at once still give one row). It records source "Bank", a title naming the bank account and the statement period, and the period.
- **`acc_register_saved_report` gains the same folder check** — today it accepts any path string, so a crafted call could register another company's object.
- **Linking:**
  - a reconciliation started from a statement (1.81's run, 1.79's start) is created with its file;
  - `acc_set_reconciliation_statement` (Import statement inside a reconciliation) sets the file with the lines;
  - attaching later (§3.4) sets it only when the reconciliation has none;
  - an import batch's file is set once.
  
  Every link is written to the audit log.
- **Archive refused** for a file any reconciliation or import batch points to (`acc_archive_saved_report`).
- **Reading:** through the company's own `acc_saved_report` row (`documents.read`), with a signed link that lives 60 seconds — as Reports › Saved does today. The PDF view fetches the bytes with that link and draws them; no file is handed to the browser to open.

**Limits, stated plainly:**
- Files are not virus-scanned, as in Reports › Saved today; OneBook never opens one directly (PDF drawn as images, text shown as text) — only Download hands the file to the computer.
- When a file is attached later, reading and matching happen in the browser; the server checks what was read against the reconciliation's own figures but does not read the file again — as every statement import works today.
- 10 MB per file.

## 5. Testing

- **Unit:** matching a file to a reconciliation (choosing the statement by its last day; closing balance; lines in order; the messages for each difference); the kept file's title and period; recognising OFX / QFX / QBO / QIF; the messages when keeping fails.
- **SQL verify script**, in transactions always rolled back, on all six companies:
  - same SHA-256 returns the kept file;
  - a path in another company's folder is refused by both `acc_keep_statement_file` and `acc_register_saved_report`;
  - linking only when there is none;
  - importing another statement into a reconciliation moves its file with its lines;
  - archiving a file in use is refused;
  - a viewer and someone outside the company cannot keep a file;
  - anon can call none of the functions.
- **Whole suite:** typecheck, lint, unit tests, build, bundle budget.
- **Live check on PC-Test only**, with a new bank account and invented statements:
  - Banking › Import statement → View shows the file;
  - From statement files with a CSV of three months → the three reconciliations point to one file;
  - View a PDF → its pages in the app;
  - Attach the statement on an earlier reconciliation (the 1.81 sample accounts) → a file of another month refused, the right file attached;
  - Reports › Saved refuses to archive a file in use.
  
  Screenshots, light and dark, approved by the user before the push.
- **Release:** changelog 1.83; guide steps "View the statement file" and "Attach the statement".

## 6. Out of scope

- Virus scanning (when the scanner exists).
- Bills, receipts and contracts (Documents & Attachments).
- OCR for scanned files (deferred by the user).
- Keeping files read before 1.83 automatically — OneBook never held them; they can only be attached by hand.
