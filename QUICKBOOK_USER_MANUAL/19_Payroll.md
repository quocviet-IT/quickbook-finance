# 19. Payroll

> Source scope: *QuickBooks Online Business User Manual*, Version 4 - July 2022, pages 83-99.

## Purpose

This chapter explains the payroll workflow documented in QuickBooks Online Australia, including business setup, Single Touch Payroll, employee setup, payroll-account mapping, opening balances, pay categories, pay runs, ABA files, payslips, payroll reports, and superannuation payments.

It also translates the documented workflow into system requirements for an internal payroll and accounting platform.

> **Important**
>
> This chapter reflects the Australian QuickBooks and KeyPay workflow documented in July 2022. Payroll, Single Touch Payroll, PAYG, SuperStream, Beam, tax, employment, privacy, and superannuation requirements are country-specific and time-sensitive. Treat this chapter as a historical workflow reference, not as current legal or payroll advice.

---

## 1. Payroll Overview

The manual describes QuickBooks Payroll as a payroll solution powered by KeyPay.

The documented platform supports:

- payroll business setup;
- employee records;
- employee self-service;
- payslip access;
- personal-detail updates;
- leave requests;
- Single Touch Payroll;
- payroll journals;
- payroll reporting;
- ABA bank-payment files;
- SuperStream-compatible superannuation payments.

A controlled payroll process should connect:

```text
Employee Master Data
        ↓
Payroll Configuration
        ↓
Pay Schedule
        ↓
Pay Run
        ↓
Review and Approval
        ↓
STP / Statutory Reporting
        ↓
Employee Payment
        ↓
Payslips
        ↓
Payroll Journal
        ↓
Reconciliation and Reports
```

---

## 2. Enable Payroll

The documented setup begins by selecting a payroll plan and enabling payroll with the organization’s business details.

General workflow:

```text
Choose Payroll Plan
        ↓
Enter Business Details
        ↓
Complete Setup Wizard
        ↓
Enable Payroll
        ↓
Add Employees
```

### Business information to validate

- legal business name;
- tax identifiers;
- business address;
- payroll contact;
- financial year;
- pay schedules;
- bank-payment details;
- statutory reporting settings;
- default superannuation fund;
- payroll clearing and liability accounts.

---

## 3. Single Touch Payroll

The manual instructs users to enable Single Touch Payroll from the Employee Centre and complete the setup wizard.

A controlled implementation should store:

- STP registration status;
- authorized declarer;
- business identifiers;
- submission status;
- submission timestamp;
- response or receipt identifier;
- errors and warnings;
- amendment history.

### Recommended STP status model

```text
Not Configured
Configured
Ready to Lodge
Submitted
Accepted
Rejected
Amendment Required
Finalised
```

> **Control principle**
>
> A pay run should not be treated as fully complete until required statutory reporting has been reviewed and its submission outcome has been recorded.

---

## 4. Add Employees

The source describes an employee setup wizard requiring employee personal information.

A payroll employee record may include:

| Area | Example fields |
|---|---|
| Identity | Legal name, preferred name, date of birth |
| Contact | Address, email, phone |
| Employment | Start date, status, position, department |
| Pay | Pay rate, pay category, pay schedule |
| Tax | Tax declaration and withholding setup |
| Bank | Payment account details |
| Superannuation | Fund, member number, contribution setup |
| Leave | Leave policies and opening balances |
| Access | Employee portal and payslip access |
| Termination | End date and termination reason |

### Employee onboarding controls

- verify identity;
- verify employment approval;
- validate tax information;
- validate bank details;
- validate pay rate;
- assign pay schedule;
- assign leave rules;
- assign superannuation details;
- require reviewer approval;
- protect sensitive personal information.

---

## 5. Review Employee Settings

After adding an employee, the manual recommends opening the employee record and reviewing each setup area before the first pay run.

Recommended review checklist:

- [ ] Personal details are complete.
- [ ] Employment dates are correct.
- [ ] Pay schedule is assigned.
- [ ] Pay category and base rate are correct.
- [ ] Tax setup is complete.
- [ ] Bank details are verified.
- [ ] Superannuation details are complete.
- [ ] Leave policies are assigned.
- [ ] Opening balances are recorded where required.
- [ ] Employee access is appropriate.
- [ ] Supporting employment documents are attached.
- [ ] Reviewer approval is recorded.

