import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSystemActivity } from "@/lib/domain/audit-entities";
import { isCardAccountType, shown } from "@/lib/domain/card-account";
import { homeBank } from "@/lib/domain/dashboard-home/bank";
import { topExpenses, totalExpenses } from "@/lib/domain/dashboard-home/expenses";
import { homeInsights } from "@/lib/domain/dashboard-home/insights";
import { homeClearLine, homeNeeds, homeUnavailableNote, type HomeNeedFacts, type HomeNeedKey } from "@/lib/domain/dashboard-home/needs";
import {
  dueSoonSummary,
  nextBills,
  overdueParties,
  overdueSummary,
  owesLongest,
  projection,
  splitOpenSide,
} from "@/lib/domain/dashboard-home/open-items";
import {
  booksBehind,
  homeMonthRanges,
  homePeriodRanges,
  longMonthName,
  monthKeyOf,
  monthYearLabel,
  monthsAfter,
  type HomeMonthRange,
  type HomePeriodRange,
} from "@/lib/domain/dashboard-home/ranges";
import { hasActivity, markPosted, monthEndBalances, monthMovement, sumLedgerRows, withoutTransfers } from "@/lib/domain/dashboard-home/series";
import { watchChoices, watchRows, type HomeWatchChoice, type HomeWatchRow } from "@/lib/domain/dashboard-home/watchlist";
import type {
  HomeBank,
  HomeCash,
  HomeCloseReport,
  HomeEarlierOpen,
  HomeFigures,
  HomeInsight,
  HomeNeedsReport,
  HomePayables,
  HomePayment,
  HomePeriod,
  HomePeriodFigures,
  HomePeriodKey,
  HomeProfit,
  HomeReceivables,
  HomeStatus,
} from "@/lib/domain/dashboard-home/types";
import { dashboardNeeds, type AttentionKey } from "@/lib/domain/dashboard-needs";
import { naturalBalance } from "@/lib/domain/accounts";
import { fiscalYearForDate } from "@/lib/domain/fiscal";
import { buildProfitAndLoss, type LedgerBalance, type ProfitAndLoss } from "@/lib/domain/reports";
import { addIsoDays } from "@/lib/domain/work-queue";
import type { SectionEnvelope } from "@/lib/domain/work-surface/types";
import { formatMoney } from "@/lib/format";
import { searchAudit } from "@/lib/services/access";
import { getAccountingContext } from "@/lib/services/accounting-dashboard/context";
import { getCloseReadiness } from "@/lib/services/accounting-dashboard/close-readiness";
import { listAccounts } from "@/lib/services/accounts";
import { getApAging, getArAging, type AgingReport } from "@/lib/services/aging";
import { getBankStanding } from "@/lib/services/bank-standing";
import { listBankAccounts } from "@/lib/services/banking";
import { describeAuditActivity, type DashboardActivity } from "@/lib/services/dashboard";
import { getAttentionChecks } from "@/lib/services/exceptions";
import { readAllPages } from "@/lib/services/paging";
import { getLedgerBalances, getMonthlyLedgerBalances } from "@/lib/services/reports";
import { createRequestMemo, type RequestMemo } from "@/lib/services/request-memo";
import { envelopeOf } from "@/lib/services/work-surface/envelope";

/**
 * The Dashboard (3.0.38): four figures, four tabs, and every widget settling
 * on its own.
 *
 * Each read is started once and shared: the ledger before the window and each
 * month's activity in it, each month's transfers between the company's own
 * bank accounts (3.0.40), the three "same days" comparisons, the periods of
 * whole months that reach back past the window (3.0.41), both aging
 * reports (one memo, so their control read is made once), the chart of
 * accounts, and the bank reads. Each section waits only for the reads it is
 * built from, inside its own envelope, so a read that fails makes the
 * sections built on it unavailable and leaves every other section its data.
 *
 * Read-only. Amounts are base currency from the ledger and the aging reports;
 * the one document-currency amount, a payment's, is summed only in the base
 * currency and otherwise shown in its own currency.
 */

export class DashboardHomeError extends Error {}

/** Months on the charts. */
export const HOME_MONTHS = 6;
/** Months read from the ledger: enough for a fiscal year to date and the month before last. */
export const HOME_WINDOW_MONTHS = 14;
/** Payments listed under Recent payments. */
export const RECENT_PAYMENTS = 8;
/** Activity rows kept, and how many are read so nightly backups and other system rows can be dropped. */
export const ACTIVITY_ROWS = { kept: 8, read: 60 } as const;
/** "The last 30 days": asOf and the 29 days before it. */
export const LAST_DAYS = 30;
/** Bank accounts whose latest line is read at once. */
const LINE_DATE_CONCURRENCY = 6;

