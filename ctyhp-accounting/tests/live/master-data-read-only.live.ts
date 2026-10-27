/**
 * 2.61: master data changes only through its functions (migration 0171).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives.
 *
 *  1. No write policy is left on the eleven tables; each keeps its read.
 *  2. A session may write directly only the three tables it files into.
 *  3. As the administrator, a direct insert, update or delete on any of the
 *     eleven is refused, and the row is untouched.
 *  4. The same change through the screen's function goes through.
 *
 * Every screen's save is exercised end to end by master-data-functions.live.ts,
 * which builds its company from the same tree, so with these tables locked.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/master-data-read-only.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";

const TABLES = [
  "acc_account", "acc_bank_account", "acc_bank_rule", "acc_banking_preference", "acc_customer", "acc_item",
  "acc_recurring_template", "acc_related_company", "acc_repayment_account", "acc_tax_code", "acc_vendor",
];

describe("master data tables", () => {
  it("change only through the screens' functions", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("master-data-read-only: hard timeout");
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
        { slug: `mlock_${randomBytes(4).toString("hex")}`, legalName: "Master data lock check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);

      // 1. No write policy; every table keeps its read.
      const policies = await q<{ tablename: string; cmd: string }>("select tablename, cmd from pg_policies where schemaname = $1 and tablename = any($2)", [schema, TABLES]);
      expect(policies.filter((p) => p.cmd !== "SELECT")).toEqual([]);
      expect(new Set(policies.filter((p) => p.cmd === "SELECT").map((p) => p.tablename))).toEqual(new Set(TABLES));

      // 2. What a session may still write directly.
      const writable = await q<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = $1
            and (has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'INSERT')
              or has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'UPDATE')
              or has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'DELETE'))`,
        [schema],
      );
      expect(writable.map((r) => r.tablename).sort()).toEqual(["acc_document_attachment", "acc_feedback_attachment", "acc_feedback_report"]);

      // Rows to aim at, written as the owner.
      const one = async (sql: string) => (await q<{ id: string }>(sql))[0].id;
      const customer = await one("insert into acc_customer (name) values ('Example Customer') returning id");
      const vendor = await one("insert into acc_vendor (name) values ('Example Supplier') returning id");
      const account = await one("select id from acc_account where account_type = 'expense' and status = 'active' order by account_code limit 1");

      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);

      // 3. Direct writes, as the administrator.
      for (const sql of [
        "insert into acc_customer (name) values ('Direct')",
        "insert into acc_vendor (name) values ('Direct')",
        "insert into acc_account (account_code, name, account_type) values ('7777', 'Direct', 'expense')",
        "insert into acc_item (name) values ('Direct')",
        "insert into acc_tax_code (code, name) values ('DIRECT', 'Direct')",
        "insert into acc_banking_preference (singleton, pair_window_days) values (true, 7)",
      ]) {
        expect((await attempt(sql)).error, sql).toMatch(/permission denied|row-level security/);
      }
      for (const [sql, params] of [
        ["update acc_customer set name = 'Direct' where id = $1", [customer]],
        ["update acc_customer set currency_code = 'CAD' where id = $1", [customer]],
        ["update acc_vendor set name = 'Direct' where id = $1", [vendor]],
        ["update acc_account set account_type = 'income' where id = $1", [account]],
        ["delete from acc_customer where id = $1", [customer]],
      ] as [string, unknown[]][]) {
        expect((await attempt(sql, params)).error, sql).toMatch(/permission denied/);
      }
      for (const table of TABLES) {
        expect((await attempt(`delete from ${table}`)).error, table).toMatch(/permission denied/);
      }
      expect((await q<{ name: string }>("select name from acc_customer where id = $1", [customer]))[0].name).toBe("Example Customer");

      // 4. Through the screen's function, the same change goes through.
      expect((await attempt("select acc_save_customer($1, '{\"name\": \"Example Customer Ltd\"}'::jsonb)", [customer])).error).toBeNull();
      expect((await q<{ name: string }>("select name from acc_customer where id = $1", [customer]))[0].name).toBe("Example Customer Ltd");
    } finally {
      await client.query("rollback").catch(() => undefined);
      clearTimeout(killer);
      await client.end();
    }
  }, 9 * 60_000);
});
