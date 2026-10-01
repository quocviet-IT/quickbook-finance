# Loan instalments (1.76) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company register its loans next to its cards. A bank payment that repays a registered loan is then proposed as a principal + interest split, with the interest estimated, shown with its basis, editable, and posted in one entry: loan account, interest account, bank.

**Architecture:**
- Migration 0130 adds `acc_post_bank_loan_payment`. The caller passes only the line, the register entry and the interest. The function takes the accounts from the register and works out the principal itself.
- A pure module, `lib/domain/loan-interest.ts`, estimates the interest: owed × rate ÷ 12, a fixed amount, or typed each time. Several waiting payments to one loan are taken in date order. The module builds one `LoanSuggestionView` per waiting loan payment.
- Review import gets a `loan` proposal. Bank Transactions gets a loan suggestion in the Category cell. Both open one shared "Split…" dialog.
- Banking › Rules gets **Add loan**.
- Two loose ends from the 1.75 review are closed:
  - a saved entry cannot change kind;
  - the register preview reads only what it needs.

**Tech Stack:** Next.js App Router, React 19 + Ant Design 6, Supabase (Postgres, PostgREST, RLS), Zod 4, Vitest, `pg` for verify scripts.

**Spec:** `docs/superpowers/specs/2026-10-01-card-loan-payments-design.md`, the 1.76 half (sections 3.1 loans, 3.3, 3.5, 3.6, 4.1 `0130`, 4.2–4.4, 5).
**Branch:** `feat/loan-payments`, stacked on `feat/card-loan-payments` (1.75, head `de7b9a8`). It merges after 1.75.

## Global Constraints

- US English UI. No hex colours outside the token block. `DataTable` only. Paged reads (`readAllPages`).
- Nothing is posted without a person's click. A loan line never starts ticked and is never part of **Code all**.
- Money is in minor units end to end. The principal is worked out on the server from the payment and the interest; a total sent by the browser is never trusted.
- The loan and interest accounts are taken from the register entry, never from the caller. Only the interest comes from the caller.
- `lib/domain/*.ts` files that scripts import use relative `.ts` imports only (`"./repayments.ts"`), never `@/`.
- Stage files by name; never `git add -A` (public repo, untracked client files). No Co-Authored-By trailer. Write commit messages to `C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt` and `git commit -q -F` that file (agents cannot write in `.git/`).
- No real client names, account digits or figures in repository files. Fixtures are invented ("Example Loan", "2500", "120,000.00").
- Migration 0130 goes live only with the user's approval. Writes to live data happen only on the sample company PC-Test.
- Run everything from `ctyhp-accounting/`. Quote paths containing `(app)` or `[id]` in shell commands.
- Never pipe test output through `tail`/`head` before a push; read the pass/fail lines.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0130_loan_payment.sql` (new) | `acc_post_bank_loan_payment`: one entry, principal + interest + bank. |
| `tests/unit/loan-payment-migration.test.ts` (new) | Static reading of 0130. |
| `lib/domain/loan-interest.ts` (new) | Pure:<br>- what is owed on a date;<br>- a month's interest;<br>- the estimate and its basis;<br>- the date-order carry;<br>- the Why text;<br>- the default interest account;<br>- `loanSuggestionsFrom`. |
| `tests/unit/loan-interest.test.ts` (new) | Its tests, with worked figures. |
| `lib/domain/repayments.ts` (modify) | `kindChangeProblem`. |
| `lib/domain/statement-review.ts` (modify) | The `loan` proposal and post item; `itemFromValue` takes the interest. |
| `tests/unit/statement-review-loans.test.ts` (new) | Review precedence and values with loans. |
| `lib/domain/bank-postings.ts` (new) | One bank line's posting as the Category cell shows it, when an entry has several accounts. |
| `tests/unit/bank-postings.test.ts` (new) | Its tests. |
| `lib/services/loan-payments.ts` (new) | Loan-account movements; Bank Transactions loan suggestions; posting through the RPC. |
| `tests/unit/loan-payments-service.test.ts` (new) | Its tests with a fake client. |
| `lib/services/statement-review.ts` (modify) | Loan proposals on Review import; posting `loan` items. |
| `tests/unit/statement-review-service.test.ts` (modify) | The `postLoan` dependency. |
| `lib/services/coding.ts` (modify) | `loadHistory(sb, accountIds?)` reads only the accounts asked for. |
| `lib/services/repayments.ts` (modify) | Kind-change guard; the stats read only the register's accounts and only waiting payments out. |
| `tests/unit/coding-service.test.ts`, `tests/unit/repayments-service.test.ts` (modify) | Tests for the above. |
| `lib/domain/schemas.ts` (modify) | Loans in `repaymentInputSchema`; the `loan` review item; `loanPaymentSchema`. |
| `app/(app)/banking/rules/actions.ts` (modify) | Save a loan. |
| `app/(app)/banking/actions.ts` (modify) | `getLoanSuggestionsAction`, `postLoanPaymentAction`. |
| `app/(app)/banking/rules/RepaymentFormModal.tsx` (rewrite) | Add/edit a card or a loan. |
| `app/(app)/banking/rules/RepaymentsSection.tsx` (rewrite) | Cards and loans, with the Interest column. |
| `app/(app)/banking/rules/page.tsx` (modify) | Loan and interest accounts, the default interest account, interest labels. |
| `app/(app)/banking/LoanSplitModal.tsx` (new) | The one Split dialog. |
| `app/(app)/banking/imports/[id]/ReviewImportClient.tsx` (modify) | Loan lines: interest state, Split…, ticking, posting, count. |
| `app/(app)/banking/CategoriseCell.tsx`, `BankTransactionsTable.tsx`, `BankingClient.tsx` (modify) | The loan suggestion and Split… on Bank Transactions; split postings shown whole. |
| `scripts/verify-loan-payment.mjs` (new) | Rolled-back behavioural check of 0130 on every company. |
| `lib/domain/changelog.ts`, `lib/domain/system-guide.ts` (modify) | Release 1.76 and the guide. |

---

### Task 1: Migration 0130 — posting a loan payment

**Files:**
- Create: `supabase/migrations/0130_loan_payment.sql`
- Create: `tests/unit/loan-payment-migration.test.ts`

**Interfaces:**
- Produces: `acc_post_bank_loan_payment(p_transaction_id uuid, p_repayment_id uuid, p_interest_minor bigint) returns jsonb`, returning `{ entry_id, entry_number, principal_minor, interest_minor }`.

- [ ] **Step 1: Write the failing static test**

`tests/unit/loan-payment-migration.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0130_loan_payment.sql"), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
}

