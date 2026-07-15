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
