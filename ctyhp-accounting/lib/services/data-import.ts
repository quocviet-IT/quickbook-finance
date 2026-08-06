import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeTransactionRow,
  signedAmountMinor,
  transactionRawHash,
  type TransactionImportRecord,
} from "@/lib/domain/transaction-import";
import {
  applyMapping,
  fieldsFor,
  type ImportProblem,
  type ImportTarget,
} from "@/lib/domain/import-mapping";
import {
  groupInvoiceRows,
  type InvoiceImportRecord,
} from "@/lib/domain/invoice-import";

export class DataImportError extends Error {}

export interface ImportPreviewRow {
  /** What the record will be matched on when it is imported. */
  key: string;
  name: string;
  /** Whether this row will create something or update something already here. */
  action: "create" | "update";
  openingBalanceMinor: number;
  values: Record<string, string | number | boolean | null>;
}

export interface ImportPreview {
  target: ImportTarget;
  rows: ImportPreviewRow[];
  problems: ImportProblem[];
  blankRows: number;
  creates: number;
  updates: number;
  /** Total opening balance carried by the file, if it carries any. */
  openingTotalMinor: number;
  /** Rows already imported, matched on their hash. Counted, never re-posted. */
  duplicates?: number;
  /** Accounts named by the file that this company's chart does not have. */
  missingAccounts?: string[];
  /**
   * Bank accounts with no record under Banking. Dedupe lives on the bank line's
   * unique hash, so without one a second import would post the same money
   * again — which is why this blocks rather than warns.
   */
  unbankedAccounts?: string[];
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
    const add = (key: string) => {
      const k = (key ?? "").trim().toLowerCase();
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

/** Hashes of what is already here, so a file imported twice adds nothing. */
async function existingHashes(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb.from("acc_bank_transaction").select("raw_hash");
  if (error) throw new DataImportError(error.message);
  return new Set(((data ?? []) as { raw_hash: string }[]).map((row) => row.raw_hash));
}

/** The column each target is matched on when deciding create versus update. */
function keyOf(target: ImportTarget, record: Record<string, unknown>): string {
  if (target === "chart_of_accounts") return String(record.account_code ?? "");
  if (target === "items") {
    const code = String(record.item_code ?? "");
    return code !== "" ? code : String(record.name ?? "").toLowerCase();
  }
  return String(record.name ?? "").toLowerCase();
}

/** What is already here, so the preview can say which rows are new. */
async function existingKeys(sb: SupabaseClient, target: ImportTarget): Promise<Set<string>> {
  const table =
    target === "chart_of_accounts"
      ? "acc_account"
      : target === "customers"
        ? "acc_customer"
        : target === "vendors"
          ? "acc_vendor"
          : "acc_item";
  const columns = target === "chart_of_accounts" ? "account_code" : target === "items" ? "item_code,name" : "name";

  const { data, error } = await sb.from(table).select(columns);
  if (error) throw new DataImportError(error.message);

  const keys = new Set<string>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    if (target === "chart_of_accounts") keys.add(String(row.account_code ?? ""));
    else if (target === "items") {
      const code = String(row.item_code ?? "");
      keys.add(code !== "" ? code : String(row.name ?? "").toLowerCase());
    } else keys.add(String(row.name ?? "").toLowerCase());
  }
  return keys;
}

/**
 * What the import would do, without doing any of it.
 *
 * Nothing is written here. An import that posts on the first click is one
 * mis-mapped column away from a ledger nobody can unpick, so the answer to
 * "what will this do" has to be available before the answer to "do it".
 */
export async function previewImport(
  sb: SupabaseClient,
  target: ImportTarget,
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
  options: { bankAccountId?: string | null } = {},
): Promise<ImportPreview> {
  const parsed = applyMapping(rows, mapping, target);

  // Transactions are the one target that posts both sides of an entry, so the
  // preview has to answer a question the others do not: does this company's
  // chart of accounts actually contain every account the file names?
  if (target === "transactions") {
    const [index, hashes, banked] = await Promise.all([
      accountIndex(sb),
      existingHashes(sb),
      bankedAccountIds(sb),
    ]);
    const records = parsed.records as unknown as TransactionImportRecord[];
    const problems = [...parsed.problems];
    const missing = new Set<string>();
    const unbanked = new Set<string>();
    const previewRows: ImportPreviewRow[] = [];
    let duplicates = 0;

    records.forEach((record, position) => {
      const signed = signedAmountMinor(record);
      if ("problem" in signed) {
        problems.push({ row: position + 1, message: signed.problem });
        return;
      }
      const bankRef = (record.bank_account ?? "").trim();
      const bankId = index.get(bankRef.toLowerCase()) ?? options.bankAccountId ?? null;
      if (bankRef && !index.has(bankRef.toLowerCase())) missing.add(bankRef);
      if (bankId && !banked.has(bankId)) unbanked.add(bankRef || "the account chosen above");
      const categoryRef = (record.category_account ?? "").trim();
      if (!index.has(categoryRef.toLowerCase())) missing.add(categoryRef);

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
      target,
      rows: previewRows,
      problems,
      blankRows: parsed.blankRows,
      creates: previewRows.length,
      updates: 0,
      openingTotalMinor: previewRows.reduce((sum, row) => sum + row.openingBalanceMinor, 0),
      duplicates,
      missingAccounts: [...missing],
      unbankedAccounts: [...unbanked],
    };
  }

  // Invoices are the one target where rows do not map one-to-one onto records:
  // several lines make a document. The preview therefore counts documents, and
  // every one of them is a create — an import raises drafts and never matches
  // an existing invoice, because "the same invoice again" is not a thing a file
  // can assert.
  if (target === "invoices") {
    const grouped = groupInvoiceRows(parsed.records as unknown as InvoiceImportRecord[]);
    return {
      target,
      rows: grouped.invoices.map((invoice) => ({
        key: invoice.customer,
        name: `${invoice.externalReference} · ${invoice.customer} · ${invoice.lines.length} line${invoice.lines.length === 1 ? "" : "s"}`,
        action: "create" as const,
        openingBalanceMinor: invoice.subtotalMinor,
        values: {},
      })),
      problems: [
        ...parsed.problems,
        ...grouped.problems.map((problem) => ({
          row: 0,
          message: `${problem.reference || "(no invoice number)"}: ${problem.message}`,
        })),
      ],
      blankRows: parsed.blankRows,
      creates: grouped.invoices.length,
      updates: 0,
      openingTotalMinor: grouped.invoices.reduce((sum, i) => sum + i.subtotalMinor, 0),
    };
  }

  const existing = await existingKeys(sb, target);

  const preview: ImportPreviewRow[] = parsed.records.map((record) => {
    const key = keyOf(target, record);
    return {
      key,
      name: String(record.name ?? ""),
      action: existing.has(key) ? "update" : "create",
      openingBalanceMinor: Number(record.opening_balance_minor ?? 0),
      values: record,
    };
  });

  return {
    target,
    rows: preview,
    problems: parsed.problems,
    blankRows: parsed.blankRows,
    creates: preview.filter((r) => r.action === "create").length,
    updates: preview.filter((r) => r.action === "update").length,
    openingTotalMinor: preview.reduce((sum, r) => sum + r.openingBalanceMinor, 0),
  };
}

export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: number;
  /** Opening documents raised, when the file carried balances. */
  openingCreated?: number;
}

/**
 * Do it.
 *
 * The rows go to the database as they were previewed; the matching and the
 * posting both happen inside one RPC so a half-finished import cannot be left
 * behind. Opening balances are a second, explicit step — importing a list is
 * not the same act as putting figures on the ledger.
 */
export async function runImport(
  sb: SupabaseClient,
  target: ImportTarget,
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
  options: { openingBalancesAsOf?: string | null; bankAccountId?: string | null } = {},
): Promise<ImportOutcome> {
  // Transactions are previewed again here rather than trusted from the screen:
  // the refusal that matters — an account this chart does not have — must not
  // depend on the browser having asked first.
  if (target === "transactions") {
    const preview = await previewImport(sb, target, rows, mapping, options);
    if (preview.missingAccounts && preview.missingAccounts.length > 0) {
      throw new DataImportError(
        `These accounts are not in this company's chart of accounts: ${preview.missingAccounts.join(", ")}. ` +
          "Import the chart of accounts first.",
      );
    }
    if (preview.unbankedAccounts && preview.unbankedAccounts.length > 0) {
      throw new DataImportError(
        `These accounts have no bank record under Banking: ${preview.unbankedAccounts.join(", ")}. ` +
          "Add the bank account there first — it is what stops a second import posting the same money twice.",
      );
    }
    if (preview.rows.length === 0) {
      throw new DataImportError("Nothing in this file could be imported");
    }
    const { data, error } = await sb.rpc("acc_import_transactions", {
      p_rows: preview.rows.map((row) => ({
        txn_date: row.values.txn_date,
        description: row.values.description,
        bank_account: row.values.bank_account,
        category_account: row.values.category_account,
        signed_minor: row.values.signed_minor,
        raw_hash: row.key,
      })),
      p_default_bank_account_id: options.bankAccountId ?? null,
    });
    if (error) throw new DataImportError(error.message);
    const result = (Array.isArray(data) ? data[0] : data) as
      | { imported?: number; skipped?: number }
      | null;
    return {
      created: Number(result?.imported ?? 0),
      updated: 0,
      skipped: Number(result?.skipped ?? 0) + (preview.duplicates ?? 0),
    };
  }

  const parsed = applyMapping(rows, mapping, target);
  if (parsed.records.length === 0) {
    throw new DataImportError("Nothing in this file could be imported");
  }

  if (target === "invoices") {
    const grouped = groupInvoiceRows(parsed.records as unknown as InvoiceImportRecord[]);
    if (grouped.invoices.length === 0) {
      throw new DataImportError("No invoice in this file could be assembled from its lines");
    }
    const { data, error } = await sb.rpc("acc_import_invoices", {
      p_rows: grouped.invoices.map((invoice) => ({
        external_reference: invoice.externalReference,
        customer: invoice.customer,
        issue_date: invoice.issueDate,
        due_date: invoice.dueDate,
        memo: invoice.memo,
        lines: invoice.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unit_price_minor: line.unitPriceMinor,
          income_account: line.incomeAccount,
          tax_code: line.taxCode,
        })),
      })),
    });
    if (error) throw new DataImportError(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { created?: number; skipped?: number }
      | null;
    return {
      created: Number(row?.created ?? 0),
      updated: 0,
      skipped: Number(row?.skipped ?? 0) + grouped.problems.length,
    };
  }

  const payload = parsed.records;
  let outcome: ImportOutcome;

  if (target === "chart_of_accounts") {
    const { data, error } = await sb.rpc("acc_import_accounts", { p_rows: payload });
    if (error) throw new DataImportError(error.message);
    outcome = first(data);
  } else if (target === "items") {
    const { data, error } = await sb.rpc("acc_import_items", { p_rows: payload });
    if (error) throw new DataImportError(error.message);
    outcome = first(data);
  } else {
    const { data, error } = await sb.rpc("acc_import_contacts", {
      p_rows: payload,
      p_kind: target === "customers" ? "customer" : "vendor",
    });
    if (error) throw new DataImportError(error.message);
    outcome = first(data);
  }

  const asOf = options.openingBalancesAsOf;
  if (!asOf) return outcome;

  const balances = payload
    .map((record) => ({
      name: String(record.name ?? ""),
      account_code: String(record.account_code ?? ""),
      // What the file believed this account to be. The database refuses to post
      // a balance onto an account that turns out to be something else.
      account_type: String(record.account_type ?? ""),
      amount_minor: Number(record.opening_balance_minor ?? 0),
    }))
    .filter((row) => row.amount_minor !== 0);

  if (balances.length === 0) return outcome;

  if (target === "chart_of_accounts") {
    const { error } = await sb.rpc("acc_post_opening_balances", {
      p_as_of: asOf,
      p_rows: balances,
    });
    if (error) throw new DataImportError(error.message);
    return { ...outcome, openingCreated: balances.length };
  }

  if (target === "customers" || target === "vendors") {
    const rpc =
      target === "customers" ? "acc_import_opening_receivables" : "acc_import_opening_payables";
    const { data, error } = await sb.rpc(rpc, { p_as_of: asOf, p_rows: balances });
    if (error) throw new DataImportError(error.message);
    const result = (Array.isArray(data) ? data[0] : data) as { created?: number } | null;
    return { ...outcome, openingCreated: Number(result?.created ?? 0) };
  }

  return outcome;
}

function first(data: unknown): ImportOutcome {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    created: Number(row?.created ?? 0),
    updated: Number(row?.updated ?? 0),
    skipped: Number(row?.skipped ?? 0),
  };
}

/** Whether this target can carry opening balances at all. */
export function supportsOpeningBalances(target: ImportTarget): boolean {
  return fieldsFor(target).some((field) => field.key === "opening_balance_minor");
}
