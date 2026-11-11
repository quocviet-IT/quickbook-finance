/**
 * Pure rules for the portable company archive: what is exported, how a cell is
 * written, and what the manifest claims. No database access lives here.
 */

import { auditEntityLabel } from "./audit-entities";

export const SENSITIVE_TABLE = "acc_vendor_tax_profile";

/**
 * Plain names for the kinds of record 3.0.15 added to the export — what a
 * restore of an older snapshot lists as having come back empty. The rest fall
 * back to the audit log's names (auditEntityLabel). The first live drill
 * showed "Afda rate" and "Number gap note" to a bookkeeper; these say it.
 */
export const RECORD_KIND_LABELS: Readonly<Record<string, string>> = {
  acc_cash_flow_close_snapshot: "Cash flow figures frozen at period close",
  acc_posting_default: "Posting defaults",
  acc_number_gap_note: "Reasons for skipped document numbers",
  acc_adjusting_entry: "Adjusting-entry marks",
  acc_afda_rate: "Doubtful-account reserve rates",
  acc_inventory_writedown: "Inventory write-downs",
  acc_bank_rule: "Bank rules",
  acc_bank_category: "Bank categories",
  acc_banking_preference: "Banking preferences",
  acc_import_batch_entry: "Journal entries each import made",
  acc_import_batch_document: "Invoices each import made",
  acc_bank_feed_skip: "Bank-feed lines skipped as already recorded",
  acc_reconciliation_statement_line: "Statement lines of each reconciliation",
  acc_financial_analysis: "Financial analysis",
  acc_work_policy: "Work queue settings",
  acc_work_item_state: "Work queue item status",
};

/** A kind of record as a person would name it, never as its table. */
export function recordKindLabel(table: string): string {
  return RECORD_KIND_LABELS[table] ?? auditEntityLabel(table);
}

/**
 * Every company table the archive deliberately does not carry, with the reason.
 *
 * The archive is also every nightly backup, so a table missing from both this
 * list and EXPORT_TABLES is a table no backup holds — and the control totals,
 * which read only the ledger, AR and AP, cannot notice. 3.0.15 found 23 such
 * tables; tests/unit/company-export-coverage.test.ts reads the migrations so a
 * new one fails there instead.
 */
export const TABLES_LEFT_OUT: Readonly<Record<string, string>> = {
  acc_bank_connection_secret:
    "Bank-feed access tokens, encrypted with this deployment's key: a copy is a live secret, and useless after a restore, where the bank is connected again instead.",
  acc_backup:
    "This company's own register of nightly snapshots. Carried into a restore, it would point the copy at the source company's files.",
  acc_us_state:
    "The list of US states. The migrations seed it identically in every company, so a copy already holds the same rows.",
  acc_number_source:
    "Which documents are numbered from which sequence. The migrations write it, not people, and a restore keeps the copy's own seeded rows.",
  acc_saved_report:
    "Saved reports and kept statement files are files in storage, which the archive does not carry; a row without its file is not a report.",
  acc_feedback_report:
    "Feedback people sent to One Book's developers about the app itself, not part of the company's books.",
  acc_feedback_attachment:
    "The screenshots attached to that feedback, stored as files outside the archive like the feedback itself.",
  acc_two_step_policy:
    "Whether signing in needs a second step: an access setting, like the user list a restore also leaves behind. The copy's only user is whoever restored it.",
};

/** What manifest.json lists as excludedTables: every table above. */
export const EXCLUDED_TABLES: readonly string[] = Object.keys(TABLES_LEFT_OUT);

