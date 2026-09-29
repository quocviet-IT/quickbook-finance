# Chart of Accounts: the Retail & Jewelry template, and a chart grouped by section

**Status:** approved in conversation, 2026-09-29.
**Branch:** `feat/coa-retail-template` (from `feat/report-statements`, which carries 1.66).
**Release:** 1.67.

## 1. What is asked

The client is organizing the chart of accounts for retail and jewelry
businesses. Related accounts sit together, and every bank account sits in one
section. The requested sections are:

- Current Assets – Bank Accounts
- Current Assets – Receivables & Inventory
- Non-current Assets
- Current Liabilities
- Non-current Liabilities
- Equity
- Income
- Cost of Goods Sold
- Operating Expenses

The request also asks for account numbers, account types, parent accounts and
sub-accounts. The aim is a chart that is easy to navigate and can be mapped and
categorized consistently.

## 2. Scope, as decided

- **New companies** can be created with a **Retail & Jewelry** chart instead of
  the **Standard** one. The template is applied inside the provisioning
  transaction.
- **Every company** gets the Chart of Accounts screen grouped by the sections
  above, shown as a parent/sub-account tree in numeric code order.
- **Existing companies' accounts are not changed.** No code, name, parent or
  type changes, and no figure changes. The migration only adds metadata:
  - a new account type;
  - a contra flag, set on the two system contra accounts;
  - a detail type on the system Undeposited Funds account.
- **Out of scope, for later:**
  - adding template accounts to an existing company;
  - a settings screen that maps system roles to accounts, which would let
    Purchase Discounts move into COGS;
  - rule-based categorization of bank transactions;
  - keeping QuickBooks `Parent:Child` hierarchy on import.

## 3. Decisions

1. **Other Income** stays its own type (`other_income`). The P&L shows it below
   Net Operating Income, as today. The Chart of Accounts screen lists it under
   Income.
2. **Purchase Discounts** means the existing `7010 Purchase Discounts Taken`
   (`other_income`). Vendor-payment terms post to it automatically, and the
   function that does so looks it up by code 7010. It moves into COGS only when
   system account roles become configurable.
3. **Undeposited Funds and Transfer Clearing** stay `current_asset`, so Banking
   and bank reconciliation never treat them as bank accounts. They carry detail
   types `undeposited_funds` and `transfer_clearing`. The Chart of Accounts
   screen places those two detail types in the Bank Accounts section.
4. **Contra accounts** get an explicit `is_contra` flag, replacing today's
   regex on free-text `detail_type` (`lib/domain/exceptions.ts:118`). The
   Exception Report's wrong-way-balance check skips flagged accounts.
5. **Non-current liabilities** get a new account type, `long_term_liability`.
   It is credit-normal and a Balance Sheet type, with cash-flow role
   `financing`.
6. **A sub-account has its parent's type.** This is enforced in the account
   form and by a database trigger. The trigger fires only when
   `parent_account_id` or `account_type` changes, so existing rows are not
   re-judged.

## 4. The Retail & Jewelry template

Codes are four digits in OneBook's existing ranges. ★ marks an account that
the migrations already seed and that code relies on by its number: 1210,
1190, 1500, 1590, 2100, 2110, 2150, 3900, 5090, 6900, 7010 and others. Those
keep their codes; the template may only rename them, set a parent or a flag, or
fill in metadata. That is safe because the company is brand new and has no
postings.

Every row is a posting account. Parents keep posting, because some carry system
roles (1200 carries the inventory cash-flow role by code).

