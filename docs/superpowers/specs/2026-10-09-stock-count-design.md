# Stock Count: the mockup's periodic count sheet

Date: 2026-10-09 · Branch: `feat/stock-count` (from main 78bccbc, release 1.95) · Release number: the next free one when it merges (1.96 if nothing else merges first).

## Why

The client's mockup, `Accounting System-v4.html`, has a **Stock Count** report. It is the last item from wave 2 of the mockup's reports. Releases 1.94 and 1.95 brought the other reports in.

Stock Count is a **periodic** count sheet. You type or paste the stock on hand, line by line. OneBook compares the counted value with the inventory accounts' balance on a date and posts one adjusting entry for the difference. Books kept this way do not track units in and out. Purchases go to cost of sales, and the count corrects the balance sheet.

The imported client books already work like this. One of them carries two year-end entries of exactly this shape:
- Dr 5010 Inventory Adjustment
- Cr 1200 Inventory

OneBook can only post such entries today as hand-written journals.

The mockup embeds a real client's books. Only its structure is used here. Tests and screenshots use invented data or the sample company PC-Test.

## Decisions (agreed with the user, 09/10)

1. **Periodic, as in the mockup.** A count compares a counted value at cost with the inventory accounts' ledger balance and posts the difference. It does not count item by item.
2. **Posting goes through the same approval policy as inventory adjustments** (`inventory_adjustment`).
   - Below the policy's threshold, or with the policy disabled, posting is immediate.
   - Above it, the count waits for a second person's approval.
3. **Companies that track inventory items can view and edit counts but cannot post them.** In such a company, a ledger-only entry would break the tie between the item subledger and the ledger. The "Inventory ties to the ledger" close step would then fail. The Adjust button is disabled with an explanation that points to item adjustments on the Products & Services page.
4. **Approach A: every count is its own document.** Each count has a number `SC-000001`, a status, and its own saved lines.
   - A new count starts as a copy of the previous count's lines (name, SKU, quantity, cost, sells for). In use it feels like the mockup's standing stock list.
   - A posted count keeps its lines unchanged, so it can always be checked later.

## What the mockup does (structure only)

- **Count sheet lines:**
  - name
  - SKU / code
  - counted quantity
  - cost each
  - value = quantity × cost
  - sells for, shown for convenience only (it never reaches the accounts)
- **Paste a count sheet:** one line per item, as "name, quantity, cost" with an optional fourth column for "sells for".
- **Stat row:** Lines; Counted at cost; On the books; Difference.
- **The posting button:** "Adjust inventory by <difference> at <date>". When the difference is zero it is replaced by "The count agrees with the books."
- **The posted entry:**
  - dated the as-of date;
  - a positive difference debits inventory and credits cost of sales; a negative one does the reverse;
  - refused if the date falls in a closed period;
  - marked as an adjusting entry, so it shows in the adjustments column of the Working Trial Balance.
- **"Counts before this" table:** Recorded, As at, Counted, Was on the books, Adjusted by, Lines.
- **Footnote: "Periodic, on purpose."** Purchases go to cost of sales as they are made, and the count corrects the balance sheet. It is a count sheet, not perpetual stock.

## Data and posting

### Migrations

- **First migration, on its own:** add `stock_count` to `acc_journal_source`. An enum value cannot be used in the transaction that adds it.
- **Second migration:**
  - **`acc_stock_count`** columns:
    - `id`
    - `count_number` (from `acc_next_number('stock_count')`, prefix `SC-`)
    - `as_of date`
    - `status`, one of `draft | pending_approval | posted`
    - `memo`
    - frozen at posting: `counted_minor`, `book_minor`, `difference_minor`, `inventory_account_id`, `offset_account_id`
    - `journal_entry_id`
    - `approval_request_id`
    - `posted_by`, `posted_at`
    - actor stamps: `created_by/at`, `updated_by/at`
  - **`acc_stock_count_line`** columns:
    - `id`
    - `stock_count_id` (cascades on delete)
    - `line_order`
    - `name` (not null)
    - `sku`
    - `quantity numeric(20,4)`
    - `unit_cost_minor bigint`
    - `sells_for_minor bigint` (nullable)
  - **Pattern** (as in migration 0129):
    - `acc_stamp_actor` and `acc_audit_row_change` triggers;
    - RLS with read for any company role and no write policy, so writes happen only through the RPCs below;
    - `revoke` from public/anon and `grant` to authenticated/service_role, as the migration-grants test requires;
    - an `acc_sequence` row for `stock_count`.