---

## 6. Payroll Chart of Accounts

The source states that payroll accounts are mapped so payroll journals can be exported to QuickBooks after each completed pay run.

Navigate to:

```text
Employee Centre
> Payroll Settings
> Business Settings
> Chart of Accounts
```

### Documented mapping workflow

1. Review Primary Account defaults.
2. Make required changes before the first pay run.
3. Import required accounts from QuickBooks.
4. Save the account list.
5. Map payroll categories to QuickBooks accounts.
6. Save the completed mapping.

### Mapping areas documented in the manual

- primary payroll accounts;
- pay categories;
- deductions;
- expense categories;
- leave provisions.

---

## 7. Recommended Payroll Accounts

A payroll ledger structure may include:

| Account | Type |
|---|---|
| Wages and Salaries Expense | Expense |
| Employer Superannuation Expense | Expense |
| Payroll Tax Expense | Expense |
| Leave Expense | Expense |
| PAYG Withholding Payable | Liability |
| Superannuation Payable | Liability |
| Payroll Clearing | Liability or clearing account |
| Employee Deductions Payable | Liability |
| Leave Provision | Liability |
| Wages Payable | Liability |

### Mapping controls

- account must be active;
- account type must be compatible;
- mapping changes require approval;
- mapping must be effective-dated;
- previous mappings must remain historically visible;
- each payroll journal must retain the mapping version used.

---

## 8. Payroll Opening Balances

The source describes an Opening Balances page for:

- selecting the initial financial year;
- importing employee opening balances;
- exporting opening balances;
- entering employee-specific values.

Navigate to:

```text
Employee Centre
> Payroll Settings
> Business Settings
> Opening Balances
```

The initial financial year determines the year to which opening Gross, PAYG, and Super balances apply.

The manual notes that opening balances have an effective Date Paid of 2 July in the selected financial year and that related reports should begin from 1 July of that financial year.

---

## 9. Employee Opening-Balance Data

Opening balances may include:

- gross earnings;
- PAYG withholding;
- superannuation;
- leave balances;
- year-to-date earnings;
- deductions;
- employer contributions.

When migration occurs during the financial year, include all relevant year-to-date values.

### Opening-balance controls

- reconcile to the prior payroll system;
- validate financial year;
- validate employee identity;
- validate leave units;
- require preparer and approver;
- lock approved opening balances;
- retain the source file and mapping;
- provide an exception report.

---

## 10. Pay Categories

Pay Categories define employee payment rates and calculation behavior.

The manual identifies capabilities such as:

- linked pay-rate calculations;
- loading and penalty multipliers;
- superannuation settings;
- leave accrual;
- payment-summary classification.

Navigate to:

```text
Employees
> Payroll Settings
> Pay Categories
```

---

## 11. Pay Category Fields

The source documents fields including:

| Field | Description |
|---|---|
| Name | Pay category name |
| Units | Hourly, annually, fixed, or daily |
| Super rate | Superannuation percentage |
| PAYG tax exempt | Tax-exemption indicator |
| Accrues leave | Whether earnings accrue leave |
| Rate loading | Loading applied to base rate |
| Penalty loading | Penalty applied above base and loading |
| Payment-summary classification | Reporting classification |

### Rate-loading example

```text
Base rate = 10.00
Rate loading = 50%

Linked rate = 15.00
```

### Penalty-loading control

The manual notes that penalty loading differs from normal rate loading because it does not accrue superannuation in the documented configuration.

---

## 12. Recommended Pay Category Model

Examples:

```text
Ordinary Hours
Overtime 1.5x
Overtime 2.0x
Saturday Penalty
Sunday Penalty
Public Holiday
Annual Leave
Personal Leave
Bonus
Commission
Allowance
Reimbursement
Termination Payment
```

Each category should define:

- calculation method;
- base rate relationship;
- tax treatment;
- superannuation treatment;
- leave accrual treatment;
- general-ledger account;
- reporting classification;
- effective dates;
- approval status.

