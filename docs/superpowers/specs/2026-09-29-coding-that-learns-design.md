# Coding that learns: bank rules and suggestions from history

**Status:** approved in conversation, 2026-09-29.
**Branch:** `feat/coding-that-learns` (from `main` at 1.68).
**Release:** 1.69.
**Source:** the client's prototype, `Accounting-System-v3.html`: "What's new" 2.7 and 2.4, the `coding that learns` block, and `ruleMatch` / `cleanPayee` in the bank statement import.

## 1. What is asked

The prototype says:

> Coding that learns. A name you have coded to the same account before is suggested there again — on the bank import, and on every entry waiting to be coded. It needs at least two past entries and a clear majority, and it says why: Coded to Rent 11 of the last 11 times.
>
> The Transactions tab offers to code every match at once. Rules you write still come first; history only speaks when nothing else did.

It also says, in 2.4: "Rules take an amount range".

## 2. Scope, as decided

The user decided three things:

- **Rules and history in one release.** Rules come first, and history speaks only when no rule matched.
- **Suggest only.** Nothing is posted without a person. A suggestion is used one line at a time, or with "Code all", after a confirmation that lists every line.
- **Rules are written by people.** Banking › Rules is where they are kept. A "Create rule" shortcut on a bank line fills in the form. A new company starts with no rules.

The work covers **bank lines waiting to be coded** (`acc_bank_transaction.status = 'unmatched'`).

Out of scope:

- re-coding entries already posted to an Uncategorized account;
- starter rules;
- learning across companies;
- rules that set anything other than the account.

## 3. How it works

### 3.1 The order for one waiting line

1. **An existing match wins.** If the line already has a match suggestion to a ledger line (a row in `acc_reconciliation`), no coding suggestion is shown. `acc_categorise_bank_transaction` refuses such a line anyway, because coding it would post a second entry for money already in the books.
2. **Rules.** Active rules are tried in their order, and the first one that matches wins.
3. **History.** If no rule matched, history is tried.
4. **Nothing.** The Category picker stays empty, as today.

### 3.2 Rules

A rule has these fields:

| Field | Meaning |
|---|---|
| `position` | The order rules are tried in; the lowest runs first. |
| `match_kind` | `words` or `regex`. |
| `match_text` | 1–200 characters. |
| `direction` | `in`, `out` or `any`. Money in is a positive `amount_minor`. |
| `min_minor`, `max_minor` | An optional window on the absolute amount; both ends are inclusive, and either may be blank. |
| `account_id` | The account the line is coded to. |
| `is_active` | Whether the rule is tried at all. |

How a rule matches, following the prototype's `ruleMatch`:

- **`words`** matches as a case-insensitive literal. It is anchored at a word boundary wherever it starts or ends with a word character, so "fee" matches "Wire fee" but not "coffee".
- **`regex`** is a case-insensitive JavaScript regular expression. It is checked when the rule is saved, and a pattern that does not compile is refused.
- **Direction** must agree unless the rule says `any`.
- **The amount window** is tested on `|amount_minor|`.
- **The target** must be an active posting account. It cannot be accounts receivable or accounts payable: money from a customer or to a supplier is settled against a document, not coded.
  - A rule whose account later becomes inactive stops suggesting.
  - Banking › Rules says why.

### 3.3 History

**Which entries teach.** A posted entry teaches when all of these hold:

- it has exactly **one line on a bank-type account** and **one other line**;
- the other account is active and posting;
- the other account is not accounts receivable or accounts payable;
- the other account is not a holding account (name matching `/uncategori[sz]ed|suspense/i`).

Transfers between two bank accounts, split entries and anything still in Uncategorized teach nothing.

**Direction.** It is `in` when the bank line is a debit, and `out` otherwise.

**Texts.** The texts an entry is known by are:

- the description of the bank line matched to its bank leg (via `acc_reconciliation.journal_line_id`), when there is one;
- the entry's description;
- the other line's memo.

A ledger imported as journal entries has no bank lines, so its descriptions ("payee — narration") are what teach.

**Keys.** Keys are built exactly as the prototype builds them:

