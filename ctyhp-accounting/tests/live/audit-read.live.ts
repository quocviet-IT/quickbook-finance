/**
 * 2.95: the audit log is read by whoever holds Read the audit log (0184).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/audit-read.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("0184 in the database", () => {
  it("shows audit history only to a role holding audit.read, and follows the switch", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("audit-read: hard timeout");
      process.exit(2);
    }, 6 * 60_000);
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
        return { error: (err as Error).message, rows: [] as Record<string, unknown>[] };
      }
    };
    const as = async (userId: string) => {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1" })]);
    };
    const owner = () => client.query("reset role");
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      await client.query("set local idle_in_transaction_session_timeout = '60s'");

      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      const others = await q<{ id: string }>("select id from auth.users where id <> $1 and email is not null order by created_at limit 4", [admin.id]);
      expect(others).toHaveLength(4);
      const [viewer, sales, accountant, outsider] = others;
      const { schema } = await provisionCompany(
        client,
        { slug: `audit_${randomBytes(4).toString("hex")}`, legalName: "Audit read check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query(
        "insert into acc_app_user (id, full_name, role, status) values ($1, 'Viewer', 'viewer', 'active'), ($2, 'Sales', 'sales', 'active'), ($3, 'Accountant', 'accountant', 'active')",
        [viewer.id, sales.id, accountant.id],
      );
      await client.query(
        "insert into acc_audit_log (table_name, record_id, action, actor_id, after_json) values ('acc_check', gen_random_uuid(), 'update', $1, '{\"note\": \"check\"}')",
        [admin.id],
      );
      const [{ n: total }] = await q<{ n: number }>("select count(*)::int as n from acc_audit_log");
      expect(total).toBeGreaterThan(0);

      const seen = async (userId: string) => {
        await as(userId);
        const result = await attempt("select count(*)::int as n from acc_audit_log");
        await owner();
        expect(result.error, "reading is refused by filtering, not by an error").toBeNull();
        return Number(result.rows[0].n);
      };
      const searched = async (userId: string) => {
        await as(userId);
        const result = await attempt("select count(*)::int as n from acc_audit_search(null, null, null, null, null, null, 1000)");
        await owner();
        return result;
      };

      // The roles that hold audit.read as every company starts.
      expect(await seen(admin.id), "admin").toBe(total);
      expect(await seen(accountant.id), "accountant").toBe(total);
      expect(await seen(viewer.id), "viewer").toBe(total);
      // Sales never held it; nor does someone outside the company.
      expect(await seen(sales.id), "sales").toBe(0);
      expect(await seen(outsider.id), "outsider").toBe(0);
      expect((await searched(sales.id)).error, "and the search says so").toMatch(/permission to read the audit log/);

      // The switch now decides the table as well as the screens.
      await client.query("update acc_role_permission set allowed = false where role = 'viewer' and permission_key = 'audit.read'");
      expect(await seen(viewer.id), "viewer, switched off").toBe(0);
      expect((await searched(viewer.id)).error).toMatch(/permission to read the audit log/);
      await client.query("update acc_role_permission set allowed = true where role = 'viewer' and permission_key = 'audit.read'");
      expect(await seen(viewer.id), "viewer, switched back on").toBe(total);

      // Still no session writes the log itself (0167); rows come from functions and triggers.
      await as(accountant.id);
      const write = await attempt("insert into acc_audit_log (table_name, action) values ('acc_check', 'forged')");
      await owner();
      expect(write.error, "no session writes the log directly").toMatch(/permission denied|row-level security/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
      clearTimeout(killer);
    }
  }, 6 * 60_000);
});
