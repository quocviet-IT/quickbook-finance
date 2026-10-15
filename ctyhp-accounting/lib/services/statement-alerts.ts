import type { SupabaseClient } from "@supabase/supabase-js";
import { entryDisplayName } from "@/lib/domain/entry-detail";
import {
  statementAlerts,
  withoutReversedPairs,
  type BankAccountAlerts,
  type BankLine,
  type BelowZeroAccount,
  type LastStatement,
  type ReversalPair,
  type StatementAlerts,
} from "@/lib/domain/statement-alerts";
import { readAllPages, type PageResult } from "@/lib/services/paging";
import { getLedgerBalances, getTransactionList } from "@/lib/services/reports";

/**
 * Reading what the two statement alerts need, and removing a flagged group.
 *
 * The reads here only select. The one write is `removeBalanceEntries`, which
 * calls the database function that does the whole job in one transaction; this
 * file posts and deletes nothing itself.
 *
 * A failed read throws. A card built from half a ledger would be a wrong
 * balance presented as a finding, so there is no partial answer.
 */
export class StatementAlertsError extends Error {}

function readAll<T>(label: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  return readAllPages<T>(page, (message) => new StatementAlertsError(`Reading ${label} failed: ${message}`));
}

/** A bank account, with the ledger account its entries post to. */
export interface AlertBankAccount {
  id: string;
  accountId: string;
  name: string;
}

type BankRow = {
  id: string;
  account_id: string;
  bank_name: string;
  acc_account: { name?: string } | null;
};

const BANK_COLUMNS = "id,account_id,bank_name,acc_account(name)";

function bankFromRow(r: BankRow): AlertBankAccount {
  return { id: r.id, accountId: r.account_id, name: r.acc_account?.name || r.bank_name };
}

async function readBankAccount(sb: SupabaseClient, bankAccountId: string): Promise<AlertBankAccount> {
  const { data, error } = await sb.from("acc_bank_account").select(BANK_COLUMNS).eq("id", bankAccountId).maybeSingle();
  if (error) throw new StatementAlertsError(`Reading the bank account failed: ${error.message}`);
  if (!data) throw new StatementAlertsError("Bank account not found");
  return bankFromRow(data as unknown as BankRow);
}

export async function readBankAccounts(sb: SupabaseClient): Promise<AlertBankAccount[]> {
  const { data, error } = await sb.from("acc_bank_account").select(BANK_COLUMNS).order("created_at").order("id");
  if (error) throw new StatementAlertsError(`Reading the bank accounts failed: ${error.message}`);
  return ((data ?? []) as unknown as BankRow[]).map(bankFromRow);
}

type LineRow = {
  id: string;
  debit_minor: number;
  credit_minor: number;
  amount_base_minor: number;
  acc_journal_entry: { id: string; entry_number: string; entry_date: string; source_type: string };
};

/** Every posted line on the ledger account, all dates. Ordered by the line id, which is unique. */
function readLines(sb: SupabaseClient, accountId: string): Promise<LineRow[]> {
  return readAll<LineRow>("the bank account's entries", (f, t) =>
    sb
      .from("acc_journal_line")
      .select("id,debit_minor,credit_minor,amount_base_minor,acc_journal_entry!inner(id,entry_number,entry_date,source_type)")
      .eq("account_id", accountId)
      .eq("acc_journal_entry.status", "posted")
      .order("id")
      .range(f, t),
  );
}

/** Debit minus credit in the base currency, read the way `acc_ledger_balances` reads it. */
function signedBase(l: LineRow): number {
  if (Number(l.debit_minor) > 0) return Number(l.amount_base_minor);
  if (Number(l.credit_minor) > 0) return -Number(l.amount_base_minor);
  return 0;
}

/** The lines ticked in a completed reconciliation of this bank account. */
async function readClearedLineIds(sb: SupabaseClient, bankAccountId: string): Promise<Set<string>> {
  const rows = await readAll<{ id: string; journal_line_id: string }>("the ticked lines", (f, t) =>
    sb
      .from("acc_reconciliation_line")
      .select("id,journal_line_id,acc_statement_reconciliation!inner(bank_account_id,status)")
      .eq("acc_statement_reconciliation.bank_account_id", bankAccountId)
      .eq("acc_statement_reconciliation.status", "completed")
      .order("id")
      .range(f, t),
  );
  return new Set(rows.map((r) => r.journal_line_id));
}

type ReconRow = {
  id: string;
  bank_account_id: string;
  statement_ending_date: string;
  statement_ending_balance_minor: number | string;
  completed_at: string | null;
};

