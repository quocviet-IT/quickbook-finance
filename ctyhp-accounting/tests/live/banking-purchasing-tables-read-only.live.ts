/**
 * 2.58: bank lines, reconciliations, purchase orders, goods receipts, sales tax
 * payments, reversal links and the posting configuration change only through
 * the functions that post them (migration 0168) — and every flow that writes
 * them still works.
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives.
 *
 *  1. No write policy is left on the seventeen tables; each keeps its read.
 *  2. The flows run through OneBook's own services: a bank account, a
 *     statement imported and a line coded, the account reconciled; a purchase
 *     order saved, approved, received and billed; a sales tax payment recorded
 *     and voided; a journal posted and reversed; the purchasing tolerances set.
 *  3. As the administrator, a direct insert into these tables is refused and
 *     a direct update reaches no row, on every table that holds rows.
 *  4. The trial balance still balances.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/banking-purchasing-tables-read-only.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import type { StatementLine } from "@/lib/domain/statement-import";
import { categoriseBankTransaction, createBankAccount, importStatement } from "@/lib/services/banking";
import { completeReconciliation, createReconciliation, getReconciliationLines, setClearedMany } from "@/lib/services/bankrec";
import { provisionCompany } from "@/lib/services/company-provisioning";
import { createManualJournal, reverseEntry } from "@/lib/services/journal";
import {
  approvePurchaseOrder,
  createBillFromPo,
  receivePurchaseOrder,
  savePurchaseOrder,
  setPurchasingConfig,
} from "@/lib/services/purchasing";
import { recordTaxPayment, voidTaxPayment } from "@/lib/services/salestax";

const TABLES = [
  "acc_bank_transaction", "acc_bank_import_batch", "acc_bank_category",
  "acc_reconciliation", "acc_reconciliation_line", "acc_statement_reconciliation",
  "acc_purchase_order", "acc_purchase_order_line", "acc_goods_receipt", "acc_goods_receipt_line",
  "acc_tax_payment", "acc_journal_reversal_link",
  "acc_currency", "acc_exchange_rate", "acc_purchasing_config", "acc_afda_rate", "acc_1099_box",
];

const line = (txn_date: string, amount_minor: number, description: string): StatementLine => ({
  txn_date,
  description,
  reference: null,
  amount_minor,
  running_balance_minor: null,
  raw_line: `${txn_date},${description},${amount_minor}`,
});

describe("banking, purchasing and posting configuration tables", () => {
  it("change only through the functions that post them, and every flow still works", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("banking-purchasing-tables-read-only: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        const r = await client.query(sql, params);
        await client.query("release savepoint attempt");
        return { error: null as string | null, count: r.rowCount ?? 0 };
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return { error: (err as Error).message, count: 0 };
      }
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      const { schema } = await provisionCompany(
        client,
        { slug: `bankpo_${randomBytes(4).toString("hex")}`, legalName: "Banking and purchasing check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);

      // 1. No write policy; every table keeps its read.
      const policies = await q<{ tablename: string; cmd: string }>("select tablename, cmd from pg_policies where schemaname = $1 and tablename = any($2)", [schema, TABLES]);
      expect(policies.filter((p) => p.cmd !== "SELECT")).toEqual([]);
      expect(new Set(policies.filter((p) => p.cmd === "SELECT").map((p) => p.tablename))).toEqual(new Set(TABLES));

      const one = async (sql: string) => (await q<{ id: string }>(sql))[0].id;
      const [checkingGl] = await q<{ id: string }>("insert into acc_account (account_code, name, account_type, detail_type) values ('1099', 'Example Checking', 'bank', 'checking') returning id");
      const expense = await one("select id from acc_account where account_type = 'expense' and status = 'active' and is_posting_account order by account_code limit 1");
      const taxAccount = await one("select tax_account_id as id from acc_tax_code where direction = 'sales' and tax_account_id is not null limit 1");
      const vendor = await one("insert into acc_vendor (name) values ('Example Supplier') returning id");

      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      const sb = pgSupabase(client);

      // 2. The flows.
      const bank = await createBankAccount(sb, { account_id: checkingGl.id, bank_name: "Example Bank", currency_code: "USD", detail_type: "checking" });
      await importStatement(sb, bank.id, "september.csv", [line("2026-09-04", -12500, "EXAMPLE OFFICE SUPPLY"), line("2026-09-10", 40000, "EXAMPLE CUSTOMER DEPOSIT")], {
        opening_minor: 0,
        closing_minor: 27500,
        opening_basis: "printed",
        closing_basis: "printed",
        set_aside: 0,
        override: null,
      });
      const [charge] = await q<{ id: string }>("select id from acc_bank_transaction where bank_account_id = $1 and amount_minor < 0", [bank.id]);
      await categoriseBankTransaction(sb, charge.id, expense);
      const recId = await createReconciliation(sb, { bank_account_id: bank.id, statement_ending_date: "2026-09-30", statement_ending_balance_minor: -12500 });
      const book = await getReconciliationLines(sb, recId);
      await setClearedMany(sb, recId, book.map((l) => l.journalLineId), true);
      await completeReconciliation(sb, recId);

      await setPurchasingConfig(sb, { price_tolerance_bps: 200, qty_tolerance_bps: 0 });
      const po = await savePurchaseOrder(sb, null, {
        vendor_id: vendor, order_date: "2026-09-05", expected_date: null, currency_code: "USD", ship_to: null, memo: null,
        lines: [{ item_id: null, description: "Display trays", quantity: 4, unit_cost_minor: 2500, expense_account_id: expense }],
      });
      await approvePurchaseOrder(sb, po);
      const [poLine] = await q<{ id: string }>("select id from acc_purchase_order_line where purchase_order_id = $1", [po]);
      await receivePurchaseOrder(sb, po, { receipt_date: "2026-09-08", memo: null, lines: [{ purchase_order_line_id: poLine.id, quantity: 4 }] });
      await createBillFromPo(sb, po, {
        bill_date: "2026-09-09", due_date: null, vendor_ref: "EX-1", memo: null,
        lines: [{ purchase_order_line_id: poLine.id, quantity: 4, unit_cost_minor: 2500 }], variance_reason: null,
      });

      const taxPayment = await recordTaxPayment(sb, {
        tax_account_id: taxAccount, bank_account_id: checkingGl.id, payment_date: "2026-09-20", currency_code: "USD",
        amount_minor: 1500, period_start: "2026-07-01", period_end: "2026-09-30", memo: null,
      });
      await voidTaxPayment(sb, taxPayment);

      const journal = await createManualJournal(sb, {
        entry_date: "2026-09-12", description: "Example accrual", source_ref: null, currency_code: "USD",
        lines: [
          { account_id: expense, debit_minor: 3000, credit_minor: 0 },
          { account_id: checkingGl.id, debit_minor: 0, credit_minor: 3000 },
        ],
      });
      await reverseEntry(sb, { entry_id: journal, reason: "Entered in error", reversal_date: "2026-09-13" });

      // 3. Directly, as the administrator.
      await client.query("reset role");
      const held: Record<string, number> = {};
      const firstColumn: Record<string, string> = {};
      for (const t of TABLES) {
        held[t] = Number((await q<{ n: number }>(`select count(*)::int as n from ${t}`))[0].n);
        firstColumn[t] = (await q<{ c: string }>("select column_name as c from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position limit 1", [schema, t]))[0].c;
      }
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      const proven: string[] = [];
      for (const t of TABLES) {
        const update = await attempt(`update ${t} set ${firstColumn[t]} = ${firstColumn[t]}`);
        expect(update.count, `update ${t}`).toBe(0);
        const del = await attempt(`delete from ${t}`);
        expect(del.count, `delete ${t}`).toBe(0);
        if (held[t] > 0) proven.push(t);
      }
      for (const sql of [
        "insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor) values (gen_random_uuid(), '2026-09-30', 'Direct', 100)",
        "insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values (gen_random_uuid(), gen_random_uuid())",
        "insert into acc_journal_reversal_link (original_entry_id, reversal_entry_id) values (gen_random_uuid(), gen_random_uuid())",
        // A currency insert is refused before this by its own USD-only trigger, so it
        // proves nothing here; a goods receipt reaches the table's rules.
        "insert into acc_goods_receipt (purchase_order_id, receipt_date) values (gen_random_uuid(), '2026-09-30')",
      ]) {
        const r = await attempt(sql);
        expect(r.error, sql).toMatch(/row-level security|permission denied/);
      }
      console.log(`direct update and delete reached no row on ${proven.length} tables holding rows: ${proven.join(", ")}`);
      expect(proven).toEqual(expect.arrayContaining(["acc_bank_transaction", "acc_reconciliation_line", "acc_statement_reconciliation", "acc_purchase_order", "acc_goods_receipt", "acc_tax_payment", "acc_journal_reversal_link"]));

      // 4. The books balance.
      const [tb] = await q<{ dr: number; cr: number }>(
        "select coalesce(sum(l.debit_minor), 0)::bigint as dr, coalesce(sum(l.credit_minor), 0)::bigint as cr from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id where e.status = 'posted'",
      );
      expect(Number(tb.dr)).toBe(Number(tb.cr));
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
