/** Zod validation schemas for the accounting domain (input boundary). */
import { z } from "zod";
import { ACCOUNT_TYPES } from "./accounts";
import { USD_CURRENCY_CODE } from "./currency";
import { FEEDBACK_KINDS, FEEDBACK_STATUSES } from "./feedback";
import {
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  FEEDBACK_ATTACHMENT_MAX_FILES,
  isAllowedAttachmentType,
} from "./feedback-attachment";

export const ACCOUNT_STATUSES = ["draft", "active", "inactive", "archived"] as const;
export const usdCurrencySchema = z.literal(USD_CURRENCY_CODE, {
  error: "Only USD is supported",
});

export const accountCreateSchema = z.object({
  account_code: z
    .string()
    .trim()
    .min(1, "Account code is required")
    .max(20, "Account code is too long")
    .regex(/^[A-Za-z0-9.\-]+$/, "Account code may only contain letters, digits, '.' and '-'"),
  name: z.string().trim().min(1, "Account name is required").max(120),
  account_type: z.enum(ACCOUNT_TYPES),
  detail_type: z.string().trim().max(80).optional().nullable(),
  parent_account_id: z.uuid().optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  default_tax_code_id: z.uuid().optional().nullable(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  is_posting_account: z.boolean().default(true),
  status: z.enum(ACCOUNT_STATUSES).default("active"),
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

/** Update allows partial fields but never changes the code via this path. */
export const accountUpdateSchema = accountCreateSchema.partial().omit({ account_code: true });
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);

// --- Customers ---
/** Optional free-text contact field: empty string and null both mean "not set". */
const contactText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("")).nullable();

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(160),
  email: z.email("Enter a valid email").optional().or(z.literal("")).nullable(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  contact_name: contactText(160),
  phone: contactText(40),
  address_line1: contactText(160),
  address_line2: contactText(160),
  city: contactText(80),
  region: contactText(80),
  postal_code: contactText(20),
  country: contactText(80),
  // Credit control. Null limit = none enforced; 0 = cash only, which is a
  // different statement and has to survive the round trip as one.
  credit_limit_minor: z
    .number()
    .int("A credit limit is a whole minor-unit amount")
    .min(0, "A credit limit cannot be negative")
    .optional()
    .nullable(),
  credit_terms_days: z
    .number()
    .int()
    .min(0, "Terms must be >= 0")
    .max(365, "Terms longer than a year need a written agreement")
    .optional()
    .nullable(),
  credit_hold: z.boolean().default(false),
  credit_review_note: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
});
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema
  .omit({ currency_code: true })
  .extend({ id: z.uuid("Select a customer") });
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

// --- Invoices ---
export const invoiceLineInputSchema = z.object({
  description: z.string().trim().max(300).default(""),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unit_price_minor: z.number().int("Unit price must be a whole minor-unit amount").min(0),
  income_account_id: z.uuid("Select an income account"),
  tax_code_id: z.uuid().optional().nullable(),
  item_id: z.uuid().optional().nullable(),
});
export type InvoiceLineInputT = z.infer<typeof invoiceLineInputSchema>;

export const invoiceCreateSchema = z.object({
  customer_id: z.uuid("Select a customer"),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  issue_date: z.string().optional(),
  due_date: z.string().optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(invoiceLineInputSchema).min(1, "Add at least one line item"),
});
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;

// --- Payments ---
export const paymentAllocationSchema = z.object({
  invoice_id: z.uuid(),
  amount_minor: z.number().int().positive(),
});

export const paymentCreateSchema = z.object({
  customer_id: z.uuid("Select a customer"),
  payment_date: z.string().optional(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  amount_minor: z.number().int().positive("Amount must be greater than 0"),
  deposit_account_id: z.uuid("Select a deposit account"),
  method: z.string().trim().max(60).optional().nullable(),
  /** Check number, wire reference, ACH trace — what the bank statement shows. */
  reference: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(paymentAllocationSchema).default([]),
});
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

// --- Vendors ---
export const vendorCreateSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(160),
  email: z.email("Enter a valid email").optional().or(z.literal("")).nullable(),
  phone: z.string().trim().max(40).optional().or(z.literal("")).nullable(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  ap_account_id: z.uuid().optional().nullable(),
  default_expense_account_id: z.uuid().optional().nullable(),
  payment_terms: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
});
export type VendorCreateInput = z.infer<typeof vendorCreateSchema>;