export interface DashboardHome {
  asOf: string;
  generatedAt: string;
  status: SectionEnvelope<HomeStatus>;
  figures: SectionEnvelope<HomeFigures>;
  cash: SectionEnvelope<HomeCash>;
  profit: SectionEnvelope<HomeProfit>;
  receivables: SectionEnvelope<HomeReceivables>;
  payables: SectionEnvelope<HomePayables>;
  /** The 8 most recent customer payments, not void, each in its own currency. */
  payments: SectionEnvelope<HomePayment[]>;
  bank: SectionEnvelope<HomeBank>;
  /** The audit feed without system activity; empty both when nothing happened and when the reader may not read the audit log. */
  activity: SectionEnvelope<DashboardActivity[]>;
  insights: SectionEnvelope<HomeInsight[]>;
  /**
   * The person's account watchlist (3.0.39), with the accounts the picker
   * offers; unavailable when the watchlist could not be read, or the ledger
   * or the chart could not.
   */
  watchlist: SectionEnvelope<HomeWatchlist>;
}

export interface HomeWatchlist {
  rows: HomeWatchRow[];
  choices: HomeWatchChoice[];
}

export interface DashboardHomeInput {
  asOf: string;
  fiscalStartMonth: number;
  baseCurrency: { code: string; decimals: number };
  /**
   * The request's memo. Pass the same one to `getHomeNeeds` and the two aging
   * reports are read once for the whole page; left out, this call makes its own.
   */
  memo?: RequestMemo;
  /** The person's watchlist, account ids in their order; null when it could not be read. */
  watchlist: string[] | null;
}

/** Said when the person's own watchlist could not be read. */
export const WATCHLIST_UNREAD = "Your watchlist could not be read.";

/** A shared read's failure is answered by the sections that use it; this only keeps Node from calling it unhandled. */
function shared<T>(work: Promise<T>): Promise<T> {
  work.catch(() => undefined);
  return work;
}

/** A read whose failure costs only a comparison: null instead of a figure. */
function orNull<T>(work: Promise<T>): Promise<T | null> {
  return work.then(
    (value) => value,
    () => null,
  );
}

function agingRead(sb: SupabaseClient, side: "receivables" | "payables", asOf: string, memo: RequestMemo): Promise<AgingReport> {
  // reconcileAsOf: every figure on the page speaks for asOf, and the two
  // reports then ask the memo for the same control read.
  return memo(`dashboard-home:${side}-aging:${asOf}`, () =>
    (side === "receivables" ? getArAging : getApAging)(sb, asOf, { memo, reconcileAsOf: asOf }),
  );
}

/** The latest posted entry on or before asOf, and whether anything is posted at all. */
async function readPostedThrough(sb: SupabaseClient, asOf: string): Promise<{ postedThrough: string | null; firstUse: boolean }> {
  const latest = await sb
    .from("acc_journal_entry")
    .select("entry_date")
    .eq("status", "posted")
    .lte("entry_date", asOf)
    .order("entry_date", { ascending: false })
    .limit(1);
  if (latest.error) throw new DashboardHomeError(latest.error.message);
  const date = ((latest.data ?? []) as { entry_date: string }[])[0]?.entry_date;
  if (date) return { postedThrough: String(date).slice(0, 10), firstUse: false };
  // Nothing by asOf: only a posted entry dated later stops this being a first use.
  const later = await sb.from("acc_journal_entry").select("id").eq("status", "posted").limit(1);
  if (later.error) throw new DashboardHomeError(later.error.message);
  return { postedThrough: null, firstUse: (later.data ?? []).length === 0 };
}

/**
 * Each month's amount moved between two of the company's own bank accounts
 * (`acc_monthly_bank_transfers`, 0199), in the same window as the monthly
 * ledger read. A month with none has no key. One row per month at most, so
 * the read is never near PostgREST's row cap and is not paged.
 */
async function readMonthlyBankTransfers(sb: SupabaseClient, asOf: string, months: number): Promise<Map<string, number>> {
  const { data, error } = await sb.rpc("acc_monthly_bank_transfers", { p_to: asOf, p_months: months });
  if (error) throw new DashboardHomeError(error.message);
  return new Map(((data ?? []) as { month_key: string; transfer_base: number | string }[]).map((row) => [String(row.month_key), Number(row.transfer_base)]));
}

async function readLastClosed(sb: SupabaseClient): Promise<HomeStatus["lastClosed"]> {
  const { data, error } = await sb.rpc("acc_period_close_history", { p_limit: 1 });
  if (error) throw new DashboardHomeError(error.message);
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row?.period_end) return null;
  const periodEnd = String(row.period_end).slice(0, 10);
  return { label: monthYearLabel(periodEnd), periodEnd };
}

/** One row of `acc_bank_close_standing` (0160): every bank and card account's lines waiting to be coded. */
interface BankCloseStandingRow {
  bank_account_id: string;
  unmatched_count: number | string;
}

async function readLinesToCode(sb: SupabaseClient, asOf: string): Promise<Map<string, number>> {
  const { data, error } = await sb.rpc("acc_bank_close_standing", { p_as_of: asOf });
  if (error) throw new DashboardHomeError(error.message);
  return new Map(((data ?? []) as BankCloseStandingRow[]).map((row) => [String(row.bank_account_id), Number(row.unmatched_count)]));
}

