# Bank standing: how much bank activity is unreconciled (release 2.05)

## Why

An external engineering review (13/10) ranked this third:

> **OB-3:** nothing shows how much bank activity is unreconciled. A balance agreed to last month's statement and a balance nobody has checked for a year print with the same authority.

It also listed:

> **OB-7:** Bank Reconciliation shows a bare "No data" for an account with no reconciliations.

The user chose to ship OB-3 in full, together with OB-7, as 2.05. 2.04 (statement proof) comes before it.

### What OneBook shows today

| Place | Today |
|---|---|
| Balance Sheet | A note only for bank accounts below zero. A healthy account gets nothing. |
| Reconcile | No summary of the chosen account. An account with no reconciliations shows antd's "No data". |
| Reconcile history (2.03) | Open lines and the last reconciled date, but no closing balance, no value and no aging. |
| A ticked entry voided after its reconciliation was completed | Only the Reconciliations report knows (`acc_reconciliation_discrepancies`, 0026). |
| Dashboard "Unreconciled bank activity" | Counts Cash on Hand lines too (`acc_unreconciled_bank`, 0030, uses `account_type = 'bank'`). |
| Exceptions "Bank accounts not agreed to a statement" | Gives the last date and the balance, but no count or value since. |

Four places each work out "the last completed reconciliation" for themselves: the statement alerts, Exceptions, the Banking overview and 0142.

### Decisions (user, 15/10)

- OB-3 in full, plus OB-7, in one release.
- The ages, the wording and the places are as in the design below.

## Part 1: data (migration 0144, additive, read-only)

### `acc_bank_standing(p_as_of date)`

Returns one row per `acc_bank_account`. Cash on Hand is not a bank account there, by the 0072 guard. The columns:

| Column | Meaning |
|---|---|
| `bank_account_id` | The bank account. |
| `last_completed_id`, `last_completed_date`, `last_closing_minor`, `last_brought_forward` | The latest COMPLETED reconciliation whose statement ending date is on or before `p_as_of`. The closing is that reconciliation's statement ending balance: the figure taken from the statement, or, for a brought-forward one, the balance the person proved. |
| `since_count`, `since_net_minor` | Posted lines on the account's ledger account dated after `last_completed_date`, or from the beginning when there is none, and on or before `p_as_of`, that no completed reconciliation holds. Signed as the pairing signs them: a debit to the bank is money in. |
| `earlier_open_count`, `earlier_open_net_minor` | Posted lines dated on or before `last_completed_date` that no completed reconciliation holds: items still outstanding. |
| `void_ticked_count`, `void_ticked_minor`, `void_reconciliation_date` | Lines ticked in a completed reconciliation whose entry has since been voided (the 0026 discrepancy rule), counted set-wise, with the date of the latest affected reconciliation. |
| `book_minor` | The account's book balance at `p_as_of`. |

Rules:
- SECURITY DEFINER, `search_path` pinned.
- Staff or viewer; anyone else is refused.
- Revoked from `public` and `anon`; granted to `authenticated` and `service_role`.
- One pass over the bank ledger lines.

This function becomes the one source of "where each bank account stands". Pointing the other four readers at it is later work, and is not in this release.

## Part 2: wording and tone (`lib/domain/bank-standing.ts`, pure, tested)

**The account's line:**

| Case | Wording |
|---|---|
| Agreed, with activity since | `Agreed to {date} at {closing} · {n} entries since, {net} not on a statement` |
| Agreed, nothing since | `Agreed to {date} at {closing} · nothing since` |
| Brought forward | The same wording, with `(brought forward)` after the closing. |
| Never reconciled, with lines | `Never reconciled · {n} entries, {net} not on a statement` |
| No lines and a zero balance | `No activity` |
| A voided tick | An extra line: `No longer agrees: {n} entries ticked on the {date} reconciliation were voided ({amount})` |

Counts use singular and plural ("1 entry"). Money uses the screen's formatter. Dates use `shortDate`.

**Tone, measured in days from the last statement date to the report date (`p_as_of`), never to today:**

| Condition | Tone |
|---|---|
| Up to 60 days | positive |
| More than 60 days | warning (amber) |
| More than 180 days | danger (red) |
| Never reconciled with any line or a non-zero balance | danger |
| No activity | neutral |
| No longer agrees | danger, whatever the age |

The thresholds are exported constants, `STANDING_AMBER_DAYS = 60` and `STANDING_RED_DAYS = 180`. The text always states the condition; colour is never the only signal.

## Part 3: screens

**Balance Sheet: a "Bank accounts" panel under the sheet.**
- One line per bank account, with its tone and a link to Reconcile on that account.
- It is read after the statement, as the 2.00 note is, and fails quietly.
- The 2.00 below-zero note folds into it: a bank account below zero adds "below zero at {date}" to its line.
- Printing and export are unchanged.

**Reconcile: a standing card for the chosen account above the reconciliations table.**
- When the account has no reconciliations, the card replaces "No data" (OB-7): "{Account} has never been reconciled. {n} entries, {net}, are waiting on a statement. Start with the oldest statement you have." It is followed by the two buttons, New reconciliation and From statement files.
- When the account was reconciled and nothing has happened since: "Reconciled to {date}; nothing new since."

**Reconcile history.**
- Two columns are added: Closing (the last closing) and Since (count and net).
- The column widths stay a tested contract that fits 1280 and scrolls inside its box on a phone.

**Exceptions.**
- A new check, the eleventh: "Reconciliations that no longer agree". It lists the bank accounts with a voided tick, and says how many entries and how much.
- The existing "Bank accounts not agreed to a statement" rows gain the count and value since.
- `checksRun` becomes 11.

**Dashboard.** "Unreconciled bank activity" leaves out Cash on Hand lines.

## Tests and release

- **Unit tests** on invented data:
  - every wording case;
  - every tone boundary (60, 61, 180, 181 days);
  - a report date in the past;
  - a brought-forward closing;
  - no longer agrees;
  - no activity;
  - the Exceptions check.
- **Migration test:** grants, security, the columns.
- **Rolled-back verification script,** behaviour on the sample company only. Its scenario has an account that was never reconciled, one that is current, one that is stale, one brought forward and one with a voided tick, and it checks the as-of behaviour.
- **Smoke with screenshots on PC-Test:**
  - the Balance Sheet panel, at today and at a past date;
  - Reconcile, with the card and the empty state;
  - the history columns;
  - Exceptions;
  - in light, dark and phone.
- **Release:** 2.05 changelog and Guide. Migration 0144 goes live only with the user's approval.

## Not in this release

- A badge inside each Balance Sheet row, which would change the row model, printing and export.
- Pointing Exceptions, the Banking overview and the statement alerts at the new function.
- OB-4 to OB-9.
