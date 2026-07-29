import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerBalance } from "@/lib/domain/reports";

export interface LedgerSnapshot {
  totalDebitMinor: number;
  totalCreditMinor: number;
  arTotalMinor: number;
  apTotalMinor: number;
  journalLineCount: number;
  /** account_code → net (debit - credit) in minor units. */
  byAccount: Map<string, number>;
}

const FROM = "1900-01-01";

async function rpc<T>(
  sb: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T[]> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return (data ?? []) as T[];
}

export async function readSnapshot(
  sb: SupabaseClient,
  asOf: string,
): Promise<LedgerSnapshot> {
  const balances = await rpc<{
    account_code: string;
    debit_base: number;
    credit_base: number;
  }>(sb, "acc_ledger_balances", { p_from: FROM, p_to: asOf });

  const ar = await rpc<{ balance_minor: number }>(sb, "acc_ar_ageing", {
    p_as_of: asOf,
  });
  const ap = await rpc<{ balance_minor: number }>(sb, "acc_ap_ageing", {
    p_as_of: asOf,
  });

  const { count, error } = await sb
    .from("acc_journal_line")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`counting acc_journal_line failed: ${error.message}`);

  const byAccount = new Map<string, number>();
  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  for (const row of balances) {
    totalDebitMinor += Number(row.debit_base);
    totalCreditMinor += Number(row.credit_base);
    byAccount.set(
      row.account_code,
      Number(row.debit_base) - Number(row.credit_base),
    );
  }

  return {
    totalDebitMinor,
    totalCreditMinor,
    arTotalMinor: ar.reduce((sum, row) => sum + Number(row.balance_minor), 0),
    apTotalMinor: ap.reduce((sum, row) => sum + Number(row.balance_minor), 0),
    journalLineCount: count ?? 0,
    byAccount,
  };
}

/** The same rows the reports read, shaped for the pure builders in lib/domain/reports. */
export async function readLedgerBalances(
  sb: SupabaseClient,
  asOf: string,
): Promise<LedgerBalance[]> {
  const rows = await rpc<{
    account_id: string;
    account_code: string;
    name: string;
    account_type: LedgerBalance["accountType"];
    debit_base: number;
    credit_base: number;
  }>(sb, "acc_ledger_balances", { p_from: FROM, p_to: asOf });

  return rows.map((row) => ({
    accountId: row.account_id,
    accountCode: row.account_code,
    name: row.name,
    accountType: row.account_type,
    debitBase: Number(row.debit_base),
    creditBase: Number(row.credit_base),
  }));
}

/** Human-readable difference, used as the assertion message when a run leaves residue. */
export function describeSnapshotDelta(
  before: LedgerSnapshot,
  after: LedgerSnapshot,
): string {
  const parts: string[] = [];
  const scalar: Array<keyof Omit<LedgerSnapshot, "byAccount">> = [
    "totalDebitMinor",
    "totalCreditMinor",
    "arTotalMinor",
    "apTotalMinor",
    "journalLineCount",
  ];
  for (const key of scalar) {
    if (before[key] !== after[key]) {
      parts.push(`${key}: ${before[key]} → ${after[key]}`);
    }
  }
  for (const [code, netBefore] of before.byAccount) {
    const netAfter = after.byAccount.get(code) ?? 0;
    if (netBefore !== netAfter) {
      parts.push(`account ${code}: ${netBefore} → ${netAfter}`);
    }
  }
  for (const [code, netAfter] of after.byAccount) {
    if (!before.byAccount.has(code)) {
      parts.push(`account ${code}: absent → ${netAfter}`);
    }
  }
  return parts.length ? parts.join("; ") : "no difference";
}
