import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerRow } from "@/lib/db/types";
import type { OpenItemDetail, OpenItemSource } from "@/lib/domain/open-item-statement";
import { readAllPages } from "./paging";

export class OpenItemStatementError extends Error {}

type Raw = Record<string, unknown>;

/** Each document kind: its table, its number column, and how its row reads as an item's detail. */
const DETAIL_READS = {
  invoice: {
    table: "acc_invoice",
    number: "invoice_number",
    columns: "invoice_number,total_minor,balance_due_minor,currency_code,memo",
    detail: (r: Raw): OpenItemDetail => ({
      totalMinor: Number(r.total_minor),
      openMinor: Number(r.balance_due_minor),
      currencyCode: String(r.currency_code),
      note: (r.memo as string | null) ?? null,
    }),
  },
  credit_memo: {
    table: "acc_credit_memo",
    number: "credit_memo_number",
    columns: "credit_memo_number,total_minor,balance_remaining_minor,currency_code,memo,reason",
    detail: (r: Raw): OpenItemDetail => ({
      totalMinor: Number(r.total_minor),
      openMinor: Number(r.balance_remaining_minor),
      currencyCode: String(r.currency_code),
      note: ((r.memo as string | null)?.trim() || (r.reason as string | null)) ?? null,
    }),
  },
  payment: {
    table: "acc_payment",
    number: "payment_number",
    columns: "payment_number,amount_minor,unapplied_minor,currency_code,reference",
    detail: (r: Raw): OpenItemDetail => ({
      totalMinor: Number(r.amount_minor),
      openMinor: Number(r.unapplied_minor),
      currencyCode: String(r.currency_code),
      note: (r.reference as string | null) ?? null,
    }),
  },
} as const;

type Kind = keyof typeof DETAIL_READS;

/**
 * One customer's open items on a day (3.0.13): the rows acc_ar_ageing gives
 * A/R Aging, for this customer only, with each document's own total and note.
 * A document that cannot be found still appears, from the row alone.
 */
export async function readOpenItemStatement(
  sb: SupabaseClient,
  customerId: string,
  asOf: string,
): Promise<{ customer: CustomerRow; items: OpenItemSource[] } | null> {
  const fail = (message: string) => new OpenItemStatementError(message);
  const found = await sb.from("acc_customer").select("*").eq("id", customerId).maybeSingle();
  if (found.error) throw fail(found.error.message);
  if (!found.data) return null;

  const rows = await readAllPages<Raw>(
    (from, to) =>
      sb
        .rpc("acc_ar_ageing", { p_as_of: asOf })
        .eq("customer_id", customerId)
        .order("doc_date")
        .order("doc_number")
        .order("doc_type")
        .range(from, to),
    fail,
  );

  const details = new Map<string, OpenItemDetail>();
  await Promise.all(
    (Object.keys(DETAIL_READS) as Kind[]).map(async (kind) => {
      const read = DETAIL_READS[kind];
      const numbers = rows
        .filter((r) => r.doc_type === kind && typeof r.doc_number === "string")
        .map((r) => r.doc_number as string);
      if (numbers.length === 0) return;
      const { data, error } = await sb
        .from(read.table)
        .select(read.columns)
        .eq("customer_id", customerId)
        .in(read.number, numbers);
      if (error) throw fail(error.message);
      for (const r of (data ?? []) as unknown as Raw[]) details.set(`${kind}:${r[read.number] as string}`, read.detail(r));
    }),
  );

  const items: OpenItemSource[] = rows.map((r) => {
    const docNumber = (r.doc_number as string | null) ?? null;
    return {
      docType: String(r.doc_type),
      docNumber,
      docDate: String(r.doc_date),
      dueDate: String(r.due_date),
      outstandingMinor: Number(r.balance_minor),
      detail: docNumber ? (details.get(`${String(r.doc_type)}:${docNumber}`) ?? null) : null,
    };
  });
  return { customer: found.data as CustomerRow, items };
}
