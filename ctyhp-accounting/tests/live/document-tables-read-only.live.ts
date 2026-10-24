/**
 * 2.54: the sales and purchase documents can be written only through the
 * functions that post them (migration 0165), and every one of those still works.
 *
 * On the real database, in a throwaway company built inside ONE transaction
 * that is always rolled back — nothing survives. The company is provisioned
 * from the migrations in this tree, 0165 included. OneBook's own services do
 * every step; only the session is stood in for.
 *
 *  1. No write policy is left on the 18 document tables; each keeps its read.
 *  2. Every document flow still runs, touching all 18 tables: an invoice
 *     issued, paid in part, credited, refunded and written off; another
 *     voided; a bill posted, credited and paid, the payment voided; an expense
 *     recorded and voided.
 *  3. A signed-in staff member writing the tables directly is refused: an
 *     insert errors, an update or delete changes nothing.
 *  4. The books still agree: the trial balance balances and Accounts
 *     Receivable and Payable tie to their documents.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/document-tables-read-only.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";
import {
  applyCreditMemo,
  applyVendorCredit,
  createCreditMemo,
  createVendorCredit,
  recordCustomerRefund,
  writeOff,
} from "@/lib/services/credits";
import { createDraftInvoice, issueInvoice, recordPayment, voidInvoice } from "@/lib/services/invoicing";
import { createDraftBill, payBills, postBill, recordExpense, voidBillPayment, voidExpense } from "@/lib/services/payables";

const DOCUMENT_TABLES = [
  "acc_invoice", "acc_invoice_line", "acc_payment", "acc_payment_allocation",
  "acc_bill", "acc_bill_line", "acc_bill_payment", "acc_bill_payment_allocation",
  "acc_expense", "acc_expense_line",
  "acc_credit_memo", "acc_credit_memo_line", "acc_credit_memo_allocation",
  "acc_vendor_credit", "acc_vendor_credit_line", "acc_vendor_credit_allocation",
  "acc_customer_refund", "acc_write_off",
];

describe("the document tables", () => {
  it("are written only by the functions that post them, and every flow still works", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("document-tables-read-only: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    /** A statement run in a savepoint, so a refusal leaves the transaction usable. */
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint direct");
      try {
        const r = await client.query(sql, params);
        await client.query("release savepoint direct");
        return { error: null as string | null, rows: r.rowCount ?? 0 };
      } catch (err) {
        await client.query("rollback to savepoint direct");
        return { error: err instanceof Error ? err.message : String(err), rows: 0 };
      }
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      if (!admin) throw new Error("no active administrator to sign in as");
      const { schema } = await provisionCompany(
        client,
        { slug: `docro_${randomBytes(4).toString("hex")}`, legalName: "Document tables check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);

      // 1. No write policy on any document table; every one keeps its read policy.
      const policies = await q<{ tablename: string; cmd: string }>(
        "select tablename, cmd from pg_policies where schemaname = $1 and tablename = any($2)",
        [schema, DOCUMENT_TABLES],
      );
      expect(policies.filter((p) => p.cmd !== "SELECT")).toEqual([]);
      expect(new Set(policies.filter((p) => p.cmd === "SELECT").map((p) => p.tablename))).toEqual(new Set(DOCUMENT_TABLES));

      const one = async (sql: string) => (await q<{ id: string }>(sql))[0].id;
      const income = await one("select id from acc_account where account_type = 'income' and status = 'active' and is_posting_account order by account_code limit 1");
      const expense = await one("select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account order by account_code limit 1");
      const bank = await one("select id from acc_account where account_type = 'bank' and detail_type = 'checking' and status = 'active' and is_posting_account order by account_code limit 1");
      const customer = await one("insert into acc_customer (name) values ('Example Customer') returning id");
      const vendor = await one("insert into acc_vendor (name) values ('Example Vendor') returning id");

      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      const sb = pgSupabase(client);
      const status = async (table: string, id: string) => (await q<{ status: string }>(`select status::text from ${table} where id = $1`, [id]))[0].status;

      // 2. Sales: invoice A for 100.00, paid 30.00 of a 50.00 payment, credited
      //    10.00, the 20.00 left on the payment refunded, the last 60.00 written off.
      const line = (minor: number) => [{ description: "Service", quantity: 1, unit_price_minor: minor, income_account_id: income, tax_code_id: null, item_id: null }];
      const invoiceA = await createDraftInvoice(sb, { customer_id: customer, currency_code: "USD", issue_date: "2026-09-02", due_date: null, memo: null, lines: line(10000) });
      await issueInvoice(sb, invoiceA.id);
      const payment = await recordPayment(sb, {
        customer_id: customer, currency_code: "USD", payment_date: "2026-09-05", amount_minor: 5000, deposit_account_id: bank,
        method: "check", reference: "100", memo: null, allocations: [{ invoice_id: invoiceA.id, amount_minor: 3000 }],
      });
      const memo = await createCreditMemo(sb, {
        customer_id: customer, currency_code: "USD", memo_date: "2026-09-06", reason: "Discount", memo: null,
        lines: [{ description: "Discount", quantity: 1, unit_price_minor: 1000, income_account_id: income, tax_code_id: null }],
      });
      await applyCreditMemo(sb, memo, [{ target_id: invoiceA.id, amount_minor: 1000 }]);
      await recordCustomerRefund(sb, {
        customer_id: customer, currency_code: "USD", refund_date: "2026-09-07", amount_minor: 2000, source_type: "payment",
        payment_id: payment, credit_memo_id: null, bank_account_id: bank, memo: null,
      });
      await writeOff(sb, { side: "ar", invoice_id: invoiceA.id, bill_id: null, offset_account_id: expense, amount_minor: 6000, write_off_date: "2026-09-08", reason: "Uncollectible" });
      expect(await status("acc_invoice", invoiceA.id)).toBe("paid");

      // Invoice B issued, then voided.
      const invoiceB = await createDraftInvoice(sb, { customer_id: customer, currency_code: "USD", issue_date: "2026-09-03", due_date: null, memo: null, lines: line(4000) });
      await issueInvoice(sb, invoiceB.id);
      await voidInvoice(sb, invoiceB.id);
      expect(await status("acc_invoice", invoiceB.id)).toBe("void");

      // Purchases: bill for 200.00, credited 50.00, paid 150.00; the payment voided.
      const bill = await createDraftBill(sb, {
        vendor_id: vendor, vendor_ref: "V-1", currency_code: "USD", bill_date: "2026-09-04", due_date: null, memo: null,
        lines: [{ description: "Supplies", expense_account_id: expense, amount_minor: 20000, item_id: null }],
      });
      await postBill(sb, bill.id);
      const credit = await createVendorCredit(sb, {
        vendor_id: vendor, currency_code: "USD", credit_date: "2026-09-05", vendor_ref: "VC-1", reason: "Returned", memo: null,
        lines: [{ description: "Returned", expense_account_id: expense, amount_minor: 5000 }],
      });
      await applyVendorCredit(sb, credit, [{ target_id: bill.id, amount_minor: 5000 }]);
      const billPayment = await payBills(sb, {
        vendor_id: vendor, currency_code: "USD", payment_date: "2026-09-09", amount_minor: 15000, payment_account_id: bank,
        method: "check", reference: "200", memo: null, allocations: [{ bill_id: bill.id, amount_minor: 15000 }],
      });
      expect(await status("acc_bill", bill.id)).toBe("paid");
      await voidBillPayment(sb, billPayment);
      expect(await status("acc_bill_payment", billPayment)).toBe("void");
      expect(await status("acc_bill", bill.id)).not.toBe("paid");

      // An expense recorded and voided.
      const spent = await recordExpense(sb, {
        vendor_id: vendor, payment_account_id: bank, currency_code: "USD", expense_date: "2026-09-10", memo: null,
        lines: [{ description: "Parking", expense_account_id: expense, amount_minor: 2500 }],
      });
      await voidExpense(sb, spent);
      expect(await status("acc_expense", spent)).toBe("void");

      // Every document table was written, by the functions alone.
      for (const table of DOCUMENT_TABLES) {
        const [{ n }] = await q<{ n: number }>(`select count(*)::int as n from ${table}`);
        expect(n, `${table} has rows`).toBeGreaterThan(0);
      }

      // 3. Directly, as the same signed-in administrator: an insert is refused,
      //    an update or a delete reaches no row.
      const insert = await attempt("insert into acc_invoice (customer_id, issue_date, currency_code) values ($1, '2026-09-11', 'USD')", [customer]);
      expect(insert.error).toMatch(/row-level security|permission denied/);
      const expenseInsert = await attempt("insert into acc_expense (payment_account_id, expense_date, currency_code) values ($1, '2026-09-11', 'USD')", [bank]);
      expect(expenseInsert.error).toMatch(/row-level security|permission denied/);
      for (const [sql, params] of [
        ["update acc_invoice set total_minor = 1, balance_due_minor = 0 where id = $1", [invoiceA.id]],
        ["update acc_invoice set status = 'paid' where id = $1", [invoiceB.id]],
        ["update acc_payment set amount_minor = 1 where id = $1", [payment]],
        ["delete from acc_payment_allocation where payment_id = $1", [payment]],
        ["update acc_bill set balance_due_minor = 0, status = 'paid' where id = $1", [bill.id]],
        ["delete from acc_bill_line where bill_id = $1", [bill.id]],
        ["update acc_credit_memo set total_minor = 1 where id = $1", [memo]],
        ["update acc_write_off set amount_minor = 1", []],
      ] as const) {
        const r = await attempt(sql, [...params]);
        expect(r.rows, sql).toBe(0);
      }
      const [after] = await q<{ total_minor: number; status: string }>("select total_minor, status::text from acc_invoice where id = $1", [invoiceA.id]);
      expect(Number(after.total_minor)).toBe(10000);

      // 4. The books agree.
      const [tb] = await q<{ dr: number; cr: number }>(
        `select coalesce(sum(l.debit_minor), 0)::bigint as dr, coalesce(sum(l.credit_minor), 0)::bigint as cr
           from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id where e.status = 'posted'`,
      );
      expect(Number(tb.dr)).toBe(Number(tb.cr));
      const controls = await q<{ control_key: string; subledger_minor: number; control_minor: number }>(
        "select control_key, subledger_minor, control_minor from acc_control_reconciliation('2026-09-30') where control_key in ('ar', 'ap')",
      );
      for (const c of controls) expect(Number(c.subledger_minor), c.control_key).toBe(Number(c.control_minor));
      expect(controls).toHaveLength(2);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