---

## 13. Pay Schedules

A Pay Schedule defines when a group of employees is paid.

Navigate to:

```text
Payroll Centre
> Payroll Settings
> Pay Schedules
```

The source states that after a schedule is configured, future pay-run dates can roll forward automatically.

Typical schedules:

- weekly;
- fortnightly;
- semi-monthly;
- monthly;
- custom.

### Pay schedule fields

- schedule name;
- frequency;
- pay-period start and end;
- payment date;
- timezone;
- employee group;
- holiday adjustment rule;
- status;
- next pay run.

---

## 14. Create a Pay Run

The documented workflow is:

```text
Payroll Centre
> New Pay Run
```

Then:

1. select the Pay Schedule;
2. enter the Pay Period Ending date;
3. enter the payment date;
4. select Create;
5. review employee earnings, tax, and superannuation.

### Pay run calculations may include

- ordinary earnings;
- overtime;
- allowances;
- bonuses;
- commissions;
- leave taken;
- deductions;
- PAYG withholding;
- superannuation;
- employer expenses;
- net pay.

---

## 15. Employee-Level Pay Run Review

The source allows the user to expand each employee in the pay run and adjust details.

Possible adjustments include:

- leave taken;
- bonuses;
- allowances;
- deductions;
- hours;
- rates;
- earnings categories.

### Review controls

- display original and adjusted values;
- require a reason for manual changes;
- flag values outside approved thresholds;
- prevent unauthorized pay-rate changes;
- record the user and timestamp;
- recalculate tax, super, leave, and net pay;
- retain adjustment history.

---

## 16. Pay Run Warnings

Before finalising, review the Warnings tab.

Possible warnings include:

- missing ABA details;
- incomplete employee bank information;
- invalid superannuation details;
- missing tax data;
- negative net pay;
- missing account mappings;
- closed accounting period;
- statutory-submission configuration issues.

### Recommended warning levels

| Level | Meaning |
|---|---|
| Information | No blocking effect |
| Warning | Review required, override may be allowed |
| Error | Must be resolved before finalisation |
| Critical | Compliance or security issue |

---

## 17. ABA Bank-Payment File

The manual states that QuickBooks Payroll does not automatically pay employees, but it can create an ABA file for upload to the bank.

Documented setup:

1. open the ABA warning;
2. select Fix This;
3. open ABA Details;
4. select Add;
5. enter required details;
6. save;
7. finalise the pay run;
8. download the ABA file;
9. upload it to the bank.

### ABA controls

- validate the business bank account;
- validate employee bank details;
- verify total net payroll;
- require payment approval;
- calculate a batch hash;
- prevent duplicate file generation or payment;
- store file-generation history;
- separate file preparation from bank release.

---

## 18. Finalise the Pay Run

The source workflow includes:

- selecting **Finalise Pay Run**;
- choosing whether to lodge an STP Pay Event immediately or later;
- choosing when to publish or send payslips;
- locking the pay run after finalisation and STP lodgement;
- downloading the ABA file;
- running payroll reports;
- sending payslips;
- posting payroll journals automatically to QuickBooks.

### Recommended finalisation checklist

- [ ] Employee count is correct.
- [ ] Gross earnings are reviewed.
- [ ] PAYG is reviewed.
- [ ] Superannuation is reviewed.
- [ ] Leave is reviewed.
- [ ] Deductions are reviewed.
- [ ] Net pay matches the payment batch.
- [ ] Warnings and errors are resolved.
- [ ] Approver has signed off.
- [ ] STP action is selected.
- [ ] Payslip timing is selected.
- [ ] Payroll journal mapping is valid.
- [ ] Accounting period is open.

---

## 19. Locking and Amendments

The manual states that a finalised pay run can be unlocked, but changes should be made before bank payments or STP lodgement.

If payment and statutory lodgement have already occurred, the source recommends using a new pay run for the amendment.

### Recommended control model

```text
Draft
    ↓
Calculated
    ↓
Under Review
    ↓
Approved
    ↓
Finalised
    ↓
Paid
    ↓
Reported
    ↓
Locked
```

