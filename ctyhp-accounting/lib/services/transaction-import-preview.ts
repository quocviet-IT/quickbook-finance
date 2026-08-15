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

/** How many rows PostgREST will return before it stops and says nothing. */
const HASH_PAGE = 1000;

/**
 * Every bank line already in the books, read in pages.
 *
 * PostgREST caps a select at a thousand rows and reports no error when it does,
 * so reading this in one go quietly stopped knowing about anything past the
 * thousandth line. Measured on a real company: 1,466 rows in the table, 1,000
 * visible, 466 invisible.
 *
 * What that costs is a silent shortfall rather than an error. A row the preview
 * does not recognise as already imported is offered for import; the unique index
 * on (bank_account_id, raw_hash) then refuses it on the server and the row is
 * skipped whole, ledger included. The screen promises a number of rows, fewer
 * arrive, and the difference surfaces weeks later as a balance that does not
 * agree with the books it was brought across from.
 */
// Exported for the test rather than for any caller: the failure this guards
// against only appears past a thousand rows, which is more than a test would
// build through the public function.
export async function existingHashes(sb: SupabaseClient): Promise<Set<string>> {
  const hashes = new Set<string>();
  for (let from = 0; ; from += HASH_PAGE) {
    const { data, error } = await sb
      .from("acc_bank_transaction")
      .select("raw_hash")
      .range(from, from + HASH_PAGE - 1);
    if (error) throw new DataImportError(error.message);
    const rows = (data ?? []) as { raw_hash: string }[];
    for (const row of rows) hashes.add(row.raw_hash);
    // A short page is the last page. Asking again would cost a round trip to
    // be told the same thing.
    if (rows.length < HASH_PAGE) return hashes;
  }
}

export async function previewTransactionImport(
  sb: SupabaseClient,
  parsed: {
    records: readonly Record<string, unknown>[];
    problems: ImportPreview["problems"];
    blankRows: number;
    sourceLines: readonly number[];
  },
  mapping: Record<string, number | null>,
  options: {
    bankAccountId?: string | null;
    /**
     * What the reader decided a name in the file means, as an account code.
     *
     * Substituted into the row before anything is resolved, so the code goes
     * to the database in place of the name and the server resolves it the one
     * way it resolves everything. Nothing here decides which account is meant;
     * it carries an answer somebody already gave.
     */
    accountOverrides?: Record<string, string>;
  },
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

  const overrides = options.accountOverrides ?? {};
  const substitute = (ref: string | null | undefined): string => {
    const raw = (ref ?? "").trim();
    return raw === "" ? "" : (overrides[raw] ?? raw);
  };

  const refs: string[] = [];
  for (const record of records) {
    refs.push(substitute(record.bank_account), substitute(record.category_account));
  }

  const [matches, hashes, banked, bankTyped] = await Promise.all([
    resolveAccountRefs(sb, refs),
    existingHashes(sb),
    bankedAccountIds(sb),
    bankTypeAccountIds(sb),
  ]);

  const problems = [...parsed.problems];
  /**
   * Every row that will not be imported, and why.
   *
   * Counted was not enough: "100 row(s) will be left out" over a 1,566-row file
   * is 7% of somebody's books going missing with no way to see which 7%. The
   * lines are carried rather than the rows — the screen still holds the file it
   * read, so it can write the CSV itself from its own copy.
   */
  const excluded: { line: number; reason: string; message: string }[] = [];
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
    // The line this row came from in the file, not its position among the rows
    // that survived parsing. A blank line makes those two diverge.
    const line = parsed.sourceLines[position] ?? position + 2;
    const signed = signedAmountMinor(record);
    if ("problem" in signed) {
      problems.push({ row: line, message: signed.problem });
      excluded.push({ line, reason: "Problem", message: signed.problem });
      return;
    }
    if ("empty" in signed) {
      emptyRows += 1;
      excluded.push({
        line,
        reason: "No money",
        message: "This row carries no amount — a waived fee, or a line recorded as 0.00.",
      });
      return;
    }

    const bankRef = substitute(record.bank_account);
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

    const categoryRef = substitute(record.category_account);
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
      excluded.push({
        line,
        reason: "Already imported",
        message: "This exact row is already in the bank register, so it is not posted again.",
      });
      return;
    }
    const posting = { ...record, bank_account: bankRef, category_account: categoryRef };
    previewRows.push({
      key: hash,
      name: describeTransactionRow(posting, signed.minor),
      action: "create",
      openingBalanceMinor: signed.minor,
      values: { ...posting, signed_minor: signed.minor },
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
    excluded,
    // Money in and money out, not just their difference. A sign column mapped
    // the wrong way round shows up here at once — everything on one side —
    // where a single net figure hides it completely.
    moneyInMinor: previewRows.reduce(
      (sum, row) => sum + Math.max(row.openingBalanceMinor, 0),
      0,
    ),
    moneyOutMinor: previewRows.reduce(
      (sum, row) => sum + Math.min(row.openingBalanceMinor, 0),
      0,
    ),
    missingAccounts: [...missing],
    unbankedAccounts: [...unbanked],
    nonBankAccounts: [...notBanks],
    ambiguousAccounts: [...ambiguous].map(([ref, codes]) => ({ ref, codes })),
  };
}
