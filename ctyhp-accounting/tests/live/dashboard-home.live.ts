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
 *  (e) the Bank accounts rows add up to Cash on hand.
 * Counts and agree/disagree are logged; names and amounts never are.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/dashboard-home.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { totalExpenses } from "@/lib/domain/dashboard-home/expenses";
import { homeMonthRanges, homePeriodRanges } from "@/lib/domain/dashboard-home/ranges";
import { hasActivity } from "@/lib/domain/dashboard-home/series";
import type { HomeOpenSide, HomePeriodFigures, HomePeriodKey } from "@/lib/domain/dashboard-home/types";
import { buildProfitAndLoss, type LedgerBalance } from "@/lib/domain/reports";
import { getApAging, getArAging, type AgingReport } from "@/lib/services/aging";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { getDashboardHome, HOME_MONTHS, type DashboardHome } from "@/lib/services/dashboard-home";
import { listCurrencies } from "@/lib/services/reference";
import { getLedgerBalances } from "@/lib/services/reports";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
  fiscalStartMonth: number;
  home: DashboardHome;
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
    const home = await getDashboardHome(sb, {
      asOf: today,
      fiscalStartMonth,
      baseCurrency: { code: base?.code ?? "USD", decimals: base?.decimal_places ?? 2 },
      watchlist: [],
    });
    companies.push({ name: row.schema_name, sb, today, fiscalStartMonth, home });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

function bankTotal(rows: readonly LedgerBalance[]): number {
  return rows.filter((row) => row.accountType === "bank").reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
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
      const sections = ["status", "figures", "cash", "profit", "receivables", "payables", "payments", "bank", "activity", "insights"] as const;
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
});