Corrections after reporting or payment should use:

- adjustment pay run;
- off-cycle pay run;
- reversal and replacement;
- formal amendment record.

Do not silently edit a completed pay run.

---

## 20. Payslips

Payslips may be:

- sent immediately;
- scheduled for later;
- published to the employee portal.

A payslip should include relevant payroll information such as:

- pay period;
- payment date;
- earnings;
- allowances;
- deductions;
- tax;
- superannuation;
- leave information;
- net pay;
- employer information.

### Security controls

- restrict payslip access to the employee and authorized payroll users;
- encrypt delivery and storage;
- prevent public links;
- log publication and access;
- protect sensitive personal and banking information.

---

## 21. Payroll Journals

After a pay run is completed, the source states that journals are posted automatically to QuickBooks using the mapped payroll accounts.

A payroll journal may include:

```text
Debit Wages Expense
Debit Employer Super Expense
Debit Leave Expense
Credit PAYG Withholding Payable
Credit Superannuation Payable
Credit Payroll Clearing or Wages Payable
Credit Other Deductions Payable
```

### Journal controls

- debit and credit totals must balance;
- journal must link to the pay run;
- journal must retain mapping version;
- duplicate journal export must be prevented;
- posting date must follow accounting policy;
- journal status must be visible;
- failed exports must enter an exception queue.

---

## 22. Payroll Reports

The source lists payroll, employee, and statutory reports accessible through:

```text
Employees > Reports
```

Important reports include:

| Report | Purpose |
|---|---|
| Detailed Activity Report | Employee activity by location and period |
| Super Contributions | Super contributions for a selected period |
| PAYG Withholding | PAYG withheld by month |
| Pay Run Audit Report | Earnings, super, bank payments, leave, and deductions |
| Leave Balances | Current leave balances by employee |
| Leave Liability | Leave liability at a point in time |
| Super Payments | Manage superannuation payments |
| Tax File Declaration Report | New-starter declaration reporting |
| Payment Summaries | Annual employee payment summaries |

### Recommended additional reports

- payroll register;
- payroll variance;
- negative net pay;
- missing bank details;
- missing superannuation details;
- employee master changes;
- overtime analysis;
- payroll cost by class/location;
- unposted payroll journals;
- payroll clearing reconciliation.

---

## 23. Superannuation and Beam

The manual documents automated superannuation payments through Beam.

The workflow includes:

1. open Super Payments;
2. register with Beam;
3. add the default super fund;
4. complete registration details;
5. provide the bank account;
6. create a new Super Payment batch;
7. select the payment date range;
8. select employees;
9. create and submit the batch;
10. pay using direct debit or BPAY, depending on setup.

### Recommended super-payment statuses

```text
Draft
Validated
Approved
Submitted
Processing
Paid
Rejected
Failed
Cancelled
```

---

## 24. Superannuation Controls

Before submitting a super payment:

- [ ] Employee fund details are valid.
- [ ] Contribution amounts reconcile to pay runs.
- [ ] Date range is correct.
- [ ] Duplicate contributions are excluded.
- [ ] Terminated employees are handled correctly.
- [ ] Payment bank account is approved.
- [ ] Batch total is reviewed.
- [ ] Submission method is authorized.
- [ ] Response and payment status are recorded.
- [ ] Failed items enter an exception queue.

---

## 25. Payroll Reconciliation

Recommended reconciliations include:

| Area | Reconciliation |
|---|---|
| Gross payroll | Pay run to payroll expense |
| Net payroll | Pay run to ABA/bank payment |
| PAYG | Pay run to PAYG liability account |
| Superannuation | Pay run to super liability and payment batch |
| Deductions | Pay run to deduction liabilities |
| Leave | Employee balances to leave provision |
| Payroll clearing | Journal to bank-payment clearing |
| Employee count | Active employees to pay-run population |

### Acceptance rule

A pay run should not be closed operationally until material differences are corrected or formally approved.

---

## 26. Segregation of Duties

Recommended separation:

