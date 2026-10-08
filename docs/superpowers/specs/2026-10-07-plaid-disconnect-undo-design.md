# 1.86 — Disconnect a bank feed; undo a bank-feed sync

**Status:** design approved by the user, 2026-10-07.
**Builds on:** 0045 (direct bank feeds through Plaid), 0109 (undo a statement import, delete one bank line), the daily feed sync (`/api/bank-feeds/sync`, 11:00 UTC).

## 1. The problems

1. **A bank connection cannot be disconnected.** `acc_bank_connection.status` allows `disconnected`, and a sync already refuses a disconnected connection, but nothing sets it. A connection whose sync failed stays `attention_required` for good, and its bank account cannot be connected again: `acc_bank_feed_account` is unique on `bank_account_id`, active or not.
2. **A bank-feed sync cannot be undone.** A statement import can be undone as a whole since 0109; lines a Plaid sync brought in can only be deleted one by one. Nothing records which lines a sync added, or which lines it retired (a modified transaction retires its old revision and inserts a new one; a removed one is retired), so a sync cannot be taken back.

Today no company has a bank connection (all six schemas: no connection, no feed line). Plaid's keys live only on Vercel (marked Sensitive), so the local live check uses a simulated connection.

## 2. Decisions taken by the user

1. **Undo removes for good.** The sync cursor is not rewound: Bank Transactions goes back to how it was before that sync, and the next sync does not bring the lines back. To fetch them again (for example into the right account after a wrong mapping), disconnect and connect again: a new connection syncs the whole history. A pending line may come back when the bank posts it, because Plaid sends the posted one as a new transaction.
2. **Only a person's decision locks an undo.** A sync cannot be undone while a line it added has been approved against a book line, coded to an account, or ignored (status not `unmatched`, or an approved match). Unapproved suggestions are removed with their lines. The statement-import undo keeps its rule unchanged.
3. **Disconnect removes the connection at Plaid first.** If Plaid answers that the connection is already gone, that counts as removed. If Plaid cannot be reached, or OneBook has no Plaid keys, Disconnect is refused unless the person ticks **Disconnect in OneBook only**.

## 3. Recording what a sync did

**Migration 0137** adds `acc_bank_feed_sync_change`:

| column | meaning |
|---|---|
| `id` | uuid primary key |
| `run_id` | the sync run (`acc_bank_feed_sync_run`, on delete cascade) |
| `bank_transaction_id` | the bank line (`acc_bank_transaction`, on delete cascade) |
| `kind` | `added` (the run inserted it) or `retired` (the run set its `provider_removed_at`) |
| `prior_status` | for `retired`: the line's status before the run retired it; null for `added` |

`acc_apply_bank_feed_page` gains `p_run_id uuid` (the old signature is dropped) and writes one change row for every line it inserts and every line it retires. The run must belong to the connection and still be `running`. The service passes the run id it already holds. Read access follows the other feed tables (staff); writes only through the functions. The table joins the company export after `acc_bank_feed_sync_run` and `acc_bank_transaction`.

`acc_bank_feed_sync_run.status` gains `undone`, with `undone_by`, `undone_at` and `undo_reason`.

## 4. Undoing a sync

**`acc_undo_bank_feed_sync(p_run_id uuid, p_reason text) returns jsonb`**:
- refuses unless the caller may manage bank feeds (`acc_bank_feed_authorized()`, as every feed function) and gives a reason;
- refuses a run that is `running` or already `undone`;
- only the connection's **newest run that changed something** (at least one change row) and is not undone can be undone — runs are taken back newest first, so a later run that modified a line an earlier run added is always undone before it;
- refuses, naming how many, when a line the run added is no longer `unmatched` or has an approved match ("N lines of this sync have been matched, coded or ignored — unmatch them first");
- otherwise, in one transaction: deletes the lines the run added (their suggestions go with them), restores the lines it retired (`provider_removed_at` back to null, status back to `prior_status`), marks the run `undone`, writes one audit line with the counts and the reason; returns `{removed, restored}`.
The cursor is not touched. Undo works on a disconnected connection too.

