# Who can do what in OneBook

For the administrators of each company, and for whoever answers their questions.
A Vietnamese version is in [permissions.vi.md](permissions.vi.md).

---

## The short version

- Everyone in a company has **one role**: admin, accountant, sales or viewer.
- On top of the role sit **38 permissions**, switched on or off per role in
  **Settings › Permissions**. Every switch is checked before its action runs.
- **The database decides.** A screen hides what you may not do, but the guard is
  the database function behind the action: it asks who you are, what your role is
  and whether your role holds the permission, every time.
- **Suspending someone takes effect at once**, on every screen, report and export.
- **Every change is recorded** in the audit log, with who made it and when.

---

## Roles

| Role | Meant for | In short |
| --- | --- | --- |
| **admin** | The owner or the controller | Everything, including users, permissions and company settings. |
| **accountant** | Day-to-day bookkeeping | Enters, posts, reconciles and voids. No users, permissions, settings or reopening. |
| **sales** | Staff who sell | Reads the books and keeps the product and service list. Posts nothing. |
| **viewer** | Auditors, owners who only look | Reads the books, the audit log and attachments. Changes nothing. |

A company always keeps at least one active admin. OneBook refuses to suspend,
offboard or demote the last one, and an admin cannot do it to themselves.

## User status

| Status | Can enter the company? |
| --- | --- |
| invited, active | Yes |
| suspended | No, from the moment the change is saved. Can be made active again. |
| offboarded | No. For someone who has left; it is not undone. |

Every status change asks for a reason, and the reason goes into the audit log.

## Getting into a company

- A person can open a company when that company's **Users** list holds them as
  invited or active. One sign-in can belong to several companies, with a
  different role in each.
- The company switcher shows only the companies a person belongs to. Each switch
  is checked again on the server.
- **Platform administrators**, a separate list of a few people, are the only ones
  who can create a new company (**Settings › Companies**) or restore a backup
  into a new one (**Settings › Backups**). Being an admin inside a company does
  not include either.

---

## The permission matrix

Every permission below is enforced: switching one off for a role stops that
role at once. A ✓ is the starting setting every company is created with.

Some actions also need a role, whatever the matrix says. Those switches are
greyed out on the screen, with a note:

- **Admin or accountant** (bookkeeping): posting and voiding bills, issuing and
  voiding invoices, reversing journals, completing reconciliations, closing
  periods, approving purchase orders and match variances, adjusting inventory,
  writing off balances, and overriding a credit limit.
- **Admin only**: reopening a period, and reopening a reconciliation.

| Area | Permission | What it allows | admin | accountant | sales | viewer | Who can use it |
| --- | --- | --- | :-: | :-: | :-: | :-: | --- |
| Accounting | Post manual journals | Create and post manual journal entries | ✓ | ✓ | | | Any role |
| Accounting | Void journal entries | Reverse a posted manual journal or opening balance | ✓ | ✓ | | | Admin or accountant |
| Accounting | Manage recurring transactions | Create, pause, resume and review recurring schedules | ✓ | ✓ | | | Any role |
| Accounting | Manage fixed assets | Create and maintain the fixed asset register | ✓ | ✓ | | | Any role |
| Accounting | Post asset depreciation | Post scheduled depreciation to the general ledger | ✓ | ✓ | | | Any role |
| Accounting | Import existing fixed assets | Import prior assets and their accumulated depreciation | ✓ | ✓ | | | Any role |
| Accounting | Dispose fixed assets | Retire or sell an asset and post the gain or loss | ✓ | ✓ | | | Any role |
| Banking | Review bank matches | Generate, approve and reject bank-to-ledger matches | ✓ | ✓ | | | Any role |
| Banking | Manage direct bank feeds | Connect banks and synchronize transactions | ✓ | ✓ | | | Any role |
| Banking | Complete reconciliations | Complete a reconciliation, or bring an account's history forward | ✓ | ✓ | | | Admin or accountant |
| Banking | Reopen reconciliations | Reopen a completed reconciliation | ✓ | | | | Admin |
| Close | Close accounting periods | Close a monthly accounting period | ✓ | | | | Admin or accountant |
| Close | Reopen accounting periods | Reopen a closed accounting period | ✓ | | | | Admin |
| Documents | Read supporting documents | List and open attachments | ✓ | ✓ | | ✓ | Any role |
| Documents | Manage supporting documents | Upload and archive attachments | ✓ | ✓ | | | Any role |
| Documents | Govern document retention | Set retention dates and legal holds | ✓ | | | | Any role |
| Governance | Read the audit log | Search the audit history | ✓ | ✓ | | ✓ | Any role |
| Governance | Approve or reject requests | Decide on a two-person approval request | ✓ | ✓ | | | Any role |
| Governance | Manage users | Add users, change roles, suspend, offboard | ✓ | | | | Any role |
| Governance | Manage permissions | Change this matrix | ✓ | | | | Any role |
| Governance | Manage settings | Company profile, work policy, the period calendar, purchasing tolerances and approval policies | ✓ | | | | Any role |
| Governance | Export company data | Download the full company archive and backups | ✓ | | | | Any role |
| Governance | Restore a backup | Restore a backup into a new company (platform administrators only) | ✓ | | | | Any role |
| Governance | Read the feedback queue | See the bug reports and suggestions staff filed | ✓ | | | | Any role |
| Governance | Triage feedback | Move reports between queues | ✓ | | | | Any role |
| Inventory | Adjust inventory | Post an inventory quantity or value adjustment | ✓ | ✓ | | | Admin or accountant |
| Purchases | Post bills | Post a vendor bill to Accounts Payable | ✓ | ✓ | | | Admin or accountant |
| Purchases | Void bills | Void a vendor bill, draft or posted | ✓ | ✓ | | | Admin or accountant |
| Purchases | Approve purchase orders | Move a purchase order from draft to open | ✓ | ✓ | | | Admin or accountant |
| Purchases | Approve match variances | Bill a purchase order beyond its tolerance, with a reason | ✓ | ✓ | | | Admin or accountant |
| Purchases | Read the 1099 review dataset | Run the 1099 preparation report | ✓ | ✓ | | | Any role |
| Purchases | Manage vendor tax profiles | Change W-9 status, taxpayer ID and 1099 eligibility | ✓ | | | | Any role |
| Receivables | Write off balances | Write off an invoice or bill balance | ✓ | ✓ | | | Admin or accountant |
| Receivables | Override a credit limit | Issue an invoice over a credit limit or on credit hold | ✓ | | | | Admin or accountant |
| Reporting | Manage budgets | Create and update monthly budgets | ✓ | ✓ | | | Any role |
| Sales | Issue invoices | Issue a draft invoice to a customer | ✓ | ✓ | | | Admin or accountant |
| Sales | Void invoices | Void an invoice, draft or issued | ✓ | ✓ | | | Admin or accountant |
| Sales | Manage products and services | Create, edit, activate and deactivate products and services | ✓ | ✓ | ✓ | | Any role |

