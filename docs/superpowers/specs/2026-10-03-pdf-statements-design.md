# PDF bank statements on Import statement (1.78) — design

**Date:** 2026-10-03
**Branch:** `feat/pdf-statements` (from `main` at ace457f)
**Roadmap:** `docs/superpowers/specs/2026-10-02-prototype-228-parity-roadmap.md`, Phase 4 item 21, brought forward at the
client's request.

## 1. What is asked

The client, after moving off their previous accounting software, receives bank statements as PDF every month and asked
for OneBook to read them, as the prototype *Accounting System 2.28* does. The client's note: use the prototype as the
reference, without blindly replicating areas where OneBook has the stronger implementation.

Decided with the user on 2026-10-03:

- **Both uses, import first.** One PDF reader. Release 1.78 puts it on Banking › Import statement, so a PDF's lines go
  through Review import like any CSV or OFX. Release 1.79 (its own spec) puts the same reader on reconciliation,
  including reconciling a run of statements.
- **Approach A:** the PDF is read in the browser, by a TypeScript port of the prototype's reader, with pdf.js bundled
  into OneBook. The file never leaves the browser; only the lines read are sent, as for every other format.
- A statement that does not prove itself can still be imported, after the person has seen by how much it is out.

## 2. The reference: the prototype's reader (`src/p44.html`)

`readStatementFile` → `pdfToRows` → `splitByAccount` → `readStatementRows`, in the prototype used only by
"Reconcile from the statements themselves" (`p44b`). What it does, and what 1.78 ports:

| Step | Prototype | Lines |
|---|---|---|
| Glyphs to rows | every text item on one baseline (`round(y / 3)`) is one row, cells sorted by x; pages in order, top to bottom | 65–95 |
| Money | a figure has two decimals; `(1.00)`, `-1.00` and a trailing `1.00-` are negative; `$` and thousands commas allowed | 14–40 |
| Period | four ways a statement names its dates: `Jan 1 - Jan 31, 2026`, `01/01/2026 - 01/31/2026`, `Beginning balance on 1/1 … Ending balance on 1/31` with the year in a corner, `as of / statement date / closing date …`; a period that starts in December opens in the year before | 121–158 |
| Opening and closing | the first row matching an opening / closing label, with its figure on the same row or one of the next two | 98–119, 257–261 |
| Sections to skip | daily balances, ending balance, cheque images, balance / interest / account / card summaries, "how to balance"; the skip lasts until a heading such as "Transaction history" announces activity again; a line starting "Total" ends a section | 164, 310–323 |
| Section sign | a heading naming withdrawals, debits, cheques, fees, charges or payments out means money out; deposits, credits, additions or payments in means money in | 165–166, 313–316 |
| Column headings | a row is a heading only if no cell is a figure or a date; a heading split over two lines is read down each column (`foldHeading`), taking in a line above only when it has several cells and every one sits over a column; Date, Debit, Credit, Amount and Balance columns are named by fixed word lists; a heading with several Date columns is a grid — of cheques when it has an amount, of balances (skipped) when it has none | 170–237 |
| A line | a row with a date in its first cell or under the Date column; grid rows split at each date | 304–345 |
| Running balance | a figure counts as the balance only when the Balance column is the column it is nearest to, within 70 points | 352–364 |
| Sign of a line | in order: the change in the running balance, when it equals the figure; the sign the bank printed; the column the figure sits under (Debit or Credit); the section's sign | 249–252, 366–383 |
| Year of a line | a line without a year takes the statement's; a December line on a January statement takes the year before | 267–277 |
| Cheque number | "Check No. 1234" in the text, or a bare 2–7 digit word in a cheque table | 281–287 |
| Restatements | a later section whose lines (date + amount) are at least 80% already read is dropped | 389–415 |
| Missing totals | with no printed closing (opening), the last (first) running balance stands in | 417–429 |
| Combined statements | the rows are cut at each `Account number: …` line; the same account named twice is one account | 468–489 |
| Self-proof | opening + the lines read = the printed closing balance; tested by its author on 45 real statements from four banks | README |

## 3. Where OneBook keeps its own way

