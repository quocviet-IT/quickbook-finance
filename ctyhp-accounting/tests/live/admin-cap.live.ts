/**
 * 2.63: a company has at most two admins holding access (migration 0172).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. Every way a third admin could arrive is
 * refused, a suspended or offboarded admin does not count, and making room by
 * demoting one lets another be promoted.
 *
 * The platform-admin half of 0172 acts on the one register shared by every
 * company, which a throwaway company does not build; it is checked on the live
 * database after migrating.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/admin-cap.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";

const CAP = /at most two admins/;

describe("admins in a company", () => {
  it("are at most two, whichever way a third would arrive", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("admin-cap: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        await client.query(sql, params);
        await client.query("release savepoint attempt");
        return null as string | null;
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return (err as Error).message;
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
      const others = await q<{ id: string; email: string }>(
        "select id, email from auth.users where id <> $1 and email is not null order by created_at limit 4",
        [admin.id],
      );
      expect(others).toHaveLength(4);
      const [second, third, dormant, outsider] = others;
      const { schema } = await provisionCompany(
        client,
        { slug: `admincap_${randomBytes(4).toString("hex")}`, legalName: "Admin cap check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      const roleOf = async (id: string) =>
        (await q<{ role: string; status: string }>("select role::text as role, status::text as status from acc_app_user where id = $1", [id]))[0];

      // Two accountants, and an admin who is suspended and so holds no access.
      await client.query(
        `insert into acc_app_user (id, full_name, role, status) values
           ($1, 'Second', 'accountant', 'active'), ($2, 'Third', 'accountant', 'active'), ($3, 'Dormant', 'admin', 'suspended')`,
        [second.id, third.id, dormant.id],
      );

      await as(admin.id);
      // The second admin is allowed.
      expect(await attempt("select acc_set_user_role($1, 'admin', 'Covers the books when the owner is away')", [second.id])).toBeNull();
      expect((await roleOf(second.id)).role).toBe("admin");

      // A third, by each road: refused, and nothing changes.
      expect(await attempt("select acc_set_user_role($1, 'admin', 'Third admin')", [third.id])).toMatch(CAP);
      expect((await roleOf(third.id)).role).toBe("accountant");
      expect(await attempt("select acc_set_user_status($1, 'active', 'Back from leave')", [dormant.id])).toMatch(CAP);
      expect((await roleOf(dormant.id)).status).toBe("suspended");
      expect(await attempt("select acc_add_existing_user($1, 'admin')", [outsider.email])).toMatch(CAP);
      expect(await q("select 1 from acc_app_user where id = $1", [outsider.id])).toHaveLength(0);
      // An existing account may still join in another role.
      expect(await attempt("select acc_add_existing_user($1, 'viewer')", [outsider.email])).toBeNull();

      // Nor around the functions, even as the database owner.
      await client.query("reset role");
      expect(await attempt("update acc_app_user set role = 'admin' where id = $1", [third.id])).toMatch(CAP);

      // Room is made by demoting one; then another can be promoted.
      await as(admin.id);
      expect(await attempt("select acc_set_user_role($1, 'accountant', 'Back to bookkeeping')", [second.id])).toBeNull();
      expect(await attempt("select acc_set_user_role($1, 'admin', 'Takes over administration')", [third.id])).toBeNull();
      expect((await roleOf(third.id)).role).toBe("admin");
      // Offboarding an admin frees the place too.
      expect(await attempt("select acc_set_user_status($1, 'offboarded', 'Left the company')", [third.id])).toBeNull();
      expect(await attempt("select acc_set_user_status($1, 'active', 'Back from leave')", [dormant.id])).toBeNull();
      expect((await q<{ n: number }>("select count(*)::int as n from acc_app_user where role = 'admin' and status in ('invited', 'active')"))[0].n).toBe(2);
    } finally {
      await client.query("rollback").catch(() => undefined);
      clearTimeout(killer);
      await client.end();
    }
  }, 9 * 60_000);
});
