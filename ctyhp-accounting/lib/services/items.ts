import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemRow } from "@/lib/db/types";
import type { ItemCreateInput, ItemUpdateInput } from "@/lib/domain/schemas";
import { writeAudit } from "./audit";

export class ItemsError extends Error {}

const COLS =
  "id,item_code,name,description,is_sold,sales_price_minor,income_account_id,sales_tax_code_id," +
  "is_purchased,purchase_cost_minor,expense_account_id,is_active,created_at,updated_at";

export async function listItems(sb: SupabaseClient): Promise<ItemRow[]> {
  const { data, error } = await sb.from("acc_item").select(COLS).order("name");
  if (error) throw new ItemsError(error.message);
  return (data ?? []) as unknown as ItemRow[];
}

function toRow(input: ItemCreateInput | ItemUpdateInput) {
  return {
    item_code: input.item_code || null,
    name: input.name,
    description: input.description ?? "",
    is_sold: input.is_sold,
    sales_price_minor: input.sales_price_minor,
    income_account_id: input.income_account_id || null,
    sales_tax_code_id: input.sales_tax_code_id || null,
    is_purchased: input.is_purchased,
    purchase_cost_minor: input.purchase_cost_minor,
    expense_account_id: input.expense_account_id || null,
  };
}

export async function createItem(sb: SupabaseClient, input: ItemCreateInput): Promise<ItemRow> {
  const { data, error } = await sb.from("acc_item").insert(toRow(input)).select(COLS).single();
  if (error) throw new ItemsError(error.message);
  const row = data as unknown as ItemRow;
  await writeAudit(sb, { table_name: "acc_item", record_id: row.id, action: "insert", after: row });
  return row;
}

export async function updateItem(sb: SupabaseClient, id: string, input: ItemUpdateInput): Promise<ItemRow> {
  const { data, error } = await sb
    .from("acc_item")
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) throw new ItemsError(error.message);
  const row = data as unknown as ItemRow;
  await writeAudit(sb, { table_name: "acc_item", record_id: id, action: "update", after: row });
  return row;
}

export async function setItemActive(sb: SupabaseClient, id: string, active: boolean): Promise<void> {
  const { error } = await sb
    .from("acc_item")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new ItemsError(error.message);
  await writeAudit(sb, { table_name: "acc_item", record_id: id, action: "update", after: { is_active: active } });
}
