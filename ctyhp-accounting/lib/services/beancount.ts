import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import {
  documentsByEntry,
  type BeancountAccount,
  type BeancountEntry,
  type BeancountInput,
  type BeancountPrice,
} from "@/lib/domain/beancount";
import { balanceAssertions, type BalanceAssertionRows } from "@/lib/domain/beancount-balance";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { readAllPages, type PageResult } from "@/lib/services/paging";
import { getTransactionList } from "@/lib/services/reports";

/**
 * Reading the whole ledger for a Beancount file.
 *
 * Every call here reads. There is no insert, update, delete or posting RPC, and
 * there must never be one.
 *
 * Two rules the Exception Report learned and this file keeps:
 * - PostgREST caps any response at 1,000 rows and says nothing, so every read
 *   is paged, with an order that makes the pages stable.
 * - A ledger file cannot be partial. A file missing one page of entries still
 *   parses and still passes bean-check — with the wrong balances. So any failed
 *   read fails the whole export; nothing here catches and carries on.
 */
export class BeancountExportError extends Error {}

/** Every source read for the file, counted into the export's audit record. */
export const BEANCOUNT_SOURCES = [
  "acc_account",
  "acc_journal_entry",
  "acc_journal_line",
  "acc_transaction_list",
  "acc_invoice",
  "acc_bill",
  "acc_payment",
  "acc_bill_payment",
  "acc_payment_allocation",
  "acc_bill_payment_allocation",
  "acc_currency",
  "acc_exchange_rate",
  "acc_company_setting_version",
  "acc_statement_reconciliation",
  "acc_bank_account",
  "acc_reconciliation_line",
] as const;

/** Read every page, stopping on the first short one; throw on any error. */
function readAll<T>(label: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  return readAllPages<T>(page, (message) => new BeancountExportError(`Reading ${label} failed: ${message}`));
}

interface AccountRow { id: string; account_code: string; name: string; account_type: AccountType }
interface LineRow { account_id: string; debit_minor: number; credit_minor: number; line_order: number }
interface EntryRow {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string | null;
  source_type: string;
  currency_code: string;
  acc_journal_line: LineRow[] | null;
}
interface NumberedRow { id: string; number: string | null; due_date: string | null; journal_entry_id: string }
interface PaymentRow { id: string; reference: string | null; journal_entry_id: string }
interface RateRow { currency_code: string; rate_date: string; rate_to_base: number | string }
interface CurrencyRow { code: string; decimal_places: number; is_base: boolean }

/**
 * Every currency record, not the app's picker list.
 *
 * `listCurrencies` in `lib/services/reference.ts` deliberately returns USD only,
 * because that is what a user may choose today. The ledger can still hold an
 * entry in another currency from before that rule, and a file that could not
 * format it would fail the whole export — so this reads the table itself.
 */
function readCurrencies(sb: SupabaseClient): Promise<CurrencyRow[]> {
  return readAll<CurrencyRow>("acc_currency", (f, t) =>
    sb.from("acc_currency").select("code,decimal_places,is_base").order("code").range(f, t));
}

function readAccountRows(sb: SupabaseClient): Promise<AccountRow[]> {
  return readAll<AccountRow>("acc_account", (f, t) =>
    sb.from("acc_account").select("id,account_code,name,account_type").order("account_code").range(f, t));
}

function toBeancountAccount(a: AccountRow): BeancountAccount {
  return { id: a.id, code: a.account_code, name: a.name, type: a.account_type };
}

/**
 * The whole chart, as the file names it.
 *
 * Exported for an entry's detail sheet, which shows the entry as Beancount and
 * must name its accounts exactly as the file does — and a Beancount name can
 * depend on the rest of the chart, when two codes clean up to the same text.
 */
export async function readBeancountAccounts(sb: SupabaseClient): Promise<BeancountAccount[]> {
  return (await readAccountRows(sb)).map(toBeancountAccount);
}