| Code | Name | Type | Parent | Detail type | Contra | Cash-flow role |
|---|---|---|---|---|---|---|
| **Current Assets – Bank Accounts** |||||||
| 1000 ★ | Cash on Hand | bank | | cash_on_hand | | cash |
| 1010 ★ | Bank – Operating Account | bank | | checking | | cash |
| 1020 | Bank – Checking | bank | | checking | | cash |
| 1030 | Bank – Savings | bank | | savings | | cash |
| 1040 | Bank – Money Market | bank | | money_market | | cash |
| 1050 | Bank – Credit Union | bank | | other_bank | | cash |
| 1090 | Transfer Clearing | current_asset | | transfer_clearing | | cash_equivalent |
| 1210 ★ | Undeposited Funds | current_asset | | undeposited_funds | | operating_asset |
| **Current Assets – Receivables & Inventory** |||||||
| 1100 ★ | Accounts Receivable | accounts_receivable | | | | operating_receivable |
| 1190 ★ | Allowance for Doubtful Accounts | current_asset | | | yes | (as seeded) |
| 1200 ★ | Inventory | current_asset | | | | operating_inventory |
| 1230 | Inventory – Jewelry | current_asset | 1200 | | | operating_inventory |
| 1240 | Inventory – Finished Jewelry | current_asset | 1200 | | | operating_inventory |
| 1250 | Inventory – Raw Materials | current_asset | 1200 | | | operating_inventory |
| 1260 | Inventory – Retail Merchandise | current_asset | 1200 | | | operating_inventory |
| 1270 | Inventory – Supplies | current_asset | 1200 | | | operating_inventory |
| 1300 | Prepaid Expenses | current_asset | | | | operating_asset |
| 1390 | Other Current Assets | current_asset | | | | operating_asset |
| 2110 ★ | Sales Tax Receivable | current_asset | | | | operating_asset |
| **Non-current Assets** |||||||
| 1500 ★ | Property & Equipment | fixed_asset | | | | investing |
| 1510 | Store Fixtures & Equipment | fixed_asset | 1500 | | | investing |
| 1520 | Jewelry Equipment | fixed_asset | 1500 | | | investing |
| 1530 | Computers & Office Equipment | fixed_asset | 1500 | | | investing |
| 1540 | Vehicles | fixed_asset | 1500 | | | investing |
| 1590 ★ | Accumulated Depreciation | fixed_asset | | Contra fixed asset | yes | investing |
| 1700 | Security Deposits | fixed_asset | | | | investing |
| 1790 | Other Long-Term Assets | fixed_asset | | | | investing |
| **Current Liabilities** |||||||
| 2000 ★ | Accounts Payable | accounts_payable | | | | operating_payable |
| 2050 | Credit Card Payable | credit_card | | | | financing |
| 2100 ★ | Sales Tax Payable | current_liability | | | | operating_liability |
| 2150 ★ | Goods Received Not Invoiced | current_liability | | | | operating_liability |
| 2200 | Customer Deposits | current_liability | | | | operating_liability |
| 2210 | Gift Cards / Store Credits Payable | current_liability | | | | operating_liability |
| 2300 | Payroll Liabilities | current_liability | | | | operating_liability |
| 2400 | Current Portion of Loans | current_liability | | | | financing |
| 2490 | Other Current Liabilities | current_liability | | | | operating_liability |
| **Non-current Liabilities** |||||||
| 2500 | Long-Term Loans Payable | long_term_liability | | | | financing |
| 2600 | Notes Payable | long_term_liability | | | | financing |
| 2700 | Long-Term Lease Liability | long_term_liability | | | | financing |
| 2990 | Other Long-Term Liabilities | long_term_liability | | | | financing |
| **Equity** |||||||
| 3000 ★ | Owner's Capital / Common Stock | equity | | | | financing |
| 3100 | Additional Paid-In Capital | equity | | | | financing |
| 3200 | Retained Earnings | equity | | | | financing |
| 3300 | Owner's Draw / Distributions | equity | | | yes | financing |
| 3900 ★ | Opening Balance Equity | equity | | | | (as seeded) |
| **Income** |||||||
| 4000 ★ | Sales Revenue | income | | | | operating |
| 4010 | Jewelry Sales | income | 4000 | | | operating |
| 4020 | Retail Sales | income | 4000 | | | operating |
| 4030 | Custom Jewelry Sales | income | 4000 | | | operating |
| 4100 ★ | Repair & Service Income | income | | | | operating |
| 4900 | Sales Returns & Allowances | income | | | yes | operating |
| 4910 | Sales Discounts | income | | | yes | operating |
| 7000 ★ | Other Income | other_income | | | | operating |
| **Cost of Goods Sold** |||||||
| 5000 ★ | Cost of Goods Sold | cost_of_goods_sold | | | | operating |
| 5010 | COGS – Jewelry | cost_of_goods_sold | 5000 | | | operating |
| 5020 | COGS – Retail Merchandise | cost_of_goods_sold | 5000 | | | operating |
| 5030 | COGS – Raw Materials | cost_of_goods_sold | 5000 | | | operating |
| 5040 | COGS – Custom Jewelry | cost_of_goods_sold | 5000 | | | operating |
| 5090 ★ | Inventory Adjustments | cost_of_goods_sold | | | | operating |
| 5100 | Freight / Shipping In | cost_of_goods_sold | | | | operating |
| **Operating Expenses** |||||||
| 6000 ★ | Operating Expenses | expense | | | | operating |
| 6010 | Salaries & Wages | expense | 6000 | | | operating |
| 6020 | Payroll Taxes | expense | 6000 | | | operating |
| 6030 | Rent | expense | 6000 | | | operating |
| 6040 | Utilities | expense | 6000 | | | operating |
| 6050 | Insurance | expense | 6000 | | | operating |
| 6060 | Advertising & Marketing | expense | 6000 | | | operating |
| 6070 | Merchant / Credit Card Fees | expense | 6000 | | | operating |
| 6080 | Bank Charges | expense | 6000 | | | operating |
| 6090 | Shipping & Delivery | expense | 6000 | | | operating |
| 6100 | Repairs & Maintenance | expense | 6000 | | | operating |
| 6110 | Office Supplies | expense | 6000 | | | operating |
| 6120 | Software & Subscriptions | expense | 6000 | | | operating |
| 6130 | Professional Fees | expense | 6000 | | | operating |
| 6140 | Telephone & Internet | expense | 6000 | | | operating |
| 6150 | Travel & Meals | expense | 6000 | | | operating |
| 6160 | Taxes & Licenses | expense | 6000 | | | operating |
| 6990 | Miscellaneous Expense | expense | 6000 | | | operating |
| 6800 ★ | Depreciation Expense | expense | | | | operating |
| 6900 ★ | Bad Debt Expense | expense | | | | operating |
| **Other Income & Expenses** (system accounts, unchanged) |||||||
| 7010 ★ | Purchase Discounts Taken | other_income | | | | operating |
| 7500 ★ | Other Expenses | other_expense | | | | operating |
| 7990 ★ | Gain on Asset Disposal | other_income | | | | (as seeded) |
| 8990 ★ | Loss on Asset Disposal | other_expense | | | | (as seeded) |

