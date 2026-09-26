# Beancount Export

- Date: 2026-09-26
- Status: Approved design, ready for planning
- Source of requirements: `Accounting-System-v3.html`, the client's single-file
  prototype — the "Beancount file" module (lines 1763–1918) and its tab
  (`renderLedger`, line 2546)
- Scope: one report page, one download, no migration
- Second of the ten modules the prototype specifies and OneBook lacks. The first,
  the Exception Report, is `2026-09-25-exceptions-report-design.md`.

## 1. Why this one

The client's own statement of the work opens with *"the ledger is prepared in
Beancount v3 with USD as the operating currency and an accrual basis"*, and the
prototype has a whole tab for it. It is the only module both documents name.

A `.beancount` file lets the accountant run the tools they already use —
`bean-check` to prove the books balance, Fava to browse them — directly on
OneBook's data, instead of on a ledger kept somewhere else.

## 2. The constraint: this must not change a figure

Same guarantee as the Exception Report, same way of proving it:

1. **No write to the books.** Every read is a `select` or a read-only RPC. No
   insert, update, delete, upsert or posting RPC touches a ledger table.
2. **The domain module is pure** and a test fails if it imports from `@/lib/db/`
   or `@/lib/services/`.
3. **No migration.**

There is exactly **one** write, and it is not to the books: one row in the audit
log through the existing `acc_log_company_export` RPC, required by US-FR-013
(§6). It is the same write the company ZIP export already makes.

## 3. What the file contains

Following the prototype, in this order:

1. **Header.** Comment lines naming the company, the generation date and
   "Beancount v3 format"; `option "title"` with the company's legal name;
   `option "operating_currency"` with the base currency; comments for the fiscal
   year's first month and the accounting basis where OneBook records them.
2. **Chart of accounts.** One `open` directive per account, grouped by root in
   the order Assets, Liabilities, Equity, Income, Expenses.
3. **Prices.** A `price` directive per recorded exchange rate, only for
   currencies that appear in a posted entry and differ from the base currency.
   Omitted entirely for a single-currency company.
4. **Transactions.** Every posted entry, oldest first, ordered by date then entry
   number, with a comment line opening each month.
5. A closing comment.

### 3.1 Deliberately left out

- **The TIN.** The prototype writes the tax identification number into the
  header. OneBook's rule, set by the 1099 module, is that the TIN never enters a
  report or the audit trail. That rule holds here.
- **Voided entries.** Beancount has no void. A voided entry is not in the books,
  so it is not in the file. Reversal entries are posted entries and are included.
- **Balance assertions.** Not in the prototype. Possible later from completed
  reconciliations.

## 4. Account names

Beancount requires names of the form `Root:Component:Component`, where each
component begins with an upper-case letter or a digit and contains only letters,
digits and hyphens. OneBook's account names are free text and **are not unique** —
only `account_code` is, and a real chart has been seen with duplicate names.

So a name is built from the account's type and its code:

| `account_type` | Prefix |
|---|---|
| `bank` | `Assets:Bank` |
| `accounts_receivable` | `Assets:Receivable` |
| `current_asset` | `Assets:Current` |
| `fixed_asset` | `Assets:Fixed` |
| `accounts_payable` | `Liabilities:Payable` |
| `credit_card` | `Liabilities:CreditCard` |
| `current_liability` | `Liabilities:Current` |
| `equity` | `Equity` |
| `income` | `Income` |
| `other_income` | `Income:Other` |
| `cost_of_goods_sold` | `Expenses:COGS` |
| `expense` | `Expenses` |
| `other_expense` | `Expenses:Other` |

The last component is `<code>-<name>`, sanitised:

1. Decompose accents and drop the combining marks, and map `đ`/`Đ` to `d`/`D`,
   so a Vietnamese name keeps its letters.
2. Replace every character that is not an ASCII letter or digit with `-`.
3. Collapse runs of `-` and trim them from both ends.
4. Upper-case the first character if it is a lower-case letter.
5. If nothing is left, use `Account`.

Example: `1010` / "Bank Account - VND" → `Assets:Bank:1010-Bank-Account-VND`.

