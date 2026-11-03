/**
 * 3.01: posting defaults (migration 0187).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives. Saved by OneBook's own service.
 *
 *  1. Saved: read back as saved, and the audit log has the entry, insert first
 *     and update after, with what changed.
 *  2. Cleared: every default empty again.
 *  3. An account of the wrong kind for each default is refused, and so is an
 *     inactive one.
 *  4. A viewer cannot save, and no session can write the table around the function.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/posting-defaults.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { getPostingDefaults, savePostingDefaults } from "@/lib/services/posting-defaults";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("posting defaults", () => {
  it("are saved through the function only, checked by kind, audited, and cleared", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("posting-defaults: hard timeout");
      process.exit(2);
    }, 8 * 60_000);
    await client.connect();
    const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[];
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
      if (!admin) throw new Error("no active administrator to sign in as");
      const [viewer] = await q<{ id: string }>("select id from auth.users where id <> $1 and email is not null order by created_at limit 1", [admin.id]);
      const { schema } = await provisionCompany(
        client,
        { slug: `defaults_${randomBytes(4).toString("hex")}`, legalName: "Posting defaults check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query("insert into acc_app_user (id, full_name, role, status) values ($1, 'Example Viewer', 'viewer', 'active')", [viewer.id]);

      // One account of each kind from the new company's chart, read before any role is taken.
      const pick = async (where: string) => {
        const [row] = await q<{ id: string }>(`select id from acc_account where is_posting_account and status = 'active' and ${where} order by account_code limit 1`);
        if (!row) throw new Error(`no account where ${where}`);
        return row.id;
      };
      // A chart may hold no card yet; one is added for the check, and goes with the rollback.
      await client.query(
        "insert into acc_account (account_code, name, account_type) values ('2059', 'Example Card', 'credit_card') on conflict (account_code) do nothing",
      );
      const bank = await pick("account_type = 'bank'");
      const undeposited = await pick("account_code = '1210'");
      const card = await pick("account_type = 'credit_card'");
      const income = await pick("account_type = 'income'");
      const expense = await pick("account_type = 'expense'");
      const fixedAsset = await pick("account_type = 'fixed_asset'");
      const retired = await pick("account_type = 'expense' and id <> '" + expense + "'");
      await client.query("update acc_account set status = 'inactive' where id = $1", [retired]);

      await as(admin.id);
      const sb = pgSupabase(client);

      // 1. Saved, then changed: read back, and audited both times.
      await savePostingDefaults(sb, { depositAccountId: undeposited, payFromAccountId: card, incomeAccountId: income, expenseAccountId: expense });
      expect(await getPostingDefaults(sb)).toEqual({ depositAccountId: undeposited, payFromAccountId: card, incomeAccountId: income, expenseAccountId: expense });
      await savePostingDefaults(sb, { depositAccountId: bank, payFromAccountId: bank, incomeAccountId: income, expenseAccountId: expense });
      expect((await getPostingDefaults(sb)).depositAccountId).toBe(bank);
      const audit = await q<{ action: string; before_dep: string | null; after_dep: string }>(
        `select action, before_json ->> 'deposit_account_id' as before_dep, after_json ->> 'deposit_account_id' as after_dep
           from acc_audit_log where table_name = 'acc_posting_default' order by created_at, action`,
      );
      expect(audit.map((a) => a.action).sort()).toEqual(["insert", "update"]);
      expect(audit.find((a) => a.action === "update")).toMatchObject({ before_dep: undeposited, after_dep: bank });

      // 2. Cleared.
      await savePostingDefaults(sb, { depositAccountId: null, payFromAccountId: null, incomeAccountId: null, expenseAccountId: null });
      expect(Object.values(await getPostingDefaults(sb))).toEqual([null, null, null, null]);

      // 3. The wrong kind of account, or an inactive one, is refused.
      const save = "select acc_save_posting_defaults($1, $2, $3, $4)";
      expect(await attempt(save, [card, null, null, null])).toMatch(/Money in can land only/);
      expect(await attempt(save, [null, undeposited, null, null])).toMatch(/Money out can come only/);
      expect(await attempt(save, [null, null, expense, null])).toMatch(/default income account must be/);
      expect(await attempt(save, [null, null, null, fixedAsset])).toMatch(/default expense account must be/);
      expect(await attempt(save, [null, null, null, retired])).toMatch(/default expense account must be/);

      // 4. A viewer cannot save, and nobody writes the table around the function.
      expect(await attempt("insert into acc_posting_default (id, income_account_id) values (true, $1)", [income])).toMatch(/permission denied/);
      await as(viewer.id);
      expect(await attempt(save, [bank, null, null, null])).toMatch(/permission to change company settings/);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
