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
