# A dismissal stays dismissed, and the clock agrees (release 2.09)

## Why

Two faults on every overview page with a work list were found while checking 2.08 (16/10). Both predate it.

1. **A dismissal is lost when another overview page opens.** `acc_retire_work_items(p_live_keys)` (0118) marks as resolved every stored state whose key is not in the caller's live list. Each page calls it with only its own keys, so opening Sales resolves Banking's dismissals, and the reverse. Checked on the sample company: a dismissed possible duplicate came back after Sales was opened. This defeats OB-6's "dismissing one stops it being offered again", and the same is true for every dismissal, assignment and due date on all five pages.
2. **React error #418 on every overview page.** The "Computed at" time is formatted with `toLocaleTimeString` and no time zone. The server (UTC) and the browser (local time) print different times, so hydration fails.

## Part 1: a retire scoped to the caller (migration 0147)

- New overload `acc_retire_work_items(p_live_keys text[], p_prefixes text[]) returns int`. It resolves an active state only when its key starts with one of `p_prefixes` and is not in `p_live_keys`.
  - An empty or null `p_prefixes` resolves nothing.
  - SECURITY DEFINER, `search_path` pinned, the same role check as the one-argument version.
  - Revoked from `public` and `anon`; granted to `authenticated` and `service_role`.
- The one-argument version stays as it is in this release, so the running app keeps working between the migration and the deploy. Dropping it is later work, once 2.09 is live.

## Part 2: each page names what it owns

Each area exports its key prefixes next to the functions that build its keys:

| Page | Prefixes |
|---|---|
| Accounting | `control:` `period:` `recurring:` |
| Banking | `bank-txn:` `bank-feed:` `bank-recon:` `dupe-charge:` |
| Sales | `ar-overdue:` `ar-unapplied:` `ar-draft:` |
| Purchases | `ap-bill:` `ap-rnb:` `ap-unapplied:` |
| Inventory | `inv-negative:` `inv-depreciation:` |

- Each page's retire passes its own prefixes to the new overload.
- Banking keeps its 2.08 guard: when the duplicates read fails, the stored `dupe-charge:` keys are kept.
- **Tests:**
  - every key builder's output starts with its own area's prefix;
  - the five prefix lists do not overlap;
  - each surface passes its prefixes to retire.

## Part 3: the time in the company's time zone

- "Computed at" (and any other time printed by the shared work-surface notes) is formatted in the company's time zone, the zone the page's "As of" line already shows. The server and the browser then print the same thing.
- Tests:
  - the formatter given a time zone prints the same text whatever the machine's zone (run the test with `TZ` set differently);
  - no work-surface component formats a time without a zone.

## Tests and release

- **Migration test:**
  - the overload's grants, security definer, search path and role check;
  - the one-argument version is untouched.
- **Rolled-back verification script,** behaviour on the sample company only:
  - states keyed for two pages;
  - a scoped retire for one page leaves the other page's states alone;
  - it still resolves its own stale keys;
  - empty prefixes resolve nothing;
  - a viewer may call it, an outsider may not.

  Other schemas: structure only.
- **Smoke on PC-Test:**
  - dismiss an item on the Banking overview, open Sales, Purchases, Inventory and Accounting, come back, and the item is still dismissed;
  - no #418 in the console.

  Run against the local build and, after release, on production.
- **Release:** changelog 2.09. Migration 0147 goes live only with the user's approval, and before the deploy.

## Not in this release

- Dropping the one-argument function.
- OB-4, OB-8, OB-9.
