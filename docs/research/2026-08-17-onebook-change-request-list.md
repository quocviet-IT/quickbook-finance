# OneBook Change Request List

## 1. Purpose and Scope

This document converts the user feedback stated in the review video into actionable requirements that can be assigned to the tech/dev team. The main scope is the **One Book > Banking > Bank Transactions** screen; some requirements were explicitly requested by the user to also apply to the **General Ledger report**. The **PaySched Manager > Payment History** screen is used only as a reference example for the layout of filters, checkboxes, batch actions, and the Delete button; it should not be assumed that the entire screen must be copied into OneBook.

> **Implementation principle:** Do not treat referenced content as a new requirement unless it was directly requested in the video. For points not defined in detail by the video, this document clearly marks them for Product/Tech confirmation before coding, in order to avoid unsupported assumptions.

## 2. Priority Summary

| ID | Group | Requirement | Priority | Area |
|---|---|---|---|---|
| RQ-01 | Interaction improvement | Drag and drop to change column order | P1 | Bank Transactions; consider applying to General Ledger if the same component is used |
| RQ-02 | Search improvement | Filter by keyword and amount | P1 | Bank Transactions and General Ledger report |
| RQ-03 | Interaction improvement | Select individual rows and select all for batch processing | P1 | Bank Transactions |
| RQ-04 | Bug | Selecting 100 rows/page still shows only 25 rows | P0 | Bank Transactions paginator |
| RQ-05 | Business workflow improvement | Assign Category and Account to multiple transactions at once | P1 | Bank Transactions; applied to selected rows |
| RQ-06 | Business workflow improvement | Allow users to delete duplicate imported transactions themselves | P1 | Bank Transactions |
| RQ-07 | UI reference | Use PaySched Payment History as a UX reference | P2 | Reference principle only, not an independent feature |

**P0** is a defect that directly breaks an existing operation and should be fixed first. **P1** is a user-requested improvement intended to speed up transaction processing. **P2** is a UI direction and should not be separated into its own feature if it is already covered by RQ-01 through RQ-06.

## 3. Detailed Requirements and Acceptance Criteria

### RQ-01 — Allow Drag-and-Drop Column Reordering

**Current context.** The user currently has to scroll to the bottom of the table, scroll horizontally left/right to view the amount, and then return to the top of the table to compare data. In the video, the table contains columns such as **Account source, Reference, Amount, Category, Match, Status**; in other states, Date and Description also appear. The user requested drag-and-drop behavior similar to Excel or Google Sheets.

**Requirement.** Add drag-and-drop capability on column headers so users can change the display order. This must not remove columns, data, horizontal scrolling, or any existing actions. At minimum, it must support the columns currently shown in Bank Transactions, including Date, Description, Account source, Reference, Amount, Category, Match, and Status when those columns are enabled in the same table.

**Acceptance criteria.** When the user drags the `Amount` header to a more visible position, the entire column's data must move with the column without any row-level misalignment. When wide columns such as Description are moved, horizontal scrolling must continue to work normally and must not hide or overlap other columns. After reordering columns, filtering, pagination, row selection, and batch actions must continue to work correctly. Whether the column order should persist across future logins or apply only to the current session must be confirmed by Product/Tech; the video does not require long-term persistence.

### RQ-02 — Add Keyword and Amount Filters

**Current context.** The user stated that there is no quick way to find a transaction by amount and wants a place to enter a keyword/amount. The user also requested this functionality in the General Ledger report.

**Minimum requirement.** In Bank Transactions, add a search/filter area that allows users to enter a **keyword** and an **amount**. The keyword search must search transaction information visible in the table, at minimum Description and Reference when those fields exist. The amount filter must allow transactions to be filtered by transaction amount. In the General Ledger report, add an equivalent filter or another method with the same capability to search by keyword and amount.

**Required behavior.** When filter conditions are entered, the list and the total result count must update correctly. When the conditions are cleared, the list must return to its unfiltered state. The filter must work correctly together with account, status, account posted to, and existing filters; it must not filter only the data currently rendered in the browser when the actual dataset spans multiple pages.

