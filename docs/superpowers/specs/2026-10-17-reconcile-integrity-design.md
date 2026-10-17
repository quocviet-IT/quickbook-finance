# A signed-off reconciliation that no longer agrees is flagged, and a transfer is checked on both statements (release 2.12)

## Why

This release answers two items of the reviewer's follow-up of 15/10.

- **OB-3b.** "Verify that editing a previously reconciled transaction flags the reconciliation as no longer agreeing."
  - Today posted lines cannot be edited.
  - A ticked customer payment cannot be voided.
  - A manual entry ticked on a completed reconciliation cannot be removed.
  - Exceptions › "Reconciliations that no longer agree" lists ticked entries that were voided afterwards.

  Three changes still pass unnoticed:
  - a ticked entry that is **reversed**. The original stays posted and nothing checks its ticks.
  - an entry **posted after sign-off** but dated inside the signed-off period.
  - a reconciliation whose saved ending no longer equals its beginning plus its ticked lines.
- **OB-4.** "Update the regression fixture so the pre-correction ledger flags the transfer and identifies the likely destination account. The corrected ledger must not flag it again, and the test must confirm why it is resolved."
  - Today a transfer's two legs clear independently, one per statement.
  - Nothing reports a leg that should have cleared and did not.

**Decided with the user (17/10):**
- Both items go in one release.
- A reversal of a ticked entry is **flagged, not blocked**. `acc_reverse_entry` is unchanged.

## Part 1: what changed after sign-off (OB-3b)

**Database (0150, read-only functions only).** `acc_reconciliation_changes()` returns one row per change to a completed reconciliation, with the reconciliation id, bank account, statement ending date and `completed_at`, and one of these kinds:

| Kind | Meaning | Carries |
|---|---|---|
| `voided` | A line ticked on it belongs to an entry that is now void (the existing 0026 rule). | The entry |
| `reversed` | A line ticked on it belongs to an entry that has a posted reversal (`acc_journal_reversal_link`). | The entry and the reversing entry |
| `added` | A posted entry on the reconciliation's bank ledger account, dated on or before its statement ending date and after the previous completed reconciliation's ending date. It is ticked on no reconciliation and was posted after this one was completed (`posted_at > completed_at`). | The entry |
| `drift` | The saved statement ending differs from the saved beginning plus the posted ticked lines, as `acc_complete_reconciliation` computes it at sign-off. | The difference |

Each row also carries:
- the entry number, date and signed amount on the bank account (for the entry kinds);
- the difference in minor units (for `drift`).

The function:
- is readable by staff and viewers;
- is revoked from public and anon, and granted to authenticated and service_role;
- orders its rows by reconciliation and then a unique key, so a reader can page it.

**App.**
- Exceptions › "Reconciliations that no longer agree" lists every completed reconciliation with at least one change.
- Its row names:
  - the bank account and the reconciliation's statement date;
  - each change in words;
  - the drift, if any.
- Each kind of change is worded as follows:

  > JE-000123 was voided.
  >
  > JE-000123 was reversed by JE-000130.
  >
  > JE-000140, dated Sep 28, 2026, was posted after the reconciliation was signed off.
  >
  > The reconciliation no longer adds up: it is out by $12.00.

- The red "No longer agrees" badge on Reconcile's standing card and on the Balance Sheet's bank panel counts the same rows.
- The export carries the same sentences.

## Part 2: a transfer checked on both statements (OB-4)

**Database (0150, read-only).** `acc_transfer_legs()` returns:
- every posted entry with exactly two lines on bank ledger accounts, one on each side. Entries with more than two bank lines are left out, and the report says how many;
- for each leg: the bank account, the signed amount, the entry date and number, and whether it is ticked on a completed reconciliation (with that reconciliation's statement ending date);
- the reversal link where there is one.

The second set of facts is the evidence for the likely destination. For an open leg's amount and date, it returns:
- statement lines held in completed reconciliations of other bank accounts with the same amount (opposite sign) within 7 days;
- posted ledger lines on other bank accounts with the same amount within 7 days.

Bank lines that came from no import batch (backfilled) are not used as evidence.

Both result sets are paged, readable by staff and viewers, and granted as in Part 1.

**Domain, pure (`lib/domain/transfer-legs.ts`).** A leg is **open** when all of these hold:
- the other leg is ticked on a completed reconciliation;
- its own bank account has a completed reconciliation whose statement ending date is on or after the entry date;
- it is not ticked;
- the entry is more than 30 days old.

The other outcomes:
- **Not yet checkable:** a leg whose account's statements do not yet reach the entry date is counted as this, not flagged.
- **Corrected:** a transfer is not flagged when an opposite entry on the open leg's account, for the same amount within 7 days, moves the money to a third bank account. It is reported as corrected, with the correcting entry's number. The report never offers to reverse anything.
- **Likely destination:** the destination is named from the evidence above, best first: a held statement line on another account, then a ledger line on another account. The report says how many candidates were found.

**App.** A thirteenth Exceptions check, "Transfers cleared on one side only":
- Each row:
  - the entry and its date;
  - the amount;
  - the account where it cleared, with that statement's date;
  - the account where it did not;
  - "Likely went to {account}" or "No other account shows it".
- The section note says how many transfers could not be checked yet and how many were corrected.
- The report's count of checks run becomes 13.

**Tests (invented data only).** These are the reviewer's regression, as three fixtures:
- **A, before the correction:** a transfer whose sending leg is ticked on a signed-off statement. The receiving account is signed off through the date with no matching line, and a third account shows the amount that day. Expect one exception naming the third account as the likely destination.
- **B, after the correction:** fixture A plus the correcting entry. Expect no exception, reported as corrected with the correcting entry named, and nothing offering to reverse.
- **C, not yet checkable:** the receiving account's statements stop before the date. Expect no exception, counted as not yet checkable.

Also: a transfer more than 30 days old that is cleared on both sides gives nothing, and a three-bank-leg entry is skipped and counted.

## Tests and release

- **Migration test:** grants, definer, search path, role check, and that no existing function is changed.
- **Rolled-back verification on the sample company only:**
  - a ticked entry voided, reversed, and an entry posted after sign-off inside the period each produce their row;
  - a clean reconciliation produces none;
  - the transfer legs come back with their tick state.

  Other schemas: structure only.
- **Smoke on PC-Test, with screenshots:** both Exceptions sections, desktop and phone. Production checks are read-only.
- **Changelog 2.12.**

## Not in this release

- Blocking a reversal or a void of ticked entries. The user chose to flag only.
- OB-8 and OB-9.
- A stored "transfer" flag on entries.
