import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeTransactionRow,
  signedAmountMinor,
  transactionRawHash,
  type TransactionImportRecord,
} from "@/lib/domain/transaction-import";
import type { ImportPreview, ImportPreviewRow } from "./data-import";

/**
 * What a transactions file would do, before it does any of it.
 *
 * Lifted out of `data-import.ts` when the fixes for the tester's report pushed
 * that file well past the size anyone can hold in their head.
 *
 * Transactions are the one target that posts both sides of an entry, so this
 * preview has to answer questions the others do not: does the chart hold every
 * account the file names, can the bank side carry a deduped line, and is any
 * name in the file claimed by two accounts at once.
 *
 * It answers the first and last of those by *asking the database*, through the
 * same function the import itself calls. It used to answer them from a lookup
 * table built here, written to match and not matching: the two disagreed about
 * a chart holding two accounts called "Cash on Hand", so this screen went green
 * and the import then refused. A preview that does not predict the import is
 * worse than no preview, because it is believed.
 */

export class DataImportError extends Error {}

/** What the database says a reference names. The only answer either side reads. */
interface AccountRefMatch {
  accountId: string | null;
  /** The rule that fired, or "ambiguous" when the name belongs to two accounts. */
  matchedBy: "code" | "code_and_name" | "name" | "ambiguous" | null;
  /** Every account that answers to an ambiguous name, so the fix can be named. */
  candidateCodes: string[];
}

interface AccountRefMatchRow {
  ref: string;
  account_id: string | null;
  matched_by: AccountRefMatch["matchedBy"];
  candidate_codes: string[] | null;
}

/**
 * Resolve every account reference the file uses, in one round trip.
 *
 * Keyed on the trimmed reference exactly as sent, so nothing here has to know
 * how the database compares two names — the day this file starts normalising
 * for itself is the day the two can drift apart again.
 */
async function resolveAccountRefs(
  sb: SupabaseClient,
  refs: readonly string[],
): Promise<Map<string, AccountRefMatch>> {
  const wanted = [...new Set(refs.map((ref) => ref.trim()).filter((ref) => ref !== ""))];
  const found = new Map<string, AccountRefMatch>();
  if (wanted.length === 0) return found;

  const { data, error } = await sb.rpc("acc_account_ref_matches", { p_refs: wanted });
  if (error) throw new DataImportError(error.message);
  for (const row of (data ?? []) as AccountRefMatchRow[]) {
    found.set(row.ref, {
      accountId: row.account_id,
      matchedBy: row.matched_by,
      candidateCodes: row.candidate_codes ?? [],
    });
  }
  return found;
}

/** GL accounts that have a bank record, and so can carry a deduped bank line. */
async function bankedAccountIds(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb.from("acc_bank_account").select("account_id");
  if (error) throw new DataImportError(error.message);
  return new Set(((data ?? []) as { account_id: string }[]).map((row) => row.account_id));
}