**Points to confirm before coding.** The video does not specify whether amount filtering should match an exact value, a range, or both. A safe UX recommendation is to support both an exact amount and a `Min amount` / `Max amount` range; if Product wants only a single input field, the input rules must be clearly defined. Vendor, expense, and company fields mentioned by the user while viewing PaySched are reference examples only; they should be added to Bank Transactions only if those fields actually exist in the data and Product confirms the requirement.

### RQ-03 — Select Individual Transactions and Select in Bulk

**Current context.** The user requested a selection/batch button for transactions in the paginator so that multiple rows can be processed instead of handling them one by one.

**Requirement.** Add a checkbox at the beginning of each row and a `Select all` checkbox in the table header. When one or more rows are selected, display a clear batch-action bar or button. The selection state must show how many transactions are selected and must not accidentally include rows that are no longer part of the filtered results.

**Default selection scope to avoid ambiguity.** For the initial implementation, `Select all` should apply to **all rows currently displayed on the current paginator page**, after filters have been applied. If users need to select all results across all pages, this must use a separate behavior such as `Select all results` with a clear result count; the video does not explicitly require cross-page selection.

**Acceptance criteria.** The user can select one row, deselect one row, select all rows on the current page, and deselect all. When changing pages or filters, the system must handle the selection state consistently and must not perform batch operations on records outside the scope currently visible to the user unless there is a clear confirmation message.

### RQ-04 — Fix the Paginator Page Size Bug

**Evidence from the video.** The table shows `157 records`, and the paginator is set to `25 / page`. The user selects `100 per page`, but the table still shows only 25 rows and identifies this as a report bug.

**Bug fix requirement.** When the user selects `100 / page`, the system must actually load and display up to 100 rows on the current page, or all remaining rows if the total number of records is less than 100. The selected value must be reflected correctly in both the dropdown and the pagination logic.

**Mandatory acceptance criteria.** Test the 25, 50, and 100 options in sequence if these options exist in the UI. The actual row count in the table must match the selected page size, the total record count must remain correct, the total number of pages must be recalculated correctly, and page navigation buttons must work according to the new page size. When data is filtered, the page size must still apply to the filtered result set. If changing the page size makes the current page invalid, the system must move the user to the nearest valid page instead of showing an empty page.

### RQ-05 — Assign Category and Account to Multiple Transactions

**Current context.** The user pointed to the PaySched example containing a batch button, `Set category`, and `Set an account`, and then stated that they want to categorize transactions quickly using filters and a batch button.

**Requirement.** For the transactions selected in RQ-03, add at least the following batch actions:

| Batch action | Expected result |
|---|---|
| Set Category | Assign the same selected Category to all selected transactions |
| Set Account | Assign the same selected Account to all selected transactions |

When a user performs a batch action, the system should display the number of records that will be changed and require confirmation before saving if the action cannot be undone. After the operation succeeds, the table must update the Category/Account values of the affected rows and display a result notification.

**Acceptance criteria.** Use a filter to narrow the list, select multiple rows, choose a new Category, and save; only the selected rows within the result scope must change. If one row cannot be updated, the system must not misleadingly report complete success; it must show the number of successful rows, the number of failed rows, and the reason for failure if available. Match/Status and unrelated fields must not change automatically.

**Point to confirm.** The video explicitly mentions `Set category` and `Set an account` on the reference screen, but it does not define business rules for transactions that have already been matched or posted to the General Ledger. Product/Accounting must confirm the update permissions for these states before batch actions are enabled in production.

### RQ-06 — Allow Users to Delete Duplicate Imported Transactions Themselves

**Current context.** The user described a situation where a transaction is imported twice and wants a Delete button so they can remove the duplicate themselves instead of asking a reviewer or admin to delete it.

**Requirement.** Add a clearly visible Delete action for imported transactions, at minimum at the individual-row level. This action must allow users with appropriate permissions to handle duplicate records directly in Bank Transactions. Delete permission must not be granted to unauthorized accounts.

**Acceptance criteria.** When Delete is clicked, the system must display information about the record that is about to be deleted and require confirmation; the record must not be deleted immediately due to an accidental click. After successful confirmation, the record must no longer appear in the current list, the total record count and paginator must be updated, and a result notification must be shown. If deletion fails, the data must remain unchanged and the user must receive a clear, understandable error message. The system should record the user, timestamp, and deleted record in the audit log if an audit log exists.

