# 08. Managing Users

> Source scope: *QuickBooks Online Business User Manual*, Version 4 — July 2022, pages 35–37.

## Purpose

This chapter explains how QuickBooks Online manages users, access levels, and accounting-firm access.

It also translates the documented QuickBooks roles into practical access-control requirements for an internal accounting web application.

> **Important**
>
> This chapter reflects the QuickBooks Australia workflow documented in July 2022. Current plan limits, role names, and permissions may differ.

---

## 1. User Limits by Subscription Plan

The manual lists the following business-user limits:

| Plan | Business users |
|---|---:|
| Simple Start | 1 |
| Essentials | 3 |
| Plus | 5 |

The business can also invite up to two accounting or bookkeeping firms. These invitations are separate from the normal business-user allowance.

> **Planning note**
>
> User limits should be reviewed against the current subscription terms before purchasing or implementing a system.

---

## 2. Open User Management

Navigate to:

```text
Gear Icon > Your Company > Manage Users
```

The Manage Users area includes two main sections:

| Section | Purpose |
|---|---|
| Users | Create, modify, or remove business users |
| Accounting Firms | Invite or remove accountants and bookkeepers |

---

## 3. Core User-Management Activities

Authorized administrators can normally:

- invite a new user;
- assign a user type;
- limit access;
- edit user permissions;
- remove or deactivate a user;
- invite an accountant or bookkeeping firm;
- transfer the primary administrator role.

### Recommended control

Every access change should record:

- user affected;
- old role;
- new role;
- changed by;
- approval;
- date and time;
- reason;
- effective date.

---

## 4. User Roles

The manual describes several user types.

### 4.1 Primary Administrator

The Primary Administrator is normally the person who created the company file.

This role:

- has the highest level of access;
- cannot be deleted while holding the role;
- cannot have its access reduced directly;
- can transfer the Primary Administrator role to another eligible user.

> **Control principle**
>
> There should be only one active Primary Administrator at a time.

---

### 4.2 Company Administrator

A Company Administrator has access to all major QuickBooks features and capabilities.

This may include:

- changing company settings;
- managing users;
- accessing financial data;
- creating and editing transactions;
- reviewing reports;
- changing passwords or access settings.

The manual warns that not every user should be an administrator.

### Recommended policy

Administrator access should be limited to users who genuinely require it.

---

### 4.3 Standard User

A Standard User is a normal business user.

Access may be granted to:

- all standard business features;
- customers and sales;
- suppliers and purchases;
- selected administrative capabilities.

Examples:

| Access area | Possible responsibilities |
|---|---|
| Customers and Sales | Quotes, invoices, customer payments |
| Suppliers and Purchases | Bills, expenses, supplier records |
| General access | Daily bookkeeping and transaction entry |
| Limited administration | Selected setup or management tasks |

---

### 4.4 Time Tracking Only

Time Tracking Only users see a restricted version of QuickBooks focused on:

- their own timesheets;
- time-entry functions;
- time reports.

According to the manual, this user type does not count toward the normal business-user limit.

---

### 4.5 Reports Only

Reports Only users can access reporting functions without normal transaction-entry access.

The manual notes that some sensitive reports may remain unavailable, including certain payroll reports and reports containing employee, customer, or supplier contact information.

This role does not count toward the normal business-user limit in the documented version.

---

### 4.6 Accountant User

Accountant users are intended for external accountants or bookkeepers.

The manual states that:

- up to two accounting users or firms may be invited;
- accountant access does not count toward the normal business-user limit;
- the business owner must invite the accountant into the company file.

---

## 5. Role Summary

| Role | General access | Typical use |
|---|---|---|
| Primary Administrator | Full and highest-level access | Account owner or designated system owner |
| Company Administrator | Full operational and administrative access | Senior finance or system administrator |
| Standard User | Configurable business access | Accounting and operations staff |
| Time Tracking Only | Timesheets and time reports | Employees or contractors entering time |
| Reports Only | Reporting access | Managers, reviewers, auditors |
| Accountant User | Accounting-professional access | External accountant or bookkeeper |

---

## 6. Principle of Least Privilege

Each user should receive only the access needed to perform assigned duties.

### Examples

- A sales user should not change tax settings.
- An expense-entry user should not approve their own payment.
- A reports-only reviewer should not edit transactions.
- An external accountant should not manage production workflows unless required.
- A system administrator should not automatically receive payment-approval authority.

---

## 7. Segregation of Duties

A robust accounting system should separate incompatible responsibilities.

| Process | Initiator | Reviewer | Approver |
|---|---|---|---|
| Create supplier | Purchasing staff | Accounting | Finance manager |
| Enter bill | Accounting staff | Senior accountant | — |
| Approve payment | — | Finance reviewer | Authorized approver |
| Create customer invoice | Sales/accounting | Billing reviewer | — |
| Change tax settings | System administrator | Accountant | Finance manager |
| Create ledger account | Accountant | Controller | Finance manager |
| Close accounting period | Senior accountant | Controller | Finance manager |

### Key rule

A user should not be allowed to create, approve, and complete the same high-risk transaction without independent review.

---

## 8. User Lifecycle

Recommended lifecycle:

```text
Requested
    ↓
Identity Verified
    ↓
Role Approved
    ↓
Invited
    ↓
Active
    ↓
Access Reviewed
    ↓
Suspended or Modified
    ↓
Deactivated
    ↓
Archived
```

### User onboarding checklist

