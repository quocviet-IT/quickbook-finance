/**
 * The Dashboard's figures, checked against the reports on every company's books — read-only.
 *
 * For every company the smoke user belongs to, at the company's today:
 *  (a) every section of the Dashboard can be read;
 *  (b) Cash on hand, today and at each month end on the chart, equals the bank
 *      accounts' balance on the balance sheet at that date, read here straight
 *      from `getLedgerBalances`;
 *  (c) net income, each month on the charts and each of the four periods
 *      (with the period it is compared with) equal the Profit and Loss over
 *      the same dates;
 *  (d) Owed to you and You owe equal the A/R and A/P Aging totals, bucket by
 *      bucket, the overdue, due soon, later and credits add back to them, and
 *      the ledger balance said beside each is the report's control account;
 *  (e) the Bank accounts rows add up to Cash on hand;
 *  (f) the account watchlist (3.0.39), given up to 10 accounts whose Chart of
 *      Accounts figure is not zero: each Balance equals that figure
 *      (`getChartBalances`), and This month and Last month equal the
 *      account's natural activity from `getLedgerBalances` over the month to
 *      date and the whole previous month;
 *  (g) Cash flow's money in and money out (3.0.40): each month, money in
 *      minus money out is the change in cash on hand, the first month's from
 *      the bank-type balance at the end of the month before; and an
 *      independent recount of the transfers between the company's own bank
 *      accounts, from the posted journal lines on bank-type accounts (per
 *      entry, the smaller of its bank debits and bank credits), taken off the
 *      gross bank debits and credits, gives money in and money out exactly.
 *      The gross from the lines is also checked against the ledger, so a
 *      line the recount missed cannot agree by accident.
 * Counts and agree/disagree are logged; names and amounts never are.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/dashboard-home.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import type { AccountRow } from "@/lib/db/types";
import { accountNormalBalance } from "@/lib/domain/accounts";
import { naturalBalanceMinor } from "@/lib/domain/chart-groups";
import { totalExpenses } from "@/lib/domain/dashboard-home/expenses";
import { homeMonthRanges, homePeriodRanges } from "@/lib/domain/dashboard-home/ranges";
import { hasActivity } from "@/lib/domain/dashboard-home/series";
import type { HomeOpenSide, HomePeriodFigures, HomePeriodKey } from "@/lib/domain/dashboard-home/types";
import { buildProfitAndLoss, type LedgerBalance } from "@/lib/domain/reports";
import { addIsoDays } from "@/lib/domain/work-queue";
import { listAccounts } from "@/lib/services/accounts";
import { getApAging, getArAging, type AgingReport } from "@/lib/services/aging";
import { getChartBalances, type ChartBalances } from "@/lib/services/chart-balances";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { getDashboardHome, HOME_MONTHS, type DashboardHome } from "@/lib/services/dashboard-home";
import { readAllPages } from "@/lib/services/paging";
import { listCurrencies } from "@/lib/services/reference";
import { getLedgerBalances } from "@/lib/services/reports";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
  fiscalStartMonth: number;
  home: DashboardHome;
  /** The chart, its figures today, and the accounts handed to the watchlist. */
  accounts: AccountRow[];
  chart: ChartBalances;
  watched: string[];
}

const companies: Company[] = [];
const PERIODS: readonly HomePeriodKey[] = ["month", "lastMonth", "quarter", "year"];

