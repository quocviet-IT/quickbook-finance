import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USD_CURRENCY_CODE } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";
import type { RecurringDocumentType, RecurringTemplateCreateInput } from "@/lib/domain/recurring";
import {
  recurringFromBill,
  recurringFromExpense,
  recurringFromInvoice,
  recurringFromJournal,
} from "@/lib/domain/recurring-from";
import { companyToday } from "./company";
import { getEntryDetail } from "./entry-detail";
import { getInvoiceLines } from "./invoicing";
import { getBillLines, getExpenseLines } from "./payables";
import { RecurringError } from "./recurring";

/** The schedule a document was already made to recur by, while it still runs or waits. */
export async function findScheduleFrom(sb: SupabaseClient, sourceId: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await sb
    .from("acc_recurring_template")
    .select("id,name")
    .eq("payload->source->>id", sourceId)
    .neq("status", "ended")
    .limit(1);
  if (error) throw new RecurringError(error.message);
  return (data?.[0] as { id: string; name: string } | undefined) ?? null;
}

const nameOf = (value: unknown): string => {
  const row = (Array.isArray(value) ? value[0] : value) as { name?: string } | null | undefined;
  return row?.name ?? "";
};

/**
 * The schedule "Make it recurring" would set up for one document, read as the
 * person asking may read it. A schedule makes documents in US dollars, so a
 * document in another currency is refused rather than repeated in dollars.
 */
export async function scheduleFromDocument(
  sb: SupabaseClient,
  type: RecurringDocumentType,
  id: string,
): Promise<RecurringTemplateCreateInput> {
  const usd = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, 2);
  // The first due date is the first one after the company's own today.
  const today = await companyToday(sb);
  const onlyUsd = (currency: string) => {
    if (currency !== USD_CURRENCY_CODE) {
      throw new RecurringError(`A schedule makes documents in ${USD_CURRENCY_CODE}, and this one is in ${currency}, so it cannot be made to recur.`);
    }
  };

  switch (type) {
    case "invoice": {
      const { data, error } = await sb
        .from("acc_invoice")
        .select("id,invoice_number,customer_id,issue_date,due_date,memo,total_minor,currency_code,status,customer:acc_customer(name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new RecurringError(error.message);
      if (!data || data.status === "draft" || data.status === "void") throw new RecurringError("Only an issued invoice can be made to recur.");
      onlyUsd(data.currency_code as string);
      const lines = await getInvoiceLines(sb, id);
      return recurringFromInvoice({ ...(data as unknown as Omit<Parameters<typeof recurringFromInvoice>[0], "lines">), lines }, nameOf(data.customer), usd(Number(data.total_minor)), today);
    }
    case "bill": {
      const { data, error } = await sb
        .from("acc_bill")
        .select("id,bill_number,vendor_id,vendor_ref,bill_date,due_date,memo,total_minor,currency_code,status,vendor:acc_vendor(name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new RecurringError(error.message);
      if (!data || data.status === "draft" || data.status === "void") throw new RecurringError("Only a posted bill can be made to recur.");
      onlyUsd(data.currency_code as string);
      const lines = await getBillLines(sb, id);
      return recurringFromBill({ ...(data as unknown as Omit<Parameters<typeof recurringFromBill>[0], "lines">), lines }, nameOf(data.vendor), usd(Number(data.total_minor)), today);
    }
    case "expense": {
      const { data, error } = await sb
        .from("acc_expense")
        .select("id,expense_number,vendor_id,payment_account_id,expense_date,memo,total_minor,currency_code,status,vendor:acc_vendor(name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new RecurringError(error.message);
      if (!data || data.status === "void") throw new RecurringError("Only a recorded expense can be made to recur.");
      onlyUsd(data.currency_code as string);
      const lines = await getExpenseLines(sb, id);
      return recurringFromExpense({ ...(data as unknown as Omit<Parameters<typeof recurringFromExpense>[0], "lines">), lines }, nameOf(data.vendor) || "Expense", usd(Number(data.total_minor)), today);
    }
    case "journal": {
      const entry = await getEntryDetail(sb, id);
      if (entry.sourceType !== "manual" || entry.status !== "posted") {
        throw new RecurringError("Only a posted journal entry made by hand can be made to recur; a document's entry recurs through the document.");
      }
      onlyUsd(entry.currencyCode);
      const total = entry.lines.reduce((sum, line) => sum + line.debitMinor, 0);
      return recurringFromJournal(entry, usd(total), today);
    }
  }
}
