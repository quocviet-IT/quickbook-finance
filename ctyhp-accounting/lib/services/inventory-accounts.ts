import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickInventoryAccounts,
  type InventoryAccountCandidate,
  type InventoryAccountPick,
} from "@/lib/domain/inventory-accounts";
import { readAllPages } from "./paging";

export class InventoryAccountsError extends Error {}

const fail = (message: string) => new InventoryAccountsError(message);

/**
 * The company's inventory accounts by the shared rule in
 * `lib/domain/inventory-accounts`. Reads inventory items' accounts and the
 * chart, both paged with the row id last in the order so no row can straddle
 * a page.
 */
export async function getInventoryAccounts(sb: SupabaseClient): Promise<InventoryAccountPick> {
  const [items, accounts] = await Promise.all([
    readAllPages<{ inventory_account_id: string | null }>(
      (from, to) =>
        sb
          .from("acc_item")
          .select("id,inventory_account_id")
          .eq("is_inventory", true)
          .not("inventory_account_id", "is", null)
          .order("id")
          .range(from, to),
      fail,
    ),
    readAllPages<{ id: string; name: string; account_type: string; cash_flow_role: string | null }>(
      (from, to) => sb.from("acc_account").select("id,name,account_type,cash_flow_role").order("id").range(from, to),
      fail,
    ),
  ]);
  const candidates: InventoryAccountCandidate[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    accountType: a.account_type,
    cashFlowRole: a.cash_flow_role,
  }));
  return pickInventoryAccounts({
    itemInventoryAccountIds: items.map((i) => i.inventory_account_id),
    accounts: candidates,
  });
}
