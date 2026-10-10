/**
 * The Chart of Accounts balances, checked against every company's books — read-only.
 *
 * For every company the smoke user belongs to, at the company's today:
 *  (a) each account's chart figure equals its natural ledger balance over the
 *      right range (balance sheet: all history; profit and loss: fiscal year
 *      to date), recomputed here straight from `getLedgerBalances`;
 *  (b) for each account with a non-zero figure, the QuickZoom list for the
 *      chart's drill-down adds up to that figure.
 * Counts and agree/disagree are logged; names and amounts never are.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/chart-balances.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { accountNormalBalance, statementSectionOf } from "@/lib/domain/accounts";
import { chartRange, chartZoomSpec, fiscalYearStartFor } from "@/lib/domain/chart-groups";
import { listAccounts } from "@/lib/services/accounts";
import { getChartBalances } from "@/lib/services/chart-balances";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { getLedgerBalances } from "@/lib/services/reports";
import { getZoom } from "@/lib/services/zoom";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
  fiscalStartMonth: number;
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
    const settings = await getCurrentCompanySettings(sb);
    companies.push({
      name: row.schema_name,
      sb,
      today: todayInTimeZone(settings?.time_zone ?? "UTC"),
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
    });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

describe("Chart of Accounts balances on every company's books", () => {
  it("every account's figure equals its natural ledger balance over the right range", async () => {
    for (const c of companies) {
      const [accounts, chart, sheet, pnl] = await Promise.all([
        listAccounts(c.sb),
        getChartBalances(c.sb, c.today),
        getLedgerBalances(c.sb, null, c.today),
        getLedgerBalances(c.sb, fiscalYearStartFor(c.today, c.fiscalStartMonth), c.today),
      ]);
      const sheetBy = new Map(sheet.map((b) => [b.accountId, b]));
      const pnlBy = new Map(pnl.map((b) => [b.accountId, b]));
      let disagree = 0;
      for (const a of accounts) {
        const row = (statementSectionOf(a.account_type) === "balance_sheet" ? sheetBy : pnlBy).get(a.id);
        const debit = row?.debitBase ?? 0;
        const credit = row?.creditBase ?? 0;
        const expected = accountNormalBalance(a.account_type, a.is_contra) === "debit" ? debit - credit : credit - debit;
        if (chart.figures[a.id] !== expected) disagree += 1;
      }
      console.log(`${c.name}: ${accounts.length} accounts, ${disagree === 0 ? "all figures agree" : `${disagree} DISAGREE`}`);
      expect(disagree, c.name).toBe(0);
    }
  });

  it("every non-zero figure's drill-down adds up to it", async () => {
    for (const c of companies) {
      const [accounts, chart] = await Promise.all([listAccounts(c.sb), getChartBalances(c.sb, c.today)]);
      let checked = 0;
      let disagree = 0;
      for (const a of accounts) {
        const figure = chart.figures[a.id] ?? 0;
        if (figure === 0) continue;
        const range = chartRange(statementSectionOf(a.account_type), c.today, c.fiscalStartMonth);
        const zoom = await getZoom(c.sb, chartZoomSpec(a, range, figure));
        checked += 1;
        if (!zoom.matches) disagree += 1;
      }
      console.log(`${c.name}: ${checked} drill-downs, ${disagree === 0 ? "all add up" : `${disagree} DO NOT add up`}`);
      expect(disagree, c.name).toBe(0);
    }
  });
});