/** Which accounts could be a bank at all, whatever Banking knows about them. */
async function bankTypeAccountIds(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb
    .from("acc_account")
    .select("id")
    .in("account_type", ["bank", "credit_card"]);
  if (error) throw new DataImportError(error.message);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

/** Hashes of what is already here, so a file imported twice adds nothing. */
async function existingHashes(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb.from("acc_bank_transaction").select("raw_hash");
  if (error) throw new DataImportError(error.message);
  return new Set(((data ?? []) as { raw_hash: string }[]).map((row) => row.raw_hash));
}

export async function previewTransactionImport(
  sb: SupabaseClient,
  parsed: { records: readonly Record<string, unknown>[]; problems: ImportPreview["problems"]; blankRows: number },
  mapping: Record<string, number | null>,
  options: { bankAccountId?: string | null },
): Promise<ImportPreview> {
  const records = parsed.records as unknown as TransactionImportRecord[];

  // Whether the money columns were mapped is a question about the file, and it
  // is answered once. Asked per row it produced 1,566 identical messages
  // telling the reader to map a column they had already mapped. Answered here,
  // before the lookups, it also spares the database four queries about a file
  // that cannot be read at all.
  const mapped = (key: string) => (mapping[key] ?? null) !== null;
  if (!mapped("amount") && !mapped("debit") && !mapped("credit")) {
    return {
      target: "transactions",
      rows: [],
      problems: [
        {
          row: 0,
          message: "No money column is mapped. Choose Amount, or choose Debit and Credit, above.",
        },
      ],
      blankRows: parsed.blankRows,
      creates: 0,
      updates: 0,
      openingTotalMinor: 0,
    };
  }

  const refs: string[] = [];
  for (const record of records) {
    refs.push(record.bank_account ?? "", record.category_account ?? "");
  }

  const [matches, hashes, banked, bankTyped] = await Promise.all([
    resolveAccountRefs(sb, refs),
    existingHashes(sb),
    bankedAccountIds(sb),
    bankTypeAccountIds(sb),
  ]);

  const problems = [...parsed.problems];
  const missing = new Set<string>();
  const unbanked = new Set<string>();
  const notBanks = new Set<string>();
  const ambiguous = new Map<string, string[]>();
  const previewRows: ImportPreviewRow[] = [];
  /** How many times this exact row has already been seen in this file. */
  const seenInFile = new Map<string, number>();
  let duplicates = 0;
  let emptyRows = 0;

  records.forEach((record, position) => {
    const signed = signedAmountMinor(record);
    if ("problem" in signed) {
      problems.push({ row: position + 1, message: signed.problem });
      return;
    }
    if ("empty" in signed) {
      emptyRows += 1;
      return;
    }

    const bankRef = (record.bank_account ?? "").trim();
    const bankMatch = bankRef ? matches.get(bankRef) : undefined;
    if (bankRef && bankMatch?.matchedBy === "ambiguous") {
      ambiguous.set(bankRef, bankMatch.candidateCodes);
    } else if (bankRef && !bankMatch?.accountId) {
      missing.add(bankRef);
    }
    const bankId = bankMatch?.accountId ?? options.bankAccountId ?? null;
    if (bankId && !banked.has(bankId)) {
      // Two different problems with two different answers. One is fixed under
      // Banking; the other cannot be, and saying which is which saves a wasted
      // trip to a screen that will never list the account.
      if (bankTyped.has(bankId)) unbanked.add(bankRef || "the account chosen above");
      else notBanks.add(bankRef || "the account chosen above");
    }

    const categoryRef = (record.category_account ?? "").trim();
    const categoryMatch = categoryRef ? matches.get(categoryRef) : undefined;
    if (categoryRef && categoryMatch?.matchedBy === "ambiguous") {
      ambiguous.set(categoryRef, categoryMatch.candidateCodes);
    } else if (!categoryMatch?.accountId) {
      missing.add(categoryRef);
    }

    // A row identical to one earlier in the same file is a second real
    // transaction, not a repeat of the first, so it is numbered rather than
    // left to collide with it on the dedupe index.
    const identity = [
      bankId ?? "",
      record.txn_date,
      (record.description ?? "").trim(),
      signed.minor,
    ].join("|");
    const occurrence = seenInFile.get(identity) ?? 0;
    seenInFile.set(identity, occurrence + 1);

    const hash = transactionRawHash({
      bankAccountId: bankId ?? "",
      txnDate: record.txn_date,
      description: record.description,
      signedMinor: signed.minor,
      occurrence,
    });
    if (hashes.has(hash)) {
      duplicates += 1;
      return;
    }
    previewRows.push({
      key: hash,
      name: describeTransactionRow(record, signed.minor),
      action: "create",
      openingBalanceMinor: signed.minor,
      values: { ...record, signed_minor: signed.minor },
    });
  });

  return {
    target: "transactions",
    rows: previewRows,
    problems,
    blankRows: parsed.blankRows,
    creates: previewRows.length,
    updates: 0,
    openingTotalMinor: previewRows.reduce((sum, row) => sum + row.openingBalanceMinor, 0),
    duplicates,
    emptyRows,
    missingAccounts: [...missing],
    unbankedAccounts: [...unbanked],
    nonBankAccounts: [...notBanks],
    ambiguousAccounts: [...ambiguous].map(([ref, codes]) => ({ ref, codes })),
  };
}
