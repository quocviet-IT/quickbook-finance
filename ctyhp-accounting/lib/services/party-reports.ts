import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProfitAndLoss, type LedgerBalance } from "@/lib/domain/reports";
import {
  openDocuments,
  partyBalances,
  type DocumentAmount,
  type OpenDocumentsReport,
  type OpenItemRow,
  type PartyBalancesReport,
} from "@/lib/domain/open-items";
import { partyActivity, NO_CUSTOMER, NO_VENDOR, type PartyActivityReport, type PartyLedgerLine } from "@/lib/domain/party-activity";
import { tieOut, type TieOut } from "@/lib/domain/tie-out";
import { getLedgerBalances } from "./reports";
import { readAllPages } from "./paging";

/**
 * The reports about customers and vendors: what is open with each, and what
 * each was sold or spent in a period. Read-only; every list is paged past
 * PostgREST's thousand-row cap.
 */
export class PartyReportError extends Error {}

const fail = (message: string) => new PartyReportError(message);

type Side = "receivable" | "payable";

const SIDE = {
  receivable: {
    rpc: "acc_ar_ageing",
    partyId: "customer_id",
    partyName: "customer_name",
    controlType: "accounts_receivable",
  },
  payable: {
    rpc: "acc_ap_ageing",
    partyId: "vendor_id",
    partyName: "vendor_name",
    controlType: "accounts_payable",
  },
} as const;

/**
 * The open-item list the aging reports read, every row of it. The function
 * orders nothing itself, so the read orders it — by document type and number,
 * which are unique together, then party and date — before paging it.
 */
async function openItemRows(sb: SupabaseClient, side: Side, asOf: string): Promise<OpenItemRow[]> {
  const s = SIDE[side];
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc(s.rpc, { p_as_of: asOf })
        .order("doc_type")
        .order("doc_number")
        .order(s.partyId)
        .order("doc_date")
        .range(from, to),
    fail,
  );
  return rows.map((r) => ({
    partyId: r[s.partyId] as string,
    partyName: r[s.partyName] as string,
    docType: r.doc_type as string,
    docNumber: (r.doc_number as string | null) ?? null,
    docDate: r.doc_date as string,
    dueDate: r.due_date as string,
    balanceMinor: Number(r.balance_minor),
  }));
}

/**
 * The control account's balance, signed the way the list is: what customers
 * owe is debit-positive, what is owed to vendors credit-positive. Read as of
 * today, as the aging reports read it — the list is today's open position,
 * whatever date its documents are cut off at.
 */
async function controlBalance(sb: SupabaseClient, side: Side, today: string): Promise<number> {
  const balances = await getLedgerBalances(sb, null, today);
  const net = balances
    .filter((row) => row.accountType === SIDE[side].controlType)
    .reduce((sum, row) => sum + (row.debitBase - row.creditBase), 0);
  return side === "receivable" ? net : -net;
}

/** What each open invoice (or bill) was for in the first place, by its number. */
async function documentAmounts(
  sb: SupabaseClient,
  side: Side,
  asOf: string,
): Promise<Map<string, DocumentAmount>> {
  const table = side === "receivable" ? "acc_invoice" : "acc_bill";
  const number = side === "receivable" ? "invoice_number" : "bill_number";
  const date = side === "receivable" ? "issue_date" : "bill_date";
  const open = side === "receivable" ? ["issued", "partial"] : ["open", "partial"];
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from(table)
        .select(`id,${number},total_minor,balance_due_minor`)
        .in("status", open)
        .gt("balance_due_minor", 0)
        .lte(date, asOf)
        .order("id")
        .range(from, to),
    fail,
  );
  const amounts = new Map<string, DocumentAmount>();
  for (const r of rows) {
    const key = r[number] as string | null;
    if (!key) continue;
    amounts.set(key, {
      number: key,
      totalMinor: Number(r.total_minor),
      balanceMinor: Number(r.balance_due_minor),
    });
  }
  return amounts;
}

