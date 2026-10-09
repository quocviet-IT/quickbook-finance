/**
 * The reports of wave 2a, run against every company's books — read-only.
 *
 * One `it` per report, so later parts add theirs beside it. For every company
 * the smoke user belongs to, each report is built from the same reads its
 * screen makes and held to the statement it has to agree with. Counts and
 * agree/disagree are logged; amounts never are.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/reports-wave2.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { presetRange } from "@/lib/domain/report-presets";
import { buildBalanceSheet, buildProfitAndLoss } from "@/lib/domain/reports";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
import { getFinancialRatios } from "@/lib/services/financial-ratios";
import { getInventoryAccounts } from "@/lib/services/inventory-accounts";
import { buildSalesTaxLiability } from "@/lib/domain/sales-tax-liability";
import { getPurchasesInventory } from "@/lib/services/purchases-inventory";
import { getSalesTaxLiabilityData } from "@/lib/services/sales-tax-liability";
import { expandRecurring } from "@/lib/domain/forecast";
import { getCashForecast, listActiveRecurringTemplates } from "@/lib/services/forecast";
import { getBudgetVsActual } from "@/lib/services/budgets";
import { fiscalMonths, fiscalYearForDate } from "@/lib/domain/fiscal";
import { getLedgerBalances } from "@/lib/services/reports";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
  fiscalStartMonth: number;
  first: string | null;
  last: string | null;
}

const companies: Company[] = [];

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
    const [settings, span] = await Promise.all([getCurrentCompanySettings(sb), postedEntryDateSpan(sb)]);
    const timeZone = settings?.time_zone ?? "UTC";
    companies.push({
      name: row.schema_name,
      sb,
      today: todayInTimeZone(timeZone),
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
      first: span.first,
      last: span.last,
    });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

describe("wave 2a reports on every company's books", () => {
  it("Financial Ratios: the workings agree with the Balance Sheet and the Profit and Loss", async () => {
    for (const c of companies) {
      const ctx = { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last };
      for (const preset of ["year", "all"] as const) {
        const { from, to } = presetRange(preset, ctx);
        const [report, inventory, balances, flow] = await Promise.all([
          getFinancialRatios(c.sb, from, to),
          getInventoryAccounts(c.sb),
          getLedgerBalances(c.sb, null, to),
          getLedgerBalances(c.sb, from, to),
        ]);
        const sheet = buildBalanceSheet(balances);
        const pnl = buildProfitAndLoss(flow);
        const w = report.current;
        const checks: [string, number, number][] = [
          ["total assets", w.totalAssetsMinor, sheet.totalAssets],
          ["total liabilities", w.totalLiabilitiesMinor, sheet.totalLiabilities],
          ["equity", w.equityMinor, sheet.totalEquity],
          ["income", w.incomeMinor, pnl.income.total],
          ["cost of goods sold", w.costOfGoodsSoldMinor, pnl.costOfGoodsSold.total],
          ["net income", w.netIncomeMinor, pnl.netIncome],
        ];
        const disagree = checks.filter(([, got, want]) => got !== want).map(([label]) => label);
        console.log(
          `${c.name} [${preset}]: ${report.rows.length} ratios, ${report.rows.filter((r) => r.current !== null).length} with a value, ` +
            `inventory accounts ${inventory.accountIds.length} (${inventory.basis}), ` +
            `year-earlier ${report.earlier ? "shown" : "blank"}, ` +
            `${disagree.length === 0 ? "workings agree with the statements" : `DISAGREE on ${disagree.join(", ")}`}`,
        );
        for (const [label, got, want] of checks) expect(got, `${c.name} ${preset}: ${label}`).toBe(want);
        expect(w.inventoryMinor, `${c.name} ${preset}: inventory within current assets`).toBeLessThanOrEqual(w.currentAssetsMinor);
        expect(report.rows).toHaveLength(15);
      }
    }
  });

  it("Purchases and Inventory: the stock adds up in every fiscal year, and the last closing is the ledger balance", async () => {
    for (const c of companies) {
      const ctx = { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last };
      const { from, to } = presetRange("all", ctx);
      const [report, inventory] = await Promise.all([getPurchasesInventory(c.sb, from, to), getInventoryAccounts(c.sb)]);
      const last = report.years.at(-1);
      let ledger: number | null = null;
      if (last) {
        const balances = await getLedgerBalances(c.sb, null, last.end);
        const ids = new Set(inventory.accountIds);
        ledger = balances.filter((b) => ids.has(b.accountId)).reduce((sum, b) => sum + (b.debitBase - b.creditBase), 0);
      }
      const supplierSum = report.supplierRows.reduce((sum, r) => sum + r.amountMinor, 0);
      console.log(
        `${c.name}: ${report.years.length} fiscal years, ${report.offByYears.length} off by, ` +
          `${report.purchases} purchase entries, ${report.suppliers} suppliers, ${report.months.length} months, ` +
          `${last ? (last.closingMinor === ledger ? "last closing agrees with the ledger" : "last closing DISAGREES with the ledger") : "no years"}, ` +
          `suppliers ${supplierSum === report.boughtMinor ? "agree" : "DISAGREE"} with the total`,
      );
      for (const y of report.years) expect(y.offByMinor, `${c.name} ${y.label}: off by`).toBe(0);
      if (last) expect(last.closingMinor, `${c.name}: last closing against the ledger`).toBe(ledger);
      expect(supplierSum, `${c.name}: suppliers add to the total`).toBe(report.boughtMinor);
    }
  });

  it("Sales Tax: the closing owed is the tax accounts' ledger balance, and gross sales is the Profit and Loss income", async () => {
    for (const c of companies) {
      const ctx = { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last };
      for (const preset of ["year", "all"] as const) {
        const { from, to } = presetRange(preset, ctx);
        const [data, flow] = await Promise.all([getSalesTaxLiabilityData(c.sb, from, to), getLedgerBalances(c.sb, from, to)]);
        const income = buildProfitAndLoss(flow).income.total;
        for (const granularity of ["monthly", "quarterly", "yearly"] as const) {
          const report = buildSalesTaxLiability(data, granularity);
          expect(report.proof.agrees, `${c.name} ${preset} ${granularity}: closing owed against the ledger`).toBe(true);
          expect(report.total.grossMinor, `${c.name} ${preset} ${granularity}: gross sales against the P&L income`).toBe(income);
        }
        const report = buildSalesTaxLiability(data, "quarterly");
        console.log(
          `${c.name} [${preset}]: tax accounts by ${data.basis}, ${data.days.length} days with activity, ${report.periods.length} quarters, ` +
            `${report.proof.agrees ? "closing owed agrees with the ledger" : "closing owed DISAGREES with the ledger"}, ` +
            `${report.total.grossMinor === income ? "gross sales agree" : "gross sales DISAGREE"} with the P&L income, ` +
            `${data.unlinked.length} unlinked tax-like accounts`,
        );
      }
    }
  });

  it("Forecast: opening cash is the bank accounts' ledger balance, there are 13 weeks, and the open items add up", async () => {
    for (const c of companies) {
      const [data, balances, templates, bank] = await Promise.all([
        getCashForecast(c.sb, { today: c.today, baseCurrency: "USD" }),
        getLedgerBalances(c.sb, null, c.today),
        listActiveRecurringTemplates(c.sb),
        c.sb.from("acc_account").select("id").eq("account_type", "bank"),
      ]);
      const bankBalance = balances
        .filter((row) => row.accountType === "bank")
        .reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
      expect(data.openingMinor, `${c.name}: opening cash against the bank accounts' ledger balance`).toBe(bankBalance);
      for (const forecast of [data.due, data.usual]) {
        expect(forecast.weeks, `${c.name} ${forecast.mode}: weeks`).toHaveLength(13);
        expect(forecast.weeks[0].start, `${c.name} ${forecast.mode}: first week starts today`).toBe(c.today);
        expect(forecast.insideInMinor + forecast.beyondHorizonInMinor, `${c.name} ${forecast.mode}: receivables inside plus beyond`).toBe(
          forecast.totalOpenInMinor,
        );
        expect(forecast.insideOutMinor + forecast.beyondHorizonOutMinor, `${c.name} ${forecast.mode}: payables inside plus beyond`).toBe(
          forecast.totalOpenOutMinor,
        );
      }
      const openIn = data.openItems.filter((i) => i.side === "receivable").reduce((s, i) => s + i.balanceMinor, 0);
      expect(openIn, `${c.name}: open receivables against the forecast`).toBe(data.due.totalOpenInMinor);

      // The recurring figures in the weeks are exactly the occurrences the templates give.
      const bankIds = new Set(((bank.data ?? []) as { id: string }[]).map((r) => r.id));
      const horizonEnd = data.due.weeks[12].end;
      const again = expandRecurring({ templates, today: c.today, horizonEnd, bankAccountIds: bankIds, baseCurrency: "USD" });
      const inWeeks = data.due.weeks.reduce((s, w) => s + w.recurringMinor, 0);
      const fromTemplates = again.occurrences.reduce((s, o) => s + o.amountMinor, 0);
      expect(inWeeks, `${c.name}: recurring in the weeks against the templates' occurrences`).toBe(fromTemplates);
      expect(data.recurring.behindCount, `${c.name}: behind-schedule count`).toBe(
        templates.filter((t) => t.nextRunDate < c.today).length,
      );

      console.log(
        `${c.name}: ${data.due.weeks.length} weeks, ${data.openItems.length} open items ` +
          `(${data.due.insideInMinor + data.due.beyondHorizonInMinor === data.due.totalOpenInMinor ? "inside plus beyond agree" : "inside plus beyond DISAGREE"} with all open receivables), ` +
          `opening cash ${data.openingMinor === bankBalance ? "agrees" : "DISAGREES"} with the bank accounts, ` +
          `${templates.length} active templates, ${data.recurring.occurrences.length} occurrences, ${data.recurring.behindCount} behind schedule, ` +
          `${inWeeks === fromTemplates ? "recurring agrees" : "recurring DISAGREES"} with the templates`,
      );
    }
  });

  it("Budget vs Actual: the actual totals are the Profit and Loss, and the months add up to the range", async () => {
    for (const c of companies) {
      const fy = fiscalYearForDate(c.today, c.fiscalStartMonth);
      const months = fiscalMonths(fy, c.fiscalStartMonth);
      // The fiscal year to date: from its first month through the end of today's month.
      const current = months.find((m) => c.today >= m.start && c.today <= m.end) ?? months[11];
      const from = months[0].start;
      const to = current.end;
      const [report, balances] = await Promise.all([
        getBudgetVsActual(c.sb, fy, from, to),
        getLedgerBalances(c.sb, from, to),
      ]);
      const pnl = buildProfitAndLoss(balances);
      const sections = ["income", "costOfGoodsSold", "operatingExpenses", "otherIncome", "otherExpenses"] as const;
      for (const key of sections) {
        expect(report.actual[key].total, `${c.name}: actual ${key} against the Profit and Loss`).toBe(pnl[key].total);
      }
      expect(report.actual.netIncome, `${c.name}: actual net income against the Profit and Loss`).toBe(pnl.netIncome);

      // The lines: every account's actual is the Profit and Loss line, and every unbudgeted line is flagged.
      const pnlById = new Map(
        sections.flatMap((key) => pnl[key].lines).map((line) => [line.accountId, line.amount] as const),
      );
      const wrongLines = report.lines.filter((line) => line.current !== (pnlById.get(line.accountId) ?? 0));
      expect(wrongLines, `${c.name}: lines whose actual differs from the Profit and Loss`).toHaveLength(0);
      const unbudgeted = report.lines.filter((line) => !line.hasBudget && line.current !== 0).length;

      const monthCount = report.monthly.length;
      if (monthCount >= 2) {
        const actualSum = report.monthly.reduce((sum, m) => sum + m.actual, 0);
        const budgetSum = report.monthly.reduce((sum, m) => sum + m.budget, 0);
        expect(monthCount, `${c.name}: one row per month`).toBe(months.indexOf(current) + 1);
        expect(actualSum, `${c.name}: monthly actual results against the range's actual result`).toBe(report.actual.netIncome);
        expect(budgetSum, `${c.name}: monthly budgeted results against the range's budgeted result`).toBe(report.budget.netIncome);
      } else {
        expect(report.monthly, `${c.name}: a single month has no month-by-month table`).toHaveLength(0);
      }

      console.log(
        `${c.name}: ${report.lines.length} lines, ${unbudgeted} with an actual and no budget, ${monthCount} months, ` +
          `sections ${wrongLines.length === 0 ? "agree" : "DISAGREE"} with the Profit and Loss, ` +
          (monthCount >= 2 ? "monthly results agree with the range" : "single month, no monthly table"),
      );
    }
  });
});