describe("0130 loan payment", () => {
  const sql = body();
  it("posts a loan payment, staff only, through acc_post_entry", () => {
    expect(sql).toMatch(/create or replace function acc_post_bank_loan_payment\(\s*p_transaction_id uuid,\s*p_repayment_id uuid,\s*p_interest_minor bigint\s*\)/i);
    expect(sql).toMatch(/security definer set search_path = public/i);
    expect(sql).toMatch(/if not acc_is_staff\(\) then/i);
    expect(sql).toMatch(/acc_post_entry\(/i);
  });
  it("takes the accounts from the register, never from the caller", () => {
    expect(sql).toMatch(/select \* into v_reg from acc_repayment_account where id = p_repayment_id/i);
    expect(sql).toMatch(/select \* into v_loan from acc_account where id = v_reg\.account_id/i);
    expect(sql).toMatch(/select \* into v_interest from acc_account where id = v_reg\.interest_account_id/i);
  });
  it("works out the principal itself and refuses interest outside 0..payment", () => {
    expect(sql).toMatch(/v_principal := v_abs - p_interest_minor/i);
    expect(sql).toMatch(/p_interest_minor is null or p_interest_minor < 0 or p_interest_minor > v_abs/i);
  });
  it("is callable by authenticated users and the service role only", () => {
    expect(sql).toMatch(/revoke all on function acc_post_bank_loan_payment\(uuid, uuid, bigint\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function acc_post_bank_loan_payment\(uuid, uuid, bigint\) to authenticated, service_role/i);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/loan-payment-migration.test.ts`
Expected: FAIL with `ENOENT … 0130_loan_payment.sql`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0130_loan_payment.sql`:

```sql
-- ============================================================================
-- 0130 — A loan instalment, posted as principal and interest.
--
-- A loan payment repays principal and pays interest; only the interest is an
-- expense. Given a waiting bank line, a loan from Cards and loans (0129) and
-- the interest a person accepted, this posts one entry: the loan account for
-- the principal, the interest account for the interest, the bank for the
-- payment. The two accounts come from the register, never from the caller;
-- the principal is worked out here. The entry is source 'bank' with no source
-- id, so Change takes it back through acc_uncategorise_bank_transaction.
--
-- Nothing existing changes.
-- ============================================================================

set search_path = public;

create or replace function acc_post_bank_loan_payment(
  p_transaction_id uuid,
  p_repayment_id uuid,
  p_interest_minor bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn       acc_bank_transaction;
  v_bank      uuid;
  v_reg       acc_repayment_account;
  v_loan      acc_account;
  v_interest  acc_account;
  v_currency  text;
  v_abs       bigint;
  v_principal bigint;
  v_lines     jsonb := '[]'::jsonb;
  v_entry     uuid;
  v_line      uuid;
  v_number    text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to post a loan payment';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_transaction_id for update;
  if v_txn.id is null then
    raise exception 'Bank transaction not found';
  end if;
  if v_txn.status <> 'unmatched' or v_txn.pending then
    raise exception 'This line must still be waiting to be posted';
  end if;
  if exists (select 1 from acc_reconciliation where bank_transaction_id = p_transaction_id) then
    raise exception 'This line is already matched to the ledger';
  end if;
  if coalesce(v_txn.amount_minor, 0) >= 0 then
    raise exception 'A loan payment is money out of the bank';
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;
  select ba.account_id into v_bank
    from acc_bank_account ba
   where ba.id = v_txn.bank_account_id and ba.currency_code = v_currency;
  if v_bank is null then
    raise exception 'Loan payments are posted only from a bank account in %', v_currency;
  end if;

  select * into v_reg from acc_repayment_account where id = p_repayment_id;
  if v_reg.id is null or v_reg.kind <> 'loan' or not v_reg.is_active then
    raise exception 'Choose a loan that is switched on in Cards and loans';
  end if;
  select * into v_loan from acc_account where id = v_reg.account_id;
  if v_loan.id is null or v_loan.status <> 'active' or not v_loan.is_posting_account
     or v_loan.account_type::text not in ('current_liability', 'long_term_liability') then
    raise exception 'The loan account must be an active posting liability account';
  end if;
  select * into v_interest from acc_account where id = v_reg.interest_account_id;
  if v_interest.id is null or v_interest.status <> 'active' or not v_interest.is_posting_account
     or v_interest.account_type::text not in ('expense', 'other_expense') then
    raise exception 'The interest account must be an active posting expense account';
  end if;

  v_abs := abs(v_txn.amount_minor);
  if p_interest_minor is null or p_interest_minor < 0 or p_interest_minor > v_abs then
    raise exception 'Interest must be between 0 and the payment';
  end if;
  v_principal := v_abs - p_interest_minor;

  if v_principal > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_loan.id, 'debit_minor', v_principal, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(v_principal, v_currency, v_txn.txn_date), 'memo', 'Principal'));
  end if;
  if p_interest_minor > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_interest.id, 'debit_minor', p_interest_minor, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(p_interest_minor, v_currency, v_txn.txn_date), 'memo', 'Interest'));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_id', v_bank, 'debit_minor', 0, 'credit_minor', v_abs,
    'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_txn.txn_date), 'memo', v_txn.description));

  v_entry := acc_post_entry(
    v_txn.txn_date,
    coalesce(nullif(btrim(v_txn.description), ''), 'Bank line') || ' — loan payment',
    'bank', null, v_currency, v_lines);

  select id into v_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_bank limit 1;
  insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
  values (p_transaction_id, v_line, 'approved', 1.000);
  update acc_bank_transaction set status = 'matched' where id = p_transaction_id;

  select entry_number into v_number from acc_journal_entry where id = v_entry;
  return jsonb_build_object('entry_id', v_entry, 'entry_number', v_number,
                            'principal_minor', v_principal, 'interest_minor', p_interest_minor);
end;
$$;

revoke all on function acc_post_bank_loan_payment(uuid, uuid, bigint) from public, anon;
grant execute on function acc_post_bank_loan_payment(uuid, uuid, bigint) to authenticated, service_role;
```

- [ ] **Step 4: Run the static tests**

Run: `npx vitest run tests/unit/loan-payment-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/schema-template.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0130_loan_payment.sql tests/unit/loan-payment-migration.test.ts
# commit-msg.txt:
# feat(banking): post a loan payment as principal and interest (0130)
#
# The accounts come from Cards and loans and the principal is worked out in
# the function; only the interest is the caller's.
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 2: The interest estimate — `lib/domain/loan-interest.ts`

**Files:**
- Create: `lib/domain/loan-interest.ts`
- Test: `tests/unit/loan-interest.test.ts`

**Interfaces:**
- Consumes:
  - `repaymentFor`, `RepaymentAccount`, `InterestMethod` from `./repayments.ts`;
  - the type `CodingAccount` (`{ id, code, name, type, active, posting }`) from `./coding.ts`.
- Produces:
  - `interface LoanMovement { accountId: string; date: string; debitMinor: number; creditMinor: number }`;
  - `owedOn(movements, accountId, date): number`;
  - `monthlyInterest(owedMinor, annualRate): number`;
  - `interface InterestEstimate { interestMinor: number | null; basis: string }`;
  - `estimateInterest({ method, annualRate, fixedInterestMinor, owedMinor, paymentMinor }): InterestEstimate`;
  - `interface LoanLine { id; date; paymentMinor; entry: RepaymentAccount }`;
  - `interface LoanPlan extends InterestEstimate { principalMinor: number | null; owedMinor: number }`;
  - `planLoanLines(lines, movements): Map<string, LoanPlan>`;
  - `splitText(principalMinor, interestMinor, loanLabel, interestLabel): string`;
  - `loanWhy(plan, loanLabel, interestLabel): string`;
  - `suggestInterestAccount(accounts: readonly CodingAccount[]): string | null`;
  - `interface LoanSuggestionView { transactionId; repaymentId; label; why; paymentMinor; interestMinor: number | null; principalMinor: number | null; basis; loanAccountLabel; interestAccountLabel }`;
  - `interface LoanCandidate { id; bankAccountId; date; amountMinor; description }`;
  - `loanSuggestionsFrom({ lines, repayments, baseCurrencyBankIds, accounts, movements, excludeIds? }): LoanSuggestionView[]`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/loan-interest.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CodingAccount } from "@/lib/domain/coding";
import {
  estimateInterest,
  loanSuggestionsFrom,
  loanWhy,
  monthlyInterest,
  owedOn,
  planLoanLines,
  suggestInterestAccount,
  type LoanMovement,
} from "@/lib/domain/loan-interest";
import type { RepaymentAccount } from "@/lib/domain/repayments";

const loan = (over: Partial<RepaymentAccount> = {}): RepaymentAccount => ({
  id: "rp-loan",
  kind: "loan",
  accountId: "loan1",
  matchWords: "example loan",
  matchDigits: null,
  interestAccountId: "int1",
  interestMethod: "rate",
  annualRate: 4,
  fixedInterestMinor: null,
  isActive: true,
  ...over,
});
const borrowed: LoanMovement[] = [
  { accountId: "loan1", date: "2026-01-01", debitMinor: 0, creditMinor: 12_000_000 },
  { accountId: "loan1", date: "2026-12-31", debitMinor: 0, creditMinor: 99_999 },
  { accountId: "other", date: "2026-01-01", debitMinor: 0, creditMinor: 5_000 },
];
const acct = (id: string, code: string, name: string, type: CodingAccount["type"], over: Partial<CodingAccount> = {}): CodingAccount => ({
  id,
  code,
  name,
  type,
  active: true,
  posting: true,
  ...over,
});

describe("owedOn", () => {
  it("adds credits less debits on that account, on or before the date", () => {
    expect(owedOn(borrowed, "loan1", "2026-09-15")).toBe(12_000_000);
    expect(owedOn(borrowed, "loan1", "2025-12-31")).toBe(0);
    expect(owedOn([...borrowed, { accountId: "loan1", date: "2026-02-01", debitMinor: 160_000, creditMinor: 0 }], "loan1", "2026-09-15")).toBe(11_840_000);
  });
});

describe("monthlyInterest", () => {
  it("is owed × rate ÷ 12, in cents", () => {
    expect(monthlyInterest(12_000_000, 4)).toBe(40_000); // 120,000.00 × 4% ÷ 12 = 400.00
  });
  it("rounds half up at a cent", () => {
    expect(monthlyInterest(150, 4)).toBe(1); // 0.5 cent → 1
    expect(monthlyInterest(149, 4)).toBe(0); // 0.4966 cent → 0
    expect(monthlyInterest(11_840_000, 4)).toBe(39_467); // 394.666… → 394.67
  });
  it("takes a rate with three decimals exactly", () => {
    expect(monthlyInterest(12_000_000, 3.75)).toBe(37_500);
    expect(monthlyInterest(12_000_000, 0.001)).toBe(10);
  });
  it("is nothing when nothing is owed", () => {
    expect(monthlyInterest(0, 4)).toBe(0);
    expect(monthlyInterest(-500, 4)).toBe(0);
  });
});

describe("estimateInterest", () => {
  it("estimates from the rate and says how", () => {
    expect(estimateInterest({ method: "rate", annualRate: 4, fixedInterestMinor: null, owedMinor: 12_000_000, paymentMinor: 200_000 })).toEqual({
      interestMinor: 40_000,
      basis: "estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement.",
    });
  });
  it("never proposes more than the payment", () => {
    expect(estimateInterest({ method: "rate", annualRate: 4, fixedInterestMinor: null, owedMinor: 12_000_000, paymentMinor: 30_000 }).interestMinor).toBe(30_000);
    expect(estimateInterest({ method: "fixed", annualRate: null, fixedInterestMinor: 50_000, owedMinor: 0, paymentMinor: 30_000 }).interestMinor).toBe(30_000);
  });
  it("proposes nothing when nothing is owed on the books", () => {
    expect(estimateInterest({ method: "rate", annualRate: 4, fixedInterestMinor: null, owedMinor: 0, paymentMinor: 200_000 })).toEqual({
      interestMinor: 0,
      basis: "nothing is owed on the books before this payment. Check it against the lender's statement.",
    });
  });
  it("uses the fixed amount, or leaves it to be typed", () => {
    expect(estimateInterest({ method: "fixed", annualRate: null, fixedInterestMinor: 40_000, owedMinor: 0, paymentMinor: 200_000 })).toEqual({
      interestMinor: 40_000,
      basis: "the fixed amount for this loan.",
    });
    expect(estimateInterest({ method: "entered", annualRate: null, fixedInterestMinor: null, owedMinor: 12_000_000, paymentMinor: 200_000 })).toEqual({
      interestMinor: null,
      basis: "Enter the interest from the lender's statement.",
    });
  });
});

describe("planLoanLines", () => {
  it("takes payments to one loan in date order, each on what the earlier ones leave", () => {
    const plans = planLoanLines(
      [
        { id: "b", date: "2026-09-15", paymentMinor: 200_000, entry: loan() },
        { id: "a", date: "2026-08-15", paymentMinor: 200_000, entry: loan() },
      ],
      borrowed,
    );
    expect(plans.get("a")).toMatchObject({ owedMinor: 12_000_000, interestMinor: 40_000, principalMinor: 160_000 });
    expect(plans.get("b")).toMatchObject({ owedMinor: 11_840_000, interestMinor: 39_467, principalMinor: 160_533 });
  });
  it("carries nothing when the interest is still to be typed", () => {
    const entered = loan({ interestMethod: "entered", annualRate: null });
    const plans = planLoanLines(
      [
        { id: "a", date: "2026-08-15", paymentMinor: 200_000, entry: entered },
        { id: "b", date: "2026-09-15", paymentMinor: 200_000, entry: entered },
      ],
      borrowed,
    );
    expect(plans.get("a")).toMatchObject({ interestMinor: null, principalMinor: null, owedMinor: 12_000_000 });
    expect(plans.get("b")).toMatchObject({ owedMinor: 12_000_000 });
  });
  it("keeps two loans apart", () => {
    const other = loan({ id: "rp2", accountId: "other" });
    const plans = planLoanLines(
      [
        { id: "a", date: "2026-08-15", paymentMinor: 200_000, entry: loan() },
        { id: "b", date: "2026-08-16", paymentMinor: 1_000, entry: other },
      ],
      borrowed,
    );
    expect(plans.get("b")).toMatchObject({ owedMinor: 5_000 });
  });
});

describe("loanWhy", () => {
  it("names the split, then how the interest was reached", () => {
    const [plan] = [...planLoanLines([{ id: "a", date: "2026-08-15", paymentMinor: 200_000, entry: loan() }], borrowed).values()];
    expect(loanWhy(plan, "2500 Example Loan", "8100 Interest Expense")).toBe(
      "Principal 1,600.00 to 2500 Example Loan, interest 400.00 to 8100 Interest Expense — estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement.",
    );
  });
  it("says only what to do while the interest is still to be typed", () => {
    expect(loanWhy({ interestMinor: null, principalMinor: null, owedMinor: 0, basis: "Enter the interest from the lender's statement." }, "x", "y")).toBe(
      "Enter the interest from the lender's statement.",
    );
  });
});

describe("suggestInterestAccount", () => {
  it("offers the first active posting expense account named for interest", () => {
    expect(
      suggestInterestAccount([
        acct("a", "8200", "Interest Expense", "other_expense"),
        acct("b", "8100", "Interest Expense", "other_expense", { active: false }),
        acct("c", "7100", "Interest Income", "other_income"),
        acct("d", "8150", "Loan interest", "expense"),
      ]),
    ).toBe("d");
    expect(suggestInterestAccount([acct("x", "6000", "Rent", "expense")])).toBeNull();
  });
});

describe("loanSuggestionsFrom", () => {
  const accounts = new Map(
    [
      acct("loan1", "2500", "Example Loan", "long_term_liability"),
      acct("int1", "8100", "Interest Expense", "other_expense"),
      acct("card1", "2050", "Example Card", "credit_card"),
    ].map((a) => [a.id, a]),
  );
  const card: RepaymentAccount = { ...loan(), id: "rp-card", kind: "card", accountId: "card1", matchWords: "example card", interestAccountId: null, interestMethod: null, annualRate: null };
  const line = (id: string, description: string, amountMinor = -200_000, over = {}) => ({ id, bankAccountId: "bank1", date: "2026-08-15", amountMinor, description, ...over });
  const base = { repayments: [loan(), card], baseCurrencyBankIds: new Set(["bank1"]), accounts, movements: borrowed };

  it("proposes each waiting loan payment with its split, in the screen's words", () => {
    expect(loanSuggestionsFrom({ ...base, lines: [line("t1", "EXAMPLE LOAN PMT")] })).toEqual([
      {
        transactionId: "t1",
        repaymentId: "rp-loan",
        label: "Loan payment · 2500 — Example Loan",
        why: "Principal 1,600.00 to 2500 Example Loan, interest 400.00 to 8100 Interest Expense — estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement.",
        paymentMinor: 200_000,
        interestMinor: 40_000,
        principalMinor: 160_000,
        basis: "estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement.",
        loanAccountLabel: "2500 Example Loan",
        interestAccountLabel: "8100 Interest Expense",
      },
    ]);
  });
  it("leaves out card payments, money in, foreign banks and lines with a ledger match on offer", () => {
    const views = loanSuggestionsFrom({
      ...base,
      lines: [
        line("c", "EXAMPLE CARD EPAY"),
        line("in", "EXAMPLE LOAN REFUND", 50_000),
        line("fx", "EXAMPLE LOAN PMT", -200_000, { bankAccountId: "bank-eur" }),
        line("m", "EXAMPLE LOAN PMT"),
      ],
      excludeIds: new Set(["m"]),
    });
    expect(views).toEqual([]);
  });
});

describe("the loan-interest module", () => {
  it("can be imported by plain-Node scripts", () => {
    expect(readFileSync("lib/domain/loan-interest.ts", "utf8")).not.toMatch(/from "@\//);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/loan-interest.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/domain/loan-interest"`.

- [ ] **Step 3: Write the module**

`lib/domain/loan-interest.ts`:

```ts
/**
 * A loan instalment, split: the interest is an expense, the rest repays the loan.
 *
 * The interest proposed is the company's own estimate, never the lender's
 * figure: the balance owed on the books before the payment × the annual rate
 * ÷ 12, or a fixed amount per payment, or nothing — typed from the lender's
 * statement each time. It is always shown with how it was reached and can be
 * changed before posting. Two waiting payments to one loan are taken in date
 * order, the second on the balance the first leaves.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
import type { CodingAccount } from "./coding.ts";
import { repaymentFor, type InterestMethod, type RepaymentAccount } from "./repayments.ts";

/** One posted line on a loan account. */
export interface LoanMovement {
  accountId: string;
  /** The entry's date, YYYY-MM-DD. */
  date: string;
  debitMinor: number;
  creditMinor: number;
}

/** What is owed on a liability account at the end of a day: credits less debits posted on or before it. */
export function owedOn(movements: readonly LoanMovement[], accountId: string, date: string): number {
  let owed = 0;
  for (const m of movements) if (m.accountId === accountId && m.date <= date) owed += m.creditMinor - m.debitMinor;
  return owed;
}

/** A month of interest at an annual rate, in minor units, rounded half up. Nothing owed is no interest. */
export function monthlyInterest(owedMinor: number, annualRate: number): number {
  if (owedMinor <= 0 || annualRate <= 0) return 0;
  // The rate in thousandths of a percent keeps the arithmetic in integers:
  // owed × (rate/100) ÷ 12 = owed × thousandths ÷ 1,200,000, rounded half up as
  // (2 × that + 1,200,000) ÷ 2,400,000. BigInt() calls, not literals: the
  // project compiles to ES2017, where `2n` is a type error.
  const thousandths = BigInt(Math.round(annualRate * 1000));
  const owed = BigInt(Math.trunc(owedMinor));
  return Number((owed * thousandths * BigInt(2) + BigInt(1_200_000)) / BigInt(2_400_000));
}

const amount = (minor: number) =>
  (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface InterestEstimate {
  /** Null while the interest is to be typed from the lender's statement. */
  interestMinor: number | null;
  /** How the figure was reached, in the words the screen shows. */
  basis: string;
}

export function estimateInterest(input: {
  method: InterestMethod;
  annualRate: number | null;
  fixedInterestMinor: number | null;
  owedMinor: number;
  paymentMinor: number;
}): InterestEstimate {
  const { method, annualRate, fixedInterestMinor, owedMinor, paymentMinor } = input;
  if (method === "entered") return { interestMinor: null, basis: "Enter the interest from the lender's statement." };
  if (method === "fixed") {
    return { interestMinor: Math.min(fixedInterestMinor ?? 0, paymentMinor), basis: "the fixed amount for this loan." };
  }
  if (owedMinor <= 0) {
    return { interestMinor: 0, basis: "nothing is owed on the books before this payment. Check it against the lender's statement." };
  }
  const rate = annualRate ?? 0;
  return {
    interestMinor: Math.min(monthlyInterest(owedMinor, rate), paymentMinor),
    basis: `estimated at ${rate.toFixed(3)}% a year on ${amount(owedMinor)} owed, ÷ 12. Check it against the lender's statement.`,
  };
}

/** A waiting payment to a registered loan. */
export interface LoanLine {
  id: string;
  date: string;
  /** The payment, as a positive number. */
  paymentMinor: number;
  entry: RepaymentAccount;
}

export interface LoanPlan extends InterestEstimate {
  /** Null while the interest is still to be typed. */
  principalMinor: number | null;
  owedMinor: number;
}

/** Each payment's proposed interest: in date order per loan, each on the balance the earlier ones leave. */
export function planLoanLines(lines: readonly LoanLine[], movements: readonly LoanMovement[]): Map<string, LoanPlan> {
  const plans = new Map<string, LoanPlan>();
  const repaid = new Map<string, number>();
  const ordered = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const line of ordered) {
    const account = line.entry.accountId;
    const owedMinor = owedOn(movements, account, line.date) - (repaid.get(account) ?? 0);
    const estimate = estimateInterest({
      method: line.entry.interestMethod ?? "entered",
      annualRate: line.entry.annualRate,
      fixedInterestMinor: line.entry.fixedInterestMinor,
      owedMinor,
      paymentMinor: line.paymentMinor,
    });
    const principalMinor = estimate.interestMinor === null ? null : line.paymentMinor - estimate.interestMinor;
    if (principalMinor !== null) repaid.set(account, (repaid.get(account) ?? 0) + principalMinor);
    plans.set(line.id, { ...estimate, principalMinor, owedMinor });
  }
  return plans;
}

/** "Principal 1,600.00 to 2500 Example Loan, interest 400.00 to 8100 Interest Expense" */
export function splitText(principalMinor: number, interestMinor: number, loanLabel: string, interestLabel: string): string {
  return `Principal ${amount(principalMinor)} to ${loanLabel}, interest ${amount(interestMinor)} to ${interestLabel}`;
}

export function loanWhy(plan: LoanPlan, loanLabel: string, interestLabel: string): string {
  if (plan.interestMinor === null || plan.principalMinor === null) return plan.basis;
  return `${splitText(plan.principalMinor, plan.interestMinor, loanLabel, interestLabel)} — ${plan.basis}`;
}

/** The account interest would most likely post to, by its name — offered, never saved on its own. */
export function suggestInterestAccount(accounts: readonly CodingAccount[]): string | null {
  return (
    [...accounts]
      .filter((a) => a.active && a.posting && (a.type === "expense" || a.type === "other_expense") && /interest/i.test(a.name))
      .sort((a, b) => a.code.localeCompare(b.code))[0]?.id ?? null
  );
}

/** What Bank Transactions and Review import show for one waiting loan payment. */
export interface LoanSuggestionView {
  transactionId: string;
  repaymentId: string;
  /** "Loan payment · 2500 — Example Loan" */
  label: string;
  why: string;
  /** The payment, as a positive number. */
  paymentMinor: number;
  interestMinor: number | null;
  principalMinor: number | null;
  /** How the interest was reached, for the Split dialog. */
  basis: string;
  /** "2500 Example Loan" */
  loanAccountLabel: string;
  /** "8100 Interest Expense" */
  interestAccountLabel: string;
}

/** A waiting bank line, as loan recognition needs it. */
export interface LoanCandidate {
  id: string;
  bankAccountId: string;
  date: string;
  amountMinor: number;
  description: string;
}

/** Pure: every waiting payment out that repays one registered loan, with its proposed split. */
export function loanSuggestionsFrom(input: {
  lines: readonly LoanCandidate[];
  repayments: readonly RepaymentAccount[];
  baseCurrencyBankIds: ReadonlySet<string>;
  accounts: ReadonlyMap<string, CodingAccount>;
  movements: readonly LoanMovement[];
  /** Lines with a ledger match on offer: they are not proposed as anything else. */
  excludeIds?: ReadonlySet<string>;
}): LoanSuggestionView[] {
  const loanLines: LoanLine[] = [];
  for (const line of input.lines) {
    if (input.excludeIds?.has(line.id)) continue;
    const fact = repaymentFor(
      input.repayments,
      { description: line.description, amountMinor: line.amountMinor, inBaseCurrency: input.baseCurrencyBankIds.has(line.bankAccountId) },
      input.accounts,
    );
    if (fact?.kind !== "one" || fact.entry.kind !== "loan") continue;
    loanLines.push({ id: line.id, date: line.date, paymentMinor: Math.abs(line.amountMinor), entry: fact.entry });
  }
  const plans = planLoanLines(loanLines, input.movements);
  const named = (id: string | null) => {
    const account = id ? input.accounts.get(id) : undefined;
    return account ? `${account.code} ${account.name}` : "an account not found";
  };
  return loanLines.flatMap((line) => {
    const plan = plans.get(line.id);
    if (!plan) return [];
    const account = input.accounts.get(line.entry.accountId);
    const loanAccountLabel = named(line.entry.accountId);
    const interestAccountLabel = named(line.entry.interestAccountId);
    return [
      {
        transactionId: line.id,
        repaymentId: line.entry.id,
        label: `Loan payment · ${account ? `${account.code} — ${account.name}` : "an account not found"}`,
        why: loanWhy(plan, loanAccountLabel, interestAccountLabel),
        paymentMinor: line.paymentMinor,
        interestMinor: plan.interestMinor,
        principalMinor: plan.principalMinor,
        basis: plan.basis,
        loanAccountLabel,
        interestAccountLabel,
      },
    ];
  });
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/loan-interest.test.ts && npm run typecheck`
Expected: PASS, and typecheck reports 0 errors. The tsconfig target is ES2017, so the module uses `BigInt(…)` calls, never `2n` literals. Do not rewrite the arithmetic in floating point.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/loan-interest.ts tests/unit/loan-interest.test.ts
# commit-msg.txt:
# feat(banking): estimate a loan instalment's interest, in date order per loan
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 3: Review import knows a loan; a saved entry keeps its kind

**Files:**
- Modify: `lib/domain/statement-review.ts`
- Modify: `lib/domain/repayments.ts` (append `kindChangeProblem`)
- Test: `tests/unit/statement-review-loans.test.ts` (new)
- Test: `tests/unit/repayments.test.ts` (append)

**Interfaces:**
- Consumes: `LoanSuggestionView` (Task 2).
- Produces:
  - `ReviewProposal` gains `{ kind: "loan"; repaymentId: string; label: string; why: string; loan: LoanSuggestionView }`;
  - `ReviewPostItem` gains `{ transactionId: string; kind: "loan"; repaymentId: string; interestMinor: number }`;
  - `reviewProposal` takes `loan?: LoanSuggestionView | null`;
  - `itemFromValue(transactionId, value, interestMinor?: number | null)`;
  - `kindChangeProblem(existing: RepaymentKind, next: RepaymentKind): string | null`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/statement-review-loans.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import { itemFromValue, proposalValue, reviewProposal, startsTicked } from "@/lib/domain/statement-review";

const line = { id: "t1", status: "unmatched", pending: false, amountMinor: -200_000, currencyCode: "USD" };
const loan: LoanSuggestionView = {
  transactionId: "t1",
  repaymentId: "rp-loan",
  label: "Loan payment · 2500 — Example Loan",
  why: "Principal 1,600.00 to 2500 Example Loan, interest 400.00 to 8100 Interest Expense — estimated …",
  paymentMinor: 200_000,
  interestMinor: 40_000,
  principalMinor: 160_000,
  basis: "estimated …",
  loanAccountLabel: "2500 Example Loan",
  interestAccountLabel: "8100 Interest Expense",
};
const funding = { kind: "funding" as const, counterpartId: "t9", label: "Shareholder funding · 2600 Shareholder Loan", why: "…", also: "…" };

describe("reviewProposal with loans", () => {
  it("proposes the loan payment with its split, and never ticks it", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: null, loan });
    expect(p).toEqual({ kind: "loan", repaymentId: "rp-loan", label: loan.label, why: loan.why, loan });
    expect(startsTicked(p)).toBe(false);
    expect(proposalValue(p)).toBe("loan:rp-loan");
  });
  it("offers no funding pair beside a loan", () => {
    expect(reviewProposal({ line, match: null, documents: [], coding: null, loan, pair: funding }).kind).toBe("loan");
  });
  it("lets a document, a transfer and the two-entries refusal come first", () => {
    const doc = { documentId: "b1", documentNumber: "BILL-1", partyName: "Example Vendor", balanceDueMinor: 200_000, currencyCode: "USD", direction: "payable" as const };
    expect(reviewProposal({ line, match: null, documents: [doc], coding: null, loan }).kind).toBe("document");
    expect(reviewProposal({ line, match: null, documents: [], coding: null, loan, repaymentRivals: 2 }).kind).toBe("none");
  });
});

describe("itemFromValue for a loan", () => {
  it("posts with the interest the person accepted, and not without one", () => {
    expect(itemFromValue("t1", "loan:rp-loan", 40_000)).toEqual({ transactionId: "t1", kind: "loan", repaymentId: "rp-loan", interestMinor: 40_000 });
    expect(itemFromValue("t1", "loan:rp-loan", 0)).toEqual({ transactionId: "t1", kind: "loan", repaymentId: "rp-loan", interestMinor: 0 });
    expect(itemFromValue("t1", "loan:rp-loan", null)).toBeNull();
    expect(itemFromValue("t1", "loan:rp-loan")).toBeNull();
  });
  it("still reads every other kind as before", () => {
    expect(itemFromValue("t1", "account:a1")).toEqual({ transactionId: "t1", kind: "account", accountId: "a1" });
  });
});
```

Append to `tests/unit/repayments.test.ts`. Add `kindChangeProblem` to its import list from `@/lib/domain/repayments`, then add this `describe` at the end:

```ts
describe("kindChangeProblem", () => {
  it("lets an entry stay what it is, and refuses a card becoming a loan or a loan a card", () => {
    expect(kindChangeProblem("card", "card")).toBeNull();
    expect(kindChangeProblem("loan", "loan")).toBeNull();
    expect(kindChangeProblem("card", "loan")).toBe("A card cannot become a loan, or a loan a card — remove the entry and add it again");
    expect(kindChangeProblem("loan", "card")).toBe("A card cannot become a loan, or a loan a card — remove the entry and add it again");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/statement-review-loans.test.ts tests/unit/repayments.test.ts`
Expected: FAIL. The loan proposal comes back as `kind: "none"`, and `kindChangeProblem` is not a function.

- [ ] **Step 3: Implement `kindChangeProblem`**

Append to `lib/domain/repayments.ts`:

```ts
/** A saved entry stays a card or a loan: the accounts and settings of one are not the other's. */
export function kindChangeProblem(existing: RepaymentKind, next: RepaymentKind): string | null {
  return existing === next ? null : "A card cannot become a loan, or a loan a card — remove the entry and add it again";
}
```

- [ ] **Step 4: Implement the loan proposal**

In `lib/domain/statement-review.ts`:

1. In the header comment, replace these three lines:

```ts
 * bill whose balance is exactly this amount; then a transfer; then a
 * registered card (1.75), or nothing when two cards or loans claim the line;
 * then a rule or history (1.70).
```

   with these four:

```ts
 * bill whose balance is exactly this amount; then a transfer; then a
 * registered card (1.75) or loan (1.76), or nothing when two cards or loans
 * claim the line; then a rule or history (1.70). A loan payment is never
 * ticked for you: its interest is an estimate until a person accepts it.
```

2. Add below `import type { CodingSuggestionView } from "./coding";`:

```ts
import type { LoanSuggestionView } from "./loan-interest";
```

3. Add the `loan` variant to `ReviewProposal`, before `| { kind: "none"; why: string };`:

```ts
  | { kind: "loan"; repaymentId: string; label: string; why: string; loan: LoanSuggestionView }
```

4. In `reviewProposal`'s input type, after `repaymentRivals?: number;`:

```ts
  /** The registered loan this line repays, with its proposed split (loan-interest.ts). */
  loan?: LoanSuggestionView | null;
```

   Add `loan` to the destructuring:

```ts
  const { line, match, documents, coding, pair, pairRivals, namedTransfer, repaymentRivals, loan } = input;
```

5. Immediately after the `repaymentRivals` refusal block, before `// Funding is only ever a suggestion`:

```ts
  // A loan payment is principal and interest; no single account, rule or
  // funding pair can stand for it.
  if (loan) return { kind: "loan", repaymentId: loan.repaymentId, label: loan.label, why: loan.why, loan };
```

6. `ReviewPostItem` gains:

```ts
  | { transactionId: string; kind: "loan"; repaymentId: string; interestMinor: number }
```

7. In `proposalValue`, before `return null;`:

```ts
  if (proposal.kind === "loan") return `loan:${proposal.repaymentId}`;
```

8. `startsTicked`:

```ts
/** A funding pair is a suggestion only, and a loan's interest an estimate; everything else with a value starts ticked. */
export function startsTicked(proposal: ReviewProposal): boolean {
  return proposalValue(proposal) !== null && proposal.kind !== "funding" && proposal.kind !== "loan";
}
```

9. `itemFromValue` takes the interest:

```ts
export function itemFromValue(transactionId: string, value: string | null, interestMinor: number | null = null): ReviewPostItem | null {
```

   and, after the `account` branch, before the final `return null;`:

```ts
  if (kind === "loan") return interestMinor === null ? null : { transactionId, kind, repaymentId: id, interestMinor };
```

- [ ] **Step 5: Run the review and repayment tests, and the typecheck**

Run: `npx vitest run tests/unit/statement-review-loans.test.ts tests/unit/statement-review.test.ts tests/unit/statement-review-pairs.test.ts tests/unit/statement-review-cards.test.ts tests/unit/repayments.test.ts && npm run typecheck`
Expected: tests PASS. Typecheck may report two errors that Task 5 and Task 8 fix:
- in `lib/services/statement-review.ts`, `postReviewItems` has no `loan` branch;
- in `ReviewImportClient.tsx`, the `counts` object has no `loan` key.

Report the exact errors. Fix only errors inside `lib/domain`.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/statement-review.ts lib/domain/repayments.ts tests/unit/statement-review-loans.test.ts tests/unit/repayments.test.ts
# commit-msg.txt:
# feat(banking): a loan proposal on Review import, never ticked; an entry keeps its kind
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 4: Split postings shown whole — `lib/domain/bank-postings.ts`

**Files:**
- Create: `lib/domain/bank-postings.ts`
- Test: `tests/unit/bank-postings.test.ts`

**Interfaces:**
- Produces:
  - `interface PostingLike { bank_transaction_id: string; account_code: string; account_name: string }`;
  - `postingsByLine<T extends PostingLike>(rows: readonly T[]): Map<string, T & { others: string[] }>`.

`acc_bank_transaction_postings` returns one row for each other line of an entry. A loan payment has two (loan and interest). The screen keeps one row per bank line, so today the last row wins and the account it shows is arbitrary.

- [ ] **Step 1: Write the failing tests**

`tests/unit/bank-postings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { postingsByLine } from "@/lib/domain/bank-postings";

const row = (txn: string, code: string, name: string) => ({ bank_transaction_id: txn, account_code: code, account_name: name, entry_number: "JE-1" });

describe("postingsByLine", () => {
  it("keeps one posting per line, the lowest account code first, with the others named", () => {
    const map = postingsByLine([row("t1", "8100", "Interest Expense"), row("t1", "2500", "Example Loan"), row("t2", "6100", "Rent")]);
    expect(map.get("t1")).toMatchObject({ account_code: "2500", account_name: "Example Loan", others: ["8100 — Interest Expense"] });
    expect(map.get("t2")).toMatchObject({ account_code: "6100", others: [] });
  });
  it("names an account once, however many lines post to it", () => {
    const map = postingsByLine([row("t1", "4000", "Sales"), row("t1", "4000", "Sales"), row("t1", "4100", "Other Sales")]);
    expect(map.get("t1")?.others).toEqual(["4100 — Other Sales"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/bank-postings.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/domain/bank-postings"`.

- [ ] **Step 3: Write the module**

`lib/domain/bank-postings.ts`:

```ts
/**
 * One bank line's posting as the Category cell shows it.
 *
 * acc_bank_transaction_postings returns a row for every other line of the
 * entry, so a loan payment (principal and interest) or a deposit of several
 * items arrives as several rows for one bank line. The cell shows the first
 * account, by code, and says how many others there are — never one picked at
 * random from the set.
 */
export interface PostingLike {
  bank_transaction_id: string;
  account_code: string;
  account_name: string;
}

export function postingsByLine<T extends PostingLike>(rows: readonly T[]): Map<string, T & { others: string[] }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.bank_transaction_id, [...(groups.get(row.bank_transaction_id) ?? []), row]);
  const byLine = new Map<string, T & { others: string[] }>();
  for (const [id, group] of groups) {
    const [first, ...rest] = [...group].sort((a, b) => a.account_code.localeCompare(b.account_code));
    const label = (r: PostingLike) => `${r.account_code} — ${r.account_name}`;
    const others = [...new Set(rest.map(label))].filter((other) => other !== label(first));
    byLine.set(id, { ...first, others });
  }
  return byLine;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/bank-postings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/bank-postings.ts tests/unit/bank-postings.test.ts
# commit-msg.txt:
# feat(banking): one posting per bank line, naming every account of a split entry
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 5: Services — loan suggestions, posting, Review import

**Files:**
- Create: `lib/services/loan-payments.ts`
- Modify: `lib/services/statement-review.ts`
- Test: `tests/unit/loan-payments-service.test.ts` (new)
- Test: `tests/unit/statement-review-service.test.ts` (modify the `deps` helper, add one test)

**Interfaces:**
- Consumes:
  - `loanSuggestionsFrom`, `LoanMovement`, `LoanSuggestionView` (Task 2);
  - `reviewProposal({ …, loan })` and the `loan` `ReviewPostItem` (Task 3);
  - `repaymentContext` (1.75, `lib/services/repayment-register.ts`);
  - `listBankTransactions`, `listSuggestions` (`lib/services/banking.ts`);
  - `listAccounts`;
  - `readAllPages`.
- Produces:
  - `class LoanPaymentError`;
  - `loanAccountIds(repayments): string[]`;
  - `loadLoanMovements(sb, accountIds): Promise<LoanMovement[]>`;
  - `loanSuggestions(sb, bankAccountId: string | null): Promise<LoanSuggestionView[]>`;
  - `postLoanPayment(sb, transactionId, repaymentId, interestMinor): Promise<{ entry_number: string | null; principal_minor: number; interest_minor: number }>`;
  - `ReviewPostDeps` gains `postLoan(sb, transactionId, repaymentId, interestMinor): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/loan-payments-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLoanMovements, loanAccountIds, postLoanPayment } from "@/lib/services/loan-payments";

const entry = (id: string, kind: "card" | "loan", accountId: string, isActive = true) => ({
  id,
  kind,
  accountId,
  matchWords: "x",
  matchDigits: null,
  interestAccountId: kind === "loan" ? "int" : null,
  interestMethod: kind === "loan" ? ("rate" as const) : null,
  annualRate: kind === "loan" ? 4 : null,
  fixedInterestMinor: null,
  isActive,
});

describe("loanAccountIds", () => {
  it("names each switched-on loan's account once", () => {
    expect(loanAccountIds([entry("a", "loan", "L1"), entry("b", "card", "C1"), entry("c", "loan", "L2", false), entry("d", "loan", "L1")])).toEqual(["L1"]);
  });
});

describe("loadLoanMovements", () => {
  it("reads nothing when there is no loan", async () => {
    const from = vi.fn();
    expect(await loadLoanMovements({ from } as unknown as SupabaseClient, [])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
  it("pages posted lines on the loan accounts and keeps the entry date", async () => {
    const range = vi.fn().mockResolvedValue({
      data: [{ id: "l1", account_id: "L1", debit_minor: 0, credit_minor: 12_000_000, acc_journal_entry: { entry_date: "2026-01-01", status: "posted" } }],
      error: null,
    });
    const order = vi.fn(() => ({ range }));
    const eq = vi.fn(() => ({ order }));
    const inFn = vi.fn(() => ({ eq }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    expect(await loadLoanMovements({ from } as unknown as SupabaseClient, ["L1"])).toEqual([
      { accountId: "L1", date: "2026-01-01", debitMinor: 0, creditMinor: 12_000_000 },
    ]);
    expect(from).toHaveBeenCalledWith("acc_journal_line");
    expect(inFn).toHaveBeenCalledWith("account_id", ["L1"]);
    expect(eq).toHaveBeenCalledWith("acc_journal_entry.status", "posted");
    expect(order).toHaveBeenCalledWith("id");
  });
});

describe("postLoanPayment", () => {
  it("passes only the line, the entry and the interest, and returns what was posted", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { entry_number: "JE-000031", principal_minor: 160_000, interest_minor: 40_000 }, error: null });
    expect(await postLoanPayment({ rpc } as unknown as SupabaseClient, "t1", "rp1", 40_000)).toEqual({
      entry_number: "JE-000031",
      principal_minor: 160_000,
      interest_minor: 40_000,
    });
    expect(rpc).toHaveBeenCalledWith("acc_post_bank_loan_payment", { p_transaction_id: "t1", p_repayment_id: "rp1", p_interest_minor: 40_000 });
  });
  it("reports the database's refusal word for word", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Interest must be between 0 and the payment" } });
    await expect(postLoanPayment({ rpc } as unknown as SupabaseClient, "t1", "rp1", 999_999)).rejects.toThrow("Interest must be between 0 and the payment");
  });
});
```

In `tests/unit/statement-review-service.test.ts`, add to the `deps` helper (after `postPair`):

```ts
  postLoan: vi.fn(async () => "JE-000012"),
```

and add this test inside `describe("postReviewItems", …)`:

```ts
  it("posts a loan item with the interest the person accepted", async () => {
    const d = deps();
    const outcomes = await postReviewItems(sb, [{ transactionId: "t1", kind: "loan", repaymentId: "rp1", interestMinor: 40_000 }], d);
    expect(outcomes).toEqual([{ id: "t1", ok: true, detail: "JE-000012" }]);
    expect(d.postLoan).toHaveBeenCalledWith(sb, "t1", "rp1", 40_000);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/loan-payments-service.test.ts tests/unit/statement-review-service.test.ts`
Expected: FAIL. The module does not resolve, and the loan item falls into the `categorise` branch.

- [ ] **Step 3: Write `lib/services/loan-payments.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { codingAccountOf } from "@/lib/domain/coding";
import { loanSuggestionsFrom, type LoanMovement, type LoanSuggestionView } from "@/lib/domain/loan-interest";
import type { RepaymentAccount } from "@/lib/domain/repayments";
import { listAccounts } from "./accounts";
import { listBankTransactions, listSuggestions } from "./banking";
import { readAllPages } from "./paging";
import { repaymentContext } from "./repayment-register";

/**
 * Loan instalments on bank lines (1.76): the balance each loan stands at on the
 * books, the split proposed for each waiting payment, and the one call that
 * posts it. The split itself is worked out in lib/domain/loan-interest.ts; the
 * posting's accounts and principal are the database's (migration 0130).
 */
export class LoanPaymentError extends Error {}
const fail = (message: string) => new LoanPaymentError(message);

/** The account each switched-on loan repays, each once. */
export function loanAccountIds(repayments: readonly RepaymentAccount[]): string[] {
  return [...new Set(repayments.filter((entry) => entry.kind === "loan" && entry.isActive).map((entry) => entry.accountId))];
}

/** Every posted line on these accounts, with its entry's date. */
export async function loadLoanMovements(sb: SupabaseClient, accountIds: readonly string[]): Promise<LoanMovement[]> {
  if (!accountIds.length) return [];
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_journal_line")
        .select("id,account_id,debit_minor,credit_minor,acc_journal_entry!inner(entry_date,status)")
        .in("account_id", [...accountIds])
        .eq("acc_journal_entry.status", "posted")
        .order("id")
        .range(from, to),
    fail,
  );
  return rows.map((row) => ({
    accountId: row.account_id as string,
    date: String((row.acc_journal_entry as { entry_date: string }).entry_date).slice(0, 10),
    debitMinor: Number(row.debit_minor),
    creditMinor: Number(row.credit_minor),
  }));
}

/**
 * For Bank Transactions: the proposed split of every waiting loan payment in
 * view (null is every bank account). The carry runs over every waiting line of
 * the company, so a split reads the same here as on Review import.
 */
export async function loanSuggestions(sb: SupabaseClient, bankAccountId: string | null): Promise<LoanSuggestionView[]> {
  const context = await repaymentContext(sb);
  const ids = loanAccountIds(context.repayments);
  if (!ids.length) return [];
  const [lines, matches, accounts, movements] = await Promise.all([
    listBankTransactions(sb, null),
    listSuggestions(sb, null),
    listAccounts(sb),
    loadLoanMovements(sb, ids),
  ]);
  const views = loanSuggestionsFrom({
    lines: lines
      .filter((row) => row.status === "unmatched" && !row.pending)
      .map((row) => ({
        id: row.id,
        bankAccountId: row.bank_account_id,
        date: row.txn_date,
        amountMinor: Number(row.amount_minor),
        description: row.description ?? "",
      })),
    repayments: context.repayments,
    baseCurrencyBankIds: context.baseCurrencyBankIds,
    accounts: new Map(accounts.map((row) => [row.id, codingAccountOf(row)])),
    movements,
    excludeIds: new Set(matches.map((match) => match.bank_transaction_id)),
  });
  if (!bankAccountId) return views;
  const inView = new Set(lines.filter((row) => row.bank_account_id === bankAccountId).map((row) => row.id));
  return views.filter((view) => inView.has(view.transactionId));
}

/** Post one loan payment: the database takes the accounts from the register and works out the principal. */
export async function postLoanPayment(
  sb: SupabaseClient,
  transactionId: string,
  repaymentId: string,
  interestMinor: number,
): Promise<{ entry_number: string | null; principal_minor: number; interest_minor: number }> {
  const { data, error } = await sb.rpc("acc_post_bank_loan_payment", {
    p_transaction_id: transactionId,
    p_repayment_id: repaymentId,
    p_interest_minor: interestMinor,
  });
  if (error) throw fail(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { entry_number: string | null; principal_minor: number; interest_minor: number };
  return { entry_number: row.entry_number ?? null, principal_minor: Number(row.principal_minor), interest_minor: Number(row.interest_minor) };
}
```

- [ ] **Step 4: Wire `lib/services/statement-review.ts`**

1. Imports:

```ts
import { loanSuggestionsFrom } from "@/lib/domain/loan-interest";
import { loadLoanMovements, loanAccountIds, postLoanPayment } from "./loan-payments";
```

2. The movements need the register, so they are read after the first `Promise.all`. Put this right after the line `const baseCode = (baseRow.data as { code: string } | null)?.code ?? "USD";`:

```ts
  const loanMovements = await loadLoanMovements(sb, loanAccountIds(context.repayments));
```

3. After the existing `repaymentRivalsOf` function, before `return {`:

```ts
  // Loan payments: the same split Bank Transactions shows, worked out over every
  // waiting line of the company so two payments to one loan carry in date order.
  const loans = new Map(
    loanSuggestionsFrom({
      lines: waiting.map((w) => ({
        id: w.id,
        bankAccountId: w.bank_account_id,
        date: w.txn_date,
        amountMinor: Number(w.amount_minor),
        description: w.description ?? "",
      })),
      repayments: context.repayments,
      baseCurrencyBankIds: context.baseCurrencyBankIds,
      accounts: chart,
      movements: loanMovements,
      excludeIds: new Set(bestMatch.keys()),
    }).map((view) => [view.transactionId, view]),
  );
```

4. In the `reviewProposal({ … })` call, after `repaymentRivals: repaymentRivalsOf(row),`:

```ts
          loan: loans.get(row.id) ?? null,
```

5. `ReviewPostDeps`, after `postPair`:

```ts
  /** Post a loan payment with the interest a person accepted; returns the entry number. */
  postLoan: (sb: SupabaseClient, transactionId: string, repaymentId: string, interestMinor: number) => Promise<string | null>;
```

6. `defaultDeps`, after `postPair: …,`:

```ts
  postLoan: async (sb, transactionId, repaymentId, interestMinor) =>
    (await postLoanPayment(sb, transactionId, repaymentId, interestMinor)).entry_number,
```

7. In `postReviewItems`, replace the final `} else {` branch (the categorise one) with:

```ts
      } else if (item.kind === "loan") {
        // The accounts and the principal are the database's; only the interest is ours.
        const entry = await deps.postLoan(sb, id, item.repaymentId, item.interestMinor);
        outcomes.push({ id, ok: true, detail: entry ?? "Posted" });
      } else {
```

(The body of that `else`, the categorise call, stays the same.)

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run tests/unit/loan-payments-service.test.ts tests/unit/statement-review-service.test.ts tests/unit/banking-paged-reads.test.ts && npm run typecheck`
Expected: tests PASS. Typecheck may still report the `ReviewImportClient.tsx` `counts` error; Task 8 fixes it. Report it, and no other error.

- [ ] **Step 6: Commit**

```bash
git add lib/services/loan-payments.ts lib/services/statement-review.ts tests/unit/loan-payments-service.test.ts tests/unit/statement-review-service.test.ts
# commit-msg.txt:
# feat(banking): loan payments proposed on Review import and Bank Transactions, posted through 0130
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 6: Registering loans — schemas, actions, the kind guard, a lighter preview

**Files:**
- Modify: `lib/domain/schemas.ts` (`repaymentInputSchema`, `reviewPostItemsSchema`, new `loanPaymentSchema`)
- Modify: `lib/services/coding.ts` (`loadHistory`)
- Modify: `lib/services/repayments.ts` (kind guard; reads)
- Modify: `app/(app)/banking/rules/actions.ts` (`saveRepaymentAction`)
- Modify: `app/(app)/banking/actions.ts` (two new actions)
- Test: `tests/unit/repayments-service.test.ts`, `tests/unit/coding-service.test.ts`

**Interfaces:**
- Consumes:
  - `kindChangeProblem` (Task 3);
  - `loanSuggestions`, `postLoanPayment` (Task 5);
  - `LoanSuggestionView` (Task 2).
- Produces:
  - `repaymentInputSchema`: a discriminated union on `kind`. A card carries `{ accountId, matchWords, matchDigits, isActive }`. A loan also carries `interestAccountId` (uuid), `interestMethod` (`rate`|`fixed`|`entered`), `annualRate` (number 0–100 or null) and `fixedInterestMinor` (int ≥ 0 or null).
  - `reviewPostItemsSchema` accepts `{ transactionId, kind: "loan", repaymentId, interestMinor }`.
  - `loanPaymentSchema` is `{ transactionId: uuid, repaymentId: uuid, interestMinor: int ≥ 0 }`.
  - `loadHistory(sb, accountIds?)`.
  - Actions: `getLoanSuggestionsAction(bankAccountId)` and `postLoanPaymentAction(raw)`, the latter returning `{ entry_number, principal_minor, interest_minor }`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/repayments-service.test.ts`, replace the test `"refuse a loan until loans ship, and digits that are not four"` with:

```ts
  it("take a loan with its interest account and method, and refuse one without", () => {
    const loan = { kind: "loan", accountId: id, matchWords: "example loan", matchDigits: null, isActive: true, interestAccountId: id, interestMethod: "rate", annualRate: 4.25, fixedInterestMinor: null };
    expect(repaymentInputSchema.safeParse(loan).success).toBe(true);
    expect(repaymentInputSchema.safeParse({ ...loan, interestAccountId: "" }).success).toBe(false);
    expect(repaymentInputSchema.safeParse({ ...loan, interestMethod: "monthly" }).success).toBe(false);
    expect(repaymentInputSchema.safeParse({ ...loan, annualRate: 101 }).success).toBe(false);
    expect(repaymentPreviewSchema.safeParse({ accountId: id, matchWords: "", matchDigits: "12a4" }).success).toBe(false);
  });
  it("take a loan post item and a loan payment, with whole-cent interest of zero or more", () => {
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "loan", repaymentId: id, interestMinor: 40_000 }]).success).toBe(true);
    expect(reviewPostItemsSchema.safeParse([{ transactionId: id, kind: "loan", repaymentId: id, interestMinor: -1 }]).success).toBe(false);
    expect(loanPaymentSchema.safeParse({ transactionId: id, repaymentId: id, interestMinor: 0 }).success).toBe(true);
    expect(loanPaymentSchema.safeParse({ transactionId: id, repaymentId: id, interestMinor: 1.5 }).success).toBe(false);
  });
```

Change that file's schema import to:

```ts
import { loanPaymentSchema, repaymentInputSchema, repaymentPreviewSchema, reviewPostItemsSchema } from "@/lib/domain/schemas";
```

In `tests/unit/coding-service.test.ts`, inside `describe("loadHistory", …)`, add:

```ts
  it("asks only for the accounts named, and nothing at all for none", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ range }));
    const inFn = vi.fn(() => ({ order }));
    const rpc = vi.fn(() => ({ in: inFn }));
    await loadHistory({ rpc } as unknown as SupabaseClient, ["acct-1"]);
    expect(rpc).toHaveBeenCalledWith("acc_coding_history");
    expect(inFn).toHaveBeenCalledWith("account_id", ["acct-1"]);
    const none = vi.fn();
    expect(await loadHistory({ rpc: none } as unknown as SupabaseClient, [])).toEqual([]);
    expect(none).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/repayments-service.test.ts tests/unit/coding-service.test.ts`
Expected: FAIL. A loan is refused by the card-only schema, `loanPaymentSchema` is undefined, and `loadHistory` ignores the accounts.

- [ ] **Step 3: The schemas**

In `lib/domain/schemas.ts`, replace the `repaymentInputSchema` block (and its comment) with:

```ts
/** A card or a loan, as the Cards and loans form saves it. */
export const repaymentInputSchema = z.discriminatedUnion("kind", [
  repaymentPreviewSchema.extend({ kind: z.literal("card"), isActive: z.boolean() }),
  repaymentPreviewSchema.extend({
    kind: z.literal("loan"),
    isActive: z.boolean(),
    interestAccountId: z.uuid("Choose the account interest posts to"),
    interestMethod: z.enum(["rate", "fixed", "entered"]),
    annualRate: z.number().min(0, "The rate a year is between 0 and 100%").max(100, "The rate a year is between 0 and 100%").nullable(),
    fixedInterestMinor: z.number().int().min(0).nullable(),
  }),
]);

/** One loan payment from Bank Transactions: the line, the loan, and the interest accepted. */
export const loanPaymentSchema = z.object({
  transactionId: z.uuid(),
  repaymentId: z.uuid(),
  interestMinor: z.number().int("Interest is a whole number of cents").min(0, "Interest cannot be below zero"),
});
```

In `reviewPostItemsSchema`, add a fifth member to the `z.discriminatedUnion("kind", [ … ])`:

```ts
      z.object({
        transactionId: z.uuid(),
        kind: z.literal("loan"),
        repaymentId: z.uuid(),
        interestMinor: z.number().int().min(0),
      }),
```

- [ ] **Step 4: `loadHistory` reads only what it is asked for**

In `lib/services/coding.ts`, replace `loadHistory` with:

```ts
/** Every finished entry coding learns from; with `accountIds`, only those whose other leg is on one of them. */
export async function loadHistory(sb: SupabaseClient, accountIds?: readonly string[]): Promise<HistorySource[]> {
  if (accountIds && accountIds.length === 0) return [];
  // entry_id is unique here: an entry is returned once, for its one bank leg.
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => {
      const history = sb.rpc("acc_coding_history");
      return (accountIds ? history.in("account_id", [...accountIds]) : history).order("entry_id").range(from, to);
    },
    fail,
  );
  return rows.map((row) => ({
    entryId: row.entry_id as string,
    date: String(row.entry_date),
    direction: row.direction as CodingDirection,
    accountId: row.account_id as string,
    texts: [row.bank_description, row.entry_description, row.other_memo].filter(
      (text): text is string => typeof text === "string" && text.trim() !== "",
    ),
  }));
}
```

- [ ] **Step 5: `lib/services/repayments.ts` — the guard and the lighter reads**

1. Imports: add `kindChangeProblem` and `type RepaymentKind` to the `@/lib/domain/repayments` import; add `import { readAllPages } from "./paging";`; remove `listBankTransactions` from the `./banking` import (and the whole import line if nothing else uses it).
2. Replace `statsGround`, `repaymentStats` and `previewRepayment` with:

```ts
type WaitingRow = { bank_account_id: string; description: string | null; amount_minor: number };

/** Waiting payments out, the only lines a card or loan can match. Read narrowly: only what the count needs. */
async function waitingPaymentsOut(sb: SupabaseClient): Promise<WaitingRow[]> {
  return readAllPages<WaitingRow>(
    (from, to) =>
      sb
        .from("acc_bank_transaction")
        .select("id,bank_account_id,description,amount_minor")
        .eq("status", "unmatched")
        .eq("pending", false)
        .is("provider_removed_at", null)
        .lt("amount_minor", 0)
        .order("id")
        .range(from, to),
    (message) => new RepaymentError(message),
  );
}

async function statsGround(
  sb: SupabaseClient,
  accountIds: readonly string[],
  lines?: readonly BankTransactionRow[],
): Promise<{ history: HistorySource[]; waiting: WaitingLine[] }> {
  // Prefetched lines (the Rules page reads them once) or a narrow read of its own; one shape either way.
  const fromLines = (rows: readonly BankTransactionRow[]): WaitingRow[] =>
    rows
      .filter((row) => row.status === "unmatched" && !row.pending)
      .map((row) => ({ bank_account_id: row.bank_account_id, description: row.description, amount_minor: Number(row.amount_minor) }));
  const [history, rows, bankIds] = await Promise.all([
    loadHistory(sb, accountIds),
    lines ? Promise.resolve(fromLines(lines)) : waitingPaymentsOut(sb),
    baseCurrencyBankIds(sb),
  ]);
  const waiting = rows.map((row) => ({
    description: row.description ?? "",
    amountMinor: Number(row.amount_minor),
    inBaseCurrency: bankIds.has(row.bank_account_id),
  }));
  return { history, waiting };
}

export async function repaymentStats(
  sb: SupabaseClient,
  entries: readonly RepaymentAccount[],
  lines?: readonly BankTransactionRow[],
): Promise<Record<string, RepaymentStats>> {
  if (!entries.length) return {};
  const { history, waiting } = await statsGround(sb, [...new Set(entries.map((entry) => entry.accountId))], lines);
  return Object.fromEntries(entries.map((entry) => [entry.id, repaymentStatsFrom(entry, history, waiting)]));
}

export async function previewRepayment(
  sb: SupabaseClient,
  input: { accountId: string; matchWords: string; matchDigits: string | null },
): Promise<RepaymentStats> {
  const { history, waiting } = await statsGround(sb, [input.accountId]);
  return repaymentStatsFrom(input, history, waiting);
}
```

3. In `saveRepayment`, immediately after `if (problem) throw new RepaymentError(problem);`:

```ts
  if (id) {
    const { data: existing, error: readError } = await sb.from("acc_repayment_account").select("kind").eq("id", id).maybeSingle();
    if (readError) throw new RepaymentError(readError.message);
    if (!existing) throw new RepaymentError("This entry is no longer in Cards and loans");
    const changed = kindChangeProblem((existing as { kind: RepaymentKind }).kind, input.kind);
    if (changed) throw new RepaymentError(changed);
  }
```

- [ ] **Step 6: The actions**

In `app/(app)/banking/rules/actions.ts`, replace the body of the `try` in `saveRepaymentAction` with:

```ts
    const sb = await createSupabaseServerClient();
    const input =
      parsed.data.kind === "card"
        ? { ...parsed.data, interestAccountId: null, interestMethod: null, annualRate: null, fixedInterestMinor: null }
        : parsed.data;
    const saved = await saveRepayment(sb, id, input);
    refresh();
    return { ok: true, data: { id: saved } };
```

In `app/(app)/banking/actions.ts`:

1. Imports:

```ts
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import { loanPaymentSchema } from "@/lib/domain/schemas";
import { loanSuggestions, postLoanPayment } from "@/lib/services/loan-payments";
```

   If `@/lib/domain/schemas` is already imported in this file, add `loanPaymentSchema` to that import instead.

2. Append:

```ts
/** The proposed split of each waiting loan payment in view. Null means every bank account. */
export async function getLoanSuggestionsAction(bankAccountId: string | null): Promise<ActionResult<LoanSuggestionView[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await loanSuggestions(sb, bankAccountId) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Post one loan payment with the interest a person accepted. */
export async function postLoanPaymentAction(
  raw: unknown,
): Promise<ActionResult<{ entry_number: string | null; principal_minor: number; interest_minor: number }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsed = loanPaymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid loan payment" };
  try {
    const sb = await createSupabaseServerClient();
    const posted = await postLoanPayment(sb, parsed.data.transactionId, parsed.data.repaymentId, parsed.data.interestMinor);
    revalidatePath("/banking");
    revalidatePath("/reports");
    return { ok: true, data: posted };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 7: Run the tests, the typecheck and lint**

Run: `npx vitest run tests/unit/repayments-service.test.ts tests/unit/coding-service.test.ts tests/unit/banking-paged-reads.test.ts && npm run typecheck && npm run lint`
Expected: tests PASS. Typecheck may still show only the Task 8 `counts` error in `ReviewImportClient.tsx`. Lint reports 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib/domain/schemas.ts lib/services/coding.ts lib/services/repayments.ts "app/(app)/banking/rules/actions.ts" "app/(app)/banking/actions.ts" tests/unit/repayments-service.test.ts tests/unit/coding-service.test.ts
# commit-msg.txt:
# feat(banking): register loans; an entry keeps its kind; the preview reads only what it counts
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 7: Add loan on Banking › Rules

**Files:**
- Rewrite: `app/(app)/banking/rules/RepaymentFormModal.tsx`
- Rewrite: `app/(app)/banking/rules/RepaymentsSection.tsx`
- Modify: `app/(app)/banking/rules/page.tsx`

**Interfaces:**
- Consumes:
  - `saveRepaymentAction` and `previewRepaymentAction` (loan-aware since Task 6);
  - `suggestInterestAccount` (Task 2);
  - `repaysAccountAllowed`, `interestAccountAllowed`, `usableRepayment`, `seedWords`, `seedDigits`, types `InterestMethod`, `RepaymentKind`, `RepaymentAccount` (1.75 domain).
- Produces:
  - `RepaymentListRow` gains `interestLabel: string | null`.
  - `RepaymentsSection({ rows, cardAccounts, loanAccounts, interestAccounts, suggestedInterestId, canWrite })`.

- [ ] **Step 1: Rewrite `RepaymentFormModal.tsx`**

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Form, Input, InputNumber, Modal, Radio, Select, Switch, Typography } from "antd";
import type { AccountRow } from "@/lib/db/types";
import { seedDigits, seedWords, type InterestMethod, type RepaymentKind } from "@/lib/domain/repayments";
import type { RepaymentStats } from "@/lib/services/repayments";
import { previewRepaymentAction, saveRepaymentAction } from "./actions";
import styles from "./repayments.module.css";

export interface RepaymentFormValues {
  accountId: string | null;
  matchWords: string;
  matchDigits: string;
  isActive: boolean;
  /** Loans only. */
  interestAccountId: string | null;
  interestMethod: InterestMethod;
  /** Percent a year. */
  annualRate: number | null;
  /** Dollars per payment. */
  fixedInterest: number | null;
}

export const EMPTY_REPAYMENT: RepaymentFormValues = {
  accountId: null,
  matchWords: "",
  matchDigits: "",
  isActive: true,
  interestAccountId: null,
  interestMethod: "rate",
  annualRate: null,
  fixedInterest: null,
};

export function toRepaymentInput(kind: RepaymentKind, values: RepaymentFormValues) {
  const digits = (values.matchDigits ?? "").trim();
  const common = {
    accountId: values.accountId ?? "",
    matchWords: (values.matchWords ?? "").trim(),
    matchDigits: digits === "" ? null : digits,
    isActive: values.isActive,
  };
  if (kind === "card") return { kind: "card" as const, ...common };
  return {
    kind: "loan" as const,
    ...common,
    interestAccountId: values.interestAccountId ?? "",
    interestMethod: values.interestMethod,
    annualRate: values.interestMethod === "rate" ? values.annualRate : null,
    fixedInterestMinor:
      values.interestMethod === "fixed" && values.fixedInterest !== null && values.fixedInterest !== undefined
        ? Math.round(values.fixedInterest * 100)
        : null,
  };
}

/**
 * Add or change a card or a loan. Choosing the account fills in the words and
 * last four from its name; the preview then says how many past payments to
 * that account those words catch, and which they miss, before anything is
 * saved. A loan also says where its interest goes and how it is worked out.
 */
export default function RepaymentFormModal({
  open,
  kind,
  repaymentId,
  initial,
  accounts,
  interestAccounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: RepaymentKind;
  repaymentId: string | null;
  initial: RepaymentFormValues;
  /** Accounts this kind may repay, not yet registered, plus this entry's own. */
  accounts: AccountRow[];
  /** Active posting expense and other-expense accounts. */
  interestAccounts: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RepaymentFormValues>();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<RepaymentStats | null>(null);
  const watched = Form.useWatch([], form) as RepaymentFormValues | undefined;
  const method = watched?.interestMethod ?? initial.interestMethod;
  const noun = kind === "card" ? "card" : "loan";

  const previewKey = useMemo(() => {
    if (!watched?.accountId) return "";
    const { accountId, matchWords, matchDigits } = toRepaymentInput("card", { ...EMPTY_REPAYMENT, ...watched });
    if (!matchWords && !matchDigits) return "";
    if (matchDigits && !/^\d{4}$/.test(matchDigits)) return "";
    return JSON.stringify({ accountId, matchWords, matchDigits });
  }, [watched]);

  useEffect(() => {
    if (!open || !previewKey) return;
    const timer = setTimeout(() => {
      void previewRepaymentAction(JSON.parse(previewKey)).then((res) => {
        if (res.ok && res.data) setPreview(res.data);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [open, previewKey]);

  const options = useMemo(
    () => accounts.map((account) => ({ value: account.id, label: `${account.account_code} — ${account.name}` })),
    [accounts],
  );
  const interestOptions = useMemo(
    () => interestAccounts.map((account) => ({ value: account.id, label: `${account.account_code} — ${account.name}` })),
    [interestAccounts],
  );

  function close() {
    setPreview(null);
    onClose();
  }

  // A new entry takes its words and digits from the account's name, until the person types their own.
  function onValuesChange(changed: Partial<RepaymentFormValues>) {
    if (repaymentId || !("accountId" in changed)) return;
    const account = accounts.find((a) => a.id === changed.accountId);
    if (!account) return;
    if (!form.isFieldTouched("matchWords")) form.setFieldValue("matchWords", seedWords(account.name));
    if (!form.isFieldTouched("matchDigits")) form.setFieldValue("matchDigits", seedDigits(account.name) ?? "");
  }

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await saveRepaymentAction(repaymentId, toRepaymentInput(kind, { ...EMPTY_REPAYMENT, ...values }));
    setSaving(false);
    if (!res.ok) {
      message.error(res.error ?? `Could not save the ${noun}`);
      return;
    }
    message.success(`${kind === "card" ? "Card" : "Loan"} ${repaymentId ? "saved" : "added"}`);
    setPreview(null);
    onSaved();
  }

  const s = (n: number) => (n === 1 ? "" : "s");
  return (
    <Modal
      open={open}
      title={`${repaymentId ? "Edit" : "Add"} ${noun}`}
      okText={`${repaymentId ? "Save" : "Add"} ${noun}`}
      confirmLoading={saving}
      onOk={submit}
      onCancel={close}
      destroyOnHidden
      width={620}
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={initial} onValuesChange={onValuesChange}>
        <Form.Item
          name="accountId"
          label={kind === "card" ? "Card account" : "Loan account"}
          rules={[{ required: true, message: `Choose the ${noun} account` }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={kind === "card" ? "Choose a Credit Card account" : "Choose a liability account"}
            options={options}
            disabled={repaymentId !== null}
          />
        </Form.Item>
        <Form.Item
          name="matchWords"
          label="Words your bank prints for these payments"
          extra="Separate several with commas. Each is matched as whole words, in any case."
          rules={[{ max: 200, message: "Words are at most 200 characters" }]}
        >
          <Input placeholder={kind === "card" ? "example card, example card epay" : "example loan, loan pmt"} />
        </Form.Item>
        <Form.Item
          name="matchDigits"
          label="Last four digits (optional)"
          rules={[{ pattern: /^\d{4}$/, message: "The last four are exactly four digits" }]}
        >
          <Input maxLength={4} inputMode="numeric" style={{ width: 120 }} />
        </Form.Item>
        {kind === "loan" ? (
          <>
            <Form.Item name="interestAccountId" label="Interest posts to" rules={[{ required: true, message: "Choose the account interest posts to" }]}>
              <Select showSearch optionFilterProp="label" placeholder="Choose an expense account" options={interestOptions} />
            </Form.Item>
            <Form.Item name="interestMethod" label="Interest on each payment">
              <Radio.Group
                optionType="button"
                options={[
                  { value: "rate", label: "A rate a year" },
                  { value: "fixed", label: "A fixed amount" },
                  { value: "entered", label: "Typed each time" },
                ]}
              />
            </Form.Item>
            {method === "rate" ? (
              <Form.Item
                name="annualRate"
                label="Rate a year"
                extra="Interest proposed = balance owed on the books × this rate ÷ 12. You can change it on every payment."
                rules={[{ required: true, message: "Give the rate a year" }]}
              >
                <InputNumber min={0} max={100} precision={3} suffix="%" style={{ width: 160 }} />
              </Form.Item>
            ) : null}
            {method === "fixed" ? (
              <Form.Item name="fixedInterest" label="Interest on each payment" rules={[{ required: true, message: "Give the fixed interest per payment" }]}>
                <InputNumber min={0} precision={2} prefix="$" style={{ width: 160 }} />
              </Form.Item>
            ) : null}
            {method === "entered" ? (
              <Typography.Paragraph type="secondary">
                No interest is proposed. Each payment waits until the interest from the lender&apos;s statement is typed in.
              </Typography.Paragraph>
            ) : null}
          </>
        ) : null}
        <Form.Item name="isActive" label="On" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
      {preview ? (
        <div className={styles.preview}>
          <Typography.Text strong>
            {preview.past === 0
              ? "No past payments to this account yet"
              : `Catches ${preview.caught} of ${preview.past} past payment${s(preview.past)} to this account`}
            {` · ${preview.waiting} waiting line${s(preview.waiting)}`}
          </Typography.Text>
          {preview.missed.length ? (
            <>
              <Typography.Text type="secondary" className={styles.missed}>
                Missed — add the words these use:
              </Typography.Text>
              {preview.missed.map((miss, i) => (
                <Typography.Text key={`${miss.date}-${i}`} type="secondary" className={styles.missed}>
                  {miss.date} · {miss.text}
                </Typography.Text>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
```

- [ ] **Step 2: Rewrite `RepaymentsSection.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Space, Switch, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import IconActionButton from "@/components/ui/IconActionButton";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import type { AccountRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import type { RepaymentAccount, RepaymentKind } from "@/lib/domain/repayments";
import { formatMoney } from "@/lib/format";
import type { RepaymentStats } from "@/lib/services/repayments";
import RepaymentFormModal, { EMPTY_REPAYMENT, toRepaymentInput, type RepaymentFormValues } from "./RepaymentFormModal";
import { deleteRepaymentAction, saveRepaymentAction } from "./actions";
import styles from "./repayments.module.css";

export interface RepaymentListRow extends RepaymentAccount {
  accountLabel: string;
  /** "8100 — Interest Expense"; null for a card. */
  interestLabel: string | null;
  /** False when an account is no longer an active posting account of the right type. */
  accountUsable: boolean;
  stats: RepaymentStats;
}

const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

const valuesOf = (entry: RepaymentAccount): RepaymentFormValues => ({
  accountId: entry.accountId,
  matchWords: entry.matchWords,
  matchDigits: entry.matchDigits ?? "",
  isActive: entry.isActive,
  interestAccountId: entry.interestAccountId,
  interestMethod: entry.interestMethod ?? "rate",
  annualRate: entry.annualRate,
  fixedInterest: entry.fixedInterestMinor === null ? null : entry.fixedInterestMinor / 100,
});

function interestText(row: RepaymentListRow): string {
  if (row.kind === "card") return "—";
  const to = row.interestLabel ?? "an account not found";
  if (row.interestMethod === "rate") return `${(row.annualRate ?? 0).toFixed(3)}% a year → ${to}`;
  if (row.interestMethod === "fixed") return `${money(row.fixedInterestMinor ?? 0)} each payment → ${to}`;
  return `Typed each time → ${to}`;
}

/**
 * Cards and loans: which payments out of the bank repay a balance. A line that
 * carries an entry's words or last four is offered as a card or loan payment
 * before any rule: paying a card is never an expense, and of a loan payment
 * only the interest is.
 */
export default function RepaymentsSection({
  rows,
  cardAccounts,
  loanAccounts,
  interestAccounts,
  suggestedInterestId,
  canWrite,
}: {
  rows: RepaymentListRow[];
  cardAccounts: AccountRow[];
  loanAccounts: AccountRow[];
  interestAccounts: AccountRow[];
  suggestedInterestId: string | null;
  canWrite: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<{ kind: RepaymentKind; id: string | null; values: RepaymentFormValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const taken = new Set(rows.map((row) => row.accountId));
  const free = (accounts: AccountRow[]) => accounts.filter((account) => !taken.has(account.id) || account.id === editing?.values.accountId);
  const allCardsTaken = cardAccounts.every((a) => taken.has(a.id));
  const allLoansTaken = loanAccounts.every((a) => taken.has(a.id));

  async function setActive(row: RepaymentListRow, isActive: boolean) {
    setBusy(row.id);
    const res = await saveRepaymentAction(row.id, toRepaymentInput(row.kind, { ...valuesOf(row), isActive }));
    setBusy(null);
    if (!res.ok) {
      message.error(res.error ?? `Could not change the ${row.kind}`);
      return;
    }
    router.refresh();
  }

  function remove(row: RepaymentListRow) {
    modal.confirm({
      title: `Remove this ${row.kind}?`,
      content: `${row.accountLabel}. Lines already posted stay as they are; new ones are no longer recognized as payments to it.`,
      okText: `Remove ${row.kind}`,
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await deleteRepaymentAction(row.id);
        if (!res.ok) {
          message.error(res.error ?? `Could not remove the ${row.kind}`);
          return;
        }
        message.success(`${row.kind === "card" ? "Card" : "Loan"} removed`);
        router.refresh();
      },
    });
  }

  const columns: TableColumnsType<RepaymentListRow> = [
    { title: "Kind", key: "kind", width: COLUMN.ACTION * 2, render: (_: unknown, row: RepaymentListRow) => <Tag>{row.kind === "card" ? "Card" : "Loan"}</Tag> },
    {
      title: "Account",
      key: "account",
      width: COLUMN.PICKER + COLUMN.ACTION * 2,
      render: (_: unknown, row: RepaymentListRow) =>
        row.accountUsable ? (
          <Typography.Text ellipsis={{ tooltip: row.accountLabel }}>{row.accountLabel}</Typography.Text>
        ) : (
          <Tooltip title="An account here is inactive, not a posting account, or no longer the right type: a card repays a Credit Card account; a loan repays a liability, with interest to an expense. Nothing is recognized as a payment to it until it is changed.">
            <Tag color="orange">{row.accountLabel}</Tag>
          </Tooltip>
        ),
    },
    {
      ...flexColumn<RepaymentListRow>({
        title: "Matches on",
        key: "match",
        render: (_: unknown, row: RepaymentListRow) => (
          <Space size={6} wrap>
            {row.matchWords ? <Typography.Text code>{row.matchWords}</Typography.Text> : null}
            {row.matchDigits ? <Typography.Text code>••{row.matchDigits}</Typography.Text> : null}
          </Space>
        ),
      }),
    },
    {
      title: "Interest",
      key: "interest",
      width: COLUMN.RICH_MIN,
      render: (_: unknown, row: RepaymentListRow) => (
        <Typography.Text type={row.kind === "card" ? "secondary" : undefined} ellipsis={{ tooltip: interestText(row) }}>
          {interestText(row)}
        </Typography.Text>
      ),
    },
    {
      title: "Past payments caught",
      key: "past",
      width: COLUMN.PICKER,
      align: "right",
      render: (_: unknown, row: RepaymentListRow) => (row.stats.past === 0 ? "—" : `${row.stats.caught} of ${row.stats.past}`),
    },
    {
      title: "Waiting lines",
      key: "waiting",
      width: COLUMN.STATUS,
      align: "right",
      render: (_: unknown, row: RepaymentListRow) => row.stats.waiting,
    },
    {
      title: "On",
      key: "active",
      width: COLUMN.ACTION * 2,
      render: (_: unknown, row: RepaymentListRow) => (
        <Switch size="small" checked={row.isActive} disabled={!canWrite} loading={busy === row.id} onChange={(checked) => void setActive(row, checked)} />
      ),
    },
    ...(canWrite
      ? [
          {
            title: "",
            key: "actions",
            width: COLUMN.ACTION * 2,
            align: "right" as const,
            render: (_: unknown, row: RepaymentListRow) => (
              <Space size={2}>
                <IconActionButton label={`Edit ${row.kind}`} icon={<EditOutlined />} onClick={() => setEditing({ kind: row.kind, id: row.id, values: valuesOf(row) })} />
                <IconActionButton label={`Remove ${row.kind}`} icon={<DeleteOutlined />} onClick={() => remove(row)} />
              </Space>
            ),
          } as TableColumnsType<RepaymentListRow>[number],
        ]
      : []),
  ];

  return (
    <section className={styles.section} aria-labelledby="repayments-heading">
      <Typography.Text strong id="repayments-heading">
        Cards and loans
      </Typography.Text>
      <Typography.Paragraph type="secondary" className={styles.lede}>
        A payment to a credit card repays its balance — the costs were the card&apos;s own charges — and a loan instalment is
        principal plus interest, of which only the interest is an expense. Add each card or loan with the words your bank
        prints for its payments, or its last four digits, and such a line is offered as a card or loan payment before any rule.
      </Typography.Paragraph>
      {canWrite ? (
        <Space style={{ marginBottom: 12 }} wrap>
          <Button icon={<PlusOutlined />} disabled={allCardsTaken} onClick={() => setEditing({ kind: "card", id: null, values: EMPTY_REPAYMENT })}>
            Add card
          </Button>
          <Button
            icon={<PlusOutlined />}
            disabled={allLoansTaken || interestAccounts.length === 0}
            onClick={() => setEditing({ kind: "loan", id: null, values: { ...EMPTY_REPAYMENT, interestAccountId: suggestedInterestId } })}
          >
            Add loan
          </Button>
          {cardAccounts.length === 0 ? (
            <Typography.Text type="secondary">Add a Credit Card account in Chart of Accounts to register a card.</Typography.Text>
          ) : allCardsTaken ? (
            <Typography.Text type="secondary">Every Credit Card account is already here.</Typography.Text>
          ) : null}
          {interestAccounts.length === 0 ? (
            <Typography.Text type="secondary">Add an Interest Expense account in Chart of Accounts to register a loan.</Typography.Text>
          ) : null}
        </Space>
      ) : null}
      <DataTable<RepaymentListRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={false}
        emptyTitle="No cards or loans yet"
        emptyDescription="Until a card or loan is added here, its payments are suggested by rules and history like any other line."
      />
      {editing ? (
        <RepaymentFormModal
          key={`${editing.kind}-${editing.id ?? "new"}`}
          open
          kind={editing.kind}
          repaymentId={editing.id}
          initial={editing.values}
          accounts={free(editing.kind === "card" ? cardAccounts : loanAccounts)}
          interestAccounts={interestAccounts}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Wire `page.tsx`**

In `app/(app)/banking/rules/page.tsx`:

1. Change the repayments domain import and add `suggestInterestAccount`:

```ts
import { interestAccountAllowed, repaysAccountAllowed, usableRepayment } from "@/lib/domain/repayments";
import { suggestInterestAccount } from "@/lib/domain/loan-interest";
```

2. In `repaymentRows`, add `interestLabel`:

```ts
  const repaymentRows: RepaymentListRow[] = repayments.map((entry) => ({
    ...entry,
    accountLabel: labelOf(entry.accountId),
    interestLabel: entry.interestAccountId ? labelOf(entry.interestAccountId) : null,
    accountUsable: usableRepayment({ ...entry, isActive: true }, chart),
    stats: stats[entry.id] ?? { past: 0, caught: 0, waiting: 0, missed: [] },
  }));
```

3. Replace the `<RepaymentsSection … />` element with:

```tsx
      <RepaymentsSection
        rows={repaymentRows}
        cardAccounts={accounts.filter((account) => repaysAccountAllowed("card", codingAccountOf(account)))}
        loanAccounts={accounts.filter((account) => repaysAccountAllowed("loan", codingAccountOf(account)))}
        interestAccounts={accounts.filter((account) => interestAccountAllowed(codingAccountOf(account)))}
        suggestedInterestId={suggestInterestAccount([...chart.values()])}
        canWrite={canWrite(role)}
      />
```

4. In the `PageHeader` description, replace "A card in Cards and loans is recognized first;" with "A card or loan in Cards and loans is recognized first;".

- [ ] **Step 4: Typecheck, lint, RSC test**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit/rsc-antd.test.ts`
Expected: lint reports 0 errors and the RSC test passes. Typecheck may still show only the Task 8 `counts` error. If `InputNumber` rejects `suffix`, use `addonAfter="%"` and say so in the report.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/banking/rules/RepaymentFormModal.tsx" "app/(app)/banking/rules/RepaymentsSection.tsx" "app/(app)/banking/rules/page.tsx"
# commit-msg.txt:
# feat(banking): Add loan on Bank Rules, with where its interest goes and how it is worked out
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 8: The Split dialog, on Review import and Bank Transactions

**Files:**
- Create: `app/(app)/banking/LoanSplitModal.tsx`
- Modify: `app/(app)/banking/imports/[id]/ReviewImportClient.tsx`
- Modify: `app/(app)/banking/CategoriseCell.tsx`
- Modify: `app/(app)/banking/BankTransactionsTable.tsx`
- Modify: `app/(app)/banking/BankingClient.tsx`

**Interfaces:**
- Consumes:
  - `LoanSuggestionView`, `splitText` (Task 2);
  - the `loan` proposal and `itemFromValue(id, value, interest)` (Task 3);
  - `postingsByLine` (Task 4);
  - `getLoanSuggestionsAction`, `postLoanPaymentAction` (Task 6).
- Produces: `LoanSplitModal({ paymentMinor, initialInterestMinor, basis, loanAccountLabel, interestAccountLabel, okText, confirmLoading, onCancel, onConfirm })`. Mount it only while open, so its state starts fresh each time.

- [ ] **Step 1: Write `LoanSplitModal.tsx`**

```tsx
"use client";
import { useState } from "react";
import { InputNumber, Modal, Space, Typography } from "antd";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";

/**
 * The split of one loan payment. The interest can be changed to the lender's
 * figure; the principal is what is left and is not typed. The two accounts are
 * the loan's own, from Cards and loans. Mounted only while open, so it starts
 * from the proposal every time.
 */
export default function LoanSplitModal({
  paymentMinor,
  initialInterestMinor,
  basis,
  loanAccountLabel,
  interestAccountLabel,
  okText,
  confirmLoading = false,
  onCancel,
  onConfirm,
}: {
  /** The payment, as a positive number. */
  paymentMinor: number;
  initialInterestMinor: number | null;
  basis: string;
  loanAccountLabel: string;
  interestAccountLabel: string;
  okText: string;
  confirmLoading?: boolean;
  onCancel: () => void;
  onConfirm: (interestMinor: number) => void;
}) {
  const [interest, setInterest] = useState<number | null>(initialInterestMinor === null ? null : initialInterestMinor / 100);
  const interestMinor = interest === null ? null : Math.round(interest * 100);
  const valid = interestMinor !== null && interestMinor >= 0 && interestMinor <= paymentMinor;
  const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);

  return (
    <Modal
      open
      title="Split loan payment"
      okText={okText}
      okButtonProps={{ disabled: !valid }}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => {
        if (valid && interestMinor !== null) onConfirm(interestMinor);
      }}
      width={520}
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Typography.Text>
          Payment <Typography.Text strong>{money(paymentMinor)}</Typography.Text>
        </Typography.Text>
        <div>
          <Typography.Text strong style={{ display: "block" }}>
            Interest to {interestAccountLabel}
          </Typography.Text>
          <InputNumber
            aria-label="Interest"
            min={0}
            max={paymentMinor / 100}
            precision={2}
            prefix="$"
            value={interest}
            onChange={(value) => setInterest(value === null ? null : Number(value))}
            style={{ width: 180 }}
          />
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
            {basis}
          </Typography.Text>
        </div>
        <Typography.Text>
          Principal to {loanAccountLabel}:{" "}
          <Typography.Text strong>{valid && interestMinor !== null ? money(paymentMinor - interestMinor) : "—"}</Typography.Text>
        </Typography.Text>
      </Space>
    </Modal>
  );
}
```

- [ ] **Step 2: Review import**

In `app/(app)/banking/imports/[id]/ReviewImportClient.tsx`:

1. Imports:

```ts
import { splitText } from "@/lib/domain/loan-interest";
import LoanSplitModal from "../../LoanSplitModal";
```

2. After the `ruleSeed` state:

```ts
  // A loan line's interest: the proposal's estimate until a person changes it in Split….
  const [interests, setInterests] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(lines.flatMap((line) => (line.proposal.kind === "loan" ? [[line.id, line.proposal.loan.interestMinor]] : []))),
  );
  const [splitting, setSplitting] = useState<ReviewLineView | null>(null);
```

3. `counts`: add `loan: 0` to the initial object:

```ts
    const c = { match: 0, document: 0, transfer: 0, funding: 0, account: 0, loan: 0, none: 0, handled: 0 };
```

4. `postable` keeps only lines that can actually be posted, so a loan with no interest yet is never counted:

```ts
  const itemOf = (id: string) => itemFromValue(id, choices[id] ?? null, interests[id] ?? null);
  const postable = ticked.filter((id) => choices[id] && open(id) && itemOf(id) !== null);
```

5. In `post()`, build the items through `itemOf`:

```ts
    const items = dedupePairItems(postable.map(itemOf).filter((item): item is ReviewPostItem => item !== null));
```

6. In `whyOf`, before `if (chosen && chosen !== own) return "Chosen by you";`:

```ts
    if (line.proposal.kind === "loan" && chosen === own) {
      const interest = interests[line.id] ?? null;
      const { loan } = line.proposal;
      if (interest !== null && interest !== loan.interestMinor) {
        return `${splitText(loan.paymentMinor - interest, interest, loan.loanAccountLabel, loan.interestAccountLabel)} — chosen by you`;
      }
    }
```

7. In the Post as column, after the `whyOf` text and before the **Create rule** button:

```tsx
            {p.kind === "loan" && choices[line.id] === ownValue ? (
              <Button type="link" size="small" style={{ padding: 0, height: "auto", fontSize: 12, marginRight: 12 }} onClick={() => setSplitting(line)}>
                Split…
              </Button>
            ) : null}
```

8. `getCheckboxProps`: a loan without interest cannot be ticked:

```ts
                getCheckboxProps: (line: ReviewLineView) => ({ disabled: line.proposal.kind === "handled" || !choices[line.id] || itemOf(line.id) === null }),
```

9. Header sentence: after the card payments count, add the loan count:

```tsx
          {counts.transfer === 1 ? "" : "s"} · {cardPayments} card payment{cardPayments === 1 ? "" : "s"} · {counts.loan} loan payment
          {counts.loan === 1 ? "" : "s"} · {counts.account - cardPayments} have an
```

10. Before `<RuleFormModal`, mount the dialog:

```tsx
      {splitting && splitting.proposal.kind === "loan" ? (
        <LoanSplitModal
          key={splitting.id}
          paymentMinor={splitting.proposal.loan.paymentMinor}
          initialInterestMinor={interests[splitting.id] ?? null}
          basis={splitting.proposal.loan.basis}
          loanAccountLabel={splitting.proposal.loan.loanAccountLabel}
          interestAccountLabel={splitting.proposal.loan.interestAccountLabel}
          okText="Use this split"
          onCancel={() => setSplitting(null)}
          onConfirm={(interestMinor) => {
            const id = splitting.id;
            setInterests((current) => ({ ...current, [id]: interestMinor }));
            // Accepting a split is a person checking the figure: the line is ticked.
            setTicked((current) => (current.includes(id) ? current : [...current, id]));
            setSplitting(null);
          }}
        />
      ) : null}
```

- [ ] **Step 3: Bank Transactions — the Category cell**

In `app/(app)/banking/CategoriseCell.tsx`:

1. Imports:

```ts
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import LoanSplitModal from "./LoanSplitModal";
import { categoriseBankTransactionAction, postLoanPaymentAction, uncategoriseBankTransactionAction } from "./actions";
```

   (The last line replaces the existing `./actions` import.)

2. Props: `posting` may name the entry's other accounts, and a loan suggestion arrives:

```ts
  /** What this line was posted to, when it has been; `others` names the rest of a split entry. */
  posting: (BankPostingRow & { others?: string[] }) | null;
```

   and, after `suggestion?:`:

```ts
  /** A registered loan's proposed split, for a waiting loan payment. */
  loan?: LoanSuggestionView | null;
```

   Add `loan = null,` to the destructured parameters.

3. After `const [query, setQuery] = useState("");`:

```ts
  const [splitting, setSplitting] = useState(false);
```

4. After the `post` function:

```ts
  async function postLoan(interestMinor: number) {
    if (!loan) return;
    setBusy(true);
    const res = await postLoanPaymentAction({ transactionId, repaymentId: loan.repaymentId, interestMinor });
    setBusy(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Could not post this loan payment");
      return;
    }
    const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
    message.success(
      `Posted${res.data.entry_number ? ` as ${res.data.entry_number}` : ""}: principal ${money(res.data.principal_minor)}, interest ${money(res.data.interest_minor)}`,
    );
    setSplitting(false);
    onChanged();
  }
```

5. After the `suggested` constant:

```tsx
  /** A loan payment is two accounts, so it is posted from the Split dialog, never from Use. */
  const loanSuggested = (withSplit: boolean) =>
    loan ? (
      <>
        <Tooltip title={loan.why}>
          <Typography.Text type="secondary" style={{ ...small, display: "block", maxWidth: "100%" }} ellipsis>
            → {loan.label}
          </Typography.Text>
        </Tooltip>
        {withSplit ? (
          <Button type="link" size="small" style={linkStyle} loading={busy} onClick={() => setSplitting(true)}>
            Split…
          </Button>
        ) : null}
      </>
    ) : null;
  const splitDialog =
    splitting && loan ? (
      <LoanSplitModal
        paymentMinor={loan.paymentMinor}
        initialInterestMinor={loan.interestMinor}
        basis={loan.basis}
        loanAccountLabel={loan.loanAccountLabel}
        interestAccountLabel={loan.interestAccountLabel}
        okText="Post"
        confirmLoading={busy}
        onCancel={() => setSplitting(false)}
        onConfirm={(interestMinor) => void postLoan(interestMinor)}
      />
    ) : null;
```

6. In the `if (posting)` branch, name the other accounts. Replace:

```tsx
    const label = `${posting.account_code} — ${posting.account_name}`;
```

   with:

```tsx
    const main = `${posting.account_code} — ${posting.account_name}`;
    const others = posting.others ?? [];
    const label = others.length ? `${main} + ${others.length} more` : main;
    const everyAccount = [main, ...others].join("; ");
```

   and change that branch's `<Typography.Text ellipsis={{ tooltip: label }}>{label}</Typography.Text>` to:

```tsx
        <Typography.Text ellipsis={{ tooltip: everyAccount }}>{label}</Typography.Text>
```

7. In the read-only branch (`if (!canWrite)`), show the loan too:

```tsx
  if (!canWrite) {
    return suggestion || loan ? (
      <div style={{ width: "100%", minWidth: 0 }}>
        {suggested(false)}
        {loanSuggested(false)}
      </div>
    ) : (
      <Typography.Text type="secondary">—</Typography.Text>
    );
  }
```

8. In the final return, after `{suggested(true)}`:

```tsx
      {loanSuggested(true)}
      {splitDialog}
```

- [ ] **Step 4: Bank Transactions — the table and the screen**

In `app/(app)/banking/BankTransactionsTable.tsx`:

1. Import the type:

```ts
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
```

2. Props: change `postings` and add `loanSuggestions`:

```ts
  /** What each matched line was posted to, keyed by transaction; `others` names the rest of a split entry. */
  postings: Map<string, BankPostingRow & { others?: string[] }>;
```

```ts
  /** The proposed split of each waiting loan payment, keyed by transaction. */
  loanSuggestions: Map<string, LoanSuggestionView>;
```

   Add `loanSuggestions,` to the destructured parameters.

3. In the Category column, pass the loan:

```tsx
            loan={loanSuggestions.get(row.transaction.id) ?? null}
```

In `app/(app)/banking/BankingClient.tsx`:

1. Imports:

```ts
import { postingsByLine } from "@/lib/domain/bank-postings";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
```

   Add `getLoanSuggestionsAction` to the existing import from `./actions`.

2. State: change the `postings` state type, and add `loans` next to `coding`:

```ts
  const [postings, setPostings] = useState<Map<string, BankPostingRow & { others: string[] }>>(new Map());
```

```ts
  const [loans, setLoans] = useState<Map<string, LoanSuggestionView>>(new Map());
```

3. In `reload`, after the `getCodingSuggestionsAction` call:

```ts
    void getLoanSuggestionsAction(accountFilter).then((res) => {
      if (res.ok && res.data) setLoans(new Map(res.data.map((view) => [view.transactionId, view])));
    });
```

   and replace `setPostings(new Map(posted.data.map((row) => [row.bank_transaction_id, row])));` with:

```ts
      setPostings(postingsByLine(posted.data));
```

4. On `<BankTransactionsTable … />`, after `codingSuggestions={coding}`:

```tsx
        loanSuggestions={loans}
```

- [ ] **Step 5: Typecheck, lint, the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck 0 errors; lint 0 errors; the full suite passes. Report the summary line untrimmed.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/banking/LoanSplitModal.tsx" "app/(app)/banking/imports/[id]/ReviewImportClient.tsx" "app/(app)/banking/CategoriseCell.tsx" "app/(app)/banking/BankTransactionsTable.tsx" "app/(app)/banking/BankingClient.tsx"
# commit-msg.txt:
# feat(banking): Split… a loan payment on Review import and Bank Transactions
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 9: `scripts/verify-loan-payment.mjs` — 0130 on every company, rolled back

**Files:**
- Create: `scripts/verify-loan-payment.mjs`

**Interfaces:**
- Consumes:
  - migration 0130 (Task 1);
  - `acc_repayment_account` (0129, live);
  - `acc_uncategorise_bank_transaction(p_transaction_id uuid, p_reason text)`.

- [ ] **Step 1: Write the script**

```js
/**
 * Behavioural verification of migration 0130 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0130 has not been applied it is applied first, inside that transaction,
 * and every account, bank account, register entry and bank line the checks
 * need is made there too — so nothing is left behind.
 *
 * Run: node --env-file=.env.local scripts/verify-loan-payment.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0130_loan_payment.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 6 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
async function refused(sql, params) {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    await client.query("release savepoint probe");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint probe");
    return error.message;
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const as = (userId) => client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
const legsOf = async (entryNumber) =>
  (
    await client.query(
      `select l.account_id, l.debit_minor::int as dr, l.credit_minor::int as cr, l.memo
         from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where e.entry_number = $1`,
      [entryNumber],
    )
  ).rows;

const { rows: companies } = await client.query(`select schema_name from onebook.company where status = 'active' order by display_order, schema_name`);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
        console.log("  (0130 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      const account = async (code, name, type, currency = base.code) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, currency],
        )).id;
      const gl = await account("ZZ-VERIFY-LK", "Verify checking", "bank");
      const loanGl = await account("ZZ-VERIFY-LL", "Verify Loan", "long_term_liability");
      const interestGl = await account("ZZ-VERIFY-LI", "Verify Interest Expense", "other_expense");
      const cardGl = await account("ZZ-VERIFY-LC", "Verify Card", "credit_card");
      const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
      const lineOf = async (amountMinor, description, pending = false) =>
        (await one(
          `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source, pending)
           values ($1, current_date, $2, $3, md5(random()::text || clock_timestamp()::text), 'file_upload', $4) returning id`,
          [bank, description, amountMinor, pending],
        )).id;
      const l1 = await lineOf(-200000, "VERIFY LOAN PMT 1");
      const l2 = await lineOf(-200000, "VERIFY LOAN PMT 2");
      const l3 = await lineOf(-200000, "VERIFY LOAN PMT 3");
      const lIn = await lineOf(200000, "VERIFY LOAN PROCEEDS");
      const lPending = await lineOf(-200000, "VERIFY LOAN PENDING", true);

      await client.query("set local role authenticated");
      await as(admin.id);
      const reg = (
        await one(
          `insert into acc_repayment_account (kind, account_id, match_words, interest_account_id, interest_method, annual_rate)
           values ('loan', $1, 'verify loan', $2, 'rate', 4) returning id`,
          [loanGl, interestGl],
        )
      ).id;
      const cardReg = (await one(`insert into acc_repayment_account (kind, account_id, match_words) values ('card', $1, 'verify card') returning id`, [cardGl])).id;

      // A payment of 2,000.00 with 400.00 interest: three legs that balance.
      const posted = await one(`select acc_post_bank_loan_payment($1, $2, 40000) as r`, [l1, reg]);
      check("it returns the principal it worked out", posted.r.principal_minor === 160000 && posted.r.interest_minor === 40000, JSON.stringify(posted.r));
      const legs = await legsOf(posted.r.entry_number);
      const leg = (id) => legs.find((l) => l.account_id === id);
      check("principal debits the loan", leg(loanGl)?.dr === 160000 && leg(loanGl)?.memo === "Principal", JSON.stringify(legs));
      check("interest debits the interest account", leg(interestGl)?.dr === 40000 && leg(interestGl)?.memo === "Interest", JSON.stringify(legs));
      check("the payment credits the bank", leg(gl)?.cr === 200000, JSON.stringify(legs));
      check("three legs and no more", legs.length === 3, String(legs.length));
      const entry = await one(`select description, source_type::text, source_id from acc_journal_entry where entry_number = $1`, [posted.r.entry_number]);
      check("the entry says it is a loan payment, posted from the bank", entry.description === "VERIFY LOAN PMT 1 — loan payment" && entry.source_type === "bank" && entry.source_id === null, JSON.stringify(entry));
      const status1 = await one(`select status from acc_bank_transaction where id = $1`, [l1]);
      check("the line is matched", status1.status === "matched", status1.status);

      // Zero interest, and interest equal to the payment, each leave out a leg.
      const zero = await one(`select acc_post_bank_loan_payment($1, $2, 0) as r`, [l2, reg]);
      const zeroLegs = await legsOf(zero.r.entry_number);
      check("no interest posts two legs: loan and bank", zeroLegs.length === 2 && !zeroLegs.some((l) => l.account_id === interestGl), JSON.stringify(zeroLegs));
      const all = await one(`select acc_post_bank_loan_payment($1, $2, 200000) as r`, [l3, reg]);
      const allLegs = await legsOf(all.r.entry_number);
      check("all interest posts two legs: interest and bank", allLegs.length === 2 && !allLegs.some((l) => l.account_id === loanGl), JSON.stringify(allLegs));

      // Change takes a loan payment back and the line waits again.
      await one(`select acc_uncategorise_bank_transaction($1, 'verify') as n`, [l1]);
      const back = await one(`select status from acc_bank_transaction where id = $1`, [l1]);
      const voided = await one(`select status::text from acc_journal_entry where entry_number = $1`, [posted.r.entry_number]);
      check("Change takes a loan payment back", back.status === "unmatched" && voided.status === "void", `${back.status} / ${voided.status}`);

      const expectRefusal = async (label, sql, params, pattern) => {
        const message = await refused(sql, params);
        check(label, pattern.test(message ?? ""), message ?? "accepted");
      };
      const post = `select acc_post_bank_loan_payment($1, $2, $3)`;
      await expectRefusal("interest above the payment is refused", post, [l1, reg, 200001], /between 0 and the payment/);
      await expectRefusal("interest below zero is refused", post, [l1, reg, -1], /between 0 and the payment/);
      await expectRefusal("money in is refused", post, [lIn, reg, 0], /money out/);
      await expectRefusal("a card entry is refused", post, [l1, cardReg, 0], /switched on in Cards and loans/);
      await expectRefusal("a pending line is refused", post, [lPending, reg, 0], /still be waiting/);
      await expectRefusal("a line already posted is refused", post, [l2, reg, 0], /still be waiting/);
      await client.query(`update acc_repayment_account set interest_account_id = $1 where id = $2`, [loanGl, reg]);
      await expectRefusal("an interest account that is not an expense is refused", post, [l1, reg, 0], /interest account must be/);
      await client.query(`update acc_repayment_account set interest_account_id = $1, is_active = false where id = $2`, [interestGl, reg]);
      await expectRefusal("a switched-off loan is refused", post, [l1, reg, 0], /switched on in Cards and loans/);
      await client.query(`update acc_repayment_account set is_active = true where id = $1`, [reg]);
      const other = await one(`select code from acc_currency where not is_base order by code limit 1`);
      if (other) {
        await client.query("reset role");
        const fxGl = await account("ZZ-VERIFY-LF", "Verify foreign bank", "bank", other.code);
        const fxBank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify FX', $2) returning id`, [fxGl, other.code])).id;
        const fxLine = (await one(
          `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source)
           values ($1, current_date, 'VERIFY LOAN FX', -200000, md5(random()::text || clock_timestamp()::text), 'file_upload') returning id`,
          [fxBank],
        )).id;
        await client.query("set local role authenticated");
        await as(admin.id);
        await expectRefusal("a foreign-currency bank is refused", post, [fxLine, reg, 0], /only from a bank account in/);
      } else {
        console.log("  (only the base currency exists; the foreign-bank refusal is not exercised)");
      }
      await as(OUTSIDER);
      await expectRefusal("someone who is not staff is refused", post, [l1, reg, 0], /Not authorized/);
      await as(admin.id);
      await client.query("reset role");
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  await client.end();
  clearTimeout(killer);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it (every company is rolled back)**

Run: `timeout 400 node --env-file=.env.local scripts/verify-loan-payment.mjs`
Expected: `0 failed`.
- Each company with an administrator shows 20 `ok` lines: 10 posting checks and 10 refusals, one of which is the foreign-bank refusal. Where only one currency exists, there are 19 `ok` lines and the "not exercised" note instead.
- If the database answers a refusal in different words, adjust the script's regex, never the migration. Report the change.
- If a check fails on the migration's behaviour, report it and do not edit the migration.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-loan-payment.mjs
# commit-msg.txt:
# test(banking): verify loan payment posting on every company, rolled back
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 10: Changelog 1.76 and the guide

**Files:**
- Modify: `lib/domain/changelog.ts` (a new first element of `RELEASES`)
- Modify: `lib/domain/system-guide.ts` (the `banking` flow)

- [ ] **Step 1: Add the release**

Insert at the top of `RELEASES`:

```ts
  {
    version: "1.76",
    date: "2026-10-01",
    headline: "A loan instalment is split into principal and interest, and only the interest is an expense.",
    changes: [
      {
        kind: "added",
        title: "Loans in Cards and loans",
        detail:
          "Add a loan with the words your bank prints for its payments, the account its interest goes to, and how the interest is worked out: a rate a year, a fixed amount each payment, or typed from the lender's statement each time.",
        route: "/banking/rules",
      },
      {
        kind: "added",
        title: "Loan payments split on Review import and Bank Transactions",
        detail:
          "A payment to a registered loan is offered as principal to the loan and interest to its expense account, with how the interest was estimated — the balance owed on the books × the rate ÷ 12. Split… changes the interest to the lender's figure; the principal is what is left. A loan payment is never ticked for you and is never part of Code all. Loan payments posted before 1.76 are not changed: correcting earlier interest is an adjusting entry for your accountant.",
        route: "/banking",
      },
      {
        kind: "changed",
        title: "An entry with several accounts shows all of them on Bank Transactions",
        detail:
          "A line posted to more than one account — a split loan payment, or a deposit of several items — shows its first account and \"+ 1 more\", with every account named on hover. Before, one of them was shown and the others were not mentioned.",
        route: "/banking",
      },
    ],
  },
```

- [ ] **Step 2: Update the guide step**

In `lib/domain/system-guide.ts`, replace the 1.75 step whose `control` is `"Add card"` with these two steps:

```ts
      {
        action: "Tell OneBook which payments repay a credit card or a loan",
        control: "Add card",
        route: "/banking/rules",
        note:
          "A payment to a card is never an expense: the costs were the card's own charges. " +
          "Of a loan payment only the interest is. Add each card with Add card and each loan with " +
          "Add loan, with the words your bank prints for its payments or its last four digits, and " +
          "such a line is offered as a card or loan payment before any rule or history. A line two " +
          "entries claim gets no suggestion.",
      },
      {
        action: "Post a loan payment as principal and interest",
        control: "Split…",
        note:
          "The interest offered is an estimate — the balance owed on the books × the loan's rate ÷ 12, " +
          "or its fixed amount — shown with how it was reached. Change it to the lender's figure; the " +
          "principal is what is left. One entry posts the principal to the loan, the interest to its " +
          "expense account and the payment from the bank, and Change takes it back.",
      },
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/domain/changelog.ts lib/domain/system-guide.ts
# commit-msg.txt:
# docs(changelog): 1.76 loan payments; guide steps for loans and Split
git commit -q -F C:/Users/pit010/QUICKBOOK_WEBAPP/.superpowers/sdd/commit-msg.txt
```

---

### Task 11: Prove it, apply it, show it

No new repository code. Every step reports real output.

- [ ] **Step 1: The four gates.** Run `npm run build && npm test && npm run typecheck && npm run lint`. Expected: build OK, 0 failed tests, 0 type errors, 0 lint errors. Paste the summary lines untrimmed.
- [ ] **Step 2: Verify before going live.** `node --env-file=.env.local scripts/verify-loan-payment.mjs` → `0 failed`.
- [ ] **Step 3: Ask the user before applying 0130 live.** Say: "Migration 0130 only adds the function `acc_post_bank_loan_payment` (nothing existing changes). Apply it to all six companies?" Wait for yes. Then:
  - Read-only, list the pending migrations per company. Expect only 0130; 0081 is the register migration and is skipped for company schemas.
  - Run `node --env-file=.env.local scripts/migrate.mjs`.
  - Re-run the verify script. The "(0130 applied inside the transaction…)" note must be gone, and the result `0 failed`.
- [ ] **Step 4: Smoke against the built server.** Start it detached from PowerShell: `Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory "C:\Users\pit010\QUICKBOOK_WEBAPP\ctyhp-accounting" -WindowStyle Hidden`. Then run `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000`. Expected: every page renders.
- [ ] **Step 5: Live on PC-Test only** (`co_pc`, `is_sample = true`; the script must refuse any other company). Put a temporary script in `ctyhp-accounting/`, delete it afterwards, and never commit it.
  1. Create `2500 Example Loan` (`long_term_liability`) and `8100 Interest Expense` (`other_expense`) if missing.
  2. Post the borrowing as a manual journal dated `2026-09-01`: Dr `1020 Savings Account` 120,000.00, Cr `2500 Example Loan` 120,000.00. Use `acc_post_manual_journal(p_entry_date, p_description, p_source_ref, p_currency, p_lines)`. Keep it as demo data.
  3. On Banking › Rules: **Add loan**, choose 2500. The words fill in. Interest goes to 8100 (offered by default), at 4.000% a year. Save.
  4. Import a made-up QFX on `1010 Sample Bank` with two lines: `EXAMPLE LOAN PMT` −2,000.00 on 2026-09-28 and `EXAMPLE LOAN PMT` −2,000.00 on 2026-09-29.
  5. Check Review import:
     - both lines read `Loan payment · 2500 — Example Loan`, unticked;
     - the first proposes interest 400.00 and principal 1,600.00;
     - the second, on 118,400.00 owed, proposes interest 394.67 and principal 1,605.33;
     - the header counts "2 loan payments".
  6. **Split…** on the first, change the interest to 395.00, **Use this split**. The line becomes ticked. Post it.
  7. On Bank Transactions, the second line shows the loan suggestion. **Split…** → **Post**. The cell then shows `2500 — Example Loan + 1 more`.
  8. Take both back with **Change**, then **Undo import**. Keep the accounts, the register entry and the borrowing journal as demo data.
- [ ] **Step 6: Screenshots.** Capture, light and dark, at 1440 and 1280:
  - Rules with the loan, and the Add loan form;
  - Review import with the two loan lines, and the Split dialog;
  - Bank Transactions with the loan suggestion, and after posting.

  Look at every picture yourself, then build `C:\Users\pit010\OneBook-1.76-anh-duyet.html` (as for 1.75) and ask the user to approve it before any push.
- [ ] **Step 7: Push after approval.** First scan the branch diff from `origin/main` for client names, digits and figures, and check there are no Co-Authored-By trailers. Then `git push -u origin feat/loan-payments`. Tell the user it merges after 1.75 (PR for `feat/card-loan-payments` first).

---

## Self-review notes

- **Spec coverage (1.76):**
  - 3.1, the loan fields and default interest account: Tasks 2, 6 and 7.
  - 3.3, precedence (loan after the rivals refusal and before rule and history; no funding beside a loan): Task 3. Rule and history are already silent for a loan since 1.75 Task 3.
  - 3.5:
    - the estimate (rate ÷ 12, half up, capped, nothing owed, fixed, entered, the date-order carry) and its Why text: Task 2;
    - the Split dialog on both screens: Task 8;
    - never ticked: Task 3;
    - never in Code all: guaranteed because `suggestCoding` returns nothing for a loan, so `codeFromSuggestions` never sees it;
    - the interest kept only until the page is left: Task 8 client state.
  - Posting and its checks: Tasks 1 and 9.
  - 3.6, the Interest column, Add loan and the Review import loan count: Tasks 7 and 8.
  - 4.4, changelog and guide: Task 10.
  - 5, proving it: Tasks 9 and 11.
- **The 1.75 review items closed here:**
  - #5, the kind guard: Tasks 3 and 6;
  - #6, preview cost: Task 6 reads only the asked accounts' history and only waiting payments out.
- **Beyond the spec:** a split entry shows all its accounts on Bank Transactions (Task 4, Task 8). Without it, a loan payment would show one of its two accounts at random.
