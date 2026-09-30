# Statement upload that categorises itself — design

**Date:** 2026-09-30
**Branch:** `feat/statement-review` (from `main` at 1.70)
**Release:** 1.71

## 1. What is asked

The client's request: "Add bank statement upload, where the system can read the file and categorise the transactions itself based on the rules applied to OneBook. The one I made can read it."

"The one I made" is the client's prototype. Its bank statement import:

- reads CSV, OFX, QFX, QBO and QIF (not PDF or Excel — it asks for CSV instead);
- lets the reader choose columns, the date order and the sign convention;
- shows a **Review before posting** table in which every line already carries a proposed account and the reason for it — a match to an open invoice or bill, a rule, history, a transfer, or "already in the books";
- posts every ticked line with one button. Nothing reaches the ledger before that click.

## 2. Scope, as decided

Decided with the user on 2026-09-30:

- **In:** upload → categorise → review → post; and reading OFX/QFX/QBO/QIF plus choosing CSV columns.
- **Later, separately:** pairing transfers and shareholder-loan cheques; Beancount balance assertions.
- A line with nothing proposed and nothing chosen is **imported and left waiting**, never posted to a holding account.
- The review proposes ledger matches and document settlements as well as accounts.
- **Approach A:** import first, review straight after. Lines enter Banking as waiting lines, exactly as an import does today; the review screen for that import opens at once and can be reopened later.
- Nothing is posted without a person's click (unchanged from 1.70).

## 3. How it works

### 3.1 The flow

1. **Import statement** (the existing modal) accepts `.csv`, `.ofx`, `.qfx`, `.qbo` and `.qif`. The file is read in the browser.
2. A CSV whose columns are not recognised shows **Choose columns** before anything can be imported.
3. **Import N rows** inserts the lines through `acc_import_bank_statement`, as today, and gets back the import's batch id.
4. The browser goes to **Review import**, `/banking/imports/[id]`.
5. Ledger match suggestions are generated for the bank account right after the import, as **Find ledger matches** does today. The review page itself only reads, so a viewer can open it too.
6. The reader changes what they want and clicks **Post N lines**. Lines not posted stay waiting.
7. **Statement imports** on Banking shows **Review** on every import that still has waiting lines.

### 3.2 Reading files

All parsing is pure, in `lib/domain`, and runs in the browser.

**CSV**
- Column detection by header name stays as it is.
- When no date column or no amount (or money in / money out) column is recognised, or when the reader asks, **Choose columns** offers:
  - Date;
  - Description;
  - either one signed Amount or Money out plus Money in;
  - Reference (optional);
  - Balance (optional).
- Also: date order (Detect, Month/Day/Year, Day/Month/Year) and **Flip signs**.
- The choice is remembered per bank account in `localStorage` (a convenience; losing it only means choosing again).
- Rows without a readable date or amount are skipped and counted, as today.

**OFX, QFX, QBO** (one format under three names, SGML or XML)
- Each `<STMTTRN>` gives:
  - the date (`DTPOSTED`, first eight digits);
  - the signed amount (`TRNAMT`);
  - the description (`NAME`, then `MEMO` if it adds anything);
  - the reference (`CHECKNUM`, else `REFNUM`);
  - the bank's own id (`FITID`).
- The duplicate key is built from the bank account and the `FITID` rather than from date, amount and description. A re-downloaded file is recognised even when the bank has reworded a description.
- If the file's `ACCTID` does not end in the same four digits as the chosen bank account's masked number, the modal warns before import. It does not refuse: masked numbers are optional.

**QIF**
- Records split on `^`.
- Fields:
  - `D` — date, including the `'` year form (`9/30'26`);
  - `T` — or `U` — the amount;
  - `P` — payee;
  - `M` — memo;
  - `N` — number.
- Only bank and cash sections (`!Type:Bank`, `!Type:Cash`, `!Type:CCard`); other sections are skipped and counted.

**PDF and Excel** are refused with the sentence: "Save the statement as CSV from your bank, or download it as OFX or QFX."

### 3.3 One proposal per line

The review works out one proposal for every waiting line of the import. The first rule that applies wins:

| # | Proposal | When | Posting it |
|---|---|---|---|
| 1 | **Already in the books** — `JE-000123` | The line has a suggested ledger match (`acc_reconciliation`, status `suggested`) | `acc_decide_bank_match` approved; no new entry |
| 2 | **Pays INV-1001** — customer, or **Pays BILL-7** — vendor | Exactly one open invoice (money in) or bill (money out), in the bank account's currency, whose balance due equals the line's amount | `acc_settle_from_bank_transaction` with one allocation of the whole amount, method empty |
| 3 | **Rule N** → account | A bank rule matches (1.70) | `acc_categorise_bank_transaction` |
| 4 | **Usually** account · h of n | History suggests (1.70 thresholds: 2 entries, 3 in 4) | `acc_categorise_bank_transaction` |
| 5 | *Needs coding* | Nothing applies | Nothing, unless the reader picks an account |

Further rules:

- **Ambiguous documents.** Two or more open documents of the same amount produce no document proposal. **Why** says "3 open invoices of this amount — use Settle". Rules and history are then **not** consulted for that line: money that probably pays a document must not be coded to income or expense.
- **Pending feed lines** (`pending`) and lines that are no longer `unmatched` are listed as **Already handled** and cannot be ticked.
- **Ticking.** A line with a proposal starts ticked; a line needing coding starts unticked.
- **Changing a line.** The reader can:
  - pick any account in the line's picker (this makes it an account post);
  - untick it;
  - use **Create rule** (the 1.70 form).
