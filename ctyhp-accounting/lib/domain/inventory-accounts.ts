/**
 * Which accounts hold a company's stock. One rule, shared by every report that
 * needs it (Financial Ratios, Purchases and Inventory), so two reports can
 * never disagree about what "inventory" is.
 *
 *  1. Accounts an inventory item posts its stock to (`acc_item.inventory_account_id`
 *     on items with `is_inventory`), plus accounts whose cash-flow role is
 *     `operating_inventory`.
 *  2. Only when that finds nothing: asset accounts of type `current_asset`
 *     whose name reads as stock ("Inventory", "Stock").
 */

/** The fields of an account this rule looks at. */
export interface InventoryAccountCandidate {
  id: string;
  name: string;
  accountType: string;
  cashFlowRole: string | null;
}

/** Which branch of the rule decided the answer. */
export type InventoryAccountBasis = "items-or-role" | "name" | "none";

export interface InventoryAccountPick {
  /** The inventory accounts' ids, in a stable (sorted) order. */
  accountIds: string[];
  basis: InventoryAccountBasis;
}

export const INVENTORY_CASH_FLOW_ROLE = "operating_inventory";
const INVENTORY_NAME = /inventory|stock/i;

export function pickInventoryAccounts(input: {
  /** `inventory_account_id` of every item with `is_inventory`; nulls are skipped. */
  itemInventoryAccountIds: readonly (string | null)[];
  accounts: readonly InventoryAccountCandidate[];
}): InventoryAccountPick {
  const chosen = new Set<string>();
  for (const id of input.itemInventoryAccountIds) if (id) chosen.add(id);
  for (const account of input.accounts) {
    if (account.cashFlowRole === INVENTORY_CASH_FLOW_ROLE) chosen.add(account.id);
  }
  if (chosen.size > 0) return { accountIds: [...chosen].sort(), basis: "items-or-role" };

  for (const account of input.accounts) {
    if (account.accountType === "current_asset" && INVENTORY_NAME.test(account.name)) chosen.add(account.id);
  }
  return { accountIds: [...chosen].sort(), basis: chosen.size > 0 ? "name" : "none" };
}