"(as seeded)" means the template leaves that field as the migration set it.
When applying the template, a ★ row only renames the account, sets the parent,
contra flag and detail type as listed, and sets the cash-flow role where the
table gives one. It never changes the type of a ★ account. A seeded account
that the template does not list is left as it is.

## 5. Software changes

### 5.1 Migration `0125_chart_of_accounts_structure.sql`

Applied by `scripts/migrate.mjs` to every company schema, and replayed by
provisioning for new ones.

- `alter type acc_account_type add value if not exists 'long_term_liability' after 'current_liability';`
  - Nothing in the same file uses the new value.
  - Provisioning may use it later in the same transaction: Postgres 17.6
    allows this because the enum type is created in that same transaction.
    Verified on the live server on 2026-09-29 with a rolled-back probe.
- `acc_account.is_contra boolean not null default false`. Backfill:
  - `true` where `detail_type ~* '^\s*contra\b'` (1590 Accumulated
    Depreciation);
  - `true` where `account_code = '1190' and name ilike 'allowance%'`.
- `detail_type = 'undeposited_funds'` where `account_code = '1210'`,
  `name ilike '%undeposited%'` and `detail_type is null`.
- A trigger that rejects a parent whose `account_type` differs from the
  child's. It fires `before insert or update of parent_account_id, account_type`.
  - Changing a parent's type is also refused while it has children of the old
    type.
  - Message: `A sub-account must have the same type as its parent`.
- `onebook.company_request.chart_template text not null default 'standard'
  check (chart_template in ('standard', 'retail_jewelry'))`.
- `onebook.request_company` gains `p_chart_template text default 'standard'`.
  Drop the old four-argument signature first, so a four-argument call is not
  ambiguous. Grants follow the existing function's.
- The migration changes no amount, code, name, parent or type of any existing
  account.

### 5.2 Domain

- `lib/domain/accounts.ts`: add `long_term_liability` to `ACCOUNT_TYPES`,
  right after `current_liability`, with label "Long-term Liability". It is
  credit-normal and belongs to the Balance Sheet.
- Every place that lists liability types must include it. Typecheck finds the
  exhaustive `Record<AccountType, …>` maps; grep finds the literal arrays.
  Known places:
  - `buildBalanceSheet` in `lib/domain/reports.ts`;
  - `LIABILITY_TYPES` and the liabilities block in `lib/domain/statement.ts`,
    which becomes Current Liabilities + Long-term Liabilities, each with a
    subtotal, then Total Liabilities;
  - the cash-flow default role (`financing`);
  - Beancount's root mapping (`Liabilities`);
  - `lib/domain/import-mapping.ts:494`, which maps "long term liability /
    notes payable / loan payable" to `long_term_liability` instead of
    `current_liability`.
- `is_contra` on `AccountRow`. `lib/domain/exceptions.ts` reads the flag
  instead of the regex.
