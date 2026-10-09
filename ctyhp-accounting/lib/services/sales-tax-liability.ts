import type { SupabaseClient } from "@supabase/supabase-js";
import { dayBefore } from "@/lib/domain/fiscal";
import {
  classifyEntries,
  resolveTaxAccounts,
  type SalesTaxLiabilityData,
  type TaxLedgerLine,
} from "@/lib/domain/sales-tax-liability";
import { getCurrentCompanySettings } from "./company";
import { readAllPages } from "./paging";
import { getLedgerBalances } from "./reports";

export class SalesTaxLiabilityError extends Error {}

const fail = (message: string) => new SalesTaxLiabilityError(message);

/**
 * Every posted line on the given accounts in the range, credit-positive. Paged
 * in line-id order: the id is unique, so no line can straddle a page.
 */
async function postedLines(
  sb: SupabaseClient,
  accountIds: readonly string[],
  kind: TaxLedgerLine["kind"],
  from: string,
  to: string,
): Promise<TaxLedgerLine[]> {
  if (accountIds.length === 0) return [];
  const rows = await readAllPages<Record<string, unknown>>(
    (start, end) =>
      sb
        .from("acc_journal_line")
        .select("id,debit_minor,amount_base_minor,journal_entry_id,acc_journal_entry!inner(entry_date,status)")
        .in("account_id", accountIds as string[])
        .eq("acc_journal_entry.status", "posted")
        .gte("acc_journal_entry.entry_date", from)
        .lte("acc_journal_entry.entry_date", to)
        .order("id")
        .range(start, end),
    fail,
  );
  return rows.map((r) => {
    const base = Number(r.amount_base_minor);
    return {
      entryId: r.journal_entry_id as string,
      entryDate: (r.acc_journal_entry as { entry_date: string }).entry_date,
      kind,
      creditMinor: Number(r.debit_minor) > 0 ? -base : base,
    };
  });
}

/**
 * What Sales Tax Liability is worked out from, for From to To: the tax
 * accounts (the ones sales-direction tax codes post to, else the liability
 * accounts named for sales tax), the entries on them and on income accounts
 * classified and added up by day, the amount owed the day before From and the
 * tax accounts' own ledger balance on To. Read-only.
 */
export async function getSalesTaxLiabilityData(sb: SupabaseClient, from: string, to: string): Promise<SalesTaxLiabilityData> {
  const [settings, accountRows, codeRows] = await Promise.all([
    getCurrentCompanySettings(sb),
    readAllPages<{ id: string; name: string; account_type: string }>(
      (start, end) => sb.from("acc_account").select("id,name,account_type").order("id").range(start, end),
      fail,
    ),
    readAllPages<{ id: string; direction: string; tax_account_id: string | null }>(
      (start, end) => sb.from("acc_tax_code").select("id,direction,tax_account_id").order("id").range(start, end),
      fail,
    ),
  ]);
  const accounts = accountRows.map((a) => ({ id: a.id, name: a.name, accountType: a.account_type }));
  const resolved = resolveTaxAccounts(
    accounts,
    codeRows.map((c) => ({ direction: c.direction, taxAccountId: c.tax_account_id })),
  );
  const fiscalStartMonth = settings?.fiscal_year_start_month ?? 1;
  const base = { from, to, fiscalStartMonth, basis: resolved.basis, unlinked: resolved.unlinked };
  if (resolved.accountIds.length === 0) {
    return { ...base, openingMinor: 0, ledgerClosingMinor: 0, days: [] };
  }

  const taxIds = new Set(resolved.accountIds);
  const incomeIds = accountRows.filter((a) => a.account_type === "income").map((a) => a.id);
  const owed = (balances: { accountId: string; debitBase: number; creditBase: number }[]) =>
    balances.filter((b) => taxIds.has(b.accountId)).reduce((sum, b) => sum + (b.creditBase - b.debitBase), 0);

  const [taxLines, incomeLines, opening, closing] = await Promise.all([
    postedLines(sb, resolved.accountIds, "tax", from, to),
    postedLines(sb, incomeIds, "income", from, to),
    getLedgerBalances(sb, null, dayBefore(from)),
    getLedgerBalances(sb, null, to),
  ]);

  return {
    ...base,
    openingMinor: owed(opening),
    ledgerClosingMinor: owed(closing),
    days: classifyEntries([...taxLines, ...incomeLines]),
  };
}