**`acc_bank_feed_syncs(p_bank_account_id uuid)`** lists, newest first, every run of every connection that ever fed that bank account (active or not, so a disconnected connection's runs stay in reach): started and completed times, status, the added/modified/removed counts, the error message, and two answers the screen needs — `undoable` (it is the newest run with changes, not undone, not running) and `locked_lines` (the count the undo would refuse on). One place decides, so the button and the function cannot disagree.

## 5. Disconnecting

**`acc_disconnect_bank_connection(p_connection_id uuid, p_reason text, p_note text) returns void`**:
- refuses unless `acc_bank_feed_authorized()` and a reason is given; refuses a connection already disconnected;
- sets the connection `disconnected` and `last_error` to `p_note` (null when Plaid confirmed; "Disconnected in OneBook only: Plaid did not confirm the removal (<reason>)" otherwise); deletes its encrypted token; sets its feed accounts `is_active = false`; writes an audit line with the reason;
- keeps every bank line the connection brought in.

`acc_bank_feed_account`'s `unique (bank_account_id)` becomes a unique index on `bank_account_id` where `is_active`, so the bank account can be connected again.

`acc_finish_bank_feed_sync` no longer turns a disconnected connection back to `active` or `attention_required`: a sync that was running when the connection was disconnected records its run and leaves the connection disconnected.

**On the server**, `disconnectBankConnection(sb, connectionId, reason, onlyInOneBook)`:
1. reads and decrypts the token and calls Plaid `/item/remove`;
2. Plaid answers success, or an error saying the item is already gone (`ITEM_NOT_FOUND`, `INVALID_ACCESS_TOKEN`) → disconnect with no note;
3. Plaid cannot be reached, answers another error, OneBook has no Plaid keys, or the token cannot be read → refuse with "Plaid did not confirm the removal: <reason>. Try again, or tick Disconnect in OneBook only." — unless `onlyInOneBook`, then disconnect with the note.

## 6. On the screen (Banking)

- **The connection card** gains **Disconnect** (staff with `bank_feed.manage`). A dialog says what happens ("Plaid stops sending this bank's transactions. The lines already here stay. You can connect the bank again.") and asks a reason. After a refusal, the dialog shows the reason and the checkbox **Disconnect in OneBook only**. Once disconnected, the card reads "No direct feed for this account" again and offers Connect bank.
- **Bank feed syncs**, below the card, for the selected account, whenever it has any run: when, status (Succeeded / Failed / Undone / Running), added / changed / removed, and **Undo**. Undo is enabled only on the undoable run; otherwise its tooltip says why ("Undo the newer syncs first", "N lines have been matched, coded or ignored", "Undone"). The Undo dialog asks a reason, says the lines will not come back with the next sync, and after it the table and Bank Transactions refresh.

## 7. Testing

- **SQL verify script** on all six companies, rolled back: a simulated connection, two runs (one adding lines, one modifying and removing some); undo refused on the older run, on a run with a coded line, without a reason, by a viewer; undo of the newer run restores the retired lines with their status and deletes its lines and their suggestions; then the older run undoes; disconnect frees the bank account for a new mapping, deletes the token, keeps the lines; a sync finishing after the disconnect leaves it disconnected; anon cannot call the new functions; `acc_apply_bank_feed_page` records its changes.
- **Unit:** the Plaid removal outcome (removed / already gone / unconfirmed / not configured); the service paths with a fake client and a fake fetch; the syncs list mapping; the screen contracts (Disconnect dialog and checkbox, Undo enabled only when undoable).
- **Whole suite:** typecheck, lint, unit tests, build, bundle budget.
- **Live check on PC-Test** with a simulated connection (no Plaid keys locally): a connection and two syncs written through the same functions the service uses; undo refused on the older, done on the newer, then the older; Disconnect refused for want of Plaid, then done in OneBook only; Connect bank offered again. Screenshots light and dark, approved by the user before the push.
- **Release:** changelog 1.86; guide steps for disconnecting and undoing a sync.

## 8. Out of scope

- Rewinding the sync cursor; re-fetching undone lines without reconnecting.
- Changing a connection's account mapping in place (disconnect and connect again).
- Changing the statement-import undo's rule on suggestions.
- Testing against Plaid itself before the production check after merge.
