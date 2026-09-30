/**
 * Two bank lines that are one movement of money.
 *
 * A transfer between two of the company's own bank accounts shows up twice —
 * money out of one, money in to the other — and coding each half to income or
 * expense would invent both. A deposit answered by a payment of the same amount
 * on the same account is, as often as not, the owner putting money in and
 * taking it out; coded as spending it would "invent a cost and hide a loan".
 *
 * A pair is offered only when it is unambiguous: each line is the other's only
 * candidate. Equal amounts also happen by coincidence, which is why a funding
 * pair is only ever a suggestion (statement-review.ts never ticks it).
 */
export const PAIR_WINDOW_OPTIONS = [0, 1, 3, 7, 14, 30] as const;
export const DEFAULT_PAIR_WINDOW = 7;

export interface PairLine {
  id: string;
  bankAccountId: string;
  txnDate: string;
  amountMinor: number;
  description: string;
}

export type PairFact =
  | { kind: "transfer"; counterpart: PairLine }
  | { kind: "funding"; counterpart: PairLine }
  | { kind: "ambiguous"; rivals: number };

const dayOf = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

export function daysApart(a: string, b: string): number {
  return Math.round(Math.abs(dayOf(a) - dayOf(b)) / 86_400_000);
}

export function findBankPairs(
  lines: readonly PairLine[],
  windowDays: number,
  options: { fundingEnabled: boolean },
): Map<string, PairFact> {
  const facts = new Map<string, PairFact>();
  const bySize = new Map<number, PairLine[]>();
  for (const l of lines) {
    const size = Math.abs(l.amountMinor);
    if (size === 0) continue;
    const group = bySize.get(size) ?? [];
    group.push(l);
    bySize.set(size, group);
  }
  const taken = (l: PairLine) => {
    const kind = facts.get(l.id)?.kind;
    return kind === "transfer" || kind === "funding";
  };
  const candidates = (a: PairLine, sameBank: boolean) =>
    (bySize.get(Math.abs(a.amountMinor)) ?? []).filter(
      (b) =>
        b.id !== a.id &&
        b.amountMinor === -a.amountMinor &&
        (b.bankAccountId === a.bankAccountId) === sameBank &&
        daysApart(a.txnDate, b.txnDate) <= windowDays &&
        !taken(b),
    );

  const pass = (sameBank: boolean, kind: "transfer" | "funding") => {
    for (const a of lines) {
      if (Math.abs(a.amountMinor) === 0 || facts.has(a.id)) continue;
      const mine = candidates(a, sameBank);
      if (mine.length === 1) {
        const [b] = mine;
        const theirs = candidates(b, sameBank);
        if (theirs.length === 1 && theirs[0].id === a.id && !facts.has(b.id)) {
          facts.set(a.id, { kind, counterpart: b });
          facts.set(b.id, { kind, counterpart: a });
          continue;
        }
      }
      if (mine.length > 1) facts.set(a.id, { kind: "ambiguous", rivals: mine.length });
    }
  };

  pass(false, "transfer");
  if (options.fundingEnabled) pass(true, "funding");
  return facts;
}

export interface PairBank {
  id: string;
  glAccountId: string;
  /** "Sample Savings · 1020" */
  label: string;
  /** The ledger account's name, "Savings Account". */
  accountName: string;
  /** Last four digits of the account number, when known. */
  digits: string | null;
}

/** The last four digits of the first value that ends in four digits. */
export function lastFourDigits(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const found = (value ?? "").match(/(\d{4})\D*$/);
    if (found) return found[1];
  }
  return null;
}

const TRANSFER_WORDS = /\b(transfer|xfer|online transfer|internal transfer|book transfer|to savings|from savings)\b/i;

/** The one other bank account a line that reads as a transfer names, if it names exactly one. */
export function namedTransferTarget(line: { bankAccountId: string; description: string }, banks: readonly PairBank[]): PairBank | null {
  const text = line.description ?? "";
  if (!TRANSFER_WORDS.test(text)) return null;
  const own = banks.find((b) => b.id === line.bankAccountId);
  const lower = text.toLowerCase();
  const hits = banks.filter((b) => {
    if (b.id === line.bankAccountId || (own && b.glAccountId === own.glAccountId)) return false;
    const byDigits = b.digits !== null && new RegExp(`(^|\\D)${b.digits}(\\D|$)`).test(text);
    const name = b.accountName.trim().toLowerCase();
    const byName = name.length >= 6 && lower.includes(name);
    return byDigits || byName;
  });
  return hits.length === 1 ? hits[0] : null;
}

export const FUNDING_ACCOUNT_TYPES = ["current_liability", "long_term_liability"] as const;

export interface FundingCandidate {
  id: string;
  account_code: string;
  name: string;
  account_type: string;
  status: string;
  is_posting_account: boolean;
}

export function fundingAccountAllowed(account: FundingCandidate): boolean {
  return (
    (FUNDING_ACCOUNT_TYPES as readonly string[]).includes(account.account_type) &&
    account.status === "active" &&
    account.is_posting_account
  );
}

const FUNDING_NAME =
  /(shareholder|owner|director|member)s?['’]?\s*(loan|advance)|loan\s+from\s+(the\s+)?(shareholder|owner|director)|due\s+to\s+(shareholder|owner|director)/i;

/** The account funding pairs would most likely post to, by its name — offered, never saved on its own. */
export function suggestFundingAccount(accounts: readonly FundingCandidate[]): string | null {
  return (
    [...accounts]
      .filter(fundingAccountAllowed)
      .sort((a, b) => a.account_code.localeCompare(b.account_code))
      .find((a) => FUNDING_NAME.test(a.name))?.id ?? null
  );
}