- Both tables join `EXPORT_TABLES` (backup/restore), `AUDITED_TABLES` and `ACTIVITY_ENTITIES`, and get row types in `lib/db/types.ts`.

### RPCs (SECURITY DEFINER, `search_path = public`)

- **`acc_create_stock_count(p_as_of date)`**
  - Staff only.
  - If a count is already in draft or waiting for approval, it returns that count instead of starting a second one.
  - Otherwise it creates a draft and copies the lines of the most recent posted count, or of the most recent count of any status when none is posted.
- **`acc_save_stock_count(p_id, p_as_of, p_memo, p_lines jsonb)`**
  - Staff only, and only for a draft.
  - It replaces the whole set of lines in one transaction, so a count is never half saved.
  - It validates each line: a name is required; quantity ≥ 0; cost ≥ 0; sells for ≥ 0 or null.
  - A count can hold at most 2,000 lines.
- **`acc_post_stock_count(p_id, p_inventory_account_id, p_offset_account_id)`** checks, in order:
  1. `acc_is_staff()` and `acc_has_permission('inventory.adjust')`.
  2. The count is a draft, or it is waiting for approval and this call comes from approval dispatch.
  3. The company tracks no inventory items. That means no active `acc_item` with `is_inventory`; otherwise raise "This company tracks stock item by item; adjust items on the Products & Services page".
  4. The inventory account is one of the company's inventory accounts, by the same rule as 1.95's `pickInventoryAccounts`. The offset account is an active posting `cost_of_goods_sold` account.
  5. **Counted value:** the sum of `round(quantity × unit_cost_minor)` over the lines.
  6. **Book value:** the ledger balance, up to and including `as_of`, of all of the company's inventory accounts.
  7. **Difference** = counted − book. A zero difference raises "The count already agrees with the books."
  8. **Approval guard:** `acc_approval_required('inventory_adjustment', abs(difference)) and not acc_in_approval_dispatch()` raises the standard "requires approval; submit it for approval instead" message.
  9. **The entry**, built with `acc_assert_postable` and then `acc_post_entry(as_of, 'Stock count SC-… as of …', 'stock_count', count id, base currency, lines)`:
     - Line 1: the inventory account, debit when the difference is positive, credit when negative.
     - Line 2: the offset account, the other way round.
     - `acc_post_entry` already refuses a closed period, with the message `Accounting period for <date> is closed`.
  10. It marks the entry as adjusting, the same way depreciation is marked.
  11. It freezes the counted, book and difference figures, both account ids and the entry id on the count, and sets status `posted`.
  12. It writes an audit row with action `post`.
- **Approval dispatch.** `acc_approve_request` is re-issued with one more branch. An `inventory_adjustment` request whose payload carries `stock_count_id` calls `acc_post_stock_count`. The existing item branch is unchanged.
  - The difference is **recomputed when the request is approved**. A periodic count sets the books to the counted value, so it must true up against the books as they stand at approval, not as they stood at the request. The count page shows the current difference.
  - A rejected request puts the count back to draft.

### Default accounts (in the post dialog; the user can change them)

- **Inventory account.** The company's inventory account with the lowest code. Every live book has 1200 Inventory.
- **Offset account.** The first available, in this order:
  1. an active posting `cost_of_goods_sold` account named like "Inventory Adjustment" (`/inventory\s*adjust/i`);
  2. otherwise, the write-down account `acc_active_inventory_writedown_account()` (5090 "Inventory Write-down" in every live book);
  3. otherwise, the lowest-coded active `cost_of_goods_sold` account.

### Changes elsewhere