/**
 * Each bank account's latest bank line on or before asOf: one small read per
 * account, a few at a time. Lines still pending at the bank or removed by the
 * feed are not counted, as Bank Transactions does not count them.
 */
async function readLastLineDates(sb: SupabaseClient, ids: readonly string[], asOf: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const { data, error } = await sb
        .from("acc_bank_transaction")
        .select("txn_date")
        .eq("bank_account_id", id)
        .eq("pending", false)
        .is("provider_removed_at", null)
        .lte("txn_date", asOf)
        .order("txn_date", { ascending: false })
        .limit(1);
      if (error) throw new DashboardHomeError(error.message);
      const date = ((data ?? []) as { txn_date: string }[])[0]?.txn_date;
      out.set(id, date ? String(date).slice(0, 10) : null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LINE_DATE_CONCURRENCY, ids.length) }, worker));
  return out;
}

/**
 * Payments dated in the last 30 days through asOf, not void. Their amounts are
 * in each payment's own currency, so only the base currency's are summed; the
 * others are counted, never added in as if they were base.
 */
async function readPaymentsInLast30(
  sb: SupabaseClient,
  table: "acc_payment" | "acc_bill_payment",
  asOf: string,
  baseCode: string,
): Promise<{ baseMinor: number; count: number; otherCurrencyCount: number }> {
  const from = addIsoDays(asOf, -(LAST_DAYS - 1));
  const rows = await readAllPages<{ amount_minor: number | string; currency_code: string }>(
    (start, end) =>
      sb
        .from(table)
        .select("id,amount_minor,currency_code")
        .gte("payment_date", from)
        .lte("payment_date", asOf)
        .neq("status", "void")
        .order("payment_date")
        .order("id")
        .range(start, end),
    (message) => new DashboardHomeError(message),
  );
  const base = rows.filter((row) => row.currency_code === baseCode);
  return {
    baseMinor: base.reduce((sum, row) => sum + Number(row.amount_minor), 0),
    count: base.length,
    otherCurrencyCount: rows.length - base.length,
  };
}

/** The most recent customer payments, not void, each in its own currency with that currency's decimals. */
async function readRecentPayments(
  sb: SupabaseClient,
  asOf: string,
  baseCurrency: DashboardHomeInput["baseCurrency"],
): Promise<HomePayment[]> {
  const { data, error } = await sb
    .from("acc_payment")
    .select("id,payment_date,amount_minor,currency_code,acc_customer(name)")
    .neq("status", "void")
    .lte("payment_date", asOf)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(RECENT_PAYMENTS);
  if (error) throw new DashboardHomeError(error.message);
  const rows = (data ?? []) as unknown as {
    id: string;
    payment_date: string;
    amount_minor: number | string;
    currency_code: string;
    acc_customer: { name?: string } | null;
  }[];
  const decimals = new Map<string, number>([[baseCurrency.code, baseCurrency.decimals]]);
  const others = [...new Set(rows.map((row) => row.currency_code).filter((code) => !decimals.has(code)))];
  if (others.length > 0) {
    // Only when a payment is in another currency: its decimals, never assumed.
    const currencies = await sb.from("acc_currency").select("code,decimal_places").in("code", others);
    if (currencies.error) throw new DashboardHomeError(currencies.error.message);
    for (const row of (currencies.data ?? []) as { code: string; decimal_places: number }[]) decimals.set(row.code, Number(row.decimal_places));
  }
  return rows.map((row) => {
    const places = decimals.get(row.currency_code);
    if (places === undefined) throw new DashboardHomeError(`No currency ${row.currency_code} for a payment`);
    return {
      id: String(row.id),
      date: String(row.payment_date).slice(0, 10),
      customerName: row.acc_customer?.name ?? "",
      amountMinor: Number(row.amount_minor),
      currencyCode: row.currency_code,
      decimals: places,
    };
  });
}

/** Recent accounting activity: the audit feed without system rows (nightly backups and the like), for someone who may read it. */
async function readActivity(sb: SupabaseClient): Promise<DashboardActivity[]> {
  const permission = await sb.rpc("acc_has_permission", { p_key: "audit.read" });
  if (permission.error) throw new DashboardHomeError(permission.error.message);
  if (!permission.data) return [];
  const rows = await searchAudit(sb, {
    table_name: null,
    record_id: null,
    actor_id: null,
    action: null,
    from: null,
    to: null,
    limit: ACTIVITY_ROWS.read,
  });
  return rows.filter((row) => !isSystemActivity(row)).slice(0, ACTIVITY_ROWS.kept).map(describeAuditActivity);
}