**Point to confirm before coding.** The video only requests the ability for users to delete records themselves; it does not specify hard delete versus soft delete. A safer implementation recommendation is soft delete or an undo/restore capability; Product/Accounting must confirm this because transactions that have already been matched or created a General Ledger entry may be subject to data constraints. If posted transactions cannot be deleted, the UI should hide or disable the Delete button with a specific reason instead of allowing an unclear failure.

## 4. Recommended Implementation Order

The dev team should fix **RQ-04** first because it is a clear defect in the current workflow. Next, implement **RQ-03** and **RQ-05** as a connected flow: the user filters the data, selects rows, and then assigns Category or Account in bulk. **RQ-02** should be completed before or in parallel with this flow so the user can find the correct group of transactions. **RQ-01** improves table readability and should be tested together with pagination/filtering to avoid layout regressions. **RQ-06** requires Product/Accounting to confirm the data rules before deletion permissions are enabled in a live environment.

## 5. Points That Must Not Be Assumed

| Topic | Confirmed by the video | Must not be assumed |
|---|---|---|
| Filters | Keyword and amount are required; they should also be added to the General Ledger report | Do not assume vendor/company/expense are mandatory in Bank Transactions unless the data and business requirement are confirmed |
| Bulk selection | A selection/batch button is needed for transactions in the paginator | Do not assume all pages should be selected unless `Select all results` is explicitly implemented |
| Data assignment | There is a need to assign Category quickly; Set Account is also referenced | Do not automatically change Match/Status or General Ledger data outside Category/Account |
| Delete | The user wants to delete duplicate imported transactions themselves | Do not choose hard delete by default; soft delete, undo, permissions, and handling of matched/posted transactions must be confirmed |
| Drag-and-drop columns | The user wants behavior similar to Excel/Google Sheets | Do not require permanent column-order persistence unless Product explicitly requests it |
| PaySched | It is a UX reference | Do not treat it as a requirement to rebuild Payment History or copy the entire UI |

## 6. Overall Acceptance Checklist

| Check | Expected result |
|---|---|
| Keyword/amount filter | Correct results and total row count; clearing the filter restores the list; works correctly across multiple pages |
| Row selection | Individual select/deselect and select-all for the current page stay within the correct scope |
| Batch Category/Account | Only selected rows change; success/failure results are clearly reported |
| Page size | Selecting 25/50/100 updates the actual row count, total page count, and navigation correctly |
| Drag-and-drop columns | Data remains aligned with the correct columns; horizontal scrolling still works; other actions are not broken |
| Delete duplicate import | Includes confirmation, permissions, list/paginator updates, and clear error handling |
| General Ledger report | Has equivalent filters within the scope confirmed by Product; does not corrupt transaction or journal-entry data |
| Regression | Does not affect account filter, status filter, account posted to, Find ledger matches, Import statement, or other existing actions |

## 7. Evidence from the Video

| Timestamp | Recorded content |
|---|---|
| 00:05–00:23 | Mentions Bank Transactions and General Ledger for each transaction in the report |
| 00:23–01:28 | Wants to drag/reorder columns to view total amounts more easily and avoid horizontal scrolling and returning to the top of the table |
| 01:28–01:43 | Wants a filter for entering keyword/amount |
| 01:43–02:01 | Wants the filter added to the General Ledger report and wants a selection/batch button |
| 02:05–02:20 | Selecting 100/page still shows only 25/page; confirms this is a bug |
| 02:20–03:01 | Uses PaySched as an example: search, batch button, Set Category, Set Account |
| 03:01–03:24 | Wants to categorize transactions quickly using filters and a batch button |
| 03:25–03:52 | Wants Delete so users can remove duplicate imported transactions themselves without needing an admin |

**The sole source of the requirements above is the OneBook review video provided by the user.** Recommendations regarding confirmation dialogs, permissions, audit logs, soft delete, and handling of matched/posted transactions are explicitly identified as safety requirements/technical points to confirm, not as verbatim statements from the user in the video.

