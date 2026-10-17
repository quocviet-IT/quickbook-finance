# Balance Comparison: OneBook's balances beside another ledger's, kept by date (release 2.17)

## Why

This is item OB-9 of the engineering review (13 October): "No way to compare against another ledger".

One company's books exist in two systems. Reconciling them took a week of screenshots and spreadsheets passed back and forth, and most of that week went on discovering that the two reports being compared were dated differently.

**Acceptance:**
- Typed figures persist and are keyed by date.
- The report states the comparison date in its heading, so two printouts cannot be confused.

**What the reviewer asks the report to do:**
1. Key what is typed by date. A check at one date must not overwrite a check at another. Say so when the user lands on a date with nothing typed.
2. Accept figures as they are read off a statement: commas, currency symbols, brackets for negatives.
3. Show signs the way a balance sheet prints them, since that is what is being copied.
4. Recompute without re-rendering the field being typed into.
5. Include accounts the other system has that this one has never posted to, at nil.

**Decided with the user (17/10):**
- The report is called **Balance Comparison**.
- The other system's name is typed **for each comparison date** ("Compared with").
- **Staff** may type and save figures; viewers read.

## Part 1: the database (migration 0155, additive)

**`acc_balance_comparison`** — one row per comparison date.

| Column | Type / rule |
|---|---|
| `as_of` | `date`, primary key |
| `compared_with` | `text` not null, 1–80 chars |
| `note` | `text`, optional, up to 500 chars |
| `created_by`, `created_at`, `updated_by`, `updated_at` | Audit columns |

**`acc_balance_comparison_line`** — one row per account with a typed figure.

| Column | Type / rule |
|---|---|
| `id` | |
| `as_of` | References `acc_balance_comparison`, on delete cascade |
| `account_id` | Null for an account only the other system has |
| `external_code` | `text`, for an account only the other system has |
| `external_name` | `text`, for an account only the other system has |
| `other_balance_minor` | `bigint` not null, in natural sign: as the other system prints it, liabilities, equity and income positive |

- Unique on (`as_of`, `account_id`) where `account_id is not null`.
- Unique on (`as_of`, `lower(external_code)`) where `account_id is null`.
- A check: either `account_id` is set, or `external_code` and `external_name` are.

**`acc_save_balance_comparison(p_as_of date, p_compared_with text, p_note text, p_lines jsonb)`**
- Who: staff only.
- Upserts the header, then replaces the lines for that date with `p_lines`, in one transaction. The lines are `[{account_id} | {external_code, external_name}, other_balance_minor]`.
- A line with no figure is not stored.
- An unknown or inactive account is refused.
- The function returns the number of lines kept.

**Access:**
- Row-level security: staff and viewers may select. There is no insert, update or delete policy, so writes go through the function only.
- Audit triggers are as in 0124/0139/0154.
- Both tables are added to the company backup list (`lib/domain/company-export.ts`).
- Grants for the function: revoke from public and anon; grant to authenticated and service_role.

## Part 2: the report

**Route:** `/reports/balance-comparison`, catalog entry "Balance Comparison", group `accounting`, beside Trial Balance. The same permissions as the Trial Balance.

**Controls:**
- **As of:** a date, defaulting to today in the company's time zone.
- **Compared with:** text, for example "QuickBooks". It is saved with the date.
- **Note:** optional.
- **Save:** staff only.
- **Only differences:** a filter.
- The report's existing export (CSV, Excel, PDF).

**Heading.** It always shows the date and the other system, on screen and in every export:

> Balance Comparison as of Sep 30, 2026 · OneBook and QuickBooks

**Rows:**
- Every active account, including one never posted to, at nil.
- Grouped Assets, Liabilities, Equity, Income, Expenses, in chart order.
- Columns:

  | Column | Shows |
  |---|---|
  | Code | |
  | Account | |
  | OneBook | The balance |
  | The other system | Its typed figure, headed by the "Compared with" name |
  | Difference | OneBook minus other |

- **OneBook's balance uses the Chart of Accounts convention (1.97):**
  - balance-sheet accounts are as at the date;
  - income and expense accounts run from the start of the fiscal year to the date.
- The heading's second line says so:

  > Balance sheet accounts as at the date; income and expenses for the year to date.

- **Signs:** natural, as a balance sheet prints them. Liabilities, equity and income are positive when they hold their normal balance. The typed figure is read in the same sign.
- **The difference** shows only when a figure is typed. A row whose difference is not zero is marked. Each group and the whole report carry totals.
- **Accounts only the other system has:** "Add an account the other system has" adds a row with code, name and figure. OneBook shows nil for it, and it sits at the end of the group the user chooses.

**Typing:**
- Each figure box keeps its own text while it is typed. The difference and totals recompute on blur, without re-rendering the box being typed in (the reviewer's point 4).
- The parser accepts:
  - `1,234.56`;
  - `$1,234.56`;
  - `(1,234.56)` and a leading or trailing minus;
  - a Unicode minus;
  - `CR`/`DR` suffixes: CR negative for a debit-natural account, DR negative for a credit-natural one;
  - non-breaking spaces.
- A blank box means "no figure".
- Anything else shows an inline error ("Not a number: …") and is never saved as zero.

**Landing on a date with nothing saved:**

> Nothing has been typed for Sep 30, 2026. The nearest saved comparison is Aug 31, 2026.

The date in that message is a link to that comparison.

**Saving:**
- Save stores the header and every typed line for that date, replacing what was saved for that date only.
- A message says "Saved {n} figures for {date}."
- Leaving with unsaved figures asks first.

**Copy and layout:**
- US English, in plain words: no table or column names on screen.
- Money goes through `formatMoney`.
- Dates are in the company's time zone.
- Tables use `DataTable`, fit 1280, and scroll inside their own box on a phone.
- No PDF reader module is imported into the client.

## Tests

- **Domain:**
  - the parser, for every accepted form and the refusals;
  - natural sign per account type;
  - the difference and the totals;
  - rows for never-posted and external-only accounts;
  - the heading text with the date and the other system;
  - the "nothing typed" message and the nearest date.
- **Migration test:** tables, uniques, check, RLS (select only), grants, the function's role check and replace semantics, the audit triggers, and the backup list.
- **Rolled-back verification on the sample company only:**
  - saving two dates keeps both;
  - saving one date again replaces only that date's lines;
  - an external-only line round-trips;
  - a viewer can read but not save;
  - an outsider can do neither.

  Other schemas: structure only.
- **Smoke on PC-Test, with screenshots:**
  - at one date, type a handful of invented figures for a made-up "Sample Ledger", one of them in brackets and one external-only account, then save;
  - reload and see them kept;
  - switch to another date and see the "nothing typed" message;
  - export and check the heading.
  - Keep the saved comparison as demo data.

## Not in this release

- Importing the other system's trial balance from a file. Typing first; import can follow.
- Mapping accounts between the systems by name. Matching is per OneBook account, plus external-only rows.
