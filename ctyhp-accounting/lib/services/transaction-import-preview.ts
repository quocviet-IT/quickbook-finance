import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeTransactionRow,
  normalizeAccountRef,
  signedAmountMinor,
  transactionRawHash,
  type TransactionImportRecord,
} from "@/lib/domain/transaction-import";
import type { ImportPreview, ImportPreviewRow } from "./data-import";

/**
 * What a transactions file would do, before it does any of it.
 *
 * Lifted out of `data-import.ts` when the fixes for the tester's report pushed
 * that file well past the size anyone can hold in their head. Nothing was
 * rewritten in the move: this is the branch that used to sit inside
 * `previewImport`, together with the chart lookups only it uses.
 *
 * Transactions are the one target that posts both sides of an entry, so this
 * preview has to answer questions the others do not: does the chart hold every
 * account the file names, can the bank side carry a deduped line, and is any
 * name in the file claimed by two accounts at once.
 */

export class DataImportError extends Error {}

/** Account references that name more than one account, and so choose nothing. */
async function ambiguousAccountRefs(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb
    .from("acc_account")
    .select("id,account_code,name")
    .neq("status", "archived");
  if (error) throw new DataImportError(error.message);
  const seen = new Map<string, number>();
  for (const row of (data ?? []) as { account_code: string; name: string }[]) {
    // Only the bare name can collide: a code, and a code with its name, are
    // unique by construction.
    const key = normalizeAccountRef(row.name);
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
}

/** Every way a file may name an account, mapped to the account it means. */
async function accountIndex(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await sb
    .from("acc_account")
    .select("id,account_code,name")
    .neq("status", "archived");
  if (error) throw new DataImportError(error.message);
  const index = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; account_code: string; name: string }[]) {
    // Normalised the way `acc_normalize_ref` does, so this screen and the RPC
    // behind it cannot disagree about whether a name matches. Wave writes
    // "Payroll – Salary & Wages" with an en dash; the chart holds a hyphen.
    const add = (key: string) => {
      const k = normalizeAccountRef(key);
      if (k) index.set(k, row.id);
    };
    add(row.account_code);
    add(row.name);
    add(`${row.account_code} - ${row.name}`);
  }
  return index;
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
  const [index, hashes, banked, bankTyped, ambiguousRefs] = await Promise.all([
    accountIndex(sb),
    existingHashes(sb),
    bankedAccountIds(sb),
    bankTypeAccountIds(sb),
    ambiguousAccountRefs(sb),
  ]);
  const records = parsed.records as unknown as TransactionImportRecord[];
  const problems = [...parsed.problems];
  const missing = new Set<string>();
  const unbanked = new Set<string>();
  const notBanks = new Set<string>();
  const ambiguous = new Set<string>();
  const previewRows: ImportPreviewRow[] = [];
  let duplicates = 0;
  let emptyRows = 0;

  // Whether the money columns were mapped is a question about the file, and it
  // is answered once. Asked per row it produced 1,566 identical messages
  // telling the reader to map a column they had already mapped.
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
    const bankKey = normalizeAccountRef(bankRef);
    const bankId = index.get(bankKey) ?? options.bankAccountId ?? null;
    if (bankRef && !index.has(bankKey)) missing.add(bankRef);
    if (bankRef && ambiguousRefs.has(bankKey)) ambiguous.add(bankRef);
    if (bankId && !banked.has(bankId)) {
      // Two different problems with two different answers. One is fixed under
      // Banking; the other cannot be, and saying which is which saves a wasted
      // trip to a screen that will never list the account.
      if (bankTyped.has(bankId)) unbanked.add(bankRef || "the account chosen above");
      else notBanks.add(bankRef || "the account chosen above");
    }
    const categoryRef = (record.category_account ?? "").trim();
    const categoryKey = normalizeAccountRef(categoryRef);
    if (!index.has(categoryKey)) missing.add(categoryRef);
    if (categoryRef && ambiguousRefs.has(categoryKey)) ambiguous.add(categoryRef);

    const hash = transactionRawHash({
      bankAccountId: bankId ?? "",
      txnDate: record.txn_date,
      description: record.description,
      signedMinor: signed.minor,
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
    ambiguousAccounts: [...ambiguous],
  };
}