## 8. Decisions on the Open Points (confirmed 2026-08-17)

The points sections 3 and 5 left for Product/Tech are settled below. One fact discovered while reading the code changes what two of these requirements are:

> **Setting a Category posts a journal entry.** `acc_categorise_bank_transaction` (migration 0111) writes to `acc_journal_entry` and `acc_journal_line`. Category is an account, not a label. So "Set Category on 100 selected rows" means posting up to 100 journal entries in one click, and deleting a categorized transaction means dealing with the entry it already created.

| Point | Decision |
|---|---|
| **RQ-05** — transactions already matched or posted | **Batch actions apply only to transactions not yet posted.** Rows that already carry a journal entry are skipped, and the screen states how many were skipped and why. Changing a posted row would mean reversing its entry and posting a new one; that is not what the video asked for, and it puts closed periods and reversal history into a bulk action. |
| **RQ-06** — hard delete vs soft delete | **Superseded — see the correction below.** |
| **RQ-02** — exact amount vs range | **Both.** An exact amount and a `Min amount` / `Max amount` range, as section 3 recommends. |
| **RQ-02** — vendor / expense / company fields | **Not added.** Section 5 says not to assume them; the video used them only while looking at PaySched. |
| **RQ-01** — column order persistence | **Current session only.** Section 5 says not to require permanent persistence. |
| **RQ-03** — selection scope | **Current page after filters**, per section 3. No cross-page `Select all results` for now. |

### Correction to RQ-06, 2026-08-17

The first decision here was "Delete applies only to transactions not yet posted." **That was decided without looking at the live data, and it was wrong for the person who asked.**

Pacific Four Nine holds **289 bank transactions, all with status `matched`** — every one has been categorized, and categorizing posts a journal entry (`acc_categorise_bank_transaction`, migration 0111). The existing Delete control renders only on an `unmatched` row, so it appears on **no row at all** in that company, and nothing on screen explains why. The user reported the feature as missing. They were right to: for their data it does not exist.

A two-step path does exist today — remove the category (which voids the entry and returns the row to `unmatched`), then delete — but nothing tells anyone that, and the user asked for a Delete button, not a procedure.

**Decision: give them the Delete button, on every row, and make it work.**

When the row carries a journal entry that can be voided, one confirmed action voids the entry and then deletes the row. This does not bypass the ledger: it composes `acc_uncategorise_bank_transaction` and `acc_delete_bank_transaction`, both of which already exist and both of which write audit records. The confirmation names both effects before anything happens.

Where the books genuinely refuse, the button says exactly why rather than hiding:

- the journal entry sits in a **closed period**, so it can no longer be voided
- the line was **settled against an invoice or bill**, or carries an **approved reconciliation**, which is a larger reversal than a delete and is not folded into this action

Those are refusals with a stated reason, not a hidden control.

### Sequencing note

Every one of RQ-01 through RQ-06 touches `app/(app)/banking/BankTransactionsTable.tsx`. They are therefore built and merged **in sequence**, not in parallel — concurrent branches on one file trade a little wall-clock for a lot of merge conflict. Order follows section 4: RQ-04, then RQ-02, then RQ-03 with RQ-05 as one connected flow, then RQ-06, then RQ-01.

## 9. Delivery Status (verified 2026-08-18)

Every requirement in this document is built. The table below records where each one lives and how it was checked. The evidence column names the file a reviewer should read, not the commit message — a commit subject asserts, a file demonstrates.

| ID | Status | Commit on `main` | Release | Read this to check it |
|---|---|---|---|---|
| RQ-01 | Done | `b530b60` | 1.28 | `components/ui/useColumnDrag.ts`, `components/ui/DraggableHeaderCell.tsx` |
| RQ-02 | Done | `3343ea0` | 1.24 | `lib/domain/transaction-filter.ts` — one module serving both Bank Transactions and the General Ledger |
| RQ-03 | Done | `ab70c53` | 1.26 | `pruneSelection` in `lib/domain/bank-transaction-batch.ts` |
| RQ-04 | Done | `cb3d5f2`, then `1e633dd` | 1.23, 1.25 | `app/(app)/banking/bank-transactions-pagination.ts`, `components/ui/table-pagination.ts` |
| RQ-05 | Done | `ab70c53` | 1.26 | `splitBatchEligibility` / `summarizeBatchResults` in `lib/domain/bank-transaction-batch.ts` |
| RQ-06 | Done, then corrected twice | `3d06b74`, then `922dbc7` | 1.27, 1.29 | `supabase/migrations/0114_delete_bank_transaction_with_void.sql` |
| RQ-07 | Not a feature | — | — | Covered by RQ-01…RQ-06, exactly as section 2 says it should be |