/** The latest completed reconciliation of each bank account: its date and ending balance. */
async function readLastStatements(sb: SupabaseClient, bankAccountId: string | null): Promise<Map<string, LastStatement>> {
  const rows = await readAll<ReconRow>("the reconciliations", (f, t) => {
    let q = sb
      .from("acc_statement_reconciliation")
      .select("id,bank_account_id,statement_ending_date,statement_ending_balance_minor,completed_at")
      .eq("status", "completed");
    if (bankAccountId) q = q.eq("bank_account_id", bankAccountId);
    return q.order("id").range(f, t);
  });
  const latest = new Map<string, ReconRow>();
  for (const r of rows) {
    const date = String(r.statement_ending_date).slice(0, 10);
    const seen = latest.get(r.bank_account_id);
    // Two sessions for one statement date: the one completed last is the one that stands.
    if (
      !seen ||
      date > String(seen.statement_ending_date).slice(0, 10) ||
      (date === String(seen.statement_ending_date).slice(0, 10) && (r.completed_at ?? "") > (seen.completed_at ?? ""))
    ) {
      latest.set(r.bank_account_id, r);
    }
  }
  return new Map(
    [...latest].map(([bank, r]) => [
      bank,
      { date: String(r.statement_ending_date).slice(0, 10), endingMinor: Number(r.statement_ending_balance_minor) },
    ]),
  );
}

type LinkRow = { id: string; original_entry_id: string; reversal_entry_id: string };

/** Which entry reversed which, so the detectors can leave both out. */
async function readReversalPairs(sb: SupabaseClient): Promise<ReversalPair[]> {
  const rows = await readAll<LinkRow>("the reversals", (f, t) =>
    sb.from("acc_journal_reversal_link").select("id,original_entry_id,reversal_entry_id").order("id").range(f, t),
  );
  return rows.map((r) => ({ originalEntryId: r.original_entry_id, reversalEntryId: r.reversal_entry_id }));
}

type ChartRow = { id: string; account_code: string; name: string };

/** Account id → "code name", for the "coded to" column. */
async function readLabels(sb: SupabaseClient): Promise<Map<string, string>> {
  const chart = await readAll<ChartRow>("the chart of accounts", (f, t) =>
    sb.from("acc_account").select("id,account_code,name").order("account_code").order("id").range(f, t),
  );
  return new Map(chart.map((a) => [a.id, `${a.account_code} ${a.name}`]));
}

/** What the transaction list knows about each entry: its name and the accounts on it. */
async function readEntryNames(sb: SupabaseClient, dates: readonly string[]) {
  if (dates.length === 0) return { names: new Map<string, { payee: string; narration: string }>(), accountIds: new Map<string, string[]>() };
  const first = dates.reduce((min, d) => (d < min ? d : min));
  const last = dates.reduce((max, d) => (d > max ? d : max));
  const listed = await getTransactionList(sb, first, last);
  return {
    names: new Map(listed.map((r) => [r.entryId, { payee: entryDisplayName(r), narration: r.description }])),
    accountIds: new Map(listed.map((r) => [r.entryId, r.accountIds])),
  };
}

type Names = Awaited<ReturnType<typeof readEntryNames>>;

function toBankLines(
  rows: readonly LineRow[],
  glAccountId: string,
  cleared: ReadonlySet<string>,
  names: Names,
  labels: ReadonlyMap<string, string>,
): BankLine[] {
  return rows.map((l) => {
    const entry = l.acc_journal_entry;
    const named = names.names.get(entry.id);
    return {
      lineId: l.id,
      entryId: entry.id,
      entryNumber: entry.entry_number,
      date: String(entry.entry_date).slice(0, 10),
      amountMinor: signedBase(l),
      payee: named?.payee ?? entry.entry_number,
      narration: named?.narration ?? "",
      codedTo: (names.accountIds.get(entry.id) ?? [])
        .filter((id) => id !== glAccountId)
        .map((id) => labels.get(id) ?? "")
        .filter((label) => label !== ""),
      sourceType: entry.source_type,
      cleared: cleared.has(l.id),
    };
  });
}

/** The posted lines of one bank account, ready for the detectors. */
async function readBankLines(
  sb: SupabaseClient,
  bank: AlertBankAccount,
  names: Names | null,
  labels: ReadonlyMap<string, string>,
): Promise<{ lines: BankLine[]; rows: LineRow[] }> {
  const [rows, cleared] = await Promise.all([readLines(sb, bank.accountId), readClearedLineIds(sb, bank.id)]);
  const resolved = names ?? (await readEntryNames(sb, rows.map((r) => String(r.acc_journal_entry.entry_date).slice(0, 10))));
  return { lines: toBankLines(rows, bank.accountId, cleared, resolved, labels), rows };
}

/**
 * One bank account's posted lines and its last agreed statement, as the
 * detectors take them: without the entries that were reversed, and their
 * reversals (see `withoutReversedPairs`).
 */