/** What the two ledger reads give every section: the window's months and their figures, and the balances as of asOf. */
interface Books {
  months: HomeMonthRange[];
  byMonth: Map<string, LedgerBalance[]>;
  pnl: ProfitAndLoss[];
  cash: number[];
  receivables: number[];
  payables: number[];
  /** Gross debits and credits to bank-type accounts per month, transfers between them included. */
  bankMovement: { debitMinor: number[]; creditMinor: number[] };
  /** Every account's balance as of asOf: the opening plus each month's activity. */
  balances: LedgerBalance[];
  cashToday: number;
}

function booksFrom(months: HomeMonthRange[], opening: LedgerBalance[], byMonth: Map<string, LedgerBalance[]>): Books {
  const cash = monthEndBalances(opening, byMonth, months, ["bank"]);
  return {
    months,
    byMonth,
    pnl: months.map((month) => buildProfitAndLoss(byMonth.get(month.key) ?? [])),
    cash,
    receivables: monthEndBalances(opening, byMonth, months, ["accounts_receivable"]),
    payables: monthEndBalances(opening, byMonth, months, ["accounts_payable"]),
    bankMovement: monthMovement(byMonth, months, ["bank"]),
    balances: sumLedgerRows([opening, ...months.map((month) => byMonth.get(month.key))]),
    cashToday: cash[cash.length - 1],
  };
}

function periodFigures(pnl: ProfitAndLoss): HomePeriodFigures {
  return {
    incomeMinor: pnl.income.total + pnl.otherIncome.total,
    expenseMinor: totalExpenses(pnl),
    netMinor: pnl.netIncome,
    salesMinor: pnl.income.total,
  };
}

/** The rows of the window's months that fall in a range made of whole months (the last may be to date). */
function monthsIn(books: Books, range: Pick<HomePeriodRange, "from" | "to">): LedgerBalance[] {
  const first = monthKeyOf(range.from);
  const last = monthKeyOf(range.to);
  if (first < books.months[0].key) throw new DashboardHomeError(`The period from ${range.from} starts before the months read`);
  return sumLedgerRows(books.months.filter((m) => m.key >= first && m.key <= last).map((m) => books.byMonth.get(m.key)));
}

/** The period a range is compared with, as a range of its own. */
function priorOf(range: HomePeriodRange): Pick<HomePeriodRange, "from" | "to"> {
  return { from: range.priorFrom, to: range.priorTo };
}

function homePeriod(key: HomePeriodKey, range: HomePeriodRange, rows: LedgerBalance[], prior: LedgerBalance[] | null): HomePeriod {
  const pnl = buildProfitAndLoss(rows);
  return {
    key,
    label: range.label,
    from: range.from,
    to: range.to,
    compareLabel: range.compareLabel,
    ...periodFigures(pnl),
    grossMarginPercent: pnl.income.total === 0 ? null : (pnl.grossProfit / Math.abs(pnl.income.total)) * 100,
    // Nothing posted in the comparison period is nothing to compare with.
    prior: prior && hasActivity(prior) ? periodFigures(buildProfitAndLoss(prior)) : null,
    expenses: topExpenses(pnl),
  };
}