- **1.95 Purchases and Inventory** (`lib/domain/purchases-inventory.ts`): an entry with `source_type = 'stock_count'` is a count entry, alongside `inventory_adjustment`. Without this, a count posted to a plain cost-of-sales account would read as a negative purchase.
- **Entry detail** (`lib/domain/entry-detail.ts`): source label "Stock count", and a link to `/inventory/stock-count/<id>`.
  - The General Ledger report's source-route map gets the same link.
  - The Journal Report's source filter gains "Stock count".
- **Reversal:** none. `acc_reverse_entry` stays limited to manual journals and opening balances. A periodic count corrects itself: the next count is compared with the books as they stand, the earlier count's adjustment included. The mockup has no undo either.

## Screens

### Placement

- The sidebar's Inventory & Assets group gains **"Stock Count"** (`/inventory/stock-count`), after Overview and before Fixed Assets.
- The Report Center gains a card in the Inventory & Tax group:
  - title "Stock Count";
  - line "What stock is on hand and what it is carried at.";
  - it links to the same page.

### The list (`/inventory/stock-count`)

- Counts, newest first. Columns: Count #, As of, Status, Counted, Was on the books, Adjusted by, Lines, Posted by.
- Statuses read "Draft", "Waiting for approval" and "Posted".
- **"New count"** opens the open draft if one exists. Otherwise it creates a draft dated the company's today, with the previous count's lines copied.
- An empty state for the first count.

### A draft count (`/inventory/stock-count/<id>`)

- **Header:** As of date and Memo.
- **Stat row:** Lines, Counted at cost, On the books (read live at the as-of date), Difference.
- **Editable lines table:**
  - columns: Name with SKU, Counted, Cost each, Value (computed), Sells for, and a delete control;
  - "Add a line";
  - a "Counted at cost" total row inside the table, through `ReportTable`'s summary;
  - the table fits a 1440-pixel window.
- **"Paste a count sheet":**
  - a text area with the hint "One line each: name, quantity, cost — and sells for, if you like", and a "Read it" button;
  - each line is read from the right: the last two or three comma-separated fields are numbers, and the rest is the name, so names may contain commas;
  - pasted lines are appended;
  - a line that cannot be read is reported by its line number and reason, and the good lines are still added.
- **"Save draft".** Unsaved changes ask for confirmation before the page is left.
- **"Adjust inventory by <difference> at <date>":**
  - shown to users with `inventory.adjust`;
  - disabled with "The count agrees with the books." when the difference is zero;
  - disabled with the item-tracking explanation in a company that tracks items;
  - disabled while there are unsaved changes ("Save the count first").
- **The confirm dialog** shows:
  - the counted, book and difference figures;
  - the Inventory account and Offset account selects, with defaults as above;
  - the entry it will post (two lines, Dr/Cr).

  It ends in one of two outcomes:
  - "Posted as JE-…", with a link to the entry;
  - "Sent for approval", with a link to Approvals.

  A closed period shows the database's message in plain words.
- **Footnote:** "Periodic, on purpose: purchases go to cost of sales as they are made and the count corrects the balance sheet. This is a count sheet, not perpetual stock, so it does not track units in and out."

### A posted or waiting count

- Read-only, showing the figures frozen at posting.
- Links to the journal entry, or to the approval request.
- Print, CSV and Excel, with every line printed.

## Not in this release

- Item-by-item (perpetual) counting.
- Undoing a posted count. The next count corrects it, and an entry can still be reversed by a manual journal.
- A close-checklist step for "stock counted this period".
- Count sheets per location or bin.
- Importing a count from a spreadsheet file. Pasting covers it.

## Verification

- **Migration check script** (`scripts/verify-stock-count.mjs`). It runs inside an always-rolled-back transaction, one company schema at a time. It checks:
  - the tables, RLS, grants and sequence exist;
  - the RPCs exist and refuse a non-staff caller, a missing permission and a company with tracked items;
  - posting writes the two-line entry, the adjusting mark and the audit row, and freezes the figures;
  - a zero difference is refused;
  - a closed period is refused;
  - the approval threshold submits instead of posting.

  Each transaction stays short. It touches only the sample company's data, and nothing is left behind. Never run it beside other database scripts. A verification transaction that held locks on the journal tables once stalled the live app.