- **Clean:** squeeze spaces; drop one leading `ach|pos|debit|credit|card|purchase|payment|dep|withdrawal`; drop runs of six or more digits; trim; keep the first 48 characters.
- **Words:** lower-case the cleaned text; replace everything that is not `a–z` or a space with a space; split; drop words of one letter and the generic words below.
- **Keys:** the first three words, and also the first two when there are more than two. Each key is prefixed with the direction.

The generic words, as in the prototype:

`deposit deposits wire type in out date time trn et ref transfer online mobile withdrawal debit credit pos ach return item chargeback payment check cheque from to the id no number bank branch atm card purchase recurring web ppd ccd des indn co entry descr orig memo`

**Index.** For each key the index keeps:

- the number of entries that carry it;
- the count for each account;
- the latest date.

One entry adds to a key once.

**Suggesting.** The waiting line's description gives its keys, and the longest keys are tried first. A key suggests only when it has **at least 2 entries** and its top account holds **at least 75%** of them.

**Scope.** Each company learns from its own books only.

### 3.4 Saying why

| Source | Text shown |
|---|---|
| Rule | `Rule 3: "gusto" → 6110 Salaries and Wages` |
| History | `Coded to 6300 Rent 11 of the last 11 times for "metro realty"` |

## 4. Software changes

### 4.1 Migration `0126_bank_rules.sql`

- **Table `acc_bank_rule`.** It holds the fields in §3.2, plus `created_by`, `updated_by`, `created_at` and `updated_at`.
  - Checks:
    - `match_kind in ('words','regex')`;
    - `direction in ('in','out','any')`;
    - `length(btrim(match_text)) between 1 and 200`;
    - `min_minor >= 0`, `max_minor >= 0`, and `min_minor <= max_minor` when both are set.
  - `account_id` references `acc_account`.
  - There is an index on `position`.
- **Triggers:**
  - the existing `acc_stamp_actor` stamps who made each change;
  - the existing `acc_audit_row_change` records every insert, update and delete.
- **Row-level security**, following `acc_bank_category` (0098):
  - read: staff and viewers;
  - insert, update and delete: `acc_is_staff()`.
  - Grants: `select, insert, update, delete` to `authenticated`, and all to `service_role`; `public` and `anon` are revoked.
- **Function `acc_reorder_bank_rules(p_ids uuid[])`.** It is security definer, staff only, and rewrites `position` to the order given, in one statement. Grants follow the other banking functions.
- **Nothing existing changes.** No column is added to a bank line, and no entry is touched.

### 4.2 Domain (pure, tested)

- `lib/domain/coding-names.ts`:
  - `cleanPayee(text)`;
  - `nameWords(text)`;
  - `historyKeys(text)`;
  - `GENERIC_WORDS`.
- `lib/domain/bank-rules.ts`:
  - the `BankRule` type;
  - `ruleMatches(rule, line)`;
  - `firstMatchingRule(rules, line)`;
  - `validateRuleInput(input)`, which covers a regex that does not compile, the text length and the amount window.
- `lib/domain/coding-history.ts`:
  - the `HistoryEntry` type, `{ direction, texts, accountId, date }`;
  - `buildHistoryIndex(entries)`;
  - `suggestFromHistory(index, line)`;
  - `HISTORY_MIN = 2` and `HISTORY_SHARE = 0.75`.
- `lib/domain/coding.ts`:
  - `suggestCoding({ line, rules, index, accounts, hasMatch })` returns `{ accountId, source: 'rule' | 'history', why, ruleId?, hits?, of?, key? } | null`, applying §3.1.
  - `codingWhy(...)`.

### 4.3 Services

`lib/services/coding.ts`:

- `listBankRules(sb)`.
- `loadHistory(sb)`: paged reads of posted entries and their lines, with the matched bank lines, through the shared pager in `lib/services/paging.ts`, reduced to `HistoryEntry[]`.
- `codingSuggestions(sb, bankAccountId | null)`: the waiting lines, rules, history, accounts and the lines with a match, turned into `Map<transactionId, Suggestion>`.
- Rule writes:
  - `saveBankRule` validates with `validateRuleInput` before it writes;
  - `deleteBankRule`;
  - `reorderBankRules`.

### 4.4 Actions

In `app/(app)/banking/actions.ts`, or `rules/actions.ts` for the rule actions:

