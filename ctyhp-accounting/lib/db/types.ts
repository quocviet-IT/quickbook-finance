/**
 * Row types for the acc_* tables. Hand-authored to match the SQL migrations;
 * once the DB is linked these can be regenerated with `supabase gen types`.
 */
import type { AccountType } from "@/lib/domain/accounts";
import type { CashFlowRole } from "@/lib/domain/cashflow";

export type AccountStatus = "draft" | "active" | "inactive" | "archived";
export type TaxDirection = "sales" | "purchase" | "none";
export type JournalSource =
  | "invoice"
  | "payment"
  | "manual"
  | "bank"
  | "reconciliation"
  | "opening_balance"
  | "bill"
  | "expense"
  | "bill_payment"
  | "tax_payment"
  | "goods_receipt"
  | "inventory"
  | "inventory_adjustment"
  | "depreciation"
  | "asset_disposal";
export type JournalStatus = "posted" | "void";
export type AppRole = "admin" | "accountant" | "sales" | "viewer";

export type DocumentEntityType =
  | "invoice"
  | "bill"
  | "expense"
  | "purchase_order"
  | "payment"
  | "bill_payment"
  | "credit_memo"
  | "vendor_credit"
  | "journal_entry"
  | "fixed_asset"
  | "bank_transaction"
  | "goods_receipt";
export type DocumentKind =
  | "receipt"
  | "vendor_bill"
  | "customer_document"
  | "purchase_order"
  | "bank_statement"
  | "contract"
  | "tax_document"
  | "other";
export type DocumentScanStatus = "not_configured" | "pending" | "clean" | "blocked" | "error";
export type DocumentStatus = "active" | "archived";

export interface DocumentAttachmentRow {
  id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  document_kind: DocumentKind;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  description: string | null;
  scan_status: DocumentScanStatus;
  scan_attempts: number;
  scan_started_at: string | null;
  scan_completed_at: string | null;
  scan_engine: string | null;
  threat_name: string | null;
  scan_error: string | null;
  retention_until: string | null;
  legal_hold: boolean;
  status: DocumentStatus;
  uploaded_by: string;
  uploaded_at: string;
  archived_by: string | null;
  archived_at: string | null;
  archive_reason: string | null;
}

export interface AccountRow {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
  cash_flow_role: CashFlowRole;
  detail_type: string | null;
  parent_account_id: string | null;
  description: string | null;
  default_tax_code_id: string | null;
  currency_code: string | null;
  is_posting_account: boolean;
  status: AccountStatus;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  is_base: boolean;
}

export interface TaxCodeRow {
  id: string;
  code: string;
  name: string;
  rate_percent: number;
  direction: TaxDirection;
  tax_account_id: string | null;
  is_active: boolean;
  /** US state the rate is filed in; null for a code tied to no jurisdiction. */
  state_code: string | null;
}

export interface UsStateRow {
  code: string;
  name: string;
}

export interface JournalEntryRow {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  source_type: JournalSource;
  source_id: string | null;
  currency_code: string;
  status: JournalStatus;
  created_by: string | null;
  posted_at: string;
  voided_at: string | null;
}

export interface JournalLineRow {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit_minor: number;
  credit_minor: number;
  amount_base_minor: number;
  tax_code_id: string | null;
  memo: string | null;
  line_order: number;
}

export type InvoiceStatus = "draft" | "issued" | "partial" | "paid" | "void";
export type PaymentStatus = "unapplied" | "partial" | "applied" | "void";

export interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  currency_code: string | null;
  is_active: boolean;
  /** Contact and billing address (migration 0060); null on records predating it. */
  contact_name: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  /** Credit control (migration 0069). A null limit means none is enforced. */
  credit_limit_minor: number | null;
  credit_terms_days: number | null;
  credit_hold: boolean;
  credit_reviewed_at: string | null;
  credit_review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  customer_id: string;
  issue_date: string;
  due_date: string | null;
  currency_code: string;
  subtotal_minor: number;
  tax_total_minor: number;
  total_minor: number;
  balance_due_minor: number;
  status: InvoiceStatus;
  order_id: string | null;
  journal_entry_id: string | null;
  memo: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_order: number;
  description: string;
  quantity: number;
  unit_price_minor: number;
  income_account_id: string;
  tax_code_id: string | null;
  item_id: string | null;
  line_subtotal_minor: number;
  line_tax_minor: number;
  line_total_minor: number;
}