- **Provisioning:** `npm run verify:company-provisioning` after the migrations.
- **Unit tests:**
  - the paste reader: commas in names, a missing cost, negative and non-numeric fields, line numbers in errors;
  - totals and difference;
  - default account choice;
  - Purchases and Inventory treating `stock_count` as a count;
  - the entry-detail label and link;
  - a migration test for the tables, RLS, grants and enum value;
  - the navigation and catalog tests.
- **Live test:** read-only across all six companies. The book value matches the inventory accounts' ledger balance, and the default accounts resolve.
- **Smoke on PC-Test:**
  - create a count, paste a sheet, save, and see the difference;
  - post once for real on the sample company, then confirm the entry, the adjusting mark and that Purchases and Inventory shows the adjustment;
  - screenshots in light and dark for the user's approval before push.
- **Live migrations** run only with the user's approval.

## Changelog and Guide

- One release, numbered at merge time.
- The changelog names Stock Count in the words the screen uses. It says that posting follows the inventory-adjustment approval policy, and that companies tracking items adjust item by item instead.
- The Guide gains a "Count stock" flow: New count → paste or type the lines → Save draft → Adjust inventory.

## Amendments from pre-building (09–10/10)

The feature was built on a local pre-build branch.

- **Migrations live.** With the user's approval, 0138 went live on all six companies first, so the posting checks could run. 0139 followed after the provisioning self-check passed (17/17).
- **Verification script:** 168 of 168 checks pass. That covers structure in all six companies, plus the whole create / save / post / approve / reject / cancel suite on the sample company, inside rolled-back transactions.
- **Read-only live test:** 3 of 3 on all six companies.
- **Smoke on the sample company:** one count was posted for real, and a second count was left as a draft.

These points were settled along the way.

1. **Book value is base currency.** It sums `amount_base_minor`, signed by side, the way `acc_ledger_balances` does. The first draft summed debit minus credit in the line's own currency, which would be wrong for a foreign-currency line on an inventory account. The verification includes such a line.
2. **Grants.**
   - Both tables are SELECT-only for signed-in users. `insert`, `update`, `delete` and `truncate` are revoked from `authenticated` explicitly. Otherwise the database's default privileges in `public` leave RLS as the only barrier. Writes happen only through the RPCs.
   - The stamp and audit triggers sit on the header only. A 2,000-line save does not flood the audit log.
3. **Waiting for approval.**
   - The post RPC cannot set the count's status when its approval guard raises, because the raise rolls the change back. After a successful submit, the app calls `acc_mark_stock_count_pending(count, request)`.
   - That RPC refuses anything except a staff caller, a draft count, and a pending `inventory_adjustment` request whose payload names this count.
   - An AFTER UPDATE trigger on `acc_approval_request` returns the count to draft when the request is rejected **or cancelled**. `acc_reject_request` and `acc_cancel_request` are untouched.
4. **One open count at a time,** enforced by a partial unique index.
5. **More refusals on posting:** an unknown count, a count already posted, and an offset account equal to the inventory account.
6. **The paste reader.**
   - Fields are read from the right, so a name may contain commas.
   - Tab-separated text, which is what pasting from a spreadsheet gives, keeps grouped thousands safely.
   - In typed comma-separated text a thousands comma cannot be told from a column break. The reader refuses the detectable cases, and the hint says so: "Pasting from a spreadsheet keeps the columns apart; in typed text leave out thousands separators."
   - An unreadable line is reported by its number, and the box keeps only those lines so they can be corrected.
7. **Screens.**
   - Unsaved changes are guarded by a small hook (`lib/client/use-unsaved-guard.ts`).
   - The lines editor pages at 50 rows so 2,000 inputs stay usable. Print never pages.
   - The post action returns the entry number for "Posted as JE-…".
   - The posted stamp is shown in the company's time zone.
8. **One colour rule for the difference** (`differenceTone`), used in the stat row, the dialog and the list. A shortage is red. A surplus and zero use the normal text colour. List figures are plain text, and only the Count # is a link.
9. **Default offset in practice.** The sample company has no "Inventory Adjustment" account, so its count posted against 5090 Inventory Write-down. Purchases and Inventory then showed the count as a count adjustment, with the year still adding up.