- Detail types: the bank-only picker becomes type-aware. `current_asset`
  offers Undeposited funds and Transfer clearing, alongside the bank options
  that exist today.
- `lib/domain/chart-templates.ts` (new, pure): `CHART_TEMPLATES` with
  `standard` (no rows) and `retail_jewelry` (the table in §4, as data). Also
  `chartTemplateStatements(template)`, which returns the parameterized SQL that
  applies a template: insert or update by `account_code`, then set parents by
  code.
- `lib/domain/account-sections.ts` (new, pure): the section rules below, and
  `accountTree(accounts)`, which gives the sections, then nested rows with
  depth, in numeric code order (`localeCompare(…, { numeric: true })`).

Section rules, for every company:

| Section | Accounts |
|---|---|
| Current Assets – Bank Accounts | `bank`; `current_asset` with detail `undeposited_funds` or `transfer_clearing` |
| Current Assets – Receivables & Inventory | `accounts_receivable`; other `current_asset` |
| Non-current Assets | `fixed_asset` |
| Current Liabilities | `accounts_payable`, `credit_card`, `current_liability` |
| Non-current Liabilities | `long_term_liability` |
| Equity | `equity` |
| Income | `income`, `other_income` |
| Cost of Goods Sold | `cost_of_goods_sold` |
| Operating Expenses | `expense` |
| Other Expenses | `other_expense` |

A sub-account whose parent falls in another section sits at the top level of
its own section, as the statement tree already does.

### 5.3 Provisioning

- `ProvisionCompanyInput` gains `chartTemplate`. After the migration
  statements run, and before the self-check, `provisionCompany` applies
  `chartTemplateStatements` inside the same transaction.
- The queue passes `row.chart_template`.
- The self-check also confirms that every template code exists with its parent.

### 5.4 Screens

- **New Company** (`settings/companies/NewCompanyModal.tsx`): a "Chart of
  accounts" choice, "Standard" (default) or "Retail & Jewelry", each with a
  one-line description. `requestCompanyAction` passes it through.
- **Chart of Accounts** (`/accounts`):
  - rows grouped under the section headings with an account count;
  - sub-accounts indented under their parent;
  - numeric code order;
  - "Contra" and "Inactive" shown as tags.

  Search and the existing filters keep working. A match is shown in its
  section, under its parent. The form gains the Contra checkbox, the
  Long-term Liability type and the type-aware detail type. It rejects a parent
  of another type, with the trigger's message.

### 5.5 Release

Changelog 1.67:
- the Retail & Jewelry chart for new companies;
- the Chart of Accounts grouped by section;
- the Non-current Liabilities type and Balance Sheet group;
- contra accounts no longer flagged as wrong-way balances.

## 6. Proving it

1. **Unit tests:**
   - Template integrity:
     - unique codes;
     - every parent exists in the template or among the seeded ★ codes, and has
       the child's type;
     - every ★ code keeps its seeded type;
     - no system code is repurposed;
     - every row's type is valid for its section;
     - contra rows are exactly 1190, 1590, 3300, 4900, 4910.
   - Section rules and tree order, including a cross-section parent and
     3-digit codes (numeric sort).
   - `long_term_liability` in the Balance Sheet, statement, cash-flow default,
     Beancount and import mapping.
   - The Exception Report skips contra accounts and still flags a real
     wrong-way balance.
   - The parent-type check in the form's validation.
2. **Migration checks:**
   - `tests/unit/migration-grants.test.ts` and the other migration gates.
   - A rollback verification script `scripts/verify-coa-structure.mjs`. In
     one rolled-back transaction it checks:
     - the trigger refuses a mismatched parent;
     - the contra backfill;
     - the Undeposited detail backfill;
     - that no amount or code changed, with a fingerprint of `acc_account`
       codes, names, types and parents before and after, apart from the new
       columns.
3. **Provisioning:** `npm run verify:company-provisioning`, extended to build
   one company with `retail_jewelry` in a rolled-back transaction and assert
   the whole template.
4. **Live, with approval:** apply migration 0125 to all four schemas. Then run
   smoke, the four gates, and screenshots of the Chart of Accounts screen on
   the sample company and on Aurora, light and dark, plus the New Company
   modal. Creating a real company with the template is optional and needs the
   user's say-so, because it creates a new schema in production.

## 7. Constraints

- US English UI. No hex colours outside the token block. No Ant Design
  `<Table` in new files. Paged reads.
- Commits: files staged by name, no Co-Authored-By trailer, messages written
  with Bash `printf`.
- Nothing is written to live data without the user's approval. The migration
  apply is the one live write, and it is asked for before it runs.