export async function getBankAccountLines(
  sb: SupabaseClient,
  bankAccountId: string,
): Promise<{ lines: BankLine[]; last: LastStatement | null }> {
  const bank = await readBankAccount(sb, bankAccountId);
  const [labels, last, pairs] = await Promise.all([readLabels(sb), readLastStatements(sb, bank.id), readReversalPairs(sb)]);
  const { lines } = await readBankLines(sb, bank, null, labels);
  return { lines: withoutReversedPairs(lines, pairs), last: last.get(bank.id) ?? null };
}

/** Both alerts for one bank account. Throws if any read fails. */
export async function getStatementAlerts(sb: SupabaseClient, bankAccountId: string): Promise<StatementAlerts> {
  const { lines, last } = await getBankAccountLines(sb, bankAccountId);
  return statementAlerts(lines, last);
}

/**
 * Both alerts for every bank account.
 *
 * The transaction list, which names the entries, is read once over the dates
 * all the accounts span, not once per account.
 */
export async function getAllStatementAlerts(sb: SupabaseClient): Promise<BankAccountAlerts[]> {
  const banks = await readBankAccounts(sb);
  if (banks.length === 0) return [];
  const [labels, last, pairs, allRows] = await Promise.all([
    readLabels(sb),
    readLastStatements(sb, null),
    readReversalPairs(sb),
    Promise.all(banks.map((b) => readLines(sb, b.accountId))),
  ]);
  const names = await readEntryNames(
    sb,
    allRows.flatMap((rows) => rows.map((r) => String(r.acc_journal_entry.entry_date).slice(0, 10))),
  );
  const out: BankAccountAlerts[] = [];
  for (const [i, bank] of banks.entries()) {
    const cleared = await readClearedLineIds(sb, bank.id);
    const lines = withoutReversedPairs(toBankLines(allRows[i], bank.accountId, cleared, names, labels), pairs);
    const found = statementAlerts(lines, last.get(bank.id) ?? null);
    out.push({ bankAccountId: bank.id, accountName: bank.name, ghosts: found.ghosts, negative: found.negative });
  }
  return out;
}

/* ----------------------------------------------------------------- removal */

/** An entry that cannot be removed, and the reason in a plain sentence. */
export interface BalanceEntryBlocker {
  entryId: string;
  entryNumber: string;
  reason: string;
}

/** The entries among `entryIds` that `acc_remove_balance_entries` would refuse. Empty when all can go. */
export async function getBalanceEntryBlockers(sb: SupabaseClient, entryIds: readonly string[]): Promise<BalanceEntryBlocker[]> {
  if (entryIds.length === 0) return [];
  const { data, error } = await sb.rpc("acc_balance_entry_blockers", { p_entry_ids: [...entryIds] });
  if (error) throw new StatementAlertsError(error.message);
  return ((data ?? []) as { entry_id: string; entry_number: string | null; reason: string }[]).map((r) => ({
    entryId: r.entry_id,
    entryNumber: r.entry_number ?? "",
    reason: r.reason,
  }));
}

export interface RemovedBalanceEntries {
  removed: number;
  reversed: number;
  voided: number;
  /** The signed net movement taken out of the bank account, base currency minor units. */
  total_minor: number;
}

/**
 * Remove a flagged group, all or nothing. The database function refuses the
 * whole request when any entry cannot go; its message names each one, and is
 * thrown as it is.
 */
export async function removeBalanceEntries(
  sb: SupabaseClient,
  bankAccountId: string,
  entryIds: readonly string[],
  reason: string,
): Promise<RemovedBalanceEntries> {
  const { data, error } = await sb.rpc("acc_remove_balance_entries", {
    p_bank_account_id: bankAccountId,
    p_entry_ids: [...entryIds],
    p_reason: reason,
  });
  if (error) throw new StatementAlertsError(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    removed: Number(r.removed ?? 0),
    reversed: Number(r.reversed ?? 0),
    voided: Number(r.voided ?? 0),
    total_minor: Number(r.total_minor ?? 0),
  };
}

/* ------------------------------------------------------------ balance sheet */

/**
 * The bank accounts that read below zero at `asOf`, for the Balance Sheet note.
 *
 * One read of the ledger balances finds them. The detector, which reads every
 * line of an account, runs only for those, so a Balance Sheet over healthy
 * books costs one extra call.
 */
export async function getBelowZeroBankAccounts(sb: SupabaseClient, asOf: string): Promise<BelowZeroAccount[]> {
  const [banks, balances] = await Promise.all([readBankAccounts(sb), getLedgerBalances(sb, null, asOf)]);
  const byAccount = new Map(balances.map((b) => [b.accountId, b.debitBase - b.creditBase]));
  const negative = banks.filter((b) => (byAccount.get(b.accountId) ?? 0) < 0);
  return Promise.all(
    negative.map(async (bank) => {
      const found = await getStatementAlerts(sb, bank.id);
      return {
        bankAccountId: bank.id,
        accountName: bank.name,
        ghostEntries: found.ghosts.reduce((sum, g) => sum + g.entryIds.length, 0),
      };
    }),
  );
}
