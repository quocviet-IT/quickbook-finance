import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaxPaymentRow, TaxCodeRow } from "@/lib/db/types";
import type { TaxCodeCreateInput, TaxCodeUpdateInput, TaxPaymentCreateInput } from "@/lib/domain/schemas";
import { summarizeSalesTaxLiability, type SalesTaxLiability, type TaxCollectedLine } from "@/lib/domain/salestax";
import { writeAudit } from "./audit";

export class SalesTaxError extends Error {}

export async function getSalesTaxLiability(
  sb: SupabaseClient,
  from: string,
  to: string,
): Promise<SalesTaxLiability> {
  const [collectedRes, balRes, payRes] = await Promise.all([
    sb.rpc("acc_sales_tax_collected", { p_from: from, p_to: to }),
    sb.rpc("acc_sales_tax_payable_balance", { p_to: to }),
    sb.from("acc_tax_payment").select("amount_minor,payment_date,status"),
  ]);
  if (collectedRes.error) throw new SalesTaxError(collectedRes.error.message);
  if (balRes.error) throw new SalesTaxError(balRes.error.message);
  if (payRes.error) throw new SalesTaxError(payRes.error.message);

  const collected: TaxCollectedLine[] = (collectedRes.data ?? []).map((r: Record<string, unknown>) => ({
    taxCodeId: r.tax_code_id as string,
    code: r.code as string,
    name: r.name as string,
    ratePercent: Number(r.rate_percent),
    taxableMinor: Number(r.taxable_minor),
    taxMinor: Number(r.tax_minor),
  }));
  const paymentsMinor = (payRes.data ?? [])
    .filter((p: Record<string, unknown>) => p.status !== "void" && (p.payment_date as string) >= from && (p.payment_date as string) <= to)
    .reduce((s: number, p: Record<string, unknown>) => s + Number(p.amount_minor), 0);

  return summarizeSalesTaxLiability({ collected, paymentsMinor, netBalanceMinor: Number(balRes.data ?? 0) });
}

const TP_COLS =
  "id,payment_number,tax_account_id,bank_account_id,payment_date,currency_code,amount_minor," +
  "period_start,period_end,status,journal_entry_id,memo,created_at,updated_at";

export async function listTaxPayments(sb: SupabaseClient): Promise<TaxPaymentRow[]> {
  const { data, error } = await sb.from("acc_tax_payment").select(TP_COLS).order("created_at", { ascending: false });
  if (error) throw new SalesTaxError(error.message);
  return (data ?? []) as unknown as TaxPaymentRow[];
}

export async function recordTaxPayment(sb: SupabaseClient, input: TaxPaymentCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_tax_payment", {
    p_tax_account_id: input.tax_account_id,
    p_bank_account_id: input.bank_account_id,
    p_payment_date: input.payment_date || undefined,
    p_currency: input.currency_code,
    p_amount_minor: input.amount_minor,
    p_period_start: input.period_start || null,
    p_period_end: input.period_end || null,
    p_memo: input.memo || null,
  });
  if (error) throw new SalesTaxError(error.message);
  await writeAudit(sb, { table_name: "acc_tax_payment", record_id: (data as string) ?? null, action: "post" });
  return data as string;
}

export async function voidTaxPayment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_tax_payment", { p_payment_id: id });
  if (error) throw new SalesTaxError(error.message);
  await writeAudit(sb, { table_name: "acc_tax_payment", record_id: id, action: "void" });
}

const TC_COLS = "id,code,name,rate_percent,direction,tax_account_id,is_active";

function taxCodeRow(input: TaxCodeCreateInput | TaxCodeUpdateInput) {
  return {
    code: input.code,
    name: input.name,
    rate_percent: input.rate_percent,
    direction: input.direction,
    tax_account_id: input.tax_account_id || null,
    is_active: input.is_active,
  };
}

export async function createTaxCode(sb: SupabaseClient, input: TaxCodeCreateInput): Promise<TaxCodeRow> {
  const { data, error } = await sb.from("acc_tax_code").insert(taxCodeRow(input)).select(TC_COLS).single();
  if (error) throw new SalesTaxError(error.message);
  const row = data as unknown as TaxCodeRow;
  await writeAudit(sb, { table_name: "acc_tax_code", record_id: row.id, action: "insert", after: row });
  return row;
}

export async function updateTaxCode(sb: SupabaseClient, id: string, input: TaxCodeUpdateInput): Promise<TaxCodeRow> {
  const { data, error } = await sb.from("acc_tax_code").update(taxCodeRow(input)).eq("id", id).select(TC_COLS).single();
  if (error) throw new SalesTaxError(error.message);
  const row = data as unknown as TaxCodeRow;
  await writeAudit(sb, { table_name: "acc_tax_code", record_id: id, action: "update", after: row });
  return row;
}

export async function setTaxCodeActive(sb: SupabaseClient, id: string, active: boolean): Promise<void> {
  // .select().single() so an RLS-blocked update surfaces as an error (0 rows)
  // rather than a silent, misleading success.
  const { error } = await sb
    .from("acc_tax_code")
    .update({ is_active: active })
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw new SalesTaxError(error.message);
  await writeAudit(sb, { table_name: "acc_tax_code", record_id: id, action: "update", after: { is_active: active } });
}
