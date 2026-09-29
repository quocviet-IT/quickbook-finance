/**
 * The five statements, checked against the books they are drawn from — read-only.
 *
 * For every company the smoke user belongs to, over three periods and every
 * Compare option, each statement is built from the same reads the screen makes
 * and held to the builders in lib/domain/reports.ts figure by figure. Then a
 * sample of figures is opened as a QuickZoom, and each list must add up to the
 * figure that opened it. Nothing is written: every call is a select or a
 * read-only RPC, and no server action runs, so no audit row is recorded.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts --pool=threads
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { dayBefore, fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
import { presetRange, type PeriodPreset } from "@/lib/domain/report-presets";
import {
  buildBalanceSheet,
  buildBudgetVsActual,
  buildProfitAndLoss,
  buildStatementOfEquity,
  buildTrialBalance,
  compareReportLines,
  netIncomeOf,
  sumProfitAndLoss,
  type ProfitAndLoss,
} from "@/lib/domain/reports";
import {
  balanceSheetStatement,
  budgetStatement,
  equityStatement,
  indexAccounts,
  pnlStatement,
  trialBalanceStatement,
  type AccountIndex,
  type Statement,
  type ZoomSpec,
} from "@/lib/domain/statement";
import { COMPARE_OPTIONS, fiscalYearStartOf, pointColumns, rangeColumns } from "@/lib/domain/statement-columns";
import { listAccounts } from "@/lib/services/accounts";
import { getBudgetAccountAmounts } from "@/lib/services/budgets";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
import { getLedgerBalances } from "@/lib/services/reports";
import { getZoom } from "@/lib/services/zoom";

interface Company {
  name: string;
  sb: SupabaseClient;
  accounts: AccountIndex;
  fiscalStartMonth: number;
  today: string;
  first: string | null;
  last: string | null;
}

const companies: Company[] = [];
const PRESETS: Exclude<PeriodPreset, "custom">[] = ["year", "last3", "all"];

beforeAll(async () => {
  const s = await smokeSession();
  if (!s.session) throw new Error("The smoke sign-in returned no session.");
  const auth = { persistSession: false };
  const headers = { Authorization: `Bearer ${s.session.access_token}` };
  const control = createClient(s.supabaseUrl, s.anonKey, { db: { schema: "onebook" }, auth, global: { headers } });
  const { data, error } = await control.rpc("my_companies");
  if (error) throw new Error(`my_companies: ${error.message}`);
  for (const row of (data ?? []) as { legal_name: string; schema_name: string }[]) {
    const sb = createClient(s.supabaseUrl, s.anonKey, {
      db: { schema: row.schema_name },
      auth,
      global: { headers },
    }) as unknown as SupabaseClient;
    const [accounts, settings, span] = await Promise.all([listAccounts(sb), getCurrentCompanySettings(sb), postedEntryDateSpan(sb)]);
    companies.push({
      name: row.legal_name,
      sb,
      accounts: indexAccounts(
        accounts.map((a) => ({ id: a.id, code: a.account_code, name: a.name, type: a.account_type, parentId: a.parent_account_id })),
      ),
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
      today: todayInTimeZone(settings?.time_zone ?? "America/New_York"),
      first: span.first,
      last: span.last,
    });
  }
  expect(companies.length).toBeGreaterThan(0);
});

const rangeOf = (c: Company, preset: Exclude<PeriodPreset, "custom">) =>
  presetRange(preset, { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last });
const byKey = (s: Statement, key: string) => s.rows.find((r) => r.key === key);
const accountRow = (s: Statement, accountId: string) => s.rows.find((r) => r.kind === "account" && r.accountId === accountId);
const sections = (p: ProfitAndLoss) => [p.income, p.costOfGoodsSold, p.operatingExpenses, p.otherIncome, p.otherExpenses];

function expectPnl(label: string, s: Statement, pnls: readonly ProfitAndLoss[], change: boolean) {
  pnls.forEach((p, i) => {
    expect(byKey(s, "income:total")?.cells[i].amount, `${label} income`).toBe(p.income.total);
    expect(byKey(s, "opex:total")?.cells[i].amount, `${label} opex`).toBe(p.operatingExpenses.total);
    expect(byKey(s, "net-income")?.cells[i].amount, `${label} net income`).toBe(p.netIncome);
    if (byKey(s, "gross")) expect(byKey(s, "gross")?.cells[i].amount, `${label} gross`).toBe(p.grossProfit);
    for (const section of sections(p)) {
      for (const line of section.lines) {
        expect(accountRow(s, line.accountId!)?.cells[i].amount, `${label} ${line.accountCode}`).toBe(line.amount);
      }
    }
  });
  if (change) {
    for (let k = 0; k < 5; k++) {
      for (const line of compareReportLines(sections(pnls[0])[k].lines, sections(pnls[1])[k].lines)) {
        const row = accountRow(s, line.accountId!);
        expect(row?.change?.amount, `${label} change ${line.accountCode}`).toBe(line.variance);
        expect(row?.change?.percent ?? null, `${label} change % ${line.accountCode}`).toBe(line.variancePercent);
      }
    }
  }
}

async function expectZoomsAddUp(c: Company, s: Statement, keys: string[]) {
  const specs: ZoomSpec[] = [];
  for (const key of keys) {
    const z = byKey(s, key)?.cells[0].zoom;
    if (z) specs.push(z);
  }
  for (const r of s.rows.filter((r) => r.kind === "account" && r.cells[0].zoom).slice(0, 3)) specs.push(r.cells[0].zoom!);
  for (const spec of specs) {
    const result = await getZoom(c.sb, spec);
    expect(result.total, `${c.name}: ${s.title} → ${spec.title}`).toBe(spec.figure);
  }
}

describe("the five statements agree with the books, figure for figure", () => {
  it("Profit and Loss, every period and Compare option", async () => {
    for (const c of companies) {
      for (const preset of PRESETS) {
        const range = rangeOf(c, preset);
        for (const { key: mode } of COMPARE_OPTIONS) {
          const plan = rangeColumns(mode, range.from, range.to, c.fiscalStartMonth);
          if (!plan.ok) continue;
          const detail = plan.columns.filter((col) => !col.isTotal);
          const detailPnls = (await Promise.all(detail.map((col) => getLedgerBalances(c.sb, col.from, col.to)))).map(buildProfitAndLoss);
          const pnls = plan.columns.map((col) => (col.isTotal ? sumProfitAndLoss(detailPnls) : detailPnls[detail.indexOf(col)]));
          const s = pnlStatement({ columns: plan.columns, pnls, accounts: c.accounts, showPercent: true, change: plan.change });
          expectPnl(`${c.name} ${preset} ${mode}`, s, pnls, plan.change);
        }
      }
    }
  });

  it("Balance Sheet and Trial Balance, every period and Compare option", async () => {
    for (const c of companies) {
      for (const preset of PRESETS) {
        const range = rangeOf(c, preset);
        for (const { key: mode } of COMPARE_OPTIONS) {
          const plan = pointColumns(mode, range.to, range.from, c.fiscalStartMonth);
          if (!plan.ok) continue;
          const label = `${c.name} ${preset} ${mode}`;
          const balances = await Promise.all(plan.columns.map((col) => getLedgerBalances(c.sb, null, col.to)));

          const tbs = balances.map(buildTrialBalance);
          const tb = trialBalanceStatement({ columns: plan.columns, tbs, accounts: c.accounts });
          tbs.forEach((t, i) => {
            expect(byKey(tb, "total")?.cells[2 * i].amount, `${label} TB debit`).toBe(t.totalDebit);
            expect(byKey(tb, "total")?.cells[2 * i + 1].amount, `${label} TB credit`).toBe(t.totalCredit);
            for (const line of t.lines) {
              const row = accountRow(tb, line.accountId);
              expect(row?.cells[2 * i].amount ?? 0, `${label} TB ${line.accountCode} debit`).toBe(line.debit);
              expect(row?.cells[2 * i + 1].amount ?? 0, `${label} TB ${line.accountCode} credit`).toBe(line.credit);
            }
          });

          const starts = plan.columns.map((col) => fiscalYearStartOf(col.to, c.fiscalStartMonth));
          const earlier = await Promise.all(starts.map((start) => getLedgerBalances(c.sb, null, dayBefore(start))));
          const sheets = balances.map(buildBalanceSheet);
          const bs = balanceSheetStatement({
            columns: plan.columns,
            sheets,
            priorEarnings: earlier.map(netIncomeOf),
            fiscalYearStarts: starts,
            accounts: c.accounts,
            change: plan.change,
          });
          sheets.forEach((sh, i) => {
            expect(byKey(bs, "assets:total")?.cells[i].amount, `${label} assets`).toBe(sh.totalAssets);
            expect(byKey(bs, "liabilities:total")?.cells[i].amount, `${label} liabilities`).toBe(sh.totalLiabilities);
            expect(byKey(bs, "equity:total")?.cells[i].amount, `${label} equity`).toBe(sh.totalEquity);
            expect(byKey(bs, "le:total")?.cells[i].amount, `${label} L+E`).toBe(sh.totalLiabilities + sh.totalEquity);
            for (const section of [sh.assets, sh.liabilities, sh.equity]) {
              for (const line of section.lines) {
                if (line.accountId === null) continue;
                expect(accountRow(bs, line.accountId)?.cells[i].amount, `${label} ${line.accountCode}`).toBe(line.amount);
              }
            }
            const earnings = sh.equity.lines.find((l) => l.accountId === null && l.name === "Current earnings")?.amount ?? 0;
            const retained = byKey(bs, "equity:retained")?.cells[i].amount ?? 0;
            const thisYear = byKey(bs, "equity:net-income")?.cells[i].amount ?? 0;
            expect(retained + thisYear, `${label} earnings split`).toBe(earnings);
            const groups = bs.rows.filter((r) => r.kind === "subtotal" && r.key.startsWith("assets:") && r.key.endsWith(":total"));
            expect(groups.reduce((sum, r) => sum + (r.cells[i].amount ?? 0), 0), `${label} asset groups`).toBe(sh.totalAssets);
            const liabilityGroups = bs.rows.filter(
              (r) => r.key === "liabilities:current:total" || r.key === "liabilities:long:total",
            );
            expect(
              liabilityGroups.reduce((sum, r) => sum + (r.cells[i].amount ?? 0), 0),
              `${label} liability groups`,
            ).toBe(sh.totalLiabilities);
          });
        }
      }
    }
  });

  it("Budget vs Actual and the Statement of Equity, this year", async () => {
    for (const c of companies) {
      const fy = fiscalYearForDate(c.today, c.fiscalStartMonth);
      const months = fiscalMonths(fy, c.fiscalStartMonth);
      const [actual, budget] = await Promise.all([
        getLedgerBalances(c.sb, months[0].start, months[11].end),
        getBudgetAccountAmounts(c.sb, fy, months[0].start, months[11].end),
      ]);
      const bva = buildBudgetVsActual(actual, budget);
      const b = budgetStatement({ bva, from: months[0].start, to: months[11].end, accounts: c.accounts });
      for (const line of bva.lines.filter((l) => l.current !== 0 || l.prior !== 0)) {
        const row = accountRow(b, line.accountId!);
        expect(row?.cells.map((cell) => cell.amount), `${c.name} budget ${line.accountCode}`).toEqual([line.current, line.prior]);
        expect(row?.change, `${c.name} budget variance ${line.accountCode}`).toEqual({ amount: line.variance, percent: line.variancePercent });
      }
      expect(byKey(b, "net-income")?.cells.map((cell) => cell.amount)).toEqual([bva.actual.netIncome, bva.budget.netIncome]);

      const range = rangeOf(c, "year");
      const [opening, period] = await Promise.all([
        getLedgerBalances(c.sb, null, dayBefore(range.from)),
        getLedgerBalances(c.sb, range.from, range.to),
      ]);
      const soe = buildStatementOfEquity(opening, period);
      const e = equityStatement({ soe, from: range.from, to: range.to, accounts: c.accounts });
      for (const line of soe.lines) expect(byKey(e, line.key)?.cells[0].amount, `${c.name} equity ${line.key}`).toBe(line.amount);
    }
  });

  it("a QuickZoom adds up to the figure that opened it", async () => {
    for (const c of companies) {
      const range = rangeOf(c, "year");
      const one = rangeColumns("none", range.from, range.to, c.fiscalStartMonth);
      if (!one.ok) continue;
      const pnl = pnlStatement({
        columns: one.columns,
        pnls: [buildProfitAndLoss(await getLedgerBalances(c.sb, range.from, range.to))],
        accounts: c.accounts,
        showPercent: false,
        change: false,
      });
      await expectZoomsAddUp(c, pnl, ["income:total", "opex:total", "net-income"]);

      const plan = pointColumns("none", range.to, range.from, c.fiscalStartMonth);
      if (!plan.ok) continue;
      const balances = await getLedgerBalances(c.sb, null, range.to);
      const start = fiscalYearStartOf(range.to, c.fiscalStartMonth);
      const bs = balanceSheetStatement({
        columns: plan.columns,
        sheets: [buildBalanceSheet(balances)],
        priorEarnings: [netIncomeOf(await getLedgerBalances(c.sb, null, dayBefore(start)))],
        fiscalYearStarts: [start],
        accounts: c.accounts,
        change: false,
      });
      await expectZoomsAddUp(c, bs, ["assets:total", "le:total", "equity:retained", "equity:net-income"]);
      const tb = trialBalanceStatement({ columns: plan.columns, tbs: [buildTrialBalance(balances)], accounts: c.accounts });
      await expectZoomsAddUp(c, tb, ["total"]);
    }
  });
});
