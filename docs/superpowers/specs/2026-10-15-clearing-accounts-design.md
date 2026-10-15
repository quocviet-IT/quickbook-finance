# Clearing accounts that have not emptied (release 2.06)

## Why

An external engineering review (13/10) raised this as a P2 correctness issue:

> **OB-5:** clearing accounts are never checked for staleness. A clearing account is meant to empty. One that does not is either unbanked takings or sales counted twice.

Its acceptance criteria:
- Accounts can be marked as clearing accounts in the chart.
- A clearing account with a balance and no movement for 60 days raises a warning naming the age of its oldest unmatched item.
- Regression: Undeposited Funds at 31 August 2026 raises it.

The user chose one release per review item, OB-5 first (2.06), then OB-4 (2.07) and OB-6 (2.08).

### What OneBook does today

| Place | Today |
|---|---|
| Chart of Accounts | A current asset may carry the detail type Undeposited funds or Transfer clearing (`lib/domain/account-detail.ts`). There is no way to mark a liability, such as payroll clearing, or a suspense account. |
| Exceptions, "Money received but not yet banked" | Finds the account by the name "undeposited" or the code 1210, not by its detail type. It reports any non-zero balance with "{n} entries, oldest {date}", where both figures count every line the account ever had. It has no movement test and no age test. |

On a company whose Undeposited Funds stopped moving months ago, today's check prints thousands of entries and an oldest date years back. That is true and of no help.

### Decisions (user, 15/10)

- Mark clearing accounts with a tick, "Clearing account", on any current asset or current liability, rather than with more detail types.
- Fold the existing check into one: "Clearing accounts that have not emptied", for every ticked account. The check count stays at 11.

## Part 1: data (migration 0145)

### Column

- `acc_account.is_clearing boolean not null default false`.
- **Backfill:** true where `detail_type in ('undeposited_funds', 'transfer_clearing')`, or where `account_type = 'current_asset'` and the name contains "undeposited" (case-insensitive).
- **New companies:** Undeposited Funds and Transfer Clearing start ticked, through the path that seeds a new company's chart (`lib/domain/chart-templates.ts` and the provisioning it feeds).
- **Writes:** the tick is saved through the existing account create and update path, with the same role rules. Only `current_asset` and `current_liability` accounts may be ticked; the database refuses it on any other type.

### `acc_clearing_standing(p_as_of date)`

Returns one row per account with `is_clearing` true:

| Column | Meaning |
|---|---|
| `account_id` | The account. |
| `balance_minor` | Posted balance at `p_as_of`, debit minus credit. |
| `last_movement_date` | The latest posted line dated on or before `p_as_of`; null when none. |
| `open_count`, `open_oldest_date`, `open_minor` | The items still open at `p_as_of`, first in, first out (below). |

**Open items.**
- An item is a line on the side the balance stands on: debits when the balance is a debit, credits when it is a credit.
- Lines on the other side clear the oldest items first, ordered by date, then by entry, then by line.
- An item part cleared is open for its remainder, and `open_minor` equals the absolute balance.
- A zero balance has no open items.

**Rules.**
- SECURITY DEFINER, `search_path` pinned.
- Staff or viewer may call it; anyone else is refused.
- Revoked from `public` and `anon`; granted to `authenticated` and `service_role`.
- Posted entries only.
- Computed in the database, so the app never pages through every line of the account.

## Part 2: thresholds and wording (`lib/domain/clearing-accounts.ts`, pure, tested)

`CLEARING_IDLE_DAYS = 60` and `CLEARING_ITEM_DAYS = 90`, exported. Both are measured to the report's end date, never to today.

An account is **left standing** when its balance is not zero and either:
- it has had no movement for more than `CLEARING_IDLE_DAYS`; or
- its oldest open item is more than `CLEARING_ITEM_DAYS` old.

**Wording.** An account with detail type Undeposited funds calls its items "receipts"; any other calls them "entries". Counts use singular and plural.

| Part | Text |
|---|---|
| Composition | `{balance} across {n} receipts, oldest {date}` |
| Idle | `No movement for {d} days, since {date}` |
| Never moved (no lines) | not listed: a zero balance is not asked about |
| Tag | `Left standing` (warning tone) when left standing; nothing otherwise |

The help text explains first in, first out once:

> The oldest items are found first in, first out: each amount out clears the oldest amount in that is still open.

## Part 3: screens

**Chart of Accounts.**
- The account form gains a "Clearing account" tick, shown only for current assets and current liabilities, with the help text: "It should empty: money received waits here until it is banked, wages until they are paid."
- The chart's setup list shows a small "Clearing" tag beside a ticked account.

**Exceptions.**
- "Money received but not yet banked" becomes **"Clearing accounts that have not emptied"**, for every ticked account with a non-zero balance at the report's end date.
- Columns: Account, Balance, Open items (the composition text), Last movement (the idle text), and the tag.
- Accounts left standing come first; then by account name.
- Its help text: "A clearing account should empty: money received waits there until it is banked, wages until they are paid. A balance left standing is either money not yet banked or something counted twice." Then the first-in-first-out sentence.
- The export follows the screen.
- If the standing cannot be read, the check reads "could not be run", as the other checks do.

## Tests and release

- **Unit tests** on invented data:
  - The regression, in the shape of the review's case: receipts left near the end of a year, then no movement. At a date eight months later the account is left standing, and the text names the count, the oldest date and the idle days.
  - Thirty days later: not idle, but still listed with its composition.
  - A liability clearing account (credits are items).
  - Part-cleared items.
  - A zero balance (not listed).
  - Boundaries at 60/61 and 90/91 days.
  - The wording for receipts and entries, singular and plural.
  - The renamed check, its count of 11, and its export.
- **Migration test:** the column, the backfill, the type guard, grants, security definer, the column list.
- **Rolled-back verification script:** behaviour on the sample company only. It covers an asset and a liability clearing account, part-cleared FIFO, as-of dates, the type guard, a viewer and an outsider; other schemas are checked for structure only.
- **Smoke with screenshots on PC-Test:** the form tick, the setup tag, Exceptions; in light, dark and phone.
- **Release:** changelog 2.06, which says the check's name and wording changed and why, and the Guide. Migration 0145 goes live only with the user's approval.

## Not in this release

- A dashboard insight or a close-checklist step for clearing accounts.
- Thresholds the user can change.
- A link from each receipt to the deposit that banked it.
- OB-4 (2.07) and OB-6 (2.08).