export async function getDashboardHome(sb: SupabaseClient, input: DashboardHomeInput): Promise<DashboardHome> {
  const { asOf, fiscalStartMonth, baseCurrency } = input;
  const memo = input.memo ?? createRequestMemo();
  const money = (minor: number) => formatMoney(minor, baseCurrency.code, baseCurrency.decimals);
  const windowMonths = homeMonthRanges(asOf, HOME_WINDOW_MONTHS);
  const ranges = homePeriodRanges(asOf, fiscalStartMonth);
  const shownFrom = windowMonths.length - HOME_MONTHS;

  // The shared reads, each started once.
  const opening = shared(getLedgerBalances(sb, null, addIsoDays(windowMonths[0].from, -1)));
  const monthly = shared(getMonthlyLedgerBalances(sb, asOf, HOME_WINDOW_MONTHS));
  const books = shared(Promise.all([opening, monthly]).then(([open, byMonth]) => booksFrom(windowMonths, open, byMonth)));
  // Null when it cannot be read: cash flow then shows gross money in and out, and says so.
  const transfers = orNull(readMonthlyBankTransfers(sb, asOf, HOME_WINDOW_MONTHS));
  const priorMonth = orNull(getLedgerBalances(sb, ranges.month.priorFrom, ranges.month.priorTo));
  const priorQuarter = orNull(getLedgerBalances(sb, ranges.quarter.priorFrom, ranges.quarter.priorTo));
  const priorYear = orNull(getLedgerBalances(sb, ranges.year.priorFrom, ranges.year.priorTo));
  /**
   * A range of whole months (3.0.41): summed from the window's months when it
   * lies wholly inside them, otherwise one read of its own, started now with
   * the others. Null when that read failed. Two periods asking for the same
   * range share it: in a fiscal year's first month the last twelve months are
   * last year, and their comparisons the year before.
   */
  const wholeMonthReads = new Map<string, Promise<LedgerBalance[] | null>>();
  const wholeMonths = (range: Pick<HomePeriodRange, "from" | "to">): Promise<LedgerBalance[] | null> => {
    const key = `${range.from}..${range.to}`;
    const seen = wholeMonthReads.get(key);
    if (seen) return seen;
    const read = orNull(range.from >= windowMonths[0].from ? books.then((b) => monthsIn(b, range)) : getLedgerBalances(sb, range.from, range.to));
    wholeMonthReads.set(key, read);
    return read;
  };
  // The last three months and their comparison, and the last twelve, are always inside the window.
  const last12Prior = wholeMonths(priorOf(ranges.last12));
  const lastYear = wholeMonths(ranges.lastYear);
  const lastYearPrior = wholeMonths(priorOf(ranges.lastYear));
  const receivablesAging = shared(agingRead(sb, "receivables", asOf, memo));
  const payablesAging = shared(agingRead(sb, "payables", asOf, memo));
  const accounts = shared(listAccounts(sb));
  const posted = shared(readPostedThrough(sb, asOf));
  const lastClosed = shared(readLastClosed(sb));
  const banks = shared(listBankAccounts(sb));
  const standings = shared(getBankStanding(sb, asOf));
  const linesToCode = shared(readLinesToCode(sb, asOf));
  const lastLines = shared(banks.then((list) => readLastLineDates(sb, list.map((bank) => bank.id), asOf)));
  const received = shared(readPaymentsInLast30(sb, "acc_payment", asOf, baseCurrency.code));
  const paid = shared(readPaymentsInLast30(sb, "acc_bill_payment", asOf, baseCurrency.code));

  /** The window's months marked posted or not. */
  const postedMonths = (b: Books, postedThrough: string | null) => markPosted(b.months, postedThrough, b.byMonth);

  const status = async (): Promise<HomeStatus> => {
    const [{ postedThrough, firstUse }, closed, lines] = await Promise.all([posted, lastClosed, lastLines]);
    const dates = [...lines.values()].filter((date): date is string => date !== null).sort();
    return {
      asOf,
      postedThrough,
      bankLinesThrough: dates.at(-1) ?? null,
      lastClosed: closed,
      behind: booksBehind(postedThrough, asOf),
      missingMonths: monthsAfter(postedThrough, asOf).slice(-HOME_MONTHS).map(longMonthName),
      firstUse,
    };
  };

  const figures = async (): Promise<HomeFigures> => {
    const [b, { postedThrough }, ar, ap, prior] = await Promise.all([books, posted, receivablesAging, payablesAging, priorMonth]);
    const arSide = splitOpenSide(ar.rows, asOf, "invoice");
    const apSide = splitOpenSide(ap.rows, asOf, "bill");
    return {
      months: postedMonths(b, postedThrough).slice(shownFrom),
      cash: {
        valueMinor: b.cashToday,
        series: b.cash.slice(shownFrom),
        changeThisMonthMinor: b.cashToday - b.cash[b.cash.length - 2],
      },
      netIncome: {
        valueMinor: b.pnl[b.pnl.length - 1].netIncome,
        series: b.pnl.slice(shownFrom).map((pnl) => pnl.netIncome),
        priorSameDaysMinor: prior && hasActivity(prior) ? buildProfitAndLoss(prior).netIncome : null,
        compareLabel: ranges.month.compareLabel,
      },
      receivables: {
        valueMinor: arSide.totalMinor,
        ledgerMinor: ar.controlBalanceMinor,
        series: b.receivables.slice(shownFrom),
        overdueMinor: arSide.overdueMinor,
        overdueInvoices: arSide.overdueDocuments,
      },
      payables: {
        valueMinor: apSide.totalMinor,
        ledgerMinor: ap.controlBalanceMinor,
        series: b.payables.slice(shownFrom),
        overdueMinor: apSide.overdueMinor,
        overdueBills: apSide.overdueDocuments,
        dueSoonMinor: apSide.dueSoonMinor,
        dueSoonBills: apSide.dueSoonDocuments,
      },
    };
  };

  const cash = async (): Promise<HomeCash> => {
    const [b, { postedThrough }, moved] = await Promise.all([books, posted, transfers]);
    const behind = booksBehind(postedThrough, asOf);
    // No forecast while the books are behind; otherwise it needs both aging reports.
    const [ar, ap] = behind ? [null, null] : await Promise.all([receivablesAging, payablesAging]);
    // Transfers between the company's own bank accounts come off both sides.
    // When they could not be read, or do not fit the month's bank figures (a
    // transfer posted between the two reads), the gross figures stand and the
    // card says transfers count on both sides: never a wrong net, never a blank card.
    const gross = { inMinor: b.bankMovement.debitMinor, outMinor: b.bankMovement.creditMinor };
    let flow = gross;
    let excluded = false;
    if (moved) {
      try {
        flow = withoutTransfers(b.bankMovement, moved, b.months);
        excluded = true;
      } catch {
        flow = gross;
      }
    }
    return {
      months: postedMonths(b, postedThrough).slice(shownFrom),
      balanceMinor: b.cash.slice(shownFrom),
      inMinor: flow.inMinor.slice(shownFrom),
      outMinor: flow.outMinor.slice(shownFrom),
      transfersExcluded: excluded,
      projection: ar && ap ? projection(b.cashToday, ar.rows, ap.rows, asOf) : null,
    };
  };

  const profit = async (): Promise<HomeProfit> => {
    const [b, { postedThrough }, month, quarter, year, last12Before, lastYearRows, lastYearBefore] = await Promise.all([
      books,
      posted,
      priorMonth,
      priorQuarter,
      priorYear,
      last12Prior,
      lastYear,
      lastYearPrior,
    ]);
    const current = windowMonths[windowMonths.length - 1].key;
    const previous = windowMonths[windowMonths.length - 2].key;
    const beforePrevious = windowMonths[windowMonths.length - 3].key;
    const shown = b.pnl.slice(shownFrom);
    return {
      months: postedMonths(b, postedThrough).slice(shownFrom),
      incomeMinor: shown.map((pnl) => pnl.income.total + pnl.otherIncome.total),
      expenseMinor: shown.map(totalExpenses),
      salesMinor: shown.map((pnl) => pnl.income.total),
      periods: {
        month: homePeriod("month", ranges.month, b.byMonth.get(current) ?? [], month),
        lastMonth: homePeriod("lastMonth", ranges.lastMonth, b.byMonth.get(previous) ?? [], b.byMonth.get(beforePrevious) ?? null),
        last3: homePeriod("last3", ranges.last3, monthsIn(b, ranges.last3), monthsIn(b, priorOf(ranges.last3))),
        quarter: homePeriod("quarter", ranges.quarter, monthsIn(b, ranges.quarter), quarter),
        year: homePeriod("year", ranges.year, monthsIn(b, ranges.year), year),
        last12: homePeriod("last12", ranges.last12, monthsIn(b, ranges.last12), last12Before),
        // Its own read failed: only this period is missing, and the card says so.
        lastYear: lastYearRows ? homePeriod("lastYear", ranges.lastYear, lastYearRows, lastYearBefore) : null,
      },
    };
  };

  /** The undeposited-funds accounts' balance; null when the company has none, or when it cannot be read: the line is then left out. */
  const undeposited = orNull(
    Promise.all([accounts, books]).then(([chart, b]) => {
      const ids = new Set(chart.filter((account) => account.detail_type === "undeposited_funds").map((account) => account.id));
      if (ids.size === 0) return null;
      return b.balances
        .filter((row) => ids.has(row.accountId))
        .reduce((sum, row) => sum + naturalBalance(row.accountType, row.debitBase, row.creditBase), 0);
    }),
  );

  const receivables = async (): Promise<HomeReceivables> => {
    const [ar, receivedLast30, undepositedMinor] = await Promise.all([receivablesAging, received, undeposited]);
    return {
      ...splitOpenSide(ar.rows, asOf, "invoice"),
      ledgerMinor: ar.controlBalanceMinor,
      receivedLast30,
      undepositedMinor,
      owesLongest: owesLongest(ar.rows, asOf, 5),
    };
  };

  const payables = async (): Promise<HomePayables> => {
    const [ap, paidLast30] = await Promise.all([payablesAging, paid]);
    return {
      ...splitOpenSide(ap.rows, asOf, "bill"),
      ledgerMinor: ap.controlBalanceMinor,
      paidLast30,
      nextBills: nextBills(ap.rows, asOf, 5),
    };
  };

  const bank = async (): Promise<HomeBank> => {
    const [list, standing, toCode, lines, b] = await Promise.all([banks, standings, linesToCode, lastLines, books]);
    return homeBank({
      records: list.map((account) => ({
        id: account.id,
        accountId: account.account_id,
        name: account.bank_name || account.account_name,
        masked: account.account_number_masked,
        isCard: isCardAccountType(account.account_type),
      })),
      standings: standing,
      linesToCode: toCode,
      lastLineDates: lines,
      balances: b.balances,
      asOf,
      money,
    });
  };

  const insights = async (): Promise<HomeInsight[]> => {
    const [b, { postedThrough }, parties] = await Promise.all([
      books,
      posted,
      // The receivables rule is left out when the aging report cannot be read; the others stand.
      orNull(receivablesAging.then((ar) => overdueParties(ar.rows, asOf))),
    ]);
    return homeInsights(
      {
        asOf,
        postedThrough,
        behind: booksBehind(postedThrough, asOf),
        months: postedMonths(b, postedThrough),
        pnl: b.pnl,
        cashTodayMinor: b.cashToday,
        overdueParties: parties,
      },
      money,
    );
  };

  /**
   * The watchlist, from reads already made: the opening and monthly ledger
   * (since the books began, this month, last month and the fiscal year to
   * date) and the chart. Its Balance is the Chart of Accounts figure.
   */
  const watchlist = async (ids: readonly string[]): Promise<HomeWatchlist> => {
    const [chart, b] = await Promise.all([accounts, books]);
    const current = windowMonths[windowMonths.length - 1].key;
    const previous = windowMonths[windowMonths.length - 2].key;
    return {
      rows: watchRows({
        ids,
        accounts: chart,
        thisMonth: b.byMonth.get(current) ?? [],
        lastMonth: b.byMonth.get(previous) ?? [],
        sinceTheBooksBegan: b.balances,
        fiscalYearToDate: monthsIn(b, ranges.year),
      }),
      choices: watchChoices(chart),
    };
  };

  const [
    statusEnvelope,
    figuresEnvelope,
    cashEnvelope,
    profitEnvelope,
    receivablesEnvelope,
    payablesEnvelope,
    paymentsEnvelope,
    bankEnvelope,
    activityEnvelope,
    insightsEnvelope,
    watchlistEnvelope,
  ] = await Promise.all([
    envelopeOf(status(), "How far the books are posted could not be read."),
    envelopeOf(figures(), "The four figures could not be read."),
    envelopeOf(cash(), "Cash flow could not be read."),
    envelopeOf(profit(), "Profit and loss could not be read."),
    envelopeOf(receivables(), "Invoices could not be read."),
    envelopeOf(payables(), "Bills could not be read."),
    envelopeOf(readRecentPayments(sb, asOf, baseCurrency), "Recent payments could not be read."),
    envelopeOf(bank(), "Bank accounts could not be read."),
    envelopeOf(readActivity(sb), "Recent accounting activity could not be read."),
    envelopeOf(insights(), "Insights could not be read."),
    input.watchlist === null
      ? envelopeOf<HomeWatchlist>(Promise.reject(new DashboardHomeError("The watchlist preference could not be read")), WATCHLIST_UNREAD)
      : envelopeOf(watchlist(input.watchlist), "The account watchlist could not be read."),
  ]);

  return {
    asOf,
    generatedAt: new Date().toISOString(),
    status: statusEnvelope,
    figures: figuresEnvelope,
    cash: cashEnvelope,
    profit: profitEnvelope,
    receivables: receivablesEnvelope,
    payables: payablesEnvelope,
    payments: paymentsEnvelope,
    bank: bankEnvelope,
    activity: activityEnvelope,
    insights: insightsEnvelope,
    watchlist: watchlistEnvelope,
  };
}

