/**
 * Related companies: money between companies the same owners run.
 *
 * Money sent to a sister company is a loan to it, and money received from one
 * is a loan from it — never income or a cost. Coded singly in each book, the
 * same movement becomes income in one and a cost in the other. Each company
 * lists its related companies with the words its bank prints for them and the
 * one account that carries what each owes or is owed: money out debits it,
 * money in credits it, and the sign of its balance says who owes whom. A
 * waiting line naming one, in or out, is weighed with the cards and loans
 * (register-claim.ts) before any rule or history.
 *
 * Imported by scripts/*.mjs: relative imports only.
 */
import type { AccountType } from "./accounts.ts";
import { wordPattern } from "./bank-rules.ts";
import { codableAccount, type CodingAccount } from "./coding.ts";
import { phrasesOf, type RepaymentLine } from "./repayments.ts";

export interface RelatedCompany {
  id: string;
  name: string;
  /** The one account that carries what this company owes or is owed. */
  accountId: string;
  /** Phrases the bank prints, comma-separated: "example affiliate, exa". */
  matchWords: string;
  isActive: boolean;
}

export type RelatedCompanyInput = Omit<RelatedCompany, "id">;

export const RELATED_NAME_MAX = 120;
export const RELATED_WORDS_MAX = 200;
/** Two letters can name a company on a statement; one names nothing. */
export const RELATED_PHRASE_MIN = 2;
const RELATED_ACCOUNT_TYPES: readonly AccountType[] = ["current_asset", "current_liability", "long_term_liability"];
const COMPANY_SUFFIX = /[\s,]+(?:l\.?l\.?c\.?|inc\.?|corp\.?|corporation|co\.?|ltd\.?)$/i;

/** "Example Affiliate, LLC" → "Example Affiliate": the name without its company suffix. */
export function seedRelatedWords(name: string): string {
  const squeezed = name.trim().replace(/\s+/g, " ");
  return squeezed.replace(COMPANY_SUFFIX, "").trim() || squeezed;
}

/** Whether an account can carry what a related company owes or is owed. */
export function relatedAccountAllowed(account: CodingAccount | undefined): boolean {
  return Boolean(account && codableAccount(account) && RELATED_ACCOUNT_TYPES.includes(account.type));
}

/** An entry that can speak: switched on, and its account still one it may use. */
export function usableRelated(company: RelatedCompany, accounts: ReadonlyMap<string, CodingAccount>): boolean {
  return company.isActive && relatedAccountAllowed(accounts.get(company.accountId));
}

/** Whether a description carries one of the company's phrases, each as whole words, in any case. */
export function relatedMatches(company: Pick<RelatedCompany, "matchWords">, description: string): boolean {
  return phrasesOf(company.matchWords).some((phrase) => wordPattern(phrase).test(description));
}

/** Every usable related company a waiting line names — money in or out, on a bank in the base currency. */
export function relatedHits(
  companies: readonly RelatedCompany[],
  line: RepaymentLine,
  accounts: ReadonlyMap<string, CodingAccount>,
): RelatedCompany[] {
  if (line.amountMinor === 0 || !line.inBaseCurrency) return [];
  return companies.filter((company) => usableRelated(company, accounts) && relatedMatches(company, line.description));
}

/**
 * What is wrong with a company as typed, or null. Whether its account is of
 * the right kind is checked against the chart by the service.
 */
export function validateRelatedInput(input: RelatedCompanyInput): string | null {
  const name = input.name.trim();
  if (!name) return "Give the company's name";
  if (name.length > RELATED_NAME_MAX) return `The name is at most ${RELATED_NAME_MAX} characters`;
  if (!input.accountId) return "Choose the account it owes or is owed on";
  if (input.matchWords.length > RELATED_WORDS_MAX) return `Words are at most ${RELATED_WORDS_MAX} characters`;
  const phrases = phrasesOf(input.matchWords);
  if (phrases.length === 0) return "Give the words your bank prints for this company";
  const short = phrases.find((phrase) => phrase.length < RELATED_PHRASE_MIN);
  if (short) return `"${short}" is too short — each word or phrase is at least ${RELATED_PHRASE_MIN} characters`;
  return null;
}

/** What is wrong with this account for a related company, or null. */
export function relatedAccountProblem(account: CodingAccount | undefined, inCardsAndLoans: boolean): string | null {
  if (!relatedAccountAllowed(account)) {
    return "A related company's account is an active posting current asset, current liability or long-term liability";
  }
  if (inCardsAndLoans) return "This account is in Cards and loans — a related company needs an account of its own";
  return null;
}

/** "Owes us $1,140.25", "We owe $3,000.00" or "Settled": a debit-less-credit balance as the person reads it. */
export function balanceWords(balanceMinor: number, money: (minor: number) => string): string {
  if (balanceMinor > 0) return `Owes us ${money(balanceMinor)}`;
  if (balanceMinor < 0) return `We owe ${money(-balanceMinor)}`;
  return "Settled";
}
