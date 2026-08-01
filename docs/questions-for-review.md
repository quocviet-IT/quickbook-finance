# One Book — questions that need an answer from you

Eight decisions have come up while working through the test round. None of them
can be settled by reading the code: each one is about how this business actually
works, or what it wants. Guessing at any of them means building the wrong thing.

They are grouped by who is best placed to answer. Write the answer under the
question with the date and who gave it — that record is what closes the item.

**Status at 2026-08-01.** Of the five reports still open, two are being built
now and need nothing from you: bulk invoice import, and the customer/vendor half
of the QuickBooks and Wave import. Three are waiting: both multi-company
requests need **Q2**, the AI request needs **Q8**, and the QuickBooks import
needs **Q7** before the rest of it can be scoped.

Working detail for each item — what was already built, what was deliberately not
built — is in [system-test-user-feedback.md](system-test-user-feedback.md).

---

## For the accountant

### Q1 — Should cash on hand appear in the Banking screen?

You reported that adding a bank account offered "Cash on Hand" as the ledger
account, and that it should have been a bank account. That is fixed: the screen
now asks what kind of account it is, only offers ledger accounts that could be
one, and never offers cash on hand. The database refuses the link even if
something tries another way.

The reason cash on hand is excluded is that Banking is a screen for matching a
bank statement, and physical cash has no statement.

**The question:** does the business count a till or petty cash on a schedule,
and would you want to do that in Banking?

- **No** — nothing to do. Cash stays where it is, adjusted by journal entry.
- **Yes** — that is a different screen, not a loosening of this one: a cash
  count sheet, a counted-versus-book difference, and a posting for the variance.
  Worth building properly if you do it monthly.

**Answer:**

---

### Q3 — Which states do you collect sales tax in, and at what rate?

Tax codes and jurisdictions are built. Customers carry a state, and the invoice
screen will suggest the right rate as soon as one exists for that state. What is
deliberately **not** in the system is the rates themselves.

They were left out on purpose. A state rate is only part of what gets charged —
county, city and district rates add on top — and every one of them changes on
its own schedule. A rate the software invented would be wrong somewhere and
nobody would know until an audit.

**The question:** which states is the business registered to collect in, and
what combined rate applies in each? A list is enough:

| State | Combined rate | Notes (county/city included?) |
|---|---|---|
| | | |

**Answer:**

---

### Q4 — What happened to invoice numbers 7, 8 and 15–20?

The sequence report flags eight numbers that were issued by the system but that
no invoice holds. Numbers 22–27 are accounted for — end-to-end test runs used
and released them, and that is recorded. These eight went missing before the
numbering controls existed, and nothing in the database says why.

This is the kind of gap an auditor asks about, so it stays flagged until there
is an explanation on file.

**The question:** does anyone remember — a data import, a clean-up, a batch that
was cancelled, invoices printed and voided? Any answer, even "we were testing in
January", gets recorded against those numbers and closes the exception.

**Answer:**

---

### Q7 — Which QuickBooks and Wave files do you actually have?

The request was to upload a "BACKUP file CSV" from QuickBooks and Wave. Those
are two different kinds of file and only one can be imported:

- A QuickBooks **backup** (`.QBB`) is a sealed file only QuickBooks Desktop can
  open. No other program can read it. If that is what you have, it has to be
  restored in QuickBooks first and the lists exported from there.
- A **CSV export** — one file per list, or per report — can be imported here.

**Question 1: which do you have?** If it is CSV, a sample file of each kind
answers more than a conversation would.

**Question 2: how much should come across?**

- **Master data plus opening balances** — customers, vendors, chart of accounts,
  items, and each account's balance at a chosen cut-over date. This is the
  normal way to move accounting systems, and it is contained work.
- **Every historical transaction** — a much bigger job. Each past invoice, bill
  and payment has to be recreated as a journal entry, some dated into periods
  that are now closed; document numbers have to be reconciled against the
  sequences this system controls; and tax codes that do not exist here have to
  be mapped to ones that do.

Most migrations take the first option and keep the old system read-only for
history. If you need the second, say so early — it changes the plan.

**Answer:**

---

## For the business owner

### Q2 — Ten companies: separate books, or one system holding all of them?

Two reports asked for clean per-company reporting — fixed assets by company, and
financial statements that are not mixed together. Both come down to one
decision, and it is the largest open question here.

- **A workspace per company.** Each company gets its own installation and its
  own database. Absolute separation — one company's data cannot appear in
  another's report because it is not there. Set up in a few hours per company.
  The cost: ten separate logins, and no report that spans companies.
- **One system, all ten companies inside it.** One login, per-company reports,
  and a group view across all of them. The cost: several weeks of work touching
  every place money is recorded, and from then on every report depends on a
  filter being right. A mistake shows up as one company's figures appearing in
  another's accounts.

**The question:** does anyone need a **consolidated** view — a group balance
sheet, one login across all companies, or customers and items shared between
them?

- **No** → separate workspaces. Recommended: it is faster, and it cannot leak.
- **Yes** → the larger build, and it is worth planning properly rather than
  starting.

**Answer:**

---

### Q5 — Should going over a credit limit need approval, or just permission?

Credit limits and terms are live on all twelve customers. Today, issuing an
invoice that would take a customer past their limit requires the credit-override
permission — administrators hold it — and a written reason that is kept in the
audit log.

**The question:** should it instead wait for a **second person to approve**,
using the approval queue that already exists elsewhere in the system?

- **Permission (today)** — faster; one trusted person can act alone, and every
  override is on record.
- **Approval** — stronger control, slower; nothing over the limit goes out until
  someone else signs it off.

This is a policy choice about how much the business wants to slow itself down,
not a technical one. Either can be built.

**Answer:**

---

### Q6 — Should files attached to feedback be virus-scanned?

Staff can now attach screenshots and PDFs when reporting a problem. Accounting
documents already go through virus scanning; these attachments do not. They are
readable only by staff with the right permission, through links that expire, and
they are never executed.

**The question:** does the business want the same scanning applied here? It is
worth doing and it is its own piece of work.

**Answer:**

---

### Q8 — "Can we add Claude AI" — to do what?

Worth knowing before answering: **the system already has an AI assistant.** The
"Ask AI" button opens a panel that answers questions about how One Book works
and the accounting behind it, grounded in the product's own manual. It runs on
Google's Gemini model today.

So the useful question is what is missing.

| What you might want | What it would take |
|---|---|
| The same assistant, running on Claude instead of Gemini | Small — a change of provider. It would answer better; it would not do anything new. |
| An assistant that can answer questions **about your own numbers** — "why is the bank out by 162.38?", "which customers are over their limit?" | Substantial. It would need read access to the books, with the same permissions people have, and every question logged. It must never state a figure it did not read from the ledger. |
| Reading a supplier's invoice PDF and filling in the bill for you | Substantial, and probably the most valuable of the three. A person still checks and confirms every field before anything posts. |
| The AI creating and posting journal entries by itself | **This one would not be built as asked.** Drafting an entry for a person to approve is fine. An AI posting to the ledger with nobody looking is not, regardless of which AI it is. |

**The question:** which of these — or something else?

**Answer:**

---

## Answered

Move a question here once it is settled, with the answer, the date, and who gave
it. Nothing has been answered yet.