/* ------------------------------------------------------------ needs attention */

export interface HomeNeedsInput {
  asOf: string;
  baseCurrency: { code: string; decimals: number };
  /** The company's first month of the fiscal year: a month left open in an earlier year is dealt with elsewhere. */
  fiscalStartMonth: number;
  /** The reader holds company.export, so may be told a backup is late (2.90). */
  backups: boolean;
  /** The request's memo, shared with `getDashboardHome` so the aging reports are read once. */
  memo?: RequestMemo;
}

const ATTENTION_KEYS: readonly AttentionKey[] = [
  "backup",
  "waiting",
  "recurringDue",
  "neverReconciled",
  "noLongerAgree",
  "holding",
  "futureDated",
  "overBudget",
];

/** Card lines no completed reconciliation has ticked (0160), as a card statement says them: charges positive. */
async function readCardActivity(sb: SupabaseClient, asOf: string): Promise<HomeNeedFacts["cardActivity"]> {
  const { data, error } = await sb.rpc("acc_unreconciled_cards", { p_as_of: asOf });
  if (error) throw new DashboardHomeError(error.message);
  const c = ((data ?? []) as { card_count: number | string; item_count: number | string; amount_minor: number | string }[])[0];
  if (!c) return null;
  return { cards: Number(c.card_count ?? 0), lines: Number(c.item_count ?? 0), amountMinor: shown(Number(c.amount_minor ?? 0), "card") };
}

