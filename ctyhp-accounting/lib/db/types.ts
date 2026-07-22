/**
 * Row types for the acc_* tables. Hand-authored to match the SQL migrations;
 * once the DB is linked these can be regenerated with `supabase gen types`.
 */
import type { AccountType } from "@/lib/domain/accounts";

export type AccountStatus = "draft" | "active" | "inactive" | "archived";
export type TaxDirection = "sales" | "purchase" | "none";
export type JournalSource =
  | "invoice"
  | "payment"
  | "manual"
  | "bank"
  | "reconciliation"
  | "opening_balance";
export type JournalStatus = "posted" | "void";
export type AppRole = "admin" | "accountant" | "viewer";

export interface AccountRow {
  id: string;
  account_code: string;
  name: string;
  account_type: AccountType;
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
  created_at: string;
}

export interface ReconciliationRow {
  id: string;
  bank_transaction_id: string;
  payment_id: string | null;
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
