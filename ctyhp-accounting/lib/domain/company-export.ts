/**
 * Pure rules for the portable company archive: what is exported, how a cell is
 * written, and what the manifest claims. No database access lives here.
 */

export const SENSITIVE_TABLE = "acc_vendor_tax_profile";

/** Encrypted with an environment key, so a copy is a live secret and a useless restore. */
export const EXCLUDED_TABLES: readonly string[] = ["acc_bank_connection_secret"];

/** Every table written to data/, in dependency order so the archive reads top-down. */
export const EXPORT_TABLES: readonly string[] = [
  "acc_schema_migrations",
  "acc_currency",
  "acc_exchange_rate",
  "acc_company_setting_version",
  "acc_accounting_period",
  "acc_period_event",
  "acc_permission",
  "acc_role_permission",
  "acc_app_user",
  "acc_approval_policy",
  "acc_approval_request",
  "acc_account",
  "acc_sequence",
  "acc_journal_entry",
  "acc_journal_line",
  "acc_journal_reversal_link",
  "acc_customer",
  "acc_vendor",
  "acc_item",
  "acc_tax_code",
  "acc_1099_box",
  "acc_invoice",
  "acc_invoice_line",
  "acc_payment",
  "acc_payment_allocation",
  "acc_credit_memo",
  "acc_credit_memo_line",
  "acc_credit_memo_allocation",
  "acc_customer_refund",
  "acc_write_off",
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
  "acc_fixed_asset",
  "acc_asset_depreciation_schedule",
  "acc_bank_account",
  "acc_bank_connection",
  "acc_bank_feed_account",
  "acc_bank_feed_sync_run",
  "acc_bank_import_batch",
  "acc_bank_transaction",
  "acc_reconciliation",
  "acc_reconciliation_line",
  "acc_statement_reconciliation",
  "acc_tax_payment",
  "acc_budget",
  "acc_budget_line",
  "acc_recurring_template",
  "acc_recurring_run",
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
 * Most tables key on `id`, which is the default. These eight key on text and
 * have no `id` column at all; ordering them by one would not drift quietly, it
 * would throw, because Postgres validates the column even on an empty table.
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
