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
