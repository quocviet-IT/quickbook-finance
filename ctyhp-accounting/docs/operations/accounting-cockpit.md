# The accounting screen, explained

For accountants using `/accounting`, and for whoever answers their questions.

The screen answers one thing: **what needs doing, and whether the books are safe
to close.** Everything on it is computed from the ledger at the moment you load
the page — nothing is typed in by hand, and nothing is remembered from
yesterday.

---

## Why work appears in the order it does

The list under **Priority work** is not sorted by date, and not by amount. It is
sorted by four things, in this order:

1. **Blocking first.** An item is blocking only when a hard control has failed —
   something that would stop the period from closing. Advisory items never jump
   the queue, however alarming they look.
2. **Severity.** Critical, then high, then medium, then low.
3. **Age.** The oldest of equal severity comes first.
4. **Amount**, and only as a tie-breaker between two otherwise identical items.

Money is deliberately last. It is what an exception *costs*, not what makes it
*urgent* — a small invoice 200 days overdue is a worse problem than a large one
raised last week. An item with no amount at all sorts below one with an amount,
never above it.

**Two orderings the design asked for are not in place yet:** an SLA breach and a
materiality threshold, which would sit between severity and age. They need a due
date the ordering function is not currently given. Until then, an item that has
breached its SLA is ranked on severity like any other.

---

## What "Control health" means

Each control answers one question about the ledger, and each one tells you the
test it applies — the line beginning *"Passes when…"*. There is no partial
credit: a control has passed, or it needs attention.

| State | What it means | What to do |
|---|---|---|
| **Passed** | The test held at the moment the page was computed. | Nothing. |
| **Needs attention** | The test did not hold. | Read the sentence under it: it names the figure, not just the failure. |

A control that needs attention is not always a mistake. "7 periods still open
after the last day covered" means nobody has closed them yet, which is a
decision, not an error.

---

## Why some insights say they cannot run

Under **What changed and why** you may see a grey panel: *"2 rule(s) cannot run
yet."*

Some rules need a number that only your company can decide — how many days an
approval may wait, how long a bank line may stay unmatched. Without that number
a rule has nothing to measure against, so it says nothing rather than inventing
a threshold nobody chose.

**To switch them on:** Settings → Work policy, and set the days. The rules start
reporting on the next page load. The two rules waiting on this today are:

- `approval-beyond-sla.v1` — needs *days an approval may wait*
- `bank-unmatched-beyond-age.v1` — needs *days a bank line may stay unmatched*

A rule that silently never fires is worse than no rule: the screen looks
complete and is not. That is why they announce themselves.

---

## When the figures are out of date

Every panel carries a **"Computed at…"** line at the bottom. Figures are
considered stale **ten minutes** after they were computed, judged against your
own clock — a page left open over lunch is stale even though nothing about it
changed.

Stale is shown separately from these three, which are never merged into one
another:

- **Loading** — the figures are on their way.
- **Healthy empty** — the check ran and found nothing wrong. Good news.
- **No data** — there is nothing to check yet. Not the same as good news.
- **Unavailable** — the check could not run. Not the same as passing.

Reload the page to recompute. Nothing on this screen refreshes itself.

---

## Setting a piece of work aside

Any item can be moved through: new → acknowledged → in progress → resolved, or
dismissed at any point.

**Dismissing requires a reason.** It is stored with the item and shown in the
*Dismissed* filter, because a queue that people can silently empty is a queue
nobody can trust.

**A blocking item cannot be dismissed at all.** If a hard control failed, the
system will not let you wave it away: fix it, or change what the control blocks.
The refusal names what is being blocked.

Resolution follows the source. An invoice marked resolved here does not become
paid — resolving reflects that the underlying document changed, it does not
change it.

---

## Period close mode

The **Period close** link at the top switches the screen to the oldest period
still open. It shows a checklist of the controls that period must satisfy, each
one with the figures behind it, and a percentage that counts only the steps that
apply to your company.

A step marked **Not applicable** is not a gap — it means the company has nothing
of that kind to tie out. Steps still **Outstanding** are what stops the close,
and they are listed first.

**Close this period** is only worth pressing when the outstanding steps are
gone. Closing with steps outstanding is possible and is sometimes right, but the
checklist is the record of what was known at the time.

---

## Common questions

**"The numbers differ from a report I ran an hour ago."**
Check the *Computed at* line. This screen does not refresh itself.

**"An item disappeared from the queue."**
It was resolved or dismissed. The *Dismissed* filter shows dismissals with their
reasons; resolved items follow the state of the document behind them.

**"Why is a large overdue invoice below a small one?"**
Age beats amount. See the ordering above.

**"A control says Passed but I know something is wrong."**
Read its *"Passes when…"* line — it states exactly what was tested. If the test
is right and the answer is wrong, that is a defect worth reporting; if the test
does not cover your case, that is a gap worth reporting. They are different
problems.