- [ ] Identity confirmed.
- [ ] Business email verified.
- [ ] Manager approval recorded.
- [ ] Role selected.
- [ ] Scope of access documented.
- [ ] MFA enabled where supported.
- [ ] Temporary password changed.
- [ ] Security training completed.
- [ ] Access tested.
- [ ] Audit record created.

### User offboarding checklist

- [ ] Access disabled promptly.
- [ ] Active sessions revoked.
- [ ] API tokens revoked.
- [ ] Ownership transferred.
- [ ] Pending approvals reassigned.
- [ ] Shared credentials rotated.
- [ ] Final audit review completed.
- [ ] Deactivation recorded.

---

## 9. Periodic Access Review

Access should be reviewed regularly.

Recommended frequencies:

| Review | Suggested frequency |
|---|---|
| Administrator access | Monthly |
| Payment approvers | Monthly |
| External accountants | Quarterly |
| Standard users | Quarterly |
| Dormant users | Monthly |
| Full organization access review | At least annually |

### Review questions

- Does the user still work with the company?
- Does the role still match the user’s responsibilities?
- Does the user have excessive access?
- Are there inactive or duplicate accounts?
- Does the user still require external-system access?
- Has the user changed department or manager?
- Are administrator privileges still justified?

---

## 10. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Excessive administrator access | Too many users can change settings | Limit administrator assignments |
| Shared accounts | Multiple people use one login | Require individual accounts |
| Orphaned accounts | Former employee remains active | Automated offboarding |
| Self-approval | User creates and approves payment | Segregation of duties |
| Dormant privileged account | Unused admin remains active | Dormancy alerts and review |
| Untracked access changes | Role changed without history | Immutable audit log |
| External-user overreach | Accountant receives unnecessary access | Time-limited, scoped access |
| Primary-admin dependency | Only one person controls the account | Documented transfer and recovery process |

---

## 11. Recommended Permission Model

A custom system should combine:

- role-based access control;
- permission-based access;
- data-scope restrictions;
- approval limits;
- environment restrictions.

### Example permissions

```text
users.view
users.invite
users.edit
users.deactivate

customers.view
customers.create
customers.edit

suppliers.view
suppliers.create
suppliers.edit

invoices.create
invoices.approve
payments.create
payments.approve

reports.view
reports.export

settings.view
settings.edit

audit.view
periods.close
```

### Data-scope examples

- own records;
- assigned department;
- assigned location;
- assigned company;
- all companies;
- read-only;
- limited monetary approval threshold.

---

## 12. Suggested Database Design

### `users`

```text
id
email
full_name
status
department_id
manager_id
last_login_at
mfa_enabled
created_at
updated_at
deactivated_at
```

### `roles`

```text
id
name
description
is_system_role
risk_level
created_at
updated_at
```

### `permissions`

```text
id
permission_key
description
module
risk_level
```

### `user_roles`

```text
id
user_id
role_id
scope_type
scope_id
effective_from
effective_to
approved_by
created_at
```

### `role_permissions`

```text
id
role_id
permission_id
```

### Supporting tables

```text
access_requests
access_approvals
user_invites
login_sessions
mfa_methods
access_review_campaigns
access_review_results
permission_change_history
```

---

## 13. Recommended Technical Controls

1. Require unique individual accounts.
2. Enable MFA for privileged users.
3. Encrypt sessions and tokens.
4. Apply row-level security.
5. Record every access change.
6. Revoke sessions after deactivation.
7. Prevent users from elevating their own roles.
8. Require approval for privileged roles.
9. Enforce password and session policies.
10. Alert on suspicious login activity.
11. Provide emergency-access procedures.
12. Review dormant accounts automatically.

---

## 14. AI Implementation Prompt

```text
Implement a user and access-management module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Implement role-based access control and granular permissions.
- Support Primary Administrator, Company Administrator, Standard User, Time Tracking Only, Reports Only, and Accountant-style roles.
- Support department, location, company, and record-level scopes.
- Prevent users from changing their own privileged role.
- Require approval for administrator and payment-approval permissions.
- Implement segregation-of-duties validation.
- Store effective-from and effective-to dates for role assignments.
- Support invitations, activation, suspension, deactivation, and reactivation.
- Revoke active sessions when a user is deactivated.
- Maintain immutable permission-change history.
- Implement periodic access-review campaigns.
- Add MFA status, last-login time, dormant-user alerts, and suspicious-login monitoring.
- Use Supabase Row Level Security for data access.
- Add filters, search, pagination, bulk actions, and confirmation dialogs.
- Include unit and integration tests for permissions, role escalation, access scopes, deactivation, and segregation of duties.
```

---

## 15. Internal System Checklist

- [ ] Every employee has an individual account.
- [ ] Shared accounts are prohibited.
- [ ] Administrator access is limited.
- [ ] MFA is enabled for privileged users.
- [ ] High-risk permissions require approval.
- [ ] Segregation-of-duties rules are implemented.
- [ ] Access changes are logged.
- [ ] Dormant accounts are reviewed.
- [ ] Offboarding revokes sessions and tokens.
- [ ] External access has an expiry date.
- [ ] Periodic access reviews are documented.
- [ ] Primary Administrator transfer procedures exist.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- Company Setup
- Accounting Permissions
- Approval Workflows
- Period Close
- Security and Compliance
- External Accountant Access

---

## Keywords

Managing Users, user roles, Primary Administrator, Company Administrator, Standard User, Time Tracking Only, Reports Only, Accountant User, RBAC, permissions, least privilege, segregation of duties, access review, user lifecycle, MFA, Supabase RLS