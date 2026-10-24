/**
 * 2.53: a sales receipt posts the sale and the money at once, reads back on
 * every screen that reports sales, and is voided with a reason.
 *
 * On the real database, in a throwaway company built inside ONE transaction
 * that is always rolled back — nothing survives. The company is provisioned
 * from the migrations in this tree, 0163 and 0164 included. OneBook's own
 * services do every step; only the session is stood in for.
 *
 *  1. The deposit choices are the banks, cash and Undeposited Funds, and a new
 *     receipt starts on the first bank account.
 *  2. A receipt with a taxed service line and an inventory line posts
 *     DR bank 258.25 / CR income 250.00 / CR tax 8.25, and a separate cost of
 *     sales entry that takes the three units off the shelf.
 *  3. It reads back in the list, the printed receipt, Sales Tax, the posting
 *     check, the Sales Tax Payable tie-out, Sales by Customer, the Transaction
 *     List and the search.
 *  4. What the database refuses: a deposit to an income account, an inactive
 *     customer, a zero total, a write past the functions, a closed period.
 *  5. Voided with a reason: both entries stop counting, the goods are back,
 *     the tax is no longer collected, and it cannot be voided twice.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/sales-receipts.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { checkPosting } from "@/lib/domain/gl-posting";
import {
  buildSalesReceiptDocument,
  defaultDepositAccountId,
  depositAccountChoices,
} from "@/lib/domain/sales-receipts";
import { listAccounts } from "@/lib/services/accounts";
import { provisionCompany } from "@/lib/services/company-provisioning";
import { getSalesByCustomer } from "@/lib/services/party-reports";
import { getTransactionList } from "@/lib/services/reports";
import {
  createSalesReceipt,
  getSalesReceiptDetail,
  getSalesReceiptDocumentSource,
  listSalesReceipts,
  voidSalesReceipt,
} from "@/lib/services/sales-receipts";

interface EntryLine {
  account_id: string;
  debit_minor: number;
  credit_minor: number;
}

describe("a sales receipt", () => {
  it("posts the sale and the money, reads back everywhere, and voids with a reason", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("sales-receipts: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    /** Runs a call the database must refuse, inside a savepoint so the transaction lives on. */
    const refused = async (call: () => Promise<unknown>, words: RegExp) => {
      await client.query("savepoint refusal");
      let message = "";
      try {
        await call();
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      await client.query("rollback to savepoint refusal");
      expect(message).toMatch(words);
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      if (!admin) throw new Error("no active administrator to sign in as");
      const { schema } = await provisionCompany(
        client,
        { slug: `salesrcpt_${randomBytes(4).toString("hex")}`, legalName: "Sales receipt check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);

      // The parts a receipt is made of, written before signing in.
      const [income] = await q<{ id: string }>(
        "select id from acc_account where account_type = 'income' and status = 'active' and is_posting_account order by account_code limit 1",
      );
      const [taxAccount] = await q<{ id: string }>(
        "select tax_account_id as id from acc_tax_code where direction = 'sales' and tax_account_id is not null limit 1",
      );
      const [tax] = await q<{ id: string }>(
        "insert into acc_tax_code (code, name, rate_percent, direction, tax_account_id) values ('SR-CHECK', 'Example sales tax', 8.25, 'sales', $1) returning id",
        [taxAccount.id],
      );
      const [inventoryGl] = await q<{ id: string }>(
        "insert into acc_account (account_code, name, account_type) values ('1299', 'Example Inventory', 'current_asset') returning id",
      );
      const [cogsGl] = await q<{ id: string }>(
        "select id from acc_account where account_type = 'cost_of_goods_sold' and status = 'active' and is_posting_account order by account_code limit 1",
      );
      const [item] = await q<{ id: string }>(
        `insert into acc_item (item_code, name, is_sold, sales_price_minor, income_account_id, is_inventory, inventory_account_id, cogs_account_id)
         values ('SR-WIDGET', 'Example Widget', true, 5000, $1, true, $2, $3) returning id`,
        [income.id, inventoryGl.id, cogsGl.id],
      );
      // Ten on the shelf at 12.50 each.
      await q("select acc_add_inventory_txn($1, '2026-09-01', 'adjustment', null, 10, 12500, null, null, 'Opening stock')", [item.id]);
      const [customer] = await q<{ id: string }>("insert into acc_customer (name) values ('Example Walk-in') returning id");
      const [inactive] = await q<{ id: string }>("insert into acc_customer (name, is_active) values ('Example Former', false) returning id");
      await q(
        `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status, closed_at, close_reason)
         values (2026, 8, '2026-08-01', '2026-08-31', 'August 2026', 'closed', now(), 'Closed for the check')`,
      );

      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      const sb = pgSupabase(client);

      // 1. Where the money may go, and where a new receipt starts.
      const accounts = await listAccounts(sb);
      const choices = depositAccountChoices(accounts);
      expect(choices.length).toBeGreaterThan(1);
      for (const a of choices) expect(a.account_type === "bank" || a.detail_type === "undeposited_funds", a.account_code).toBe(true);
      expect(choices.some((a) => a.detail_type === "undeposited_funds")).toBe(true);
      const depositId = defaultDepositAccountId(choices)!;
      const deposit = choices.find((a) => a.id === depositId)!;
      expect(deposit.account_type).toBe("bank");
      expect(deposit.detail_type).not.toBe("cash_on_hand");

      // 2. Saved and posted.
      const saved = await createSalesReceipt(sb, {
        customer_id: customer.id,
        receipt_date: "2026-09-12",
        deposit_account_id: depositId,
        payment_method: "check",
        reference: "1042",
        memo: "Counter sale",
        lines: [
          { description: "Fitting", quantity: 2, unit_price_minor: 5000, income_account_id: income.id, tax_code_id: tax.id, item_id: null },
          { description: "Widget", quantity: 3, unit_price_minor: 5000, income_account_id: income.id, tax_code_id: null, item_id: item.id },
        ],
      });
      expect(saved.receipt_number).toMatch(/^SR-\d{6}$/);
      expect(saved.total_minor).toBe(25825);

      const [entry] = await q<{ id: string; status: string; description: string }>(
        "select id, status, description from acc_journal_entry where source_type = 'sales_receipt' and source_id = $1",
        [saved.id],
      );
      expect(entry.status).toBe("posted");
      expect(entry.description).toBe(`Sales receipt ${saved.receipt_number} · Example Walk-in`);
      const lines = await q<EntryLine & Record<string, unknown>>(
        "select account_id, debit_minor, credit_minor from acc_journal_line where journal_entry_id = $1",
        [entry.id],
      );
      const on = (id: string) => lines.filter((l) => l.account_id === id);
      expect(on(depositId).map((l) => [Number(l.debit_minor), Number(l.credit_minor)])).toEqual([[25825, 0]]);
      expect(on(income.id).map((l) => [Number(l.debit_minor), Number(l.credit_minor)])).toEqual([[0, 25000]]);
      expect(on(taxAccount.id).map((l) => [Number(l.debit_minor), Number(l.credit_minor)])).toEqual([[0, 825]]);
      expect(lines.some((l) => l.account_id !== depositId && l.account_id !== income.id && l.account_id !== taxAccount.id)).toBe(false);

      const [cost] = await q<{ id: string; status: string }>(
        "select id, status from acc_journal_entry where source_type = 'inventory' and source_id = $1",
        [saved.id],
      );
      expect(cost.status).toBe("posted");
      const costLines = await q<EntryLine & Record<string, unknown>>(
        "select account_id, debit_minor, credit_minor from acc_journal_line where journal_entry_id = $1",
        [cost.id],
      );
      expect(costLines.find((l) => l.account_id === cogsGl.id)).toMatchObject({ debit_minor: 3750 });
      expect(costLines.find((l) => l.account_id === inventoryGl.id)).toMatchObject({ credit_minor: 3750 });
      const onHand = async () =>
        Number((await q<{ qty: number }>("select running_qty as qty from acc_inventory_txn where item_id = $1 order by seq desc limit 1", [item.id]))[0].qty);
      expect(await onHand()).toBe(7);

      // 3. It reads back. The list and the dialog:
      const listed = (await listSalesReceipts(sb)).find((r) => r.id === saved.id)!;
      expect(listed).toMatchObject({
        receipt_number: saved.receipt_number,
        customer_name: "Example Walk-in",
        deposit_account_label: `${deposit.account_code} ${deposit.name}`,
        payment_method: "check",
        reference: "1042",
        subtotal_minor: 25000,
        tax_minor: 825,
        total_minor: 25825,
        status: "posted",
        journal_entry_id: entry.id,
      });
      const detail = await getSalesReceiptDetail(sb, saved.id);
      expect(detail.lines.map((l) => [l.description, l.quantity, l.line_tax_minor])).toEqual([
        ["Fitting", 2, 825],
        ["Widget", 3, 0],
      ]);

      // The printed receipt:
      const printed = buildSalesReceiptDocument(await getSalesReceiptDocumentSource(sb, saved.id));
      expect(printed.title).toBe(`Sales Receipt ${saved.receipt_number}`);
      expect(printed.partyHeading).toBe("SOLD TO");
      expect(printed.meta).toContainEqual({ label: "Paid by", value: "Check · 1042" });
      expect(printed.totals.at(-1)).toEqual({ label: "Paid", amount: "$258.25" });
      expect(printed.watermark).toBeNull();
      expect(printed.fileName).toBe(`Sales receipt ${saved.receipt_number} Example Walk-in.pdf`);

      // Sales tax collected:
      const collected = async () =>
        (await q<{ tax_code_id: string; taxable_minor: number; tax_minor: number }>(
          "select * from acc_sales_tax_collected('2026-09-01', '2026-09-30')",
        )).find((r) => r.tax_code_id === tax.id);
      expect(await collected()).toMatchObject({ taxable_minor: 10000, tax_minor: 825 });

      // The posting check, and Sales Tax Payable against its subledger:
      const postingRow = async () => {
        const [row] = await q<Record<string, unknown>>(
          "select * from acc_gl_posting_report('2026-09-01', '2026-09-30') where source_type = 'sales_receipt' and document_id = $1",
          [saved.id],
        );
        return checkPosting({
          sourceType: String(row.source_type),
          documentId: String(row.document_id),
          documentNumber: String(row.document_number),
          documentDate: String(row.document_date),
          partyName: String(row.party_name),
          documentStatus: String(row.document_status),
          amountMinor: Number(row.amount_minor),
          journalEntryId: (row.journal_entry_id as string | null) ?? null,
          entryNumber: (row.entry_number as string | null) ?? null,
          entryDate: (row.entry_date as string | null) ?? null,
          entryStatus: (row.entry_status as string | null) ?? null,
          entryTotalMinor: Number(row.entry_total_minor),
        });
      };
      expect((await postingRow()).verdict).toBe("posted");
      const salesTaxTie = async () => {
        const [row] = await q<{ subledger_minor: number; control_minor: number }>(
          "select * from acc_control_reconciliation('2026-09-30') where control_key = 'sales_tax'",
        );
        return row;
      };
      const tie = await salesTaxTie();
      expect(Number(tie.subledger_minor)).toBe(825);
      expect(Number(tie.control_minor)).toBe(825);

      // Sales by Customer gives the income to the customer, and ties to the P&L:
      const byCustomer = await getSalesByCustomer(sb, "2026-09-01", "2026-09-30");
      expect(byCustomer.report.lines.find((l) => l.partyId === customer.id)?.totalMinor).toBe(25000);
      expect(byCustomer.report.unattributedCount).toBe(0);
      expect(byCustomer.proof.differenceMinor).toBe(0);

      // The Transaction List names the customer; the search finds the number:
      const txn = (await getTransactionList(sb, "2026-09-01", "2026-09-30")).find((r) => r.entryId === entry.id);
      expect(txn).toMatchObject({ sourceType: "sales_receipt", partyName: "Example Walk-in" });
      const hits = await q<{ kind: string; id: string; href: string }>("select * from acc_global_search($1, 10)", [saved.receipt_number]);
      expect(hits).toContainEqual(expect.objectContaining({ kind: "sales_receipt", id: saved.id, href: "/sales-receipts" }));

      // 4. What the database refuses.
      const base = {
        customer_id: customer.id,
        receipt_date: "2026-09-13",
        deposit_account_id: depositId,
        payment_method: "cash" as const,
        reference: null,
        memo: null,
        lines: [{ description: "Fitting", quantity: 1, unit_price_minor: 5000, income_account_id: income.id, tax_code_id: null, item_id: null }],
      };
      await refused(() => createSalesReceipt(sb, { ...base, deposit_account_id: income.id }), /Deposit the money to an active bank or cash account/);
      await refused(() => createSalesReceipt(sb, { ...base, customer_id: inactive.id }), /Customer not found or inactive/);
      await refused(
        () => createSalesReceipt(sb, { ...base, lines: [{ ...base.lines[0], unit_price_minor: 0 }] }),
        /total must be positive/,
      );
      await refused(() => createSalesReceipt(sb, { ...base, receipt_date: "2026-08-20" }), /closed/i);
      // Past the functions: refused by the revoked grant on a company migrated in
      // place, by row-level security on one provisioned whole (provisioning
      // grants every table, and no write policy exists). An update finds no row.
      await refused(
        () =>
          q("insert into acc_sales_receipt (receipt_number, customer_id, receipt_date, deposit_account_id, subtotal_minor, total_minor) values ('SR-DIRECT', $1, '2026-09-13', $2, 100, 100)", [
            customer.id,
            depositId,
          ]),
        /permission denied|row-level security/,
      );
      await client.query("savepoint direct_update");
      const touched = await client
        .query("update acc_sales_receipt set memo = 'Changed directly' where id = $1", [saved.id])
        .then((r) => r.rowCount ?? 0, () => 0);
      await client.query("rollback to savepoint direct_update");
      expect(touched).toBe(0);

      // 5. Voided with a reason.
      await refused(() => voidSalesReceipt(sb, saved.id, "  x "), /Say why/);
      await voidSalesReceipt(sb, saved.id, "Entered twice");
      const voided = await getSalesReceiptDetail(sb, saved.id);
      expect(voided.receipt).toMatchObject({ status: "void", void_reason: "Entered twice" });
      expect(voided.receipt.voided_at).not.toBeNull();
      const statuses = await q<{ source_type: string; status: string }>(
        "select source_type, status from acc_journal_entry where source_id = $1 order by source_type",
        [saved.id],
      );
      expect(statuses).toEqual([
        { source_type: "inventory", status: "void" },
        { source_type: "sales_receipt", status: "void" },
      ]);
      expect(await onHand()).toBe(10);
      expect(await collected()).toBeUndefined();
      expect((await postingRow()).verdict).toBe("off_ledger");
      const tieAfter = await salesTaxTie();
      expect(Number(tieAfter.subledger_minor)).toBe(Number(tieAfter.control_minor));
      const voidPrinted = buildSalesReceiptDocument(await getSalesReceiptDocumentSource(sb, saved.id));
      expect(voidPrinted.watermark).toBe("VOID");
      expect(voidPrinted.totals.some((t) => t.label === "Paid")).toBe(false);
      await refused(() => voidSalesReceipt(sb, saved.id, "Again"), /already void/);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
