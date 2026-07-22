/**
 * Pure mapping from a catalog item to invoice/bill line default values.
 * These are the single definition of "what an item prefills"; the UI uses them
 * and the line still stores its own snapshot values plus item_id.
 */
export interface ItemLike {
  description: string;
  sales_price_minor: number;
  income_account_id: string | null;
  sales_tax_code_id: string | null;
  purchase_cost_minor: number;
  expense_account_id: string | null;
}

export function itemToInvoiceLineDefaults(item: ItemLike): {
  description: string;
  unit_price_minor: number;
  income_account_id: string | null;
  tax_code_id: string | null;
} {
  return {
    description: item.description,
    unit_price_minor: item.sales_price_minor,
    income_account_id: item.income_account_id,
    tax_code_id: item.sales_tax_code_id,
  };
}

export function itemToBillLineDefaults(item: ItemLike): {
  description: string;
  amount_minor: number;
  expense_account_id: string | null;
} {
  return {
    description: item.description,
    amount_minor: item.purchase_cost_minor,
    expense_account_id: item.expense_account_id,
  };
}
