import { createHash } from "node:crypto";

/**
 * One categorized transaction, as the column mapper hands it over.
 *
 * `money` fields arrive already in minor units and `date` fields already as
 * `YYYY-MM-DD`; everything here is about deciding what the row *means*.
 */
export interface TransactionImportRecord {
  txn_date: string;
  description: string | null;
  bank_account: string | null;
  category_account: string;
  amount: number | null;
  debit: number | null;
  credit: number | null;
}

/*
 * There was a `normalizeAccountRef` here, written to lowercase and fold dashes
 * the way `acc_normalize_ref` does. It was faithful about dashes and unfaithful
 * about precedence, and the preview built on it chose a different account from
 * the import it was predicting. Nothing replaced it: the screen asks
 * `acc_account_ref_matches` now (migration 0107), so there is one answer and no
 * second implementation to keep in step. Do not write another.
 */

/**
 * `empty` is not a fault.
 *
 * A file records a waived fee as 0.00, and the tester's had 99 of them. Calling
 * that a problem and telling the reader to map a column they had already mapped
 * sent them hunting a mistake that was not theirs. Whether the columns were
 * mapped at all is a question about the file, answered once, not 1,566 times.
 */
export type SignedAmount = { minor: number } | { empty: true } | { problem: string };

/**
 * How much money moved, and which way.
 *
 * A bank account is an asset, so a debit is money in. Products disagree about
 * whether to write one signed column or a pair; this is the only place that
 * knows, which is what lets the next product be an alias change rather than a
 * new code path.
 */
export function signedAmountMinor(record: TransactionImportRecord): SignedAmount {
  // A column the user did not map arrives as 0, not null — so zero means
  // "this side of the pair says nothing", which is also true of a real file
  // that writes 0.00 in the column it is not using.
  const debit = record.debit || 0;
  const credit = record.credit || 0;
  const hasPair = debit !== 0 || credit !== 0;
  const fromPair = debit - credit;
  const fromAmount = record.amount === null || record.amount === 0 ? null : record.amount;

  if (fromAmount === null && !hasPair) return { empty: true };
  if (fromAmount !== null && hasPair && fromAmount !== fromPair) {
    return {
      problem:
        `Amount (${fromAmount}) and Debit/Credit (${fromPair}) disagree on this row; ` +
        "map one or the other.",
    };
  }

  const minor = fromAmount ?? fromPair;
  if (minor === 0) return { empty: true };
  return { minor };
}

/**
 * The key that makes importing twice harmless.
 *
 * Two identical rows in one file are two real transactions and both are kept;
 * the same row in a file imported again is one transaction, and the unique
 * index on (bank_account_id, raw_hash) is what enforces that.
 */
export function transactionRawHash(input: {
  bankAccountId: string;
  txnDate: string;
  description: string | null;
  signedMinor: number;
  /** Which time this identical row appears in the file. 0 is the first. */
  occurrence?: number;
}): string {
  const base = [
    input.bankAccountId,
    input.txnDate,
    (input.description ?? "").trim(),
    input.signedMinor,
  ].join(" ");
  // Two identical rows in one file are two real transactions — a bank can
  // charge the same wire fee twice on the same day, and one file did. Hashed
  // the same they collide on the dedupe index, and the second is dropped in
  // silence: the preview promised 1,467 rows and 1,466 arrived, $30 short.
  // Numbering the repeats keeps them apart, and keeps them recognisable as the
  // same two if the file is imported again.
  //
  // Only repeats carry the suffix. The first of a kind hashes exactly as it
  // always did, so every row already imported still recognises itself.
  const occurrence = input.occurrence ?? 0;
  return createHash("sha256")
    .update(occurrence === 0 ? base : `${base} #${occurrence + 1}`)
    .digest("hex");
}

/**
 * A checksum for the file, taken from the rows read out of it.
 *
 * The register refuses a file that is already imported and still live, and it
 * has to recognise one from what would actually be posted rather than from a
 * name anybody can change. Two uploads of the same export hash the same however
 * they are named.
 */
export function transactionFileChecksum(rows: readonly (readonly string[])[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** The one line the dry run shows for a row. */
export function describeTransactionRow(
  record: TransactionImportRecord,
  signedMinor: number,
): string {
  const direction = signedMinor > 0 ? "in" : "out";
  return (
    `${record.txn_date} · ${record.description || "(no description)"} · ` +
    `${record.category_account} · ${direction}`
  );
}