Outside the matrix, by role:

- **Admin only:** importing a chart of accounts, and changing tax codes.
- **Platform administrators only:** creating a company and restoring a backup,
  as above.
- **Admin or accountant:** every other document and record: customers, vendors,
  bills, expenses, payments, the chart of accounts, bank accounts and rules.

## Two-person approval

Seven actions can be made to wait for a second person, each above an amount you
choose, in **Settings › Approvals**: manual journals, write-offs, inventory
adjustments, reopening a period, reopening a reconciliation, cash counts and
vendor tax profiles. All seven start switched off.

- The approver needs **Approve or reject requests**.
- With "the approver must be someone else" on, a company needs **at least two**
  people holding that permission. With only one, the action is blocked for
  everyone, and the screen warns before you save that setting.

## How it is enforced

Four layers, and the third is the one that decides:

1. **Signing in.** Only a signed-in person reaches any page.
2. **Screens and their actions.** Buttons appear only for someone who may use
   them, and each action checks again on the server. This is for clarity, not
   for safety.
3. **Database functions.** Every action that changes the books runs inside a
   function that checks the caller's role and permission itself, and refuses
   anyone who is not a member of the company, including someone suspended.
4. **Table rules.** Reading is allowed to members only. Writing goes through the
   functions in layer 3. Since release 2.61 no record a screen changes can be
   written around its function: documents, users and permissions, periods and
   the audit log, banking and purchasing, and master data such as accounts,
   customers, vendors and products.

A new company is created with exactly the same rules as the existing ones.

---

## Operating guide

### Give someone access

- **They have never signed in to OneBook:** Settings › Users › **Add user**.
  Enter their email, name and role. OneBook creates their sign-in.
- **They already sign in for another company:** Settings › Users › **Add
  existing account**. Enter the email they sign in with and choose the role for
  this company. They keep their password.
- Give the least role that does the job. Add permissions to a role only when a
  real task needs them.

### Change someone's role

Settings › Users, the person's row, **Change role**. A reason is required. The
last active admin cannot be demoted.

### When someone leaves, or must be stopped at once

1. Settings › Users, the person's row: **Suspend** (can be undone) or
   **Offboard** (for good). Give the reason.
2. It takes effect immediately everywhere, including reports and exports.
3. If they could use the bank feed, check Banking for connections they set up.
4. If they were an approver, check that at least two people still hold **Approve
   or reject requests** where approvals require someone else.
5. If they belonged to other companies, repeat in each one.

### Change the matrix

Settings › Permissions. Only someone holding **Manage permissions** can. Change
it only for a business reason, and write the reason down where your team keeps
such decisions; the switch itself is recorded in the audit log. An admin cannot
switch off **Manage users** or **Manage permissions** for admins.

### Turn on two-person approval

Settings › Approvals. Turn on the action, set the amount, and decide whether
the approver must be someone else. See the two-person rule above.

### Create a company, or restore a backup

Platform administrators only. Settings › Companies to create one; Settings ›
Backups, **Restore**, to restore a backup into a new company beside the running
books. Restoring never overwrites a company.

### Review access every quarter

Once a quarter, for each company, an admin:

1. Opens Settings › Users and confirms every active person still needs access,
   with the role they have.
2. Suspends or offboards anyone who has left or changed jobs.
3. Opens Settings › Permissions and confirms any change from the starting
   matrix is still wanted.
4. Opens Settings › Audit history, filtered to users and permissions, and reads
   what changed since the last review.
5. Writes down the date and who reviewed.

### Check it yourself

The claim that the database decides can be tested from outside, the way an
auditor would, without anyone's existing credentials. On the sample company:

1. Settings › Users, **Add user** with the **Sales** role, for this test only.
2. Put its sign-in in `ACCESS_PROBE_EMAIL` and `ACCESS_PROBE_PASSWORD`, and run
   `npm run verify:access-denials` in `ctyhp-accounting/`. It signs in as that
   user and, through the same API the browser uses, tries nine actions the role
   may not take, writes straight to the tables, and another company's books.
   Every line must say PASS (refused), and nothing may change.
3. **Suspend** the account, then run it again with `-- --after-suspend` within
   the hour: the same signed-in session must read nothing at once.
4. **Offboard** the account.

---

## Still to decide

- **What sales and viewer may read.** Today both read the whole ledger. Limiting
  that is a product decision not yet taken.
- **A second sign-in factor (MFA).** Whether it is required, and for which roles,
  is not yet decided. Settings › Users shows who has set one up.