interface ReconciliationRow {
  id: string;
  bank_account_id: string;
  statement_ending_date: string;
  statement_ending_balance_minor: number | string;
  completed_at: string | null;
}
interface BankAccountRow { id: string; account_id: string; currency_code: string }
interface ClearedRow { reconciliation_id: string; journal_line_id: string }
interface BankLineRow {
  id: string;
  account_id: string;
  debit_minor: number | string;
  credit_minor: number | string;
  acc_journal_entry: {
    entry_date: string;
    currency_code: string;
    status: "posted" | "void";
    posted_at: string;
    voided_at: string | null;
  } | null;
}

/**
 * Every completed bank reconciliation and the bank-account lines behind it,
 * void entries included: a balance as it stood at completion counts an entry
 * voided since. Throws if any read fails.
 */
export async function readBalanceAssertionRows(sb: SupabaseClient): Promise<BalanceAssertionRows> {
  const [reconciliations, bankAccounts, cleared] = await Promise.all([
    readAll<ReconciliationRow>("acc_statement_reconciliation", (f, t) =>
      sb
        .from("acc_statement_reconciliation")
        .select("id,bank_account_id,statement_ending_date,statement_ending_balance_minor,completed_at")
        .eq("status", "completed")
        .order("statement_ending_date")
        .order("id")
        .range(f, t)),
    readAll<BankAccountRow>("acc_bank_account", (f, t) =>
      sb.from("acc_bank_account").select("id,account_id,currency_code").order("id").range(f, t)),
    readAll<ClearedRow>("acc_reconciliation_line", (f, t) =>
      sb.from("acc_reconciliation_line").select("reconciliation_id,journal_line_id").order("id").range(f, t)),
  ]);

  const glOf = new Map(bankAccounts.map((b) => [b.id, b.account_id]));
  const glIds = [
    ...new Set(reconciliations.map((r) => glOf.get(r.bank_account_id)).filter((id): id is string => id !== undefined)),
  ];
  const lines =
    glIds.length === 0
      ? []
      : await readAll<BankLineRow>("acc_journal_line", (f, t) =>
          sb
            .from("acc_journal_line")
            .select("id,account_id,debit_minor,credit_minor,acc_journal_entry!inner(entry_date,currency_code,status,posted_at,voided_at)")
            .in("account_id", glIds)
            .order("id")
            .range(f, t));

  return {
    reconciliations: reconciliations.map((r) => {
      const statementDate = String(r.statement_ending_date).slice(0, 10);
      if (!r.completed_at) {
        throw new BeancountExportError(`The completed reconciliation of ${statementDate} has no completion time`);
      }
      return {
        id: r.id,
        bankAccountId: r.bank_account_id,
        statementDate,
        statementMinor: Number(r.statement_ending_balance_minor),
        completedAt: r.completed_at,
      };
    }),
    bankAccounts: bankAccounts.map((b) => ({ id: b.id, glAccountId: b.account_id, currencyCode: b.currency_code })),
    lines: lines.map((l) => {
      const e = l.acc_journal_entry;
      if (!e) throw new BeancountExportError("A bank-account line was read without its entry");
      return {
        id: l.id,
        accountId: l.account_id,
        debitMinor: Number(l.debit_minor),
        creditMinor: Number(l.credit_minor),
        entryDate: String(e.entry_date).slice(0, 10),
        currencyCode: e.currency_code,
        status: e.status,
        postedAt: e.posted_at,
        voidedAt: e.voided_at,
      };
    }),
    cleared: cleared.map((c) => ({ reconciliationId: c.reconciliation_id, journalLineId: c.journal_line_id })),
  };
}

