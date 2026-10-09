import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADJUSTMENT_ACCOUNT_NAME,
  buildPurchasesInventory,
  type PurchaseAccount,
  type PurchaseLedgerLine,
  type PurchasesInventoryReport,
} from "@/lib/domain/purchases-inventory";
import { getCurrentCompanySettings } from "./company";
import { getInventoryAccounts } from "./inventory-accounts";
import { partyNames, partyOfDocuments } from "./party-reports";
import { readAllPages } from "./paging";

export class PurchasesInventoryError extends Error {}

const fail = (message: string) => new PurchasesInventoryError(message);

type EntryFacts = { entry_date: string; source_type: string | null; description: string | null; source_id: string | null };

/**
 * Every posted line on the given accounts, with its entry's date, source and
 * description. Paged in line-id order: the id is unique, so no line can
 * straddle a page.
 */
async function postedLines(sb: SupabaseClient, accountIds: readonly string[]): Promise<PurchaseLedgerLine[]> {
  if (accountIds.length === 0) return [];
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_journal_line")
        .select(
          "id,account_id,debit_minor,amount_base_minor,journal_entry_id,acc_journal_entry!inner(entry_date,status,source_type,description,source_id)",
        )
        .in("account_id", accountIds as string[])
        .eq("acc_journal_entry.status", "posted")
        .order("id")
        .range(from, to),
    fail,
  );
  return rows.map((r) => {
    const entry = r.acc_journal_entry as EntryFacts;
    const base = Number(r.amount_base_minor);
    return {
      entryId: r.journal_entry_id as string,
      entryDate: entry.entry_date,
      sourceType: entry.source_type ?? null,
      description: entry.description ?? null,
      sourceId: entry.source_id ?? null,
      accountId: r.account_id as string,
      signedMinor: Number(r.debit_minor) > 0 ? base : -base,
    };
  });
}

/** The ids of the posted entries that have a line on one of the equity accounts. */
async function entriesWithEquityLine(sb: SupabaseClient, equityAccountIds: readonly string[]): Promise<Set<string>> {
  if (equityAccountIds.length === 0) return new Set();
  const rows = await readAllPages<{ journal_entry_id: string }>(
    (from, to) =>
      sb
        .from("acc_journal_line")
        .select("id,journal_entry_id,acc_journal_entry!inner(status)")
        .in("account_id", equityAccountIds as string[])
        .eq("acc_journal_entry.status", "posted")
        .order("id")
        .range(from, to),
    fail,
  );
  return new Set(rows.map((r) => r.journal_entry_id));
}

/**
 * Purchases and Inventory for From to To, with the year-by-year table over all
 * the books. Reads the lines on the inventory and cost-of-goods-sold accounts
 * (and accounts named for an adjustment or write-down) once, and which entries
 * have an equity line. A purchase entry's vendor comes from its source document
 * as in Expenses by Vendor, plus goods receipts. Read-only.
 */
export async function getPurchasesInventory(sb: SupabaseClient, from: string, to: string): Promise<PurchasesInventoryReport> {
  const [settings, inventory, accountRows] = await Promise.all([
    getCurrentCompanySettings(sb),
    getInventoryAccounts(sb),
    readAllPages<{ id: string; name: string; account_type: string }>(
      (start, end) => sb.from("acc_account").select("id,name,account_type").order("id").range(start, end),
      fail,
    ),
  ]);
  const accounts: PurchaseAccount[] = accountRows.map((a) => ({ id: a.id, name: a.name, accountType: a.account_type }));
  const inventoryIds = new Set(inventory.accountIds);
  const readIds = accounts
    .filter((a) => inventoryIds.has(a.id) || a.accountType === "cost_of_goods_sold" || ADJUSTMENT_ACCOUNT_NAME.test(a.name))
    .map((a) => a.id);
  const equityIds = accounts.filter((a) => a.accountType === "equity").map((a) => a.id);

  const [lines, equityEntryIds, bills, expenses, vendorCredits, billPayments, receipts, names] = await Promise.all([
    postedLines(sb, readIds),
    entriesWithEquityLine(sb, equityIds),
    partyOfDocuments(sb, "acc_bill", "vendor_id"),
    partyOfDocuments(sb, "acc_expense", "vendor_id"),
    partyOfDocuments(sb, "acc_vendor_credit", "vendor_id"),
    partyOfDocuments(sb, "acc_bill_payment", "vendor_id"),
    partyOfDocuments(sb, "acc_goods_receipt", "vendor_id"),
    partyNames(sb, "acc_vendor"),
  ]);

  // Only the sources of the lines read need a vendor; document ids are uuids, so one map serves every table.
  const vendorOfSource = new Map<string, { id: string; name: string }>();
  for (const l of lines) {
    const source = l.sourceId;
    if (!source || vendorOfSource.has(source)) continue;
    const ref = bills.get(source) ?? expenses.get(source) ?? vendorCredits.get(source) ?? billPayments.get(source) ?? receipts.get(source);
    if (ref?.partyId) vendorOfSource.set(source, { id: ref.partyId, name: names.get(ref.partyId) ?? "A vendor no longer on file" });
  }

  return buildPurchasesInventory({
    lines,
    accounts,
    inventoryAccountIds: inventoryIds,
    equityEntryIds,
    vendorOfSource,
    fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
    from,
    to,
  });
}
