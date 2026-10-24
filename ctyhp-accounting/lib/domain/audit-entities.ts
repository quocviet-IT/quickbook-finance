/**
 * Plain names for the tables the audit log records.
 *
 * Pure, so the dashboard service and the client-side Audit History screen read
 * the same labels.
 */

export type DashboardActivityCategory =
  | "sales"
  | "purchases"
  | "inventory"
  | "banking"
  | "close"
  | "governance"
  | "other";

export const ACTIVITY_ENTITIES: Record<
  string,
  { entity: string; href: string; category: DashboardActivityCategory }
> = {
  acc_invoice: { entity: "Invoice", href: "/invoices", category: "sales" },
  acc_estimate: { entity: "Estimate", href: "/estimates", category: "sales" },
  acc_sales_receipt: { entity: "Sales receipt", href: "/sales-receipts", category: "sales" },
  acc_payment: { entity: "Customer payment", href: "/payments", category: "sales" },
  acc_credit_memo: { entity: "Credit memo", href: "/credit-memos", category: "sales" },
  acc_bill: { entity: "Bill", href: "/bills", category: "purchases" },
  acc_bill_payment: { entity: "Bill payment", href: "/pay-bills", category: "purchases" },
  acc_vendor_credit: { entity: "Vendor credit", href: "/vendor-credits", category: "purchases" },
  acc_expense: { entity: "Expense", href: "/expenses", category: "purchases" },
  acc_purchase_order: { entity: "Purchase order", href: "/purchase-orders", category: "purchases" },
  acc_goods_receipt: { entity: "Goods receipt", href: "/purchase-orders", category: "inventory" },
  acc_inventory_txn: { entity: "Inventory movement", href: "/items", category: "inventory" },
  acc_stock_count: { entity: "Stock count", href: "/inventory/stock-count", category: "inventory" },
  acc_journal_entry: { entity: "Journal entry", href: "/journal", category: "close" },
  acc_statement_reconciliation: { entity: "Bank reconciliation", href: "/banking/reconcile", category: "banking" },
  acc_approval_request: { entity: "Approval request", href: "/approvals", category: "governance" },
  acc_accounting_period: { entity: "Accounting period", href: "/settings/periods", category: "close" },
  acc_company_setting: { entity: "Company settings", href: "/settings/company", category: "governance" },
  acc_vendor_tax_profile: { entity: "Vendor tax profile", href: "/vendors", category: "governance" },
  acc_budget: { entity: "Budget", href: "/reports", category: "close" },
  acc_work_item_state: { entity: "Work queue item", href: "/settings/audit", category: "other" },
  acc_bank_transaction: { entity: "Bank transaction", href: "/banking", category: "banking" },
  acc_bank_rule: { entity: "Bank rule", href: "/banking", category: "banking" },
  // Cash on hand counts (feat/cash-count, migration 0154). Listed here so that
  // branch's entry in lib/services/dashboard.ts has a home once both merge.
  acc_cash_count: { entity: "Cash count", href: "/accounts", category: "banking" },
  acc_balance_comparison: { entity: "Balance comparison", href: "/reports/balance-comparison", category: "close" },
  acc_balance_comparison_line: { entity: "Balance comparison line", href: "/reports/balance-comparison", category: "close" },
  acc_bank_account: { entity: "Bank account", href: "/banking", category: "banking" },
  acc_account: { entity: "Account", href: "/settings/audit", category: "other" },
  acc_item: { entity: "Product or service", href: "/items", category: "inventory" },
  acc_customer: { entity: "Customer", href: "/customers", category: "sales" },
  acc_vendor: { entity: "Vendor", href: "/vendors", category: "purchases" },
  acc_tax_code: { entity: "Sales tax code", href: "/settings/audit", category: "other" },
  acc_recurring_template: { entity: "Recurring transaction", href: "/settings/audit", category: "other" },
  acc_app_user: { entity: "User", href: "/settings/audit", category: "governance" },
  acc_approval_policy: { entity: "Approval policy", href: "/settings/audit", category: "governance" },
  acc_company_setting_version: { entity: "Company settings version", href: "/settings/company", category: "governance" },
  acc_document_attachment: { entity: "Attachment", href: "/settings/audit", category: "other" },
  acc_purchasing_config: { entity: "Purchasing settings", href: "/settings/audit", category: "governance" },
  acc_role_permission: { entity: "Role permission", href: "/settings/audit", category: "governance" },
  acc_write_off: { entity: "Write-off", href: "/settings/audit", category: "sales" },
  acc_bank_import_batch: { entity: "Statement import", href: "/banking", category: "banking" },
  acc_bank_connection: { entity: "Bank connection", href: "/banking", category: "banking" },
  acc_bank_feed_sync_run: { entity: "Bank feed update", href: "/banking", category: "banking" },
  acc_reconciliation: { entity: "Bank match", href: "/banking", category: "banking" },
  acc_repayment_account: { entity: "Card or loan", href: "/banking/rules", category: "banking" },
  acc_related_company: { entity: "Related company", href: "/banking/rules", category: "banking" },
  acc_saved_report: { entity: "Saved report", href: "/reports/saved", category: "other" },
  acc_number_gap_note: { entity: "Number gap note", href: "/reports/number-sequence", category: "governance" },
  acc_backup: { entity: "Backup", href: "/settings/backups", category: "governance" },
};

export const ACTIVITY_VERBS: Record<string, string> = {
  insert: "Created",
  update: "Updated",
  post: "Posted",
  void: "Voided",
  reverse: "Reversed",
  delete: "Deleted",
  // Actions with their own names, in the past tense like the rest.
  disconnect: "Disconnected",
  undo: "Undone",
  recode: "Recoded",
  undo_recode: "Recode undone",
  uncategorise: "Uncategorized",
  override: "Imported out of balance",
  add_statement_lines: "Statement lines added",
  remove_balance_entries: "Balance entries removed",
  statement_file: "Statement file kept",
  keep_statement_file: "Statement file kept",
  match_from_reconciliation: "Matched by reconciliation",
  "company.backup": "Backed up",
};

/**
 * What the application does around the books, rather than a change to them:
 * the work queue's own bookkeeping, statement files kept beside an import or a
 * reconciliation, the bank lines a completed reconciliation matched on its
 * own, saved reports, nightly backups, and anything no person did.
 *
 * True, and kept in the audit log. But on the Change Log they buried the
 * changes a reader came for, so it hides them until asked.
 */
const SYSTEM_TABLES = new Set(["acc_work_item_state", "acc_saved_report", "acc_backup"]);
const SYSTEM_ACTIONS = new Set(["statement_file", "keep_statement_file", "match_from_reconciliation", "company.backup"]);

export function isSystemActivity(row: { table_name: string; action: string; actor_id: string | null }): boolean {
  return row.actor_id === null || SYSTEM_TABLES.has(row.table_name) || SYSTEM_ACTIONS.has(row.action);
}

/** A table name as a person would say it: mapped label, else the name with its prefix and underscores removed. */
export function auditEntityLabel(tableName: string): string {
  const mapped = ACTIVITY_ENTITIES[tableName]?.entity;
  if (mapped) return mapped;
  const words = tableName.replace(/^acc_/, "").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