export interface OpenDocumentsResult {
  report: OpenDocumentsReport;
  /** The aging total beside the control account. */
  control: TieOut;
}

async function openDocumentsFor(sb: SupabaseClient, side: Side, asOf: string, today: string): Promise<OpenDocumentsResult> {
  const [rows, amounts, controlMinor] = await Promise.all([
    openItemRows(sb, side, asOf),
    documentAmounts(sb, side, asOf),
    controlBalance(sb, side, today),
  ]);
  const report = openDocuments(rows, asOf, side === "receivable" ? "invoice" : "bill", amounts);
  return { report, control: tieOut(report.agingTotalMinor, controlMinor) };
}

export function getOpenInvoices(sb: SupabaseClient, asOf: string, today: string): Promise<OpenDocumentsResult> {
  return openDocumentsFor(sb, "receivable", asOf, today);
}

export function getUnpaidBills(sb: SupabaseClient, asOf: string, today: string): Promise<OpenDocumentsResult> {
  return openDocumentsFor(sb, "payable", asOf, today);
}

export interface PartyBalancesResult {
  report: PartyBalancesReport;
  control: TieOut;
}

async function balancesFor(sb: SupabaseClient, side: Side, asOf: string, today: string): Promise<PartyBalancesResult> {
  const [rows, controlMinor] = await Promise.all([openItemRows(sb, side, asOf), controlBalance(sb, side, today)]);
  const report = partyBalances(rows);
  return { report, control: tieOut(report.totalMinor, controlMinor) };
}

export function getCustomerBalances(sb: SupabaseClient, asOf: string, today: string): Promise<PartyBalancesResult> {
  return balancesFor(sb, "receivable", asOf, today);
}

export function getVendorBalances(sb: SupabaseClient, asOf: string, today: string): Promise<PartyBalancesResult> {
  return balancesFor(sb, "payable", asOf, today);
}

// --- Sales by customer, expenses by vendor --------------------------------------

interface PartyRef {
  partyId: string | null;
}

/** id → the customer (or vendor) on it, for one document table, every row. */
async function partyOfDocuments(
  sb: SupabaseClient,
  table: string,
  partyColumn: "customer_id" | "vendor_id",
): Promise<Map<string, PartyRef>> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from(table).select(`id,${partyColumn}`).order("id").range(from, to),
    fail,
  );
  return new Map(rows.map((r) => [r.id as string, { partyId: (r[partyColumn] as string | null) ?? null }]));
}

async function partyNames(sb: SupabaseClient, table: "acc_customer" | "acc_vendor"): Promise<Map<string, string>> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.from(table).select("id,name").order("id").range(from, to),
    fail,
  );
  return new Map(rows.map((r) => [r.id as string, r.name as string]));
}

interface PostedLine {
  entryId: string;
  accountId: string;
  /** Base currency, debit positive. */
  signedMinor: number;
  sourceId: string | null;
}

/** Every posted line in the period on the given accounts. */
async function postedLines(
  sb: SupabaseClient,
  accountIds: readonly string[],
  from: string,
  to: string,
): Promise<PostedLine[]> {
  if (accountIds.length === 0) return [];
  const rows = await readAllPages<Record<string, unknown>>(
    (start, end) =>
      sb
        .from("acc_journal_line")
        .select("id,account_id,debit_minor,amount_base_minor,journal_entry_id,acc_journal_entry!inner(entry_date,status,source_id)")
        .in("account_id", accountIds as string[])
        .eq("acc_journal_entry.status", "posted")
        .gte("acc_journal_entry.entry_date", from)
        .lte("acc_journal_entry.entry_date", to)
        .order("id")
        .range(start, end),
    fail,
  );
  return rows.map((r) => {
    const entry = r.acc_journal_entry as { source_id: string | null };
    const base = Number(r.amount_base_minor);
    return {
      entryId: r.journal_entry_id as string,
      accountId: r.account_id as string,
      signedMinor: Number(r.debit_minor) > 0 ? base : -base,
      sourceId: entry.source_id ?? null,
    };
  });
}

