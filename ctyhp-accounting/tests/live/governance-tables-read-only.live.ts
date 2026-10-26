/**
 * 2.57: users, permissions, approval policies, periods, settings history and
 * the audit log can be changed only through the functions that check, ask for
 * a reason and write the audit row (migration 0167) — and every one of those
 * still works, plus the new "add an existing account".
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives.
 *
 *  1. No write policy is left on the eight tables; each keeps its read policy.
 *  2. The administrator writing them directly is refused: an insert errors,
 *     an update or delete reaches no row.
 *  3. Through the functions: add an existing account by email (refused twice,
 *     refused for an unknown email), add a new account's user row, change a
 *     role, suspend, edit the matrix and an approval policy, generate, close
 *     and reopen a period, save the company settings — each leaves its audit
 *     row.
 *  4. Someone without users.manage cannot add anyone.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/governance-tables-read-only.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";

const TABLES = [
  "acc_app_user", "acc_role_permission", "acc_permission", "acc_approval_policy",
  "acc_accounting_period", "acc_period_event", "acc_company_setting_version", "acc_audit_log",
];

describe("the governance tables", () => {
  it("change only through the functions that check and record, and every one still works", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("governance-tables-read-only: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        const r = await client.query(sql, params);
        await client.query("release savepoint attempt");
        return { error: null as string | null, rows: r.rows as Record<string, unknown>[], count: r.rowCount ?? 0 };
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return { error: (err as Error).message, rows: [] as Record<string, unknown>[], count: 0 };
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
      const others = await q<{ id: string; email: string }>("select id, email from auth.users where id <> $1 and email is not null order by created_at limit 2", [admin.id]);
      const [existing, fresh] = others;
      const { schema } = await provisionCompany(
        client,
        { slug: `govern_${randomBytes(4).toString("hex")}`, legalName: "Governance check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);

      // 1. No write policy; every table keeps its read.
      const policies = await q<{ tablename: string; cmd: string }>("select tablename, cmd from pg_policies where schemaname = $1 and tablename = any($2)", [schema, TABLES]);
      expect(policies.filter((p) => p.cmd !== "SELECT")).toEqual([]);
      expect(new Set(policies.filter((p) => p.cmd === "SELECT").map((p) => p.tablename))).toEqual(new Set(TABLES));

      const auditCount = async () => Number((await q<{ n: number }>("select count(*)::int as n from acc_audit_log"))[0].n);
      await as(admin.id);

      // 3a. Periods first, so there is a period to try to write directly below.
      const gen = await attempt("select acc_generate_periods(2026)");
      expect(gen.error).toBeNull();
      const [period] = await q<{ id: string }>("select id from acc_accounting_period where period_start = '2026-01-01'");

      // 2. Direct writes, as the administrator.
      for (const sql of [
        "insert into acc_app_user (id, full_name, role, status) values (gen_random_uuid(), 'Direct', 'admin', 'active')",
        "insert into acc_audit_log (table_name, record_id, action, actor_id) values ('acc_invoice', gen_random_uuid(), 'update', gen_random_uuid())",
        "insert into acc_period_event (period_id, event, reason) select id, 'reopen', 'Direct' from acc_accounting_period limit 1",
        "insert into acc_company_setting_version (version, legal_name) values (99, 'Direct')",
      ]) {
        const r = await attempt(sql);
        expect(r.error, sql).toMatch(/row-level security|permission denied|violates/);
      }
      for (const [sql, params] of [
        ["update acc_app_user set role = 'viewer' where id = $1", [admin.id]],
        ["update acc_accounting_period set status = 'closed' where id = $1", [period.id]],
        ["update acc_role_permission set allowed = false where role = 'admin' and permission_key = 'users.manage'", []],
        ["update acc_approval_policy set enabled = true", []],
        ["update acc_permission set is_enforced = false", []],
        ["delete from acc_audit_log", []],
      ] as const) {
        const r = await attempt(sql, [...params]);
        expect(r.count, sql).toBe(0);
      }
      expect((await q<{ role: string }>("select role::text from acc_app_user where id = $1", [admin.id]))[0].role).toBe("admin");

      // 3. Through the functions.
      let before = await auditCount();
      const added = await attempt("select acc_add_existing_user($1, 'accountant') as id", [existing.email.toUpperCase()]);
      expect(added.error).toBeNull();
      expect(added.rows[0].id).toBe(existing.id);
      expect(await auditCount()).toBeGreaterThan(before);
      expect((await attempt("select acc_add_existing_user($1, 'viewer')", [existing.email])).error).toMatch(/already in this company \(active\)/);
      expect((await attempt("select acc_add_existing_user('nobody-at-all@example.invalid', 'viewer')")).error).toMatch(/No OneBook sign-in uses/);
      expect((await attempt("select acc_add_existing_user('  ', 'viewer')")).error).toMatch(/Enter the email address/);

      before = await auditCount();
      expect((await attempt("select acc_add_company_user($1, 'New Person', 'viewer')", [fresh.id])).error).toBeNull();
      expect(await auditCount()).toBeGreaterThan(before);
      expect((await attempt("select acc_add_company_user($1, 'Again', 'viewer')", [fresh.id])).error).toMatch(/already in this company/);
      expect((await attempt("select acc_add_company_user(gen_random_uuid(), 'Ghost', 'viewer')")).error).toMatch(/does not exist/);

      for (const sql of [
        `select acc_set_user_role('${fresh.id}', 'sales', 'Moving to the sales desk')`,
        `select acc_set_user_status('${fresh.id}', 'suspended', 'On leave')`,
        "select acc_set_role_permission('accountant', 'budget.manage', false)",
        "select acc_set_approval_policy('write_off', true, 50000, false)",
        `select acc_close_period('${period.id}', 'January reviewed', null)`,
        `select acc_reopen_period('${period.id}', 'A late bill arrived')`,
        "select acc_save_company_settings('Governance check', null, null, null, null, null, null, null, 'US', 1, 'USD', 'America/New_York', 'accrual', 30, 'average_cost', null)",
      ]) {
        before = await auditCount();
        const r = await attempt(sql);
        expect(r.error, sql).toBeNull();
        expect(await auditCount(), `${sql} leaves an audit row`).toBeGreaterThan(before);
      }
      expect((await q<{ status: string }>("select status::text from acc_accounting_period where id = $1", [period.id]))[0].status).toBe("open");

      // 4. Without users.manage, nobody is added.
      await as(existing.id);
      expect((await attempt("select acc_add_existing_user($1, 'admin')", [fresh.email])).error).toMatch(/permission to manage users/);
      expect((await attempt("select acc_add_company_user(gen_random_uuid(), 'X', 'admin')")).error).toMatch(/permission to manage users/);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