- `getCodingSuggestionsAction(bankAccountId | null)`.
- `codeFromSuggestionsAction(transactionIds)`:
  - guarded like the existing batch action;
  - at most 100 ids per call;
  - the suggestions are worked out again on the server, never taken from the browser;
  - each line whose suggestion still stands is posted through `categoriseBankTransaction`, one at a time, as the batch action does;
  - it returns an outcome for each line, reusing the wording in `lib/domain/bank-transaction-batch.ts`.
- `saveBankRuleAction`, `deleteBankRuleAction` and `reorderBankRulesAction`.
- `previewBankRuleAction(input)`: how many waiting lines this rule would match, with up to five examples, for the rule form.

### 4.5 Screens

- **Bank Transactions** (`/banking`):
  - **The Category cell of a waiting line** has one line under the picker: `Usually 6300 Rent · 11 of 11 · Use` or `Rule 3 "gusto" → 6110 Salaries and Wages · Use`, with the full why in a tooltip. "Use" posts that one line through the existing categorise action.
  - **Above the table**, when any waiting line in view has a suggestion, a bar says: `12 of 20 waiting lines have a suggestion, $8,430.00 in all — Code all 12`. "Code all" opens a confirmation that lists each line with its date, description, amount, target account and why. Posting shows the same per-line result as batch assign. Above 100 lines, the button codes the first 100 and says how many are left.
  - **A "Create rule" action on a line** opens the rule form filled from that line: its cleaned name as `words`, its direction, and the account it is coded to or chosen for.
  - A viewer sees suggestions but no "Use", "Code all" or "Create rule".
- **Banking › Rules** (`/banking/rules`, linked from the Banking section in the navigation):
  - a list in order, with the match, direction, amount window, account, whether the rule is active, and "matches N waiting lines";
  - add and edit in a modal, with a live preview of matching lines;
  - move up and down;
  - delete, with a confirmation;
  - an inactive target account is shown as a warning on its rule.

### 4.6 Release

Changelog 1.69:

- bank rules;
- suggestions from history on waiting bank lines;
- Code all;
- Create rule from a line.

## 5. Proving it

1. **Unit tests:**
   - Name cleaning and keys, against the prototype's examples: generic words dropped; digits dropped; three- and two-word keys.
   - Rule matching:
     - words anchored at word boundaries, "fee" not matching "coffee";
     - regex;
     - direction;
     - both ends of the amount window;
     - an inactive rule and an unusable account are skipped;
     - the first match wins.
   - History:
     - `HISTORY_MIN` and `HISTORY_SHARE` at their edges, including 2 of 2, 3 of 4 and 2 of 3;
     - the longest key first;
     - direction kept apart;
     - which entries teach and which do not: split entries, transfers, holding accounts, AR/AP, inactive targets.
   - Precedence: an existing match, then a rule, then history.
   - The Code all action works its suggestions out again, and a line whose suggestion changed is skipped with a reason.
2. **Migration:**
   - a static test;
   - `migration-grants.test.ts`;
   - a rolled-back check, `scripts/verify-bank-rules.mjs`, on every company, covering:
     - that staff can write and a viewer cannot;
     - the checks;
     - the audit rows;
     - reordering.
3. **Accuracy, read-only, on real books** (`scripts/evaluate-coding-history.mjs`):
   - For the two live companies with the most history, hide a fixed fifth of the entries that teach.
   - Suggest for the hidden ones from the rest, and report how many are suggested and how many of those are wrong.
   - The prototype's figure was 2 wrong in 470. The result is reported to the user before the history thresholds are accepted.
4. **Live, with approval:**
   - apply 0126 to every company;
   - run smoke and the four gates;
   - take screenshots of Bank Transactions with suggestions, the Code all confirmation and Banking › Rules, on the sample company in light and dark;
   - show them before any push.

## 6. Constraints

- **Language and style:** US English UI. No hex colours outside the token block. No Ant Design `<Table` in new files; use `DataTable`. Paged reads.
- **Posting:** nothing is posted without a person's click, and every post goes through `acc_categorise_bank_transaction`.
- **Git:** commits stage files by name, carry no Co-Authored-By trailer, and have messages written with Bash `printf`.
- **Live data:** nothing is written to live data without the user's approval. The migration apply is asked for before it runs.
