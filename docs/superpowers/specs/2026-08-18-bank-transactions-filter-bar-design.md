# Bank Transactions filter bar — design

Date: 2026-08-18

## Where this came from

A screenshot of the Bank Transactions filter bar, with two asks: lay it out
better, and suggest matches while someone types in the search box.

## What is wrong now

`.accounting-filter-bar` is one flex row, `justify-content: space-between`,
`align-items: center`. This screen puts **seven controls** in the left half
(account, status, posted-to, keyword, exact amount, min amount, max amount)
and a result count plus four buttons in the right half.

Three consequences, all visible in the report:

1. **Seven controls do not fit one row**, so they wrap into three ragged rows
   that break across unrelated groups — the search box ends up beside "posted
   to", and the three amount boxes are stranded on a row of their own with a
   large empty space to their right.
2. **`align-items: center` strands the result count.** The control block is
   three rows tall and the action block is one, so the actions are centred
   against them and "157 results" lands in the middle of row two, reading as
   though it belongs to the search box.
3. **Nothing is grouped.** Three different kinds of thing sit in one
   undifferentiated run: narrowing the *scope* (account, status, posted-to),
   *finding* within it (keyword, amount), and *acting* (four buttons).

The search box is also the narrowest control on the bar — squeezed to
`Search description or ref…` — and it is the one that needs the most room,
because it is about to grow a suggestion list.

## Decisions

| Question | Decision |
|---|---|
| What do suggestions offer? | Descriptions and references that actually exist in the current list |
| Layout | Two tiers: scope above, find below. Actions anchored top-right |
| The three amount boxes | Collapse into one `Amount` popover with a badge when active |
| Group labels ("Scope" / "Find") | No. Spacing separates the tiers; labels cost height and words on a screen used daily |

## Suggestions

`lib/domain/transaction-search.ts`, pure and tested directly.

```
buildSearchSuggestions(rows, keyword, limit) -> Suggestion[]
Suggestion = { value: string; field: "description" | "reference"; count: number }
```

**Which rows go in is the decision that matters.** They are the rows already
narrowed by the *scope* filters — account, status, posted-to — but not yet by
keyword or amount. Suggesting from the whole set would let someone pick a
suggestion and land on **zero results**, and a suggestion that leads nowhere
is worse than no suggestion at all.

Values are grouped, because many lines share a description, and each carries
the number of lines behind it. Ranking puts prefix matches above interior
matches, and within each, more lines first. At most eight. An empty box opens
no dropdown — dumping 157 values on someone who has typed nothing is noise.

## Layout

`components/ui/FilterBar.tsx` gains one **optional** prop, `secondary`, for the
second tier. Every existing caller omits it and is unaffected. `align-items`
changes so the action block anchors to the top of the bar instead of floating
against the middle of a tall wrapped control block.

`app/(app)/banking/BankTransactionsFilters.tsx` is new: the whole filter block
moves out of `BankingClient.tsx`, which is 1,139 lines. It owns the scope
selects, the search `AutoComplete`, and the amount popover.

## Testing

`tests/unit/transaction-search.test.ts` covers the ranking, the grouping, the
cap, and the empty case directly — no React, no Ant Design.

The layout is verified by screenshot against the built server, before and
after, on the company whose data produced the report. Nothing is committed
from those screenshots: that company is not a sample.

## Out of scope

Other screens' filter bars. The General Ledger has four controls and does not
have this problem; `FilterBar`'s existing behaviour is unchanged for all of
them.
