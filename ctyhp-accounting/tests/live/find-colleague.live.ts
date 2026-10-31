/**
 * 2.96: Add existing account finds colleagues, not any account (0185).
 *
 * Inside ONE transaction that is always rolled back; nothing survives. Two
 * throwaway companies are built from this tree: A, run by the caller, and B,
 * where a stranger works and the caller does not. 0185's global function is
 * built from its own statement in a scratch schema in the same transaction, so
 * the live one is never touched; it reads the real register, which inside the
 * transaction also lists A and B.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/find-colleague.live.ts
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { scopeOf, splitSqlStatements } from "@/lib/domain/schema-template";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("0185 in the database", () => {
  it("finds a colleague by email and gives every other address the same empty answer", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("find-colleague: hard timeout");
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

      const [admin] = await q<{ id: string; email: string }>(
        "select a.id, u.email from public.acc_app_user a join auth.users u on u.id = a.id where a.role = 'admin' and a.status = 'active' order by a.created_at limit 1",
      );
      // A colleague: works in public, as the caller does.
      const [colleague] = await q<{ id: string; email: string }>(
        "select a.id, u.email from public.acc_app_user a join auth.users u on u.id = a.id where a.status in ('invited', 'active') and a.id <> $1 and u.email is not null order by a.created_at limit 1",
        [admin.id],
      );
      expect(colleague, "public has a second member").toBeTruthy();

      // A stranger: a sign-in that works only in company B.
      const strangerEmail = `stranger-${randomBytes(4).toString("hex")}@example.test`;
      const strangerId = randomUUID();
      await client.query(
        `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{"full_name": "Stranger"}', now(), now())`,
        [strangerId, strangerEmail],
      );

      const sources = loadMigrationSources(process.cwd());
      const a = await provisionCompany(
        client,
        { slug: `colleague_a_${randomBytes(3).toString("hex")}`, legalName: "Colleague check A", isSample: true, displayOrder: 9998, adminUserIds: [admin.id] },
        sources,
      );
      await provisionCompany(
        client,
        { slug: `colleague_b_${randomBytes(3).toString("hex")}`, legalName: "Colleague check B", isSample: true, displayOrder: 9999, adminUserIds: [strangerId] },
        sources,
      );
      const [{ id: companyA }] = await q<{ id: string }>("select id from onebook.company where schema_name = $1", [a.schema]);

      // 0185's global statement, built in a scratch schema.
      const scratch = `colleague_${randomBytes(4).toString("hex")}`;
      await client.query(`create schema ${scratch}`);
      await client.query(`grant usage on schema ${scratch} to authenticated`);
      const migration = readFileSync(join(process.cwd(), "supabase/migrations/0185_add_colleague_not_any_account.sql"), "utf8");
      const global = splitSqlStatements(migration)
        .filter((s) => scopeOf(s).scope === "global" && !/^\s*(--[^\n]*\n\s*)*notify\b/i.test(s))
        .map((s) => s.replace(/onebook\.find_colleague/g, `${scratch}.find_colleague`));
      expect(global.length).toBe(3);
      for (const statement of global) {
        expect(statement).not.toMatch(/onebook\.find_colleague/);
        await client.query(statement);
      }
      const find = async (userId: string, company: string, email: string) => {
        await as(userId);
        const result = await attempt(`select colleague_id, colleague_name from ${scratch}.find_colleague($1, $2)`, [company, email]);
        await owner();
        return result;
      };

      // The email lookup by any address is gone from the company.
      await client.query(`set local search_path = ${a.schema}, extensions`);
      expect((await attempt("select acc_add_existing_user($1, 'viewer')", [colleague.email])).error).toMatch(/does not exist/);

      // A colleague is found, whatever the case of the address.
      const found = await find(admin.id, companyA, colleague.email.toUpperCase());
      expect(found.error).toBeNull();
      expect(found.rows.map((r) => r.colleague_id)).toEqual([colleague.id]);

      // A stranger and an address nobody uses get the same empty answer.
      const stranger = await find(admin.id, companyA, strangerEmail);
      const nobody = await find(admin.id, companyA, `nobody-${randomBytes(4).toString("hex")}@example.invalid`);
      expect(stranger).toEqual({ error: null, rows: [] });
      expect(nobody).toEqual({ error: null, rows: [] });
      expect((await find(admin.id, companyA, "  ")).error).toMatch(/Enter the email address/);

      // Added by id, then found again as already on the list, and refused a second time.
      await as(admin.id);
      expect((await attempt("select acc_add_company_user($1, $2, 'viewer')", [colleague.id, "Colleague"])).error).toBeNull();
      await owner();
      expect((await find(admin.id, companyA, colleague.email)).rows.map((r) => r.colleague_id)).toEqual([colleague.id]);
      await as(admin.id);
      expect((await attempt("select acc_add_company_user($1, $2, 'viewer')", [colleague.id, "Colleague"])).error).toMatch(/already in this company/);
      await owner();

      // Only someone holding users.manage in that company may ask, and only about that company.
      expect((await find(colleague.id, companyA, admin.email)).error).toMatch(/permission to manage users/);
      expect((await find(admin.id, randomUUID(), colleague.email)).error).toMatch(/permission to manage users/);
      expect((await find(strangerId, companyA, admin.email)).error).toMatch(/permission to manage users/);

      // Nobody signed out may run it at all.
      await client.query("reset role");
      await client.query("set local role anon");
      expect((await attempt(`select * from ${scratch}.find_colleague($1, $2)`, [companyA, colleague.email])).error).toMatch(/permission denied/);
      await owner();
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
      clearTimeout(killer);
    }
  }, 9 * 60_000);
});