### The one acceptance criterion that was not met, and how it was closed

RQ-06 states: *"If deletion fails, the data must remain unchanged."* The version shipped on 2026-08-17 could not promise that, and said so in its own source comments.

Deleting a categorised line is **two writes** — void the journal entry the categorising posted, then remove the line. Those ran as two separate RPC calls from the server action, which is two database transactions. When the void committed and the delete was then refused — a closed period, a concurrent edit to the same row — the entry stayed voided and the line came back as `unmatched`. The books had moved after a delete that failed. The error message disclosed this and asked the reader to press Delete again. Disclosure is honest; it is not the acceptance criterion.

Migration `0114` closes it by composing the same two already-audited functions inside one `acc_delete_bank_transaction_with_void` — the shape `acc_delete_payment` (migration 0106) already uses for a customer receipt. One function is one transaction, so a refusal anywhere unwinds everything before it.

The new function carries **no copy** of the authorization check, the reason-length rule, the void, or the delete: each of those has exactly one home, and the two composed functions are it. It holds one rule of its own, because neither function beneath it can state it — a line settled against an invoice or bill carries an approved reconciliation with no journal line, and `acc_uncategorise_bank_transaction` would answer *"this line is not categorised"* about a line to which something has certainly happened.

On the application side, `deleteBankTransactionWithVoid` is now a single RPC call. The status read and the settlement probe it used to perform *between* the two writes — on a row that could change underneath them — are gone with the second call. The dialog's wording is unchanged: it already named both effects, and now they are genuinely one act.

### How it was verified

- `npm test` — 164 files, 1675 tests, all passing.
- `npm run typecheck`, `npm run build` — clean. `npm run lint` — 0 errors (11 pre-existing warnings, all in `scripts/*.mjs`).
- `scripts/smoke-pages.mjs` against the built server — 56 of 56 pages rendered.
- `npm run verify:company-provisioning` replayed all 114 migrations into a real Postgres schema with no SQL error, inside the transaction it always rolls back. Its completeness check still fails on `missing tables: acc_backup` — **a pre-existing failure, not this change.** Removing this migration and re-running gives the identical failure at 113 migrations. The cause is that the live database already carries the `feat/scheduled-backups` branch's migration while `main` does not.
- Tests were written before the code and watched to fail first: `tests/unit/delete-bank-line-migration.test.ts` (8 assertions on the migration's shape) and `tests/unit/bank-line-delete-service.test.ts` (4 on the service).

### Not yet applied — read before merging

Commit `922dbc7` sits on branch **`fix/atomic-bank-line-delete`**, cut from `main`. Migration `0114` has **not been applied to any database**.

**Do not merge this branch until `scripts/migrate.mjs` has run `0114`.** Merged first, the Delete button calls a database function that is not there, and every delete fails — the exact opposite of what RQ-06 asked for.

### Deliberately not built

These are recorded so a later reader does not mistake them for oversights.

| Item | Why not |
|---|---|
| Drag-and-drop columns on the General Ledger report | Section 2 lists this as *"consider applying to General Ledger if the same component is used"*, and section 8 never promoted it to a decision. The component is now shared (`components/ui/useColumnDrag.ts`), so it is a small piece of work whenever Product asks for it. |
| Vendor / expense / company fields in the Bank Transactions filter | Section 5 says not to assume them; the video used them only while looking at PaySched. |
| `Select all results` across every page | Section 8 fixed the selection scope at the current page after filters. |
| Batch Category/Account on rows already posted | Section 8: those rows are skipped, and the screen states how many and why. Changing them would mean bulk reversals against closed periods. |
