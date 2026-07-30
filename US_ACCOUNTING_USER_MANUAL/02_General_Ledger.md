# 02. Chart of Accounts and General Ledger

## Chart of Accounts

Accounts contain a unique code, name, type, detail type, optional parent, description, currency, posting/summary designation, effective dates, and status.

- Circular hierarchies are prohibited.
- Summary and inactive accounts cannot receive new postings.
- Accounts with history are deactivated, not deleted.
- Similar-name warnings reduce duplicate accounts.
- Activation and sensitive mapping changes may require approval.
- External-system mappings are versioned and auditable.

## Posting rules

Every journal entry must balance in transaction currency and base currency. Each line has exactly one positive debit or credit and references an active posting account.

Financial workflows post through transactional database functions. Direct client writes cannot bypass document state, ledger, subledger, approval, or audit rules.

## Manual journals and opening balances

Manual journals support descriptions, source references, attachments, approval, and optional scheduled reversal. Opening balances are imported through a controlled batch whose Trial Balance must reconcile before approval.

## Corrections

Posted entries are immutable. Corrections create linked reversal or adjusting entries. The original entry remains available, and a later reversal cannot change a previously generated historical report.

## Required reports

- General Ledger.
- Journal report.
- Trial Balance.
- Account activity and balance detail.
- Unposted, rejected, reversed, and post-close exception reports.