Because the code leads, two accounts cannot share a name unless their codes
sanitise identically — possible in principle (`1010` and `1010.`). **That case
must never merge two accounts' balances silently.** Colliding names are
disambiguated deterministically by appending `-` and the first six characters of
the account id, and a test proves it.

Renaming an account in OneBook changes its Beancount name; its code does not
change, so the account remains recognisable across exports.

## 5. A transaction

```
2025-02-20 * "Northwind Supply" "Payment for bill BILL-000123" #bill_payment ^BILL-000123
  entry: "JE-000456"
  num: "1171"
  Liabilities:Payable:2000-Accounts-Payable      3450.00 USD
  Assets:Bank:1010-Operating-Checking           -3450.00 USD
```

- **Payee** is the entry's counterparty, taken from `acc_transaction_list`, which
  already resolves the party for every source type. An entry with no
  counterparty has no payee: `date * "narration"`.
- **Narration** is the entry's description.
- **Tag** is `#` and the entry's `source_type`.
- **Links.** An invoice or bill carries `^` and its document number. A payment
  carries the numbers of the invoices it settled, through
  `acc_payment_allocation`; a bill payment the bills, through
  `acc_bill_payment_allocation`. So Fava groups a document with the payments that
  settled it — the behaviour the prototype describes.
- **Metadata.** `entry:` always, carrying OneBook's entry number so every line
  in the file traces back. `num:` when the source payment carries a reference —
  a check number, a wire reference. `due:` when the source invoice or bill has a
  due date.
- **Strings** are escaped the Beancount way: backslash and double quote are
  backslash-escaped, and carriage returns, line feeds and tabs become spaces. The
  prototype replaced `"` with `'`, which changes the data; this does not.
- **Tags and links** contain only characters Beancount allows in them; anything
  else becomes `-`.

### 5.1 Currency — the easiest place to produce an invalid file

OneBook enforces balance in the **entry's own currency**: a trigger requires
`sum(debit_minor) = sum(credit_minor)` for each entry. The base-currency figure,
`amount_base_minor`, is converted and rounded **line by line, with no constraint
that it sums to zero**. Posting base amounts would therefore let an entry in a
foreign currency be out by one minor unit, and `bean-check` would reject the file.

So each posting carries the **entry's own currency**, and the amount is
`debit_minor − credit_minor` divided by that currency's `decimal_places` (0 for
VND, 2 for USD). Every transaction balances exactly, by the database's own
invariant. The `price` directives of §3 let Fava convert. For a company that
posts only in its base currency the output is identical either way.

`open` directives carry no currency constraint, so an account may hold more than
one currency. Each account is opened on the date of the earliest posted entry in
the book, which is on or before its first posting by construction.

## 6. The page, the download and the audit

**Route:** `/reports/beancount`, in the Accounting group of the reports
catalogue.

**The page shows** the number of posted entries, the number of accounts, the
first and last entry dates, and the currencies in use; a **Download** button; and
the prototype's instructions for running the file:
`pip install beancount fava` · `bean-check <file>` · `fava <file>`.

**The download follows the company ZIP export exactly**
(`app/(app)/settings/company/actions.ts`):

1. A server action checks `acc_has_permission('company.export')`. This file *is*
   the whole ledger, so it takes the same permission as exporting the company.
2. It reads everything and builds the text.
3. It records the export through `acc_log_company_export`.
4. **If the audit write fails, the file is withheld.** An unrecorded export of the
   books is what US-FR-013 forbids.
5. It returns the text; the client saves it as `<company-slug>.beancount`.

A user without the permission sees the page with the button disabled and a line
saying why.

### 6.1 How the export is recorded

The audit RPC accepts a fixed set of keys. They are filled truthfully:

| Key | Value |
|---|---|
| `generated_at` | the one clock reading the export takes |
| `schema_version` | the schema version, as the ZIP export reads it |
| `manifest_sha256` | SHA-256 of the exact text returned |
| `table_count` | the number of distinct sources read — tables and the one RPC — counted from the list in §7, not typed in |
| `total_rows` | entries plus lines written to the file |
| `included_sensitive` | `false` — no TIN, by §3.1 |

