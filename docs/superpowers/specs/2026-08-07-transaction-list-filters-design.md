# Filtering the transaction list

Date: 2026-08-07

## Where this came from

Feedback filed 2026-08-06 from `/reports/transactions`:

> Can we add a filter? Like filter it by vendor, filter it by account, something
> like that for easily checking and review

And, from the person asking for the fix, translated from Vietnamese:

> Remember to fix it for every company — it has to keep working for a company
> the user creates later too, not just for one company.

Which is to say: whatever this touches must work in every company that exists
now *and* in every company created later, not only in the first one. The
original is kept because a request is evidence of what was actually asked:
*"nhớ là fix ở tất cả công ty, làm sau mà khi người dùng tạo công ty vẫn có thể
sử dụng, chứ không phải ở mỗi 1 công ty"*.

## What exists today

`/reports/transactions` fetches every posted entry in a date range through
`acc_transaction_list(p_from, p_to)` and filters *reconciled* in the browser.
The date range is a server round trip because the range is what the query is.

Each row carries `category_label` and `money_label`: the name of the account
that side of the entry touched, or the literal `— Split —` when it touched more
than one.

## The trap in the obvious implementation

Filtering by account against those labels would be wrong in the worst way. An
entry that touches four accounts is labelled `— Split —`, so a bookkeeper
reviewing "everything that hit 6010 Bank Service Charges" would get a list that
silently omits every split entry touching 6010. A filter that hides matching
transactions is worse than no filter: it is trusted.

So the account filter has to match **any line of the entry**, which the row as
returned today cannot answer.

## Goal

Someone reviewing a month can narrow the list by vendor or customer, by account,
by document type, by free text, and by reconciled state, and see the totals and
the export follow what they narrowed it to.

## Not in scope

- **No new report.** This is the existing one, filtered.
- **No saved filter sets.** Ask again if people start wanting them.
- **No server round trip per filter.** The rows for the range are already in the
  browser; only the range itself remains a query.

## Architecture

### Migration `0105` — one more column

`acc_transaction_list` gains `account_ids uuid[]`: the distinct accounts every
line of that entry touched. Nothing else about the function changes — same
parameters, same rows, same order.

Ids rather than names, because account names are not unique: `co_pc_49` holds
both `1000 Cash on Hand` and `140 Cash on Hand`. Names would merge two accounts
into one filter entry and quietly report the wrong set.

**How this reaches every company.** A migration is replayed into each schema by
`scripts/migrate.mjs`, and a company created later is built by
`planCompanySchema`, which replays the whole migration folder into the new
schema. Both paths are exercised: the harness runs the function in a real
company, and a unit test plans a fresh probe schema and asserts the statement is
in it. This is asserted rather than assumed, because the request was explicit.

### The filter itself — `lib/domain/transaction-list.ts`

A pure function, so the behaviour that matters can be tested with concrete rows
rather than clicked at:

```ts
export interface TransactionListFilter {
  party: string | null;      // exact party name, or "" for rows with none
  accountId: string | null;
  sourceType: string | null;
  reconciled: "all" | "yes" | "no";
  search: string;            // description, entry number, party, labels
}

export function filterTransactionList(
  rows: TransactionListRow[],
  filter: TransactionListFilter,
): TransactionListRow[];

/** The choices to offer, taken from the rows on screen. */
export function transactionListChoices(rows: TransactionListRow[]): {
  parties: string[];
  accountIds: string[];
  sourceTypes: string[];
};
```

`TransactionListRow` gains `accountIds: string[]`.

Offering only the values present in the range is deliberate: a dropdown of the
whole chart of accounts makes the reader hunt for the entry that has anything in
it, and picking one that is not there produces an empty table that looks like a
fault.

### The screen

Filters are instant — they narrow rows already fetched. Only the date range
keeps its Apply button, because only the range changes the query.

The five figures across the top and the export both read the filtered rows. An
export that does not match what is on screen is how a report stops being
believed. A **Clear filters** button appears once anything is set, beside a
count that says how many of how many are showing.

### Files

| File | Responsibility |
| --- | --- |
| `supabase/migrations/0105_transaction_list_accounts.sql` | Create. `account_ids` on the report function. |
| `lib/domain/transaction-list.ts` | Modify. `accountIds` on the row; the filter and the choices. |
| `lib/services/reports.ts` | Modify. Read the new column. |
| `app/(app)/reports/transactions/page.tsx` | Modify. Load the chart for account labels. |
| `app/(app)/reports/transactions/TransactionListClient.tsx` | Modify. The controls, the totals, the export. |
| `scripts/verify-transaction-filters.mjs` | Create. Rollback-only proof against real books. |

### Testing

**Unit — `tests/unit/transaction-list-filter.test.ts`.** The one that matters
first: a split entry touching the filtered account is kept, even though its
label says `— Split —`. Then: party matches exactly and "no party" is its own
choice; source type; search is case-insensitive across description, entry
number, party and labels; reconciled unchanged; filters combine; an empty filter
returns everything; choices are unique, sorted, and taken only from the rows
given.

**Migration — `tests/unit/transaction-list-accounts-migration.test.ts`.** The
function returns `account_ids`, still takes two parameters, and the statement
survives `planCompanySchema` into a probe schema — the assertion that a company
created tomorrow gets it.

**Behavioural — `scripts/verify-transaction-filters.mjs`.** Rollback-only: apply
0105, post a two-account entry and a four-account split into a real company, and
assert both appear with the accounts they actually touched, so the filter has
something true to work from.

**Gates.** `npm test`, `npm run typecheck`, `npm run lint`,
`npm run security:check-source`, `npm run build`, `scripts/smoke-pages.mjs`.
