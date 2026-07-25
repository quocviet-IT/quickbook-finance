import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryTxnRow, InventoryValuationRow } from "@/lib/db/types";
import type { InventoryAdjustmentInput } from "@/lib/domain/schemas";
import { inventoryTiesOut } from "@/lib/domain/inventory";
import { getLedgerBalances } from "./reports";
import { writeAudit } from "./audit";

export class InventoryError extends Error {}

export interface InventoryValuation {
  asOf: string;
  rows: InventoryValuationRow[];
  /** Total subledger value across every inventory item. */
  subledgerValueMinor: number;
  /** Net balance of the inventory control accounts those items point at. */
  controlBalanceMinor: number;
  tiesOut: boolean;
}

/**
 * Inventory valuation as of a date, with the US-FR-072 reconciliation: the
 * subledger total against the ledger balance of the inventory control accounts.
 * A mismatch is surfaced, never hidden.
 */
export async function getInventoryValuation(
  sb: SupabaseClient,
  asOf: string,
): Promise<InventoryValuation> {
  const { data, error } = await sb.rpc("acc_inventory_valuation", { p_as_of: asOf });
  if (error) throw new InventoryError(error.message);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    item_id: r.item_id as string,
    item_code: (r.item_code as string | null) ?? null,
    name: r.name as string,
    inventory_account_id: (r.inventory_account_id as string | null) ?? null,
    qty_on_hand: Number(r.qty_on_hand),
    value_minor: Number(r.value_minor),
    unit_cost_minor: Number(r.unit_cost_minor),
  }));

  const accountIds = new Set(rows.map((r) => r.inventory_account_id).filter(Boolean) as string[]);
  let controlBalanceMinor = 0;
  if (accountIds.size > 0) {
    // acc_ledger_balances keys by account code, so resolve the codes first.
    const { data: accounts, error: eAcc } = await sb
      .from("acc_account")
      .select("id,account_code")
      .in("id", [...accountIds]);
    if (eAcc) throw new InventoryError(eAcc.message);
    const codes = new Set((accounts ?? []).map((a) => (a as { account_code: string }).account_code));
    const balances = await getLedgerBalances(sb, null, asOf);
    controlBalanceMinor = balances
      .filter((b) => codes.has(b.accountCode))
      .reduce((sum, b) => sum + b.debitBase - b.creditBase, 0);
  }

  const subledgerValueMinor = rows.reduce((s, r) => s + r.value_minor, 0);
  return {
    asOf,
    rows,
    subledgerValueMinor,
    controlBalanceMinor,
    tiesOut: inventoryTiesOut(subledgerValueMinor, controlBalanceMinor),
  };
}

/** Movement history for one item — the audit trail behind its value. */
export async function listItemMovements(
  sb: SupabaseClient,
  itemId: string,
): Promise<InventoryTxnRow[]> {
  const { data, error } = await sb
    .from("acc_inventory_txn")
    .select(
      "id,seq,item_id,txn_date,source,source_id,qty_delta,cost_delta_minor," +
        "running_qty,running_value_minor,journal_entry_id,reversal_of,memo,created_at",
    )
    .eq("item_id", itemId)
    .order("seq");
  if (error) throw new InventoryError(error.message);
  return (data ?? []) as unknown as InventoryTxnRow[];
}

/** Shrinkage, found stock, or a revaluation. Costing is decided server-side. */
export async function adjustInventory(
  sb: SupabaseClient,
  input: InventoryAdjustmentInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_adjust_inventory", {
    p_item_id: input.item_id,
    p_date: input.adjust_date,
    p_qty_delta: input.qty_delta,
    p_unit_cost_minor: input.unit_cost_minor,
    p_value_delta_minor: input.value_delta_minor,
    p_offset_account_id: input.offset_account_id,
    p_reason: input.reason,
  });
  if (error) throw new InventoryError(error.message);
  const txnId = String(data);
  await writeAudit(sb, {
    table_name: "acc_inventory_txn",
    record_id: txnId,
    action: "insert",
    after: input,
  });
  return txnId;
}

/** The same materiality amount used by the database approval policy guard. */
export async function inventoryAdjustmentApprovalAmount(
  sb: SupabaseClient,
  input: InventoryAdjustmentInput,
): Promise<number> {
  const { data, error } = await sb.rpc("acc_inventory_adjust_amount", {
    p_item_id: input.item_id,
    p_qty_delta: input.qty_delta,
    p_unit_cost_minor: input.unit_cost_minor,
    p_value_delta_minor: input.value_delta_minor,
  });
  if (error) throw new InventoryError(error.message);
  return Number(data ?? 0);
}