/** Every table written to data/, in dependency order so the archive reads top-down. */
export const EXPORT_TABLES: readonly string[] = [
  "acc_schema_migrations",
  "acc_currency",
  "acc_exchange_rate",
  "acc_company_setting_version",
  "acc_accounting_period",
  "acc_period_event",
  // The cash-flow figures frozen when a period closed (0081).
  "acc_cash_flow_close_snapshot",
  "acc_permission",
  "acc_role_permission",
  "acc_app_user",
  "acc_approval_policy",
  "acc_approval_request",
  "acc_account",
  // Which accounts a new deposit, payment, sale or purchase starts from (0187).
  "acc_posting_default",
  "acc_sequence",
  // Why a document number was skipped (0066).
  "acc_number_gap_note",
  "acc_journal_entry",
  "acc_journal_line",
  "acc_journal_reversal_link",
  // Which journal entries are year-end adjustments (0124).
  "acc_adjusting_entry",
  "acc_customer",
  "acc_vendor",
  "acc_item",
  "acc_tax_code",
  "acc_1099_box",
  // Estimates (0141): a customer, items, income accounts and tax codes; the
  // invoice made from one points back at it, so they come before acc_invoice.
  "acc_estimate",
  "acc_estimate_line",
  "acc_invoice",
  "acc_invoice_line",
  // Sales receipts (0164): a customer, items, income accounts, tax codes and
  // a deposit account, and the journal entry each posted.
  "acc_sales_receipt",
  "acc_sales_receipt_line",
  "acc_payment",
  "acc_payment_allocation",
  "acc_credit_memo",
  "acc_credit_memo_line",
  "acc_credit_memo_allocation",
  "acc_customer_refund",
  "acc_write_off",
  // The reserve rate for each age of receivable (0093).
  "acc_afda_rate",
  "acc_bill",
  "acc_bill_line",
  "acc_bill_payment",
  "acc_bill_payment_allocation",
  "acc_expense",
  "acc_expense_line",
  "acc_vendor_credit",
  "acc_vendor_credit_line",
  "acc_vendor_credit_allocation",
  "acc_purchase_order",
  "acc_purchase_order_line",
  "acc_goods_receipt",
  "acc_goods_receipt_line",
  "acc_po_variance_exception",
  "acc_purchasing_config",
  "acc_inventory_txn",
  // Stock written down to what it can still be sold for (0079).
  "acc_inventory_writedown",
  // Stock Count (0139): a count references accounts, a journal entry and an approval request.
  "acc_stock_count",
  "acc_stock_count_line",
  // Cash count (0154): a count references accounts, a journal entry and an approval request.
  "acc_cash_count",
  // Balance comparison (0155): the lines reference their date's header.
  "acc_balance_comparison",
  "acc_balance_comparison_line",
  "acc_fixed_asset",
  "acc_asset_depreciation_schedule",
  "acc_bank_account",
  // Bank rules, the categories a bank line can take, and the banking
  // preferences (0126, 0098, 0127).
  "acc_bank_rule",
  "acc_bank_category",
  "acc_banking_preference",
  // Cards and loans (0129): which accounts a bank payment repays.
  "acc_repayment_account",
  // Related companies (0131): which account carries what each owes or is owed.
  "acc_related_company",
  "acc_bank_connection",
  "acc_bank_feed_account",
  "acc_bank_feed_sync_run",
  "acc_bank_import_batch",
  // The general-ledger and transactions import register (0102/0108) —
  // acc_bank_transaction.transaction_batch_id references it. Listed here,
  // before that table, for the same reason acc_bank_import_batch is: the
  // live restore proved this list matters as a readable approximation of
  // dependency order even though the actual load order is derived from the
  // schema's own foreign keys at restore time, not from this list.
  "acc_import_batch",
  // Which entries and invoices each import made, so an import can be undone
  // (0102, 0116).
  "acc_import_batch_entry",
  "acc_import_batch_document",
  "acc_bank_transaction",
  // What each bank-feed sync added or retired (0137), so a sync can be undone.
  "acc_bank_feed_sync_change",
  // Bank-feed lines skipped because the books already held them (0161).
  "acc_bank_feed_skip",
  "acc_reconciliation",
  "acc_reconciliation_line",
  "acc_statement_reconciliation",
  // The statement lines a reconciliation was worked from (0132).
  "acc_reconciliation_statement_line",
  "acc_tax_payment",
  "acc_budget",
  "acc_budget_line",
  "acc_recurring_template",
  "acc_recurring_run",
  // Frozen financial analyses (0115).
  "acc_financial_analysis",
  // The work queue: its thresholds, and what was done about each item (0119, 0118).
  "acc_work_policy",
  "acc_work_item_state",
  "acc_document_attachment",
  "acc_document_access_log",
  "acc_audit_log",
];

