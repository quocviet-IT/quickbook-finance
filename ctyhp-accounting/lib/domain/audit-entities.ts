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
};

export const ACTIVITY_VERBS: Record<string, string> = {
  insert: "Created",
  update: "Updated",
  post: "Posted",
  void: "Voided",
  reverse: "Reversed",
  delete: "Deleted",
};

/** A table name as a person would say it: mapped label, else the name with its prefix and underscores removed. */
export function auditEntityLabel(tableName: string): string {
  const mapped = ACTIVITY_ENTITIES[tableName]?.entity;
  if (mapped) return mapped;
  const words = tableName.replace(/^acc_/, "").replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
