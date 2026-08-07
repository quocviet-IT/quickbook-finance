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

/**
 * Read an account reference the way the database does.
 *
 * `acc_normalize_ref` (migration 0102) lowercases, trims, and turns every kind
 * of dash into a hyphen. The screen has to agree with it exactly: Wave writes
 * "Payroll – Salary & Wages" with an en dash, and a screen that compares raw
 * strings blocks a file the server would have accepted.
 */
export function normalizeAccountRef(ref: string | null | undefined): string {
  return (ref ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-");
}

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