/**
 * How each exported table is ordered when it is read.
 *
 * `readTable` pages with `.range()`, and Postgres does not have to answer two
 * unordered queries the same way — so without this, page two of a large table
 * can repeat rows page one already returned and drop others in their place. The
 * largest company here holds 20,740 journal lines, twenty-one pages of them.
 *
 * Most tables key on `id`, which is the default. These have no `id` column at
 * all; ordering them by one would not drift quietly, it would throw, because
 * Postgres validates the column even on an empty table — and one table
 * throwing fails the whole nightly backup. Each lists its primary key.
 */
export const ORDER_COLUMNS: Record<string, string[]> = {
  acc_schema_migrations: ["filename"],
  acc_currency: ["code"],
  acc_permission: ["key"],
  acc_role_permission: ["role", "permission_key"],
  acc_approval_policy: ["action_key"],
  acc_sequence: ["key"],
  acc_purchasing_config: ["singleton"],
  acc_1099_box: ["code"],
  acc_cash_flow_close_snapshot: ["period_id"],
  acc_number_gap_note: ["sequence_key", "number_value"],
  acc_adjusting_entry: ["journal_entry_id"],
  acc_afda_rate: ["bucket_key"],
  acc_import_batch_entry: ["batch_id", "journal_entry_id"],
  acc_import_batch_document: ["batch_id", "document_kind", "document_id"],
  acc_work_item_state: ["work_key"],
};

export function orderColumnsFor(table: string): string[] {
  return ORDER_COLUMNS[table] ?? ["id"];
}

export interface ExportDataset {
  table: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  sensitive: boolean;
}

export interface ExportControlTotals {
  trialBalanceDebitMinor: number;
  trialBalanceCreditMinor: number;
  arTotalMinor: number;
  apTotalMinor: number;
  journalLineCount: number;
}

// Exported because the restore parser must strip exactly the guard this set
// applies; a second list of these four characters would be free to drift and
// silently corrupt every value that starts with one of them.
export const FORMULA_LEAD = new Set(["=", "+", "-", "@"]);

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell.
  const guarded = FORMULA_LEAD.has(raw[0] ?? "") ? `'${raw}` : raw;
  const mustQuote = guarded !== raw || /[",\r\n]/.test(guarded);
  return mustQuote ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.map(cell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(","));
  return lines.join("\r\n");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildManifest(input: {
  datasets: ExportDataset[];
  files: Array<{ path: string; sha256: string; rowCount: number }>;
  totals: ExportControlTotals;
  /**
   * The date the control totals were measured at. Balances move with the
   * reporting date — a future-dated entry is excluded until its date arrives —
   * so a restore must be checked at this same date or the figures will differ
   * for a reason that has nothing to do with the restore.
   */
  controlTotalsAsOf: string;
  schemaVersion: string;
  generatedAt: string;
  actorEmail: string;
}): string {
  return JSON.stringify(
    {
      format: "ctyhp-accounting-company-export",
      formatVersion: 1,
      generatedAt: input.generatedAt,
      generatedBy: input.actorEmail,
      schemaVersion: input.schemaVersion,
      containsSensitiveData: input.datasets.some((dataset) => dataset.sensitive),
      excludedTables: EXCLUDED_TABLES,
      controlTotals: input.totals,
      controlTotalsAsOf: input.controlTotalsAsOf,
      files: input.files,
      tables: input.datasets.map((dataset) => ({
        table: dataset.table,
        rowCount: dataset.rows.length,
        columns: dataset.columns,
        sensitive: dataset.sensitive,
      })),
    },
    null,
    2,
  );
}

/** Where a table's CSV lives inside the archive. */
export function archivePathFor(table: string): string {
  if (table === SENSITIVE_TABLE) return "sensitive/vendor-tax.csv";
  if (table === "acc_document_attachment") return "attachments.csv";
  return `data/${table}.csv`;
}

export function exportFileName(companyName: string, generatedAt: string): string {
  const slug = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "company"}-company-export-${generatedAt.slice(0, 10)}.zip`;
}
