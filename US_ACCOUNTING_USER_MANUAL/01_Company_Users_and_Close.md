# 01. Company, Users, Audit, and Accounting Close

## Company setup

Administrators maintain the legal business name, DBA name, EIN reference, addresses, fiscal-year start, base currency, time zone, default payment terms, document numbering, and default Cash or Accrual report basis.

Sensitive identifiers must be masked in normal views, encrypted or vaulted where appropriate, excluded from ordinary audit payloads, and restricted to explicitly authorized roles.

Accounting-sensitive configuration uses version history and effective dates. An authorized reviewer approves high-risk changes before they become active.

## Users and permissions

- Every employee uses an individual identity.
- Privileged users use MFA when supported.
- Roles grant explicit permissions rather than relying only on hidden UI controls.
- Invitations, suspension, offboarding, session revocation, and external-user expiry are supported.
- Access changes are audited.
- Periodic access review is documented.
- Maker-checker rules prevent self-approval where configured.

## Audit history

Every protected write records the actor, role, timestamp, source, action, entity, request ID, reason, and before/after state in the same database transaction as the business change.

Application users cannot update or delete audit events. Entity pages provide an audit-history view, and authorized users can filter by actor, date, action, source, entity, and request ID.

## Accounting periods

Periods progress through `open`, `soft_closed`, `closed`, and optionally `reopened` states.

- Open periods accept authorized postings.
- Soft-closed periods warn or restrict according to permission.
- Closed periods reject new or changed postings.
- Reopening requires permission, reason, and approval.
- Changes after reopening appear in an exception report.
- Closing checklists cover bank reconciliation, AR/AP reconciliation, sales-tax controls, suspense accounts, and required approvals.

