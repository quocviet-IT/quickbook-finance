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
