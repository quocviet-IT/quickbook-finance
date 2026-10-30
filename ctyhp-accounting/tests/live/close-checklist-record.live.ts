/**
 * 2.84: a close keeps the month-end checklist as it stood (migration 0180).
 *
 * In a throwaway company built from this tree inside ONE transaction that is
 * always rolled back; nothing survives.
 *
 *  1. A checklist that is not a list of steps is refused, and the month stays open.
 *  2. A viewer cannot close, with or without a checklist.
 *  3. Closed through OneBook's own service: the checklist worked out for that
 *     month is kept on its close event, and the Month-End Close Log reads it back.
 *  4. Reopened and closed again: each close keeps its own checklist; the
 *     reopen keeps none.
 *
 * Run: node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *        tests/live/close-checklist-record.live.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { pgSupabase } from "./support/pg-supabase";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { loadMigrationSources } from "@/lib/db/migration-sources";
import { closePeriodWithChecklist } from "@/lib/services/accounting-dashboard/close-record";
import { provisionCompany } from "@/lib/services/company-provisioning";

describe("closing a month", () => {
  it("keeps the checklist as it stood on the close's own event", async () => {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
    const killer = setTimeout(() => {
      console.error("close-checklist-record: hard timeout");
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
        { slug: `closecheck_${randomBytes(4).toString("hex")}`, legalName: "Close checklist check", isSample: true, displayOrder: 9999, adminUserIds: [admin.id] },
        loadMigrationSources(process.cwd()),
      );
      await client.query(`set local search_path = ${schema}, extensions`);
      await client.query("insert into acc_app_user (id, full_name, role, status) values ($1, 'Example Viewer', 'viewer', 'active')", [viewer.id]);
      await as(admin.id);
      await client.query("select acc_generate_periods(2026)");
      const [{ id: september }] = await q<{ id: string }>("select id from acc_accounting_period where fiscal_year = 2026 and period_month = 9");
      const status = async () => (await q<{ status: string }>("select status::text as status from acc_accounting_period where id = $1", [september]))[0].status;
      const withChecklist = "select acc_close_period_with_checklist($1, 'Example close', null, $2::jsonb)";
      const oneStep = JSON.stringify([{ key: "trial-balance", title: "Trial balance", status: "complete", evidence: "Debits equal credits", blocksClose: true }]);

      // 1. Not a list of steps: refused, and the month stays open.
      expect(await attempt(withChecklist, [september, JSON.stringify({ key: "x" })])).toMatch(/list of between 1 and 40 steps/);
      expect(await attempt(withChecklist, [september, JSON.stringify([{ key: "x", title: "X", status: "maybe" }])])).toMatch(/key, a title and a status/);
      expect(await status()).toBe("open");

      // 2. A viewer cannot close.
      await as(viewer.id);
      expect(await attempt(withChecklist, [september, oneStep])).toMatch(/Not authorized to close a period/);
      await as(admin.id);
      expect(await status()).toBe("open");

      // 3. Closed through the service: the month's checklist is kept on its close event.
      const sb = pgSupabase(client);
      const closed = await closePeriodWithChecklist(sb, september, "Example close", null);
      expect(closed.checklistKept).toBe(true);
      expect(await status()).toBe("closed");
      // Every event of this one transaction has the same created_at, so they are told apart by id.
      const events = async () =>
        q<{ id: string; event: string; steps: number | null; keys: string[] | null }>(
          `select id, event, jsonb_array_length(checklist) as steps,
                  (select array_agg(s ->> 'key') from jsonb_array_elements(checklist) s) as keys
             from acc_period_event where period_id = $1`,
          [september],
        );
      const [first] = await events();
      expect(first.event).toBe("close");
      expect(first.steps).toBeGreaterThan(3);
      expect(first.keys).toContain("trial-balance");

      // 4. Reopened, then closed again with a checklist of its own.
      await client.query("select acc_reopen_period($1, 'Example late bill')", [september]);
      const [{ out: second }] = await q<{ out: string }>(
        "select acc_close_period_with_checklist($1, 'Example close again', null, $2::jsonb) as out",
        [september, oneStep],
      );
      const all = await events();
      const byId = new Map(all.map((e) => [e.id, e]));
      expect(byId.get(first.id)?.steps).toBe(first.steps);
      expect(byId.get(second)).toMatchObject({ event: "close", steps: 1 });
      expect(all.filter((e) => e.event === "reopen").map((e) => e.steps)).toEqual([null]);
      expect(all).toHaveLength(3);
      // The column refuses a checklist on anything but a close.
      await client.query("reset role");
      expect(
        await attempt("update acc_period_event set checklist = $2::jsonb where period_id = $1 and event = 'reopen'", [september, oneStep]),
      ).toMatch(/acc_period_event_checklist_shape/);
    } finally {
      clearTimeout(killer);
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  }, 9 * 60_000);
});
