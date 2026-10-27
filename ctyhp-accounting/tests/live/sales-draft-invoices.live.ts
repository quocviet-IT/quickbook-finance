/**
 * 2.63: sales prepares invoices and an accountant issues them (migration 0173).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. A sales user makes a draft, cannot
 * issue, void or add a customer, and loses the draft when invoice.create is
 * switched off; a viewer cannot make one; the accountant issues the sales
 * user's draft. Sales reads supporting documents, and the audit log says why.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/sales-draft-invoices.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("draft invoices by sales", () => {
  it("are made by sales and issued by an accountant", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("sales-draft-invoices: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        const rows = (await client.query(sql, params)).rows;
        await client.query("release savepoint attempt");
        return { error: null as string | null, rows };
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return { error: (err as Error).message, rows: [] };
      }
    };
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
      const others = await q<{ id: string }>("select id from auth.users where id <> $1 and email is not null order by created_at limit 3", [admin.id]);
      expect(others).toHaveLength(3);
      const [accountant, sales, viewer] = others;
      const { schema } = await provisionCompany(
        client,
        { slug: `salesdraft_${randomBytes(4).toString("hex")}`, legalName: "Sales draft check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query(
        `insert into acc_app_user (id, full_name, role, status) values
           ($1, 'Example Accountant', 'accountant', 'active'), ($2, 'Example Sales', 'sales', 'active'), ($3, 'Example Viewer', 'viewer', 'active')`,
        [accountant.id, sales.id, viewer.id],
      );
      const one = async (sql: string) => (await q<{ id: string }>(sql))[0].id;
      const income = await one("select id from acc_account where account_type = 'income' and status = 'active' and is_posting_account order by account_code limit 1");
      const customer = await one("insert into acc_customer (name) values ('Example Customer') returning id");
      const lines = JSON.stringify([
        { description: "Ring resize", quantity: 1, unit_price_minor: 15000, income_account_id: income, tax_code_id: null, item_id: null },
      ]);
      const draft = "select acc_create_draft_invoice($1, '2026-10-01', null, 'USD', 'Prepared by sales', $2::jsonb) as id";

      // The matrix a new company starts with.
      const matrix = await q<{ role: string; allowed: boolean }>(
        "select role::text as role, allowed from acc_role_permission where permission_key = 'invoice.create' order by role",
      );
      expect(Object.fromEntries(matrix.map((r) => [r.role, r.allowed]))).toEqual({ admin: true, accountant: true, sales: true, viewer: false });
      expect((await q<{ allowed: boolean }>("select allowed from acc_role_permission where role = 'sales' and permission_key = 'documents.read'"))[0].allowed).toBe(true);
      expect(
        (await q<{ n: number }>(
          "select count(*)::int as n from acc_audit_log where table_name = 'acc_role_permission' and after_json ->> 'permission_key' = 'documents.read' and actor_id is null",
        ))[0].n,
      ).toBe(1);

      // Sales makes a draft, recorded as theirs, with the amounts worked out here.
      await as(sales.id);
      const made = await attempt(draft, [customer, lines]);
      expect(made.error).toBeNull();
      const invoiceId = made.rows[0].id as string;
      const [invoice] = await q<{ status: string; created_by: string; total_minor: string }>(
        "select status::text as status, created_by, total_minor::text as total_minor from acc_invoice where id = $1",
        [invoiceId],
      );
      expect(invoice).toEqual({ status: "draft", created_by: sales.id, total_minor: "15000" });
      expect((await attempt("select acc_has_permission('documents.read') as ok")).rows[0].ok).toBe(true);

      // But cannot issue it, void it, add a customer, or turn an estimate into an invoice.
      expect((await attempt("select acc_issue_invoice($1, null)", [invoiceId])).error).toMatch(/not authorized|permission/i);
      expect((await attempt("select acc_void_invoice($1)", [invoiceId])).error).toMatch(/not authorized|permission/i);
      expect((await attempt("select acc_save_customer(null, $1::jsonb)", [JSON.stringify({ name: "Walk-in" })])).error).toMatch(/not authorized|permission/i);
      expect(
        (await attempt("select acc_create_invoice_from_estimate(gen_random_uuid(), $1, '2026-10-01', null, 'USD', null, $2::jsonb)", [customer, lines])).error,
      ).toMatch(/Not authorized to create invoices/);
      expect((await q<{ status: string }>("select status::text as status from acc_invoice where id = $1", [invoiceId]))[0].status).toBe("draft");

      // A viewer cannot make one.
      await as(viewer.id);
      expect((await attempt(draft, [customer, lines])).error).toMatch(/You do not have permission to create invoices/);

      // Switched off for sales, sales cannot either.
      await client.query("reset role");
      await client.query("update acc_role_permission set allowed = false where role = 'sales' and permission_key = 'invoice.create'");
      await as(sales.id);
      expect((await attempt(draft, [customer, lines])).error).toMatch(/You do not have permission to create invoices/);

      // The accountant issues the sales user's draft.
      await as(admin.id);
      expect((await attempt("select acc_generate_periods(2026)")).error).toBeNull();
      await as(accountant.id);
      expect((await attempt("select acc_issue_invoice($1, null)", [invoiceId])).error).toBeNull();
      expect((await q<{ status: string }>("select status::text as status from acc_invoice where id = $1", [invoiceId]))[0].status).toBe("issued");
    } finally {
      await client.query("rollback").catch(() => undefined);
      clearTimeout(killer);
      await client.end();
    }
  }, 9 * 60_000);
});