/** Everything `buildBeancountFile` needs. Throws if any read fails. */
export async function readBeancountInput(sb: SupabaseClient, generatedAt: string): Promise<BeancountInput> {
  const [
    accounts,
    entries,
    transactions,
    invoices,
    bills,
    payments,
    billPayments,
    paymentAllocations,
    billPaymentAllocations,
    rates,
    currencies,
    company,
    assertionRows,
  ] = await Promise.all([
    readAccountRows(sb),
    readAll<EntryRow>("acc_journal_entry", (f, t) =>
      sb
        .from("acc_journal_entry")
        .select(
          "id,entry_number,entry_date,description,source_type,currency_code," +
            "acc_journal_line(account_id,debit_minor,credit_minor,line_order)",
        )
        .eq("status", "posted")
        .order("entry_date")
        .order("entry_number")
        .range(f, t)),
    getTransactionList(sb, "0001-01-01", "9999-12-31"),
    readAll<NumberedRow>("acc_invoice", (f, t) =>
      sb
        .from("acc_invoice")
        .select("id,number:invoice_number,due_date,journal_entry_id")
        .not("journal_entry_id", "is", null)
        .order("id")
        .range(f, t)),
    readAll<NumberedRow>("acc_bill", (f, t) =>
      sb
        .from("acc_bill")
        .select("id,number:bill_number,due_date,journal_entry_id")
        .not("journal_entry_id", "is", null)
        .order("id")
        .range(f, t)),
    readAll<PaymentRow>("acc_payment", (f, t) =>
      sb
        .from("acc_payment")
        .select("id,reference,journal_entry_id")
        .not("journal_entry_id", "is", null)
        .order("id")
        .range(f, t)),
    readAll<PaymentRow>("acc_bill_payment", (f, t) =>
      sb
        .from("acc_bill_payment")
        .select("id,reference,journal_entry_id")
        .not("journal_entry_id", "is", null)
        .order("id")
        .range(f, t)),
    readAll<{ payment_id: string; invoice_id: string }>("acc_payment_allocation", (f, t) =>
      sb.from("acc_payment_allocation").select("payment_id,invoice_id").order("id").range(f, t)),
    readAll<{ bill_payment_id: string; bill_id: string }>("acc_bill_payment_allocation", (f, t) =>
      sb.from("acc_bill_payment_allocation").select("bill_payment_id,bill_id").order("id").range(f, t)),
    readAll<RateRow>("acc_exchange_rate", (f, t) =>
      sb
        .from("acc_exchange_rate")
        .select("currency_code,rate_date,rate_to_base")
        .order("rate_date")
        .order("currency_code")
        .range(f, t)),
    readCurrencies(sb),
    getCurrentCompanySettings(sb),
    readBalanceAssertionRows(sb),
  ]);

  if (!company) throw new BeancountExportError("Company settings are not set, so the file would have no title");

  const partyByEntryId = new Map<string, string>();
  for (const t of transactions) if (t.partyName) partyByEntryId.set(t.entryId, t.partyName);

  const toNumbered = (r: NumberedRow) => ({
    id: r.id,
    number: r.number,
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
    journalEntryId: r.journal_entry_id,
  });
  const toPayment = (r: PaymentRow) => ({ id: r.id, reference: r.reference, journalEntryId: r.journal_entry_id });

  return {
    // Only the three fields the file names. `ein_ref` — the TIN — is never
    // copied out of the settings row, so it cannot reach the file.
    company: {
      legalName: company.legal_name,
      fiscalYearStartMonth: company.fiscal_year_start_month,
      accountingBasis: company.accounting_basis,
    },
    generatedAt,
    accounts: accounts.map(toBeancountAccount),
    entries: entries.map<BeancountEntry>((e) => ({
      id: e.id,
      entryNumber: e.entry_number,
      entryDate: String(e.entry_date).slice(0, 10),
      description: e.description,
      sourceType: e.source_type,
      currencyCode: e.currency_code,
      lines: [...(e.acc_journal_line ?? [])]
        .sort((x, y) => x.line_order - y.line_order)
        .map((l) => ({
          accountId: l.account_id,
          debitMinor: Number(l.debit_minor),
          creditMinor: Number(l.credit_minor),
        })),
    })),
    partyByEntryId,
    documentByEntryId: documentsByEntry({
      invoices: invoices.map(toNumbered),
      bills: bills.map(toNumbered),
      payments: payments.map(toPayment),
      billPayments: billPayments.map(toPayment),
      paymentAllocations: paymentAllocations.map((a) => ({ paymentId: a.payment_id, documentId: a.invoice_id })),
      billPaymentAllocations: billPaymentAllocations.map((a) => ({
        paymentId: a.bill_payment_id,
        documentId: a.bill_id,
      })),
    }),
    currencies: currencies.map((c) => ({ code: c.code, decimalPlaces: c.decimal_places, isBase: c.is_base })),
    prices: rates.map<BeancountPrice>((r) => ({
      currencyCode: r.currency_code,
      rateDate: String(r.rate_date).slice(0, 10),
      rateToBase: String(r.rate_to_base),
    })),
    assertions: balanceAssertions(assertionRows, currencies.find((c) => c.is_base)?.code ?? ""),
  };
}