| Activity | Role |
|---|---|
| Maintain employee records | HR |
| Maintain payroll configuration | Payroll administrator |
| Enter payroll adjustments | Payroll officer |
| Review pay run | Senior payroll reviewer |
| Approve pay run | Finance manager |
| Release bank payment | Authorized banking approver |
| Submit statutory report | Authorized declarer |
| Review payroll reconciliation | Accountant or controller |

No single user should control employee setup, pay calculation, approval, payment release, and reconciliation for a material payroll process.

---

## 27. Privacy and Security

Payroll data contains highly sensitive information.

Required controls include:

- role-based access;
- multi-factor authentication;
- row-level data restrictions;
- encrypted storage;
- encrypted transmission;
- masked bank and tax identifiers;
- restricted export;
- access logging;
- secure document retention;
- immediate offboarding;
- periodic access review.

### High-risk events to alert

- employee bank-detail change;
- pay-rate increase;
- new employee added immediately before payroll;
- bank account reused across employees;
- large bonus;
- negative net pay;
- payroll administrator role change;
- pay run unlocked after approval.

---

## 28. Risks and Controls

| Risk | Example | Recommended control |
|---|---|---|
| Ghost employee | Fake employee added to payroll | HR approval and employee reconciliation |
| Bank-detail fraud | Account changed before pay day | Dual approval and change alert |
| Incorrect pay rate | Unauthorized rate increase | Effective-dated rate approval |
| Duplicate pay run | Same schedule processed twice | Unique pay-period constraint |
| Missing STP submission | Pay run completed but not reported | Submission-status dashboard |
| Duplicate ABA payment | File uploaded twice | Batch hash and bank approval control |
| Wrong payroll account | Journal posts to incorrect ledger | Mapping validation and review |
| Invalid opening balances | Year-to-date totals are incorrect | Source reconciliation |
| Unapproved adjustment | Bonus added without authorization | Adjustment reason and approval |
| Privacy breach | User exports all payroll data | Restricted export and audit log |
| Incorrect super payment | Contributions do not match payroll | Batch reconciliation |
| Closed-period posting | Payroll journal posts to locked month | Period validation |

---

## 29. Suggested Database Design

### `employees`

```text
id
employee_number
legal_name
preferred_name
employment_status
start_date
termination_date
department_id
location_id
pay_schedule_id
portal_status
created_at
updated_at
```

### `employee_compensation`

```text
id
employee_id
pay_category_id
rate
unit_type
effective_from
effective_to
approved_by
created_at
```

### `pay_schedules`

```text
id
name
frequency
timezone
next_period_start
next_period_end
next_payment_date
status
created_at
updated_at
```

### `pay_runs`

```text
id
pay_schedule_id
period_start
period_end
payment_date
status
gross_amount
tax_amount
super_amount
deduction_amount
net_amount
prepared_by
reviewed_by
approved_by
finalised_at
locked_at
created_at
updated_at
```

### `pay_run_employee_lines`

```text
id
pay_run_id
employee_id
gross_amount
tax_amount
super_amount
deduction_amount
net_amount
warning_status
created_at
updated_at
```

### `pay_run_earnings`

```text
id
pay_run_employee_line_id
pay_category_id
units
rate
loading_rate
amount
tax_treatment
super_treatment
leave_treatment
```

### `payroll_submissions`

```text
id
pay_run_id
submission_type
status
submitted_at
response_reference
error_message
created_at
updated_at
```

### `payroll_payment_batches`

```text
id
pay_run_id
payment_method
batch_reference
file_hash
total_amount
status
prepared_by
approved_by
released_at
created_at
```

### Supporting tables

```text
employee_bank_accounts
employee_tax_details
employee_super_details
leave_policies
leave_balances
pay_categories
payroll_account_mappings
payroll_opening_balances
payroll_journal_exports
payroll_adjustments
payroll_audit_history
```

---

## 30. Recommended Constraints

1. Employee number must be unique.
2. One employee cannot have overlapping active compensation records for the same category.
3. Pay period and schedule combination must be unique.
4. Net pay must reconcile to payment-batch detail.
5. Pay-run totals must equal employee-line totals.
6. Finalised pay runs cannot be silently edited.
7. ABA batch hash must be unique.
8. Payroll journals must balance.
9. Account mappings must be effective-dated.
10. Sensitive bank changes require dual approval.
11. Closed accounting periods cannot receive payroll journals.
12. Statutory-submission responses must be retained.