- **Post N lines** sends the ticked lines in chunks of **50** to one server action.
  - A progress bar counts the lines done.
  - Each line goes through the same RPC as when done by hand, one at a time.
  - A refusal (a closed period, a document paid meanwhile, a line coded by someone else) is reported verbatim for that line, and the rest continue.
  - The result uses the batch summary helpers (`summarizeBatchResults`, `describeBatchResult`, `batchResultSeverity`).
- **Checked again on the server.** For each line the server re-reads the line and refuses unless it is still `unmatched`. For a match or a settlement, the reconciliation or document is taken from the request and validated by the RPC. For an account, the RPC validates the account. The server does **not** replace what the reader chose.

### 3.4 Review import screen

- **Header:**
  - file name, bank account, and import date;
  - counts: rows in the file (the batch's `row_count`), lines this import added, already in the books, pays a document, has an account, needs coding, already handled.
  - The modal's success message already says how many duplicates were skipped.
- **Table**, via `DataTable`, with one row per waiting line:
  - tick;
  - Date;
  - Description, with the reference under it;
  - Amount;
  - **Post as** — a tag for a match or document, or the account picker;
  - **Why**.
- It fits the 984px box at 1280.
- **Footer:**
  - **Post N lines**;
  - a note of how many lines will stay waiting;
  - **Back to Banking**.
- **Viewers** see the review read-only (no ticks, no pickers, no Post).
- **No waiting lines left:** the page says so and links back to Banking.

## 4. Software changes

### 4.1 Domain (pure, tested)

- `lib/domain/statement-files.ts` — `detectStatementFormat(fileName, text)`, `parseOfx(text)`, `parseQif(text)`. Each returns rows in the existing `StatementLine` shape plus an optional `externalId`, with skipped counts and, for OFX, the account id.
- `lib/domain/statement-import.ts` — `parseStatementRows` gains an explicit column mapping and `flipSigns`; `detectStatementColumns(headers)` reports what was recognised.
- `lib/domain/statement-review.ts` — `reviewProposal({ line, match, documents, coding })` returns the one proposal with its **Why** text; `REVIEW_POST_CHUNK = 50`.

### 4.2 Services

- `lib/services/banking.ts`
  - `importStatement` returns the batch id as well.
  - The row hash uses `externalId` when there is one: `statementRowHash([bankAccountId, "fitid", externalId])`.
- `lib/services/statement-review.ts`
  - `loadImportReview(sb, batchId)` reads, all paged:
    - the batch;
    - its waiting lines;
    - their suggested ledger matches;
    - open invoices and bills;
    - the 1.70 coding suggestions.
  - `postReviewItems(sb, items)` posts one item after another and returns the outcomes.

### 4.3 Actions and routes

- `app/(app)/banking/imports/[id]/page.tsx`
- `ReviewImportClient.tsx`
- `actions.ts`, with `postReviewItemsAction(batchId, items)`:
  - guarded by write permission;
  - at most 50 items per call;
  - revalidates `/banking` and `/reports`.
- `importStatementAction` returns the batch id.
- `ImportStatementModal` accepts the new formats and shows Choose columns and the account warning.
- `BankImportList` gets **Review**.

### 4.4 Database

No migration. Everything the review needs already exists and is protected by row-level security:

- the import batch;
- `import_batch_id` on each line;
- ledger match suggestions;
- the settlement RPC;
- the categorise RPC;
- rules and history (0126).

### 4.5 Changelog 1.71

- Bank statements in OFX, QFX, QBO and QIF.
- Choose columns for any CSV.
- Review import: every line proposed — a ledger match, an invoice or bill it pays, a rule or history — and posted in one click.

## 5. Proving it

1. **Unit tests**
   - OFX in SGML and XML form: the amounts and signs, the dates, `FITID`, `CHECKNUM`, the account id, and a malformed transaction skipped and counted.
   - QIF: both year forms, `U` against `T`, a non-bank section skipped.
   - CSV: the explicit mapping, money out and money in, flipped signs, day-first dates, and detection reporting what it recognised.
   - The duplicate key: two downloads with the same `FITID` and different wording give one hash.
   - Precedence:
     - a match beats a document;
     - a single exact document beats a rule;
     - two documents of the same amount give no proposal and suppress rules and history;
     - then a rule, then history;
     - pending and handled lines.
   - The post action: at most 50 items; a refusal reported without stopping the rest.
2. **Live, on the sample company PC-Test only**
   - Import a made-up OFX file into its sample bank account.
   - Review, post, and check the outcomes and the entries.
   - Undo what the test created: void the posted entries through Change, then undo the import.
3. **Gates and screenshots**
   - The four gates.
   - Smoke.
   - Screenshots of the import modal, Choose columns and Review import, in light and dark, at 1440 and 1280, shown to the user before any push.

## 6. Constraints

- **Language and style:** US English UI. No hex colours outside the token block. `DataTable` only. Paged reads.
- **Posting:** nothing is posted without a person's click.
- **Git:** stage files by name; no Co-Authored-By trailer; commit messages written with `printf`.
- **Public repository:** no real client names or data in repo files; test fixtures are invented.
- **Live data:** writes happen only on the sample company, with the user's approval.