export interface BeancountSummary {
  entryCount: number;
  accountCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Currencies at least one posted entry is in. */
  currencies: string[];
  /** Completed bank reconciliations: each adds a balance line, or a comment saying why not. */
  reconciledStatements: number;
  bankAccountCount: number;
  /** Bank accounts with no completed reconciliation, so no balance line. */
  bankAccountsUnreconciled: number;
}

type CountResult = { count: number | null; error: { message: string } | null };

/** What the page shows before anyone downloads. Counts, not the ledger. */
export async function readBeancountSummary(sb: SupabaseClient): Promise<BeancountSummary> {
  const count = async (query: PromiseLike<CountResult>, label: string) => {
    const { count: n, error } = await query;
    if (error) throw new BeancountExportError(`Counting ${label} failed: ${error.message}`);
    return n ?? 0;
  };
  const edge = async (ascending: boolean) => {
    const { data, error } = await sb
      .from("acc_journal_entry")
      .select("entry_date")
      .eq("status", "posted")
      .order("entry_date", { ascending })
      .limit(1);
    if (error) throw new BeancountExportError(`Reading the book's dates failed: ${error.message}`);
    const rows = (data ?? []) as { entry_date: string }[];
    return rows.length > 0 ? String(rows[0].entry_date).slice(0, 10) : null;
  };

  const currencyRows = await readCurrencies(sb);
  const [entryCount, accountCount, firstDate, lastDate, perCurrency, reconciled, banks] = await Promise.all([
    count(sb.from("acc_journal_entry").select("id", { count: "exact", head: true }).eq("status", "posted"), "entries"),
    count(sb.from("acc_account").select("id", { count: "exact", head: true }), "accounts"),
    edge(true),
    edge(false),
    Promise.all(
      currencyRows.map(async (c) => ({
        code: c.code,
        n: await count(
          sb
            .from("acc_journal_entry")
            .select("id", { count: "exact", head: true })
            .eq("status", "posted")
            .eq("currency_code", c.code),
          `${c.code} entries`,
        ),
      })),
    ),
    readAll<{ bank_account_id: string }>("acc_statement_reconciliation", (f, t) =>
      sb.from("acc_statement_reconciliation").select("bank_account_id").eq("status", "completed").order("id").range(f, t)),
    readAll<{ id: string }>("acc_bank_account", (f, t) =>
      sb.from("acc_bank_account").select("id").order("id").range(f, t)),
  ]);

  const withReconciliation = new Set(reconciled.map((r) => r.bank_account_id));
  return {
    entryCount,
    accountCount,
    firstDate,
    lastDate,
    currencies: perCurrency
      .filter((c) => c.n > 0)
      .map((c) => c.code)
      .sort(),
    reconciledStatements: reconciled.length,
    bankAccountCount: banks.length,
    bankAccountsUnreconciled: banks.filter((b) => !withReconciliation.has(b.id)).length,
  };
}