async function readPendingApprovals(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb.from("acc_approval_request").select("id", { count: "exact", head: true }).eq("status", "pending");
  if (error) throw new DashboardHomeError(error.message);
  return count ?? 0;
}

/** Open periods whose last day has passed, the oldest one's last day, and whether it is from an earlier fiscal year. */
async function readMonthsOpen(sb: SupabaseClient, asOf: string, fiscalStartMonth: number): Promise<HomeNeedFacts["monthsOpen"]> {
  const { data, count, error } = await sb
    .from("acc_accounting_period")
    .select("period_end,fiscal_year", { count: "exact" })
    .eq("status", "open")
    .lt("period_end", asOf)
    .order("period_end")
    .limit(1);
  if (error) throw new DashboardHomeError(error.message);
  const oldest = ((data ?? []) as { period_end: string; fiscal_year: number | string }[])[0];
  if (!oldest?.period_end) return null;
  return {
    count: count ?? 1,
    oldestPeriodEnd: String(oldest.period_end).slice(0, 10),
    earlierYear: Number(oldest.fiscal_year) < fiscalYearForDate(asOf, fiscalStartMonth),
  };
}

/**
 * Needs attention, streamed on its own: the Dashboard's existing checks
 * (`getAttentionChecks`) and the money in and out (`homeNeeds`). A check whose
 * read fails is named in the note and never counted as clear.
 */
