/**
 * 2.85: declining balance depreciation (migrations 0181 and 0182).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives.
 *
 *  1. A declining-balance asset of $10,000.00 over 60 months with $1,000.00
 *     salvage is planned month by month exactly as lib/domain/fixed-assets.ts
 *     works it out: $333.33 in its first month, straight-line from month 44,
 *     and its last month leaves the salvage value.
 *  2. A straight-line asset is planned as before: even months, the remainder last.
 *  3. A declining-balance asset needs a useful life and both accounts, as a
 *     straight-line one does; the table refuses one without.
 *  4. Its first month posts the planned charge.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/declining-balance.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { decliningBalanceSchedule } from "@/lib/domain/fixed-assets";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("a declining-balance fixed asset", () => {
  it("is planned at twice the straight-line rate, switching to straight-line, ending at salvage", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("declining-balance: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
    const one = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params))[0])[0] as string;
    const attempt = async (sql: string, params: unknown[] = []) => {
      await client.query("savepoint attempt");
      try {
        await client.query(sql, params);
        await client.query("release savepoint attempt");
        return null;
      } catch (err) {
        await client.query("rollback to savepoint attempt");
        return (err as Error).message;
      }
    };
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '10s'");
      await client.query("set local statement_timeout = '120s'");
      const [admin] = await q<{ id: string }>("select id from public.acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1");
      if (!admin) throw new Error("no active administrator to sign in as");
      const { schema } = await provisionCompany(
        client,
        { slug: `ddb_${randomBytes(4).toString("hex")}`, legalName: "Declining balance check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      const asset = await one("insert into acc_account (account_code, name, account_type) values ('1597', 'Example Equipment', 'fixed_asset') returning id");
      const accumulated = await one("insert into acc_account (account_code, name, account_type) values ('1598', 'Example Accumulated Depreciation', 'fixed_asset') returning id");
      const expense = await one("insert into acc_account (account_code, name, account_type) values ('6897', 'Example Depreciation', 'expense') returning id");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);
      await client.query("select acc_generate_periods(2026)");

      const register = (method: string, life: number | null, accounts: boolean) =>
        `select acc_register_fixed_asset('Example ${method}', null, 'Equipment', null, null, '2026-01-10', '2026-01-15', 'USD',
           1000000, 100000, ${life ?? "null"}, '${method}', '${asset}', ${accounts ? `'${accumulated}'` : "null"},
           ${accounts ? `'${expense}'` : "null"}, null, null, null) as id`;
      const planned = async (id: string) =>
        (await q<{ amount: string; period_end: string }>(
          "select planned_amount_minor::text as amount, period_end::text from acc_asset_depreciation_schedule where asset_id = $1 order by sequence_number",
          [id],
        )).map((r) => Number(r.amount));

      // 1. Declining balance, month by month as the domain works it out.
      const ddb = await one(register("declining_balance", 60, true));
      const ddbPlan = await planned(ddb);
      expect(ddbPlan).toEqual(decliningBalanceSchedule(1_000_000, 100_000, 60));
      expect(ddbPlan).toHaveLength(60);
      expect(ddbPlan[0]).toBe(33_333);
      expect(ddbPlan.reduce((sum, c) => sum + c, 0)).toBe(900_000);
      const [{ method }] = await q<{ method: string }>("select depreciation_method::text as method from acc_fixed_asset where id = $1", [ddb]);
      expect(method).toBe("declining_balance");

      // 2. Straight-line, unchanged: $150.00 a month, the remainder in the last.
      const sl = await one(register("straight_line", 60, true));
      const slPlan = await planned(sl);
      expect(new Set(slPlan.slice(0, 59))).toEqual(new Set([15_000]));
      expect(slPlan.reduce((sum, c) => sum + c, 0)).toBe(900_000);

      // 3. Declining balance needs a life and both accounts.
      expect(await attempt(register("declining_balance", null, true))).toMatch(/Useful life is required/);
      await client.query("reset role");
      expect(
        await attempt(
          "update acc_fixed_asset set accumulated_depreciation_account_id = null where id = $1",
          [ddb],
        ),
      ).toMatch(/acc_fixed_asset_method_fields/);
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: admin.id, role: "authenticated" })]);

      // 4. The first month posts what was planned.
      const [posted] = await q<{ posted_count: number; posted_total_minor: string }>(
        "select * from acc_post_asset_depreciation($1, '2026-01-31')",
        [ddb],
      );
      expect([posted.posted_count, Number(posted.posted_total_minor)]).toEqual([1, 33_333]);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
