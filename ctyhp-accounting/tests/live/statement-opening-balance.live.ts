/**
 * 2.81: customer and vendor statements that add up (migration 0178).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. The statements are read by OneBook's
 * own service.
 *
 * Customer: an invoice of 1,000.00 on 15 Aug, paid in full on 10 Sep; an
 * invoice of 500.00 on 12 Sep with 50.00 written off on 20 Sep; a draft of
 * 300.00 on 5 Sep. September opens at 1,000.00 (it opened at 0 before 0178, and
 * closed at -550.00), the draft is not on it, the write-off is, and it closes at
 * 450.00: August's closing is September's opening, and September's closing is
 * the AR ageing on 30 Sep.
 *
 * Vendor: a bill of 2,000.00 on 20 Aug paid on 4 Sep with 40.00 early payment
 * discount, and a draft bill. September opens at 2,000.00, and the payment and
 * the discount bring it to 0, the AP ageing on 30 Sep.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/statement-opening-balance.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { getCustomerStatement, getVendorStatement } from "@/lib/services/aging";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("a customer or vendor statement", () => {
  it("opens with what was owed before it, and closes with what was owed at its end", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("statement-opening-balance: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const one = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params))[0])[0] as string;
    const as = async (userId: string) => {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      if (!admin) throw new Error("no active administrator to sign in as");
      const { schema } = await provisionCompany(
        client,
        { slug: `stmt_${randomBytes(4).toString("hex")}`, legalName: "Statement check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      const bank = await one("insert into acc_account (account_code, name, account_type, detail_type) values ('1099', 'Example Checking', 'bank', 'checking') returning id");
      if (!(await one("select acc_active_purchase_discount_account()"))) {
        await client.query("insert into acc_account (account_code, name, account_type) values ('7010', 'Purchase Discounts', 'other_income')");
      }
      const income = await one("select id from acc_account where account_type = 'income' and status = 'active' and is_posting_account order by account_code limit 1");
      const expense = await one(
        `select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account
            and coalesce(detail_type, '') not in ('uncategorized_income', 'uncategorized_expense') order by account_code limit 1`,
      );
      await as(admin.id);
      await client.query("select acc_generate_periods(2026)");
      const sb = pgSupabase(client);

      // --- Customer -----------------------------------------------------------
      const customer = await one("select (acc_save_customer(null, $1::jsonb) ->> 'id') as id", [JSON.stringify({ name: "Example Customer", currency_code: "USD" })]);
      const line = (price: number) =>
        JSON.stringify([{ description: "Example ring", quantity: 1, unit_price_minor: price, income_account_id: income, tax_code_id: null, item_id: null }]);
      const draft = (date: string, price: number) =>
        one("select acc_create_draft_invoice($1, $2::date, null, 'USD', 'Example', $3::jsonb) as id", [customer, date, line(price)]);
      const august = await draft("2026-08-15", 100000);
      await client.query("select acc_issue_invoice($1, null)", [august]);
      await draft("2026-09-05", 30000);
      const september = await draft("2026-09-12", 50000);
      await client.query("select acc_issue_invoice($1, null)", [september]);
      await client.query("select acc_record_payment($1, '2026-09-10', 'USD', 100000, $2, 'check', 'Example payment', $3::jsonb)", [
        customer,
        bank,
        JSON.stringify([{ invoice_id: august, amount_minor: 100000 }]),
      ]);
      await client.query("select acc_write_off('ar', $1, $2, 5000, '2026-09-20', 'Example small balance')", [september, expense]);

      const aug = await getCustomerStatement(sb, customer, "2026-08-01", "2026-08-31");
      const sep = await getCustomerStatement(sb, customer, "2026-09-01", "2026-09-30");
      expect([aug.openingMinor, aug.closingMinor]).toEqual([0, 100000]);
      expect(sep.openingMinor).toBe(aug.closingMinor);
      expect(sep.rows.map((r) => [r.txnDate, r.docType, r.amountMinor])).toEqual([
        ["2026-09-10", "payment", -100000],
        ["2026-09-12", "invoice", 50000],
        ["2026-09-20", "write_off", -5000],
      ]);
      expect(sep.closingMinor).toBe(45000);
      const [{ owed }] = await q<{ owed: string }>(
        "select coalesce(sum(balance_minor), 0)::text as owed from acc_ar_ageing('2026-09-30') where customer_id = $1",
        [customer],
      );
      expect(Number(owed)).toBe(sep.closingMinor);

      // --- Vendor -------------------------------------------------------------
      const vendor = await one("select (acc_save_vendor($1::jsonb) ->> 'id') as id", [JSON.stringify({ name: "Example Vendor", currency_code: "USD" })]);
      const billLines = (amount: number) => JSON.stringify([{ description: "Example supplies", expense_account_id: expense, amount_minor: amount }]);
      const bill = await one("select acc_create_draft_bill($1, 'VB-1', '2026-08-20', '2026-09-19', 'USD', 'Example', $2::jsonb) as id", [vendor, billLines(200000)]);
      await client.query("select acc_post_bill($1)", [bill]);
      await one("select acc_create_draft_bill($1, 'VB-2', '2026-09-08', null, 'USD', 'Example draft', $2::jsonb) as id", [vendor, billLines(10000)]);
      // The vendor's terms offer 2% for paying within 16 days (set here as posting would freeze them).
      await client.query("reset role");
      await client.query("update acc_bill set discount_due_date = '2026-09-05', discount_amount_minor = 4000 where id = $1", [bill]);
      await as(admin.id);
      await client.query("select acc_pay_bills($1, '2026-09-04', 'USD', 196000, $2, 'check', 'Example pay run', $3::jsonb)", [
        vendor,
        bank,
        JSON.stringify([{ bill_id: bill, amount_minor: 196000, discount_minor: 4000 }]),
      ]);

      const vsep = await getVendorStatement(sb, vendor, "2026-09-01", "2026-09-30");
      expect(vsep.openingMinor).toBe(200000);
      expect(vsep.rows.map((r) => [r.txnDate, r.docType, r.amountMinor])).toEqual([
        ["2026-09-04", "bill_payment", -196000],
        ["2026-09-04", "discount", -4000],
      ]);
      expect(vsep.closingMinor).toBe(0);
      const [{ owing }] = await q<{ owing: string }>(
        "select coalesce(sum(balance_minor), 0)::text as owing from acc_ap_ageing('2026-09-30') where vendor_id = $1",
        [vendor],
      );
      expect(Number(owing)).toBe(vsep.closingMinor);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
