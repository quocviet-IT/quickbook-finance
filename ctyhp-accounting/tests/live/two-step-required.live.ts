/**
 * 2.66: from its company's deadline, an admin or accountant counts only in a
 * session that has passed the second step (migration 0175).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. The deadline is moved into the past
 * inside that company only. The platform-administrator half acts on the one
 * register every company shares and is checked on the live database.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/two-step-required.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("two-step sign-in required", () => {
  it("is needed by admins and accountants from the deadline, and by no one else", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("two-step-required: hard timeout");
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
        return { error: (err as Error).message, rows: [] as Record<string, unknown>[] };
      }
    };
    const as = async (userId: string, aal: "aal1" | "aal2") => {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", aal })]);
    };
    const roleOf = async (userId: string, aal: "aal1" | "aal2") => {
      await as(userId, aal);
      return (await attempt("select acc_current_role()::text as r")).rows[0]?.r ?? null;
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
        { slug: `required_${randomBytes(4).toString("hex")}`, legalName: "Two-step required check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query(
        `insert into acc_app_user (id, full_name, role, status) values
           ($1, 'Example Accountant', 'accountant', 'active'), ($2, 'Example Sales', 'sales', 'active'), ($3, 'Example Viewer', 'viewer', 'active')`,
        [accountant.id, sales.id, viewer.id],
      );
      await client.query("insert into acc_customer (name) values ('Example Customer')");
      for (const id of [admin.id, accountant.id, sales.id, viewer.id]) {
        expect((await q<{ n: number }>("select count(*)::int as n from auth.mfa_factors where user_id = $1 and status = 'verified'", [id]))[0].n).toBe(0);
      }

      // A new company: seven days from its creation, for admins and accountants.
      const [policy] = await q<{ roles: string; days: number }>(
        "select roles::text as roles, round(extract(epoch from required_from - now()) / 86400)::int as days from acc_two_step_policy",
      );
      expect(policy).toEqual({ roles: "{admin,accountant}", days: 7 });
      // Readable by anyone signed in; written by no one.
      for (const [privilege, expected] of [["SELECT", true], ["INSERT", false], ["UPDATE", false], ["DELETE", false]] as const) {
        expect((await q<{ ok: boolean }>(`select has_table_privilege('authenticated', '${schema}.acc_two_step_policy', '${privilege}') as ok`))[0].ok, privilege).toBe(expected);
      }

      // Before the deadline: a password session is enough for everyone.
      expect(await roleOf(admin.id, "aal1")).toBe("admin");
      expect(await roleOf(accountant.id, "aal1")).toBe("accountant");
      await as(accountant.id, "aal1");
      expect((await attempt("select (select count(*) from acc_two_step_policy)::int as n")).rows[0].n).toBe(1);

      // After it: admins and accountants need the second step; sales and viewers do not.
      await client.query("reset role");
      await client.query("update acc_two_step_policy set required_from = now() - interval '1 minute'");
      expect(await roleOf(admin.id, "aal1")).toBeNull();
      expect(await roleOf(accountant.id, "aal1")).toBeNull();
      await as(accountant.id, "aal1");
      expect((await attempt("select count(*)::int as n from acc_customer")).rows[0].n).toBe(0);
      expect(await roleOf(accountant.id, "aal2")).toBe("accountant");
      await as(accountant.id, "aal2");
      expect((await attempt("select count(*)::int as n from acc_customer")).rows[0].n).toBe(1);
      expect(await roleOf(admin.id, "aal2")).toBe("admin");
      expect(await roleOf(sales.id, "aal1")).toBe("sales");
      expect(await roleOf(viewer.id, "aal1")).toBe("viewer");
      // The person can still read their own row and the deadline, which is
      // how the screens know to send them to set it up.
      await as(accountant.id, "aal1");
      expect((await attempt("select role::text as r from acc_app_user where id = auth.uid()")).rows[0]?.r).toBe("accountant");
      expect((await attempt("select count(*)::int as n from acc_two_step_policy")).rows[0].n).toBe(1);

      // No policy row: nothing is required, rather than everyone locked out.
      await client.query("reset role");
      await client.query("delete from acc_two_step_policy");
      expect(await roleOf(admin.id, "aal1")).toBe("admin");
      expect(await roleOf(accountant.id, "aal1")).toBe("accountant");
    } finally {
      await client.query("rollback").catch(() => undefined);
      clearTimeout(killer);
      await client.end();
    }
  }, 9 * 60_000);
});