**Known limitation, accepted:** the RPC has no field for the format, so the audit
row for a Beancount export looks like the row for a ZIP export. The two are told
apart by the hash. A one-key migration can add a `format` field if an auditor
needs it; it was judged not worth losing "no migration" for now.

## 7. Reads, and why every one is paged

PostgREST caps a response at 1,000 rows and reports no error. This repository
measured it on a table select (`lib/services/transaction-import-preview.ts`), and
PostgREST's own documentation applies the limit to stored-procedure results too.
A file that silently stops at the thousandth entry would still pass `bean-check`
— with the wrong balances. So **every read is paged** with `.range()` and an
`.order()`, RPC and table alike.

| Read | Gives |
|---|---|
| `acc_account` | code, name, type, id |
| `acc_journal_entry` with embedded `acc_journal_line`, `status = 'posted'`, ordered by date and entry number | the transactions and their postings |
| `acc_transaction_list` over the whole book | counterparty per entry |
| `acc_invoice`, `acc_bill` | document number and due date per source id |
| `acc_payment`, `acc_bill_payment` | reference per source id |
| `acc_payment_allocation`, `acc_bill_payment_allocation` | which documents each payment settled |
| `acc_currency` | base currency and decimal places |
| `acc_exchange_rate` | the price directives |
| company settings | legal name, fiscal year start, basis |

### 7.1 All or nothing

The Exception Report tolerates a failed read: seven checks still run and the
eighth says it could not. **A ledger file cannot.** A file missing one page of
entries still parses and still passes `bean-check`, and its balances are wrong.
So any failed read fails the whole export with a message naming what could not be
read, and no file is offered.

## 8. Architecture

| File | Responsibility |
|---|---|
| `lib/domain/beancount.ts` | Pure. Account naming, escaping, amount formatting, and `buildBeancountFile(input): string`. No I/O, no clock — `generatedAt` arrives as an argument. |
| `lib/services/beancount.ts` | The paged reads of §7, assembled into the domain input. |
| `app/(app)/reports/beancount/page.tsx` | Server shell: header, summary, permission state. |
| `app/(app)/reports/beancount/actions.ts` | One server action: check permission, build, audit, return. |
| `app/(app)/reports/beancount/BeancountClient.tsx` | The download button and the instructions. |
| `lib/domain/report-catalog.ts` | One catalogue entry, group `accounting`. |
| `tests/unit/beancount.test.ts` | The domain module. |
| `tests/unit/beancount-service.test.ts` | Paging and all-or-nothing, with a stub client. |

## 9. Testing

**Domain, by exact text.** Build inputs by hand and assert the output string
verbatim for: a two-line entry; an entry with no counterparty; a payment linking
two invoices; `num:` and `due:`; a VND entry with zero decimals; a EUR entry in a
USD company with its price directive; a voided entry absent; month comments.

**Account naming**, each on its own: accented and Vietnamese names; punctuation
and spaces; a name that sanitises to nothing; a lower-case first letter; and two
codes that sanitise identically, proving they get **different** names.

**Escaping:** a narration containing `"`, `\`, a newline and a tab.

**A property test on our own output:** parse every transaction back out of the
generated file, sum its postings per currency, and assert each sums to exactly
zero. This is the check `bean-check` performs first, run here without Python.

**Service, with a stub client:** a book of more than 1,000 entries arrives whole
across pages; a failure on any page fails the export; the entry list stays ordered
across page boundaries.

**The purity guard** from §2.

**Acceptance, on real books, never committed.** Export Pacific Four Nine, run
`bean-check` on it (beancount installed into a virtual environment in the session
scratchpad, not added to the repository), and confirm every account's Beancount
balance equals OneBook's trial balance for the same account. The exported file is
real customer data: it lives only in the scratchpad, and the `customer-data` gate
and the root `.gitignore` both refuse it.

## 10. Out of scope

A full on-screen view of the file with clickable accounts, as the prototype has —
a book of several thousand entries is too heavy to render. Balance assertions.
Importing a `.beancount` file. A date-range export — Beancount needs the book
from its first entry to prove its balances. Adding the file to the backup ZIP.