export interface PaymentRow {
  id: string;
  payment_number: string | null;
  customer_id: string;
  payment_date: string;
  currency_code: string;
  amount_minor: number;
  unapplied_minor: number;
  method: string | null;
  reference: string | null;
  deposit_account_id: string;
  status: PaymentStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export type BankTxnStatus = "unmatched" | "matched" | "ignored";
export type ReconciliationStatus = "suggested" | "approved" | "rejected";

export interface BankAccountRow {
  id: string;
  account_id: string;
  bank_name: string;
  account_number_masked: string | null;
  currency_code: string;
  created_at: string;
}

export interface BankTransactionRow {
  id: string;
  bank_account_id: string;
  import_batch_id: string | null;
  txn_date: string;
  description: string;
  reference: string | null;
  amount_minor: number;
  running_balance_minor: number | null;
  raw_line: string | null;
  raw_hash: string;
  status: BankTxnStatus;
  source: "file_upload" | "bank_feed";
  external_transaction_id: string | null;
  provider_account_id: string | null;
  provider_revision: number;
  pending: boolean;
  authorized_date: string | null;
  merchant_name: string | null;
  category: string | null;
  provider_removed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReconciliationRow {
  id: string;
  bank_transaction_id: string;
  payment_id: string | null;
  journal_line_id: string | null;
  rule_applied: string | null;
  confidence: number;
  status: ReconciliationStatus;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

// --- Payables (Module 3b) ---
export interface VendorRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  currency_code: string | null;
  ap_account_id: string | null;
  default_expense_account_id: string | null;
  payment_terms: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  payment_terms_days: number | null;
  discount_percent: number | null;
  discount_days: number | null;
}

export type BillStatus = "draft" | "open" | "partial" | "paid" | "void";

export interface BillRow {
  id: string;
  bill_number: string | null;
  vendor_ref: string | null;
  vendor_id: string;
  bill_date: string;
  due_date: string | null;
  currency_code: string;
  total_minor: number;
  balance_due_minor: number;
  status: BillStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  /** Terms the bill was raised under — a snapshot, not the vendor's current terms. */
  terms_label: string | null;
  discount_due_date: string | null;
  discount_amount_minor: number;
  discount_taken_minor: number;
}

export interface BillLineRow {
  id: string;
  bill_id: string;
  line_order: number;
  description: string;
  expense_account_id: string;
  amount_minor: number;
  item_id: string | null;
}

export type ExpenseStatus = "posted" | "void";

export interface ExpenseRow {
  id: string;
  expense_number: string | null;
  vendor_id: string | null;
  payment_account_id: string;
  expense_date: string;
  currency_code: string;
  total_minor: number;
  status: ExpenseStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseLineRow {
  id: string;
  expense_id: string;
  line_order: number;
  description: string;
  expense_account_id: string;
  amount_minor: number;
}

export type BillPaymentStatus = "unapplied" | "partial" | "applied" | "void";

export interface BillPaymentRow {
  id: string;
  payment_number: string | null;
  vendor_id: string;
  payment_date: string;
  currency_code: string;
  amount_minor: number;
  unapplied_minor: number;
  payment_account_id: string;
  method: string | null;
  status: BillPaymentStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

// --- Products & Services ---
export interface ItemRow {
  id: string;
  item_code: string | null;
  name: string;
  description: string;
  is_sold: boolean;
  sales_price_minor: number;
  income_account_id: string | null;
  sales_tax_code_id: string | null;
  is_purchased: boolean;
  purchase_cost_minor: number;
  expense_account_id: string | null;
  is_inventory: boolean;
  inventory_account_id: string | null;
  cogs_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- Sales Tax ---
export type TaxPaymentStatus = "posted" | "void";

export interface TaxPaymentRow {
  id: string;
  payment_number: string | null;
  tax_account_id: string;
  bank_account_id: string;
  payment_date: string;
  currency_code: string;
  amount_minor: number;
  period_start: string | null;
  period_end: string | null;
  status: TaxPaymentStatus;
  journal_entry_id: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

// --- Manual journal / reversal (Module B) ---
export interface JournalReversalLinkRow {
  id: string;
  original_entry_id: string;
  reversal_entry_id: string;
  reason: string;
  created_by: string | null;
  created_at: string;
}

// --- AR/AP credits, refunds, write-offs ---
export type CreditStatus = "draft" | "issued" | "partial" | "applied" | "void";

export interface CreditMemoRow {
  id: string;
  credit_memo_number: string | null;
  customer_id: string;
  memo_date: string;
  currency_code: string;
  subtotal_minor: number;
  tax_total_minor: number;
  total_minor: number;
  balance_remaining_minor: number;
  status: CreditStatus;
  reason: string | null;
  memo: string | null;
}

export interface VendorCreditRow {
  id: string;
  vendor_credit_number: string | null;
  vendor_id: string;
  credit_date: string;
  currency_code: string;
  total_minor: number;
  balance_remaining_minor: number;
  status: CreditStatus;
  vendor_ref: string | null;
  reason: string | null;
  memo: string | null;
}

export interface CustomerRefundRow {
  id: string;
  refund_number: string | null;
  customer_id: string;
  refund_date: string;
  currency_code: string;
  amount_minor: number;
  source_type: "payment" | "credit_memo";
  payment_id: string | null;
  credit_memo_id: string | null;
  status: "posted" | "void";
}

export interface WriteOffRow {
  id: string;
  write_off_number: string | null;
  side: "ar" | "ap";
  invoice_id: string | null;
  bill_id: string | null;
  amount_minor: number;
  offset_account_id: string;
  reason: string;
  status: "posted" | "void";
}

// --- Bank Reconciliation ---
export type ReconciliationSessionStatus = "in_progress" | "completed";

export interface StatementReconciliationRow {
  id: string;
  bank_account_id: string;
  statement_ending_date: string;
  beginning_balance_minor: number;
  statement_ending_balance_minor: number;
  status: ReconciliationSessionStatus;
  adjustment_entry_id: string | null;
  adjustment_reason: string | null;
  statement_ref: string | null;
  completed_at: string | null;
  created_at: string;
}

// --- Company & Periods ---
export type AccountingBasis = "accrual" | "cash";
export type PeriodStatus = "open" | "closed";

export interface AccountingPeriodRow {
  id: string;
  fiscal_year: number;
  period_month: number;
  period_start: string;
  period_end: string;
  label: string;
  status: PeriodStatus;
  close_reason: string | null;
  reopen_reason: string | null;
}
export interface CompanySettingRow {
  id: string;
  version: number;
  effective_from: string;
  legal_name: string;
  dba_name: string | null;
  ein_ref: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  fiscal_year_start_month: number;
  base_currency_code: string;
  time_zone: string;
  accounting_basis: AccountingBasis;
  default_payment_terms_days: number;
  created_at: string;
  inventory_valuation_method: string;
  inventory_policy_memo: string | null;
}

// --- Budgets and management reporting ---
export interface BudgetRow {
  id: string;
  fiscal_year: number;
  name: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type BankConnectionStatus = "active" | "attention_required" | "disconnected";

export interface BankFeedAccountRow {
  id: string;
  connection_id: string;
  bank_account_id: string;
  provider_account_id: string;
  account_name: string;
  account_mask: string | null;
  account_type: string | null;
  account_subtype: string | null;
  currency_code: string;
  is_active: boolean;
  last_balance_minor: number | null;
  created_at: string;
  updated_at: string;
}

export interface BankConnectionRow {
  id: string;
  provider: "plaid";
  provider_item_id: string;
  institution_id: string | null;
  institution_name: string;
  status: BankConnectionStatus;
  sync_cursor: string | null;
  consent_expires_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type FixedAssetMethod = "straight_line" | "none";
export type FixedAssetStatus = "in_service" | "fully_depreciated" | "disposed";
export type DepreciationScheduleStatus = "planned" | "opening" | "posted" | "cancelled";

export interface FixedAssetRow {
  id: string;
  asset_number: string;
  name: string;
  description: string | null;
  category: string;
  serial_number: string | null;
  location: string | null;
  acquisition_date: string;
  in_service_date: string;
  currency_code: string;
  cost_minor: number;
  salvage_value_minor: number;
  useful_life_months: number | null;
  depreciation_method: FixedAssetMethod;
  asset_account_id: string;
  accumulated_depreciation_account_id: string | null;
  depreciation_expense_account_id: string | null;
  vendor_id: string | null;
  source_bill_id: string | null;
  status: FixedAssetStatus;
  disposed_at: string | null;
  opening_accumulated_depreciation_minor: number;
  opening_as_of_date: string | null;
  opening_journal_entry_id: string | null;
  disposal_sale_price_minor: number | null;
  disposal_cost_minor: number | null;
  disposal_net_proceeds_minor: number | null;
  disposal_gain_loss_minor: number | null;
  disposal_proceeds_account_id: string | null;
  disposal_gain_account_id: string | null;
  disposal_loss_account_id: string | null;
  disposal_journal_entry_id: string | null;
  disposal_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetDepreciationScheduleRow {
  id: string;
  asset_id: string;
  sequence_number: number;
  period_start: string;
  period_end: string;
  planned_amount_minor: number;
  posted_amount_minor: number;
  status: DepreciationScheduleStatus;
  journal_entry_id: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_at: string;
}

export type RecurringDocumentType = "invoice" | "bill" | "expense" | "journal";
export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly";
export type RecurringTemplateStatus = "active" | "paused" | "ended";
export type RecurringRunStatus =
  | "processing"
  | "generated"
  | "pending_review"
  | "awaiting_approval"
  | "failed";

export interface RecurringTemplateRow {
  id: string;
  name: string;
  document_type: RecurringDocumentType;
  frequency: RecurringFrequency;
  interval_count: number;
  start_date: string;
  next_run_date: string;
  end_date: string | null;
  payload: Record<string, unknown>;
  total_minor: number;
  status: RecurringTemplateStatus;
  last_run_at: string | null;
  last_run_status: RecurringRunStatus | null;
  last_error: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringRunRow {
  id: string;
  template_id: string;
  template_name?: string;
  document_type: RecurringDocumentType;
  scheduled_date: string;
  payload_snapshot: Record<string, unknown>;
  status: RecurringRunStatus;
  document_id: string | null;
  approval_request_id: string | null;
  error_message: string | null;
  generated_by: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface BudgetLineRow {
  id: string;
  budget_id: string;
  account_id: string;
  period_start: string;
  amount_minor: number;
  created_at: string;
  updated_at: string;
}

// --- Purchasing (Module G1) ---
export type PoStatus = "draft" | "open" | "partial" | "received" | "closed" | "cancelled";
export type ReceiptStatus = "posted" | "void";
export type VarianceKindRow = "price" | "quantity";

export interface PurchaseOrderRow {
  id: string;
  po_number: string | null;
  vendor_id: string;
  order_date: string;
  expected_date: string | null;
  currency_code: string;
  ship_to: string | null;
  memo: string | null;
  total_minor: number;
  status: PoStatus;
  close_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderLineRow {
  id: string;
  purchase_order_id: string;
  line_order: number;
  item_id: string | null;
  description: string;
  quantity: number;
  unit_cost_minor: number;
  expense_account_id: string;
  line_total_minor: number;
  qty_received: number;
  qty_billed: number;
  is_closed: boolean;
}

export interface GoodsReceiptRow {
  id: string;
  receipt_number: string | null;
  purchase_order_id: string;
  vendor_id: string;
  receipt_date: string;
  memo: string | null;
  status: ReceiptStatus;
  void_reason: string | null;
  created_at: string;
}

export interface GoodsReceiptLineRow {
  id: string;
  goods_receipt_id: string;
  purchase_order_line_id: string;
  quantity: number;
  unit_cost_minor: number;
}

export interface PurchasingConfigRow {
  price_tolerance_bps: number;
  qty_tolerance_bps: number;
  updated_at: string;
}

export interface PoVarianceExceptionRow {
  id: string;
  bill_id: string;
  purchase_order_id: string;
  purchase_order_line_id: string;
  kind: VarianceKindRow;
  expected_value: number;
  actual_value: number;
  variance_bps: number;
  reason: string;
  created_at: string;
}

export interface ReceivedNotBilledRow {
  purchase_order_id: string;
  purchase_order_line_id: string;
  po_number: string | null;
  vendor_name: string;
  order_date: string;
  description: string;
  qty_outstanding: number;
  unit_cost_minor: number;
  value_minor: number;
  currency_code: string;
}

// --- Inventory (Module G2) ---
export type InventorySource = "receipt" | "bill_variance" | "sale" | "adjustment" | "reversal";

export interface InventoryTxnRow {
  id: string;
  seq: number;
  item_id: string;
  txn_date: string;
  source: InventorySource;
  source_id: string | null;
  qty_delta: number;
  cost_delta_minor: number;
  running_qty: number;
  running_value_minor: number;
  journal_entry_id: string | null;
  reversal_of: string | null;
  memo: string | null;
  created_at: string;
}

export interface InventoryValuationRow {
  item_id: string;
  item_code: string | null;
  name: string;
  inventory_account_id: string | null;
  qty_on_hand: number;
  value_minor: number;
  unit_cost_minor: number;
}

// --- Access control (Module C) ---
export type UserStatus = "invited" | "active" | "suspended" | "offboarded";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface AppUserRow {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: UserStatus;
  mfa_enrolled: boolean;
  last_sign_in: string | null;
  invited_at: string | null;
  status_reason: string | null;
}

export interface PermissionRow {
  key: string;
  label: string;
  category: string;
  description: string;
  is_enforced: boolean;
}

export interface RolePermissionRow {
  role: AppRole;
  permission_key: string;
  allowed: boolean;
}

export interface ApprovalPolicyRow {
  action_key: string;
  label: string;
  description: string;
  enabled: boolean;
  threshold_minor: number;
  require_segregation: boolean;
  updated_at: string;
}

export interface ApprovalRequestRow {
  id: string;
  action_key: string;
  title: string;
  amount_minor: number;
  payload: Record<string, unknown>;
  reason: string;
  status: ApprovalStatus;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  result_id: string | null;
  error_message: string | null;
}

/** One signed-in colleague, for resolving a document's actor id to a name. */
export interface ActorRow {
  id: string;
  email: string;
  full_name: string;
}

export interface AuditEntryRow {
  id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

// --- Vendor tax profile + 1099 (Module G3) ---
export type W9StatusRow = "not_requested" | "requested" | "on_file" | "expired";
export type TinTypeRow = "ssn" | "ein" | "itin";
export type TaxClassificationRow =
  | "individual" | "sole_proprietor" | "partnership" | "c_corporation" | "s_corporation"
  | "llc" | "trust_estate" | "exempt_payee" | "other";

export interface VendorTaxProfileRow {
  id: string;
  vendor_id: string;
  version: number;
  w9_status: W9StatusRow;
  w9_received_date: string | null;
  w9_expires_date: string | null;
  classification: TaxClassificationRow | null;
  reporting_name: string | null;
  tin_ref: string | null;
  tin_type: TinTypeRow | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string;
  is_1099_eligible: boolean;
  box_code: string | null;
  eligibility_override: boolean;
  override_reason: string | null;
  change_reason: string;
  created_at: string;
}

export interface Box1099Row {
  code: string;
  form: string;
  box_label: string;
  threshold_minor: number;
  is_active: boolean;
}

export interface Vendor1099SummaryRow {
  vendor_id: string;
  vendor_name: string;
  reporting_name: string | null;
  classification: TaxClassificationRow | null;
  w9_status: W9StatusRow;
  w9_expires_date: string | null;
  tin_on_file: boolean;
  address_complete: boolean;
  is_1099_eligible: boolean;
  box_code: string | null;
  box_label: string | null;
  threshold_minor: number;
  paid_minor: number;
  eligibility_override: boolean;
}
