import { createHash } from "node:crypto";

/** Collision-resistant deterministic hash for immutable statement rows. */
export function statementRowHash(
  parts: (string | number | null | undefined)[],
): string {
  const canonical = parts.map((part) => String(part ?? "")).join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The duplicate key of one statement line. A line that carries the bank's own
 * id (OFX FITID) is keyed on it, so a re-downloaded file is recognised even when
 * the bank rewords a description; any other line is keyed as imports always
 * have been, so it still meets the lines imported before. The n-th identical
 * line of one file (n ≥ 2) adds its `occurrence`: two $5.00 fees on one day are
 * two lines, and the first keeps the key it always had.
 */
export function statementLineHash(
  bankAccountId: string,
  line: StatementLineKey,
  occurrence = 1,
): string {
  if (line.external_id) return statementRowHash([bankAccountId, "fitid", line.external_id]);
  const parts = [bankAccountId, line.txn_date, line.amount_minor, line.description, line.reference];
  return statementRowHash(occurrence > 1 ? [...parts, `#${occurrence}`] : parts);
}

export interface StatementLineKey {
  txn_date: string;
  amount_minor: number;
  description: string;
  reference: string | null;
  external_id?: string | null;
}

/** The duplicate keys of one file's lines, in file order, each repeat of an identical line counted. */
export function statementLineHashes(bankAccountId: string, lines: readonly StatementLineKey[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    if (line.external_id) return statementLineHash(bankAccountId, line);
    const key = JSON.stringify([line.txn_date, line.amount_minor, line.description, line.reference]);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return statementLineHash(bankAccountId, line, occurrence);
  });
}

// --- Review queue ------------------------------------------------------------

/** The parts of a bank account this queue needs to label and format a row. */
export interface ReviewAccountLike {
  id: string;
  name: string;
  currency_code: string;
}

/** The parts of a bank transaction the queue keys on. */
export interface ReviewTransactionLike {
  id: string;
  bank_account_id: string;
}

/** The parts of a match suggestion the queue keys on. */
export interface ReviewSuggestionLike {
  bank_transaction_id: string;
  confidence: number;
}

export interface BankReviewRow<
  T extends ReviewTransactionLike,
  S extends ReviewSuggestionLike,
> {
  transaction: T;
  /** The account this line came from, for the queue that spans all of them. */
  accountName: string;
  /** Null when the account is unknown, so the caller shows the raw amount. */
  currencyCode: string | null;
  /** The strongest suggestion for this line, or null when nothing matched. */
  suggestion: S | null;
}

/**
 * One row per bank transaction, carrying the account it came from and its best
 * suggested match — the two things a single review table needs that a
 * per-account table did not.
 *
 * The currency travels with the row rather than with the screen. A queue over
 * several accounts holds several currencies at once, and formatting a card line
 * with the checking account's currency is how a review screen starts lying
 * about amounts.
 *
 * A transaction whose account cannot be found is still listed. It is money that
 * really is on a statement, and hiding it would be worse than labelling it.
 */
export function buildBankReviewRows<
  T extends ReviewTransactionLike,
  S extends ReviewSuggestionLike,
>(
  transactions: readonly T[],
  suggestions: readonly S[],
  accounts: readonly ReviewAccountLike[],
): BankReviewRow<T, S>[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const best = new Map<string, S>();
  for (const suggestion of suggestions) {
    const current = best.get(suggestion.bank_transaction_id);
    if (!current || suggestion.confidence > current.confidence) {
      best.set(suggestion.bank_transaction_id, suggestion);
    }
  }

  return transactions.map((transaction) => {
    const account = accountById.get(transaction.bank_account_id);
    return {
      transaction,
      accountName: account?.name ?? "Unknown account",
      currencyCode: account?.currency_code ?? null,
      suggestion: best.get(transaction.id) ?? null,
    };
  });
}