export interface PartyActivityResult {
  report: PartyActivityReport;
  /** The report's total beside the Profit and Loss's for the same period. */
  proof: TieOut;
}

function accountsOfType(balances: readonly LedgerBalance[], types: readonly string[]): string[] {
  return balances.filter((row) => types.includes(row.accountType)).map((row) => row.accountId);
}

/**
 * Sales by Customer: the income accounts' postings for the period, by the
 * customer on the invoice, credit memo or payment each came from. Its total is
 * the Profit and Loss's Income for the same period.
 */
export async function getSalesByCustomer(sb: SupabaseClient, from: string, to: string): Promise<PartyActivityResult> {
  const balances = await getLedgerBalances(sb, from, to);
  const incomeIds = accountsOfType(balances, ["income"]);
  const [lines, invoices, creditMemos, payments, names] = await Promise.all([
    postedLines(sb, incomeIds, from, to),
    partyOfDocuments(sb, "acc_invoice", "customer_id"),
    partyOfDocuments(sb, "acc_credit_memo", "customer_id"),
    partyOfDocuments(sb, "acc_payment", "customer_id"),
    partyNames(sb, "acc_customer"),
  ]);
  const ledger: PartyLedgerLine[] = lines.map((line) => {
    const source = line.sourceId;
    const ref = source ? (invoices.get(source) ?? creditMemos.get(source) ?? payments.get(source)) : undefined;
    const partyId = ref?.partyId ?? null;
    return {
      entryId: line.entryId,
      accountId: line.accountId,
      // Income is credit-natural: a sale credits it.
      amountMinor: -line.signedMinor,
      partyId,
      partyName: partyId ? (names.get(partyId) ?? "A customer no longer on file") : null,
      invoiceId: source && invoices.has(source) ? source : null,
    };
  });
  const report = partyActivity(ledger, "invoices", NO_CUSTOMER);
  const income = buildProfitAndLoss(balances).income.total;
  return { report, proof: tieOut(report.totalMinor, income) };
}

/**
 * Expenses by Vendor: the cost of sales, expense and other expense accounts'
 * postings for the period, by the vendor on the bill, expense, vendor credit or
 * bill payment each came from. Its total is the Profit and Loss's cost of sales
 * plus expenses plus other expenses for the same period.
 */
export async function getExpensesByVendor(sb: SupabaseClient, from: string, to: string): Promise<PartyActivityResult> {
  const balances = await getLedgerBalances(sb, from, to);
  const spendIds = accountsOfType(balances, ["cost_of_goods_sold", "expense", "other_expense"]);
  const [lines, bills, expenses, vendorCredits, billPayments, names] = await Promise.all([
    postedLines(sb, spendIds, from, to),
    partyOfDocuments(sb, "acc_bill", "vendor_id"),
    partyOfDocuments(sb, "acc_expense", "vendor_id"),
    partyOfDocuments(sb, "acc_vendor_credit", "vendor_id"),
    partyOfDocuments(sb, "acc_bill_payment", "vendor_id"),
    partyNames(sb, "acc_vendor"),
  ]);
  const ledger: PartyLedgerLine[] = lines.map((line) => {
    const source = line.sourceId;
    const ref = source
      ? (bills.get(source) ?? expenses.get(source) ?? vendorCredits.get(source) ?? billPayments.get(source))
      : undefined;
    const partyId = ref?.partyId ?? null;
    return {
      entryId: line.entryId,
      accountId: line.accountId,
      // Spending is debit-natural.
      amountMinor: line.signedMinor,
      partyId,
      partyName: partyId ? (names.get(partyId) ?? "A vendor no longer on file") : null,
      invoiceId: null,
    };
  });
  const report = partyActivity(ledger, "entryAccounts", NO_VENDOR);
  const pnl = buildProfitAndLoss(balances);
  const expected = pnl.costOfGoodsSold.total + pnl.operatingExpenses.total + pnl.otherExpenses.total;
  return { report, proof: tieOut(report.totalMinor, expected) };
}
