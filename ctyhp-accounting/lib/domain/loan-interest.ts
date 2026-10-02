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
import { registerClaim } from "./register-claim.ts";
import type { RelatedCompany } from "./related-companies.ts";
import type { InterestMethod, RepaymentAccount } from "./repayments.ts";

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
      // Number order: 410 before 1000.
      .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))[0]?.id ?? null
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
  /** Related companies: a line one of them also names is not a loan payment to propose. */
  related?: readonly RelatedCompany[];
  baseCurrencyBankIds: ReadonlySet<string>;
  accounts: ReadonlyMap<string, CodingAccount>;
  movements: readonly LoanMovement[];
  /** Lines with a ledger match on offer: they are not proposed as anything else. */
  excludeIds?: ReadonlySet<string>;
}): LoanSuggestionView[] {
  const loanLines: LoanLine[] = [];
  for (const line of input.lines) {
    if (input.excludeIds?.has(line.id)) continue;
    const claim = registerClaim({
      repayments: input.repayments,
      related: input.related ?? [],
      line: { description: line.description, amountMinor: line.amountMinor, inBaseCurrency: input.baseCurrencyBankIds.has(line.bankAccountId) },
      accounts: input.accounts,
    });
    if (claim?.kind !== "repayment" || claim.entry.kind !== "loan") continue;
    loanLines.push({ id: line.id, date: line.date, paymentMinor: Math.abs(line.amountMinor), entry: claim.entry });
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