| Prototype | OneBook in 1.78 | Why |
|---|---|---|
| Floating-point dollars rounded with `r2` | every figure read straight into integer cents; no float arithmetic | the rule for money everywhere in OneBook |
| pdf.js 3.11.174 fetched from a CDN at run time | `pdfjs-dist` 6.x, a pinned dependency bundled with the app, its worker served from OneBook, `isEvalSupported: false` | 3.11.174 has a published flaw (CVE-2024-4367) that lets a crafted PDF run script; no third-party fetch at run time |
| An impossible date (02/30) is kept as the string `2026-02-30` | a line whose date does not exist is skipped and counted | as every other OneBook reader does |
| `isDateCell` accepts `.` between month and day, so `75.00` reads as month 75, day 00: in a cheque grid every cheque under $100 starts a false segment and is lost, and a restated cheque table is then only partly recognised and counted twice | a figure with two decimals is never a date | found by running the prototype's own code on the scenarios of section 5: one cheque grid out by $75.00, one restated table out by $150.00 |
| `as of / statement date / closing date` takes the gap before the month greedily, so "Statement date: November 30, 2026" yields the month "ber"; only three-letter months and "May" work, and a statement dated that way loses every line | the gap is matched lazily; the whole month name is read | same run |
| pdf.js joins a date to the words printed just after it ("07/02/2026 EXAMPLE DEPOSIT") when the gap is narrow; the cell is then neither a date nor words, and the line is missed | a cell that starts with a date followed by words is read as the date and the words | found reading generated PDFs through pdf.js |
| The account number is only used to split | the statement's account number is checked against the bank account chosen, as for OFX | an existing OneBook protection |
| The reader feeds a reconciliation that signs itself off | the lines go to Review import; nothing is posted until a person ticks and clicks Post | OneBook's rule; reconciliation is 1.79 |
| — | duplicate lines and re-imported files recognised, as for every format | an existing OneBook protection |

The prototype is stronger in one place OneBook will now follow, for every format: **two identical lines in one file are
two lines.** Today `importStatement` keys each line on bank account, date, amount, description and reference, and the
database keeps one row per key (`on conflict (bank_account_id, raw_hash) do nothing`), so a second identical line in the
same file — two $5.00 fees on one day — is silently counted as skipped. 1.78 numbers repeats within one import: the
first keeps today's key, the n-th identical line (n ≥ 2) adds `#n` to it. Re-importing the same file meets every key
again, and a line imported before 1.78 still recognises itself.

## 4. Design

### 4.1 Reading the PDF — `lib/client/pdf-text.ts` (browser only)

- `readPdfGlyphs(data: ArrayBuffer): Promise<PdfGlyphs>` loads `pdfjs-dist` with a dynamic `import()` the first time a
  PDF is chosen (so /banking does not grow), sets the worker from the package's own file, and returns every page's text
  items as `{ page, x, y, text }` (x, y from the item's transform).
- Errors become one of three answers, never a guess:
  - no text item on any page → `scanned`;
  - pdf.js asks for a password → `password`;
  - anything else → `unreadable`.

### 4.2 The statement reader — `lib/domain/pdf-statement.ts` (pure)

A line-by-line port of section 2, in TypeScript, in cents. Public surface:

```ts
export interface PdfGlyph { page: number; x: number; y: number; text: string }
export interface PdfRow { cells: { x: number; text: string }[]; text: string }
export interface PdfStatementLine {
  date: string;              // ISO
  description: string;       // the words of the row, at most 90 characters
  checkNumber: string | null;
  amountMinor: number;       // positive is money in
  balanceMinor: number | null;
  raw: string;               // the row as printed
}
export interface PdfStatement {
  accountNumber: string | null;   // digits only, when the PDF names one
  from: string | null;
  to: string | null;
  openingMinor: number | null;
  closingMinor: number | null;
  lines: PdfStatementLine[];
  skipped: number;                // dated rows whose date does not exist
}
export function rowsFromGlyphs(glyphs: PdfGlyph[]): PdfRow[];
export function readPdfStatements(glyphs: PdfGlyph[]): PdfStatement[];   // one per account in the file
export function statementProof(s: PdfStatement): { linesMinor: number; differenceMinor: number | null };
export function toStatementLines(s: PdfStatement): StatementLine[];     // for Import statement
```

`differenceMinor` is null when either printed balance is missing. `toStatementLines` maps `checkNumber` to `reference`,
`balanceMinor` to `running_balance_minor` and `raw` to `raw_line`.

### 4.3 Import statement

- `detectStatementFormat` returns `{ format: "pdf" }` for a `.pdf` name or a `%PDF` header (today it refuses both).
  Excel and Numbers stay refused.
- `ImportStatementModal` accepts `.pdf`. For a PDF it reads the file as bytes, not text, and skips the column chooser:
  columns come from the page.
- A PDF that holds several statements offers a choice — `Account ending 1234 · Jan 1 – Jan 31, 2026 · 42 lines` — with
  the one whose last four match the bank account chosen already selected.
- Below the file name, the statement's summary: its period, opening balance, money in (lines, total), money out (lines,
  total), closing balance, and one proof line:
  - proves: `Opening $1,000.00 + lines $250.00 = $1,250.00, the closing balance on the statement.`
  - out: `Out by $40.00: opening $1,000.00 + lines $210.00 comes to $1,210.00, and the statement closes at $1,250.00. A line may not have been read — check before importing.`
  - no balances: `The statement shows no opening or closing balance, so it cannot prove itself.`
