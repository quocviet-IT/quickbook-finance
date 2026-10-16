# Possible duplicate charges (release 2.08)

## Why

An external engineering review (13/10) raised this as a P3 detection issue:

> **OB-6:** same-payee duplicate charges are not flagged. A charge repeated within a few weeks, to the same payee, for the same amount, is worth a second look, more so when its description reads differently from that payee's other lines.

Its acceptance criteria:
- Candidates are listed for review, never actioned automatically.
- Dismissing one stops it being offered again.
- A line already ticked on a signed-off reconciliation is never offered for removal.

### What OneBook does today

| Place | Today |
|---|---|
| Exceptions, "Entries recorded more than once" | Same date, same name, same reference, same accounts, same amount. A charge repeated 15 days later is never grouped. |
| Import | Repeated lines within one file are counted (2.04), which stops a re-import, not a charge the bank took twice. |
| Banking overview, work queue | Derived items (unmatched lines, broken feeds, open reconciliations), each with Dismiss, which needs a reason and is remembered (`acc_work_item_state`, 0118). |

### Decisions (user, 15/10)

- Show candidates in the Banking overview work queue, with its existing Dismiss.
- Recognise recurring payments (rent, subscriptions) and do not flag them; flag only a repeat that breaks the rhythm.

## Part 1: the detector (`lib/domain/duplicate-charges.ts`, pure, tested)

**Input:** each bank account's posted lines as `getBankAccountLines` returns them (`BankLine`, `lib/domain/statement-alerts.ts`): reversed entries and their reversals already left out. The company's today.

**Window:** lines dated in the 12 months up to and including the company's today.

**Charges only:** lines whose amount is money out (`amountMinor < 0`).

**Payee key:** from the line's payee (party, else description). Steps:
1. Lower-case it.
2. Drop the channel words `pos`, `debit`, `purchase`, `card`, `checkcard`, `recurring`, `ach`, `www`, `com`.
3. Drop digits and punctuation.
4. Keep the first two words that remain.

A line whose key comes out empty is not grouped.

**Description shape:** a coarse pattern of the line's text that tells formats apart. It is built from:
- the channel words it contains;
- whether it has a web suffix (".com");
- a digit run written as "9".

For example, `POS DEBIT SHOPMART 1234` and `SHOPMART.COM 8004` have different shapes. The modal shape of a payee is the most common shape among that payee's lines on that account in the window; it counts only when the payee has 3 or more lines.

**Candidate pair:** two charge lines with all of these in common:
- the same bank account;
- the same payee key;
- the same amount;
- dates at most 30 days apart.

A chain of repeats is cut into consecutive pairs.

**Recurring payments:** for one bank account, payee key and amount with 3 or more lines in the window, the group's rhythm is the median gap between consecutive lines. A consecutive pair is not a candidate when:
- its gap is within 3 days of that median; and
- the median is 6 days or more.

A pair that breaks the rhythm is a candidate. For example, a monthly rent paid twice in one month, or the same subscription charged twice on one day.

**Signed-off lines:**
- When both lines of a pair are ticked in a completed reconciliation (`BankLine.cleared`), the pair is not offered.
- When one line is ticked, the other is the one to review.
- When neither is ticked, the later line is the one to review.

**Outlier:** when the payee has a modal shape and the line to review does not match it, the candidate is an outlier.

**Output** per candidate:
- the bank account;
- the two lines: id, entry id, entry number, date, amount, payee, text;
- the line to review;
- the days apart;
- the outlier flag;
- the number of the payee's other lines (for the wording).

The order is outliers first, then newest.

## Part 2: the Banking work queue

**New source kind** `possible-duplicate`. Each candidate becomes one item:

| Field | Value |
|---|---|
| key | `dupe-charge:{earlier line id}:{later line id}`. Stable, so a dismissal holds and the item retires on its own when the pair stops being derived, for example after a void. |
| title | `Charged twice in {n} days: {Payee}` (`1 day`; `on the same day` when 0). The fact comes first because the queue keeps a title to one line; the amount has its own column. |
| reason | `{Bank account} · {date 1} and {date 2}`. An outlier adds ` · the {date} line is described differently from this payee's other {n}`. A pair with one line signed off adds ` · the {date} line is on a completed reconciliation`. |
| severity | `high` for an outlier, `medium` otherwise. |
| amount | The amount (magnitude). |
| href | Opens the entry of the line to review, by the app's existing way to open an entry. |
| actionLabel | `Review` |
| blocking | false |

Rules:
- Dismiss uses the queue's existing lifecycle: a reason is required, and the dismissal is remembered.
- Nothing is voided or changed automatically. The person voids the entry themselves if it is a real duplicate.
- The read is paged (`readAllPages` through the existing readers).
- A failed read leaves the duplicates out of the queue without failing the rest of Banking.

## Tests and release

- **Unit tests** on invented data:
  - a pair 15 days apart (flagged);
  - a pair 31 days apart (not flagged);
  - a monthly rent with 4 payments (not flagged);
  - the same rent paid twice in one month (flagged);
  - a weekly subscription (not flagged), and one charged twice on a day (flagged);
  - a payee key that unites `SHOPMART.COM 8004` and `POS DEBIT SHOPMART #1234`;
  - an outlier line;
  - one line signed off (the other is reviewed);
  - both lines signed off (not offered);
  - a reversed entry (not offered);
  - money in (not offered);
  - lines older than 12 months (not offered);
  - the item wording, singular and plural;
  - the stable key.
- **No migration.**
- **Smoke with screenshots on PC-Test:** the queue item, Review opening the entry, and Dismiss asking for a reason. Any test entries posted for the smoke are reversed after it.
- **Release:** changelog 2.08 and the Guide.

## Not in this release

- Duplicate deposits (money in).
- Voiding from the queue.
- A check in Exceptions.
- OB-4, OB-8, OB-9.
