/** Zod validation schemas for the accounting domain (input boundary). */
import { z } from "zod";
import { ACCOUNT_TYPES } from "./accounts";

export const ACCOUNT_STATUSES = ["draft", "active", "inactive", "archived"] as const;

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
  currency_code: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code")
    .optional()
    .nullable(),
  is_posting_account: z.boolean().default(true),
  status: z.enum(ACCOUNT_STATUSES).default("active"),
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

/** Update allows partial fields but never changes the code via this path. */
export const accountUpdateSchema = accountCreateSchema.partial().omit({ account_code: true });
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;

export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);

// --- Customers ---
export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(160),
  email: z.email("Enter a valid email").optional().or(z.literal("")).nullable(),
  currency_code: z
    .string()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code")
    .optional()
    .nullable(),
});
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

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
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  amount_minor: z.number().int().positive("Amount must be greater than 0"),
  deposit_account_id: z.uuid("Select a deposit account"),
  method: z.string().trim().max(60).optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  allocations: z.array(paymentAllocationSchema).default([]),
});
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

// --- Vendors ---
export const vendorCreateSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(160),
  email: z.email("Enter a valid email").optional().or(z.literal("")).nullable(),
  phone: z.string().trim().max(40).optional().or(z.literal("")).nullable(),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code").optional().nullable(),
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
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  amount_minor: z.number().int().positive("Amount must be greater than 0"),
  payment_account_id: z.uuid("Select a payment account"),
  method: z.string().trim().max(60).optional().nullable(),
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
});
export type TaxCodeCreateInput = z.infer<typeof taxCodeCreateSchema>;

export const taxCodeUpdateSchema = taxCodeCreateSchema;
export type TaxCodeUpdateInput = z.infer<typeof taxCodeUpdateSchema>;

export const taxPaymentCreateSchema = z.object({
  tax_account_id: z.uuid("Select the Sales Tax Payable account"),
  bank_account_id: z.uuid("Select a bank account"),
  payment_date: z.string().optional(),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
    currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
    currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
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