beforeAll(async () => {
  const s = await smokeSession();
  if (!s.session) throw new Error("The smoke sign-in returned no session.");
  const auth = { persistSession: false };
  const headers = { Authorization: `Bearer ${s.session.access_token}` };
  const control = createClient(s.supabaseUrl, s.anonKey, { db: { schema: "onebook" }, auth, global: { headers } });
  const { data, error } = await control.rpc("my_companies");
  if (error) throw new Error(`my_companies: ${error.message}`);
  for (const row of (data ?? []) as { schema_name: string }[]) {
    const sb = createClient(s.supabaseUrl, s.anonKey, {
      db: { schema: row.schema_name },
      auth,
      global: { headers },
    }) as unknown as SupabaseClient;
    const [settings, currencies] = await Promise.all([getCurrentCompanySettings(sb), listCurrencies(sb)]);
    const base = currencies.find((currency) => currency.is_base);
    const today = todayInTimeZone(settings?.time_zone ?? "UTC");
    const fiscalStartMonth = settings?.fiscal_year_start_month ?? 1;
    // The watchlist is given up to 10 accounts the Chart of Accounts shows a figure for today.
    const [accounts, chart] = await Promise.all([listAccounts(sb), getChartBalances(sb, today)]);
    const watched = accounts.filter((account) => (chart.figures[account.id] ?? 0) !== 0).slice(0, 10).map((account) => account.id);
    const home = await getDashboardHome(sb, {
      asOf: today,
      fiscalStartMonth,
      baseCurrency: { code: base?.code ?? "USD", decimals: base?.decimal_places ?? 2 },
      watchlist: watched,
    });
    companies.push({ name: row.schema_name, sb, today, fiscalStartMonth, home, accounts, chart, watched });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

function bankTotal(rows: readonly LedgerBalance[]): number {
  return rows.filter((row) => row.accountType === "bank").reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
}

/** One posted journal line on a bank-type posting account, as PostgREST returns it with its entry. */
interface BankLine {
  journal_entry_id: string;
  debit_minor: number | string;
  credit_minor: number | string;
  amount_base_minor: number | string;
  acc_journal_entry: { entry_date: string; status: string };
}

/**
 * Every month's gross bank debits and credits, and the transfers between the
 * company's own bank accounts, recounted from the journal lines rather than
 * through acc_monthly_bank_transfers: per posted entry, the smaller of its
 * bank debits and bank credits, summed by the entry's month.
 */
async function recountBankMovement(
  sb: SupabaseClient,
  from: string,
  to: string,
): Promise<{ lines: number; entries: number; byMonth: Map<string, { debit: number; credit: number; transfer: number }> }> {
  const lines = await readAllPages<BankLine>(
    (start, end) =>
      sb
        .from("acc_journal_line")
        .select(
          "id,journal_entry_id,debit_minor,credit_minor,amount_base_minor," +
            "acc_journal_entry!inner(entry_date,status),acc_account!inner(account_type,is_posting_account)",
        )
        .eq("acc_account.account_type", "bank")
        .eq("acc_account.is_posting_account", true)
        .eq("acc_journal_entry.status", "posted")
        .gte("acc_journal_entry.entry_date", from)
        .lte("acc_journal_entry.entry_date", to)
        .order("id")
        .range(start, end),
    (message) => new Error(`journal lines: ${message}`),
  );
  const entries = new Map<string, { month: string; debit: number; credit: number }>();
  for (const line of lines) {
    const entry = entries.get(line.journal_entry_id) ?? { month: String(line.acc_journal_entry.entry_date).slice(0, 7), debit: 0, credit: 0 };
    const amount = Number(line.amount_base_minor);
    if (Number(line.debit_minor) > 0) entry.debit += amount;
    if (Number(line.credit_minor) > 0) entry.credit += amount;
    entries.set(line.journal_entry_id, entry);
  }
  const byMonth = new Map<string, { debit: number; credit: number; transfer: number }>();
  for (const entry of entries.values()) {
    const month = byMonth.get(entry.month) ?? { debit: 0, credit: 0, transfer: 0 };
    month.debit += entry.debit;
    month.credit += entry.credit;
    month.transfer += Math.min(entry.debit, entry.credit);
    byMonth.set(entry.month, month);
  }
  return { lines: lines.length, entries: entries.size, byMonth };
}

function figuresOf(rows: LedgerBalance[]): HomePeriodFigures {
  const pnl = buildProfitAndLoss(rows);
  return {
    incomeMinor: pnl.income.total + pnl.otherIncome.total,
    expenseMinor: totalExpenses(pnl),
    netMinor: pnl.netIncome,
    salesMinor: pnl.income.total,
  };
}

function sameFigures(a: HomePeriodFigures, b: HomePeriodFigures): boolean {
  return a.incomeMinor === b.incomeMinor && a.expenseMinor === b.expenseMinor && a.netMinor === b.netMinor && a.salesMinor === b.salesMinor;
}

describe("the Dashboard's figures on every company's books", () => {
  it("reads every section", () => {
    for (const c of companies) {
      const sections = ["status", "figures", "cash", "profit", "receivables", "payables", "payments", "bank", "activity", "insights", "watchlist"] as const;
      const unavailable = sections.filter((key) => c.home[key].dataState === "unavailable");
      console.log(`${c.name}: ${sections.length - unavailable.length} of ${sections.length} sections read${unavailable.length ? `; UNAVAILABLE ${unavailable.join(", ")}` : ""}`);
      expect(unavailable, c.name).toEqual([]);
    }
  });

  it("Cash on hand is the bank accounts on the balance sheet, today and at each month end", async () => {
    for (const c of companies) {
      const { figures, cash, bank } = c.home;
      if (!figures.data || !cash.data) throw new Error(`${c.name}: figures or cash unavailable`);
      const months = homeMonthRanges(c.today, HOME_MONTHS);
      const sheets = await Promise.all(months.map((month) => getLedgerBalances(c.sb, null, month.to)));
      const expected = sheets.map(bankTotal);
      let disagree = 0;
      expected.forEach((value, index) => {
        if (cash.data!.balanceMinor[index] !== value) disagree += 1;
        if (figures.data!.cash.series[index] !== value) disagree += 1;
      });
      const today = expected[expected.length - 1];
      if (figures.data.cash.valueMinor !== today) disagree += 1;
      if (bank.data && bank.data.totalBookMinor !== today) disagree += 1;
      console.log(`${c.name}: cash at ${months.length} dates, ${disagree === 0 ? "all agree" : `${disagree} DISAGREE`}`);
      expect(disagree, c.name).toBe(0);
    }
  });

  it("net income, each month and each period equal the Profit and Loss over the same dates", async () => {
    for (const c of companies) {
      const { figures, profit } = c.home;
      if (!figures.data || !profit.data) throw new Error(`${c.name}: figures or profit unavailable`);
      let checked = 0;
      let disagree = 0;

      const months = homeMonthRanges(c.today, HOME_MONTHS);
      const monthly = await Promise.all(months.map((month) => getLedgerBalances(c.sb, month.from, month.to)));
      monthly.forEach((rows, index) => {
        const expected = figuresOf(rows);
        checked += 1;
        if (
          profit.data!.incomeMinor[index] !== expected.incomeMinor ||
          profit.data!.expenseMinor[index] !== expected.expenseMinor ||
          profit.data!.salesMinor[index] !== expected.salesMinor ||
          figures.data!.netIncome.series[index] !== expected.netMinor
        ) {
          disagree += 1;
        }
      });

      const ranges = homePeriodRanges(c.today, c.fiscalStartMonth);
      for (const key of PERIODS) {
        const range = ranges[key];
        const [rows, priorRows] = await Promise.all([
          getLedgerBalances(c.sb, range.from, range.to),
          getLedgerBalances(c.sb, range.priorFrom, range.priorTo),
        ]);
        const period = profit.data.periods[key];
        checked += 1;
        // A period the service could not read is a failure here, never skipped.
        if (!period) {
          disagree += 1;
          continue;
        }
        if (!sameFigures(period, figuresOf(rows))) disagree += 1;
        if (period.expenses.reduce((sum, line) => sum + line.amountMinor, 0) !== period.expenseMinor) disagree += 1;
        const expectedPrior = hasActivity(priorRows) ? figuresOf(priorRows) : null;
        if ((period.prior === null) !== (expectedPrior === null)) disagree += 1;
        else if (period.prior && expectedPrior && !sameFigures(period.prior, expectedPrior)) disagree += 1;
        if (key === "month") {
          if (figures.data.netIncome.valueMinor !== period.netMinor) disagree += 1;
          if (figures.data.netIncome.priorSameDaysMinor !== (expectedPrior?.netMinor ?? null)) disagree += 1;
        }
      }
      console.log(`${c.name}: ${checked} months and periods, ${disagree === 0 ? "all agree" : `${disagree} DISAGREE`}`);
      expect(disagree, c.name).toBe(0);
    }
  });

  it("Owed to you and You owe equal the aging reports, and their parts add back", async () => {
    const sideDisagreements = (side: HomeOpenSide, report: AgingReport): number => {
      let disagree = 0;
      if (side.totalMinor !== report.total) disagree += 1;
      if (side.overdueMinor + side.dueSoonMinor + side.laterMinor + side.creditsMinor !== side.totalMinor) disagree += 1;
      for (const [bucket, amount] of Object.entries(side.buckets)) {
        if ((report.buckets[bucket] ?? 0) !== amount) disagree += 1;
      }
      return disagree;
    };
    for (const c of companies) {
      const { figures, receivables, payables } = c.home;
      if (!figures.data || !receivables.data || !payables.data) throw new Error(`${c.name}: figures or open items unavailable`);
      const [ar, ap] = await Promise.all([
        getArAging(c.sb, c.today, { reconcileAsOf: c.today }),
        getApAging(c.sb, c.today, { reconcileAsOf: c.today }),
      ]);
      let disagree = sideDisagreements(receivables.data, ar) + sideDisagreements(payables.data, ap);
      if (figures.data.receivables.valueMinor !== ar.total) disagree += 1;
      if (figures.data.payables.valueMinor !== ap.total) disagree += 1;
      if (figures.data.receivables.overdueMinor !== receivables.data.overdueMinor) disagree += 1;
      if (figures.data.payables.overdueMinor !== payables.data.overdueMinor) disagree += 1;
      // What the ledger shows beside each figure is the control account the aging report reconciles to.
      if (figures.data.receivables.ledgerMinor !== ar.controlBalanceMinor || receivables.data.ledgerMinor !== ar.controlBalanceMinor) disagree += 1;
      if (figures.data.payables.ledgerMinor !== ap.controlBalanceMinor || payables.data.ledgerMinor !== ap.controlBalanceMinor) disagree += 1;
      const tied = `A/R ${ar.reconciled ? "ties" : "does not tie"} to its control account, A/P ${ap.reconciled ? "ties" : "does not tie"}`;
      console.log(`${c.name}: ${ar.rows.length} A/R and ${ap.rows.length} A/P rows, ${disagree === 0 ? "all agree" : `${disagree} DISAGREE`}; ${tied}`);
      expect(disagree, c.name).toBe(0);
    }
  });

  it("the Bank accounts rows add up to Cash on hand", () => {
    for (const c of companies) {
      const bank = c.home.bank.data;
      if (!bank) throw new Error(`${c.name}: bank accounts unavailable`);
      const listed = bank.accounts.filter((account) => !account.isCard).reduce((sum, account) => sum + account.bookMinor, 0);
      const rows = listed + (bank.otherCash?.bookMinor ?? 0);
      const agree = rows === bank.totalBookMinor;
      console.log(
        `${c.name}: ${bank.accounts.filter((a) => !a.isCard).length} bank accounts, ${bank.accounts.filter((a) => a.isCard).length} cards, ` +
          `${bank.otherCash ? `${bank.otherCash.accounts} other cash accounts` : "no other cash"}: ${agree ? "rows add up" : "ROWS DO NOT ADD UP"}`,
      );
      expect(agree, c.name).toBe(true);
    }
  });

  it("the watchlist's Balance is the Chart of Accounts figure, and its months the ledger's natural activity", async () => {
    for (const c of companies) {
      const data = c.home.watchlist.data;
      if (!data) throw new Error(`${c.name}: watchlist unavailable`);
      // The whole previous month, then the month to date.
      const [previous, current] = homeMonthRanges(c.today, 2);
      const [thisMonth, lastMonth] = await Promise.all([
        getLedgerBalances(c.sb, current.from, current.to),
        getLedgerBalances(c.sb, previous.from, previous.to),
      ]);
      const byId = new Map(c.accounts.map((account) => [account.id, account]));
      const natural = (rows: readonly LedgerBalance[], account: AccountRow) => {
        const row = rows.find((r) => r.accountId === account.id);
        return row ? naturalBalanceMinor(row.debitBase, row.creditBase, accountNormalBalance(account.account_type, account.is_contra)) : 0;
      };
      let disagree = 0;
      if (data.rows.map((row) => row.accountId).join() !== c.watched.join()) disagree += 1;
      for (const row of data.rows) {
        const account = byId.get(row.accountId);
        if (!account) {
          disagree += 1;
          continue;
        }
        if (row.balanceMinor !== (c.chart.figures[row.accountId] ?? 0)) disagree += 1;
        if (row.thisMonthMinor !== natural(thisMonth, account)) disagree += 1;
        if (row.lastMonthMinor !== natural(lastMonth, account)) disagree += 1;
      }
      console.log(`${c.name}: ${data.rows.length} watched accounts, ${data.choices.length} to choose from, ${disagree === 0 ? "all agree" : `${disagree} DISAGREE`}`);
      expect(disagree, c.name).toBe(0);
    }
  });

  it("money in and money out leave out transfers between own bank accounts, and their difference is the change in cash", async () => {
    for (const c of companies) {
      const cash = c.home.cash.data;
      if (!cash) throw new Error(`${c.name}: cash flow unavailable`);
      const months = homeMonthRanges(c.today, HOME_MONTHS);
      const [opening, monthly, recount] = await Promise.all([
        getLedgerBalances(c.sb, null, addIsoDays(months[0].from, -1)),
        Promise.all(months.map((month) => getLedgerBalances(c.sb, month.from, month.to))),
        recountBankMovement(c.sb, months[0].from, c.today),
      ]);
      let flowDisagree = 0;
      let recountDisagree = 0;
      let grossDisagree = 0;
      let monthsWithTransfers = 0;
      months.forEach((month, index) => {
        // (a) Money in minus money out is the month's change in cash on hand.
        const previous = index === 0 ? bankTotal(opening) : cash.balanceMinor[index - 1];
        if (cash.inMinor[index] - cash.outMinor[index] !== cash.balanceMinor[index] - previous) flowDisagree += 1;
        // (b) The gross less the recounted transfers is money in and money out.
        const counted = recount.byMonth.get(month.key) ?? { debit: 0, credit: 0, transfer: 0 };
        if (counted.transfer > 0) monthsWithTransfers += 1;
        if (counted.debit - counted.transfer !== cash.inMinor[index]) recountDisagree += 1;
        if (counted.credit - counted.transfer !== cash.outMinor[index]) recountDisagree += 1;
        // The lines recounted are all of the ledger's bank debits and credits that month.
        const bank = monthly[index].filter((row) => row.accountType === "bank");
        if (bank.reduce((sum, row) => sum + row.debitBase, 0) !== counted.debit) grossDisagree += 1;
        if (bank.reduce((sum, row) => sum + row.creditBase, 0) !== counted.credit) grossDisagree += 1;
      });
      const disagree = flowDisagree + recountDisagree + grossDisagree;
      console.log(
        `${c.name}: ${months.length} months, ${recount.lines} bank lines in ${recount.entries} entries, ${monthsWithTransfers} months with transfers, ` +
          `transfers ${cash.transfersExcluded ? "left out" : "NOT LEFT OUT"}: ` +
          (disagree === 0 ? "all agree" : `${flowDisagree} flow, ${recountDisagree} recount, ${grossDisagree} gross DISAGREE`),
      );
      expect(cash.transfersExcluded, c.name).toBe(true);
      expect(disagree, c.name).toBe(0);
    }
  });
});
