/**
 * Cards and loans: what a payment out of the bank repays.
 *
 * Paying a card is not a cost — the costs were the card's own charges, already
 * in the books — and a loan instalment is principal plus interest, of which
 * only the interest belongs on the Profit and Loss. Each company lists its
 * cards and loans with the words its bank prints for their payments, or their
 * last four digits. A waiting payment out that carries them is that entry's
 * repayment, recognised before any rule or history (coding.ts).
 *
 * One entry or nothing: a line two entries claim gets no proposal at all, the
 * way two open invoices of one amount get none.
 *
 * Imported by scripts/*.mjs: relative imports only, types only across modules.
 */
import type { AccountType } from "./accounts.ts";
import { lastFourDigits } from "./bank-pairs.ts";
import { wordPattern } from "./bank-rules.ts";
import type { CodingAccount } from "./coding.ts";

export type RepaymentKind = "card" | "loan";
export type InterestMethod = "rate" | "fixed" | "entered";

export interface RepaymentAccount {
  id: string;
  kind: RepaymentKind;
  /** The liability the payment repays. */
  accountId: string;
  /** Phrases the bank prints, comma-separated: "example card, example epay". */
  matchWords: string;
  /** Four digits the bank prints, or null. */
  matchDigits: string | null;
  interestAccountId: string | null;
  interestMethod: InterestMethod | null;
  /** Percent a year: 4.25 is 4.25%. */
  annualRate: number | null;
  fixedInterestMinor: number | null;
  isActive: boolean;
}

export type RepaymentInput = Omit<RepaymentAccount, "id">;

/** A waiting bank line, as recognition needs it. */
export interface RepaymentLine {
  description: string;
  amountMinor: number;
  /** Its bank account is in the company's base currency. */
  inBaseCurrency: boolean;
}

export type RepaymentFact = { kind: "one"; entry: RepaymentAccount } | { kind: "rivals"; count: number };

export const REPAYMENT_WORDS_MAX = 200;
const CARD_ACCOUNT_TYPES: readonly AccountType[] = ["credit_card"];
const LOAN_ACCOUNT_TYPES: readonly AccountType[] = ["current_liability", "long_term_liability"];
const INTEREST_ACCOUNT_TYPES: readonly AccountType[] = ["expense", "other_expense"];

/** The phrases of a words field: trimmed, inner spaces squeezed, blanks dropped, each once. */
export function phrasesOf(words: string): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const raw of words.split(",")) {
    const phrase = raw.trim().replace(/\s+/g, " ");
    const key = phrase.toLowerCase();
    if (!phrase || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases;
}

/** "Example Card 4321" → "Example Card": the name without its trailing number. */
export function seedWords(accountName: string): string {
  return accountName.replace(/\s+[•*#.(]*x?\d{2,}\)?\s*$/i, "").trim();
}

/** The last four digits in an account's name, if it has any. */
export function seedDigits(accountName: string): string | null {
  return lastFourDigits(accountName);
}

const allowed = (types: readonly AccountType[], account: CodingAccount | undefined) =>
  Boolean(account && account.active && account.posting && types.includes(account.type));

/** Whether an account can be what an entry of this kind repays. */
export function repaysAccountAllowed(kind: RepaymentKind, account: CodingAccount | undefined): boolean {
  return allowed(kind === "card" ? CARD_ACCOUNT_TYPES : LOAN_ACCOUNT_TYPES, account);
}

/** Whether a loan's interest may post to this account. */
export function interestAccountAllowed(account: CodingAccount | undefined): boolean {
  return allowed(INTEREST_ACCOUNT_TYPES, account);
}

/** An entry that can speak: switched on, and its accounts still the kind it needs. */
export function usableRepayment(entry: RepaymentAccount, accounts: ReadonlyMap<string, CodingAccount>): boolean {
  if (!entry.isActive || !repaysAccountAllowed(entry.kind, accounts.get(entry.accountId))) return false;
  return entry.kind === "card" || interestAccountAllowed(accounts.get(entry.interestAccountId ?? ""));
}

/** Whether a description carries one of the entry's phrases, or its last four as a run of exactly four digits. */
export function repaymentMatches(entry: Pick<RepaymentAccount, "matchWords" | "matchDigits">, description: string): boolean {
  const digits = entry.matchDigits;
  if (digits && /^\d{4}$/.test(digits) && new RegExp(`(^|\\D)${digits}(\\D|$)`).test(description)) return true;
  return phrasesOf(entry.matchWords).some((phrase) => wordPattern(phrase).test(description));
}

/** The one entry a waiting payment out repays, how many claim it when several do, or nothing. */
export function repaymentFor(
  entries: readonly RepaymentAccount[],
  line: RepaymentLine,
  accounts: ReadonlyMap<string, CodingAccount>,
): RepaymentFact | null {
  if (line.amountMinor >= 0 || !line.inBaseCurrency) return null;
  const hits = entries.filter((entry) => usableRepayment(entry, accounts) && repaymentMatches(entry, line.description));
  if (hits.length === 0) return null;
  return hits.length === 1 ? { kind: "one", entry: hits[0] } : { kind: "rivals", count: hits.length };
}

/**
 * What is wrong with an entry as typed, or null. Whether its accounts are of
 * the right kind is checked against the chart by the service.
 */
export function validateRepaymentInput(input: RepaymentInput): string | null {
  if (input.kind !== "card" && input.kind !== "loan") return "Say whether this is a card or a loan";
  if (!input.accountId) return input.kind === "card" ? "Choose the card account" : "Choose the loan account";
  if (input.matchWords.length > REPAYMENT_WORDS_MAX) return `Words are at most ${REPAYMENT_WORDS_MAX} characters`;
  if (input.matchDigits !== null && !/^\d{4}$/.test(input.matchDigits)) return "The last four are exactly four digits";
  if (phrasesOf(input.matchWords).length === 0 && input.matchDigits === null) {
    return "Give the words your bank prints for these payments, or the last four digits";
  }
  if (input.kind === "card") {
    const hasInterest =
      input.interestAccountId !== null || input.interestMethod !== null || input.annualRate !== null || input.fixedInterestMinor !== null;
    return hasInterest ? "A card payment has no interest to split" : null;
  }
  if (!input.interestAccountId) return "Choose the account interest posts to";
  if (input.interestMethod === null) return "Say how the interest is worked out";
  if (input.interestMethod === "rate") {
    const rate = input.annualRate;
    if (rate === null || !(rate >= 0 && rate <= 100)) return "The rate a year is between 0 and 100%";
    if (Math.abs(rate * 1000 - Math.round(rate * 1000)) > 1e-6) return "The rate a year has at most three decimals";
  }
  if (input.interestMethod === "fixed") {
    const fixed = input.fixedInterestMinor;
    if (fixed === null || !Number.isInteger(fixed) || fixed < 0) return "Give the fixed interest per payment";
  }
  return null;
}

/** A saved entry stays a card or a loan: the accounts and settings of one are not the other's. */
export function kindChangeProblem(existing: RepaymentKind, next: RepaymentKind): string | null {
  return existing === next ? null : "A card cannot become a loan, or a loan a card — remove the entry and add it again";
}