- The button reads `Import 42 lines` when the statement proves, and `Import 42 lines anyway` when it is out or cannot
  prove itself.
- The account-number warning that OFX shows applies to a PDF's account number too.
- A PDF can be read only into an account whose currency has two decimal places; otherwise:
  `A PDF statement can be read only into an account kept in a currency with two decimal places.`
- Errors, under the file name:
  - scanned: `This PDF holds no text — it looks like a scanned image. Download the statement from online banking as a PDF, or as CSV, OFX or QFX.`
  - password: `This PDF is locked with a password. Open it, save a copy without the password, and choose that copy.`
  - unreadable: `This PDF could not be read.`
  - no lines: `No dated amounts could be read out of this PDF.`
- The import itself is `importStatementAction` as today; Review import opens after it.

### 4.4 Repeated lines — `lib/domain/banking-import.ts`, `lib/services/banking.ts`

`statementLineHash(bankAccountId, line, occurrence = 1)` adds `#<occurrence>` to the key parts only when
`occurrence > 1`. `importStatement` counts identical lines (same date, amount, description and reference; lines with a
bank id are unaffected) in file order and passes each its occurrence. Applies to CSV, OFX, QIF and PDF alike.

## 5. Proving it

Verified before planning: the reader of section 4.2, written out in full, was run on sixteen invented statements next to
the prototype's own `p44` code. It agrees with the prototype line for line on every statement except the four that
exercise the departures of section 3, and every one of the sixteen proves (opening + lines = closing) — including the
four the prototype misreads. Generated as real PDFs and read through `pdfjs-dist` 6.3, all sixteen prove too.

- **Unit tests**, invented data only ("Example Bank", account ending 0000), on synthetic glyph fixtures built by a small
  helper that lays out rows at given x positions: each row of the table in section 2 has at least one test — the money
  forms, each period form, a two-line heading, a balance grid skipped, a cheque grid read, the balance-column test with a
  withdrawals column close to it, each of the four sign rules, a December line on a January statement, a restated
  cheque table dropped, missing totals standing in, a combined statement split, an impossible date skipped.
- **The PDF itself:** a few statements generated with `jspdf` (already a dependency) are read end to end through
  `pdfjs-dist`'s Node build in a unit test, and through the real browser path in the live check below.
- **Parity with the prototype:** a test under `npm run parity` opens the prototype (as Phase 0 does), hands its own
  `pdfRowsFrom`, `splitByAccount` and `readStatementRows` the same glyph fixtures, and compares period, opening, closing
  and every line with OneBook's reader, to the cent. A difference is either one of section 3's deliberate ones (stated in
  the test) or a defect.
- **Repeated lines:** unit tests for the occurrence key; a live check that two identical lines in one file both arrive.
- **Live check on the sample company** (PC-Test): import a generated PDF, see the summary and the proof, Review import,
  post a line, undo it; screenshots approved before the push.

## 6. Release

1.78: changelog entry and a guide step "Import a PDF statement". No migration.

## 7. Out of scope

- PDF on reconciliation, and reconciling a run of statements — 1.79, its own spec.
- Scanned statements (OCR).
- Keeping the PDF file itself (Documents is paused).
- PDF statements in currencies without two decimal places.

## 8. Constraints

- No real statement, bank name, account number or figure in the repository; fixtures are invented. Real statements, if
  the client sends any, are read on the local machine only.
- US English UI. Money in minor units. Nothing posts without a person's click.
- Changelog entry and guide step; screenshots approved before the push.
