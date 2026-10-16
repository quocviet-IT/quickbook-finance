# An item that comes back can be worked on again (release 2.10)

## Why

This was found while checking 2.09 on the sample company (16/10). The fault dates from 0118.

- When an item's exception clears, its stored state is marked `resolved`. That happens through the retire, scoped to its page since 2.09.
- The work lists read only states that are not resolved. So when the same key comes back (a bank line unmatched again, a control failing again, a bill overdue again), the item shows as new.
- But `acc_set_work_item_state` refuses any change to a row whose lifecycle is `resolved`. It says "This item is already resolved; its exception has cleared".
- So an item that came back can never be acknowledged, started, assigned, dated or dismissed.
- On 16/10 only the sample company has stored states, so no real company is stuck.

## Part 1: reopen a resolved row (migration 0148)

- `create or replace` `acc_set_work_item_state`. The signature, the grants and every existing refusal stay the same, except one:
  - A row whose lifecycle is `resolved` is treated as no row. The screen never reads a resolved row, so it sends no version: a null `p_expected_version` means "I believe there is no row yet".
  - With a null `p_expected_version`, the row is reopened in place. It takes the new lifecycle, owner, due date and dismiss reason (the reason only when dismissed), and its version goes up by one. The new version is returned.
  - With a non-null `p_expected_version`, the change is refused as changed by someone else, as for any version mismatch.
  - The audit row is written as an `update`, with `reopened: true` in its `after_json`.
- `drop function if exists acc_retire_work_items(text[])`. Since 2.09, nothing in the app calls the one-argument retire. The 2.09 spec scheduled its removal for after 2.09 was live.
  - `scripts/verify-work-item-state.mjs` moves to the two-argument form.
- All other refusals keep their order and wording:
  - not staff;
  - empty key;
  - `resolved` by hand;
  - dismissing a blocking item;
  - dismissing without a reason;
  - an active row with a null or wrong version.

## Part 2: release notes

- Changelog 2.10, one fixed entry: an item that came back to a work list can be acknowledged, assigned, dated and dismissed again. It starts afresh, with no owner or due date from before.

## Tests

- **Migration test:**
  - the resolved branch reopens (no raise on resolved);
  - the null-version and non-null-version paths;
  - the grants are unchanged;
  - the one-argument retire is dropped;
  - the two-argument retire is untouched;
  - `search_path` and security definer.
- **Rolled-back verification script,** behaviour on the sample company only:
  - an active state is resolved by a scoped retire, then set again with a null version: it succeeds, the lifecycle is the new one, and the version goes up;
  - a resolved row set with a non-null version is refused;
  - an active row set with a null version is still refused;
  - dismissing the reopened item still needs a reason, and a blocking one still cannot be dismissed;
  - a viewer is refused;
  - the audit row says `reopened`.

  Other schemas: structure only (the function body, and the one-argument retire is gone).
- **Smoke on PC-Test:** the bank item that is stuck today (its state resolved by the old retire) can be dismissed and put back. Run it on the local build and, after release, on production.

## Not in this release

- OB-4, OB-8, OB-9.
- Time-of-day formatting without a zone on pages other than the five overview pages.
- The `/bill-payments` 404 on Purchases.
