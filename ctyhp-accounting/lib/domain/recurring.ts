import { z } from "zod";
import {
  billLineInputSchema,
  expenseLineInputSchema,
  invoiceLineInputSchema,
  manualJournalLineSchema,
} from "./schemas";

export const RECURRING_DOCUMENT_TYPES = ["invoice", "bill", "expense", "journal"] as const;
export type RecurringDocumentType = (typeof RECURRING_DOCUMENT_TYPES)[number];

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

const scheduleFields = {
  name: z.string().trim().min(1, "Schedule name is required").max(160),
  frequency: z.enum(RECURRING_FREQUENCIES),
  interval_count: z.number().int().min(1).max(24).default(1),
  start_date: z.iso.date("Enter a valid start date"),
  end_date: z.iso.date("Enter a valid end date").optional().nullable(),
};

export const invoiceRecurringPayloadSchema = z.object({
  customer_id: z.uuid("Select a customer"),
  due_days: z.number().int().min(0).max(365).default(30),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(invoiceLineInputSchema).min(1, "Add at least one invoice line"),
});

export const billRecurringPayloadSchema = z.object({
  vendor_id: z.uuid("Select a vendor"),
  vendor_ref: z.string().trim().max(80).optional().nullable(),
  due_days: z.number().int().min(0).max(365).default(30),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(billLineInputSchema).min(1, "Add at least one bill line"),
});

export const expenseRecurringPayloadSchema = z.object({
  vendor_id: z.uuid().optional().nullable(),
  payment_account_id: z.uuid("Select a payment account"),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(expenseLineInputSchema).min(1, "Add at least one expense line"),
});

export const journalRecurringPayloadSchema = z
  .object({
    description: z.string().trim().min(1, "Description is required").max(500),
    source_ref: z.string().trim().max(120).optional().nullable(),
    lines: z.array(manualJournalLineSchema).min(2, "Add at least two journal lines"),
  })
  .refine(
    (value) =>
      value.lines.reduce((sum, line) => sum + line.debit_minor, 0) ===
      value.lines.reduce((sum, line) => sum + line.credit_minor, 0),
    { message: "Debits and credits must be equal", path: ["lines"] },
  );

export const recurringTemplateCreateSchema = z
  .discriminatedUnion("document_type", [
    z.object({
      ...scheduleFields,
      document_type: z.literal("invoice"),
      payload: invoiceRecurringPayloadSchema,
    }),
    z.object({
      ...scheduleFields,
      document_type: z.literal("bill"),
      payload: billRecurringPayloadSchema,
    }),
    z.object({
      ...scheduleFields,
      document_type: z.literal("expense"),
      payload: expenseRecurringPayloadSchema,
    }),
    z.object({
      ...scheduleFields,
      document_type: z.literal("journal"),
      payload: journalRecurringPayloadSchema,
    }),
  ])
  .refine((value) => !value.end_date || value.end_date >= value.start_date, {
    message: "End date cannot be before the start date",
    path: ["end_date"],
  });

export type RecurringTemplateCreateInput = z.infer<typeof recurringTemplateCreateSchema>;
export type RecurringPayload = RecurringTemplateCreateInput["payload"];

export const DOCUMENT_TYPE_LABELS: Record<RecurringDocumentType, string> = {
  invoice: "Invoice",
  bill: "Bill",
  expense: "Expense",
  journal: "Journal entry",
};

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
};

export function recurringAmountMinor(input: RecurringTemplateCreateInput): number {
  switch (input.document_type) {
    case "invoice":
      return input.payload.lines.reduce(
        (sum, line) => sum + Math.round(line.quantity * line.unit_price_minor),
        0,
      );
    case "bill":
    case "expense":
      return input.payload.lines.reduce((sum, line) => sum + line.amount_minor, 0);
    case "journal":
      return input.payload.lines.reduce((sum, line) => sum + line.debit_minor, 0);
  }
}

export function addDays(isoDate: string, days: number): string {
  const date = isoToUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Advance one schedule occurrence while preserving the original day-of-month.
 * A schedule starting on the last day of a month stays month-end.
 */
export function nextRecurringDate(
  currentIso: string,
  startIso: string,
  frequency: RecurringFrequency,
  intervalCount: number,
): string {
  const current = isoToUtcDate(currentIso);
  const start = isoToUtcDate(startIso);
  if (frequency === "weekly") {
    current.setUTCDate(current.getUTCDate() + intervalCount * 7);
    return current.toISOString().slice(0, 10);
  }

  const monthStep =
    intervalCount * (frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12);
  const targetFirst = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + monthStep, 1),
  );
  const targetLastDay = new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const startLastDay = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const targetDay =
    start.getUTCDate() === startLastDay ? targetLastDay : Math.min(start.getUTCDate(), targetLastDay);
  return new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), targetDay),
  )
    .toISOString()
    .slice(0, 10);
}

function isoToUtcDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
