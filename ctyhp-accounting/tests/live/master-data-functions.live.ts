/**
 * 2.60: master data is saved through functions (migration 0170), and the
 * matrix knows who can use each permission.
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives.
 *
 *  1. Every master-data save the screens make goes through OneBook's own
 *     services, now calling the new functions: accounts (create, edit,
 *     deactivate, classify), a bank account, bank rules, the banking
 *     preference, customers, vendors, products, tax codes, a recurring
 *     schedule paused and resumed, related companies, cards and loans.
 *  2. Each function saves only its screen's columns: an account's code and a
 *     customer's currency are fixed once set, and no system column is writable.
 *  3. Each asks for what the table's write rule asked for: staff, items.manage,
 *     recurring.manage, or an admin for tax codes.
 *  4. acc_permission.min_role matches the role check every function using the
 *     permission makes, and the matrix refuses a grant below it.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/master-data-functions.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import type { RecurringTemplateCreateInput } from "@/lib/domain/recurring";
import { classifyAccounts } from "@/lib/services/account-classification";
import { createAccount, setAccountStatus, updateAccount } from "@/lib/services/accounts";
import { createBankAccount } from "@/lib/services/banking";
import { saveBankingPreference } from "@/lib/services/banking-preference";
import { deleteBankRule, saveBankRule } from "@/lib/services/coding";
import { provisionCompany } from "@/lib/services/company-provisioning";
import { createCustomer, updateCustomer } from "@/lib/services/invoicing";
import { createItem, setItemActive, updateItem } from "@/lib/services/items";
import { createVendor } from "@/lib/services/payables";
import { createRecurringTemplate, setRecurringTemplateStatus } from "@/lib/services/recurring";
import { deleteRelatedCompany, saveRelatedCompany } from "@/lib/services/related-companies";
import { deleteRepayment, saveRepayment } from "@/lib/services/repayments";
import { createTaxCode, setTaxCodeActive, updateTaxCode } from "@/lib/services/salestax";

describe("master data", () => {
  it("is saved through functions that keep to each screen's columns and its rule", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("master-data-functions: hard timeout");
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
    /** A service call that must fail, inside its own savepoint so the transaction lives on. */
    const refuses = async (run: () => Promise<unknown>, pattern: RegExp) => {
      await client.query("savepoint refused");
      await expect(run()).rejects.toThrow(pattern);
      await client.query("rollback to savepoint refused");
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      const others = await q<{ id: string }>("select id from auth.users where id <> $1 and email is not null order by created_at limit 3", [admin.id]);
      const [accountant, viewer, sales] = others.map((o) => o.id);
      const { schema } = await provisionCompany(
        client,
        { slug: `master_${randomBytes(4).toString("hex")}`, legalName: "Master data check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      for (const [id, role] of [[accountant, "accountant"], [viewer, "viewer"], [sales, "sales"]]) {
        await client.query("insert into acc_app_user (id, full_name, role, status) values ($1, $2, $3, 'active')", [id, `Example ${role}`, role]);
      }
      const one = async (sql: string) => (await q<{ id: string }>(sql))[0].id;
      const expense = await one("select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account order by account_code limit 1");
      const income = await one("select id from acc_account where account_type = 'income' and status = 'active' and is_posting_account order by account_code limit 1");
      const liability = await one("select id from acc_account where account_type = 'current_liability' and status = 'active' and is_posting_account order by account_code limit 1");
      const cardAccount = await one("insert into acc_account (account_code, name, account_type) values ('2190', 'Example Card', 'credit_card') returning id");

      // 1. Every screen's save, as the administrator, through the services.
      await as(admin.id);
      const sb = pgSupabase(client);
      const bankGl = await createAccount(sb, { account_code: "1099", name: "Example Checking", account_type: "bank", cash_flow_role: "cash", is_contra: false, is_clearing: false, currency_code: "USD", is_posting_account: true, status: "active" });
      expect(bankGl.account_code).toBe("1099");
      const renamed = await updateAccount(sb, bankGl.id, { name: "Example Operating Checking" });
      expect(renamed.name).toBe("Example Operating Checking");
      expect(renamed.account_code).toBe("1099");
      await refuses(
        () => createAccount(sb, { account_code: "1099", name: "Twice", account_type: "bank", cash_flow_role: "cash", is_contra: false, is_clearing: false, currency_code: "USD", is_posting_account: true, status: "active" }),
        /already exists/,
      );
      const spare = await createAccount(sb, { account_code: "6990", name: "Example Spare", account_type: "expense", cash_flow_role: "operating", is_contra: false, is_clearing: false, currency_code: "USD", is_posting_account: true, status: "active" });
      expect((await setAccountStatus(sb, spare.id, "inactive")).status).toBe("inactive");
      await client.query("reset role");
      await client.query("update acc_account set cash_flow_role = 'unclassified' where id = $1", [spare.id]);
      await as(admin.id);
      await classifyAccounts(sb);
      expect((await q<{ cash_flow_role: string }>("select cash_flow_role from acc_account where id = $1", [spare.id]))[0].cash_flow_role).not.toBe("unclassified");

      const bank = await createBankAccount(sb, { account_id: bankGl.id, bank_name: "Example Bank", currency_code: "USD", detail_type: "checking" });
      expect((await q<{ detail_type: string }>("select detail_type from acc_account where id = $1", [bankGl.id]))[0].detail_type).toBe("checking");
      const ruleA = await saveBankRule(sb, null, { matchKind: "words", matchText: "EXAMPLE OFFICE", direction: "out", minMinor: null, maxMinor: null, accountId: expense, isActive: true });
      const ruleB = await saveBankRule(sb, null, { matchKind: "words", matchText: "EXAMPLE FEE", direction: "out", minMinor: null, maxMinor: null, accountId: expense, isActive: true });
      const positions = await q<{ id: string; position: number }>("select id, position from acc_bank_rule order by position");
      expect(positions.map((r) => r.id)).toEqual([ruleA, ruleB]);
      await saveBankRule(sb, ruleA, { matchKind: "words", matchText: "EXAMPLE OFFICE SUPPLY", direction: "out", minMinor: null, maxMinor: null, accountId: expense, isActive: false });
      expect((await q<{ match_text: string; is_active: boolean }>("select match_text, is_active from acc_bank_rule where id = $1", [ruleA]))[0]).toEqual({ match_text: "EXAMPLE OFFICE SUPPLY", is_active: false });
      await deleteBankRule(sb, ruleB);
      await saveBankingPreference(sb, { fundingAccountId: null, pairWindowDays: 7 });
      await saveBankingPreference(sb, { fundingAccountId: null, pairWindowDays: 3 });
      expect((await q<{ pair_window_days: number }>("select pair_window_days from acc_banking_preference"))[0].pair_window_days).toBe(3);

      const customer = await createCustomer(sb, { name: "Example Customer", currency_code: "USD", email: "", credit_limit_minor: 500000 } as Parameters<typeof createCustomer>[1]);
      expect(customer.credit_limit_minor).toBe(500000);
      const moved = await updateCustomer(sb, { id: customer.id, name: "Example Customer", city: "Cambridge", credit_hold: true } as Parameters<typeof updateCustomer>[1]);
      expect(moved.city).toBe("Cambridge");
      expect(moved.credit_hold).toBe(true);
      const vendor = await createVendor(sb, { name: "Example Supplier", currency_code: "USD" } as Parameters<typeof createVendor>[1]);
      expect(vendor.name).toBe("Example Supplier");
      const item = await createItem(sb, { name: "Example Service", description: "", is_sold: true, sales_price_minor: 1500, income_account_id: income, is_purchased: false, purchase_cost_minor: 0, is_inventory: false } as Parameters<typeof createItem>[1]);
      expect((await updateItem(sb, item.id, { name: "Example Service Plus", description: "", is_sold: true, sales_price_minor: 1800, income_account_id: income, is_purchased: false, purchase_cost_minor: 0, is_inventory: false } as Parameters<typeof updateItem>[2])).sales_price_minor).toBe(1800);
      await setItemActive(sb, item.id, false);
      const taxAccount = await one("select tax_account_id as id from acc_tax_code where tax_account_id is not null limit 1");
      const tax = await createTaxCode(sb, { code: "EX-1", name: "Example tax", rate_percent: 6.25, direction: "sales", tax_account_id: taxAccount, is_active: true, state_code: null } as Parameters<typeof createTaxCode>[1]);
      expect(Number((await updateTaxCode(sb, tax.id, { code: "EX-1", name: "Example tax", rate_percent: 6.5, direction: "sales", tax_account_id: taxAccount, is_active: true, state_code: null } as Parameters<typeof updateTaxCode>[2])).rate_percent)).toBe(6.5);
      await setTaxCodeActive(sb, tax.id, false);

      const schedule = await createRecurringTemplate(sb, {
        name: "Example accrual", frequency: "monthly", interval_count: 1, start_date: "2026-11-01", end_date: null, document_type: "journal",
        payload: { description: "Example accrual", source_ref: null, lines: [{ account_id: expense, debit_minor: 2500, credit_minor: 0 }, { account_id: liability, debit_minor: 0, credit_minor: 2500 }] },
      } as unknown as RecurringTemplateCreateInput);
      const [stamped] = await q<{ created_by: string; total_minor: number }>("select created_by, total_minor::int as total_minor from acc_recurring_template where id = $1", [schedule.id]);
      expect(stamped).toEqual({ created_by: admin.id, total_minor: 2500 });
      await setRecurringTemplateStatus(sb, schedule.id, "paused");
      await setRecurringTemplateStatus(sb, schedule.id, "active");
      await client.query("reset role");
      await client.query("update acc_recurring_template set status = 'ended' where id = $1", [schedule.id]);
      await as(admin.id);
      await refuses(() => setRecurringTemplateStatus(sb, schedule.id, "active"), /ended schedule cannot be resumed/);

      const related = await saveRelatedCompany(sb, null, { name: "Example Affiliate", accountId: liability, matchWords: "example affiliate", isActive: true });
      await saveRelatedCompany(sb, related, { name: "Example Affiliate LLC", accountId: liability, matchWords: "example affiliate", isActive: true });
      await refuses(
        () => saveRelatedCompany(sb, "00000000-0000-0000-0000-000000000000", { name: "Gone", accountId: liability, matchWords: "gone co", isActive: true }),
        /no longer in the list/,
      );
      await deleteRelatedCompany(sb, related);
      const card = await saveRepayment(sb, null, { kind: "card", accountId: cardAccount, matchWords: "example card", matchDigits: "1183", interestAccountId: null, interestMethod: null, annualRate: null, fixedInterestMinor: null, isActive: true });
      await refuses(
        () => saveRepayment(sb, null, { kind: "card", accountId: cardAccount, matchWords: "example card", matchDigits: null, interestAccountId: null, interestMethod: null, annualRate: null, fixedInterestMinor: null, isActive: true }),
        /already in Cards and loans/,
      );
      await deleteRepayment(sb, card);
      // The audit trigger saw it all, under the person who did it.
      expect((await q<{ n: number }>("select count(distinct table_name)::int as n from acc_audit_log where actor_id = $1 and table_name = any($2)", [admin.id,
        ["acc_account", "acc_bank_account", "acc_bank_rule", "acc_customer", "acc_vendor", "acc_item", "acc_tax_code", "acc_recurring_template", "acc_related_company", "acc_repayment_account"]]))[0].n).toBe(10);

      // 2. Only each screen's columns.
      for (const [sql, params] of [
        ["select acc_save_customer($1, '{\"currency_code\": \"CAD\"}'::jsonb)", [customer.id]],
        ["select acc_save_account($1, '{\"account_code\": \"1098\"}'::jsonb)", [bankGl.id]],
        ["select acc_save_item(null, '{\"name\": \"X\", \"id\": \"00000000-0000-0000-0000-000000000001\"}'::jsonb)", []],
        ["select acc_save_vendor('{\"name\": \"X\", \"created_at\": \"2020-01-01\"}'::jsonb)", []],
        ["select acc_save_vendor('{\"name\": \"X\", \"discount_percent\": 5}'::jsonb)", []],
        ["select acc_save_bank_rule($1, '{\"position\": 99}'::jsonb)", [ruleA]],
        ["select acc_save_tax_code($1, '{\"id\": \"00000000-0000-0000-0000-000000000001\"}'::jsonb)", [tax.id]],
      ] as [string, unknown[]][]) {
        expect((await attempt(sql, params)).error, sql).toMatch(/cannot be saved here/);
      }
      // The recurring status and run history are not a save's to set.
      expect((await attempt("select acc_save_recurring_template('{\"name\": \"X\", \"status\": \"active\"}'::jsonb)")).error).toMatch(/cannot be saved here: status/);
      // And the private writer is not the API's to call.
      expect((await attempt("select acc_write_master('acc_customer', null, '{\"name\": \"X\"}'::jsonb, array['name'])")).error).toMatch(/permission denied/);

      // 3. The rule each table had.
      await as(viewer);
      for (const sql of [
        "select acc_save_customer(null, '{\"name\": \"Viewer\"}'::jsonb)",
        "select acc_save_vendor('{\"name\": \"Viewer\"}'::jsonb)",
        "select acc_save_account(null, '{\"account_code\": \"7777\", \"name\": \"Viewer\", \"account_type\": \"expense\"}'::jsonb)",
        "select acc_save_banking_preference(null, 7)",
        "select acc_save_item(null, '{\"name\": \"Viewer\"}'::jsonb)",
      ]) {
        expect((await attempt(sql)).error, sql).toMatch(/Not authorized|do not have permission/);
      }
      await as(sales);
      // Products and services follow items.manage, which a sales user holds.
      expect((await attempt("select acc_save_item(null, '{\"name\": \"Sales item\", \"description\": \"\"}'::jsonb)")).error).toBeNull();
      await as(accountant);
      expect((await attempt("select acc_save_customer(null, '{\"name\": \"Accountant customer\"}'::jsonb)")).error).toBeNull();
      expect((await attempt("select acc_save_tax_code($1, '{\"name\": \"Changed\"}'::jsonb)", [tax.id])).error).toMatch(/Only an admin can change tax codes/);
      expect((await attempt("select acc_set_recurring_template_status($1, 'paused')", [schedule.id])).error).toMatch(/ended schedule cannot be resumed/);

      // 4. Who can use each permission, read from the functions themselves.
      await client.query("reset role");
      const functions = await q<{ prosrc: string }>(
        "select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.prokind = 'f'",
        [schema],
      );
      const derived = new Map<string, "any" | "staff" | "admin">();
      const rank = { any: 0, staff: 1, admin: 2 } as const;
      for (const f of functions) {
        const floor = /acc_is_admin\(\)/.test(f.prosrc) ? "admin" : /acc_is_staff\(\)/.test(f.prosrc) ? "staff" : "any";
        for (const m of f.prosrc.matchAll(/acc_has_permission\('([a-z_.0-9]+)'\)/g)) {
          const seen = derived.get(m[1]);
          // The least floor wins: one function that any role may use is enough.
          derived.set(m[1], seen === undefined || rank[floor] < rank[seen] ? floor : seen);
        }
      }
      const stored = await q<{ key: string; min_role: string }>("select key, min_role from acc_permission order by key");
      for (const p of stored) {
        // A permission no function checks is used by a table rule, which asks for no role.
        expect(p.min_role, p.key).toBe(derived.get(p.key) ?? "any");
      }
      expect((await q<{ n: number }>(
        "select count(*)::int as n from acc_role_permission rp join acc_permission p on p.key = rp.permission_key where rp.allowed and not acc_role_meets(rp.role, p.min_role)",
      ))[0].n).toBe(0);
      await as(admin.id);
      expect((await attempt("select acc_set_role_permission('viewer', 'bill.post', true)")).error).toMatch(/Post bills works only for admins and accountants/);
      expect((await attempt("select acc_set_role_permission('accountant', 'period.reopen', true)")).error).toMatch(/works only for admins, so it cannot be given to the accountant role/);
      expect((await attempt("select acc_set_role_permission('accountant', 'period.close', true)")).error).toBeNull();
      expect((await attempt("select acc_set_role_permission('viewer', 'audit.read', false)")).error).toBeNull();
      expect((await attempt("select acc_set_role_permission('viewer', 'bill.post', false)")).error).toBeNull();
      void bank;
    } finally {
      await client.query("rollback").catch(() => undefined);
      clearTimeout(killer);
      await client.end();
    }
  }, 9 * 60_000);
});
