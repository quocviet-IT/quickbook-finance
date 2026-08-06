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

export type SignedAmount = { minor: number } | { problem: string };

/**
 * How much money moved, and which way.
 *
 * A bank account is an asset, so a debit is money in. Products disagree about
 * whether to write one signed column or a pair; this is the only place that
 * knows, which is what lets the next product be an alias change rather than a
 * new code path.
 */
export function signedAmountMinor(record: TransactionImportRecord): SignedAmount {
  const hasPair = record.debit !== null || record.credit !== null;
  const fromPair = (record.debit ?? 0) - (record.credit ?? 0);
  const fromAmount = record.amount;

  if (fromAmount === null && !hasPair) {
    return { problem: "This row has no amount: map Amount, or map Debit and Credit." };
  }
  if (fromAmount !== null && hasPair && fromAmount !== fromPair) {
    return {
      problem:
        `Amount (${fromAmount}) and Debit/Credit (${fromPair}) disagree on this row; ` +
        "map one or the other.",
    };
  }

  const minor = fromAmount ?? fromPair;
  if (minor === 0) return { problem: "This row moves zero, so there is nothing to post." };
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
}): string {
  return createHash("sha256")
    .update(
      [
        input.bankAccountId,
        input.txnDate,
        (input.description ?? "").trim(),
        input.signedMinor,
      ].join(" "),
    )
    .digest("hex");
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
