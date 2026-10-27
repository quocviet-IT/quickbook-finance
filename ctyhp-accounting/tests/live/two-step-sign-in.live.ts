/**
 * 2.65: once someone has a second sign-in step, a session that has not passed
 * it is worth nothing in the database (migration 0174).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives, including the second factors written
 * here for real sign-ins (they are never committed, so no one's sign-in sees
 * them). Covers the membership check, the reset functions, that row policies
 * now ask once per statement, and, once 0174 is live, platform administrators.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/two-step-sign-in.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("two-step sign-in in the database", () => {
  it("counts someone with a second step only in a session that has passed it", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("two-step-sign-in: hard timeout");
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
    /** A request from this person, with the assurance level its token would carry. */
    const as = async (userId: string, aal: "aal1" | "aal2") => {
      await client.query("reset role");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", aal })]);
    };
    const addFactor = (userId: string) =>
      client.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
         values (gen_random_uuid(), $1, $2, 'totp', 'verified', now(), now(), 'live-test')`,
        [userId, `live test ${randomBytes(3).toString("hex")}`],
      );
    const timeCount = async (table: string) => {
      const runs: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        await client.query(`select count(*) from ${table}`);
        runs.push(performance.now() - t);
      }
      return runs.sort((a, b) => a - b)[1];
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      const [platformAdmin] = await q<{ user_id: string }>("select user_id from onebook.platform_admin limit 1");
      const others = await q<{ id: string }>(
        "select id from auth.users where id <> all($1::uuid[]) and email is not null order by created_at limit 2",
        [[admin.id, platformAdmin.user_id]],
      );
      expect(others).toHaveLength(2);
      const [enrolled, plain] = others;
      const { schema } = await provisionCompany(
        client,
        { slug: `twostep_${randomBytes(4).toString("hex")}`, legalName: "Two-step check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query(
        "insert into acc_app_user (id, full_name, role, status) values ($1, 'Enrolled Accountant', 'accountant', 'active'), ($2, 'Plain Accountant', 'accountant', 'active')",
        [enrolled.id, plain.id],
      );
      await client.query("insert into acc_customer (name) values ('Example Customer')");
      for (const id of [admin.id, enrolled.id, plain.id]) {
        expect((await q<{ n: number }>("select count(*)::int as n from auth.mfa_factors where user_id = $1 and status = 'verified'", [id]))[0].n, "starts with no factor").toBe(0);
      }
      await addFactor(enrolled.id);

      // 1. A password-only session of someone with a second step: no role, no rows, no actions.
      await as(enrolled.id, "aal1");
      expect((await attempt("select acc_current_role() as r")).rows[0].r).toBeNull();
      expect((await attempt("select count(*)::int as n from acc_customer")).rows[0].n).toBe(0);
      expect((await attempt("select acc_has_permission('invoice.create') as ok")).rows[0].ok).toBe(false);
      expect((await attempt("select acc_save_customer(null, $1::jsonb)", [JSON.stringify({ name: "Walk-in" })])).error).toMatch(/not authorized|permission/i);
      // The same person, having passed it.
      await as(enrolled.id, "aal2");
      expect((await attempt("select acc_current_role()::text as r")).rows[0].r).toBe("accountant");
      expect((await attempt("select count(*)::int as n from acc_customer")).rows[0].n).toBe(1);
      // Someone without a second step is unaffected.
      await as(plain.id, "aal1");
      expect((await attempt("select acc_current_role()::text as r")).rows[0].r).toBe("accountant");
      expect((await attempt("select count(*)::int as n from acc_customer")).rows[0].n).toBe(1);

      // 2. Every row policy asks once per statement.
      await client.query("reset role");
      const perRow = await q<{ policyname: string }>(
        `select policyname from pg_policies where schemaname = $1
            and (coalesce(qual, '') ~ '(?<!SELECT )(acc_current_role|acc_is_staff|acc_is_admin|acc_has_permission)\\('
              or coalesce(with_check, '') ~ '(?<!SELECT )(acc_current_role|acc_is_staff|acc_is_admin|acc_has_permission)\\(')`,
        [schema],
      );
      expect(perRow.map((p) => p.policyname)).toEqual([]);

      // 3. Resetting someone else's second step.
      await as(admin.id, "aal1");
      expect((await attempt("select acc_mfa_reset_check($1, 'Lost their phone')", [enrolled.id])).error).toBeNull();
      expect((await attempt("select acc_mfa_reset_check($1, '  ')", [enrolled.id])).error).toMatch(/A reason is required/);
      expect((await attempt("select acc_mfa_reset_check($1, 'Mine')", [admin.id])).error).toMatch(/cannot reset your own/);
      expect((await attempt("select acc_mfa_reset_check(gen_random_uuid(), 'Nobody')")).error).toMatch(/not a user of this company/);
      expect((await attempt("select acc_record_mfa_reset($1, 'Lost their phone', 1)", [enrolled.id])).error).toBeNull();
      await as(plain.id, "aal1");
      expect((await attempt("select acc_mfa_reset_check($1, 'Lost their phone')", [enrolled.id])).error).toMatch(/permission to manage users/);
      await client.query("reset role");
      const [audit] = await q<{ actor_id: string; after_json: { reason: string; factors_removed: number } }>(
        "select actor_id, after_json from acc_audit_log where table_name = 'acc_app_user' and record_id = $1 and action = 'mfa_reset'",
        [enrolled.id],
      );
      expect(audit).toEqual({ actor_id: admin.id, after_json: { reason: "Lost their phone", factors_removed: 1 } });

      // 4. Once per statement is what makes the check affordable: twenty
      // thousand customers, read the new way and the old way.
      await client.query("reset role");
      await client.query("insert into acc_customer (name) select 'Bulk ' || g from generate_series(1, 20000) g");
      await as(plain.id, "aal1");
      const wrapped = await timeCount("acc_customer");
      await client.query("reset role");
      const policies = await q<{ policyname: string; qual: string }>(
        "select policyname, qual from pg_policies where schemaname = $1 and tablename = 'acc_customer' and cmd in ('SELECT', 'ALL')",
        [schema],
      );
      for (const p of policies) {
        const old = p.qual.replace(/\( SELECT (acc_\w+\([^()]*\)) AS \w+\)/g, "$1");
        await client.query(`alter policy ${p.policyname} on acc_customer using (${old})`);
      }
      await as(plain.id, "aal1");
      const perRowMs = await timeCount("acc_customer");
      console.log(`20,001 customers: once per statement ${wrapped.toFixed(0)} ms, once per row ${perRowMs.toFixed(0)} ms`);
      expect(wrapped).toBeLessThan(perRowMs / 2);

      // 5. Platform administrators, the same rule. onebook is the one register
      // every company shares, which a throwaway company does not rebuild, so
      // this asks the live one, and only once 0174 has been applied to it.
      await client.query("reset role");
      const [applied] = await q<{ n: number }>("select count(*)::int as n from public.acc_schema_migrations where filename = '0174_two_step_sign_in.sql'");
      if (applied.n === 0) {
        console.log("onebook.is_platform_admin: 0174 not applied yet; checked after migrating");
        return;
      }
      await as(platformAdmin.user_id, "aal1");
      expect((await attempt("select onebook.is_platform_admin() as ok")).rows[0].ok).toBe(true);
      await client.query("reset role");
      await addFactor(platformAdmin.user_id);
      await as(platformAdmin.user_id, "aal1");
      expect((await attempt("select onebook.is_platform_admin() as ok")).rows[0].ok).toBe(false);
      await as(platformAdmin.user_id, "aal2");
      expect((await attempt("select onebook.is_platform_admin() as ok")).rows[0].ok).toBe(true);
    } finally {
      await client.query("rollback").catch(() => undefined);
      clearTimeout(killer);
      await client.end();
    }
  }, 9 * 60_000);
});
