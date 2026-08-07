import type { SupabaseClient } from "@supabase/supabase-js";
import { DataImportError, previewTransactionImport } from "./transaction-import-preview";
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
import { transactionFileChecksum } from "@/lib/domain/transaction-import";

// The class lives beside the lookups that throw it; re-exported here because
// every caller has always imported it from this module.
export { DataImportError } from "./transaction-import-preview";

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
  /**
   * Rows carrying no money — a waived fee written as 0.00.
   *
   * Counted apart from `problems` because they are not faults: nothing is wrong
   * with the file, and there is simply nothing to post.
   */
  emptyRows?: number;
  /**
   * Accounts the file uses as a bank that are not bank accounts at all.
   *
   * Kept apart from `unbankedAccounts`, which can be fixed under Banking. This
   * one cannot: telling somebody to add "Cash on Hand" under Banking when it is
   * a current asset sends them somewhere it will never appear.
   */
  nonBankAccounts?: string[];
  /**
   * Names in the file that match more than one account in the chart, with the
   * codes of every account they match.
   *
   * A chart holding "1000 Cash on Hand" and "140 Cash on Hand" makes the bare
   * name a question, not a reference. It blocks: the resolver used to take one
   * of them, and which one it took decided whether the money landed in a bank
   * account or a current asset. Nobody can review a choice made that way, so it
   * is handed back to the only person who knows the answer.
   */
  ambiguousAccounts?: { ref: string; codes: string[] }[];
  /** Accounts named by the file that this company's chart does not have. */
  missingAccounts?: string[];
  /**
   * Bank accounts with no record under Banking. Dedupe lives on the bank line's
   * unique hash, so without one a second import would post the same money
   * again — which is why this blocks rather than warns.
   */
  unbankedAccounts?: string[];
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

  // Transactions are the one target that posts both sides of an entry, so its
  // preview asks questions no other target does. It lives in its own file.
  if (target === "transactions") {
    return previewTransactionImport(sb, parsed, mapping, options);
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
  options: {
    openingBalancesAsOf?: string | null;
    bankAccountId?: string | null;
    /** What to record this import under, so it can be found and undone. */
    fileName?: string | null;
  } = {},
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
    // The database refuses these too, one row into the loop. Refusing here says
    // which names and what to write instead, rather than surfacing whichever
    // row happened to reach the resolver first.
    if (preview.ambiguousAccounts && preview.ambiguousAccounts.length > 0) {
      throw new DataImportError(
        `${preview.ambiguousAccounts
          .map(({ ref, codes }) => `"${ref}" belongs to ${codes.join(" and ")}`)
          .join("; ")}. Write the account code in the file instead of the name.`,
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
      // What the import records about itself, so it can be found and undone.
      // The checksum comes from the rows rather than the file's own bytes: it
      // has to recognise the same export uploaded again under another name.
      p_file_name: options.fileName?.trim() || "transactions.csv",
      p_sha256: transactionFileChecksum(rows),
      p_line_count: rows.length,
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
