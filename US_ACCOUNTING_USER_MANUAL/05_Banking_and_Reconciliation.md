# 05. Banking and Reconciliation

## Bank data

Bank accounts map to active bank-type ledger accounts and a currency. Statement files are stored or referenced securely. Imported raw transactions are immutable and deduplicated with a collision-resistant hash plus source metadata.

## Transaction review

Unreviewed transactions do not affect the ledger. Authorized users can:

- Match an existing payment or posted transaction.
- Categorize and create an approved accounting transaction.
- Split an amount across categories.
- Record a transfer using linked entries.
- Exclude an item with a required reason.
- Resolve duplicates and exceptions.

Bank rules are versioned, testable, approved before automatic posting, and measured for match quality.

## Statement reconciliation

A reconciliation session stores the account, statement ending date, beginning balance, ending balance, status, preparer, approver, and attached statement.

- Beginning balance agrees with the previous completed reconciliation.
- Cleared ledger activity is linked to reconciliation lines.
- Completion requires a zero unexplained difference or an explicitly approved adjustment.
- Completed sessions are locked and produce a reproducible reconciliation report.
- Reopen requires reason, permission, and approval.
- Later changes to reconciled transactions create alerts and discrepancy history.

## Concurrency

Approval and matching are transactional. A bank transaction and a payment cannot each participate in more than one approved one-to-one match unless an explicit split model is used.