---

## 31. Suggested Payroll Workflow

```text
Maintain Employee and Payroll Setup
        ↓
Create Pay Run
        ↓
Calculate Earnings, Tax, Super, Leave, and Net Pay
        ↓
Review Employee Exceptions
        ↓
Resolve Warnings
        ↓
Approve Pay Run
        ↓
Finalise
        ↓
Lodge Required Statutory Event
        ↓
Generate and Approve Payment Batch
        ↓
Publish Payslips
        ↓
Post Payroll Journal
        ↓
Reconcile Payroll, Bank, Tax, Super, and Leave
        ↓
Lock Pay Run
```

---

## 32. AI Implementation Prompt

```text
Implement a payroll module for an accounting web application.

Technology:
- Next.js
- TypeScript
- Supabase/PostgreSQL
- Ant Design

Requirements:
- Support employee onboarding, employment status, compensation, tax, bank, superannuation, leave, and document records.
- Support pay categories with hourly, annual, fixed, and daily units.
- Support rate loading, penalty loading, tax treatment, super treatment, leave accrual, and reporting classification.
- Support multiple pay schedules and automatic future-period calculation.
- Support pay runs with employee-level expansion and adjustments.
- Require adjustment reasons and approval where thresholds are exceeded.
- Implement warning and blocking-error validation.
- Support statutory submission status and response tracking through an adapter architecture.
- Support payslip generation, scheduling, secure employee access, and delivery status.
- Support ABA or configurable bank-payment file generation with unique file hash and dual approval.
- Prevent duplicate payment batches and duplicate pay runs.
- Automatically create balanced payroll journals using effective-dated account mappings.
- Support opening balances and year-to-date migration.
- Support leave balances and leave-liability reporting.
- Support superannuation contribution batches and payment status.
- Implement draft, calculated, review, approved, finalised, paid, reported, and locked statuses.
- Use adjustment pay runs instead of overwriting completed payroll.
- Add payroll reconciliation reports and exception queues.
- Enforce segregation of duties, MFA for privileged roles, encrypted sensitive fields, restricted exports, and immutable audit history.
- Include unit and integration tests for payroll calculations, rate loadings, adjustments, duplicate prevention, payment batches, journal balancing, permissions, period locks, and status transitions.
```

---

## 33. Internal System Checklist

- [ ] Payroll business configuration is approved.
- [ ] Employee onboarding is complete.
- [ ] Sensitive employee data is protected.
- [ ] Pay categories are configured.
- [ ] Pay schedules are documented.
- [ ] Payroll accounts are mapped.
- [ ] Opening balances reconcile.
- [ ] Pay-run warnings are resolved.
- [ ] Manual adjustments require reasons.
- [ ] Pay run is independently reviewed.
- [ ] Statutory-submission status is recorded.
- [ ] ABA or payment batch is approved separately.
- [ ] Payslips are delivered securely.
- [ ] Payroll journal balances.
- [ ] Net pay reconciles to the bank batch.
- [ ] PAYG and super liabilities reconcile.
- [ ] Leave balances and provisions reconcile.
- [ ] Completed pay runs are locked.
- [ ] Corrections use a formal adjustment process.
- [ ] Payroll access is reviewed periodically.

---

## Related Topics

- [05. Audit Log](05_Audit_Log.md)
- [06. Chart of Accounts](06_Chart_of_Accounts.md)
- [08. Managing Users](08_Managing_Users.md)
- [09. Multi-Currency](09_Multi_Currency.md)
- [12. Banking Centre](12_Banking_Centre.md)
- Class and Location Tracking
- Accounting Period Close
- Reports Centre

---

## Keywords

Payroll, employee, KeyPay, Single Touch Payroll, STP, pay category, pay schedule, pay run, PAYG withholding, superannuation, SuperStream, Beam, ABA file, payslip, payroll journal, leave balance, payroll reconciliation, payroll audit