export async function getHomeNeeds(sb: SupabaseClient, input: HomeNeedsInput): Promise<HomeNeedsReport> {
  const { asOf, baseCurrency, backups, fiscalStartMonth } = input;
  const memo = input.memo ?? createRequestMemo();
  const money = (minor: number) => formatMoney(minor, baseCurrency.code, baseCurrency.decimals);
  const settle = <T>(work: Promise<T>) =>
    work.then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );
  const [checks, ar, ap, cards, approvals, monthsOpen] = await Promise.all([
    settle(getAttentionChecks(sb, asOf, { backups })),
    settle(agingRead(sb, "receivables", asOf, memo)),
    settle(agingRead(sb, "payables", asOf, memo)),
    settle(readCardActivity(sb, asOf)),
    settle(readPendingApprovals(sb)),
    settle(readMonthsOpen(sb, asOf, fiscalStartMonth)),
  ]);

  const made = ATTENTION_KEYS.filter((key) => key !== "backup" || backups);
  const unavailable: HomeNeedKey[] = checks.ok ? [...checks.value.unavailable] : [...made];
  if (!ar.ok) unavailable.push("overdueInvoices");
  if (!ap.ok) unavailable.push("billsOverdue", "billsDueSoon");
  if (!cards.ok) unavailable.push("cardActivity");
  if (!approvals.ok) unavailable.push("approvals");
  if (!monthsOpen.ok) unavailable.push("monthsOpen");

  const facts: HomeNeedFacts = {
    asOf,
    overdueInvoices: ar.ok ? overdueSummary(ar.value.rows, asOf, "invoice") : null,
    billsOverdue: ap.ok ? overdueSummary(ap.value.rows, asOf, "bill") : null,
    billsDueSoon: ap.ok ? dueSoonSummary(ap.value.rows, asOf, "bill") : null,
    cardActivity: cards.ok ? cards.value : null,
    approvals: approvals.ok ? approvals.value : null,
    monthsOpen: monthsOpen.ok ? monthsOpen.value : null,
    unavailable,
  };
  const existing = checks.ok ? dashboardNeeds(checks.value, money) : [];
  return {
    needs: homeNeeds(existing, facts, money),
    clear: homeClearLine(unavailable, made.length + 6),
    note: homeUnavailableNote(unavailable),
  };
}

/* --------------------------------------------------------------- month-end close */

/** Open months of fiscal years before `fiscalYear`: every one of them has ended. */
async function readEarlierOpen(sb: SupabaseClient, fiscalYear: number): Promise<HomeEarlierOpen | null> {
  const { data, count, error } = await sb
    .from("acc_accounting_period")
    .select("period_end", { count: "exact" })
    .eq("status", "open")
    .lt("fiscal_year", fiscalYear)
    .order("period_end")
    .limit(1);
  if (error) throw new DashboardHomeError(error.message);
  const oldest = ((data ?? []) as { period_end: string }[])[0]?.period_end;
  return oldest ? { count: count ?? 1, oldestPeriodEnd: String(oldest).slice(0, 10) } : null;
}

/**
 * The month-end close widget, streamed on its own: the real checklist of the
 * period a close is about (the oldest overdue open period of this fiscal year,
 * else the current one), at asOf, as the period close screen picks it. Months
 * of earlier fiscal years still open are counted apart: that screen does not
 * show them, Accounting periods does.
 */
export async function getHomeClose(sb: SupabaseClient, input: { asOf: string }): Promise<HomeCloseReport> {
  const context = await getAccountingContext(sb);
  const { asOf } = input;
  // Every widget on the page speaks for the same day.
  const sameDay = {
    ...context,
    asOf,
    currentPeriod: context.periods.find((p) => p.periodStart <= asOf && asOf <= p.periodEnd) ?? null,
    overduePeriods: context.periods.filter((p) => p.status === "open" && p.periodEnd < asOf),
  };
  const [readiness, earlierOpen] = await Promise.all([
    getCloseReadiness(sb, sameDay),
    // Only a sentence rests on it: when it cannot be read, the sentence is left out.
    orNull(readEarlierOpen(sb, context.fiscalYear)),
  ]);
  if (!readiness) return { close: null, earlierOpen };
  const lastClosed = readiness.history[0];
  return {
    close: {
      periodLabel: monthYearLabel(readiness.period.periodStart),
      periodEnd: readiness.period.periodEnd,
      steps: readiness.steps.map((step) => ({ key: step.key, title: step.title, status: step.status, href: step.href })),
      complete: readiness.progress.complete,
      applicable: readiness.progress.applicable,
      lastClosedLabel: lastClosed ? monthYearLabel(lastClosed.periodEnd) : null,
    },
    earlierOpen,
  };
}
