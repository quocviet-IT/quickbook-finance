/**
 * The ten reports of wave 1, run against every company's books — read-only.
 *
 * For every company the smoke user belongs to, each report is built from the
 * same reads its screen makes, then held to the report it has to agree with:
 *   - Open Invoices and Customer Balances total the A/R Aging;
 *   - Unpaid Bills and Vendor Balances total the A/P Aging;
 *   - Sales by Customer totals the Profit and Loss's Income, and Expenses by
 *     Vendor its cost of sales plus expenses, for this year and for all dates;
 *   - the review reports run, and what they count matches a direct count.
 * Whether each aging agrees with its control account is printed, not asserted:
 * that is the books' own state, and the A/R Aging screen reports it the same way.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/reports-wave1.live.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { presetRange } from "@/lib/domain/report-presets";
import { getApAging, getArAging } from "@/lib/services/aging";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { postedEntryDateSpan } from "@/lib/services/exceptions";
import {
  getCustomerBalances,
  getExpensesByVendor,
  getOpenInvoices,
  getSalesByCustomer,
  getUnpaidBills,
  getVendorBalances,
} from "@/lib/services/party-reports";
import { getCloseLog, getReconciliationList, getVoidedEntries } from "@/lib/services/review-reports";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
  timeZone: string;
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
      timeZone,
      fiscalStartMonth: settings?.fiscal_year_start_month ?? 1,
      first: span.first,
      last: span.last,
    });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

describe("wave 1 reports on every company's books", () => {
  it("Open Invoices and Customer Balances total the A/R Aging", async () => {
    for (const c of companies) {
      const [open, balances, aging] = await Promise.all([
        getOpenInvoices(c.sb, c.today, c.today),
        getCustomerBalances(c.sb, c.today, c.today),
        getArAging(c.sb, c.today, { reconcileAsOf: c.today }),
      ]);
      console.log(
        `${c.name}: open invoices ${open.report.lines.length}, credits ${open.report.creditsMinor}, ` +
          `aging ${aging.total}, control ${open.control.expectedMinor} (${open.control.agrees ? "agrees" : `out by ${open.control.differenceMinor}`})`,
      );
      expect(open.report.agingTotalMinor, c.name).toBe(aging.total);
      expect(balances.report.totalMinor, c.name).toBe(aging.total);
      expect(open.control.expectedMinor, c.name).toBe(aging.controlBalanceMinor);
      expect(open.report.lines.every((line) => line.amountMinor !== null), `${c.name}: every open invoice has its amount`).toBe(true);
    }
  });

  it("Unpaid Bills and Vendor Balances total the A/P Aging", async () => {
    for (const c of companies) {
      const [open, balances, aging] = await Promise.all([
        getUnpaidBills(c.sb, c.today, c.today),
        getVendorBalances(c.sb, c.today, c.today),
        getApAging(c.sb, c.today, { reconcileAsOf: c.today }),
      ]);
      console.log(
        `${c.name}: unpaid bills ${open.report.lines.length}, aging ${aging.total}, ` +
          `control ${open.control.expectedMinor} (${open.control.agrees ? "agrees" : `out by ${open.control.differenceMinor}`})`,
      );
      expect(open.report.agingTotalMinor, c.name).toBe(aging.total);
      expect(balances.report.totalMinor, c.name).toBe(aging.total);
      expect(open.control.expectedMinor, c.name).toBe(aging.controlBalanceMinor);
      expect(open.report.lines.every((line) => line.amountMinor !== null), `${c.name}: every unpaid bill has its amount`).toBe(true);
    }
  });

  it("Sales by Customer and Expenses by Vendor tie to the Profit and Loss", async () => {
    for (const c of companies) {
      const ctx = { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last };
      for (const preset of ["year", "all"] as const) {
        const { from, to } = presetRange(preset, ctx);
        const [sales, spend] = await Promise.all([getSalesByCustomer(c.sb, from, to), getExpensesByVendor(c.sb, from, to)]);
        const named = (lines: { partyId: string | null }[]) => lines.filter((line) => line.partyId !== null).length;
        console.log(
          `${c.name} ${preset}: sales ${sales.report.totalMinor} over ${named(sales.report.lines)} customers ` +
            `(${sales.report.unattributedCount} lines with none); spend ${spend.report.totalMinor} over ` +
            `${named(spend.report.lines)} vendors (${spend.report.unattributedCount} lines with none)`,
        );
        expect(sales.proof.agrees, `${c.name} ${preset}: sales out by ${sales.proof.differenceMinor}`).toBe(true);
        expect(spend.proof.agrees, `${c.name} ${preset}: spend out by ${spend.proof.differenceMinor}`).toBe(true);
      }
    }
  });

  it("the review reports run, and count what the books hold", async () => {
    for (const c of companies) {
      const fiscalYear = Number(presetRange("year", { today: c.today, fiscalStartMonth: c.fiscalStartMonth, firstEntryDate: c.first, lastEntryDate: c.last }).from.slice(0, 4));
      const started = Date.now();
      const [recs, close, voided] = await Promise.all([
        getReconciliationList(c.sb),
        getCloseLog(c.sb, fiscalYear),
        getVoidedEntries(c.sb, { from: c.first ?? c.today, to: c.today }, c.timeZone, false),
      ]);
      const [{ count: completed }, { count: voidCount }, { count: reversalCount }] = await Promise.all([
        c.sb.from("acc_statement_reconciliation").select("id", { count: "exact", head: true }).eq("status", "completed"),
        c.sb.from("acc_journal_entry").select("id", { count: "exact", head: true }).eq("status", "void"),
        c.sb.from("acc_journal_reversal_link").select("id", { count: "exact", head: true }),
      ]);
      console.log(
        `${c.name}: reconciliations ${recs.lines.length} (${recs.outOfAgreement} out), close log ${close.lines.length} lines ` +
          `(${close.closedMonths} closed, ${close.reopenings} reopenings), voided ${voided.voided}, reversed ${voided.reversed}`,
      );
      expect(recs.lines.length, c.name).toBe(completed ?? 0);
      expect(voided.voided, c.name).toBe(voidCount ?? 0);
      console.log(`${c.name}: voided entries read in ${Date.now() - started} ms`);
      expect(voided.reversed, c.name).toBe(reversalCount ?? 0);
      expect(close.lines.length, c.name).toBeGreaterThanOrEqual(close.closedMonths);
    }
  });
});