// --- Bills ---
export const billLineInputSchema = z.object({
  description: z.string().trim().max(300).default(""),
  expense_account_id: z.uuid("Select an expense account"),
  amount_minor: z.number().int("Amount must be a whole minor-unit amount").positive("Amount must be greater than 0"),
  item_id: z.uuid().optional().nullable(),
});
export type BillLineInputT = z.infer<typeof billLineInputSchema>;

export const billCreateSchema = z.object({
  vendor_id: z.uuid("Select a vendor"),
  vendor_ref: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  bill_date: z.string().optional(),
  due_date: z.string().optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(billLineInputSchema).min(1, "Add at least one line item"),
});
export type BillCreateInput = z.infer<typeof billCreateSchema>;

// --- Expenses ---
export const expenseLineInputSchema = z.object({
  description: z.string().trim().max(300).default(""),
  expense_account_id: z.uuid("Select an expense account"),
  amount_minor: z.number().int("Amount must be a whole minor-unit amount").positive("Amount must be greater than 0"),
});
export type ExpenseLineInputT = z.infer<typeof expenseLineInputSchema>;

export const expenseCreateSchema = z.object({
  vendor_id: z.uuid().optional().nullable(),
  payment_account_id: z.uuid("Select a payment account"),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  expense_date: z.string().optional(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(expenseLineInputSchema).min(1, "Add at least one line item"),
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

// --- Bill payments ---
export const billPaymentAllocationSchema = z.object({
  bill_id: z.uuid(),
  amount_minor: z.number().int().positive(),
});

export const billPaymentCreateSchema = z.object({
  vendor_id: z.uuid("Select a vendor"),
  payment_date: z.string().optional(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  amount_minor: z.number().int().positive("Amount must be greater than 0"),
  payment_account_id: z.uuid("Select a payment account"),
  method: z.string().trim().max(60).optional().nullable(),
  reference: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(billPaymentAllocationSchema).default([]),
});
export type BillPaymentCreateInput = z.infer<typeof billPaymentCreateSchema>;

// --- Products & Services ---
export const itemCreateSchema = z
  .object({
    item_code: z.string().trim().max(40).optional().or(z.literal("")).nullable(),
    name: z.string().trim().min(1, "Item name is required").max(160),
    description: z.string().trim().max(300).default(""),
    is_sold: z.boolean().default(true),
    sales_price_minor: z.number().int().min(0).default(0),
    income_account_id: z.uuid().optional().nullable(),
    sales_tax_code_id: z.uuid().optional().nullable(),
    is_purchased: z.boolean().default(false),
    purchase_cost_minor: z.number().int().min(0).default(0),
    expense_account_id: z.uuid().optional().nullable(),
    is_inventory: z.boolean().default(false),
    inventory_account_id: z.uuid().optional().nullable(),
    cogs_account_id: z.uuid().optional().nullable(),
  })
  .refine((v) => v.is_sold || v.is_purchased, {
    message: "Enable at least one of Sales or Purchase",
    path: ["is_sold"],
  })
  .refine((v) => !v.is_sold || !!v.income_account_id, {
    message: "Select an income account for a sold item",
    path: ["income_account_id"],
  })
  .refine((v) => !v.is_purchased || !!v.expense_account_id, {
    message: "Select an expense account for a purchased item",
    path: ["expense_account_id"],
  })
  // An inventory item is bought, held as an asset, then relieved into COGS when
  // sold — so it needs both sides and both accounts.
  .refine((v) => !v.is_inventory || (v.is_sold && v.is_purchased), {
    message: "An inventory item must be both sold and purchased",
    path: ["is_inventory"],
  })
  .refine((v) => !v.is_inventory || !!v.inventory_account_id, {
    message: "Select an inventory asset account",
    path: ["inventory_account_id"],
  })
  .refine((v) => !v.is_inventory || !!v.cogs_account_id, {
    message: "Select a Cost of Goods Sold account",
    path: ["cogs_account_id"],
  });
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;

export const itemUpdateSchema = itemCreateSchema;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;

// --- Sales Tax ---
export const TAX_DIRECTIONS = ["sales", "purchase", "none"] as const;

export const taxCodeCreateSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(20),
  name: z.string().trim().min(1, "Name is required").max(120),
  rate_percent: z.number().min(0, "Rate must be >= 0").max(100, "Rate must be <= 100"),
  direction: z.enum(TAX_DIRECTIONS),
  tax_account_id: z.uuid().optional().nullable(),
  is_active: z.boolean().default(true),
  // Two letters, as the states table stores them. Empty means the code is not
  // tied to one jurisdiction (an exemption, or a rate not yet classified).
  state_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Pick a state")
    .optional()
    .or(z.literal(""))
    .nullable(),
});
export type TaxCodeCreateInput = z.infer<typeof taxCodeCreateSchema>;

export const taxCodeUpdateSchema = taxCodeCreateSchema;
export type TaxCodeUpdateInput = z.infer<typeof taxCodeUpdateSchema>;

export const taxPaymentCreateSchema = z.object({
  tax_account_id: z.uuid("Select the Sales Tax Payable account"),
  bank_account_id: z.uuid("Select a bank account"),
  payment_date: z.string().optional(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  amount_minor: z.number().int().positive("Amount must be greater than 0"),
  period_start: z.string().optional().nullable(),
  period_end: z.string().optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
});
export type TaxPaymentCreateInput = z.infer<typeof taxPaymentCreateSchema>;

// --- Manual journal / opening balances / reversal ---
export const manualJournalLineSchema = z
  .object({
    account_id: z.uuid("Select an account"),
    debit_minor: z.number().int("Amounts must be whole minor units").min(0),
    credit_minor: z.number().int("Amounts must be whole minor units").min(0),
  })
  .refine((l) => (l.debit_minor > 0) !== (l.credit_minor > 0), {
    message: "Each line needs exactly one of debit or credit",
    path: ["debit_minor"],
  });

export const manualJournalSchema = z
  .object({
    entry_date: z.string().optional(),
    description: z.string().trim().max(500).optional().nullable(),
    source_ref: z.string().trim().max(120).optional().or(z.literal("")).nullable(),
    currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
    lines: z.array(manualJournalLineSchema).min(2, "Add at least two lines"),
  })
  .refine(
    (v) =>
      v.lines.reduce((s, l) => s + l.debit_minor, 0) ===
      v.lines.reduce((s, l) => s + l.credit_minor, 0),
    { message: "Debits and credits must be equal", path: ["lines"] },
  );
export type ManualJournalInput = z.infer<typeof manualJournalSchema>;

export const openingBalanceLineSchema = z.object({
  account_id: z.uuid("Select an account"),
  debit_minor: z.number().int().min(0).default(0),
  credit_minor: z.number().int().min(0).default(0),
});

export const openingBalanceSchema = z.object({
  as_of: z.string().optional(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  lines: z.array(openingBalanceLineSchema).min(1, "Enter at least one opening balance"),
});
export type OpeningBalanceInput = z.infer<typeof openingBalanceSchema>;

export const reverseEntrySchema = z.object({
  entry_id: z.uuid(),
  reason: z.string().trim().min(1, "A reversal reason is required").max(300),
  reversal_date: z.string().optional(),
});
export type ReverseEntryInput = z.infer<typeof reverseEntrySchema>;

// --- AR/AP credits, refunds, write-offs ---
export const creditMemoLineSchema = z.object({
  description: z.string().trim().max(300).default(""),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unit_price_minor: z.number().int("Unit price must be a whole minor-unit amount").min(0),
  income_account_id: z.uuid("Select an income account"),
  tax_code_id: z.uuid().optional().nullable(),
});

export const creditMemoCreateSchema = z.object({
  customer_id: z.uuid("Select a customer"),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  memo_date: z.string().optional(),
  reason: z.string().trim().max(300).optional().or(z.literal("")).nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(creditMemoLineSchema).min(1, "Add at least one line"),
});
export type CreditMemoCreateInput = z.infer<typeof creditMemoCreateSchema>;

export const vendorCreditLineSchema = z.object({
  description: z.string().trim().max(300).default(""),
  expense_account_id: z.uuid("Select an expense account"),
  amount_minor: z.number().int("Amount must be a whole minor-unit amount").positive("Amount must be greater than 0"),
});

export const vendorCreditCreateSchema = z.object({
  vendor_id: z.uuid("Select a vendor"),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  credit_date: z.string().optional(),
  vendor_ref: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  reason: z.string().trim().max(300).optional().or(z.literal("")).nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(vendorCreditLineSchema).min(1, "Add at least one line"),
});
export type VendorCreditCreateInput = z.infer<typeof vendorCreditCreateSchema>;

export const creditAllocationSchema = z.object({
  target_id: z.uuid(),
  amount_minor: z.number().int().positive(),
});
export type CreditAllocationInput = z.infer<typeof creditAllocationSchema>;

export const customerRefundSchema = z
  .object({
    customer_id: z.uuid("Select a customer"),
    refund_date: z.string().optional(),
    currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
    amount_minor: z.number().int().positive("Amount must be greater than 0"),
    source_type: z.enum(["payment", "credit_memo"]),
    payment_id: z.uuid().optional().nullable(),
    credit_memo_id: z.uuid().optional().nullable(),
    bank_account_id: z.uuid("Select a bank account"),
    memo: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => (v.source_type === "payment" ? !!v.payment_id && !v.credit_memo_id : !!v.credit_memo_id && !v.payment_id), {
    message: "Provide exactly the source matching the selected type",
    path: ["source_type"],
  });
export type CustomerRefundInput = z.infer<typeof customerRefundSchema>;

export const writeOffSchema = z
  .object({
    side: z.enum(["ar", "ap"]),
    invoice_id: z.uuid().optional().nullable(),
    bill_id: z.uuid().optional().nullable(),
    offset_account_id: z.uuid("Select an offset account"),
    amount_minor: z.number().int().positive("Amount must be greater than 0"),
    write_off_date: z.string().optional(),
    reason: z.string().trim().min(1, "A reason is required").max(300),
  })
  .refine((v) => (v.side === "ar" ? !!v.invoice_id && !v.bill_id : !!v.bill_id && !v.invoice_id), {
    message: "Provide the target matching the selected side",
    path: ["side"],
  });
export type WriteOffInput = z.infer<typeof writeOffSchema>;

// --- Bank reconciliation ---
export const reconciliationCreateSchema = z.object({
  bank_account_id: z.uuid("Select a bank account"),
  statement_ending_date: z.string().min(1, "Statement ending date is required"),
  statement_ending_balance_minor: z.number().int("Ending balance must be a whole minor-unit amount"),
});
export type ReconciliationCreateInput = z.infer<typeof reconciliationCreateSchema>;

export const reconciliationAdjustmentSchema = z.object({
  offset_account_id: z.uuid("Select an offset account"),
  reason: z.string().trim().min(1, "A reason is required").max(300),
});
export type ReconciliationAdjustmentInput = z.infer<typeof reconciliationAdjustmentSchema>;

export const reconciliationReopenSchema = z.object({
  reason: z.string().trim().min(1, "A reopen reason is required").max(300),
});
export type ReconciliationReopenInput = z.infer<typeof reconciliationReopenSchema>;

// --- Company settings + accounting periods ---
export const companySettingsSchema = z.object({
  legal_name: z.string().trim().min(1, "Legal name is required").max(200),
  dba_name: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
  ein_ref: z.string().trim().max(40).optional().or(z.literal("")).nullable(),
  address_line1: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
  address_line2: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
  city: z.string().trim().max(120).optional().or(z.literal("")).nullable(),
  region: z.string().trim().max(120).optional().or(z.literal("")).nullable(),
  postal_code: z.string().trim().max(20).optional().or(z.literal("")).nullable(),
  country: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  fiscal_year_start_month: z.number().int().min(1, "Month 1-12").max(12, "Month 1-12"),
  base_currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  time_zone: z.string().trim().min(1).max(60).default("America/New_York"),
  accounting_basis: z.enum(["accrual", "cash"]),
  default_payment_terms_days: z.number().int().min(0, "Terms must be >= 0"),
});
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;

export const closePeriodSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(300),
  /** Required only when a control account does not tie out at the period end. */
  variance_note: z.string().trim().min(10, "Explain the difference in at least ten characters").optional(),
});
export const reopenPeriodSchema = z.object({ reason: z.string().trim().min(1, "A reason is required").max(300) });

// --- Cash flow ---
export const cashFlowRangeSchema = z.object({
  from: z.string().min(1, "From date is required"),
  to: z.string().min(1, "To date is required"),
});
export type CashFlowRangeInput = z.infer<typeof cashFlowRangeSchema>;

// --- Budgets and management reporting ---
export const budgetLineInputSchema = z.object({
  account_id: z.uuid("Select a valid account"),
  amount_minor: z.number().int("Budget amount must use whole minor units").safe(),
});

export const budgetMonthSaveSchema = z.object({
  fiscal_year: z.number().int().min(2000).max(2100),
  period_start: z.string().regex(/^\d{4}-\d{2}-01$/, "Budget period must start on the first day of a month"),
  lines: z.array(budgetLineInputSchema).max(500),
});
export type BudgetMonthSaveInput = z.infer<typeof budgetMonthSaveSchema>;

// --- Purchasing: purchase orders, receiving, three-way matching ---
export const purchaseOrderLineInputSchema = z.object({
  item_id: z.uuid().optional().nullable(),
  description: z.string().trim().max(300).default(""),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unit_cost_minor: z
    .number()
    .int("Unit cost must be a whole minor-unit amount")
    .min(0, "Unit cost cannot be negative"),
  expense_account_id: z.uuid("Select an expense account"),
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

export const purchaseOrderSaveSchema = z.object({
  vendor_id: z.uuid("Select a vendor"),
  order_date: z.string().min(1, "Order date is required"),
  expected_date: z.string().optional().nullable(),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  ship_to: z.string().trim().max(300).optional().or(z.literal("")).nullable(),
  memo: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
  lines: z.array(purchaseOrderLineInputSchema).min(1, "Add at least one line item"),
});
export type PurchaseOrderSaveInput = z.infer<typeof purchaseOrderSaveSchema>;

export const goodsReceiptLineSchema = z.object({
  purchase_order_line_id: z.uuid(),
  quantity: z.number().positive("Received quantity must be greater than 0"),
});

export const goodsReceiptSchema = z.object({
  receipt_date: z.string().min(1, "Receipt date is required"),
  memo: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
  lines: z.array(goodsReceiptLineSchema).min(1, "Receive at least one line"),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const billFromPoLineSchema = z.object({
  purchase_order_line_id: z.uuid(),
  quantity: z.number().positive("Billed quantity must be greater than 0"),
  unit_cost_minor: z
    .number()
    .int("Unit cost must be a whole minor-unit amount")
    .min(0, "Unit cost cannot be negative"),
});

export const billFromPoSchema = z.object({
  bill_date: z.string().min(1, "Bill date is required"),
  due_date: z.string().optional().nullable(),
  vendor_ref: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  memo: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
  lines: z.array(billFromPoLineSchema).min(1, "Bill at least one line"),
  /** Required by the server only when a line falls outside the matching tolerance. */
  variance_reason: z.string().trim().max(300).optional().or(z.literal("")).nullable(),
});
export type BillFromPoInput = z.infer<typeof billFromPoSchema>;

export const purchasingConfigSchema = z.object({
  price_tolerance_bps: z.number().int().min(0, "Tolerance must be 0-10000").max(10000, "Tolerance must be 0-10000"),
  qty_tolerance_bps: z.number().int().min(0, "Tolerance must be 0-10000").max(10000, "Tolerance must be 0-10000"),
});
export type PurchasingConfigInput = z.infer<typeof purchasingConfigSchema>;

export const purchaseOrderReasonSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(300),
});
export type PurchaseOrderReasonInput = z.infer<typeof purchaseOrderReasonSchema>;

// --- Inventory adjustments ---
export const inventoryAdjustmentSchema = z
  .object({
    item_id: z.uuid("Select an inventory item"),
    adjust_date: z.string().min(1, "Adjustment date is required"),
    qty_delta: z.number("Enter a quantity change"),
    unit_cost_minor: z.number().int().min(0).default(0),
    value_delta_minor: z.number().int().default(0),
    offset_account_id: z.uuid("Select an offset account"),
    reason: z.string().trim().min(1, "A reason is required").max(300),
  })
  .refine((v) => v.qty_delta !== 0 || v.value_delta_minor !== 0, {
    message: "An adjustment must change quantity or value",
    path: ["qty_delta"],
  })
  .refine((v) => v.qty_delta <= 0 || v.unit_cost_minor > 0, {
    message: "A unit cost is required when adding quantity",
    path: ["unit_cost_minor"],
  });
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentSchema>;

export const inventoryValuationSchema = z.object({
  as_of: z.string().min(1, "As-of date is required"),
});

// --- Access control: users, permissions, approvals, audit ---
export const APP_ROLES = ["admin", "accountant", "viewer"] as const;
export const USER_STATUSES = ["invited", "active", "suspended", "offboarded"] as const;

export const userCreateSchema = z.object({
  email: z.email("Enter a valid email"),
  full_name: z.string().trim().max(160).optional().or(z.literal("")).nullable(),
  role: z.enum(APP_ROLES),
  password: z
    .string()
    .min(12, "Use at least 12 characters")
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/\d/, "Include a number")
    .regex(/[^A-Za-z0-9]/, "Include a special character"),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userRoleSchema = z.object({
  role: z.enum(APP_ROLES),
  reason: z.string().trim().min(1, "A reason is required").max(300),
});
export type UserRoleInput = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.object({
  status: z.enum(USER_STATUSES),
  reason: z.string().trim().min(1, "A reason is required").max(300),
});
export type UserStatusInput = z.infer<typeof userStatusSchema>;

export const rolePermissionSchema = z.object({
  role: z.enum(APP_ROLES),
  permission_key: z.string().trim().min(1),
  allowed: z.boolean(),
});
export type RolePermissionInput = z.infer<typeof rolePermissionSchema>;

export const approvalPolicySchema = z.object({
  action_key: z.string().trim().min(1),
  enabled: z.boolean(),
  threshold_minor: z.number().int().min(0, "Threshold cannot be negative"),
  require_segregation: z.boolean(),
});
export type ApprovalPolicyInput = z.infer<typeof approvalPolicySchema>;

export const approvalSubmitSchema = z.object({
  action_key: z.string().trim().min(1),
  title: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
  amount_minor: z.number().int().default(0),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(1, "A reason is required").max(300),
});
export type ApprovalSubmitInput = z.infer<typeof approvalSubmitSchema>;

export const approvalDecisionSchema = z.object({
  note: z.string().trim().min(1, "A note is required").max(300),
});
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

export const auditFilterSchema = z.object({
  table_name: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  record_id: z.uuid().optional().or(z.literal("")).nullable(),
  actor_id: z.uuid().optional().or(z.literal("")).nullable(),
  action: z.string().trim().max(20).optional().or(z.literal("")).nullable(),
  from: z.string().optional().or(z.literal("")).nullable(),
  to: z.string().optional().or(z.literal("")).nullable(),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type AuditFilterInput = z.infer<typeof auditFilterSchema>;

// --- Vendor tax profile + 1099 review ---
export const W9_STATUSES = ["not_requested", "requested", "on_file", "expired"] as const;
export const TIN_TYPES = ["ssn", "ein", "itin"] as const;
export const TAX_CLASSIFICATIONS = [
  "individual", "sole_proprietor", "partnership", "c_corporation", "s_corporation",
  "llc", "trust_estate", "exempt_payee", "other",
] as const;

export const vendorTaxProfileSchema = z
  .object({
    w9_status: z.enum(W9_STATUSES),
    w9_received_date: z.string().optional().or(z.literal("")).nullable(),
    w9_expires_date: z.string().optional().or(z.literal("")).nullable(),
    classification: z.enum(TAX_CLASSIFICATIONS).optional().nullable(),
    reporting_name: z.string().trim().max(160).optional().or(z.literal("")).nullable(),
    /** A reference to the identifier, never rendered in full outside the form. */
    tin_ref: z.string().trim().max(40).optional().or(z.literal("")).nullable(),
    tin_type: z.enum(TIN_TYPES).optional().nullable(),
    address_line1: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
    address_line2: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
    city: z.string().trim().max(120).optional().or(z.literal("")).nullable(),
    region: z.string().trim().max(120).optional().or(z.literal("")).nullable(),
    postal_code: z.string().trim().max(20).optional().or(z.literal("")).nullable(),
    country: z.string().trim().max(80).default("US"),
    is_1099_eligible: z.boolean().default(false),
    box_code: z.string().trim().max(20).optional().or(z.literal("")).nullable(),
    eligibility_override: z.boolean().default(false),
    override_reason: z.string().trim().max(300).optional().or(z.literal("")).nullable(),
    reason: z.string().trim().min(1, "A change reason is required").max(300),
  })
  .refine((v) => !v.is_1099_eligible || !!v.box_code, {
    message: "Select the reporting box for an eligible vendor",
    path: ["box_code"],
  })
  .refine((v) => !v.eligibility_override || !!v.override_reason, {
    message: "An override needs its own documented reason",
    path: ["override_reason"],
  });
export type VendorTaxProfileInput = z.infer<typeof vendorTaxProfileSchema>;

export const taxYearSchema = z.object({
  year: z.number().int().min(2000, "Enter a four-digit tax year").max(2100, "Enter a four-digit tax year"),
});
export type TaxYearInput = z.infer<typeof taxYearSchema>;

// --- Feedback (bug reports and suggestions) ---
export const feedbackPageContextSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  route: z.string().trim().min(1).max(300),
  title: z.string().trim().max(300).default(""),
  viewport: z.object({
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
  }),
});

export const feedbackReportSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  description: z.string().trim().max(4000).optional().or(z.literal("")).nullable(),
  page: feedbackPageContextSchema,
  /** Base64 PNG without the data-URL prefix; ~5 MB cap matches the bucket. */
  screenshot_base64: z
    .string()
    .max(7_000_000, "The screenshot is too large to send")
    .optional()
    .or(z.literal(""))
    .nullable(),
});
export type FeedbackReportInput = z.infer<typeof feedbackReportSchema>;

/**
 * Files the browser has already put in the bucket. The server re-checks type
 * and size against the same rules the dialog used, so a hand-made call cannot
 * register something the picker would have refused.
 */
export const feedbackAttachmentsSchema = z.object({
  report_id: z.uuid("Select a report"),
  files: z
    .array(
      z.object({
        storage_path: z.string().trim().min(1).max(300),
        file_name: z.string().trim().min(1).max(200),
        mime_type: z
          .string()
          .refine(isAllowedAttachmentType, "That file type cannot be attached"),
        size_bytes: z
          .number()
          .int()
          .positive("An empty file cannot be attached")
          .max(FEEDBACK_ATTACHMENT_MAX_BYTES, "That file is larger than the 10 MB limit"),
      }),
    )
    .min(1)
    .max(FEEDBACK_ATTACHMENT_MAX_FILES, "A report takes at most 5 attachments"),
});
export type FeedbackAttachmentsInput = z.infer<typeof feedbackAttachmentsSchema>;

export const feedbackStatusChangeSchema = z.object({
  report_id: z.uuid("Select a report"),
  status: z.enum(FEEDBACK_STATUSES),
  note: z.string().trim().max(2000).optional().or(z.literal("")).nullable(),
});
export type FeedbackStatusChangeInput = z.infer<typeof feedbackStatusChangeSchema>;
