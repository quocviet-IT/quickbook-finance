/**
 * 2.59: every permission in the matrix decides (migration 0169).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives.
 *
 *  1. The nine permissions that were display-only now decide. For each, an
 *     accountant without it is refused, and with it the same call goes
 *     through: issuing and voiding an invoice, posting and voiding a bill,
 *     reversing a journal, completing a reconciliation (and bringing history
 *     forward), approving a purchase order, and billing one beyond its
 *     tolerance. Closing a period is no longer an accountant's by default, and
 *     works once an admin grants it.
 *  2. The settings saves follow settings.manage, as their cards do: an
 *     accountant given it may save them, and an admin without it may not.
 *  3. The new company's privileges: every table readable, each write granted
 *     exactly where a policy allows it, no TRUNCATE; every permission enforced.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/permissions-enforced.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { createBankAccount } from "@/lib/services/banking";
import { createReconciliation } from "@/lib/services/bankrec";
import { provisionCompany } from "@/lib/services/company-provisioning";
import { createDraftInvoice } from "@/lib/services/invoicing";
import { createManualJournal } from "@/lib/services/journal";
import { createDraftBill } from "@/lib/services/payables";
import { receivePurchaseOrder, savePurchaseOrder, setPurchasingConfig } from "@/lib/services/purchasing";

describe("the permission matrix", () => {
  it("decides every action it lists, and a new company's privileges follow its policies", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("permissions-enforced: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        const r = await client.query(sql, params);
        await client.query("release savepoint attempt");
        return { error: null as string | null, rows: r.rows as Record<string, unknown>[] };
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return { error: (err as Error).message, rows: [] as Record<string, unknown>[] };
      }
    };
    const as = async (userId: string) => {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    };
    /** The matrix, changed as its owner: the screens' own path is acc_set_role_permission. */
    const grant = async (role: "admin" | "accountant", key: string, allowed: boolean) => {
      await client.query("reset role");
      await client.query("update acc_role_permission set allowed = $3 where role = $1 and permission_key = $2", [role, key, allowed]);
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      const [accountant] = await q<{ id: string }>("select id from auth.users where id <> $1 and email is not null order by created_at limit 1", [admin.id]);
      const { schema } = await provisionCompany(
        client,
        { slug: `perms_${randomBytes(4).toString("hex")}`, legalName: "Permission check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);

      // 3. The new company's privileges and matrix, before anything runs in it.
      const [grants] = await q<{ unreadable: number; wrong: number; truncate: number }>(
        `select count(distinct t.tablename) filter (where not has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'SELECT'))::int as unreadable,
                count(*) filter (where has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), w.cmd)
                                   <> exists (select 1 from pg_policies p
                                               where p.schemaname = t.schemaname and p.tablename = t.tablename
                                                 and p.cmd in (w.cmd, 'ALL')))::int as wrong,
                count(distinct t.tablename) filter (where has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'TRUNCATE'))::int as truncate
           from pg_tables t
          cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(cmd)
          where t.schemaname = $1 and left(t.tablename, 4) = 'acc_'`,
        [schema],
      );
      expect(grants).toEqual({ unreadable: 0, wrong: 0, truncate: 0 });
      const writable = await q<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = $1
            and (has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'INSERT')
              or has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'UPDATE')
              or has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'DELETE'))
          order by 1`,
        [schema],
      );
      // The tables the screens still write directly, and the two the app files into.
      expect(writable.map((r) => r.tablename).sort()).toEqual(
        [
          "acc_account", "acc_bank_account", "acc_bank_rule", "acc_banking_preference", "acc_customer",
          "acc_document_attachment", "acc_feedback_attachment", "acc_feedback_report", "acc_item",
          "acc_recurring_template", "acc_related_company", "acc_repayment_account", "acc_tax_code", "acc_vendor",
        ].sort(),
      );
      expect((await q<{ n: number }>("select count(*)::int as n from acc_permission where not is_enforced"))[0].n).toBe(0);
      expect((await q<{ allowed: boolean }>("select allowed from acc_role_permission where role = 'accountant' and permission_key = 'period.close'"))[0].allowed).toBe(false);

      // The accountant, and what the flows below need.
      await client.query("insert into acc_app_user (id, full_name, role, status) values ($1, 'Example Accountant', 'accountant', 'active')", [accountant.id]);
      const one = async (sql: string) => (await q<{ id: string }>(sql))[0].id;
      const income = await one("select id from acc_account where account_type = 'income' and status = 'active' and is_posting_account order by account_code limit 1");
      const expense = await one("select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account order by account_code limit 1");
      const cash = await one("select id from acc_account where account_type = 'bank' and detail_type = 'checking' and status = 'active' and is_posting_account order by account_code limit 1");
      const [checkingGl] = await q<{ id: string }>("insert into acc_account (account_code, name, account_type, detail_type) values ('1099', 'Example Checking', 'bank', 'checking') returning id");
      const customer = await one("insert into acc_customer (name) values ('Example Customer') returning id");
      const vendor = await one("insert into acc_vendor (name) values ('Example Supplier') returning id");

      await as(admin.id);
      const sb = pgSupabase(client);
      expect((await attempt("select acc_generate_periods(2026)")).error).toBeNull();
      const invoice = await createDraftInvoice(sb, {
        customer_id: customer, currency_code: "USD", issue_date: "2026-09-02", due_date: null, memo: null,
        lines: [{ description: "Service", quantity: 1, unit_price_minor: 10000, income_account_id: income, tax_code_id: null, item_id: null }],
      });
      const bill = await createDraftBill(sb, {
        vendor_id: vendor, vendor_ref: "V-1", currency_code: "USD", bill_date: "2026-09-04", due_date: null, memo: null,
        lines: [{ description: "Supplies", expense_account_id: expense, amount_minor: 20000, item_id: null }],
      });
      const journal = await createManualJournal(sb, {
        entry_date: "2026-09-05", description: "Example accrual", source_ref: null, currency_code: "USD",
        lines: [
          { account_id: expense, debit_minor: 5000, credit_minor: 0 },
          { account_id: cash, debit_minor: 0, credit_minor: 5000 },
        ],
      });
      const bank = await createBankAccount(sb, { account_id: checkingGl.id, bank_name: "Example Bank", currency_code: "USD", detail_type: "checking" });
      // Nothing has moved through the account, so a zero statement leaves no difference.
      const reconciliation = await createReconciliation(sb, { bank_account_id: bank.id, statement_ending_date: "2026-09-30", statement_ending_balance_minor: 0 });
      await setPurchasingConfig(sb, { price_tolerance_bps: 0, qty_tolerance_bps: 0 });
      const poLines = [{ item_id: null, description: "Display trays", quantity: 4, unit_cost_minor: 2500, expense_account_id: expense }];
      const po = await savePurchaseOrder(sb, null, {
        vendor_id: vendor, order_date: "2026-09-05", expected_date: null, currency_code: "USD", ship_to: null, memo: null, lines: poLines,
      });

      /** Refused without the permission, through with it — as the accountant both times. */
      const decides = async (key: string, sql: string, params: unknown[], refusal: RegExp) => {
        await grant("accountant", key, false);
        await as(accountant.id);
        const without = await attempt(sql, params);
        expect(without.error, `${key} withheld: ${sql}`).toMatch(refusal);
        await grant("accountant", key, true);
        await as(accountant.id);
        const withIt = await attempt(sql, params);
        expect(withIt.error, `${key} granted: ${sql}`).toBeNull();
        return withIt.rows;
      };

      // 1. The nine.
      await decides("invoice.issue", "select acc_issue_invoice($1, null)", [invoice.id], /permission to issue invoices/);
      await decides("invoice.void", "select acc_void_invoice($1)", [invoice.id], /permission to void invoices/);
      await decides("bill.post", "select acc_post_bill($1)", [bill.id], /permission to post bills/);
      await decides("bill.void", "select acc_void_bill($1)", [bill.id], /permission to void bills/);
      await decides("journal.void", "select acc_reverse_entry($1, 'Entered in error', '2026-09-06')", [journal], /permission to reverse journal entries/);
      await decides("reconciliation.complete", "select acc_complete_reconciliation($1)", [reconciliation], /permission to complete reconciliations/);
      await decides("po.approve", "select acc_approve_purchase_order($1)", [po], /permission to approve purchase orders/);

      // Bringing history forward records a completed reconciliation, so it asks
      // for the same permission before anything else about the account.
      await grant("accountant", "reconciliation.complete", false);
      await as(accountant.id);
      expect((await attempt("select acc_bring_history_forward($1, '2026-09-30', 0, null)", [bank.id])).error).toMatch(/permission to complete reconciliations/);
      await grant("accountant", "reconciliation.complete", true);

      // Billing past a tolerance of zero: the price moved by a cent a unit.
      await as(admin.id);
      const [poLine] = await q<{ id: string }>("select id from acc_purchase_order_line where purchase_order_id = $1", [po]);
      await receivePurchaseOrder(sb, po, { receipt_date: "2026-09-08", memo: null, lines: [{ purchase_order_line_id: poLine.id, quantity: 4 }] });
      const [billed] = await decides(
        "po.variance_approve",
        "select acc_create_bill_from_po($1, '2026-09-09', null, 'EX-2', null, $2::jsonb, 'Supplier raised the price') as id",
        [po, JSON.stringify([{ purchase_order_line_id: poLine.id, quantity: 4, unit_cost_minor: 2501 }])],
        /outside the purchase order's matching tolerance, and you do not have permission to approve match variances/,
      );
      expect((await q<{ n: number }>("select count(*)::int as n from acc_po_variance_exception where bill_id = $1", [billed.id]))[0].n).toBe(1);

      // Closing a period: an accountant's no longer by default, theirs once granted.
      const [january] = await q<{ id: string }>("select id from acc_accounting_period where period_start = '2026-01-01'");
      await as(accountant.id);
      expect((await attempt("select acc_close_period($1, 'Month end', 'Checked')", [january.id])).error).toMatch(/permission to close a period/);
      await grant("accountant", "period.close", true);
      await as(accountant.id);
      expect((await attempt("select acc_close_period($1, 'Month end', 'Checked')", [january.id])).error).toBeNull();
      expect((await q<{ status: string }>("select status::text from acc_accounting_period where id = $1", [january.id]))[0].status).toBe("closed");

      // 2. Settings follow settings.manage, which an accountant does not hold by default.
      const SETTINGS = [
        ["select acc_set_purchasing_config(200, 0)", /permission to change purchasing tolerances/],
        ["select acc_save_work_policy(null, null, null, null, 'Example')", /permission to change the work policy/],
        ["select acc_generate_periods(2027)", /permission to set up accounting periods/],
        [
          `select acc_save_company_settings(s.legal_name, s.dba_name, s.ein_ref, s.address_line1, s.address_line2, s.city,
                  s.region, s.postal_code, s.country, s.fiscal_year_start_month, s.base_currency_code, s.time_zone,
                  s.accounting_basis::text, s.default_payment_terms_days, s.inventory_valuation_method::text,
                  s.inventory_policy_memo)
             from acc_company_setting_version s order by s.version desc limit 1`,
          /permission to change company settings/,
        ],
      ] as const;
      await as(accountant.id);
      for (const [sql, refusal] of SETTINGS) expect((await attempt(sql)).error, sql).toMatch(refusal);
      await grant("accountant", "settings.manage", true);
      await as(accountant.id);
      for (const [sql] of SETTINGS) expect((await attempt(sql)).error, sql).toBeNull();
      // And being an admin is no longer enough on its own.
      await grant("admin", "settings.manage", false);
      await as(admin.id);
      expect((await attempt("select acc_set_purchasing_config(300, 0)")).error).toMatch(/permission to change purchasing tolerances/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      clearTimeout(killer);
      await client.end();
    }
  }, 9 * 60_000);
});
