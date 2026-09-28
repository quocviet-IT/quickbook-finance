import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { entryDisplayName } from "@/lib/domain/entry-detail";
import {
  buildWorkingTrialBalance,
  type AdjustingEntry,
  type WorkingTrialBalance,
} from "@/lib/domain/working-trial-balance";
import { getLedgerBalances, getTransactionList } from "@/lib/services/reports";

/**
 * Reading the working trial balance. Every call here reads.
 *
 * Totals come from `acc_ledger_balances`, the aggregate the Trial Balance and
 * Balance Sheet use, so the three cannot disagree about a balance. Only the
 * adjusting part is read on its own. A trial balance missing any read is a
 * wrong trial balance, not a partial one, so any failed read fails the report.
 */
export class WorkingTrialBalanceError extends Error {}

const PAGE = 1000;

type MarkRow = {
  journal_entry_id: string;
  note: string | null;
  acc_journal_entry: {
    id: string;
    entry_number: string;
    entry_date: string;
    description: string | null;
    acc_journal_line:
      | {
          account_id: string;
          debit_minor: number;
          credit_minor: number;
          amount_base_minor: number;
          line_order: number;
          acc_account: { account_code: string; name: string; account_type: AccountType } | null;
        }[]
      | null;
  };
};

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Posted entries dated in the range and marked adjusting, with their lines. Paged. */
async function readAdjusting(sb: SupabaseClient, from: string, to: string): Promise<MarkRow[]> {
  const rows: MarkRow[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await sb
      .from("acc_adjusting_entry")
      .select(
        "journal_entry_id,note," +
          "acc_journal_entry!inner(id,entry_number,entry_date,description,status," +
          "acc_journal_line(account_id,debit_minor,credit_minor,amount_base_minor,line_order," +
          "acc_account(account_code,name,account_type)))",
      )
      .eq("acc_journal_entry.status", "posted")
      .gte("acc_journal_entry.entry_date", from)
      .lte("acc_journal_entry.entry_date", to)
      .order("journal_entry_id")
      .range(start, start + PAGE - 1);
    if (error) throw new WorkingTrialBalanceError(`Reading the adjusting entries failed: ${error.message}`);
    const page = (data ?? []) as unknown as MarkRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function getWorkingTrialBalance(
  sb: SupabaseClient,
  from: string,
  to: string,
): Promise<WorkingTrialBalance> {
  const [before, movements, marks, listed] = await Promise.all([
    getLedgerBalances(sb, null, dayBefore(from)),
    getLedgerBalances(sb, from, to),
    readAdjusting(sb, from, to),
    getTransactionList(sb, from, to),
  ]);

  const nameOf = new Map(listed.map((r) => [r.entryId, entryDisplayName(r)]));
  const adjusting: AdjustingEntry[] = marks.map((m) => {
    const e = m.acc_journal_entry;
    return {
      entryId: e.id,
      entryNumber: e.entry_number,
      entryDate: String(e.entry_date).slice(0, 10),
      description: e.description,
      name: nameOf.get(e.id) || e.description?.trim() || "",
      note: m.note,
      lines: [...(e.acc_journal_line ?? [])]
        .sort((x, y) => x.line_order - y.line_order)
        .map((l) => ({
          accountId: l.account_id,
          accountCode: l.acc_account?.account_code ?? "",
          accountName: l.acc_account?.name ?? "",
          accountType: l.acc_account?.account_type ?? "expense",
          // Base currency, read exactly as acc_ledger_balances reads it.
          debitBase: Number(l.debit_minor) > 0 ? Number(l.amount_base_minor) : 0,
          creditBase: Number(l.credit_minor) > 0 ? Number(l.amount_base_minor) : 0,
        })),
    };
  });

  return buildWorkingTrialBalance({ from, to, before, movements, adjusting });
}
