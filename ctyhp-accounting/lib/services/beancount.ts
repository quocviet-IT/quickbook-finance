import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import {
  documentsByEntry,
  type BeancountAccount,
  type BeancountEntry,
  type BeancountInput,
  type BeancountPrice,
} from "@/lib/domain/beancount";
import { getCurrentCompanySettings } from "@/lib/services/company";
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
] as const;

const PAGE = 1000;

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/** Read every page, stopping on the first short one; throw on any error. */
async function readAll<T>(label: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new BeancountExportError(`Reading ${label} failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
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
  };
}

export interface BeancountSummary {
  entryCount: number;
  accountCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Currencies at least one posted entry is in. */
  currencies: string[];
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
  const [entryCount, accountCount, firstDate, lastDate, perCurrency] = await Promise.all([
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
  ]);

  return {
    entryCount,
    accountCount,
    firstDate,
    lastDate,
    currencies: perCurrency
      .filter((c) => c.n > 0)
      .map((c) => c.code)
      .sort(),
  };
}
